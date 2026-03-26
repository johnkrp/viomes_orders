import {
  buildAnalyticsLineFilter,
  buildCountInOrderTotalsCase,
  buildCustomerActivityFilter,
  buildEffectivePiecesExpression,
  buildEffectiveRevenueExpression,
  buildKnownDocumentTypesSqlList,
} from "./document-type-rules.js";
import {
  FACTUAL_LIFECYCLE_RULES,
  buildDocumentTypeSqlList,
} from "./factual-lifecycle.js";

export const IMPORTED_DISCOUNT_PERCENT_EXPRESSION = `
  CASE
    WHEN COALESCE(discount_pct_total, 0) <> 0 THEN discount_pct_total
    WHEN COALESCE(qty_base, 0) > 0 AND COALESCE(unit_price, 0) > 0 THEN
      CASE
        WHEN (100 - ((ABS(net_value) / (ABS(qty_base) * ABS(unit_price))) * 100)) < 0 THEN 0
        WHEN (100 - ((ABS(net_value) / (ABS(qty_base) * ABS(unit_price))) * 100)) > 100 THEN 100
        ELSE (100 - ((ABS(net_value) / (ABS(qty_base) * ABS(unit_price))) * 100))
      END
    ELSE 0
  END
`.trim();

export const IMPORTED_SALES_ARCHITECTURE = Object.freeze({
  operationalTables: ["products", "admin_users", "admin_sessions"],
  ingestionTables: ["import_runs", "imported_sales_lines"],
  projectionTables: [
    "imported_customers",
    "imported_customer_branches",
    "imported_orders",
    "imported_open_orders",
    "imported_monthly_sales",
    "imported_product_sales",
    "customers[source='entersoft_import']",
  ],
  legacyDormantTables: [
    "orders",
    "order_lines",
    "customer_receivables",
    "customers[source!='entersoft_import']",
  ],
  rawFactTable: "imported_sales_lines",
  projectionStrategy: "truncate_and_recompute",
});

export const DUPLICATE_GROUP_BY = `
  order_date,
  document_no,
  document_type,
  item_code,
  item_description,
  unit_code,
  qty,
  qty_base,
  unit_price,
  net_value,
  customer_code,
  customer_name,
  delivery_code,
  delivery_description,
  account_code,
  account_description,
  branch_code,
  branch_description,
  note_1
`;

export const DUPLICATE_SUMMARY_SQL = `
  SELECT
    COUNT(*) AS duplicate_groups,
    COALESCE(SUM(group_size - 1), 0) AS duplicate_rows
  FROM (
    SELECT COUNT(*) AS group_size
    FROM imported_sales_lines
    GROUP BY ${DUPLICATE_GROUP_BY}
    HAVING COUNT(*) > 1
  ) duplicate_groups
`;

export const DUPLICATE_SAMPLE_SQL = `
  SELECT
    order_date,
    document_no,
    customer_code,
    item_code,
    COUNT(*) AS copies,
    GROUP_CONCAT(DISTINCT source_file ORDER BY source_file SEPARATOR ', ') AS files
  FROM imported_sales_lines
  GROUP BY ${DUPLICATE_GROUP_BY}
  HAVING COUNT(*) > 1
  ORDER BY copies DESC, order_date DESC, document_no, item_code
  LIMIT 10
`;

export const IMPORTED_ORDER_COLLISIONS_SQL = `
  SELECT
    document_no,
    customer_code,
    created_at,
    COUNT(*) AS copies
  FROM imported_orders
  GROUP BY document_no, customer_code, created_at
  HAVING COUNT(*) > 1
  ORDER BY created_at DESC, document_no, customer_code
  LIMIT 10
`;

export const MISSING_MIRRORED_CUSTOMERS_SQL = `
  SELECT COUNT(*) AS missing_mirrors
  FROM (
    SELECT customer_code
    FROM imported_customers
    UNION
    SELECT customer_code
    FROM imported_customer_ledgers
  ) imported_customer_sources
  LEFT JOIN customers c
    ON c.code = imported_customer_sources.customer_code
   AND c.source = 'entersoft_import'
  WHERE c.code IS NULL
`;

