export async function apiFetch(apiBase, path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = payload?.detail || payload?.error || `HTTP ${response.status}`;
    throw new Error(detail);
  }

  return payload;
}

export function formatImportDatasetLabel(labels, dataset) {
  const normalized = String(dataset || "").trim().toLowerCase();
  if (!normalized) return "άγνωστο";
  return labels[normalized] || normalized;
}

export function buildImportMessage({ apiBase, labels, latestRun, username, formatDate }) {
  const base = `Συνδεδεμένος χρήστης: ${username}. API: ${apiBase || "same-origin"}`;
  if (!latestRun) return `${base}. Τελευταία εισαγωγή δεδομένων: μη διαθέσιμη`;

  const dataset = formatImportDatasetLabel(labels, latestRun.dataset);
  const finishedAt = formatDate(latestRun.finished_at || latestRun.started_at);
  return `${base}. Τελευταία εισαγωγή δεδομένων: ${dataset}, στις ${finishedAt}`;
}

export async function loadLatestImportMessage(context, me) {
  if (!me?.authenticated) {
    context.setSessionInfo("Δεν υπάρχει ενεργή συνεδρία διαχειριστή.");
    return;
  }

  context.setSessionInfo(`Συνδεδεμένος χρήστης: ${me.username}. Φόρτωση τελευταίας εισαγωγής δεδομένων...`);

  try {
    const payload = await apiFetch(context.apiBase, "/api/admin/import-health", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    context.setSessionInfo(
      buildImportMessage({
        apiBase: context.apiBase,
        labels: context.importDatasetLabels,
        latestRun: payload?.latest_import_run || null,
        username: me.username,
        formatDate: context.formatDate,
      }),
    );
  } catch (_error) {
    context.setSessionInfo(
      buildImportMessage({
        apiBase: context.apiBase,
        labels: context.importDatasetLabels,
        latestRun: null,
        username: me.username,
        formatDate: context.formatDate,
      }),
    );
  }
}

export async function refreshSession(context, options = {}) {
  try {
    const me = await apiFetch(context.apiBase, "/api/admin/me", { method: "GET" });
    context.setAuthenticatedUI(me);
    if (me.authenticated) {
      void loadLatestImportMessage(context, me);
    }

    if (!me.authenticated && !options.silent) {
      context.setStatus("Συνδεθείτε για να δείτε την ανάλυση πελατών.", "info");
    }

    return me;
  } catch (error) {
    context.setAuthenticatedUI({ authenticated: false });
    if (!options.silent) {
      context.setStatus(`Η σύνδεση με το backend απέτυχε: ${error.message}`, "error");
    }
    return { authenticated: false };
  }
}
