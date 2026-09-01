import { estimateOrderValue } from "./order-value-estimate.js";

// Sized from real ES1 history, not guessed: the largest ΠΑΡ ever recorded is 390 lines
// (the old limit of 200 would have bounced it) and the largest single line is 384,000
// pieces. MAX_QTY_PER_LINE is therefore only a typo guard - it has to stay well clear of
// quantities the business genuinely places.
const MAX_ITEMS = 500;
const MAX_QTY_PER_LINE = 1000000;
const MAX_TEXT_LENGTH = 500;
const MAX_NOTES_LENGTH = 4000;

// With the approval step gone, a submitted order goes straight to the writer-ready
// state and a double-submit (double-click, retry after a slow response) would become
// two real ΠΑΡ documents in ES1 instead of two harmless pending rows. This window is
// how far back createOrderSubmission looks for an identical order from the same
// customer before rejecting the second one with 409.
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

// Order lifecycle on orders.status, as shown in the admin panel. ES1's own
// "100. Πιστωτικός Έλεγχος" is the general human gate; there is no approval state for
// the ordinary flow. The viomes_db ΠΑΡ writer polls for 'ready', claims a row as
// 'writing', then sets 'written' or 'write_failed'. Denylist-only exceptions: the
// poller parks a denylisted customer's order as 'held', and an owner-admin here either
// approves it back to 'ready' (with writer_override=1) or moves it to 'rejected'.
export const WRITER_LIFECYCLE_STATUSES = [
  "ready",
  "writing",
  "written",
  "write_failed",
  "held",
  "rejected",
];

// Statuses whose rows the admin panel may soft-archive. A row the writer is mid-flight
// on ('writing') or has already turned into a real ΠΑΡ ('written') is never archivable
// from here — archiving 'written' would hide a document that can only be cancelled in
// ES1 (transition 157), not here.
export const ARCHIVABLE_STATUSES = ["ready", "write_failed", "held"];

