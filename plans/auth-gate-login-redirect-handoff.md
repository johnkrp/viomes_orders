# order_form — auth gate: redirect logged-out visitors to a login page

**Created:** 2026-08-31
**Scope:** the customer/staff **order form** (`/`). Not `admin.html` (see "Out of scope").
**Requested behavior (user, 2026-08-31):** "When anyone loads the order form and hasn't
logged in in a while, it should send him to the login page, without opening any other page
beforehand." Chosen approach: **both** a server-side redirect for fresh loads **and**
client-side handling for a session that expires while the tab is open.

---

## Current behavior (as built today)

- **`GET /` serves the SPA unconditionally.** `lib/routes/public.js` → `app.get("/", … sendFile("index.html"))`,
  and `app.use(express.static(settings.publicDir))` (app.js:481) would serve it anyway. No
  server-side session check on any page route.
- **Auth is 100% client-side.** `public/order-form.js` bottom → `bootstrapApp()`:
  1. `await checkAuthState()` — `Promise.all([fetch("/api/admin/me"), fetch("/api/customer/me")])`
  2. `applyRoleUi(actor)` — toggles `#loginPanel.hidden` / `#appMain.hidden` (both start
     `hidden` in `index.html`), then `startApp()` only if `actor.role`.
- **Sessions:** DB-backed tokens. `customer_sessions` / `admin_sessions` tables, cookie
  names `settings.customerSessionCookieName` / `settings.adminSessionCookieName`, TTL
  `SESSION_MAX_AGE_SECONDS` (default **28800 = 8h**, app.js:309). `/api/customer/me` and
  `/api/admin/me` return `{ authenticated: false }` once `expires_at` has passed.
- **Symptoms the user sees with a stale session:**
  - a blank shell (header only) for as long as the two `/me` round-trips take, sometimes a
    brief flash of the app frame, before the login panel appears;
  - a session that expires while the form is open **never re-gates** — the form stays fully
    visible and the next API call just returns `401` (e.g. submit shows an inline error).

The server-side gate below removes both: a logged-out browser never receives the SPA
HTML/JS at all, so there is nothing to flash.

---

## Change 1 — server-side gate on `/` + a real login page

### 1a. `public/login.html` (new)

Minimal standalone page. Reuse the existing `#loginForm` markup currently inside
`index.html`'s `#loginPanel` (username/password, `#loginBtn`, `#loginStatus`). Its own
small inline `<script>` (or `public/login.js`, which is already `no-store` per the
`.js` rule in app.js:451):

- On submit: `POST /api/admin/login` then, on 401, `POST /api/customer/login` (same order
  as `checkAuthState`). Both already return `{ ok: true }` + set the session cookie.
- On success: read `next` from `location.search` (`?next=`), default `/`, **validate it is
  a same-origin path** (starts with a single `/`, not `//` or a scheme), then
  `location.href = next`.
- No catalog, no `order-form.js`, no app CSS beyond what the login card needs.

### 1b. Page routes (register in `createApp`, in `app.js`)

`getAuthenticatedAdmin` (app.js:483) and `getAuthenticatedCustomer` (app.js:548) are
defined inside `createApp`. Register these **before** `app.use(express.static(...))`
(app.js:481) so the explicit handlers win over static's automatic `index.html`:

```js
async function currentActor(req) {
  return (await getAuthenticatedAdmin(req)) || (await getAuthenticatedCustomer(req));
}

app.get(["/", "/index.html"], async (req, res) => {
  if (!(await currentActor(req))) {
    return res.redirect(302, "/login?next=" + encodeURIComponent(req.originalUrl || "/"));
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(settings.publicDir, "index.html"));
});

app.get("/login", async (req, res) => {
  if (await currentActor(req)) return res.redirect(302, "/");
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(settings.publicDir, "login.html"));
});
```

- Also pass `{ index: false }` to `express.static(settings.publicDir, …)` so a bare `/`
  is never auto-answered with `index.html` behind the new handler's back.
- The `no-store` on `/` matters: without it a logged-out user could be served a cached
  `200` of the app shell. `order-form.js` is already `no-store`.

### 1c. `index.html`

- `#loginPanel` becomes dead code once the server gate exists. Safe to **leave as a
  fallback** for now; remove in a follow-up.
- Keep `order-form.js`'s `applyRoleUi()` — it still does the staff-vs-customer chrome
  (customer picker, identity line, admin link). It will now only ever run for an
  authenticated actor.

---

## Change 2 — client: a 401 from any API call navigates to `/login`

For the "session expired while the tab was open" case.

- In `order-form.js`, add one helper and call it from every request path:

  ```js
  function bounceIfUnauthorized(response) {
    if (response.status === 401) {
      window.location.assign("/login?next=" + encodeURIComponent(location.pathname));
      return true;
    }
    return false;
  }
  ```

- Wire it into:
  - `fetchJson()` (~line 88) — right after the `fetch`, before parsing.
  - the bare `fetch()` calls: catalog (`loadCatalog`, ~946), order submit (~1726), the
    branch loader (`loadBranchesInto` / `/api/order-form/customers/:code/branches`), and
    `/api/order/export-xlsx` if it can 401.
  - Cleanest: route all of them through a single `apiFetch()` wrapper that calls
    `bounceIfUnauthorized` and rethrows/aborts otherwise.
- `checkAuthState()` stays — a race (session dies between the `/` gate and the first
  `/me`) then also lands on the 401 path via `applyRoleUi` seeing `role: null`; optionally
  have that branch call `window.location.assign("/login…")` too instead of just showing
  the (now-vestigial) panel.

### Optional (confirm with user)

Proactive logout rather than "next action bounces": a check on `visibilitychange` when
the tab refocuses, or a `setInterval` (~5 min) hitting `/api/customer/me` /
`/api/admin/me` and redirecting on `authenticated: false`. Default assumption if
unconfirmed: **do not add** the timer; the 401 bounce is enough.

---

## Testing

- Logged out: `curl -sI localhost:<port>/` → `302`, `Location: /login?next=%2F`.
- With a valid session cookie: `GET /` → `200` `index.html`, `Cache-Control: no-store`.
- `GET /login` with a valid cookie → `302 /`.
- Expire a live session (`UPDATE customer_sessions SET expires_at = '2000-01-01' WHERE …`
  or delete the row) with the form open → next catalog page / branch load / submit →
  browser navigates to `/login`.
- Log in on `/login?next=/` → lands on the order form; catalog, branch picker, submit all
  work; `orders` row still gets `customer_substore_code` (unrelated, but smoke it).
- Extend `site/tests/public-routes-gating.integration.test.js` with the `/` and `/login`
  redirect cases (it already builds a fake authed/unauthed request context).

---

## Out of scope / notes

- **`admin.html`** has its own bootstrap and is not covered here. Same gate is trivial to
  add later (redirect to `/login` when `getAuthenticatedAdmin(req)` is null, `next`
  back to `/admin.html`) — track separately if wanted.
- No change to the session model, cookie names, TTL, or the `/api/*/login|logout|me`
  endpoints.
- **ΠΑΡ writer (`viomes_db/order-writer/`) is unaffected** — it polls MySQL `orders`
  directly and never hits these HTTP routes.
