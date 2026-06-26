"""
Operational analytics aggregated from persisted call runs — 100% real numbers
from the database (no synthetic baseline). When there are no runs yet, `hasData`
is false and the UI shows honest empty states.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.db import query, query_one
from app.routers._deps import require_internal, require_user_scope

router = APIRouter(
    prefix="/api",
    tags=["analytics"],
    dependencies=[Depends(require_internal)],
)


@router.get("/analytics")
async def analytics(scope: tuple[str, bool] = Depends(require_user_scope)):
    user_id, is_admin = scope
    # Admins aggregate the whole org; others only their own runs. Each query
    # below references $1 exactly once iff scoped, so the param list stays
    # consistent with asyncpg's strict arg-count check.
    if is_admin:
        params: list = []
        runs_scope = ""  # AND-able predicate on call_runs
        events_scope = ""  # AND-able predicate on call_events
    else:
        params = [user_id]
        runs_scope = "user_id = $1"
        events_scope = (
            "EXISTS (SELECT 1 FROM call_runs r WHERE r.id = call_events.run_id AND r.user_id = $1)"
        )

    def _where(*preds: str) -> str:
        clauses = [p for p in preds if p]
        return ("WHERE " + " AND ".join(clauses)) if clauses else ""

    phi_where = _where("type='phi.access'", events_scope)
    tools_where = _where("type='tool.call'", events_scope)

    try:
        totals = await query_one(
            f"""SELECT count(*) AS total,
                      count(*) FILTER (WHERE outcome='completed') AS completed,
                      count(*) FILTER (WHERE outcome='escalated') AS escalated,
                      avg(extract(epoch from (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL) AS aht_sec,
                      avg(completion_prob) AS avg_completion,
                      avg(escalation_risk) AS avg_escalation
               FROM call_runs {_where(runs_scope)}""",
            params,
        )
        phi = await query_one(
            f"SELECT count(*) AS phi FROM call_events {phi_where}",
            params,
        )
        tools = await query_one(
            f"""SELECT count(*) AS calls,
                      count(*) FILTER (WHERE redaction IS NULL) AS errors
               FROM call_events {tools_where}""",
            params,
        )
        payers = await query(
            f"""SELECT payer,
                      count(*) AS calls,
                      count(*) FILTER (WHERE outcome='completed')::float / greatest(count(*),1) AS completion,
                      count(*) FILTER (WHERE outcome='escalated')::float / greatest(count(*),1) AS escalation,
                      avg(extract(epoch from (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL) AS aht
               FROM call_runs {_where(runs_scope)} GROUP BY payer ORDER BY calls DESC""",
            params,
        )
        models = await query(
            f"""SELECT model,
                      count(*) AS calls,
                      count(*) FILTER (WHERE outcome='completed')::float / greatest(count(*),1) AS completion,
                      count(*) FILTER (WHERE outcome='escalated')::float / greatest(count(*),1) AS escalation,
                      avg(extract(epoch from (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL) AS aht
               FROM call_runs {_where('model IS NOT NULL', runs_scope)} GROUP BY model ORDER BY calls DESC""",
            params,
        )
        volume = await query(
            f"""SELECT extract(hour from started_at)::int AS hour, count(*) AS calls
               FROM call_runs {_where('started_at IS NOT NULL', runs_scope)} GROUP BY 1 ORDER BY 1""",
            params,
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
            "models": [
                {
                    "model": m["model"],
                    "calls": int(m["calls"]),
                    "completionRate": float(m["completion"]),
                    "escalationRate": float(m["escalation"]),
                    "ahtSec": round(float(m["aht"])) if m["aht"] else 0,
                }
                for m in models
            ],
            "volumeByHour": [
                {"hour": f"{int(v['hour']):02d}:00", "calls": int(v["calls"])}
                for v in volume
            ],
        }
    except Exception as e:  # noqa: BLE001 - mirror TS: degrade gracefully, HTTP 200
        return {"hasData": False, "error": str(e) or "query failed"}
