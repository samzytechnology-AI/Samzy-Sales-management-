import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runBusinessAI } from "@/lib/ai/run-business-ai";
import { extractAIActionProposal } from "@/lib/ai/action-proposals";
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
      .limit(12);
    if (memoryError) throw new Error("Could not load approved company memory.");

    // Give the AI General Manager a fresh, read-only snapshot of the real company workspace.
    const [prospectsResult, clientsResult, projectsResult, approvalsResult, outreachResult, financeResult, runsResult, auditResult, contactCoverageTotal, verifiedContactTotal, prospectTotal, clientTotal, projectTotal, approvalTotal, outreachTotal] = await Promise.all([
      supabase.from("prospects").select("id,company_name,website_url,industry,country,fit_score,status,research_summary,created_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(12),
      supabase.from("clients").select("id,company_name,industry,status,source_prospect_id,created_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(12),
      supabase.from("projects").select("id,project_name,status,quoted_amount_ngn,approved_amount_ngn,due_at,client_id,prospect_id,product_id,updated_at").eq("organization_id", organizationId).order("updated_at", { ascending: false }).limit(12),
      supabase.from("approval_requests").select("id,title,category,status,created_at,decided_at,decision_note").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(10),
      supabase.from("outreach_events").select("id,prospect_id,channel,recipient,direction,status,body,sent_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(10),
      supabase.rpc("get_financial_summary", { p_organization_id: organizationId }),
      supabase.from("ai_runs").select("id,objective,task_type,status,created_at,synthesis").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(5),
      supabase.from("audit_events").select("action,entity_type,entity_id,metadata,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(10),
      supabase.from("contact_points").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      supabase.from("contact_points").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("is_verified", true),
      supabase.from("prospects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
            supabase.from("clients").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
            supabase.from("projects").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
            supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
            supabase.from("outreach_events").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    ]);
    const snapshotResults = [prospectsResult, clientsResult, projectsResult, approvalsResult, outreachResult, financeResult, runsResult, auditResult, contactCoverageTotal, verifiedContactTotal, prospectTotal, clientTotal, projectTotal, approvalTotal, outreachTotal];
    if (snapshotResults.some(result => result.error)) {
      throw new Error("Could not load the complete company operating snapshot. Check the latest database migrations and workspace permissions.");
    }
    const financialTotals = Array.isArray(financeResult.data) ? financeResult.data[0] : null;
    const boundedApprovedMemory = (memory ?? []).map(item => ({ ...item, content: item.content.slice(0, 800) }));
    const companySnapshot = {
      capturedAt: new Date().toISOString(),
      dataScope: "Records read from this organisation's Business Command Centre database. Database presence confirms the record is stored, not that its claims were independently verified. Empty arrays mean no records were found; they do not imply activity outside this system.",
      recordTotals: {
        prospects: prospectTotal.count ?? 0,
        clients: clientTotal.count ?? 0,
        projects: projectTotal.count ?? 0,
        approvals: approvalTotal.count ?? 0,
        outreachEvents: outreachTotal.count ?? 0,
      },
      loadedRecordCounts: {
        recentProspects: prospectsResult.data?.length ?? 0,
        recentClients: clientsResult.data?.length ?? 0,
        recentProjects: projectsResult.data?.length ?? 0,
        pendingApprovalsInLoadedWindow: approvalsResult.data?.filter(item => item.status === "pending").length ?? 0,
        recentOutreachEvents: outreachResult.data?.length ?? 0,
      },
      prospects: (prospectsResult.data ?? []).map(item => ({ ...item, research_summary: item.research_summary?.slice(0, 500) ?? null })),
      clients: clientsResult.data ?? [],
      projects: projectsResult.data ?? [],
      approvals: approvalsResult.data ?? [],
      recentOutreach: (outreachResult.data ?? []).map(item => ({ ...item, body: item.body?.slice(0, 350) ?? null })),
      finance: financialTotals ?? { income_ngn: 0, expenses_ngn: 0, net_ngn: 0, transaction_count: 0 },
      recentAiRuns: (runsResult.data ?? []).map(item => ({ ...item, synthesis: item.synthesis?.slice(0, 500) ?? null })),
      recentAuditEvents: (auditResult.data ?? []).map(item => ({ ...item, metadata: item.metadata ? JSON.stringify(item.metadata).slice(0, 250) : null })),
      contactCoverage: {
        total: contactCoverageTotal.count ?? 0,
        verified: verifiedContactTotal.count ?? 0,
        unverified: Math.max(0, (contactCoverageTotal.count ?? 0) - (verifiedContactTotal.count ?? 0)),
        note: "Contact addresses are intentionally excluded from the shared AI context. Only exact verification counts are supplied.",
      },
    };

    let conversationId = body.conversationId;
    if (conversationId) {
      const { data: conversation, error: conversationError } = await supabase
        .from("ai_conversations")
        .select("id,scope,created_by")
        .eq("id", conversationId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (conversationError) throw new Error("Could not verify the requested conversation.");
      if (!conversation || (conversation.scope === "personal" && conversation.created_by !== authData.user.id)) {
        return jsonError("That conversation does not belong to your account and company workspace.", 404);
      }
      if (conversation.scope !== "company") {
        return jsonError("The shared company AI conversation is ready. Refresh the dashboard to continue in it.", 409);
      }
    } else {
      const { data: sharedConversation, error: createError } = await supabase.rpc("get_or_create_company_ai_conversation", {
        p_organization_id: organizationId,
        p_user_id: authData.user.id,
        p_title: "Samzy Technology — AI General Manager",
      });
      if (createError || !sharedConversation) throw new Error("Could not open the shared company AI conversation.");
      conversationId = sharedConversation as string;
    }

    const { error: userMessageError } = await supabase.from("ai_messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      role: "user",
      actor_user_id: authData.user.id,
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
        conversationHistory: (history ?? []).reverse().map(item => ({ role: item.role, content: item.content.slice(0, 1200) })),
        approvedCompanyMemory: boundedApprovedMemory,
        recordedCompanySnapshot: companySnapshot,
      },
    });

    const proposalExtraction = extractAIActionProposal(result.synthesis);
    const runWarnings = [...result.warnings];
    if (proposalExtraction.warning) runWarnings.push(proposalExtraction.warning);
    const cleanSynthesis = proposalExtraction.cleanContent || "The AI did not return a user-facing synthesis.";

    const { data: runRecord, error: runError } = await supabase.from("ai_runs").insert({
      organization_id: organizationId,
      actor_user_id: authData.user.id,
      objective: body.objective,
      task_type: body.task,
      model_contributions: result.contributions.map(({ slot, provider, model, content }) => ({ slot, provider, model, content })),
      synthesis: cleanSynthesis,
      warnings: runWarnings,
      request_metadata: { conversation_id: conversationId },
      status: "completed",
    }).select("id").single();
    if (runError || !runRecord) throw new Error("AI completed, but its execution record could not be saved. Contact an administrator before retrying.");

    let proposedAction: { id: string; action_type: string; summary: string; status: string } | null = null;
    let assistantContent = cleanSynthesis;
    if (proposalExtraction.proposal) {
      const proposal = proposalExtraction.proposal;
      const { data: actionRecord, error: actionError } = await supabase.from("ai_action_requests").insert({
        organization_id: organizationId,
        requested_by: authData.user.id,
        ai_run_id: runRecord.id,
        action_type: proposal.action_type,
        summary: proposal.summary,
        payload: proposal.payload,
        idempotency_key: crypto.randomUUID(),
      }).select("id,action_type,summary,status").single();
      if (actionError || !actionRecord) {
        runWarnings.push("The AI prepared a structured action, but the action queue could not save it. No company record was changed. Check that migration 007 is applied and the action table is exposed to the Supabase Data API.");
        assistantContent += "\n\nThe action proposal could not be saved, so nothing was changed. An administrator must check the action-engine database setup.";
      } else {
        proposedAction = actionRecord;
        assistantContent += "\n\n**Action proposal submitted for approval:** " + actionRecord.summary + ". No company record has been changed. An owner or administrator must approve it in Approvals.";
        const { error: actionAuditError } = await supabase.from("audit_events").insert({
          organization_id: organizationId,
          actor_user_id: authData.user.id,
          actor_type: "user",
          action: "ai_action.proposed",
          entity_type: "ai_action_request",
          entity_id: actionRecord.id,
          metadata: { action_type: actionRecord.action_type, ai_run_id: runRecord.id },
        });
        if (actionAuditError) runWarnings.push("The action proposal was queued, but its audit event could not be saved. Administrator review is required.");
      }
    }

    await supabase.from("ai_runs").update({
      synthesis: assistantContent,
      warnings: runWarnings,
      request_metadata: { conversation_id: conversationId, proposed_action_id: proposedAction?.id ?? null },
    }).eq("id", runRecord.id).eq("organization_id", organizationId);

    const { error: assistantMessageError } = await supabase.from("ai_messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      role: "assistant",
      content: assistantContent,
      ai_run_id: runRecord.id,
      metadata: { warnings: runWarnings, proposed_action_id: proposedAction?.id ?? null },
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

    return NextResponse.json({ ...result, synthesis: assistantContent, warnings: runWarnings, proposedAction, conversationId, runId: runRecord.id }, { headers: { "Cache-Control": "no-store" } });
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

    const { data: sharedConversationId, error: sharedConversationError } = await supabase.rpc("get_or_create_company_ai_conversation", {
      p_organization_id: organizationId,
      p_user_id: authData.user.id,
      p_title: "Samzy Technology — AI General Manager",
    });
    if (sharedConversationError || !sharedConversationId) throw new Error("Could not open the shared company AI conversation.");

    const { data: conversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .select("id,title,updated_at")
      .eq("id", sharedConversationId)
      .eq("organization_id", organizationId)
      .eq("scope", "company")
      .maybeSingle();
    if (conversationError || !conversation) throw new Error("Could not load your shared company conversation.");

    const { data: messages, error: messagesError } = await supabase
      .from("ai_messages")
      .select("id,role,actor_user_id,content,created_at")
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
