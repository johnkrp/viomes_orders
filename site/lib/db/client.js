import path from "node:path";
import mysql from "mysql2/promise";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

function normalizeDbClientName(value) {
  return String(value || "sqlite")
    .trim()
    .toLowerCase();
}

export async function openDatabase({ env = process.env, sqlitePath } = {}) {
  const client = normalizeDbClientName(env.DB_CLIENT);

  if (client === "mysql") {
    const host = String(env.MYSQL_HOST || "127.0.0.1").trim();
    const port = Number(env.MYSQL_PORT || 3306);
    const user = String(env.MYSQL_USER || "").trim();
    const password = String(env.MYSQL_PASSWORD || "");
    const database = String(env.MYSQL_DATABASE || "").trim();
    const connectionLimit = Math.max(Number(env.MYSQL_CONNECTION_LIMIT || 10), 1);

    if (!user || !database) {
      throw new Error("DB_CLIENT=mysql requires MYSQL_USER and MYSQL_DATABASE.");
    }

    const pool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit,
      decimalNumbers: true,
      dateStrings: true,
    });

    await pool.query("SELECT 1");

    return {
      kind: "mysql",
      description: `${host}:${port}/${database}`,
      async get(sql, params = []) {
        const [rows] = await pool.execute(sql, params);
        return rows[0];
      },
      async all(sql, params = []) {
        const [rows] = await pool.execute(sql, params);
        return rows;
      },
      async run(sql, params = []) {
        const [result] = await pool.execute(sql, params);
        return {
          lastID: Number(result?.insertId || 0),
          changes: Number(result?.affectedRows || 0),
        };
      },
      async exec(sql) {
        await pool.query(sql);
      },
      async close() {
        await pool.end();
      },
    };
  }

  const filename = sqlitePath || path.join(process.cwd(), "..", "backend", "app.db");
  const db = await open({ filename, driver: sqlite3.Database });

  return {
    kind: "sqlite",
    description: filename,
    get: db.get.bind(db),
    all: db.all.bind(db),
    run: db.run.bind(db),
    exec: db.exec.bind(db),
    close: db.close.bind(db),
  };
}
