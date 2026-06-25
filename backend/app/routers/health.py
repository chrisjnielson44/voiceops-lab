"""Liveness + dependency health."""
from __future__ import annotations

from fastapi import APIRouter

from app.llm.local_llm import local_llm_health

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz():
    return {"ok": True, "service": "voiceops-backend"}


@router.get("/readyz")
async def readyz():
    llm = await local_llm_health()
    return {"ok": True, "localLLM": llm}
