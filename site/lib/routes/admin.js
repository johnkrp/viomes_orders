export function registerAdminImportRoutes(app, context) {
  const {
    express,
    mkdir,
    writeFile,
    path,
    db,
    settings,
    requireAdmin,
    runAdminImport,
    getImportedSalesProjectionHealth,
    searchImportedCustomers,
    customerStatsProvider,
    trimCommandOutput,
    resolveImportUploadTarget,
    sanitizeUploadedFilename,
    validateImportUploadFilename,
    ADMIN_IMPORT_UPLOAD_MAX_BYTES,
    verifyPassword,
    newSessionToken,
    buildSessionCookieOptions,
    shouldUseSecureCookie,
    logRouteError,
  } = context;

  app.get("/api/admin/import-health", requireAdmin, async (req, res) => {
    try {
      const health = await getImportedSalesProjectionHealth(db);
      res.json(health);
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.put(
    "/api/admin/import-upload/:dataset",
    requireAdmin,
    express.raw({
      type: ["application/octet-stream", "text/csv", "text/plain", "application/vnd.ms-excel"],
      limit: ADMIN_IMPORT_UPLOAD_MAX_BYTES,
    }),
    async (req, res) => {
      try {
        const uploadTarget = resolveImportUploadTarget(req.params.dataset);
        if (!uploadTarget) {
          res.status(400).json({ error: "Unsupported import dataset. Use sales/factuals or ledger/receivables." });
          return;
        }

        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body || "");
        if (!bodyBuffer.length) {
          res.status(400).json({ error: "Upload body is empty." });
          return;
        }

        const requestedFilename =
          req.headers["x-upload-filename"] || req.query.filename || uploadTarget.defaultFilename;
        const filename = sanitizeUploadedFilename(requestedFilename, uploadTarget.defaultFilename);
        validateImportUploadFilename(uploadTarget, filename);

        await mkdir(settings.backendDir, { recursive: true });
        const filePath = path.join(settings.backendDir, filename);
        await writeFile(filePath, bodyBuffer);

        const result = await runAdminImport({
          uploadTarget,
          filePath,
          originalFilename: filename,
          adminUsername: req.admin?.username || "unknown",
        });

        const stdout = trimCommandOutput(result?.stdout);
        const stderr = trimCommandOutput(result?.stderr);
        const exitCode = Number(result?.code ?? 1);
        if (exitCode !== 0) {
          res.status(500).json({
            ok: false,
            dataset: uploadTarget.kind,
            file_name: filename,
            exit_code: exitCode,
            signal: result?.signal || null,
            stdout,
            stderr,
          });
          return;
        }

        res.json({
          ok: true,
          dataset: uploadTarget.kind,
          file_name: filename,
          bytes_received: bodyBuffer.length,
          exit_code: exitCode,
          stdout,
          stderr,
        });
      } catch (error) {
        logRouteError(error);
        res.status(error.status || 500).json({ error: error.message || String(error) });
      }
    },
  );

}

export function registerAdminAuthRoutes(app, context) {
  const {
    db,
    settings,
    verifyPassword,
    newSessionToken,
    buildSessionCookieOptions,
    shouldUseSecureCookie,
    logRouteError,
  } = context;

  app.post("/api/admin/login", async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");

      const admin = await db.get(
        `
          SELECT id, username, password_hash, is_active
          FROM admin_users
          WHERE username = ?
        `,
        [username],
      );

      if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
        res.status(401).json({ ok: false, username: null, authenticated: false });
        return;
      }

      const token = newSessionToken();
      const expiresAt = new Date(Date.now() + settings.sessionMaxAgeSeconds * 1000).toISOString();

      await db.run(
        `
          INSERT INTO admin_sessions(admin_user_id, token, expires_at)
          VALUES (?, ?, ?)
        `,
        [admin.id, token, expiresAt],
      );

      const cookieOptions = buildSessionCookieOptions({
        secure: shouldUseSecureCookie(req, settings.cookieSecureMode),
      });
      res.cookie(settings.sessionCookieName, token, {
        ...cookieOptions,
        maxAge: settings.sessionMaxAgeSeconds * 1000,
      });
      res.json({ ok: true, username: admin.username, authenticated: true });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/admin/me", async (req, res) => {
    try {
      const token = req.cookies?.[settings.sessionCookieName];
      if (!token) {
        res.json({ ok: true, username: null, authenticated: false });
        return;
      }

      const admin = await db.get(
        `
          SELECT u.username
          FROM admin_sessions s
          JOIN admin_users u ON u.id = s.admin_user_id
          WHERE s.token = ?
            AND s.expires_at > ?
            AND u.is_active = 1
        `,
        [token, new Date().toISOString()],
      );

      if (!admin) {
        res.json({ ok: true, username: null, authenticated: false });
        return;
      }

      res.json({ ok: true, username: admin.username, authenticated: true });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/admin/logout", async (req, res) => {
    try {
      const token = req.cookies?.[settings.sessionCookieName];
      if (token) {
        await db.run(`DELETE FROM admin_sessions WHERE token = ?`, [token]);
      }
      res.clearCookie(
        settings.sessionCookieName,
        buildSessionCookieOptions({
          secure: shouldUseSecureCookie(req, settings.cookieSecureMode),
        }),
      );
      res.json({ ok: true });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

}

export function registerAdminCustomerRoutes(app, context) {
  const {
    requireAdmin,
    db,
    searchImportedCustomers,
    customerStatsProvider,
    logRouteError,
  } = context;

  app.get("/api/admin/customers/search", requireAdmin, async (req, res) => {
    try {
      const payload = await searchImportedCustomers(
        db,
        {
          customer_name: String(req.query.customer_name || "").trim(),
          customer_code: String(req.query.customer_code || "").trim(),
          branch_code: String(req.query.branch_code || "").trim(),
          branch_description: String(req.query.branch_description || "").trim(),
        },
        {
          limit: req.query.limit,
        },
      );
      res.json(payload);
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/admin/customers/:code/stats", requireAdmin, async (req, res) => {
    try {
      const payload = await customerStatsProvider.getCustomerStats(req.params.code, {
        branchCode: String(req.query.branch_code || "").trim() || null,
        branchScopeCode: String(req.query.filter_branch_code || "").trim() || null,
        branchScopeDescription: String(req.query.filter_branch_description || "").trim() || null,
        salesTimeRange: String(req.query.sales_time_range || "").trim() || null,
      });
      res.json(payload);
    } catch (error) {
      logRouteError(error);
      res.status(error.status || 500).json({ detail: error.message || String(error) });
    }
  });
}

export function registerAdminRoutes(app, context) {
  registerAdminImportRoutes(app, context);
  registerAdminAuthRoutes(app, context);
  registerAdminCustomerRoutes(app, context);
}
