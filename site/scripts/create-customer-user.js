import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { hashPassword } from "../lib/admin-auth.js";
import { getImportedCustomerByCode } from "../lib/admin-customer-search.js";
import { openDatabase } from "../lib/db/client.js";
import { initDatabaseSchema } from "../lib/db/init-schema.js";

// Load site/.env the same way server.js does (see create-admin-user.js).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true, quiet: true });

function parseArgs(argv) {
  const args = {};
  for (const rawArg of argv) {
    if (!rawArg.startsWith("--")) continue;
    const [rawKey, ...rawValueParts] = rawArg.slice(2).split("=");
    const key = rawKey.trim();
    const value = rawValueParts.length ? rawValueParts.join("=") : "1";
    args[key] = value;
  }
  return args;
}

function printUsage() {
  console.log(`
Usage:
  npm run customer:create-user -- --username=USERNAME --password=PASSWORD --customer-code=CODE [--active=0|1]

Examples:
  npm run customer:create-user -- --username=abcmarket --password=supersecret --customer-code=12345
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = String(args.username || "").trim();
  const password = String(args.password || "");
  const customerCode = String(args["customer-code"] || "").trim();
  const isActive = String(args.active || "1").trim() !== "0" ? 1 : 0;

  if (!username || !password || !customerCode) {
    printUsage();
    throw new Error(
      "Missing required --username, --password, or --customer-code.",
    );
  }

  const db = await openDatabase({ env: process.env });

  try {
    await initDatabaseSchema({ db, kind: db.kind });

    const customerRecord = await getImportedCustomerByCode(db, customerCode);
    if (!customerRecord) {
      throw new Error(
        `No imported_customers record found for customer_code "${customerCode}". Import customer data first or check the code.`,
      );
    }
    if (customerRecord.is_inactive) {
      throw new Error(
        `Customer "${customerCode}" (${customerRecord.name}) is marked inactive in imported_customers.`,
      );
    }

    const existing = await db.get(
      `
        SELECT id, username
        FROM customer_users
        WHERE username = ?
      `,
      [username],
    );

    const passwordHash = hashPassword(password);

    if (existing) {
      await db.run(
        `
          UPDATE customer_users
          SET password_hash = ?, customer_code = ?, is_active = ?
          WHERE id = ?
        `,
        [passwordHash, customerCode, isActive, existing.id],
      );
      console.log(
        `Updated customer user "${username}" for customer_code "${customerCode}" (${customerRecord.name}) (active=${isActive}).`,
      );
      return;
    }

    await db.run(
      `
        INSERT INTO customer_users(username, password_hash, customer_code, is_active)
        VALUES (?, ?, ?, ?)
      `,
      [username, passwordHash, customerCode, isActive],
    );
    console.log(
      `Created customer user "${username}" for customer_code "${customerCode}" (${customerRecord.name}) (active=${isActive}).`,
    );
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
