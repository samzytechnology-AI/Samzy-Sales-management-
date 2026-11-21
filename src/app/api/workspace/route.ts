import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

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
  z.object({ type: z.literal("project"), project_name: z.string().trim().min(2).max(160), status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]).default("planned"), quoted_amount_ngn: z.number().int().nonnegative().optional(), due_at: z.string().datetime().optional(), client_id: z.string().uuid().optional().or(z.literal("")), prospect_id: z.string().uuid().optional().or(z.literal("")) }),
  z.object({ type: z.literal("prospect"), company_name: z.string().trim().min(2).max(160), website_url: z.string().url().max(2048).optional().or(z.literal("")), industry: z.string().trim().max(100).optional(), country: z.string().trim().max(80).optional(), research_summary: z.string().trim().max(3000).optional() }),
  z.object({ type: z.literal("finance"), direction: z.enum(["income","expense"]), category: z.string().trim().min(2).max(80), description: z.string().trim().min(3).max(300), amount_ngn: z.number().int().positive().max(1_000_000_000_000), status: z.enum(["recorded","pending","void"]).default("recorded"), occurred_at: z.string().date().optional() }),
  z.object({ type: z.literal("product"), product_name: z.string().trim().min(2).max(120), product_key: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/), dashboard_url: z.string().url().max(2048).optional().or(z.literal("")), integration_mode: z.enum(["manual","api","webhook","oauth"]).default("manual"), capabilities: z.array(z.string().trim().min(1).max(60)).max(30).default([]) }),
  z.object({ type: z.literal("approval"), title: z.string().trim().min(3).max(160), description: z.string().trim().min(5).max(2000), category: z.enum(["outreach","pricing","contract","payment","delivery","other"]) }),
]);

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const { db, organizationId } = auth;
    const moduleName = request.nextUrl.searchParams.get("module") ?? "overview";

    const [prospectsCount, clientsCount, projectsCount, approvalsCount, prospects, clients, projects, products, approvals, finance, financialSummary] = await Promise.all([
      db.from("prospects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      db.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      db.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["in_progress","blocked","review"]),
      db.from("approval_requests").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "pending"),
      moduleName === "prospects" || moduleName === "overview" || moduleName === "projects" ? db.from("prospects").select("id,company_name,website_url,industry,country,fit_score,status,research_summary,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "clients" || moduleName === "overview" || moduleName === "projects" ? db.from("clients").select("id,company_name,primary_contact_name,email,phone,industry,status,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "projects" || moduleName === "overview" ? db.from("projects").select("id,project_name,status,quoted_amount_ngn,approved_amount_ngn,due_at,created_at,client_id,prospect_id").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "products" || moduleName === "overview" ? db.from("product_registry").select("id,product_name,product_key,dashboard_url,integration_mode,health_status,capabilities,active").eq("organization_id", organizationId).order("product_name").limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "approvals" ? db.from("approval_requests").select("id,title,description,category,status,decision_note,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(100) : Promise.resolve({ data: [], error: null }),
      moduleName === "finance" || moduleName === "overview" ? db.from("financial_transactions").select("id,direction,category,description,amount_ngn,status,occurred_at,created_at").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
      db.rpc("get_financial_summary", { p_organization_id: organizationId }),
    ]);
    const errors = [prospectsCount,clientsCount,projectsCount,approvalsCount,prospects,clients,projects,products,approvals,finance,financialSummary].filter(x => x.error);
    if (errors.length) throw new Error("One or more dashboard records could not be loaded. Check whether the latest dashboard migration has been applied.");
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
      prospects: prospects.data ?? [], clients: clients.data ?? [], projects: projects.data ?? [],
      products: products.data ?? [], approvals: approvals.data ?? [], finance: transactions, outreach: outreach.data ?? [],
      module: moduleName,
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
    if (input.type === "project" && input.client_id) {
      const { data: linkedClient, error: clientLookupError } = await db.from("clients").select("id").eq("id", input.client_id).eq("organization_id", organizationId).maybeSingle();
      if (clientLookupError || !linkedClient) return error("The selected client does not belong to this company workspace.", 403);
    }
    if (input.type === "project" && input.prospect_id) {
      const { data: linkedProspect, error: prospectLookupError } = await db.from("prospects").select("id").eq("id", input.prospect_id).eq("organization_id", organizationId).maybeSingle();
      if (prospectLookupError || !linkedProspect) return error("The selected prospect does not belong to this company workspace.", 403);
    }
    const table = input.type === "client" ? "clients" : input.type === "project" ? "projects" : input.type === "prospect" ? "prospects" : input.type === "finance" ? "financial_transactions" : input.type === "product" ? "product_registry" : "approval_requests";
    const payload: Record<string, unknown> = { ...input, organization_id: organizationId };
    delete payload.type;
    if (input.type === "finance") payload.recorded_by = user.id;
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
  z.object({ type: z.literal("prospect"), id: uuid, status: z.enum(["discovered","researching","qualified","contacted","replied","opportunity","customer","disqualified"]) }),
  z.object({ type: z.literal("project"), id: uuid, status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]) }),
  z.object({ type: z.literal("client"), id: uuid, status: z.enum(["active","inactive","on_hold"]) }),
]);
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorize(request, true);
    if ("response" in auth) return auth.response;
    const input = patchSchema.parse(await request.json());

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

    const table = input.type === "prospect" ? "prospects" : input.type === "project" ? "projects" : "clients";
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
