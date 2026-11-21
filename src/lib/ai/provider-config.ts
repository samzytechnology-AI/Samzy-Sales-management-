import type { ModelSlot } from "./types";
export interface ProviderSlotConfig { slot: ModelSlot; provider: string; model: string; configured: boolean; }
export function getProviderConfiguration(): ProviderSlotConfig[] {
  return (["A", "B", "C"] as const).map((slot) => {
    const prefix = `AI_MODEL_${slot}`;
    return { slot, provider: process.env[`${prefix}_PROVIDER`] ?? "", model: process.env[`${prefix}_MODEL`] ?? "", configured: Boolean(process.env[`${prefix}_PROVIDER`] && process.env[`${prefix}_MODEL`] && process.env[`${prefix}_API_KEY`]) };
  });
}
export function assertAllProvidersConfigured(): void {
  const missing = getProviderConfiguration().filter((item) => !item.configured).map((item) => item.slot);
  if (missing.length) throw new Error(`AI provider credentials/configuration missing for slots: ${missing.join(", ")}.`);
}
