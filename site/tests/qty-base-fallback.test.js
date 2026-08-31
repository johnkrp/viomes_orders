import assert from "node:assert/strict";
import test from "node:test";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { initDatabaseSchema } from "../lib/db/init-schema.js";
import {
  buildEffectivePiecesExpression,
  buildQtyBaseExpression,
} from "../lib/document-type-rules.js";
import { IMPORTED_DISCOUNT_PERCENT_EXPRESSION } from "../lib/imported-sales.js";

test("qty_base expressions fall back to qty (Entersoft dropped the base-MM column in 2026-01)", () => {
  assert.equal(
    buildQtyBaseExpression(),
    "COALESCE(NULLIF(qty_base, 0), qty, 0)",
  );
  assert.equal(
    buildQtyBaseExpression("l"),
    "COALESCE(NULLIF(l.qty_base, 0), l.qty, 0)",
  );
  assert.match(buildEffectivePiecesExpression(), /NULLIF\(qty_base, 0\), qty/);
  assert.match(
    IMPORTED_DISCOUNT_PERCENT_EXPRESSION,
    /NULLIF\(qty_base, 0\), qty/,
  );
  // qty_base must not survive bare anywhere in the discount expression.
  assert.doesNotMatch(
    IMPORTED_DISCOUNT_PERCENT_EXPRESSION,
    /[^(]qty_base(?!, 0\), qty)/,
  );
});

test("a line with qty_base=0 still contributes pieces and a real discount", async () => {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    await initDatabaseSchema({ db, kind: "sqlite" });

    // Two ΤΙΠ lines for the same customer: the modern one has qty_base=0 (the bug),
    // the legacy one has qty_base populated. Both carry a 10% discount
    // (net = qty * price * 0.9) with discount_pct_total left blank.
    await db.run(
      `INSERT INTO imported_sales_lines(
         source_file, order_date, order_year, order_month, document_no, document_type,
         item_code, item_description, unit_code, qty, qty_base, unit_price, net_value,
         customer_code, customer_name
       ) VALUES
         ('2026.CSV','2026-03-01',2026,3,'D-NEW','ΤΙΠ','P1','Item 1','PCS',12,0, 10, 108, 'C1','Cust'),
         ('2025.CSV','2025-11-01',2025,11,'D-OLD','ΤΙΠ','P1','Item 1','PCS', 8,8, 10,  72, 'C1','Cust')`,
    );

    const row = await db.get(
      `SELECT
         COALESCE(SUM(${buildEffectivePiecesExpression()}), 0) AS pieces,
         ROUND(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 1) AS avg_discount
       FROM imported_sales_lines
       WHERE customer_code = 'C1'`,
    );

    assert.equal(row.pieces, 20, "12 (was qty_base=0) + 8 legacy");
    assert.equal(row.avg_discount, 10, "10% derived on both lines, not 0");
  } finally {
    await db.close();
  }
});
