import { z } from "zod";

const uuid = z.string().uuid();
const proposalSchema = z.discriminatedUnion("action_type", [
  z.object({
    action_type: z.literal("create_prospect"),
    summary: z.string().trim().min(5).max(240),
    payload: z.object({
      company_name: z.string().trim().min(2).max(160),
      website_url: z.string().url().max(2048).optional(),
      industry: z.string().trim().max(100).optional(),
      country: z.string().trim().max(80).optional(),
      fit_score: z.number().int().min(0).max(100).optional(),
      research_summary: z.string().trim().max(3000).optional(),
    }).strict(),
  }).strict(),
  z.object({
    action_type: z.literal("update_prospect_status"),
    summary: z.string().trim().min(5).max(240),
    payload: z.object({
      prospect_id: uuid,
      status: z.enum(["discovered","researching","qualified","contacted","replied","opportunity","disqualified"]),
    }).strict(),
  }).strict(),
  z.object({
    action_type: z.literal("create_project"),
    summary: z.string().trim().min(5).max(240),
    payload: z.object({
      project_name: z.string().trim().min(2).max(160),
      status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]).default("planned"),
      quoted_amount_ngn: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
      due_at: z.string().datetime().optional(),
      client_id: uuid.optional(),
      prospect_id: uuid.optional(),
      product_id: uuid.optional(),
    }).strict(),
  }).strict(),
  z.object({
    action_type: z.literal("update_project_status"),
    summary: z.string().trim().min(5).max(240),
    payload: z.object({
      project_id: uuid,
      status: z.enum(["planned","in_progress","blocked","review","delivered","cancelled"]),
    }).strict(),
  }).strict(),
  z.object({
    action_type: z.literal("create_approval_request"),
    summary: z.string().trim().min(5).max(240),
    payload: z.object({
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().min(5).max(2000),
      category: z.enum(["outreach","pricing","contract","payment","delivery","other"]).default("other"),
    }).strict(),
  }).strict(),
]);

export type AIActionProposal = z.infer<typeof proposalSchema>;

const OPEN = "[[SAMZY_ACTION_PROPOSAL]]";
const CLOSE = "[[/SAMZY_ACTION_PROPOSAL]]";

/** Extract one strictly validated proposal. Invalid or malformed markers are removed and never executed. */
export function extractAIActionProposal(content: string): {
  cleanContent: string;
  proposal?: AIActionProposal;
  warning?: string;
} {
  const occurrences = content.split(OPEN).length - 1;
  if (occurrences === 0) return { cleanContent: content.trim() };
  if (occurrences > 1) return { cleanContent: content.replace(/\[\[SAMZY_ACTION_PROPOSAL\]\][\s\S]*?(?:\[\[\/SAMZY_ACTION_PROPOSAL\]\]|$)/g, "").trim(), warning: "The AI returned multiple action proposals. None were submitted." };
  const start = content.indexOf(OPEN);
  const end = content.indexOf(CLOSE, start + OPEN.length);
  if (end < 0) {
    return { cleanContent: content.slice(0, start).trim(), warning: "The AI action proposal was incomplete and was not submitted." };
  }
  const raw = content.slice(start + OPEN.length, end).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const cleanContent = (content.slice(0, start) + content.slice(end + CLOSE.length)).trim();
  try {
    const parsed = proposalSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { cleanContent, warning: "The AI suggested an action, but its details failed validation. No action was submitted." };
    }
    return { cleanContent, proposal: parsed.data };
  } catch {
    return { cleanContent, warning: "The AI suggested an action in an invalid format. No action was submitted." };
  }
}
