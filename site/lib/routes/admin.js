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
    logActivity,
  } = context;

  app.post("/api/admin/login", async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");

      const admin = await db.get(
        `
          SELECT id, username, password_hash, is_active, is_owner
          FROM admin_users
          WHERE username = ?
        `,
        [username],
      );

      if (!admin || !admin.is_active || !verifyPassword(password, admin.password_hash)) {
        logActivity("admin.login.failed", { req, username });
        res
          .status(401)
          .json({ ok: false, username: null, authenticated: false, is_owner: false });
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
      logActivity("admin.login.success", {
        req,
        username: admin.username,
        isOwner: Boolean(admin.is_owner),
      });
      res.json({
        ok: true,
        username: admin.username,
        authenticated: true,
        is_owner: Boolean(admin.is_owner),
      });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/admin/me", async (req, res) => {
    try {
      const token = req.cookies?.[settings.sessionCookieName];
      if (!token) {
        res.json({ ok: true, username: null, authenticated: false, is_owner: false });
        return;
      }

      const admin = await db.get(
        `
          SELECT u.username, u.is_owner
          FROM admin_sessions s
          JOIN admin_users u ON u.id = s.admin_user_id
          WHERE s.token = ?
            AND s.expires_at > ?
            AND u.is_active = 1
        `,
        [token, new Date().toISOString()],
      );

      if (!admin) {
        res.json({ ok: true, username: null, authenticated: false, is_owner: false });
        return;
      }

      res.json({
        ok: true,
        username: admin.username,
        authenticated: true,
        is_owner: Boolean(admin.is_owner),
      });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/admin/logout", async (req, res) => {
    try {
      const token = req.cookies?.[settings.sessionCookieName];
      if (token) {
        const admin = await db.get(
          `
            SELECT u.username
            FROM admin_sessions s
            JOIN admin_users u ON u.id = s.admin_user_id
            WHERE s.token = ?
          `,
          [token],
        );
        await db.run(`DELETE FROM admin_sessions WHERE token = ?`, [token]);
        logActivity("admin.logout", { req, username: admin?.username || null });
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
    logActivity,
  } = context;

  app.get("/api/admin/customers/search", requireAdmin, async (req, res) => {
    try {
      const filters = {
        customer_name: String(req.query.customer_name || "").trim(),
        customer_code: String(req.query.customer_code || "").trim(),
        branch_code: String(req.query.branch_code || "").trim(),
        branch_description: String(req.query.branch_description || "").trim(),
      };
      const payload = await searchImportedCustomers(db, filters, {
        limit: req.query.limit,
      });

      // Only the admin page's deliberate "Αναζήτηση" submit sends track=1 - the
      // order form's staff customer picker and the typeahead hit this same route
      // on every keystroke and must not flood the log.
      if (String(req.query.track || "") === "1") {
        logActivity("admin.customer_search", {
          req,
          username: req.admin?.username || null,
          isOwner: Boolean(req.admin?.is_owner),
          name: filters.customer_name || null,
          code: filters.customer_code || null,
          branchCode: filters.branch_code || null,
          branchDescription: filters.branch_description || null,
          resultCount: Array.isArray(payload?.items) ? payload.items.length : null,
        });
      }

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

export function registerAdminOrderSubmissionRoutes(app, context) {
  const {
    requireOwnerAdmin,
    db,
    listOrderSubmissions,
    archiveOrderSubmissions,
    unarchiveOrderSubmissions,
    approveHeldOrderSubmission,
    rejectHeldOrderSubmission,
    validateListFilterDate,
    logRouteError,
    logActivity,
  } = context;

  // Read-only feed. The approve/reject routes were removed with the approval step - a
  // captured order flows straight to the viomes_db ΠΑΡ writer, which owns every status
  // transition on the DB itself. This endpoint just exposes the pipeline, with optional
  // ?from=YYYY-MM-DD&to=YYYY-MM-DD date-range and ?archived=1 (the un-archive view).
  app.get("/api/admin/order-submissions", requireOwnerAdmin, async (req, res) => {
    try {
      const from = validateListFilterDate(req.query.from, "Από ημερομηνία");
      const to = validateListFilterDate(req.query.to, "Έως ημερομηνία");
      const archived = ["1", "true", "yes"].includes(
        String(req.query.archived || "").toLowerCase(),
      );
      const items = await listOrderSubmissions(db, { from, to, archived });
      res.json({ items });
    } catch (error) {
      logRouteError(error);
      res
        .status(error.status || 500)
        .json({ error: error.message || String(error) });
    }
  });

  // Soft-archive (reversible). Body { ids: number[] }. 'writing' / 'written' rows are
  // refused and returned in `skipped`; there is no hard-delete endpoint.
  app.post(
    "/api/admin/order-submissions/archive",
    requireOwnerAdmin,
    async (req, res) => {
      try {
        const result = await archiveOrderSubmissions(db, req.body?.ids);
        res.json(result);
      } catch (error) {
        logRouteError(error);
        res
          .status(error.status || 500)
          .json({ error: error.message || String(error) });
      }
    },
  );

  app.post(
    "/api/admin/order-submissions/unarchive",
    requireOwnerAdmin,
    async (req, res) => {
      try {
        const result = await unarchiveOrderSubmissions(db, req.body?.ids);
        res.json(result);
      } catch (error) {
        logRouteError(error);
        res
          .status(error.status || 500)
          .json({ error: error.message || String(error) });
      }
    },
  );

  // Denylist "held for approval" — owner-admin releases / declines a poller-held
  // order. Only status='held' rows are actionable (enforced in the SQL WHERE);
  // anything else → 409. This is a denylist-only gate, NOT the old general approval
  // step ("let the robot write this", not "approve the order").
  app.post(
    "/api/admin/order-submissions/:id/approve",
    requireOwnerAdmin,
    async (req, res) => {
      try {
        const result = await approveHeldOrderSubmission(
          db,
          req.params.id,
          req.admin?.username,
        );
        logActivity("order.approved", {
          req,
          username: req.admin?.username || null,
          orderId: req.params.id,
        });
        res.json(result);
      } catch (error) {
        logRouteError(error);
        res
          .status(error.status || 500)
          .json({ error: error.message || String(error) });
      }
    },
  );

  app.post(
    "/api/admin/order-submissions/:id/reject",
    requireOwnerAdmin,
    async (req, res) => {
      try {
        const result = await rejectHeldOrderSubmission(
          db,
          req.params.id,
          req.admin?.username,
          req.body?.reason,
        );
        logActivity("order.rejected", {
          req,
          username: req.admin?.username || null,
          orderId: req.params.id,
          reason: req.body?.reason || null,
        });
        res.json(result);
      } catch (error) {
        logRouteError(error);
        res
          .status(error.status || 500)
          .json({ error: error.message || String(error) });
      }
    },
  );
}

export function registerAdminRoutes(app, context) {
  registerAdminImportRoutes(app, context);
  registerAdminAuthRoutes(app, context);
  registerAdminCustomerRoutes(app, context);
  registerAdminOrderSubmissionRoutes(app, context);
}
