"""Simple shared-key authentication for the API.

All ``/api/v1/*`` endpoints require a matching ``X-API-Key`` header (the health
check stays public). This is a coarse, single-shared-secret gate suitable for a
local / small-team deployment behind localhost — not per-user auth. The key MUST
be configured (enforced at startup in ``main.lifespan``) so the API is never
silently left open.
"""

from fastapi import Header, HTTPException, status

from app.core.config import settings


async def require_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    """FastAPI dependency: reject requests without the correct ``X-API-Key``."""
    if not settings.APP_API_KEY:
        # Defensive: startup should have refused to boot without a key. Never
        # fall through to open access.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Sunucu yapılandırması: APP_API_KEY ayarlanmamış.",
        )
    if x_api_key != settings.APP_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Geçersiz veya eksik X-API-Key.",
        )
