/**
 * @file Supabase-side wrapper for local-rank-order merging (issue #422).
 * The merge itself has no Supabase/window.state coupling - the "given
 * order" the caller supplies already encodes whatever the Supabase-side
 * collection-fetch decided as its own implicit default (alphabetical -
 * see loadSupabaseLocalRankCollectionFilms() in supabase-workspace.js),
 * so this delegates straight to src/domain/local-rank.js's
 * mergeLocalRankOrder(), which is exactly as Node-testable (no DOM, no
 * Supabase SDK import) - kept as a separate export only so callers in
 * this module's area don't need to know the merge lives in local-rank.js.
 */

/**
 * @param {string[]} storedOrder Explicit film ids, in preferred order.
 * @param {string[]} currentIds Current collection film ids, in their
 *   caller-supplied default order.
 * @returns {string[]} Final film id order.
 */
window.mergeSupabaseLocalRankOrder = function (storedOrder, currentIds) {
  return window.mergeLocalRankOrder(storedOrder, currentIds);
};
