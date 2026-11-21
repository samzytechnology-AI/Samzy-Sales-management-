import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
const uuid = z.string().uuid();
const noStore = { "Cache-Control": "no-store" };
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: noStore });

const payloadSchemas = {
  create_prospect: z.object({
    company_name: z.string().trim().min(2).max(160),
    website_url: z.string().url().max(2048).optional(),
    industry: z.string().trim().max(100).optional(),
    country: z.string().trim().max(80).optional(),
    fit_score: z.number().int().min(0).max(100).optional(),
    research_summary: z.string().trim().max(3000).optional(),
  }).strict(),
  update_prospect_status: z.object({
    prospect_id: uuid,
    status: z.enum(["discovered","researching","qualified","contacted","replied","opportunity","disqualified"]),
  }).strict(),
  create_project: z.object({
    project_name: z.string().trim().min(2).max(160),
    status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]).default("planned"),
    quoted_amount_ngn: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
    due_at: z.string().datetime().optional(),
    client_id: uuid.optional(),
    prospect_id: uuid.optional(),
    product_id: uuid.optional(),
  }).strict(),
  update_project_status: z.object({
    project_id: uuid,
    status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]),
  }).strict(),
  create_approval_request: z.object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(5).max(2000),
    category: z.enum(["outreach","pricing","contract","payment","delivery","other"]).default("other"),
  }).strict(),
} as const;

const createSchema = z.object({
  actionType: z.enum(["create_prospect","update_prospect_status","create_project","update_project_status","create_approval_request"]),
  summary: z.string().trim().min(5).max(240),
  payload: z.record(z.unknown()),
  idempotencyKey: uuid,
});

async function authorize(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return { response: fail("A valid sign-in session is required.", 401) } as const;
  if (!uuid.safeParse(organizationId).success) return { response: fail("A valid organization ID is required.", 400) } as const;
  const db = createServerSupabaseClient();
  const { data, error: authError } = await db.auth.getUser(token);
  if (authError || !data.user) return { response: fail("Your sign-in session is invalid or expired.", 401) } as const;
  const { data: member, error: memberError } = await db.from("organization_members")
    .select("role").eq("organization_id", organizationId).eq("user_id", data.user.id).maybeSingle();
  if (memberError) throw new Error("Could not verify organisation membership.");
  if (!member || !["owner","admin","manager"].includes(member.role)) return { response: fail("You cannot manage AI action requests for this organisation.", 403) } as const;
  return { db, user: data.user, organizationId, role: member.role } as const;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const { data, error } = await auth.db.from("ai_action_requests")
      .select("id,action_type,summary,payload,status,requested_by,approved_by,created_at,expires_at,decided_at,execution_result,failure_reason")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error("Could not load AI action requests. Confirm the action-engine migration is applied.");
    return NextResponse.json({ actions: data ?? [], canReview: ["owner","admin"].includes(auth.role) }, { headers: noStore });
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : "AI actions could not be loaded.", 503);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 16_384) return fail("Request is too large.", 413);
    const input = createSchema.parse(JSON.parse(raw));
    const parsedPayload = payloadSchemas[input.actionType].parse(input.payload);
    const { data, error } = await auth.db.from("ai_action_requests").insert({
      organization_id: auth.organizationId,
      requested_by: auth.user.id,
      action_type: input.actionType,
      summary: input.summary,
      payload: parsedPayload,
      idempotency_key: input.idempotencyKey,
    }).select("id,action_type,summary,status,created_at,expires_at").single();
    if (error) {
      if (error.code === "23505") return fail("This action request was already submitted. Refresh the action list.", 409);
      throw new Error("Could not save the proposed action. Confirm the action-engine migration is applied.");
    }
    const { error: auditError } = await auth.db.from("audit_events").insert({
      organization_id: auth.organizationId, actor_user_id: auth.user.id, actor_type: "user",
      action: "ai_action.proposed", entity_type: "ai_action_request", entity_id: data.id,
      metadata: { action_type: input.actionType, summary: input.summary },
    });
    if (auditError) return fail("Action proposal saved, but its audit event could not be recorded. Contact an administrator.", 503);
    return NextResponse.json({ action: data }, { status: 201, headers: noStore });
  } catch (cause) {
    if (cause instanceof z.ZodError) return fail(cause.issues[0]?.message ?? "Invalid action proposal.", 422);
    return fail("The action proposal could not be created.", 503);
  }
}

const decisionSchema = z.object({
  id: uuid,
  decision: z.enum(["approved","rejected"]),
  note: z.string().trim().max(1000).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if ("response" in auth) return auth.response;
    if (!["owner","admin"].includes(auth.role)) return fail("Only organisation owners and administrators can approve or reject AI actions.", 403);
    const input = decisionSchema.parse(await request.json());
    const { data, error } = await auth.db.rpc("review_ai_action_request", {
      p_organization_id: auth.organizationId,
      p_action_request_id: input.id,
      p_actor_user_id: auth.user.id,
      p_decision: input.decision,
      p_decision_note: input.note ?? null,
    });
    if (error) return fail(error.message.includes("no longer pending") ? error.message : "The AI action could not be reviewed or executed. Check the action record and database logs.", 409);
    return NextResponse.json({ result: data }, { headers: noStore });
  } catch (cause) {
    if (cause instanceof z.ZodError) return fail(cause.issues[0]?.message ?? "Invalid approval decision.", 422);
    return fail("The AI action could not be reviewed.", 503);
  }
}
