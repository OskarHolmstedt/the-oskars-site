/**
 * @file Caches loadSupabaseHydrationDomains()'s raw payload in
 * sessionStorage so a same-tab page navigation - this is a multi-page app,
 * every nav is a full static-HTML reload - can skip re-fetching and
 * re-joining the entire watched/watchlist/rankings/personal-awards/
 * film-and-franchise-catalog dataset from Supabase on every single page
 * visit. Keyed by user id so a different account signing in on the same
 * tab never sees a stale cache. A short TTL bounds staleness from another
 * tab/device; invalidateCachedSupabaseHydrationSource() below is also
 * called after every mutation function in supabase-workspace.js succeeds
 * (wrapped generically here rather than editing each function body), so a
 * same-session write-then-navigate flow always sees fresh data.
 */

// Version the key whenever the raw hydration-source contract changes so a
// payload written by older loader code cannot survive into an incompatible
// reader after a reload.
window.OSKARS_HYDRATION_CACHE_KEY = "oskars-supabase-hydration-cache:v5";
window.OSKARS_HYDRATION_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Reads the cached hydration source for the given user, if any and still
 * fresh.
 * @param {string} [userId] The signed-in user's id.
 * @returns {Object|null} The cached raw source, or null on a miss.
 */
window.readCachedSupabaseHydrationSource = function (userId) {
  if (!userId) return null;
  try {
    let raw = sessionStorage.getItem(window.OSKARS_HYDRATION_CACHE_KEY);
    if (!raw) return null;
    let entry = JSON.parse(raw);
    if (
      entry?.userId !== userId ||
      typeof entry?.savedAt !== "number" ||
      Date.now() - entry.savedAt > window.OSKARS_HYDRATION_CACHE_TTL_MS
    )
      return null;
    return entry.source || null;
  } catch (err) {
    return null;
  }
};

// Domain sets whose serialized source overflowed sessionStorage in this tab.
// A source holding every domain of such a set is at least as large, so its
// write is skipped instead of serialized only to fail again.
window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY =
  "oskars-supabase-hydration-cache-overflow:v1";

function hydrationCacheDomains(source) {
  return Array.isArray(source?.domains) ? source.domains : ["*"];
}

function readHydrationCacheOverflows(userId) {
  try {
    let entry = JSON.parse(
      sessionStorage.getItem(window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY) ||
        "null",
    );
    return entry?.userId === userId && Array.isArray(entry.domainSets)
      ? entry.domainSets
      : [];
  } catch (err) {
    return [];
  }
}

function hydrationCacheKnownToOverflow(userId, domains) {
  return readHydrationCacheOverflows(userId).some((overflowed) =>
    overflowed.includes("*")
      ? domains.includes("*")
      : domains.includes("*") ||
        overflowed.every((domain) => domains.includes(domain)),
  );
}

function rememberHydrationCacheOverflow(userId, domains) {
  try {
    sessionStorage.setItem(
      window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY,
      JSON.stringify({
        userId,
        domainSets: [...readHydrationCacheOverflows(userId), domains],
      }),
    );
  } catch (err) {}
}

function isStorageQuotaError(err) {
  return (
    err?.name === "QuotaExceededError" ||
    err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err?.code === 22 ||
    err?.code === 1014
  );
}

/**
 * Writes a freshly-loaded hydration source to the cache.
 * @param {string} userId The signed-in user's id.
 * @param {Object} source A raw source from loadSupabaseHydrationDomains(); its
 * `domains` says which parts of the archive it holds.
 */
window.writeCachedSupabaseHydrationSource = function (userId, source) {
  if (!userId) return;
  let finishWrite = window.startOskarsPerformance?.("hydration:cacheWrite");
  let domains = hydrationCacheDomains(source);
  if (hydrationCacheKnownToOverflow(userId, domains)) {
    finishWrite?.("skipped: too large");
    return;
  }
  try {
    sessionStorage.setItem(
      window.OSKARS_HYDRATION_CACHE_KEY,
      JSON.stringify({ userId, savedAt: Date.now(), source }),
    );
    finishWrite?.("stored");
  } catch (err) {
    if (isStorageQuotaError(err))
      rememberHydrationCacheOverflow(userId, domains);
    finishWrite?.("unavailable");
    // Storage quota exceeded or disabled (private browsing, etc.) - caching
    // is a pure optimization, so a write failure just means every page
    // re-fetches, not a broken app.
  }
};

window.OSKARS_PEOPLE_EDGES_CACHE_KEY = "oskars-people-edges-cache:v1";

