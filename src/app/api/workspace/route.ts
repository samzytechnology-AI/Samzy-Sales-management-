import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { evaluateOutreach } from "@/lib/outreach/policy";

export const runtime = "nodejs";
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const error = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

async function authorize(request: NextRequest, write = false) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return { response: error("A valid sign-in session is required.", 401) } as const;
  if (!uuid.safeParse(organizationId).success) return { response: error("A valid organization ID is required.", 400) } as const;
  const db = createServerSupabaseClient();
  const { data, error: authError } = await db.auth.getUser(token);
  if (authError || !data.user) return { response: error("Your sign-in session is invalid or expired.", 401) } as const;
  const { data: member, error: memberError } = await db.from("organization_members")
    .select("role").eq("organization_id", organizationId).eq("user_id", data.user.id).maybeSingle();
  if (memberError) throw new Error("Could not verify company membership.");
  if (!member || !["owner", "admin", "manager"].includes(member.role)) {
    return { response: error("You do not have permission to access this company workspace.", 403) } as const;
  }
  if (write && !["owner", "admin", "manager"].includes(member.role)) {
    return { response: error("You do not have permission to change company records.", 403) } as const;
  }
  return { db, user: data.user, organizationId, role: member.role } as const;
}

const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("client"), company_name: z.string().trim().min(2).max(160), primary_contact_name: z.string().trim().max(120).optional(), email: z.string().email().max(254).optional().or(z.literal("")), phone: z.string().trim().max(40).optional(), website_url: z.string().url().max(2048).optional().or(z.literal("")), industry: z.string().trim().max(100).optional(), notes: z.string().trim().max(2000).optional() }),
  z.object({ type: z.literal("project"), project_name: z.string().trim().min(2).max(160), status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]).default("planned"), quoted_amount_ngn: z.number().int().nonnegative().optional(), due_at: z.string().datetime().optional(), client_id: z.string().uuid().optional().or(z.literal("")), prospect_id: z.string().uuid().optional().or(z.literal("")), product_id: z.string().uuid().optional().or(z.literal("")) }),
  z.object({ type: z.literal("prospect"), company_name: z.string().trim().min(2).max(160), website_url: z.string().url().max(2048).optional().or(z.literal("")), industry: z.string().trim().max(100).optional(), country: z.string().trim().max(80).optional(), fit_score: z.number().int().min(0).max(100).optional(), research_summary: z.string().trim().max(3000).optional() }),
  z.object({ type: z.literal("contact_point"), prospect_id: uuid, channel: z.enum(["email","whatsapp","voice","other"]), address: z.string().trim().min(3).max(254), consent_basis: z.string().trim().max(300).optional() }),
  z.object({ type: z.literal("finance"), direction: z.enum(["income","expense"]), category: z.string().trim().min(2).max(80), description: z.string().trim().min(3).max(300), amount_ngn: z.number().int().positive().max(1_000_000_000_000), status: z.enum(["recorded","pending","void"]).default("recorded"), occurred_at: z.string().date().optional() }),
  z.object({ type: z.literal("product"), product_name: z.string().trim().min(2).max(120), product_key: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/), dashboard_url: z.string().url().max(2048).optional().or(z.literal("")), integration_mode: z.enum(["manual","api","webhook","oauth"]).default("manual"), capabilities: z.array(z.string().trim().min(1).max(60)).max(30).default([]) }),
  z.object({ type: z.literal("approval"), title: z.string().trim().min(3).max(160), description: z.string().trim().min(5).max(2000), category: z.enum(["outreach","pricing","contract","payment","delivery","other"]) }),
  z.object({ type: z.literal("task"), title: z.string().trim().min(2).max(180), description: z.string().trim().max(2000).optional(), status: z.enum(["open","in_progress","blocked","completed","cancelled"]).default("open"), priority: z.enum(["low","normal","high","urgent"]).default("normal"), due_at: z.string().datetime().optional(), project_id: uuid.optional().or(z.literal("")), client_id: uuid.optional().or(z.literal("")), prospect_id: uuid.optional().or(z.literal("")) }),
  z.object({ type: z.literal("outreach_draft"), contact_point_id: uuid, body: z.string().trim().min(10).max(4000) }),
]);

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const { db, organizationId } = auth;
    const moduleName = request.nextUrl.searchParams.get("module") ?? "overview";
    const requestedOffset = Number.parseInt(request.nextUrl.searchParams.get("prospect_offset") ?? "0",10);
    const prospectOffset = moduleName === "prospects" && Number.isFinite(requestedOffset) ? Math.max(0,Math.min(1000000,requestedOffset)) : 0;

    const [prospectsCount, clientsCount, projectsCount, approvalsCount, prospects, clients, projects, products, approvals, finance, financialSummary, tasks] = await Promise.all([
      db.from("prospects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      db.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      db.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["in_progress","blocked","review"]),
      db.from("approval_requests").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "pending"),
      moduleName === "prospects" || moduleName === "overview" || moduleName === "projects" || moduleName === "tasks" || moduleName === "outreach" ? db.from("prospects").select("id,company_name,website_url,industry,country,fit_score,status,research_summary,evidence,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).range(prospectOffset,prospectOffset+99) : Promise.resolve({ data: [], error: null }),
      moduleName === "clients" || moduleName === "overview" || moduleName === "projects" || moduleName === "tasks" ? db.from("clients").select("id,company_name,primary_contact_name,email,phone,industry,status,source_prospect_id,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "projects" || moduleName === "overview" || moduleName === "tasks" ? db.from("projects").select("id,project_name,status,quoted_amount_ngn,approved_amount_ngn,due_at,created_at,client_id,prospect_id").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "products" || moduleName === "overview" || moduleName === "projects" ? db.from("product_registry").select("id,product_name,product_key,dashboard_url,integration_mode,health_status,capabilities,active").eq("organization_id", organizationId).order("product_name").limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "approvals" ? db.from("approval_requests").select("id,title,description,category,status,decision_note,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "finance" || moduleName === "overview" ? db.from("financial_transactions").select("id,direction,category,description,amount_ngn,status,occurred_at,created_at").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
      db.rpc("get_financial_summary", { p_organization_id: organizationId }),
      moduleName === "tasks" || moduleName === "overview" ? db.from("tasks").select("id,title,description,status,priority,due_at,project_id,client_id,prospect_id,created_at,updated_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
    ]);
    const errors = [prospectsCount,clientsCount,projectsCount,approvalsCount,prospects,clients,projects,products,approvals,finance,financialSummary,tasks].filter(x => x.error);
    if (errors.length) throw new Error("One or more dashboard records could not be loaded. Check whether the latest dashboard migration has been applied.");
    const contactPoints = moduleName === "prospects" || moduleName === "overview" || moduleName === "outreach" ? await db.from("contact_points").select("id,prospect_id,channel,address,is_verified,consent_basis,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(300) : { data: [], error: null };
    if (contactPoints.error) throw new Error("CRM contact points could not be loaded.");
    const outreach = moduleName === "outreach" ? await db.from("outreach_events").select("id,channel,recipient,direction,status,body,sent_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100) : { data: [], error: null };
    if (outreach.error) throw new Error("Outreach history could not be loaded.");
    const transactions = finance.data ?? [];
    const totals = Array.isArray(financialSummary.data) ? financialSummary.data[0] : null;
    const income = Number(totals?.income_ngn ?? 0);
    const expenses = Number(totals?.expenses_ngn ?? 0);
    return NextResponse.json({
      summary: {
        prospects: prospectsCount.count ?? 0,
        clients: clientsCount.count ?? 0,
        activeProjects: projectsCount.count ?? 0,
        pendingApprovals: approvalsCount.count ?? 0,
        incomeNgn: income,
        expensesNgn: expenses,
        netNgn: Number(totals?.net_ngn ?? income - expenses),
      },
      prospects: prospects.data ?? [],
      prospectsHasMore: moduleName === "prospects" && (prospectOffset + (prospects.data?.length ?? 0)) < (prospectsCount.count ?? 0),
      prospectsNextOffset: prospectOffset + (prospects.data?.length ?? 0),
      clients: clients.data ?? [], projects: projects.data ?? [],
      products: products.data ?? [], approvals: approvals.data ?? [], finance: transactions, outreach: outreach.data ?? [], contactPoints: contactPoints.data ?? [], tasks: tasks.data ?? [],
      module: moduleName,
      canSendOutreach: ["owner", "admin"].includes(auth.role),
    }, { headers: noStore });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Company dashboard data could not be loaded.", 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request, true);
    if ("response" in auth) return auth.response;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return error("Request is too large.", 413);
    const input = createSchema.parse(JSON.parse(raw));
    const { db, organizationId, user } = auth;
    const normalizedProspectWebsite = input.type === "prospect" && input.website_url ? new URL(input.website_url).toString() : undefined;
    if (input.type === "prospect" && normalizedProspectWebsite) {
      const normalizedWebsite = normalizedProspectWebsite;
      const { data: duplicate, error: duplicateError } = await db.from("prospects")
        .select("id,company_name").eq("organization_id", organizationId)
        .eq("website_url", normalizedWebsite).maybeSingle();
      if (duplicateError) return error("Could not verify whether this prospect already exists.", 503);
      if (duplicate) return error(`A prospect for ${duplicate.company_name} with this website already exists.`, 409);
    }
    if (input.type === "outreach_draft") {
      const { data: contact, error: contactError } = await db.from("contact_points")
        .select("id,prospect_id,channel,address,is_verified,consent_basis")
        .eq("id", input.contact_point_id).eq("organization_id", organizationId).maybeSingle();
      if (contactError || !contact) return error("The selected contact does not belong to this company CRM.", 403);
      if (!contact.is_verified || !contact.consent_basis?.trim()) return error("Outreach drafts require a verified contact point and a recorded consent basis.", 409);
      if (!["email","whatsapp","voice"].includes(contact.channel)) return error("Outreach supports email, WhatsApp or voice contacts only.", 422);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const normalizedAddress = contact.channel === "email" ? contact.address.toLowerCase() : contact.address;
      const [suppression, recent, total, latestOutbound, latestInbound] = await Promise.all([
        db.from("suppression_list").select("id").eq("organization_id", organizationId).eq("channel", contact.channel).eq("normalized_address", normalizedAddress).maybeSingle(),
        db.from("outreach_events").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("prospect_id", contact.prospect_id).eq("channel", contact.channel).eq("recipient", contact.address).eq("direction", "outbound").in("status", ["sent","send_unknown","sending"]).gte("created_at", since),
        db.from("outreach_events").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("prospect_id", contact.prospect_id).eq("channel", contact.channel).eq("recipient", contact.address).eq("direction", "outbound").in("status", ["sent","send_unknown","sending"]),
        db.from("outreach_events").select("created_at").eq("organization_id", organizationId).eq("prospect_id", contact.prospect_id).eq("channel", contact.channel).eq("recipient", contact.address).eq("direction", "outbound").in("status", ["sent","send_unknown","sending"]).order("created_at", { ascending: false }).limit(1),
        db.from("outreach_events").select("created_at").eq("organization_id", organizationId).eq("prospect_id", contact.prospect_id).eq("channel", contact.channel).eq("recipient", contact.address).eq("direction", "inbound").order("created_at", { ascending: false }).limit(1),
      ]);
      if (suppression.error || recent.error || total.error || latestOutbound.error || latestInbound.error) return error("Could not verify outreach eligibility. No draft was created.", 503);
      const lastOutboundAt = latestOutbound.data?.[0]?.created_at;
      const lastInboundAt = latestInbound.data?.[0]?.created_at;
      const activeConversation = Boolean(lastInboundAt && (!lastOutboundAt || lastInboundAt > lastOutboundAt) && Date.now() - new Date(lastInboundAt).getTime() < 30 * 24 * 60 * 60 * 1000);
      const decision = evaluateOutreach({
        normalizedAddress,
        optedOut: Boolean(suppression.data),
        lastContactAt: lastOutboundAt,
        contactCount30d: recent.count ?? 0,
        totalOutboundCount: total.count ?? 0,
        activeConversation,
      }, contact.channel as "email" | "whatsapp" | "voice");
      if (!decision.allowed) return error(decision.reason, 409);
      const { data: draft, error: draftError } = await db.from("outreach_events").insert({
        organization_id: organizationId, prospect_id: contact.prospect_id,
        channel: contact.channel, recipient: contact.address, direction: "outbound",
        status: "draft", body: input.body,
      }).select("id,prospect_id,channel,recipient,direction,status,body,created_at").single();
      if (draftError || !draft) return error("The outreach draft could not be saved.", 503);
      await db.from("audit_events").insert({ organization_id: organizationId, actor_user_id: user.id, actor_type: "user", action: "outreach.draft.created", entity_type: "outreach_event", entity_id: draft.id, metadata: { channel: contact.channel, prospect_id: contact.prospect_id, requires_human_approval: true } });
      return NextResponse.json({ record: draft, decision }, { status: 201, headers: noStore });
    }
    if (input.type === "contact_point") {
      const { data: linkedProspect, error: prospectLookupError } = await db.from("prospects").select("id").eq("id", input.prospect_id).eq("organization_id", organizationId).maybeSingle();
      if (prospectLookupError || !linkedProspect) return error("The contact must belong to a prospect in this company workspace.", 403);
      const normalizedAddress = input.channel === "email" ? input.address.toLowerCase() : input.address;
      const { data: duplicateContact, error: contactLookupError } = await db.from("contact_points").select("id").eq("organization_id", organizationId).eq("channel", input.channel).eq("address", normalizedAddress).maybeSingle();
      if (contactLookupError) return error("Could not verify whether this contact already exists.", 503);
      if (duplicateContact) return error("This contact point is already recorded in the company CRM.", 409);
    }
    if (input.type === "project" && input.client_id) {
      const { data: linkedClient, error: clientLookupError } = await db.from("clients").select("id").eq("id", input.client_id).eq("organization_id", organizationId).maybeSingle();
      if (clientLookupError || !linkedClient) return error("The selected client does not belong to this company workspace.", 403);
    }
    if (input.type === "project" && input.product_id) {
      const { data: linkedProduct, error: productLookupError } = await db.from("product_registry").select("id").eq("id", input.product_id).eq("organization_id", organizationId).maybeSingle();
      if (productLookupError || !linkedProduct) return error("The selected product does not belong to this company workspace.", 403);
    }
    if (input.type === "task") {
      if (input.project_id) {
        const { data, error: lookupError } = await db.from("projects").select("id").eq("id", input.project_id).eq("organization_id", organizationId).maybeSingle();
        if (lookupError || !data) return error("The selected project does not belong to this company workspace.", 403);
      }
      if (input.client_id) {
        const { data, error: lookupError } = await db.from("clients").select("id").eq("id", input.client_id).eq("organization_id", organizationId).maybeSingle();
        if (lookupError || !data) return error("The selected client does not belong to this company workspace.", 403);
      }
      if (input.prospect_id) {
        const { data, error: lookupError } = await db.from("prospects").select("id").eq("id", input.prospect_id).eq("organization_id", organizationId).maybeSingle();
        if (lookupError || !data) return error("The selected prospect does not belong to this company workspace.", 403);
      }
    }
    if (input.type === "project" && input.prospect_id) {
      const { data: linkedProspect, error: prospectLookupError } = await db.from("prospects").select("id").eq("id", input.prospect_id).eq("organization_id", organizationId).maybeSingle();
      if (prospectLookupError || !linkedProspect) return error("The selected prospect does not belong to this company workspace.", 403);
    }
    const table = input.type === "client" ? "clients" : input.type === "project" ? "projects" : input.type === "prospect" ? "prospects" : input.type === "contact_point" ? "contact_points" : input.type === "finance" ? "financial_transactions" : input.type === "product" ? "product_registry" : input.type === "task" ? "tasks" : "approval_requests";
    const payload: Record<string, unknown> = { ...input, organization_id: organizationId };
    if (normalizedProspectWebsite) payload.website_url = normalizedProspectWebsite;
    if (input.type === "contact_point") payload.address = input.channel === "email" ? input.address.toLowerCase() : input.address;
    delete payload.type;
    if (input.type === "finance") payload.recorded_by = user.id;
    if (input.type === "task") payload.created_by = user.id;
    if (input.type === "approval") payload.requested_by = user.id;
    const { data, error: insertError } = await db.from(table).insert(payload).select("*").single();
    if (insertError || !data) return error("The record could not be saved. Check required fields and database migrations.", 400);
    await db.from("audit_events").insert({ organization_id: organizationId, actor_user_id: user.id, actor_type: "user", action: `dashboard.${input.type}.created`, entity_type: input.type, entity_id: data.id, metadata: { source: "dashboard" } });
    return NextResponse.json({ record: data }, { status: 201, headers: noStore });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Invalid record details.", 422);
    return error(cause instanceof Error && cause.message === "Unexpected end of JSON input" ? "Request body is empty or invalid." : "The company record could not be saved.", 503);
  }
}

const patchSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approval"), id: uuid, decision: z.enum(["approved","rejected"]), decision_note: z.string().trim().max(1000).optional() }),
  z.object({ type: z.literal("convert_prospect"), prospect_id: uuid }),
  z.object({ type: z.literal("prospect"), id: uuid, status: z.enum(["discovered","researching","qualified","contacted","replied","opportunity","disqualified"]) }),
  z.object({ type: z.literal("project"), id: uuid, status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]) }),
  z.object({ type: z.literal("client"), id: uuid, status: z.enum(["active","inactive","on_hold"]) }),
  z.object({ type: z.literal("task"), id: uuid, status: z.enum(["open","in_progress","blocked","completed","cancelled"]) }),
  z.object({ type: z.literal("contact_point_verify"), id: uuid, verification_note: z.string().trim().min(5).max(300) }),
]);
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorize(request, true);
    if ("response" in auth) return auth.response;
    const input = patchSchema.parse(await request.json());

    if (input.type === "contact_point_verify") {
      if (!["owner","admin"].includes(auth.role)) return error("Only an owner or administrator can verify a CRM contact point.", 403);
      const { data, error: verificationError } = await auth.db.from("contact_points").update({ is_verified: true })
        .eq("id", input.id).eq("organization_id", auth.organizationId).eq("is_verified", false)
        .not("consent_basis", "is", null).neq("consent_basis", "")
        .select("id,prospect_id,is_verified").maybeSingle();
      if (verificationError || !data) return error("Contact verification requires an unverified contact with a recorded consent basis.", 409);
      await auth.db.from("audit_events").insert({ organization_id: auth.organizationId, actor_user_id: auth.user.id, actor_type: "user", action: "crm.contact_point.verified", entity_type: "contact_point", entity_id: input.id, metadata: { verification_note: input.verification_note, verification_mode: "manual_attestation" } });
      return NextResponse.json({ record: data, verification_mode: "manual_attestation" }, { headers: noStore });
    }

    if (input.type === "convert_prospect") {
      const { data: converted, error: conversionError } = await auth.db.rpc("convert_prospect_to_client", {
        p_organization_id: auth.organizationId,
        p_prospect_id: input.prospect_id,
        p_actor_user_id: auth.user.id,
      });
      if (conversionError || !converted) return error("Prospect conversion failed. Confirm the CRM migration is applied and the prospect belongs to this company.", 409);
      return NextResponse.json({ record: converted }, { headers: noStore });
    }

    if (input.type === "approval") {
      if (!["owner","admin"].includes(auth.role)) return error("Only company owners or administrators can decide approvals.", 403);
      const { data, error: updateError } = await auth.db.from("approval_requests").update({
        status: input.decision, decision_note: input.decision_note ?? null,
        decided_by: auth.user.id, decided_at: new Date().toISOString(),
      }).eq("id", input.id).eq("organization_id", auth.organizationId).eq("status", "pending").select("id,status").maybeSingle();
      if (updateError || !data) return error("This approval is no longer pending or could not be updated.", 409);
      await auth.db.from("audit_events").insert({ organization_id: auth.organizationId, actor_user_id: auth.user.id, actor_type: "user", action: `approval.${input.decision}`, entity_type: "approval_request", entity_id: input.id, metadata: { decision_note: input.decision_note ?? null } });
      return NextResponse.json({ record: data }, { headers: noStore });
    }

    const table = input.type === "prospect" ? "prospects" : input.type === "project" ? "projects" : input.type === "task" ? "tasks" : "clients";
    const { data, error: updateError } = await auth.db.from(table).update({
      status: input.status, updated_at: new Date().toISOString(),
    }).eq("id", input.id).eq("organization_id", auth.organizationId).select("id,status").maybeSingle();
    if (updateError || !data) return error("The company record could not be updated.", 409);
    await auth.db.from("audit_events").insert({ organization_id: auth.organizationId, actor_user_id: auth.user.id, actor_type: "user", action: `dashboard.${input.type}.status_updated`, entity_type: input.type, entity_id: input.id, metadata: { status: input.status } });
    return NextResponse.json({ record: data }, { headers: noStore });
  } catch (cause) {
    if (cause instanceof z.ZodError) return error(cause.issues[0]?.message ?? "Invalid update details.", 422);
    return error("The company record could not be updated.", 503);
  }
}
