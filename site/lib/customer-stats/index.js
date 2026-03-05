import { createEntersoftCustomerStatsProvider } from "./entersoft-provider.js";
import { createSqliteCustomerStatsProvider } from "./sqlite-provider.js";

export function createCustomerStatsProvider({ db, sqlDialect = "sqlite", env = process.env } = {}) {
  const providerName = String(env.CUSTOMER_STATS_PROVIDER || "sqlite")
    .trim()
    .toLowerCase();

  if (providerName === "sqlite") {
    return createSqliteCustomerStatsProvider({ db, sqlDialect });
  }

  if (providerName === "entersoft") {
    return createEntersoftCustomerStatsProvider({
      baseUrl: env.ENTERSOFT_BASE_URL,
      pathTemplate: env.ENTERSOFT_CUSTOMER_STATS_PATH,
      responseShape: env.ENTERSOFT_RESPONSE_SHAPE,
      timeoutMs: env.ENTERSOFT_TIMEOUT_MS,
      apiKey: env.ENTERSOFT_API_KEY,
      apiKeyHeader: env.ENTERSOFT_API_KEY_HEADER,
      bearerToken: env.ENTERSOFT_BEARER_TOKEN,
      username: env.ENTERSOFT_USERNAME,
      password: env.ENTERSOFT_PASSWORD,
    });
  }

  throw new Error(
    `Unsupported CUSTOMER_STATS_PROVIDER "${providerName}". Expected "sqlite" or "entersoft".`,
  );
}
