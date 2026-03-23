import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FACTUAL_LIFECYCLE_RULES_PATH = path.resolve(__dirname, "../../factual_lifecycle_rules.json");
export const FACTUAL_LIFECYCLE_RULES = Object.freeze(
  JSON.parse(fs.readFileSync(FACTUAL_LIFECYCLE_RULES_PATH, "utf8")),
);

export function buildDocumentTypeSqlList(documentTypes) {
  return documentTypes.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(", ");
}
