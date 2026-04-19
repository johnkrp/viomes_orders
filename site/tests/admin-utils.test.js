import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesBranchSearch,
  normalizeBranchSearchText,
} from "../public/admin-utils.js";

test("normalizeBranchSearchText transliterates Greek branch search text", () => {
  assert.equal(normalizeBranchSearchText("ΚΡΗΤΗ - ΛΧΑΝΙΩΝ"), "kriti lxanion");
  assert.equal(normalizeBranchSearchText("ΧΑΝ"), "xan");
  assert.equal(normalizeBranchSearchText("ΜΗΧΑΝΙΩΝΑ"), "mixaniona");
});

test("matchesBranchSearch tolerates Greek and Latin equivalents for branch filtering", () => {
  const branch = {
    branch_code: "2057",
    branch_description: "ΚΡΗΤΗ - ΛΧΑΝΙΩΝ - (057) (73100)",
  };

  assert.equal(matchesBranchSearch(branch, "ΚΡΗ"), true);
  assert.equal(matchesBranchSearch(branch, "KRI"), true);
  assert.equal(matchesBranchSearch(branch, "ΧΑΝ"), true);
  assert.equal(matchesBranchSearch(branch, "XAN"), true);
  assert.equal(matchesBranchSearch(branch, "ΘΕΣ"), false);
});
