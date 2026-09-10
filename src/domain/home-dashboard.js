/** @file Selects deterministic daily Home memories and watchlist suggestions from existing archive state. */

(function () {
  /** Builds a local-calendar key used to keep Home choices stable for one day. @param {Date|string} [value] Date or canonical date key. @returns {string} Canonical `YYYY-MM-DD` key. */
  window.homeDailyKey = function (value = new Date()) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return String(value);
    let date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) date = new Date();
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  };

  function dailyOrder(left, right, seed) {
    let leftKey = left.id || `${left.title || ""}:${left.year || ""}`;
    let rightKey = right.id || `${right.title || ""}:${right.year || ""}`;
    return window.compareBySeededShuffle(leftKey, rightKey, seed);
  }

  function dailyFirst(records, seed) {
    return (records || []).reduce(
      (best, record) =>
        !best || dailyOrder(record, best, seed) < 0 ? record : best,
      null,
    );
  }

  /** Selects one stable archive memory, preferring films watched on the same month and day. @param {FilmRecord[]} films Watched films. @param {Date|string} [date] Calendar date. @returns {{film:FilmRecord,anniversary:boolean,date:string}|null} Daily memory or null. */
  window.homeArchiveMemory = function (films, date = new Date()) {
    let key = window.homeDailyKey(date);
    let eligible = (films || []).filter((film) => film?.title);
    if (!eligible.length) return null;
    let anniversaries = eligible.filter((film) => {
      let watched = window.parseWatchedDate?.(film.dateWatched) || "";
      return watched && watched.slice(5) === key.slice(5);
    });
    let pool = anniversaries.length ? anniversaries : eligible;
    let film = dailyFirst(pool, `${key}:memory`);
    return {
      film,
      anniversary: anniversaries.length > 0,
      date: window.parseWatchedDate?.(film.dateWatched) || "",
    };
  };

  /** Selects one reasoned watchlist item that remains stable for the calendar day. @param {WatchlistItem[]} items Watchlist candidates. @param {Date|string} [date] Calendar date. @returns {Object|null} Daily pick or null. */
  window.homeWatchlistPick = function (items, date = new Date()) {
    // Home needs a light daily prompt, not Discover's deeper relationship
    // analysis (which builds archive-wide director/franchise indexes). Keep
    // the first 24 films from the best available tier—the source array is
    // already in watchlist order—then let the shared picker own the stable
    // tier-based choice within that high-priority shortlist.
    let bestTierRank = Infinity;
    let shortlist = [];
    (items || []).forEach((item) => {
      let rank = window.watchlistTierRank(item?.tier);
      if (rank < bestTierRank) {
        bestTierRank = rank;
        shortlist = [item];
      } else if (rank === bestTierRank && shortlist.length < 24) {
        shortlist.push(item);
      }
    });
    return (
      window.pickWatchQueueItems(shortlist, {
        count: 1,
        seed: `${window.homeDailyKey(date)}:watchlist`,
        relationshipReasons: false,
      })[0] || null
    );
  };
})();
