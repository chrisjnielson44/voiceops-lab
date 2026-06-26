"""
Anticipatory prediction helpers — pure functions over predictor JSON + a small
prefetch bookkeeping layer. The orchestrator owns the async loop (it has the
emit/audit closures); this module keeps the parsing, key derivation, and
hit/stat math testable without a DB or a model.

Framing: prediction is a LATENCY-HIDING cache warmer, not a correctness
mechanism. The authoritative tool/agent path always runs; a miss only wastes a
little local compute, and a hit lets a tool be served from the speculative
cache (skipping the live SQL/summarize) — that is the real, measured win.
"""
from __future__ import annotations

import json
from typing import Any

from app.core.format import clamp
from app.schemas.agent import PredictedEntity, Prediction, PredictionSet
from app.schemas.simulation import Scenario

MAX_PREDICTIONS = 4
PREFETCH_TOP = 2           # how many distinct tools to warm per round
CONFIDENCE_PREFETCH = 0.45  # only prefetch reasonably-likely candidates


def prefetch_key(tool: str, args: dict[str, Any]) -> str:
    """Canonical, order-independent key for a (tool, args) read so the agent's
    later real call matches the speculative entry."""
    norm = {k: str(v) for k, v in sorted((args or {}).items()) if v not in (None, "")}
    return f"{tool}|{json.dumps(norm, sort_keys=True)}"


def normalize_prediction_set(raw: dict[str, Any], scenario: Scenario) -> PredictionSet:
    """Coerce a small local model's JSON into a clean, ranked PredictionSet.
    Tolerant of partial/garbage output (treated as fewer/zero predictions)."""
    items = raw.get("predictions")
    out: list[Prediction] = []
    if isinstance(items, list):
        for it in items:
            if not isinstance(it, dict):
                continue
            intent = str(it.get("intent") or "").strip()[:48]
            utterance = str(it.get("utterance") or "").strip()[:200]
            if not intent and not utterance:
                continue
            ents: list[PredictedEntity] = []
            raw_ents = it.get("entities")
            if isinstance(raw_ents, list):
                for e in raw_ents[:4]:
                    if isinstance(e, dict) and e.get("id"):
                        ents.append(PredictedEntity(type=str(e.get("type") or "entity"), id=str(e.get("id"))))
            out.append(
                Prediction(
                    intent=intent or "other",
                    utterance=utterance or intent,
                    confidence=clamp(float(it.get("confidence", 0.5) or 0.5), 0, 1),
                    entities=ents,
                    needs_tool=(str(it["needsTool"]) if isinstance(it.get("needsTool"), str) else None),
                    draft_worth=bool(it.get("draftWorth")),
                )
            )
    out.sort(key=lambda p: -p.confidence)
    out = out[:MAX_PREDICTIONS]
    return PredictionSet(predictions=out, predicted_count=len(out))


def stats_summary(pred_stats: dict[str, Any]) -> tuple[float, int, int]:
    """(hit_rate, avg_saved_ms, wasted) from accumulated run stats."""
    hits = pred_stats.get("hits", 0)
    misses = pred_stats.get("misses", 0)
    saved = pred_stats.get("savedMs", 0)
    total = hits + misses
    hit_rate = (hits / total) if total else 0.0
    avg_saved = round(saved / hits) if hits else 0
    wasted = pred_stats.get("wasted", 0)
    return round(hit_rate, 3), avg_saved, wasted
