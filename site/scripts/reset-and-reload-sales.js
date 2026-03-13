import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resetScript = path.join(__dirname, "reset-business-data.js");
const importScript = path.join(__dirname, "run-entersoft-import.js");

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

function buildForwardArgs(cli) {
  const flags = [
    "mode",
    "mysql-host",
    "mysql-port",
    "mysql-database",
    "mysql-user",
    "sales-files",
    "daily-info-file",
    "trigger-source",
    "python-install-deps",
    "install-pymysql",
  ];
  return flags
    .filter((key) => cli[key] !== undefined)
    .map((key) => `--${key}=${cli[key]}`);
}

function runNodeScript(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });
}

function ensureHasSalesInput(cli) {
  if (cli["sales-files"] || cli["daily-info-file"]) return;
  throw new Error("Missing sales input. Provide --sales-files=... or --daily-info-file=...");
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  ensureHasSalesInput(cli);
  const fullRefreshCli = {
    ...cli,
    mode: cli.mode || "full_refresh",
  };
  const args = buildForwardArgs(fullRefreshCli);

  console.log("[pipeline] step 1/2: reset business data");
  const reset = runNodeScript(resetScript, args);
  if (reset.status !== 0) process.exit(reset.status ?? 1);

  console.log("[pipeline] step 2/2: import sales data");
  const load = runNodeScript(importScript, args);
  if (load.status !== 0) process.exit(load.status ?? 1);

  console.log("[pipeline] completed successfully");
}

try {
  main();
} catch (error) {
  console.error("[pipeline] failed:", error.message || String(error));
  process.exit(1);
}
