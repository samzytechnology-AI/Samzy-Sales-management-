import { z } from "zod";
import { createConfiguredAdapters } from "./provider-config";
import { coordinateModels } from "./orchestrator";

const requestSchema = z.object({
  task: z.enum(["prospect_discovery", "company_research", "lead_qualification", "outreach_draft", "reply_analysis", "business_advice"]),
  objective: z.string().trim().min(1).max(8_000),
  context: z.record(z.string(), z.unknown()).default({}),
  evidence: z.array(z.object({
    url: z.string().url().max(2_048),
    title: z.string().max(300).optional(),
    excerpt: z.string().max(4_000).optional(),
  })).max(30).optional(),
});

export async function runBusinessAI(input: unknown) {
  const request = requestSchema.parse(input);
  const serializedSize = JSON.stringify({ context: request.context, evidence: request.evidence ?? [] }).length;
  if (serializedSize > 60_000) {
    throw new Error("AI request context exceeds the 60 KB safety limit. Summarize or narrow the supplied data.");
  }
  const adapters = createConfiguredAdapters();
  return coordinateModels(request, adapters);
}
