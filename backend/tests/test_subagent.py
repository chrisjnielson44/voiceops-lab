"""
The `investigate` capability: a single tool call that fans out to a nested
plan→gather→verify→synthesize sub-graph, reusing the real read tools, and folds
the finding back into one ToolResult.
"""
from __future__ import annotations

import pytest

from app import db
from app.agent.tools import ToolContext, execute_tool
from tests.conftest import FakePool


def _recon_responder(claim_status, denial_reason, auth_rows):
    """A DB stub for the claim↔auth reconciliation cases."""
    def responder(query: str, params):
        q = query.strip()
        if "FROM members m LEFT JOIN coverage" in q:
            return [{"name": "Sofia Mendoza", "member_id": "ANT-883-50127", "payer": "Anthem", "plan_type": "Premier PPO", "group_number": "AN-6610", "active": True}]
        if "FROM coverage c JOIN members" in q:
            return [{"payer": "Anthem", "plan_type": "Premier PPO", "group_number": "AN-6610", "active": True, "copay_pcp": 30, "copay_spec": 55, "deductible_total": 2500, "deductible_met": 1200, "oop_max": 7000, "oop_met": 2600}]
        if "FROM claims WHERE claim_id" in q:
            return [{"claim_id": "ANT-7741", "status": claim_status, "dos": "2026-05-20", "cpt": "70553", "billed_amount": 2890.0, "carc_code": "CARC 197", "denial_reason": denial_reason, "resubmission_path": "see auth", "timely_filing_deadline": "2026-11-20"}]
        if "FROM prior_auths" in q:
            return auth_rows
        return []
    return responder


@pytest.fixture
def recon_pool(monkeypatch):
    def _install(claim_status, denial_reason, auth_rows):
        pool = FakePool(_recon_responder(claim_status, denial_reason, auth_rows))
        monkeypatch.setattr(db, "_pool", pool)
        return pool
    return _install


async def test_investigate_gathers_and_flags(fake_pool, fake_llm):
    ctx = ToolContext(
        run_id="sub1",
        scenario_id="claim-denial",
        member_id="W2049-88147",
        claim_id="4471-A",
    )
    res = await execute_tool("investigate", {"task": "check the claim denial end to end"}, ctx)

    # It gathered multiple records through the sub-graph...
    tools_run = {g["tool"] for g in res.data["gathered"]}
    assert {"lookup_patient", "verify_eligibility", "verify_claim"} <= tools_run
    # ...cross-checked them and flagged the denied claim...
    assert any("DENIED" in f for f in res.data["flags"])
    assert res.status == "warn" and res.phi is True
    # ...and synthesized a single finding for the calling agent.
    assert res.result and res.data["subagent"] == "investigate"


async def test_investigate_clean_when_no_issues(fake_pool, fake_llm):
    # No claim id and a default task → just member + eligibility, no flags.
    ctx = ToolContext(run_id="sub2", scenario_id="elig-aetna", member_id="W2049-88147")
    res = await execute_tool("investigate", {"task": "verify eligibility"}, ctx)
    assert res.status == "ok" and not res.data["flags"]
    assert {"lookup_patient", "verify_eligibility"} <= {g["tool"] for g in res.data["gathered"]}


async def test_investigate_reconciles_approved_auth(recon_pool, fake_llm):
    """Claim denied for 'auth not on file', but the auth is APPROVED now → the
    sub-agent should flag a discrepancy and recommend resubmit (not appeal)."""
    recon_pool(
        "DENIED",
        "Authorization not on file at time of adjudication (PA was still pending).",
        [{"auth_id": "PA-90233", "cpt": "70553", "status": "APPROVED", "determination": "APPROVED", "clinical_criteria_unmet": None}],
    )
    ctx = ToolContext(run_id="r", scenario_id="claim-anthem-recon", member_id="ANT-883-50127", claim_id="ANT-7741")
    res = await execute_tool("investigate", {"task": "reconcile the denied claim against the prior auth"}, ctx)

    assert "verify_auth" in {g["tool"] for g in res.data["gathered"]}
    flags = " ".join(res.data["flags"])
    assert "DISCREPANCY" in flags and "resubmit" in flags.lower()
    assert res.status == "warn"


async def test_investigate_flags_missing_auth_for_appeal(recon_pool, fake_llm):
    """Auth-related denial with NO auth on file → flag a retro-auth appeal (escalate)."""
    recon_pool(
        "DENIED",
        "Precertification/authorization absent for procedure.",
        [],  # no prior auth on file
    )
    ctx = ToolContext(run_id="r", scenario_id="claim-humana-appeal", member_id="HUM-664-10298", claim_id="HUM-9920")
    res = await execute_tool("investigate", {"task": "root cause of the precert denial; any auth on file?"}, ctx)

    flags = " ".join(res.data["flags"]).lower()
    assert "appeal" in flags and "escalate" in flags
    assert res.status == "warn"
