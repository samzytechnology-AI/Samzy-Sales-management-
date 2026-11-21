import type { CoordinatedResult, ModelAdapter, ModelRequest } from "./types";

/** All configured models receive the same task and context concurrently. */
export async function coordinateModels(request: ModelRequest, adapters: ModelAdapter[]): Promise<CoordinatedResult> {
  if (adapters.length !== 3) throw new Error(`Exactly three model adapters are required; received ${adapters.length}.`);
  if (new Set(adapters.map((adapter) => adapter.slot)).size !== 3) throw new Error("Model slots A, B and C must each be configured once.");
  const settled = await Promise.allSettled(adapters.map((adapter) => adapter.generate(request)));
  const contributions = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const warnings = settled.flatMap((result, index) => result.status === "rejected" ? [`Model ${adapters[index].slot} failed: ${result.reason instanceof Error ? result.reason.message : "Provider error"}`] : []);
  if (!contributions.length) throw new Error(`All AI providers failed. ${warnings.join(" | ")}`);
  const synthesis = contributions.map((item) => `[${item.slot} · ${item.provider}/${item.model}]\n${item.content}`).join("\n\n---\n\n");
  return { objective: request.objective, contributions, synthesis, warnings, completedAt: new Date().toISOString() };
}
