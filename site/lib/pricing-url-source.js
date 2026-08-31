// Resolves the live pricing service's base URL, re-reading it periodically instead of
// once at boot. Closes the loop described in PRICING_URL_HOT_RELOAD_TASK.md: the
// viomes_db-side tunnel automation pushes the current URL into
// backend/pricing-url.txt whenever the Cloudflare quick tunnel restarts (its public
// URL is not stable), and this module is how the already-running process picks that
// change up without a manual Plesk restart.

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_TTL_MS = 45_000;

/**
 * `envUrl` (typically `settings.pricingServiceUrl`, from `PRICING_SERVICE_URL`) is used
 * only when `backend/pricing-url.txt` is missing or empty - this keeps local dev
 * (`site/scripts/dev-with-pricing-service.js`) and any future deployment with a stable
 * URL working unchanged. A missing/empty file is not an error: it's read the same way
 * as an unset env var - "no live pricing configured (yet)".
 */
export function createPricingUrlSource({ backendDir, envUrl, ttlMs = DEFAULT_TTL_MS } = {}) {
  const fallbackUrl = String(envUrl || "").trim();
  const filePath = path.join(backendDir, "pricing-url.txt");

  let cached = null; // { url: string|null, expiresAt: number }

  async function readFileUrl() {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return raw.trim() || null;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function getUrl() {
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.url;
    }

    const url = (await readFileUrl()) || fallbackUrl || null;
    cached = { url, expiresAt: now + ttlMs };
    return url;
  }

  return { getUrl };
}
