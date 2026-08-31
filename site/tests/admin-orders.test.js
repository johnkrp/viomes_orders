import assert from "node:assert/strict";
import test from "node:test";

import {
  pruneExpandedOrderSubmissions,
  renderOrderSubmissions,
  toggleOrderSubmissionDetails,
} from "../public/admin-orders.js";

function escapeHtml(value) {
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

function buildContext(orders, { expandedIds = [], showArchived = false } = {}) {
  const body = { innerHTML: "" };
  return {
    elements: {
      orderSubmissionsBody: body,
      orderSubmissionsShowArchivedToggle: { checked: showArchived },
    },
    state: {
      currentOrderSubmissions: orders,
      expandedOrderSubmissionIds: new Set(expandedIds),
    },
    escapeHtml,
    formatDate: (value) => String(value ?? "-"),
    formatDateTime: (value) => `${value} 10:30`,
    formatMoney: (value) => `${Number(value || 0).toFixed(2)} €`,
    body,
  };
}

const sampleOrder = {
  id: 7,
  customer_name: "Πελάτης Α",
  customer_email: "a@example.com",
  customer_code: "C001",
  customer_substore: "Κεντρικό",
  notes: "Παράδοση Δευτέρα",
  total_qty_pieces: 12,
  total_net_value: 48.25,
  submitted_at: "2026-07-29",
  value_is_partial: false,
  lines: [
    {
      code: "306",
      description: "Καλάθι απλύτων",
      qty: 10,
      unit_price: 4.0,
      discount_pct: 35,
      line_net_value: 26.0,
    },
    {
      code: "412",
      description: "Λεκάνη",
      qty: 2,
      unit_price: 0,
      discount_pct: 0,
      line_net_value: 0,
    },
  ],
};

test("summary row collapses the line list into a toggle with the item count", () => {
  const context = buildContext([sampleOrder]);
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /data-action="toggle"/);
  assert.match(context.body.innerHTML, /2 είδη/);
  assert.match(context.body.innerHTML, /aria-expanded="false"/);
});

test("a single-line order uses the singular noun", () => {
  const context = buildContext([{ ...sampleOrder, lines: [sampleOrder.lines[0]] }]);
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /1 είδος/);
});

test("collapsed detail row is hidden but still carries the per-line pricing", () => {
  const context = buildContext([sampleOrder]);
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /class="admin-order-detail-row"/);
  assert.match(context.body.innerHTML, /hidden/);
  assert.match(context.body.innerHTML, /Καλάθι απλύτων/);
  assert.match(context.body.innerHTML, /26\.00 €/);
  assert.match(context.body.innerHTML, /35%/);
});

test("expanded detail row drops the hidden attribute and flags the expansion", () => {
  const context = buildContext([sampleOrder], { expandedIds: ["7"] });
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /aria-expanded="true"/);
  assert.match(context.body.innerHTML, /is-expanded/);
  assert.doesNotMatch(context.body.innerHTML, /data-detail-for="7"[^>]*hidden/);
});

test("lines without price history are marked instead of showing a zero price", () => {
  const context = buildContext([sampleOrder], { expandedIds: ["7"] });
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /is-unpriced/);
  assert.match(context.body.innerHTML, /χωρίς ιστορικό/);
});

test("an order needing manual price review shows the warning badge instead of an estimate, even over other value flags", () => {
  const order = {
    ...sampleOrder,
    total_net_value: 0,
    needs_manual_price_review: true,
    value_is_partial: true,
    value_has_fallback: true,
  };
  const context = buildContext([order], { expandedIds: ["7"] });
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /admin-order-needs-review/);
  assert.match(context.body.innerHTML, /Χειροκίνητος έλεγχος τιμής/);
  // The plain partial-estimate badge must not also render for the same order.
  assert.doesNotMatch(context.body.innerHTML, /εκτ\.\*/);
});

test("long notes are truncated in the summary but kept whole in the detail row", () => {
  const notes = "Α".repeat(200);
  const context = buildContext([{ ...sampleOrder, notes }], {
    expandedIds: ["7"],
  });
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /…/);
  assert.match(context.body.innerHTML, new RegExp(`<p>${notes}</p>`));
});

test("toggling flips expansion state and re-renders", () => {
  const context = buildContext([sampleOrder]);
  renderOrderSubmissions(context);
  assert.match(context.body.innerHTML, /aria-expanded="false"/);

  toggleOrderSubmissionDetails(context, 7);
  assert.match(context.body.innerHTML, /aria-expanded="true"/);
  assert.ok(context.state.expandedOrderSubmissionIds.has("7"));

  toggleOrderSubmissionDetails(context, 7);
  assert.match(context.body.innerHTML, /aria-expanded="false"/);
  assert.ok(!context.state.expandedOrderSubmissionIds.has("7"));
});

