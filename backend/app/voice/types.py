"""Voice + telephony contracts, ported from `src/lib/voice/types.ts`."""
from __future__ import annotations

from typing import Literal

from app.config import settings
from app.schemas import CamelModel

TelephonyVendor = Literal["livekit", "twilio"]
VoiceRuntimeId = Literal["livekit", "vercel"]


class VoiceProviderStatus(CamelModel):
    id: str
    label: str
    configured: bool
    capabilities: list[Literal["tts", "stt"]]
    missing_env: list[str]
    detail: str


class TelephonyStatus(CamelModel):
    id: str
    label: str
    vendor: TelephonyVendor
    configured: bool
    missing_env: list[str]
    demo_mode: bool
    detail: str


class VoiceRuntimeStatus(CamelModel):
    id: VoiceRuntimeId
    label: str
    configured: bool
    missing_env: list[str]
    detail: str
    default: bool = False


class PlaceCallRequest(CamelModel):
    to_number: str
    from_number: str | None = None
    scenario_id: str | None = None
    metadata: dict[str, str] | None = None


class PlaceCallResult(CamelModel):
    ok: bool
    demo: bool
    call_id: str | None = None
    detail: str


def is_demo_mode() -> bool:
    """Global demo kill-switch. Defaults to ON unless explicitly disabled."""
    return settings.demo_mode
