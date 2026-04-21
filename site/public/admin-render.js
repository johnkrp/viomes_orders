import {
  MONTH_LABELS,
  OPEN_ORDERS_PAGE_SIZE,
  PRE_APPROVAL_ORDERS_PAGE_SIZE,
  PRODUCT_SALES_PAGE_SIZE,
  RECEIVABLES_PAGE_SIZE,
  RECENT_ORDERS_PAGE_SIZE,
} from "./admin-constants.js";
import {
  filterProductItems,
  getOpenOrdersForTable,
  getPreApprovalOrdersForTable,
  getRecentOrdersForTable,
  getSortedProductSalesForTable,
} from "./admin-tables.js";
import {
  escapeHtml,
  formatDate,
  formatDays,
  formatMoney,
  formatNumber,
  formatPercentRoundedUp,
  numberStateClass,
  updateSortIndicators,
} from "./admin-utils.js";

export function resetProductSales(context) {
  context.state.currentProductSales = [];
  context.state.currentProductSalesPage = 1;
  if (context.elements.productSalesMetric)
    context.elements.productSalesMetric.value = "revenue";
  if (context.elements.productSalesMetricHeading)
    context.elements.productSalesMetricHeading.textContent = "Τζίρος";
  if (context.elements.productSalesSecondaryMetricHeading)
    context.elements.productSalesSecondaryMetricHeading.textContent = "Τεμάχια";
  if (context.elements.productSalesPagination)
    context.elements.productSalesPagination.hidden = true;
  if (context.elements.productSalesPageInfo)
    context.elements.productSalesPageInfo.textContent = "Σελίδα 1 από 1";
  if (context.elements.productSalesPrevBtn)
    context.elements.productSalesPrevBtn.disabled = true;
  if (context.elements.productSalesNextBtn)
    context.elements.productSalesNextBtn.disabled = true;
  updateSortIndicators("product-sales", context.state.productSalesSort);
  if (context.elements.productSalesBody) {
    context.elements.productSalesBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη οι πωλήσεις ειδών.</td>
      </tr>
    `;
  }
}

export function resetSearchResults(context) {
  context.state.currentSearchResults = [];
  if (context.elements.searchResultsPanel)
    context.elements.searchResultsPanel.hidden = true;
  context.elements.searchResultsPanel?.classList.remove("is-loading");
  context.renderLoadingNotice(context.elements.searchLoadingNotice, false, "");
  if (context.elements.searchResultsBody) {
    context.elements.searchResultsBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη αποτελέσματα.</td>
      </tr>
    `;
  }
}

export function resetSearchSuggestions() {
  return;
}

export function resetBranchSelector(context) {
  context.state.currentCustomerCode = null;
  context.state.currentBranchCode = "";
  context.state.currentAvailableBranches = [];
  if (context.elements.branchSelectorPanel)
    context.elements.branchSelectorPanel.hidden = true;
  if (context.elements.branchSelectorSearch) {
    context.elements.branchSelectorSearch.value = "";
    context.elements.branchSelectorSearch.disabled = true;
  }
  if (context.elements.branchSelector) {
    context.elements.branchSelector.innerHTML = `<option value="">Όλα τα υποκαταστήματα</option>`;
    context.elements.branchSelector.value = "";
  }
}

export function getBranchOptionLabel(branch) {
  const code = branch?.branch_code || "";
  const description = branch?.branch_description || "";
  return (
    [code, description].filter(Boolean).join(" | ") ||
    "Χωρίς στοιχεία υποκαταστήματος"
  );
}

export function renderFilteredBranchOptions(
  context,
  branches,
  selectedBranchCode = "",
) {
  const items = Array.isArray(branches) ? branches : [];
  if (!context.elements.branchSelector) return;

  context.elements.branchSelector.innerHTML = [
    `<option value="">Όλα τα υποκαταστήματα</option>`,
    ...items.map((branch) => {
      const code = branch.branch_code || "";
      return `<option value="${escapeHtml(code)}">${escapeHtml(getBranchOptionLabel(branch))}</option>`;
    }),
  ].join("");

  const desiredValue = selectedBranchCode || "";
  const hasDesiredOption =
    desiredValue === "" ||
    items.some((branch) => (branch.branch_code || "") === desiredValue);
  context.elements.branchSelector.value = hasDesiredOption ? desiredValue : "";
}

export function renderBranchSelector(
  context,
  customerCode,
  branches = [],
  selectedBranchCode = "",
) {
  context.state.currentCustomerCode = customerCode || null;
  context.state.currentBranchCode = selectedBranchCode || "";
  const isStatsLoading =
    context.elements.statsPanel?.getAttribute("aria-busy") === "true";
  const items = Array.isArray(branches) ? branches : [];

  context.state.currentAvailableBranches = items;
  if (!customerCode || items.length <= 1) {
    context.elements.branchSelectorPanel.hidden = true;
    if (context.elements.branchSelectorSearch) {
      context.elements.branchSelectorSearch.value = "";
      context.elements.branchSelectorSearch.disabled = true;
    }
    renderFilteredBranchOptions(context, [], "");
    return;
  }

  context.elements.branchSelectorPanel.hidden = false;
  if (context.elements.branchSelectorSearch) {
    context.elements.branchSelectorSearch.disabled = Boolean(isStatsLoading);
    context.elements.branchSelectorSearch.value = "";
  }
  renderFilteredBranchOptions(context, items, selectedBranchCode);
  context.elements.branchSelector.disabled = Boolean(isStatsLoading);
}

