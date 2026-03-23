import { DEFAULT_SALES_TIME_RANGE } from "./admin-constants.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("el-GR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("el-GR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeSalesTimeRange(value) {
  const normalized = String(value || DEFAULT_SALES_TIME_RANGE).trim().toLowerCase();
  const allowedValues = new Set(["1m", "3m", "6m", "12m", "this_year", "last_year", "all"]);
  return allowedValues.has(normalized) ? normalized : DEFAULT_SALES_TIME_RANGE;
}

export function formatMoney(value) {
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatNumber(value) {
  return new Intl.NumberFormat("el-GR").format(Number(value || 0));
}

export function formatPercentRoundedUp(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "-";
  return `${Math.ceil(numericValue)}%`;
}

export function formatDays(value) {
  if (value === null || value === undefined || value === "") return "-";
  return `${formatNumber(value)} ημ.`;
}

export function numberStateClass(value) {
  return Number(value || 0) < 0 ? " admin-number-negative" : "";
}

export function compareSortableValues(a, b, { direction = "asc", numeric = false, date = false } = {}) {
  let left = a ?? "";
  let right = b ?? "";

  if (date) {
    left = parseIsoDate(left)?.getTime() || 0;
    right = parseIsoDate(right)?.getTime() || 0;
  }

  if (numeric) {
    left = Number(left || 0);
    right = Number(right || 0);
  }

  let result = 0;
  if (typeof left === "number" && typeof right === "number") {
    result = left - right;
  } else {
    result = String(left).localeCompare(String(right), "el", { numeric: true, sensitivity: "base" });
  }

  return direction === "desc" ? result * -1 : result;
}

export function updateSortIndicators(tableId, sortState) {
  document.querySelectorAll(`.admin-sort-btn[data-table-sort="${tableId}"]`).forEach((button) => {
    const indicator = button.querySelector(".admin-sort-indicator");
    if (!indicator) return;

    const key = String(button.getAttribute("data-sort-key") || "").trim();
    if (key === sortState.key) {
      indicator.textContent = sortState.direction === "asc" ? "↑" : "↓";
    } else {
      indicator.textContent = "↕";
    }
  });
}
