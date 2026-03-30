import argparse
import json
from pathlib import Path

import pandas as pd


COLUMN_MAP = {
    "code": "Κωδ.Είδους",
    "description": "Περιγραφή",
    "color": "Χρώμα",
    "pieces_per_package": "Υποσυσκευασία",
    "volume_liters": "Όγκος",
    "image_url": "URL",
}


def norm(value: str) -> str:
    return str(value).strip().lower()


def pick_col(columns, candidates):
    normalized = {norm(col): col for col in columns}
    for candidate in candidates:
        key = norm(candidate)
        if key in normalized:
            return normalized[key]
    return None


def to_int(value, default=0):
    try:
        if pd.isna(value):
            return default
        return int(float(str(value).replace(",", ".")))
    except Exception:
        return default


def to_float(value, default=0.0):
    try:
        if pd.isna(value):
            return default
        return float(str(value).replace(",", "."))
    except Exception:
        return default


def resolve_columns(df):
    if COLUMN_MAP:
        return {
            "code": COLUMN_MAP.get("code"),
            "description": COLUMN_MAP.get("description"),
            "color": COLUMN_MAP.get("color"),
            "pieces_per_package": COLUMN_MAP.get("pieces_per_package"),
            "volume_liters": COLUMN_MAP.get("volume_liters"),
            "image_url": COLUMN_MAP.get("image_url"),
        }

    return {
        "code": pick_col(df.columns, ["code", "ΚΩΔ", "ΚΩΔΙΚΟΣ", "κωδ", "κωδικός"]),
        "description": pick_col(df.columns, ["description", "ΠΕΡΙΓΡΑΦΗ", "περιγραφή", "Περιγραφή"]),
        "color": pick_col(df.columns, ["color", "ΧΡΩΜΑ", "χρώμα"]),
        "pieces_per_package": pick_col(
            df.columns,
            [
                "pieces_per_package",
                "ΤΕΜ/ΣΥΣΚ",
                "ΤΕΜ_ΑΝΑ_ΣΥΣΚ",
                "τεμ/συσκ",
                "τεμ ανα συσκ",
            ],
        ),
        "volume_liters": pick_col(
            df.columns,
            ["volume_liters", "ΟΓΚΟΣ", "ΟΓΚΟΣ_L", "VOLUME_LITERS", "όγκος", "όγκος l"],
        ),
        "image_url": pick_col(df.columns, ["image_url", "IMAGE", "IMAGE_URL", "ΕΙΚΟΝΑ", "εικόνα"]),
    }


def build_items(df, columns):
    code_col = columns["code"]
    desc_col = columns["description"]

    if not code_col or not desc_col:
        raise ValueError(
            f"Required columns code/description were not found. Headers: {list(df.columns)}"
        )

    color_col = columns["color"]
    ppp_col = columns["pieces_per_package"]
    vol_col = columns["volume_liters"]
    img_col = columns["image_url"]

    items = []
    next_id = 1

    for _, row in df.iterrows():
        code = str(row.get(code_col, "")).strip()
        if not code or code.lower() == "nan":
            continue

        item = {
            "id": next_id,
            "code": code,
            "description": str(row.get(desc_col, "")).strip(),
            "image_url": str(row.get(img_col, "")).strip() if img_col else "",
            "pieces_per_package": to_int(row.get(ppp_col, 1)) if ppp_col else 1,
            "volume_liters": to_float(row.get(vol_col, 0.0)) if vol_col else 0.0,
            "color": str(row.get(color_col, "")).strip() if color_col else "",
        }

        if item["pieces_per_package"] <= 0:
            item["pieces_per_package"] = 1

        items.append(item)
        next_id += 1

    return items


def main():
    script_dir = Path(__file__).resolve().parent
    default_input = script_dir.parent.parent / "backend" / "archive" / "legacy-inputs" / "products.xlsx"
    default_output = script_dir.parent / "public" / "catalog.json"

    parser = argparse.ArgumentParser(description="Generate catalog.json from products.xlsx")
    parser.add_argument("--input", type=Path, default=default_input, help="Path to products.xlsx")
    parser.add_argument("--output", type=Path, default=default_output, help="Path to output catalog.json")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and print stats without writing the output file",
    )
    args = parser.parse_args()

    input_path = args.input.resolve()
    output_path = args.output.resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"Input XLSX not found: {input_path}")

    df = pd.read_excel(input_path)
    columns = resolve_columns(df)

    print("Detected columns:")
    print(" code:", columns["code"])
    print(" desc:", columns["description"])
    print(" color:", columns["color"])
    print(" ppp:", columns["pieces_per_package"])
    print(" vol:", columns["volume_liters"])
    print(" img:", columns["image_url"])

    items = build_items(df, columns)
    payload = {"items": items}

    print(f"Built {len(items)} products from {input_path}")
    print("Preview first 2 items:", items[:2])

    if args.dry_run:
        print("Dry run complete. Output file was not written.")
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)

    print(f"Wrote catalog JSON to: {output_path}")


if __name__ == "__main__":
    main()