// Filter-date validator for the admin panel's από/έως inputs. Unlike
// validateOptionalOrderDate this has NO ±day window — filtering months back is
// legitimate — it only rejects a value that isn't a real YYYY-MM-DD date.
export function validateListFilterDate(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${label} must be a date in YYYY-MM-DD format.`);
    error.status = 400;
    throw error;
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    const error = new Error(`${label} is not a real date.`);
    error.status = 400;
    throw error;
  }
  return text;
}

function nextDayString(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizeIdList(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  for (const raw of ids) {
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric > 0) seen.add(numeric);
  }
  return [...seen];
}

/**
 * Normalized signature of an order's lines: the sorted "code:qty" list joined with "|".
 * Line order and object identity do not matter - two submissions with the same set of
 * {code, qty} pairs produce the same string. Used only for the double-submit guard.
 */
export function orderLineSignature(items) {
  return (items || [])
    .map((item) => `${item.code}:${item.qty}`)
    .sort()
    .join("|");
}

function sanitizeText(value, maxLength) {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

function validateEmailAddress(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const MAX_DATE_DAYS_AHEAD = 365;
const MAX_DATE_DAYS_BEHIND = 30;

/**
 * ES1's ΤΡΟΠΟΣ ΛΗΨΗΣ ΠΑΡΑΓΓΕΛΙΑΣ code for "ΜΕΣΩ ΠΛΑΤΦΟΡΜΑΣ" — an order received through
 * a B2B portal rather than by email, phone or in person. It is stamped on every order
 * this form captures, so the eventual ΠΑΡ writer has the value ready instead of guessing.
 *
 * The field is filled on 97.8% of 2026 ΠΑΡ documents, so leaving it blank would make
 * form-created orders visibly odd in ES1's own reporting. 9070 is already in real use
 * (2.7% of 2026 orders, e.g. DEDEMAN's portal traffic).
 *
 * Caveat for later: this is exactly right for a customer submitting their own order. For
 * a salesman keying in an order that reached them by email, ES1's own reading of the
 * field would arguably be 9020 (EMAIL) — the code describes how the CUSTOMER's order
 * arrived, not which screen typed it. submitted_by_role already distinguishes the two if
 * that refinement is ever wanted.
 */
export const ES1_ORDER_CHANNEL_PLATFORM = "9070";

/**
 * Validates an optional ISO date (YYYY-MM-DD) and returns it, or null when blank.
 *
 * The window is a typo guard, not a business rule: real desired-pickup dates cluster at
 * +1/+2 days but genuinely run past +12, so the bounds stay wide. A little slack in the
 * past is allowed because an order can be entered after the date the customer asked for.
 */
export function validateOptionalOrderDate(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${label} must be a date in YYYY-MM-DD format.`);
    error.status = 400;
    throw error;
  }

  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${label} is not a real date.`);
    error.status = 400;
    throw error;
  }
  // Rejects things like 2026-02-31, which Date would otherwise roll forward silently.
  if (parsed.toISOString().slice(0, 10) !== text) {
    const error = new Error(`${label} is not a real date.`);
    error.status = 400;
    throw error;
  }

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const diffDays = Math.round((parsed.getTime() - todayUtc) / 86400000);
  if (diffDays > MAX_DATE_DAYS_AHEAD || diffDays < -MAX_DATE_DAYS_BEHIND) {
    const error = new Error(
      `${label} (${text}) is outside the accepted range of ${MAX_DATE_DAYS_BEHIND} days back to ${MAX_DATE_DAYS_AHEAD} days ahead.`,
    );
    error.status = 400;
    throw error;
  }

  return text;
}

export function validateOrderSubmission(body) {
  const customerName = sanitizeText(body?.customerName, MAX_TEXT_LENGTH);
  const customerCode = sanitizeText(body?.customerCode, 128);
  const customerSubstore = sanitizeText(
    body?.customerSubstore,
    MAX_TEXT_LENGTH,
  );
  // Exact branch code (== ES1 ESGOSites.Code) for the ΠΑΡ writer's delivery-site
  // resolver. Optional - blank for retail / no-branch orders.
  const customerSubstoreCode = sanitizeText(body?.customerSubstoreCode, 128);
  const customerEmail = sanitizeText(body?.customerEmail, MAX_TEXT_LENGTH);
  const notes = sanitizeText(body?.notes, MAX_NOTES_LENGTH);
  const desiredDeliveryDate = validateOptionalOrderDate(
    body?.desiredDeliveryDate,
    "Επιθυμητή ημερομηνία παραλαβής",
  );
  const items = Array.isArray(body?.items) ? body.items : null;

  if (!validateEmailAddress(customerEmail)) {
    const error = new Error("Customer email address is invalid.");
    error.status = 400;
    throw error;
  }

  if (!items || !items.length) {
    const error = new Error("Order submission requires at least one item.");
    error.status = 400;
    throw error;
  }

  if (items.length > MAX_ITEMS) {
    const error = new Error(
      `Order submission supports up to ${MAX_ITEMS} items.`,
    );
    error.status = 400;
    throw error;
  }

  const normalizedItems = items.map((item, index) => {
    const code = sanitizeText(item?.code, 128);
    const qty = Number(item?.qty);

    if (!code) {
      const error = new Error(`Item ${index + 1} is missing a product code.`);
      error.status = 400;
      throw error;
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      const error = new Error(`Item ${index + 1} has an invalid quantity.`);
      error.status = 400;
      throw error;
    }

    if (qty > MAX_QTY_PER_LINE) {
      const error = new Error(
        `Item ${code} has an implausible quantity (${qty}). Maximum is ${MAX_QTY_PER_LINE}.`,
      );
      error.status = 400;
      throw error;
    }

    return { code, qty };
  });

  return {
    customerName,
    customerCode,
    customerSubstore,
    customerSubstoreCode,
    customerEmail,
    notes,
    desiredDeliveryDate,
    items: normalizedItems,
  };
}

export async function resolveOrderSubmissionIdentity(
  db,
  { actor, submission, getImportedCustomerByCode },
) {
  if (actor?.role === "customer") {
    const customer = await getImportedCustomerByCode(db, actor.customerCode);
    if (!customer || customer.is_inactive) {
      const error = new Error(
        "Customer account is not linked to an active customer record.",
      );
      error.status = 403;
      throw error;
    }
    return {
      customerCode: customer.code,
      customerName: customer.name,
      customerSubstore: submission.customerSubstore || null,
      customerSubstoreCode: submission.customerSubstoreCode || null,
      submittedBy: actor.username || null,
      submittedByRole: "customer",
    };
  }

  if (!submission.customerCode) {
    const error = new Error("Select a customer before submitting the order.");
    error.status = 400;
    throw error;
  }

  const customer = await getImportedCustomerByCode(db, submission.customerCode);
  if (!customer || customer.is_inactive) {
    const error = new Error(
      `Unknown or inactive customer code: ${submission.customerCode}`,
    );
    error.status = 400;
    throw error;
  }

  return {
    customerCode: customer.code,
    customerName: customer.name,
    customerSubstore: submission.customerSubstore || null,
    customerSubstoreCode: submission.customerSubstoreCode || null,
    submittedBy: actor?.username || null,
    submittedByRole: actor?.role || null,
  };
}

export async function createOrderSubmission(db, submission, { pricingClient } = {}) {
  const codes = submission.items.map((item) => item.code);
  const placeholders = codes.map(() => "?").join(", ");
  const products = await db.all(
    `SELECT id, code, pieces_per_package FROM products WHERE code IN (${placeholders})`,
    codes,
  );
  const productIdByCode = new Map(products.map((row) => [row.code, row.id]));
  const packSizeByCode = new Map(
    products.map((row) => [row.code, Number(row.pieces_per_package) || 0]),
  );

  const missingCodes = codes.filter((code) => !productIdByCode.has(code));
  if (missingCodes.length) {
    const error = new Error(
      `Unknown product code(s): ${missingCodes.join(", ")}. Reload the catalog and try again.`,
    );
    error.status = 400;
    throw error;
  }

  // Quantities must be whole packages. The salesman form already enforces this
  // ("Λάθος ποσότητα. Το προϊόν X έχει N τεμ./συσκ."), but that is client-side only —
  // anything posting straight to the API skipped it entirely, which matters more once
  // customers submit their own orders. Products with no recorded pack size are skipped
  // rather than assumed to be 1.
  const packErrors = [];
  for (const item of submission.items) {
    const packSize = packSizeByCode.get(item.code);
    if (packSize > 0 && item.qty % packSize !== 0) {
      packErrors.push(`${item.code} (${item.qty} δεν είναι πολλαπλάσιο του ${packSize})`);
    }
  }
  if (packErrors.length) {
    const error = new Error(
      `Λάθος ποσότητα ανά συσκευασία: ${packErrors.join(", ")}.`,
    );
    error.status = 400;
    throw error;
  }

  // Double-submit guard. Only a customer-coded order can be matched reliably (a
  // walk-in with no code is left alone). Reject - do not silently succeed - so the
  // form surfaces it instead of the salesman ending up with two ΠΑΡ documents.
  if (submission.customerCode) {
    const cutoff = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const recentLines = await db.all(
      `
        SELECT o.id AS order_id, ol.qty_pieces, p.code
        FROM orders o
        JOIN order_lines ol ON ol.order_id = o.id
        JOIN products p ON p.id = ol.product_id
        WHERE o.customer_code = ?
          AND o.submitted_at >= ?
        ORDER BY o.id
      `,
      [submission.customerCode, cutoff],
    );
    const partsByOrder = new Map();
    for (const row of recentLines) {
      if (!partsByOrder.has(row.order_id)) partsByOrder.set(row.order_id, []);
      partsByOrder.get(row.order_id).push(`${row.code}:${row.qty_pieces}`);
    }
    const incomingSignature = orderLineSignature(submission.items);
    for (const parts of partsByOrder.values()) {
      if (parts.sort().join("|") === incomingSignature) {
        const error = new Error(
          "Αυτή η παραγγελία μόλις υποβλήθηκε (ίδιος πελάτης και ίδιες γραμμές, τελευταία 5 λεπτά). Ελέγξτε τις καταχωρημένες παραγγελίες πριν υποβάλετε ξανά.",
        );
        error.status = 409;
        throw error;
      }
    }
  }

  const valueEstimate = await estimateOrderValue(db, {
    customerCode: submission.customerCode || null,
    items: submission.items,
    pricingClient,
  });
  const valueByCode = new Map(
    valueEstimate.lines.map((line) => [line.code, line]),
  );

  const totalQtyPieces = submission.items.reduce(
    (sum, item) => sum + item.qty,
    0,
  );
  const submittedAt = new Date().toISOString();

  const { lastID: orderId } = await db.run(
    `
      INSERT INTO orders(
        customer_name, customer_email, customer_code, customer_substore,
        customer_substore_code, notes,
        desired_delivery_date, es1_order_channel_code, total_qty_pieces,
        total_net_value, needs_manual_price_review, status, submitted_by,
        submitted_by_role, submitted_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)
    `,
    [
      submission.customerName,
      submission.customerEmail || null,
      submission.customerCode || null,
      submission.customerSubstore || null,
      submission.customerSubstoreCode || null,
      submission.notes || null,
      submission.desiredDeliveryDate || null,
      ES1_ORDER_CHANNEL_PLATFORM,
      totalQtyPieces,
      valueEstimate.totalNetValue,
      valueEstimate.needsManualPriceReview ? 1 : 0,
      submission.submittedBy || null,
      submission.submittedByRole || null,
      submittedAt,
      submittedAt,
    ],
  );

  for (const item of submission.items) {
    const priced = valueByCode.get(item.code);
    await db.run(
      `
        INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, discount_pct, line_net_value, price_source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orderId,
        productIdByCode.get(item.code),
        item.qty,
        priced?.unitPrice || 0,
        priced?.discountPct || 0,
        priced?.lineNetValue || 0,
        priced?.source || "no_history",
      ],
    );
  }

  return { orderId, valueEstimate };
}