test("expansion state for orders that left the queue is pruned", () => {
  const context = buildContext([sampleOrder], { expandedIds: ["7", "99"] });

  pruneExpandedOrderSubmissions(context);

  assert.ok(context.state.expandedOrderSubmissionIds.has("7"));
  assert.ok(!context.state.expandedOrderSubmissionIds.has("99"));
});

test("each row shows the submitting salesman's username under the timestamp", () => {
  const context = buildContext([
    { ...sampleOrder, submitted_by: "g.papadopoulos", submitted_by_role: "staff" },
  ]);
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /g\.papadopoulos/);
  // A staff username renders plainly — the "(πελάτης)" tag is customer-only.
  assert.doesNotMatch(context.body.innerHTML, /g\.papadopoulos<\/span>\s*\(πελάτης\)/);
});

test("escaping still applies to customer and line text", () => {
  const context = buildContext(
    [
      {
        ...sampleOrder,
        customer_name: '<img src=x onerror="alert(1)">',
        lines: [{ ...sampleOrder.lines[0], description: "<script>" }],
      },
    ],
    { expandedIds: ["7"] },
  );
  renderOrderSubmissions(context);

  assert.doesNotMatch(context.body.innerHTML, /<img src=x/);
  assert.doesNotMatch(context.body.innerHTML, /<script>/);
  assert.match(context.body.innerHTML, /&lt;script&gt;/);
});

test("empty queue renders the placeholder across all columns", () => {
  const context = buildContext([]);
  renderOrderSubmissions(context);

  // 10 columns: status + the trailing archive-actions column.
  assert.match(context.body.innerHTML, /colspan="10"/);
  assert.match(context.body.innerHTML, /Δεν υπάρχουν παραγγελίες προς καταχώρηση/);
});

test("the row shows the ES1 writer status and never an approve/reject control", () => {
  const context = buildContext([{ ...sampleOrder, status: "ready" }]);
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /Έτοιμη για ES1/);
  assert.doesNotMatch(context.body.innerHTML, /data-action="approve"/);
  assert.doesNotMatch(context.body.innerHTML, /data-action="reject"/);
  assert.doesNotMatch(context.body.innerHTML, /data-dispatch-input/);
});

test("a written order shows its ES1 document code; a failed one shows the error as a tooltip", () => {
  const written = {
    ...sampleOrder,
    status: "written",
    es1_document_code: "ΠΑΡ-Μ-37411",
  };
  const failed = {
    ...sampleOrder,
    id: 8,
    status: "write_failed",
    es1_write_error: "customer GID not found",
  };
  const context = buildContext([written, failed]);
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /ΠΑΡ-Μ-37411/);
  assert.match(context.body.innerHTML, /admin-order-status-written/);
  assert.match(context.body.innerHTML, /admin-order-status-write-failed/);
  assert.match(context.body.innerHTML, /title="customer GID not found"/);
});

test("archivable rows get an archive button; writing/written rows get none", () => {
  const context = buildContext([
    { ...sampleOrder, id: 1, status: "ready" },
    { ...sampleOrder, id: 2, status: "write_failed" },
    { ...sampleOrder, id: 3, status: "held" },
    { ...sampleOrder, id: 4, status: "writing" },
    { ...sampleOrder, id: 5, status: "written", es1_document_code: "ΠΑΡ-Μ-1" },
  ]);
  renderOrderSubmissions(context);
  const html = context.body.innerHTML;

  for (const id of [1, 2, 3]) {
    assert.match(
      html,
      new RegExp(`data-action="archive" data-order-id="${id}"`),
    );
  }
  assert.doesNotMatch(html, /data-action="archive" data-order-id="4"/);
  assert.doesNotMatch(html, /data-action="archive" data-order-id="5"/);
  // The select-to-archive checkbox is gone entirely — one button per row is all.
  assert.doesNotMatch(html, /data-archive-select/);
});

test("the archived view swaps in a restore control instead of archive", () => {
  const context = buildContext(
    [{ ...sampleOrder, status: "ready" }],
    { showArchived: true },
  );
  renderOrderSubmissions(context);

  assert.match(context.body.innerHTML, /data-action="unarchive"/);
  assert.match(context.body.innerHTML, /Επαναφορά/);
  assert.doesNotMatch(context.body.innerHTML, /data-action="archive"/);
});
