# Stock ("Απόθεμα") column on the order-entry catalog — handoff

**Status:** code built 2026-09-02. Blocked on one manual op step (the SQL login) before it
shows real numbers; until then the column degrades to "—" everywhere, harmlessly.
**Goal:** add a per-code stock column to the catalog table on the order-entry page so a
salesman sees what's actually available before adding a line.

---

## Build log (2026-09-02)

**pricing-service side** (`viomes_db/pricing-service/`, not under git — filesystem edits):
- `src/db.js` — added `getStockPool()`: its own independent `mssql.ConnectionPool` on the
  `STOCK_DB_USER` / `STOCK_DB_PASSWORD` login, same server + Radmin fallback as pricing.
  Rejects with `code:"STOCK_NOT_CONFIGURED"` when those env vars are unset.
- `src/stock.js` (new) — `getStockLevels(pool, sql, itemCodes)`. One CTE query:
  WH-101 balances, `available = onHand101 − reserved101`, company-wide on-hand for the
  tooltip, mixed-content sibling resolved via `OUTER APPLY` over the same `itemStock` CTE
  (guarded `s.IsMixed = 1`). `STOCK_CODE_CAP = 250`. Unknown codes omitted from the result.
- `src/server.js` — `POST /stock-levels` (`requireApiKey`, validates non-empty array under
  the cap, 400/502/503). ~45 s in-memory TTL cache keyed by code, misses cached as `null`.
  `/health` now also reports `stock: live | not_configured | unreachable` (soft dep — a bad
  stock login does NOT make the service unhealthy).
- `.env.example` — `STOCK_DB_USER` / `STOCK_DB_PASSWORD` block (was already added earlier).
- Not runtime-tested here (no live DB / no login yet). `node --check` clean.

**order_form side** (this repo — committed):
- `site/lib/pricing-client.js` — `stockLevels(itemCodes)`, same guard shape as `priceLines`
  (`PRICING_NOT_CONFIGURED` when the URL is empty, `status`-tagged errors, returns
  `payload.levels`). Dedupes/trims codes; `[]` short-circuit when nothing usable.
- `site/lib/routes/public.js` — `GET /api/stock?codes=a,b,c` (`requireStaffOrCustomer`).
  Module-scoped 45 s per-code cache, 200-code cap. Any failure → `200 { levels, unavailable:true }`
  (never logs, never 5xx). `stock_source` added to `/api/health`.
- `site/public/order-form.js` — `ΑΠΟΘΕΜΑ` column between ΤΕΜ./ΣΥΣΚ. and ΣΥΣΚΕΥΑΣΙΕΣ,
  `colspan` 6 → 7. `hydrateStockColumn()` (150 ms debounce, per-page fetch, 90 s session
  cache, stale-fetch guard via a sequence number) called after every `renderCatalog`.
  Colour vs the row's qty input: red ≤ 0 / amber `avail < qty` / green `avail ≥ qty` /
  grey when qty blank; recolours live as the qty input changes (delegated on `#catalog`).
  Mixed-content → `≈` prefix + sibling code in the tooltip. Failure / unknown code →
  muted `—`, `title="Απόθεμα μη διαθέσιμο"`. `↻ απόθεμα` button in the toolbar clears the
  session cache + re-hydrates; `απόθεμα HH:MM` label shows the newest `asOf`.
- `site/public/index.html` / `styles.css` — `#stockRefreshBtn`, `#stockAsOf`, `.th-stock` /
  `.td-stock` widths (88 px desktop, 2.6 rem mobile), `.stock-cell` state colours reusing
  the order-history badge palette.
- Tests: 5 `pricing-client` `stockLevels` cases + 3 `/api/stock` route cases (gated,
  degrades with no client, dedupe/cap/per-code cache). Full suite 137 green.

## Remaining before it shows real numbers

1. **Run `viomes_db/pricing-service/sql/create-stock-login.sql`** as sysadmin (replace the
   password placeholder first), verify both directions per the script's checklist.
2. Put the credential in `viomes_db/pricing-service/.env` as `STOCK_DB_USER` /
   `STOCK_DB_PASSWORD`, restart the pricing-service.
3. Smoke `POST /stock-levels` for a couple of codes incl. a mixed-content one (`66-50`)
   and reconcile against `viomes_db/queries/stock-availability.sql` (+ WH-101 filter).
