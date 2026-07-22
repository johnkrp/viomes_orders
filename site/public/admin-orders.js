export async function fetchOrderSubmissions(context) {
  if (context.elements.orderSubmissionsBody) {
    context.elements.orderSubmissionsBody.innerHTML = `
      <tr><td colspan="7" class="admin-table-empty">Φόρτωση...</td></tr>
    `;
  }

  try {
    const payload = await context.apiFetch("/api/admin/order-submissions", {
      method: "GET",
    });
    context.state.currentOrderSubmissions = Array.isArray(payload?.items)
      ? payload.items
      : [];
  } catch (error) {
    context.state.currentOrderSubmissions = [];
    context.setStatus(
      `Σφάλμα φόρτωσης παραγγελιών πωλητών: ${error.message}`,
      "error",
    );
  }

  renderOrderSubmissions(context);
}

export function renderOrderSubmissions(context) {
  const { elements, state, escapeHtml, formatDate } = context;
  if (!elements.orderSubmissionsBody) return;

  const orders = state.currentOrderSubmissions || [];
  if (!orders.length) {
    elements.orderSubmissionsBody.innerHTML = `
      <tr><td colspan="7" class="admin-table-empty">Δεν υπάρχουν εκκρεμείς παραγγελίες.</td></tr>
    `;
    return;
  }

  elements.orderSubmissionsBody.innerHTML = orders
    .map((order) => {
      const linesHtml =
        (order.lines || [])
          .map((line) => `${escapeHtml(line.code)} × ${line.qty}`)
          .join("<br>") || "-";
      const emailHtml = order.customer_email
        ? `<br><span class="muted">${escapeHtml(order.customer_email)}</span>`
        : "";

      return `
        <tr data-order-id="${order.id}">
          <td>${escapeHtml(order.customer_name)}${emailHtml}</td>
          <td>${escapeHtml(order.customer_substore || "-")}</td>
          <td>${linesHtml}</td>
          <td>${Number(order.total_qty_pieces || 0)}</td>
          <td>${escapeHtml(order.notes || "-")}</td>
          <td>${formatDate(order.submitted_at)}</td>
          <td>
            <div class="admin-order-submission-actions">
              <input
                type="text"
                class="order-submission-warehouse"
                placeholder="Κωδ. αποθήκης"
                data-warehouse-input
              />
              <button type="button" class="btn" data-action="approve" data-order-id="${order.id}">
                Έγκριση
              </button>
              <button type="button" class="btn ghost" data-action="reject" data-order-id="${order.id}">
                Απόρριψη
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

export async function decideOrderSubmission(context, orderId, action) {
  const row = context.elements.orderSubmissionsBody?.querySelector(
    `tr[data-order-id="${orderId}"]`,
  );
  const warehouseCode =
    row?.querySelector("[data-warehouse-input]")?.value?.trim() || "";

  try {
    await context.apiFetch(`/api/admin/order-submissions/${orderId}/${action}`, {
      method: "POST",
      ...(action === "approve"
        ? { body: JSON.stringify({ warehouse_code: warehouseCode }) }
        : {}),
    });
    context.setStatus(
      action === "approve"
        ? "Η παραγγελία εγκρίθηκε."
        : "Η παραγγελία απορρίφθηκε.",
      "ok",
    );
    await fetchOrderSubmissions(context);
  } catch (error) {
    context.setStatus(`Σφάλμα: ${error.message}`, "error");
  }
}
