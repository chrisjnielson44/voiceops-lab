"""
Pure SHA-256 audit-chain helpers for the voice agent — byte-identical to the
backend (`app/core/hash.py` + `app/audit/ledger.py::audit_canonical`) and the
frontend (`web/src/lib/hash.ts`), so voice-call events verify with the same
`verify_ledger`. No third-party deps, so this is unit-testable on its own.
"""
from __future__ import annotations

import hashlib
from typing import Any

GENESIS_HASH = "0" * 64


def digest_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def chain_hash(prev_hash: str, payload: str) -> str:
    return digest_hex(f"{prev_hash}|{payload}")


def audit_canonical(e: dict[str, Any]) -> str:
    """Canonical pre-image — MUST match backend app/audit/ledger.py::audit_canonical."""
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
