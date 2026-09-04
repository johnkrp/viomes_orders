export function registerCustomerAuthRoutes(app, context) {
  const {
    db,
    settings,
    verifyPassword,
    newSessionToken,
    buildSessionCookieOptions,
    shouldUseSecureCookie,
    getImportedCustomerByCode,
    logRouteError,
    logActivity,
  } = context;

  async function resolveCustomerDisplayName(customerCode) {
    const record = await getImportedCustomerByCode(db, customerCode);
    return record?.name || null;
  }

  app.post("/api/customer/login", async (req, res) => {
    try {
      const username = String(req.body?.username || "").trim();
      const password = String(req.body?.password || "");

      const customer = await db.get(
        `
          SELECT id, username, password_hash, customer_code, is_active
          FROM customer_users
          WHERE username = ?
        `,
        [username],
      );

      if (
        !customer ||
        !customer.is_active ||
        !verifyPassword(password, customer.password_hash)
      ) {
        logActivity("customer.login.failed", { req, username });
        res.status(401).json({
          ok: false,
          username: null,
          authenticated: false,
          customer_code: null,
        });
        return;
      }

      const token = newSessionToken();
      const expiresAt = new Date(
        Date.now() + settings.sessionMaxAgeSeconds * 1000,
      ).toISOString();

      await db.run(
        `
          INSERT INTO customer_sessions(customer_user_id, token, expires_at)
          VALUES (?, ?, ?)
        `,
        [customer.id, token, expiresAt],
      );

      const cookieOptions = buildSessionCookieOptions({
        secure: shouldUseSecureCookie(req, settings.cookieSecureMode),
      });
      res.cookie(settings.customerSessionCookieName, token, {
        ...cookieOptions,
        maxAge: settings.sessionMaxAgeSeconds * 1000,
      });
      logActivity("customer.login.success", {
        req,
        username: customer.username,
        customerCode: customer.customer_code,
      });
      res.json({
        ok: true,
        username: customer.username,
        authenticated: true,
        customer_code: customer.customer_code,
        customer_name: await resolveCustomerDisplayName(customer.customer_code),
      });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/customer/me", async (req, res) => {
    try {
      const token = req.cookies?.[settings.customerSessionCookieName];
      if (!token) {
        res.json({
          ok: true,
          username: null,
          authenticated: false,
          customer_code: null,
        });
        return;
      }

      const customer = await db.get(
        `
          SELECT u.username, u.customer_code
          FROM customer_sessions s
          JOIN customer_users u ON u.id = s.customer_user_id
          WHERE s.token = ?
            AND s.expires_at > ?
            AND u.is_active = 1
        `,
        [token, new Date().toISOString()],
      );

      if (!customer) {
        res.json({
          ok: true,
          username: null,
          authenticated: false,
          customer_code: null,
        });
        return;
      }

      res.json({
        ok: true,
        username: customer.username,
        authenticated: true,
        customer_code: customer.customer_code,
        customer_name: await resolveCustomerDisplayName(customer.customer_code),
      });
    } catch (error) {
      logRouteError(error);
      res.status(500).json({ error: String(error) });
    }
  });

  app.post("/api/customer/logout", async (req, res) => {
    try {
      const token = req.cookies?.[settings.customerSessionCookieName];
      if (token) {
        const customer = await db.get(
          `
            SELECT u.username, u.customer_code
            FROM customer_sessions s
            JOIN customer_users u ON u.id = s.customer_user_id
            WHERE s.token = ?
          `,
          [token],
        );
        await db.run(`DELETE FROM customer_sessions WHERE token = ?`, [
          token,
        ]);
        logActivity("customer.logout", {
          req,
          username: customer?.username || null,
          customerCode: customer?.customer_code || null,
        });
      }
      res.clearCookie(
        settings.customerSessionCookieName,
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
