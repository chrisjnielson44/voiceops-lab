"""Tool execution against a fake DB pool, ported from tools.ts behavior."""
from __future__ import annotations

import pytest

from app.agent.tools import ToolContext, execute_tool

pytestmark = pytest.mark.asyncio


async def test_lookup_patient_match(fake_pool):
    res = await execute_tool("lookup_patient", {"member_id": "W2049-88147"}, ToolContext(run_id="r", scenario_id="elig-aetna"))
    assert res.status == "ok"
    assert res.phi is True
    assert "Maria Alvarez" in res.result
    assert "active" in res.result


async def test_verify_eligibility_requires_member(fake_pool):
    res = await execute_tool("verify_eligibility", {}, ToolContext(run_id="r", scenario_id="elig-aetna"))
    assert res.status == "error"
    assert res.phi is False


async def test_verify_eligibility_active(fake_pool):
    res = await execute_tool("verify_eligibility", {"member_id": "W2049-88147"}, ToolContext(run_id="r", scenario_id="elig-aetna"))
    assert res.status == "ok"
    assert "PCP copay $25" in res.result


async def test_verify_claim_denied_includes_detail(fake_pool):
    res = await execute_tool("verify_claim", {"claim_id": "4471-A"}, ToolContext(run_id="r", scenario_id="claim-uhc"))
    assert res.status == "warn"
    assert "DENIED" in res.result
    assert "Resubmission:" in res.result
    # Date rendered as YYYY-MM-DD, not a JS Date string.
    assert "2026-04-18" in res.result


async def test_unknown_tool(fake_pool):
    res = await execute_tool("frobnicate", {}, ToolContext(run_id="r", scenario_id="x"))
    assert res.status == "error"
    assert "Unknown tool" in res.result
