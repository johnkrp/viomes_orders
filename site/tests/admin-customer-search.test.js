import assert from "node:assert/strict";
import test from "node:test";
import {
  getImportedCustomerByCode,
  searchImportedCustomers,
} from "../lib/admin-customer-search.js";

test("searchImportedCustomers returns empty results without filters", async () => {
  let called = false;
  const db = {
    async all() {
      called = true;
      return [];
    },
  };

  const payload = await searchImportedCustomers(db, {}, { limit: 20 });

  assert.equal(called, false);
  assert.deepEqual(payload, {
    items: [],
    total: 0,
    filters: {
      customer_name: "",
      customer_code: "",
      branch_code: "",
      branch_description: "",
    },
  });
});

test("searchImportedCustomers queries imported_customer_branches and formats grouped results", async () => {
  const calls = [];
  const db = {
    async all(sql, params) {
      calls.push({ sql, params });
      return [
        {
          code: "C001",
          name: "Alpha Store",
          branch_count: 2,
          branch_code: "",
          branch_description: "",
        },
      ];
    },
  };

  const payload = await searchImportedCustomers(
    db,
    {
      customer_name: "Alpha",
      branch_description: "Athens",
    },
    { limit: "10" },
  );

  assert.match(calls[0].sql, /FROM imported_customer_branches/);
  assert.deepEqual(calls[0].params, [
    "%Alpha%",
    "%Athens%",
    "Alpha",
    "Athens",
    "Alpha%",
    "Athens%",
    10,
  ]);
  assert.deepEqual(payload, {
    filters: {
      customer_name: "Alpha",
      customer_code: "",
      branch_code: "",
      branch_description: "Athens",
    },
    total: 1,
    items: [
      {
        code: "C001",
        name: "Alpha Store",
        branch_description: "2 υποκαταστήματα",
      },
    ],
  });
});

test("getImportedCustomerByCode returns the matching record", async () => {
  const db = {
    async get(sql, params) {
      assert.match(sql, /FROM imported_customers/);
      assert.deepEqual(params, ["C001"]);
      return { code: "C001", name: "Alpha Store", is_inactive: 0 };
    },
  };

  const record = await getImportedCustomerByCode(db, "C001");
  assert.deepEqual(record, {
    code: "C001",
    name: "Alpha Store",
    is_inactive: false,
  });
});

test("getImportedCustomerByCode returns null for an unknown code", async () => {
  const db = { async get() { return undefined; } };
  const record = await getImportedCustomerByCode(db, "UNKNOWN");
  assert.equal(record, null);
});

test("getImportedCustomerByCode returns null for a blank code without querying", async () => {
  let called = false;
  const db = {
    async get() {
      called = true;
      return undefined;
    },
  };

  const record = await getImportedCustomerByCode(db, "  ");
  assert.equal(record, null);
  assert.equal(called, false);
});

test("getImportedCustomerByCode reports is_inactive as a boolean", async () => {
  const db = {
    async get() {
      return { code: "C999", name: "Inactive Store", is_inactive: 1 };
    },
  };

  const record = await getImportedCustomerByCode(db, "C999");
  assert.equal(record.is_inactive, true);
});
