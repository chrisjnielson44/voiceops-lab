"""
Scenario catalog endpoint. The backend is the source of truth for the scenario
library the cockpit offers — built-in domain packs plus user-authored custom
scenarios.

  GET    /api/scenarios       — list all scenarios (with pack + custom flag)
  GET    /api/scenarios/{id}  — fetch one
  POST   /api/scenarios       — create a custom scenario
  PUT    /api/scenarios/{id}  — edit a custom scenario
  DELETE /api/scenarios/{id}  — delete a custom scenario

Custom scenarios are persisted in Neon (see app.packs.custom_store) and run on
the generic, facts-backed pack seam. Built-in scenarios are read-only.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.packs import custom_store
from app.packs.registry import all_scenarios, get_scenario, pack_for_scenario
from app.routers._deps import require_internal, require_user
from app.schemas import CamelModel

router = APIRouter(
    prefix="/api",
    tags=["scenarios"],
    dependencies=[Depends(require_internal), Depends(require_user)],
)


class CustomScenarioInput(CamelModel):
    """Editor payload for creating/updating a custom scenario."""

    title: str
    payer: str
    category: str = "general"
    difficulty: str = "moderate"
    outcome: str = "completed"
    objective: str = ""
    subject_name: str = ""
    subject_id: str = ""
    caller_name: str = ""
    required_fields: list[str] = []
    facts: str = ""


def _with_pack(scenario_id: str) -> dict:
    s = get_scenario(scenario_id)
    pack = pack_for_scenario(scenario_id)
    return {**s.to_wire(), "pack": pack.id, "packLabel": pack.label, "custom": pack.id == "custom"}


@router.get("/scenarios")
async def scenarios():
    out = []
    for s in all_scenarios():
        pack = pack_for_scenario(s.id)
        out.append({**s.to_wire(), "pack": pack.id, "packLabel": pack.label, "custom": pack.id == "custom"})
    return {"scenarios": out}


@router.get("/scenarios/{scenario_id}")
async def scenario(scenario_id: str):
    return _with_pack(scenario_id)


@router.get("/scenarios/{scenario_id}/role-card")
async def role_card(scenario_id: str):
    """Brief the human who plays the counterparty in a text role-play: who they
    are, who's calling, what's on file (so they can answer accurately), and the
    objective. Records reuse the context graph's human-readable fact lines, with
    a fall back to the pack's ground-truth text."""
    s = get_scenario(scenario_id)
    pack = pack_for_scenario(scenario_id)
    records: list[str] = []
    try:
        graph = await pack.build_graph(s)
        if graph is not None:
            records = graph.all_facts()
    except Exception:  # noqa: BLE001 - never fail the card on a graph/DB hiccup
        records = []
    if not records:
        try:
            text = await pack.load_ground_truth(s)
            records = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
        except Exception:  # noqa: BLE001
            records = []
    return {
        "scenarioId": s.id,
        "payer": s.payer,
        "payerId": s.payer_id,
        "category": s.category,
        "objective": s.objective,
        "requiredFields": s.required_fields,
        "patient": {"name": s.patient.name, "memberId": s.patient.member_id},
        "records": records,
    }


def _build(scenario_id: str, body: CustomScenarioInput):
    return custom_store.build_scenario(
        scenario_id=scenario_id,
        title=body.title,
        payer=body.payer,
        category=body.category,
        difficulty=body.difficulty,
        objective=body.objective,
        subject_name=body.subject_name,
        subject_id=body.subject_id,
        caller_name=body.caller_name,
        required_fields=body.required_fields,
        facts=body.facts,
        outcome=body.outcome,
    )


@router.post("/scenarios", status_code=201)
async def create_scenario(body: CustomScenarioInput, user_id: str = Depends(require_user)):
    if not body.title.strip() or not body.payer.strip():
        raise HTTPException(status_code=422, detail="title and payer are required")
    scenario_id = custom_store.new_id(body.title)
    s = _build(scenario_id, body)
    await custom_store.create(s, user_id)
    return _with_pack(scenario_id)


@router.put("/scenarios/{scenario_id}")
async def update_scenario(scenario_id: str, body: CustomScenarioInput, _user: str = Depends(require_user)):
    if not custom_store.exists(scenario_id):
        # Either unknown or a read-only built-in scenario.
        raise HTTPException(status_code=404, detail="custom scenario not found")
    if not body.title.strip() or not body.payer.strip():
        raise HTTPException(status_code=422, detail="title and payer are required")
    s = _build(scenario_id, body)
    await custom_store.update(s, _user)
    return _with_pack(scenario_id)


@router.delete("/scenarios/{scenario_id}", status_code=204)
async def delete_scenario(scenario_id: str, _user: str = Depends(require_user)):
    if not custom_store.exists(scenario_id):
        raise HTTPException(status_code=404, detail="custom scenario not found")
    await custom_store.delete(scenario_id)
    return None
