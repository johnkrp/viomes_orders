function normalizeOriginList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isLocalNodeEnv(nodeEnv) {
  return ["development", "dev", "local", "test"].includes(String(nodeEnv || "").trim().toLowerCase());
}

export function resolveAllowedCorsOrigins({ nodeEnv, corsAllowedOrigins, port } = {}) {
  const explicitOrigins = normalizeOriginList(corsAllowedOrigins);
  if (explicitOrigins.length) return explicitOrigins;

  if (!isLocalNodeEnv(nodeEnv)) {
    return [];
  }

  const effectivePort = Number(port || 3001);
  const fallbackPorts = new Set([3000, 3001, 4173, 5173, effectivePort]);
  const origins = [];
  for (const host of ["localhost", "127.0.0.1"]) {
    for (const candidatePort of fallbackPorts) {
      origins.push(`http://${host}:${candidatePort}`);
      origins.push(`https://${host}:${candidatePort}`);
    }
  }
  return origins;
}

export function getRequestOrigin(req) {
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const host = String(req?.headers?.host || "").trim();
  if (!host) return "";
  const protocol = forwardedProto || (req?.secure ? "https" : "http");
  return `${protocol}://${host}`;
}

export function isOriginAllowed(origin, allowedOrigins = [], req = null) {
  if (!origin) return true;
  if (req && origin === getRequestOrigin(req)) return true;
  return allowedOrigins.includes(origin);
}

export function buildCorsOriginDelegate({ nodeEnv, corsAllowedOrigins, port } = {}) {
  const allowedOrigins = resolveAllowedCorsOrigins({ nodeEnv, corsAllowedOrigins, port });

  return {
    allowedOrigins,
    origin(origin, req, callback) {
      if (isOriginAllowed(origin, allowedOrigins, req)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS origin not allowed: ${origin}`));
    },
  };
}

export function buildSessionCookieOptions({ secure } = {}) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: Boolean(secure),
    path: "/",
  };
}
