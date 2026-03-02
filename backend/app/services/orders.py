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
    resolved_lines: list[tuple[int, int, str, int]] = []

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

        resolved_lines.append((product_id, line.qty, product_code, pieces_per_package))

    now = datetime.now(timezone.utc).isoformat()
    cur.execute(
        """
        INSERT INTO orders(customer_name, customer_email, customer_code, notes, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            payload.customer_name.strip(),
            str(payload.customer_email).strip() if payload.customer_email else None,
            (payload.customer_code or "").strip() or None,
            (payload.notes or "").strip(),
            now,
        ),
    )
    order_id = cur.lastrowid

    cur.executemany(
        """
        INSERT INTO order_lines(order_id, product_id, qty_pieces)
        VALUES (?, ?, ?)
        """,
        [(order_id, product_id, qty) for (product_id, qty, _, _) in resolved_lines],
    )

    conn.commit()
    conn.close()

    return {"ok": True, "order_id": order_id, "warnings": warnings}

