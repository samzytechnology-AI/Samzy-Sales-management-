import type { ModelSlot } from "./types";
import { createOpenAICompatibleAdapter, type OpenAICompatibleConfig } from "./openai-compatible";
import { createAnthropicAdapter } from "./anthropic";

export interface ProviderSlotConfig {
  slot: ModelSlot;
  provider: string;
  model: string;
  baseUrl: string;
  configured: boolean;
}

const SLOTS = ["A", "B", "C", "D", "E"] as const;
const DEFAULT_BASE_URLS: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};
const DEFAULT_MODELS: Record<string, string> = {
  gemini: "gemini-4-neon",
  groq: "openai/gpt-oss-120b",
  openrouter: "nvidia/nemotron-3-ultra:free",
  openai: "gpt-6.2-sol",
  anthropic: "claude-sonnet-5-5",
};

function readSlot(slot: ModelSlot): ProviderSlotConfig {
  const prefix = `AI_MODEL_${slot}`;
  const provider = (process.env[`${prefix}_PROVIDER`] ?? "").trim().toLowerCase();
  const model = (process.env[`${prefix}_MODEL`] ?? DEFAULT_MODELS[provider] ?? "").trim();
  const baseUrl = (process.env[`${prefix}_BASE_URL`] ?? DEFAULT_BASE_URLS[provider] ?? "").trim();
  const apiKey = process.env[`${prefix}_API_KEY`] ?? "";
  return { slot, provider, model, baseUrl, configured: Boolean(provider && model && apiKey && baseUrl) };
}

export function getProviderConfiguration(): ProviderSlotConfig[] {
  return SLOTS.map(readSlot);
}

/** Return every fully configured provider. Individual provider failures are isolated by the orchestrator. */
export function createConfiguredAdapters() {
  return SLOTS.flatMap((slot) => {
    const config = readSlot(slot);
    if (!config.configured) return [];
    const apiKey = process.env[`AI_MODEL_${slot}_API_KEY`] ?? "";
    const adapterConfig = { ...config, apiKey } as OpenAICompatibleConfig;
    return [config.provider === "anthropic"
      ? createAnthropicAdapter(adapterConfig)
      : createOpenAICompatibleAdapter(adapterConfig)];
  });
}
