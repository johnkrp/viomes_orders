from __future__ import annotations

from fastapi import Cookie, HTTPException, status

from app.config import settings
from app.services.auth import get_admin_by_session_token


def get_current_admin(
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
):
    admin = get_admin_by_session_token(session_token)
    if not admin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return admin

