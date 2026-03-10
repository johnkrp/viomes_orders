export function asMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

export function asInteger(value) {
  return Number.parseInt(value ?? 0, 10) || 0;
}

export function parseIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function productStatRow(row) {
  return {
    code: row.code,
    description: row.description,
    qty: asInteger(row.qty),
    orders: asInteger(row.orders),
    revenue: asMoney(row.revenue),
    avg_unit_price: asMoney(row.avg_unit_price),
  };
}

export function productSalesRow(row) {
  return {
    code: row.code,
    description: row.description,
    pieces: asInteger(row.pieces ?? row.qty),
    orders: asInteger(row.orders),
    revenue: asMoney(row.revenue),
    avg_unit_price: asMoney(row.avg_unit_price),
  };
}

export function availableBranchRow(row) {
  return {
    branch_code: row.branch_code ?? row.code ?? "",
    branch_description: row.branch_description ?? row.description ?? "",
    orders: asInteger(row.orders),
    revenue: asMoney(row.revenue),
    raw_rows: asInteger(row.raw_rows),
    last_order_date: row.last_order_date ?? row.created_at ?? null,
  };
}

export function ensureCustomerCode(customerCode) {
  const code = String(customerCode || "").trim();
  if (!code) {
    const error = new Error("Customer code is required.");
    error.status = 400;
    throw error;
  }
  return code;
}

export function buildRevenueSince(orders, now, days) {
  const cutoff = new Date(now.getTime() - days * 86400000);
  return asMoney(
    orders.reduce((sum, order) => {
      const date = parseIso(order.created_at);
      if (!date || date < cutoff) return sum;
      return sum + Number(order.total_net_value || 0);
    }, 0),
  );
}

export function buildAverageDaysBetweenOrders(orders) {
  const chronological = [...orders]
    .map((row) => ({ ...row, parsedDate: parseIso(row.created_at) }))
    .filter((row) => row.parsedDate)
    .sort((a, b) => a.parsedDate - b.parsedDate);

  if (chronological.length < 2) return null;

  const gaps = [];
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = chronological[index - 1].parsedDate;
    const current = chronological[index].parsedDate;
    gaps.push(Math.floor((current.getTime() - previous.getTime()) / 86400000));
  }

  if (!gaps.length) return null;
  return Number((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length).toFixed(1));
}

export function buildDaysSinceLastOrder(lastOrderDate, now = new Date()) {
  const parsed = parseIso(lastOrderDate);
  if (!parsed) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86400000));
}

export function createCustomerNotFoundError(code) {
  const error = new Error(`Customer not found: ${code}`);
  error.status = 404;
  return error;
}

export function normalizeMonthlySeries(series) {
  const normalized = new Map();
  for (let month = 1; month <= 12; month += 1) {
    normalized.set(month, { month, revenue: 0, pieces: 0 });
  }

  for (const row of Array.isArray(series) ? series : []) {
    const month = asInteger(row.month);
    if (month < 1 || month > 12) continue;
    normalized.set(month, {
      month,
      revenue: asMoney(row.revenue),
      pieces: asInteger(row.pieces ?? row.qty),
    });
  }

  return [...normalized.values()];
}

export function normalizeMonthlyYearlySeries(series, fallbackYears = []) {
  const map = new Map();

  for (const year of fallbackYears) {
    if (!Number.isInteger(year)) continue;
    map.set(year, { year, months: normalizeMonthlySeries([]) });
  }

  for (const entry of Array.isArray(series) ? series : []) {
    const year = asInteger(entry?.year);
    if (!year) continue;
    map.set(year, {
      year,
      months: normalizeMonthlySeries(entry?.months),
    });
  }

  return [...map.values()].sort((a, b) => a.year - b.year);
}

export function normalizeReceivables(receivables) {
  const items = Array.isArray(receivables?.items) ? receivables.items : [];
  return {
    currency: receivables?.currency || "EUR",
    open_balance: asMoney(receivables?.open_balance),
    overdue_balance: asMoney(receivables?.overdue_balance),
    items: items.map((item) => ({
      document_no: item.document_no ?? item.document ?? item.id ?? "",
      document_date: item.document_date ?? item.date ?? null,
      due_date: item.due_date ?? null,
      amount_total: asMoney(item.amount_total ?? item.amount ?? item.total_amount),
      amount_paid: asMoney(item.amount_paid ?? item.paid ?? 0),
      open_balance: asMoney(item.open_balance ?? item.balance ?? 0),
      is_overdue: Boolean(item.is_overdue),
      status: item.status || "",
    })),
  };
}

