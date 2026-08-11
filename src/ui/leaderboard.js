/** @file Owns the standard read-only leaderboard table scaffold used across pages and data views. */

/**
 * @typedef {Object} LeaderboardTableOptions
 * @property {string[]} headers Caller-rendered, already-safe header cell HTML.
 * @property {string} rows Caller-rendered, already-safe table row HTML.
 * @property {string|string[]} [classes] Extra classes on the table.
 * @property {string|string[]} [wrapClasses] Extra classes on the wrapper.
 */

(function () {
  function classList(base, extras) {
    let values = Array.isArray(extras)
      ? extras
      : String(extras || "").split(/\s+/);
    return [...new Set([base, ...values].filter(Boolean))].join(" ");
  }

  /** Renders the standard leaderboard wrapper, header row, and body.
   * @param {LeaderboardTableOptions} options Pre-rendered table content and optional classes.
   * @returns {string} Leaderboard table HTML.
   */
  window.renderLeaderboardTable = function (options = {}) {
    let headers = (options.headers || [])
      .map((header) => `<th>${header}</th>`)
      .join("");
    return `<div class="${classList("leaderboard-wrap", options.wrapClasses)}"><table class="${classList("leaderboard", options.classes)}"><thead><tr>${headers}</tr></thead><tbody>${options.rows || ""}</tbody></table></div>`;
  };
})();
