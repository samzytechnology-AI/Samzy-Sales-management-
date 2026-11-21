import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { evaluateOutreach } from "@/lib/outreach/policy";
import { GmailDeliveryError, sendEmailWithGmail } from "@/lib/outreach/gmail";
import { getGmailAccessToken } from "@/lib/gmail/tokens";

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
    if (new TextEncoder().encode(raw).byteLength > 4_096) return fail("Request is too large.", 413);
    input = bodySchema.parse(JSON.parse(raw));
  } catch (cause) {
    return fail(cause instanceof z.ZodError ? cause.issues[0]?.message ?? "Invalid send request." : "Invalid request body.", 400);
  }

  const db = createServerSupabaseClient();
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) return fail("Your sign-in session is invalid or expired.", 401);

  const { data: member, error: memberError } = await db.from("organization_members")
    .select("role").eq("organization_id", organizationId).eq("user_id", authData.user.id).maybeSingle();
  if (memberError) return fail("Could not verify company membership.", 503);
  if (!member || !["owner", "admin"].includes(member.role)) return fail("Only an organisation owner or administrator can send external outreach.", 403);
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_TOKEN_ENCRYPTION_KEY) {
    return fail("Gmail API credentials and encrypted token storage are not configured.", 503);
  }


  const { data: event, error: eventError } = await db.from("outreach_events")
    .select("id,prospect_id,channel,recipient,direction,status,body")
    .eq("id", input.outreachId).eq("organization_id", organizationId).maybeSingle();
  if (eventError) return fail("Could not load the outreach draft.", 503);
  if (!event || event.direction !== "outbound" || event.status !== "draft" || !event.prospect_id) {
    return fail("Only an unsent outbound draft linked to a CRM prospect can be sent.", 409);
  }
  if (event.channel !== "email") {
    return fail("This sender currently supports email drafts only. WhatsApp first-contact messages require an approved Meta template and configured Cloud API credentials.", 422);
  }
  if (!event.body?.trim() || event.body.trim().length < 10) return fail("The outreach message is empty or too short.", 422);

  const normalizedAddress = event.recipient.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedAddress)) return fail("The saved recipient is not a valid email address.", 422);

  const { data: contact, error: contactError } = await db.from("contact_points")
    .select("id,is_verified,consent_basis,address")
    .eq("organization_id", organizationId).eq("prospect_id", event.prospect_id)
    .eq("channel", "email").eq("address", event.recipient).maybeSingle();
  if (contactError || !contact || !contact.is_verified || !contact.consent_basis?.trim()) {
    return fail("Sending requires a verified email contact and a recorded consent/source basis.", 409);
  }

  const [suppression, recent, total, latest, latestInbound, prospect] = await Promise.all([
    db.from("suppression_list").select("id").eq("organization_id", organizationId)
      .eq("channel", "email").eq("normalized_address", normalizedAddress).maybeSingle(),
    db.from("outreach_events").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("channel", "email").eq("recipient", event.recipient)
      .eq("direction", "outbound").in("status", ["sent","send_unknown","sending"])
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    db.from("outreach_events").select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId).eq("channel", "email").eq("recipient", normalizedAddress)
      .eq("direction", "outbound").in("status", ["sent","send_unknown","sending"]),
    db.from("outreach_events").select("created_at").eq("organization_id", organizationId)
      .eq("channel", "email").eq("recipient", normalizedAddress).eq("direction", "outbound")
      .in("status", ["sent","send_unknown","sending"]).order("created_at", { ascending: false }).limit(1),
    db.from("outreach_events").select("created_at").eq("organization_id", organizationId)
      .eq("channel", "email").eq("recipient", normalizedAddress).eq("direction", "inbound")
      .order("created_at", { ascending: false }).limit(1),
    db.from("prospects").select("company_name").eq("id", event.prospect_id)
      .eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (suppression.error || recent.error || total.error || latest.error || latestInbound.error || prospect.error) {
    return fail("Could not complete the outreach eligibility checks. No message was sent.", 503);
  }
  if (suppression.data) return fail("This address has opted out and is suppressed. No message was sent.", 409);
  const lastOutboundAt = latest.data?.[0]?.created_at;
  const lastInboundAt = latestInbound.data?.[0]?.created_at;
  const activeConversation = Boolean(lastInboundAt && (!lastOutboundAt || lastInboundAt > lastOutboundAt) && Date.now() - new Date(lastInboundAt).getTime() < 30 * 24 * 60 * 60 * 1000);

  const eligibility = evaluateOutreach({
    normalizedAddress,
    optedOut: false,
    lastContactAt: lastOutboundAt,
    contactCount30d: recent.count ?? 0,
    totalOutboundCount: total.count ?? 0,
    activeConversation,
  }, "email");
  if (!eligibility.allowed) return fail(eligibility.reason, 409);

  // Atomically claim the draft. A second click or concurrent request cannot send it again.
  const { data: claimed, error: claimError } = await db.from("outreach_events")
    .update({ status: "sending" }).eq("id", event.id).eq("organization_id", organizationId)
    .eq("status", "draft").select("id").maybeSingle();
  if (claimError) return fail("Could not reserve the draft for sending.", 503);
  if (!claimed) return fail("This draft is already being sent or has already been processed.", 409);

  const companyName = prospect.data?.company_name?.trim() || "your business";
  try {
    const { accessToken } = await getGmailAccessToken(organizationId);
    const sent = await sendEmailWithGmail({
      accessToken,
      to: normalizedAddress,
      subject: `A quick idea for ${companyName}`,
      text: event.body.trim(),
    });
    const { error: updateError } = await db.from("outreach_events")
      .update({ status: "sent", provider_message_id: sent.messageId, sent_at: new Date().toISOString() })
      .eq("id", event.id).eq("organization_id", organizationId).eq("status", "sending");
    if (updateError) {
      await db.from("outreach_events").update({ status: "send_unknown" })
        .eq("id", event.id).eq("organization_id", organizationId).eq("status", "sending");
      return NextResponse.json({ status: "send_unknown", messageId: sent.messageId, warning: "The provider accepted the email, but the CRM status could not be confirmed. Do not resend until an administrator reconciles the message." }, { status: 202, headers: noStore });
    }
    const { error: auditError } = await db.from("audit_events").insert({
      organization_id: organizationId, actor_user_id: authData.user.id, actor_type: "user",
      action: "outreach.email.sent", entity_type: "outreach_event", entity_id: event.id,
      metadata: { provider: "gmail", provider_message_id: sent.messageId },
    });
    return NextResponse.json({
      status: "sent",
      messageId: sent.messageId,
      ...(auditError ? { warning: "The email was sent and recorded, but the audit event could not be saved. An administrator should review the audit log." } : {}),
    }, { headers: noStore });
  } catch (cause) {
    const ambiguous = !(cause instanceof GmailDeliveryError) || cause.ambiguous;
    await db.from("outreach_events").update({ status: ambiguous ? "send_unknown" : "failed" })
      .eq("id", event.id).eq("organization_id", organizationId).eq("status", "sending");
    return fail(ambiguous
      ? "The provider outcome is uncertain. The draft is marked send_unknown; check provider logs before retrying."
      : "The email provider rejected the message. The draft is marked failed and can be reviewed.", 502);
  }
}
