import mysql from "mysql2/promise";

export async function openDatabase({ env = process.env } = {}) {
  const client = String(env.DB_CLIENT || "mysql")
    .trim()
    .toLowerCase();

  if (client !== "mysql") {
    throw new Error(
      `Unsupported DB_CLIENT "${client}". This runtime is MySQL-only. Set DB_CLIENT=mysql.`,
    );
  }

  const host = String(env.MYSQL_HOST || "127.0.0.1").trim();
  const port = Number(env.MYSQL_PORT || 3306);
  const user = String(env.MYSQL_USER || "").trim();
  const password = String(env.MYSQL_PASSWORD || "");
  const database = String(env.MYSQL_DATABASE || "").trim();
  const connectionLimit = Math.max(Number(env.MYSQL_CONNECTION_LIMIT || 10), 1);

  if (!user || !database) {
    throw new Error("MySQL requires MYSQL_USER and MYSQL_DATABASE.");
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
