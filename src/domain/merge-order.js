/** @file Generic two-pointer merge session: combines two already-ordered lists via repeated "which ranks higher" choices, in O(|A|+|B|) comparisons rather than an exhaustive all-pairs sort. Shared by the watchlist merge tool (`watchlist-merge.html`) and the local-rank merge tool (issue #165). */

(function () {
  function mergeFinishIfExhausted(session) {
    if (session.pointerA >= session.listA.length) {
      session.merged.push(...session.listB.slice(session.pointerB));
      session.pointerB = session.listB.length;
      session.done = true;
      return true;
    }
    if (session.pointerB >= session.listB.length) {
      session.merged.push(...session.listA.slice(session.pointerA));
      session.pointerA = session.listA.length;
      session.done = true;
      return true;
    }
    return false;
  }

  /**
   * Starts a merge session over two ordered lists.
   * @param {Array} listA First ordered list.
   * @param {Array} listB Second ordered list.
   * @returns {Object} Session: `listA`, `listB`, `pointerA`, `pointerB`,
   *   `merged`, `history`, `done`. Auto-completes when either list starts
   *   empty.
   */
  window.createMergeSession = function (listA, listB) {
    let session = {
      listA: listA || [],
      listB: listB || [],
      pointerA: 0,
      pointerB: 0,
      merged: [],
      history: [],
      done: false,
    };
    mergeFinishIfExhausted(session);
    return session;
  };

  /**
   * Records a "this one ranks higher" choice and advances the session.
   * @param {Object} session Session from `createMergeSession`.
   * @param {'a'|'b'} side Which list's current item was chosen.
   * @returns {Object} The same session, mutated.
   */
  window.pickMergeSide = function (session, side) {
    if (!session || session.done) return session;
    let item =
      side === "a"
        ? session.listA[session.pointerA]
        : session.listB[session.pointerB];
    session.merged.push(item);
    session.history.push(side);
    if (side === "a") session.pointerA += 1;
    else session.pointerB += 1;
    mergeFinishIfExhausted(session);
    return session;
  };

  /**
   * Undoes the last recorded choice, if any.
   * @param {Object} session Session from `createMergeSession`.
   * @returns {Object} The same session, mutated.
   */
  window.undoMergeChoice = function (session) {
    let side = session?.history?.pop();
    if (!side) return session;
    session.merged.pop();
    if (side === "a") session.pointerA -= 1;
    else session.pointerB -= 1;
    session.done = false;
    return session;
  };
})();
