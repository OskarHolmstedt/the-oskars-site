/** @file Owns the watchlist year shelf editor and ranking backlog on the Rankings page. */

(function () {
  let escape = window.pageEscape;

  /**
   * Builds a link to the watchlist year editor, optionally opening an exact tier.
   * @param {number|string} year
   * @param {string} [tier]
   * @returns {string}
   */
  window.watchlistYearOrderUrl = function (year, tier = "") {
    return `rank-year.html?year=${encodeURIComponent(year)}&category=watchlist${tier ? `&tier=${encodeURIComponent(tier)}` : ""}`;
  };

  /**
   * Mounts the selected year's drag-sort editor with keyboard and touch ordering controls.
   * @param {HTMLElement} container
   * @returns {boolean} Whether the URL selects the watchlist year editor.
   */
  window.mountWatchlistYearOrder = function (container) {
    let rawYear = window.pageQueryParam?.("watchlistYear");
    if (rawYear === null || rawYear === "" || rawYear === undefined)
      return false;
    let tier = window.pageQueryParam?.("tier") || "";
    let target = window.watchlistYearOrderUrl(rawYear, tier);
    if (typeof window.location?.replace === "function") {
      window.location.replace(target);
      return true;
    }
    if (container) {
      container.innerHTML = `<p>Redirecting to <a href="${escape(target)}">year ranking</a>…</p>`;
    }
    return true;
  };
})();
