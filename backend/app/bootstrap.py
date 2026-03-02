from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers.admin import router as admin_router
from app.routers.auth import router as auth_router
from app.routers.public import router as public_router
from app.services.auth import seed_default_admin
from db import init_schema


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    init_schema()
    seed_default_admin()

    app.include_router(public_router)
    app.include_router(auth_router)
    app.include_router(admin_router)
    return app


app = create_app()
