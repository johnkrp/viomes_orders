# site/data/

Runtime reference data read by the Node app but **not** committed to this repo
(it is public, and these files carry customer names + commercial data).

## customer-terms.json

Per-customer ES1 commercial / credit terms shown as read-only cards on the admin
customer analysis page (`customer.terms` on
`GET /api/admin/customers/:code/stats`).

- **Produced by:** `viomes_db/scripts/Export-CustomerTerms.ps1` (weekly), from
  `ESFITradeAccount`. Slow-moving reference data, no live pricing-service call.
- **Deploy:** upload the exported file to `site/data/customer-terms.json` on the
  server (Plesk) after each weekly export. No process restart needed — the store
  re-reads on the next request when the file mtime changes.
- **When absent:** expected on a fresh checkout / before the first upload. The
  cards render "-" and the freshness line stays blank; nothing errors.

Shape:

```json
{
  "generatedAt": "2026-09-10T09:50:03Z",
  "companyCode": "001",
  "source": "queries/customer-terms.sql",
  "count": 1691,
  "customers": {
    "121.1.049": {
      "name": "…",
      "tradeDiscountPct": 35,
      "commercialBalanceLimit": 700000,
      "creditDays": 140,
      "settlementMeansCode": 1,
      "paymentMethodCode": "12080",
      "paymentMethodLabel": "ΕΠΙΤΑΓΗ 120 ΗΜΕΡΩΝ"
    }
  }
}
```
