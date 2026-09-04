# order_form ⇄ ES1 ΠΑΡ writer — contract & status

**Created:** 2026-08-27 · **Last updated:** 2026-08-28
**Other half:** `viomes_db/order-writer/` (the raw-SQL ΠΑΡ writer) + `viomes_db/pricing-service/`.
**Coupling:** DB only. The writer polls this app's MySQL `orders`/`order_lines`; it never
calls an HTTP endpoint here, and this app never writes to ES1 or invokes the writer.

---

## Status (2026-08-28)

| Piece | Where | State |
|---|---|---|
| order_form schema + lifecycle + admin view | this repo | **DONE** — see "order_form side" below, all verified in `site/lib/db/init-schema.js` / `site/lib/order-submissions.js` |
| Writer W0–W3 (login, money, resolver, shadow-diff) | `viomes_db/order-writer/` | **DONE** — 0 EXACT-tier deltas vs real ΠΑΡ |
| Writer W4 (insert path: dryrun/rollback/live) | `viomes_db/order-writer/` | **DONE** — rollback test passes live (real INSERT + triggers + ROLLBACK) |
| Writer W5 (first live ΠΑΡ) | ES1 | **DONE** — `ΠΑΡ-Μ-37429` committed for ΣΑΝΤΗ. Counter integration confirmed. A UTC+3 date-shift bug was found (`ADRegistrationDate` stored a day early) and fixed. Doc was cancelled; a clean re-run + one pass through `100` is the last check. |
| Writer W5 aftermath (first poller live write) | ES1 | **DONE** — poller wrote `ΠΑΡ-Μ-37429` for order #126 (ΣΑΝΤΗ) end-to-end via `WRITER_MODE=live npm run poll:once`; doc + test rows since deleted, counter back to 37428 |
| **Writer W6 (the poller)** | `viomes_db/order-writer/src/poll.js` | **BUILT** — reconcile + claim + map + resolve + insert(live) + write-back, guardrails, daemon/`--once`. Delivery-site resolution bulk-validated to 99.6%. Remaining: gap #1 change on this side, re-price decision, Task Scheduler wrapper, one real doc through `100` |

**gap #1 (`customer_substore_code`) — DONE & VERIFIED LIVE 2026-08-31.** Column added via
`ensureColumn` (`site/lib/db/init-schema.js`), carried onto the substore `<select>`
options and the submit payload (`site/public/order-form.js`), INSERTed in
`site/lib/order-submissions.js`. Re-submitted the 5 test orders through the running form
and re-ran the poller (dryrun): the three real multi-branch customers (THE MART, ΣΚΛΑΒΕΝΙΤΗΣ,
GREEN CITY) now resolve via `siteMethod: "branch_code"` — ΣΚΛΑΒΕΝΙΤΗΣ lands on code `9154`
deterministically instead of a lucky name match. Single-branch customers (`branch_code` =
placeholder `"1"`) correctly stay on the `site_name`/`sole_site` path. No writer changes
outstanding for delivery-site.

---

## order_form side — DONE (no further changes needed)

All of the 2026-08-27 change list shipped:

1. **Approval step removed.** `createOrderSubmission` inserts `status='ready'` directly.
   `approveOrderSubmission` / `rejectOrderSubmission` / `setOrderSubmissionStatus` and the
   `/api/admin/order-submissions*` approve/reject routes are gone. The admin panel is now a
   read-only lifecycle view (`listOrderSubmissions`).
   Safety confirmed: ES1's `100. Πιστωτικός Έλεγχος` is a hard, non-skippable gate from
   `1. ΑΡΧΙΚΟ` (`151. ΠΑΡ=>ΠΔΣ` needs `2. ΕΓΚΡΙΘΗΚΕ` and re-checks credit).
2. **Customer PO (Αρ. Παραγγελίας)** — **NOW ON THE FORM 2026-09-01.** Optional text
   input under the Υποκατάστημα field → `orders.customer_order_no` (`ensureColumn`
   VARCHAR(128)/TEXT). Writer (`build-document.js` + `order-to-payload.js` + `resolve.js`,
   `hasColumn`-guarded in `poll.js`) prefixes it into BOTH `dd.ADReasoning` and
   `dt.ADReasoning` as the literal `Αρ.Παραγγελίας:<value>` (ES1's own convention,
   1482/1482 PO-carrying ΠΑΡ since 2026-06); `NULL` when blank. Shadow-diff tier E_INFO
   (~45% of real ΠΑΡ carry a hand-typed dispatch note in the same field). Deploys with
   this order_form push — nothing on the writer side needs the column present.
