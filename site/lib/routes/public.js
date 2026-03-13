export function registerPublicRoutes(app, context) {
  const {
    db,
    path,
    settings,
    normGr,
    APP_NAME,
    dbClient,
    customerStatsProvider,
    IMPORTED_SALES_ARCHITECTURE,
    LATEST_IMPORT_RUN_SQL,
    logRouteError,
  } = context;

  app.get("/", (req, res) => res.sendFile(path.join(settings.publicDir, "index.html")));

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
      db_architecture: {
        raw_fact_table: IMPORTED_SALES_ARCHITECTURE.rawFactTable,
        projection_tables: IMPORTED_SALES_ARCHITECTURE.projectionTables,
        legacy_dormant_tables: IMPORTED_SALES_ARCHITECTURE.legacyDormantTables,
        projection_strategy: IMPORTED_SALES_ARCHITECTURE.projectionStrategy,
      },
      latest_import_run: latestImportRun,
    });
  });

  app.get("/api/catalog", async (req, res) => {
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
}
