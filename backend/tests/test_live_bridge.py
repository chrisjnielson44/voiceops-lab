"""
Live voice → SSE bridge. The LiveKit worker forwards turns/tools/lifecycle to
the ingest endpoint; the bridge must enrich them into the SAME event stream the
simulate orchestrator produces, so the cockpit's graph / prediction / reasoning /
tool panels light up during a real call. These exercise the bridge directly
(no LiveKit), with the fake DB + LLM standing in for Neon and the local model.
"""
from __future__ import annotations

import pytest

from app.agent import live_bridge
from app.agent.context_graph import ContextGraph
from app.agent.prediction import normalize_prediction_set
from app.agent.run_store import subscribe
from app.packs.registry import get_scenario, pack_for_scenario


@pytest.fixture
def patched_bridge_llm(monkeypatch, fake_llm):
    # The bridge imports chat_json directly; point it at the scripted fake.
    monkeypatch.setattr(live_bridge, "chat_json", fake_llm.chat_json)
    return fake_llm


async def _make(run_id: str = "voice_test_1"):
    return await live_bridge.get_or_create_bridge(
        run_id=run_id, scenario_id="elig-aetna", model="test-model", user_id="u1"
    )


async def test_get_or_create_emits_session_open(fake_pool, patched_bridge_llm):
    bridge = await _make("voice_open")
    assert bridge is not None
    kinds = [e["kind"] for e in bridge.run.events]
    # on_start opens the run: dialing → session/start audit → active.
    assert kinds[0] == "status" and bridge.run.events[0]["status"] == "dialing"
    assert "audit" in kinds
    assert bridge.run.events[-1]["kind"] == "status" and bridge.run.events[-1]["status"] == "active"
    # A second resolve returns the same bridge without re-opening.
    again = await _make("voice_open")
    assert again is bridge


async def test_full_call_lights_every_panel(fake_pool, patched_bridge_llm):
    bridge = await _make("voice_full")
    q = subscribe(bridge.run)  # a late SSE subscriber sees live events

    await bridge.on_turn("agent", "Hi, I'm verifying eligibility for the member.")
    await bridge.on_tool(
        tool="verify_eligibility",
        args={"member_id": "W2049-88147"},
        result="Active. PCP copay $25.",
        phi=True,
    )
    await bridge.on_turn("payer", "You're verified. The member is active.")
    await bridge.on_done("completed")

    kinds = {e["kind"] for e in bridge.run.events}
    # The whole simulate-grade surface, now driven by the live worker:
    assert {"status", "turn", "tool", "reasoning", "graph", "prediction", "predictionSet", "audit", "metrics", "done"} <= kinds

    # Tool event carries the real result + PHI flag.
    tool = next(e for e in bridge.run.events if e["kind"] == "tool")["tool"]
    assert tool["tool"] == "verify_eligibility" and tool["phi"] is True

    # The predictor ran off the payer turn and produced a snapshot.
    pred = next(e for e in bridge.run.events if e["kind"] == "prediction")["prediction"]
    assert 0.0 <= pred["completionProbability"] <= 1.0

    # Reasoning trace narrates the graph walk (no streamed think segment in live).
    reasoning = next(e for e in bridge.run.events if e["kind"] == "reasoning")["reasoning"]
    assert any(s["phase"] in ("retrieve", "anticipate") for s in reasoning["segments"])

    # done finalized + closed the run.
    assert bridge.run.done is True
    assert bridge.run.events[-1] == {"kind": "done", "outcome": "completed"}
    # The subscriber received the live fan-out (not just the buffered log).
    assert q.qsize() > 0


async def test_ingest_endpoint_dispatches_to_bridge(client, fake_pool, monkeypatch, fake_llm):
    # The ingest endpoint resolves its own bridge module's chat_json.
    monkeypatch.setattr(live_bridge, "chat_json", fake_llm.chat_json)

    res = await client.post(
        "/api/agent/ingest",
        json={
            "runId": "voice_http_1",
            "scenarioId": "elig-aetna",
            "model": "m",
            "event": {"kind": "turn", "speaker": "agent", "text": "Hello, verifying eligibility."},
        },
    )
    assert res.status_code == 200 and res.json()["ok"] is True

    run = live_bridge.get_run("voice_http_1")
    assert run is not None and run.live is True
    assert any(e["kind"] == "turn" for e in run.events)

    # A malformed body is rejected, not silently swallowed.
    bad = await client.post("/api/agent/ingest", json={"runId": "x"})
    assert bad.status_code == 400


# --- anticipatory grounding (the context graph + anticipation steering live) --


def test_fact_for_serializes_a_single_record():
    """`fact_for` lets the bridge fold one anticipated record into grounding."""
    scn = get_scenario("elig-aetna")
    mid = scn.patient.member_id
    g = ContextGraph.build(
        scn,
        member={"member_id": mid, "name": "Maria Alvarez", "payer": "Aetna", "plan_type": "PPO"},
        coverage={"active": True, "copay_pcp": 25, "copay_spec": 40, "deductible_met": 0,
                  "deductible_total": 1500, "oop_met": 0, "oop_max": 6000},
        claims=[],
        prior_auths=[],
    )
    assert "MEMBER" in g.fact_for(f"member:{mid}")
    assert g.fact_for("does-not-exist:x") == ""


