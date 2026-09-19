/**
 * @file Caches loadSupabaseLegacyHydrationSource()'s raw payload in
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
window.OSKARS_HYDRATION_CACHE_KEY = "oskars-supabase-hydration-cache:v2";
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

/**
 * Writes a freshly-loaded hydration source to the cache.
 * @param {string} userId The signed-in user's id.
 * @param {Object} source The raw source from loadSupabaseLegacyHydrationSource().
 */
window.writeCachedSupabaseHydrationSource = function (userId, source) {
  if (!userId) return;
  try {
    sessionStorage.setItem(
      window.OSKARS_HYDRATION_CACHE_KEY,
      JSON.stringify({ userId, savedAt: Date.now(), source }),
    );
  } catch (err) {
    // Storage quota exceeded or disabled (private browsing, etc.) - caching
    // is a pure optimization, so a write failure just means every page
    // re-fetches, not a broken app.
  }
};

/** Clears the cached hydration source, e.g. after a mutation or sign-out. */
window.invalidateCachedSupabaseHydrationSource = function () {
  try {
    sessionStorage.removeItem(window.OSKARS_HYDRATION_CACHE_KEY);
  } catch (err) {}
};

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
