"""Alembic environment — async (asyncpg) against Neon, reusing app settings."""
from __future__ import annotations

import asyncio
import ssl
from logging.config import fileConfig
from urllib.parse import urlsplit, urlunsplit

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# No ORM models — migrations are explicit SQL — so no target_metadata.
target_metadata = None


def _async_url() -> str:
    """app connection string -> SQLAlchemy asyncpg URL (drop libpq query params)."""
    parts = urlsplit(settings.connection_string())
    scheme = "postgresql+asyncpg"
    return urlunsplit((scheme, parts.netloc, parts.path, "", ""))


def _ssl_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def _run_async() -> None:
    engine = create_async_engine(_async_url(), connect_args={"ssl": _ssl_context()})
    async with engine.connect() as connection:
        await connection.run_sync(_run_migrations)
    await engine.dispose()


def run_migrations_offline() -> None:
    context.configure(url=_async_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(_run_async())