def test_anticipated_records_maps_intent_to_graph_node():
    """The pack resolves an anticipated intent to the (intent, tool, node) whose
    record the agent is about to need — reusing the one intent→tool map."""
    scn = get_scenario("claim-uhc")  # claim-status scenario with claim 4471-A
    pack = pack_for_scenario(scn.id)
    preds = normalize_prediction_set(
        {"predictions": [{"intent": "claim_status", "confidence": 0.8, "needsTool": "verify_claim"}]}, scn
    )
    recs = pack.anticipated_records(preds.predictions, scn)
    assert recs, "a claim-status prediction should resolve to a record"
    _intent, tool, node = recs[0]
    assert tool == "verify_claim" and node == f"claim:{scn.claim.id}"


async def test_grounding_returns_base_context(fake_pool, patched_bridge_llm):
    """With no prediction yet, grounding still returns the verified records the
    call has surfaced (option-1 substrate: the live agent is grounded at all)."""
    bridge = await _make("voice_ground_base")
    out = await bridge.grounding("Can you confirm the member's eligibility?")
    assert isinstance(out, dict) and "context" in out and "anticipated" in out
    assert "MEMBER" in out["context"]  # base graph grounding present
    assert out["anticipated"] == []   # nothing folded without a prediction


class _StubGraph:
    """Deterministic stand-in: base context that does NOT contain the anticipated
    claim, so the fold path is exercised regardless of budget/scoring."""

    def retrieve(self, *_a, **_k):
        return None, "MEMBER W2049-88147 — Maria Alvarez, Aetna PPO (group 7741-A)."

    def fact_for(self, node_id):
        return "CLAIM 4471-A — DENIED, DOS 2026-04-18, CPT 99214, billed $432.0." if node_id == "claim:4471-A" else ""


async def test_grounding_folds_anticipated_record(fake_pool, patched_bridge_llm):
    """Anticipation serves the answer: a predicted next record absent from the
    base context is folded into grounding AND surfaced as a real prefetch signal."""
    scn = get_scenario("elig-aetna")
    bridge = await _make("voice_ground_fold")
    # Pin a deterministic graph + a prediction whose record isn't in base context.
    bridge.run.graph = _StubGraph()
    bridge.graph_ready = True
    bridge.run.last_pred_set = normalize_prediction_set(
        {"predictions": [{"intent": "claim_status", "confidence": 0.8, "needsTool": "verify_claim"}]}, scn
    )
    bridge.pack.anticipated_records = lambda preds, s: [("claim_status", "verify_claim", "claim:4471-A")]

    out = await bridge.grounding("What's the status of that claim?")

    assert "LIKELY-NEXT" in out["context"]
    assert "CLAIM 4471-A" in out["context"]
    assert out["anticipated"] == ["claim:4471-A"]
    # The fold emits an honest prefetch `ready` signal (no fabricated savedMs).
    pf = [e for e in bridge.run.events if e["kind"] == "prefetch"]
    assert pf and pf[-1]["record"]["status"] == "ready" and pf[-1]["record"]["label"] == "verify_claim"
    assert pf[-1]["record"].get("savedMs") in (None, 0)
    # The intent is tracked so the reasoning trace can narrate it honestly.
    assert "claim_status" in bridge.preloaded_intents
    # Idempotent: a second pull for the same record doesn't re-emit the signal.
    await bridge.grounding("Still asking about that claim.")
    assert len([e for e in bridge.run.events if e["kind"] == "prefetch"]) == len(pf)


async def test_context_endpoint_returns_grounding(client, fake_pool, monkeypatch, fake_llm):
    """The worker's RAG hook hits this: resolve-or-create the bridge, return the
    grounding for the upcoming turn. Internal-gated (no user session)."""
    monkeypatch.setattr(live_bridge, "chat_json", fake_llm.chat_json)
    res = await client.post(
        "/api/agent/context",
        json={"runId": "voice_ctx_ep", "scenarioId": "elig-aetna", "model": "m",
              "text": "Can you confirm eligibility and copays?"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "context" in data and "anticipated" in data
    assert "MEMBER" in data["context"]
    # A request without a runId is a 400 (not a silent empty grounding).
    bad = await client.post("/api/agent/context", json={"scenarioId": "elig-aetna"})
    assert bad.status_code == 400


async def test_unknown_scenario_falls_back_gracefully(fake_pool, patched_bridge_llm):
    # The registry resolves an unknown id to a real default scenario (the worker
    # always forwards a validated id), so the bridge still opens rather than 422.
    bridge = await live_bridge.get_or_create_bridge(
        run_id="voice_bad", scenario_id="does-not-exist", model="m", user_id=None
    )
    assert bridge is not None
    assert bridge.scenario.id  # resolved to a concrete scenario
