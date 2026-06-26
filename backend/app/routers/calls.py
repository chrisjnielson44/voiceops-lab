"""
Read-only call history — individual `call_runs` (with a derived duration and
event count) and a single run's full `call_events` timeline. These power the
cockpit's Call History page. Like `analytics`, they degrade gracefully: a DB
error returns an honest empty payload (HTTP 200) rather than a 500.
"""
from __future__ import annotations

import datetime as _dt
import json
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.db import query, query_one
from app.routers._deps import require_internal

router = APIRouter(prefix="/api", tags=["calls"], dependencies=[Depends(require_internal)])


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, _dt.datetime) else value


def _num(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    return value


def _payload(value: Any) -> Any:
    # asyncpg returns JSONB as a string unless a codec is registered; parse it
    # so the client gets real objects.
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return value
    return value


def _run_summary(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": r["id"],
        "scenarioId": r.get("scenario_id"),
        "payer": r.get("payer"),
        "model": r.get("model"),
        "status": r.get("status"),
        "outcome": r.get("outcome"),
        "completionProb": _num(r.get("completion_prob")),
        "escalationRisk": _num(r.get("escalation_risk")),
        "startedAt": _iso(r.get("started_at")),
        "endedAt": _iso(r.get("ended_at")),
        "durationSec": round(float(r["duration_sec"])) if r.get("duration_sec") is not None else None,
        "eventCount": int(r["event_count"]) if r.get("event_count") is not None else 0,
    }


@router.get("/calls")
async def list_calls(limit: int = 50, offset: int = 0):
    limit = max(1, min(int(limit), 200))
    offset = max(0, int(offset))
    try:
        rows = await query(
            """SELECT r.id, r.scenario_id, r.payer, r.model, r.status, r.outcome,
                      r.completion_prob, r.escalation_risk, r.started_at, r.ended_at,
                      extract(epoch from (r.ended_at - r.started_at)) AS duration_sec,
                      (SELECT count(*) FROM call_events e WHERE e.run_id = r.id) AS event_count
               FROM call_runs r
               ORDER BY r.started_at DESC NULLS LAST
               LIMIT $1 OFFSET $2""",
            [limit, offset],
        )
        calls = [_run_summary(r) for r in rows]
        return {"hasData": len(calls) > 0, "calls": calls}
    except Exception as e:  # noqa: BLE001 - mirror analytics: degrade gracefully, HTTP 200
        return {"hasData": False, "calls": [], "error": str(e) or "query failed"}


@router.get("/calls/{run_id}")
async def get_call(run_id: str):
    run = await query_one(
        """SELECT id, scenario_id, payer, model, status, outcome,
                  completion_prob, escalation_risk, started_at, ended_at,
                  extract(epoch from (ended_at - started_at)) AS duration_sec
           FROM call_runs WHERE id = $1""",
        [run_id],
    )
    if not run:
        raise HTTPException(status_code=404, detail="call run not found")

    events = await query(
        """SELECT seq, type, at_ms, actor, summary, model, tool, phi, phi_scope, payload
           FROM call_events WHERE run_id = $1 ORDER BY seq ASC""",
        [run_id],
    )
    return {
        "run": {**_run_summary({**run, "event_count": len(events)})},
        "events": [
            {
                "seq": int(e["seq"]) if e.get("seq") is not None else None,
                "type": e.get("type"),
                "atMs": int(e["at_ms"]) if e.get("at_ms") is not None else None,
                "actor": e.get("actor"),
                "summary": e.get("summary"),
                "model": e.get("model"),
                "tool": e.get("tool"),
                "phi": bool(e.get("phi")),
                "phiScope": e.get("phi_scope"),
                "payload": _payload(e.get("payload")),
            }
            for e in events
        ],
    }
