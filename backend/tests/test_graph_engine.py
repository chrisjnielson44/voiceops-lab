"""
The LangGraph call engine must produce the same kind of run the legacy loop does:
a valid SSE event stream, an internally-consistent audit-hash chain, and the same
turn shape — plus native interrupt()-based human-in-the-loop.

(Exact audit hashes can't match run-to-run because the chain commits each event's
`atMs`; what we assert is that each chain links correctly and both engines emit
the same sequence of event kinds and turn speakers.)
"""
from __future__ import annotations

import asyncio

from app.agent.graph.engine import run_orchestrator_lg
from app.agent.orchestrator import run_orchestrator
from app.agent.run_store import create_run
from app.audit.ledger import audit_canonical
from app.core.hash import GENESIS_HASH, chain_hash


def _kinds(run):
    return [e.get("kind") for e in run.events]


def _audit_events(run):
    return [e["event"] for e in run.events if e.get("kind") == "audit"]


def _assert_chain_valid(run):
    """Every audit event links to the previous via the hash chain."""
    audits = _audit_events(run)
    assert audits, "expected audit events in the stream"
    prev = GENESIS_HASH
    for a in audits:
        assert a["prevHash"] == prev, f"broken chain at seq {a['seq']}"
        recomputed = chain_hash(
            prev,
            audit_canonical(
                {
                    "seq": a["seq"],
                    "type": a["type"],
                    "atMs": a["atMs"],
                    "actor": a["actor"],
                    "summary": a["summary"],
                    "tool": a.get("tool"),
                    "phi": a["phi"],
                    "phiScope": a.get("phiScope"),
                    "redaction": a["redaction"],
                    "model": a.get("model"),
                    "promptVersion": a.get("promptVersion"),
                }
            ),
        )
        assert recomputed == a["hash"], f"hash mismatch at seq {a['seq']}"
        prev = a["hash"]


async def test_langgraph_autonomous_call(fake_pool, fake_llm):
    run = create_run(id="lg_auto", scenario_id="elig-aetna", model="m")
    await asyncio.wait_for(run_orchestrator_lg(run), timeout=10)

    kinds = _kinds(run)
    assert kinds[-1] == "done"
    assert run.events[-1]["outcome"] == "completed"
    # The agent spoke and the payer replied.
    speakers = [e["turn"]["speaker"] for e in run.events if e["kind"] == "turn"]
    assert "agent" in speakers and "payer" in speakers
    # Tools ran (lookup + eligibility) and were audited.
    assert any(e["kind"] == "tool" for e in run.events)
    _assert_chain_valid(run)


async def test_langgraph_matches_legacy_shape(fake_pool, fake_llm):
    """Same scenario + scripted model through both engines → same event-kind set
    and same turn speakers, proving the migration preserves the contract."""
    legacy = create_run(id="legacy_shape", scenario_id="elig-aetna", model="m")
    await asyncio.wait_for(run_orchestrator(legacy), timeout=10)

    # Fresh fake_llm script position: rebuild the scripted model for the 2nd run.
    fake_llm.agent_step = 0
    lg = create_run(id="lg_shape", scenario_id="elig-aetna", model="m")
    await asyncio.wait_for(run_orchestrator_lg(lg), timeout=10)

    assert set(_kinds(legacy)) == set(_kinds(lg))
    legacy_speakers = [e["turn"]["speaker"] for e in legacy.events if e["kind"] == "turn"]
    lg_speakers = [e["turn"]["speaker"] for e in lg.events if e["kind"] == "turn"]
    assert legacy_speakers == lg_speakers
    assert legacy.events[-1]["outcome"] == lg.events[-1]["outcome"]


async def _wait_for(pred, run, timeout=5.0):
    for _ in range(int(timeout / 0.01)):
        if pred(run):
            return True
        await asyncio.sleep(0.01)
    return False


async def test_langgraph_human_payer_interrupt(fake_pool, fake_llm):
    """The human-payer turn suspends the graph via interrupt(); feeding the reply
    to payer_inbox resumes it (POST /api/agent/say plumbing, unchanged)."""
    run = create_run(id="lg_human", scenario_id="elig-aetna", model="m", human_payer=True)
    task = asyncio.create_task(run_orchestrator_lg(run))

    awaiting = await _wait_for(
        lambda r: any(e.get("kind") == "await" and e.get("awaiting") for e in r.events), run
    )
    assert awaiting, "graph should interrupt and emit await(true) for the human"
    assert not any(e["kind"] == "turn" and e["turn"]["speaker"] == "payer" for e in run.events)

    run.payer_inbox.put_nowait("You're verified — the member is active.")
    await asyncio.wait_for(task, timeout=10)

    payer_turns = [e["turn"] for e in run.events if e["kind"] == "turn" and e["turn"]["speaker"] == "payer"]
    assert payer_turns and payer_turns[0]["text"].startswith("You're verified")
    assert any(e.get("kind") == "await" and not e.get("awaiting") for e in run.events)
    assert run.events[-1]["kind"] == "done"


def _tool_names(run):
    return [e["tool"]["tool"] for e in run.events if e["kind"] == "tool"]


async def test_langgraph_sensitive_tool_approved(fake_pool, fake_llm, monkeypatch):
    """A tool in agent_approval_tools suspends the graph for human approval;
    approving lets it execute."""
    from app.config import settings

    monkeypatch.setattr(settings, "agent_approval_tools", "verify_eligibility")
    run = create_run(id="lg_appr_ok", scenario_id="elig-aetna", model="m")
    task = asyncio.create_task(run_orchestrator_lg(run))
    # The driver blocks on approval_inbox at the verify_eligibility interrupt;
    # the queue buffers, so pre-loading the decision is race-free.
    run.approval_inbox.put_nowait({"approved": True, "args": None})
    await asyncio.wait_for(task, timeout=10)

    assert "verify_eligibility" in _tool_names(run)
    assert any(e.get("kind") == "await" and e.get("role") == "approval" and e.get("awaiting") for e in run.events)
    assert run.events[-1]["kind"] == "done"


async def test_langgraph_sensitive_tool_declined(fake_pool, fake_llm, monkeypatch):
    """Declining the approval skips the tool; the agent is told and re-decides."""
    from app.config import settings

    monkeypatch.setattr(settings, "agent_approval_tools", "verify_eligibility")
    run = create_run(id="lg_appr_no", scenario_id="elig-aetna", model="m")
    task = asyncio.create_task(run_orchestrator_lg(run))
    run.approval_inbox.put_nowait({"approved": False, "args": None})
    await asyncio.wait_for(task, timeout=10)

    assert "verify_eligibility" not in _tool_names(run)
    assert any(
        e["kind"] == "audit" and e["event"]["type"] == "compliance.flag" and "declined" in e["event"]["summary"]
        for e in run.events
    )
    assert run.events[-1]["kind"] == "done" and run.events[-1]["outcome"] != "stopped"
