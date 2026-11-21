import type { ModelSlot } from "./types";
import { createOpenAICompatibleAdapter, type OpenAICompatibleConfig } from "./openai-compatible";

export interface ProviderSlotConfig {
  slot: ModelSlot;
  provider: string;
  model: string;
  baseUrl: string;
  configured: boolean;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  cloudflare: "",
};

function readSlot(slot: ModelSlot): ProviderSlotConfig {
  const prefix = `AI_MODEL_${slot}`;
  const provider = (process.env[`${prefix}_PROVIDER`] ?? "").trim().toLowerCase();
  const model = (process.env[`${prefix}_MODEL`] ?? "").trim();
  const baseUrl = (process.env[`${prefix}_BASE_URL`] ?? DEFAULT_BASE_URLS[provider] ?? "").trim();
  const apiKey = process.env[`${prefix}_API_KEY`] ?? "";
  return { slot, provider, model, baseUrl, configured: Boolean(provider && model && apiKey && baseUrl) };
}

export function getProviderConfiguration(): ProviderSlotConfig[] {
  return (["A", "B", "C"] as const).map(readSlot);
}

export function createConfiguredAdapters() {
  const configs = (["A", "B", "C"] as const).map((slot) => {
    const prefix = `AI_MODEL_${slot}`;
    return {
      ...readSlot(slot),
      apiKey: process.env[`${prefix}_API_KEY`] ?? "",
    };
  });
  const missing = configs.filter((item) => !item.configured).map((item) => item.slot);
  if (missing.length) throw new Error(`AI provider configuration missing for slots: ${missing.join(", ")}.`);
  return configs.map((item) => createOpenAICompatibleAdapter(item as OpenAICompatibleConfig));
}
