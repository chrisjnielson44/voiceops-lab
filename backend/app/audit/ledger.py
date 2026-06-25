"""
Audit hash-chain helpers, ported from `src/lib/audit/ledger.ts`.

`audit_canonical` MUST match the TS field order and join exactly — it is the
pre-image of every chained hash, and the frontend recomputes the same string to
verify the ledger. The live chaining itself happens incrementally in the
orchestrator (mirroring `pushAudit`); here we keep the canonical encoder plus a
`verify_ledger` used by tests and any export path.

(The deterministic `buildLedger`/`revealedTurns` path from the TS file is
frontend-only demo code and is intentionally not ported.)
"""
from __future__ import annotations

from typing import Any

from app.core.hash import GENESIS_HASH, chain_hash


def audit_canonical(e: dict[str, Any]) -> str:
    """Canonical pre-image string for the hash chain. Excludes wall-clock display."""
    return "|".join(
        [
            str(e["seq"]),
            str(e["type"]),
            str(e["atMs"]),
            str(e["actor"]),
            str(e["summary"]),
            str(e.get("tool") or ""),
            "1" if e.get("phi") else "0",
            str(e.get("phiScope") or ""),
            str(e["redaction"]),
            str(e.get("model") or ""),
            str(e.get("promptVersion") or ""),
        ]
    )


def verify_ledger(events: list[dict[str, Any]]) -> bool:
    """Recompute the chain to confirm nothing was tampered with."""
    prev_hash = GENESIS_HASH
    for e in events:
        expected = chain_hash(prev_hash, audit_canonical(e))
        if expected != e.get("hash") or e.get("prevHash") != prev_hash:
            return False
        prev_hash = e["hash"]
    return True
