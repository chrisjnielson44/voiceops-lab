"""
Auth boundary. The browser authenticates against the standalone Better Auth host
(auth-server). For protected routes, this backend VALIDATES the caller's session
by introspecting the forwarded session cookie against that host's
`/api/auth/get-session` — it does NOT blindly trust a client-supplied header.

Behavior:
- If `AUTH_SERVER_URL` is set and the request carries a valid session cookie, the
  authenticated user id is used (and attributed to persisted runs).
- If no valid session and `REQUIRE_AUTH=true` (production), the route 401s.
- Otherwise (local/dev/tests, preview bypass) it falls back to an optional
  `x-voiceops-user` hint or the demo user id.
"""
from __future__ import annotations

import httpx
from fastapi import Header, HTTPException, Request

from app.config import settings


async def require_internal(x_internal_token: str | None = Header(default=None)) -> None:
    """Optional shared-secret gate. No-op unless BACKEND_INTERNAL_TOKEN is set."""
    expected = settings.backend_internal_token
    if expected and x_internal_token != expected:
        raise HTTPException(status_code=401, detail="invalid internal token")


async def _session_user(request: Request) -> dict | None:
    """Introspect the forwarded session cookie via the Better Auth host."""
    cookie = request.headers.get("cookie")
    if not settings.auth_server_url or not cookie:
        return None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            res = await client.get(
                f"{settings.auth_server_url.rstrip('/')}/api/auth/get-session",
                headers={"cookie": cookie},
            )
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, dict) and data.get("user"):
                return data["user"]
    except Exception:  # noqa: BLE001 - auth host unreachable -> treat as unauthenticated
        return None
    return None


async def require_user(
    request: Request,
    x_voiceops_user: str | None = Header(default=None),
) -> str:
    """Return the authenticated user id, enforcing auth when configured."""
    user = await _session_user(request)
    if user and user.get("id"):
        return str(user["id"])
    if settings.require_auth:
        raise HTTPException(status_code=401, detail="authentication required")
    # Dev/test/preview fallback.
    return (x_voiceops_user or "").strip() or settings.demo_user_id


async def require_admin(request: Request) -> str:
    """Like `require_user`, but the session user's role must be `admin`. Falls
    back to the demo user in dev/test (when REQUIRE_AUTH is off) so local tooling
    keeps working; 403s in production for non-admins."""
    user = await _session_user(request)
    if user and user.get("role") == "admin" and user.get("id"):
        return str(user["id"])
    if settings.require_auth:
        if user and user.get("id"):
            raise HTTPException(status_code=403, detail="admin access required")
        raise HTTPException(status_code=401, detail="authentication required")
    return settings.demo_user_id
