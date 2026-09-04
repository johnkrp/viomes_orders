// Human-readable summary of site/logs/activity.log (login/logout, order
// submissions, admin/order-form page views, held-order approve/reject).
// Usage: node scripts/activity-recap.js [--days=7] [--since=2026-09-01] [--tail=15]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, "..", "logs", "activity.log");

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [rawKey, ...rest] = token.slice(2).split("=");
    const key = rawKey.trim();
    if (key) args[key] = rest.join("=").trim() || "true";
  }
  return args;
}

function readEntries() {
  if (!fs.existsSync(LOG_PATH)) return [];
  const raw = fs.readFileSync(LOG_PATH, "utf8");
  const entries = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // Skip a corrupt/partial line (e.g. a write interrupted mid-append).
    }
  }
  return entries;
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function formatCounts(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => `  ${key}: ${count}`)
    .join("\n") || "  (none)";
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const since = cli.since
    ? new Date(cli.since)
    : new Date(Date.now() - Number(cli.days || 7) * 24 * 60 * 60 * 1000);
  const tailCount = Number(cli.tail || 15);

  const all = readEntries();
  const entries = all.filter((e) => e.ts && new Date(e.ts) >= since);

  console.log(`Activity recap since ${since.toISOString()}`);
  console.log(`(${entries.length} of ${all.length} total logged events)\n`);

  if (!entries.length) {
    console.log("No activity in this window.");
    return;
  }

  const loginSuccess = new Map(); // "role:username" -> count
  const loginFailed = new Map();
  const logouts = new Map();
  const ordersSubmitted = new Map(); // customerCode -> count
  const orderSubmitFailed = new Map();
  const adminPageViews = new Map();
  const orderformPageViews = new Map();
  const approvals = [];
  const rejections = [];

  for (const e of entries) {
    switch (e.event) {
      case "admin.login.success":
        bump(loginSuccess, `admin:${e.username}`);
        break;
      case "customer.login.success":
        bump(loginSuccess, `customer:${e.username} (${e.customerCode})`);
        break;
      case "admin.login.failed":
        bump(loginFailed, `admin:${e.username}`);
        break;
      case "customer.login.failed":
        bump(loginFailed, `customer:${e.username}`);
        break;
      case "admin.logout":
        bump(logouts, `admin:${e.username}`);
        break;
      case "customer.logout":
        bump(logouts, `customer:${e.username}`);
        break;
      case "order.submitted":
        bump(ordersSubmitted, `${e.username} -> ${e.customerCode}`);
        break;
      case "order.submit_failed":
        bump(orderSubmitFailed, `${e.username}: ${e.error}`);
        break;
      case "admin.page_view":
        bump(adminPageViews, e.username ? `admin:${e.username}` : "(unauthenticated)");
        break;
      case "orderform.page_view":
        bump(
          orderformPageViews,
          e.role === "customer" ? `customer:${e.username}` : `admin:${e.username}`,
        );
        break;
      case "order.approved":
        approvals.push(e);
        break;
      case "order.rejected":
        rejections.push(e);
        break;
      default:
        break;
    }
  }

  console.log("== Logins (success) ==");
  console.log(formatCounts(loginSuccess));
  console.log("\n== Logins (FAILED) ==");
  console.log(formatCounts(loginFailed));
  console.log("\n== Logouts ==");
  console.log(formatCounts(logouts));
  console.log("\n== Orders submitted ==");
  console.log(formatCounts(ordersSubmitted));
  if (orderSubmitFailed.size) {
    console.log("\n== Order submit FAILURES ==");
    console.log(formatCounts(orderSubmitFailed));
  }
  console.log("\n== Admin panel page views ==");
  console.log(formatCounts(adminPageViews));
  console.log("\n== Order-form page views ==");
  console.log(formatCounts(orderformPageViews));

  if (approvals.length || rejections.length) {
    console.log("\n== Held-order approvals/rejections ==");
    for (const e of approvals) {
      console.log(`  APPROVED order ${e.orderId} by ${e.username} at ${e.ts}`);
    }
    for (const e of rejections) {
      console.log(
        `  REJECTED order ${e.orderId} by ${e.username} at ${e.ts}${e.reason ? ` (${e.reason})` : ""}`,
      );
    }
  }

  console.log(`\n== Last ${tailCount} events ==`);
  for (const e of entries.slice(-tailCount)) {
    const { ts, event, ...rest } = e;
    console.log(`  ${ts}  ${event}  ${JSON.stringify(rest)}`);
  }
}

main();
