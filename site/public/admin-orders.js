const ORDER_SUBMISSION_COLUMNS = 10;
const NOTES_PREVIEW_LENGTH = 60;

// Rows in these statuses can be soft-archived from the panel (mirrors the server's
// ARCHIVABLE_STATUSES). A 'held' row shows Approve/Reject instead (handled first in
// buildActionsCell); 'writing' / 'written' / 'rejected' get no button.
const ARCHIVABLE_CLIENT_STATUSES = new Set(["ready", "write_failed", "held"]);

// orders.status as shown in the admin panel. The general flow is read-only (the ES1
// "100" check is the human gate); the only actions here are the denylist-only
// Approve / Reject on a poller-'held' order.
const ORDER_STATUS_LABELS = {
  ready: "Έτοιμη για ES1",
  writing: "Καταχώρηση…",
  written: "Καταχωρήθηκε",
  write_failed: "Αποτυχία καταχώρησης",
  held: "Σε αναμονή έγκρισης",
  rejected: "Απορρίφθηκε",
};

function buildStatusHtml(order, escapeHtml) {
  const status = String(order.status || "ready");
  const label = ORDER_STATUS_LABELS[status] || status;
  const cls = `admin-order-status admin-order-status-${status.replace(/_/g, "-")}`;

  if (status === "written" && order.es1_document_code) {
    return `<span class="${cls}" title="Καταχωρήθηκε στο ES1">${escapeHtml(
      order.es1_document_code,
    )}</span>`;
  }
  if (status === "write_failed" && order.es1_write_error) {
    return `<span class="${cls}" title="${escapeHtml(
      order.es1_write_error,
    )}">⚠ ${escapeHtml(label)}</span>`;
  }
  if (status === "held" && order.held_reason) {
    return `<span class="${cls}" title="${escapeHtml(
      order.held_reason,
    )}">⏸ ${escapeHtml(label)}</span>`;
  }
  if (status === "rejected") {
    const why = String(order.es1_write_error || "").trim();
    return `<span class="${cls}"${why ? ` title="${escapeHtml(why)}"` : ""}>${escapeHtml(
      label,
    )}</span>`;
  }
  if (status === "written" && order.writer_override) {
    return `<span class="${cls}" title="Καταχωρήθηκε αυτόματα μετά από έγκριση">${escapeHtml(
      label,
    )}</span>`;
  }
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function getExpandedIds(state) {
  if (!(state.expandedOrderSubmissionIds instanceof Set)) {
    state.expandedOrderSubmissionIds = new Set();
  }
  return state.expandedOrderSubmissionIds;
}

function isShowingArchived(context) {
  return Boolean(context.elements.orderSubmissionsShowArchivedToggle?.checked);
}

// from / to (YYYY-MM-DD, either optional) + the archived toggle, as a query string.
function buildOrderSubmissionsQuery(context) {
  const params = new URLSearchParams();
  const from = context.elements.orderSubmissionsFromDate?.value || "";
  const to = context.elements.orderSubmissionsToDate?.value || "";
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (isShowingArchived(context)) params.set("archived", "1");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function buildActionsCell(order, escapeHtml, showArchived) {
  if (showArchived) {
    return `<td class="admin-order-actions"><button type="button" class="btn ghost admin-order-action-btn" data-action="unarchive" data-order-id="${order.id}">Επαναφορά</button></td>`;
  }
  const status = String(order.status || "");
  // A poller-held (denylisted) order: approve back to the writer, or reject it.
  if (status === "held") {
    return (
      `<td class="admin-order-actions">` +
      `<button type="button" class="btn success admin-order-action-btn" data-action="approve" data-order-id="${order.id}">Έγκριση</button>` +
      `<button type="button" class="btn ghost admin-order-action-btn admin-order-action-reject" data-action="reject" data-order-id="${order.id}">Απόρριψη</button>` +
      `</td>`
    );
  }
  if (!ARCHIVABLE_CLIENT_STATUSES.has(status)) {
    return `<td class="admin-order-actions"></td>`;
  }
  return `<td class="admin-order-actions"><button type="button" class="btn ghost admin-order-action-btn" data-action="archive" data-order-id="${order.id}">Αρχειοθέτηση</button></td>`;
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

  const formatTimestamp = context.formatDateTime || context.formatDate;
  const approvalParts = [];
  if (order.status === "held" && order.held_reason) {
    approvalParts.push(`Σε αναμονή: ${escapeHtml(order.held_reason)}`);
  }
  if (order.approved_by) {
    approvalParts.push(
      `Εγκρίθηκε από ${escapeHtml(order.approved_by)}${
        order.approved_at ? ` (${escapeHtml(formatTimestamp(order.approved_at))})` : ""
      }`,
    );
  }
  if (order.rejected_by) {
    approvalParts.push(
      `Απορρίφθηκε από ${escapeHtml(order.rejected_by)}${
        order.rejected_at ? ` (${escapeHtml(formatTimestamp(order.rejected_at))})` : ""
      }`,
    );
  }
  const approvalHtml = approvalParts.length
    ? `<p class="admin-order-detail-approval">${approvalParts.join(" · ")}</p>`
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
          ${approvalHtml}
          ${buildLinesTable(order, context)}
          ${notesHtml}
        </div>
      </td>
    </tr>
  `;
}

// `silent` is the auto-refresh poll: it must not flash "Φόρτωση...", and a failed
// tick must keep the last good table (with a stale marker) rather than blank it.
export async function fetchOrderSubmissions(context, { silent = false } = {}) {
  if (context.state.orderSubmissionsFetchInFlight) return;
  context.state.orderSubmissionsFetchInFlight = true;

  if (!silent && context.elements.orderSubmissionsBody) {
    context.elements.orderSubmissionsBody.innerHTML = `
      <tr><td colspan="${ORDER_SUBMISSION_COLUMNS}" class="admin-table-empty">Φόρτωση...</td></tr>
    `;
  }

  try {
    const payload = await context.apiFetch(
      `/api/admin/order-submissions${buildOrderSubmissionsQuery(context)}`,
      { method: "GET" },
    );
    context.state.currentOrderSubmissions = Array.isArray(payload?.items)
      ? payload.items
      : [];
    context.state.orderSubmissionsStale = false;
    context.state.orderSubmissionsLastFetchAt = Date.now();
  } catch (error) {
    context.state.orderSubmissionsStale = true;
    if (!silent) {
      context.state.currentOrderSubmissions = [];
      context.setStatus(
        `Σφάλμα φόρτωσης παραγγελιών πωλητών: ${error.message}`,
        "error",
      );
    }
  } finally {
    context.state.orderSubmissionsFetchInFlight = false;
  }

  pruneExpandedOrderSubmissions(context);
  renderOrderSubmissions(context);
  context.refreshOrderSubmissionsFreshness?.();
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

  // Hold the table's scroll position across the innerHTML rebuild so an auto-refresh
  // doesn't yank the view back to the top while someone is reading a lower row.
  const scrollHost =
    elements.orderSubmissionsBody.closest?.(".admin-table-wrap") || null;
  const savedScrollTop = scrollHost ? scrollHost.scrollTop : 0;

  const showArchived = isShowingArchived(context);
  const formatTimestamp = context.formatDateTime || context.formatDate;
  const orders = state.currentOrderSubmissions || [];
  if (!orders.length) {
    const message = showArchived
      ? "Δεν υπάρχουν αρχειοθετημένες παραγγελίες."
      : "Δεν υπάρχουν παραγγελίες προς καταχώρηση.";
    elements.orderSubmissionsBody.innerHTML = `
      <tr><td colspan="${ORDER_SUBMISSION_COLUMNS}" class="admin-table-empty">${message}</td></tr>
    `;
    if (scrollHost) scrollHost.scrollTop = savedScrollTop;
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
          <td>${buildStatusHtml(order, escapeHtml)}</td>
          ${buildActionsCell(order, escapeHtml, showArchived)}
        </tr>
      `;

      return summaryRow + buildDetailRow(order, context, { isExpanded });
    })
    .join("");

  if (scrollHost) scrollHost.scrollTop = savedScrollTop;
}

