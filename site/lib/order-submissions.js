import { estimateOrderValue } from "./order-value-estimate.js";

// Sized from real ES1 history, not guessed: the largest ΠΑΡ ever recorded is 390 lines
// (the old limit of 200 would have bounced it) and the largest single line is 384,000
// pieces. MAX_QTY_PER_LINE is therefore only a typo guard - it has to stay well clear of
// quantities the business genuinely places.
const MAX_ITEMS = 500;
const MAX_QTY_PER_LINE = 1000000;
const MAX_TEXT_LENGTH = 500;
const MAX_NOTES_LENGTH = 4000;

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
        customer_name, customer_email, customer_code, customer_substore, notes,
        desired_delivery_date, es1_order_channel_code, total_qty_pieces,
        total_net_value, needs_manual_price_review, status, submitted_by,
        submitted_by_role, submitted_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `,
    [
      submission.customerName,
      submission.customerEmail || null,
      submission.customerCode || null,
      submission.customerSubstore || null,
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

export async function listPendingOrderSubmissions(db) {
  const orders = await db.all(`
    SELECT id, customer_name, customer_email, customer_code, customer_substore, notes,
           desired_delivery_date, dispatch_date, es1_order_channel_code,
           total_qty_pieces, total_net_value, needs_manual_price_review, status,
           submitted_by, submitted_by_role, submitted_at
    FROM orders
    WHERE status = 'pending'
    ORDER BY submitted_at DESC
  `);

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
      value_is_partial: orderLines.some((line) => Number(line.unit_price) === 0),
      // Priced from another customer's invoice (heuristic model) or from a live-pricing
      // branch flagged "verified_with_caveats" - both are a weaker signal than the
      // customer's own confirmed history, and the approver has to be able to tell them apart.
      value_has_fallback: orderLines.some(
        (line) =>
          line.price_source === "last_invoice_any_customer" ||
          String(line.price_source || "").endsWith("_caveats"),
      ),
    };
  });
}

async function setOrderSubmissionStatus(
  db,
  orderId,
  status,
  adminUsername,
  { dispatchDate } = {},
) {
  const order = await db.get(`SELECT id, status FROM orders WHERE id = ?`, [
    orderId,
  ]);
  if (!order) {
    const error = new Error("Order not found.");
    error.status = 404;
    throw error;
  }
  if (order.status !== "pending") {
    const error = new Error(
      `Order is already "${order.status}", not pending.`,
    );
    error.status = 409;
    throw error;
  }

  await db.run(
    `
      UPDATE orders
      SET status = ?, approved_by = ?, approved_at = ?, dispatch_date = ?
      WHERE id = ?
    `,
    [
      status,
      adminUsername,
      new Date().toISOString(),
      dispatchDate || null,
      orderId,
    ],
  );
}

export async function approveOrderSubmission(
  db,
  orderId,
  adminUsername,
  { dispatchDate } = {},
) {
  await setOrderSubmissionStatus(db, orderId, "approved", adminUsername, {
    dispatchDate,
  });
}

export async function rejectOrderSubmission(db, orderId, adminUsername) {
  await setOrderSubmissionStatus(db, orderId, "rejected", adminUsername);
}
