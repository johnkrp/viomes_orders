from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from db import get_conn


def _safe_float(value) -> float:
    return round(float(value or 0), 2)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _product_payload(row) -> dict:
    return {
        "code": row["code"],
        "description": row["description"],
        "qty": row["qty"] or 0,
        "orders": row["orders"] or 0,
        "revenue": _safe_float(row["revenue"]),
        "avg_unit_price": _safe_float(row["avg_unit_price"]),
    }


def get_customer_stats_by_code(customer_code: str) -> dict:
    code = (customer_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Customer code is required.")

    conn = get_conn()
    cur = conn.cursor()

    customer = cur.execute(
        """
        SELECT code, name, email
        FROM customers
        WHERE code = ?
        """,
        (code,),
    ).fetchone()

    if not customer:
        conn.close()
        raise HTTPException(status_code=404, detail=f"Customer not found: {code}")

    summary = cur.execute(
        """
        SELECT
          COUNT(DISTINCT o.id) AS total_orders,
          COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
          COALESCE(SUM(ol.line_net_value), 0) AS total_revenue,
          MAX(o.created_at) AS last_order_date
        FROM orders o
        LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.customer_code = ?
        """,
        (code,),
    ).fetchone()

    top_products_by_qty = cur.execute(
        """
        SELECT
          p.code,
          p.description,
          SUM(ol.qty_pieces) AS qty,
          COUNT(DISTINCT o.id) AS orders,
          COALESCE(SUM(ol.line_net_value), 0) AS revenue,
          CASE
            WHEN SUM(ol.qty_pieces) > 0 THEN COALESCE(SUM(ol.line_net_value), 0) / SUM(ol.qty_pieces)
            ELSE 0
          END AS avg_unit_price
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.id
        JOIN products p ON p.id = ol.product_id
        WHERE o.customer_code = ?
        GROUP BY p.id, p.code, p.description
        ORDER BY qty DESC, revenue DESC, p.code ASC
        LIMIT 10
        """,
        (code,),
    ).fetchall()

    top_products_by_value = cur.execute(
        """
        SELECT
          p.code,
          p.description,
          SUM(ol.qty_pieces) AS qty,
          COUNT(DISTINCT o.id) AS orders,
          COALESCE(SUM(ol.line_net_value), 0) AS revenue,
          CASE
            WHEN SUM(ol.qty_pieces) > 0 THEN COALESCE(SUM(ol.line_net_value), 0) / SUM(ol.qty_pieces)
            ELSE 0
          END AS avg_unit_price
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.id
        JOIN products p ON p.id = ol.product_id
        WHERE o.customer_code = ?
        GROUP BY p.id, p.code, p.description
        ORDER BY revenue DESC, qty DESC, p.code ASC
        LIMIT 10
        """,
        (code,),
    ).fetchall()

    recent_orders = cur.execute(
        """
        SELECT
          o.id AS order_id,
          o.created_at,
          o.total_net_value,
          COUNT(ol.id) AS total_lines,
          COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
          COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
        FROM orders o
        LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.customer_code = ?
        GROUP BY o.id, o.created_at, o.total_net_value
        ORDER BY o.created_at DESC
        LIMIT 10
        """,
        (code,),
    ).fetchall()

    detailed_order_headers = cur.execute(
        """
        SELECT
          o.id AS order_id,
          o.created_at,
          o.notes,
          o.total_net_value,
          COUNT(ol.id) AS total_lines,
          COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
          COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
        FROM orders o
        LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.customer_code = ?
        GROUP BY o.id, o.created_at, o.notes, o.total_net_value
        ORDER BY o.created_at DESC
        LIMIT 6
        """,
        (code,),
    ).fetchall()

    detailed_orders = []
    for order_row in detailed_order_headers:
        lines = cur.execute(
            """
            SELECT
              p.code,
              p.description,
              ol.qty_pieces,
              ol.unit_price,
              ol.discount_pct,
              ol.line_net_value
            FROM order_lines ol
            JOIN products p ON p.id = ol.product_id
            WHERE ol.order_id = ?
            ORDER BY p.code ASC
            """,
            (order_row["order_id"],),
        ).fetchall()

        detailed_orders.append(
            {
                "order_id": order_row["order_id"],
                "created_at": order_row["created_at"],
                "notes": order_row["notes"] or "",
                "total_lines": order_row["total_lines"] or 0,
                "total_pieces": order_row["total_pieces"] or 0,
                "total_net_value": _safe_float(order_row["total_net_value"]),
                "average_discount_pct": _safe_float(order_row["average_discount_pct"]),
                "lines": [
                    {
                        "code": line["code"],
                        "description": line["description"],
                        "qty": line["qty_pieces"] or 0,
                        "unit_price": _safe_float(line["unit_price"]),
                        "discount_pct": _safe_float(line["discount_pct"]),
                        "line_net_value": _safe_float(line["line_net_value"]),
                    }
                    for line in lines
                ],
            }
        )

    conn.close()

    now = datetime.now(timezone.utc)
    last_order_dt = _parse_iso(summary["last_order_date"])
    days_since_last_order = None if last_order_dt is None else max(0, (now - last_order_dt).days)

    ordered_dates = [
        parsed
        for parsed in (
            _parse_iso(row["created_at"])
            for row in sorted(recent_orders, key=lambda row: row["created_at"])
        )
        if parsed is not None
    ]
    average_days_between_orders = None
    if len(ordered_dates) >= 2:
        gaps = []
        for previous, current in zip(ordered_dates, ordered_dates[1:]):
            gaps.append((current - previous).days)
        if gaps:
            average_days_between_orders = round(sum(gaps) / len(gaps), 1)

    def revenue_since(days: int) -> float:
        cutoff = now - timedelta(days=days)
        return _safe_float(
            sum(
                row["total_net_value"] or 0
                for row in recent_orders
                if (_parse_iso(row["created_at"]) or datetime.min.replace(tzinfo=timezone.utc)) >= cutoff
            )
        )

    total_orders = summary["total_orders"] or 0
    total_revenue = _safe_float(summary["total_revenue"])

    return {
        "customer": {
            "code": customer["code"],
            "name": customer["name"],
            "email": customer["email"],
        },
        "summary": {
            "total_orders": total_orders,
            "total_pieces": summary["total_pieces"] or 0,
            "total_revenue": total_revenue,
            "revenue_3m": revenue_since(90),
            "revenue_6m": revenue_since(180),
            "revenue_12m": revenue_since(365),
            "average_order_value": _safe_float(total_revenue / total_orders) if total_orders else 0.0,
            "average_days_between_orders": average_days_between_orders,
            "days_since_last_order": days_since_last_order,
            "last_order_date": summary["last_order_date"],
        },
        "top_products_by_qty": [_product_payload(row) for row in top_products_by_qty],
        "top_products_by_value": [_product_payload(row) for row in top_products_by_value],
        "recent_orders": [
            {
                "order_id": row["order_id"],
                "created_at": row["created_at"],
                "total_lines": row["total_lines"] or 0,
                "total_pieces": row["total_pieces"] or 0,
                "total_net_value": _safe_float(row["total_net_value"]),
                "average_discount_pct": _safe_float(row["average_discount_pct"]),
            }
            for row in recent_orders
        ],
        "detailed_orders": detailed_orders,
    }