/**
 * Read-only feed for the admin "Νέες παραγγελίες πωλητών" panel. There is nothing to
 * action here any more - it shows where each captured order sits in the ES1 writer
 * lifecycle (ready / writing / written / write_failed / held). Bounded so it cannot grow
 * without limit as 'written' rows accumulate.
 *
 * Options:
 *   from / to  — inclusive YYYY-MM-DD bounds on submitted_at; `to` is expanded to an
 *                exclusive next-day boundary so from === to selects that single day.
 *   archived   — false (default) lists live rows (archived_at IS NULL); true lists the
 *                soft-archived rows for the un-archive view.
 */
export async function listOrderSubmissions(
  db,
  { from = null, to = null, archived = false } = {},
) {
  const statusPlaceholders = WRITER_LIFECYCLE_STATUSES.map(() => "?").join(", ");
  const conditions = [`status IN (${statusPlaceholders})`];
  const params = [...WRITER_LIFECYCLE_STATUSES];

  conditions.push(archived ? "archived_at IS NOT NULL" : "archived_at IS NULL");
  if (from) {
    conditions.push("submitted_at >= ?");
    params.push(from);
  }
  if (to) {
    conditions.push("submitted_at < ?");
    params.push(nextDayString(to));
  }

  const orders = await db.all(
    `
    SELECT id, customer_name, customer_email, customer_code, customer_substore, notes,
           desired_delivery_date, dispatch_date, es1_order_channel_code,
           total_qty_pieces, total_net_value, needs_manual_price_review, status,
           es1_document_code, es1_written_at, es1_write_error, es1_write_attempts,
           archived_at, writer_override, held_reason,
           approved_by, approved_at, rejected_by, rejected_at,
           submitted_by, submitted_by_role, submitted_at
    FROM orders
    WHERE ${conditions.join(" AND ")}
    ORDER BY submitted_at DESC
    LIMIT 200
  `,
    params,
  );

  if (!orders.length) return [];

  const orderIds = orders.map((order) => order.id);
  const placeholders = orderIds.map(() => "?").join(", ");
  const lines = await db.all(
    `
      SELECT ol.order_id, ol.qty_pieces, ol.unit_price, ol.discount_pct, ol.line_net_value,
             ol.price_source, p.code, p.description
      FROM order_lines ol
      JOIN products p ON p.id = ol.product_id
      WHERE ol.order_id IN (${placeholders})
      ORDER BY ol.id
    `,
    orderIds,
  );

  const linesByOrderId = new Map();
  for (const line of lines) {
    if (!linesByOrderId.has(line.order_id)) {
      linesByOrderId.set(line.order_id, []);
    }
    linesByOrderId.get(line.order_id).push({
      code: line.code,
      description: line.description,
      qty: line.qty_pieces,
      unit_price: line.unit_price,
      discount_pct: line.discount_pct,
      line_net_value: line.line_net_value,
      price_source: line.price_source || null,
    });
  }

  return orders.map((order) => {
    const orderLines = linesByOrderId.get(order.id) || [];
    return {
      ...order,
      lines: orderLines,
      needs_manual_price_review: Boolean(Number(order.needs_manual_price_review)),
      writer_override: Boolean(Number(order.writer_override)),
      value_is_partial: orderLines.some((line) => Number(line.unit_price) === 0),
      // Priced from another customer's invoice (heuristic model) or from a live-pricing
      // branch flagged "verified_with_caveats" - both are a weaker signal than the
      // customer's own confirmed history. The writer copies this onto the ΠΑΡ as a
      // Σχόλιο note so the ES1 "100" operator can tell them apart.
      value_has_fallback: orderLines.some(
        (line) =>
          line.price_source === "last_invoice_any_customer" ||
          String(line.price_source || "").endsWith("_caveats"),
      ),
    };
  });
}

