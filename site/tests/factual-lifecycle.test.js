import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FACTUAL_LIFECYCLE_RULES } from "../lib/factual-lifecycle.js";

test("factual lifecycle rules derive the expected core sales document groups", () => {
  assert.deepEqual(FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes, ["ΠΔΣ"]);
  assert.ok(FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes.includes("ΠΑΡ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes.includes("ΕΑΠ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes.includes("ΤΔΑ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes.includes("ΤΙΠ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes.includes("ΑΠΛ"));
});

test("factual lifecycle runtime rules match the shared artifact exactly", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const artifactPath = path.resolve(__dirname, "../../factual_lifecycle_rules.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  assert.deepEqual(FACTUAL_LIFECYCLE_RULES, artifact);
});
