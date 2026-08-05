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
 * Returns null (not a throwing factory) when no base URL is configured, so callers can
 * treat "pricing service not set up" (dev/test, or before SRV2019 deployment) as a
 * distinct, expected case from "pricing service configured but unreachable" - the two
 * must NOT be handled the same way. See order-value-estimate.js.
 */
export function createPricingServiceClient(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) return null;

  const config = {
    baseUrl,
    apiKey: String(options.apiKey || "").trim(),
    timeoutMs: Math.max(Number(options.timeoutMs || 8000), 1000),
  };

  return {
    name: "pricing-service",
    async priceLines(customerCode, items) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

      try {
        const response = await fetch(`${config.baseUrl}/price-lines`, {
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
  };
}
