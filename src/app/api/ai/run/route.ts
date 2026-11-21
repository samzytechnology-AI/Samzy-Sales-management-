import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runBusinessAI } from "@/lib/ai/run-business-ai";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  task: z.enum(["prospect_discovery", "company_research", "lead_qualification", "outreach_draft", "reply_analysis", "business_advice"]),
  objective: z.string().trim().min(12).max(2_000),
  context: z.record(z.unknown()).default({}),
  evidence: z.array(z.object({
    url: z.string().url().max(2_048),
    title: z.string().max(300).optional(),
    excerpt: z.string().max(4_000).optional(),
  })).max(30).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Authenticated, organization-scoped AI execution. No anonymous provider-key proxy. */
export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const organizationId = request.headers.get("x-organization-id") ?? "";
  if (!token) return jsonError("A valid sign-in session is required.", 401);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(organizationId)) {
    return jsonError("A valid organization ID is required.", 400);
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
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

    const { data: memory, error: memoryError } = await supabase
      .from("company_memory")
      .select("category,title,content,confidence,source_reference")
      .eq("organization_id", organizationId)
      .eq("is_approved", true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (memoryError) throw new Error("Could not load approved company memory.");

    const result = await runBusinessAI({
      ...body,
      context: {
        ...body.context,
        approvedCompanyMemory: memory ?? [],
      },
    });

    const { error: runError } = await supabase.from("ai_runs").insert({
      organization_id: organizationId,
      objective: body.objective,
      task_type: body.task,
      model_contributions: result.contributions.map(({ slot, provider, model, content }) => ({ slot, provider, model, content })),
      warnings: result.warnings,
      status: "completed",
    });
    if (runError) throw new Error("AI completed, but the execution record could not be saved. Contact an administrator before retrying.");

    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI execution failed.";
    const safeMessage = message.includes("provider configuration missing")
      ? message
      : message.includes("exceeds the 60 KB")
        ? message
        : "Business AI could not complete this request. Check provider configuration and server logs.";
    return jsonError(safeMessage, 503);
  }
}
