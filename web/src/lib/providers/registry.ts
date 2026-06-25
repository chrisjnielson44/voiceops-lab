import type { ProviderId, ProviderKind } from "./types";

/**
 * Model registry — the single source of truth for which models exist, who serves
 * them, and their cost/latency characteristics. This module is isomorphic (no
 * secrets, no env reads) so it can be imported from both client and server.
 *
 * `qualityIndex` and `hallucinationBase` are demo-only heuristics that let the
 * deterministic adapter and the benchmark page shape realistic-looking outcomes
 * (frontier hosted models score higher; small local models are cheaper/faster
 * but slightly less reliable). They are NOT claims about real model quality.
 */

export interface ModelInfo {
  id: string;
  label: string;
  providerId: ProviderId;
  kind: ProviderKind;
  family: string;
  contextTokens: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  /** p50 latency baseline (ms) used by the simulation + benchmark. */
  baseLatencyMs: number;
  /** 0..1 demo heuristic for task reliability. */
  qualityIndex: number;
  /** 0..1 demo heuristic for baseline hallucination tendency. */
  hallucinationBase: number;
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
    baseLatencyMs: 120,
    qualityIndex: 0.9,
    hallucinationBase: 0.04,
    strengths: ["Offline", "Deterministic", "Zero-cost"],
    note: "Built-in scripted engine. Runs with no API keys; powers the live demo call.",
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
    baseLatencyMs: 540,
    qualityIndex: 0.96,
    hallucinationBase: 0.03,
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
    baseLatencyMs: 320,
    qualityIndex: 0.9,
    hallucinationBase: 0.05,
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
    baseLatencyMs: 410,
    qualityIndex: 0.86,
    hallucinationBase: 0.07,
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
    baseLatencyMs: 620,
    qualityIndex: 0.88,
    hallucinationBase: 0.06,
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
    baseLatencyMs: 280,
    qualityIndex: 0.82,
    hallucinationBase: 0.09,
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
    baseLatencyMs: 300,
    qualityIndex: 0.8,
    hallucinationBase: 0.1,
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
