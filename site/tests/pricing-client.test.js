import test from "node:test";
import assert from "node:assert/strict";
import { createPricingServiceClient } from "../lib/pricing-client.js";

test("createPricingServiceClient returns null when no base URL is configured", () => {
  assert.equal(createPricingServiceClient({}), null);
  assert.equal(createPricingServiceClient({ baseUrl: "   " }), null);
});

test("pricing client posts customerCode/lines and the API key header, returns lines[]", async () => {
  const originalFetch = globalThis.fetch;
  let captured;

  globalThis.fetch = async (url, options = {}) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          customerCode: "121.1.047",
          lines: [
            { itemCode: "155-60", qty: 12, price: 8.24, discount1: 40, discount2: 0, discount3: 0, discount4: 0, netValue: 59.328, source: "pricelist_direct", confidence: "verified", warnings: [] },
          ],
          asOf: "2026-08-04T00:00:00.000Z",
        };
      },
    };
  };

  try {
    const client = createPricingServiceClient({
      baseUrl: "http://srv2019:4100/",
      apiKey: "secret-key",
      timeoutMs: 5000,
    });

    const lines = await client.priceLines("121.1.047", [{ code: "155-60", qty: 12 }]);

    assert.equal(captured.url, "http://srv2019:4100/price-lines");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers["X-Pricing-Api-Key"], "secret-key");
    const body = JSON.parse(captured.options.body);
    assert.deepEqual(body, {
      customerCode: "121.1.047",
      lines: [{ itemCode: "155-60", qty: 12 }],
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].source, "pricelist_direct");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pricing client throws a 502 on a non-2xx response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    async json() {
      return { error: "unauthorized" };
    },
  });

  try {
    const client = createPricingServiceClient({ baseUrl: "http://srv2019:4100" });
    await assert.rejects(
      () => client.priceLines("C001", [{ code: "X", qty: 1 }]),
      /unauthorized/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pricing client throws when the payload is missing lines[]", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { customerCode: "C001" };
    },
  });

  try {
    const client = createPricingServiceClient({ baseUrl: "http://srv2019:4100" });
    await assert.rejects(
      () => client.priceLines("C001", [{ code: "X", qty: 1 }]),
      /unexpected payload shape/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pricing client with a urlSource re-resolves the base URL on every call", async () => {
  const originalFetch = globalThis.fetch;
  const urls = ["http://first:4100", "http://second:4100"];
  const captured = [];

  globalThis.fetch = async (url) => {
    captured.push(url);
    return { ok: true, status: 200, async json() { return { lines: [] }; } };
  };

  try {
    const urlSource = { async getUrl() { return urls.shift() || null; } };
    const client = createPricingServiceClient({ urlSource });

    await client.priceLines("C001", [{ code: "X", qty: 1 }]);
    await client.priceLines("C001", [{ code: "X", qty: 1 }]);

    assert.deepEqual(captured, [
      "http://first:4100/price-lines",
      "http://second:4100/price-lines",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pricing client with a urlSource that resolves nothing throws a PRICING_NOT_CONFIGURED error instead of fetching", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called when no URL is resolved");
  };

  try {
    const urlSource = { async getUrl() { return null; } };
    const client = createPricingServiceClient({ urlSource });

    assert.equal(await client.isConfigured(), false);
    await assert.rejects(
      () => client.priceLines("C001", [{ code: "X", qty: 1 }]),
      (error) => error.code === "PRICING_NOT_CONFIGURED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createPricingServiceClient with only a urlSource (no static baseUrl) is not null", () => {
  const client = createPricingServiceClient({ urlSource: { async getUrl() { return null; } } });
  assert.notEqual(client, null);
});

test("pricing client throws a timeout error when the request hangs past timeoutMs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, { signal } = {}) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  try {
    const client = createPricingServiceClient({
      baseUrl: "http://srv2019:4100",
      timeoutMs: 1000,
    });
    await assert.rejects(
      () => client.priceLines("C001", [{ code: "X", qty: 1 }]),
      /timed out/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