3. **Dispatch date** — not on the form. `orders.dispatch_date` stays nullable/unused.
   Writer inserts `order date + 2 business days` (skip Sat/Sun) into ES1's
   always-populated `ADDateField1` / `DeliveryDueDate` / line `DeliveryDate`; the office
   overwrites in ES1. (Recalibrated 2026-08-30 from +1 calendar day — real hand-keyed
   ΠΑΡ gap is median 2 / mean 3.6 days.)
4. **Duplicate guard** — `createOrderSubmission` rejects a matching
   `customer_code` + normalized `code:qty` signature + `submitted_at` within 5 min with
   HTTP 409.
5. **Writer lifecycle on `orders.status`** — `ready → writing → written / write_failed`
   (+ optional `held`). Columns added via `ensureColumn`:
   `status` (`DEFAULT 'ready'`), `es1_document_code`, `es1_written_at`, `es1_write_error`,
   `es1_write_attempts`, `customer_substore`, `desired_delivery_date`,
   `es1_order_channel_code`, `needs_manual_price_review`, `submitted_by(_role)`,
   `order_lines.price_source`. Index `idx_orders_status_submitted_at (status, submitted_at)`.
6. Voucher/tracking — deferred (lands on `ΠΔΣ`, not `ΠΑΡ`).

---

## Poller contract (W6 — `viomes_db/order-writer/src/poll.js`)

### Read — claim a row

```sql
-- claim (atomic; the WHERE status='ready' is the lock)
UPDATE orders
SET status = 'writing', es1_write_attempts = es1_write_attempts + 1
WHERE id = ? AND status = 'ready';
-- proceed only if rowcount = 1
```

Then read the order + lines:

| MySQL column | → writer payload | notes |
|---|---|---|
| `orders.id` | `correlationId` | written to ES1 `ADStringField2` (decision A) — the reconciliation key. (Not `ADStringField1` — ES1 labels that "CONTAINER/TRUCK Nr." and the office uses it for real; `ADStringField2` "Πεδίο 2" has 0 uses in 17,695 ΠΑΡ.) |
| `orders.customer_code` | `customerCode` | → ES1 GID via `resolveCustomer` |
| `orders.customer_substore` | *(resolve to)* `deliverySiteGid` | Free-text branch label; nullable. Empty ⇒ customer's sole site. `delivery-site.js` `pickDeliverySite` |
| `orders.customer_substore_code` | *(resolve to)* `deliverySiteGid` | **gap #1 — add this column.** `imported_customer_branches.branch_code` == `ESGOSites.Code`; the reliable key (99.6% vs 84.7% on the label). Read only if the column exists |
| `orders.submitted_at` | `receivedDate` | ES1 `ADDateField4` (Ημ/νία Λήψης) |
| `orders.desired_delivery_date` | `desiredDeliveryDate` | ES1 `ADDateField5`; nullable |
| `orders.es1_order_channel_code` | `channelCode` | set to the platform channel on insert; writer default `9070` if null |
| `orders.needs_manual_price_review` OR any line `price_source` ∈ {`last_invoice_any_customer`, `*_caveats`} | `needsManualPriceReview` + `manualReviewComment` | writer appends a `Σχόλιο` (`ADComments`) so the `100` operator prices by hand — never blocks the write (decision D) |
| `order_lines.product_id` → `products.code` | line `itemCode` | → ES1 GID via `resolveItem` |
| `order_lines.qty_pieces` | line `qty` | |
| `order_lines.unit_price` | line `price` | submit-time price from the pricing service; **W6 decision:** reuse as-is (already priced through the same service) unless it's stale enough to re-price |
| `order_lines.discount_pct` | line `discount1` | |
| `orders.total_net_value` | — | ignored; the writer recomputes the money block by formula |

### Write — the result

```sql
-- success
UPDATE orders
SET status='written', es1_document_code=?, es1_written_at=?, es1_write_error=NULL
WHERE id=?;

-- failure
UPDATE orders
SET status='write_failed', es1_write_error=?
WHERE id=?;
```

`es1_write_attempts` was already incremented at claim time. A row that has burned
`WRITER_MAX_ATTEMPTS_PER_ORDER` stays `write_failed` and is not retried.

