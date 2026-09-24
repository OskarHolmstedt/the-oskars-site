/**
 * @file Coordinates startup loading, bundled-data imports, structural
 * migrations, and narrow repairs before the active page renders.
 */

window.OSKARS_BUNDLED_DATA_VERSION = 6;

/**
 * Builds a public profile's stable, shareable entry URL from the current
 * page location — always `index.html?profile=<slug>`, regardless of which
 * page the viewer is currently on, so "Copy profile link" always shares the
 * canonical entry point rather than an incidental internal-navigation URL.
 * @param {string} slug Profile slug.
 * @returns {string} Absolute share URL.
 */
function publicProfileShareUrl(slug) {
  let base = String(window.location?.href || "").replace(/[^/]*$/, "");
  return `${base}index.html?${window.OSKARS_PROFILE_SLUG_QUERY_PARAM}=${encodeURIComponent(slug)}`;
}

const PUBLIC_PROFILE_ERROR_MESSAGES = {
  "not-found": "Profile not found",
  invalid: "This profile's data could not be loaded",
  unavailable: "This profile is temporarily unavailable",
  offline: "This profile is temporarily unavailable",
};

/**
 * Attempts to load and hydrate the active public profile for the current
 * tab (issue #253) — reachable regardless of the deployment's baked runtime
 * mode; see the file-level comment in public-profile.js. Reports a status
 * message either way — a shareable "Viewing X's public profile" badge on
 * success, or a plain-language reason on a recoverable failure — but only
 * ever returns whether hydration succeeded; callers decide what startup
 * path runs next.
 * @param {string} slug Profile slug to load.
 * @returns {Promise<boolean>} Whether the profile was hydrated.
 */
async function ensurePublicProfileData(slug) {
  // Supabase is the one live profile source (issue #452). Immutable static
  // revisions remain a separate Community comparison contract.
  let result;
  try {
    result = await window.loadSupabasePublicProfile?.(slug);
  } catch (err) {
    result = { ok: false, error: "unavailable" };
  }
  result ||= { ok: false, error: "unavailable" };
  if (result.ok) {
    window.showPublicProfileStatus?.(
      `Viewing ${result.meta.ownerName}'s public profile · live data`,
      "viewer",
      [
        {
          label: "Copy profile link",
          run: () => window.copyViewLink?.(publicProfileShareUrl(slug)),
        },
      ],
    );
    return true;
  }
  let message =
    PUBLIC_PROFILE_ERROR_MESSAGES[result.error] ||
    PUBLIC_PROFILE_ERROR_MESSAGES.unavailable;
  window.showPublicProfileStatus?.(message, "error", [
    { label: "Retry", run: () => window.location.reload() },
  ]);
  window.state ||= window.createEmptyState?.() || {};
  window.state.isPublicProfileView = true;
  return false;
}

/**
 * Loads and hydrates window.state from Supabase (issues #438/#452) - the
 * owner's own data or someone else's published live profile. entry-loader.js
 * has already resolved the
 * Supabase account gate by the time this runs, so no account-access
 * recheck is needed here.
 * @param {Object} [options] Deferred-shell freshness and stale-request guard.
 * @param {boolean} [options.forceRefresh] Whether to bypass the raw session cache.
 * @param {Function} [options.isCurrent] Whether this deferred request still owns its scope.
 * @returns {Promise<OskarsState>} The ready global application state.
 */
window.ensureOskarsData = async function (options = {}) {
  let doneEnsure = window.startOskarsPerformance?.("ensureOskarsData");
  // reconcile() in supabase-legacy-writes.js diffs window.state against
  // window.OSKARS_SUPABASE_HYDRATION_SOURCE and deletes anything present in
  // the source but absent from state (awards, rankings, watchlist rows) -
  // safe only when state was built from the *complete* archive. Cleared
  // for the duration of every (re)hydration and only set true once that
  // full reshape below actually finishes, so a save mid-load, or from any
  // future page that populates window.state from a partial/compact read
  // instead, fails loudly here rather than silently deleting records
  // outside that partial set (issue #607).
  window.OSKARS_STATE_HYDRATION_COMPLETE = false;
  let activeSlug = window.resolveActiveProfileSlug?.();
  if (options.isCurrent && (activeSlug || !options.isCurrent()))
    throw new Error("Archive request is no longer current.");
  if (activeSlug) {
    if (await ensurePublicProfileData(activeSlug)) {
      window.refreshOskarsBackdrop?.();
      doneEnsure?.();
      return window.state;
    }
    // An invalid/missing profile link shows the same failure status
    // ensurePublicProfileData() already reported - the viewer may not be
    // signed in at all here (the Supabase account gate is skipped while a
    // profile slug is active).
    doneEnsure?.();
    return window.state;
  }
  // Cross-navigation cache (issue: performance investigation) - this is a
  // multi-page app, so every navigation would otherwise re-fetch and
  // re-join the entire watched/watchlist/rankings/awards/film-and-
  // franchise-catalog dataset from scratch on every single page visit.
  // resolveSupabaseAuthState() is memoized per page load, so this doesn't
  // add a second network round trip -
  // loadSupabaseLegacyHydrationSource() below calls it again internally
  // and gets the same already-resolved promise.
  let authState = await window.resolveSupabaseAuthState?.();
  let hydrationUserId = authState?.user?.id;
  let finishCacheRead = window.startOskarsPerformance?.("hydration:cacheRead");
  let source = options.forceRefresh
    ? null
    : window.readCachedSupabaseHydrationSource?.(hydrationUserId);
  finishCacheRead?.(source ? "hit" : "miss");
  if (!source) {
    let finishSource = window.startOskarsPerformance?.("hydration:source");
    source = await window.loadSupabaseLegacyHydrationSource();
    finishSource?.();
  }
  if (options.isCurrent && !options.isCurrent())
    throw new Error("Archive request is no longer current.");
  if (hydrationUserId)
    window.writeCachedSupabaseHydrationSource?.(hydrationUserId, source);
  window.OSKARS_SUPABASE_HYDRATION_SOURCE = source;
  let finishSharedArchive = window.startOskarsPerformance?.(
    "hydration:sharedArchive",
  );
  window.applySharedFilmArchive?.(
    window.buildSharedFilmArchiveFromSupabase(
      source.catalogFilms,
      source.franchises,
    ),
  );
  finishSharedArchive?.();
  let finishReshape = window.startOskarsPerformance?.("hydration:reshape");
  Object.assign(
    window.state,
    window.buildLegacyStateFromSupabaseHydration(source),
  );
  finishReshape?.();
  window.rebuildAggregates();
  // Needs state.filmsById/state.watchlist already rebuilt above, since it
  // classifies each project item's film_id against them (issue #458).
  window.applyProjectSourceIndex?.(source.ownProjects);
  window.OSKARS_STATE_HYDRATION_COMPLETE = true;
  doneEnsure?.(`${Object.keys(window.state.filmsById || {}).length} films`);
  return window.state;
};
