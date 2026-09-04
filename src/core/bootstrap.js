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
  let result = await window.loadPublicProfile?.(slug);
  if (!result) return false;
  if (result.ok) {
    let canReturnToOwnArchive = window.runtimeModeCapabilities?.(
      window.getRuntimeMode?.(),
    )?.canPersistPrivateState;
    window.showStorageStatus?.(
      `Viewing ${result.meta.ownerName}'s public profile · revision ${result.meta.revision}`,
      "viewer",
      [
        {
          label: "Copy profile link",
          run: () => window.copyViewLink?.(publicProfileShareUrl(slug)),
        },
        {
          label: canReturnToOwnArchive
            ? "Return to my local archive"
            : "Stop viewing",
          run: () => window.stopViewingPublicProfile?.(),
        },
      ],
    );
    return true;
  }
  let message = PUBLIC_PROFILE_ERROR_MESSAGES[result.error];
  if (message) window.showStorageStatus?.(message, "error");
  return false;
}

/**
 * Loads and hydrates window.state from Supabase (issue #438) - the owner's
 * own data, or someone else's published public profile (unaffected;
 * already backend-independent). entry-loader.js has already resolved the
 * Supabase account gate by the time this runs, so no account-access
 * recheck is needed here.
 * @returns {Promise<OskarsState>} The ready global application state.
 */
window.ensureOskarsData = async function () {
  let doneEnsure = window.startOskarsPerformance?.("ensureOskarsData");
  let activeSlug = window.resolveActiveProfileSlug?.();
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
  let source = await window.loadSupabaseLegacyHydrationSource();
  window.OSKARS_SUPABASE_HYDRATION_SOURCE = source;
  window.applySharedFilmArchive?.(
    window.buildSharedFilmArchiveFromSupabase(source.catalogFilms),
  );
  Object.assign(
    window.state,
    window.buildLegacyStateFromSupabaseHydration(source),
  );
  window.rebuildAggregates();
  // Needs state.filmsById/state.watchlist already rebuilt above, since it
  // classifies each project item's film_id against them (issue #458).
  window.applyProjectSourceIndex?.(source.ownProjects);
  doneEnsure?.(`${Object.keys(window.state.filmsById || {}).length} films`);
  return window.state;
};
