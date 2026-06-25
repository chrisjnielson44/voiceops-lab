"""
VoiceOps Lab backend — FastAPI application.

Mounts the ported API under `/api/*` (matching the Next.js routes the cockpit
already calls, minus auth), opens the asyncpg pool on startup, and exposes
OpenAPI docs at `/docs`.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import settings
from app.routers import agent, analytics, health, providers, scenarios, telephony

log = logging.getLogger("voiceops")


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

app.include_router(health.router)
app.include_router(agent.router)
app.include_router(analytics.router)
app.include_router(providers.router)
app.include_router(telephony.router)
app.include_router(scenarios.router)


@app.get("/", tags=["health"])
async def root():
    return {"service": "voiceops-backend", "docs": "/docs"}
