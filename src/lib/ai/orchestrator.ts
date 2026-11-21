import type { CoordinatedResult, ModelAdapter, ModelRequest } from "./types";
import { SAMZY_REVENUE_PLAYBOOK } from "./sales-playbook";
import { SAMZY_BUSINESS_LIFECYCLE } from "../business/lifecycle-playbook";
import { renderSamzyServiceDiscoveryRules } from "../business/service-catalog";

/** Three independent agents share one objective; a second pass produces a unified synthesis. */
export async function coordinateModels(request: ModelRequest, adapters: ModelAdapter[]): Promise<CoordinatedResult> {
  if (adapters.length !== 3) throw new Error(`Exactly three model adapters are required; received ${adapters.length}.`);
  if (new Set(adapters.map((adapter) => adapter.slot)).size !== 3) {
    throw new Error("Model slots A, B and C must each be configured once.");
  }

  const agentMandates = {
    A: "ROLE: Prospect intelligence analyst. Verify business facts, customer journey, fit, reachable decision-maker and strongest evidence-backed commercial opportunity. Flag unknowns; do not write generic pitches.",
    B: "ROLE: Revenue strategist and conversion copywriter. Translate the verified opportunity into a credible business benefit and a short interest-first message. Model likely replies and concise next responses without claiming certainty.",
    C: "ROLE: Independent sales critic and deal coach. Challenge unsupported assumptions, assess objections and conversion friction, improve the message, and recommend the safest high-value next step.",
  } as const;
  const enrichedRequest: ModelRequest = {
    ...request,
    objective: [request.objective, "Apply the mandatory Samzy revenue-conversion playbook below.", SAMZY_REVENUE_PLAYBOOK, "Apply the end-to-end company operating lifecycle below.", SAMZY_BUSINESS_LIFECYCLE, "Use the official Samzy service catalogue and prospect-matching rules below.", renderSamzyServiceDiscoveryRules()].join("\n\n"),
  };
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.generate({
    ...enrichedRequest,
    context: { ...enrichedRequest.context, agentMandate: agentMandates[adapter.slot], independentAnalysis: true },
  })));
  const contributions = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const warnings = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [`Model ${adapters[index].slot} failed: ${result.reason instanceof Error ? result.reason.message : "Provider error"}`]
      : [],
  );
  if (!contributions.length) throw new Error(`All AI providers failed. ${warnings.join(" | ")}`);

  const synthesizer = adapters.find((adapter) => adapter.slot === "C") ?? adapters[0];
  let synthesis: string;
  try {
    const result = await synthesizer.generate({
      task: "business_advice",
      objective: [
        "Synthesize the independent model contributions into one decision-ready answer.",
        "Preserve the original objective. Identify agreement, meaningful disagreements, unsupported claims, and missing evidence.",
        "Do not treat majority agreement as proof. Do not invent facts or citations.",
        "For prospect_discovery, company_research, lead_qualification, outreach_draft and reply_analysis, produce: verified snapshot; strongest evidenced opportunity; practical benefit and plausible revenue pathway; concise first message (35–65 words); likely reply scenarios with calibrated confidence or insufficient evidence; exact short next reply for each; conversion next step; risks and unknowns.",
        "The first message must earn a reply, not attempt to close. Make the business benefit immediately clear. Keep client-facing drafts concise and natural.",
        "Return an executive decision, evidence-backed findings, disagreements/risks, recommended next actions, and confidence/unknowns.",
        "For client/project/finance/operations questions, identify the current business lifecycle stage and give the next best operational action. Distinguish quoted value, signed contract value, invoiced amount, outstanding balance and cash actually collected. Include delivery milestones, acceptance evidence, overdue receivables and retention opportunities when relevant.",
        "If and only if the original user explicitly requested one supported company operation and all required details are present, append exactly one [[SAMZY_ACTION_PROPOSAL]] JSON marker containing action_type, summary and a schema-valid payload. Never propose an action based only on a recommendation. Do not propose outreach delivery, payments, contracts, final prices or deletions. If details are missing, ask a question and omit the marker.",
      ].join(" "),
      context: {
        originalTask: request.task,
        originalObjective: request.objective,
        originalContext: request.context,
        originalEvidence: request.evidence ?? [],
        independentContributions: contributions.map(({ slot, provider, model, content, evidence }) => ({
          slot, provider, model, content, evidence: evidence ?? [],
        })),
      },
    });
    synthesis = result.content;
  } catch (error) {
    warnings.push(`Synthesis pass failed: ${error instanceof Error ? error.message : "Unknown synthesis error"}`);
    synthesis = "SYNTHESIS UNAVAILABLE — review the independent model contributions below. No unified conclusion was generated.\n\n" +
      contributions.map((item) => `[Model ${item.slot} · ${item.provider}/${item.model}]\n${item.content}`).join("\n\n---\n\n");
  }
  return { objective: request.objective, contributions, synthesis, warnings, completedAt: new Date().toISOString() };
}
