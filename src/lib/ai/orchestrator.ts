import type { CoordinatedResult, ModelAdapter, ModelRequest } from "./types";
import { SAMZY_REVENUE_PLAYBOOK } from "./sales-playbook";
import { SAMZY_BUSINESS_LIFECYCLE } from "../business/lifecycle-playbook";
import { SAMZY_SERVICE_CATALOG, renderSamzyServiceDiscoveryRules } from "../business/service-catalog";

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
    objective: [request.objective, "Apply the mandatory Samzy revenue-conversion playbook below.", SAMZY_REVENUE_PLAYBOOK, "Apply the end-to-end company operating lifecycle below.", SAMZY_BUSINESS_LIFECYCLE, "Use the official Samzy service catalogue and prospect-matching rules below. The structured catalogue is also supplied in context; treat it as the source of truth.", renderSamzyServiceDiscoveryRules()].join("\n\n"),
    context: {
      ...request.context,
      samzyServiceCatalog: SAMZY_SERVICE_CATALOG,
      serviceDiscoveryOutputContract: {
        requiredForProspectTasks: ["prospect_discovery", "company_research", "lead_qualification"],
        businessSnapshot: ["businessName", "location", "industry", "operatingStatus", "operatingEvidenceUrls", "officialWebsite", "officialSocialProfiles", "officialContactChannels", "productsOrServices"],
        customerJourney: ["discovery", "offerUnderstanding", "trustProof", "enquiryOrderBooking", "followUp"],
        serviceFit: ["matchedServiceId", "serviceName", "readiness", "observedNeed", "evidenceUrls", "evidenceSummary", "confidence", "businessBenefit", "fitReasons", "unknowns", "qualificationQuestions", "likelyScope", "pricingFloorNgn", "nextBestAction"],
        score: { total: 100, dimensions: { serviceFit: 25, evidenceStrength: 25, reachableOfficialContact: 15, visibleBusinessActivity: 15, plausibleAbilityToPay: 10, timingOrTrigger: 10 }, requirePerDimensionScoresAndEvidence: true },
        outreach: { wordCount: "35-65", required: ["one verified observation", "one practical benefit", "one low-friction question"], neverAutoSend: true },
        integrity: ["separate verified facts from inference and unknowns", "attach source URLs to material claims", "unknown score dimensions receive conservative scores", "never invent budget, intent, contacts, defects, decision-makers, revenue or urgency", "mark expansion services requires_confirmation and never present them as active offers"],
      },
    },
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
        "For prospect_discovery, company_research and lead_qualification, return the complete serviceDiscoveryOutputContract from context: businessSnapshot, customerJourney, serviceFit (including matchedServiceId and readiness), score with all six weighted dimensions and evidence, disqualification decision/reason where applicable, unknowns and qualificationQuestions. Include the tailored 35–65-word first message, likely reply scenarios with qualitative confidence or insufficient evidence, exact next reply for each, and conversion next step. For outreach_draft and reply_analysis, return the relevant concise message/reply analysis plus risks, assumptions and next step; do not fabricate a prospect research record when none was requested.",
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
        samzyServiceCatalog: SAMZY_SERVICE_CATALOG,
        serviceDiscoveryOutputContract: enrichedRequest.context.serviceDiscoveryOutputContract,
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
