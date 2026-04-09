import {
  FACTUAL_LIFECYCLE_RULES,
  buildDocumentTypeSqlList,
} from "../factual-lifecycle.js";
import { IMPORTED_DISCOUNT_PERCENT_EXPRESSION } from "../imported-sales.js";
import {
  asInteger,
  asMoney,
  buildAverageDaysBetweenOrders,
  buildDaysSinceLastOrder,
  createCustomerNotFoundError,
} from "./shared.js";
import {
  buildImportedAnalyticsExpressions,
  buildImportedBranchClause,
  buildImportedBranchScopeClause,
  buildImportedOrderIdExpression,
  buildImportedOrderRefExpression,
  loadImportedCustomerBranches,
  loadImportedLedgerLines,
  loadImportedLedgerSnapshot,
  shouldUseImportedProjections,
} from "./stats-imported-helpers.js";
import {
  buildDetailedOrder,
  buildReceivables,
  buildSummaryOrder,
  mergeMonthlyRows,
} from "./stats-shaping.js";
import {
  buildCutoffDateString,
  buildDateWindowFilter,
  loadRevenueWindows,
} from "./stats-time-range.js";

const EXECUTED_ORDER_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes,
);
const OPEN_EXECUTION_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes,
);
const PRE_APPROVAL_DOCUMENT_TYPES =
  FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes.includes("Ξ Ξ‘Ξ΅")
    ? ["Ξ Ξ‘Ξ΅"]
    : ["Ξ Ξ‘Ξ΅", ...FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes];
const PRE_APPROVAL_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  PRE_APPROVAL_DOCUMENT_TYPES,
);
const PRE_APPROVAL_CLOSURE_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  Array.from(
    new Set([
      ...FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes,
      ...FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes,
      "ΠΑΑ",
    ]),
  ),
);

function buildImportedOpenOrderRefExpression(sqlDialect) {
  if (sqlDialect === "mysql") {
    return "NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(SUBSTRING_INDEX(note_1, ':', -1))), '|', ''), ' ', ''), '.', ''), ':', ''), '')";
  }

  return `NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(
    CASE
      WHEN INSTR(note_1, ':') > 0 THEN SUBSTR(note_1, INSTR(note_1, ':') + 1)
      ELSE note_1
    END
  )), '|', ''), ' ', ''), '.', ''), ':', ''), '')`;
}

