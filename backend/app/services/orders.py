from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from db import get_conn

from app.schemas import OrderIn


def create_order(payload: OrderIn) -> dict:
    if not payload.lines:
        raise HTTPException(status_code=400, detail="Η παραγγελία δεν έχει γραμμές.")

    conn = get_conn()
    cur = conn.cursor()

    warnings: list[str] = []
    resolved_lines: list[tuple[int, int, str, int, float, float, float]] = []
    total_qty_pieces = 0
    total_net_value = 0.0

    for line in payload.lines:
        code = (line.itemCode or "").strip()
        if not code:
            conn.close()
            raise HTTPException(status_code=400, detail="Κενός κωδικός σε γραμμή παραγγελίας.")

        row = cur.execute(
            """
            SELECT id, code, pieces_per_package
            FROM products
            WHERE code = ?
            """,
            (code,),
        ).fetchone()

        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail=f"Άγνωστος κωδικός προϊόντος: {code}")

        product_id = row["id"]
        product_code = row["code"]
        pieces_per_package = int(row["pieces_per_package"] or 1)

        if pieces_per_package > 0 and line.qty % pieces_per_package != 0:
            warnings.append(
                f"Το προϊόν {product_code} έχει {pieces_per_package} τεμ./συσκ. Ζητήθηκαν {line.qty} τεμ."
            )

        unit_price = 0.0
        discount_pct = 0.0
        line_net_value = float(line.qty) * unit_price * (1 - discount_pct / 100)
        total_qty_pieces += line.qty
        total_net_value += line_net_value
        resolved_lines.append(
            (product_id, line.qty, product_code, pieces_per_package, unit_price, discount_pct, line_net_value)
        )

    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        INSERT INTO orders(
            customer_name,
            customer_email,
            customer_code,
            notes,
            total_qty_pieces,
            total_net_value,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.customer_name.strip(),
            str(payload.customer_email).strip() if payload.customer_email else None,
            (payload.customer_code or "").strip() or None,
            (payload.notes or "").strip(),
            total_qty_pieces,
            total_net_value,
            now,
        ),
    )
    order_id = cur.lastrowid

    cur.executemany(
        """
        INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, discount_pct, line_net_value)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (order_id, product_id, qty, unit_price, discount_pct, line_net_value)
            for (product_id, qty, _, _, unit_price, discount_pct, line_net_value) in resolved_lines
        ],
    )

    conn.commit()
    conn.close()

    return {"ok": True, "order_id": order_id, "warnings": warnings}
