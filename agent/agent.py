"""
VoiceOps LiveKit voice agent (real telephony pipeline).

This is the deployable voice counterpart to the in-app text agent. It wires a
real STT -> LLM -> TTS loop and exposes the same payer-ops tools, querying the
same Neon Postgres ground-truth the web app uses. The LLM points at the LOCAL
model server (MLX, OpenAI-compatible) so inference stays on-device.

It is intentionally NOT auto-deployed. To run/deploy:
    pip install -r requirements.txt
    python agent.py dev          # local dev (needs STT/TTS keys for real audio)
    # or, to deploy to LiveKit Cloud (interactive auth required):
    #   lk cloud auth
    #   lk agent create
See README.md.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import traceback
from typing import Any

import httpx
import psycopg
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, RunContext, function_tool
from livekit.plugins import elevenlabs, openai

from persistence import CallRecorder

load_dotenv()

# Backend bridge — forwards live turns/tools/lifecycle to POST /api/agent/ingest
# so the cockpit's context-graph, prediction, reasoning, and tool panels light up
# during a real voice call (parity with the in-app simulate loop). Best-effort: a
# missing URL or a backend hiccup never disturbs the audio pipeline.
BRIDGE_URL = (os.environ.get("BACKEND_URL") or os.environ.get("VOICEOPS_BACKEND_URL") or "").rstrip("/")
BRIDGE_TOKEN = os.environ.get("BACKEND_INTERNAL_TOKEN")

# The ElevenLabs plugin reads ELEVEN_API_KEY; accept the project's ELEVENLABS_API_KEY too.
if os.environ.get("ELEVENLABS_API_KEY") and not os.environ.get("ELEVEN_API_KEY"):
    os.environ["ELEVEN_API_KEY"] = os.environ["ELEVENLABS_API_KEY"]

DB_URL = (
    os.environ.get("DATABASE_URL_UNPOOLED")
    or os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL_NON_POOLING")
)

INSTRUCTIONS = """You are VoiceOps, an autonomous healthcare administrative voice agent calling a
payer's provider-services line on behalf of a clinic. Authenticate, then verify member eligibility,
claim status, or prior-auth status. Speak only facts that are either returned by a tool or supplied
in a VERIFIED RECORDS grounding block — both come from the payer's system of record. Never invent
coverage, claim, or auth details. When the grounding already contains the answer to what the rep
asks, you may state it directly without re-running a lookup; still call tools to take an action or to
write a result back. Be concise and professional. If the payer requires a peer-to-peer review or you
cannot resolve the issue autonomously, say so and escalate. Capture the required fields, then
summarize the outcome and end the call politely."""


def _debug(msg: str) -> None:
    # Lightweight local trace for LiveKit job startup; useful because child
    # process logs do not reliably surface through `python agent.py dev`.
    with open("/tmp/voiceops-agent-debug.log", "a", encoding="utf-8") as f:
        f.write(f"{msg}\n")


class Bridge:
    """Forwards live-call events to the backend SSE ingest endpoint. Fire-and-
    forget: every send is wrapped so a backend outage can't stall the audio loop,
    and the whole thing no-ops when BACKEND_URL isn't configured."""

    def __init__(self, run_id: str, scenario_id: str | None, model: str) -> None:
        self.run_id = run_id
        self.scenario_id = scenario_id
        self.model = model
        self.enabled = bool(BRIDGE_URL)
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(10.0))
        return self._client

    def send(self, event: dict[str, Any]) -> None:
        """Schedule a forward without awaiting it (safe to call from sync code)."""
        if not self.enabled:
            return
        asyncio.create_task(self._post(event))

    async def _post(self, event: dict[str, Any]) -> None:
        headers = {"content-type": "application/json"}
        if BRIDGE_TOKEN:
            headers["x-internal-token"] = BRIDGE_TOKEN
        try:
            await self._http().post(
                f"{BRIDGE_URL}/api/agent/ingest",
                headers=headers,
                json={
                    "runId": self.run_id,
                    "scenarioId": self.scenario_id,
                    "model": self.model,
                    "event": event,
                },
            )
        except Exception:  # noqa: BLE001 - bridge is best-effort
            _debug(f"bridge post failed: {event.get('kind')}")

    async def fetch_context(self, text: str) -> str:
        """Pull anticipatory grounding for the upcoming reply: the verified records
        the call has surfaced PLUS the records the predictor expects the rep to ask
        about next, folded into one block. So the context graph + anticipation
        actually steer the live answer (not just the cockpit panels). Best-effort
        and short-timeout — a backend hiccup just means an ungrounded turn, never a
        stalled audio loop. Returns "" when disabled/unavailable."""
        if not self.enabled:
            return ""
        headers = {"content-type": "application/json"}
        if BRIDGE_TOKEN:
            headers["x-internal-token"] = BRIDGE_TOKEN
        try:
            resp = await self._http().post(
                f"{BRIDGE_URL}/api/agent/context",
                headers=headers,
                json={
                    "runId": self.run_id,
                    "scenarioId": self.scenario_id,
                    "model": self.model,
                    "text": text or "",
                },
                timeout=httpx.Timeout(2.5),
            )
            if resp.status_code != 200:
                return ""
            data = resp.json()
            return data.get("context") or "" if isinstance(data, dict) else ""
        except Exception:  # noqa: BLE001 - grounding is best-effort
            _debug("bridge context fetch failed")
            return ""

    async def aclose(self) -> None:
        if self._client is not None:
            try:
                await self._client.aclose()
            except Exception:  # noqa: BLE001
                pass


