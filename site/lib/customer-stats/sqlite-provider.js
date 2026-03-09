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

function buildImportedBranchClause(branchCode, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  if (!String(branchCode || "").trim()) {
    return { clause: "", params: [] };
  }
  return {
    clause: ` AND ${prefix}branch_code = ?`,
    params: [String(branchCode).trim()],
  };
}

function buildImportedBranchScopeClause(scope = {}, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const branchCode = String(scope?.branchCode || "").trim();
  const branchDescription = String(scope?.branchDescription || "").trim();
  const parts = [];
  const params = [];

  if (branchCode) {
    parts.push(`${prefix}branch_code LIKE ?`);
    params.push(`%${branchCode}%`);
  }

  if (branchDescription) {
    parts.push(`${prefix}branch_description LIKE ?`);
    params.push(`%${branchDescription}%`);
  }

  if (!parts.length) {
    return { clause: "", params: [] };
  }

  return {
    clause: ` AND ${parts.join(" AND ")}`,
    params,
  };
}

async function loadImportedCustomerBranches(db, customerCode, scope = {}) {
  const branchScope = buildImportedBranchScopeClause(scope);
  return db.all(
    `
      SELECT
        COALESCE(branch_code, '') AS branch_code,
        COALESCE(branch_description, '') AS branch_description,
        COUNT(*) AS raw_rows,
        COUNT(DISTINCT CONCAT(customer_code, '::', order_date, '::', document_no)) AS orders,
        COALESCE(SUM(net_value), 0) AS revenue,
        MAX(order_date) AS last_order_date
      FROM imported_sales_lines
      WHERE customer_code = ?
        ${branchScope.clause}
        AND (COALESCE(branch_code, '') <> '' OR COALESCE(branch_description, '') <> '')
      GROUP BY COALESCE(branch_code, ''), COALESCE(branch_description, '')
      ORDER BY branch_description ASC, branch_code ASC
    `,
    [customerCode, ...branchScope.params],
  );
}

