"""
LiveKit telephony adapter (SIP/WebRTC). Stub by design — reports configuration
status and HONORS THE DEMO KILL-SWITCH. Ported from `src/lib/voice/livekit.ts`.
"""
from __future__ import annotations

from app.config import settings
from app.voice.types import PlaceCallRequest, PlaceCallResult, TelephonyStatus, is_demo_mode

_REQUIRED = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]


def _missing() -> list[str]:
    values = {
        "LIVEKIT_URL": settings.livekit_url,
        "LIVEKIT_API_KEY": settings.livekit_api_key,
        "LIVEKIT_API_SECRET": settings.livekit_api_secret,
    }
    return [k for k in _REQUIRED if not (values[k] or "").strip()]


class LiveKitTelephony:
    id = "livekit"
    label = "LiveKit"
    vendor = "livekit"

    def is_configured(self) -> bool:
        return len(_missing()) == 0

    def status(self) -> TelephonyStatus:
        configured = self.is_configured()
        return TelephonyStatus(
            id=self.id,
            label=self.label,
            vendor=self.vendor,
            configured=configured,
            missing_env=_missing(),
            demo_mode=is_demo_mode(),
            detail="Credentials present. Outbound SIP dialing gated by demo kill-switch."
            if configured
            else "Provide LiveKit URL + API key/secret and a SIP trunk to enable dialing.",
        )

    async def place_call(self, req: PlaceCallRequest) -> PlaceCallResult:
        if is_demo_mode():
            return PlaceCallResult(
                ok=False,
                demo=True,
                detail=f"Demo mode: simulated LiveKit room created for {req.to_number}. No real call placed.",
            )
        if not self.is_configured():
            return PlaceCallResult(ok=False, demo=False, detail=f"LiveKit not configured: missing {', '.join(_missing())}")
        return PlaceCallResult(ok=False, demo=False, detail="Live dialing is intentionally not implemented in this demo build.")


livekit_telephony = LiveKitTelephony()