export function renderSearchResults(context, items, filters = {}) {
  context.state.currentSearchResults = Array.isArray(items) ? items : [];
  if (context.elements.searchResultsPanel)
    context.elements.searchResultsPanel.hidden = false;
  const isStatsLoading =
    context.elements.statsPanel?.getAttribute("aria-busy") === "true";
  const activeFilters = Object.values(filters || {})
    .filter(Boolean)
    .join(" | ");

  context.elements.searchResultsBody.innerHTML = context.state
    .currentSearchResults.length
    ? context.state.currentSearchResults
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.name)}</td>
              <td>${escapeHtml(item.branch_description || "-")}</td>
              <td>
                <button
                  type="button"
                  class="btn ghost admin-result-select"
                  data-customer-code="${escapeHtml(item.code)}"
                  ${isStatsLoading ? "disabled" : ""}
                >
                  Επιλογή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="4" class="admin-table-empty">Δεν βρέθηκαν πελάτες${activeFilters ? ` για "${escapeHtml(activeFilters)}"` : ""}.</td>
        </tr>
      `;
}

export function renderSelectedOrderDetails(context) {
  const selectedOrder = context.findDetailedOrder(
    context.state.selectedOrderId,
  );
  if (!selectedOrder) {
    context.elements.detailedOrdersList.innerHTML = `
      <article class="admin-order-card admin-order-empty">
        Επιλέξτε παραγγελία για να δείτε την αναλυτική ανάλυση.
      </article>
    `;
    return;
  }

  const linesHtml =
    Array.isArray(selectedOrder.lines) && selectedOrder.lines.length
      ? selectedOrder.lines
          .map((line) => {
            return `
            <tr>
              <td>${escapeHtml(line.code)}</td>
              <td>${escapeHtml(line.description)}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(line.qty))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(line.unit_price))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(line.discount_pct))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(line.line_net_value))}</td>
            </tr>
          `;
          })
          .join("")
      : `
        <tr>
          <td colspan="6" class="admin-table-empty">Η παραγγελία δεν έχει γραμμές ειδών.</td>
        </tr>
      `;

  const orderMetaParts = [];
  if (selectedOrder.branch_code) {
    orderMetaParts.push(`Υποκατάστημα: ${selectedOrder.branch_code}`);
  }
  if (selectedOrder.branch_description) {
    orderMetaParts.push(selectedOrder.branch_description);
  }
  if (selectedOrder.document_type) {
    orderMetaParts.push(`Τύπος: ${selectedOrder.document_type}`);
  }

  context.elements.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-card-active">
      <div class="admin-order-head">
        <div>
          <h3>${escapeHtml(context.formatDisplayOrderId(selectedOrder.order_id))}</h3>
          <p class="admin-panel-note">Παραγγελία: ${escapeHtml(formatDate(selectedOrder.ordered_at || selectedOrder.created_at))} | Τιμολόγιο: ${escapeHtml(formatDate(selectedOrder.created_at))}</p>
          ${orderMetaParts.length ? `<p class="admin-panel-note">${escapeHtml(orderMetaParts.join(" | "))}</p>` : ""}
        </div>
        <div class="admin-order-summary">
          <strong>${escapeHtml(formatMoney(selectedOrder.total_net_value))}</strong>
          <button type="button" class="btn ghost" data-open-order-form="${escapeHtml(selectedOrder.order_id)}">
            Άνοιγμα στη φόρμα παραγγελίας
          </button>
        </div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Κωδικός</th>
              <th>Περιγραφή</th>
              <th class="admin-table-number">Τεμάχια</th>
              <th class="admin-table-number">Τιμή μονάδας</th>
              <th class="admin-table-number">Έκπτωση</th>
              <th class="admin-table-number">Καθαρή αξία</th>
            </tr>
          </thead>
          <tbody>${linesHtml}</tbody>
        </table>
      </div>
    </article>
  `;
}

