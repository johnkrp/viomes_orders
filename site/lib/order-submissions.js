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
  const customerSubstore = sanitizeText(
    body?.customerSubstore,
    MAX_TEXT_LENGTH,
  );
  const customerEmail = sanitizeText(body?.customerEmail, MAX_TEXT_LENGTH);
  const notes = sanitizeText(body?.notes, MAX_NOTES_LENGTH);
  const items = Array.isArray(body?.items) ? body.items : null;

  if (!customerName) {
    const error = new Error("Order submission requires a customer name.");
    error.status = 400;
    throw error;
  }

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
    customerSubstore,
    customerEmail,
    notes,
    items: normalizedItems,
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

  const totalQtyPieces = submission.items.reduce(
    (sum, item) => sum + item.qty,
    0,
  );
  const submittedAt = new Date().toISOString();

  const { lastID: orderId } = await db.run(
    `
      INSERT INTO orders(
        customer_name, customer_email, customer_substore, notes,
        total_qty_pieces, total_net_value, status, submitted_at, created_at
      )
      VALUES (?, ?, ?, ?, ?, 0, 'pending', ?, ?)
    `,
    [
      submission.customerName,
      submission.customerEmail || null,
      submission.customerSubstore || null,
      submission.notes || null,
      totalQtyPieces,
      submittedAt,
      submittedAt,
    ],
  );

  for (const item of submission.items) {
    await db.run(
      `
        INSERT INTO order_lines(order_id, product_id, qty_pieces, unit_price, discount_pct, line_net_value)
        VALUES (?, ?, ?, 0, 0, 0)
      `,
      [orderId, productIdByCode.get(item.code), item.qty],
    );
  }

  return { orderId };
}

export async function listPendingOrderSubmissions(db) {
  const orders = await db.all(`
    SELECT id, customer_name, customer_email, customer_substore, notes,
           total_qty_pieces, status, submitted_at, warehouse_code
    FROM orders
    WHERE status = 'pending'
    ORDER BY submitted_at DESC
  `);

  if (!orders.length) return [];

  const orderIds = orders.map((order) => order.id);
  const placeholders = orderIds.map(() => "?").join(", ");
  const lines = await db.all(
    `
      SELECT ol.order_id, ol.qty_pieces, p.code, p.description
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
    });
  }

  return orders.map((order) => ({
    ...order,
    lines: linesByOrderId.get(order.id) || [],
  }));
}

async function setOrderSubmissionStatus(
  db,
  orderId,
  status,
  adminUsername,
  { warehouseCode } = {},
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
      SET status = ?, approved_by = ?, approved_at = ?, warehouse_code = ?
      WHERE id = ?
    `,
    [status, adminUsername, new Date().toISOString(), warehouseCode || null, orderId],
  );
}

export async function approveOrderSubmission(
  db,
  orderId,
  adminUsername,
  { warehouseCode } = {},
) {
  await setOrderSubmissionStatus(db, orderId, "approved", adminUsername, {
    warehouseCode,
  });
}

export async function rejectOrderSubmission(db, orderId, adminUsername) {
  await setOrderSubmissionStatus(db, orderId, "rejected", adminUsername);
}
