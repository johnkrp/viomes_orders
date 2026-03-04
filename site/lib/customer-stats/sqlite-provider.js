import {
  asInteger,
  asMoney,
  buildAverageDaysBetweenOrders,
  buildDaysSinceLastOrder,
  buildRevenueSince,
  createCustomerNotFoundError,
  ensureCustomerCode,
  productStatRow,
} from "./shared.js";

function createMonthlyBuckets() {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    revenue: 0,
    pieces: 0,
  }));
}

function mergeMonthlyRows(rows) {
  const buckets = createMonthlyBuckets();
  for (const row of rows) {
    const monthIndex = asInteger(row.month) - 1;
    if (monthIndex < 0 || monthIndex >= 12) continue;
    buckets[monthIndex] = {
      month: monthIndex + 1,
      revenue: asMoney(row.revenue),
      pieces: asInteger(row.pieces),
    };
  }
  return buckets;
}

export function createSqliteCustomerStatsProvider({ db }) {
  if (!db) {
    throw new Error("SQLite customer stats provider requires a database connection.");
  }

  return {
    name: "sqlite",
    async getCustomerStats(customerCode) {
      const code = ensureCustomerCode(customerCode);

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
        GROUP BY p.id, p.code, p.description
      `;

      const allProductSales = await db.all(`${productQuery} ORDER BY p.code ASC`, [code]);
      const topProductsByQty = [...allProductSales]
        .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue || a.code.localeCompare(b.code))
        .slice(0, 10);
      const topProductsByValue = [...allProductSales]
        .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.code.localeCompare(b.code))
        .slice(0, 10);

      const recentOrders = await db.all(
        `
          SELECT
            o.id AS order_id,
            o.created_at,
            o.total_net_value,
            COUNT(ol.id) AS total_lines,
            COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
            COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
          FROM orders o
          LEFT JOIN order_lines ol ON ol.order_id = o.id
          WHERE o.customer_code = ?
          GROUP BY o.id, o.created_at, o.total_net_value
          ORDER BY o.created_at DESC
          LIMIT 10
        `,
        [code],
      );

      const detailedOrderHeaders = await db.all(
        `
          SELECT
            o.id AS order_id,
            o.created_at,
            o.notes,
            o.total_net_value,
            COUNT(ol.id) AS total_lines,
            COALESCE(SUM(ol.qty_pieces), 0) AS total_pieces,
            COALESCE(AVG(ol.discount_pct), 0) AS average_discount_pct
          FROM orders o
          LEFT JOIN order_lines ol ON ol.order_id = o.id
          WHERE o.customer_code = ?
          GROUP BY o.id, o.created_at, o.notes, o.total_net_value
          ORDER BY o.created_at DESC
          LIMIT 6
        `,
        [code],
      );

      const detailedOrders = [];
      for (const order of detailedOrderHeaders) {
        const lines = await db.all(
          `
            SELECT
              p.code,
              p.description,
              ol.qty_pieces,
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

        detailedOrders.push({
          order_id: order.order_id,
          created_at: order.created_at,
          notes: order.notes || "",
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asMoney(order.average_discount_pct),
          lines: lines.map((line) => ({
            code: line.code,
            description: line.description,
            qty: asInteger(line.qty_pieces),
            unit_price: asMoney(line.unit_price),
            discount_pct: asMoney(line.discount_pct),
            line_net_value: asMoney(line.line_net_value),
          })),
        });
      }

      const now = new Date();
      const currentYear = now.getUTCFullYear();
      const previousYear = currentYear - 1;

      const monthlyCurrent = await db.all(
        `
          SELECT
            CAST(strftime('%m', o.created_at) AS INTEGER) AS month,
            COALESCE(SUM(o.total_net_value), 0) AS revenue,
            COALESCE(SUM(o.total_qty_pieces), 0) AS pieces
          FROM orders o
          WHERE o.customer_code = ?
            AND CAST(strftime('%Y', o.created_at) AS INTEGER) = ?
          GROUP BY CAST(strftime('%m', o.created_at) AS INTEGER)
          ORDER BY month ASC
        `,
        [code, currentYear],
      );

      const monthlyPrevious = await db.all(
        `
          SELECT
            CAST(strftime('%m', o.created_at) AS INTEGER) AS month,
            COALESCE(SUM(o.total_net_value), 0) AS revenue,
            COALESCE(SUM(o.total_qty_pieces), 0) AS pieces
          FROM orders o
          WHERE o.customer_code = ?
            AND CAST(strftime('%Y', o.created_at) AS INTEGER) = ?
          GROUP BY CAST(strftime('%m', o.created_at) AS INTEGER)
          ORDER BY month ASC
        `,
        [code, previousYear],
      );

      const receivableItems = await db.all(
        `
          SELECT
            document_no,
            document_date,
            due_date,
            amount_total,
            amount_paid,
            open_balance,
            status
          FROM customer_receivables
          WHERE customer_code = ?
          ORDER BY due_date ASC, document_date ASC
        `,
        [code],
      );

      const todayIso = now.toISOString();
      const receivables = receivableItems.map((item) => ({
        document_no: item.document_no,
        document_date: item.document_date,
        due_date: item.due_date,
        amount_total: asMoney(item.amount_total),
        amount_paid: asMoney(item.amount_paid),
        open_balance: asMoney(item.open_balance),
        status: item.status || "",
        is_overdue:
          Number(item.open_balance || 0) > 0 && item.due_date && String(item.due_date) < todayIso,
      }));

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
          revenue_3m: buildRevenueSince(recentOrders, now, 90),
          revenue_6m: buildRevenueSince(recentOrders, now, 180),
          revenue_12m: buildRevenueSince(recentOrders, now, 365),
          average_order_value: totalOrders ? asMoney(totalRevenue / totalOrders) : 0,
          average_days_between_orders: buildAverageDaysBetweenOrders(recentOrders),
          days_since_last_order: buildDaysSinceLastOrder(summary.last_order_date, now),
          last_order_date: summary.last_order_date,
        },
        monthly_sales: {
          current_year: mergeMonthlyRows(monthlyCurrent),
          previous_year: mergeMonthlyRows(monthlyPrevious),
        },
        product_sales: {
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
          open_balance: asMoney(
            receivables.reduce((sum, item) => sum + Number(item.open_balance || 0), 0),
          ),
          overdue_balance: asMoney(
            receivables.reduce(
              (sum, item) => sum + (item.is_overdue ? Number(item.open_balance || 0) : 0),
              0,
            ),
          ),
          items: receivables,
        },
        top_products_by_qty: topProductsByQty.map(productStatRow),
        top_products_by_value: topProductsByValue.map(productStatRow),
        recent_orders: recentOrders.map((order) => ({
          order_id: order.order_id,
          created_at: order.created_at,
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asMoney(order.average_discount_pct),
        })),
        detailed_orders: detailedOrders,
      };
    },
  };
}
