import fs from "node:fs";
import path from "node:path";

// Append-only JSONL activity log: who logged in/out, who submitted an order,
// who opened the admin panel. No UI - read with a one-off script or `tail`.
// Never throws: a logging failure must not break the request it's attached to.

let logFilePath = null;
let writeQueue = Promise.resolve();

export function initActivityLog({ logDir }) {
  logFilePath = path.join(logDir, "activity.log");
  fs.mkdirSync(logDir, { recursive: true });
}

function clientIp(req) {
  if (!req) return null;
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || null;
}

export function logActivity(event, { req, ...fields } = {}) {
  if (!logFilePath) return;

  const entry = {
    ts: new Date().toISOString(),
    event,
    ip: clientIp(req),
    ...fields,
  };
  const line = `${JSON.stringify(entry)}\n`;

  writeQueue = writeQueue
    .then(() => fs.promises.appendFile(logFilePath, line))
    .catch((error) => {
      console.error("[activity-log] failed to write entry:", error);
    });
}
