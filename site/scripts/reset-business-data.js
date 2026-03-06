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
  const deleteStatements = [
    "DELETE FROM imported_sales_lines",
    "DELETE FROM imported_orders",
    "DELETE FROM imported_monthly_sales",
    "DELETE FROM imported_product_sales",
    "DELETE FROM imported_customers",
    "DELETE FROM import_runs",
    "DELETE FROM order_lines",
    "DELETE FROM orders",
    "DELETE FROM customer_receivables",
    "DELETE FROM customers",
  ];

  try {
    console.log("[reset] starting full business-data reset (admin tables preserved)");
    await db.run("SET FOREIGN_KEY_CHECKS = 0");
    for (const sql of deleteStatements) {
      const result = await db.run(sql);
      console.log(`[reset] ${sql} -> affected_rows=${result?.changes ?? 0}`);
    }
    await db.run("SET FOREIGN_KEY_CHECKS = 1");
    console.log("[reset] completed");
  } finally {
    try {
      await db.run("SET FOREIGN_KEY_CHECKS = 1");
    } catch {
      // best effort cleanup
    }
    await db.close();
  }
}

main().catch((error) => {
  console.error("[reset] failed:", error.message || String(error));
  process.exit(1);
});
