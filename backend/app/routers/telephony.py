"""
Telephony endpoint, ported from the Next.js `/api/telephony` route. ALWAYS honors
the demo kill-switch: with VOICEOPS_DEMO_MODE on (the default), this returns a
simulated result and never dials a real number.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.routers._deps import require_internal
from app.voice.livekit import livekit_telephony
from app.voice.twilio import twilio_telephony
from app.voice.types import PlaceCallRequest

router = APIRouter(prefix="/api", tags=["telephony"], dependencies=[Depends(require_internal)])


@router.post("/telephony")
async def telephony(request: Request):
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        body = {}

    provider = twilio_telephony if body.get("vendor") == "twilio" else livekit_telephony
    result = await provider.place_call(
        PlaceCallRequest(
            to_number=body.get("toNumber") if isinstance(body.get("toNumber"), str) else "",
            from_number=body.get("fromNumber") if isinstance(body.get("fromNumber"), str) else None,
            scenario_id=body.get("scenarioId") if isinstance(body.get("scenarioId"), str) else None,
        )
    )
    return {"vendor": provider.vendor, **result.to_wire()}
