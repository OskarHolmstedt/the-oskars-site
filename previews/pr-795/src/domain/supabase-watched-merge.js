/**
 * @file Pure functions and candidate block lifecycle for Watched Period
 * ranking merges. Enables merge-sort across years and blocks within a
 * period scope (all-time, decade, century) with a strict rating guard
 * rail: films are compared shelf-by-shelf (e.g. 5.0★, 4.5★...), ensuring
 * higher-rated films always precede lower-rated films and auto-passing
 * non-overlapping rating shelves.
 */

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
 * @param {number[]} years
 * @returns {string} Formatted label.
 */
window.formatWatchedMergeBlockLabel = function (years) {
  if (typeof window.formatWatchlistMergeBlockLabel === "function") {
    return window.formatWatchlistMergeBlockLabel(years);
  }
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

/**
 * Loads candidate blocks for a watched period scope.
 * @param {string} scopeType
 * @param {string} scopeKey
 * @param {Object[]} [watchedRows]
 * @returns {Object[]} Candidate blocks: {id, years, label, count, isSingle}.
 */
window.loadWatchedMergeBlocks = function (scopeType, scopeKey, watchedRows) {
  let populatedYears = window.supabaseWatchedScopePopulatedYears(
    scopeType,
    scopeKey,
    watchedRows,
  );
  let populatedSet = new Set(populatedYears);
  let storageKey = `oskars-watched-merge-blocks-${scopeType}-${scopeKey}`;
  let savedRaw = getStorageItem(storageKey);
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
    let items = window.supabaseWatchedBlockItems(
      scopeType,
      scopeKey,
      years,
      null,
      watchedRows,
    );
    return {
      id: years.join(","),
      years,
      label: window.formatWatchedMergeBlockLabel(years),
      count: items.length,
      isSingle: years.length === 1,
    };
  });
};

/**
 * Persists candidate blocks for a watched period scope.
 * @param {string} scopeType
 * @param {string} scopeKey
 * @param {Array<Object|number[]>} blocks
 */
window.saveWatchedMergeBlocks = function (scopeType, scopeKey, blocks) {
  let yearArrays = (blocks || [])
    .map((b) =>
      (Array.isArray(b) ? b : b?.years || []).map(Number).sort((a, b) => a - b),
    )
    .filter((arr) => arr.length > 0);
  setStorageItem(
    `oskars-watched-merge-blocks-${scopeType}-${scopeKey}`,
    JSON.stringify(yearArrays),
  );
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
  if (!blockAId || !blockBId || blockAId === blockBId) {
    return window.loadWatchedMergeBlocks(scopeType, scopeKey);
  }
  let blocks = window.loadWatchedMergeBlocks(scopeType, scopeKey);
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

  window.saveWatchedMergeBlocks(scopeType, scopeKey, remainingBlocks);
  return window.loadWatchedMergeBlocks(scopeType, scopeKey);
};

/**
 * Splits a composite candidate block back into atomic single-year blocks.
 * @param {string} scopeType
 * @param {string} scopeKey
 * @param {string} blockId
 * @returns {Object[]}
 */
window.splitWatchedMergeBlock = function (scopeType, scopeKey, blockId) {
  let blocks = window.loadWatchedMergeBlocks(scopeType, scopeKey);
  let target = blocks.find((b) => b.id === blockId);
  if (!target || target.isSingle) return blocks;

  let remaining = blocks.filter((b) => b.id !== blockId).map((b) => b.years);
  target.years.forEach((year) => remaining.push([year]));

  window.saveWatchedMergeBlocks(scopeType, scopeKey, remaining);
  return window.loadWatchedMergeBlocks(scopeType, scopeKey);
};

/**
 * Resets candidate blocks for a watched period scope back to single-year blocks.
 * @param {string} scopeType
 * @param {string} scopeKey
 * @returns {Object[]}
 */
window.resetWatchedMergeBlocks = function (scopeType, scopeKey) {
  removeStorageItem(`oskars-watched-merge-blocks-${scopeType}-${scopeKey}`);
  return window.loadWatchedMergeBlocks(scopeType, scopeKey);
};

/**
 * Groups all populated years in a watched period scope by decade.
 * @param {string} scopeType
 * @param {string} scopeKey
 * @returns {Object[]}
 */
window.groupWatchedMergeBlocksByDecade = function (scopeType, scopeKey) {
  let populatedYears = window.supabaseWatchedScopePopulatedYears(
    scopeType,
    scopeKey,
  );
  let decadeGroups = new Map();
  populatedYears.forEach((year) => {
    let decade = window.getDecadeKey
      ? window.getDecadeKey(year)
      : `${Math.floor(year / 10) * 10}s`;
    if (!decadeGroups.has(decade)) decadeGroups.set(decade, []);
    decadeGroups.get(decade).push(year);
  });
  let yearArrays = [...decadeGroups.values()];
  window.saveWatchedMergeBlocks(scopeType, scopeKey, yearArrays);
  return window.loadWatchedMergeBlocks(scopeType, scopeKey);
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
  let mod = parts[1] === "plus" ? "＋" : parts[1] === "minus" ? "—" : "";
  return val ? `${val}★${mod}` : "Unrated";
}

function syncWatchedShelfSession(session) {
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
 * Creates a shelf-by-shelf merge session for Watched Period rankings.
 * Enforces rating guard rail: comparisons occur strictly shelf-by-shelf,
 * auto-passing non-overlapping shelves.
 * @param {Object[]} listA Ordered items from Group A.
 * @param {Object[]} listB Ordered items from Group B.
 * @returns {Object} Watched shelf merge session.
 */
window.createWatchedShelfMergeSession = function (listA, listB) {
  let mapA = new Map();
  (listA || []).forEach((item) => {
    let key = window.supabaseRankingRatingKey
      ? window.supabaseRankingRatingKey(item)
      : String(item.rating || "");
    if (!mapA.has(key)) mapA.set(key, []);
    mapA.get(key).push(item);
  });

  let mapB = new Map();
  (listB || []).forEach((item) => {
    let key = window.supabaseRankingRatingKey
      ? window.supabaseRankingRatingKey(item)
      : String(item.rating || "");
    if (!mapB.has(key)) mapB.set(key, []);
    mapB.get(key).push(item);
  });

  let allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  let sortedKeys = [...allKeys].sort((a, b) => {
    let valA = window.supabaseRankingRatingSortValueFromKey
      ? window.supabaseRankingRatingSortValueFromKey(a)
      : Number(a) || 0;
    let valB = window.supabaseRankingRatingSortValueFromKey
      ? window.supabaseRankingRatingSortValueFromKey(b)
      : Number(b) || 0;
    return valB - valA;
  });

  let shelves = sortedKeys.map((key) => {
    let shelfA = mapA.get(key) || [];
    let shelfB = mapB.get(key) || [];
    let sample = shelfA[0] || shelfB[0];
    return {
      key,
      label: formatShelfLabel(sample, key),
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

  syncWatchedShelfSession(session);
  return session;
};

/**
 * Records a pairwise ranking pick in the active shelf.
 * @param {Object} session
 * @param {'a'|'b'} side
 * @returns {Object}
 */
window.pickWatchedMergeSide = function (session, side) {
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
  syncWatchedShelfSession(session);
  return session;
};

/**
 * Undoes the last pairwise ranking pick in the watched merge session.
 * @param {Object} session
 * @returns {Object}
 */
window.undoWatchedMergeChoice = function (session) {
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
  syncWatchedShelfSession(session);
  return session;
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
