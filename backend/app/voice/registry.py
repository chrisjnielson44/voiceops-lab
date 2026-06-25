"""Voice/telephony registries, ported from `src/lib/voice/index.ts`."""
from __future__ import annotations

from app.voice.elevenlabs import elevenlabs_provider
from app.voice.livekit import livekit_telephony
from app.voice.twilio import twilio_telephony

voice_providers = [elevenlabs_provider]
telephony_providers = [livekit_telephony, twilio_telephony]


def get_voice_statuses():
    return [p.status() for p in voice_providers]


def get_telephony_statuses():
    return [p.status() for p in telephony_providers]
