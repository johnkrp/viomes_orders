import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCorsOriginDelegate,
  buildSessionCookieOptions,
  getRequestOrigin,
  isOriginAllowed,
  resolveAllowedCorsOrigins,
} from "../lib/http-security.js";

test("resolveAllowedCorsOrigins honors explicit configured origins", () => {
  const origins = resolveAllowedCorsOrigins({
    nodeEnv: "production",
    corsAllowedOrigins: "https://orders.viomes.gr, https://admin.viomes.gr ",
    port: 3001,
  });

  assert.deepEqual(origins, ["https://orders.viomes.gr", "https://admin.viomes.gr"]);
});

test("resolveAllowedCorsOrigins falls back to localhost origins in local environments", () => {
  const origins = resolveAllowedCorsOrigins({
    nodeEnv: "development",
    corsAllowedOrigins: "",
    port: 3001,
  });

  assert.match(origins.join(","), /http:\/\/localhost:3001/);
  assert.match(origins.join(","), /http:\/\/127\.0\.0\.1:5173/);
});

test("isOriginAllowed permits same-origin requests without Origin and blocks unknown origins", () => {
  assert.equal(isOriginAllowed(undefined, []), true);
  assert.equal(isOriginAllowed("https://orders.viomes.gr", ["https://orders.viomes.gr"]), true);
  assert.equal(isOriginAllowed("https://evil.example", ["https://orders.viomes.gr"]), false);
});

test("getRequestOrigin derives the effective request origin from forwarded proto and host", () => {
  const req = {
    secure: false,
    headers: {
      host: "orders.viomes.gr",
      "x-forwarded-proto": "https",
    },
  };

  assert.equal(getRequestOrigin(req), "https://orders.viomes.gr");
});

test("isOriginAllowed permits same-origin browser requests in production without explicit CORS env", () => {
  const req = {
    secure: false,
    headers: {
      host: "orders.viomes.gr",
      "x-forwarded-proto": "https",
    },
  };

  assert.equal(isOriginAllowed("https://orders.viomes.gr", [], req), true);
  assert.equal(isOriginAllowed("https://evil.example", [], req), false);
});

test("buildCorsOriginDelegate returns an error for disallowed origins", async () => {
  const delegate = buildCorsOriginDelegate({
    nodeEnv: "production",
    corsAllowedOrigins: "https://orders.viomes.gr",
    port: 3001,
  });

  await new Promise((resolve, reject) => {
    delegate.origin("https://evil.example", { headers: { host: "orders.viomes.gr" } }, (error, allowed) => {
      try {
        assert.match(String(error), /CORS origin not allowed/);
        assert.equal(allowed, undefined);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
});

test("buildCorsOriginDelegate permits same-origin browser requests without explicit production allowlist", async () => {
  const delegate = buildCorsOriginDelegate({
    nodeEnv: "production",
    corsAllowedOrigins: "",
    port: 3001,
  });

  await new Promise((resolve, reject) => {
    delegate.origin(
      "https://orders.viomes.gr",
      { secure: false, headers: { host: "orders.viomes.gr", "x-forwarded-proto": "https" } },
      (error, allowed) => {
        try {
          assert.equal(error, null);
          assert.equal(allowed, true);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });
});

test("buildSessionCookieOptions keeps cookie set and clear attributes aligned", () => {
  assert.deepEqual(buildSessionCookieOptions({ secure: true }), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  assert.deepEqual(buildSessionCookieOptions({ secure: false }), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });
});
