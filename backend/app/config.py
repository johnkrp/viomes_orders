from __future__ import annotations

# Legacy FastAPI settings kept for reference only.
# The active production runtime is the Node app in site/server.js.

import os


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings:
    app_name = "VIOMES Order Form API"
    allow_origins = _split_csv(
        os.getenv(
            "ALLOW_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500,https://orders.viomes.gr",
        ),
    )
    session_cookie_name = os.getenv("SESSION_COOKIE_NAME", "viomes_admin_session")
    session_max_age_seconds = int(os.getenv("SESSION_MAX_AGE_SECONDS", "28800"))
    default_admin_username = os.getenv("ADMIN_USERNAME", "admin")
    default_admin_password = os.getenv("ADMIN_PASSWORD", "change-me-now")


settings = Settings()
