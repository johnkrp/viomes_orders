import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createCustomerTermsStore,
  settlementMeansLabel,
  SETTLEMENT_MEANS_LABELS,
} from "../lib/customer-terms.js";

async function tmpFile(contents) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "viomes-customer-terms-"));
  const filePath = path.join(dir, "customer-terms.json");
  if (contents !== undefined) await writeFile(filePath, contents, "utf8");
  return { dir, filePath };
}

const SAMPLE = JSON.stringify({
  generatedAt: "2026-09-10T09:50:03Z",
  companyCode: "001",
  count: 1,
  customers: {
    "121.1.049": {
      name: "ΕΛΛΗΝΙΚΕΣ ΥΠΕΡΑΓΟΡΕΣ ΣΚΛΑΒΕΝΙΤΗΣ A.E.E.",
      tradeDiscountPct: 35,
      commercialBalanceLimit: 700000,
      creditDays: 140,
      settlementMeansCode: 1,
      paymentMethodCode: "12080",
      paymentMethodLabel: "ΕΠΙΤΑΓΗ 120 ΗΜΕΡΩΝ",
    },
  },
});

test("settlementMeansLabel maps known codes and rejects the rest", () => {
  assert.equal(settlementMeansLabel(0), "Μετρητά");
  assert.equal(settlementMeansLabel(1), "Με έμβασμα");
  assert.equal(settlementMeansLabel(2), "Επιταγή");
  assert.equal(settlementMeansLabel("1"), "Με έμβασμα");
  assert.equal(settlementMeansLabel(9), null);
  assert.equal(settlementMeansLabel(null), null);
  assert.equal(settlementMeansLabel(""), null);
  assert.deepEqual(Object.keys(SETTLEMENT_MEANS_LABELS), ["0", "1", "2"]);
});

test("get() returns a record enriched with settlement label and freshness", async () => {
  const { dir, filePath } = await tmpFile(SAMPLE);
  try {
    const store = createCustomerTermsStore({ filePath });
    const terms = await store.get("121.1.049");
    assert.equal(terms.tradeDiscountPct, 35);
    assert.equal(terms.commercialBalanceLimit, 700000);
    assert.equal(terms.creditDays, 140);
    assert.equal(terms.paymentMethodCode, "12080");
    assert.equal(terms.paymentMethodLabel, "ΕΠΙΤΑΓΗ 120 ΗΜΕΡΩΝ");
    assert.equal(terms.settlementMeans, "Με έμβασμα");
    assert.equal(terms.generatedAt, "2026-09-10T09:50:03Z");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("get() trims the code and returns null for unknown / blank codes", async () => {
  const { dir, filePath } = await tmpFile(SAMPLE);
  try {
    const store = createCustomerTermsStore({ filePath });
    assert.ok(await store.get("  121.1.049 "));
    assert.equal(await store.get("999.9.999"), null);
    assert.equal(await store.get(""), null);
    assert.equal(await store.get(null), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing file is an expected empty state, not an error", async () => {
  const { dir, filePath } = await tmpFile();
  try {
    const store = createCustomerTermsStore({ filePath });
    assert.equal(await store.get("121.1.049"), null);
    assert.deepEqual(await store.meta(), { generatedAt: null, count: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a UTF-8 BOM prefix is tolerated", async () => {
  const { dir, filePath } = await tmpFile("﻿" + SAMPLE);
  try {
    const store = createCustomerTermsStore({ filePath });
    const terms = await store.get("121.1.049");
    assert.equal(terms?.creditDays, 140);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corrupt file keeps the last good cache and does not throw", async () => {
  const { dir, filePath } = await tmpFile(SAMPLE);
  const warnings = [];
  try {
    const store = createCustomerTermsStore({
      filePath,
      logger: { warn: (message) => warnings.push(message) },
    });
    assert.ok(await store.get("121.1.049"));

    // Corrupt it and bump mtime so the store re-reads.
    await writeFile(filePath, "{ not json", "utf8");
    const future = new Date(Date.now() + 60_000);
    await utimes(filePath, future, future);

    const terms = await store.get("121.1.049");
    assert.equal(terms?.creditDays, 140, "should still serve the cached record");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /failed to read\/parse/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an updated file is picked up when its mtime changes", async () => {
  const { dir, filePath } = await tmpFile(SAMPLE);
  try {
    const store = createCustomerTermsStore({ filePath });
    assert.equal((await store.get("121.1.049")).creditDays, 140);

    const updated = JSON.parse(SAMPLE);
    updated.customers["121.1.049"].creditDays = 90;
    updated.generatedAt = "2026-09-17T09:00:00Z";
    await writeFile(filePath, JSON.stringify(updated), "utf8");
    const future = new Date(Date.now() + 60_000);
    await utimes(filePath, future, future);

    const terms = await store.get("121.1.049");
    assert.equal(terms.creditDays, 90);
    assert.equal(terms.generatedAt, "2026-09-17T09:00:00Z");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
