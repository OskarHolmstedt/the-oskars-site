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
      (left, right) =>
        Number(left.replace(/s$/, "")) - Number(right.replace(/s$/, "")),
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
  window.supabaseWatchlistTierPeriodScopeItems = function (
    tier,
    periodType,
    periodKey,
  ) {
    let items = window.supabaseWatchlistTierItemsInOrder(tier);
    if (periodType === "all") return items;
    return items.filter((row) => {
      let year = row.films?.year;
      if (!Number.isInteger(year)) return false;
      if (periodType === "year") return String(year) === periodKey;
      if (periodType === "decade")
        return window.getDecadeKey(year) === periodKey;
      if (periodType === "century")
        return window.getCenturyKey(year) === periodKey;
      return false;
    });
  };

  let memoryStorage = new Map();
  function getStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  }
  function setStorageItem(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {
      memoryStorage.set(key, val);
    }
  }
  function removeStorageItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      memoryStorage.delete(key);
    }
  }

  /**
   * Formats an array of release years into a human-readable span or list.
   * Contiguous spans use en-dashes (e.g. "1951–1952", "1950–1953"), full
   * decades format as decade labels (e.g. "1950s"), and disjoint ranges
   * are joined with commas (e.g. "1947, 2003").
   * @param {number[]} years
   * @returns {string} Formatted label.
   */
  window.formatWatchlistMergeBlockLabel = function (years) {
    if (!Array.isArray(years) || !years.length) return "";
    let sorted = [...new Set(years.map(Number).filter(Number.isInteger))].sort(
      (a, b) => a - b,
    );
    if (!sorted.length) return "";

    let runs = [];
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      let prev = sorted[i - 1];
      let curr = sorted[i];
      if (curr === prev + 1) {
        current.push(curr);
      } else {
        runs.push(current);
        current = [curr];
      }
    }
    runs.push(current);

    let parts = runs.map((run) => {
      if (run.length === 1) return String(run[0]);
      if (run.length === 10 && run[0] % 10 === 0 && window.getDecadeKey) {
        return window.getDecadeKey(run[0]);
      }
      return `${run[0]}–${run[run.length - 1]}`;
    });

    return parts.join(", ");
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

  /**
   * Loads candidate blocks for a tier, restoring persisted multi-year
   * blocks and defaulting unassigned years to atomic single-year blocks.
   * @param {string} tier
   * @returns {Object[]} Array of candidate block descriptors: {id, years, label, count, isSingle}.
   */
  window.loadWatchlistMergeBlocks = function (tier) {
    let populatedYears = window.supabaseWatchlistTierPopulatedYears(tier);
    let populatedSet = new Set(populatedYears);
    let key = "oskars-watchlist-merge-blocks-" + tier;
    let savedRaw = getStorageItem(key);
    let rawBlocks = [];

    if (savedRaw) {
      try {
        let parsed = JSON.parse(savedRaw);
        if (Array.isArray(parsed)) {
          let seenYears = new Set();
          parsed.forEach((entry) => {
            if (!Array.isArray(entry)) return;
            let validYears = entry
              .map(Number)
              .filter((y) => populatedSet.has(y) && !seenYears.has(y));
            if (validYears.length) {
              validYears.forEach((y) => seenYears.add(y));
              rawBlocks.push(validYears.sort((a, b) => a - b));
            }
          });
          populatedYears.forEach((year) => {
            if (!seenYears.has(year)) rawBlocks.push([year]);
          });
        }
      } catch {
        rawBlocks = [];
      }
    }

    if (!rawBlocks.length) {
      rawBlocks = populatedYears.map((year) => [year]);
    }

    rawBlocks.sort((left, right) => Math.min(...left) - Math.min(...right));

    return rawBlocks.map((years) => {
      let items = window.supabaseWatchlistBlockScopeItems(tier, years);
      return {
        id: years.join(","),
        years,
        label: window.formatWatchlistMergeBlockLabel(years),
        count: items.length,
        isSingle: years.length === 1,
      };
    });
  };

  /**
   * Persists candidate blocks for a tier.
   * @param {string} tier
   * @param {Array<Object|number[]>} blocks
   */
  window.saveWatchlistMergeBlocks = function (tier, blocks) {
    let yearArrays = (blocks || [])
      .map((b) =>
        (Array.isArray(b) ? b : b?.years || [])
          .map(Number)
          .sort((a, b) => a - b),
      )
      .filter((arr) => arr.length > 0);
    setStorageItem(
      "oskars-watchlist-merge-blocks-" + tier,
      JSON.stringify(yearArrays),
    );
  };

  /**
   * Unites two candidate blocks into one composite block.
   * @param {string} tier
   * @param {string} blockAId
   * @param {string} blockBId
   * @returns {Object[]} Updated candidate blocks.
   */
  window.uniteWatchlistMergeBlocks = function (tier, blockAId, blockBId) {
    if (!blockAId || !blockBId || blockAId === blockBId) {
      return window.loadWatchlistMergeBlocks(tier);
    }
    let blocks = window.loadWatchlistMergeBlocks(tier);
    let blockA = blocks.find((b) => b.id === blockAId);
    let blockB = blocks.find((b) => b.id === blockBId);
    if (!blockA || !blockB) return blocks;

    let unitedYears = [...new Set([...blockA.years, ...blockB.years])].sort(
      (a, b) => a - b,
    );

    let remainingBlocks = blocks
      .filter((b) => b.id !== blockAId && b.id !== blockBId)
      .map((b) => b.years);
    remainingBlocks.push(unitedYears);

    window.saveWatchlistMergeBlocks(tier, remainingBlocks);
    return window.loadWatchlistMergeBlocks(tier);
  };

  /**
   * Splits a composite candidate block back into atomic single-year blocks.
   * @param {string} tier
   * @param {string} blockId
   * @returns {Object[]} Updated candidate blocks.
   */
  window.splitWatchlistMergeBlock = function (tier, blockId) {
    let blocks = window.loadWatchlistMergeBlocks(tier);
    let target = blocks.find((b) => b.id === blockId);
    if (!target || target.isSingle) return blocks;

    let remaining = blocks.filter((b) => b.id !== blockId).map((b) => b.years);
    target.years.forEach((year) => remaining.push([year]));

    window.saveWatchlistMergeBlocks(tier, remaining);
    return window.loadWatchlistMergeBlocks(tier);
  };

  /**
   * Resets candidate blocks for a tier back to atomic single-year blocks.
   * @param {string} tier
   * @returns {Object[]} Initial single-year blocks.
   */
  window.resetWatchlistMergeBlocks = function (tier) {
    removeStorageItem("oskars-watchlist-merge-blocks-" + tier);
    return window.loadWatchlistMergeBlocks(tier);
  };

  /**
   * Groups all populated years in a tier by decade.
   * @param {string} tier
   * @returns {Object[]} Decade-grouped candidate blocks.
   */
  window.groupWatchlistMergeBlocksByDecade = function (tier) {
    let populatedYears = window.supabaseWatchlistTierPopulatedYears(tier);
    let decadeGroups = new Map();
    populatedYears.forEach((year) => {
      let decade = window.getDecadeKey
        ? window.getDecadeKey(year)
        : `${Math.floor(year / 10) * 10}s`;
      if (!decadeGroups.has(decade)) decadeGroups.set(decade, []);
      decadeGroups.get(decade).push(year);
    });
    let yearArrays = [...decadeGroups.values()];
    window.saveWatchlistMergeBlocks(tier, yearArrays);
    return window.loadWatchlistMergeBlocks(tier);
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

  function syncWatchlistShelfSession(session) {
    while (session.currentShelfIndex < session.shelves.length) {
      let shelf = session.shelves[session.currentShelfIndex];
      if (shelf.pointerA >= shelf.listA.length) {
        if (shelf.pointerB < shelf.listB.length) {
          let remainder = shelf.listB.slice(shelf.pointerB);
          shelf.merged.push(...remainder);
          session.merged.push(...remainder);
          shelf.pointerB = shelf.listB.length;
        }
        session.currentShelfIndex += 1;
        continue;
      }
      if (shelf.pointerB >= shelf.listB.length) {
        if (shelf.pointerA < shelf.listA.length) {
          let remainder = shelf.listA.slice(shelf.pointerA);
          shelf.merged.push(...remainder);
          session.merged.push(...remainder);
          shelf.pointerA = shelf.listA.length;
        }
        session.currentShelfIndex += 1;
        continue;
      }
      // Interactive shelf reached
      session.currentShelf = shelf;
      session.listA = shelf.listA;
      session.listB = shelf.listB;
      session.pointerA = shelf.pointerA;
      session.pointerB = shelf.pointerB;
      session.shelfLabel = shelf.label;
      session.done = false;
      return session;
    }

    session.currentShelf = null;
    session.listA = [];
    session.listB = [];
    session.pointerA = 0;
    session.pointerB = 0;
    session.shelfLabel = "";
    session.done = true;
    return session;
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
    let mapA = new Map();
    (listA || []).forEach((item) => {
      let key = window.supabaseWatchlistTierGradeKey(item);
      if (!mapA.has(key)) mapA.set(key, []);
      mapA.get(key).push(item);
    });

    let mapB = new Map();
    (listB || []).forEach((item) => {
      let key = window.supabaseWatchlistTierGradeKey(item);
      if (!mapB.has(key)) mapB.set(key, []);
      mapB.get(key).push(item);
    });

    let allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    let sortedKeys = [...allKeys].sort((a, b) => {
      let valA = window.supabaseWatchlistTierGradeSortValueFromKey(a);
      let valB = window.supabaseWatchlistTierGradeSortValueFromKey(b);
      return valA - valB; // Ascending grade: 0 (S+) comes first, 20 (F-) comes last
    });

    let shelves = sortedKeys.map((key) => {
      let shelfA = mapA.get(key) || [];
      let shelfB = mapB.get(key) || [];
      let sample = shelfA[0] || shelfB[0];
      return {
        key,
        label: formatWatchlistShelfLabel(sample, key),
        listA: shelfA,
        listB: shelfB,
        pointerA: 0,
        pointerB: 0,
        merged: [],
      };
    });

    let session = {
      shelves,
      currentShelfIndex: 0,
      merged: [],
      history: [],
      done: false,
      listA: [],
      listB: [],
      pointerA: 0,
      pointerB: 0,
      currentShelf: null,
      shelfLabel: "",
    };

    syncWatchlistShelfSession(session);
    return session;
  };

  /**
   * Records a pairwise ranking pick in the active watchlist shelf.
   * @param {Object} session
   * @param {'a'|'b'} side
   * @returns {Object}
   */
  window.pickWatchlistMergeSide = function (session, side) {
    if (!session || session.done || !session.currentShelf) return session;

    let shelf = session.currentShelf;
    let historyEntry = {
      shelfIndex: session.currentShelfIndex,
      side,
      mergedCountBefore: session.merged.length,
      shelvesState: session.shelves.map((s) => ({
        pointerA: s.pointerA,
        pointerB: s.pointerB,
        mergedLen: s.merged.length,
      })),
    };

    let item =
      side === "a" ? shelf.listA[shelf.pointerA] : shelf.listB[shelf.pointerB];
    shelf.merged.push(item);
    session.merged.push(item);

    if (side === "a") shelf.pointerA += 1;
    else shelf.pointerB += 1;

    session.history.push(historyEntry);
    syncWatchlistShelfSession(session);
    return session;
  };

  /**
   * Undoes the last pairwise ranking pick in the watchlist merge session.
   * @param {Object} session
   * @returns {Object}
   */
  window.undoWatchlistMergeChoice = function (session) {
    if (!session || !session.history || !session.history.length) return session;

    let entry = session.history.pop();
    session.merged.length = entry.mergedCountBefore;
    session.shelves.forEach((s, idx) => {
      let saved = entry.shelvesState[idx];
      s.pointerA = saved.pointerA;
      s.pointerB = saved.pointerB;
      s.merged.length = saved.mergedLen;
    });

    session.currentShelfIndex = entry.shelfIndex;
    syncWatchlistShelfSession(session);
    return session;
  };
})();
