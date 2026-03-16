from __future__ import annotations

import hashlib
import hmac
import secrets


PBKDF2_ITERATIONS = 600_000


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, password_hash: str) -> bool:
    if not password_hash or "$" not in password_hash:
        return False

    salt, stored_digest = password_hash.split("$", 1)
    computed = hash_password(password, salt).split("$", 1)[1]
    return hmac.compare_digest(stored_digest, computed)


def new_session_token() -> str:
    return secrets.token_urlsafe(32)

