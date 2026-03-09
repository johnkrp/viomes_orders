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
  return String(row?.column_type || "").trim().toLowerCase();
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
        postal_code TEXT,
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
        customer_code TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        delivery_code TEXT,
        delivery_description TEXT,
        account_code TEXT,
        account_description TEXT,
        branch_code TEXT,
        branch_description TEXT,
        postal_code TEXT,
        note_1 TEXT,
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
        schema_version TEXT NOT NULL DEFAULT 'import-ledger-v2',
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

  await ensureColumn(db, kind, "orders", "customer_code", `customer_code ${typeText}`);
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
    "imported_sales_lines",
    "postal_code",
    `postal_code ${kind === "mysql" ? "VARCHAR(64)" : "TEXT"}`,
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
    `schema_version ${kind === "mysql" ? "VARCHAR(32)" : "TEXT"} NOT NULL DEFAULT 'import-ledger-v2'`,
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
  await ensureColumn(
    db,
    kind,
    "imported_orders",
    "document_no",
    `document_no ${kind === "mysql" ? "VARCHAR(128)" : "TEXT"} NOT NULL DEFAULT ''`,
  );
  if (kind === "mysql") {
    await ensureMysqlColumnType(db, "imported_orders", "order_id", "VARCHAR(300) NOT NULL");
  }
  await ensureIndex(
    db,
    kind,
    "imported_orders",
    "idx_imported_orders_customer_document_date",
    "(customer_code, document_no, created_at)",
  );
}
