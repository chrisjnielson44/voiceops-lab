import type { ProviderId, ProviderKind } from "./types";

/**
 * Model registry — factual metadata about which models exist, who serves them,
 * their context window, and public list pricing. Isomorphic (no secrets/env).
 *
 * NOTE: this is descriptive metadata only — no fabricated quality/latency
 * "scores". Real performance is measured from actual runs (see /api/analytics).
 */

export interface ModelInfo {
  id: string;
  label: string;
  providerId: ProviderId;
  kind: ProviderKind;
  family: string;
  contextTokens: number;
  /** Public list pricing, USD per 1K tokens (0 for local/demo). */
  inputCostPer1k: number;
  outputCostPer1k: number;
  strengths: string[];
  note: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "demo/voiceops-sim-1",
    label: "VoiceOps Sim 1",
    providerId: "demo",
    kind: "demo",
    family: "Deterministic",
    contextTokens: 32000,
    inputCostPer1k: 0,
    outputCostPer1k: 0,
    strengths: ["Offline", "Deterministic", "Zero-cost"],
    note: "Built-in deterministic fallback engine; runs with no API keys.",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    providerId: "openrouter",
    kind: "hosted",
    family: "Anthropic",
    contextTokens: 200000,
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    strengths: ["Tool use", "Long context", "Clinical reasoning"],
    note: "Balanced frontier model; strong structured tool calling for payer workflows.",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    providerId: "openrouter",
    kind: "hosted",
    family: "Anthropic",
    contextTokens: 200000,
    inputCostPer1k: 0.0008,
    outputCostPer1k: 0.004,
    strengths: ["Low latency", "Cost-efficient", "High throughput"],
    note: "Fast, inexpensive frontier-tier model; good default for high call volume.",
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o mini",
    providerId: "openrouter",
    kind: "hosted",
    family: "OpenAI",
    contextTokens: 128000,
    inputCostPer1k: 0.00015,
    outputCostPer1k: 0.0006,
    strengths: ["Very low cost", "Wide availability"],
    note: "Cheap hosted baseline; competitive on routine eligibility checks.",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B",
    providerId: "openrouter",
    kind: "hosted",
    family: "Meta",
    contextTokens: 128000,
    inputCostPer1k: 0.0004,
    outputCostPer1k: 0.0004,
    strengths: ["Open weights", "Self-hostable", "Symmetric pricing"],
    note: "Open-weight option routable via OpenRouter or self-hosted behind MLX.",
  },
  {
    id: "mlx-community/Qwen2.5-7B-Instruct-4bit",
    label: "Qwen2.5 7B (MLX)",
    providerId: "mlx",
    kind: "local",
    family: "Qwen / on-device",
    contextTokens: 32000,
    inputCostPer1k: 0,
    outputCostPer1k: 0,
    strengths: ["On-device", "No PHI egress", "Zero marginal cost"],
    note: "Runs locally via MLX LM on Apple silicon. Keeps PHI on the machine.",
  },
  {
    id: "mlx-community/Llama-3.1-8B-Instruct-4bit",
    label: "Llama 3.1 8B (MLX)",
    providerId: "mlx",
    kind: "local",
    family: "Meta / on-device",
    contextTokens: 32000,
    inputCostPer1k: 0,
    outputCostPer1k: 0,
    strengths: ["On-device", "No PHI egress", "Offline-capable"],
    note: "Local fallback model; useful where data residency rules forbid hosted calls.",
  },
];

export const DEFAULT_MODEL_ID = "demo/voiceops-sim-1";

export function getModel(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function modelsByProvider(providerId: ProviderId): ModelInfo[] {
  return MODELS.filter((m) => m.providerId === providerId);
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: "OpenRouter",
  mlx: "MLX LM (local)",
  demo: "Demo Engine",
};
