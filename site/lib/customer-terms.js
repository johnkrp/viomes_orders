// Read-only store over site/data/customer-terms.json - per-customer commercial / credit
// terms exported weekly from ES1 (viomes_db/scripts/Export-CustomerTerms.ps1). The admin
// customer hero shows these as static cards. Slow-moving reference data: we re-read the
// file only when its mtime changes, and a missing file is an expected state (not yet
// shipped / dev), not an error.

import { readFile, stat } from "node:fs/promises";

// ES1 ESFITradeAccount.ProposedPaymentType -> label. Verified against the client's
// "Μέσο εξόφλησης" dropdown for 121.1.049 (value 1 = "Με έμβασμα"). 0/2 inferred from the
// standard Entersoft enumeration and the live value distribution (1662x transfer, 21x
// cash, 8x cheque); correct these if ES1 says otherwise.
export const SETTLEMENT_MEANS_LABELS = {
  0: "Μετρητά",
  1: "Με έμβασμα",
  2: "Επιταγή",
};

export function settlementMeansLabel(code) {
  if (code === null || code === undefined || code === "") return null;
  return SETTLEMENT_MEANS_LABELS[Number(code)] ?? null;
}

/**
 * @param {{ filePath: string, logger?: { warn?: Function } }} options
 */
export function createCustomerTermsStore({ filePath, logger } = {}) {
  if (!filePath) {
    throw new Error("createCustomerTermsStore requires a filePath.");
  }
  const warn = typeof logger?.warn === "function" ? logger.warn.bind(logger) : () => {};

  let state = {
    mtimeMs: null,
    loadedOnce: false,
    generatedAt: null,
    byCode: new Map(),
  };

  async function refresh() {
    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        // Expected before the first export is committed / on a fresh checkout.
        if (!state.loadedOnce || state.byCode.size > 0) {
          state = { mtimeMs: null, loadedOnce: true, generatedAt: null, byCode: new Map() };
        }
        return;
      }
      throw error;
    }

    if (state.loadedOnce && fileStat.mtimeMs === state.mtimeMs) return;

    let parsed;
    try {
      const raw = await readFile(filePath, "utf8");
      // Tolerate a UTF-8 BOM even though the exporter writes without one.
      parsed = JSON.parse(raw.replace(/^﻿/, ""));
    } catch (error) {
      // A corrupt file must not take down the whole customer stats view. Keep serving
      // whatever we last parsed successfully (possibly empty) and log loudly.
      warn(
        `customer-terms: failed to read/parse ${filePath} (${error.message}); keeping ${state.byCode.size} cached record(s)`,
      );
      state = { ...state, loadedOnce: true, mtimeMs: fileStat.mtimeMs };
      return;
    }

    const byCode = new Map();
    const customers = parsed && typeof parsed.customers === "object" ? parsed.customers : {};
    for (const [code, record] of Object.entries(customers)) {
      if (!record || typeof record !== "object") continue;
      byCode.set(String(code).trim(), record);
    }

    state = {
      mtimeMs: fileStat.mtimeMs,
      loadedOnce: true,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : null,
      byCode,
    };
  }

  return {
    /**
     * Terms for one customer code, or null when the file is missing or has no such code.
     * The returned object is a shallow copy with `settlementMeans` (label) and
     * `generatedAt` (file freshness) folded in.
     */
    async get(customerCode) {
      await refresh();
      const key = String(customerCode || "").trim();
      if (!key) return null;
      const record = state.byCode.get(key);
      if (!record) return null;
      return {
        ...record,
        settlementMeans: settlementMeansLabel(record.settlementMeansCode),
        generatedAt: state.generatedAt,
      };
    },

    /** File-level info for diagnostics / a freshness label. */
    async meta() {
      await refresh();
      return { generatedAt: state.generatedAt, count: state.byCode.size };
    },
  };
}
