import { openDatabase } from "../lib/db/client.js";
import {
  DELETE_DUPLICATES_SQL,
  PREVIEW_DUPLICATES_SQL,
  rebuildImportedSalesData,
  SAMPLE_DUPLICATES_SQL,
} from "../lib/imported-sales.js";

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
    MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
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
        "Provide non-secret --mysql-* args or set env vars. MYSQL_PASSWORD must come from the environment.",
    );
  }

  const db = await openDatabase({ env });

  try {
    try {
      await db.run("SET SESSION max_statement_time = 0");
      console.log("[dedupe] session max_statement_time disabled");
    } catch (error) {
      console.log(
        `[dedupe] could not disable max_statement_time for this session: ${error.message || String(error)}`,
      );
    }

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
