"""
Persists a LiveKit voice call to the same Neon tables a text run uses:
finalizes the `call_runs` row and appends hash-chained `call_events` (SHA-256),
so voice calls show up in Analytics (and carry a tamper-evident audit chain)
exactly like the in-app orchestrator's runs.

Writes are synchronous (psycopg) and serialized under a lock for stable chain
ordering; callers invoke them via `asyncio.to_thread` so the audio loop is never
blocked.
"""
from __future__ import annotations

import os
import threading
import time

import psycopg

from audit_chain import GENESIS_HASH, audit_canonical, chain_hash

PROMPT_VERSION = os.environ.get("VOICEOPS_PROMPT_VERSION", "payer-ops-v4.0")


class CallRecorder:
    def __init__(self, db_url: str | None, run_id: str, model: str) -> None:
        self.run_id = run_id
        self.model = model
        self.payer: str | None = None
        self.scenario_id: str | None = None
        self.escalated = False
        self._seq = 0
        self._prev = GENESIS_HASH
        self._t0 = time.time()
        self._lock = threading.Lock()
        self._conn = None
        if db_url:
            try:
                self._conn = psycopg.connect(db_url, sslmode="require", autocommit=True)
            except Exception:  # noqa: BLE001 - persistence is best-effort
                self._conn = None

    def _now_ms(self) -> int:
        return int((time.time() - self._t0) * 1000)

    def _persist(self, *, type: str, actor: str, summary: str, phi: bool, redaction: str,
                 tool: str | None = None, phi_scope: str | None = None, model: str | None = None) -> None:
        with self._lock:
            at_ms = self._now_ms()
            base = {
                "seq": self._seq, "type": type, "atMs": at_ms, "actor": actor, "summary": summary,
                "tool": tool, "phi": phi, "phiScope": phi_scope, "redaction": redaction,
                "model": model, "promptVersion": PROMPT_VERSION if model else None,
            }
            h = chain_hash(self._prev, audit_canonical(base))
            if self._conn:
                try:
                    self._conn.execute(
                        """INSERT INTO call_events(run_id,seq,type,at_ms,actor,summary,model,tool,phi,phi_scope,redaction,hash,prev_hash)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (self.run_id, self._seq, type, at_ms, actor, summary, model, tool, phi, phi_scope, redaction, h, self._prev),
                    )
                except Exception:  # noqa: BLE001
                    pass
            self._prev = h
            self._seq += 1

    def start(self) -> None:
        """Load scenario/payer from the run row (created by /api/voice/token) and open the chain."""
        if self._conn:
            try:
                row = self._conn.execute(
                    "SELECT scenario_id, payer FROM call_runs WHERE id=%s", (self.run_id,)
                ).fetchone()
                if row:
                    self.scenario_id, self.payer = row[0], row[1]
                self._conn.execute("UPDATE call_runs SET status='active' WHERE id=%s", (self.run_id,))
            except Exception:  # noqa: BLE001
                pass
        self._persist(type="call.session.open", actor="operator",
                      summary="Voice session opened (LiveKit + ElevenLabs, on-device LLM).",
                      phi=False, redaction="none")
        self._persist(type="call.start", actor="operator",
                      summary=f"Voice call started to {self.payer or 'payer'} provider services.",
                      phi=False, redaction="none", model=self.model)

    def record_turn(self, speaker: str, text: str) -> None:
        text = text or ""
        snippet = text[:72] + ("…" if len(text) > 72 else "")
        self._persist(type="model.invoke", actor=("agent" if speaker == "agent" else "payer"),
                      summary=f'{speaker} turn: "{snippet}"', phi=False, redaction="none",
                      model=self.model if speaker == "agent" else None)

    def record_tool(self, tool: str, summary: str, phi: bool, phi_scope: str | None = None) -> None:
        self._persist(type="tool.call", actor="agent", summary=summary, tool=tool, phi=phi,
                      phi_scope=phi_scope, redaction=("tokenized" if phi else "none"), model=self.model)
        if phi:
            self._persist(type="phi.access", actor="agent",
                          summary=f"PHI accessed via {tool} (minimum-necessary scope).",
                          phi=True, phi_scope=phi_scope, redaction="tokenized")

    def finalize(self) -> None:
        outcome = "escalated" if self.escalated else "completed"
        if self.escalated:
            self._persist(type="call.escalate", actor="system",
                          summary="Voice call escalated to a human specialist — hand-off packet queued.",
                          phi=True, phi_scope="handoff:packet", redaction="tokenized", model=self.model)
        else:
            self._persist(type="call.complete", actor="system",
                          summary="Voice call completed — record finalized.", phi=False, redaction="none", model=self.model)
        if self._conn:
            try:
                self._conn.execute(
                    "UPDATE call_runs SET status=%s, outcome=%s, ended_at=now() WHERE id=%s",
                    (outcome, outcome, self.run_id),
                )
                self._conn.close()
            except Exception:  # noqa: BLE001
                pass
