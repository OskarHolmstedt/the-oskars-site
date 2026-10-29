/**
 * @file Owns tab-scoped raw Supabase hydration domain caches, their five-minute
 * freshness window, post-paint writes and mutation/account invalidation.
 */

window.OSKARS_HYDRATION_CACHE_KEY = "oskars-supabase-hydration-cache:v7";
window.OSKARS_HYDRATION_CACHE_TTL_MS = 5 * 60 * 1000;
window.OSKARS_HYDRATION_CACHE_MAX_DOMAIN_CHARS = 5_000_000;
window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY =
  "oskars-supabase-hydration-cache-overflow:v2";

const hydrationCacheDefaultDomains = [
  "watched",
  "watchlist",
  "rankings",
  "personalAwards",
  "franchises",
  "catalogFilms",
  "people",
  "ownProjects",
  "profile",
  "franchiseWatchlist",
  "taggedWatchlist",
];
let hydrationCacheGeneration = 0;
let hydrationCachePageReady = false;
let hydrationCacheWriteScheduled = false;
let pendingHydrationCacheDomains = new Map();

function hydrationCacheKnownDomains() {
  return [
    ...new Set([
      ...hydrationCacheDefaultDomains,
      ...(window.SUPABASE_HYDRATION_DOMAINS || []),
      ...Object.keys(window.SUPABASE_HYDRATION_SUBSET_DOMAINS || {}),
    ]),
  ];
}
function hydrationCacheDomainKey(domain) {
  return `${window.OSKARS_HYDRATION_CACHE_KEY}:${domain}`;
}
function clearLegacyHydrationCacheEntries() {
  try {
    for (let version = 1; version <= 6; version++)
      sessionStorage.removeItem(`oskars-supabase-hydration-cache:v${version}`);
    sessionStorage.removeItem("oskars-supabase-hydration-cache-overflow:v1");
  } catch (_) {}
}
function freshHydrationCacheEntry(entry, userId) {
  return (
    entry?.userId === userId &&
    typeof entry.savedAt === "number" &&
    Date.now() - entry.savedAt <= window.OSKARS_HYDRATION_CACHE_TTL_MS
  );
}
function hydrationCacheDomainEntry(domain) {
  try {
    let raw = sessionStorage.getItem(hydrationCacheDomainKey(domain));
    if (!raw) return null;
    let entry = JSON.parse(raw);
    return entry && Object.prototype.hasOwnProperty.call(entry, "value")
      ? { entry, length: raw.length }
      : null;
  } catch (_) {
    return null;
  }
}

/** Reads fresh stored or pending hydration domains for one account. @param {string} [userId] Signed-in account ID. @returns {Object|null} Raw source with exactly its held domains, or null. */
window.readCachedSupabaseHydrationSource = function (userId) {
  if (!userId) return null;
  clearLegacyHydrationCacheEntries();
  let source = { domains: [] };
  for (let domain of hydrationCacheKnownDomains()) {
    let stored = hydrationCacheDomainEntry(domain);
    let pending = pendingHydrationCacheDomains.get(domain);
    let entry = freshHydrationCacheEntry(pending, userId)
      ? pending
      : stored?.entry;
    if (!freshHydrationCacheEntry(entry, userId)) continue;
    source[domain] = entry.value;
    source.domains.push(domain);
  }
  return source.domains.length ? source : null;
};

function oversizedHydrationCacheDomains(userId) {
  try {
    let entry = JSON.parse(
      sessionStorage.getItem(window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY) ||
        "null",
    );
    if (
      entry?.userId !== userId ||
      !entry.domains ||
      Array.isArray(entry.domains)
    )
      return {};
    return Object.fromEntries(
      Object.entries(entry.domains).filter(
        ([, savedAt]) =>
          typeof savedAt === "number" &&
          Date.now() - savedAt <= window.OSKARS_HYDRATION_CACHE_TTL_MS,
      ),
    );
  } catch (_) {
    return {};
  }
}
function rememberOversizedHydrationDomain(userId, domain, savedAt) {
  try {
    let domains = {
      ...oversizedHydrationCacheDomains(userId),
      [domain]: savedAt,
    };
    sessionStorage.setItem(
      window.OSKARS_HYDRATION_CACHE_OVERFLOW_KEY,
      JSON.stringify({ userId, domains }),
    );
  } catch (_) {}
}
function isStorageQuotaError(err) {
  return (
    err?.name === "QuotaExceededError" ||
    err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err?.code === 22 ||
    err?.code === 1014
  );
}
function storeHydrationDomain(userId, domain, raw) {
  let key = hydrationCacheDomainKey(domain);
  try {
    sessionStorage.setItem(key, raw);
    return true;
  } catch (err) {
    if (!isStorageQuotaError(err)) return false;
  }
  // Prefer more smaller domains under the shared origin quota. Never evict
  // unrelated storage, or a smaller domain to make room for a larger one.
  let larger = hydrationCacheKnownDomains()
    .filter((name) => name !== domain)
    .map((name) => ({ name, ...hydrationCacheDomainEntry(name) }))
    .filter(
      (stored) =>
        freshHydrationCacheEntry(stored.entry, userId) &&
        stored.length > raw.length,
    )
    .sort((a, b) => b.length - a.length);
  for (let stored of larger) {
    try {
      sessionStorage.removeItem(hydrationCacheDomainKey(stored.name));
      sessionStorage.setItem(key, raw);
      return true;
    } catch (err) {
      if (!isStorageQuotaError(err)) return false;
    }
  }
  return false;
}

