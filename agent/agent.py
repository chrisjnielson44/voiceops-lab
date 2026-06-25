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
import os
from typing import Any

import psycopg
from dotenv import load_dotenv
from livekit import agents
from livekit.agents import Agent, AgentSession, RunContext, function_tool
from livekit.plugins import elevenlabs, openai

from persistence import CallRecorder

load_dotenv()

# The ElevenLabs plugin reads ELEVEN_API_KEY; accept the project's ELEVENLABS_API_KEY too.
if os.environ.get("ELEVENLABS_API_KEY") and not os.environ.get("ELEVEN_API_KEY"):
    os.environ["ELEVEN_API_KEY"] = os.environ["ELEVENLABS_API_KEY"]

DB_URL = (
    os.environ.get("DATABASE_URL_UNPOOLED")
    or os.environ.get("DATABASE_URL")
    or os.environ.get("POSTGRES_URL_NON_POOLING")
)

INSTRUCTIONS = """You are VoiceOps, an autonomous healthcare administrative voice agent calling a
payer's provider-services line on behalf of a clinic. Authenticate, then use your tools to verify
member eligibility, claim status, or prior-auth status. Speak only facts returned by tools — never
invent coverage, claim, or auth details. Be concise and professional. If the payer requires a
peer-to-peer review or you cannot resolve the issue autonomously, say so and escalate. Capture the
required fields, then summarize the outcome and end the call politely."""


def _query(sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    """Real synchronous DB read against Neon (ground truth the agent verifies)."""
    if not DB_URL:
        return []
    with psycopg.connect(DB_URL, sslmode="require") as conn:
        with conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


class PayerOpsAgent(Agent):
    def __init__(self, recorder: CallRecorder) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._rec = recorder

    async def _record(self, tool: str, result: str, *, phi: bool, key: str | None = None) -> None:
        scope = f"member:***{key[-4:]}" if (phi and key) else ("handoff:packet" if phi else None)
        await asyncio.to_thread(self._rec.record_tool, tool, f"{tool} → {result[:80]}", phi, scope)

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
        await self._record("verify_claim", result, phi=True, key=claim_id)
        return result

    @function_tool()
    async def escalate(self, context: RunContext, reason: str) -> str:
        """Route to a human specialist when the call cannot be completed autonomously."""
        self._rec.escalated = True
        result = f"Escalation packet created and routed to clinical review ({reason})."
        await self._record("escalate", result, phi=True)
        return result


async def entrypoint(ctx: agents.JobContext) -> None:
    await ctx.connect()

    # Persist this voice call to the same Neon tables a text run uses. The room
    # name IS the runId (set by POST /api/voice/token).
    recorder = CallRecorder(DB_URL, ctx.room.name, os.environ.get("LOCAL_LLM_MODEL", "livekit+mlx"))
    await asyncio.to_thread(recorder.start)

    has_eleven = bool(os.environ.get("ELEVEN_API_KEY") or os.environ.get("ELEVENLABS_API_KEY"))

    session = AgentSession(
        # LLM points at the local OpenAI-compatible server (MLX). On-device.
        llm=openai.LLM(
            model=os.environ.get("LOCAL_LLM_MODEL", "mlx-community/Qwen2.5-7B-Instruct-4bit"),
            base_url=os.environ.get("LOCAL_LLM_BASE_URL", "http://127.0.0.1:8080/v1"),
            api_key=os.environ.get("LOCAL_LLM_API_KEY", "local"),
        ),
        # ElevenLabs handles both speech-to-text (Scribe v2 realtime) and TTS
        # from a single key; the LLM above stays on-device.
        stt=elevenlabs.STT(model="scribe_v2_realtime") if has_eleven else None,
        tts=(
            elevenlabs.TTS(**({"voice_id": os.environ["ELEVENLABS_VOICE_ID"]} if os.environ.get("ELEVENLABS_VOICE_ID") else {}))
            if has_eleven
            else None
        ),
        # VAD: AgentSession uses the bundled silero VAD by default (no plugin needed).
        # Forward word-aligned TTS transcripts so the cockpit shows synced captions.
        use_tts_aligned_transcript=True,
    )

    # Persist each conversation turn (audit chain) as it lands.
    @session.on("conversation_item_added")
    def _on_item(ev: Any) -> None:
        item = getattr(ev, "item", None)
        text = getattr(item, "text_content", None) or "" if item else ""
        if not text:
            return
        speaker = "agent" if getattr(item, "role", "") == "assistant" else "payer"
        asyncio.create_task(asyncio.to_thread(recorder.record_turn, speaker, text))

    async def _finalize() -> None:
        await asyncio.to_thread(recorder.finalize)

    ctx.add_shutdown_callback(_finalize)

    await session.start(agent=PayerOpsAgent(recorder), room=ctx.room)
    await session.generate_reply(
        instructions="Greet the payer representative and state the reason for the call."
    )


if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
