/**
 * @file Pure functions and candidate block lifecycle for Watched Period
 * ranking merges. Enables merge-sort across years and blocks within a
 * period scope (all-time, decade, century) with a strict rating guard
 * rail: films are compared shelf-by-shelf (e.g. 5.0★, 4.5★...), ensuring
 * higher-rated films always precede lower-rated films and auto-passing
 * non-overlapping rating shelves.
 */

(function () {
  /**
   * Lists available period scopes for watched ranking merges.
   * @param {Object[]} [watchedRows] Optional explicit watched rows.
   * @returns {{type: string, key: string, label: string, count: number}[]}
   */
  window.supabaseWatchedScopes = function (watchedRows) {
    let rows =
      watchedRows ||
      (window.getSupabaseWorkspace
        ? window.getSupabaseWorkspace()?.watched
        : []) ||
      [];
    let rated = rows.filter(
      (row) =>
        Number.isInteger(row.films?.year) &&
        (row.rating || window.supabaseRankingRatingKey?.(row)),
    );

    let scopes = [
      {
        type: "allTime",
        key: "alltime",
        label: "All-time",
        count: rated.length,
      },
    ];

    let decadeCounts = new Map();
    let centuryCounts = new Map();

    rated.forEach((row) => {
      let year = row.films.year;
      let decade = window.getDecadeKey
        ? window.getDecadeKey(year)
        : `${Math.floor(year / 10) * 10}s`;
      let century = window.getCenturyKey
        ? window.getCenturyKey(year)
        : `${Math.floor(year / 100) * 100}s`;

      decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
      centuryCounts.set(century, (centuryCounts.get(century) || 0) + 1);
    });

    let sortedDecades = [...decadeCounts.keys()]
      .filter((d) => (decadeCounts.get(d) || 0) >= 2)
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

    sortedDecades.forEach((decade) => {
      scopes.push({
        type: "decades",
        key: decade,
        label: decade,
        count: decadeCounts.get(decade),
      });
    });

    let sortedCenturies = [...centuryCounts.keys()]
      .filter((c) => (centuryCounts.get(c) || 0) >= 2)
      .sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));

    sortedCenturies.forEach((century) => {
      let label =
        century === "2000s"
          ? "21st century (2000s)"
          : century === "1900s"
            ? "20th century (1900s)"
            : century;
      scopes.push({
        type: "centuries",
        key: century,
        label,
        count: centuryCounts.get(century),
      });
    });

    return scopes;
  };

  /**
   * Returns populated integer release years present for a period scope.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @param {Object[]} [watchedRows]
   * @returns {number[]} Sorted ascending.
   */
  window.supabaseWatchedScopePopulatedYears = function (
    scopeType,
    scopeKey,
    watchedRows,
  ) {
    let rows =
      watchedRows ||
      (window.getSupabaseWorkspace
        ? window.getSupabaseWorkspace()?.watched
        : []) ||
      [];
    let years = new Set();
    rows.forEach((row) => {
      let year = row.films?.year;
      if (!Number.isInteger(year)) return;
      if (!row.rating && !window.supabaseRankingRatingKey?.(row)) return;
      if (
        window.supabaseRankingEntryInScope &&
        !window.supabaseRankingEntryInScope(scopeType, scopeKey, row)
      ) {
        return;
      }
      years.add(Number(year));
    });
    return [...years].sort((a, b) => a - b);
  };

  function blockStore(scopeType, scopeKey, watchedRows) {
    return window.createShelfMergeBlockStore(
      `oskars-watched-merge-blocks-${scopeType}-${scopeKey}`,
      () =>
        window.supabaseWatchedScopePopulatedYears(
          scopeType,
          scopeKey,
          watchedRows,
        ),
      (years) =>
        window.supabaseWatchedBlockItems(
          scopeType,
          scopeKey,
          years,
          null,
          watchedRows,
        ),
    );
  }

  /**
   * Loads candidate blocks for a watched period scope.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @param {Object[]} [watchedRows]
   * @returns {Object[]} Candidate blocks: {id, years, label, count, isSingle}.
   */
  window.loadWatchedMergeBlocks = function (scopeType, scopeKey, watchedRows) {
    return blockStore(scopeType, scopeKey, watchedRows).load();
  };

  /**
   * Unites two candidate blocks into one composite block.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @param {string} blockAId
   * @param {string} blockBId
   * @returns {Object[]}
   */
  window.uniteWatchedMergeBlocks = function (
    scopeType,
    scopeKey,
    blockAId,
    blockBId,
  ) {
    return blockStore(scopeType, scopeKey).unite(blockAId, blockBId);
  };

  /**
   * Splits a composite candidate block back into atomic single-year blocks.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @param {string} blockId
   * @returns {Object[]}
   */
  window.splitWatchedMergeBlock = function (scopeType, scopeKey, blockId) {
    return blockStore(scopeType, scopeKey).split(blockId);
  };

  /**
   * Resets candidate blocks for a watched period scope back to single-year blocks.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @returns {Object[]}
   */
  window.resetWatchedMergeBlocks = function (scopeType, scopeKey) {
    return blockStore(scopeType, scopeKey).reset();
  };

  /**
   * Groups all populated years in a watched period scope by decade.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @returns {Object[]}
   */
  window.groupWatchedMergeBlocksByDecade = function (scopeType, scopeKey) {
    return blockStore(scopeType, scopeKey).groupByDecade();
  };

  /**
   * Returns rated watched items for a candidate block's years, sorted by
   * rating shelf descending and intra-shelf position.
   * @param {string} scopeType
   * @param {string} scopeKey
   * @param {number[]} years
   * @param {Object[]} [rankingEntries] Ranking entries from loadSupabaseRanking().
   * @param {Object[]} [watchedRows]
   * @returns {Object[]}
   */
  window.supabaseWatchedBlockItems = function (
    scopeType,
    scopeKey,
    years,
    rankingEntries,
    watchedRows,
  ) {
    let rows =
      watchedRows ||
      (window.getSupabaseWorkspace
        ? window.getSupabaseWorkspace()?.watched
        : []) ||
      [];
    let yearSet = new Set((years || []).map(Number));

    let eligible = rows.filter((row) => {
      let year = row.films?.year;
      if (!Number.isInteger(year) || !yearSet.has(Number(year))) return false;
      if (!row.rating && !window.supabaseRankingRatingKey?.(row)) return false;
      if (
        window.supabaseRankingEntryInScope &&
        !window.supabaseRankingEntryInScope(scopeType, scopeKey, row)
      ) {
        return false;
      }
      return true;
    });

    let positionMap = new Map();
    (rankingEntries || []).forEach((entry, index) => {
      positionMap.set(entry.film_id, entry.position || index);
    });

    return eligible.sort((a, b) => {
      let keyA = window.supabaseRankingRatingKey
        ? window.supabaseRankingRatingKey(a)
        : String(a.rating || 0);
      let keyB = window.supabaseRankingRatingKey
        ? window.supabaseRankingRatingKey(b)
        : String(b.rating || 0);

      let valA = window.supabaseRankingRatingSortValueFromKey
        ? window.supabaseRankingRatingSortValueFromKey(keyA)
        : Number(a.rating || 0);
      let valB = window.supabaseRankingRatingSortValueFromKey
        ? window.supabaseRankingRatingSortValueFromKey(keyB)
        : Number(b.rating || 0);

      if (valA !== valB) return valB - valA;

      let posA = positionMap.get(a.film_id);
      let posB = positionMap.get(b.film_id);
      if (posA != null && posB != null) {
        return posA < posB ? -1 : posA > posB ? 1 : 0;
      }
      if (posA != null) return -1;
      if (posB != null) return 1;

      let yearA = a.films?.year || 0;
      let yearB = b.films?.year || 0;
      if (yearA !== yearB) return yearA - yearB;

      let titleA = a.films?.title || "";
      let titleB = b.films?.title || "";
      return window.compareEnglishTitles
        ? window.compareEnglishTitles(titleA, titleB)
        : titleA.localeCompare(titleB);
    });
  };

  function formatShelfLabel(sampleRow, key) {
    if (window.renderFilmRating && sampleRow) {
      let rendered = window.renderFilmRating(sampleRow);
      if (rendered) return rendered;
    }
    let parts = String(key || "").split("|");
    let val = parts[0];
    let mod = parts[1] === "plus" ? "＋" : parts[1] === "minus" ? "−" : "";
    return val ? `${val}★${mod}` : "Unrated";
  }

  /**
   * Creates a shelf-by-shelf merge session for Watched Period rankings.
   * Enforces rating guard rail: comparisons occur strictly shelf-by-shelf,
   * auto-passing non-overlapping shelves.
   * @param {Object[]} listA Ordered items from Group A.
   * @param {Object[]} listB Ordered items from Group B.
   * @returns {Object} Watched shelf merge session.
   */
  window.createWatchedShelfMergeSession = function (listA, listB) {
    return window.createShelfMergeSession(listA, listB, {
      gradeKey: (item) =>
        window.supabaseRankingRatingKey
          ? window.supabaseRankingRatingKey(item)
          : String(item.rating || ""),
      gradeValue: (key) =>
        window.supabaseRankingRatingSortValueFromKey
          ? window.supabaseRankingRatingSortValueFromKey(key)
          : Number(key) || 0,
      direction: -1,
      formatLabel: formatShelfLabel,
    });
  };

  /**
   * Records a pairwise ranking pick in the active shelf.
   * @param {Object} session
   * @param {'a'|'b'} side
   * @returns {Object}
   */
  window.pickWatchedMergeSide = function (session, side) {
    return window.pickShelfMergeSide(session, side);
  };

  /**
   * Undoes the last pairwise ranking pick in the watched merge session.
   * @param {Object} session
   * @returns {Object}
   */
  window.undoWatchedMergeChoice = function (session) {
    return window.undoShelfMergeChoice(session);
  };

  /**
   * Persists the merged film order for a period ranking to Supabase,
   * preserving all unmerged films' positions.
   * @param {string} scope
   * @param {string} scopeType
   * @param {string[]} orderedFilmIds
   * @returns {Promise<{ok: boolean, changed?: number, reason?: string}>}
   */
  window.applySupabaseWatchedPeriodMergeOrder = async function (
    scope,
    scopeType,
    orderedFilmIds,
  ) {
    let ready = await window.ensureSupabaseClient?.();
    if (!ready) throw new Error("Supabase not configured.");

    let ids = (orderedFilmIds || []).map(String).filter(Boolean);
    let idSet = new Set(ids);
    if (idSet.size < 2 || idSet.size !== ids.length) {
      return {
        ok: false,
        reason: "Choose at least two distinct films to merge.",
      };
    }

    let loaded = await window.loadSupabaseRanking(scope, scopeType);
    let entries = loaded?.entries || [];
    let existingPositions = entries
      .filter((entry) => idSet.has(entry.film_id))
      .map((entry) => entry.position);

    if (existingPositions.length !== ids.length) {
      return {
        ok: false,
        reason: "Some selected films are no longer in this ranking.",
      };
    }

    if (existingPositions.some((pos) => !pos)) {
      let firstIndex = entries.findIndex((entry) => idSet.has(entry.film_id));
      let beforePos = null;
      for (let i = firstIndex - 1; i >= 0; i--) {
        if (entries[i].position) {
          beforePos = entries[i].position;
          break;
        }
      }
      let lastIndex = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (idSet.has(entries[i].film_id)) {
          lastIndex = i;
          break;
        }
      }
      let afterPos = null;
      for (let i = lastIndex + 1; i < entries.length; i++) {
        if (entries[i].position) {
          afterPos = entries[i].position;
          break;
        }
      }
      let generated = [];
      let cur = beforePos;
      for (let i = 0; i < ids.length; i++) {
        let nextPos = window.fractionalPositionBetween
          ? window.fractionalPositionBetween(cur, afterPos)
          : String(i + 1);
        generated.push(nextPos);
        cur = nextPos;
      }
      existingPositions = generated;
    }

    let updates = ids.map((filmId, index) => ({
      ranking_id: loaded.rankingId,
      film_id: filmId,
      position: existingPositions[index],
      rank_confirmed: true,
      updated_at: new Date().toISOString(),
    }));

    let { error } = await ready.client
      .from("ranking_entries")
      .upsert(updates, { onConflict: "ranking_id,film_id" });
    if (error) throw error;

    return { ok: true, changed: updates.length };
  };
})();
