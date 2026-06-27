"""
Shared fixtures. These let the suite run with NO external services — a fake
asyncpg pool and a scripted fake LLM stand in for Neon and the local model.
"""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app import db
from app.llm.local_llm import LLMJsonResult, LLMResult

# --- Fake Postgres pool -----------------------------------------------------
# Every module reaches the DB through `app.db.query`, which calls
# `app.db.get_pool().fetch(...)`. Swapping the module-level `_pool` for a fake is
# therefore enough to intercept all queries.


class FakePool:
    def __init__(self, responder):
        self._responder = responder
        self.executed: list[tuple[str, tuple]] = []

    async def fetch(self, query: str, *params):
        self.executed.append((query, params))
        return self._responder(query, params)

    async def close(self):  # called by db.disconnect()
        return None


def _default_responder(query: str, params):
    q = query.strip()
    if q.startswith("INSERT"):
        return []
    if "FROM members m LEFT JOIN coverage" in q:  # lookup_patient
        return [{"name": "Maria Alvarez", "member_id": "W2049-88147", "payer": "Aetna", "plan_type": "Open Access PPO", "group_number": "7741-A", "active": True}]
    if "FROM coverage c JOIN members" in q:  # verify_eligibility
        return [{"payer": "Aetna", "plan_type": "Open Access PPO", "group_number": "7741-A", "active": True, "copay_pcp": 25, "copay_spec": 40, "deductible_total": 1500, "deductible_met": 640, "oop_max": 6000, "oop_met": 1180}]
    if "FROM claims WHERE claim_id" in q:
        return [{"claim_id": "4471-A", "status": "DENIED", "dos": "2026-04-18", "cpt": "99214", "billed_amount": 432.0, "carc_code": "CARC 16", "denial_reason": "missing info", "resubmission_path": "corrected claim", "timely_filing_deadline": "2026-10-18"}]
    if "FROM members WHERE member_id" in q:
        return [{"member_id": "W2049-88147", "name": "Maria Alvarez", "payer": "Aetna"}]
    if "FROM coverage WHERE member_id" in q:
        return [{"member_id": "W2049-88147", "active": True, "copay_pcp": 25}]
    if "FROM prior_auths" in q:
        return [{"auth_id": "PA-88210", "status": "PENDING"}]
    return []


@pytest.fixture
def fake_pool(monkeypatch):
    pool = FakePool(_default_responder)
    monkeypatch.setattr(db, "_pool", pool)
    return pool


# --- Scripted fake LLM ------------------------------------------------------


class FakeLLM:
    """Returns canned JSON keyed by which system prompt is present in the messages."""

    def __init__(self):
        self.agent_step = 0
        self.agent_script = [
            {"action": "tool", "tool": "lookup_patient", "args": {"member_id": "W2049-88147"}},
            {"action": "tool", "tool": "verify_eligibility", "args": {"member_id": "W2049-88147"}},
            {"action": "speak", "text": "Hello, I'm verifying eligibility for the member."},
            {"action": "end", "outcome": "completed", "summary": "Eligibility confirmed."},
        ]

    async def chat_json(self, messages, *, temperature=0.3, max_tokens=256, model=None, abort=None, name="llm.json"):
        await asyncio.sleep(0)
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        if "provider-services representative" in system:
            value = {"text": "You're verified. The member is active.", "ends": False, "escalate": False}
        elif "predictive operations model" in system:
            value = {"completionProbability": 0.9, "escalationRisk": 0.1, "nextPayerResponse": "ok", "nextResponseConfidence": 0.8, "missingFields": [], "estRemainingSec": 30, "rationale": "progressing well"}
        else:  # agent decision
            value = self.agent_script[min(self.agent_step, len(self.agent_script) - 1)]
            self.agent_step += 1
        return LLMJsonResult(value=value, raw="{}", latency_ms=12, completion_tokens=20, reasoning="Considering the member's eligibility.")

    async def chat_stream(self, messages, *, temperature=0.3, max_tokens=256, model=None, abort=None, on_delta=None, name="llm.stream"):
        # The agent turn now streams; return the next scripted decision and emit a
        # token of reasoning so the streaming reasoning path is exercised.
        await asyncio.sleep(0)
        if on_delta is not None:
            await on_delta("Considering the next step in the call.", "")
        value = self.agent_script[min(self.agent_step, len(self.agent_script) - 1)]
        self.agent_step += 1
        return LLMJsonResult(value=value, raw="{}", latency_ms=12, completion_tokens=20, reasoning="Considering the next step in the call.")

    async def chat(self, messages, *, temperature=0.3, max_tokens=256, model=None, abort=None, name="llm.chat"):
        await asyncio.sleep(0)
        return LLMResult(text="Encounter summary: eligibility verified.", latency_ms=10, prompt_tokens=5, completion_tokens=8)


@pytest.fixture
def fake_llm(monkeypatch):
    llm = FakeLLM()
    from app.agent import engine, orchestrator, tools

    monkeypatch.setattr(orchestrator, "chat_json", llm.chat_json)
    monkeypatch.setattr(orchestrator, "chat_stream", llm.chat_stream)
    # The CallEngine (shared by the langgraph engine) imports the same helpers.
    monkeypatch.setattr(engine, "chat_json", llm.chat_json)
    monkeypatch.setattr(engine, "chat_stream", llm.chat_stream)
    monkeypatch.setattr(tools, "chat", llm.chat)
    # The investigate sub-agent synthesizes via its own chat import.
    from app.agent.graph import subagents

    monkeypatch.setattr(subagents, "chat", llm.chat)
    return llm


@pytest.fixture
async def client():
    """ASGI test client. Lifespan is skipped, so set up `fake_pool` where needed."""
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
