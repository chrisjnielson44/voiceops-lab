"""
Text role-play: the agent leads the call and a HUMAN plays the payer rep. The
orchestrator must pause for the human's typed reply (instead of running the payer
model) and resume when it arrives — driven by POST /api/agent/say.
"""
from __future__ import annotations

import asyncio

from app.agent.orchestrator import run_orchestrator
from app.agent.run_store import create_run, get_run


async def _wait_for(pred, run, timeout=5.0):
    for _ in range(int(timeout / 0.01)):
        if pred(run):
            return True
        await asyncio.sleep(0.01)
    return False


async def test_roleplay_awaits_then_resumes(fake_pool, fake_llm):
    run = create_run(id="rp_resume", scenario_id="elig-aetna", model="m", human_payer=True)
    task = asyncio.create_task(run_orchestrator(run))

    # The loop runs the agent (lead), then blocks for the human payer reply.
    awaiting = await _wait_for(
        lambda r: any(e.get("kind") == "await" and e.get("awaiting") for e in r.events), run
    )
    assert awaiting, "orchestrator should emit await(true) and pause for the human"
    # No payer turn yet — only the agent has spoken (it leads).
    assert not any(e["kind"] == "turn" and e["turn"]["speaker"] == "payer" for e in run.events)

    # Human (playing the rep) submits a reply → the loop resumes.
    run.payer_inbox.put_nowait("You're verified — the member is active.")
    await asyncio.wait_for(task, timeout=8)

    payer_turns = [e["turn"] for e in run.events if e["kind"] == "turn" and e["turn"]["speaker"] == "payer"]
    assert payer_turns and payer_turns[0]["text"].startswith("You're verified")
    # The await was cleared so the UI hides the reply box.
    assert any(e.get("kind") == "await" and not e.get("awaiting") for e in run.events)


async def test_say_endpoint_validates(client, fake_pool):
    # Unknown run → 404.
    assert (await client.post("/api/agent/say", json={"runId": "nope", "text": "hi"})).status_code == 404

    # A non-role-play run rejects /say (409) — that side is the model's.
    create_run(id="rp_auto", scenario_id="elig-aetna", model="m", human_payer=False)
    assert (await client.post("/api/agent/say", json={"runId": "rp_auto", "text": "hi"})).status_code == 409

    # A role-play run accepts a non-empty reply and enqueues it.
    create_run(id="rp_ok", scenario_id="elig-aetna", model="m", human_payer=True)
    blank = await client.post("/api/agent/say", json={"runId": "rp_ok", "text": "  "})
    assert blank.status_code == 400
    ok = await client.post("/api/agent/say", json={"runId": "rp_ok", "text": "Sure, go ahead."})
    assert ok.status_code == 200 and ok.json()["ok"] is True
    assert get_run("rp_ok").payer_inbox.get_nowait() == "Sure, go ahead."
