import { asMoney } from "./shared.js";

export const SALES_TIME_RANGE_DAYS = {
  "1w": 7,
  "2w": 14,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "12m": 365,
};

const SALES_TIME_RANGE_YEAR_MODES = new Set(["this_year", "last_year"]);

export function buildCutoffDateString(now, days) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  return cutoff.toISOString().slice(0, 10);
}

export function normalizeSalesTimeRange(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "all") return "all";
  if (SALES_TIME_RANGE_YEAR_MODES.has(normalized)) return normalized;
  if (Object.hasOwn(SALES_TIME_RANGE_DAYS, normalized)) return normalized;
  return "3m";
}

export function buildDateWindowFilter(now, salesTimeRange, dateColumn) {
  const normalizedRange = normalizeSalesTimeRange(salesTimeRange);
  if (normalizedRange === "all") {
    return {
      salesTimeRange: normalizedRange,
      clause: "",
      params: [],
    };
  }

  if (normalizedRange === "this_year" || normalizedRange === "last_year") {
    const year = normalizedRange === "this_year" ? now.getFullYear() : now.getFullYear() - 1;
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    return {
      salesTimeRange: normalizedRange,
      clause: ` AND SUBSTR(${dateColumn}, 1, 10) BETWEEN ? AND ?`,
      params: [start, end],
    };
  }

  return {
    salesTimeRange: normalizedRange,
    clause: ` AND SUBSTR(${dateColumn}, 1, 10) >= ?`,
    params: [buildCutoffDateString(now, SALES_TIME_RANGE_DAYS[normalizedRange])],
  };
}

export async function loadRevenueWindows(db, table, customerCodeColumn, dateColumn, customerCode, now) {
  const cutoff3m = buildCutoffDateString(now, 90);
  const cutoff6m = buildCutoffDateString(now, 180);
  const cutoff12m = buildCutoffDateString(now, 365);

  const row = await db.get(
    `
      SELECT
        COALESCE(SUM(CASE WHEN SUBSTR(${dateColumn}, 1, 10) >= ? THEN total_net_value ELSE 0 END), 0) AS revenue_3m,
        COALESCE(SUM(CASE WHEN SUBSTR(${dateColumn}, 1, 10) >= ? THEN total_net_value ELSE 0 END), 0) AS revenue_6m,
        COALESCE(SUM(CASE WHEN SUBSTR(${dateColumn}, 1, 10) >= ? THEN total_net_value ELSE 0 END), 0) AS revenue_12m
      FROM ${table}
      WHERE ${customerCodeColumn} = ?
    `,
    [cutoff3m, cutoff6m, cutoff12m, customerCode],
  );

  return {
    revenue_3m: asMoney(row?.revenue_3m),
    revenue_6m: asMoney(row?.revenue_6m),
    revenue_12m: asMoney(row?.revenue_12m),
  };
}