export const ORPHAN_MIRRORED_CUSTOMERS_SQL = `
  SELECT COUNT(*) AS orphan_mirrors
  FROM customers c
  LEFT JOIN (
    SELECT customer_code
    FROM imported_customers
    UNION
    SELECT customer_code
    FROM imported_customer_ledgers
  ) imported_customer_sources
    ON imported_customer_sources.customer_code = c.code
  WHERE c.source = 'entersoft_import'
    AND imported_customer_sources.customer_code IS NULL
`;

export const IMPORTED_ORDER_CARDINALITY_SQL = `
  SELECT
    (SELECT COUNT(*) FROM imported_orders) AS imported_orders_count,
    (
      SELECT COUNT(*)
      FROM (
        SELECT document_no, customer_code, order_date
        FROM imported_sales_lines
        WHERE ${buildCountInOrderTotalsCase()} = 1
        GROUP BY document_no, customer_code, order_date
      ) grouped_orders
    ) AS grouped_orders_count
`;

export const IMPORTED_PRODUCT_CARDINALITY_SQL = `
  SELECT
    (SELECT COUNT(*) FROM imported_product_sales) AS imported_product_sales_count,
    (
      SELECT COUNT(*)
      FROM (
        SELECT customer_code, item_code
        FROM imported_sales_lines
        WHERE ${buildAnalyticsLineFilter()}
        GROUP BY customer_code, item_code
      ) grouped_products
    ) AS grouped_products_count
`;

export const IMPORTED_MONTHLY_CARDINALITY_SQL = `
  SELECT
    (SELECT COUNT(*) FROM imported_monthly_sales) AS imported_monthly_sales_count,
    (
      SELECT COUNT(*)
      FROM (
        SELECT customer_code, order_year, order_month
        FROM imported_sales_lines
        WHERE ${buildAnalyticsLineFilter()}
        GROUP BY customer_code, order_year, order_month
      ) grouped_months
    ) AS grouped_months_count
`;

export const LATEST_IMPORT_RUN_SQL = `
  SELECT
    id,
    dataset,
    file_name,
    import_mode,
    status,
    started_at,
    finished_at,
    source_row_count,
    rows_in,
    rows_upserted,
    rows_skipped_duplicate,
    rows_rejected,
    rebuild_started_at,
    rebuild_finished_at,
    schema_version,
    trigger_source,
    source_checksum
  FROM import_runs
  ORDER BY id DESC
  LIMIT 1
`;

export const UNKNOWN_DOCUMENT_TYPES_SQL = `
  SELECT
    document_type,
    COUNT(*) AS rows_count
  FROM imported_sales_lines
  WHERE COALESCE(document_type, '') <> ''
    AND document_type NOT IN (${buildKnownDocumentTypesSqlList()})
  GROUP BY document_type
  ORDER BY rows_count DESC, document_type ASC
`;

export const IMPORTED_CUSTOMER_BRANCHES_COUNT_SQL = `
  SELECT COUNT(*) AS imported_customer_branches_count
  FROM imported_customer_branches
`;

export const IMPORTED_SALES_LINES_COUNT_SQL = `
  SELECT COUNT(*) AS imported_sales_lines_count
  FROM imported_sales_lines
`;

export const REBUILD_IMPORTED_CUSTOMER_BRANCHES_SQL = `
  INSERT INTO imported_customer_branches(
    customer_code,
    customer_name,
    branch_code,
    branch_description,
    orders,
    revenue,
    last_order_date,
    source_file
  )
  SELECT
    customer_code,
    COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS customer_name,
    COALESCE(branch_code, '') AS branch_code,
    COALESCE(MAX(branch_description), '') AS branch_description,
    COUNT(DISTINCT CASE
      WHEN ${buildCountInOrderTotalsCase()} = 1 THEN CONCAT(customer_code, '::', order_date, '::', document_no)
      ELSE NULL
    END) AS orders,
    COALESCE(SUM(${buildEffectiveRevenueExpression()}), 0) AS revenue,
    MAX(CASE
      WHEN ${buildCustomerActivityFilter()} THEN order_date
      ELSE NULL
    END) AS last_order_date,
    MAX(source_file) AS source_file
  FROM imported_sales_lines
  WHERE ${buildCustomerActivityFilter()}
  GROUP BY customer_code, COALESCE(branch_code, '')
  ON DUPLICATE KEY UPDATE
    customer_name = VALUES(customer_name),
    branch_description = VALUES(branch_description),
    orders = VALUES(orders),
    revenue = VALUES(revenue),
    last_order_date = VALUES(last_order_date),
    source_file = VALUES(source_file)
`;

