import test from "node:test";
import assert from "node:assert/strict";
import { estimateOrderValue } from "../lib/order-value-estimate.js";

// The live pricing branch never touches `db` - a stub proves that (the heuristic branch
// would throw immediately if it tried to run a query against it).
const untouchedDb = {
  async get() {
    throw new Error("db.get should not be called when a pricingClient is configured");
  },
};

const items = [
  { code: "155-60", qty: 12 },
  { code: "1050-58", qty: 36 },
  { code: "UNKNOWN", qty: 1 },
];

test("estimateOrderValue prices from the live pricing service when a pricingClient is configured", async () => {
  const pricingClient = {
    async priceLines(customerCode, requestedItems) {
      assert.equal(customerCode, "121.1.047");
      assert.deepEqual(
        requestedItems.map((i) => i.code),
        items.map((i) => i.code),
      );
      return [
        {
          itemCode: "155-60",
          qty: 12,
          price: 8.24,
          discount1: 40,
          discount2: 0,
          discount3: 0,
          discount4: 0,
          netValue: 59.33,
          source: "pricelist_direct",
          confidence: "verified",
          warnings: [],
        },
        {
          itemCode: "1050-58",
          qty: 36,
          price: 1.5,
          discount1: 30,
          discount2: 5,
          discount3: 0,
          discount4: 0,
          netValue: 35.9,
          source: "zone_fallback",
          confidence: "verified_with_caveats",
          warnings: ["price_zone_unverified: PriceZone=1 was never observed live this session"],
        },
        { error: "item_not_found", itemCode: "UNKNOWN" },
      ];
    },
  };

  const result = await estimateOrderValue(untouchedDb, {
    customerCode: "121.1.047",
    items,
    pricingClient,
  });

  assert.equal(result.pricingSource, "live");
  assert.equal(result.needsManualPriceReview, false);
  assert.equal(result.totalLines, 3);
  assert.equal(result.pricedLines, 2);
  assert.equal(result.isPartial, true);
  assert.equal(result.hasFallback, true);
  assert.equal(result.fallbackLines, 1);
  assert.equal(result.totalNetValue, 95.23);

  assert.equal(result.lines[0].source, "live_pricelist_direct");
  assert.equal(result.lines[0].unitPrice, 8.24);
  assert.equal(result.lines[0].discountPct, 40);
  assert.equal(result.lines[0].lineNetValue, 59.33);

  assert.equal(result.lines[1].source, "live_zone_fallback_caveats");
  // 1 - (1-0.30)*(1-0.05) = 33.5%
  assert.equal(result.lines[1].discountPct, 33.5);

  assert.equal(result.lines[2].source, "live_item_not_found");
  assert.equal(result.lines[2].unitPrice, 0);
  assert.equal(result.lines[2].lineNetValue, 0);

  for (const line of result.lines) {
    assert.equal("priced" in line, false);
    assert.equal("hasCaveats" in line, false);
  }
});

test("estimateOrderValue falls back to the heuristic (not manual review) when a dynamic pricingClient currently has no URL resolved", async () => {
  // Mirrors what pricing-client.js's createPricingServiceClient throws when its
  // urlSource (pricing-url-source.js) has nothing to resolve right now - e.g. before
  // backend/pricing-url.txt has ever been written. This must behave exactly like a
  // null pricingClient, not like a reachable-but-failing one.
  const pricingClient = {
    async priceLines() {
      const error = new Error("Pricing service is not currently configured.");
      error.code = "PRICING_NOT_CONFIGURED";
      throw error;
    },
  };

  const noHistoryDb = { async get() { return undefined; } };

  const result = await estimateOrderValue(noHistoryDb, {
    customerCode: "121.1.047",
    items: [{ code: "155-60", qty: 12 }],
    pricingClient,
  });

  assert.equal(result.needsManualPriceReview, false);
  assert.equal(result.pricingSource, "heuristic");
});

test("estimateOrderValue flags the whole order for manual review when the pricing service is unreachable, never falling back to the heuristic", async () => {
  const pricingClient = {
    async priceLines() {
      const error = new Error("Pricing service timed out after 8000ms.");
      error.status = 504;
      throw error;
    },
  };

  const result = await estimateOrderValue(untouchedDb, {
    customerCode: "121.1.047",
    items,
    pricingClient,
  });

  assert.equal(result.needsManualPriceReview, true);
  assert.equal(result.pricingSource, "live_unavailable");
  assert.equal(result.totalNetValue, 0);
  assert.equal(result.pricedLines, 0);
  assert.equal(result.isPartial, true);
  for (const line of result.lines) {
    assert.equal(line.source, "manual_review_required");
    assert.equal(line.unitPrice, 0);
    assert.equal(line.lineNetValue, 0);
  }
});
