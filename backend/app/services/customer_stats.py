from __future__ import annotations

from fastapi import HTTPException

from db import get_conn


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
          MAX(o.created_at) AS last_order_date
        FROM orders o
        LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.customer_code = ?
        """,
        (code,),
    ).fetchone()

    top_products = cur.execute(
        """
        SELECT
          p.code,
          p.description,
          SUM(ol.qty_pieces) AS qty,
          COUNT(DISTINCT o.id) AS orders
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.id
        JOIN products p ON p.id = ol.product_id
        WHERE o.customer_code = ?
        GROUP BY p.id, p.code, p.description
        ORDER BY qty DESC, p.code ASC
        LIMIT 10
        """,
        (code,),
    ).fetchall()

    recent_orders = cur.execute(
        """
        SELECT
          o.id AS order_id,
          o.created_at,
          COUNT(ol.id) AS total_lines,
          COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces
        FROM orders o
        LEFT JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.customer_code = ?
        GROUP BY o.id, o.created_at
        ORDER BY o.created_at DESC
        LIMIT 10
        """,
        (code,),
    ).fetchall()

    conn.close()

    return {
        "customer": {
            "code": customer["code"],
            "name": customer["name"],
            "email": customer["email"],
        },
        "summary": {
            "total_orders": summary["total_orders"] or 0,
            "total_pieces": summary["total_pieces"] or 0,
            "last_order_date": summary["last_order_date"],
        },
        "top_products": [
            {
                "code": row["code"],
                "description": row["description"],
                "qty": row["qty"] or 0,
                "orders": row["orders"] or 0,
            }
            for row in top_products
        ],
        "recent_orders": [
            {
                "order_id": row["order_id"],
                "created_at": row["created_at"],
                "total_lines": row["total_lines"] or 0,
                "total_pieces": row["total_pieces"] or 0,
            }
            for row in recent_orders
        ],
    }