4. `scripts/verify.js` extension (plan §5.5) — still TODO; optional.
5. Deploy the order_form push. Where `PRICING_SERVICE_URL` is unset the column just shows
   "—" (same standing caveat as live pricing).

---

## 1. Decisions locked in (2026-09-02)

| Decision | Value |
|---|---|
| **Surface** | The catalog table only (`site/public/order-form.js` → `renderCatalog`). Not the admin queue, not a separate page. |
| **Number shown** | **Available = on-hand − `ReservedStock`, warehouse `101` (Ετοίμων), company `001`.** This is the figure ES1 shows the credit-check (`100`) operator and the one the ES1 order-writer already stamps on every line (`Διαθέσιμο Στοκ ΑΧ`). Keep the whole pipeline showing the same number. |
| **Not** subtracted | `PendingSalesOrders` (un-approved ΠΑΡ), including orders from this form. Matches the Skroutz-feed rule — an un-approved order must not visually eat the stock. |
| **Tooltip / secondary** | plain on-hand @ 101, and company-wide on-hand, on hover. |
| **Mixed-content SKUs** | Endpoint resolves to the stock-carrying family sibling and flags `isMixedContent`. 8 catalog codes affected (see §4). |
| **Failure mode** | Column shows a muted `—` with a tooltip. **Never blocks submit, never gates anything.** Informational only. |
| **Data source** | New `POST /stock-levels` endpoint on the existing `viomes_db/pricing-service`, same Cloudflare tunnel, same `X-Pricing-Api-Key`, same hot-reloaded URL (`backend/pricing-url.txt`). No new env vars on the order_form side. |
| **DB login** | New dedicated `viomes_stock_readonly` (SELECT on `ESFIItemCurrentBalances`, `ESFIItem`, `ESGOSites` only) with its own pool in the pricing-service. Not a widen of `viomes_pricing_readonly`. |

---

## 2. Surface details (verified in the repo)

- `site/public/order-form.js`:
  - `PAGE_SIZE = 20` (L5). Catalog is `catalog.json` (1,778 order-channel codes), loaded
    once, filtered client-side, paginated.
  - `applyCatalogView(page, query)` (~L960) slices the filtered list to the visible 20 and
    calls `renderCatalog(catalog)` (~L969).
  - `renderCatalog(items)` (L1282) builds the row HTML. Existing cells per row (~L1250–1268):
    `td-code`, `td-desc`, `td-pack`, `td-bundle`, `td-packs`, `td-qty`.
  - The `<table class="catalog-table">` template + header row + empty-state `colspan="6"`
    are in the `els.catalog.innerHTML = ...` block (~L1285). **All three need the new
    column** (header cell, body cell, bump `colspan` 6 → 7).
- Only ≤20 codes are ever on screen at once → bounded batch fetch.

---

## 3. Architecture

```
order-form.js (browser)
  └─ GET /api/stock?codes=101-14,102-50,...        (≤20 codes, current page)
       └─ routes/public.js  (adds X-Pricing-Api-Key server-side, short TTL cache)
            └─ pricingClient.stockLevels(codes)     (new method on the existing client)
                 └─ POST {tunnel}/stock-levels      (pricing-service)
                      └─ src/stock.js               (one SQL query, WH101, sibling resolve)
```

Reuse the **existing** pricing-service client (`site/lib/pricing-client.js`) — it already
holds the hot-reloaded base URL (`pricing-url-source.js`), the API key, the timeout, and is
already threaded through `app.js` → `createApp` deps → `routes/public.js`. Add a
`stockLevels(itemCodes)` method rather than a second factory/second wiring.

---

## 4. Mixed-content SKUs (must handle)

These 8 catalog codes have `ESFIItem.fItemControlProfileGID = 'dcc17f66-3f6a-4fb7-b7eb-804809bb1ecb'`
(mixed-content) — they never carry their own balance; real stock is a sibling in the same
`fItemFamilyCode`. All 8 have real siblings, so resolution always succeeds.