// decideOrderSubmission (approve/reject) was removed with the approval step. The panel
// is now read-only for the ES1 lifecycle; the only mutation left is the reversible
// soft-archive below.

function summarizeSkipped(skipped) {
  if (!skipped?.length) return "";
  const reasons = {
    not_found: "δεν βρέθηκε",
    already_archived: "ήδη αρχειοθετημένη",
    status_not_archivable: "καταχωρείται/καταχωρήθηκε στο ES1",
  };
  const parts = skipped.map(
    (item) => `#${item.id} (${reasons[item.reason] || item.reason})`,
  );
  return ` Παραλείφθηκαν: ${parts.join(", ")}.`;
}

async function runArchiveCall(context, endpoint, ids, { verb }) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!list.length) return;

  try {
    const result = await context.apiFetch(
      `/api/admin/order-submissions/${endpoint}`,
      { method: "POST", body: JSON.stringify({ ids: list }) },
    );
    const done = result?.archived ?? result?.unarchived ?? 0;
    context.setStatus(
      `${verb} ${done} ${done === 1 ? "παραγγελία" : "παραγγελίες"}.${summarizeSkipped(
        result?.skipped,
      )}`,
      "ok",
    );
  } catch (error) {
    context.setStatus(`Σφάλμα αρχειοθέτησης: ${error.message}`, "error");
  }

  await fetchOrderSubmissions(context);
}

