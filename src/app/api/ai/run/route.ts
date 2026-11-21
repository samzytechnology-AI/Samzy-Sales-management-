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
      .limit(30);
    if (memoryError) throw new Error("Could not load approved company memory.");

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
