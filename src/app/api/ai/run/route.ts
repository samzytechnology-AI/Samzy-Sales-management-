import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runBusinessAI } from "@/lib/ai/run-business-ai";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidSchema = z.string().uuid();
const bodySchema = z.object({
  task: z.enum(["prospect_discovery", "company_research", "lead_qualification", "outreach_draft", "reply_analysis", "business_advice"]),
  objective: z.string().trim().min(12).max(2_000),
  context: z.record(z.unknown()).default({}),
  conversationId: uuidSchema.optional(),
  evidence: z.array(z.object({
    url: z.string().url().max(2_048),
    title: z.string().max(300).optional(),
    excerpt: z.string().max(4_000).optional(),
  })).max(30).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Authenticated, organization-scoped AI execution with persistent chat and atomic usage limits. */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return jsonError("A valid sign-in session is required.", 401);
  if (!uuidSchema.safeParse(organizationId).success) {
    return jsonError("A valid organization ID is required.", 400);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 64 * 1024) return jsonError("The request is too large. Keep it under 64 KB.", 413);

  let body: z.infer<typeof bodySchema>;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
      return jsonError("The request is too large. Keep it under 64 KB.", 413);
    }
    body = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return jsonError("The AI request body is invalid.", 400);
  }

  try {
    const supabase = createServerSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return jsonError("Your sign-in session is invalid or expired.", 401);

    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", authData.user.id)
      .maybeSingle();

    if (membershipError) throw new Error("Could not verify organization membership.");
    if (!membership || !["owner", "admin", "manager"].includes(membership.role)) {
      return jsonError("You do not have permission to run business AI for this organization.", 403);
    }

    const { data: allowed, error: limitError } = await supabase.rpc("consume_ai_rate_limit", {
      p_organization_id: organizationId,
      p_user_id: authData.user.id,
      p_limit: 30,
      p_window_seconds: 3600,
    });
    if (limitError) throw new Error("Could not verify AI usage limits. AI execution was stopped.");
    if (allowed !== true) return jsonError("The company AI usage limit has been reached for this hour. Please try again later.", 429);

    const { data: memory, error: memoryError } = await supabase
      .from("company_memory")
      .select("category,title,content,confidence,source_reference")
      .eq("organization_id", organizationId)
      .eq("is_approved", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("updated_at", { ascending: false })
      .limit(20);
    if (memoryError) throw new Error("Could not load approved company memory.");

    // Give the AI General Manager a fresh, read-only snapshot of the real company workspace.
    const [prospectsResult, clientsResult, projectsResult, approvalsResult, outreachResult, financeResult, runsResult, auditResult] = await Promise.all([
      supabase.from("prospects").select("id,company_name,website_url,industry,country,fit_score,status,research_summary,created_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(25),
      supabase.from("clients").select("id,company_name,primary_contact_name,email,phone,industry,status,source_prospect_id,created_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(25),
      supabase.from("projects").select("id,project_name,status,quoted_amount_ngn,approved_amount_ngn,due_at,client_id,prospect_id,product_id,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(25),
      supabase.from("approval_requests").select("id,title,category,status,created_at,decided_at,decision_note").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(12),
      supabase.from("outreach_events").select("id,prospect_id,channel,recipient,direction,status,body,sent_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(12),
      supabase.rpc("get_financial_summary", { p_organization_id: organizationId }),
      supabase.from("ai_runs").select("id,objective,task_type,status,created_at,synthesis").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(5),
      supabase.from("audit_events").select("action,entity_type,entity_id,metadata,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(20),
    ]);
    const snapshotResults = [prospectsResult, clientsResult, projectsResult, approvalsResult, outreachResult, financeResult, runsResult, auditResult];
    if (snapshotResults.some(result => result.error)) {
      throw new Error("Could not load the complete company operating snapshot. Check the latest database migrations and workspace permissions.");
    }
    const financialTotals = Array.isArray(financeResult.data) ? financeResult.data[0] : null;
    const companySnapshot = {
      capturedAt: new Date().toISOString(),
      dataScope: "Verified records read from this organisation's Business Command Centre database. Empty arrays mean no records were found; they do not imply activity outside this system.",
      loadedRecordCounts: {
        recentProspects: prospectsResult.data?.length ?? 0,
        recentClients: clientsResult.data?.length ?? 0,
        recentProjects: projectsResult.data?.length ?? 0,
        pendingApprovalsInLoadedWindow: approvalsResult.data?.filter(item => item.status === "pending").length ?? 0,
        recentOutreachEvents: outreachResult.data?.length ?? 0,
      },
      prospects: (prospectsResult.data ?? []).map(item => ({ ...item, research_summary: item.research_summary?.slice(0, 1000) ?? null })),
      clients: clientsResult.data ?? [],
      projects: projectsResult.data ?? [],
      approvals: approvalsResult.data ?? [],
      recentOutreach: (outreachResult.data ?? []).map(item => ({ ...item, body: item.body?.slice(0, 500) ?? null })),
      finance: financialTotals ?? { income_ngn: 0, expenses_ngn: 0, net_ngn: 0, transaction_count: 0 },
      recentAiRuns: (runsResult.data ?? []).map(item => ({ ...item, synthesis: item.synthesis?.slice(0, 800) ?? null })),
      recentAuditEvents: (auditResult.data ?? []).map(item => ({ ...item, metadata: item.metadata ? JSON.stringify(item.metadata).slice(0, 500) : null })),
    };

    let conversationId = body.conversationId;
    if (conversationId) {
      const { data: conversation, error: conversationError } = await supabase
        .from("ai_conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("organization_id", organizationId)
        .eq("created_by", authData.user.id)
        .maybeSingle();
      if (conversationError) throw new Error("Could not verify the requested conversation.");
      if (!conversation) return jsonError("That conversation does not belong to your account and company workspace.", 404);
    } else {
      const { data: created, error: createError } = await supabase
        .from("ai_conversations")
        .insert({
          organization_id: organizationId,
          created_by: authData.user.id,
          title: body.objective.slice(0, 80),
        })
        .select("id")
        .single();
      if (createError || !created) throw new Error("Could not create a company conversation.");
      conversationId = created.id;
    }

    const { error: userMessageError } = await supabase.from("ai_messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      role: "user",
      content: body.objective,
    });
    if (userMessageError) throw new Error("Could not save your message to company history.");

    const { data: history, error: historyError } = await supabase
      .from("ai_messages")
      .select("role,content")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversationId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: false })
      .limit(12);
    if (historyError) throw new Error("Could not load the conversation history.");

    const result = await runBusinessAI({
      ...body,
      context: {
        ...body.context,
        conversationHistory: (history ?? []).reverse(),
        approvedCompanyMemory: memory ?? [],
        verifiedCompanySnapshot: companySnapshot,
      },
    });

    const { data: runRecord, error: runError } = await supabase.from("ai_runs").insert({
      organization_id: organizationId,
      actor_user_id: authData.user.id,
      objective: body.objective,
      task_type: body.task,
      model_contributions: result.contributions.map(({ slot, provider, model, content }) => ({ slot, provider, model, content })),
      synthesis: result.synthesis,
      warnings: result.warnings,
      request_metadata: { conversation_id: conversationId },
      status: "completed",
    }).select("id").single();
    if (runError || !runRecord) throw new Error("AI completed, but its execution record could not be saved. Contact an administrator before retrying.");

    const { error: assistantMessageError } = await supabase.from("ai_messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      role: "assistant",
      content: result.synthesis,
      ai_run_id: runRecord.id,
      metadata: { warnings: result.warnings },
    });
    if (assistantMessageError) throw new Error("The AI result was generated, but could not be saved to conversation history.");

    await supabase.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);

    const { error: auditError } = await supabase.from("audit_events").insert({
      organization_id: organizationId,
      actor_user_id: authData.user.id,
      actor_type: "user",
      action: "ai.conversation.run",
      entity_type: "ai_run",
      entity_id: runRecord.id,
      metadata: { task: body.task, conversation_id: conversationId, provider_count: result.contributions.length },
    });
    if (auditError) throw new Error("The AI result was saved, but the audit record could not be completed.");

    return NextResponse.json({ ...result, conversationId, runId: runRecord.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI execution failed.";
    const safeMessage = message.includes("provider configuration missing")
      ? message
      : message.includes("exceeds the 60 KB")
        ? message
        : message.includes("AI usage limits")
          ? message
          : "Business AI could not complete this request. Check provider configuration and server logs.";
    return jsonError(safeMessage, 503);
  }
}


/** Restore the signed-in user's most recent company conversation. */
export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return jsonError("A valid sign-in session is required.", 401);
  if (!uuidSchema.safeParse(organizationId).success) return jsonError("A valid organization ID is required.", 400);

  try {
    const supabase = createServerSupabaseClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return jsonError("Your sign-in session is invalid or expired.", 401);

    const { data: membership, error: membershipError } = await supabase
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (membershipError) throw new Error("Could not verify organization membership.");
    if (!membership || !["owner", "admin", "manager"].includes(membership.role)) {
      return jsonError("You do not have permission to access this company workspace.", 403);
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .select("id,title,updated_at")
      .eq("organization_id", organizationId)
      .eq("created_by", authData.user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conversationError) throw new Error("Could not load your company conversation.");

    if (!conversation) return NextResponse.json({ conversationId: null, messages: [] }, { headers: { "Cache-Control": "no-store" } });

    const { data: messages, error: messagesError } = await supabase
      .from("ai_messages")
      .select("id,role,content,created_at")
      .eq("organization_id", organizationId)
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true })
      .limit(100);
    if (messagesError) throw new Error("Could not restore conversation messages.");

    return NextResponse.json({
      conversationId: conversation.id,
      title: conversation.title,
      messages: messages ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError("Company conversation history could not be loaded. Check server configuration.", 503);
  }
}
