import { loadImportedCustomerBranches } from "../customer-stats/stats-imported-helpers.js";
import { availableBranchRow } from "../customer-stats/shared.js";

// GET /api/stock cache. The catalog only asks for the ~20 codes on the current page,
// but paginating back and forth re-asks for the same codes constantly - a short TTL
// keeps that from re-hitting the pricing tunnel. Misses are cached too (as null) so an
// unknown code isn't retried on every page flip. Module-scoped: shared across requests,
// which is the point.
const STOCK_ROUTE_CACHE_TTL_MS = 45_000;
const STOCK_ROUTE_CODE_CAP = 200;
const stockRouteCache = new Map(); // code -> { level: object|null, expiresAt: number }

export function registerPublicRoutes(app, context) {
  const {
    db,
    normGr,
    APP_NAME,
    dbClient,
    customerStatsProvider,
    pricingClient,
    IMPORTED_SALES_ARCHITECTURE,
    LATEST_IMPORT_RUN_SQL,
    logRouteError,
    requireStaffOrCustomer,
    validateOrderSubmission,
    createOrderSubmission,
    resolveOrderSubmissionIdentity,
    getImportedCustomerByCode,
  } = context;

  // "/" and "/index.html" are served by the auth-gated handler registered in
  // createApp (app.js) before express.static, so there is no plain "/" route here.

  app.get("/api/health", async (req, res) => {
    let latestImportRun = null;
    try {
      latestImportRun = await db.get(LATEST_IMPORT_RUN_SQL);
    } catch {
      latestImportRun = null;
    }

    res.json({
      ok: true,
      app: APP_NAME,
      db_client: dbClient?.kind || null,
      customer_stats_provider: customerStatsProvider?.name || null,
      customer_stats_provider_mode: customerStatsProvider?.mode || null,
      pricing_source: (await pricingClient?.isConfigured()) ? "live" : "heuristic",
      stock_source: (await pricingClient?.isConfigured()) ? "live" : "unavailable",
      db_architecture: {
        raw_fact_table: IMPORTED_SALES_ARCHITECTURE.rawFactTable,
        projection_tables: IMPORTED_SALES_ARCHITECTURE.projectionTables,
        legacy_dormant_tables: IMPORTED_SALES_ARCHITECTURE.legacyDormantTables,
        projection_strategy: IMPORTED_SALES_ARCHITECTURE.projectionStrategy,
      },
      latest_import_run: latestImportRun,
    });
  });

  app.get("/api/catalog", requireStaffOrCustomer, async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page || "1", 10), 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.page_size || "10", 10), 1), 200);
      const qRaw = String(req.query.q || "").trim();
      const qNorm = normGr(qRaw);
      const offset = (page - 1) * pageSize;

      let total = 0;
      let rows = [];

      if (qRaw) {
        const needleRaw = `%${qRaw.toLowerCase()}%`;
        const needleNorm = `%${qNorm}%`;
        total = (
          await db.get(
            `
              SELECT COUNT(*) AS n
              FROM products
              WHERE lower(code) LIKE ?
                 OR lower(description) LIKE ?
                 OR lower(color) LIKE ?
                 OR description_norm LIKE ?
                 OR color_norm LIKE ?
            `,
            [needleRaw, needleRaw, needleRaw, needleNorm, needleNorm],
          )
        ).n;

        rows = await db.all(
          `
            SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
            FROM products
            WHERE lower(code) LIKE ?
               OR lower(description) LIKE ?
               OR lower(color) LIKE ?
               OR description_norm LIKE ?
               OR color_norm LIKE ?
            ORDER BY code
            LIMIT ? OFFSET ?
          `,
          [needleRaw, needleRaw, needleRaw, needleNorm, needleNorm, pageSize, offset],
        );
      } else {
        total = (await db.get(`SELECT COUNT(*) AS n FROM products`)).n;
        rows = await db.all(
          `
            SELECT id, code, description, image_url, pieces_per_package, volume_liters, color
            FROM products
            ORDER BY code
            LIMIT ? OFFSET ?
          `,
          [pageSize, offset],
        );
      }

      res.json({
        items: rows,
        page,
        page_size: pageSize,
        total,
        pages: total ? Math.ceil(total / pageSize) : 1,
      });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/stock?codes=101-14,102-50,... - the catalog's "Απόθεμα" column.
  //
  // Informational only: it never gates a submit. Any failure (pricing service not
  // configured, tunnel down, SQL error) resolves 200 with `unavailable: true` and
  // whatever was already cached, so the column degrades to "—" and the form stays
  // fully usable. Codes not in the response are simply omitted (the client renders
  // "—" for those too).
  app.get("/api/stock", requireStaffOrCustomer, async (req, res) => {
    const codes = [
      ...new Set(
        String(req.query.codes || "")
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    ].slice(0, STOCK_ROUTE_CODE_CAP);

    if (codes.length === 0) {
      res.json({ levels: [], asOf: null });
      return;
    }

    const now = Date.now();
    const resolved = [];
    const missing = [];
    for (const code of codes) {
      const hit = stockRouteCache.get(code);
      if (hit && hit.expiresAt > now) {
        if (hit.level) resolved.push(hit.level);
      } else {
        missing.push(code);
      }
    }

    if (missing.length === 0) {
      res.json({ levels: resolved, asOf: new Date().toISOString() });
      return;
    }

    try {
      const levels = await pricingClient?.stockLevels(missing);
      if (!Array.isArray(levels)) {
        // No pricing client wired up at all (dev/test before the tunnel exists).
        throw new Error("stock levels unavailable");
      }
      const byCode = new Map(levels.map((l) => [l.itemCode, l]));
      for (const code of missing) {
        const level = byCode.get(code) || null;
        stockRouteCache.set(code, { level, expiresAt: now + STOCK_ROUTE_CACHE_TTL_MS });
        if (level) resolved.push(level);
      }
      res.json({ levels: resolved, asOf: new Date().toISOString() });
    } catch {
      // Quiet by design - a missing stock number is not an error worth logging on
      // every catalog page load. The client shows "—".
      res.json({ levels: resolved, unavailable: true });
    }
  });

  // Branch list for the order form's Υποκατάστημα dropdown.
  //
  // The form used to read this from /api/admin/customers/:code/stats, which computes the
  // ENTIRE customer-stats payload — ledger, monthly sales, per-order values — purely to
  // reach available_branches. For Σκλαβενίτης that took ~53 seconds with the dropdown
  // disabled throughout. The branch list itself is one cheap aggregate.
  //
  // It also has to live outside /api/admin, which is staff-only: a logged-in customer
  // could never load their own branches through the admin route.
  app.get(
    "/api/order-form/customers/:code/branches",
    requireStaffOrCustomer,
    async (req, res) => {
      try {
        // A customer session may only ever read its own branches, whatever the URL says.
        const requested = String(req.params.code || "").trim();
        const code =
          req.actor?.role === "customer" ? req.actor.customerCode : requested;

        if (!code) {
          res.status(400).json({ error: "Customer code is required." });
          return;
        }

        const rows = await loadImportedCustomerBranches(db, code);
        res.json({
          customer_code: code,
          available_branches: rows.map(availableBranchRow),
        });
      } catch (error) {
        logRouteError(error);
        res.status(500).json({ error: String(error) });
      }
    },
  );

  app.post("/api/orders/submit", requireStaffOrCustomer, async (req, res) => {
    try {
      const submission = validateOrderSubmission(req.body);
      const identity = await resolveOrderSubmissionIdentity(db, {
        actor: req.actor,
        submission,
        getImportedCustomerByCode,
      });
      const { orderId } = await createOrderSubmission(
        db,
        { ...submission, ...identity },
        { pricingClient },
      );
      res.json({ ok: true, order_id: orderId });
    } catch (error) {
      logRouteError(error);
      res
        .status(error.status || 500)
        .json({ error: error.message || String(error) });
    }
  });
}