const OPEN_ORDER_REF_EXPRESSION =
  "NULLIF(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(SUBSTRING_INDEX(note_1, ':', -1))), '|', ''), ' ', ''), '.', ''), ':', ''), '')";

const OPEN_EXECUTION_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes,
);
const EXECUTED_ORDER_DOCUMENT_TYPES_SQL = buildDocumentTypeSqlList(
  FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes,
);

export const REBUILD_IMPORTED_OPEN_ORDERS_SQL = `
  INSERT INTO imported_open_orders(
    order_id,
    document_no,
    customer_code,
    customer_name,
    created_at,
    total_lines,
    total_pieces,
    total_net_value,
    average_discount_pct,
    ordered_at,
    sent_at,
    document_type,
    delivery_code,
    delivery_description,
    source_file
  )
  SELECT
    pending.order_id,
    pending.document_no,
    pending.customer_code,
    pending.customer_name,
    pending.created_at,
    pending.total_lines,
    pending.total_pieces,
    pending.total_net_value,
    pending.average_discount_pct,
    pending.ordered_at,
    pending.sent_at,
    pending.document_type,
    pending.delivery_code,
    pending.delivery_description,
    pending.source_file
  FROM (
    SELECT
      CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
      document_no,
      customer_code,
      MAX(customer_name) AS customer_name,
      order_date AS created_at,
      COUNT(*) AS total_lines,
      COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
      COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value,
      COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct,
      MAX(ordered_at) AS ordered_at,
      MAX(sent_at) AS sent_at,
      MAX(document_type) AS document_type,
      MAX(${OPEN_ORDER_REF_EXPRESSION}) AS order_ref,
      MAX(delivery_code) AS delivery_code,
      MAX(delivery_description) AS delivery_description,
      MAX(source_file) AS source_file
    FROM imported_sales_lines
    WHERE COALESCE(document_type, '') IN (${OPEN_EXECUTION_DOCUMENT_TYPES_SQL})
    GROUP BY document_no, customer_code, order_date
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
        ${OPEN_ORDER_REF_EXPRESSION} AS order_ref,
        document_no,
        order_date,
        COUNT(*) AS total_lines,
        COALESCE(SUM(COALESCE(qty_base, 0)), 0) AS total_pieces,
        COALESCE(SUM(COALESCE(net_value, 0)), 0) AS total_net_value
      FROM imported_sales_lines
      WHERE ${buildCountInOrderTotalsCase()} = 1
        AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
        AND ${OPEN_ORDER_REF_EXPRESSION} IS NOT NULL
      GROUP BY customer_code, ${OPEN_ORDER_REF_EXPRESSION}, document_no, order_date
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
      COALESCE(MAX(${OPEN_ORDER_REF_EXPRESSION}), '') AS order_ref
    FROM imported_sales_lines
    WHERE ${buildCountInOrderTotalsCase()} = 1
      AND COALESCE(document_type, '') IN (${EXECUTED_ORDER_DOCUMENT_TYPES_SQL})
      AND (${OPEN_ORDER_REF_EXPRESSION} IS NULL OR ${OPEN_ORDER_REF_EXPRESSION} = '')
    GROUP BY document_no, customer_code, order_date
  ) executed_no_ref
    ON executed_no_ref.customer_code = pending.customer_code
   AND (pending.order_ref IS NULL OR pending.order_ref = '')
   AND (executed_no_ref.order_ref IS NULL OR executed_no_ref.order_ref = '')
   AND COALESCE(executed_no_ref.created_at, '') = COALESCE(pending.created_at, '')
   AND executed_no_ref.total_lines = pending.total_lines
   AND executed_no_ref.total_pieces = pending.total_pieces
   AND ROUND(executed_no_ref.total_net_value, 2) = ROUND(pending.total_net_value, 2)
  WHERE executed_by_ref.customer_code IS NULL
    AND executed_no_ref.customer_code IS NULL
`;

