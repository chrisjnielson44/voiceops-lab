"""
Deterministic, dependency-free hashing — an EXACT port of `src/lib/hash.ts`.

The audit ledger's tamper-evident chain uses these functions, and the Next.js
frontend re-verifies the chain client-side, so the digests this module produces
MUST be byte-identical to the TypeScript implementation. The parity is asserted
in `tests/test_hash.py` against values generated from the original TS logic.

NOTE: cyrb53 is NOT cryptographically secure. It is a demo stand-in for SHA-256
chosen so the chain stays dependency-free and reproducible across the JS UI and
this Python service.
"""
from __future__ import annotations

_MASK32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """Replicate JS `Math.imul`: 32-bit integer multiply, returning a SIGNED int32."""
    product = ((a & _MASK32) * (b & _MASK32)) & _MASK32
    return product - 0x100000000 if product & 0x80000000 else product


def _ushr(x: int, n: int) -> int:
    """Replicate JS `>>>`: logical right shift on the unsigned 32-bit value."""
    return (x & _MASK32) >> n


def cyrb53(s: str, seed: int = 0) -> int:
    """cyrb53 — fast 53-bit string hash. Returns a non-negative integer."""
    h1 = 0xDEADBEEF ^ seed
    h2 = 0x41C6CE57 ^ seed
    for ch in s:
        # charCodeAt returns the UTF-16 code unit; for BMP characters (all we use)
        # this equals ord(ch).
        code = ord(ch)
        h1 = _imul(h1 ^ code, 2654435761)
        h2 = _imul(h2 ^ code, 1597334677)
    h1 = _imul(h1 ^ _ushr(h1, 16), 2246822507)
    h1 ^= _imul(h2 ^ _ushr(h2, 13), 3266489909)
    h2 = _imul(h2 ^ _ushr(h2, 16), 2246822507)
    h2 ^= _imul(h1 ^ _ushr(h1, 13), 3266489909)
    return 4294967296 * (2097151 & (h2 & _MASK32)) + _ushr(h1, 0)


def _block(s: str, seed: int) -> str:
    return format(cyrb53(s, seed), "x").rjust(14, "0")[:16]


def digest_hex(input_str: str) -> str:
    """Produce a deterministic hex digest (SHA-256-shaped). Matches hash.ts exactly."""
    return (
        _block(input_str, 1)
        + _block(input_str, 2)
        + _block(input_str, 3)
        + _block(input_str, 4)
    )[:64]


def chain_hash(prev_hash: str, payload: str) -> str:
    """Chain a new payload onto a previous hash, like a tamper-evident log."""
    return digest_hex(f"{prev_hash}|{payload}")


GENESIS_HASH = "0" * 64