| Code | Description | Family |
|---|---|---|
| `151-04` | ΚΑΛΑΘΙ ΠΟΛΛΩΝ ΧΡΗΣΕΩΝ 38x27x15h — ΜΠΕΖ ΙΒΟΥΑΡ | 151 |
| `300-58` | ΚΟΥΒΑΣ ΣΦΟΥΓΓΑΡΙΣΜΑΤΟΣ 16lt — ΤΙΤΑΝΙΟ | 300 |
| `300-62` | ΚΟΥΒΑΣ ΣΦΟΥΓΓΑΡΙΣΜΑΤΟΣ 16lt — ΜΠΛΕ ΑΙΓΑΙΟΥ | 300 |
| `305-05` | ΚΟΥΒΑΣ ΜΕ ΕΡΓΟΝ/ΚΗ ΛΑΒΗ 16lt — ΚΟΚΚΙΝΟ | 305 |
| `627-76` | ΚΟΥΤΙ ΑΠΟΘΗΚΕΥΣΗΣ & ΚΑΠΑΚΙ 21lt — ΡΟΖ ΣΚΟΥΡΟ | 627 |
| `66-14` | ΛΕΚΑΝΗ ΣΤΡΟΓΓΥΛΗ 20lt — ΜΠΟΡΝΤΩ | 66 |
| `66-50` | ΛΕΚΑΝΗ ΣΤΡΟΓΓΥΛΗ 20lt — ΓΚΡΙ ΜΠΕΖ | 66 |
| `66-66` | ΛΕΚΑΝΗ ΣΤΡΟΓΓΥΛΗ 20lt — ΓΚΡΙ | 66 |

Resolution logic = the one already proven in `viomes_db/queries/skroutz-feed-availability.sql`:
`OUTER APPLY (SELECT TOP 1 ... FROM real-stock siblings in same fItemFamilyCode ORDER BY available DESC)`.

---

## 5. Prerequisite tasks — `viomes_db/pricing-service` (NOT this repo)

> Do these first; the order_form side is inert without the endpoint.

1. **SQL login — DECIDED 2026-09-02: a separate login, not a grant-widen.** Per the project
   rule (memory `pricing-readonly-login-created` — *don't widen `viomes_pricing_readonly`
   opportunistically*), create **`viomes_stock_readonly`** with `GRANT SELECT` on exactly:
   `ESFIItemCurrentBalances`, `ESFIItem`, `ESGOSites`.
   Draft written: `viomes_db/pricing-service/sql/create-stock-login.sql`, styled like
   `order-writer/sql/create-writer-login.sql` — user runs it manually as sysadmin (SSMS /
   sqlcmd, **not** through `Invoke-ViomesQuery.ps1 -AllowWrite`), then verifies both
   directions (grants work AND SELECT is denied on e.g. `ESFITradeAccountEntry`).
2. **`src/db.js`** — add `getStockPool()` using `STOCK_DB_USER` / `STOCK_DB_PASSWORD`
   (same server + Radmin fallback as the pricing pool). The stock endpoint uses this pool,
   never the pricing one.
3. **`src/stock.js`** — `getStockLevels(pool, sql, itemCodes)`:
   - Base query from `viomes_db/queries/stock-availability.sql`, but:
     - scope to warehouse `101` (`JOIN ESGOSites wh ON wh.GID = b.fWareHouseGID WHERE wh.Code='101'`),
     - `available = SUM(DebitQty − CreditQty) − SUM(ReservedStock)`,
     - also return `onHand101` and a company-wide `onHand` (no WH filter) for the tooltip,
     - `WHERE it.Code IN (@codes)` (table-valued param or parameterised list; cap ~250),
     - mixed-content sibling `OUTER APPLY` per §4.
   - Returns `[{ itemCode, available, onHand101, onHandCompany, isMixedContent,
     fulfillmentCode, asOf }]`. Unknown code → omitted (client renders `—`).
4. **`src/server.js`** — `POST /stock-levels`, `requireApiKey`, validate `itemCodes` is a
   non-empty array under the cap, 400 otherwise; 502 on SQL error (mirror `/price-lines`).
   In-memory TTL cache (~45 s) keyed by code.
5. **`scripts/verify.js`** — extend to hit `/stock-levels` for a couple of known codes and
   sanity-check against `stock-availability.sql`.
6. **`.env.example` / `.env`** — `STOCK_DB_USER` / `STOCK_DB_PASSWORD` (if separate login).

---

## 6. Tasks — `order_form` repo

1. **`site/lib/pricing-client.js`** — add method:
   ```
   async stockLevels(itemCodes) → POST `${baseUrl}/stock-levels` { itemCodes }
   ```
   Same guards as `priceLines`: `PRICING_NOT_CONFIGURED` when the resolved URL is empty,
   `status`-tagged errors on non-2xx / timeout / bad shape. Returns `payload.levels` (array).