export const PREVIEW_DUPLICATES_SQL = `
  SELECT
    COUNT(*) AS duplicate_groups,
    COALESCE(SUM(group_size - 1), 0) AS duplicate_rows_to_delete
  FROM (
    SELECT COUNT(*) AS group_size
    FROM imported_sales_lines
    GROUP BY ${DUPLICATE_GROUP_BY}
    HAVING COUNT(*) > 1
  ) duplicate_groups
`;

export const SAMPLE_DUPLICATES_SQL = `
  SELECT
    order_date,
    document_no,
    customer_code,
    item_code,
    COUNT(*) AS copies,
    GROUP_CONCAT(source_file ORDER BY source_file SEPARATOR ', ') AS source_files
  FROM imported_sales_lines
  GROUP BY ${DUPLICATE_GROUP_BY}
  HAVING COUNT(*) > 1
  ORDER BY copies DESC, order_date DESC, document_no, item_code
  LIMIT 10
`;

export const DELETE_DUPLICATES_SQL = `
  DELETE duplicate_row
  FROM imported_sales_lines duplicate_row
  JOIN imported_sales_lines keeper
    ON keeper.id < duplicate_row.id
   AND keeper.order_date = duplicate_row.order_date
   AND keeper.document_no = duplicate_row.document_no
   AND keeper.document_type <=> duplicate_row.document_type
   AND keeper.item_code = duplicate_row.item_code
   AND keeper.item_description = duplicate_row.item_description
   AND keeper.unit_code <=> duplicate_row.unit_code
   AND keeper.qty = duplicate_row.qty
   AND keeper.qty_base = duplicate_row.qty_base
   AND keeper.unit_price = duplicate_row.unit_price
   AND keeper.net_value = duplicate_row.net_value
   AND keeper.customer_code = duplicate_row.customer_code
   AND keeper.customer_name = duplicate_row.customer_name
   AND keeper.delivery_code <=> duplicate_row.delivery_code
   AND keeper.delivery_description <=> duplicate_row.delivery_description
   AND keeper.account_code <=> duplicate_row.account_code
   AND keeper.account_description <=> duplicate_row.account_description
   AND keeper.branch_code <=> duplicate_row.branch_code
   AND keeper.branch_description <=> duplicate_row.branch_description
   AND keeper.note_1 <=> duplicate_row.note_1
`;

export async function ensureImportedCustomerBranchProjection(db) {
  const [branchCountRow, salesLineCountRow] = await Promise.all([
    db.get(IMPORTED_CUSTOMER_BRANCHES_COUNT_SQL),
    db.get(IMPORTED_SALES_LINES_COUNT_SQL),
  ]);

  const branchCount = Number(
    branchCountRow?.imported_customer_branches_count || 0,
  );
  const salesLineCount = Number(
    salesLineCountRow?.imported_sales_lines_count || 0,
  );

  if (branchCount > 0 || salesLineCount === 0) {
    return {
      repaired: false,
      branch_count: branchCount,
      sales_line_count: salesLineCount,
    };
  }

  await db.run("DELETE FROM imported_customer_branches");
  await db.run(REBUILD_IMPORTED_CUSTOMER_BRANCHES_SQL);

  const repairedCountRow = await db.get(IMPORTED_CUSTOMER_BRANCHES_COUNT_SQL);

  return {
    repaired: true,
    branch_count: Number(
      repairedCountRow?.imported_customer_branches_count || 0,
    ),
    sales_line_count: salesLineCount,
  };
}

