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

test("stockLevels posts itemCodes[] with the API key header and returns levels[]", async () => {
  const originalFetch = globalThis.fetch;
  let captured;

  globalThis.fetch = async (url, options = {}) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          levels: [
            {
              itemCode: "66-50",
              available: 3,
              onHand101: 5,
              onHandCompany: 12,
              isMixedContent: true,
              fulfillmentCode: "66-51",
            },
          ],
          asOf: "2026-09-02T10:00:00.000Z",
        };
      },
    };
  };

  try {
    const client = createPricingServiceClient({
      baseUrl: "http://srv2019:4100/",
      apiKey: "secret-key",
    });

    // Duplicates and blanks are collapsed before the request goes out.
    const levels = await client.stockLevels(["66-50", " 66-50 ", "", "101-14"]);

    assert.equal(captured.url, "http://srv2019:4100/stock-levels");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers["X-Pricing-Api-Key"], "secret-key");
    assert.deepEqual(JSON.parse(captured.options.body), {
      itemCodes: ["66-50", "101-14"],
    });
    assert.equal(levels.length, 1);
    assert.equal(levels[0].isMixedContent, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stockLevels short-circuits to [] for an all-blank code list (no fetch)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called");
  };
  try {
    const client = createPricingServiceClient({ baseUrl: "http://srv2019:4100" });
    assert.deepEqual(await client.stockLevels(["", "   ", null, undefined]), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stockLevels throws a 502 on a non-2xx response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    async json() {
      return { error: "stock_not_configured" };
    },
  });
  try {
    const client = createPricingServiceClient({ baseUrl: "http://srv2019:4100" });
    await assert.rejects(() => client.stockLevels(["X"]), /stock_not_configured/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stockLevels throws when the payload is missing levels[]", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { asOf: "2026-09-02T10:00:00.000Z" };
    },
  });
  try {
    const client = createPricingServiceClient({ baseUrl: "http://srv2019:4100" });
    await assert.rejects(() => client.stockLevels(["X"]), /unexpected payload shape/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stockLevels throws PRICING_NOT_CONFIGURED when the urlSource resolves nothing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called when no URL is resolved");
  };
  try {
    const client = createPricingServiceClient({
      urlSource: { async getUrl() { return null; } },
    });
    await assert.rejects(
      () => client.stockLevels(["X"]),
      (error) => error.code === "PRICING_NOT_CONFIGURED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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
