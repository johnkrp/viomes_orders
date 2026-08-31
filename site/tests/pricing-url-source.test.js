import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createPricingUrlSource } from "../lib/pricing-url-source.js";

async function withBackendDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "viomes-pricing-url-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("createPricingUrlSource reads and trims backend/pricing-url.txt when present", async () => {
  await withBackendDir(async (backendDir) => {
    await writeFile(
      path.join(backendDir, "pricing-url.txt"),
      "  https://abc123.trycloudflare.com  \n",
    );
    const source = createPricingUrlSource({ backendDir, envUrl: "http://ignored:4100" });
    assert.equal(await source.getUrl(), "https://abc123.trycloudflare.com");
  });
});

test("createPricingUrlSource falls back to envUrl when the file is missing", async () => {
  await withBackendDir(async (backendDir) => {
    const source = createPricingUrlSource({
      backendDir,
      envUrl: "http://127.0.0.1:4100",
    });
    assert.equal(await source.getUrl(), "http://127.0.0.1:4100");
  });
});

test("createPricingUrlSource falls back to envUrl when the file is empty", async () => {
  await withBackendDir(async (backendDir) => {
    await writeFile(path.join(backendDir, "pricing-url.txt"), "   \n");
    const source = createPricingUrlSource({
      backendDir,
      envUrl: "http://127.0.0.1:4100",
    });
    assert.equal(await source.getUrl(), "http://127.0.0.1:4100");
  });
});

test("createPricingUrlSource returns null when neither the file nor envUrl is set", async () => {
  await withBackendDir(async (backendDir) => {
    const source = createPricingUrlSource({ backendDir, envUrl: "" });
    assert.equal(await source.getUrl(), null);
  });
});

test("createPricingUrlSource caches the resolved value for the TTL, then picks up a changed file", async () => {
  await withBackendDir(async (backendDir) => {
    const filePath = path.join(backendDir, "pricing-url.txt");
    await writeFile(filePath, "https://first.trycloudflare.com");

    const source = createPricingUrlSource({ backendDir, ttlMs: 20 });
    assert.equal(await source.getUrl(), "https://first.trycloudflare.com");

    // Overwrite while still inside the TTL window - the cached value must win.
    await writeFile(filePath, "https://second.trycloudflare.com");
    assert.equal(await source.getUrl(), "https://first.trycloudflare.com");

    // After the TTL expires, the new URL must be picked up without recreating the source.
    await sleep(30);
    assert.equal(await source.getUrl(), "https://second.trycloudflare.com");
  });
});