### Startup reconciliation

On boot, for every `status='writing'` row: check ES1 for a non-cancelled ΠΑΡ whose
`ADStringField2 = orders.id`. If found → set `written` + backfill `es1_document_code`
(a crash landed between the ES1 COMMIT and this write-back). If not → reset to `ready`.

### Guardrails (env, `viomes_db/order-writer/.env`)

- `WRITER_MODE=live`
- `WRITER_CUSTOMER_ALLOWLIST` — **start at `153.4.007` (ΣΑΝΤΗ) only**, widen customer by
  customer once each behaves end to end.
- `WRITER_MAX_WRITES_PER_HOUR` — circuit breaker.
- `WRITER_MAX_ATTEMPTS_PER_ORDER` — poison-row cap.
- Poll interval + backoff on DB errors; append-log every `id → ΠΑΡ code` / failure.

---

## Known gaps for W6

1. ~~**`customer_substore` → `fDeliverySiteGID`.**~~ — writer side **DONE**
   (`viomes_db/order-writer/src/delivery-site.js`, `pickDeliverySite`). Bulk-validated
   over all 3,140 `(customer, branch)` pairs in `imported_customer_branches`
   (`scripts/validate-delivery-site.js`): **99.6% order-weighted auto-resolve**, every
   remaining 0.4% is a *safe* miss (→ `write_failed`, human keys it), none a wrong-branch
   risk.

   **⚠️ needs one change on THIS side to hit that number:** the resolver's reliable key is
   `imported_customer_branches.branch_code`, which is byte-identical to `ESGOSites.Code`
   (`"5040"`, `"1024-1024"`, `"1.A30-1730"`, …). The free-text `branch_description` alone
   only gets 84.7% — big chains like Σκλαβενίτης put a *different* number in the label
   (`"… ΤΟΜΠΑΖΗ - (040)"` for the store whose real code is `5040`). Today the order only
   carries the label. **Add `customer_substore_code`:**
   - `lib/db/init-schema.js` — `ensureColumn('orders', 'customer_substore_code', 'TEXT')`
     (alongside `customer_substore`).
   - `public/order-form.js` — `buildCustomerSubstoreOptions()` already has
     `branch.branch_code`; carry it onto each option (`code: branch.branch_code`) and
     include the selected option's code in the submit payload as `customer_substore_code`.
   - `lib/order-submissions.js` — `createOrderSubmission` INSERT: add the column, value
     `submission.customerSubstoreCode || null`.
   The writer reads it only if the column exists (`orders-db.js` `hasColumn` probe), so
   deploying the writer before this change is safe — it just stays at the 84.7% label path
   until the column lands.
2. ~~**Re-price vs. reuse** `order_lines.unit_price` / `discount_pct` at write time.~~ —
   **DECIDED 2026-08-29: reuse the submit-time price.** It is the price the salesman quoted
   the customer; the `100` operator rechecks it; re-fetching from the pricing service at
   write time would add a dependency and could silently contradict the quote. Revisit only
   if the poller routinely runs hours behind submit.
3. ~~**Reconciliation query** — ΠΑΡ by `ADStringField2`~~ — DONE (`src/reconcile.js`).
4. ~~**Service lifecycle**~~ — DONE 2026-08-29.
   `viomes_db/order-writer/scripts/Start-OrderWriterPoller.ps1` (daemon wrapper) +
   `Register-OrderWriterPollerTask.ps1` (Scheduled Task, S4U / no stored password, mirrors
   the pricing-service tunnel task). Runs `node src/poll.js` as a **daemon** — not `--once`
   — so `WRITER_MAX_WRITES_PER_HOUR` (an in-memory rolling window) actually engages. Cap
   raised 20→40 after measuring real volume (~49 ΠΑΡ/workday, 90th-pct 70, max 107).
5. **Unsupported-class failures** show `es1_write_error = 'import failed'` in the admin
   panel (unknown customer/item, new branch, VAT-inclusive retail, unresolvable site); the
   technical reason stays in `order-writer/logs/poller.log`. Unexpected errors keep full
   detail. Nothing more needed on this side.

## Out of scope (unchanged)

- Any ES1 / SQL Server code — all `viomes_db`.
- Pricing-client behaviour — "unreachable service ⇒ `needs_manual_price_review`, never a
  silent fallback" stays exactly as is.
- Carrier / vehicle fields — master-/warehouse-driven, stay off the form.
