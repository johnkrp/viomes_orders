import {
  asInteger,
  asMoney,
  buildAverageDaysBetweenOrders,
  buildDaysSinceLastOrder,
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

async function loadMonthlyYearlySeries(db, query, customerCode, years) {
  const series = [];
  for (const year of years) {
    const rows = await db.all(query, [customerCode, year]);
    series.push({
      year,
      months: mergeMonthlyRows(rows),
    });
  }
  return series;
}

function buildCutoffDateString(now, days) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  return cutoff.toISOString().slice(0, 10);
}

async function loadRevenueWindows(db, table, customerCodeColumn, dateColumn, customerCode, now) {
  const cutoff3m = buildCutoffDateString(now, 90);
  const cutoff6m = buildCutoffDateString(now, 180);
  const cutoff12m = buildCutoffDateString(now, 365);

  const row = await db.get(
    `
      SELECT
        COALESCE(SUM(CASE WHEN SUBSTR(${dateColumn}, 1, 10) >= ? THEN total_net_value ELSE 0 END), 0) AS revenue_3m,
        COALESCE(SUM(CASE WHEN SUBSTR(${dateColumn}, 1, 10) >= ? THEN total_net_value ELSE 0 END), 0) AS revenue_6m,
        COALESCE(SUM(CASE WHEN SUBSTR(${dateColumn}, 1, 10) >= ? THEN total_net_value ELSE 0 END), 0) AS revenue_12m
      FROM ${table}
      WHERE ${customerCodeColumn} = ?
    `,
    [cutoff3m, cutoff6m, cutoff12m, customerCode],
  );

  return {
    revenue_3m: asMoney(row?.revenue_3m),
    revenue_6m: asMoney(row?.revenue_6m),
    revenue_12m: asMoney(row?.revenue_12m),
  };
}

async function hasImportedData(db) {
  try {
    const row = await db.get(`SELECT COUNT(*) AS n FROM imported_sales_lines`);
    return asInteger(row?.n) > 0;
  } catch {
    return false;
  }
}

