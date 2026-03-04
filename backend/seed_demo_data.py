from __future__ import annotations

from datetime import datetime, timezone

from db import get_conn, init_schema


DEMO_CUSTOMERS = [
    {"code": "CUST001", "name": "ABC Market Patision", "email": "orders@abc-market.gr"},
    {"code": "CUST002", "name": "Green Garden Center Marousi", "email": "purchasing@greengarden.gr"},
    {"code": "CUST003", "name": "Home Pots Cash & Carry Piraeus", "email": "sales@homepots.gr"},
]

MONTHLY_PLAN = {
    "CUST001": {
        2025: [(1, 860.0, 120), (2, 980.0, 132), (4, 1240.0, 164), (7, 1380.0, 177), (10, 1495.0, 198), (12, 1710.0, 226)],
        2026: [(1, 1180.0, 154), (2, 1360.0, 180), (3, 1490.0, 194)],
    },
    "CUST002": {
        2025: [(2, 720.0, 96), (3, 810.0, 110), (6, 890.0, 118), (9, 1140.0, 150), (11, 1320.0, 170)],
        2026: [(1, 940.0, 126), (2, 1015.0, 134), (3, 1090.0, 142)],
    },
    "CUST003": {
        2025: [(1, 650.0, 88), (5, 760.0, 101), (8, 910.0, 118), (12, 1040.0, 134)],
        2026: [(1, 980.0, 126), (2, 1125.0, 144), (3, 1210.0, 152)],
    },
}

RECEIVABLES_PLAN = {
    "CUST001": [
        ("INV-25011", "2026-01-12T09:00:00+00:00", "2026-02-11T09:00:00+00:00", 1280.00, 780.00, "partial"),
        ("INV-25042", "2026-02-08T09:00:00+00:00", "2026-03-10T09:00:00+00:00", 940.00, 0.00, "open"),
    ],
    "CUST002": [
        ("INV-26008", "2026-01-18T09:00:00+00:00", "2026-02-17T09:00:00+00:00", 880.00, 880.00, "paid"),
        ("INV-26033", "2026-02-22T09:00:00+00:00", "2026-03-24T09:00:00+00:00", 1115.00, 400.00, "partial"),
    ],
    "CUST003": [
        ("INV-27005", "2026-01-09T09:00:00+00:00", "2026-02-08T09:00:00+00:00", 760.00, 0.00, "open"),
        ("INV-27021", "2026-02-14T09:00:00+00:00", "2026-03-16T09:00:00+00:00", 995.00, 250.00, "partial"),
    ],
}


def load_seed_products(cur):
    preferred_codes = [
        "100-01",
        "101-14",
        "101-58",
        "102-50",
        "102-199",
        "103-58",
        "104-01",
        "105-58",
    ]

    rows = cur.execute(
        """
        SELECT id, code, description, pieces_per_package
        FROM products
        WHERE code IN (?, ?, ?, ?, ?, ?, ?, ?)
        ORDER BY code
        """,
        preferred_codes,
    ).fetchall()

    if rows:
        return rows

    return cur.execute(
        """
        SELECT id, code, description, pieces_per_package
        FROM products
        ORDER BY code
        LIMIT 8
        """
    ).fetchall()


def build_order_date(year: int, month: int, day: int) -> str:
    return datetime(year, month, day, 9, 0, tzinfo=timezone.utc).isoformat()


