import pandas as pd
from db import get_conn, init_schema
import unicodedata

EXCEL_PATH = "products.xlsx"

# Μπορείς να βάλεις ΟΠΟΙΑ ονόματα υπάρχουν στο Excel σου (και ελληνικά)
COLUMN_MAP = {
    "Κωδ.Είδους": "code",
    "Περιγραφή": "description",
    "URL": "image_url",
    "Υποσυσκευασία": "pieces_per_package",
    "Όγκος": "volume_liters",
    "Χρώμα": "color",
}

REQUIRED = ["code", "description", "pieces_per_package", "volume_liters", "color"]  # image_url optional

def norm_gr(s: str) -> str:
    if s is None:
        return ""
    s = str(s).strip().lower()
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")  # remove accents
    return s

def normalize_col(name: str) -> str:
    return str(name).strip()

def import_products_from_excel(path: str = EXCEL_PATH) -> int:
    df = pd.read_excel(path, sheet_name=0, dtype=str)
    df.columns = [normalize_col(c) for c in df.columns]

    # rename using mapping (only keys present)
    ren = {c: COLUMN_MAP[c] for c in df.columns if c in COLUMN_MAP}
    df = df.rename(columns=ren)

    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"Δεν βρέθηκαν υποχρεωτικές στήλες: {missing}. Έλεγξε το COLUMN_MAP.")

    # keep only needed
    keep = ["code", "description", "image_url", "pieces_per_package", "volume_liters", "color"]
    for c in keep:
        if c not in df.columns:
            df[c] = ""  # create optional columns if missing
    df = df[keep]

    # clean
    df["code"] = df["code"].astype(str).str.strip()
    df["description"] = df["description"].astype(str).str.strip()
    df["image_url"] = df["image_url"].fillna("").astype(str).str.strip()

    df["pieces_per_package"] = pd.to_numeric(df["pieces_per_package"], errors="coerce").fillna(0).astype(int)
    df["volume_liters"] = pd.to_numeric(df["volume_liters"], errors="coerce").fillna(0.0).astype(float)
    df["color"] = df["color"].fillna("").astype(str).str.strip()
    df.loc[df["color"] == "", "color"] = "N/A"


    df = df[df["code"].str.len() > 0]
    df = df[df["pieces_per_package"] > 0]
    df = df[df["volume_liters"] >= 0]

    init_schema()
    conn = get_conn()
    cur = conn.cursor()

    count = 0
    for _, r in df.iterrows():
        desc_norm = norm_gr(r["description"])
        color_norm = norm_gr(r["color"])

        cur.execute("""
        INSERT INTO products(code, description, image_url, pieces_per_package, volume_liters, color, description_norm, color_norm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          description=excluded.description,
          image_url=excluded.image_url,
          pieces_per_package=excluded.pieces_per_package,
          volume_liters=excluded.volume_liters,
          color=excluded.color,
          description_norm=excluded.description_norm,
          color_norm=excluded.color_norm
        """, (r["code"], r["description"], r["image_url"], int(r["pieces_per_package"]), float(r["volume_liters"]), r["color"], desc_norm, color_norm))
        count += 1

    conn.commit()
    conn.close()
    return count

if __name__ == "__main__":
    n = import_products_from_excel()
    print(f"Imported/Updated: {n} rows")
