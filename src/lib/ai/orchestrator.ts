import type { CoordinatedResult, ModelAdapter, ModelRequest } from "./types";

/** Three independent agents share one objective; a second pass produces a unified synthesis. */
export async function coordinateModels(request: ModelRequest, adapters: ModelAdapter[]): Promise<CoordinatedResult> {
  if (adapters.length !== 3) throw new Error(`Exactly three model adapters are required; received ${adapters.length}.`);
  if (new Set(adapters.map((adapter) => adapter.slot)).size !== 3) {
    throw new Error("Model slots A, B and C must each be configured once.");
  }

  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.generate(request)));
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
        "Return: Executive answer; Evidence-backed findings; Disagreements/risks; Recommended next actions; Confidence and unknowns.",
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
