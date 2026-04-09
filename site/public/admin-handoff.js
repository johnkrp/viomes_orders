import {
  ORDER_FORM_IMPORT_KEY,
  ORDER_FORM_RANKING_KEY,
} from "./admin-constants.js";

export function buildOrderFormDraftFromSelectedOrder(order, customer) {
  const customerName = String(
    order?.customer_name || customer?.name || customer?.textContent || "",
  ).trim();
  const branchCode = String(
    order?.branch_code || customer?.branch_code || "",
  ).trim();
  const branchDescription = String(
    order?.branch_description || customer?.branch_description || "",
  ).trim();
  const branchLabel =
    customer?.branch_code || customer?.branch_description
      ? [customer.branch_code, customer.branch_description]
          .filter(Boolean)
          .join(" | ")
      : "";
  return {
    customerName,
    customerSubstore: branchLabel || branchDescription || branchCode,
    branchCode,
    branchDescription,
    customerEmail: String(order?.customer_email || "").trim(),
    notes: String(order?.notes || "").trim(),
    sourceOrderId: String(order?.order_id || "").trim(),
    lines: Array.isArray(order?.lines)
      ? order.lines
          .filter((line) => line?.code && Number(line?.qty || 0) > 0)
          .map((line) => ({
            code: String(line.code).trim(),
            qty: Number(line.qty || 0),
            description: String(line.description || "").trim(),
          }))
      : [],
  };
}

export function openSelectedOrderInOrderForm(context, orderId) {
  const order = context.findDetailedOrder(orderId);
  if (!order) {
    context.setStatus("Η επιλεγμένη παραγγελία δεν βρέθηκε.", "error");
    return;
  }

  const draft = buildOrderFormDraftFromSelectedOrder(
    order,
    context.state.lastRenderedStatsPayload?.customer,
  );
  if (!draft.lines.length) {
    context.setStatus(
      "Η επιλεγμένη παραγγελία δεν έχει γραμμές ειδών για φόρτωση.",
      "error",
    );
    return;
  }

  try {
    window.sessionStorage.setItem(ORDER_FORM_IMPORT_KEY, JSON.stringify(draft));
    window.location.href = "index.html";
  } catch (_error) {
    context.setStatus(
      "Δεν ήταν δυνατή η μεταφορά της παραγγελίας στη φόρμα.",
      "error",
    );
  }
}

export function openRankedOrderForm(context) {
  const customer = context.state.lastRenderedStatsPayload?.customer || {};
  const branchLabel =
    customer.branch_code || customer.branch_description
      ? [customer.branch_code, customer.branch_description]
          .filter(Boolean)
          .join(" | ")
      : "";
  const productSales = context.getSortedProductSales();
  const rankedCodes = productSales
    .map((item) => String(item?.code || "").trim())
    .filter(Boolean);

  if (!context.state.currentCustomerCode || !rankedCodes.length) {
    context.setStatus(
      "Δεν υπάρχουν αρκετά στοιχεία για κατάταξη ειδών πελάτη.",
      "error",
    );
    return;
  }

  // Build product history map: code -> order count
  const productHistoryMap = {};
  for (const sale of productSales) {
    const code = String(sale?.code || "").trim();
    if (code) {
      productHistoryMap[code] = Number(sale?.orders || 0);
    }
  }

  const draft = {
    customerName: customer.name || "",
    customerSubstore:
      branchLabel || customer.branch_description || customer.branch_code || "",
    branchCode: customer.branch_code || "",
    branchDescription: customer.branch_description || "",
    customerEmail: customer.email || "",
    customerCode: context.state.currentCustomerCode,
    branchCode: context.state.currentBranchCode || "",
    rankedCodes,
    productHistoryMap,
    salesTimeRange: context.state.currentSalesTimeRange,
  };

  try {
    window.sessionStorage.setItem(
      ORDER_FORM_RANKING_KEY,
      JSON.stringify(draft),
    );
    window.location.href = "index.html";
  } catch (_error) {
    context.setStatus(
      "Δεν ήταν δυνατή η αποθήκευση της κατάταξης για τη φόρμα παραγγελίας.",
      "error",
    );
  }
}
