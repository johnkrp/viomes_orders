import {
  asInteger,
  asMoney,
  buildAverageDaysBetweenOrders,
  buildDaysSinceLastOrder,
  createCustomerNotFoundError,
} from "./shared.js";
import {
  buildDetailedOrder,
  buildSummaryOrder,
  loadMonthlyYearlySeries,
  mergeMonthlyRows,
} from "./stats-shaping.js";
import { buildDateWindowFilter, loadRevenueWindows } from "./stats-time-range.js";

export async function loadLocalCustomerStats({ db, sqlDialect, code, salesTimeRange, now }) {
  const orderDateWindowFilter = buildDateWindowFilter(now, salesTimeRange, "o.created_at");

  const customer = await db.get(
    `
      SELECT code, name, email
      FROM customers
      WHERE code = ?
    `,
    [code],
  );

  if (!customer) {
    throw createCustomerNotFoundError(code);
  }

  const summary = await db.get(
    `
      SELECT
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(SUM(ol.line_net_value), 0) AS total_revenue,
        MAX(o.created_at) AS last_order_date
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
    `,
    [code],
  );
  const rangeSummary = await db.get(
    `
      SELECT
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(SUM(ol.line_net_value), 0) AS total_revenue
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
        ${orderDateWindowFilter.clause}
    `,
    [code, ...orderDateWindowFilter.params],
  );
  const revenueWindows = await loadRevenueWindows(db, "orders", "customer_code", "created_at", code, now);

  const productQuery = `
    SELECT
      p.code,
      p.description,
      SUM(ol.qty_pieces) AS qty,
      COUNT(DISTINCT o.id) AS orders,
      COALESCE(SUM(ol.line_net_value), 0) AS revenue,
      CASE
        WHEN SUM(ol.qty_pieces) > 0 THEN COALESCE(SUM(ol.line_net_value), 0) / SUM(ol.qty_pieces)
        ELSE 0
      END AS avg_unit_price
    FROM orders o
    JOIN order_lines ol ON ol.order_id = o.id
    JOIN products p ON p.id = ol.product_id
    WHERE o.customer_code = ?
      ${orderDateWindowFilter.clause}
    GROUP BY p.id, p.code, p.description
  `;

  const allProductSales = await db.all(`${productQuery} ORDER BY p.code ASC`, [
    code,
    ...orderDateWindowFilter.params,
  ]);
  const topProductsByQty = [...allProductSales]
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.code.localeCompare(b.code))
    .slice(0, 10);
  const topProductsByValue = [...allProductSales]
    .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.code.localeCompare(b.code))
    .slice(0, 10);

  const summaryRecentOrders = await db.all(
    `
      SELECT
        o.id AS order_id,
        o.created_at,
        o.created_at AS ordered_at,
        NULL AS sent_at,
        o.total_net_value,
        COUNT(ol.id) AS total_lines,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
      GROUP BY o.id, o.created_at, o.total_net_value
      ORDER BY o.created_at DESC
      LIMIT 100
    `,
    [code],
  );

  const recentOrdersRows = await db.all(
    `
      SELECT
        o.id AS order_id,
        o.created_at,
        o.created_at AS ordered_at,
        NULL AS sent_at,
        o.total_net_value,
        COUNT(ol.id) AS total_lines,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
        ${orderDateWindowFilter.clause}
      GROUP BY o.id, o.created_at, o.total_net_value
      ORDER BY o.created_at DESC
      LIMIT 100
    `,
    [code, ...orderDateWindowFilter.params],
  );

  const detailedOrderHeaders = await db.all(
    `
      SELECT
        o.id AS order_id,
        o.created_at,
        o.created_at AS ordered_at,
        NULL AS sent_at,
        o.notes,
        o.total_net_value,
        COUNT(ol.id) AS total_lines,
        COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
        COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
      FROM orders o
      LEFT JOIN order_lines ol ON ol.order_id = o.id
      WHERE o.customer_code = ?
        ${orderDateWindowFilter.clause}
      GROUP BY o.id, o.created_at, o.notes, o.total_net_value
      ORDER BY o.created_at DESC
      LIMIT 100
    `,
    [code, ...orderDateWindowFilter.params],
  );

  const detailedOrders = [];
  for (const order of detailedOrderHeaders) {
    const lines = await db.all(
      `
        SELECT
          p.code,
          p.description,
          ol.qty_pieces AS qty,
          ol.unit_price,
          ol.discount_pct,
          ol.line_net_value
        FROM order_lines ol
        JOIN products p ON p.id = ol.product_id
        WHERE ol.order_id = ?
        ORDER BY p.code ASC
      `,
      [order.order_id],
    );

    detailedOrders.push(buildDetailedOrder(order, lines));
  }

  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;
  const olderYear = currentYear - 2;

  const castInt = sqlDialect === "mysql" ? "UNSIGNED" : "INTEGER";
  const monthExpr = `CAST(SUBSTR(o.created_at, 6, 2) AS ${castInt})`;
  const yearExpr = `CAST(SUBSTR(o.created_at, 1, 4) AS ${castInt})`;
  const monthlyYearQuery =
    `
      SELECT
        ${monthExpr} AS month,
        COALESCE(SUM(o.total_net_value), 0) AS revenue,
        COALESCE(SUM(o.total_qty_pieces), 0) AS pieces
      FROM orders o
      WHERE o.customer_code = ?
        AND ${yearExpr} = ?
      GROUP BY ${monthExpr}
      ORDER BY month ASC
    `;
  const monthlyYearlySeries = await loadMonthlyYearlySeries(
    db,
    monthlyYearQuery,
    code,
    [olderYear, previousYear, currentYear],
  );

  const totalOrders = asInteger(summary.total_orders);
  const totalRevenue = asMoney(summary.total_revenue);

  return {
    customer: {
      code: customer.code,
      name: customer.name,
      email: customer.email,
      aggregation_level: "store",
    },
    summary: {
      total_orders: totalOrders,
      total_pieces: asInteger(summary.total_pieces),
      total_revenue: totalRevenue,
      revenue_3m: revenueWindows.revenue_3m,
      revenue_6m: revenueWindows.revenue_6m,
      revenue_12m: revenueWindows.revenue_12m,
      average_order_value: totalOrders ? asMoney(totalRevenue / totalOrders) : 0,
      average_days_between_orders: buildAverageDaysBetweenOrders(summaryRecentOrders),
      days_since_last_order: buildDaysSinceLastOrder(summary.last_order_date, now),
      last_order_date: summary.last_order_date,
    },
    rangeSummary: {
      total_orders: asInteger(rangeSummary?.total_orders),
      total_pieces: asInteger(rangeSummary?.total_pieces),
      total_revenue: asMoney(rangeSummary?.total_revenue),
    },
    monthlySales: {
      current_year:
        monthlyYearlySeries.find((entry) => entry.year === currentYear)?.months ||
        mergeMonthlyRows([]),
      previous_year:
        monthlyYearlySeries.find((entry) => entry.year === previousYear)?.months ||
        mergeMonthlyRows([]),
      yearly_series: monthlyYearlySeries,
    },
    productSales: {
      metric: "revenue",
      items: allProductSales.map((row) => ({
        code: row.code,
        description: row.description,
        pieces: asInteger(row.qty),
        orders: asInteger(row.orders),
        revenue: asMoney(row.revenue),
        avg_unit_price: asMoney(row.avg_unit_price),
      })),
    },
    receivables: {
      currency: "EUR",
      open_balance: 0,
      overdue_balance: 0,
      progressive_credit: 0,
      items: [],
    },
    topProductsByQty: topProductsByQty,
    topProductsByValue: topProductsByValue,
    availableBranches: [],
    recentOrders: recentOrdersRows.map(buildSummaryOrder),
    openOrders: [],
    preApprovalOrders: [],
    detailedOrders,
    detailedOpenOrders: [],
    detailedPreApprovalOrders: [],
  };
}
