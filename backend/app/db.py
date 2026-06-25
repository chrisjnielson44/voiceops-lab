"""
Shared asyncpg pool (Neon). Uses the UNPOOLED/direct connection string — the
extended protocol / prepared statements that asyncpg relies on can break under
PgBouncer transaction pooling, exactly as noted in the original `src/lib/db/pool.ts`.

The pool is opened on app startup (see `app.main` lifespan) and exposed through
`query()` / `query_one()` helpers that return plain dicts.
"""
from __future__ import annotations

import ssl
from typing import Any

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


def _ssl_context() -> ssl.SSLContext:
    # Neon serves a valid cert; relax verification to avoid local CA hiccups,
    # mirroring `ssl: { rejectUnauthorized: false }` in the Node pool.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def connect() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            dsn=settings.connection_string(),
            min_size=1,
            max_size=5,
            ssl=_ssl_context(),
        )
    return _pool


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool is not initialized. Call connect() first.")
    return _pool


async def query(text: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    """Run a query and return rows as a list of dicts (parity with pg `.rows`)."""
    rows = await get_pool().fetch(text, *(params or []))
    return [dict(r) for r in rows]


async def query_one(text: str, params: list[Any] | None = None) -> dict[str, Any] | None:
    rows = await query(text, params)
    return rows[0] if rows else None
