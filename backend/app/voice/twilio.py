"""
Twilio telephony adapter (PSTN). Stub by design — same contract as LiveKit.
Honors the demo kill-switch. Ported from `src/lib/voice/twilio.ts`.
"""
from __future__ import annotations

from app.config import settings
from app.voice.types import PlaceCallRequest, PlaceCallResult, TelephonyStatus, is_demo_mode

_REQUIRED = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]


def _missing() -> list[str]:
    values = {
        "TWILIO_ACCOUNT_SID": settings.twilio_account_sid,
        "TWILIO_AUTH_TOKEN": settings.twilio_auth_token,
        "TWILIO_FROM_NUMBER": settings.twilio_from_number,
    }
    return [k for k in _REQUIRED if not (values[k] or "").strip()]


class TwilioTelephony:
    id = "twilio"
    label = "Twilio"
    vendor = "twilio"

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
            detail="Credentials present. Outbound PSTN dialing gated by demo kill-switch."
            if configured
            else "Provide Twilio SID, auth token, and a verified from-number to enable dialing.",
        )

    async def place_call(self, req: PlaceCallRequest) -> PlaceCallResult:
        if is_demo_mode():
            frm = req.from_number or settings.twilio_from_number or "(from)"
            return PlaceCallResult(
                ok=False,
                demo=True,
                detail=f"Demo mode: simulated Twilio call to {req.to_number} from {frm}. No real call placed.",
            )
        if not self.is_configured():
            return PlaceCallResult(ok=False, demo=False, detail=f"Twilio not configured: missing {', '.join(_missing())}")
        return PlaceCallResult(ok=False, demo=False, detail="Live dialing is intentionally not implemented in this demo build.")


twilio_telephony = TwilioTelephony()
