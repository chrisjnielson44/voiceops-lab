"""Custom scenarios: CRUD endpoints + generic/domain pack behavior."""
from __future__ import annotations

import pytest

from app.packs import custom_store
from app.packs.registry import all_packs, all_scenarios, get_scenario, pack_for_scenario

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def _clean_custom_cache():
    # Each test starts from an empty custom-scenario cache.
    custom_store._CACHE.clear()
    yield
    custom_store._CACHE.clear()


def test_domain_packs_register():
    ids = {p.id for p in all_packs()}
    assert {"healthcare", "banking", "telecom", "custom"} <= ids


def test_generic_pack_prompts_and_ground_truth():
    s = get_scenario("telco-outage-credit")
    pack = pack_for_scenario(s.id)
    assert pack.id == "telecom"
    # The counterparty answers from the scenario's self-contained facts.
    assert "outage" in pack.counterparty_system_prompt(s, s.facts).lower()


async def test_generic_tools_execute_without_db():
    s = get_scenario("bank-dispute")
    pack = pack_for_scenario(s.id)
    ctx = pack.tool_context(run_id="r1", scenario=s, transcript="")
    res = await pack.execute_tool("verify_details", {"reference": s.patient.member_id}, ctx)
    assert res.status == "ok"
    # Banking is flagged sensitive -> tokenized audit scope + phi on reads.
    assert res.phi is True
    assert pack.sensitive_scope(s).startswith("account:***")


async def test_create_update_delete_custom_scenario(client, fake_pool):
    payload = {
        "title": "Refund a duplicate charge",
        "payer": "Acme Retail",
        "category": "refund",
        "difficulty": "moderate",
        "objective": "Get a refund for a duplicate online order and capture the RMA number.",
        "subjectName": "Sam Carter",
        "subjectId": "ORD-99812",
        "callerName": "Sam Carter (customer)",
        "requiredFields": ["order_id", "refund_amount", "rma_number"],
        "facts": "ORDER ORD-99812 was charged twice ($42.00). Policy: refund the duplicate and issue RMA on request.",
    }
    created = await client.post("/api/scenarios", json=payload)
    assert created.status_code == 201
    body = created.json()
    sid = body["id"]
    assert body["pack"] == "custom" and body["custom"] is True
    assert sid.startswith("custom-")

    # It now appears in the merged catalog and resolves through the registry.
    assert any(s.id == sid for s in all_scenarios())
    assert get_scenario(sid).payer == "Acme Retail"

    # Edit it.
    payload["title"] = "Refund a duplicate charge (v2)"
    updated = await client.put(f"/api/scenarios/{sid}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["title"].endswith("(v2)")
    assert get_scenario(sid).title.endswith("(v2)")

    # Delete it.
    deleted = await client.delete(f"/api/scenarios/{sid}")
    assert deleted.status_code == 204
    assert not custom_store.exists(sid)


async def test_cannot_edit_or_delete_builtin(client, fake_pool):
    assert (await client.put("/api/scenarios/elig-aetna", json={"title": "x", "payer": "y"})).status_code == 404
    assert (await client.delete("/api/scenarios/elig-aetna")).status_code == 404