// Per-row "Αρχειοθέτηση".
export function archiveOrderSubmission(context, orderId) {
  return runArchiveCall(context, "archive", orderId, { verb: "Αρχειοθετήθηκαν" });
}

// Per-row "Επαναφορά" from the archived view.
export function unarchiveOrderSubmission(context, orderId) {
  return runArchiveCall(context, "unarchive", orderId, { verb: "Επαναφέρθηκαν" });
}

async function runHeldDecision(context, orderId, endpoint, body, okMessage) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id <= 0) return;
  try {
    await context.apiFetch(`/api/admin/order-submissions/${id}/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
    context.setStatus(okMessage, "ok");
  } catch (error) {
    context.setStatus(`Σφάλμα: ${error.message}`, "error");
  }
  await fetchOrderSubmissions(context);
}

// Per-row "Έγκριση" on a poller-held order — release it back to the ΠΑΡ writer.
export function approveHeldOrderSubmission(context, orderId) {
  const proceed =
    typeof context.confirm === "function"
      ? context.confirm(
          "Έγκριση: η παραγγελία θα σταλεί στο ES1 από τον writer. Συνέχεια;",
        )
      : true;
  if (!proceed) return Promise.resolve();
  return runHeldDecision(
    context,
    orderId,
    "approve",
    {},
    `Η παραγγελία #${orderId} εγκρίθηκε και επιστρέφει στην ουρά καταχώρησης.`,
  );
}

// Per-row "Απόρριψη" on a poller-held order — decline it (optional reason).
export function rejectHeldOrderSubmission(context, orderId) {
  const reason =
    typeof context.promptReason === "function"
      ? context.promptReason("Λόγος απόρριψης (προαιρετικό):")
      : "";
  // A null return from the prompt means the admin cancelled the dialog.
  if (reason === null) return Promise.resolve();
  return runHeldDecision(
    context,
    orderId,
    "reject",
    { reason: reason || "" },
    `Η παραγγελία #${orderId} απορρίφθηκε.`,
  );
}