export function createSqliteCustomerStatsProvider({ db, sqlDialect = "sqlite" }) {
  if (!db) {
    throw new Error("SQLite customer stats provider requires a database connection.");
  }

  return {
    name: "sqlite",
    mode: "sql-backed",
    projection_strategy: "projection-first",
    async getCustomerStats(customerCode, options = {}) {
      const code = ensureCustomerCode(customerCode);
      const selectedBranchCode = String(options?.branchCode || "").trim() || null;
      const branchScopeCode = String(options?.branchScopeCode || "").trim() || null;
      const branchScopeDescription = String(options?.branchScopeDescription || "").trim() || null;
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

      const branchScope = buildImportedBranchScopeClause({
        branchCode: branchScopeCode,
        branchDescription: branchScopeDescription,
      });
      const availableBranches = await loadImportedCustomerBranches(db, code, {
        branchCode: branchScopeCode,
        branchDescription: branchScopeDescription,
      });
      const importedDataFilter = selectedBranchCode
        ? buildImportedBranchClause(selectedBranchCode)
        : branchScope;

      const customer = await db.get(
        `
          SELECT
            customer_code AS code,
            COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS name,
            NULL AS email,
            MAX(delivery_code) AS delivery_code,
            MAX(delivery_description) AS delivery_description,
            ${selectedBranchCode ? "MAX(branch_code)" : "NULL"} AS branch_code,
            ${selectedBranchCode ? "MAX(branch_description)" : "NULL"} AS branch_description
          FROM imported_sales_lines
          WHERE customer_code = ?${importedDataFilter.clause}
          GROUP BY customer_code
        `,
        [code, ...importedDataFilter.params],
      );

      if (!customer) {
        throw createCustomerNotFoundError(code);
      }

      const summary = await db.get(
        `
          SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(order_totals.total_pieces), 0) AS total_pieces,
            COALESCE(SUM(order_totals.total_net_value), 0) AS total_revenue,
            MAX(created_at) AS last_order_date
          FROM (
            SELECT
              document_no,
              order_date AS created_at,
              COALESCE(SUM(qty_base), 0) AS total_pieces,
              COALESCE(SUM(net_value), 0) AS total_net_value
            FROM imported_sales_lines
            WHERE customer_code = ?${importedDataFilter.clause}
            GROUP BY document_no, order_date
          ) order_totals
        `,
        [code, ...importedDataFilter.params],
      );
      const revenueWindows = await db.get(
        `
          SELECT
            COALESCE(SUM(CASE WHEN SUBSTR(order_date, 1, 10) >= ? THEN net_value ELSE 0 END), 0) AS revenue_3m,
            COALESCE(SUM(CASE WHEN SUBSTR(order_date, 1, 10) >= ? THEN net_value ELSE 0 END), 0) AS revenue_6m,
            COALESCE(SUM(CASE WHEN SUBSTR(order_date, 1, 10) >= ? THEN net_value ELSE 0 END), 0) AS revenue_12m
          FROM imported_sales_lines
          WHERE customer_code = ?${importedDataFilter.clause}
        `,
        [
          buildCutoffDateString(now, 90),
          buildCutoffDateString(now, 180),
          buildCutoffDateString(now, 365),
          code,
          ...importedDataFilter.params,
        ],
      );

      const allProductSales = await db.all(
        `
          SELECT
            item_code AS code,
            MAX(item_description) AS description,
            COALESCE(SUM(qty_base), 0) AS pieces,
            COUNT(DISTINCT CONCAT(customer_code, '::', order_date, '::', document_no)) AS orders,
            COALESCE(SUM(net_value), 0) AS revenue,
            CASE
              WHEN COALESCE(SUM(qty_base), 0) > 0 THEN COALESCE(SUM(net_value), 0) / SUM(qty_base)
              ELSE 0
            END AS avg_unit_price
          FROM imported_sales_lines
          WHERE customer_code = ?${importedDataFilter.clause}
          GROUP BY item_code
          ORDER BY item_code ASC
        `,
        [code, ...importedDataFilter.params],
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
            CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
            document_no,
            order_date AS created_at,
            COUNT(*) AS total_lines,
            COALESCE(SUM(qty_base), 0) AS total_pieces,
            COALESCE(SUM(net_value), 0) AS total_net_value,
            0 AS average_discount_pct
          FROM imported_sales_lines
          WHERE customer_code = ?${importedDataFilter.clause}
          GROUP BY customer_code, document_no, order_date
          ORDER BY order_date DESC, document_no DESC
          LIMIT 10
        `,
        [code, ...importedDataFilter.params],
      );

      const detailedOrderHeaders = await db.all(
        `
          SELECT
            CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
            document_no,
            order_date AS created_at,
            COUNT(*) AS total_lines,
            COALESCE(SUM(qty_base), 0) AS total_pieces,
            COALESCE(SUM(net_value), 0) AS total_net_value,
            0 AS average_discount_pct
          FROM imported_sales_lines
          WHERE customer_code = ?${importedDataFilter.clause}
          GROUP BY customer_code, document_no, order_date
          ORDER BY order_date DESC, document_no DESC
          LIMIT 6
        `,
        [code, ...importedDataFilter.params],
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
              ${importedDataFilter.clause}
              AND document_no = ?
              AND order_date = ?
            ORDER BY item_code ASC
          `,
          [code, ...importedDataFilter.params, order.document_no, order.created_at],
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
            COALESCE(SUM(net_value), 0) AS revenue,
            COALESCE(SUM(qty_base), 0) AS pieces
          FROM imported_sales_lines
          WHERE customer_code = ?
            AND order_year = ?${importedDataFilter.clause}
          GROUP BY order_month
          ORDER BY order_month ASC
        `;
      const monthlyYearlySeries = [];
      for (const year of [olderYear, previousYear, currentYear]) {
        const rows = await db.all(
          monthlyYearQuery,
          [code, year, ...importedDataFilter.params],
        );
        monthlyYearlySeries.push({ year, months: mergeMonthlyRows(rows) });
      }

      const totalOrders = asInteger(summary.total_orders);
      const totalRevenue = asMoney(summary.total_revenue);

      return {
        customer: {
          code: customer.code,
          name: customer.name,
          email: null,
          aggregation_level: selectedBranchCode ? "branch" : "customer",
          branch_code: selectedBranchCode ? customer.branch_code || selectedBranchCode : null,
          branch_description: selectedBranchCode ? customer.branch_description || null : null,
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
        available_branches: availableBranches.map((branch) => ({
          branch_code: branch.branch_code || "",
          branch_description: branch.branch_description || "",
          orders: asInteger(branch.orders),
          revenue: asMoney(branch.revenue),
          raw_rows: asInteger(branch.raw_rows),
          last_order_date: branch.last_order_date || null,
        })),
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
