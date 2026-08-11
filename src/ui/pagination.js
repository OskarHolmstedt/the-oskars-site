/** @file Computes bounded pagination state and renders shared pagination controls. */

/**
 * Computes normalized page boundaries for a collection.
 * @param {number} total Total item count.
 * @param {number} page Requested one-based page.
 * @param {number} pageSize Requested items per page.
 * @returns {Object} Normalized page counts, range, and slice boundaries.
 */
window.paginationState = function (total, page, pageSize) {
  let normalizedTotal = Math.max(0, Number(total) || 0);
  let normalizedPageSize = Math.max(1, Number(pageSize) || 100);
  let pageCount = Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));
  let normalizedPage = Math.max(1, Math.min(Number(page) || 1, pageCount));
  return {
    total: normalizedTotal,
    page: normalizedPage,
    pageCount,
    pageSize: normalizedPageSize,
    start: normalizedTotal ? (normalizedPage - 1) * normalizedPageSize + 1 : 0,
    end: Math.min(normalizedPage * normalizedPageSize, normalizedTotal),
    sliceStart: (normalizedPage - 1) * normalizedPageSize,
    sliceEnd: normalizedPage * normalizedPageSize,
  };
};

function paginationButton(dataAttribute, target, label, disabled) {
  return `<button type="button" ${dataAttribute}="${target}" ${disabled ? "disabled" : ""}>${label}</button>`;
}

/**
 * Renders standard or extended pagination controls.
 * @param {Object} options Collection, page, labels, attributes, and presentation options.
 * @returns {string}
 */
window.renderPaginationControls = function (options) {
  let state = window.paginationState(
    options.total,
    options.page,
    options.pageSize,
  );
  if (options.hideWhenSingle !== false && state.total <= state.pageSize)
    return "";
  let dataAttribute = options.dataAttribute || "data-page";
  let itemLabel = options.itemLabel || "items";
  let ariaLabel = options.ariaLabel || `${itemLabel} pages`;
  let classes = ["film-pagination", ...(options.classes || [])].join(" ");
  let showingLabel = window.uiText?.("Showing") || "Showing";
  let ofLabel = window.uiText?.("of") || "of";
  let pageLabel = window.uiText?.("Page") || "Page";
  let range = `<span>${showingLabel} <b>${state.start}–${state.end}</b> ${ofLabel} <b>${state.total}</b> ${itemLabel} · ${pageLabel} ${state.page} ${ofLabel} ${state.pageCount}</span>`;

  if (options.variant === "extended") {
    let back = [
      paginationButton(
        dataAttribute,
        1,
        window.uiText?.("First") || "First",
        state.page === 1,
      ),
      paginationButton(
        dataAttribute,
        Math.max(1, state.page - 10),
        "-10",
        state.page === 1,
      ),
      paginationButton(
        dataAttribute,
        Math.max(1, state.page - 5),
        "-5",
        state.page === 1,
      ),
      paginationButton(
        dataAttribute,
        state.page - 1,
        `← ${state.pageSize}`,
        state.page === 1,
      ),
    ].join("");
    let forward = [
      paginationButton(
        dataAttribute,
        state.page + 1,
        `${state.pageSize} →`,
        state.page === state.pageCount,
      ),
      paginationButton(
        dataAttribute,
        Math.min(state.pageCount, state.page + 5),
        "+5",
        state.page === state.pageCount,
      ),
      paginationButton(
        dataAttribute,
        Math.min(state.pageCount, state.page + 10),
        "+10",
        state.page === state.pageCount,
      ),
      paginationButton(
        dataAttribute,
        state.pageCount,
        window.uiText?.("Last") || "Last",
        state.page === state.pageCount,
      ),
    ].join("");
    return `<nav class="${classes}" aria-label="${ariaLabel}"><div>${back}</div>${range}<div>${forward}</div></nav>`;
  }

  let previous = paginationButton(
    dataAttribute,
    state.page - 1,
    `← ${window.uiText?.("Previous") || "Previous"} ${state.pageSize}`,
    state.page === 1,
  );
  let next = paginationButton(
    dataAttribute,
    state.page + 1,
    `${window.uiText?.("Next") || "Next"} ${state.pageSize} →`,
    state.page === state.pageCount,
  );
  return `<nav class="${classes}" aria-label="${ariaLabel}">${previous}${range}${next}</nav>`;
};
