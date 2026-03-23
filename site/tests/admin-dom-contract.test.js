import test from "node:test";
import assert from "node:assert/strict";
import { assertAdminDomContract } from "../public/admin-dom.js";

test("admin DOM contract fails loudly when required ids are missing", () => {
  assert.throws(
    () => assertAdminDomContract({}),
    /Admin DOM contract mismatch/,
  );
});