export function normalizeStatsPayload(payload, customerCode) {
  const code = ensureCustomerCode(customerCode);
  const customer = payload?.customer;
  if (!customer?.code || !customer?.name) {
    throw new Error(`Customer stats payload for ${code} is missing customer identity fields.`);
  }

  const summary = payload?.summary || {};
  const recentOrders = Array.isArray(payload?.recent_orders) ? payload.recent_orders : [];
  const now = new Date();
  const totalOrders = Number(summary.total_orders ?? recentOrders.length ?? 0);
  const totalRevenue = asMoney(summary.total_revenue);

  const currentYear = now.getUTCFullYear();
  const fallbackYears = [currentYear - 2, currentYear - 1, currentYear];
  const providedYearlySeries = Array.isArray(payload?.monthly_sales?.yearly_series)
    ? payload.monthly_sales.yearly_series
    : [
        { year: currentYear - 1, months: payload?.monthly_sales?.previous_year },
        { year: currentYear, months: payload?.monthly_sales?.current_year },
      ];
  const normalizedYearlySeries = normalizeMonthlyYearlySeries(providedYearlySeries, fallbackYears);
  const previousYearSeries =
    normalizedYearlySeries.find((entry) => entry.year === currentYear - 1)?.months ||
    normalizeMonthlySeries(payload?.monthly_sales?.previous_year);
  const currentYearSeries =
    normalizedYearlySeries.find((entry) => entry.year === currentYear)?.months ||
    normalizeMonthlySeries(payload?.monthly_sales?.current_year);

  return {
    customer: {
      code: customer.code,
      name: customer.name,
      email: customer.email || null,
      aggregation_level: customer.aggregation_level || "store",
      branch_code: customer.branch_code || null,
      branch_description: customer.branch_description || null,
      chain_name: customer.chain_name || null,
    },
    summary: {
      total_orders: totalOrders,
      total_pieces: asInteger(summary.total_pieces),
      total_revenue: totalRevenue,
      revenue_3m: asMoney(summary.revenue_3m ?? buildRevenueSince(recentOrders, now, 90)),
      revenue_6m: asMoney(summary.revenue_6m ?? buildRevenueSince(recentOrders, now, 180)),
      revenue_12m: asMoney(summary.revenue_12m ?? buildRevenueSince(recentOrders, now, 365)),
      average_order_value: asMoney(
        summary.average_order_value ?? (totalOrders ? totalRevenue / totalOrders : 0),
      ),
      average_days_between_orders:
        summary.average_days_between_orders ?? buildAverageDaysBetweenOrders(recentOrders),
      days_since_last_order:
        summary.days_since_last_order ?? buildDaysSinceLastOrder(summary.last_order_date, now),
      last_order_date: summary.last_order_date || null,
    },
    monthly_sales: {
      current_year: currentYearSeries,
      previous_year: previousYearSeries,
      yearly_series: normalizedYearlySeries,
    },
    product_sales: {
      metric: payload?.product_sales?.metric === "pieces" ? "pieces" : "revenue",
      items: Array.isArray(payload?.product_sales?.items)
        ? payload.product_sales.items.map(productSalesRow)
        : [],
    },
    receivables: normalizeReceivables(payload?.receivables),
    top_products_by_qty: Array.isArray(payload?.top_products_by_qty)
      ? payload.top_products_by_qty.map(productStatRow)
      : [],
    top_products_by_value: Array.isArray(payload?.top_products_by_value)
      ? payload.top_products_by_value.map(productStatRow)
      : [],
    available_branches: Array.isArray(payload?.available_branches)
      ? payload.available_branches.map(availableBranchRow)
      : [],
    recent_orders: recentOrders.map((order) => ({
      order_id: order.order_id,
      created_at: order.created_at,
      total_lines: asInteger(order.total_lines),
      total_pieces: asInteger(order.total_pieces),
      total_net_value: asMoney(order.total_net_value),
      average_discount_pct: asMoney(order.average_discount_pct),
    })),
    detailed_orders: Array.isArray(payload?.detailed_orders)
      ? payload.detailed_orders.map((order) => ({
          order_id: order.order_id,
          created_at: order.created_at,
          notes: order.notes || "",
          total_lines: asInteger(order.total_lines),
          total_pieces: asInteger(order.total_pieces),
          total_net_value: asMoney(order.total_net_value),
          average_discount_pct: asMoney(order.average_discount_pct),
          lines: Array.isArray(order.lines)
            ? order.lines.map((line) => ({
                code: line.code,
                description: line.description,
                qty: asInteger(line.qty),
                unit_price: asMoney(line.unit_price),
                discount_pct: asMoney(line.discount_pct),
                line_net_value: asMoney(line.line_net_value),
              }))
            : [],
        }))
      : [],
  };
}
