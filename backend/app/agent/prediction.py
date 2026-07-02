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
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from app.core.format import clamp
from app.db import query
from app.schemas.agent import PredictedEntity, Prediction, PredictionSet
from app.schemas.simulation import Scenario

MAX_PREDICTIONS = 4
PREFETCH_TOP = 2           # how many distinct tools to warm per round
CONFIDENCE_PREFETCH = 0.45  # only prefetch reasonably-likely candidates
LEARNER_ALPHA = 1.0
LEARNER_BETA = 1.0


@dataclass
class PredictionLearner:
    """Tiny online learner for anticipation ranking.

    The model still proposes the candidate next turns, but observed prefetch
    hits/misses become per-scenario/per-tool priors. A candidate whose mapped
    tool has been useful in this scenario gets boosted on later turns/runs; a
    repeatedly wasted candidate is dampened.
    """

    stats: dict[str, dict[str, float]] = field(default_factory=lambda: defaultdict(lambda: {"hits": 0.0, "misses": 0.0}))

    def prior(self, scenario_id: str, tool: str) -> float:
        row = self.stats[f"{scenario_id}:{tool}"]
        return (row["hits"] + LEARNER_ALPHA) / (row["hits"] + row["misses"] + LEARNER_ALPHA + LEARNER_BETA)

    def observe(self, scenario_id: str, tool: str, *, hit: bool) -> None:
        row = self.stats[f"{scenario_id}:{tool}"]
        row["hits" if hit else "misses"] += 1.0


GLOBAL_PREDICTION_LEARNER = PredictionLearner()


async def load_prediction_priors(learner: PredictionLearner, scenario_id: str) -> None:
    """Best-effort load of persisted priors for one scenario."""
    try:
        rows = await query(
            "SELECT scenario_id, tool, hits, misses FROM prediction_learner_stats WHERE scenario_id = $1",
            [scenario_id],
        )
    except Exception:  # noqa: BLE001 - prediction learning must not block sims
        return
    for row in rows:
        key = f"{row['scenario_id']}:{row['tool']}"
        learner.stats[key] = {"hits": float(row.get("hits") or 0), "misses": float(row.get("misses") or 0)}


async def persist_prediction_observation(scenario_id: str, tool: str, *, hit: bool) -> None:
    """Best-effort durable update for simulation feedback."""
    try:
        await query(
            """INSERT INTO prediction_learner_stats(scenario_id, tool, hits, misses)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (scenario_id, tool) DO UPDATE SET
                 hits = prediction_learner_stats.hits + EXCLUDED.hits,
                 misses = prediction_learner_stats.misses + EXCLUDED.misses,
                 updated_at = now()""",
            [scenario_id, tool, 1 if hit else 0, 0 if hit else 1],
        )
    except Exception:  # noqa: BLE001 - DB persistence is additive, never critical path correctness
        return


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


def rescore_prediction_set(ps: PredictionSet, scenario: Scenario, learner: PredictionLearner, tool_mapper) -> PredictionSet:
    """Blend model confidence with learned tool priors and re-rank in place.

    `tool_mapper` is the pack's intent->tool function. Keeping it injected avoids
    teaching this pure helper about domain packs.
    """
    for p in ps.predictions:
        mapping = tool_mapper(p.needs_tool or p.intent, scenario)
        if not mapping:
            continue
        tool, _args = mapping
        prior = learner.prior(scenario.id, tool)
        # Preserve the model as the dominant signal, but let repeated simulation
        # outcomes move close calls enough to affect prefetch order.
        p.confidence = clamp((0.7 * p.confidence) + (0.3 * prior), 0, 1)
    ps.predictions.sort(key=lambda p: -p.confidence)
    return ps


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
