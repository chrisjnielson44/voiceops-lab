"""Curated cheap/fast OpenRouter model catalog."""
from __future__ import annotations

import app.llm.local_llm as local_llm
from app.config import settings
from app.providers.registry import MODELS
from app.routers.voice import _default_model, _fast_model


def test_default_model_prefers_gpt4o_mini_on_hosted_only_deploy():
    # Prod has no local server, so only hosted models are runnable. The picker
    # must default to the cheap/fast preferred model, NOT the first (premium) one.
    hosted = [
        {"id": "anthropic/claude-sonnet-4.6", "reasoning": False, "kind": "hosted"},
        {"id": "openai/gpt-4o-mini", "reasoning": False, "kind": "hosted"},
        {"id": "google/gemini-2.5-flash", "reasoning": False, "kind": "hosted"},
    ]
    assert settings.default_model_id == "openai/gpt-4o-mini"
    assert _default_model(hosted) == "openai/gpt-4o-mini"
    assert _fast_model(hosted) == "openai/gpt-4o-mini"


def test_default_model_respects_explicit_local_model(monkeypatch):
    # In local dev an explicitly-configured local model still wins over the
    # preferred hosted default.
    monkeypatch.setattr(settings, "local_llm_model", "qwen3:14b")
    local = [
        {"id": "qwen3:14b", "reasoning": True, "kind": "local"},
        {"id": "llama3.1:8b", "reasoning": False, "kind": "local"},
    ]
    assert _default_model(local) == "qwen3:14b"
    assert _fast_model(local) == "llama3.1:8b"


def test_registry_has_curated_cheap_fast_openrouter_models():
    ids = {m.id for m in MODELS if m.provider_id == "openrouter"}
    # A representative slice of the cheap/fast lineup deployed users can pick.
    for expected in (
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
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
