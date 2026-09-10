import assert from "node:assert/strict";
import test from "node:test";

import {
  renderCustomerTerms,
  renderRecentOrdersTable,
  renderSelectedOrderDetails,
} from "../public/admin-render.js";

function makeTermsElements() {
  return {
    customerTradeDiscountValue: { textContent: "" },
    customerPaymentMethodValue: { textContent: "" },
    customerSettlementMeansValue: { textContent: "" },
    customerCommercialBalanceLimitValue: { textContent: "" },
    customerCreditDaysValue: { textContent: "" },
    customerTermsFreshness: { textContent: "" },
  };
}

test("renderCustomerTerms fills the ES1 terms cards from a record", () => {
  const elements = makeTermsElements();
  renderCustomerTerms(
    { elements },
    {
      tradeDiscountPct: 35,
      paymentMethodCode: "12080",
      paymentMethodLabel: "ΕΠΙΤΑΓΗ 120 ΗΜΕΡΩΝ",
      settlementMeans: "Με έμβασμα",
      commercialBalanceLimit: 700000,
      creditDays: 140,
      generatedAt: "2026-09-10T09:50:03Z",
    },
  );

  assert.equal(elements.customerTradeDiscountValue.textContent, "35%");
  assert.equal(
    elements.customerPaymentMethodValue.textContent,
    "12080 / ΕΠΙΤΑΓΗ 120 ΗΜΕΡΩΝ",
  );
  assert.equal(elements.customerSettlementMeansValue.textContent, "Με έμβασμα");
  assert.match(elements.customerCommercialBalanceLimitValue.textContent, /700[.\s]000/);
  assert.equal(elements.customerCreditDaysValue.textContent, "140 ημ.");
  assert.match(elements.customerTermsFreshness.textContent, /Ενημέρωση:/);
});

test("renderCustomerTerms shows dashes and no freshness when terms is null", () => {
  const elements = makeTermsElements();
  renderCustomerTerms({ elements }, null);

  assert.equal(elements.customerTradeDiscountValue.textContent, "-");
  assert.equal(elements.customerPaymentMethodValue.textContent, "-");
  assert.equal(elements.customerSettlementMeansValue.textContent, "-");
  assert.equal(elements.customerCommercialBalanceLimitValue.textContent, "-");
  assert.equal(elements.customerCreditDaysValue.textContent, "-");
  assert.equal(elements.customerTermsFreshness.textContent, "");
});

test("renderCustomerTerms tolerates partially populated records", () => {
  const elements = makeTermsElements();
  renderCustomerTerms(
    { elements },
    { tradeDiscountPct: 0, creditDays: null, commercialBalanceLimit: null },
  );

  assert.equal(elements.customerTradeDiscountValue.textContent, "0%");
  assert.equal(elements.customerCommercialBalanceLimitValue.textContent, "-");
  assert.equal(elements.customerCreditDaysValue.textContent, "-");
  assert.equal(elements.customerPaymentMethodValue.textContent, "-");
});

test("recent orders table renders the progress step column", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: () => [],
  };

  try {
    const body = { innerHTML: "" };
    renderRecentOrdersTable({
      state: {
        currentDetailedOrders: [
          {
            order_id: "C001::2026-04-09::INV-1",
            created_at: "2026-04-09",
            ordered_at: "2026-04-08",
            progress_step: "5. ΑΠΕΣΤΑΛΗ",
            total_lines: 4,
            total_pieces: 12,
            total_net_value: 48.25,
            average_discount_pct: 35,
          },
        ],
        currentRecentOrdersPage: 1,
        recentOrdersSort: { key: "created_at", direction: "desc" },
        selectedOrderId: null,
      },
      elements: {
        recentOrdersBody: body,
        recentOrdersPagination: null,
        recentOrdersPageInfo: null,
        recentOrdersPrevBtn: null,
        recentOrdersNextBtn: null,
      },
      formatDisplayOrderId: (value) => value,
    });

    assert.match(body.innerHTML, /5\. ΑΠΕΣΤΑΛΗ/);
    assert.equal((body.innerHTML.match(/<td/g) || []).length, 9);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("selected order details render the branch metadata", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelectorAll: () => [],
  };

  try {
    const body = { innerHTML: "" };
    renderSelectedOrderDetails({
      state: {
        selectedOrderId: "C001::2026-04-09::INV-1",
        currentDetailedOrders: [
          {
            order_id: "C001::2026-04-09::INV-1",
            created_at: "2026-04-09",
            ordered_at: "2026-04-08",
            branch_code: "B1",
            branch_description: "Branch 1",
            document_type: "ΤΔΑ",
            total_net_value: 48.25,
            lines: [
              {
                code: "P1",
                description: "Product 1",
                qty: 2,
                unit_price: 12,
                discount_pct: 0,
                line_net_value: 24,
              },
            ],
          },
        ],
        currentDetailedOpenOrders: [],
        currentDetailedPreApprovalOrders: [],
      },
      elements: {
        detailedOrdersList: body,
      },
      findDetailedOrder(orderId) {
        return this.state.currentDetailedOrders.find(
          (order) => String(order.order_id) === String(orderId),
        );
      },
      formatDisplayOrderId: (value) => value,
    });

    assert.match(body.innerHTML, /Υποκατάστημα: B1/);
    assert.match(body.innerHTML, /Branch 1/);
    assert.match(body.innerHTML, /Τύπος: ΤΔΑ/);
  } finally {
    globalThis.document = originalDocument;
  }
});
