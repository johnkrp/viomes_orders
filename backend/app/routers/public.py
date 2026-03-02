from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas import CatalogResponse, OrderCreated, OrderIn
from app.services.catalog import list_catalog
from app.services.orders import create_order


router = APIRouter(prefix="/api", tags=["public"])


@router.get("/health")
def health():
    return {"ok": True}


@router.get("/catalog", response_model=CatalogResponse)
def catalog(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=200),
    q: str | None = None,
):
    return list_catalog(page=page, page_size=page_size, query=q)


@router.post("/order", response_model=OrderCreated)
def order(payload: OrderIn):
    return create_order(payload)

