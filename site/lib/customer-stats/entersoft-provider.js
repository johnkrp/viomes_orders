import {
  asMoney,
  createCustomerNotFoundError,
  ensureCustomerCode,
  normalizeStatsPayload,
} from "./shared.js";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildUrl(baseUrl, pathTemplate, customerCode) {
  const path = (pathTemplate || "/customers/{code}/stats").replace(
    /\{code\}/g,
    encodeURIComponent(customerCode),
  );
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildQueryString(options = {}) {
  const params = new URLSearchParams();
  const branchCode = String(options.branchCode || "").trim();
  const branchScopeCode = String(options.branchScopeCode || "").trim();
  const branchScopeDescription = String(options.branchScopeDescription || "").trim();

  if (branchCode) params.set("branch_code", branchCode);
  if (branchScopeCode) params.set("filter_branch_code", branchScopeCode);
  if (branchScopeDescription) params.set("filter_branch_description", branchScopeDescription);

  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildHeaders(config) {
  const headers = {
    Accept: "application/json",
  };

  if (config.apiKey) {
    headers[config.apiKeyHeader || "X-API-Key"] = config.apiKey;
  }

  if (config.bearerToken) {
    headers.Authorization = `Bearer ${config.bearerToken}`;
  } else if (config.username || config.password) {
    const encoded = Buffer.from(`${config.username || ""}:${config.password || ""}`, "utf8").toString(
      "base64",
    );
    headers.Authorization = `Basic ${encoded}`;
  }

  return headers;
}

function getByPath(source, path) {
  if (!path) return undefined;
  return path.split(".").reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, source);
}

function mapProductRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    code: row.item_code ?? row.code ?? row.product_code ?? "",
    description: row.item_description ?? row.description ?? row.product_description ?? "",
    qty: Number(row.qty ?? row.quantity ?? row.pieces ?? 0),
    orders: Number(row.orders ?? row.order_count ?? 0),
    revenue: asMoney(row.revenue ?? row.net_value ?? row.value ?? 0),
    avg_unit_price: asMoney(row.avg_unit_price ?? row.unit_price ?? 0),
  }));
}

function mapRecentOrders(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    order_id: row.order_id ?? row.id ?? row.document_id ?? row.document_no,
    created_at: row.created_at ?? row.date ?? row.order_date ?? row.document_date,
    total_lines: Number(row.total_lines ?? row.lines ?? row.line_count ?? 0),
    total_pieces: Number(row.total_pieces ?? row.qty ?? row.quantity ?? 0),
    total_net_value: asMoney(row.total_net_value ?? row.net_value ?? row.value ?? 0),
    average_discount_pct: asMoney(
      row.average_discount_pct ?? row.discount_pct ?? row.avg_discount_pct ?? 0,
    ),
  }));
}

function mapDetailedOrders(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    order_id: row.order_id ?? row.id ?? row.document_id ?? row.document_no,
    created_at: row.created_at ?? row.date ?? row.order_date ?? row.document_date,
    notes: row.notes ?? row.comments ?? row.remark ?? "",
    total_lines: Number(row.total_lines ?? row.lines ?? row.line_count ?? 0),
    total_pieces: Number(row.total_pieces ?? row.qty ?? row.quantity ?? 0),
    total_net_value: asMoney(row.total_net_value ?? row.net_value ?? row.value ?? 0),
    average_discount_pct: asMoney(
      row.average_discount_pct ?? row.discount_pct ?? row.avg_discount_pct ?? 0,
    ),
    lines: (Array.isArray(row.lines) ? row.lines : []).map((line) => ({
      code: line.item_code ?? line.code ?? line.product_code ?? "",
      description: line.item_description ?? line.description ?? line.product_description ?? "",
      qty: Number(line.qty ?? line.quantity ?? line.pieces ?? 0),
      unit_price: asMoney(line.unit_price ?? line.price ?? 0),
      discount_pct: asMoney(line.discount_pct ?? line.discount ?? 0),
      line_net_value: asMoney(line.line_net_value ?? line.net_value ?? line.value ?? 0),
    })),
  }));
}

function mapMonthlyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    month: row.month ?? row.month_no ?? row.month_number,
    revenue: row.revenue ?? row.net_value ?? row.value ?? 0,
    pieces: row.pieces ?? row.qty ?? row.quantity ?? 0,
  }));
}

function mapReceivableItems(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    document_no: row.document_no ?? row.document ?? row.doc_no ?? row.id ?? "",
    document_date: row.document_date ?? row.date ?? row.issue_date ?? null,
    due_date: row.due_date ?? row.maturity_date ?? null,
    amount_total: row.amount_total ?? row.amount ?? row.total_amount ?? 0,
    amount_paid: row.amount_paid ?? row.paid ?? row.paid_amount ?? 0,
    open_balance: row.open_balance ?? row.balance ?? row.remaining_amount ?? 0,
    is_overdue: row.is_overdue ?? row.overdue ?? false,
    status: row.status ?? "",
  }));
}

function mapAvailableBranches(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    branch_code: row.branch_code ?? row.code ?? "",
    branch_description: row.branch_description ?? row.description ?? "",
    orders: Number(row.orders ?? row.order_count ?? 0),
    revenue: asMoney(row.revenue ?? row.net_value ?? row.value ?? 0),
    raw_rows: Number(row.raw_rows ?? row.rows ?? 0),
    last_order_date: row.last_order_date ?? row.created_at ?? row.order_date ?? null,
  }));
}

function mapPayload(rawPayload, customerCode, responseShape) {
  if (responseShape === "viomes-admin-stats") {
    return normalizeStatsPayload(rawPayload, customerCode);
  }

  if (responseShape !== "entersoft-customer-stats-v1") {
    throw new Error(`Unsupported Entersoft response shape: ${responseShape}`);
  }

  const root = rawPayload?.data ?? rawPayload;
  const customer = getByPath(root, "customer") || {};
  const summary = getByPath(root, "summary") || {};

  if (!customer.code && !customer.name && !summary.total_orders && !Array.isArray(root?.recent_orders)) {
    throw createCustomerNotFoundError(customerCode);
  }

  return normalizeStatsPayload(
    {
      customer: {
        code: customer.code ?? customer.customer_code ?? customerCode,
        name: customer.name ?? customer.customer_name ?? customer.trade_name ?? "",
        email: customer.email ?? customer.email_address ?? null,
        aggregation_level: customer.aggregation_level ?? customer.level ?? "store",
        branch_code: customer.branch_code ?? customer.store_code ?? customer.branch?.code ?? null,
        branch_description:
          customer.branch_description ??
          customer.store_description ??
          customer.branch?.description ??
          null,
        chain_name: customer.chain_name ?? customer.parent_name ?? null,
      },
      summary: {
        total_orders: summary.total_orders ?? summary.order_count ?? 0,
        total_pieces: summary.total_pieces ?? summary.total_qty ?? summary.qty ?? 0,
        total_revenue: summary.total_revenue ?? summary.net_value ?? summary.value ?? 0,
        revenue_3m: summary.revenue_3m ?? summary.revenue_last_3m,
        revenue_6m: summary.revenue_6m ?? summary.revenue_last_6m,
        revenue_12m: summary.revenue_12m ?? summary.revenue_last_12m,
        average_order_value: summary.average_order_value ?? summary.avg_order_value,
        average_days_between_orders:
          summary.average_days_between_orders ?? summary.avg_days_between_orders,
        days_since_last_order: summary.days_since_last_order,
        last_order_date: summary.last_order_date ?? summary.latest_order_date ?? null,
      },
      monthly_sales: {
        current_year: mapMonthlyRows(
          getByPath(root, "monthly_sales.current_year") ?? getByPath(root, "sales_by_month.current_year"),
        ),
        previous_year: mapMonthlyRows(
          getByPath(root, "monthly_sales.previous_year") ?? getByPath(root, "sales_by_month.previous_year"),
        ),
      },
      product_sales: {
        metric: getByPath(root, "product_sales.metric") ?? getByPath(root, "products.metric") ?? "revenue",
        items: mapProductRows(getByPath(root, "product_sales.items") ?? getByPath(root, "products.items")),
      },
      receivables: {
        currency:
          getByPath(root, "receivables.currency") ??
          getByPath(root, "ledger.currency") ??
          "EUR",
        open_balance:
          getByPath(root, "receivables.open_balance") ?? getByPath(root, "ledger.open_balance") ?? 0,
        overdue_balance:
          getByPath(root, "receivables.overdue_balance") ??
          getByPath(root, "ledger.overdue_balance") ??
          0,
        items: mapReceivableItems(
          getByPath(root, "receivables.items") ?? getByPath(root, "ledger.items"),
        ),
      },
      top_products_by_qty: mapProductRows(
        getByPath(root, "top_products_by_qty") ?? getByPath(root, "products_by_qty"),
      ),
      top_products_by_value: mapProductRows(
        getByPath(root, "top_products_by_value") ?? getByPath(root, "products_by_value"),
      ),
      available_branches: mapAvailableBranches(
        getByPath(root, "available_branches") ??
          getByPath(root, "branches") ??
          getByPath(root, "customer.available_branches"),
      ),
      recent_orders: mapRecentOrders(
        getByPath(root, "recent_orders") ?? getByPath(root, "recent_documents"),
      ),
      detailed_orders: mapDetailedOrders(
        getByPath(root, "detailed_orders") ?? getByPath(root, "order_details"),
      ),
    },
    customerCode,
  );
}

