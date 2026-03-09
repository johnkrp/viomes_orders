from __future__ import annotations

# Legacy FastAPI admin routes kept for reference only.
# The active production runtime is the Node app in site/server.js.

from fastapi import APIRouter, Depends

from app.dependencies import get_current_admin
from app.schemas import CustomerStatsResponse
from app.services.customer_stats import get_customer_stats_by_code


router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/customers/{customer_code}/stats", response_model=CustomerStatsResponse)
def customer_stats(customer_code: str, admin=Depends(get_current_admin)):
    return get_customer_stats_by_code(customer_code)
