from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class CatalogItem(BaseModel):
    id: int
    code: str
    description: str
    image_url: Optional[str] = ""
    pieces_per_package: int
    volume_liters: float
    color: str


class CatalogResponse(BaseModel):
    items: list[CatalogItem]
    page: int
    page_size: int
    total: int
    pages: int


class OrderLineIn(BaseModel):
    itemCode: str = Field(..., min_length=1)
    qty: int = Field(..., ge=1)


class OrderIn(BaseModel):
    customer_name: str = Field(..., min_length=1)
    customer_email: Optional[EmailStr] = None
    customer_code: Optional[str] = None
    notes: Optional[str] = ""
    token: Optional[str] = None
    lines: list[OrderLineIn]


class OrderCreated(BaseModel):
    ok: bool
    order_id: int
    warnings: list[str] = []


class LoginIn(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class AdminMeResponse(BaseModel):
    ok: bool
    username: Optional[str] = None
    authenticated: bool


class TopProductStat(BaseModel):
    code: str
    description: str
    qty: int
    orders: int
    revenue: float
    avg_unit_price: float


class RecentOrderStat(BaseModel):
    order_id: int
    created_at: str
    total_lines: int
    total_pieces: int
    total_net_value: float
    average_discount_pct: float


class OrderLineStat(BaseModel):
    code: str
    description: str
    qty: int
    unit_price: float
    discount_pct: float
    line_net_value: float


class DetailedOrderStat(BaseModel):
    order_id: int
    created_at: str
    notes: str
    total_lines: int
    total_pieces: int
    total_net_value: float
    average_discount_pct: float
    lines: list[OrderLineStat]


class CustomerSummary(BaseModel):
    total_orders: int
    total_pieces: int
    total_revenue: float
    revenue_3m: float
    revenue_6m: float
    revenue_12m: float
    average_order_value: float
    average_days_between_orders: Optional[float] = None
    days_since_last_order: Optional[int] = None
    last_order_date: Optional[str] = None


class CustomerInfo(BaseModel):
    code: str
    name: str
    email: Optional[str] = None


class CustomerStatsResponse(BaseModel):
    customer: CustomerInfo
    summary: CustomerSummary
    top_products_by_qty: list[TopProductStat]
    top_products_by_value: list[TopProductStat]
    recent_orders: list[RecentOrderStat]
    detailed_orders: list[DetailedOrderStat]
