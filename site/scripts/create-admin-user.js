import { hashPassword } from "../lib/admin-auth.js";
import { openDatabase } from "../lib/db/client.js";
import { initDatabaseSchema } from "../lib/db/init-schema.js";

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
  npm run admin:create-user -- --username=USERNAME --password=PASSWORD [--active=0|1]

Examples:
  npm run admin:create-user -- --username=warehouse-admin --password=supersecret
  npm run admin:create-user -- --username=ops --password=anothersecret --active=1
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const username = String(args.username || "").trim();
  const password = String(args.password || "");
  const isActive = String(args.active || "1").trim() !== "0" ? 1 : 0;

  if (!username || !password) {
    printUsage();
    throw new Error("Missing required --username or --password.");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const db = await openDatabase({ env: process.env });

  try {
    await initDatabaseSchema({ db, kind: db.kind });

    const existing = await db.get(
      `
        SELECT id, username
        FROM admin_users
        WHERE username = ?
      `,
      [username],
    );

    const passwordHash = hashPassword(password);

    if (existing) {
      await db.run(
        `
          UPDATE admin_users
          SET password_hash = ?, is_active = ?
          WHERE id = ?
        `,
        [passwordHash, isActive, existing.id],
      );
      console.log(`Updated admin user "${username}" (active=${isActive}).`);
      return;
    }

    await db.run(
      `
        INSERT INTO admin_users(username, password_hash, is_active)
        VALUES (?, ?, ?)
      `,
      [username, passwordHash, isActive],
    );
    console.log(`Created admin user "${username}" (active=${isActive}).`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
