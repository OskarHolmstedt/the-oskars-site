/**
 * @file Pure domain state machine for watchlist stash two-pointer pop merges (issue #1037).
 * Owns queuing, auto-drain on empty list tails, undo history, and fractional key allocation
 * for merging a stashed ranking with newly tiered/ranked catalog batches.
 */

(function () {
  /**
   * Creates an active pop-merge session between a stashed ranking and an active batch for one exact tier.
   * @param {string} tier 21-point tier key (e.g. "S+", "A-", "B").
   * @param {Object[]} stashItems Stashed watchlist items, already ordered by stashed position.
   * @param {Object[]} activeItems Newly ranked watchlist items, already ordered by active position.
   * @returns {Object} Mutable merge session state.
   */
  window.createWatchlistPopMergeSession = function (
    tier,
    stashItems,
    activeItems,
  ) {
    let stashQueue = (stashItems || []).slice();
    let activeQueue = (activeItems || []).slice();
    let totalCount = stashQueue.length + activeQueue.length;
    let session = {
      tier: String(tier || ""),
      stashQueue,
      activeQueue,
      get listA() {
        return this.stashQueue;
      },
      get pointerA() {
        return 0;
      },
      get listB() {
        return this.activeQueue;
      },
      get pointerB() {
        return 0;
      },
      mergedList: [],
      get merged() {
        return this.mergedList;
      },
      history: [],
      isComplete: false,
      get done() {
        return this.isComplete;
      },
      totalCount,
      maxComparisons: Math.max(0, totalCount - 1),
      comparisonCount: 0,
    };

    // Auto-drain if either input is already empty
    if (!session.stashQueue.length && session.activeQueue.length) {
      session.mergedList = session.activeQueue.slice();
      session.activeQueue = [];
      session.isComplete = true;
    } else if (!session.activeQueue.length && session.stashQueue.length) {
      session.mergedList = session.stashQueue.slice();
      session.stashQueue = [];
      session.isComplete = true;
    } else if (!session.stashQueue.length && !session.activeQueue.length) {
      session.isComplete = true;
    }

    return session;
  };

  /**
   * Returns the current pair to compare, or null if complete.
   * @param {Object} session Active pop-merge session.
   * @returns {{stashItem: Object, activeItem: Object}|null}
   */
  window.currentPopMergePair = function (session) {
    if (
      !session ||
      session.isComplete ||
      !session.stashQueue.length ||
      !session.activeQueue.length
    ) {
      return null;
    }
    return {
      stashItem: session.stashQueue[0],
      activeItem: session.activeQueue[0],
    };
  };

  /**
   * Advances the pop merge by declaring either the stashed item or active item the winner.
   * Automatically drains remaining items when one queue is emptied.
   * @param {Object} session Active pop-merge session.
   * @param {'stash'|'active'} winner Which queue head should be appended first.
   * @returns {boolean} Whether the merge is complete.
   */
  window.advanceWatchlistPopMerge = function (session, winner) {
    if (!session || session.isComplete) return true;

    // Snapshot state for undo
    session.history.push({
      stashQueue: session.stashQueue.slice(),
      activeQueue: session.activeQueue.slice(),
      mergedList: session.mergedList.slice(),
      comparisonCount: session.comparisonCount,
      isComplete: session.isComplete,
    });

    if (winner === "stash") {
      let chosen = session.stashQueue.shift();
      session.mergedList.push(chosen);
    } else if (winner === "active") {
      let chosen = session.activeQueue.shift();
      session.mergedList.push(chosen);
    } else {
      throw new Error(`Invalid pop merge winner: ${winner}`);
    }

    session.comparisonCount++;

    // Auto-drain when one queue runs out of candidates
    if (!session.stashQueue.length && session.activeQueue.length) {
      session.mergedList.push(...session.activeQueue);
      session.activeQueue = [];
      session.isComplete = true;
    } else if (!session.activeQueue.length && session.stashQueue.length) {
      session.mergedList.push(...session.stashQueue);
      session.stashQueue = [];
      session.isComplete = true;
    } else if (!session.stashQueue.length && !session.activeQueue.length) {
      session.isComplete = true;
    }

    return session.isComplete;
  };

  /**
   * Undoes the last comparison step, restoring prior queue and completion state.
   * @param {Object} session Active pop-merge session.
   * @returns {boolean} Whether an undo was performed.
   */
  window.undoWatchlistPopMerge = function (session) {
    if (!session || !session.history || !session.history.length) return false;
    let previous = session.history.pop();
    session.stashQueue = previous.stashQueue;
    session.activeQueue = previous.activeQueue;
    session.mergedList = previous.mergedList;
    session.comparisonCount = previous.comparisonCount;
    session.isComplete = previous.isComplete;
    return true;
  };

  /**
   * Advances the stash merge session by chosen side ("a" for stash, "b" for active).
   * @param {Object} session Active pop-merge session.
   * @param {'a'|'b'} side
   * @returns {boolean} Whether merge is complete.
   */
  window.pickStashMergeSide = function (session, side) {
    let winner = side === "a" ? "stash" : "active";
    return window.advanceWatchlistPopMerge(session, winner);
  };

  /**
   * Undoes the last comparison step.
   * @param {Object} session Active pop-merge session.
   * @returns {boolean} Whether an undo was performed.
   */
  window.undoStashMergeChoice = function (session) {
    return window.undoWatchlistPopMerge(session);
  };

  /**
   * Generates monotonic, collision-free fractional positions for a merged sequence.
   * @param {Object[]} mergedList Ordered list of films.
   * @param {string|null} [startPosition] Optional lower bound key.
   * @param {string|null} [endPosition] Optional upper bound key.
   * @returns {Array<{film_id: string, position: string, updated_at?: string}>}
   */
  window.allocateMergedPositions = function (
    mergedList,
    startPosition = null,
    endPosition = null,
  ) {
    let current = startPosition;
    return (mergedList || []).map((row) => {
      let key = window.fractionalPositionBetween
        ? window.fractionalPositionBetween(current, endPosition)
        : current
          ? `${current}1`
          : "a0";
      current = key;
      return {
        film_id: row.film_id,
        position: key,
        updated_at: row.updated_at,
      };
    });
  };
})();
