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

function buildContext(orders, { expandedIds = [] } = {}) {
  const body = { innerHTML: "" };
  return {
    elements: { orderSubmissionsBody: body },
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

  assert.match(context.body.innerHTML, /colspan="8"/);
  assert.match(context.body.innerHTML, /Δεν υπάρχουν εκκρεμείς παραγγελίες/);
});
