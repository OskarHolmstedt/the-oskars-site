/**
 * @file Pure read-side helpers over getSupabaseWorkspace().watchlist
 * (issue #421) - the Supabase-row-shaped counterpart to
 * src/imports/watchlists.js's watchlistTierItemsInOrder()/
 * watchlistPeriodKeys()/watchlistTierPeriodScopeItems(). Structurally
 * simpler than the original: every watchlist row's joined `films` object
 * already carries a real `year`, so there's no "watchlist item's own
 * field vs. archive-film fallback" split to reconcile - Supabase has one
 * unified films table, not two representations of a film to merge.
 *
 * window.WATCHLIST_TIERS (src/imports/watchlists.js) is reused as-is -
 * that file loads unconditionally for every page already, and the tier
 * list itself (S..F) has nothing to do with which backend stores the
 * items. window.getDecadeKey/getCenturyKey (src/core/state.js) are also
 * reused as-is - trivial, pure year-to-period-key math, no state
 * coupling at all.
 *
 * No DOM, no Supabase SDK import - directly Node-testable.
 */

/**
 * One interest tier's watchlist rows, in their current position order.
 * @param {string} tier
 * @returns {Object[]} Watchlist rows (each already joined with its film).
 */
window.supabaseWatchlistTierItemsInOrder = function (tier) {
  let workspace = window.getSupabaseWorkspace();
  return (workspace?.watchlist || [])
    .filter((row) => row.tier === tier)
    .sort((left, right) =>
      left.position < right.position ? -1 : left.position > right.position ? 1 : 0,
    );
};

/**
 * Interest tiers with at least two watchlist rows - the minimum needed
 * for a merge to make sense.
 * @returns {string[]}
 */
window.supabaseWatchlistTiersWithItems = function () {
  return (window.WATCHLIST_TIERS || []).filter(
    (tier) => window.supabaseWatchlistTierItemsInOrder(tier).length >= 2,
  );
};

/**
 * Lists populated period keys within one tier, for a period type.
 * @param {string} tier
 * @param {'year'|'decade'|'century'} periodType
 * @returns {string[]} Sorted ascending.
 */
window.supabaseWatchlistPeriodKeys = function (tier, periodType) {
  let keys = new Set();
  window.supabaseWatchlistTierItemsInOrder(tier).forEach((row) => {
    let year = row.films?.year;
    if (!Number.isInteger(year)) return;
    if (periodType === "year") keys.add(String(year));
    else if (periodType === "decade") keys.add(window.getDecadeKey(year));
    else if (periodType === "century") keys.add(window.getCenturyKey(year));
  });
  return [...keys].sort(
    (left, right) => Number(left.replace(/s$/, "")) - Number(right.replace(/s$/, "")),
  );
};

/**
 * Filters one tier's items to a period scope, keeping their existing
 * relative order - the input the merge tool combines two of.
 * @param {string} tier
 * @param {'year'|'decade'|'century'|'all'} periodType
 * @param {string} [periodKey] Ignored when periodType is "all".
 * @returns {Object[]}
 */
window.supabaseWatchlistTierPeriodScopeItems = function (tier, periodType, periodKey) {
  let items = window.supabaseWatchlistTierItemsInOrder(tier);
  if (periodType === "all") return items;
  return items.filter((row) => {
    let year = row.films?.year;
    if (!Number.isInteger(year)) return false;
    if (periodType === "year") return String(year) === periodKey;
    if (periodType === "decade") return window.getDecadeKey(year) === periodKey;
    if (periodType === "century") return window.getCenturyKey(year) === periodKey;
    return false;
  });
};
