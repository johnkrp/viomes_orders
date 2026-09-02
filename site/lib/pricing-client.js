// Client for the live on-prem pricing service (viomes_db/pricing-service), which ports
// ES1's actual decoded pricing/discount resolution (see that repo's
// es1-pricing-mechanism-decoded.md) instead of order-value-estimate.js's older
// last-invoiced-price statistical model. Mirrors customer-stats/entersoft-provider.js's
// shape: a small factory over fetch, no framework dependency.

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Returns null (not a throwing factory) when no base URL is configured and no dynamic
 * `urlSource` was given either, so callers can treat "pricing service not set up"
 * (dev/test, or before deployment) as a distinct, expected case from "pricing service
 * configured but unreachable" - the two must NOT be handled the same way. See
 * order-value-estimate.js.
 *
 * `options.urlSource`, when given (see pricing-url-source.js), is an object with an
 * async `getUrl()` re-resolved on every call instead of a `baseUrl` fixed at
 * construction time - this is what lets the live process pick up a changed pricing
 * service URL without a restart. When the resolved URL is currently empty (file not
 * written yet, tunnel not up), `priceLines` throws an error tagged
 * `code: "PRICING_NOT_CONFIGURED"` rather than attempting a request - callers use that
 * to fall back to the heuristic estimate exactly as they would for a null client.
 */
export function createPricingServiceClient(options = {}) {
  const urlSource = options.urlSource || null;
  const staticBaseUrl = normalizeBaseUrl(options.baseUrl);
  if (!urlSource && !staticBaseUrl) return null;

  const config = {
    apiKey: String(options.apiKey || "").trim(),
    timeoutMs: Math.max(Number(options.timeoutMs || 8000), 1000),
  };

  async function resolveBaseUrl() {
    if (urlSource) return normalizeBaseUrl(await urlSource.getUrl());
    return staticBaseUrl;
  }

  return {
    name: "pricing-service",
    async isConfigured() {
      return Boolean(await resolveBaseUrl());
    },
    async priceLines(customerCode, items) {
      const baseUrl = await resolveBaseUrl();
      if (!baseUrl) {
        const error = new Error("Pricing service is not currently configured.");
        error.code = "PRICING_NOT_CONFIGURED";
        throw error;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const response = await fetch(`${baseUrl}/price-lines`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Pricing-Api-Key": config.apiKey,
          },
          body: JSON.stringify({
            customerCode,
            lines: items.map((item) => ({ itemCode: item.code, qty: item.qty })),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = `Pricing service responded with HTTP ${response.status}`;
          try {
            const payload = await response.json();
            detail = payload?.detail || payload?.error || detail;
          } catch {
            // Keep the generic message when the upstream body is not JSON.
          }
          const error = new Error(detail);
          error.status = 502;
          throw error;
        }

        const payload = await response.json();
        if (!Array.isArray(payload?.lines)) {
          const error = new Error(
            "Pricing service returned an unexpected payload shape (missing lines[]).",
          );
          error.status = 502;
          throw error;
        }

        return payload.lines;
      } catch (error) {
        if (error?.status) throw error;
        if (error?.name === "AbortError") {
          const timeoutError = new Error(
            `Pricing service timed out after ${config.timeoutMs}ms.`,
          );
          timeoutError.status = 504;
          throw timeoutError;
        }
        const wrapped = new Error(
          `Pricing service request failed: ${error.message || String(error)}`,
        );
        wrapped.status = 502;
        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    },

    /**
     * Current stock ("Απόθεμα") for a batch of item codes, for the order form's catalog
     * column. Same guards as priceLines: throws `code: "PRICING_NOT_CONFIGURED"` when the
     * resolved URL is empty (dev/test, tunnel down), and `status`-tagged errors on
     * non-2xx / timeout / bad shape. Returns `payload.levels` (an array of
     * `{ itemCode, available, onHand101, onHandCompany, isMixedContent, fulfillmentCode }`;
     * unknown codes are simply absent). The caller degrades the column to "—" on any throw.
     */
    async stockLevels(itemCodes) {
      const baseUrl = await resolveBaseUrl();
      if (!baseUrl) {
        const error = new Error("Pricing service is not currently configured.");
        error.code = "PRICING_NOT_CONFIGURED";
        throw error;
      }

      const codes = [
        ...new Set((itemCodes || []).map((c) => String(c || "").trim()).filter(Boolean)),
      ];
      if (codes.length === 0) return [];

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const response = await fetch(`${baseUrl}/stock-levels`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Pricing-Api-Key": config.apiKey,
          },
          body: JSON.stringify({ itemCodes: codes }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let detail = `Pricing service responded with HTTP ${response.status}`;
          try {
            const payload = await response.json();
            detail = payload?.detail || payload?.error || detail;
          } catch {
            // Keep the generic message when the upstream body is not JSON.
          }
          const error = new Error(detail);
          error.status = 502;
          throw error;
        }

        const payload = await response.json();
        if (!Array.isArray(payload?.levels)) {
          const error = new Error(
            "Pricing service returned an unexpected payload shape (missing levels[]).",
          );
          error.status = 502;
          throw error;
        }

        return payload.levels;
      } catch (error) {
        if (error?.status) throw error;
        if (error?.name === "AbortError") {
          const timeoutError = new Error(
            `Pricing service timed out after ${config.timeoutMs}ms.`,
          );
          timeoutError.status = 504;
          throw timeoutError;
        }
        const wrapped = new Error(
          `Pricing service request failed: ${error.message || String(error)}`,
        );
        wrapped.status = 502;
        throw wrapped;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