// approveOrderSubmission / rejectOrderSubmission / setOrderSubmissionStatus were removed
// with the approval step. Orders now move ready -> writing -> written / write_failed
// under the viomes_db ΠΑΡ writer, which owns those transitions on the DB directly.

/**
 * Soft-archive rows for the admin panel's reversible "Clear". Every requested id is
 * classified: archivable ids get archived_at stamped; the rest come back in `skipped`
 * with the reason (a 'writing'/'written' row is refused, a missing id is reported, an
 * already-archived id is a no-op). Never a DELETE.
 */
export async function archiveOrderSubmissions(db, ids) {
  const cleanIds = normalizeIdList(ids);
  if (!cleanIds.length) return { archived: 0, skipped: [] };

  const placeholders = cleanIds.map(() => "?").join(", ");
  const rows = await db.all(
    `SELECT id, status, archived_at FROM orders WHERE id IN (${placeholders})`,
    cleanIds,
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));

  const archivable = [];
  const skipped = [];
  for (const id of cleanIds) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, status: null, reason: "not_found" });
    } else if (row.archived_at) {
      skipped.push({ id, status: row.status, reason: "already_archived" });
    } else if (!ARCHIVABLE_STATUSES.includes(row.status)) {
      skipped.push({ id, status: row.status, reason: "status_not_archivable" });
    } else {
      archivable.push(id);
    }
  }

  if (archivable.length) {
    const archivablePlaceholders = archivable.map(() => "?").join(", ");
    const statusPlaceholders = ARCHIVABLE_STATUSES.map(() => "?").join(", ");
    await db.run(
      `
        UPDATE orders
        SET archived_at = ?
        WHERE id IN (${archivablePlaceholders})
          AND archived_at IS NULL
          AND status IN (${statusPlaceholders})
      `,
      [new Date().toISOString(), ...archivable, ...ARCHIVABLE_STATUSES],
    );
  }

  return { archived: archivable.length, skipped };
}

