# order_form — denylist "held for approval" flow (order-writer denylist)

**Created:** 2026-09-01
**Other half:** `viomes_db/order-writer/src/poll.js` (writer side is DONE — see below).
**Coupling:** DB only, as with the rest of `es1-par-writer-handoff.md`.

The writer's steady state is **allow-all minus a denylist**
(`WRITER_CUSTOMER_DENYLIST` in `order-writer/.env`). A denylisted customer's order
must not be auto-written to ES1 — instead it waits for an owner-admin to approve it
in this app, which releases it to the writer, or reject it.

The denylist itself lives only in the writer's `.env`. **This app never sees the
list** — it just reacts to the `held` status the poller sets, and provides the
approve/reject actions.

---

## The lifecycle with denylist

```
createOrderSubmission           → status='ready'            (unchanged)
poller sees a denylisted 'ready' → status='held'            (poller UPDATE, this app does not)
admin clicks Approve            → status='ready', writer_override=1, approved_by/at set
admin clicks Reject             → status='rejected', rejected_by/at, es1_write_error='rejected by <user>'
poller sees 'ready' + override=1 → writes to ES1 normally   (bypasses the denylist check that once)
```

`held` is a terminal-until-a-human-acts state, exactly like `write_failed`. The poller
never moves a row **out** of `held` — only Approve/Reject here does.

---

## Schema changes (`site/lib/db/init-schema.js`, via `ensureColumn` / `ensureIndex`)

On `orders`:

| Column | Type | Notes |
|---|---|---|
| `writer_override` | `TINYINT(1) NOT NULL DEFAULT 0` | 1 = an admin approved this denylisted order back into the write path. The writer reads it; never reset it here after a write (audit trail). |
| `held_reason` | `VARCHAR(255) NULL` | Set by the poller when it holds a row (`'customer requires manual approval before ES1 import'`). Displayed in the admin table. Also reuse for future hold reasons. |
| `approved_by` | `VARCHAR(120) NULL` | owner-admin username who approved. (These 4 existed in the pre-`ready` schema and were dropped — re-add.) |
| `approved_at` | `DATETIME NULL` | |
| `rejected_by` | `VARCHAR(120) NULL` | |
| `rejected_at` | `DATETIME NULL` | |

**`status` must accept `'held'` and `'rejected'`.** If `orders.status` is a plain
`VARCHAR` this is free. If it's an `ENUM`, add both values in the migration. The
writer's hold step is gated on `writer_override` existing, so shipping that column
is the switch that turns the whole flow on — do the `status` change in the same
migration.

No changes to `order_lines`.

---

## Server (`site/lib/order-submissions.js` + `site/lib/routes/admin.js`)

### 1. Show `held` in the admin table
- Add `held` and `rejected` to `WRITER_LIFECYCLE_STATUSES` **for the admin view only**
  (the salesman-facing views stay unchanged). `admin-salesman-orders-table-handoff.md`
  already lists `held` as an expected status — make sure it's actually in the filter.
- `listOrderSubmissions` — include `writer_override`, `held_reason`, `approved_by`,
  `approved_at`, `rejected_by`, `rejected_at` in the SELECT so the client can render
  the badge + who/when.

### 2. Approve / Reject routes (`registerAdminOrderSubmissionRoutes`, `requireOwnerAdmin`)
- `POST /api/admin/order-submissions/:id/approve`
  ```sql
  UPDATE orders
     SET status='ready', writer_override=1, es1_write_error=NULL,
         approved_by=?, approved_at=NOW()
   WHERE id=? AND status='held'
  ```
  `affectedRows !== 1` → `409` (already acted on / not held). Return the refreshed row.
- `POST /api/admin/order-submissions/:id/reject`
  ```sql
  UPDATE orders
     SET status='rejected', rejected_by=?, rejected_at=NOW(),
         es1_write_error=CONCAT('rejected by ', ?)
   WHERE id=? AND status='held'
  ```
  Same `409` rule.
- Both: username from the authenticated owner-admin session (as elsewhere in
  `routes/admin.js`). No body needed; a `{ reason }` on reject is optional polish.
- **Only `status='held'` rows are actionable.** Never expose approve/reject for
  `ready`/`writing`/`written` — the guard is the `WHERE ... AND status='held'`.

### 3. Do NOT re-introduce the old approval path
`approveOrderSubmission` / `setOrderSubmissionStatus` for the *general* flow stay
deleted (per `es1-par-writer-handoff.md`). This is a separate, denylist-only gate:
same verb, different meaning ("let the robot write this", not "approve the order").

---

## Client (`site/public/admin-orders.js` + `admin-main.js` + `admin.html`)

- Render a **`held`** badge (amber, like `write_failed` is red) with `held_reason` in
  the row detail.
- On a `held` row, show **Approve** and **Reject** buttons (owner-admin only). Approve
  is a plain confirm; Reject a confirm with an optional reason field.
- After either action, refetch (the table already polls every ~12 s per
  `admin-salesman-orders-table-handoff.md` — an immediate refetch on action keeps it
  snappy).
- A `written` row that was previously held can show a small "auto-imported after
  approval" hint if `writer_override=1` — nice-to-have, not required.
- Approved rows briefly reappear as `ready` → `writing` → `written`; that's expected,
  the poller picks them up within one interval.

---

## Writer side — DONE (`viomes_db/order-writer/src/poll.js`, 2026-09-01)

- `WRITER_CUSTOMER_DENYLIST` env var (CSV of customer codes). `denyClause()` pure
  helper, unit-tested (`test/denylist.test.js`, 4 tests; `npm test` = 66).
- `runBatch`: before the write select, if the denylist is non-empty **and**
  `orders.writer_override` exists, it runs
  `UPDATE orders SET status='held'[, held_reason=…] WHERE status='ready' AND
  (writer_override IS NULL OR writer_override=0) AND customer_code IN (…)`
  and logs `batch.held_for_approval {count, denylist}`.
- The poison-park and the write-select both get
  `AND (customer_code NOT IN (…) OR writer_override = 1)` appended, so a denylisted
  row is never claimed unless approved.
- **Degrades safe:** if `orders.writer_override` is absent (this migration not shipped
  yet), the poller skips the `held` transition entirely and just excludes denylisted
  customers from the write path — they stay `ready`, nothing is written or lost. Logs
  `denylist.degraded` once per batch so it's visible.
- `held_reason` is written only if that column exists (`hasColumn` guard).
- `write.ok` log gains `approvedOverride: <bool>` for the audit trail.

So the writer is ready now; it does nothing denylist-related until
`WRITER_CUSTOMER_DENYLIST` is populated **and** this app ships `writer_override`.

---

## Suggested rollout

1. Ship this migration + routes + UI. Writer unaffected (denylist still empty).
2. Blank `WRITER_CUSTOMER_ALLOWLIST`, set `WRITER_CUSTOMER_DENYLIST` to the top retail
   chains (Σκλαβενίτης `121.1.049`, ΑΒ, Sklavenitis…) + dummy accounts
   (`MARK FREI`, `999.9.014`, `000.9.998`, `000.9.999`).
3. Those customers' orders now land in `held`; everyone else auto-writes. Watch
   `order-writer/logs/poller.log` + the admin table for a week.
4. Remove chains from the denylist one at a time as each is eyeballed in ES1.