export async function rebuildImportedSalesData(db) {
  await db.run("DELETE FROM imported_orders");
  await db.run("DELETE FROM imported_open_orders");
  await db.run("DELETE FROM imported_monthly_sales");
  await db.run("DELETE FROM imported_product_sales");
  await db.run("DELETE FROM imported_customer_branches");
  await db.run("DELETE FROM imported_customers");
  await db.run("DELETE FROM customers WHERE source = 'entersoft_import'");

  await db.run(REBUILD_IMPORTED_CUSTOMER_BRANCHES_SQL);

  await db.run(`
    INSERT INTO imported_customers(
      customer_code,
      customer_name,
      delivery_code,
      delivery_description,
      branch_code,
      branch_description,
      source_file
    )
    SELECT
      customer_code,
      COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS customer_name,
      MAX(delivery_code) AS delivery_code,
      MAX(delivery_description) AS delivery_description,
      MAX(branch_code) AS branch_code,
      MAX(branch_description) AS branch_description,
      MAX(source_file) AS source_file
    FROM imported_sales_lines
    WHERE ${buildCustomerActivityFilter()}
    GROUP BY customer_code
  `);

  await db.run(`
    INSERT INTO customers(code, name, email, source)
    SELECT customer_code, customer_name, NULL, 'entersoft_import'
    FROM imported_customers
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      email = VALUES(email),
      source = VALUES(source)
  `);

  await db.run(`
    INSERT INTO imported_orders(
      order_id,
      document_no,
      customer_code,
      customer_name,
      created_at,
      total_lines,
      total_pieces,
      total_net_value,
      average_discount_pct,
      ordered_at,
      sent_at,
      document_type,
      delivery_code,
      delivery_description,
      source_file
    )
    SELECT
      CONCAT(customer_code, '::', order_date, '::', document_no) AS order_id,
      document_no,
      customer_code,
      MAX(customer_name),
      order_date,
      COUNT(*) AS total_lines,
      COALESCE(SUM(${buildEffectivePiecesExpression()}), 0) AS total_pieces,
      COALESCE(SUM(${buildEffectiveRevenueExpression()}), 0) AS total_net_value,
      COALESCE(AVG(${IMPORTED_DISCOUNT_PERCENT_EXPRESSION}), 0) AS average_discount_pct,
      MAX(ordered_at),
      MAX(sent_at),
      MAX(document_type),
      MAX(delivery_code),
      MAX(delivery_description),
      MAX(source_file)
    FROM imported_sales_lines
    WHERE ${buildCountInOrderTotalsCase()} = 1
    GROUP BY document_no, customer_code, order_date
  `);

  await db.run(REBUILD_IMPORTED_OPEN_ORDERS_SQL);

  await db.run(`
    INSERT INTO imported_monthly_sales(customer_code, order_year, order_month, revenue, pieces)
    SELECT
      customer_code,
      order_year,
      order_month,
      COALESCE(SUM(${buildEffectiveRevenueExpression()}), 0) AS revenue,
      COALESCE(SUM(${buildEffectivePiecesExpression()}), 0) AS pieces
    FROM imported_sales_lines
    WHERE ${buildAnalyticsLineFilter()}
    GROUP BY customer_code, order_year, order_month
  `);

  await db.run(`
    INSERT INTO imported_product_sales(
      customer_code,
      item_code,
      item_description,
      revenue,
      pieces,
      orders,
      avg_unit_price
    )
    SELECT
      customer_code,
      item_code,
      MAX(item_description),
      COALESCE(SUM(${buildEffectiveRevenueExpression()}), 0) AS revenue,
      COALESCE(SUM(${buildEffectivePiecesExpression()}), 0) AS pieces,
      COUNT(DISTINCT CASE
        WHEN ${buildCountInOrderTotalsCase()} = 1 THEN CONCAT(customer_code, '::', order_date, '::', document_no)
        ELSE NULL
      END) AS orders,
      CASE
        WHEN COALESCE(SUM(${buildEffectivePiecesExpression()}), 0) > 0
          THEN COALESCE(SUM(${buildEffectiveRevenueExpression()}), 0) / SUM(${buildEffectivePiecesExpression()})
        ELSE 0
      END AS avg_unit_price
    FROM imported_sales_lines
    WHERE ${buildAnalyticsLineFilter()}
    GROUP BY customer_code, item_code
  `);
}

