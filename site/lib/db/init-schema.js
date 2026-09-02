import { getMysqlImportSchemaStatements } from "./mysql-import-schema.js";

async function hasColumn(db, kind, table, column) {
  if (kind === "mysql") {
    const row = await db.get(
      `
        SELECT COUNT(*) AS n
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [table, column],
    );
    return Number(row?.n || 0) > 0;
  }

  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function ensureColumn(db, kind, table, column, ddl) {
  if (await hasColumn(db, kind, table, column)) return;
  await db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

async function ensureOwnerAdminColumn(db, kind, defaultOwnerUsername) {
  if (await hasColumn(db, kind, "admin_users", "is_owner")) return;

  await db.run(
    `ALTER TABLE admin_users ADD COLUMN is_owner ${kind === "mysql" ? "TINYINT(1)" : "INTEGER"} NOT NULL DEFAULT 0`,
  );
  if (defaultOwnerUsername) {
    await db.run(`UPDATE admin_users SET is_owner = 1 WHERE username = ?`, [
      defaultOwnerUsername,
    ]);
  }
}

async function hasIndex(db, kind, table, indexName) {
  if (kind === "mysql") {
    const row = await db.get(
      `
        SELECT COUNT(*) AS n
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
      `,
      [table, indexName],
    );
    return Number(row?.n || 0) > 0;
  }

  const rows = await db.all(`PRAGMA index_list(${table})`);
  return rows.some((row) => row.name === indexName);
}

async function ensureIndex(db, kind, table, indexName, ddl) {
  if (await hasIndex(db, kind, table, indexName)) return;
  await db.run(`CREATE INDEX ${indexName} ON ${table} ${ddl}`);
}

async function mysqlColumnType(db, table, column) {
  const row = await db.get(
    `
      SELECT column_type
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [table, column],
  );
  return String(row?.column_type || "")
    .trim()
    .toLowerCase();
}

async function ensureMysqlColumnType(db, table, column, ddl) {
  if ((await mysqlColumnType(db, table, column)) === ddl.toLowerCase()) return;
  await db.run(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${ddl}`);
}

async function initSqliteSchema(db) {
  // SQLite remains for tests and legacy/local compatibility only.
  // Production runtime is MySQL and should continue to use initMysqlSchema().
  // Logical domains:
  // - operational: products, admin_users, admin_sessions
  // - ingestion: import_runs, imported_sales_lines
  // - projections: imported_customers/imported_orders/imported_monthly_sales/imported_product_sales
  // - legacy_dormant: orders, order_lines, customer_receivables, non-import customer behavior
  await db.exec(`PRAGMA foreign_keys = ON;`);

  const statements = [
    `
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        pieces_per_package INTEGER NOT NULL,
        volume_liters REAL NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT 'N/A',
        description_norm TEXT NOT NULL DEFAULT '',
        color_norm TEXT NOT NULL DEFAULT ''
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        customer_email TEXT,
        customer_code TEXT,
        notes TEXT,
        total_qty_pieces INTEGER NOT NULL DEFAULT 0,
        total_net_value REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS order_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        qty_pieces INTEGER NOT NULL CHECK(qty_pieces > 0),
        unit_price REAL NOT NULL DEFAULT 0,
        discount_pct REAL NOT NULL DEFAULT 0,
        line_net_value REAL NOT NULL DEFAULT 0,
        FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT,
        source TEXT NOT NULL DEFAULT 'local'
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS customer_receivables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_code TEXT NOT NULL,
        document_no TEXT NOT NULL,
        document_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        amount_total REAL NOT NULL DEFAULT 0,
        amount_paid REAL NOT NULL DEFAULT 0,
        open_balance REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(customer_code, document_no),
        FOREIGN KEY(customer_code) REFERENCES customers(code) ON DELETE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_customers (
        customer_code TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL,
        delivery_code TEXT,
        delivery_description TEXT,
        branch_code TEXT,
        branch_description TEXT,
        address_1 TEXT,
        city TEXT,
        region TEXT,
        country TEXT,
        phone TEXT,
        pallet_info TEXT,
        delivery_method TEXT,
        salesperson_code TEXT,
        salesperson_name TEXT,
        is_inactive INTEGER NOT NULL DEFAULT 0,
        source_file TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_customer_branches (
        customer_code TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        branch_code TEXT NOT NULL DEFAULT '',
        branch_description TEXT NOT NULL DEFAULT '',
        orders INTEGER NOT NULL DEFAULT 0,
        revenue REAL NOT NULL DEFAULT 0,
        last_order_date TEXT,
        source_file TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(customer_code, branch_code, branch_description)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_customer_ledgers (
        customer_code TEXT PRIMARY KEY,
        customer_name TEXT NOT NULL,
        opening_balance REAL NOT NULL DEFAULT 0,
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0,
        ledger_balance REAL NOT NULL DEFAULT 0,
        pending_instruments REAL NOT NULL DEFAULT 0,
        commercial_balance REAL NOT NULL DEFAULT 0,
        email TEXT,
        is_inactive INTEGER NOT NULL DEFAULT 0,
        salesperson_code TEXT,
        source_file TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_customer_ledger_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_code TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        document_date TEXT,
        document_no TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0,
        running_debit REAL NOT NULL DEFAULT 0,
        running_credit REAL NOT NULL DEFAULT 0,
        ledger_balance REAL NOT NULL DEFAULT 0,
        source_file TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_sales_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_file TEXT NOT NULL,
        order_date TEXT NOT NULL,
        order_year INTEGER NOT NULL,
        order_month INTEGER NOT NULL,
        document_no TEXT NOT NULL,
        document_type TEXT,
        item_code TEXT NOT NULL,
        item_description TEXT NOT NULL,
        unit_code TEXT,
        qty REAL NOT NULL DEFAULT 0,
        qty_base REAL NOT NULL DEFAULT 0,
        unit_price REAL NOT NULL DEFAULT 0,
        net_value REAL NOT NULL DEFAULT 0,
        discount_pct_1 REAL NOT NULL DEFAULT 0,
        discount_pct_2 REAL NOT NULL DEFAULT 0,
        discount_pct_total REAL NOT NULL DEFAULT 0,
        customer_code TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        delivery_code TEXT,
        delivery_description TEXT,
        account_code TEXT,
        account_description TEXT,
        branch_code TEXT,
        branch_description TEXT,
        ordered_at TEXT,
        sent_at TEXT,
        note_1 TEXT,
        progress_step TEXT NOT NULL DEFAULT '',
        progress_step_description TEXT NOT NULL DEFAULT '',
        UNIQUE(source_file, document_no, item_code, customer_code, delivery_code, net_value, qty)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_orders (
        order_id TEXT PRIMARY KEY,
        document_no TEXT NOT NULL DEFAULT '',
        customer_code TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        total_lines INTEGER NOT NULL DEFAULT 0,
        total_pieces REAL NOT NULL DEFAULT 0,
        total_net_value REAL NOT NULL DEFAULT 0,
        average_discount_pct REAL NOT NULL DEFAULT 0,
        ordered_at TEXT,
        sent_at TEXT,
        document_type TEXT,
        delivery_code TEXT,
        delivery_description TEXT,
        source_file TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_open_orders (
        order_id TEXT PRIMARY KEY,
        document_no TEXT NOT NULL DEFAULT '',
        customer_code TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        total_lines INTEGER NOT NULL DEFAULT 0,
        total_pieces REAL NOT NULL DEFAULT 0,
        total_net_value REAL NOT NULL DEFAULT 0,
        average_discount_pct REAL NOT NULL DEFAULT 0,
        ordered_at TEXT,
        sent_at TEXT,
        document_type TEXT,
        delivery_code TEXT,
        delivery_description TEXT,
        source_file TEXT,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_monthly_sales (
        customer_code TEXT NOT NULL,
        order_year INTEGER NOT NULL,
        order_month INTEGER NOT NULL,
        revenue REAL NOT NULL DEFAULT 0,
        pieces REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(customer_code, order_year, order_month)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS imported_product_sales (
        customer_code TEXT NOT NULL,
        item_code TEXT NOT NULL,
        item_description TEXT NOT NULL,
        revenue REAL NOT NULL DEFAULT 0,
        pieces REAL NOT NULL DEFAULT 0,
        orders INTEGER NOT NULL DEFAULT 0,
        avg_unit_price REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(customer_code, item_code)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS import_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset TEXT NOT NULL,
        file_name TEXT NOT NULL,
        import_mode TEXT NOT NULL DEFAULT 'incremental',
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        source_files_json TEXT,
        source_checksum TEXT,
        source_row_count INTEGER NOT NULL DEFAULT 0,
        rows_in INTEGER NOT NULL DEFAULT 0,
        rows_upserted INTEGER NOT NULL DEFAULT 0,
        rows_skipped_duplicate INTEGER NOT NULL DEFAULT 0,
        rows_rejected INTEGER NOT NULL DEFAULT 0,
        rebuild_started_at TEXT,
        rebuild_finished_at TEXT,
        schema_version TEXT NOT NULL DEFAULT 'import-ledger-v3',
        trigger_source TEXT,
        metadata_json TEXT,
        error_text TEXT
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS customer_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        customer_code TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_user_id INTEGER NOT NULL,
        token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_user_id) REFERENCES customer_users(id) ON DELETE CASCADE
      )
    `,
  ];

  for (const sql of statements) {
    await db.run(sql);
  }
}

async function initMysqlSchema(db) {
  // Logical domains:
  // - operational: products, admin_users, admin_sessions
  // - ingestion: import_runs, imported_sales_lines
  // - projections: imported_customers/imported_orders/imported_monthly_sales/imported_product_sales
  // - legacy_dormant: orders, order_lines, customer_receivables, non-import customer behavior
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(128) NOT NULL UNIQUE,
        description TEXT NOT NULL,
        image_url TEXT NOT NULL,
        pieces_per_package INT NOT NULL,
        volume_liters DOUBLE NOT NULL DEFAULT 0,
        color VARCHAR(128) NOT NULL DEFAULT 'N/A',
        description_norm TEXT NOT NULL,
        color_norm TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255),
        customer_code VARCHAR(128),
        notes TEXT,
        total_qty_pieces INT NOT NULL DEFAULT 0,
        total_net_value DOUBLE NOT NULL DEFAULT 0,
        created_at VARCHAR(64) NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS order_lines (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        product_id INT NOT NULL,
        qty_pieces INT NOT NULL,
        unit_price DOUBLE NOT NULL DEFAULT 0,
        discount_pct DOUBLE NOT NULL DEFAULT 0,
        line_net_value DOUBLE NOT NULL DEFAULT 0,
        INDEX idx_order_lines_order_id(order_id),
        INDEX idx_order_lines_product_id(product_id),
        CONSTRAINT fk_order_lines_order FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_lines_product FOREIGN KEY(product_id) REFERENCES products(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS customers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        source VARCHAR(64) NOT NULL DEFAULT 'local'
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS customer_receivables (
        id INT AUTO_INCREMENT PRIMARY KEY,
        customer_code VARCHAR(128) NOT NULL,
        document_no VARCHAR(128) NOT NULL,
        document_date VARCHAR(64) NOT NULL,
        due_date VARCHAR(64) NOT NULL,
        amount_total DOUBLE NOT NULL DEFAULT 0,
        amount_paid DOUBLE NOT NULL DEFAULT 0,
        open_balance DOUBLE NOT NULL DEFAULT 0,
        status VARCHAR(64) NOT NULL DEFAULT 'open',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_receivable_customer_doc(customer_code, document_no),
        CONSTRAINT fk_receivable_customer FOREIGN KEY(customer_code) REFERENCES customers(code) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    ...getMysqlImportSchemaStatements(),
    `
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(128) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        admin_user_id INT NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_admin_sessions_user_id(admin_user_id),
        CONSTRAINT fk_admin_session_user FOREIGN KEY(admin_user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS customer_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(191) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        customer_code VARCHAR(128) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_customer_users_customer_code(customer_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    `
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        customer_user_id INT NOT NULL,
        token VARCHAR(255) NOT NULL UNIQUE,
        expires_at VARCHAR(64) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_customer_sessions_user_id(customer_user_id),
        CONSTRAINT fk_customer_session_user FOREIGN KEY(customer_user_id) REFERENCES customer_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
  ];

  for (const sql of statements) {
    await db.run(sql);
  }
}

export async function initDatabaseSchema({ db, kind }) {
  if (kind === "mysql") {
    await initMysqlSchema(db);
  } else {
    await initSqliteSchema(db);
  }

  const typeText = kind === "mysql" ? "VARCHAR(128)" : "TEXT";
  const typeInt = kind === "mysql" ? "INT" : "INTEGER";
  const typeReal = kind === "mysql" ? "DOUBLE" : "REAL";

  await ensureOwnerAdminColumn(db, kind, "admin");
  await ensureColumn(
    db,
    kind,
    "orders",
    "customer_code",
    `customer_code ${typeText}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_branches",
    "customer_name",
    `customer_name ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"} NOT NULL`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_branches",
    "orders",
    `orders ${typeInt} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_branches",
    "revenue",
    `revenue ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_branches",
    "last_order_date",
    `last_order_date ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_branches",
    "source_file",
    `source_file ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"}`,
  );
  await ensureIndex(
    db,
    kind,
    "imported_customer_branches",
    "idx_imported_customer_branches_customer_lookup",
    "(customer_code, branch_code, branch_description)",
  );
  await ensureIndex(
    db,
    kind,
    "imported_customer_branches",
    "idx_imported_customer_branches_name_lookup",
    kind === "mysql"
      ? "(customer_name(191), branch_description(191))"
      : "(customer_name, branch_description)",
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "customer_name",
    `customer_name ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "opening_balance",
    `opening_balance ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "debit",
    `debit ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "credit",
    `credit ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "ledger_balance",
    `ledger_balance ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "pending_instruments",
    `pending_instruments ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "commercial_balance",
    `commercial_balance ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "email",
    `email ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "is_inactive",
    `is_inactive ${kind === "mysql" ? "TINYINT(1)" : "INTEGER"} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "salesperson_code",
    `salesperson_code ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledgers",
    "source_file",
    `source_file ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "customer_name",
    `customer_name ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "document_date",
    `document_date ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "document_no",
    `document_no ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "reason",
    `reason ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "debit",
    `debit ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "credit",
    `credit ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "running_debit",
    `running_debit ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "running_credit",
    `running_credit ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "ledger_balance",
    `ledger_balance ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customer_ledger_lines",
    "source_file",
    `source_file ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "total_qty_pieces",
    `total_qty_pieces ${typeInt} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "total_net_value",
    `total_net_value ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "order_lines",
    "unit_price",
    `unit_price ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "order_lines",
    "discount_pct",
    `discount_pct ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "order_lines",
    "line_net_value",
    `line_net_value ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "customer_substore",
    `customer_substore ${typeText}`,
  );
  // The picked branch's exact code (== ES1 ESGOSites.Code). The viomes_db ΠΑΡ writer
  // resolves the delivery site from this - the free-text customer_substore label alone
  // only resolves ~85% because big chains label a store with a different number than
  // its real code. Nullable: retail / no-branch orders leave it blank.
  await ensureColumn(
    db,
    kind,
    "orders",
    "customer_substore_code",
    `customer_substore_code ${typeText}`,
  );
  // Αρ. Παραγγελίας - the reference number the customer quotes for their own order
  // (their PO / internal order id). Optional free text: it can be a bare number, a
  // hyphenated range, or a number+date. The viomes_db ΠΑΡ writer puts it into the
  // document's dd/dt.ADReasoning as "Αρ.Παραγγελίας:<value>". Nullable - blank when the
  // customer gave no reference.
  await ensureColumn(
    db,
    kind,
    "orders",
    "customer_order_no",
    `customer_order_no ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"}`,
  );
  // Writer lifecycle, not an approval state: a submitted order is 'ready' for the
  // viomes_db ΠΑΡ writer to pick up (there is no human approval step any more - ES1's
  // own '100. Πιστωτικός Έλεγχος' is the gate). The writer moves it ready -> writing ->
  // written / write_failed; an owner-admin can park a row as 'held'. The default only
  // bites on brand-new databases - createOrderSubmission always sets 'ready' explicitly.
  await ensureColumn(
    db,
    kind,
    "orders",
    "status",
    `status ${kind === "mysql" ? "VARCHAR(32)" : "TEXT"} NOT NULL DEFAULT 'ready'`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "submitted_at",
    `submitted_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "approved_by",
    `approved_by ${typeText}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "approved_at",
    `approved_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "es1_document_code",
    `es1_document_code ${typeText}`,
  );
  // Filled by the viomes_db ΠΑΡ writer, not by this app. es1_document_code carries the
  // resulting ES1 code (e.g. ΠΑΡ-Μ-37411) on success; es1_write_error carries the failure
  // string on 'write_failed'; es1_write_attempts counts tries so a poison row can be
  // spotted and parked. This app only ever reads these, for the read-only admin view.
  await ensureColumn(
    db,
    kind,
    "orders",
    "es1_written_at",
    `es1_written_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "es1_write_error",
    `es1_write_error TEXT`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "es1_write_attempts",
    `es1_write_attempts ${typeInt} NOT NULL DEFAULT 0`,
  );
  // Soft-archive for the admin "Νέες παραγγελίες πωλητών" panel. "Clear" there is
  // reversible: an owner-admin sets archived_at to hide test / stale rows from the
  // default view (and the viomes_db ΠΑΡ writer skips archived rows once its own probe
  // for this column passes); un-archive clears it again. Never a hard DELETE.
  await ensureColumn(
    db,
    kind,
    "orders",
    "archived_at",
    `archived_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  // Denylist "held for approval" flow. The viomes_db ΠΑΡ writer runs allow-all minus a
  // denylist it keeps in its own .env; this app never sees the list. When the poller
  // parks a denylisted order it sets status='held' (+ held_reason). An owner-admin here
  // then Approves (status back to 'ready' + writer_override=1, so the poller writes it
  // that one time) or Rejects (status='rejected'). writer_override is the switch: the
  // poller's hold step only engages once this column exists.
  await ensureColumn(
    db,
    kind,
    "orders",
    "writer_override",
    `writer_override ${kind === "mysql" ? "TINYINT(1)" : "INTEGER"} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "held_reason",
    `held_reason ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "rejected_by",
    `rejected_by ${typeText}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "rejected_at",
    `rejected_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "order_lines",
    "price_source",
    `price_source ${kind === "mysql" ? "VARCHAR(32)" : "TEXT"}`,
  );
  // ES1's Πληροφορίες tab carries three manual per-order dates. Ημ/νία Λήψης Παραγγελίας
  // (order received) needs no column — submitted_at is exactly that for a form order.
  // The other two are captured by different people at different moments:
  //   desired_delivery_date — Ημ/νία Επιθυμητής Παραλαβής, stated by the CUSTOMER at
  //     order entry. Populated on 100% of THE MART's orders, 99.6% of DEDEMAN's and
  //     79.5% of Σκλαβενίτης's, so it matters most on exactly the accounts that matter.
  //   dispatch_date — Ημ/νία Παράδοσης από Έδρα, a scheduling decision made by the office
  //     directly in ES1 after the order lands in step 1. ΑΡΧΙΚΟ. No longer written here
  //     (it was only ever set at the approval step, which is gone); the column stays
  //     nullable and unused so old rows keep validating.
  await ensureColumn(
    db,
    kind,
    "orders",
    "desired_delivery_date",
    `desired_delivery_date ${kind === "mysql" ? "DATE" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "dispatch_date",
    `dispatch_date ${kind === "mysql" ? "DATE" : "TEXT"}`,
  );
  // ΤΡΟΠΟΣ ΛΗΨΗΣ ΠΑΡΑΓΓΕΛΙΑΣ — ES1's order-receipt channel, stored so the eventual
  // ΠΑΡ writer knows which code to stamp on the document rather than re-deriving it.
  await ensureColumn(
    db,
    kind,
    "orders",
    "es1_order_channel_code",
    `es1_order_channel_code ${kind === "mysql" ? "VARCHAR(16)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "submitted_by",
    `submitted_by ${typeText}`,
  );
  await ensureColumn(
    db,
    kind,
    "orders",
    "submitted_by_role",
    `submitted_by_role ${kind === "mysql" ? "VARCHAR(32)" : "TEXT"}`,
  );
  // Set when the live pricing service (viomes_db/pricing-service) was configured but
  // unreachable at submission time. Per the user's explicit choice, an unreachable
  // service must never silently fall back to the older statistical estimate - that would
  // look identical to a real price in the queue. This is the flag that tells the approver
  // "price this by hand", distinct from value_is_partial (some lines priced, some not).
  await ensureColumn(
    db,
    kind,
    "orders",
    "needs_manual_price_review",
    `needs_manual_price_review ${kind === "mysql" ? "TINYINT(1)" : "INTEGER"} NOT NULL DEFAULT 0`,
  );
  await ensureIndex(
    db,
    kind,
    "orders",
    "idx_orders_status_submitted_at",
    "(status, submitted_at)",
  );
  // The admin panel's default query is status IN (…) AND archived_at IS NULL ordered
  // by submitted_at; the writer's claim is status='ready' AND archived_at IS NULL.
  await ensureIndex(
    db,
    kind,
    "orders",
    "idx_orders_status_archived_submitted",
    "(status, archived_at, submitted_at)",
  );
  await ensureColumn(
    db,
    kind,
    "imported_sales_lines",
    "ordered_at",
    `ordered_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_sales_lines",
    "sent_at",
    `sent_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_orders",
    "ordered_at",
    `ordered_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_orders",
    "sent_at",
    `sent_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customers",
    "branch_code",
    `branch_code ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_customers",
    "branch_description",
    `branch_description ${kind === "mysql" ? "VARCHAR(255)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "import_mode",
    `import_mode ${kind === "mysql" ? "VARCHAR(32)" : "TEXT"} NOT NULL DEFAULT 'incremental'`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "source_files_json",
    `source_files_json ${kind === "mysql" ? "LONGTEXT" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "source_checksum",
    `source_checksum ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "source_row_count",
    `source_row_count ${typeInt} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "rows_skipped_duplicate",
    `rows_skipped_duplicate ${typeInt} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "rows_rejected",
    `rows_rejected ${typeInt} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "rebuild_started_at",
    `rebuild_started_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "rebuild_finished_at",
    `rebuild_finished_at ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "schema_version",
    `schema_version ${kind === "mysql" ? "VARCHAR(32)" : "TEXT"} NOT NULL DEFAULT 'import-ledger-v3'`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "trigger_source",
    `trigger_source ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
  );
  await ensureColumn(
    db,
    kind,
    "import_runs",
    "metadata_json",
    `metadata_json ${kind === "mysql" ? "LONGTEXT" : "TEXT"}`,
  );
  await ensureIndex(
    db,
    kind,
    "imported_sales_lines",
    "idx_imported_sales_line_lookup",
    "(order_date, document_no, item_code, customer_code, delivery_code)",
  );
  await ensureIndex(
    db,
    kind,
    "imported_sales_lines",
    "idx_imported_sales_customer_date_doc",
    "(customer_code, order_date, document_no)",
  );
  await ensureIndex(
    db,
    kind,
    "imported_sales_lines",
    "idx_imported_sales_customer_year_month",
    "(customer_code, order_year, order_month)",
  );
  await ensureIndex(
    db,
    kind,
    "imported_sales_lines",
    "idx_imported_sales_customer_item",
    "(customer_code, item_code)",
  );
  // The order-value estimator's any-customer price fallback looks up the newest invoiced
  // line for ONE item. Without an item-leading index it walks
  // idx_imported_sales_line_lookup (order_date first) backwards until the item turns up,
  // so the rarer the item the slower it gets: ~75ms at 20-29 invoiced lines, but
  // 1.4s at 3-4. One 76-line order of rare items took 112 seconds to price.
  await ensureIndex(
    db,
    kind,
    "imported_sales_lines",
    "idx_imported_sales_item_date_doc",
    "(item_code, order_date, document_no)",
  );
  await ensureColumn(
    db,
    kind,
    "imported_sales_lines",
    "discount_pct_1",
    `discount_pct_1 ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_sales_lines",
    "discount_pct_2",
    `discount_pct_2 ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_sales_lines",
    "discount_pct_total",
    `discount_pct_total ${typeReal} NOT NULL DEFAULT 0`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_orders",
    "document_no",
    `document_no ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  await ensureColumn(
    db,
    kind,
    "imported_orders",
    "progress_step",
    `progress_step ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  if (kind === "mysql") {
    await ensureMysqlColumnType(
      db,
      "imported_orders",
      "order_id",
      "VARCHAR(300) NOT NULL",
    );
  }
  await ensureColumn(
    db,
    kind,
    "imported_open_orders",
    "progress_step",
    `progress_step ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  await ensureIndex(
    db,
    kind,
    "imported_orders",
    "idx_imported_orders_customer_document_date",
    "(customer_code, document_no, created_at)",
  );
  await ensureIndex(
    db,
    kind,
    "imported_customer_ledger_lines",
    "idx_imported_customer_ledger_lines_customer_date",
    "(customer_code, document_date, id)",
  );
}
