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

const DUPLICATE_SUMMARY_SQL = `
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

const DUPLICATE_SAMPLE_SQL = `
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

const IMPORTED_ORDER_COLLISIONS_SQL = `
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
    const counts = {
      imported_sales_lines: Number((await db.get("SELECT COUNT(*) AS n FROM imported_sales_lines"))?.n || 0),
      imported_orders: Number((await db.get("SELECT COUNT(*) AS n FROM imported_orders"))?.n || 0),
      imported_monthly_sales: Number(
        (await db.get("SELECT COUNT(*) AS n FROM imported_monthly_sales"))?.n || 0,
      ),
      imported_product_sales: Number(
        (await db.get("SELECT COUNT(*) AS n FROM imported_product_sales"))?.n || 0,
      ),
      imported_customers: Number((await db.get("SELECT COUNT(*) AS n FROM imported_customers"))?.n || 0),
      mirrored_customers: Number(
        (await db.get("SELECT COUNT(*) AS n FROM customers WHERE source = 'entersoft_import'"))?.n || 0
      ),
    };

    const duplicateSummary = await db.get(DUPLICATE_SUMMARY_SQL);
    const duplicateSamples = await db.all(DUPLICATE_SAMPLE_SQL);
    const importedOrderCollisions = await db.all(IMPORTED_ORDER_COLLISIONS_SQL);

    console.log("[check] row counts");
    for (const [name, value] of Object.entries(counts)) {
      console.log(`[check] ${name}=${value}`);
    }

    console.log(
      `[check] duplicate_groups=${Number(duplicateSummary?.duplicate_groups || 0)} ` +
        `duplicate_rows=${Number(duplicateSummary?.duplicate_rows || 0)}`,
    );

    if (duplicateSamples.length) {
      console.log("[check] duplicate samples");
      for (const row of duplicateSamples) {
        console.log(
          `[check] order_date=${row.order_date} document_no=${row.document_no} ` +
            `customer_code=${row.customer_code} item_code=${row.item_code} copies=${row.copies} ` +
            `files=${row.files}`,
        );
      }
    }

    if (importedOrderCollisions.length) {
      console.log("[check] imported order collisions");
      for (const row of importedOrderCollisions) {
        console.log(
          `[check] document_no=${row.document_no} customer_code=${row.customer_code} ` +
            `created_at=${row.created_at} copies=${row.copies}`,
        );
      }
    }

    const hasDuplicates = Number(duplicateSummary?.duplicate_groups || 0) > 0;
    const hasOrderCollisions = importedOrderCollisions.length > 0;

    if (hasDuplicates || hasOrderCollisions) {
      console.error("[check] FAILED import integrity checks");
      process.exit(1);
    }

    console.log("[check] OK import integrity checks passed");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("[check] failed:", error.message || String(error));
  process.exit(1);
});
