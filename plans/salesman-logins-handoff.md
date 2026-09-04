# order_form — per-salesman logins that correlate to ES1 accounts

**Created:** 2026-08-31
**Decisions (user, 2026-08-31):**
- Accounts are the **same kind as the existing `sales` account** — a non-owner
  `admin_users` row — one per salesman instead of one shared login.
- ~~The salesman's name must also reach the **ES1 ΠΑΡ**, as a **note on the document**
  (not as `ESUCreated`). `ESUCreated` stays `ORDER_WRITER`.~~

**Decisions (user, 2026-09-01) — supersede the ΠΑΡ-note plan above:**
- **The order_form `username` IS the person's ES1 `ESGOUser.UserID`** — no display-name
  column, no `es1_user_id` column. Create each login with `--username=<their ES1 UserID>`
  (lowercase, exactly as in `ESGOUser`, e.g. `giannis`, `nikos`, `vasilis_a`).
- **`ESUCreated` on the writer ΠΑΡ now carries the real submitter** — the writer stamps
  `UPPER(orders.submitted_by)` into `dt.ESUCreated` + `ie.ESUCreated` (ES1's own
  convention: `haido`→`HAIDO` on hand-keyed docs). Falls back to `ES1_WRITER_ESUSER`
  (`ORDER_WRITER`) for customer self-service orders, legacy rows, and the generic shared
  logins (`sales`/`admin`/`administrator`, configurable via `ES1_GENERIC_SUBMITTERS`).
- **Keep the shared `sales` login active** — a ΠΑΡ it produces reads `ORDER_WRITER`, not
  `SALES` (it's in the generic-submitter fallback list).
- **`dt.ADComments` stays empty on a clean order** (Change 4 stays reversed — no ΠΑΡ note).

**Writer side is DONE (2026-09-01, `viomes_db/order-writer`):** `resolve.js`
`resolveEsuCreated()` + wired into `resolveOrderContext`; `order-to-payload.js` sets
`payload.es1Username` from `submitted_by` (null when `submitted_by_role='customer'`);
`insert.js` buildOrder whitelist forwards it; `poll.js` SELECT reads `submitted_by` +
`submitted_by_role` behind `hasColumn` guards (an old order_form schema → NULL →
`ORDER_WRITER`, unchanged). `.env.example` documents `ES1_GENERIC_SUBMITTERS`. 5 new unit
tests (`test/esu-created.test.js`) + order-to-payload + an insert.integration dryrun
assertion. **No order_form code change is needed** — `submitted_by` already stores
`actor.username`.

---

## Current state

- **Accounts:** `admin_users(id, username, password_hash, is_active, created_at, is_owner)`
  and `customer_users` (empty, unused). The shared sales login is
  `admin_users.username = 'sales'`, `is_owner = 0`, `is_active = 1`. Created with
  `npm run admin:create-user -- --username= --password= [--active=]`
  (`scripts/create-admin-user.js`) — no display-name field.
- **Submission identity:** `resolveOrderSubmissionIdentity()` sets
  `submittedBy = actor.username`; `createOrderSubmission()` stores it as
  `orders.submitted_by` (+ `submitted_by_role = 'staff'`). Distribution today:
  `admin` × 27, `sales` × 3, `NULL` × 5 (legacy).
- **Admin table:** `buildSubmittedByHtml()` in `public/admin-orders.js` already renders
  `order.submitted_by` under the timestamp. Per-account names show up here with **no
  display code change** — the shared login is the only reason it looks generic.
- **Permissions:** the orders panel route is `requireOwnerAdmin`. A non-owner salesman
  account can log into the order form and submit, but **cannot see** the admin
  order-submissions table. That's the intended split (salesmen submit, owner-admins
  review) — no gating change needed.
- **ES1 / writer (updated 2026-09-01):** `viomes_db/order-writer` **now reads
  `submitted_by` + `submitted_by_role`** and stamps `UPPER(submitted_by)` into
  `dt.ESUCreated` + `ie.ESUCreated` (still `E_INFO` tier — the shadow-diff reconstructs
  historical hand-keyed docs, which it feeds no submitter). Fallback to
  `ES1_WRITER_ESUSER` = `ORDER_WRITER` for `submitted_by_role='customer'`, NULL
  `submitted_by`, or a name in `ES1_GENERIC_SUBMITTERS` (`sales,admin,administrator`). The
  ΠΑΡ `ADComments` Σχόλιο is unchanged — only the `needsManualPriceReview` flag, never a
  submitter line.

