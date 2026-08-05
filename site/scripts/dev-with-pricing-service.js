import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const siteDir = path.resolve(path.dirname(__filename), "..");
const pricingServiceDir =
  process.env.PRICING_SERVICE_DIR ||
  path.resolve(siteDir, "..", "..", "viomes_db", "pricing-service");
const pricingServiceEnvPath = path.join(pricingServiceDir, ".env");

function readPricingServiceEnv() {
  if (!fs.existsSync(pricingServiceEnvPath)) {
    throw new Error(`Pricing service .env not found at ${pricingServiceEnvPath}`);
  }

  return dotenv.parse(fs.readFileSync(pricingServiceEnvPath));
}

async function checkHealth(url) {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return payload?.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealth(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });

  return child;
}

const pricingEnv = readPricingServiceEnv();
const pricingPort = Number(pricingEnv.PORT || 4100);
const pricingServiceUrl =
  process.env.PRICING_SERVICE_URL || `http://127.0.0.1:${pricingPort}`;
const pricingServiceApiKey =
  process.env.PRICING_SERVICE_API_KEY || pricingEnv.PRICING_API_KEY || "";

if (!pricingServiceApiKey) {
  throw new Error(
    `PRICING_API_KEY is missing from ${pricingServiceEnvPath}; cannot configure order-form pricing.`,
  );
}

let pricingChild = null;
if (!(await checkHealth(pricingServiceUrl))) {
  console.log(`Starting pricing service at ${pricingServiceUrl}...`);
  pricingChild = spawnChild(process.execPath, ["src/server.js"], {
    cwd: pricingServiceDir,
    env: { ...process.env, ...pricingEnv },
  });

  if (!(await waitForHealth(pricingServiceUrl))) {
    if (pricingChild && !pricingChild.killed) pricingChild.kill();
    throw new Error(`Pricing service did not become healthy at ${pricingServiceUrl}.`);
  }
}

const serverEnv = {
  ...process.env,
  PRICING_SERVICE_URL: pricingServiceUrl,
  PRICING_SERVICE_API_KEY: pricingServiceApiKey,
};

const serverChild = spawnChild("node", ["server.js"], {
  cwd: siteDir,
  env: serverEnv,
});

function shutdown(signal) {
  if (serverChild && !serverChild.killed) serverChild.kill(signal);
  if (pricingChild && !pricingChild.killed) pricingChild.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdown(signal);
    process.exit(0);
  });
}

serverChild.on("exit", (code, signal) => {
  if (pricingChild && !pricingChild.killed) pricingChild.kill();
  if (signal) process.kill(process.pid, signal);
  process.exit(code || 0);
});
