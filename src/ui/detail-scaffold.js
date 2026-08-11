/** @file Owns the shared outer scaffolds for detail-page headers and flex-row stat summaries. */

/**
 * @typedef {Object} DetailHeaderOptions
 * @property {string} mainHtml Caller-rendered, already-safe primary content.
 * @property {string} [leadingHtml] Caller-rendered content before the primary wrapper.
 * @property {string} [actionsHtml] Caller-rendered action content; presence adds the action wrapper.
 * @property {string|string[]} [classes] Extra header classes.
 * @property {string|string[]} [mainClasses] Classes on the primary content wrapper.
 */

/**
 * @typedef {Object} DetailStatsOptions
 * @property {string} itemsHtml Caller-rendered, already-safe metric items.
 * @property {string|string[]} [classes] Extra stat-wrapper classes.
 */

/**
 * @typedef {Object} RatingStatisticsItemsOptions
 * @property {(value: *) => string} escape Escapes text for HTML.
 * @property {(text: string, values?: Record<string, *>)} [ui] Localizes text.
 */

(function () {
  function classList(base, extras) {
    let values = Array.isArray(extras)
      ? extras
      : String(extras || "").split(/\s+/);
    return [...new Set([base, ...values].filter(Boolean))].join(" ");
  }

  /** Renders a detail header around caller-owned content and actions.
   * @param {DetailHeaderOptions} options Header content and optional classes.
   * @returns {string} Detail-header HTML.
   */
  window.renderDetailHeader = function (options = {}) {
    let mainClasses = classList("", options.mainClasses);
    let main = mainClasses
      ? `<div class="${mainClasses}">${options.mainHtml || ""}</div>`
      : `<div>${options.mainHtml || ""}</div>`;
    let actions = Object.prototype.hasOwnProperty.call(options, "actionsHtml")
      ? `<div class="detail-header-actions">${options.actionsHtml || ""}</div>`
      : "";
    return `<header class="${classList("film-detail-header", options.classes)}">${options.leadingHtml || ""}${main}${actions}</header>`;
  };

  /** Renders the standard flex-row detail-stat summary wrapper.
   * @param {DetailStatsOptions} options Metric HTML and optional classes.
   * @returns {string} Detail-stat summary HTML.
   */
  window.renderDetailStats = function (options = {}) {
    return `<div class="${classList("detail-stats", options.classes)}">${options.itemsHtml || ""}</div>`;
  };

  /** Renders reusable mean, spread, and coverage stat items. @param {RatingStatistics} statistics Rating statistics. @param {RatingStatisticsItemsOptions} options Rendering options. @returns {string} Stat-item HTML. */
  window.renderRatingStatisticsItems = function (statistics, options) {
    let escape = options.escape;
    let ui = options.ui || ((text) => text);
    return `<span><b>${escape(window.formatAverageRating(statistics.mean))}</b> ${escape(ui("average rating"))}</span><span><b>${escape(window.formatRatingStatistic(statistics.standardDeviation))}</b> ${escape(ui("standard deviation"))}</span><span><b>${escape(`${statistics.ratedCount}/${statistics.totalCount}`)}</b> ${escape(ui("rated"))}<small>${escape(statistics.coveragePercent)}% ${escape(ui("coverage"))}</small></span>`;
  };
})();