export function createEntersoftCustomerStatsProvider(options = {}) {
  const config = {
    baseUrl: normalizeBaseUrl(options.baseUrl),
    pathTemplate: options.pathTemplate || "/customers/{code}/stats",
    responseShape: options.responseShape || "entersoft-customer-stats-v1",
    timeoutMs: Math.max(Number(options.timeoutMs || 10000), 1000),
    apiKey: String(options.apiKey || "").trim(),
    apiKeyHeader: String(options.apiKeyHeader || "").trim(),
    bearerToken: String(options.bearerToken || "").trim(),
    username: String(options.username || "").trim(),
    password: String(options.password || "").trim(),
  };

  if (!config.baseUrl) {
    throw new Error("Entersoft customer stats provider requires ENTERSOFT_BASE_URL.");
  }

  return {
    name: "entersoft",
    async getCustomerStats(customerCode, requestOptions = {}) {
      const code = ensureCustomerCode(customerCode);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const url = `${buildUrl(config.baseUrl, config.pathTemplate, code)}${buildQueryString(requestOptions)}`;

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: buildHeaders(config),
          signal: controller.signal,
        });

        if (response.status === 404) {
          throw createCustomerNotFoundError(code);
        }

        if (!response.ok) {
          let detail = `Entersoft request failed with HTTP ${response.status}`;
          try {
            const payload = await response.json();
            detail = payload?.detail || payload?.error || payload?.message || detail;
          } catch {
            // Keep the generic message when the upstream body is not JSON.
          }
          const error = new Error(detail);
          error.status = 502;
          throw error;
        }

        const payload = await response.json();
        return mapPayload(payload, code, config.responseShape);
      } catch (error) {
        if (error?.status) throw error;
        if (error?.name === "AbortError") {
          const timeoutError = new Error(
            `Entersoft request timed out after ${config.timeoutMs}ms for customer ${code}.`,
          );
          timeoutError.status = 504;
          throw timeoutError;
        }

        const upstreamError = new Error(`Entersoft request failed: ${error.message || String(error)}`);
        upstreamError.status = 502;
        throw upstreamError;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