/**
 * Reads cached read_people_directory_edges() rows for the given user, if
 * fresh. Rows cached with every watchlist item also answer a preview
 * request: the preview is the first three of the same ordered items.
 * @param {string} userId The signed-in user's id.
 * @param {boolean} allWatchlistItems Whether the caller needs every item.
 * @returns {Object[]|null} The rows, or null on a miss.
 */
window.readCachedPeopleDirectoryEdges = function (userId, allWatchlistItems) {
  if (!userId) return null;
  try {
    let entry = JSON.parse(
      sessionStorage.getItem(window.OSKARS_PEOPLE_EDGES_CACHE_KEY) || "null",
    );
    if (
      entry?.userId !== userId ||
      typeof entry.savedAt !== "number" ||
      Date.now() - entry.savedAt > window.OSKARS_HYDRATION_CACHE_TTL_MS ||
      !Array.isArray(entry.rows) ||
      (allWatchlistItems && !entry.allWatchlistItems)
    )
      return null;
    if (allWatchlistItems || !entry.allWatchlistItems) return entry.rows;
    return entry.rows.map((row) => ({
      ...row,
      watchlist_preview: (row.watchlist_preview || []).slice(0, 3),
    }));
  } catch (err) {
    return null;
  }
};

/**
 * Caches read_people_directory_edges() rows, keeping an existing
 * every-item entry rather than replacing it with a preview.
 * @param {string} userId The signed-in user's id.
 * @param {boolean} allWatchlistItems Whether the rows carry every item.
 * @param {Object[]} rows The RPC rows.
 */
window.writeCachedPeopleDirectoryEdges = function (
  userId,
  allWatchlistItems,
  rows,
) {
  if (!userId) return;
  if (!allWatchlistItems && window.readCachedPeopleDirectoryEdges(userId, true))
    return;
  try {
    sessionStorage.setItem(
      window.OSKARS_PEOPLE_EDGES_CACHE_KEY,
      JSON.stringify({
        userId,
        savedAt: Date.now(),
        allWatchlistItems: Boolean(allWatchlistItems),
        rows,
      }),
    );
  } catch (err) {
    // Storage full or disabled: the next visit simply fetches again.
  }
};

window.OSKARS_FILM_DETAIL_CACHE_PREFIX = "oskars-film-detail-cache:v1:";

/**
 * Reads cached loadSupabaseFilmDetail() source for a specific user and film, if fresh.
 * @param {string} [userId] The signed-in user's id.
 * @param {string} [filmId] The target film's id.
 * @returns {Object|null} The cached film detail source, or null on a miss.
 */
window.readCachedSupabaseFilmDetail = function (userId, filmId) {
  if (!userId || !filmId) return null;
  try {
    let raw = sessionStorage.getItem(
      `${window.OSKARS_FILM_DETAIL_CACHE_PREFIX}${userId}:${filmId}`,
    );
    if (!raw) return null;
    let entry = JSON.parse(raw);
    if (
      entry?.userId !== userId ||
      entry?.filmId !== filmId ||
      typeof entry.savedAt !== "number" ||
      Date.now() - entry.savedAt > window.OSKARS_HYDRATION_CACHE_TTL_MS
    )
      return null;
    return entry.source || null;
  } catch (err) {
    return null;
  }
};

/**
 * Writes a freshly-loaded film detail source to sessionStorage.
 * @param {string} userId The signed-in user's id.
 * @param {string} filmId The target film's id.
 * @param {Object} source The raw film detail source.
 */
window.writeCachedSupabaseFilmDetail = function (userId, filmId, source) {
  if (!userId || !filmId || !source) return;
  try {
    sessionStorage.setItem(
      `${window.OSKARS_FILM_DETAIL_CACHE_PREFIX}${userId}:${filmId}`,
      JSON.stringify({
        userId,
        filmId,
        savedAt: Date.now(),
        source,
      }),
    );
  } catch (err) {
    // Storage full or disabled: the next visit simply fetches again.
  }
};

/**
 * Clears all cached film detail entries from sessionStorage.
 */
window.clearCachedSupabaseFilmDetails = function () {
  try {
    let prefix = window.OSKARS_FILM_DETAIL_CACHE_PREFIX;
    let toRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      let key = sessionStorage.key(i);
      if (key && key.indexOf(prefix) === 0) toRemove.push(key);
    }
    toRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch (err) {}
};

window.OSKARS_HYDRATION_INVALIDATION_KEY = "oskars-hydration-invalidation:v1";

