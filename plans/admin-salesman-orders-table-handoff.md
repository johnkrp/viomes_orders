# order_form — admin "salesman orders" table: date filters, auto-refresh, archive

**Created:** 2026-08-31
**Scope:** the admin page's order-submissions panel (`public/admin-orders.js`,
`GET /api/admin/order-submissions`).
**Decisions locked (user, 2026-08-31):**
- Real-time = **auto-refresh by polling every ~10–15 s** (no WebSocket/SSE).
- "Clear" = **soft-archive**, reversible; never a hard delete.
- Table shows **lifecycle statuses only** (`ready` / `writing` / `written` /
  `write_failed` / `held`); legacy `pending` / `rejected` stay hidden.
- **Value column is unchanged** — it already shows `total_net_value` computed by the
  pricing service at submit time (not a heuristic); the quality badges stay. No live
  re-pricing.

---

## Current state (as built)

- **Route:** `GET /api/admin/order-submissions`, `requireOwnerAdmin`, body `{ items }`.
  `lib/routes/admin.js` → `registerAdminOrderSubmissionRoutes`.
- **Query:** `listOrderSubmissions(db)` in `lib/order-submissions.js:395` —
  `SELECT … FROM orders WHERE status IN (WRITER_LIFECYCLE_STATUSES) ORDER BY submitted_at DESC LIMIT 200`,
  plus a second query for `order_lines` (with `line_net_value`, `price_source`).
- **Client:** `public/admin-orders.js` — `fetchOrderSubmissions()` +
  `renderOrderSubmissions()`. Refresh is **manual only** (`refreshOrderSubmissionsBtn`
  in `admin-main.js:983`). Expanded rows are tracked in `state` and pruned by
  `pruneExpandedOrderSubmissions()`.
- **Auth:** owner-admin only. Client uses `apiFetch` (so the `/login` 401 bounce from
  `auth-gate-login-redirect-handoff.md` covers it).

So this is an *enhancement* of an existing panel, not a new one.

---

## Change 1 — date filters

### Server
- `listOrderSubmissions(db, { from, to } = {})` — add
  `AND submitted_at >= ? AND submitted_at < ?` when supplied. `to` is treated as an
  **exclusive** next-day boundary (or `to + ' 23:59:59'`), so a single-day filter with
  `from == to` works. Validate both with the existing `validateOptionalOrderDate()`
  helper in the same file.
- Route: `GET /api/admin/order-submissions?from=YYYY-MM-DD&to=YYYY-MM-DD`. Bad dates →
  `400`.
- Keep `WHERE status IN (WRITER_LIFECYCLE_STATUSES)` and add `AND archived_at IS NULL`
  (see Change 3).
- Raise `LIMIT` to 500, or make it range-bound. **Default when no params:** last 30 days
  (confirm the window with the user; 30 d keeps the table small without a filter).

### Client (`admin-orders.js` + `admin-main.js` + `admin.html`)
- Two `<input type="date">` (από / έως) above the table plus an apply action.
- `fetchOrderSubmissions()` appends `?from=&to=` from those inputs.
- Persist the last-used range in `localStorage` (key `viomes.admin.orders.range.v1`) so a
  refresh/re-login keeps it.
- Empty range = server default; a clear-filter link resets to that.

---

## Change 2 — auto-refresh (poll ~12 s)

- In `admin-main.js`: start a `setInterval(fetchOrderSubmissions, 12_000)` **only while
  the orders panel is the active view and the tab is visible**; `clearInterval` on
  panel switch and on `document.visibilitychange` → hidden; resume + immediate fetch on
  visible.
- **No overlap:** skip a tick if a fetch is already in flight (a `let pollInFlight`
  guard, or reuse the existing in-flight promise).
- **Preserve UI state across refreshes:** expanded rows (already id-keyed in `state`,
  keep calling `pruneExpandedOrderSubmissions`), the date inputs, scroll position, and
  any open confirm dialog. Re-render diff-free where cheap; a full `innerHTML` rebuild is
  fine if expansion + scroll are restored right after.
- **Failed poll ≠ empty table:** on error keep the last good `state.currentOrderSubmissions`
  and show a small "δεν ανανεώθηκε" indicator; don't render the empty state.
- Show "Ενημερώθηκε πριν N δευτ." near the (now secondary) manual refresh button.
- A 401 during a poll already routes to `/login` via `apiFetch` — nothing extra.