---

## Change 1 — create one account per colleague  *(the only remaining work)*

- Run `npm run admin:create-user` once per colleague, `--active=1`, no `is_owner`.
- **Username MUST equal the person's ES1 `ESGOUser.UserID`**, lowercase, exactly as
  stored in ES1 (`--username=giannis`, `--username=vasilis_a`, …). This is what lands in
  `orders.submitted_by` and, uppercased, in `dt/ie.ESUCreated` on the ES1 ΠΑΡ. A typo
  here = a document authored by a non-existent ES1 user (harmless audit string, but wrong).
- To list the real ES1 UserIDs:
  `SELECT UserID, Name FROM ESGOUser WHERE ISNULL(Inactive,0)=0 ORDER BY UserID`.
- Anyone without an ES1 login needs one created **in ES1 first** (ES1 admin task) — the
  writer can't invent it.
- Keep the shared `sales` account active (user's call) — orders under it stamp
  `ORDER_WRITER`, not `SALES`.
- No schema or code change. Writer side already done.

## Change 2 — a human display name  *(DROPPED 2026-09-01)*

Not doing this. `submitted_by` = the ES1 UserID is the identity everywhere. If the admin
table needs friendlier names later, join `ESGOUser.Name` at display time rather than
denormalising a `display_name` column.

## Change 3 — admin table shows the submitter  *(already works)*

`buildSubmittedByHtml()` in `public/admin-orders.js` already renders `order.submitted_by`.
With per-person logins that becomes the ES1 UserID (`giannis`) instead of `sales`/`admin`
— no display code change.

## Change 4 — note on the ΠΑΡ  *(REVERSED 2026-09-01 — do NOT implement)*

**Superseded.** The `Καταχωρήθηκε από: <name> (πλατφόρμα παραγγελιών)` line was built and
then removed at the office's request — they want `dt.ADComments` **empty on a clean
order**. The submitter reaches ES1 via `ESUCreated` instead (see the 2026-09-01 decisions
at the top), not via a comment.

---

## Testing

- `npm run admin:create-user -- --username=giannis --password=<8+ chars> --active=1`
  (username = a real active `ESGOUser.UserID`). Log into the order form as `giannis`,
  submit an order → `orders.submitted_by = 'giannis'`, `submitted_by_role = 'staff'`,
  `status = 'ready'`.
- Admin table (owner login) shows `giannis` on that row.
- Non-owner account: confirm `GET /api/admin/order-submissions` returns 401/403 for it
  (panel stays owner-only).
- Writer dryrun (`viomes_db/order-writer`, `node src/poll.js --once`, `WRITER_MODE=dryrun`)
  on that order → `dryrun.ok`; in the rendered `dt` + `ie` inserts `ESUCreated = 'GIANNIS'`
  and `ADComments` is empty.
- An order left under the shared `sales` login → `ESUCreated = 'ORDER_WRITER'`.
- `cd viomes_db/order-writer && npm test` (esu-created + order-to-payload) and
  `npm run test:integration` (the insert dryrun ESUCreated assertion).

---

## Out of scope / notes

- `ESUCreated` now varies per order (the submitter's ES1 UserID) but `ES1_WRITER_ESUSER`
  stays the fallback constant. Creating the ES1 user logins themselves is out of scope —
  an ES1 admin task.
- `fSalesPersonGID` on the ΠΑΡ (the commercial salesperson, set from the branch cascade)
  is a different thing and is untouched — it is "whose customer this is", not "who keyed
  the order".
- `customer_users` (customer self-service logins) is unrelated and stays empty/unused.
  A customer-submitted order stamps `ORDER_WRITER` (submitted_by_role='customer').
- The orders panel remains `requireOwnerAdmin`; salesmen never see it.
- Independent of `auth-gate-login-redirect-handoff.md`.
