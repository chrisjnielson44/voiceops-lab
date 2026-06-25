"""
Operational analytics aggregated from persisted call runs. Ported from the
Next.js `/api/analytics` route — returns live numbers from the database; the UI
falls back to its sample dataset for historical views when there are no runs yet.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.db import query, query_one
from app.routers._deps import require_internal

router = APIRouter(prefix="/api", tags=["analytics"], dependencies=[Depends(require_internal)])


@router.get("/analytics")
async def analytics():
    try:
        totals = await query_one(
            """SELECT count(*) AS total,
                      count(*) FILTER (WHERE outcome='completed') AS completed,
                      count(*) FILTER (WHERE outcome='escalated') AS escalated,
                      avg(extract(epoch from (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL) AS aht_sec,
                      avg(completion_prob) AS avg_completion,
                      avg(escalation_risk) AS avg_escalation
               FROM call_runs"""
        )
        phi = await query_one("SELECT count(*) AS phi FROM call_events WHERE type='phi.access'")
        tools = await query_one(
            """SELECT count(*) AS calls,
                      count(*) FILTER (WHERE redaction IS NULL) AS errors
               FROM call_events WHERE type='tool.call'"""
        )
        payers = await query(
            """SELECT payer,
                      count(*) AS calls,
                      count(*) FILTER (WHERE outcome='completed')::float / greatest(count(*),1) AS completion,
                      count(*) FILTER (WHERE outcome='escalated')::float / greatest(count(*),1) AS escalation,
                      avg(extract(epoch from (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL) AS aht
               FROM call_runs GROUP BY payer ORDER BY calls DESC"""
        )

        total = int((totals or {}).get("total") or 0)
        completed = int((totals or {}).get("completed") or 0)
        escalated = int((totals or {}).get("escalated") or 0)
        aht_sec = (totals or {}).get("aht_sec")
        avg_completion = (totals or {}).get("avg_completion")
        avg_escalation = (totals or {}).get("avg_escalation")

        return {
            "hasData": total > 0,
            "totals": {
                "totalCalls": total,
                "completionRate": (completed / total) if total else 0,
                "escalationRate": (escalated / total) if total else 0,
                "avgHandleTimeSec": round(float(aht_sec)) if aht_sec else 0,
                "avgCompletionProb": float(avg_completion) if avg_completion else 0,
                "avgEscalationRisk": float(avg_escalation) if avg_escalation else 0,
                "phiAccessEvents": int((phi or {}).get("phi") or 0),
                "toolCalls": int((tools or {}).get("calls") or 0),
            },
            "payers": [
                {
                    "payer": p["payer"],
                    "calls": int(p["calls"]),
                    "completionRate": float(p["completion"]),
                    "escalationRate": float(p["escalation"]),
                    "ahtSec": round(float(p["aht"])) if p["aht"] else 0,
                }
                for p in payers
            ],
        }
    except Exception as e:  # noqa: BLE001 - mirror TS: degrade gracefully, HTTP 200
        return {"hasData": False, "error": str(e) or "query failed"}