def _query(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Real synchronous DB read against Neon (ground truth the agent verifies)."""
    if not DB_URL:
        return []
    with psycopg.connect(DB_URL, sslmode="require") as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


class PayerOpsAgent(Agent):
    def __init__(self, recorder: CallRecorder, instructions: str, bridge: Bridge) -> None:
        super().__init__(instructions=instructions)
        self._rec = recorder
        self._bridge = bridge

    async def on_user_turn_completed(self, turn_ctx: Any, new_message: Any) -> None:
        """LiveKit RAG hook: fires after the rep finishes speaking, before the LLM
        replies. We fold the context graph's grounding — verified records the call
        has surfaced PLUS the records anticipation expects the rep to ask about
        next — into the turn so the agent answers from on-file facts (and already
        holds the likely-next record, no extra lookup). Best-effort: any failure
        leaves the turn ungrounded rather than disturbing the audio pipeline."""
        try:
            user_text = getattr(new_message, "text_content", None) or ""
            context = await self._bridge.fetch_context(user_text)
            if not context:
                return
            turn_ctx.add_message(
                role="system",
                content=(
                    "VERIFIED RECORDS from the payer's system of record (read-only "
                    "grounding — speak only these facts; still call tools to act and "
                    "to write results back):\n" + context
                ),
            )
            _debug(f"grounding injected ({len(context)} chars) room={self._bridge.run_id}")
        except Exception:  # noqa: BLE001 - never let grounding disturb the reply
            _debug("grounding inject failed")

    async def _record(
        self, tool: str, result: str, *, phi: bool, key: str | None = None, args: dict[str, Any] | None = None
    ) -> None:
        scope = f"member:***{key[-4:]}" if (phi and key) else ("handoff:packet" if phi else None)
        started = time.time()
        await asyncio.to_thread(self._rec.record_tool, tool, f"{tool} → {result[:80]}", phi, scope)
        # Mirror the tool call into the cockpit's live event stream.
        self._bridge.send({
            "kind": "tool",
            "tool": tool,
            "args": args or ({"member_id": key} if key else {}),
            "result": result,
            "status": "ok",
            "latencyMs": round((time.time() - started) * 1000),
            "phi": phi,
            "phiScope": scope,
        })

    @function_tool()
    async def lookup_patient(self, context: RunContext, member_id: str) -> str:
        """Look up a member and confirm a match before discussing PHI."""
        rows = _query(
            "SELECT m.name, m.payer, m.plan_type, c.active "
            "FROM members m LEFT JOIN coverage c USING (member_id) WHERE m.member_id = %s",
            (member_id,),
        )
        if not rows:
            result = "No member match found."
        else:
            r = rows[0]
            result = f"Match: {r['name']}, {r['payer']} {r.get('plan_type') or ''}, coverage {'active' if r['active'] else 'inactive'}."
        await self._record("lookup_patient", result, phi=True, key=member_id)
        return result

    @function_tool()
    async def verify_eligibility(self, context: RunContext, member_id: str) -> str:
        """Return active coverage, copays, deductible, and out-of-pocket accumulators."""
        rows = _query("SELECT * FROM coverage WHERE member_id = %s", (member_id,))
        if not rows:
            result = "No coverage on file."
        else:
            c = rows[0]
            result = (
                f"{'Active' if c['active'] else 'Inactive'}. PCP copay ${c['copay_pcp']}, specialist "
                f"${c['copay_spec']}. Deductible ${c['deductible_met']}/${c['deductible_total']} met. "
                f"OOP ${c['oop_met']}/${c['oop_max']}."
            )
        await self._record("verify_eligibility", result, phi=True, key=member_id)
        return result

    @function_tool()
    async def verify_claim(self, context: RunContext, claim_id: str) -> str:
        """Return a claim's adjudication status, denial reason, and resubmission path."""
        rows = _query("SELECT * FROM claims WHERE claim_id = %s", (claim_id,))
        if not rows:
            result = "No claim found."
        else:
            c = rows[0]
            result = f"Claim {c['claim_id']}: {c['status']}, CPT {c['cpt']}, billed ${c['billed_amount']}."
            if c["status"] == "DENIED":
                result += f" {c['carc_code']}: {c['denial_reason']} Resubmission: {c['resubmission_path']}."
        await self._record("verify_claim", result, phi=True, key=claim_id, args={"claim_id": claim_id})
        return result

    @function_tool()
    async def escalate(self, context: RunContext, reason: str) -> str:
        """Route to a human specialist when the call cannot be completed autonomously."""
        self._rec.escalated = True
        result = f"Escalation packet created and routed to clinical review ({reason})."
        await self._record("escalate", result, phi=True, args={"reason": reason})
        return result


def _build_llm(model: str, temperature: float):
    """Honor the selected model: local MLX models stay on-device; hosted ids route
    to OpenRouter when a key is present."""
    hosted = (not model.startswith("mlx-community/")) and bool(os.environ.get("OPENROUTER_API_KEY"))
    if hosted:
        return openai.LLM(
            model=model,
            base_url=os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            api_key=os.environ["OPENROUTER_API_KEY"],
            temperature=temperature,
        )
    return openai.LLM(
        model=model,
        base_url=os.environ.get("LOCAL_LLM_BASE_URL", "http://127.0.0.1:8080/v1"),
        api_key=os.environ.get("LOCAL_LLM_API_KEY", "local"),
        temperature=temperature,
    )


async def entrypoint(ctx: agents.JobContext) -> None:
    try:
        await _entrypoint(ctx)
    except Exception:  # noqa: BLE001
        _debug(traceback.format_exc())
        raise


async def _entrypoint(ctx: agents.JobContext) -> None:
    _debug(f"entrypoint start room={ctx.room.name}")
    await ctx.connect()
    _debug(f"connected room={ctx.room.name} participants={len(ctx.room.remote_participants)}")

    # The selected sandbox config rides on the room metadata (set by /api/voice/token).
    try:
        cfg = json.loads(ctx.room.metadata or "{}")
    except Exception:  # noqa: BLE001
        cfg = {}
    model = cfg.get("model") or os.environ.get("LOCAL_LLM_MODEL", "mlx-community/Qwen2.5-7B-Instruct-4bit")
    voice_id = cfg.get("voiceId") or os.environ.get("ELEVENLABS_VOICE_ID")
    instructions = cfg.get("instructions") or INSTRUCTIONS
    temperature = float(cfg.get("temperature", 0.4))

    # Persist this voice call to the same Neon tables a text run uses. The room
    # name IS the runId (set by POST /api/voice/token).
    recorder = CallRecorder(DB_URL, ctx.room.name, model)
    await asyncio.to_thread(recorder.start)
    _debug(f"recorder started room={ctx.room.name}")

    # Live cockpit bridge: forwards turns/tools/lifecycle to the backend so the
    # graph / prediction / reasoning panels track the call in real time.
    bridge = Bridge(ctx.room.name, cfg.get("scenarioId") or recorder.scenario_id, model)
    bridge.send({"kind": "hello"})  # opens the run + emits session/start events

    has_eleven = bool(os.environ.get("ELEVEN_API_KEY") or os.environ.get("ELEVENLABS_API_KEY"))
    _debug(f"session build start room={ctx.room.name} has_eleven={has_eleven}")

    session = AgentSession(
        llm=_build_llm(model, temperature),
        # ElevenLabs handles both speech-to-text (Scribe v2 realtime) and TTS
        # from a single key; the selected voice is applied to TTS.
        stt=elevenlabs.STT(model_id="scribe_v2_realtime") if has_eleven else None,
        tts=(
            elevenlabs.TTS(**({"voice_id": voice_id} if voice_id else {})) if has_eleven else None
        ),
        # VAD: AgentSession uses the bundled silero VAD by default (no plugin needed).
        # Forward word-aligned TTS transcripts so the cockpit shows synced captions.
        use_tts_aligned_transcript=True,
    )
    _debug(f"session built room={ctx.room.name}")

    # Persist each conversation turn (audit chain) as it lands.
    @session.on("conversation_item_added")
    def _on_item(ev: Any) -> None:
        item = getattr(ev, "item", None)
        text = getattr(item, "text_content", None) or "" if item else ""
        if not text:
            return
        speaker = "agent" if getattr(item, "role", "") == "assistant" else "payer"
        asyncio.create_task(asyncio.to_thread(recorder.record_turn, speaker, text))
        bridge.send({"kind": "turn", "speaker": speaker, "text": text})

    async def _finalize() -> None:
        await asyncio.to_thread(recorder.finalize)
        # Await the final forward (don't schedule it) so it lands before teardown.
        if bridge.enabled:
            await bridge._post({"kind": "done", "outcome": "escalated" if recorder.escalated else "completed"})
        await bridge.aclose()

    ctx.add_shutdown_callback(_finalize)

    await session.start(agent=PayerOpsAgent(recorder, instructions, bridge), room=ctx.room)
    _debug(f"session started room={ctx.room.name}")
    await asyncio.sleep(0.5)
    session.say(
        f"Hello, this is VoiceOps calling {recorder.payer or 'provider services'} on a recorded line. "
        "I am calling to verify eligibility and benefits for an office visit."
    )
    _debug(f"greeting queued room={ctx.room.name}")
    # `AgentSession.start()` is non-blocking. Keep the job process alive until
    # LiveKit terminates it; otherwise the browser joins a room with no agent.
    try:
        await asyncio.Event().wait()
    finally:
        _debug(f"session closing room={ctx.room.name}")
        await session.aclose()


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=os.environ.get("LIVEKIT_AGENT_NAME", "voiceops-agent"),
        )
    )
