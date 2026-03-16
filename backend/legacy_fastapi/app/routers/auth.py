from __future__ import annotations

# Legacy FastAPI auth routes kept for reference only.
# The active production runtime is the Node app in site/server.js.

from fastapi import APIRouter, Cookie, Response, status

from app.config import settings
from app.schemas import AdminMeResponse, LoginIn
from app.services.auth import (
    authenticate_admin,
    create_admin_session,
    delete_admin_session,
    get_admin_by_session_token,
)


router = APIRouter(prefix="/api/admin", tags=["admin-auth"])


@router.post("/login", response_model=AdminMeResponse)
def login(payload: LoginIn, response: Response):
    admin = authenticate_admin(payload.username, payload.password)
    if not admin:
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"ok": False, "username": None, "authenticated": False}

    session_token = create_admin_session(admin["id"])
    response.set_cookie(
        key=settings.session_cookie_name,
        value=session_token,
        httponly=True,
        samesite="lax",
        max_age=settings.session_max_age_seconds,
    )
    return {"ok": True, "username": admin["username"], "authenticated": True}


@router.post("/logout")
def logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name),
):
    delete_admin_session(session_token)
    response.delete_cookie(settings.session_cookie_name)
    return {"ok": True}


@router.get("/me", response_model=AdminMeResponse)
def me(session_token: str | None = Cookie(default=None, alias=settings.session_cookie_name)):
    admin = get_admin_by_session_token(session_token)
    if not admin:
        return {"ok": True, "username": None, "authenticated": False}
    return {"ok": True, "username": admin["username"], "authenticated": True}
