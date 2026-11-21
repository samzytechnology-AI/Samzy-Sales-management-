import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { evaluateOutreach } from "@/lib/outreach/policy";
import { sendWhatsAppTemplate, WhatsAppDeliveryError } from "@/lib/outreach/whatsapp";
export const runtime = "nodejs";
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });
const bodySchema = z.object({ outreachId: uuid }).strict();

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return fail("A valid sign-in session is required.", 401);
  if (!uuid.safeParse(organizationId).success) return fail("A valid organisation ID is required.", 400);
  let input: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4096) return fail("Request is too large.", 413);
    input = bodySchema.parse(JSON.parse(raw));
  } catch (cause) {
    return fail(cause instanceof z.ZodError ? cause.issues[0]?.message ?? "Invalid send request." : "Invalid request body.", 400);
  }
  try {
    const db = createServerSupabaseClient();
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return fail("Your sign-in session is invalid or expired.", 401);
    const { data: member, error: memberError } = await db.from("organization_members").select("role")
      .eq("organization_id", organizationId).eq("user_id", auth.user.id).maybeSingle();
    if (memberError) return fail("Could not verify company membership.", 503);
    if (!member || !["owner", "admin"].includes(member.role)) return fail("Only an organisation owner or administrator can send WhatsApp outreach.", 403);

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? "";
    const language = process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en";
    if (!accessToken || !phoneNumberId || !templateName) return fail("WhatsApp is not configured. Add WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and an approved WHATSAPP_TEMPLATE_NAME.", 503);

    const { data: event, error: eventError } = await db.from("outreach_events")
      .select("id,prospect_id,channel,recipient,direction,status,body").eq("id", input.outreachId)
      .eq("organization_id", organizationId).maybeSingle();
    if (eventError) return fail("Could not load the outreach draft.", 503);
    if (!event || event.direction !== "outbound" || event.status !== "draft" || !event.prospect_id || event.channel !== "whatsapp")
      return fail("Only an unsent WhatsApp draft linked to a CRM prospect can be sent.", 409);
    if (!event.body?.trim() || event.body.trim().length < 10) return fail("The outreach message is empty or too short.", 422);
    const phone = event.recipient.replace(/[\s().-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return fail("Save the WhatsApp contact in international E.164 format, e.g. +2348012345678.", 422);

    const { data: contact, error: contactError } = await db.from("contact_points").select("id,is_verified,consent_basis,address")
      .eq("organization_id", organizationId).eq("prospect_id", event.prospect_id).eq("channel", "whatsapp")
      .eq("address", event.recipient).maybeSingle();
    if (contactError || !contact || !contact.is_verified || !contact.consent_basis?.trim())
      return fail("Sending requires an owner/admin-verified WhatsApp contact and recorded consent/source basis.", 409);

    const [suppression, recent, total, latest, inbound] = await Promise.all([
      db.from("suppression_list").select("id").eq("organization_id", organizationId).eq("channel", "whatsapp").eq("normalized_address", phone).maybeSingle(),
      db.from("outreach_events").select("id", {count:"exact",head:true}).eq("organization_id", organizationId).eq("channel","whatsapp").eq("recipient",event.recipient).eq("direction","outbound").in("status",["sent","send_unknown","sending"]).gte("created_at",new Date(Date.now()-30*86400000).toISOString()),
      db.from("outreach_events").select("id", {count:"exact",head:true}).eq("organization_id", organizationId).eq("channel","whatsapp").eq("recipient",event.recipient).eq("direction","outbound").in("status",["sent","send_unknown","sending"]),
      db.from("outreach_events").select("created_at").eq("organization_id", organizationId).eq("channel","whatsapp").eq("recipient",event.recipient).eq("direction","outbound").in("status",["sent","send_unknown","sending"]).order("created_at",{ascending:false}).limit(1),
      db.from("outreach_events").select("created_at").eq("organization_id", organizationId).eq("channel","whatsapp").eq("recipient",event.recipient).eq("direction","inbound").order("created_at",{ascending:false}).limit(1),
    ]);
    if ([suppression,recent,total,latest,inbound].some(x=>x.error)) return fail("Could not complete WhatsApp eligibility checks. No message was sent.",503);
    if (suppression.data) return fail("This number has opted out and is suppressed.",409);
    const last = latest.data?.[0]?.created_at, lastIn = inbound.data?.[0]?.created_at;
    const active = Boolean(lastIn && (!last || lastIn > last) && Date.now()-new Date(lastIn).getTime()<30*86400000);
    const eligibility = evaluateOutreach({normalizedAddress:phone,optedOut:false,lastContactAt:last,contactCount30d:recent.count??0,totalOutboundCount:total.count??0,activeConversation:active},"whatsapp");
    if (!eligibility.allowed) return fail(eligibility.reason,409);

    const {data: claimed,error: claimError}=await db.from("outreach_events").update({status:"sending"})
      .eq("id",event.id).eq("organization_id",organizationId).eq("status","draft").select("id").maybeSingle();
    if(claimError)return fail("Could not reserve this draft for sending.",503);
    if(!claimed)return fail("This draft is already being sent or processed.",409);
    try {
      const sent=await sendWhatsAppTemplate({accessToken,phoneNumberId,to:phone,templateName,language,bodyText:event.body,idempotencyKey:event.id});
      const {error:updateError}=await db.from("outreach_events").update({status:"sent",provider_message_id:sent.messageId,sent_at:new Date().toISOString()})
        .eq("id",event.id).eq("organization_id",organizationId).eq("status","sending");
      if(updateError){
        await db.from("outreach_events").update({status:"send_unknown"}).eq("id",event.id).eq("organization_id",organizationId).eq("status","sending");
        return NextResponse.json({status:"send_unknown",messageId:sent.messageId,warning:"Meta accepted the message but CRM status could not be confirmed. Reconcile before retrying."},{status:202,headers:noStore});
      }
      const {error:auditError}=await db.from("audit_events").insert({organization_id:organizationId,actor_user_id:auth.user.id,actor_type:"user",action:"outreach.whatsapp.sent",entity_type:"outreach_event",entity_id:event.id,metadata:{provider:"meta_whatsapp_cloud_api",provider_message_id:sent.messageId,template:templateName}});
      return NextResponse.json({status:"sent",messageId:sent.messageId,...(auditError?{warning:"Message sent, but audit logging needs administrator review."}:{})},{headers:noStore});
    } catch(cause) {
      const ambiguous=!(cause instanceof WhatsAppDeliveryError)||cause.ambiguous;
      await db.from("outreach_events").update({status:ambiguous?"send_unknown":"failed"}).eq("id",event.id).eq("organization_id",organizationId).eq("status","sending");
      return fail(ambiguous?"Meta's delivery outcome is uncertain. Draft marked send_unknown; check WhatsApp Manager before retrying.":"Meta rejected the template message. Draft marked failed for review.",502);
    }
  } catch {
    return fail("WhatsApp delivery could not be completed. Check server configuration and logs.",503);
  }
}
