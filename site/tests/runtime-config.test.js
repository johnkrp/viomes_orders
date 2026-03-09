import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeConfig } from "../lib/runtime-config.js";

function baseOptions(overrides = {}) {
  return {
    cookieSecureMode: "auto",
    syncAdminPasswordOnStartup: "0",
    nodeEnv: "development",
    adminUsernameEnv: "",
    adminPasswordEnv: "",
    defaultAdminPassword: "change-me-now",
    ...overrides,
  };
}

test("allows default admin credentials in local development", () => {
  assert.doesNotThrow(() => validateRuntimeConfig(baseOptions()));
});

test("rejects missing admin username outside local/dev/test", () => {
  assert.throws(
    () => validateRuntimeConfig(baseOptions({ nodeEnv: "production", adminPasswordEnv: "secret" })),
    /without ADMIN_USERNAME/,
  );
});

test("rejects missing admin password outside local/dev/test", () => {
  assert.throws(
    () => validateRuntimeConfig(baseOptions({ nodeEnv: "production", adminUsernameEnv: "admin" })),
    /without ADMIN_PASSWORD/,
  );
});

test("rejects default admin password outside local/dev/test", () => {
  assert.throws(
    () =>
      validateRuntimeConfig(
        baseOptions({
          nodeEnv: "staging",
          adminUsernameEnv: "admin",
          adminPasswordEnv: "change-me-now",
        }),
      ),
    /default admin password/,
  );
});

test("accepts explicit credentials outside local/dev/test", () => {
  assert.doesNotThrow(() =>
    validateRuntimeConfig(
      baseOptions({
        nodeEnv: "production",
        adminUsernameEnv: "ops-admin",
        adminPasswordEnv: "long-random-secret",
      }),
    ),
  );
});