2. **`site/lib/routes/public.js`**
   - New `GET /api/stock?codes=a,b,c` (public, same auth context as the catalog page).
     Splits/dedupes/caps `codes`, calls `deps.pricingClient?.stockLevels(...)`, returns
     `{ levels: [...], asOf }`. On `PRICING_NOT_CONFIGURED` or any client error →
     `200 { levels: [], unavailable: true }` (the column degrades to `—`, page still works).
   - Short server-side `Map` cache (code → { level, expiresAt }, ~45 s TTL) so pagination
     back-and-forth doesn't re-hit the tunnel.
   - Extend the health payload (currently `pricing_source` at ~L39) with
     `stock_source: (await pricingClient?.isConfigured()) ? "live" : "unavailable"`.
3. **`site/public/order-form.js`**
   - `renderCatalog` template (~L1285): add `<th>Απόθεμα</th>` header, a `td-stock` body
     cell per row, bump the empty-state `colspan` 6 → 7.
   - After `renderCatalog(catalog)` in `applyCatalogView`: call a new
     `hydrateStockColumn(catalog)` — debounced ~150 ms, fetches `/api/stock` for the
     visible codes not already in a session `Map` (90 s TTL), then fills each `td-stock`.
   - Render: number; colour vs that row's qty input — red `≤ 0`, amber `0 < avail < qty`,
     green `avail ≥ qty`, neutral grey when qty is blank. `title` = on-hand @101 +
     company-wide. Mixed-content → small marker (e.g. `≈` + "από συγγενικό κωδικό
     {fulfillmentCode}" in the tooltip).
   - A small "↻ απόθεμα" control near the catalog toolbar that clears the session `Map`
     and re-hydrates the current page; show the newest `asOf` as "απόθεμα HH:MM".
   - Failure / `unavailable: true` / missing code → `td-stock` = muted `—`,
     `title="Απόθεμα μη διαθέσιμο"`. No console noise, no disabled buttons.
4. **`site/public/index.html` / `styles.css`** — `.td-stock` width + the 3 state colours
   (reuse the existing `εκτ.` badge palette for consistency).
5. **(optional) `orders` line snapshot** — `orders_lines.stock_at_submit` via the
   `ensureColumn` pattern (`site/lib/db/init-schema.js`), captured in
   `site/lib/order-submissions.js` at submit time from the last hydrated value. Only useful
   for a later "did we promise against real stock?" report; the ES1 writer already snapshots
   at write time, so this just covers the submit→write gap. Skip for v1 unless wanted.

---

## 7. Testing

- **pricing-service:** unit test the query builder + mixed-content sibling pick; live smoke
  reconciling ~5 codes (incl. 2 from §4) against `stock-availability.sql`.
- **order_form:**
  - `pricing-client` `stockLevels`: fetch-stubbed — success mapping, non-2xx, timeout,
    `PRICING_NOT_CONFIGURED` → throws tagged.
  - `/api/stock` route: cache hit/miss, `unavailable` fallback when client is null/throws,
    code cap + dedupe.
  - DOM test for `renderCatalog`: 7 columns, `td-stock` present, `—` on failure, colour
    class picked correctly against a qty.
- Manual: real order form against the live tunnel — confirm a known low-stock code shows
  red, a mixed-content code (`66-50`) shows a resolved number + marker, and killing the
  tunnel degrades every row to `—` with the form still fully usable.

---

## 8. Config / deploy

- **No new order_form env vars.** Uses the existing `PRICING_SERVICE_URL` /
  `PRICING_SERVICE_API_KEY` / `backend/pricing-url.txt`. Where those are unset (dev, and
  prod until the tunnel is wired — see `order-form-live-pricing-integration` memory), the
  column just shows `—`.
- pricing-service: deploy alongside the existing service (same host, same tunnel). Add
  `STOCK_DB_*` to its `.env` if the separate-login route is chosen.
- The quick-tunnel URL is still ephemeral (laptop-hosted) — same standing caveat as pricing.

---

## 9. Out of scope

- Admin queue stock column (revisit later if the `100`-desk wants it).
- Any gating / warning / block based on stock — explicitly not wanted.
- Reservations, ATP projections, inbound POs — tooltip could add them later; not v1.
