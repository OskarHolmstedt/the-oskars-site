/**
 * @file Pure local-rank-order merging (issue #422) - a direct port of
 * src/domain/local-rank.js's mergeLocalRankOrder(), same semantics: a
 * stored explicit order wins for the ids it still covers, in its own
 * order; anything left over (new additions, or every id when nothing's
 * stored yet) is appended in its given order. No Supabase/window.state
 * coupling at all - the "given order" the caller supplies already
 * encodes whatever the Supabase-side collection-fetch decided as its
 * own implicit default (alphabetical - see
 * loadSupabaseLocalRankCollectionFilms() in supabase-workspace.js),
 * this function doesn't need to know what that was.
 *
 * No DOM, no Supabase SDK import - directly Node-testable.
 */

/**
 * @param {string[]} storedOrder Explicit film ids, in preferred order.
 * @param {string[]} currentIds Current collection film ids, in their
 *   caller-supplied default order.
 * @returns {string[]} Final film id order.
 */
window.mergeSupabaseLocalRankOrder = function (storedOrder, currentIds) {
  let currentSet = new Set(currentIds || []);
  let seen = new Set();
  let ordered = (storedOrder || []).filter((id) => {
    if (!currentSet.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  (currentIds || []).forEach((id) => {
    if (!seen.has(id)) ordered.push(id);
  });
  return ordered;
};
