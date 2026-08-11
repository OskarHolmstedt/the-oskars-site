/** @file Renders award progression placement cells and matrix table scaffolding. */

/**
 * Renders one linked award placement cell or an empty matrix cell.
 * @param {Object|null} credit Award progression credit.
 * @param {Object} [options] Period, placement, type, and escaping options.
 * @returns {string}
 */
window.renderProgressionPlacementCell = function (credit, options = {}) {
  if (!credit)
    return '<td class="award-matrix-empty"><span aria-label="Not represented">—</span></td>';
  let escape = options.escape || window.pageEscape;
  let period = String(options.period ?? credit.period ?? credit.year ?? "");
  let type = options.type || window.getAwardPeriodType({ year: period });
  let label = options.placement
    ? options.placement(credit.placement)
    : window.pagePlacement(credit.placement);
  return `<td class="detail-place"><a class="period-link" href="${escape(window.periodPageUrl(type, period))}" title="${escape(period === "alltime" ? "All-time" : period)}">${label}</a></td>`;
};

/**
 * Renders an award progression matrix or its empty state.
 * @param {Object} [options] Headers, rows, bands, classes, and empty-state options.
 * @returns {string}
 */
window.renderProgressionTable = function (options = {}) {
  if (!options.rows)
    return `<div class="detail-empty">${options.emptyText || "No nominations"}</div>`;
  let classes = [
    "leaderboard",
    "award-matrix",
    ...(options.classes || []),
  ].join(" ");
  let band = options.bandHeaders?.length
    ? `<tr class="${options.bandClass || "progression-bands"}">${options.bandHeaders.map((item) => `<th colspan="${item.span}">${item.label}</th>`).join("")}</tr>`
    : "";
  // Explicit per-column widths (table-layout: fixed) let a page pin down
  // exactly how wide each column is instead of leaving it to auto-layout,
  // which distributes leftover space unpredictably across columns. Optional
  // so callers without a fixed column shape (e.g. film.js's award matrix)
  // keep the previous auto-sized behavior.
  let colgroup = options.colWidths?.length
    ? `<colgroup>${options.colWidths.map((width) => `<col style="width:${width}px">`).join("")}</colgroup>`
    : "";
  // A standalone table that's the entirety of its view (nothing else on the
  // page to reveal by collapsing it) doesn't benefit from a collapse toggle
  // the way a page with several sibling tables does, and the toggle's
  // reserved corner space fights a table already sized to the page width.
  let skipCollapse = options.skipCollapse ? " data-collapsible-skip" : "";
  return `<div class="leaderboard-wrap ${options.wrapClass || "award-matrix-wrap"}"${skipCollapse}><table class="${classes}">${colgroup}<thead>${band}<tr>${options.headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${options.rows}</tbody></table></div>`;
};