/** Stores independently cacheable raw domains without refreshing unrelated entries. @param {string} userId Signed-in account ID. @param {Object} source Raw hydration domains. @param {number} [savedAt] Fetch time; defaults to now. */
window.writeCachedSupabaseHydrationSource = function (
  userId,
  source,
  savedAt = Date.now(),
) {
  if (!userId) return;
  clearLegacyHydrationCacheEntries();
  let finish = window.startOskarsPerformance?.("hydration:cacheWrite");
  let blocked = Object.keys(oversizedHydrationCacheDomains(userId));
  let domains =
    source?.domains ||
    hydrationCacheKnownDomains().filter((domain) =>
      Object.prototype.hasOwnProperty.call(source || {}, domain),
    );
  let candidates = [];
  let skipped = 0;
  for (let domain of hydrationCacheKnownDomains()) {
    let stored = hydrationCacheDomainEntry(domain);
    if (stored && !freshHydrationCacheEntry(stored.entry, userId)) {
      try {
        sessionStorage.removeItem(hydrationCacheDomainKey(domain));
      } catch (_) {}
    }
  }
  for (let domain of domains) {
    if (source[domain] === undefined) continue;
    if (blocked.includes(domain)) {
      skipped++;
      continue;
    }
    try {
      let raw = JSON.stringify({ userId, savedAt, value: source[domain] });
      if (raw.length > window.OSKARS_HYDRATION_CACHE_MAX_DOMAIN_CHARS) {
        rememberOversizedHydrationDomain(userId, domain, savedAt);
        skipped++;
      } else candidates.push({ domain, raw });
    } catch (_) {
      skipped++;
    }
  }
  candidates.sort((a, b) => a.raw.length - b.raw.length);
  let stored = 0;
  for (let candidate of candidates) {
    if (storeHydrationDomain(userId, candidate.domain, candidate.raw)) stored++;
    else skipped++;
  }
  finish?.(`stored: ${stored}; skipped: ${skipped}`);
};

function scheduleHydrationCacheWrites() {
  if (
    !hydrationCachePageReady ||
    hydrationCacheWriteScheduled ||
    !pendingHydrationCacheDomains.size
  )
    return;
  let generation = hydrationCacheGeneration;
  hydrationCacheWriteScheduled = true;
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      if (generation !== hydrationCacheGeneration) return;
      hydrationCacheWriteScheduled = false;
      let entries = [...pendingHydrationCacheDomains.values()];
      pendingHydrationCacheDomains.clear();
      let owner = window.getSupabaseCurrentUser?.()?.id;
      let groups = new Map();
      for (let entry of entries) {
        if (
          !freshHydrationCacheEntry(entry, entry.userId) ||
          (window.getSupabaseCurrentUser && owner !== entry.userId)
        )
          continue;
        let groupKey = `${entry.userId}:${entry.savedAt}`;
        let group = groups.get(groupKey) || {
          userId: entry.userId,
          domains: [],
          savedAt: entry.savedAt,
        };
        group.domains.push(entry.domain);
        group[entry.domain] = entry.value;
        groups.set(groupKey, group);
      }
      groups.forEach((source) =>
        window.writeCachedSupabaseHydrationSource(
          source.userId,
          source,
          source.savedAt,
        ),
      );
    }),
  );
}

/** Queues immutable raw hydration rows until the page's first paint; pending rows also serve same-document reads. @param {string} userId Signed-in account ID. @param {Object} source Newly fetched raw domains. */
window.queueCachedSupabaseHydrationSource = function (userId, source) {
  if (!userId) return;
  if (!window.requestAnimationFrame) {
    window.writeCachedSupabaseHydrationSource(userId, source);
    return;
  }
  let savedAt = Date.now();
  let domains =
    source.domains ||
    hydrationCacheKnownDomains().filter((domain) =>
      Object.prototype.hasOwnProperty.call(source, domain),
    );
  for (let domain of domains)
    if (source[domain] !== undefined)
      pendingHydrationCacheDomains.set(domain, {
        userId,
        domain,
        savedAt,
        value: source[domain],
      });
  scheduleHydrationCacheWrites();
};

/** Allows queued hydration cache writes after the entry controller has rendered. */
window.markHydrationCachePageReady = function () {
  hydrationCachePageReady = true;
  scheduleHydrationCacheWrites();
};

/** Reports whether a post-paint cache batch is pending for performance navigation checks. @returns {boolean} Whether raw domains still await storage. */
window.hydrationCacheWritesPending = function () {
  return pendingHydrationCacheDomains.size > 0 || hydrationCacheWriteScheduled;
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

window.OSKARS_FILM_DETAIL_CACHE_PREFIX = "oskars-film-detail-cache:v2:";

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
  hydrationCacheGeneration++;
  pendingHydrationCacheDomains.clear();
  hydrationCacheWriteScheduled = false;
  try {
    clearLegacyHydrationCacheEntries();
    hydrationCacheKnownDomains().forEach((domain) =>
      sessionStorage.removeItem(hydrationCacheDomainKey(domain)),
    );
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

// Every write-shaped Supabase function in supabase/ area modules, wrapped
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
  "addSupabaseSeenFilms",
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
  "moveSupabasePersonalNomination",
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
  "setSupabaseWatchedRewatch",
  "setSupabaseWatchedRewatchTier",
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
  let original = /** @type {any} */ (window)[name];
  if (typeof original !== "function") return;
  /** @type {any} */ (window)[name] = async function (...args) {
    let result = await original.apply(this, args);
    window.invalidateCachedSupabaseHydrationSource();
    return result;
  };
});
