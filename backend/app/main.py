"""
VoiceOps Lab backend — FastAPI application.

Mounts the ported API under `/api/*` (matching the Next.js routes the cockpit
already calls, minus auth), opens the asyncpg pool on startup, and exposes
OpenAPI docs at `/docs`.
"""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import settings
from app.core.logging import configure_logging, request_id_ctx
from app.routers import agent, analytics, health, providers, scenarios, telephony

configure_logging(level=settings.log_level, as_json=settings.log_json)
log = logging.getLogger("voiceops")

# Optional error monitoring — no-op unless SENTRY_DSN is set (and sentry-sdk
# installed). Safe in dev/tests where neither is present.
if settings.sentry_dsn:
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.app_env,
            traces_sample_rate=settings.sentry_traces_sample_rate,
        )
        log.info("Sentry initialized")
    except Exception as e:  # noqa: BLE001
        log.warning("Sentry not initialized: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Best-effort DB connect: the service still boots (provider/telephony/scenario
    # endpoints work) if the database is unreachable; data-backed routes degrade.
    try:
        await db.connect()
        log.info("Connected to Postgres pool.")
    except Exception as e:  # noqa: BLE001
        log.warning("Database pool not initialized: %s", e)
    try:
        yield
    finally:
        await db.disconnect()


app = FastAPI(
    title="VoiceOps Lab API",
    version="0.1.0",
    description="Real local-model healthcare voice-agent operations runtime.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Attach a request id (honoring an upstream X-Request-ID) and log latency."""
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    token = request_id_ctx.set(rid)
    started = time.time()
    try:
        response = await call_next(request)
    finally:
        request_id_ctx.reset(token)
    response.headers["x-request-id"] = rid
    log.info(
        "%s %s -> %s (%dms)",
        request.method,
        request.url.path,
        response.status_code,
        round((time.time() - started) * 1000),
    )
    return response

app.include_router(health.router)
app.include_router(agent.router)
app.include_router(analytics.router)
app.include_router(providers.router)
app.include_router(telephony.router)
app.include_router(scenarios.router)


@app.get("/", tags=["health"])
async def root():
    return {"service": "voiceops-backend", "docs": "/docs"}