export function createSqliteCustomerStatsProvider({ db, sqlDialect = "sqlite" }) {
  if (!db) {
    throw new Error("SQLite customer stats provider requires a database connection.");
  }

  return {
    name: "sqlite",
    mode: "sql-backed",
    projection_strategy: "projection-first",
    async getCustomerStats(customerCode) {
      const code = ensureCustomerCode(customerCode);
      const useImportedData = await hasImportedData(db);
      const now = new Date();

      if (!useImportedData) {
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
            average_days_between_orders: buildAverageDaysBetweenOrders(recentOrders),
            days_since_last_order: buildDaysSinceLastOrder(summary.last_order_date, now),
            last_order_date: summary.last_order_date,
          },
          monthly_sales: {
            current_year:
              monthlyYearlySeries.find((entry) => entry.year === currentYear)?.months ||
              mergeMonthlyRows([]),
            previous_year:
              monthlyYearlySeries.find((entry) => entry.year === previousYear)?.months ||
              mergeMonthlyRows([]),
            yearly_series: monthlyYearlySeries,
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
            open_balance: 0,
            overdue_balance: 0,
            items: [],
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
      }

      const customer = await db.get(
        `
          SELECT
            ic.customer_code AS code,
            ic.customer_name AS name,
            NULL AS email,
            ic.delivery_code,
            ic.delivery_description,
            ic.branch_code,
            ic.branch_description
          FROM imported_customers ic
          WHERE ic.customer_code = ?
        `,
        [code],
      );

      if (!customer) {
        throw createCustomerNotFoundError(code);
      }

      const summary = await db.get(
        `
          SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(total_pieces), 0) AS total_pieces,
            COALESCE(SUM(total_net_value), 0) AS total_revenue,
            MAX(created_at) AS last_order_date
          FROM imported_orders
          WHERE customer_code = ?
        `,
        [code],
      );
      const revenueWindows = await loadRevenueWindows(
        db,
        "imported_orders",
        "customer_code",
        "created_at",
        code,
        now,
      );

      const allProductSales = await db.all(
        `
          SELECT
            item_code AS code,
            item_description AS description,
            pieces,
            orders,
            revenue,
            avg_unit_price
          FROM imported_product_sales
          WHERE customer_code = ?
          ORDER BY item_code ASC
        `,
        [code],
      );

      const topProductsByQty = [...allProductSales]
        .sort((a, b) => b.pieces - a.pieces || b.revenue - a.revenue || a.code.localeCompare(b.code))
        .slice(0, 10)
        .map((row) => ({
          code: row.code,
          description: row.description,
          qty: row.pieces,
          orders: row.orders,
          revenue: row.revenue,
          avg_unit_price: row.avg_unit_price,
        }));

      const topProductsByValue = [...allProductSales]
        .sort((a, b) => b.revenue - a.revenue || b.pieces - a.pieces || a.code.localeCompare(b.code))
        .slice(0, 10)
        .map((row) => ({
          code: row.code,
          description: row.description,
          qty: row.pieces,
          orders: row.orders,
          revenue: row.revenue,
          avg_unit_price: row.avg_unit_price,
        }));

      const recentOrders = await db.all(
        `
          SELECT
            order_id,
            document_no,
            created_at,
            total_lines,
            total_pieces,
            total_net_value,
            average_discount_pct
          FROM imported_orders
          WHERE customer_code = ?
          ORDER BY created_at DESC, order_id DESC
          LIMIT 10
        `,
        [code],
      );

      const detailedOrderHeaders = await db.all(
        `
          SELECT
            order_id,
            document_no,
            created_at,
            total_lines,
            total_pieces,
            total_net_value,
            average_discount_pct
          FROM imported_orders
          WHERE customer_code = ?
          ORDER BY created_at DESC, order_id DESC
          LIMIT 6
        `,
        [code],
      );

      const detailedOrders = [];
      for (const order of detailedOrderHeaders) {
        const lines = await db.all(
          `
            SELECT
              item_code AS code,
              item_description AS description,
              qty_base AS qty,
              unit_price,
              0 AS discount_pct,
              net_value AS line_net_value
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND document_no = ?
              AND order_date = ?
            ORDER BY item_code ASC
          `,
          [code, order.document_no, order.created_at],
        );

        detailedOrders.push({
          order_id: order.order_id,
          created_at: order.created_at,
          notes: "",
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asMoney(order.average_discount_pct),
          lines: lines.map((line) => ({
            code: line.code,
            description: line.description,
            qty: asInteger(line.qty),
            unit_price: asMoney(line.unit_price),
            discount_pct: asMoney(line.discount_pct),
            line_net_value: asMoney(line.line_net_value),
          })),
        });
      }

      const currentYear = now.getUTCFullYear();
      const previousYear = currentYear - 1;
      const olderYear = currentYear - 2;
      const monthlyYearQuery =
        `
          SELECT
            order_month AS month,
            revenue,
            pieces
          FROM imported_monthly_sales
          WHERE customer_code = ?
            AND order_year = ?
          ORDER BY order_month ASC
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
          email: null,
          aggregation_level: "store",
          branch_code: customer.branch_code || null,
          branch_description: customer.branch_description || null,
        },
        summary: {
          total_orders: totalOrders,
          total_pieces: asInteger(summary.total_pieces),
          total_revenue: totalRevenue,
          revenue_3m: revenueWindows.revenue_3m,
          revenue_6m: revenueWindows.revenue_6m,
          revenue_12m: revenueWindows.revenue_12m,
          average_order_value: totalOrders ? asMoney(totalRevenue / totalOrders) : 0,
          average_days_between_orders: buildAverageDaysBetweenOrders(recentOrders),
          days_since_last_order: buildDaysSinceLastOrder(summary.last_order_date, now),
          last_order_date: summary.last_order_date,
        },
        monthly_sales: {
          current_year:
            monthlyYearlySeries.find((entry) => entry.year === currentYear)?.months ||
            mergeMonthlyRows([]),
          previous_year:
            monthlyYearlySeries.find((entry) => entry.year === previousYear)?.months ||
            mergeMonthlyRows([]),
          yearly_series: monthlyYearlySeries,
        },
        product_sales: {
          metric: "revenue",
          items: allProductSales.map((row) => ({
            code: row.code,
            description: row.description,
            pieces: asInteger(row.pieces),
            orders: asInteger(row.orders),
            revenue: asMoney(row.revenue),
            avg_unit_price: asMoney(row.avg_unit_price),
          })),
        },
        receivables: {
          currency: "EUR",
          open_balance: 0,
          overdue_balance: 0,
          items: [],
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
