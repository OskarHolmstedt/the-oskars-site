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

// Without supabase-workspace.js's domain list (a stubbed loader), the archive
// is one all-or-nothing domain.
function allHydrationDomains() {
  return window.SUPABASE_HYDRATION_DOMAINS || ["complete"];
}

// Every domain a source can list: the complete-archive domains, then subset
// domains such as `franchiseWatchlist`.
function knownHydrationDomains() {
  return [
    ...allHydrationDomains(),
    ...Object.keys(window.SUPABASE_HYDRATION_SUBSET_DOMAINS || {}),
  ];
}

// A source without a `domains` list holds the complete archive.
function hydrationSourceDomains(source) {
  if (!source) return [];
  return source.domains || allHydrationDomains();
}

// Whether a source already holds a domain's rows, directly or through the
// domain it is a subset of.
function hydrationSourceHas(source, domain) {
  let held = hydrationSourceDomains(source);
  let superset = window.SUPABASE_HYDRATION_SUBSET_DOMAINS?.[domain];
  return held.includes(domain) || Boolean(superset && held.includes(superset));
}

// The cache accumulates subset domains across pages; a page's state is built
// only from the ones it asked for.
function withoutUnrequestedSubsets(source, requested) {
  let subsets = window.SUPABASE_HYDRATION_SUBSET_DOMAINS || {};
  if (!source.domains) return source;
  return {
    ...source,
    domains: source.domains.filter(
      (domain) => !(domain in subsets) || requested.includes(domain),
    ),
  };
}

function mergeHydrationSources(base, addition) {
  let merged = { ...base };
  let added = hydrationSourceDomains(addition);
  added.forEach((domain) => {
    merged[domain] = addition[domain];
  });
  merged.domains = knownHydrationDomains().filter(
    (domain) =>
      hydrationSourceDomains(base).includes(domain) || added.includes(domain),
  );
  return merged;
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
 * @param {string[]} [options.domains] The archive parts this page reads
 * (SUPABASE_HYDRATION_DOMAINS names); all when omitted. Anything the session
 * cache already holds is reused, only missing domains are fetched, and
 * state built from less than the complete archive is never marked
 * complete, so window.save() refuses to reconcile against it.
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
  let allDomains = allHydrationDomains();
  let requested = options.domains || allDomains;
  let source = options.forceRefresh
    ? null
    : window.readCachedSupabaseHydrationSource?.(hydrationUserId);
  let missing = knownHydrationDomains().filter(
    (domain) =>
      requested.includes(domain) && !hydrationSourceHas(source, domain),
  );
  finishCacheRead?.(!source ? "miss" : missing.length ? "partial" : "hit");
  if (missing.length) {
    let finishSource = window.startOskarsPerformance?.("hydration:source");
    let fetched =
      missing.length === allDomains.length
        ? await window.loadSupabaseLegacyHydrationSource()
        : await window.loadSupabaseHydrationDomains(missing);
    source = source ? mergeHydrationSources(source, fetched) : fetched;
    finishSource?.();
  }
  if (options.isCurrent && !options.isCurrent())
    throw new Error("Archive request is no longer current.");
  // A full cache hit holds nothing new, and rewriting it would restart the
  // TTL that bounds staleness from other tabs and devices.
  if (hydrationUserId && missing.length)
    window.writeCachedSupabaseHydrationSource?.(hydrationUserId, source);
  let complete = allDomains.every((domain) =>
    hydrationSourceDomains(source).includes(domain),
  );
  window.OSKARS_SUPABASE_HYDRATION_SOURCE = complete ? source : null;
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
    window.buildLegacyStateFromSupabaseHydration(
      withoutUnrequestedSubsets(source, requested),
    ),
  );
  finishReshape?.();
  window.rebuildAggregates();
  // Needs state.filmsById/state.watchlist already rebuilt above, since it
  // classifies each project item's film_id against them (issue #458).
  window.applyProjectSourceIndex?.(source.ownProjects);
  window.OSKARS_STATE_HYDRATION_COMPLETE = complete;
  doneEnsure?.(`${Object.keys(window.state.filmsById || {}).length} films`);
  return window.state;
};
