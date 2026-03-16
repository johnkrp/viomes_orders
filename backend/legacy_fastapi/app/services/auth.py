from __future__ import annotations

from datetime import datetime, timedelta, timezone

from db import get_conn

from app.config import settings
from app.security import hash_password, new_session_token, verify_password


def seed_default_admin() -> None:
    conn = get_conn()
    cur = conn.cursor()

    password_hash = hash_password(settings.default_admin_password)
    cur.execute(
        """
        INSERT INTO admin_users(username, password_hash, is_active)
        VALUES (?, ?, 1)
        ON CONFLICT(username) DO NOTHING
        """,
        (settings.default_admin_username, password_hash),
    )

    conn.commit()
    conn.close()


def authenticate_admin(username: str, password: str) -> dict | None:
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute(
        """
        SELECT id, username, password_hash, is_active
        FROM admin_users
        WHERE username = ?
        """,
        ((username or "").strip(),),
    ).fetchone()
    conn.close()

    if not row or not row["is_active"]:
        return None
    if not verify_password(password, row["password_hash"]):
        return None

    return {"id": row["id"], "username": row["username"]}


def create_admin_session(admin_id: int) -> str:
    token = new_session_token()
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=settings.session_max_age_seconds)).isoformat()

    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO admin_sessions(admin_user_id, token, expires_at)
        VALUES (?, ?, ?)
        """,
        (admin_id, token, expires_at),
    )
    conn.commit()
    conn.close()

    return token


def delete_admin_session(token: str | None) -> None:
    if not token:
        return

    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM admin_sessions WHERE token = ?", (token,))
    conn.commit()
    conn.close()


def get_admin_by_session_token(token: str | None) -> dict | None:
    if not token:
        return None

    now = datetime.now(timezone.utc).isoformat()
    conn = get_conn()
    cur = conn.cursor()
    row = cur.execute(
        """
        SELECT u.id, u.username
        FROM admin_sessions s
        JOIN admin_users u ON u.id = s.admin_user_id
        WHERE s.token = ?
          AND s.expires_at > ?
          AND u.is_active = 1
        """,
        (token, now),
    ).fetchone()
    conn.close()

    if not row:
        return None

    return {"id": row["id"], "username": row["username"]}

