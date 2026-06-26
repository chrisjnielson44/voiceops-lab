"""
End-to-end API smoke tests over the ASGI app with a fake DB + scripted fake LLM.
Exercises the live call stream, run control, and the read-only endpoints.
"""
from __future__ import annotations

import json

import pytest

pytestmark = pytest.mark.asyncio


async def _consume_stream(client, run_id: str, limit: int = 200) -> list[dict]:
    events: list[dict] = []
    async with client.stream("GET", f"/api/agent/stream?runId={run_id}") as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            if not line.startswith("data: "):
                continue
            events.append(json.loads(line[len("data: ") :]))
            if events[-1].get("kind") == "done" or len(events) >= limit:
                break
    return events


async def test_full_call_stream(client, fake_pool, fake_llm):
    start = await client.post("/api/agent/start", json={"scenarioId": "elig-aetna"})
    assert start.status_code == 200
    run_id = start.json()["runId"]
    assert run_id.startswith("run_")

    events = await _consume_stream(client, run_id)
    kinds = [e["kind"] for e in events]

    # The stream must open with a status and close with a completed `done`.
    assert kinds[0] == "status"
    assert events[-1] == {"kind": "done", "outcome": "completed"}

    # The scripted agent calls two tools, speaks, gets a payer reply + prediction.
    assert "tool" in kinds
    assert "turn" in kinds
    assert "prediction" in kinds
    assert "audit" in kinds
    assert "metrics" in kinds
    # Each agent decision streams an inline reasoning trace with ordered segments.
    assert "reasoning" in kinds
    reasoning = next(e["reasoning"] for e in events if e["kind"] == "reasoning")
    assert set(["id", "seq", "atMs", "segments"]).issubset(reasoning.keys())
    assert reasoning["segments"] and reasoning["segments"][0]["phase"] in ("retrieve", "think", "anticipate")

    # Audit events carry a hash chain.
    audits = [e["event"] for e in events if e["kind"] == "audit"]
    assert audits[0]["type"] == "call.session.open"
    assert audits[0]["prevHash"] == "0" * 64
    # A turn carries camelCase fields.
    turn = next(e["turn"] for e in events if e["kind"] == "turn")
    assert set(["id", "seq", "speaker", "text", "atMs"]).issubset(turn.keys())


async def test_audit_chain_is_verifiable(client, fake_pool, fake_llm):
    start = await client.post("/api/agent/start", json={"scenarioId": "elig-aetna"})
    run_id = start.json()["runId"]
    events = await _consume_stream(client, run_id)
    from app.audit.ledger import verify_ledger

    audits = [e["event"] for e in events if e["kind"] == "audit"]
    assert len(audits) >= 2
    assert verify_ledger(audits) is True


async def test_control_stop_unknown_run(client):
    r = await client.post("/api/agent/control", json={"runId": "nope", "action": "stop"})
    assert r.status_code == 404


async def test_control_pause_resume(client, fake_pool, fake_llm):
    start = await client.post("/api/agent/start", json={"scenarioId": "elig-aetna"})
    run_id = start.json()["runId"]
    r = await client.post("/api/agent/control", json={"runId": run_id, "action": "pause"})
    assert r.status_code == 200
    assert r.json()["paused"] is True
    r = await client.post("/api/agent/control", json={"runId": run_id, "action": "resume"})
    assert r.json()["paused"] is False
    # Drain so the background task finishes cleanly.
    await _consume_stream(client, run_id)


async def test_control_rejects_unknown_action(client, fake_pool, fake_llm):
    start = await client.post("/api/agent/start", json={"scenarioId": "elig-aetna"})
    run_id = start.json()["runId"]
    r = await client.post("/api/agent/control", json={"runId": run_id, "action": "frobnicate"})
    assert r.status_code == 400
    await _consume_stream(client, run_id)


async def test_scenarios_endpoint(client):
    r = await client.get("/api/scenarios")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()["scenarios"]]
    assert ids == ["elig-aetna", "claim-uhc", "pa-cigna"]

    one = await client.get("/api/scenarios/claim-uhc")
    assert one.json()["payer"] == "UnitedHealthcare"


async def test_telephony_demo_mode_never_dials(client):
    r = await client.post("/api/telephony", json={"vendor": "twilio", "toNumber": "+15551234567"})
    body = r.json()
    assert body["vendor"] == "twilio"
    assert body["demo"] is True
    assert body["ok"] is False


async def test_providers_status(client):
    r = await client.get("/api/providers")
    body = r.json()
    assert body["demoMode"] is True
    assert any(p["id"] == "demo" and p["configured"] for p in body["llm"])


async def test_analytics_graceful_without_data(client, fake_pool):
    r = await client.get("/api/analytics")
    assert r.status_code == 200
    assert r.json()["hasData"] is False


async def test_voice_options(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "elevenlabs_api_key", "")  # force default voices (no network)
    r = await client.get("/api/voice/options")
    assert r.status_code == 200
    body = r.json()
    assert len(body["scenarios"]) == 3
    assert all(s["id"] and s["objective"] for s in body["scenarios"])
    assert len(body["models"]) >= 1
    assert len(body["voices"]) >= 1
    assert body["defaults"]["scenarioId"]


async def test_voice_token_requires_livekit_config(client, fake_pool, monkeypatch):
    # With LiveKit unconfigured -> 503, not a crash. (Clear explicitly so the test
    # is deterministic whether or not a local .env provides creds.)
    from app.config import settings

    monkeypatch.setattr(settings, "livekit_url", None)
    monkeypatch.setattr(settings, "livekit_api_key", None)
    monkeypatch.setattr(settings, "livekit_api_secret", None)
    r = await client.post("/api/voice/token", json={"scenarioId": "elig-aetna"})
    assert r.status_code == 503


async def test_voice_token_mints_jwt(client, fake_pool, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "livekit_url", "wss://test.livekit.cloud")
    monkeypatch.setattr(settings, "livekit_api_key", "APItest")
    monkeypatch.setattr(settings, "livekit_api_secret", "s" * 32)
    r = await client.post("/api/voice/token", json={"scenarioId": "elig-aetna"})
    assert r.status_code == 200
    body = r.json()
    assert body["url"] == "wss://test.livekit.cloud"
    assert body["room"] == body["runId"]
    assert body["runId"].startswith("voice_")
    assert body["token"].count(".") == 2  # header.payload.signature


async def test_require_auth_blocks_unauthenticated(client, monkeypatch):
    # With REQUIRE_AUTH on and no valid session, protected routes 401.
    from app.config import settings

    monkeypatch.setattr(settings, "require_auth", True)
    r = await client.post("/api/agent/start", json={"scenarioId": "elig-aetna"})
    assert r.status_code == 401


async def test_anon_fallback_when_auth_not_required(client, fake_pool, fake_llm):
    # Default (REQUIRE_AUTH off): start works and attributes to the demo user.
    r = await client.post("/api/agent/start", json={"scenarioId": "elig-aetna"})
    assert r.status_code == 200
    await _consume_stream(client, r.json()["runId"])
