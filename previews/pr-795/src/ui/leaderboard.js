/** @file Owns the standard read-only leaderboard table scaffold used across pages and data views. */

/**
 * @typedef {Object} LeaderboardTableOptions
 * @property {string[]} headers Caller-rendered, already-safe header cell HTML.
 * @property {string} rows Caller-rendered, already-safe table row HTML.
 * @property {string|string[]} [classes] Extra classes on the table.
 * @property {string|string[]} [wrapClasses] Extra classes on the wrapper.
 */

(function () {
  /** Renders the standard leaderboard wrapper, header row, and body.
   * @param {LeaderboardTableOptions} options Pre-rendered table content and optional classes.
   * @returns {string} Leaderboard table HTML.
   */
  window.renderLeaderboardTable = function (options = {}) {
    let headers = (options.headers || [])
      .map((header) => `<th>${header}</th>`)
      .join("");
    return `<div class="${window.pageClassList("leaderboard-wrap", options.wrapClasses)}"><table class="${window.pageClassList("leaderboard", options.classes)}"><thead><tr>${headers}</tr></thead><tbody>${options.rows || ""}</tbody></table></div>`;
  };
})();
