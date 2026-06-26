"""Curated cheap/fast OpenRouter model catalog."""
from __future__ import annotations

import app.llm.local_llm as local_llm
from app.config import settings
from app.providers.registry import MODELS


def test_registry_has_curated_cheap_fast_openrouter_models():
    ids = {m.id for m in MODELS if m.provider_id == "openrouter"}
    # A representative slice of the cheap/fast lineup deployed users can pick.
    for expected in (
        "openai/gpt-4o-mini",
        "google/gemini-2.0-flash-001",
        "deepseek/deepseek-chat",
        "meta-llama/llama-3.1-8b-instruct",
        "qwen/qwen-2.5-7b-instruct",
    ):
        assert expected in ids, f"missing curated model {expected}"
    # Every hosted entry must declare a provider + non-negative pricing.
    for m in MODELS:
        if m.provider_id == "openrouter":
            assert m.kind == "hosted"
            assert m.input_cost_per_1k >= 0 and m.output_cost_per_1k >= 0


def test_hosted_model_routes_to_openrouter_when_key_set(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-test", raising=False)
    ep = local_llm._resolve_endpoint("anthropic/claude-haiku-4.5")
    assert ep.base_url == settings.openrouter_base_url.rstrip("/")
    assert ep.api_key == "sk-test"
    assert "HTTP-Referer" in ep.headers and "X-Title" in ep.headers


def test_hosted_model_falls_back_to_local_without_key(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "", raising=False)
    ep = local_llm._resolve_endpoint("anthropic/claude-haiku-4.5")
    assert ep.base_url == settings.local_llm_base_url.rstrip("/")
    assert ep.api_key == settings.local_llm_api_key


def test_local_and_unknown_models_route_local(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-test", raising=False)
    for model_id in ("mlx-community/Qwen2.5-7B-Instruct-4bit", "some/unknown-model", None):
        ep = local_llm._resolve_endpoint(model_id)
        assert ep.base_url == settings.local_llm_base_url.rstrip("/")
        assert ep.headers == {}
