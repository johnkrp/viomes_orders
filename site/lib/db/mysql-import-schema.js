import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MYSQL_IMPORT_SCHEMA_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "backend",
  "sql",
  "mysql_import_schema.sql",
);

export function splitSqlStatements(source) {
  return source
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function getMysqlImportSchemaStatements() {
  return splitSqlStatements(fs.readFileSync(MYSQL_IMPORT_SCHEMA_PATH, "utf8"));
}
