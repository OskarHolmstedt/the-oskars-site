/** @file Independent within-collection film ordering for franchises, directors, and tags (issue #165) — an explicit order that doesn't have to agree with the implicit global-rank-derived order every collection page still shows too. Neither franchises, directors, nor tags have a persisted record of their own (`state.franchisesById`/`state.peopleById` are derived from film/watchlist records; tags are plain strings), so this follows the same pattern as `state.entityNotes`: a canonical side-table keyed by collection kind, then entity id. */

(function () {
  /**
   * Merges a stored local order with a collection's current implicit order.
   * Stored ids still present in the collection come first, in their stored
   * order; any remaining current ids (new additions, or every id when no
   * order has been stored yet) are appended in their given order.
   * @param {string[]} storedOrder Explicit film ids, in preferred order.
   * @param {string[]} currentIds Current collection film ids, already in
   *   implicit (global-rank-derived) order.
   * @returns {string[]} Final film id order.
   */
  window.mergeLocalRankOrder = function (storedOrder, currentIds) {
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
})();