export function resetMonthlySales(context) {
  const currentYear = new Date().getUTCFullYear();
  if (context.elements.monthlyYearOneHeading)
    context.elements.monthlyYearOneHeading.textContent = String(
      currentYear - 2,
    );
  if (context.elements.monthlyYearTwoHeading)
    context.elements.monthlyYearTwoHeading.textContent = String(
      currentYear - 1,
    );
  if (context.elements.monthlyYearThreeHeading)
    context.elements.monthlyYearThreeHeading.textContent = String(currentYear);
  if (context.elements.monthlySalesBody) {
    context.elements.monthlySalesBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν έχουν φορτωθεί ακόμη οι μηνιαίες πωλήσεις.</td>
      </tr>
    `;
  }
  if (context.elements.monthlySalesFoot) {
    context.elements.monthlySalesFoot.innerHTML = `
      <tr>
        <td>Σύνολο</td>
        <td class="admin-table-number">-</td>
        <td class="admin-table-number">-</td>
        <td class="admin-table-number">-</td>
        <td class="admin-table-number admin-monthly-total-cell">-</td>
      </tr>
    `;
  }
}

export function renderMonthlySales(context, monthlySales) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const yearlySeries =
    Array.isArray(monthlySales?.yearly_series) &&
    monthlySales.yearly_series.length
      ? monthlySales.yearly_series
      : [
          { year: currentYear - 2, months: [] },
          { year: currentYear - 1, months: monthlySales?.previous_year || [] },
          { year: currentYear, months: monthlySales?.current_year || [] },
        ];
  const displaySeries = [...yearlySeries]
    .sort((a, b) => Number(a.year || 0) - Number(b.year || 0))
    .slice(-3);
  const rows = [];
  const yearlyTotals = displaySeries.map(() => 0);

  for (let month = 1; month <= 12; month += 1) {
    const revenues = displaySeries.map((entry, index) => {
      const row =
        (Array.isArray(entry.months) ? entry.months : []).find(
          (candidate) => Number(candidate.month) === month,
        ) || {};
      const revenue = Number(row.revenue || 0);
      yearlyTotals[index] += revenue;
      return revenue;
    });
    const totalRevenue = revenues.reduce((sum, value) => sum + value, 0);
    const revenueCells = revenues
      .map(
        (revenue) =>
          `<td class="admin-table-number${numberStateClass(revenue)}">${escapeHtml(formatMoney(revenue))}</td>`,
      )
      .join("");

    rows.push(`
      <tr>
        <td>${MONTH_LABELS[month - 1]}</td>
        ${revenueCells}
        <td class="admin-table-number admin-monthly-total-cell${numberStateClass(totalRevenue)}">${escapeHtml(formatMoney(totalRevenue))}</td>
      </tr>
    `);
  }

  if (context.elements.monthlyYearOneHeading)
    context.elements.monthlyYearOneHeading.textContent = String(
      displaySeries[0]?.year || currentYear - 2,
    );
  if (context.elements.monthlyYearTwoHeading)
    context.elements.monthlyYearTwoHeading.textContent = String(
      displaySeries[1]?.year || currentYear - 1,
    );
  if (context.elements.monthlyYearThreeHeading)
    context.elements.monthlyYearThreeHeading.textContent = String(
      displaySeries[2]?.year || currentYear,
    );
  context.elements.monthlySalesBody.innerHTML = rows.join("");
  if (context.elements.monthlySalesFoot) {
    const totalCells = yearlyTotals
      .map(
        (value) =>
          `<td class="admin-table-number${numberStateClass(value)}">${escapeHtml(formatMoney(value))}</td>`,
      )
      .join("");
    const grandTotal = yearlyTotals.reduce((sum, value) => sum + value, 0);
    context.elements.monthlySalesFoot.innerHTML = `
      <tr>
        <td>Total</td>
        ${totalCells}
        <td class="admin-table-number admin-monthly-total-cell${numberStateClass(grandTotal)}">${escapeHtml(formatMoney(grandTotal))}</td>
      </tr>
    `;
  }
}

export function resetReceivables(context) {
  if (context.elements.receivablesPanel)
    context.elements.receivablesPanel.hidden = false;
  if (context.elements.receivablesOpenValue)
    context.elements.receivablesOpenValue.textContent = "-";
  if (context.elements.receivablesBody) {
    context.elements.receivablesBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-table-empty">Δεν έχει φορτωθεί ακόμη snapshot υπολοίπων.</td>
      </tr>
    `;
  }
}

