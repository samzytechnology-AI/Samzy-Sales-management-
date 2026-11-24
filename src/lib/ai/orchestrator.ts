import type { CoordinatedResult, ModelAdapter, ModelRequest } from "./types";
import { SAMZY_SERVICE_CATALOG } from "../business/service-catalog";

const PROSPECT_TASKS = new Set(["prospect_discovery", "company_research", "lead_qualification"]);

/** Five independent agents share one bounded objective; one successful agent can still produce a useful answer. */
export async function coordinateModels(request: ModelRequest, adapters: ModelAdapter[]): Promise<CoordinatedResult> {
  if (adapters.length < 1) throw new Error("At least one configured AI provider is required.");
  if (new Set(adapters.map((adapter) => adapter.slot)).size !== adapters.length) {
    throw new Error("Each configured model slot must appear only once.");
  }

  const prospectTask = PROSPECT_TASKS.has(request.task);
  const serviceDiscoveryOutputContract = {
    requiredForProspectTasks: ["prospect_discovery", "company_research", "lead_qualification"],
    businessSnapshot: ["businessName", "location", "industry", "operatingStatus", "operatingEvidenceUrls", "officialWebsite", "officialSocialProfiles", "officialContactChannels", "productsOrServices"],
    customerJourney: ["discovery", "offerUnderstanding", "trustProof", "enquiryOrderBooking", "followUp"],
    serviceFit: ["matchedServiceId", "serviceName", "readiness", "observedNeed", "evidenceUrls", "evidenceSummary", "confidence", "businessBenefit", "fitReasons", "unknowns", "qualificationQuestions", "likelyScope", "pricingFloorNgn", "nextBestAction"],
    score: { total: 100, dimensions: { serviceFit: 25, evidenceStrength: 25, reachableOfficialContact: 15, visibleBusinessActivity: 15, plausibleAbilityToPay: 10, timingOrTrigger: 10 }, requirePerDimensionScoresAndEvidence: true },
    outreach: { wordCount: "35-65", required: ["one verified observation", "one practical benefit", "one low-friction question"], neverAutoSend: true },
    integrity: ["separate verified facts from inference and unknowns", "attach source URLs to material claims", "unknown score dimensions receive conservative scores", "never invent budget, intent, contacts, defects, decision-makers, revenue or urgency", "mark expansion services requires_confirmation and never present them as active offers"],
  };

  const enrichedRequest: ModelRequest = {
    ...request,
    objective: request.objective,
    context: {
      ...request.context,
      ...(prospectTask ? {
        samzyServiceCatalog: SAMZY_SERVICE_CATALOG,
        serviceDiscoveryOutputContract,
      } : {}),
      independentAnalysis: true,
      crossEvaluationInstructions: "Independently examine evidence quality, business fit, operational feasibility, commercial value, risks, alternatives and unknowns. Challenge assumptions. Do not assume another provider covers any dimension.",
    },
  };

  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.generate(enrichedRequest)));
  const contributions = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const warnings = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [`Model ${adapters[index].slot} failed: ${result.reason instanceof Error ? result.reason.message : "Provider error"}`]
      : [],
  );
  if (!contributions.length) throw new Error(`All AI providers failed. ${warnings.join(" | ")}`);

  const successfulSlots = new Set(contributions.map((item) => item.slot));
  const synthesizer = (["D", "E", "C", "B", "A"] as const)
    .map((slot) => adapters.find((adapter) => adapter.slot === slot && successfulSlots.has(slot)))
    .find(Boolean) ?? adapters[0];

  if (contributions.length === 1) {
    warnings.push("Only one model responded; cross-checking was skipped.");
    const availableAnswer = contributions[0].content.trim();
    const boundedAnswer = availableAnswer.length > 1_800
      ? availableAnswer.slice(0, 1_800).replace(/\s+\S*$/, "") + "…"
      : availableAnswer;
    return {
      objective: request.objective,
      contributions,
      synthesis: boundedAnswer
        ? "### Available answer\n\n" + boundedAnswer + "\n\n*This reply is based on one model and has not been cross-checked.*"
        : "I couldn't produce a usable answer. Please try again shortly.",
      warnings,
      completedAt: new Date().toISOString(),
    };
  }

  let synthesis: string;
  try {
    const result = await synthesizer.generate({
      task: "business_advice",
      objective: [
        "Synthesize the independent model contributions into one clear, natural, decision-ready answer.",
        "Keep the reply concise: target 120–180 words unless the user explicitly asks for detail. Use a short opening, up to 3 simple headings, and 3–5 short bullets where useful. Do not use tables unless the user asks for one. Do not repeat the prompt or narrate the synthesis process.",
        "Preserve the original objective. Briefly note only material disagreements, unsupported claims, missing evidence, and uncertainty.",
        prospectTask
          ? "For prospect tasks include businessSnapshot, customerJourney, serviceFit, six weighted score dimensions with evidence, unknowns, qualification questions, a 35–65-word first message, reply scenarios and next conversion step."
          : "Return an executive decision, evidence-backed findings, risks, assumptions, recommended next actions and confidence.",
        "Never treat majority agreement as proof. Never invent facts, citations or source URLs. Prefer plain conversational language over lengthy executive-report formatting.",
        "For client/project/finance/operations questions distinguish quoted, approved, invoiced, outstanding and collected amounts where relevant.",
        "Only append a structured action proposal if the original user explicitly requested a supported operation and all required details are present. Never propose external message delivery, payments, contracts, final prices, deletions or irreversible actions.",
      ].join(" "),
      context: {
        originalTask: request.task,
        originalObjective: request.objective,
        originalContext: request.context,
        originalEvidence: request.evidence ?? [],
        ...(prospectTask ? { samzyServiceCatalog: SAMZY_SERVICE_CATALOG, serviceDiscoveryOutputContract } : {}),
        independentContributions: contributions.map(({ slot, provider, model, content, evidence }) => ({
          slot, provider, model, content: content.slice(0, 5_000), evidence: (evidence ?? []).slice(0, 10),
        })),
      },
    });
    synthesis = result.content;
  } catch (error) {
    warnings.push(`Synthesis pass failed: ${error instanceof Error ? error.message : "Unknown synthesis error"}`);
    const availableAnswer = contributions[0]?.content?.trim() ?? "";
    const boundedAnswer = availableAnswer.length > 1_800
      ? availableAnswer.slice(0, 1_800).replace(/\s+\S*$/, "") + "…"
      : availableAnswer;
    synthesis = boundedAnswer
      ? "### Available answer\n\n" + boundedAnswer + "\n\n*This reply is based on one model and has not been cross-checked.*"
      : "I couldn't produce a usable answer because the synthesis service was unavailable. Please try again shortly.";
  }
  return { objective: request.objective, contributions, synthesis, warnings, completedAt: new Date().toISOString() };
}
