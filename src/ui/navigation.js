/** @file Renders breadcrumbs and reusable view-order, shuffle, section, and sort controls. */

/**
 * Renders a breadcrumb navigation trail.
 * @param {Object[]} items Breadcrumb labels and optional links.
 * @param {Object} [options] Escaping and accessible-label options.
 * @returns {string}
 */
window.renderBreadcrumbs = function (items, options = {}) {
  let escape = options.escape || window.pageEscape;
  let links = (items || [])
    .filter(Boolean)
    .map((item) =>
      item.href
        ? `<a href="${escape(item.href)}">${escape(item.label)}</a>`
        : `<span aria-current="page">${escape(item.label)}</span>`,
    )
    .join('<span aria-hidden="true">›</span>');
  return links
    ? `<nav class="detail-breadcrumbs" aria-label="${escape(options.label || "Breadcrumb")}">${links}</nav>`
    : "";
};

// Reusable reverse-order control, standard across every multi-film/entity
// view (issue #51). `href` renders a plain navigation link, preserving the
// original icon+text pill for pages that still want it (e.g. category.js).
// `iconOnly` (matching the shuffle control below and the grid/list view
// toggle, so all three sit as one same-shaped square-button row) drops the
// pill down to a bare square icon, for either a reload page (`href`) or a
// live-rerender page that wires its own click listener via `attribute`.
/**
 * Renders the shared chronological-order control.
 * @param {Object} [options] Current order, target, labeling, and presentation options.
 * @returns {string}
 */
window.renderChronologyControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let order = options.order === "desc" ? "desc" : "asc";
  let nextDirection =
    order === "asc"
      ? options.descDirection || "newest"
      : options.ascDirection || "oldest";
  let text =
    order === "asc"
      ? options.descLabel || "Newest first"
      : options.ascLabel || "Oldest first";
  let title = escape(options.title || `Show ${nextDirection} first`);
  let attribute = options.attribute
    ? ` ${options.attribute}`
    : options.iconOnly
      ? " data-reverse-order-button"
      : "";
  if (options.iconOnly) {
    return options.href
      ? `<a class="sort-order-button sort-order-button--icon" href="${escape(options.href)}" title="${title}" aria-label="${title}"${attribute}>⇅</a>`
      : `<button type="button" class="sort-order-button sort-order-button--icon" title="${title}" aria-label="${title}"${attribute}>⇅</button>`;
  }
  return `<div class="chronology-order-control"><a class="sort-order-button" href="${escape(options.href)}" title="${title}"${attribute}>⇅ ${escape(text)}</a></div>`;
};

// Reusable shuffle control, standard alongside the reverse-order control
// above - same square icon shape. Always the same look/label - clicking it
// (a fresh href seed for reload pages, or a click listener on `attribute`
// for live-rerender pages) just reshuffles again, with no separate
// "shuffle again" state to track.
/**
 * Renders the shared shuffle link or button.
 * @param {Object} [options] Target, labeling, attributes, and escaping options.
 * @returns {string}
 */
window.renderShuffleControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let title = escape(options.label || ui("Shuffle"));
  let attribute = options.attribute
    ? ` ${options.attribute}`
    : " data-shuffle-button";
  return options.href
    ? `<a class="sort-order-button sort-order-button--icon" href="${escape(options.href)}" title="${title}" aria-label="${title}"${attribute}>⇄</a>`
    : `<button type="button" class="sort-order-button sort-order-button--icon" title="${title}" aria-label="${title}"${attribute}>⇄</button>`;
};

// Reusable split/combined toggle for pages that render separate watched
// and watchlist blocks (issue #52) - same square-icon shape as the reverse
// and shuffle controls above. A pressed-state link: `href` is the page URL
// with the opposite sections mode, `combined` marks the current state.
/**
 * Renders the shared split-versus-combined sections toggle.
 * @param {Object} [options] Current mode, target, and escaping options.
 * @returns {string}
 */
window.renderCombinedSectionsControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let combined = options.combined === true || options.combined === "combined";
  let title = escape(
    combined
      ? ui("Show watched and watchlist separately")
      : ui("Combine watched and watchlist into one list"),
  );
  return `<a class="sort-order-button sort-order-button--icon${combined ? " is-active" : ""}" href="${escape(options.href)}" title="${title}" aria-label="${title}" aria-pressed="${combined ? "true" : "false"}" data-combined-sections-button>∪</a>`;
};

// Reusable sort-axis dropdown, standard across every multi-item view
// (issue #53) - a shared vocabulary (Title/Order/Year/Rating/Wins/Noms/
// Score) and one <select> widget, but each page still owns its own small
// value-getter for the axes it exposes (there is no single "universal
// comparator" here - a watched film's Rating isn't the same field as a
// watchlist item's Tier, a person's Score isn't a film's Score, etc). This
// just renders a consistent control; `axes` is the page-supplied ordered
// list of `{ value, label }` currently relevant to that page/section.
/**
 * Renders a shared sort-axis selector from page-supplied axes.
 * @param {Object} [options] Axis definitions, selection, attributes, and labeling options.
 * @returns {string}
 */
window.renderSortAxisControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let axes = options.axes || [];
  let value = options.value || (axes[0] && axes[0].value) || "";
  let attribute = options.attribute
    ? ` ${options.attribute}`
    : " data-sort-axis";
  let optionsHtml = axes
    .map(
      (axis) =>
        `<option value="${escape(axis.value)}"${axis.value === value ? " selected" : ""}>${escape(ui(axis.label))}</option>`,
    )
    .join("");
  return `<label class="sort-axis-control">${escape(ui(options.label || "Sort"))} <select${attribute}>${optionsHtml}</select></label>`;
};

/**
 * Renders the shared Overview/Awards controller for collection detail pages.
 * @param {Object} [options] Active view, destinations, and escaping options.
 * @returns {string}
 */
window.renderCollectionViewController = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let view = options.view === "awards" ? "awards" : "films";
  let overview =
    view === "films"
      ? `<strong aria-current="page">${escape(ui("Overview"))}</strong>`
      : `<a href="${escape(options.overviewUrl || "#")}">${escape(ui("Overview"))}</a>`;
  let awards =
    view === "awards"
      ? `<strong aria-current="page">${escape(ui("Awards"))}</strong>`
      : `<a href="${escape(options.awardsUrl || "#")}">${escape(ui("Awards"))}</a>`;
  return `<nav class="collection-page-view-controls" aria-label="${escape(ui("Collection view"))}">${overview}${awards}</nav>`;
};
