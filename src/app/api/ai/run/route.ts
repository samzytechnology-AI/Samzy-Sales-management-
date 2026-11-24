import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runBusinessAI } from "@/lib/ai/run-business-ai";
import { extractAIActionProposal } from "@/lib/ai/action-proposals";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const uuidSchema = z.string().uuid();
const bodySchema = z.object({
  task: z.enum(["prospect_discovery", "company_research", "lead_qualification", "outreach_draft", "reply_analysis", "business_advice"]),
  objective: z.string().trim().min(1, "Enter a message before sending.").max(8_000, "Your message is too long (maximum 8,000 characters)."),
  context: z.record(z.string(), z.unknown()).default({}),
  conversationId: uuidSchema.optional(),
  editMessageId: uuidSchema.optional(),
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

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return jsonError("The AI request body could not be read. Please try sending again.", 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
    return jsonError("The request is too large. Keep it under 64 KB.", 413);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonError("The AI request was not valid JSON. Please retry your message.", 400);
  }
  const validatedBody = bodySchema.safeParse(parsedJson);
  if (!validatedBody.success) {
    const issues = validatedBody.error.issues.map(issue => ({
      field: issue.path.length ? issue.path.join(".") : "body",
      message: issue.message,
    }));
    return NextResponse.json(
      { error: "The AI request did not match the expected format.", issues },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const body = validatedBody.data;

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
      supabase.from("outreach_events").select("id,prospect_id,channel,direction,status,body,sent_at,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(10),
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
      // Personal conversations are allowed only for their creator (checked above).
      // Company conversations are shared with authorised organisation members.
    } else {
      const { data: sharedConversation, error: createError } = await supabase.rpc("get_or_create_company_ai_conversation", {
        p_organization_id: organizationId,
        p_user_id: authData.user.id,
        p_title: "Samzy Technology — AI General Manager",
      });
      if (createError || !sharedConversation) throw new Error("Could not open the shared company AI conversation.");
      conversationId = sharedConversation as string;
    }

    if (body.editMessageId) {
      const { data: targetMessage, error: targetMessageError } = await supabase
        .from("ai_messages")
        .select("id,created_at")
        .eq("id", body.editMessageId)
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .eq("actor_user_id", authData.user.id)
        .maybeSingle();
      if (targetMessageError) throw new Error("Could not verify the message selected for editing.");
      if (!targetMessage) return jsonError("The message you selected cannot be edited in this company conversation.", 404);

      const { data: laterUserMessages, error: laterMessagesError } = await supabase
        .from("ai_messages")
        .select("id,actor_user_id")
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .gt("created_at", targetMessage.created_at);
      if (laterMessagesError) throw new Error("Could not verify later conversation messages.");
      if ((laterUserMessages ?? []).some(message => message.actor_user_id !== authData.user.id)) {
        return jsonError("This message cannot be edited because another company user has added a later message. Start a new message instead.", 409);
      }

      const { error: trimError } = await supabase
        .from("ai_messages")
        .delete()
        .eq("organization_id", organizationId)
        .eq("conversation_id", conversationId)
        .gte("created_at", targetMessage.created_at);
      if (trimError) throw new Error("Could not replace the selected message in conversation history.");
    }

    const { data: userMessage, error: userMessageError } = await supabase.from("ai_messages").insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      role: "user",
      actor_user_id: authData.user.id,
      content: body.objective,
    }).select("id").single();
    if (userMessageError || !userMessage) throw new Error("Could not save your message to company history.");
    const userMessageId = userMessage.id as string;

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

    const synthesisAvailable = result.contributions.length >= 1 && !result.warnings.some(warning => warning.startsWith("Synthesis pass failed"));
    const proposalExtraction = extractAIActionProposal(result.synthesis, synthesisAvailable);
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
        let actionStatus = actionRecord.status;
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

        // Low-risk internal records are executed after an explicit owner/admin instruction.
        // Managers retain the review queue. External outreach and commercial commitments
        // are deliberately not supported by this action engine.
        if (["owner", "admin"].includes(membership.role)) {
          const { data: execution, error: executionError } = await supabase.rpc("review_ai_action_request", {
            p_organization_id: organizationId,
            p_action_request_id: actionRecord.id,
            p_actor_user_id: authData.user.id,
            p_decision: "approved",
            p_decision_note: "Auto-executed: explicit owner/admin instruction for a validated low-risk internal action.",
          });
          if (executionError) {
            runWarnings.push("The internal action was saved but could not be auto-executed. It remains in the approval queue.");
          } else if (execution?.status === "executed") {
            actionStatus = "executed";
          } else if (execution?.status === "failed" || execution?.status === "expired") {
            actionStatus = execution.status;
            runWarnings.push("The internal action did not complete. Review its action record and failure details.");
          }
        }
        proposedAction = { ...actionRecord, status: actionStatus };
        if (actionStatus === "executed") {
          assistantContent += "\n\n**Completed:** " + actionRecord.summary + ". The requested internal company record has been created or updated.";
        } else if (actionStatus === "pending_approval") {
          assistantContent += "\n\n**Action queued for review:** " + actionRecord.summary + ". An owner or administrator can review it in Approvals. No company record has been changed yet.";
        } else {
          assistantContent += "\n\n**Action status: " + actionStatus + ".** Check the action record in Approvals before retrying.";
        }
      }
    }

    const { error: runUpdateError } = await supabase.from("ai_runs").update({
      synthesis: assistantContent,
      warnings: runWarnings,
      request_metadata: { conversation_id: conversationId, proposed_action_id: proposedAction?.id ?? null },
    }).eq("id", runRecord.id).eq("organization_id", organizationId);
    if (runUpdateError) throw new Error("The AI result was generated, but its final run record could not be updated.");

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

    return NextResponse.json({ ...result, synthesis: assistantContent, warnings: runWarnings, proposedAction, conversationId, runId: runRecord.id, userMessageId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI execution failed.";
    // Log actionable provider/DB diagnostics server-side; never log request bodies, tokens, or API keys.
    console.error("[business-ai] request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message,
      stack: error instanceof Error ? error.stack : undefined,
      task: body.task,
    });
    const safeMessage = message.includes("All AI providers failed.")
      ? message.slice(0, 900)
      : message.includes("provider configuration missing")
        ? message
        : message.includes("exceeds the 60 KB")
          ? message
          : message.includes("AI usage limits")
            ? message
            : "Business AI could not complete this request. The server recorded a diagnostic error; check the latest function logs.";
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

    if (new URL(request.url).searchParams.get("new") === "1") {
      const { data: newConversation, error: newConversationError } = await supabase
        .from("ai_conversations")
        .insert({
          organization_id: organizationId,
          created_by: authData.user.id,
          scope: "personal",
          title: "New chat",
        })
        .select("id,title,updated_at")
        .single();
      if (newConversationError || !newConversation) {
        console.error("[business-ai] new conversation creation failed", {
          message: newConversationError?.message ?? "No conversation row returned",
        });
        return jsonError("A new chat could not be created. Please try again.", 503);
      }
      return NextResponse.json({
        conversationId: newConversation.id,
        title: newConversation.title,
        messages: [],
      }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: recentConversation, error: recentConversationError } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("organization_id", organizationId)
      .or(`scope.eq.company,and(scope.eq.personal,created_by.eq.${authData.user.id})`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentConversationError) throw new Error("Could not find the latest company conversation.");

    let sharedConversationId = recentConversation?.id as string | undefined;
    if (!sharedConversationId) {
      const { data: createdConversationId, error: sharedConversationError } = await supabase.rpc("get_or_create_company_ai_conversation", {
        p_organization_id: organizationId,
        p_user_id: authData.user.id,
        p_title: "Samzy Technology — AI General Manager",
      });
      if (sharedConversationError || !createdConversationId) throw new Error("Could not open the shared company AI conversation.");
      sharedConversationId = createdConversationId as string;
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("ai_conversations")
      .select("id,title,updated_at")
      .eq("id", sharedConversationId)
      .eq("organization_id", organizationId)
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
