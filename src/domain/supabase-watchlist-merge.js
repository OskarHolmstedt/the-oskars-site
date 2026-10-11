/**
 * @file Pure read-side helpers over getSupabaseWorkspace().watchlist
 * (issue #421) - the Supabase-row-shaped counterpart to
 * src/domain/watchlists.js's watchlistTierItemsInOrder()/
 * watchlistPeriodKeys()/watchlistTierPeriodScopeItems(). Structurally
 * simpler than the original: every watchlist row's joined `films` object
 * already carries a real `year`, so there's no "watchlist item's own
 * field vs. archive-film fallback" split to reconcile - Supabase has one
 * unified films table, not two representations of a film to merge.
 *
 * window.WATCHLIST_TIERS (src/domain/watchlists.js) is reused as-is -
 * that file loads unconditionally for every page already, and the tier
 * list itself (S..F) has nothing to do with which backend stores the
 * items. window.getDecadeKey/getCenturyKey (src/core/state.js) are also
 * reused as-is - trivial, pure year-to-period-key math, no state
 * coupling at all.
 *
 * No DOM, no Supabase SDK import - directly Node-testable.
 */

(function () {
  /**
   * One interest tier's watchlist rows, in their current position order,
   * respecting the 21-level interest tier grade scale (S+ down to F-).
   * @param {string} tier
   * @returns {Object[]} Watchlist rows (each already joined with its film).
   */
  window.supabaseWatchlistTierItemsInOrder = function (tier) {
    let workspace = window.getSupabaseWorkspace();
    return (workspace?.watchlist || [])
      .filter((row) => (tier === "all" ? Boolean(row.tier) : row.tier === tier))
      .sort((left, right) => {
        let gradeLeft = window.watchlistTierGrade
          ? window.watchlistTierGrade(
              left.tier,
              left.tier_modifier || left.tierModifier,
            )
          : 0;
        let gradeRight = window.watchlistTierGrade
          ? window.watchlistTierGrade(
              right.tier,
              right.tier_modifier || right.tierModifier,
            )
          : 0;
        if (gradeLeft !== gradeRight) return gradeLeft - gradeRight;

        let leftHas = left.position != null && left.position !== "";
        let rightHas = right.position != null && right.position !== "";
        if (leftHas && rightHas) {
          return left.position < right.position
            ? -1
            : left.position > right.position
              ? 1
              : 0;
        }
        if (leftHas && !rightHas) return -1;
        if (!leftHas && rightHas) return 1;
        let leftYear = Number(left.films?.year || 9999);
        let rightYear = Number(right.films?.year || 9999);
        if (leftYear !== rightYear) return leftYear - rightYear;
        return window.compareEnglishTitles
          ? window.compareEnglishTitles(left.films?.title, right.films?.title)
          : String(left.films?.title || "").localeCompare(
              String(right.films?.title || ""),
            );
      });
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
   * Lists all populated integer release years present for a tier.
   * @param {string} tier
   * @returns {number[]} Sorted ascending.
   */
  window.supabaseWatchlistTierPopulatedYears = function (tier) {
    let years = new Set();
    window.supabaseWatchlistTierItemsInOrder(tier).forEach((row) => {
      let year = row.films?.year;
      if (Number.isInteger(year)) years.add(Number(year));
    });
    return [...years].sort((a, b) => a - b);
  };

  /**
   * Filters one tier's items to a set of years, preserving existing
   * relative order.
   * @param {string} tier
   * @param {number[]} years
   * @returns {Object[]} Watchlist rows.
   */
  window.supabaseWatchlistBlockScopeItems = function (tier, years) {
    let yearSet = new Set((years || []).map(Number));
    return window
      .supabaseWatchlistTierItemsInOrder(tier)
      .filter((row) => yearSet.has(Number(row.films?.year)));
  };

  function blockStore(tier) {
    return window.createShelfMergeBlockStore(
      "oskars-watchlist-merge-blocks-" + tier,
      () => window.supabaseWatchlistTierPopulatedYears(tier),
      (years) => window.supabaseWatchlistBlockScopeItems(tier, years),
    );
  }

  /**
   * Loads candidate blocks for a tier, restoring persisted multi-year
   * blocks and defaulting unassigned years to atomic single-year blocks.
   * @param {string} tier
   * @returns {Object[]} Array of candidate block descriptors: {id, years, label, count, isSingle}.
   */
  window.loadWatchlistMergeBlocks = function (tier) {
    return blockStore(tier).load();
  };

  /**
   * Unites two candidate blocks into one composite block.
   * @param {string} tier
   * @param {string} blockAId
   * @param {string} blockBId
   * @returns {Object[]} Updated candidate blocks.
   */
  window.uniteWatchlistMergeBlocks = function (tier, blockAId, blockBId) {
    return blockStore(tier).unite(blockAId, blockBId);
  };

  /**
   * Splits a composite candidate block back into atomic single-year blocks.
   * @param {string} tier
   * @param {string} blockId
   * @returns {Object[]} Updated candidate blocks.
   */
  window.splitWatchlistMergeBlock = function (tier, blockId) {
    return blockStore(tier).split(blockId);
  };

  /**
   * Resets candidate blocks for a tier back to atomic single-year blocks.
   * @param {string} tier
   * @returns {Object[]} Initial single-year blocks.
   */
  window.resetWatchlistMergeBlocks = function (tier) {
    return blockStore(tier).reset();
  };

  /**
   * Groups all populated years in a tier by decade.
   * @param {string} tier
   * @returns {Object[]} Decade-grouped candidate blocks.
   */
  window.groupWatchlistMergeBlocksByDecade = function (tier) {
    return blockStore(tier).groupByDecade();
  };

  /**
   * Builds an exact interest tier grade bucket key (e.g. "A|plus", "A|", "A|minus").
   * @param {{tier?: string, tier_modifier?: string, tierModifier?: string}} item
   * @returns {string} Bucket key or "" when unset.
   */
  window.supabaseWatchlistTierGradeKey = function (item) {
    let tier = window.normalizeWatchlistTier
      ? window.normalizeWatchlistTier(item?.tier)
      : String(item?.tier || "")
          .trim()
          .toUpperCase();
    let modifier = window.normalizeTierModifierValue
      ? window.normalizeTierModifierValue(
          item?.tier_modifier || item?.tierModifier,
        )
      : item?.tier_modifier || item?.tierModifier || "";
    return tier ? `${tier}|${modifier}` : "";
  };

  /**
   * Returns the exact 0–20 integer sort grade for a watchlist tier key.
   * @param {string} key
   * @returns {number}
   */
  window.supabaseWatchlistTierGradeSortValueFromKey = function (key) {
    let parts = String(key || "").split("|");
    let tier = parts[0] || "";
    let modifier = parts[1] || "";
    return window.watchlistTierGrade
      ? window.watchlistTierGrade(tier, modifier)
      : 0;
  };

  function formatWatchlistShelfLabel(sample, key) {
    let parts = String(key || "").split("|");
    let tier = parts[0];
    let mod = parts[1];
    let badge = window.renderTierWithModifier
      ? window.renderTierWithModifier(tier, mod)
      : `${tier}${mod === "plus" ? "＋" : mod === "minus" ? "−" : ""}`;
    return badge ? `Tier ${badge}` : "Unset";
  }

  /**
   * Creates a shelf-by-shelf merge session for Watchlist rankings.
   * Enforces interest tier guard rail across the 21-level scale (S+ down to F-):
   * comparisons occur strictly shelf-by-shelf, auto-passing non-overlapping shelves.
   * @param {Object[]} listA Ordered items from Group A.
   * @param {Object[]} listB Ordered items from Group B.
   * @returns {Object} Watchlist shelf merge session.
   */
  window.createWatchlistShelfMergeSession = function (listA, listB) {
    return window.createShelfMergeSession(listA, listB, {
      gradeKey: (item) => window.supabaseWatchlistTierGradeKey(item),
      gradeValue: (key) =>
        window.supabaseWatchlistTierGradeSortValueFromKey(key),
      direction: 1,
      formatLabel: formatWatchlistShelfLabel,
    });
  };

  /**
   * Records a pairwise ranking pick in the active watchlist shelf.
   * @param {Object} session
   * @param {'a'|'b'} side
   * @returns {Object}
   */
  window.pickWatchlistMergeSide = function (session, side) {
    return window.pickShelfMergeSide(session, side);
  };

  /**
   * Undoes the last pairwise ranking pick in the watchlist merge session.
   * @param {Object} session
   * @returns {Object}
   */
  window.undoWatchlistMergeChoice = function (session) {
    return window.undoShelfMergeChoice(session);
  };
})();
