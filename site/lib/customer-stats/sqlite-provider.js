import { ensureCustomerCode } from "./shared.js";
import { toCustomerStatsPayload } from "./stats-shaping.js";
import { hasImportedData } from "./stats-imported-helpers.js";
import { loadLocalCustomerStats } from "./stats-local-loader.js";
import { loadImportedCustomerStats } from "./stats-imported-loader.js";
import { normalizeSalesTimeRange } from "./stats-time-range.js";

export function createSqliteCustomerStatsProvider({ db, sqlDialect = "sqlite" }) {
  if (!db) {
    throw new Error("SQLite customer stats provider requires a database connection.");
  }

  return {
    name: "sqlite",
    mode: "sql-backed",
    projection_strategy: "projection-first",
    async getCustomerStats(customerCode, options = {}) {
      const code = ensureCustomerCode(customerCode);
      const useImported = await hasImportedData(db);
      const context = {
        db,
        sqlDialect,
        code,
        now: new Date(),
        salesTimeRange: normalizeSalesTimeRange(options?.salesTimeRange),
        selectedBranchCode: String(options?.branchCode || "").trim() || null,
        branchScopeCode: String(options?.branchScopeCode || "").trim() || null,
        branchScopeDescription: String(options?.branchScopeDescription || "").trim() || null,
      };

      const result = useImported
        ? await loadImportedCustomerStats(context)
        : await loadLocalCustomerStats(context);

      return toCustomerStatsPayload(result);
    },
  };
}
