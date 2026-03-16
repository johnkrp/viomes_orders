import test from "node:test";
import assert from "node:assert/strict";

import { FACTUAL_LIFECYCLE_RULES } from "../lib/factual-lifecycle.js";

test("factual lifecycle rules derive the expected core sales document groups", () => {
  assert.deepEqual(FACTUAL_LIFECYCLE_RULES.openExecutionDocumentTypes, ["ΠΔΣ"]);
  assert.ok(FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes.includes("ΠΑΡ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.preExecutionDocumentTypes.includes("ΕΑΠ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes.includes("ΤΔΑ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes.includes("ΤΙΠ"));
  assert.ok(FACTUAL_LIFECYCLE_RULES.executedOrderDocumentTypes.includes("ΑΠΛ"));
});

