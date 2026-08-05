import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultCsvInput =
  "D:/Desktop/programming/viomes/viomes_db/exports/products.csv";
const defaultCatalogPath = path.join(__dirname, "..", "public", "catalog.json");

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

function parseCsvNumber(value) {
  return parseFloat(String(value || "0").replace(",", "."));
}

const REQUIRED_COLUMNS = [
  "Κωδ.Είδους",
  "Περιγραφή",
  "Χρώμα",
  "Υποσυσκευασία",
  "Συσκευασία",
  "Ανενεργό",
  "Χ5-orders",
];

// This ES1 export never carries a photo URL or a packaging volume for any
// row, so those two fields always come from the existing catalog by code —
// there is no CSV column to fall back to.
function parseProductsCsv(csvPath) {
  const buf = readFileSync(csvPath);
  const text = buf.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r\n|\n/).filter(Boolean);
  if (!lines.length) throw new Error(`CSV is empty: ${csvPath}`);

  const header = lines[0].split("\t").map((s) => s.replace(/^"|"$/g, ""));
  const idx = (name) => header.indexOf(name);

  const missing = REQUIRED_COLUMNS.filter((name) => idx(name) === -1);
  if (missing.length) {
    throw new Error(
      `CSV is missing required column(s): ${missing.join(", ")}. ` +
        `Found columns: ${header.join(" | ")}`,
    );
  }

  const codeIdx = idx("Κωδ.Είδους");
  const descIdx = idx("Περιγραφή");
  const colorIdx = idx("Χρώμα");
  const hypoIdx = idx("Υποσυσκευασία");
  const suskIdx = idx("Συσκευασία");
  const activeIdx = idx("Ανενεργό");
  const ordersIdx = idx("Χ5-orders");

  const rows = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split("\t").map((s) => s.replace(/^"|"$/g, ""));
    const code = cols[codeIdx];
    // ES1 sometimes repeats a code across rows; the first occurrence wins.
    if (!code || rows.has(code)) continue;
    rows.set(code, {
      code,
      description: cols[descIdx] || "",
      color: cols[colorIdx] || "",
      hypo: parseCsvNumber(cols[hypoIdx]),
      susk: parseCsvNumber(cols[suskIdx]),
      inactive: cols[activeIdx] === "1",
      ordersChannel: cols[ordersIdx] === "1",
    });
  }
  return rows;
}

// Υποσυσκευασία is an inner-pack override that ES1 leaves at 0 for most
// products; Συσκευασία is the standard pack size. Validated against the
// pre-drift catalog at 97.8% agreement before this became the standing rule.
// When ES1 gives no signal at all, carry forward whatever the existing
// catalog already has rather than defaulting to 1 — the existing value is
// more likely correct than a made-up default, e.g. 151-04's real pack size
// of 20 has no CSV signal but must not collapse to 1 on every regeneration.
function resolvePackSize(row, existing) {
  const raw = row.hypo !== 0 ? row.hypo : row.susk;
  if (raw > 0) return Math.round(raw);
  const existingPack = Number(existing?.pieces_per_package);
  return existingPack > 0 ? existingPack : 1;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const csvPath = path.resolve(cli.input || defaultCsvInput);
  const catalogPath = path.resolve(cli.output || defaultCatalogPath);
  const dryRun = cli["dry-run"] === "true";

  const existingCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const existingByCode = new Map(
    (existingCatalog.items || []).map((item) => [item.code, item]),
  );
  let nextId =
    Math.max(0, ...existingCatalog.items.map((item) => Number(item.id) || 0)) +
    1;

  const csvRows = parseProductsCsv(csvPath);
  console.log(`[catalog] read ${csvRows.size} unique codes from ${csvPath}`);

  const items = [];
  const newCodesNoMedia = [];
  for (const [code, row] of csvRows) {
    // Χ5-orders is the only gate for catalog membership — Ανενεργό is
    // ignored on purpose, confirmed against a manual review of the 25
    // active-but-Χ5=0 products this would otherwise exclude.
    if (!row.ordersChannel) continue;

    const existing = existingByCode.get(code);
    if (!existing) newCodesNoMedia.push(code);

    items.push({
      id: existing?.id ?? nextId++,
      code,
      description: row.description,
      image_url: existing?.image_url || "",
      pieces_per_package: resolvePackSize(row, existing),
      volume_liters: existing ? Number(existing.volume_liters) || 0 : 0,
      color: row.color,
    });
  }

  items.sort((a, b) => a.code.localeCompare(b.code, "el"));

  console.log(
    `[catalog] built ${items.length} active, order-channel products`,
  );
  console.log("[catalog] preview first 2 items:", items.slice(0, 2));
  if (newCodesNoMedia.length) {
    console.log(
      `[catalog] ${newCodesNoMedia.length} code(s) have no existing image_url/volume_liters ` +
        `to carry forward (new to the catalog): ${newCodesNoMedia.slice(0, 20).join(", ")}` +
        `${newCodesNoMedia.length > 20 ? ", ..." : ""}`,
    );
  }

  if (dryRun) {
    console.log("[catalog] dry run complete. Output file was not written.");
    return;
  }

  writeFileSync(catalogPath, JSON.stringify({ items }, null, 2), "utf8");
  console.log(`[catalog] wrote catalog JSON to: ${catalogPath}`);
}

main();
