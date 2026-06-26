"""Liveness + dependency health."""
from __future__ import annotations

from fastapi import APIRouter, Response

from app import db
from app.llm.local_llm import local_llm_health

router = APIRouter(tags=["health"])


async def _db_health() -> dict:
    """Probe the Postgres pool. Distinguishes 'reachable' from the silent
    empty-data degradation the analytics/calls routes fall back to."""
    try:
        row = await db.query_one("SELECT 1 AS ok")
        return {"ok": bool(row and row.get("ok") == 1)}
    except Exception as e:  # noqa: BLE001 - report, don't raise
        return {"ok": False, "error": str(e) or "unreachable"}


@router.get("/healthz")
async def healthz():
    """Liveness: the process is up. Does not touch dependencies."""
    return {"ok": True, "service": "voiceops-backend"}


@router.get("/readyz")
async def readyz(response: Response):
    """Readiness: can we actually serve data-backed routes? 503 when the DB is
    unreachable so orchestrators/ops see a real failure, not a 200 empty state."""
    database = await _db_health()
    llm = await local_llm_health()
    ok = bool(database.get("ok"))
    if not ok:
        response.status_code = 503
    return {"ok": ok, "db": database, "localLLM": llm}
