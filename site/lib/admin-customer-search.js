function normalizeFilters(filters = {}) {
  return {
    customer_name: String(filters.customer_name || "").trim(),
    customer_code: String(filters.customer_code || "").trim(),
    branch_code: String(filters.branch_code || "").trim(),
    branch_description: String(filters.branch_description || "").trim(),
  };
}

function hasFilters(filters) {
  return Object.values(filters).some(Boolean);
}

export async function searchImportedCustomers(db, filters = {}, options = {}) {
  const normalizedFilters = normalizeFilters(filters);
  const limit = Math.min(Math.max(parseInt(options.limit || "20", 10), 1), 50);

  if (!hasFilters(normalizedFilters)) {
    return { items: [], total: 0, filters: normalizedFilters };
  }

  const whereParts = [];
  const whereParams = [];
  const exactScoreParts = [];
  const exactScoreParams = [];
  const prefixScoreParts = [];
  const prefixScoreParams = [];

  if (normalizedFilters.customer_name) {
    whereParts.push("customer_name LIKE ?");
    whereParams.push(`%${normalizedFilters.customer_name}%`);
    exactScoreParts.push("MAX(CASE WHEN customer_name = ? THEN 1 ELSE 0 END)");
    exactScoreParams.push(normalizedFilters.customer_name);
    prefixScoreParts.push("MAX(CASE WHEN customer_name LIKE ? THEN 1 ELSE 0 END)");
    prefixScoreParams.push(`${normalizedFilters.customer_name}%`);
  }

  if (normalizedFilters.customer_code) {
    whereParts.push("customer_code LIKE ?");
    whereParams.push(`%${normalizedFilters.customer_code}%`);
    exactScoreParts.push("MAX(CASE WHEN customer_code = ? THEN 1 ELSE 0 END)");
    exactScoreParams.push(normalizedFilters.customer_code);
    prefixScoreParts.push("MAX(CASE WHEN customer_code LIKE ? THEN 1 ELSE 0 END)");
    prefixScoreParams.push(`${normalizedFilters.customer_code}%`);
  }

  if (normalizedFilters.branch_code) {
    whereParts.push("branch_code LIKE ?");
    whereParams.push(`%${normalizedFilters.branch_code}%`);
    exactScoreParts.push("MAX(CASE WHEN branch_code = ? THEN 1 ELSE 0 END)");
    exactScoreParams.push(normalizedFilters.branch_code);
    prefixScoreParts.push("MAX(CASE WHEN branch_code LIKE ? THEN 1 ELSE 0 END)");
    prefixScoreParams.push(`${normalizedFilters.branch_code}%`);
  }

  if (normalizedFilters.branch_description) {
    whereParts.push("branch_description LIKE ?");
    whereParams.push(`%${normalizedFilters.branch_description}%`);
    exactScoreParts.push("MAX(CASE WHEN branch_description = ? THEN 1 ELSE 0 END)");
    exactScoreParams.push(normalizedFilters.branch_description);
    prefixScoreParts.push("MAX(CASE WHEN branch_description LIKE ? THEN 1 ELSE 0 END)");
    prefixScoreParams.push(`${normalizedFilters.branch_description}%`);
  }

  const rows = await db.all(
    `
      SELECT
        customer_code AS code,
        COALESCE(NULLIF(MAX(customer_name), ''), customer_code) AS name,
        COUNT(DISTINCT branch_code) AS branch_count,
        CASE
          WHEN COUNT(DISTINCT branch_code) = 1 THEN MAX(branch_code)
          ELSE ''
        END AS branch_code,
        CASE
          WHEN COUNT(DISTINCT branch_code) = 1 THEN COALESCE(NULLIF(MAX(branch_description), ''), '')
          ELSE ''
        END AS branch_description
      FROM imported_customer_branches
      WHERE ${whereParts.join(" AND ")}
      GROUP BY customer_code
      ORDER BY
        (${exactScoreParts.join(" + ") || "0"}) DESC,
        (${prefixScoreParts.join(" + ") || "0"}) DESC,
        name,
        customer_code
      LIMIT ?
    `,
    [...whereParams, ...exactScoreParams, ...prefixScoreParams, limit],
  );

  return {
    filters: normalizedFilters,
    total: rows.length,
    items: rows.map((row) => ({
      code: row.code,
      name: row.name,
      branch_code: row.branch_code || "",
      branch_description:
        Number(row.branch_count || 0) === 1
          ? row.branch_description || ""
          : `${Number(row.branch_count || 0)} υποκαταστήματα`,
    })),
  };
}