def split_line_amounts(total_value: float, qty_total: int, product_count: int):
    base_qty = max(1, qty_total // product_count)
    qty_values = [base_qty for _ in range(product_count)]
    qty_values[-1] += max(0, qty_total - sum(qty_values))

    weights = [1 + index * 0.18 for index in range(product_count)]
    weight_sum = sum(weights)
    values = [round(total_value * weight / weight_sum, 2) for weight in weights]
    values[-1] = round(total_value - sum(values[:-1]), 2)

    return list(zip(qty_values, values))


def main() -> None:
    init_schema()
    conn = get_conn()
    cur = conn.cursor()

    products = load_seed_products(cur)
    if len(products) < 4:
        conn.close()
        raise RuntimeError("Not enough products found to generate demo orders.")

    demo_codes = [customer["code"] for customer in DEMO_CUSTOMERS]
    placeholders = ", ".join("?" for _ in demo_codes)

    existing_demo_orders = cur.execute(
        f"SELECT id FROM orders WHERE customer_code IN ({placeholders})",
        demo_codes,
    ).fetchall()
    if existing_demo_orders:
        order_ids = [row["id"] for row in existing_demo_orders]
        order_placeholders = ", ".join("?" for _ in order_ids)
        cur.execute(f"DELETE FROM order_lines WHERE order_id IN ({order_placeholders})", order_ids)
        cur.execute(f"DELETE FROM orders WHERE id IN ({order_placeholders})", order_ids)

    cur.execute(f"DELETE FROM customer_receivables WHERE customer_code IN ({placeholders})", demo_codes)

    cur.executemany(
        """
        INSERT INTO customers(code, name, email, source)
        VALUES (?, ?, ?, 'demo')
        ON CONFLICT(code) DO UPDATE SET
          name = excluded.name,
          email = excluded.email,
          source = excluded.source
        """,
        [(customer["code"], customer["name"], customer["email"]) for customer in DEMO_CUSTOMERS],
    )

    created_orders = 0
    created_lines = 0
    product_count = min(4, len(products))

    for customer_index, customer in enumerate(DEMO_CUSTOMERS):
        plan = MONTHLY_PLAN[customer["code"]]
        for year in sorted(plan):
            for month_index, (month, order_value, qty_total) in enumerate(plan[year]):
                created_at = build_order_date(year, month, 5 + ((customer_index + month_index) % 18))
                notes = f"Demo order for {customer['name']} {year}-{month:02d}"
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
                        customer["name"],
                        customer["email"],
                        customer["code"],
                        notes,
                        qty_total,
                        round(order_value, 2),
                        created_at,
                    ),
                )
                order_id = cur.lastrowid
                created_orders += 1

                rotated_products = [products[(customer_index + month_index + idx) % len(products)] for idx in range(product_count)]
                for line_index, (product, line_data) in enumerate(zip(rotated_products, split_line_amounts(order_value, qty_total, product_count))):
                    qty_pieces, line_value = line_data
                    unit_price = round(line_value / qty_pieces, 2) if qty_pieces else 0.0
                    discount_pct = float(((customer_index + month_index + line_index) % 3) * 5)
                    cur.execute(
                        """
                        INSERT INTO order_lines(
                            order_id,
                            product_id,
                            qty_pieces,
                            unit_price,
                            discount_pct,
                            line_net_value
                        )
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (order_id, product["id"], qty_pieces, unit_price, discount_pct, round(line_value, 2)),
                    )
                    created_lines += 1

    receivable_rows = []
    for customer in DEMO_CUSTOMERS:
        for document_no, document_date, due_date, amount_total, amount_paid, status in RECEIVABLES_PLAN[customer["code"]]:
            open_balance = round(amount_total - amount_paid, 2)
            receivable_rows.append(
                (
                    customer["code"],
                    document_no,
                    document_date,
                    due_date,
                    amount_total,
                    amount_paid,
                    open_balance,
                    status,
                )
            )

    cur.executemany(
        """
        INSERT INTO customer_receivables(
            customer_code,
            document_no,
            document_date,
            due_date,
            amount_total,
            amount_paid,
            open_balance,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        receivable_rows,
    )

    conn.commit()
    conn.close()

    print(
        f"Seeded {len(DEMO_CUSTOMERS)} customers, {created_orders} orders, "
        f"{created_lines} order lines, {len(receivable_rows)} receivable rows."
    )


if __name__ == "__main__":
    main()
