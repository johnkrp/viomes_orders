import {
  asInteger,
  asMoney,
  buildAverageDaysBetweenOrders,
  buildDaysSinceLastOrder,
  createCustomerNotFoundError,
  ensureCustomerCode,
  productStatRow,
} from "./shared.js";
import {
  buildAnalyticsLineFilter,
  buildCountInOrderTotalsCase,
  buildCustomerActivityFilter,
  buildEffectivePiecesExpression,
  buildEffectiveRevenueExpression,
} from "../document-type-rules.js";
import { IMPORTED_DISCOUNT_PERCENT_EXPRESSION } from "../imported-sales.js";
import { FACTUAL_LIFECYCLE_RULES, buildDocumentTypeSqlList } from "../factual-lifecycle.js";

const EXECUTED_ORDER_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes,
);
const OPEN_EXECUTION_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes,
);
const PRE_APPROVAL_DOCUMENT_TYPES = FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes.includes("ΠΑΡ")
  ? ["ΠΑΡ"]
  : ["ΠΑΡ", ...FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes];
const PRE_APPROVAL_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(PRE_APPROVAL_DOCUMENT_TYPES);

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
  for (const yearEntry of years) {
    const yearParams = Array.isArray(yearEntry) ? yearEntry : [yearEntry];
    const rows = await db.all(query, [customerCode, ...yearParams]);
    series.push({
      year: yearParams[0],
      months: mergeMonthlyRows(rows),
    });
  }
  return series;
}

function buildCutoffDateString(now, days) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  return cutoff.toISOString().slice(0, 10);
}

const SALES_TIME_RANGE_DAYS = {
  "1w": 7,
  "2w": 14,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "12m": 365,
};

const SALES_TIME_RANGE_YEAR_MODES = new Set(["this_year", "last_year"]);

function normalizeSalesTimeRange(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "all") return "all";
  if (SALES_TIME_RANGE_YEAR_MODES.has(normalized)) return normalized;
  if (Object.hasOwn(SALES_TIME_RANGE_DAYS, normalized)) return normalized;
  return "3m";
}

function buildDateWindowFilter(now, salesTimeRange, dateColumn) {
  const normalizedRange = normalizeSalesTimeRange(salesTimeRange);
  if (normalizedRange === "all") {
    return {
      salesTimeRange: normalizedRange,
      clause: "",
      params: [],
    };
  }

  if (normalizedRange === "this_year" || normalizedRange === "last_year") {
    const year = normalizedRange === "this_year" ? now.getFullYear() : now.getFullYear() - 1;
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    return {
      salesTimeRange: normalizedRange,
      clause: ` AND SUBSTR(${dateColumn}, 1, 10) BETWEEN ? AND ?`,
      params: [start, end],
    };
  }

  return {
    salesTimeRange: normalizedRange,
    clause: ` AND SUBSTR(${dateColumn}, 1, 10) >= ?`,
    params: [buildCutoffDateString(now, SALES_TIME_RANGE_DAYS[normalizedRange])],
  };
}

function buildImportedOrderIdExpression(sqlDialect) {
  return sqlDialect === "mysql"
    ? "CONCAT(customer_code, '::', order_date, '::', document_no)"
    : "customer_code || '::' || order_date || '::' || document_no";
}

function asRoundedUpPercent(value) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.ceil(numericValue);
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

async function loadImportedLedgerSnapshot(db, customerCode) {
  try {
    return await db.get(
      `
        SELECT
          customer_code,
          customer_name,
          commercial_balance,
          ledger_balance,
          credit,
          pending_instruments,
          email,
          is_inactive,
          salesperson_code
        FROM imported_customer_ledgers
        WHERE customer_code = ?
      `,
      [customerCode],
    );
  } catch {
    return null;
  }
}

