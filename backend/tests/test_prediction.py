"""Unit tests for the anticipatory-prediction helpers (pure; no model/DB)."""
from __future__ import annotations

from app import db
from app.agent.prediction import (
    MAX_PREDICTIONS,
    PredictionLearner,
    load_prediction_priors,
    normalize_prediction_set,
    persist_prediction_observation,
    prefetch_key,
    rescore_prediction_set,
    stats_summary,
)
from app.packs.generic import GenericPack
from app.packs.healthcare import HealthcarePack
from app.simulation.scenarios import SCENARIOS
from tests.conftest import FakePool


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


def test_prediction_learner_rescores_close_calls_from_feedback():
    scn = _scenario("claim-uhc")
    pack = HealthcarePack()
    learner = PredictionLearner()
    for _ in range(8):
        learner.observe(scn.id, "verify_eligibility", hit=True)
        learner.observe(scn.id, "verify_claim", hit=False)

    raw = {
        "predictions": [
            {"intent": "claim_status", "utterance": "I can check the claim.", "confidence": 0.62, "needsTool": "verify_claim"},
            {"intent": "eligibility_check", "utterance": "Let me verify coverage.", "confidence": 0.58, "needsTool": "verify_eligibility"},
        ],
    }
    ps = normalize_prediction_set(raw, scn)

    learned = rescore_prediction_set(ps, scn, learner, pack.predicted_tool_for)

    assert learned.predictions[0].intent == "eligibility_check"
    assert learned.predictions[0].confidence > learned.predictions[1].confidence


def test_generic_pack_maps_predictions_to_read_tools():
    scn = _scenario("elig-aetna")
    pack = GenericPack()

    assert pack.predicted_tool_for("lookup_record", scn) == ("lookup_record", {"reference": scn.patient.member_id})
    assert pack.predicted_tool_for("verify_status", scn) == ("verify_details", {"reference": scn.patient.member_id})
    assert pack.predicted_tool_for("small_talk", scn) is None


async def test_prediction_learner_loads_persisted_priors(monkeypatch):
    def responder(query: str, params):
        if "FROM prediction_learner_stats" in query:
            return [{"scenario_id": params[0], "tool": "verify_eligibility", "hits": 9, "misses": 1}]
        return []

    monkeypatch.setattr(db, "_pool", FakePool(responder))
    learner = PredictionLearner()

    await load_prediction_priors(learner, "elig-aetna")

    assert learner.prior("elig-aetna", "verify_eligibility") > 0.8


async def test_prediction_observation_persists_feedback(monkeypatch):
    pool = FakePool(lambda _query, _params: [])
    monkeypatch.setattr(db, "_pool", pool)

    await persist_prediction_observation("elig-aetna", "verify_eligibility", hit=True)
    await persist_prediction_observation("elig-aetna", "verify_claim", hit=False)

    assert len(pool.executed) == 2
    assert pool.executed[0][1] == ("elig-aetna", "verify_eligibility", 1, 0)
    assert pool.executed[1][1] == ("elig-aetna", "verify_claim", 0, 1)