export function renderReceivablesTable(context) {
  const receivablesHeadRow = document.querySelector(
    "#receivablesPanel thead tr",
  );
  if (receivablesHeadRow) {
    receivablesHeadRow.innerHTML = `
      <th>Ημερομηνία</th>
      <th>Παραστατικό</th>
      <th>Αιτιολογία</th>
      <th class="admin-table-number">Χρέωση</th>
      <th class="admin-table-number">Πίστωση</th>
    `;
  }
  const totalPages = Math.max(
    1,
    Math.ceil(context.state.currentReceivables.length / RECEIVABLES_PAGE_SIZE),
  );
  context.state.currentReceivablesPage = Math.min(
    context.state.currentReceivablesPage,
    totalPages,
  );
  const start =
    (context.state.currentReceivablesPage - 1) * RECEIVABLES_PAGE_SIZE;
  const pageItems = context.state.currentReceivables.slice(
    start,
    start + RECEIVABLES_PAGE_SIZE,
  );

  context.elements.receivablesBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(formatDate(item.document_date))}</td>
              <td>${escapeHtml(item.document_no)}</td>
              <td>${escapeHtml(item.reason || "-")}</td>
              <td>${escapeHtml(formatMoney(item.debit))}</td>
              <td>${escapeHtml(formatMoney(item.credit))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν υπάρχουν κινήσεις καρτέλας για αυτόν τον πελάτη.</td>
        </tr>
      `;

  if (context.elements.receivablesPagination)
    context.elements.receivablesPagination.hidden =
      !context.state.currentReceivables.length;
  if (context.elements.receivablesPageInfo) {
    context.elements.receivablesPageInfo.textContent = context.state
      .currentReceivables.length
      ? `Σελίδα ${context.state.currentReceivablesPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (context.elements.receivablesPrevBtn)
    context.elements.receivablesPrevBtn.disabled =
      context.state.currentReceivablesPage <= 1;
  if (context.elements.receivablesNextBtn)
    context.elements.receivablesNextBtn.disabled =
      context.state.currentReceivablesPage >= totalPages;
}

export function renderReceivables(context, receivables) {
  context.state.currentReceivables = Array.isArray(receivables?.items)
    ? receivables.items
    : [];
  context.state.currentReceivablesPage = 1;
  context.elements.receivablesOpenValue.textContent = formatMoney(
    receivables?.open_balance,
  );
  renderReceivablesTable(context);
}

export function renderProductSales(context) {
  const metric =
    context.elements.productSalesMetric?.value === "pieces"
      ? "pieces"
      : "revenue";
  const secondaryMetric = metric === "pieces" ? "revenue" : "pieces";
  const sortedItems = filterProductItems(
    getSortedProductSalesForTable(context),
    context.state.currentProductSalesFilters,
  );

  if (context.elements.productSalesMetricHeading) {
    context.elements.productSalesMetricHeading.textContent =
      metric === "pieces" ? "Τεμάχια" : "Τζίρος";
  }
  if (context.elements.productSalesSecondaryMetricHeading) {
    context.elements.productSalesSecondaryMetricHeading.textContent =
      secondaryMetric === "pieces" ? "Τεμάχια" : "Τζίρος";
  }

  const totalPages = Math.max(
    1,
    Math.ceil(sortedItems.length / PRODUCT_SALES_PAGE_SIZE),
  );
  context.state.currentProductSalesPage = Math.min(
    context.state.currentProductSalesPage,
    totalPages,
  );
  const start =
    (context.state.currentProductSalesPage - 1) * PRODUCT_SALES_PAGE_SIZE;
  const pageItems = sortedItems.slice(start, start + PRODUCT_SALES_PAGE_SIZE);

  context.elements.productSalesBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const metricValue =
            metric === "pieces"
              ? formatNumber(item.pieces)
              : formatMoney(item.revenue);
          const secondaryMetricValue =
            secondaryMetric === "pieces"
              ? formatNumber(item.pieces)
              : formatMoney(item.revenue);
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(metricValue)}</td>
              <td class="admin-table-number">${escapeHtml(secondaryMetricValue)}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.orders))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.avg_unit_price))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="6" class="admin-table-empty">Δεν υπάρχουν διαθέσιμες πωλήσεις ειδών για την τρέχουσα επιλογή.</td>
        </tr>
      `;

  if (context.elements.productSalesPagination)
    context.elements.productSalesPagination.hidden = !sortedItems.length;
  if (context.elements.productSalesPageInfo) {
    context.elements.productSalesPageInfo.textContent = sortedItems.length
      ? `Σελίδα ${context.state.currentProductSalesPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (context.elements.productSalesPrevBtn)
    context.elements.productSalesPrevBtn.disabled =
      context.state.currentProductSalesPage <= 1;
  if (context.elements.productSalesNextBtn)
    context.elements.productSalesNextBtn.disabled =
      context.state.currentProductSalesPage >= totalPages;
  updateSortIndicators("product-sales", context.state.productSalesSort);
}

export function renderTopProductsQty(context) {
  if (!context.elements.topProductsQtyBody) return;
  const filteredItems = context.state.currentTopProductsByQty;
  context.elements.topProductsQtyBody.innerHTML = filteredItems.length
    ? filteredItems
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.qty))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.orders))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.revenue))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν κορυφαία είδη ανά τεμάχια.</td>
        </tr>
      `;
}

export function renderTopProductsValue(context) {
  if (!context.elements.topProductsValueBody) return;
  const filteredItems = context.state.currentTopProductsByValue;
  context.elements.topProductsValueBody.innerHTML = filteredItems.length
    ? filteredItems
        .map((item) => {
          return `
            <tr>
              <td>${escapeHtml(item.code)}</td>
              <td>${escapeHtml(item.description)}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.revenue))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.qty))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.avg_unit_price))}</td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="5" class="admin-table-empty">Δεν βρέθηκαν κορυφαία είδη ανά τζίρο.</td>
        </tr>
      `;
}

export function renderRecentOrdersTable(context) {
  const recentOrders = getRecentOrdersForTable(context);
  const totalPages = Math.max(
    1,
    Math.ceil(recentOrders.length / RECENT_ORDERS_PAGE_SIZE),
  );
  context.state.currentRecentOrdersPage = Math.min(
    context.state.currentRecentOrdersPage,
    totalPages,
  );
  const start =
    (context.state.currentRecentOrdersPage - 1) * RECENT_ORDERS_PAGE_SIZE;
  const pageItems = recentOrders.slice(start, start + RECENT_ORDERS_PAGE_SIZE);

  context.elements.recentOrdersBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const isActive =
            String(context.state.selectedOrderId || "") ===
            String(item.order_id || "");
          return `
            <tr>
              <td>${escapeHtml(context.formatDisplayOrderId(item.order_id))}</td>
              <td>${escapeHtml(formatDate(item.ordered_at || item.created_at))}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td>${escapeHtml(item.progress_step || "-")}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(item.average_discount_pct))}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select${isActive ? " is-active" : ""}"
                  data-order-id="${escapeHtml(item.order_id)}"
                >
                  Προβολή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="9" class="admin-table-empty">Δεν βρέθηκαν πρόσφατες εκτελεσμένες παραγγελίες.</td>
        </tr>
      `;

  if (context.elements.recentOrdersPagination)
    context.elements.recentOrdersPagination.hidden = !recentOrders.length;
  if (context.elements.recentOrdersPageInfo) {
    context.elements.recentOrdersPageInfo.textContent = recentOrders.length
      ? `Σελίδα ${context.state.currentRecentOrdersPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (context.elements.recentOrdersPrevBtn)
    context.elements.recentOrdersPrevBtn.disabled =
      context.state.currentRecentOrdersPage <= 1;
  if (context.elements.recentOrdersNextBtn)
    context.elements.recentOrdersNextBtn.disabled =
      context.state.currentRecentOrdersPage >= totalPages;
  updateSortIndicators("recent", context.state.recentOrdersSort);
}

