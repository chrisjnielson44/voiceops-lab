"""ElevenLabs voice adapter (status only here), ported from `src/lib/voice/elevenlabs.ts`."""
from __future__ import annotations

from app.config import settings
from app.voice.types import VoiceProviderStatus


class ElevenLabsProvider:
    id = "elevenlabs"
    label = "ElevenLabs"

    def is_configured(self) -> bool:
        return bool((settings.elevenlabs_api_key or "").strip())

    def status(self) -> VoiceProviderStatus:
        configured = self.is_configured()
        missing: list[str] = []
        if not (settings.elevenlabs_api_key or "").strip():
            missing.append("ELEVENLABS_API_KEY")
        if not settings.elevenlabs_voice_id:
            missing.append("ELEVENLABS_VOICE_ID")
        return VoiceProviderStatus(
            id=self.id,
            label=self.label,
            configured=configured,
            capabilities=["tts", "stt"],
            missing_env=missing,
            detail="Live. Real-time TTS/STT available for agent + caller audio."
            if configured
            else "Stub. Set ELEVENLABS_API_KEY (+ voice id) to enable real audio.",
        )


elevenlabs_provider = ElevenLabsProvider()
