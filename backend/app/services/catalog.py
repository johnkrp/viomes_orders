from __future__ import annotations

import unicodedata
from math import ceil

from db import get_conn


def norm_gr(value: str | None) -> str:
    text = (value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn")


def row_to_catalog_item(row) -> dict:
    return {
        "id": row["id"],
        "code": row["code"],
        "description": row["description"],
        "image_url": row["image_url"],
        "pieces_per_package": row["pieces_per_package"],
        "volume_liters": row["volume_liters"],
        "color": row["color"],
    }


def list_catalog(page: int, page_size: int, query: str | None) -> dict:
    offset = (page - 1) * page_size
    normalized_query = norm_gr(query)

    conn = get_conn()
    cur = conn.cursor()

    if normalized_query:
        needle = f"%{normalized_query}%"
        total = cur.execute(
            """
            SELECT COUNT(*) AS n
            FROM products
            WHERE code LIKE ? OR description_norm LIKE ? OR color_norm LIKE ?
            """,
            (needle, needle, needle),
        ).fetchone()["n"]

        rows = cur.execute(
            """
            SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
            FROM products
            WHERE code LIKE ? OR description_norm LIKE ? OR color_norm LIKE ?
            ORDER BY code
            LIMIT ? OFFSET ?
            """,
            (needle, needle, needle, page_size, offset),
        ).fetchall()
    else:
        total = cur.execute("SELECT COUNT(*) AS n FROM products").fetchone()["n"]
        rows = cur.execute(
            """
            SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
            FROM products
            ORDER BY code
            LIMIT ? OFFSET ?
            """,
            (page_size, offset),
        ).fetchall()

    conn.close()

    pages = int(ceil(total / page_size)) if total else 1
    return {
        "items": [row_to_catalog_item(row) for row in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": pages,
    }