export function renderPreApprovalOrdersTable(context) {
  const preApprovalOrders = getPreApprovalOrdersForTable(context);
  const totalPages = Math.max(
    1,
    Math.ceil(preApprovalOrders.length / PRE_APPROVAL_ORDERS_PAGE_SIZE),
  );
  context.state.currentPreApprovalOrdersPage = Math.min(
    context.state.currentPreApprovalOrdersPage,
    totalPages,
  );
  const start =
    (context.state.currentPreApprovalOrdersPage - 1) *
    PRE_APPROVAL_ORDERS_PAGE_SIZE;
  const pageItems = preApprovalOrders.slice(
    start,
    start + PRE_APPROVAL_ORDERS_PAGE_SIZE,
  );

  context.elements.preApprovalOrdersBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const isActive =
            String(context.state.selectedOrderId || "") ===
            String(item.order_id || "");
          return `
            <tr>
              <td>${escapeHtml(context.formatDisplayOrderId(item.order_id))}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td>${escapeHtml(item.progress_step || "-")}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(item.average_discount_pct))}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select${isActive ? " is-active" : ""}"
                  data-order-id="${escapeHtml(item.order_id)}"
                >
                  Προβολή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="8" class="admin-table-empty">Δεν βρέθηκαν παραγγελίες προς έγκριση.</td>
        </tr>
      `;

  updateSortIndicators("pre-approval", context.state.preApprovalOrdersSort);
  if (context.elements.preApprovalOrdersPagination)
    context.elements.preApprovalOrdersPagination.hidden =
      !preApprovalOrders.length;
  if (context.elements.preApprovalOrdersPageInfo) {
    context.elements.preApprovalOrdersPageInfo.textContent =
      preApprovalOrders.length
        ? `Σελίδα ${context.state.currentPreApprovalOrdersPage} από ${totalPages}`
        : "Σελίδα 1 από 1";
  }
  if (context.elements.preApprovalOrdersPrevBtn)
    context.elements.preApprovalOrdersPrevBtn.disabled =
      context.state.currentPreApprovalOrdersPage <= 1;
  if (context.elements.preApprovalOrdersNextBtn)
    context.elements.preApprovalOrdersNextBtn.disabled =
      context.state.currentPreApprovalOrdersPage >= totalPages;
}

