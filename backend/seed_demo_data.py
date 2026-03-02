from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from db import get_conn, init_schema


DEMO_CUSTOMERS = [
    {"code": "CUST001", "name": "ABC Market", "email": "orders@abc-market.gr"},
    {"code": "CUST002", "name": "Green Garden Center", "email": "purchasing@greengarden.gr"},
    {"code": "CUST003", "name": "Home Pots Cash & Carry", "email": "sales@homepots.gr"},
]


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

    randomizer = random.Random(42)
    now = datetime.now(timezone.utc)
    created_orders = 0
    created_lines = 0

    for customer_index, customer in enumerate(DEMO_CUSTOMERS):
        for order_offset in range(6):
            created_at = now - timedelta(days=(customer_index * 9) + (order_offset * 21) + 2)
            notes = f"Demo order #{order_offset + 1} for {customer['name']}"
            cur.execute(
                """
                INSERT INTO orders(customer_name, customer_email, customer_code, notes, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    customer["name"],
                    customer["email"],
                    customer["code"],
                    notes,
                    created_at.isoformat(),
                ),
            )
            order_id = cur.lastrowid
            created_orders += 1

            product_count = 3 + (order_offset % 2)
            selected_products = randomizer.sample(products, k=product_count)

            for line_index, product in enumerate(selected_products):
                pack_size = int(product["pieces_per_package"] or 1)
                multiplier = 1 + ((customer_index + order_offset + line_index) % 5)
                qty_pieces = pack_size * multiplier
                cur.execute(
                    """
                    INSERT INTO order_lines(order_id, product_id, qty_pieces)
                    VALUES (?, ?, ?)
                    """,
                    (order_id, product["id"], qty_pieces),
                )
                created_lines += 1

    conn.commit()
    conn.close()

    print(f"Seeded {len(DEMO_CUSTOMERS)} customers, {created_orders} orders, {created_lines} order lines.")


if __name__ == "__main__":
    main()
