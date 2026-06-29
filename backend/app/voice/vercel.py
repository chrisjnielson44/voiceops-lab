"""Vercel Voice runtime/status adapter."""
from __future__ import annotations

from app.config import settings
from app.voice.types import VoiceProviderStatus


class VercelVoiceProvider:
    id = "vercel"
    label = "Vercel Voice"

    def is_configured(self) -> bool:
        return bool((settings.vercel_oidc_token or "").strip() or (settings.ai_gateway_api_key or "").strip())

    def status(self) -> VoiceProviderStatus:
        configured = self.is_configured()
        missing = [] if configured else ["VERCEL_OIDC_TOKEN or AI_GATEWAY_API_KEY"]
        return VoiceProviderStatus(
            id=self.id,
            label=self.label,
            configured=configured,
            capabilities=["tts", "stt"],
            missing_env=missing,
            detail=(
                f"Configured for Vercel AI Gateway realtime voice ({settings.vercel_voice_model})."
                if configured
                else "Stub. Link a Vercel project and pull OIDC env, or set AI_GATEWAY_API_KEY."
            ),
        )


vercel_voice_provider = VercelVoiceProvider()