/**
 * Reverse of archiveOrderSubmissions — clears archived_at so the row returns to the
 * default panel view (and the ΠΑΡ writer can pick it up again). Owner-admin only.
 */
export async function unarchiveOrderSubmissions(db, ids) {
  const cleanIds = normalizeIdList(ids);
  if (!cleanIds.length) return { unarchived: 0 };

  const placeholders = cleanIds.map(() => "?").join(", ");
  const result = await db.run(
    `UPDATE orders SET archived_at = NULL WHERE id IN (${placeholders}) AND archived_at IS NOT NULL`,
    cleanIds,
  );
  return { unarchived: result?.changes ?? 0 };
}

function assertOrderId(id) {
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const error = new Error("Invalid order id.");
    error.status = 400;
    throw error;
  }
  return orderId;
}

function assertOneHeldRowChanged(result) {
  if ((result?.changes ?? 0) !== 1) {
    const error = new Error(
      "Η παραγγελία δεν είναι σε αναμονή (έχει ήδη εγκριθεί, απορριφθεί ή καταχωρηθεί).",
    );
    error.status = 409;
    throw error;
  }
}

/**
 * Denylist "held for approval": an owner-admin releases a poller-held order back to the
 * writer. status → 'ready' with writer_override=1, so the poller writes it that one
 * time even though the customer is on its denylist. Only a 'held' row is actionable —
 * the WHERE guard is the whole safety story; anything else → 409.
 */
export async function approveHeldOrderSubmission(db, id, adminUsername) {
  const orderId = assertOrderId(id);
  const who = adminUsername || "unknown";
  const now = new Date().toISOString();
  const result = await db.run(
    `
      UPDATE orders
      SET status = 'ready', writer_override = 1, es1_write_error = NULL,
          approved_by = ?, approved_at = ?
      WHERE id = ? AND status = 'held'
    `,
    [who, now, orderId],
  );
  assertOneHeldRowChanged(result);
  return {
    ok: true,
    id: orderId,
    status: "ready",
    writer_override: true,
    approved_by: who,
    approved_at: now,
  };
}

/**
 * Denylist "held for approval": an owner-admin declines a poller-held order. status →
 * 'rejected'; the writer never touches a rejected row. Optional free-text reason is
 * folded into es1_write_error so it shows in the admin table like any other hold note.
 */
export async function rejectHeldOrderSubmission(db, id, adminUsername, reason = "") {
  const orderId = assertOrderId(id);
  const who = adminUsername || "unknown";
  const cleanReason = sanitizeText(reason, MAX_TEXT_LENGTH);
  const now = new Date().toISOString();
  const errText = cleanReason
    ? `rejected by ${who}: ${cleanReason}`
    : `rejected by ${who}`;
  const result = await db.run(
    `
      UPDATE orders
      SET status = 'rejected', rejected_by = ?, rejected_at = ?, es1_write_error = ?
      WHERE id = ? AND status = 'held'
    `,
    [who, now, errText, orderId],
  );
  assertOneHeldRowChanged(result);
  return {
    ok: true,
    id: orderId,
    status: "rejected",
    rejected_by: who,
    rejected_at: now,
    es1_write_error: errText,
  };
}