export async function getImportedSalesProjectionHealth(db) {
  const [
    duplicateSummary,
    importedOrderCollisions,
    missingMirrorsRow,
    orphanMirrorsRow,
    orderCardinality,
    productCardinality,
    monthlyCardinality,
    latestImportRun,
    unknownDocumentTypes,
  ] = await Promise.all([
    db.get(DUPLICATE_SUMMARY_SQL),
    db.all(IMPORTED_ORDER_COLLISIONS_SQL),
    db.get(MISSING_MIRRORED_CUSTOMERS_SQL),
    db.get(ORPHAN_MIRRORED_CUSTOMERS_SQL),
    db.get(IMPORTED_ORDER_CARDINALITY_SQL),
    db.get(IMPORTED_PRODUCT_CARDINALITY_SQL),
    db.get(IMPORTED_MONTHLY_CARDINALITY_SQL),
    db.get(LATEST_IMPORT_RUN_SQL),
    db.all(UNKNOWN_DOCUMENT_TYPES_SQL),
  ]);

  const duplicateGroups = Number(duplicateSummary?.duplicate_groups || 0);
  const duplicateRows = Number(duplicateSummary?.duplicate_rows || 0);
  const importedOrderCollisionGroups = importedOrderCollisions.length;
  const missingMirrors = Number(missingMirrorsRow?.missing_mirrors || 0);
  const orphanMirrors = Number(orphanMirrorsRow?.orphan_mirrors || 0);
  const importedOrdersCount = Number(
    orderCardinality?.imported_orders_count || 0,
  );
  const groupedOrdersCount = Number(
    orderCardinality?.grouped_orders_count || 0,
  );
  const importedProductSalesCount = Number(
    productCardinality?.imported_product_sales_count || 0,
  );
  const groupedProductsCount = Number(
    productCardinality?.grouped_products_count || 0,
  );
  const importedMonthlySalesCount = Number(
    monthlyCardinality?.imported_monthly_sales_count || 0,
  );
  const groupedMonthsCount = Number(
    monthlyCardinality?.grouped_months_count || 0,
  );
  const unmappedDocumentTypes = unknownDocumentTypes.map((row) => ({
    document_type: row.document_type,
    rows_count: Number(row.rows_count || 0),
  }));

  return {
    ok:
      duplicateGroups === 0 &&
      importedOrderCollisionGroups === 0 &&
      missingMirrors === 0 &&
      orphanMirrors === 0 &&
      unmappedDocumentTypes.length === 0 &&
      importedOrdersCount === groupedOrdersCount &&
      importedProductSalesCount === groupedProductsCount &&
      importedMonthlySalesCount === groupedMonthsCount,
    architecture: IMPORTED_SALES_ARCHITECTURE,
    invariants: {
      duplicate_groups: duplicateGroups,
      duplicate_rows: duplicateRows,
      imported_order_collision_groups: importedOrderCollisionGroups,
      missing_mirrors: missingMirrors,
      orphan_mirrors: orphanMirrors,
      unmapped_document_types: unmappedDocumentTypes,
      imported_orders_match_grouped_sales:
        importedOrdersCount === groupedOrdersCount,
      imported_product_sales_match_grouped_sales:
        importedProductSalesCount === groupedProductsCount,
      imported_monthly_sales_match_grouped_sales:
        importedMonthlySalesCount === groupedMonthsCount,
      imported_orders_count: importedOrdersCount,
      grouped_orders_count: groupedOrdersCount,
      imported_product_sales_count: importedProductSalesCount,
      grouped_products_count: groupedProductsCount,
      imported_monthly_sales_count: importedMonthlySalesCount,
      grouped_months_count: groupedMonthsCount,
    },
    latest_import_run: latestImportRun
      ? {
          id: latestImportRun.id,
          dataset: latestImportRun.dataset,
          file_name: latestImportRun.file_name,
          import_mode: latestImportRun.import_mode,
          status: latestImportRun.status,
          started_at: latestImportRun.started_at,
          finished_at: latestImportRun.finished_at,
          source_row_count: Number(latestImportRun.source_row_count || 0),
          rows_in: Number(latestImportRun.rows_in || 0),
          rows_upserted: Number(latestImportRun.rows_upserted || 0),
          rows_skipped_duplicate: Number(
            latestImportRun.rows_skipped_duplicate || 0,
          ),
          rows_rejected: Number(latestImportRun.rows_rejected || 0),
          rebuild_started_at: latestImportRun.rebuild_started_at,
          rebuild_finished_at: latestImportRun.rebuild_finished_at,
          schema_version: latestImportRun.schema_version,
          trigger_source: latestImportRun.trigger_source,
          source_checksum: latestImportRun.source_checksum,
        }
      : null,
  };
}
