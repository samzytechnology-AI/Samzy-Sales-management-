import type { CoordinatedResult, ModelAdapter, ModelRequest } from "./types";
import { SAMZY_SERVICE_CATALOG } from "../business/service-catalog";

const PROSPECT_TASKS = new Set(["prospect_discovery", "company_research", "lead_qualification"]);

/**
 * Availability-first orchestration.
 * Use the first provider that answers, rather than spending the whole request budget
 * calling several providers that may be out of credits or rate-limited.
 */
export async function coordinateModels(request: ModelRequest, adapters: ModelAdapter[]): Promise<CoordinatedResult> {
  if (adapters.length < 1) throw new Error("At least one configured AI provider is required.");
  if (new Set(adapters.map((adapter) => adapter.slot)).size !== adapters.length) {
    throw new Error("Each configured model slot must appear only once.");
  }

  const prospectTask = PROSPECT_TASKS.has(request.task);
  const serviceDiscoveryOutputContract = {
    requiredForProspectTasks: ["prospect_discovery", "company_research", "lead_qualification"],
    businessSnapshot: ["businessName","location","industry","operatingStatus","operatingEvidenceUrls","officialWebsite","officialSocialProfiles","officialContactChannels","productsOrServices"],
    customerJourney: ["discovery","offerUnderstanding","trustProof","enquiryOrderBooking","followUp"],
    serviceFit: ["matchedServiceId","serviceName","readiness","observedNeed","evidenceUrls","evidenceSummary","confidence","businessBenefit","fitReasons","unknowns","qualificationQuestions","likelyScope","pricingFloorNgn","nextBestAction"],
    score: { total: 100, dimensions: { serviceFit:25,evidenceStrength:25,reachableOfficialContact:15,visibleBusinessActivity:15,plausibleAbilityToPay:10,timingOrTrigger:10 }, requirePerDimensionScoresAndEvidence: true },
    outreach: { wordCount:"35-65",required:["one verified observation","one practical benefit","one low-friction question"],neverAutoSend:true },
    integrity: ["separate verified facts from inference and unknowns","attach source URLs to material claims","unknown score dimensions receive conservative scores","never invent budget, intent, contacts, defects, decision-makers, revenue or urgency","mark expansion services requires_confirmation and never present them as active offers"],
  };

  const enrichedRequest: ModelRequest = {
    ...request,
    context: {
      ...request.context,
      ...(prospectTask ? { samzyServiceCatalog:SAMZY_SERVICE_CATALOG,serviceDiscoveryOutputContract } : {}),
      independentAnalysis: true,
      crossEvaluationInstructions: "Challenge assumptions, assess evidence quality, business fit, commercial value, risks and unknowns. Do not invent facts.",
    },
  };

  const failures: string[] = [];
  for (const adapter of adapters) {
    try {
      const contribution = await adapter.generate(enrichedRequest);
      const content = contribution.content.trim();
      if (!content) throw new Error("Provider returned an empty answer.");
      const boundedAnswer = content.length > 1_800
        ? content.slice(0,1_800).replace(/\s+\S*$/,"") + "…"
        : content;
      return {
        objective: request.objective,
        contributions: [{ ...contribution, content: boundedAnswer }],
        synthesis: boundedAnswer,
        warnings: ["Single-provider mode: the first available AI model is being used. Multi-model cross-checking is paused to conserve quota and keep replies available."],
        completedAt: new Date().toISOString(),
      };
    } catch (cause) {
      failures.push(`${adapter.provider}: ${cause instanceof Error ? cause.message : "provider error"}`);
    }
  }
  throw new Error(`All configured AI providers failed. ${failures.slice(0,5).join(" | ")}`);
}
