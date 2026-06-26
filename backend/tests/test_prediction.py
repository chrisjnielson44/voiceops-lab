"""Unit tests for the anticipatory-prediction helpers (pure; no model/DB)."""
from __future__ import annotations

from app.agent.prediction import (
    MAX_PREDICTIONS,
    normalize_prediction_set,
    prefetch_key,
    stats_summary,
)
from app.simulation.scenarios import SCENARIOS


def _scenario(scenario_id: str):
    return next(s for s in SCENARIOS if s.id == scenario_id)


def test_prefetch_key_is_order_independent_and_drops_empties():
    a = prefetch_key("verify_eligibility", {"member_id": "M1", "extra": ""})
    b = prefetch_key("verify_eligibility", {"member_id": "M1"})
    assert a == b
    assert prefetch_key("verify_claim", {"claim_id": "4471-A"}) != a


def test_normalize_parses_and_ranks_predictions():
    raw = {
        "completionProbability": 0.7,
        "predictions": [
            {"intent": "provide_eligibility", "utterance": "Coverage is active.", "confidence": 0.6, "needsTool": "verify_eligibility", "entities": [{"type": "member", "id": "W2049-88147"}]},
            {"intent": "request_authentication", "utterance": "What's your tax ID?", "confidence": 0.9},
        ],
    }
    ps = normalize_prediction_set(raw, _scenario("elig-aetna"))
    assert len(ps.predictions) == 2
    # ranked by confidence desc
    assert ps.predictions[0].confidence >= ps.predictions[1].confidence
    assert ps.predictions[0].intent == "request_authentication"
    e = ps.predictions[1]
    assert e.needs_tool == "verify_eligibility"
    assert e.entities and e.entities[0].id == "W2049-88147"


def test_normalize_tolerates_garbage():
    for raw in ({}, {"predictions": "nope"}, {"predictions": [1, 2, {"foo": "bar"}]}):
        ps = normalize_prediction_set(raw, _scenario("elig-aetna"))
        assert ps.predicted_count == len(ps.predictions)  # never raises


def test_normalize_caps_count():
    raw = {"predictions": [{"intent": f"i{i}", "utterance": "x", "confidence": 0.5} for i in range(10)]}
    ps = normalize_prediction_set(raw, _scenario("elig-aetna"))
    assert len(ps.predictions) <= MAX_PREDICTIONS


def test_stats_summary_math():
    hit_rate, avg_saved, wasted = stats_summary({"hits": 3, "misses": 1, "savedMs": 600, "wasted": 2})
    assert hit_rate == 0.75
    assert avg_saved == 200
    assert wasted == 2
    # no activity -> zeros, no division error
    assert stats_summary({"hits": 0, "misses": 0, "savedMs": 0}) == (0.0, 0, 0)
