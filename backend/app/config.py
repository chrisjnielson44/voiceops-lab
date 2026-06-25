"""
Environment-driven configuration. Mirrors the variables the Next.js app already
reads from `.env.local` so the two services can share one database and one local
model server. Auth lives in Next.js; this service only trusts an upstream-set
user header (see `routers/_deps.py`).
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", ".env.local"), extra="ignore")

    # --- Database (Neon Postgres). Prefer the UNPOOLED/direct URL. ----------
    database_url_unpooled: str | None = None
    postgres_url_non_pooling: str | None = None
    database_url: str | None = None
    postgres_url: str | None = None

    # --- Local model (real agent runtime) -----------------------------------
    local_llm_base_url: str = "http://127.0.0.1:8080/v1"
    local_llm_model: str = "mlx-community/Qwen2.5-7B-Instruct-4bit"
    local_llm_api_key: str = "local"

    # --- Optional hosted routing --------------------------------------------
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_site_url: str = "https://voiceops-lab.local"
    openrouter_app_name: str = "VoiceOps Lab"

    # --- Local MLX provider (separate from agent runtime base url) ----------
    mlx_base_url: str | None = None
    mlx_api_key: str = "mlx-local"

    # --- Voice / telephony ---------------------------------------------------
    elevenlabs_api_key: str | None = None
    elevenlabs_voice_id: str | None = None
    # LiveKit (browser/WebRTC voice). The SPA gets a short-lived room token from
    # /api/voice/token; the agent worker joins the same room.
    livekit_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    # --- Runtime flags -------------------------------------------------------
    voiceops_demo_mode: str = "true"
    voiceops_prompt_version: str = "payer-ops-v4.0"

    # --- Service / auth boundary --------------------------------------------
    # Comma-separated CORS allowlist; the Next.js origin in dev.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Optional shared secret a trusted proxy must send (x-internal-token).
    backend_internal_token: str | None = None
    # Fallback user id when no authenticated user is forwarded.
    demo_user_id: str = "demo-user"

    # --- Session validation -------------------------------------------------
    # Better Auth host used to introspect the session cookie. When set, the
    # backend validates the caller's session instead of trusting a header.
    auth_server_url: str | None = None
    # When true, protected routes 401 without a valid session (production).
    # Default false keeps local/dev/tests and the preview bypass working.
    require_auth: bool = False

    # --- Observability ------------------------------------------------------
    app_env: str = "development"
    log_level: str = "INFO"
    log_json: bool = False  # set true in prod for structured JSON logs
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1

    def connection_string(self) -> str:
        cs = (
            self.database_url_unpooled
            or self.postgres_url_non_pooling
            or self.database_url
            or self.postgres_url
        )
        if not cs:
            raise RuntimeError(
                "No Postgres connection string set. Define DATABASE_URL_UNPOOLED "
                "(or DATABASE_URL) in backend/.env."
            )
        return cs

    @property
    def demo_mode(self) -> bool:
        return (self.voiceops_demo_mode or "true").lower() != "false"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
