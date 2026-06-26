"""
Read-only call-history endpoints over the fake pool: list shape, the derived
duration/event-count, the run+events detail, and a 404 for an unknown run.
"""
from __future__ import annotations

import datetime as _dt

import pytest

from app import db

pytestmark = pytest.mark.asyncio


def _responder(query: str, params):
    q = " ".join(query.split())
    if "FROM call_runs r" in q:  # list_calls
        return [
            {
                "id": "voice_abc",
                "scenario_id": "elig-aetna",
                "payer": "Aetna",
                "model": "local",
                "status": "completed",
                "outcome": "completed",
                "completion_prob": 0.91,
                "escalation_risk": 0.08,
                "started_at": _dt.datetime(2026, 6, 25, 12, 0, 0),
                "ended_at": _dt.datetime(2026, 6, 25, 12, 2, 30),
                "duration_sec": 150.0,
                "event_count": 7,
            }
        ]
    if "FROM call_runs WHERE id" in q:  # get_call -> run
        if params and params[0] == "voice_abc":
            return [
                {
                    "id": "voice_abc",
                    "scenario_id": "elig-aetna",
                    "payer": "Aetna",
                    "model": "local",
                    "status": "completed",
                    "outcome": "completed",
                    "completion_prob": 0.91,
                    "escalation_risk": 0.08,
                    "started_at": _dt.datetime(2026, 6, 25, 12, 0, 0),
                    "ended_at": _dt.datetime(2026, 6, 25, 12, 2, 30),
                    "duration_sec": 150.0,
                }
            ]
        return []
    if "FROM call_events WHERE run_id" in q:  # get_call -> events
        return [
            {
                "seq": 0,
                "type": "call.session.open",
                "at_ms": 1000,
                "actor": "system",
                "summary": "session opened",
                "model": None,
                "tool": None,
                "phi": False,
                "phi_scope": None,
                "payload": '{"k": "v"}',
            }
        ]
    return []


@pytest.fixture
def calls_pool(monkeypatch):
    from tests.conftest import FakePool

    pool = FakePool(_responder)
    monkeypatch.setattr(db, "_pool", pool)
    return pool


async def test_list_calls(client, calls_pool):
    r = await client.get("/api/calls")
    assert r.status_code == 200
    body = r.json()
    assert body["hasData"] is True
    call = body["calls"][0]
    assert call["id"] == "voice_abc"
    assert call["payer"] == "Aetna"
    assert call["durationSec"] == 150
    assert call["eventCount"] == 7
    assert call["startedAt"].startswith("2026-06-25")


async def test_get_call_detail(client, calls_pool):
    r = await client.get("/api/calls/voice_abc")
    assert r.status_code == 200
    body = r.json()
    assert body["run"]["id"] == "voice_abc"
    assert body["run"]["eventCount"] == 1
    assert len(body["events"]) == 1
    ev = body["events"][0]
    assert ev["type"] == "call.session.open"
    assert ev["payload"] == {"k": "v"}  # JSONB string parsed back to an object


async def test_get_call_404(client, calls_pool):
    r = await client.get("/api/calls/does-not-exist")
    assert r.status_code == 404