export async function loadImportedCustomerStats(context) {
  const {
    db,
    sqlDialect,
    code,
    salesTimeRange,
    now,
    selectedBranchCode,
    branchScopeCode,
    branchScopeDescription,
  } = context;
  const useImportedProjections = shouldUseImportedProjections(
    selectedBranchCode,
    branchScopeCode,
    branchScopeDescription,
  );
  const branchScope = buildImportedBranchScopeClause({
    branchCode: branchScopeCode,
    branchDescription: branchScopeDescription,
  });
  const importedLedger = await loadImportedLedgerSnapshot(db, code);
  const importedLedgerLines = importedLedger
    ? await loadImportedLedgerLines(db, code)
    : [];
  const availableBranches = await loadImportedCustomerBranches(db, code, {
    branchCode: branchScopeCode,
    branchDescription: branchScopeDescription,
  });
  const importedDataFilter = selectedBranchCode
    ? buildImportedBranchClause(selectedBranchCode)
    : branchScope;
  const importedExpressions = buildImportedAnalyticsExpressions();
  const importedOrderIdExpression = buildImportedOrderIdExpression(sqlDialect);
  const importedLinesDateWindowFilter = buildDateWindowFilter(
    now,
    salesTimeRange,
    "order_date",
  );
  const importedOrdersDateWindowFilter = buildDateWindowFilter(
    now,
    salesTimeRange,
    "created_at",
  );

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

  const rangeSummary = useImportedProjections
    ? await db.get(
        `
          SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(total_pieces), 0) AS total_pieces,
            COALESCE(SUM(total_net_value), 0) AS total_revenue
          FROM imported_orders
          WHERE customer_code = ?
            AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
            ${importedOrdersDateWindowFilter.clause}
        `,
        [code, ...importedOrdersDateWindowFilter.params],
      )
    : await db.get(
        `
          SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(total_pieces), 0) AS total_pieces,
            COALESCE(SUM(total_net_value), 0) AS total_revenue
          FROM (
            SELECT
              document_no,
              order_date AS created_at,
              COALESCE(SUM(${importedExpressions.effectivePieces}), 0) AS total_pieces,
              COALESCE(SUM(${importedExpressions.effectiveRevenue}), 0) AS total_net_value
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND ${importedExpressions.countInOrderTotals} = 1
              AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}
              ${importedLinesDateWindowFilter.clause}
            GROUP BY document_no, order_date
          ) executed
        `,
        [
          code,
          ...importedDataFilter.params,
          ...importedLinesDateWindowFilter.params,
        ],
      );

  const revenueWindows = useImportedProjections
    ? await loadRevenueWindows(
        db,
        "imported_orders",
        "customer_code",
        "created_at",
        code,
        now,
      )
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
    [
      code,
      ...importedDataFilter.params,
      ...importedLinesDateWindowFilter.params,
    ],
  );

  const topProductsByQty = [...allProductSales]
    .sort(
      (a, b) =>
        b.pieces - a.pieces ||
        b.revenue - a.revenue ||
        a.code.localeCompare(b.code),
    )
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
    .sort(
      (a, b) =>
        b.revenue - a.revenue ||
        b.pieces - a.pieces ||
        a.code.localeCompare(b.code),
    )
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

  const recentOrdersRows = useImportedProjections
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
        [
          code,
          ...importedDataFilter.params,
          ...importedLinesDateWindowFilter.params,
        ],
      );

  const importedOrderRefExpression =
    buildImportedOrderRefExpression(sqlDialect);
  const importedOpenOrderRefExpression =
    buildImportedOpenOrderRefExpression(sqlDialect);

  const openOrdersRows = useImportedProjections
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
        [
          code,
          ...importedDataFilter.params,
          ...importedOrdersDateWindowFilter.params,
        ],
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
              MAX(document_type) AS document_type,
              MAX(${importedOpenOrderRefExpression}) AS order_ref
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND COALESCE(document_type, '') IN (${OPEN_EXECUTION_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
            GROUP BY customer_code, document_no, order_date
          ) pending
          LEFT JOIN (
            SELECT
              customer_code,
              order_ref,
              MAX(total_lines) AS total_lines,
              MAX(total_pieces) AS total_pieces,
              MAX(total_net_value) AS total_net_value
            FROM (
              SELECT
                customer_code,
                ${importedOpenOrderRefExpression} AS order_ref,
                document_no,
                order_date,
                COUNT(*) AS total_lines,
                COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
                COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value
              FROM imported_sales_lines
              WHERE customer_code = ?
                AND ${importedExpressions.countInOrderTotals} = 1
                AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
                AND ${importedOpenOrderRefExpression} IS NOT NULL${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
              GROUP BY customer_code, ${importedOpenOrderRefExpression}, document_no, order_date
            ) executed_docs
            GROUP BY customer_code, order_ref
          ) executed_by_ref
            ON executed_by_ref.customer_code = pending.customer_code
           AND pending.order_ref IS NOT NULL
           AND pending.order_ref <> ''
           AND executed_by_ref.order_ref = pending.order_ref
           AND executed_by_ref.total_lines >= pending.total_lines
           AND executed_by_ref.total_pieces >= pending.total_pieces
           AND ROUND(executed_by_ref.total_net_value, 2) >= ROUND(pending.total_net_value, 2)
          LEFT JOIN (
            SELECT
              customer_code,
              order_date AS created_at,
              COUNT(*) AS total_lines,
              COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
              COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
              COALESCE(MAX(${importedOpenOrderRefExpression}), '') AS order_ref
            FROM imported_sales_lines
            WHERE customer_code = ?
              AND ${importedExpressions.countInOrderTotals} = 1
              AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
              AND (${importedOpenOrderRefExpression} IS NULL OR ${importedOpenOrderRefExpression} = '')${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
            GROUP BY customer_code, document_no, order_date
          ) executed_no_ref
            ON executed_no_ref.customer_code = pending.customer_code
           AND (pending.order_ref IS NULL OR pending.order_ref = '')
           AND (executed_no_ref.order_ref IS NULL OR executed_no_ref.order_ref = '')
           AND executed_no_ref.created_at = pending.created_at
           AND executed_no_ref.total_lines = pending.total_lines
           AND executed_no_ref.total_pieces = pending.total_pieces
           AND ROUND(executed_no_ref.total_net_value, 2) = ROUND(pending.total_net_value, 2)
          WHERE executed_by_ref.customer_code IS NULL
            AND executed_no_ref.customer_code IS NULL
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
          code,
          ...importedDataFilter.params,
          ...importedLinesDateWindowFilter.params,
        ],
      );

  const preApprovalOrdersRows = await db.all(
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
          MAX(document_type) AS document_type,
          MAX(${importedOrderRefExpression}) AS order_ref
        FROM imported_sales_lines
        WHERE customer_code = ?
          AND COALESCE(document_type, '') IN (${PRE_APPROVAL_DOCUMENT_TYPES_SQL})${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
        GROUP BY customer_code, document_no, order_date
      ) pending
      LEFT JOIN (
        SELECT
          customer_code,
          order_ref,
          COALESCE(MAX(CASE WHEN is_rejection = 0 THEN total_lines END), 0)
            + COALESCE(MAX(CASE WHEN is_rejection = 1 THEN total_lines END), 0) AS total_lines,
          COALESCE(MAX(CASE WHEN is_rejection = 0 THEN total_pieces END), 0)
            + COALESCE(MAX(CASE WHEN is_rejection = 1 THEN total_pieces END), 0) AS total_pieces,
          COALESCE(MAX(CASE WHEN is_rejection = 0 THEN total_net_value END), 0)
            + COALESCE(MAX(CASE WHEN is_rejection = 1 THEN total_net_value END), 0) AS total_net_value
        FROM (
          SELECT
            customer_code,
            ${importedOrderRefExpression} AS order_ref,
            document_no,
            order_date,
            CASE WHEN MAX(COALESCE(document_type, '')) = 'ΠΑΑ' THEN 1 ELSE 0 END AS is_rejection,
            COUNT(*) AS total_lines,
            COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
            COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value
          FROM imported_sales_lines
          WHERE customer_code = ?
            AND COALESCE(document_type, '') IN (${PRE_APPROVAL_CLOSURE_DOCUMENT_TYPES_SQL})
            AND ${importedOrderRefExpression} IS NOT NULL${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
          GROUP BY customer_code, ${importedOrderRefExpression}, document_no, order_date
        ) progressed_docs
        GROUP BY customer_code, order_ref
      ) progressed_by_ref
        ON progressed_by_ref.customer_code = pending.customer_code
       AND (
         (
           pending.order_ref IS NOT NULL
           AND pending.order_ref <> ''
           AND progressed_by_ref.order_ref = pending.order_ref
           AND progressed_by_ref.total_lines >= pending.total_lines
           AND progressed_by_ref.total_pieces >= pending.total_pieces
           AND ROUND(progressed_by_ref.total_net_value, 2) >= ROUND(pending.total_net_value, 2)
         )
       )
      LEFT JOIN (
        SELECT
          customer_code,
          order_date AS created_at,
          COUNT(*) AS total_lines,
          COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
          COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
          COALESCE(MAX(${importedOrderRefExpression}), '') AS order_ref
        FROM imported_sales_lines
        WHERE customer_code = ?
          AND COALESCE(document_type, '') IN (${PRE_APPROVAL_CLOSURE_DOCUMENT_TYPES_SQL})
          AND (${importedOrderRefExpression} IS NULL OR ${importedOrderRefExpression} = '')${importedDataFilter.clause}${importedLinesDateWindowFilter.clause}
        GROUP BY customer_code, document_no, order_date
      ) progressed_no_ref
        ON progressed_no_ref.customer_code = pending.customer_code
       AND (
         ((pending.order_ref IS NULL OR pending.order_ref = '') AND (progressed_no_ref.order_ref IS NULL OR progressed_no_ref.order_ref = ''))
         AND progressed_no_ref.created_at = pending.created_at
         AND progressed_no_ref.total_lines = pending.total_lines
         AND progressed_no_ref.total_pieces = pending.total_pieces
         AND ROUND(progressed_no_ref.total_net_value, 2) = ROUND(pending.total_net_value, 2)
       )
      WHERE progressed_by_ref.customer_code IS NULL
        AND progressed_no_ref.customer_code IS NULL
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
    [
      code,
      ...importedDataFilter.params,
      ...importedLinesDateWindowFilter.params,
    ],
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
          ${importedExpressions.effectiveRevenue} AS line_net_value,
          COALESCE(progress_step, '') AS progress_step,
          COALESCE(progress_step_description, '') AS progress_step_description
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

    detailedOrders.push(buildDetailedOrder(order, lines, { notes: "" }));
  }

  const detailedOpenOrders = [];
  for (const order of openOrdersRows) {
    const lines = await db.all(
      `
        SELECT
          item_code AS code,
          item_description AS description,
          COALESCE(qty_base, 0) AS qty,
          unit_price,
          ${IMPORTED_DISCOUNT_PERCENT_EXPRESSION} AS discount_pct,
          COALESCE(net_value, 0) AS line_net_value,
          COALESCE(progress_step, '') AS progress_step,
          COALESCE(progress_step_description, '') AS progress_step_description
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

    detailedOpenOrders.push(
      buildDetailedOrder(order, lines, {
        notes: "",
        document_type: order.document_type || "",
      }),
    );
  }

  const detailedPreApprovalOrders = [];
  for (const order of preApprovalOrdersRows) {
    const lines = await db.all(
      `
        SELECT
          item_code AS code,
          item_description AS description,
          COALESCE(qty_base, 0) AS qty,
          unit_price,
          ${IMPORTED_DISCOUNT_PERCENT_EXPRESSION} AS discount_pct,
          COALESCE(net_value, 0) AS line_net_value,
          COALESCE(progress_step, '') AS progress_step,
          COALESCE(progress_step_description, '') AS progress_step_description
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

    detailedPreApprovalOrders.push(
      buildDetailedOrder(order, lines, {
        notes: "",
        document_type: order.document_type || "",
      }),
    );
  }

  const currentYear = now.getUTCFullYear();
  const previousYear = currentYear - 1;
  const olderYear = currentYear - 2;
  const yearlySeries = [];
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
    yearlySeries.push({ year, months: mergeMonthlyRows(rows) });
  }

  const totalOrders = asInteger(summary.total_orders);
  const totalRevenue = asMoney(summary.total_revenue);

  return {
    customer: {
      code: customer.code,
      name: customer.name,
      email: customer.email || importedLedger?.email || null,
      aggregation_level: selectedBranchCode ? "branch" : "customer",
      branch_code: selectedBranchCode
        ? customer.branch_code || selectedBranchCode
        : null,
      branch_description: selectedBranchCode
        ? customer.branch_description || null
        : null,
    },
    summary: {
      total_orders: totalOrders,
      total_pieces: asInteger(summary.total_pieces),
      total_revenue: totalRevenue,
      revenue_3m: asMoney(revenueWindows.revenue_3m),
      revenue_6m: asMoney(revenueWindows.revenue_6m),
      revenue_12m: asMoney(revenueWindows.revenue_12m),
      average_order_value: totalOrders
        ? asMoney(totalRevenue / totalOrders)
        : 0,
      average_days_between_orders:
        buildAverageDaysBetweenOrders(summaryRecentOrders),
      days_since_last_order: buildDaysSinceLastOrder(
        summary.last_order_date,
        now,
      ),
      last_order_date: summary.last_order_date,
    },
    rangeSummary: {
      total_orders: asInteger(rangeSummary?.total_orders),
      total_pieces: asInteger(rangeSummary?.total_pieces),
      total_revenue: asMoney(rangeSummary?.total_revenue),
    },
    monthlySales: {
      current_year:
        yearlySeries.find((entry) => entry.year === currentYear)?.months ||
        mergeMonthlyRows([]),
      previous_year:
        yearlySeries.find((entry) => entry.year === previousYear)?.months ||
        mergeMonthlyRows([]),
      yearly_series: yearlySeries,
    },
    productSales: {
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
    receivables: buildReceivables(importedLedger, importedLedgerLines),
    topProductsByQty: topProductsByQty,
    topProductsByValue: topProductsByValue,
    availableBranches,
    recentOrders: recentOrdersRows.map(buildSummaryOrder),
    openOrders: openOrdersRows.map(buildSummaryOrder),
    preApprovalOrders: preApprovalOrdersRows.map(buildSummaryOrder),
    detailedOrders,
    detailedOpenOrders,
    detailedPreApprovalOrders,
  };
}