---

## Change 3 — "Clear" = soft-archive (reversible)

### Schema (`lib/db/init-schema.js`)
- `ensureColumn('orders', 'archived_at', <nullable datetime/text>)` — same pattern as
  the other `ensureColumn` calls. Optional index `(status, archived_at, submitted_at)`.

### Server (`lib/routes/admin.js` + `lib/order-submissions.js`)
- `listOrderSubmissions` main query gets `AND archived_at IS NULL`. Add an optional
  `?archived=1` that flips it to `archived_at IS NOT NULL` (for the un-archive view).
- `POST /api/admin/order-submissions/archive`, `requireOwnerAdmin`, body `{ ids: number[] }`:
  - `UPDATE orders SET archived_at = <now> WHERE id IN (…) AND archived_at IS NULL
     AND status IN ('ready','write_failed','held')`.
  - Any requested id whose status is **`writing` or `written`** is **refused** — collect
    and return them.
  - Response: `{ archived: n, skipped: [{ id, status, reason }] }`.
- `POST /api/admin/order-submissions/unarchive`, `requireOwnerAdmin`, body `{ ids }` —
  sets `archived_at = NULL`. (Reversibility; owner-admin only.)
- No hard `DELETE` endpoint.

### Client (`admin-orders.js`)
- **Per-row:** an "Αρχειοθέτηση" button on rows with status `ready` / `write_failed` /
  `held`; not rendered for `writing` / `written`.
- **Bulk:** a checkbox per eligible row + an "Αρχειοθέτηση επιλεγμένων (N)" button.
  Selection may include `ready` (e.g. clearing test orders) but the checkbox is absent
  for `writing` / `written`. Typed confirmation ("γράψτε ΕΚΚΑΘΑΡΙΣΗ") for a bulk action
  over ~5 rows.
- After the call: toast with `archived` / `skipped` counts, then `fetchOrderSubmissions()`.
- A "Προβολή αρχειοθετημένων" toggle that refetches with `?archived=1` and shows an
  "Επαναφορά" button per row.
- `written` rows: no archive control; show `es1_document_code` and a hint that
  cancellation happens in ES1 (transition 157), not here.

### Writer coordination — **change in `viomes_db/order-writer/`, not this repo**
`src/poll.js` must ignore archived rows:
- claim `UPDATE … WHERE id=? AND status='ready'` → `… AND archived_at IS NULL`
- ready `SELECT … WHERE status='ready' AND es1_write_attempts < ?` → add `AND archived_at IS NULL`
- poison-park `UPDATE … WHERE status='ready' AND es1_write_attempts >= ?` → add `AND archived_at IS NULL`
- gate all three behind the existing `hasColumn(ordersPool,'orders','archived_at')` probe
  so the writer still runs against a DB where the column hasn't been added yet.
`src/reconcile.js` scans `status='writing'` only (which can't be archived), so it's safe;
add the guard anyway for symmetry.

---

## Testing

- **Date filter:** submit orders across three days; filter to one → only that day's rows;
  bad date → 400; range persists across a reload.
- **Auto-refresh:** submit an order → appears within ~12 s with no click; run
  `poll.js --once` → a row's status goes `ready → written` live; an expanded row stays
  expanded and scroll holds across a refresh; kill the network → table keeps last data +
  shows the stale badge; switch tabs → polling stops, returns on focus.
- **Archive:** archive a `write_failed` row → leaves the view, `archived_at` set;
  bulk-select incl. a `written` row → that one comes back in `skipped` with reason;
  `?archived=1` lists it; unarchive restores it to the main view.
- **Writer:** archive a `ready` row, run `poll.js --once` → writer does **not** claim it;
  un-archive → next poll picks it up.
- Add an integration test alongside `site/tests/public-routes-gating.integration.test.js`
  (fake owner-admin context) for the new routes.

---

## Out of scope / notes

- Value/pricing display is untouched — already the stored pricing-service figure with
  source badges; no re-pricing on view.
- No hard delete anywhere. `written` orders are cancelled in ES1, never removed here.
- Legacy `pending` / `rejected` rows stay excluded.
- The auth-gate handoff (`auth-gate-login-redirect-handoff.md`) is independent; this
  panel already goes through `apiFetch`, so it inherits the 401→`/login` behavior.