export function renderOpenOrdersTable(context) {
  const openOrders = getOpenOrdersForTable(context);
  const totalPages = Math.max(
    1,
    Math.ceil(openOrders.length / OPEN_ORDERS_PAGE_SIZE),
  );
  context.state.currentOpenOrdersPage = Math.min(
    context.state.currentOpenOrdersPage,
    totalPages,
  );
  const start =
    (context.state.currentOpenOrdersPage - 1) * OPEN_ORDERS_PAGE_SIZE;
  const pageItems = openOrders.slice(start, start + OPEN_ORDERS_PAGE_SIZE);

  context.elements.openOrdersBody.innerHTML = pageItems.length
    ? pageItems
        .map((item) => {
          const isActive =
            String(context.state.selectedOrderId || "") ===
            String(item.order_id || "");
          return `
            <tr>
              <td>${escapeHtml(context.formatDisplayOrderId(item.order_id))}</td>
              <td>${escapeHtml(formatDate(item.created_at))}</td>
              <td>${escapeHtml(item.progress_step || "-")}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_lines))}</td>
              <td class="admin-table-number">${escapeHtml(formatNumber(item.total_pieces))}</td>
              <td class="admin-table-number">${escapeHtml(formatMoney(item.total_net_value))}</td>
              <td class="admin-table-number">${escapeHtml(formatPercentRoundedUp(item.average_discount_pct))}</td>
              <td class="admin-table-action">
                <button
                  type="button"
                  class="btn ghost admin-order-select${isActive ? " is-active" : ""}"
                  data-order-id="${escapeHtml(item.order_id)}"
                >
                  Προβολή
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `
        <tr>
          <td colspan="8" class="admin-table-empty">Δεν βρέθηκαν παραγγελίες προς εκτέλεση.</td>
        </tr>
      `;

  updateSortIndicators("open", context.state.openOrdersSort);
  if (context.elements.openOrdersPagination)
    context.elements.openOrdersPagination.hidden = !openOrders.length;
  if (context.elements.openOrdersPageInfo) {
    context.elements.openOrdersPageInfo.textContent = openOrders.length
      ? `Σελίδα ${context.state.currentOpenOrdersPage} από ${totalPages}`
      : "Σελίδα 1 από 1";
  }
  if (context.elements.openOrdersPrevBtn)
    context.elements.openOrdersPrevBtn.disabled =
      context.state.currentOpenOrdersPage <= 1;
  if (context.elements.openOrdersNextBtn)
    context.elements.openOrdersNextBtn.disabled =
      context.state.currentOpenOrdersPage >= totalPages;
}

export function resetStats(context) {
  void context.setStatsLoading(false);
  context.state.lastRenderedStatsPayload = null;
  resetBranchSelector(context);
  context.state.currentSalesTimeRange = context.getSelectedSalesTimeRange();
  context.state.allRangeDetailedOrders = [];
  context.state.allRangeStatsKey = "";
  context.state.rangeSummaryCache.clear();
  context.state.rangeSummaryPending.clear();
  context.elements.customerNameHeading.textContent = "Πελάτης";
  context.elements.customerMeta.textContent = "-";
  if (context.elements.totalOrdersValue)
    context.elements.totalOrdersValue.textContent = "0";
  context.elements.totalPiecesValue.textContent = "0";
  context.elements.totalRevenueValue.textContent = "-";
  if (context.elements.activeDocumentsValue)
    context.elements.activeDocumentsValue.textContent = "0";
  context.elements.averageOrderValue.textContent = "-";
  if (context.elements.daysSinceLastOrderValue)
    context.elements.daysSinceLastOrderValue.textContent = "-";
  context.elements.averageDaysBetweenOrdersValue.textContent = "-";
  context.elements.acceptedOrdersValue.textContent = "-";
  context.elements.inProgressOrdersValue.textContent = "-";
  context.elements.invoicedOrdersValue.textContent = "-";
  if (context.elements.lastOrderDateValue)
    context.elements.lastOrderDateValue.textContent = "-";
  resetMonthlySales(context);
  resetReceivables(context);
  resetProductSales(context);
  context.resetProductTableFilters();
  context.state.currentTopProductsByQty = [];
  context.state.currentTopProductsByValue = [];
  if (context.elements.topProductsQtyBody) {
    context.elements.topProductsQtyBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  if (context.elements.topProductsValueBody) {
    context.elements.topProductsValueBody.innerHTML = `
      <tr>
        <td colspan="5" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  const recentOrdersHeadRow = document.querySelector(
    ".admin-recent-orders-table thead tr",
  );
  if (recentOrdersHeadRow) {
    recentOrdersHeadRow.innerHTML = `
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="order_id">ID <span class="admin-sort-indicator">↕</span></button></th>
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="ordered_at">Ημερομηνία παραγγελίας <span class="admin-sort-indicator">↕</span></button></th>
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="created_at">Ημερομηνία τιμολογίου <span class="admin-sort-indicator">↕</span></button></th>
      <th><button type="button" class="admin-sort-btn" data-table-sort="recent" data-sort-key="progress_step">Βήμα εξέλιξης <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="total_lines">Γραμμές <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="total_pieces">Τεμάχια <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="total_net_value">Αξία <span class="admin-sort-indicator">↕</span></button></th>
      <th class="admin-table-number"><button type="button" class="admin-sort-btn admin-sort-btn-number" data-table-sort="recent" data-sort-key="average_discount_pct">Μέση έκπτωση <span class="admin-sort-indicator">↕</span></button></th>
      <th>Ενέργεια</th>
    `;
  }
  context.elements.recentOrdersBody.innerHTML = `
    <tr>
      <td colspan="9" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
    </tr>
  `;
  context.state.currentRecentOrdersPage = 1;
  context.state.currentOpenOrdersPage = 1;
  context.state.currentPreApprovalOrdersPage = 1;
  if (context.elements.recentOrdersPagination)
    context.elements.recentOrdersPagination.hidden = true;
  if (context.elements.recentOrdersPageInfo)
    context.elements.recentOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  if (context.elements.openOrdersBody) {
    context.elements.openOrdersBody.innerHTML = `
      <tr>
        <td colspan="7" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  if (context.elements.openOrdersPagination)
    context.elements.openOrdersPagination.hidden = true;
  if (context.elements.openOrdersPageInfo)
    context.elements.openOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  if (context.elements.preApprovalOrdersBody) {
    context.elements.preApprovalOrdersBody.innerHTML = `
      <tr>
        <td colspan="7" class="admin-table-empty">Δεν υπάρχουν ακόμη δεδομένα.</td>
      </tr>
    `;
  }
  if (context.elements.preApprovalOrdersPagination)
    context.elements.preApprovalOrdersPagination.hidden = true;
  if (context.elements.preApprovalOrdersPageInfo)
    context.elements.preApprovalOrdersPageInfo.textContent = "Σελίδα 1 από 1";
  if (context.elements.openRankedOrderFormBtn)
    context.elements.openRankedOrderFormBtn.disabled = true;
  context.state.currentDetailedOrders = [];
  context.state.currentDetailedOpenOrders = [];
  context.state.currentDetailedPreApprovalOrders = [];
  context.state.currentOpenOrders = [];
  context.state.currentPreApprovalOrders = [];
  context.state.recentOrdersSort = { key: "created_at", direction: "desc" };
  context.state.productSalesSort = { key: "primary_metric", direction: "desc" };
  context.state.openOrdersSort = { key: "created_at", direction: "desc" };
  context.state.preApprovalOrdersSort = {
    key: "created_at",
    direction: "desc",
  };
  updateSortIndicators("recent", context.state.recentOrdersSort);
  updateSortIndicators("product-sales", context.state.productSalesSort);
  updateSortIndicators("open", context.state.openOrdersSort);
  updateSortIndicators("pre-approval", context.state.preApprovalOrdersSort);
  context.state.selectedOrderId = null;
  context.elements.detailedOrdersList.innerHTML = `
    <article class="admin-order-card admin-order-empty">
      Επιλέξτε παραγγελία για να δείτε την αναλυτική ανάλυση.
    </article>
  `;
  context.elements.emptyState.hidden = false;
  context.elements.statsPanel.hidden = true;
}

export function renderStats(context, data) {
  const customer = data?.customer || {};
  const summary = data?.summary || {};
  const monthlySales = data?.monthly_sales || {};
  const productSales = data?.product_sales || {};
  const receivables = data?.receivables || {};
  const availableBranches = Array.isArray(data?.available_branches)
    ? data.available_branches
    : [];
  const topProductsByQty = Array.isArray(data?.top_products_by_qty)
    ? data.top_products_by_qty
    : [];
  const topProductsByValue = Array.isArray(data?.top_products_by_value)
    ? data.top_products_by_value
    : [];
  const openOrders = Array.isArray(data?.open_orders) ? data.open_orders : [];
  const preApprovalOrders = Array.isArray(data?.pre_approval_orders)
    ? data.pre_approval_orders
    : [];
  const detailedOrders = Array.isArray(data?.detailed_orders)
    ? data.detailed_orders
    : [];
  const detailedOpenOrders = Array.isArray(data?.detailed_open_orders)
    ? data.detailed_open_orders
    : [];
  const detailedPreApprovalOrders = Array.isArray(
    data?.detailed_pre_approval_orders,
  )
    ? data.detailed_pre_approval_orders
    : [];
  const isBranchView = customer.aggregation_level === "branch";

  context.state.lastRenderedStatsPayload = data;
  context.state.currentDetailedOrders = detailedOrders;
  context.state.currentDetailedOpenOrders = detailedOpenOrders;
  context.state.currentDetailedPreApprovalOrders = detailedPreApprovalOrders;
  context.state.currentOpenOrders = openOrders;
  context.state.currentPreApprovalOrders = preApprovalOrders;
  context.state.currentProductSales = Array.isArray(productSales.items)
    ? productSales.items
    : [];
  context.state.currentTopProductsByQty = topProductsByQty;
  context.state.currentTopProductsByValue = topProductsByValue;
  if (context.elements.openRankedOrderFormBtn)
    context.elements.openRankedOrderFormBtn.disabled =
      context.state.currentProductSales.length === 0;
  context.state.selectedOrderId = null;
  context.state.currentProductSalesPage = 1;
  context.state.currentRecentOrdersPage = 1;
  context.state.currentOpenOrdersPage = 1;
  context.state.currentPreApprovalOrdersPage = 1;
  context.resetProductTableFilters();

  const metaParts = [customer.code, customer.email];
  if (customer.branch_code)
    metaParts.push(`Υποκατάστημα: ${customer.branch_code}`);
  if (customer.branch_description) metaParts.push(customer.branch_description);
  if (customer.aggregation_level)
    metaParts.push(
      `Επίπεδο: ${context.formatAggregationLevelLabel(customer.aggregation_level)}`,
    );
  if (customer.chain_name) metaParts.push(`Αλυσίδα: ${customer.chain_name}`);

  context.elements.customerNameHeading.textContent =
    customer.name || "Άγνωστος πελάτης";
  context.elements.customerMeta.textContent =
    metaParts.filter(Boolean).join(" | ") || "-";
  if (context.elements.totalOrdersValue)
    context.elements.totalOrdersValue.textContent = formatNumber(
      summary.total_orders ?? 0,
    );
  if (context.elements.totalPiecesValue)
    context.elements.totalPiecesValue.textContent = formatNumber(
      summary.total_pieces ?? 0,
    );
  if (context.elements.totalRevenueValue)
    context.elements.totalRevenueValue.textContent = formatMoney(
      summary.total_revenue,
    );
  context.elements.averageOrderValue.textContent = formatMoney(
    summary.average_order_value,
  );
  if (context.elements.daysSinceLastOrderValue)
    context.elements.daysSinceLastOrderValue.textContent = formatDays(
      summary.days_since_last_order,
    );
  context.elements.averageDaysBetweenOrdersValue.textContent = formatDays(
    summary.average_days_between_orders,
  );

  const preApprovalOrdersForTable = getPreApprovalOrdersForTable(context);
  const openOrdersForTable = getOpenOrdersForTable(context);
  const preApprovalCount = preApprovalOrdersForTable.length;
  const openCount = openOrdersForTable.length;
  const now = new Date();
  const statsKey = `${customer.code || ""}::${customer.branch_code || ""}`;
  if (data?.range_summary)
    context.cacheRangeSummary(
      statsKey,
      context.state.currentSalesTimeRange,
      data.range_summary,
    );
  const detailedOrdersForCards =
    context.state.allRangeDetailedOrders.length &&
    context.state.allRangeStatsKey === statsKey
      ? context.state.allRangeDetailedOrders
      : context.state.currentDetailedOrders;
  const recentRange = context.getCardTimeRangeValue("recent_executed");
  if (!context.getCachedRangeSummary(statsKey, recentRange)) {
    void context.fetchRangeSummary(
      recentRange,
      customer.code,
      customer.branch_code || "",
      context.state.currentCustomerSearchFilters,
    );
  }
  const recentRangeSummary = context.getCachedRangeSummary(
    statsKey,
    recentRange,
  );
  const recentExecutedCount = recentRangeSummary
    ? Number(recentRangeSummary.total_orders || 0)
    : context.filterOrdersByRange(detailedOrdersForCards, recentRange, now)
        .length;
  const piecesRange = context.getCardTimeRangeValue("total_pieces");
  const revenueRange = context.getCardTimeRangeValue("total_revenue");
  if (!context.getCachedRangeSummary(statsKey, piecesRange)) {
    void context.fetchRangeSummary(
      piecesRange,
      customer.code,
      customer.branch_code || "",
      context.state.currentCustomerSearchFilters,
    );
  }
  if (!context.getCachedRangeSummary(statsKey, revenueRange)) {
    void context.fetchRangeSummary(
      revenueRange,
      customer.code,
      customer.branch_code || "",
      context.state.currentCustomerSearchFilters,
    );
  }
  const piecesRangeSummary = context.getCachedRangeSummary(
    statsKey,
    piecesRange,
  );
  const revenueRangeSummary = context.getCachedRangeSummary(
    statsKey,
    revenueRange,
  );
  const ordersForPieces = context.filterOrdersByRange(
    detailedOrdersForCards,
    piecesRange,
    now,
  );
  const ordersForRevenue = context.filterOrdersByRange(
    detailedOrdersForCards,
    revenueRange,
    now,
  );
  const piecesTotal = piecesRangeSummary
    ? Number(piecesRangeSummary.total_pieces || 0)
    : ordersForPieces.reduce(
        (sum, order) => sum + Number(order?.total_pieces || 0),
        0,
      );
  const revenueTotal = revenueRangeSummary
    ? Number(revenueRangeSummary.total_revenue || 0)
    : ordersForRevenue.reduce(
        (sum, order) => sum + Number(order?.total_net_value || 0),
        0,
      );
  const activeDocumentIds = new Set(
    [...preApprovalOrdersForTable, ...openOrdersForTable]
      .map((order) => String(order?.order_id || ""))
      .filter(Boolean),
  );

  if (context.elements.activeDocumentsValue)
    context.elements.activeDocumentsValue.textContent = formatNumber(
      activeDocumentIds.size,
    );
  context.elements.acceptedOrdersValue.textContent =
    formatNumber(preApprovalCount);
  context.elements.inProgressOrdersValue.textContent = formatNumber(openCount);
  context.elements.invoicedOrdersValue.textContent =
    formatNumber(recentExecutedCount);
  if (context.elements.totalPiecesValue)
    context.elements.totalPiecesValue.textContent = formatNumber(piecesTotal);
  if (context.elements.totalRevenueValue)
    context.elements.totalRevenueValue.textContent = formatMoney(revenueTotal);
  if (context.elements.lastOrderDateValue)
    context.elements.lastOrderDateValue.textContent = formatDate(
      summary.last_order_date,
    );

  renderBranchSelector(
    context,
    customer.code,
    availableBranches,
    customer.branch_code || "",
  );
  renderMonthlySales(context, monthlySales);
  if (context.elements.receivablesPanel)
    context.elements.receivablesPanel.hidden = isBranchView;
  renderReceivables(context, receivables);
  context.elements.productSalesMetric.value =
    productSales.metric === "pieces" ? "pieces" : "revenue";
  renderProductSales(context);
  renderTopProductsQty(context);
  renderTopProductsValue(context);
  renderPreApprovalOrdersTable(context);
  renderOpenOrdersTable(context);
  renderRecentOrdersTable(context);
  renderSelectedOrderDetails(context);
  context.elements.emptyState.hidden = true;
  context.elements.statsPanel.hidden = false;
  context.setSearchPanelCollapsed(true);
}
