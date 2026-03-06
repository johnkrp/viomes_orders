import { openDatabase } from "../lib/db/client.js";

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [rawKey, ...rest] = token.slice(2).split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim();
    if (!key) continue;
    args[key] = value || "true";
  }
  return args;
}

function buildEnv(cli) {
  return {
    ...process.env,
    DB_CLIENT: "mysql",
    MYSQL_HOST: cli["mysql-host"] || process.env.MYSQL_HOST,
    MYSQL_PORT: cli["mysql-port"] || process.env.MYSQL_PORT,
    MYSQL_DATABASE: cli["mysql-database"] || process.env.MYSQL_DATABASE,
    MYSQL_USER: cli["mysql-user"] || process.env.MYSQL_USER,
    MYSQL_PASSWORD: cli["mysql-password"] || process.env.MYSQL_PASSWORD,
  };
}

const DUPLICATE_GROUP_BY = `
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

const PREVIEW_DUPLICATES_SQL = `
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

const SAMPLE_DUPLICATES_SQL = `
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

const DELETE_DUPLICATES_SQL = `
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

async function rebuildImportedSalesData(db) {
  await db.run("DELETE FROM imported_orders");
  await db.run("DELETE FROM imported_monthly_sales");
  await db.run("DELETE FROM imported_product_sales");
  await db.run("DELETE FROM imported_customers");
  await db.run("DELETE FROM customers WHERE source = 'entersoft_import'");

  await db.run(`
    INSERT INTO imported_customers(
      customer_code,
      customer_name,
      delivery_code,
      delivery_description,
      source_file
    )
    SELECT
      customer_code,
      COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS customer_name,
      MAX(delivery_code) AS delivery_code,
      MAX(delivery_description) AS delivery_description,
      MAX(source_file) AS source_file
    FROM imported_sales_lines
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
      COALESCE(SUM(qty_base), 0) AS total_pieces,
      COALESCE(SUM(net_value), 0) AS total_net_value,
      0 AS average_discount_pct,
      MAX(document_type),
      MAX(delivery_code),
      MAX(delivery_description),
      MAX(source_file)
    FROM imported_sales_lines
    GROUP BY document_no, customer_code, order_date
  `);

  await db.run(`
    INSERT INTO imported_monthly_sales(customer_code, order_year, order_month, revenue, pieces)
    SELECT
      customer_code,
      order_year,
      order_month,
      COALESCE(SUM(net_value), 0) AS revenue,
      COALESCE(SUM(qty_base), 0) AS pieces
    FROM imported_sales_lines
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
      COALESCE(SUM(net_value), 0) AS revenue,
      COALESCE(SUM(qty_base), 0) AS pieces,
      COUNT(DISTINCT CONCAT(customer_code, '::', order_date, '::', document_no)) AS orders,
      CASE
        WHEN COALESCE(SUM(qty_base), 0) > 0 THEN COALESCE(SUM(net_value), 0) / SUM(qty_base)
        ELSE 0
      END AS avg_unit_price
    FROM imported_sales_lines
    GROUP BY customer_code, item_code
  `);
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const env = buildEnv(cli);
  const required = ["MYSQL_DATABASE", "MYSQL_USER"];
  const missing = required.filter((key) => !String(env[key] || "").trim());
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Provide --mysql-* args or set env vars.",
    );
  }

  const db = await openDatabase({ env });

  try {
    await db.run("START TRANSACTION");

    const preview = await db.get(PREVIEW_DUPLICATES_SQL);
    const duplicateGroups = Number(preview?.duplicate_groups || 0);
    const duplicateRows = Number(preview?.duplicate_rows_to_delete || 0);
    console.log(`[dedupe] duplicate_groups=${duplicateGroups} duplicate_rows=${duplicateRows}`);

    if (duplicateGroups > 0) {
      const sampleRows = await db.all(SAMPLE_DUPLICATES_SQL);
      for (const row of sampleRows) {
        console.log(
          `[dedupe] sample order_date=${row.order_date} document_no=${row.document_no} ` +
            `customer_code=${row.customer_code} item_code=${row.item_code} copies=${row.copies} ` +
            `files=${row.source_files}`,
        );
      }
    }

    const deleted = await db.run(DELETE_DUPLICATES_SQL);
    console.log(`[dedupe] deleted_rows=${deleted?.changes ?? 0}`);

    await rebuildImportedSalesData(db);

    const postCount = await db.get("SELECT COUNT(*) AS n FROM imported_sales_lines");
    const postDuplicates = await db.get(PREVIEW_DUPLICATES_SQL);
    console.log(`[dedupe] imported_sales_lines=${Number(postCount?.n || 0)}`);
    console.log(
      `[dedupe] remaining_duplicate_groups=${Number(postDuplicates?.duplicate_groups || 0)} ` +
        `remaining_duplicate_rows=${Number(postDuplicates?.duplicate_rows_to_delete || 0)}`,
    );

    await db.run("COMMIT");
    console.log("[dedupe] completed");
  } catch (error) {
    try {
      await db.run("ROLLBACK");
    } catch {
      // best effort cleanup
    }
    throw error;
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("[dedupe] failed:", error.message || String(error));
  process.exit(1);
});
