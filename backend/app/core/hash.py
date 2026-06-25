"""
Hashing primitives.

The audit ledger's tamper-evident chain uses **real SHA-256** (`digest_hex` /
`chain_hash`). The frontend recomputes the same chain with a standard SHA-256, so
the hashes are byte-identical across languages and `verify_ledger` works on both
sides. Parity is asserted in `tests/test_hash.py` against the canonical
SHA-256("abc") vector.

`cyrb53` (and the seeded float) remain a fast, non-cryptographic hash used ONLY
for deterministic demo data (the offline provider's latency/canned replies) — not
for the audit chain.
"""
from __future__ import annotations

import hashlib

GENESIS_HASH = "0" * 64


def digest_hex(input_str: str) -> str:
    """SHA-256 hex digest of a UTF-8 string (64 hex chars)."""
    return hashlib.sha256(input_str.encode("utf-8")).hexdigest()


def chain_hash(prev_hash: str, payload: str) -> str:
    """Chain a new payload onto a previous hash — a tamper-evident log link."""
    return digest_hex(f"{prev_hash}|{payload}")


# --- non-cryptographic helper for deterministic demo data only ---------------

_MASK32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    product = ((a & _MASK32) * (b & _MASK32)) & _MASK32
    return product - 0x100000000 if product & 0x80000000 else product


def _ushr(x: int, n: int) -> int:
    return (x & _MASK32) >> n


def cyrb53(s: str, seed: int = 0) -> int:
    """cyrb53 — fast 53-bit string hash (NOT cryptographic; demo seeding only)."""
    h1 = 0xDEADBEEF ^ seed
    h2 = 0x41C6CE57 ^ seed
    for ch in s:
        code = ord(ch)
        h1 = _imul(h1 ^ code, 2654435761)
        h2 = _imul(h2 ^ code, 1597334677)
    h1 = _imul(h1 ^ _ushr(h1, 16), 2246822507)
    h1 ^= _imul(h2 ^ _ushr(h2, 13), 3266489909)
    h2 = _imul(h2 ^ _ushr(h2, 16), 2246822507)
    h2 ^= _imul(h1 ^ _ushr(h1, 13), 3266489909)
    return 4294967296 * (2097151 & (h2 & _MASK32)) + _ushr(h1, 0)
