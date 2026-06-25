"""
Model registry — single source of truth for which models exist, who serves them,
and their cost/latency characteristics. Ported from `src/lib/providers/registry.ts`.

`quality_index`/`hallucination_base` are demo-only heuristics, NOT claims about
real model quality.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelInfo:
    id: str
    label: str
    provider_id: str
    kind: str
    family: str
    context_tokens: int
    input_cost_per_1k: float
    output_cost_per_1k: float
    base_latency_ms: int
    quality_index: float
    hallucination_base: float
    strengths: list[str]
    note: str


MODELS: list[ModelInfo] = [
    ModelInfo("demo/voiceops-sim-1", "VoiceOps Sim 1", "demo", "demo", "Deterministic", 32000, 0, 0, 120, 0.9, 0.04, ["Offline", "Deterministic", "Zero-cost"], "Built-in scripted engine. Runs with no API keys; powers the live demo call."),
    ModelInfo("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6", "openrouter", "hosted", "Anthropic", 200000, 0.003, 0.015, 540, 0.96, 0.03, ["Tool use", "Long context", "Clinical reasoning"], "Balanced frontier model; strong structured tool calling for payer workflows."),
    ModelInfo("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", "openrouter", "hosted", "Anthropic", 200000, 0.0008, 0.004, 320, 0.9, 0.05, ["Low latency", "Cost-efficient", "High throughput"], "Fast, inexpensive frontier-tier model; good default for high call volume."),
    ModelInfo("openai/gpt-4o-mini", "GPT-4o mini", "openrouter", "hosted", "OpenAI", 128000, 0.00015, 0.0006, 410, 0.86, 0.07, ["Very low cost", "Wide availability"], "Cheap hosted baseline; competitive on routine eligibility checks."),
    ModelInfo("meta-llama/llama-3.3-70b-instruct", "Llama 3.3 70B", "openrouter", "hosted", "Meta", 128000, 0.0004, 0.0004, 620, 0.88, 0.06, ["Open weights", "Self-hostable", "Symmetric pricing"], "Open-weight option routable via OpenRouter or self-hosted behind MLX."),
    ModelInfo("mlx-community/Qwen2.5-7B-Instruct-4bit", "Qwen2.5 7B (MLX)", "mlx", "local", "Qwen / on-device", 32000, 0, 0, 280, 0.82, 0.09, ["On-device", "No PHI egress", "Zero marginal cost"], "Runs locally via MLX LM on Apple silicon. Keeps PHI on the machine."),
    ModelInfo("mlx-community/Llama-3.1-8B-Instruct-4bit", "Llama 3.1 8B (MLX)", "mlx", "local", "Meta / on-device", 32000, 0, 0, 300, 0.8, 0.1, ["On-device", "No PHI egress", "Offline-capable"], "Local fallback model; useful where data residency rules forbid hosted calls."),
]

DEFAULT_MODEL_ID = "demo/voiceops-sim-1"

PROVIDER_LABELS: dict[str, str] = {
    "openrouter": "OpenRouter",
    "mlx": "MLX LM (local)",
    "demo": "Demo Engine",
}


def get_model(model_id: str) -> ModelInfo:
    return next((m for m in MODELS if m.id == model_id), MODELS[0])
