import { estimateOrderValue } from "./order-value-estimate.js";

const MAX_ITEMS = 200;
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

export function validateOrderSubmission(body) {
  const customerName = sanitizeText(body?.customerName, MAX_TEXT_LENGTH);
  const customerCode = sanitizeText(body?.customerCode, 128);
  const customerSubstore = sanitizeText(
    body?.customerSubstore,
    MAX_TEXT_LENGTH,
  );
  const customerEmail = sanitizeText(body?.customerEmail, MAX_TEXT_LENGTH);
  const notes = sanitizeText(body?.notes, MAX_NOTES_LENGTH);
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

    return { code, qty };
  });

  return {
    customerName,
    customerCode,
    customerSubstore,
    customerEmail,
    notes,
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

export async function createOrderSubmission(db, submission) {
  const codes = submission.items.map((item) => item.code);
  const placeholders = codes.map(() => "?").join(", ");
  const products = await db.all(
    `SELECT id, code FROM products WHERE code IN (${placeholders})`,
    codes,
  );
  const productIdByCode = new Map(products.map((row) => [row.code, row.id]));

  const missingCodes = codes.filter((code) => !productIdByCode.has(code));
  if (missingCodes.length) {
    const error = new Error(
      `Unknown product code(s): ${missingCodes.join(", ")}. Reload the catalog and try again.`,
    );
    error.status = 400;
    throw error;
  }

  const valueEstimate = await estimateOrderValue(db, {
    customerCode: submission.customerCode || null,
    items: submission.items,
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
        total_qty_pieces, total_net_value, status, submitted_by, submitted_by_role,
        submitted_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
    `,
    [
      submission.customerName,
      submission.customerEmail || null,
      submission.customerCode || null,
      submission.customerSubstore || null,
      submission.notes || null,
      totalQtyPieces,
      valueEstimate.totalNetValue,
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
        INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, discount_pct, line_net_value)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        orderId,
        productIdByCode.get(item.code),
        item.qty,
        priced?.unitPrice || 0,
        priced?.discountPct || 0,
        priced?.lineNetValue || 0,
      ],
    );
  }

  return { orderId, valueEstimate };
}

export async function listPendingOrderSubmissions(db) {
  const orders = await db.all(`
    SELECT id, customer_name, customer_email, customer_code, customer_substore, notes,
           total_qty_pieces, total_net_value, status, submitted_by, submitted_by_role,
           submitted_at
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
             p.code, p.description
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
    });
  }

  return orders.map((order) => {
    const orderLines = linesByOrderId.get(order.id) || [];
    return {
      ...order,
      lines: orderLines,
      value_is_partial: orderLines.some((line) => Number(line.unit_price) === 0),
    };
  });
}

async function setOrderSubmissionStatus(db, orderId, status, adminUsername) {
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
      SET status = ?, approved_by = ?, approved_at = ?
      WHERE id = ?
    `,
    [status, adminUsername, new Date().toISOString(), orderId],
  );
}

export async function approveOrderSubmission(db, orderId, adminUsername) {
  await setOrderSubmissionStatus(db, orderId, "approved", adminUsername);
}

export async function rejectOrderSubmission(db, orderId, adminUsername) {
  await setOrderSubmissionStatus(db, orderId, "rejected", adminUsername);
}
