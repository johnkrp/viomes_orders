const ORDER_SUBMISSION_COLUMNS = 9;
const NOTES_PREVIEW_LENGTH = 60;

function getExpandedIds(state) {
  if (!(state.expandedOrderSubmissionIds instanceof Set)) {
    state.expandedOrderSubmissionIds = new Set();
  }
  return state.expandedOrderSubmissionIds;
}

function formatDiscount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return "-";
  return `${Math.round(numeric)}%`;
}

function buildNotesPreview(notes, escapeHtml) {
  const text = String(notes || "").trim();
  if (!text) return "-";
  if (text.length <= NOTES_PREVIEW_LENGTH) return escapeHtml(text);
  return `${escapeHtml(text.slice(0, NOTES_PREVIEW_LENGTH))}…`;
}

// Date-only value (no time component) — MySQL DATE columns can arrive as a Date object
// or a plain YYYY-MM-DD string depending on driver settings, so handle both.
function formatOrderDate(value) {
  if (!value) return "-";
  const text = typeof value === "string" ? value.slice(0, 10) : null;
  const parsed = text ? new Date(`${text}T00:00:00`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("el-GR");
}

function buildSubmittedByHtml(order, escapeHtml) {
  const submittedBy = String(order.submitted_by || "").trim();
  if (!submittedBy) return "";
  const label =
    order.submitted_by_role === "customer"
      ? `${submittedBy} (πελάτης)`
      : submittedBy;
  return `<br><span class="muted">${escapeHtml(label)}</span>`;
}

/**
 * The estimate's trustworthiness depends entirely on where the price came from, so the
 * summary has to say which. Priced from the customer's own past invoices it lands within
 * ~1%; priced from another customer's invoice it can be out by that customer's whole
 * discount, so it gets a visibly different mark rather than the same plain "εκτ.".
 */
function buildValueHtml(order, { escapeHtml, formatMoney }) {
  const money = escapeHtml(formatMoney(order.total_net_value));

  // Takes priority over the plain estimate badges below: the live pricing service was
  // configured but unreachable when this order was submitted, so total_net_value is not
  // an estimate at all - it's 0,00, and someone has to price the order by hand before
  // approving it. Must never look like a normal (if uncertain) "εκτ." price.
  if (order.needs_manual_price_review) {
    return `<span class="admin-order-needs-review" title="Η υπηρεσία τιμολόγησης δεν ήταν διαθέσιμη κατά την υποβολή. Χρειάζεται χειροκίνητη τιμολόγηση πριν την έγκριση.">⚠ Χειροκίνητος έλεγχος τιμής</span>`;
  }

  if (order.value_is_partial) {
    return `${money} <span class="muted" title="Μία ή περισσότερες γραμμές δεν έχουν ιστορικό τιμής — μη πλήρης εκτίμηση">εκτ.*</span>`;
  }

  if (order.value_has_fallback) {
    return `${money} <span class="muted admin-order-value-fallback" title="Ο πελάτης δεν έχει αγοράσει ποτέ ένα ή περισσότερα από αυτά τα είδη. Η τιμή προέρχεται από τιμολόγιο άλλου πελάτη — χαμηλή αξιοπιστία.">εκτ.≈</span>`;
  }

  return `${money} <span class="muted">εκτ.</span>`;
}

function buildLinesTable(order, { escapeHtml, formatMoney }) {
  const lines = order.lines || [];
  if (!lines.length) {
    return `<p class="admin-order-detail-empty">Η παραγγελία δεν έχει γραμμές.</p>`;
  }

  const rows = lines
    .map((line) => {
      const hasPrice = Number(line.unit_price) > 0;
      const isFallback = line.price_source === "last_invoice_any_customer";
      const fallbackMark = isFallback
        ? ` <span class="admin-order-line-fallback" title="Ο πελάτης δεν έχει αγοράσει ποτέ αυτόν τον κωδικό. Η τιμή προέρχεται από τιμολόγιο ΑΛΛΟΥ πελάτη, με τη μέση έκπτωση αυτού του πελάτη.">≈</span>`
        : "";
      const priceCell = hasPrice
        ? `${escapeHtml(formatMoney(line.unit_price))}${fallbackMark}`
        : `<span class="admin-order-line-missing" title="Δεν βρέθηκε ιστορικό τιμής για αυτόν τον κωδικό">χωρίς ιστορικό</span>`;
      const valueCell = hasPrice
        ? escapeHtml(formatMoney(line.line_net_value))
        : "-";

      return `
        <tr${hasPrice ? "" : ' class="is-unpriced"'}>
          <td>${escapeHtml(line.code)}</td>
          <td>${escapeHtml(line.description || "-")}</td>
          <td class="admin-table-number">${Number(line.qty || 0)}</td>
          <td class="admin-table-number">${priceCell}</td>
          <td class="admin-table-number">${formatDiscount(line.discount_pct)}</td>
          <td class="admin-table-number">${valueCell}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <table class="admin-order-lines-table">
      <thead>
        <tr>
          <th>Κωδικός</th>
          <th>Περιγραφή</th>
          <th class="admin-table-number">Τεμάχια</th>
          <th class="admin-table-number">Τιμή μον.</th>
          <th class="admin-table-number">Έκπτ.</th>
          <th class="admin-table-number">Αξία γραμμής</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2">Σύνολο</td>
          <td class="admin-table-number">${Number(order.total_qty_pieces || 0)}</td>
          <td class="admin-table-number"></td>
          <td class="admin-table-number"></td>
          <td class="admin-table-number">${escapeHtml(formatMoney(order.total_net_value))}</td>
        </tr>
      </tfoot>
    </table>
  `;
}

function buildDetailRow(order, context, { isExpanded }) {
  const { escapeHtml } = context;
  const notes = String(order.notes || "").trim();
  const notesHtml = notes
    ? `
        <div class="admin-order-detail-notes">
          <h4>Σχόλια πωλητή</h4>
          <p>${escapeHtml(notes)}</p>
        </div>
      `
    : "";
  const metaParts = [];
  if (order.customer_code) {
    metaParts.push(`Κωδ. πελάτη: ${escapeHtml(order.customer_code)}`);
  }
  if (order.customer_email) {
    metaParts.push(`Email: ${escapeHtml(order.customer_email)}`);
  }
  if (order.needs_manual_price_review) {
    metaParts.push(
      `<span class="admin-order-needs-review">⚠ Η υπηρεσία τιμολόγησης ήταν εκτός λειτουργίας κατά την υποβολή — τιμολογήστε χειροκίνητα</span>`,
    );
  } else if (order.value_is_partial) {
    metaParts.push(
      `<span class="admin-order-line-missing">Μη πλήρης εκτίμηση αξίας</span>`,
    );
  }
  const metaHtml = metaParts.length
    ? `<p class="admin-order-detail-meta">${metaParts.join(" · ")}</p>`
    : "";

  return `
    <tr
      class="admin-order-detail-row"
      id="orderSubmissionDetail-${order.id}"
      data-detail-for="${order.id}"${isExpanded ? "" : " hidden"}
    >
      <td colspan="${ORDER_SUBMISSION_COLUMNS}">
        <div class="admin-order-detail">
          ${metaHtml}
          ${buildLinesTable(order, context)}
          ${notesHtml}
        </div>
      </td>
    </tr>
  `;
}

export async function fetchOrderSubmissions(context) {
  if (context.elements.orderSubmissionsBody) {
    context.elements.orderSubmissionsBody.innerHTML = `
      <tr><td colspan="${ORDER_SUBMISSION_COLUMNS}" class="admin-table-empty">Φόρτωση...</td></tr>
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

  pruneExpandedOrderSubmissions(context);
  renderOrderSubmissions(context);
}

// Orders leave the queue once decided, so drop their expansion state instead of
// letting the set grow with ids that will never render again.
export function pruneExpandedOrderSubmissions(context) {
  const expanded = getExpandedIds(context.state);
  if (!expanded.size) return;
  const liveIds = new Set(
    (context.state.currentOrderSubmissions || []).map((order) =>
      String(order.id),
    ),
  );
  for (const id of expanded) {
    if (!liveIds.has(id)) expanded.delete(id);
  }
}

export function toggleOrderSubmissionDetails(context, orderId) {
  const expanded = getExpandedIds(context.state);
  const key = String(orderId);
  if (expanded.has(key)) {
    expanded.delete(key);
  } else {
    expanded.add(key);
  }
  renderOrderSubmissions(context);
}

export function renderOrderSubmissions(context) {
  const { elements, state, escapeHtml, formatMoney } = context;
  if (!elements.orderSubmissionsBody) return;

  const formatTimestamp = context.formatDateTime || context.formatDate;
  const orders = state.currentOrderSubmissions || [];
  if (!orders.length) {
    elements.orderSubmissionsBody.innerHTML = `
      <tr><td colspan="${ORDER_SUBMISSION_COLUMNS}" class="admin-table-empty">Δεν υπάρχουν εκκρεμείς παραγγελίες.</td></tr>
    `;
    return;
  }

  const expanded = getExpandedIds(state);

  elements.orderSubmissionsBody.innerHTML = orders
    .map((order, index) => {
      const isExpanded = expanded.has(String(order.id));
      const lineCount = (order.lines || []).length;
      const emailHtml = order.customer_email
        ? `<br><span class="muted">${escapeHtml(order.customer_email)}</span>`
        : "";
      const submittedByHtml = buildSubmittedByHtml(order, escapeHtml);
      const valueHtml = buildValueHtml(order, { escapeHtml, formatMoney });

      const summaryRow = `
        <tr
          class="admin-order-summary-row${index % 2 ? " is-alt" : ""}${
            isExpanded ? " is-expanded" : ""
          }"
          data-order-id="${order.id}"
        >
          <td>${escapeHtml(order.customer_name)}${emailHtml}</td>
          <td>${escapeHtml(order.customer_substore || "-")}</td>
          <td>
            <button
              type="button"
              class="admin-order-toggle"
              data-action="toggle"
              data-order-id="${order.id}"
              aria-expanded="${isExpanded}"
              aria-controls="orderSubmissionDetail-${order.id}"
            >
              <span class="admin-order-toggle-caret" aria-hidden="true"></span>
              ${lineCount} ${lineCount === 1 ? "είδος" : "είδη"}
            </button>
          </td>
          <td class="admin-table-number">${Number(order.total_qty_pieces || 0)}</td>
          <td class="admin-table-number">${valueHtml}</td>
          <td><div class="admin-order-notes-preview">${buildNotesPreview(order.notes, escapeHtml)}</div></td>
          <td>${formatOrderDate(order.desired_delivery_date)}</td>
          <td>${formatTimestamp(order.submitted_at)}${submittedByHtml}</td>
          <td>
            <div class="admin-order-submission-actions">
              <input
                type="date"
                class="order-submission-dispatch"
                title="Ημ/νία παράδοσης από έδρα — καταχωρείται με την έγκριση"
                data-dispatch-input
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

      return summaryRow + buildDetailRow(order, context, { isExpanded });
    })
    .join("");
}

export async function decideOrderSubmission(context, orderId, action) {
  const row = context.elements.orderSubmissionsBody?.querySelector(
    `tr[data-order-id="${orderId}"]`,
  );
  const dispatchDate =
    row?.querySelector("[data-dispatch-input]")?.value?.trim() || "";

  try {
    await context.apiFetch(`/api/admin/order-submissions/${orderId}/${action}`, {
      method: "POST",
      ...(action === "approve" && dispatchDate
        ? { body: JSON.stringify({ dispatch_date: dispatchDate }) }
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