/** Clears cached hydration (and cached people edges / film details) and notifies active shell consumers. @param {boolean} [broadcast] Whether to notify other tabs after a local write. */
window.invalidateCachedSupabaseHydrationSource = function (broadcast = true) {
  try {
    sessionStorage.removeItem(window.OSKARS_HYDRATION_CACHE_KEY);
    sessionStorage.removeItem(window.OSKARS_PEOPLE_EDGES_CACHE_KEY);
    sessionStorage.removeItem(window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY);
    window.clearCachedSupabaseFilmDetails?.();
    window.clearSupabaseFilmDetailInFlight?.();
  } catch (err) {}
  if (broadcast) {
    try {
      localStorage.setItem(
        window.OSKARS_HYDRATION_INVALIDATION_KEY,
        `${Date.now()}:${Math.random()}`,
      );
    } catch (_) {}
  }
  try {
    window.dispatchEvent?.(new CustomEvent("oskars:hydration-invalidated"));
  } catch (_) {}
};

window.addEventListener?.("storage", (event) => {
  if (event.key === window.OSKARS_HYDRATION_INVALIDATION_KEY)
    window.invalidateCachedSupabaseHydrationSource(false);
});

// Every write-shaped Supabase function in supabase-workspace.js, wrapped
// from outside that file (rather than editing ~40 function bodies) so a
// successful mutation always invalidates the cache and a thrown error
// never does. Read-only functions (load*/get*/list*/search*/
// refreshSupabaseWorkspace) are deliberately excluded. Several of these
// (tags, franchise membership, entity notes, award/pair-review status)
// write tables not literally present in the hydration source's own
// top-level shape, but are included anyway on purpose - some are embedded
// in LEGACY_HYDRATION_FILM_FIELDS on every film row (film_tags,
// film_franchises), and over-invalidating the rest costs one extra fetch,
// while under-invalidating would silently show stale data.
window.OSKARS_HYDRATION_CACHE_INVALIDATING_MUTATIONS = [
  "createSupabaseFreshWatchedIntake",
  "updateSupabaseIntakeWorkflow",
  "setSupabaseIntakeWatchedFacts",
  "setSupabaseWatchedRating",
  "addToSupabaseWatchlist",
  "removeFromSupabaseWatchlist",
  "removeFromSupabaseWatched",
  "moveSupabaseWatchlistToWatched",
  "addToSupabaseRanking",
  "seedSupabaseYearRanking",
  "confirmSupabaseRankingEntries",
  "placeSupabaseIntakeRankingFilm",
  "moveSupabaseRankingEntry",
  "removeFromSupabaseRanking",
  "removeSupabasePersonalNomination",
  "applySupabaseWatchlistTierMergeOrder",
  "setSupabaseLocalRankOrder",
  "resolveSupabaseRankingPairReview",
  "reopenSupabaseRankingPairReview",
  "setSupabaseProfileDisplayName",
  "setSupabaseProfileLetterboxd",
  "updateSupabaseProfileLetterboxdLastSynced",
  "deleteSupabaseAccount",
  "moveSupabaseRankingEntryToPosition",
  "setSupabaseAwardReview",
  "reopenSupabaseAwardReview",
  "insertSupabasePersonalNomination",
  "deleteSupabasePersonalNomination",
  "updateSupabaseNominationDetail",
  "updateSupabaseNominationRecipients",
  "createSupabaseWatchlistWatchedIntake",
  "setSupabaseWatchlistTier",
  "addSupabaseFilmTag",
  "removeSupabaseFilmTag",
  "addSupabaseFilmFranchiseMembership",
  "setSupabaseEntityNote",
  "moveSupabaseLocalRankFilm",
  "setSupabaseWatchlistTierForItems",
  "moveSupabaseWatchlistItemWithinTier",
  "createSupabaseProject",
  "createSupabaseProjectFromSource",
  "createSupabaseCollection",
  "promoteSupabaseCollectionToProject",
  "setSupabaseProjectStatus",
  "setSupabaseProjectPinned",
  "deleteSupabaseCollection",
  "removeSupabaseCollectionItem",
  "moveSupabaseCollectionItem",
  "setSupabaseFilmPoster",
  "setSupabaseFilmMetadata",
  "persistSupabaseFilmCredits",
  "setSupabasePersonPortrait",
  "mergeSupabaseFilms",
  "mergeSupabasePeople",
  "deleteSupabaseFilmPermanently",
];

window.OSKARS_HYDRATION_CACHE_INVALIDATING_MUTATIONS.forEach((name) => {
  let original = window[name];
  if (typeof original !== "function") return;
  window[name] = async function (...args) {
    let result = await original.apply(this, args);
    window.invalidateCachedSupabaseHydrationSource();
    return result;
  };
});
