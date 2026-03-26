# Product Ordering History In Ranked Order Form - Plan

## Goal

Show per-product ordering history in the order form when opened from admin using ranked mode.

## Phase 1 - Extend Ranked Handoff Draft (admin)

Scope:

- site/public/admin-handoff.js

Tasks:

1. In `openRankedOrderForm(context)`, derive a `productHistoryMap` from `context.getSortedProductSales()`.
2. Normalize product code keys (`String(...).trim()`) and order counts (`Number(... || 0)`).
3. Add `productHistoryMap` into the ranking draft payload saved under `ORDER_FORM_RANKING_KEY`.
4. Preserve existing behavior for validation/errors and redirect.

Validation:

- Verify no runtime errors in admin JS via diagnostics.
- Confirm draft JSON in `sessionStorage` includes `productHistoryMap`.

## Phase 2 - Consume And Render History (order form)

Scope:

- site/public/order-form.js
- site/public/styles.css (if styling belongs to shared stylesheet)

Tasks:

1. Load `productHistoryMap` from ranking draft parse path.
2. Thread history value to catalog row rendering path (`createCatalogRow()`).
3. Render history badge/indicator next to code-description cell:
   - Never ordered: explicit visual state.
   - Ordered once/few times: neutral/info state.
   - Ordered multiple times: emphasized positive state.
4. Keep rendering robust for missing history entries (fallback to 0).

Validation:

- Diagnostics for touched files.
- Manual check in ranked flow for customers with and without history.

## Phase 3 - Test And Verify Behavior

Scope:

- Existing frontend tests and quick manual verification

Tasks:

1. Run relevant test subset for admin handoff and order form rendering.
2. Add/update tests if current coverage does not assert history mapping/rendering.
3. Manual pass:
   - Customer with product history (mixed 0/1/many orders).
   - Customer with no product history.
4. Confirm indicators and counts are shown in catalog rows without layout regressions.

Validation:

- Test command output recorded.
- No new diagnostics in modified files.