async function loadImportedLedgerLines(db, customerCode) {
  try {
    return await db.all(
      `
        SELECT
          document_date,
          document_no,
          reason,
          debit,
          credit,
          running_debit,
          running_credit,
          ledger_balance
        FROM imported_customer_ledger_lines
        WHERE customer_code = ?
        ORDER BY COALESCE(document_date, '') DESC, id DESC
      `,
      [customerCode],
    );
  } catch {
    return [];
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
        branch_code,
        COALESCE(NULLIF(MAX(branch_description), ''), '') AS branch_description,
        SUM(orders) AS orders,
        SUM(revenue) AS revenue,
        MAX(last_order_date) AS last_order_date
      FROM imported_customer_branches
      WHERE customer_code = ?
        ${branchScope.clause}
        AND (branch_code <> '' OR branch_description <> '')
      GROUP BY branch_code
      ORDER BY branch_description ASC, branch_code ASC
    `,
    [customerCode, ...branchScope.params],
  );
}

function shouldUseImportedProjections(selectedBranchCode, branchScopeCode, branchScopeDescription) {
  return !selectedBranchCode && !branchScopeCode && !branchScopeDescription;
}

function buildImportedAnalyticsExpressions(alias = "") {
  return {
    analyticsFilter: buildAnalyticsLineFilter(alias),
    customerActivityFilter: buildCustomerActivityFilter(alias),
    effectiveRevenue: buildEffectiveRevenueExpression(alias),
    effectivePieces: buildEffectivePiecesExpression(alias),
    countInOrderTotals: buildCountInOrderTotalsCase(alias),
  };
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
      const salesTimeRange = normalizeSalesTimeRange(options?.salesTimeRange);
      const useImportedData = await hasImportedData(db);
      const useImportedProjections = shouldUseImportedProjections(
        selectedBranchCode,
        branchScopeCode,
        branchScopeDescription,
      );
      const now = new Date();
      const orderDateWindowFilter = buildDateWindowFilter(now, salesTimeRange, "o.created_at");

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

        const recentOrders = await db.all(
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
            ordered_at: order.ordered_at || order.created_at,
            sent_at: order.sent_at || null,
            notes: order.notes || "",
            total_lines: asInteger(order.total_lines),
            total_pieces: asInteger(order.total_pieces),
            total_net_value: asMoney(order.total_net_value),
            average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
            lines: lines.map((line) => ({
              code: line.code,
              description: line.description,
              qty: asInteger(line.qty_pieces),
              unit_price: asMoney(line.unit_price),
              discount_pct: asRoundedUpPercent(line.discount_pct),
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
            average_days_between_orders: buildAverageDaysBetweenOrders(summaryRecentOrders),
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
          progressive_credit: 0,
          items: [],
        },
          top_products_by_qty: topProductsByQty.map(productStatRow),
          top_products_by_value: topProductsByValue.map(productStatRow),
          recent_orders: recentOrders.map((order) => ({
            order_id: order.order_id,
            created_at: order.created_at,
            ordered_at: order.ordered_at || order.created_at,
            sent_at: order.sent_at || null,
            total_lines: asInteger(order.total_lines),
            total_pieces: asInteger(order.total_pieces),
            total_net_value: asMoney(order.total_net_value),
            average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
          })),
          detailed_orders: detailedOrders,
        };
      }

      const branchScope = buildImportedBranchScopeClause({
        branchCode: branchScopeCode,
        branchDescription: branchScopeDescription,
      });
      const importedLedger = await loadImportedLedgerSnapshot(db, code);
      const importedLedgerLines = importedLedger ? await loadImportedLedgerLines(db, code) : [];
      const availableBranches = await loadImportedCustomerBranches(db, code, {
        branchCode: branchScopeCode,
        branchDescription: branchScopeDescription,
      });
      const importedDataFilter = selectedBranchCode
        ? buildImportedBranchClause(selectedBranchCode)
        : branchScope;
      const importedExpressions = buildImportedAnalyticsExpressions();
      const importedOrderIdExpression = buildImportedOrderIdExpression(sqlDialect);
      const importedLinesDateWindowFilter = buildDateWindowFilter(now, salesTimeRange, "order_date");
      const importedOrdersDateWindowFilter = buildDateWindowFilter(now, salesTimeRange, "created_at");

      const customer = useImportedProjections
        ? await db.get(
            `
              SELECT
                customer_code AS code,
                customer_name AS name,
                ? AS email,
                delivery_code,
                delivery_description,
                NULL AS branch_code,
                NULL AS branch_description
              FROM imported_customers
              WHERE customer_code = ?
            `,
            [importedLedger?.email || null, code],
          )
        : await db.get(
            `
              SELECT
                customer_code AS code,
                COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS name,
                ? AS email,
                MAX(delivery_code) AS delivery_code,
                MAX(delivery_description) AS delivery_description,
                ${selectedBranchCode ? "MAX(branch_code)" : "NULL"} AS branch_code,
                ${selectedBranchCode ? "MAX(branch_description)" : "NULL"} AS branch_description
              FROM imported_sales_lines
              WHERE customer_code = ?
                AND ${importedExpressions.customerActivityFilter}${importedDataFilter.clause}
              GROUP BY customer_code
            `,
            [importedLedger?.email || null, code, ...importedDataFilter.params],
          );

      if (!customer) {
        throw createCustomerNotFoundError(code);
      }

      const summary = useImportedProjections
        ? await db.get(
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
          )
        : await db.get(
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
                  COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS total_pieces,
                  COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS total_net_value
                FROM imported_sales_lines
                WHERE customer_code = ?
                  AND ${importedExpressions.analyticsFilter}${importedDataFilter.clause}
                GROUP BY document_no, order_date
              ) order_totals
            `,
            [code, ...importedDataFilter.params],
          );
      const revenueWindows = useImportedProjections
        ? await loadRevenueWindows(db, "imported_orders", "customer_code", "created_at", code, now)
        : await db.get(
            `
              SELECT
                COALESCE(SUM(CASE WHEN SUBSTR(order_date, 1, 10) >= ? THEN ${importedExpressions.effectiveRevenue} ELSE 0 END), 0) AS revenue_3m,
                COALESCE(SUM(CASE WHEN SUBSTR(order_date, 1, 10) >= ? THEN ${importedExpressions.effectiveRevenue} ELSE 0 END), 0) AS revenue_6m,
                COALESCE(SUM(CASE WHEN SUBSTR(order_date, 1, 10) >= ? THEN ${importedExpressions.effectiveRevenue} ELSE 0 END), 0) AS revenue_12m
              FROM imported_sales_lines
              WHERE customer_code = ?
                AND ${importedExpressions.analyticsFilter}${importedDataFilter.clause}
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
            COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS pieces,
            COUNT(DISTINCT CASE
              WHEN ${importedExpressions.countInOrderTotals} = 1 THEN ${importedOrderIdExpression}
              ELSE NULL
            END) AS orders,
            COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS revenue,
            CASE
              WHEN COALESCE(SUM(${importedExpressions.effectivePieces}), 0) > 0
                THEN COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) / SUM(${importedExpressions.effectivePieces})
              ELSE 0
            END AS avg_unit_price
          FROM imported_sales_lines
          WHERE customer_code = ?
            AND ${importedExpressions.analyticsFilter}${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
          GROUP BY item_code
          ORDER BY item_code ASC
        `,
        [code, ...importedDataFilter.params, ...importedLinesDateWindowFilter.params],
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

      const summaryRecentOrders = useImportedProjections
        ? await db.all(
            `
              SELECT
                order_id,
                document_no,
                created_at,
                ordered_at,
                sent_at,
                total_lines,
                total_pieces,
                total_net_value,
                average_discount_pct
              FROM imported_orders
              WHERE customer_code = ?
                AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
              ORDER BY created_at DESC, document_no DESC
              LIMIT 10
            `,
            [code],
          )
        : await db.all(
            `
              SELECT
                ${importedOrderIdExpression} AS order_id,
                document_no,
                order_date AS created_at,
                MAX(ordered_at) AS ordered_at,
                MAX(sent_at) AS sent_at,
                COUNT(*) AS total_lines,
                COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS total_pieces,
                COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS total_net_value,
                COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct
              FROM imported_sales_lines
              WHERE customer_code = ?
                AND ${importedExpressions.countInOrderTotals} = 1
                AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}
              GROUP BY customer_code, document_no, order_date
              ORDER BY order_date DESC, document_no DESC
              LIMIT 10
            `,
            [code, ...importedDataFilter.params],
          );

      const recentOrders = useImportedProjections
        ? await db.all(
            `
              SELECT
                order_id,
                document_no,
                created_at,
                ordered_at,
                sent_at,
                total_lines,
                total_pieces,
                total_net_value,
                average_discount_pct
              FROM imported_orders
              WHERE customer_code = ?
                AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
                ${importedOrdersDateWindowFilter.clause}
              ORDER BY COALESCE(NULLIF(sent_at, ''), NULLIF(ordered_at, ''), created_at) DESC, document_no DESC
              LIMIT 100
            `,
            [code, ...importedOrdersDateWindowFilter.params],
          )
        : await db.all(
            `
              SELECT
                ${importedOrderIdExpression} AS order_id,
                document_no,
                order_date AS created_at,
                MAX(ordered_at) AS ordered_at,
                MAX(sent_at) AS sent_at,
                COUNT(*) AS total_lines,
                COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS total_pieces,
                COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS total_net_value,
                COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct
              FROM imported_sales_lines
              WHERE customer_code = ?
                AND ${importedExpressions.countInOrderTotals} = 1
                AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
              GROUP BY customer_code, document_no, order_date
              ORDER BY COALESCE(MAX(sent_at), MAX(ordered_at), order_date) DESC, document_no DESC
              LIMIT 100
            `,
            [code, ...importedDataFilter.params, ...importedLinesDateWindowFilter.params],
          );

      const openOrders = useImportedProjections
        ? await db.all(
            `
              SELECT
                open_orders.order_id,
                open_orders.document_no,
                open_orders.created_at,
                open_orders.ordered_at,
                open_orders.sent_at,
                open_orders.total_lines,
                COALESCE(SUM(COALESCE(open_lines.qty_base, 0)), 0) AS total_pieces,
                COALESCE(SUM(COALESCE(open_lines.net_value, 0)), 0) AS total_net_value,
                open_orders.average_discount_pct,
                open_orders.document_type
              FROM imported_open_orders open_orders
              LEFT JOIN imported_sales_lines open_lines
                ON open_lines.customer_code = open_orders.customer_code
               AND open_lines.document_no = open_orders.document_no
               AND open_lines.order_date = open_orders.created_at
               AND COALESCE(open_lines.document_type, '') IN (${OPEN_EXECUTION_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}
              WHERE open_orders.customer_code = ?
                ${importedOrdersDateWindowFilter.clause}
              GROUP BY
                open_orders.order_id,
                open_orders.document_no,
                open_orders.created_at,
                open_orders.ordered_at,
                open_orders.sent_at,
                open_orders.total_lines,
                open_orders.average_discount_pct,
                open_orders.document_type
              ORDER BY
                COALESCE(NULLIF(open_orders.sent_at, ''), NULLIF(open_orders.ordered_at, ''), open_orders.created_at) DESC,
                open_orders.document_no DESC
              LIMIT 100
            `,
            [code, ...importedDataFilter.params, ...importedOrdersDateWindowFilter.params],
          )
        : await db.all(
            `
              SELECT
                pending.order_id,
                pending.document_no,
                pending.created_at,
                pending.ordered_at,
                pending.sent_at,
                pending.total_lines,
                pending.total_pieces,
                pending.total_net_value,
                pending.average_discount_pct,
                pending.document_type
              FROM (
                SELECT
                  ${importedOrderIdExpression} AS order_id,
                  document_no,
                  customer_code,
                  order_date AS created_at,
                  MAX(ordered_at) AS ordered_at,
                  MAX(sent_at) AS sent_at,
                  COUNT(*) AS total_lines,
                  COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
                  COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
                  COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct,
                  MAX(document_type) AS document_type
                FROM imported_sales_lines
                WHERE customer_code = ?
                  AND COALESCE(document_type, '') IN (${OPEN_EXECUTION_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
                GROUP BY customer_code, document_no, order_date
              ) pending
              LEFT JOIN (
                SELECT
                  customer_code,
                  MAX(ordered_at) AS ordered_at,
                  MAX(sent_at) AS sent_at,
                  COUNT(*) AS total_lines,
                  COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct
                FROM imported_sales_lines
                WHERE customer_code = ?
                  AND ${importedExpressions.countInOrderTotals} = 1
                  AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
                GROUP BY customer_code, document_no, order_date
              ) executed
                ON executed.customer_code = pending.customer_code
               AND COALESCE(executed.ordered_at, '') = COALESCE(pending.ordered_at, '')
               AND COALESCE(executed.sent_at, '') = COALESCE(pending.sent_at, '')
               AND executed.total_lines = pending.total_lines
               AND ROUND(executed.average_discount_pct, 2) = ROUND(pending.average_discount_pct, 2)
              WHERE executed.customer_code IS NULL
              ORDER BY COALESCE(pending.sent_at, pending.ordered_at, pending.created_at) DESC, pending.document_no DESC
              LIMIT 100
            `,
            [
              code,
              ...importedDataFilter.params,
              ...importedLinesDateWindowFilter.params,
              code,
              ...importedDataFilter.params,
              ...importedLinesDateWindowFilter.params,
            ],
          );

      const preApprovalOrders = await db.all(
        `
          SELECT
            pending.order_id,
            pending.document_no,
            pending.created_at,
            pending.ordered_at,
            pending.sent_at,
            pending.total_lines,
            pending.total_pieces,
            pending.total_net_value,
            pending.average_discount_pct,
            pending.document_type
          FROM (
            SELECT
              ${importedOrderIdExpression} AS order_id,
              document_no,
              customer_code,
              order_date AS created_at,
              MAX(ordered_at) AS ordered_at,
              MAX(sent_at) AS sent_at,
              COUNT(*) AS total_lines,
              COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
              COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
              COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct,
              MAX(document_type) AS document_type
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND COALESCE(document_type, '') IN (${PRE_APPROVAL_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
            GROUP BY customer_code, document_no, order_date
          ) pending
          LEFT JOIN (
            SELECT
              customer_code,
              MAX(ordered_at) AS ordered_at,
              MAX(sent_at) AS sent_at,
              COUNT(*) AS total_lines,
              COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND (
                COALESCE(document_type, '') IN (${OPEN_EXECUTION_DOCUMENT_TYPES_SQL})
                OR COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
              )${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
            GROUP BY customer_code, document_no, order_date
          ) progressed
            ON progressed.customer_code = pending.customer_code
           AND COALESCE(progressed.ordered_at, '') = COALESCE(pending.ordered_at, '')
           AND COALESCE(progressed.sent_at, '') = COALESCE(pending.sent_at, '')
           AND progressed.total_lines = pending.total_lines
           AND ROUND(progressed.average_discount_pct, 2) = ROUND(pending.average_discount_pct, 2)
          WHERE progressed.customer_code IS NULL
          ORDER BY COALESCE(pending.sent_at, pending.ordered_at, pending.created_at) DESC, pending.document_no DESC
          LIMIT 100
        `,
        [
          code,
          ...importedDataFilter.params,
          ...importedLinesDateWindowFilter.params,
          code,
          ...importedDataFilter.params,
          ...importedLinesDateWindowFilter.params,
        ],
      );

      const detailedOrderHeaders = await db.all(
        `
          SELECT
            ${importedOrderIdExpression} AS order_id,
            document_no,
            order_date AS created_at,
            MAX(ordered_at) AS ordered_at,
            MAX(sent_at) AS sent_at,
            COUNT(*) AS total_lines,
            COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS total_pieces,
            COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS total_net_value,
            COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct
          FROM imported_sales_lines
          WHERE customer_code = ?
            AND ${importedExpressions.countInOrderTotals} = 1
            AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
          GROUP BY customer_code, document_no, order_date
          ORDER BY COALESCE(MAX(sent_at), MAX(ordered_at), order_date) DESC, document_no DESC
          LIMIT 100
        `,
        [code, ...importedDataFilter.params, ...importedLinesDateWindowFilter.params],
      );

      const detailedOrders = [];
      for (const order of detailedOrderHeaders) {
        const lines = await db.all(
          `
            SELECT
              item_code AS code,
              item_description AS description,
              ${importedExpressions.effectivePieces} AS qty,
              unit_price,
              ${IMPORTED_DISCOUNT_PERCENT_EXPRESSION} AS discount_pct,
              ${importedExpressions.effectiveRevenue} AS line_net_value
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND ${importedExpressions.countInOrderTotals} = 1
              AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
              ${importedDataFilter.clause}
              ${importedLinesDateWindowFilter.clause}
              AND document_no = ?
              AND order_date = ?
            ORDER BY item_code ASC
          `,
          [
            code,
            ...importedDataFilter.params,
            ...importedLinesDateWindowFilter.params,
            order.document_no,
            order.created_at,
          ],
        );

        detailedOrders.push({
          order_id: order.order_id,
          created_at: order.created_at,
          ordered_at: order.ordered_at || order.created_at,
          sent_at: order.sent_at || null,
          notes: "",
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
          lines: lines.map((line) => ({
            code: line.code,
            description: line.description,
            qty: asInteger(line.qty),
            unit_price: asMoney(line.unit_price),
            discount_pct: asRoundedUpPercent(line.discount_pct),
            line_net_value: asMoney(line.line_net_value),
          })),
        });
      }

      const detailedOpenOrders = [];
      for (const order of openOrders) {
        const lines = await db.all(
          `
            SELECT
              item_code AS code,
              item_description AS description,
              COALESCE(qty_base, 0) AS qty,
              unit_price,
              ${IMPORTED_DISCOUNT_PERCENT_EXPRESSION} AS discount_pct,
              COALESCE(net_value, 0) AS line_net_value
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND COALESCE(document_type, '') IN (${OPEN_EXECUTION_DOCUMENT_TYPES_SQL})
              ${importedDataFilter.clause}
              ${importedLinesDateWindowFilter.clause}
              AND document_no = ?
              AND order_date = ?
            ORDER BY item_code ASC
          `,
          [
            code,
            ...importedDataFilter.params,
            ...importedLinesDateWindowFilter.params,
            order.document_no,
            order.created_at,
          ],
        );

        detailedOpenOrders.push({
          order_id: order.order_id,
          document_type: order.document_type || "",
          created_at: order.created_at,
          ordered_at: order.ordered_at || order.created_at,
          sent_at: order.sent_at || null,
          notes: "",
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
          lines: lines.map((line) => ({
            code: line.code,
            description: line.description,
            qty: asInteger(line.qty),
            unit_price: asMoney(line.unit_price),
            discount_pct: asRoundedUpPercent(line.discount_pct),
            line_net_value: asMoney(line.line_net_value),
          })),
        });
      }

      const detailedPreApprovalOrders = [];
      for (const order of preApprovalOrders) {
        const lines = await db.all(
          `
            SELECT
              item_code AS code,
              item_description AS description,
              COALESCE(qty_base, 0) AS qty,
              unit_price,
              ${IMPORTED_DISCOUNT_PERCENT_EXPRESSION} AS discount_pct,
              COALESCE(net_value, 0) AS line_net_value
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND COALESCE(document_type, '') IN (${PRE_APPROVAL_DOCUMENT_TYPES_SQL})
              ${importedDataFilter.clause}
              ${importedLinesDateWindowFilter.clause}
              AND document_no = ?
              AND order_date = ?
            ORDER BY item_code ASC
          `,
          [
            code,
            ...importedDataFilter.params,
            ...importedLinesDateWindowFilter.params,
            order.document_no,
            order.created_at,
          ],
        );

        detailedPreApprovalOrders.push({
          order_id: order.order_id,
          document_type: order.document_type || "",
          created_at: order.created_at,
          ordered_at: order.ordered_at || order.created_at,
          sent_at: order.sent_at || null,
          notes: "",
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
          lines: lines.map((line) => ({
            code: line.code,
            description: line.description,
            qty: asInteger(line.qty),
            unit_price: asMoney(line.unit_price),
            discount_pct: asRoundedUpPercent(line.discount_pct),
            line_net_value: asMoney(line.line_net_value),
          })),
        });
      }

      const currentYear = now.getUTCFullYear();
      const previousYear = currentYear - 1;
      const olderYear = currentYear - 2;
      const resolvedMonthlyYearlySeries = await (async () => {
        const series = [];
        for (const year of [olderYear, previousYear, currentYear]) {
          const rows = await db.all(
            `
              SELECT
                order_month AS month,
                COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS revenue,
                COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS pieces
              FROM imported_sales_lines
              WHERE customer_code = ?
                AND order_year = ?
                AND ${importedExpressions.analyticsFilter}${importedDataFilter.clause}
              GROUP BY order_month
              ORDER BY order_month ASC
            `,
            [code, year, ...importedDataFilter.params],
          );
          series.push({ year, months: mergeMonthlyRows(rows) });
        }
        return series;
      })();

      const totalOrders = asInteger(summary.total_orders);
      const totalRevenue = asMoney(summary.total_revenue);

      return {
        customer: {
          code: customer.code,
          name: customer.name,
          email: customer.email || importedLedger?.email || null,
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
          average_days_between_orders: buildAverageDaysBetweenOrders(summaryRecentOrders),
          days_since_last_order: buildDaysSinceLastOrder(summary.last_order_date, now),
          last_order_date: summary.last_order_date,
        },
        monthly_sales: {
            current_year:
            resolvedMonthlyYearlySeries.find((entry) => entry.year === currentYear)?.months ||
            mergeMonthlyRows([]),
          previous_year:
            resolvedMonthlyYearlySeries.find((entry) => entry.year === previousYear)?.months ||
            mergeMonthlyRows([]),
          yearly_series: resolvedMonthlyYearlySeries,
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
          open_balance: asMoney(importedLedger?.ledger_balance),
          overdue_balance: 0,
          progressive_credit: asMoney(importedLedger?.credit),
          total_credit: asMoney(importedLedger?.credit),
          items: importedLedgerLines.map((row) => ({
            document_date: row.document_date || null,
            document_no: row.document_no || "",
            reason: row.reason || "",
            debit: asMoney(row.debit),
            credit: asMoney(row.credit),
            ledger_balance: asMoney(row.ledger_balance),
          })),
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
          ordered_at: order.ordered_at || order.created_at,
          sent_at: order.sent_at || null,
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
        })),
        open_orders: openOrders.map((order) => ({
          order_id: order.order_id,
          document_type: order.document_type || "",
          created_at: order.created_at,
          ordered_at: order.ordered_at || order.created_at,
          sent_at: order.sent_at || null,
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
        })),
        pre_approval_orders: preApprovalOrders.map((order) => ({
          order_id: order.order_id,
          document_type: order.document_type || "",
          created_at: order.created_at,
          ordered_at: order.ordered_at || order.created_at,
          sent_at: order.sent_at || null,
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asRoundedUpPercent(order.average_discount_pct),
        })),
        detailed_orders: detailedOrders,
        detailed_open_orders: detailedOpenOrders,
        detailed_pre_approval_orders: detailedPreApprovalOrders,
      };
    },
  };
}


