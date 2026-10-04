/**
 * @file The "load once, browse locally, write straight through" session
 * cache #401 settled on (issue #411), built on
 * src/core/supabase-client.js's signed-in session. Proves the pattern on
 * the same representative slice #402/#405 already used — watched and
 * watchlist joined with films — not every table at once; the rest of
 * the schema follows the identical pattern once this is actually wired
 * into a real page.
 *
 * Real, live surface as of #420 - rate-watched.html loads this file for
 * real, not just the standalone PoC harnesses. Its write surface grew
 * from watched-rating only (#411) to watchlist add/remove/move-to-
 * watched (#416) to ranking add/reorder/remove (#418) to personal-
 * nomination add/remove (#419) to watchlist tier-merge reorder (#421)
 * to local-rank collection search/order (#422), still the same small-
 * purpose-specific-function-per-concept pattern #414 established wiring
 * the first real page onto it. Unlike watched/watchlist, ranking,
 * personal-award, and local-rank functions are NOT part of the core
 * session cache (loadSupabaseWorkspace()/getSupabaseWorkspace()) - all
 * are scoped
 * (one year/decade/century/all-time at a time) and viewed one scope at
 * a time, so eagerly fetching every scope on every session load would
 * be wasted work; these
 * are page-specific fetches instead, the same posture
 * searchSupabaseFilmsByTitle() already has.
 *
 * No offline handling, no reconciliation, no local-first sync tool (#401
 * already resolved that this app doesn't need one): a session fetches
 * once, holds the result in memory for fast browsing, and every write
 * goes straight to Supabase — updating the in-memory cache to match
 * rather than requiring a full refetch for one edit. A write using a
 * stale `updated_at` (someone else changed the row since this session
 * last loaded it) surfaces as a distinct, catchable error rather than
 * being silently applied or silently dropped — the same optimistic-
 * concurrency guarantee docs/supabase-backend-decision.md's
 * "Concurrency" section already documents and
 * tests/supabase-integration.test.js already proves at the raw-client
 * level; this is that same guarantee surfaced through the cache layer a
 * real caller would actually use.
 *
 * A signed-out/unconfigured load resolves to an empty workspace, not an
 * error - the ordinary "haven't logged in yet" state. Found running this
 * in a real browser with no session (supabase-workspace-test.html):
 * ensureSupabaseClient() alone isn't a strong enough signal for this,
 * since the client initializes fine even fully signed out - an anonymous
 * caller has no grant on watched's private columns at all, so querying
 * without first checking auth state surfaced as a confusing "permission
 * denied" instead of a clean, expected empty result.
 */

const WATCHED_SELECT =
  "id, film_id, rating, rating_modifier, date_watched, review, platform, views, updated_at, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, primary_country, medium, type, screenplay_type, original_language)";
const WATCHLIST_SELECT =
  "id, film_id, tier, tier_modifier, position, reason, updated_at, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, medium, type)";

let workspaceState = null;
let workspaceLoadPromise = null;
let workspaceOwnerId = window.getSupabaseCurrentUser?.()?.id || null;
let workspaceGeneration = 0;

function syncWorkspaceAccount(userId) {
  if (userId === workspaceOwnerId) return;
  workspaceGeneration += 1;
  workspaceOwnerId = userId;
  workspaceState = null;
  workspaceLoadPromise = null;
}

function beginWorkspaceMutation() {
  let generation = workspaceGeneration;
  let ownerId = window.getSupabaseCurrentUser?.()?.id || null;
  return function isCurrent() {
    let currentOwnerId = window.getSupabaseCurrentUser?.()?.id || null;
    return generation === workspaceGeneration && ownerId === currentOwnerId;
  };
}

function assertCurrentWorkspaceMutation(isCurrent) {
  if (typeof isCurrent === "function" && !isCurrent()) {
    let err = new Error("Account changed while performing operation.");
    err.code = "OSKARS_ACCOUNT_CHANGED";
    throw err;
  }
}

// Account changes invalidate pending reads as well as cached rows. Token
// refreshes for the same account preserve both.
window.onSupabaseAuthChange?.((user) => syncWorkspaceAccount(user?.id || null));

const WORKSPACE_PARTS = ["watched", "watchlist"];

async function fetchWorkspace(ownerId, parts) {
  let empty = { watched: [], watchlist: [], parts, loadedAt: null };
  if (!ownerId) return empty;

  let ready = await window.ensureSupabaseClient();
  if (!ready) return empty;

  let [watched, watchlist] = await Promise.all([
    parts.includes("watched")
      ? fetchAllSupabaseRows((withCount) =>
          ready.client
            .from("watched")
            .select(WATCHED_SELECT, withCount ? { count: "exact" } : undefined)
            .eq("user_id", ownerId)
            .order("id"),
        )
      : [],
    parts.includes("watchlist")
      ? fetchAllSupabaseRows((withCount) =>
          ready.client
            .from("watchlist")
            .select(
              WATCHLIST_SELECT,
              withCount ? { count: "exact" } : undefined,
            )
            .eq("user_id", ownerId)
            .order("position")
            .order("id"),
        )
      : [],
  ]);

  return {
    watched,
    watchlist,
    parts,
    loadedAt: new Date().toISOString(),
  };
}

function workspaceHas(state, parts) {
  return Boolean(state) && parts.every((part) => state.parts.includes(part));
}

/**
 * Fetches the signed-in user's watched/watchlist rows (joined with their
 * films) once and caches the result for the rest of the session.
 * Concurrent callers for the same account share one in-flight request.
 * Account changes and newer forced refreshes reject superseded results.
 * A caller that reads only watched rows asks for `parts: ["watched"]`
 * (issue #633); a later request for a missing part fetches just that part.
 * A part that was never requested reads as an empty array.
 * @param {{force?: boolean, parts?: ('watched'|'watchlist')[]}} [options]
 *   `force: true` re-fetches the requested parts even if already cached -
 *   the explicit "refresh" case, never automatic. `parts` defaults to both.
 * @returns {Promise<{watched: Object[], watchlist: Object[], parts: string[], loadedAt: string|null}>}
 */
window.loadSupabaseWorkspace = async function (options = {}) {
  let parts = options.parts || WORKSPACE_PARTS;
  let authState = await window.resolveSupabaseAuthState();
  if (!["signed-in", "signed-out", "unconfigured"].includes(authState.status)) {
    throw new Error(
      authState.error ||
        `Could not resolve the signed-in account (${authState.status}).`,
    );
  }
  let ownerId = authState.status === "signed-in" ? authState.user?.id : null;
  let currentUserId = window.getSupabaseCurrentUser()?.id || null;
  syncWorkspaceAccount(currentUserId);
  if (ownerId !== currentUserId)
    throw new Error("Account changed while loading — reload first.");
  if (!options.force && workspaceHas(workspaceState, parts))
    return workspaceState;
  if (workspaceLoadPromise && !options.force) {
    let joined = await workspaceLoadPromise;
    if (workspaceHas(joined, parts)) return joined;
    if (workspaceLoadPromise) return window.loadSupabaseWorkspace(options);
  }
  let base = workspaceState;
  let missing = options.force
    ? parts
    : parts.filter((part) => !base?.parts.includes(part));
  let generation = workspaceGeneration;
  let pending = fetchWorkspace(ownerId, missing).then((result) => {
    if (
      generation !== workspaceGeneration ||
      ownerId !== (window.getSupabaseCurrentUser()?.id || null)
    )
      throw new Error("Account changed while loading — reload first.");
    if (workspaceLoadPromise !== pending)
      throw new Error("Workspace load superseded by a newer refresh.");
    let kept = workspaceState || { watched: [], watchlist: [], parts: [] };
    workspaceState = {
      watched: missing.includes("watched") ? result.watched : kept.watched,
      watchlist: missing.includes("watchlist")
        ? result.watchlist
        : kept.watchlist,
      parts: WORKSPACE_PARTS.filter(
        (part) => missing.includes(part) || kept.parts.includes(part),
      ),
      loadedAt: result.loadedAt,
    };
    return workspaceState;
  });
  workspaceLoadPromise = pending;
  try {
    return await pending;
  } finally {
    if (workspaceLoadPromise === pending) workspaceLoadPromise = null;
  }
};

/**
 * Synchronous accessor to whatever loadSupabaseWorkspace() last resolved
 * - null before the first successful load.
 * @returns {{watched: Object[], watchlist: Object[], loadedAt: string|null}|null}
 */
window.getSupabaseWorkspace = function () {
  syncWorkspaceAccount(window.getSupabaseCurrentUser()?.id || null);
  return workspaceState;
};

/**
 * Re-fetches the workspace on demand - the explicit "sync when you feel
 * like it" action #401 describes, never triggered automatically by this
 * module itself.
 * @returns {Promise<{watched: Object[], watchlist: Object[], loadedAt: string|null}>}
 */
window.refreshSupabaseWorkspace = function () {
  return window.loadSupabaseWorkspace({ force: true });
};

const INTAKE_WORKFLOW_SELECT =
  "id, watched_id, version, source, steps, summary, completed_at, created_at, updated_at, watched(id, film_id, rating, rating_modifier, date_watched, platform, views, updated_at, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, medium, type))";

/** Loads every resumable Intake for the signed-in user. @returns {Promise<Object[]>} */
window.loadSupabaseIntakeWorkflows = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return [];
  let { data, error } = await ready.client
    .from("intake_workflows")
    .select(INTAKE_WORKFLOW_SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
};

/** Atomically creates a shared film, watched row, and fresh Intake, refusing a film with no catalog or TMDB match. @param {Object} values Form values. @returns {Promise<Object>} The joined workflow, with `notAddedPeople` listing directors that matched no catalog or TMDB person. */
window.createSupabaseFreshWatchedIntake = async function (values) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let title = String(values?.title || "").trim();
  if (!title) throw new Error("Title is required.");
  let rawYear = values?.year;
  let year =
    rawYear !== null && rawYear !== undefined && String(rawYear).trim() !== ""
      ? Number(rawYear)
      : NaN;
  if (!Number.isInteger(year) || year < 1888 || year > 2100) {
    throw new Error(
      "Release year must be a valid integer between 1888 and 2100.",
    );
  }
  let directors = String(values?.director || "")
    .split(/\s*(?:,|\band\b|&)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  // A film without a TMDB identity is matched in the catalog first (the
  // RPC below finds it again by exact title and year), then on TMDB; with
  // neither it is not added.
  await window.ensureCatalogIdentity?.();
  let identity = window.filmTmdbIdentity(values?.tmdbId);
  if (!identity) {
    let catalogId = await window.findSupabaseCatalogFilm(
      ready.client,
      title,
      year,
    );
    if (!catalogId) {
      identity = await window.lookupTmdbFilmIdentity({ title, year });
      if (!identity)
        throw new Error(
          window.catalogIdentityWarning("film", [
            window.catalogFilmLabel({ title, year }),
          ]),
        );
    }
  }
  let tvRef = /^TV:/.test(identity || "");
  let { data, error } = await ready.client.rpc(
    tvRef ? "create_tv_watched_intake" : "create_fresh_watched_intake",
    {
      p_title: title,
      p_year: year,
      ...(tvRef
        ? { p_tv_ref: identity }
        : { p_tmdb_id: identity ? Number(identity) : null }),
      p_directors: directors,
      p_rating: values?.rating ? Number(values.rating) : null,
      p_rating_modifier: values?.ratingModifier || null,
      p_date_watched: values?.dateWatched || null,
      p_platform: values?.platform || null,
      p_views: values?.views ? Number(values.views) : 1,
    },
  );
  if (error) throw error;
  let { data: joined, error: selectError } = await ready.client
    .from("intake_workflows")
    .select(INTAKE_WORKFLOW_SELECT)
    .eq("id", data.id)
    .single();
  if (selectError) throw selectError;
  // The RPC credits directors already in the catalog; the rest are looked
  // up on TMDB here, and any still unmatched are reported.
  joined.notAddedPeople = directors.length
    ? await window.persistSupabaseFilmCredits(
        joined.watched.film_id,
        "director",
        directors,
      )
    : [];
  await window.refreshSupabaseWorkspace();
  return joined;
};

/** Updates one Intake using optimistic concurrency. @param {Object} workflow Last loaded workflow. @param {Object} changes Allowed column changes. @returns {Promise<Object>} Joined updated workflow. */
window.updateSupabaseIntakeWorkflow = async function (workflow, changes) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let payload = { updated_at: new Date().toISOString() };
  for (let key of ["steps", "summary", "completed_at"])
    if (Object.prototype.hasOwnProperty.call(changes, key))
      payload[key] = changes[key];
  let { data, error } = await ready.client
    .from("intake_workflows")
    .update(payload)
    .eq("id", workflow.id)
    .eq("updated_at", workflow.updated_at)
    .select(INTAKE_WORKFLOW_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    let conflict = new Error(
      "This Intake changed elsewhere. Refresh before continuing.",
    );
    conflict.code = "OSKARS_STALE_WRITE";
    throw conflict;
  }
  return data;
};

/** Writes Intake rating/viewing facts and returns a cache-shaped watched row. @param {Object} watched Last loaded watched row. @param {Object} values Form values. @returns {Promise<Object>} */
window.setSupabaseIntakeWatchedFacts = async function (watched, values) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();
  let { data, error } = await ready.client
    .from("watched")
    .update({
      rating: Number(values.rating),
      rating_modifier: values.ratingModifier || null,
      date_watched: values.dateWatched || null,
      platform: values.platform || null,
      views: values.views ? Number(values.views) : 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", watched.id)
    .eq("updated_at", watched.updated_at)
    .select(WATCHED_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    let conflict = new Error(
      "This watched film changed elsewhere. Refresh before continuing.",
    );
    conflict.code = "OSKARS_STALE_WRITE";
    throw conflict;
  }
  assertCurrentWorkspaceMutation(isCurrent);
  if (workspaceState) {
    let index = workspaceState.watched.findIndex((row) => row.id === data.id);
    if (index >= 0) workspaceState.watched[index] = data;
  }
  return data;
};

/**
 * Updates one watched film's rating, straight through to Supabase, then
 * updates the in-memory cache to match - a real caller never needs a
 * full refresh just to see their own edit reflected. Represents the
 * general write-through shape every other field/table follows once
 * wired in for real, not a one-off special case.
 * @param {string} watchedId The watched row's id (from a cached entry).
 * @param {number} rating New rating value.
 * @param {'minus'|'plus'|''} modifier New rating modifier, or an empty string to clear it.
 * @returns {Promise<Object>} The updated, cache-shaped watched row.
 * @throws {Error} With `.code === 'OSKARS_STALE_WRITE'` when the row
 *   changed elsewhere since it was last loaded - the caller's cue to
 *   refresh before retrying, not a silently-dropped or silently-applied
 *   write either way.
 */
window.setSupabaseWatchedRating = async function (
  watchedId,
  rating,
  modifier = "",
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let cached = workspaceState?.watched?.find((row) => row.id === watchedId);
  let staleUpdatedAt = cached?.updated_at;

  let { data, error } = await ready.client
    .from("watched")
    .update({
      rating,
      rating_modifier: modifier || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", watchedId)
    .eq("updated_at", staleUpdatedAt)
    .select(WATCHED_SELECT)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    let conflictErr = new Error(
      "This film's rating was changed elsewhere since it was last loaded - refresh before retrying.",
    );
    conflictErr.code = "OSKARS_STALE_WRITE";
    throw conflictErr;
  }

  assertCurrentWorkspaceMutation(isCurrent);
  if (workspaceState) {
    let idx = workspaceState.watched.findIndex((row) => row.id === watchedId);
    if (idx >= 0) workspaceState.watched[idx] = data;
  }
  return data;
};

/**
 * Adds a film (already in the shared catalog) to the signed-in user's
 * watchlist, straight through to Supabase, then updates the in-memory
 * cache. `position` uses a simple monotonic base-36 timestamp string so
 * new adds sort to the end - no fractional-index reordering scheme is
 * implemented here (issue #416 is add/remove/move, not drag/drop).
 * @param {string} filmId Shared catalog film id.
 * @param {{tier?: string, tierModifier?: string, reason?: string, position?: string}} [options]
 * @returns {Promise<Object>} The new, cache-shaped watchlist row.
 */
window.addToSupabaseWatchlist = async function (filmId, options = {}) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let { data, error } = await ready.client
    .from("watchlist")
    .insert({
      film_id: filmId,
      tier: options.tier || null,
      tier_modifier: options.tierModifier || null,
      reason: options.reason || null,
      position: options.position || Date.now().toString(36),
    })
    .select(WATCHLIST_SELECT)
    .single();
  if (error) throw error;

  assertCurrentWorkspaceMutation(isCurrent);
  if (workspaceState) workspaceState.watchlist.push(data);
  return data;
};

/**
 * Removes one row from the signed-in user's watchlist, straight through
 * to Supabase, then updates the in-memory cache.
 * @param {string} watchlistId The watchlist row's id (from a cached entry).
 */
window.removeFromSupabaseWatchlist = async function (watchlistId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let { error } = await ready.client
    .from("watchlist")
    .delete()
    .eq("id", watchlistId);
  if (error) throw error;

  assertCurrentWorkspaceMutation(isCurrent);
  if (workspaceState) {
    workspaceState.watchlist = workspaceState.watchlist.filter(
      (row) => row.id !== watchlistId,
    );
  }
};

/**
 * Removes one row from the signed-in user's watched films, straight
 * through to Supabase, then updates the in-memory cache. Mirrors
 * removeFromSupabaseWatchlist exactly - the "watched: own rows, eligible
 * only" RLS policy is `for all`, so delete is already permitted for the
 * row owner with no migration needed.
 * @param {string} watchedId The watched row's id (from a cached entry).
 */
window.removeFromSupabaseWatched = async function (watchedId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let { error } = await ready.client
    .from("watched")
    .delete()
    .eq("id", watchedId);
  if (error) throw error;

  assertCurrentWorkspaceMutation(isCurrent);
  if (workspaceState) {
    workspaceState.watched = workspaceState.watched.filter(
      (row) => row.id !== watchedId,
    );
  }
};

/**
 * Moves a film from the signed-in user's watchlist to watched, straight
 * through to Supabase's move_watchlist_to_watched RPC (already proven
 * atomic in tests/supabase-integration.test.js), then updates the
 * in-memory cache on both sides. The RPC returns a bare `watched` row
 * (no film join); this borrows the film join data already present on
 * the watchlist entry being removed rather than a second round trip.
 * @param {string} filmId Shared catalog film id (not the watchlist row id).
 * @param {{rating?: number, dateWatched?: string, review?: string}} [options]
 * @returns {Promise<Object>} The new, cache-shaped watched row.
 */
window.moveSupabaseWatchlistToWatched = async function (filmId, options = {}) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let watchlistEntry = workspaceState?.watchlist?.find(
    (row) => row.film_id === filmId,
  );

  let { data, error } = await ready.client.rpc("move_watchlist_to_watched", {
    p_film_id: filmId,
    p_rating: options.rating ?? null,
    p_date_watched: options.dateWatched ?? null,
    p_review: options.review ?? null,
  });
  if (error) throw error;

  let films = watchlistEntry?.films;
  if (!films) {
    let { data: filmRow, error: filmError } = await ready.client
      .from("films")
      .select(
        "id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, primary_country, medium, type, screenplay_type",
      )
      .eq("id", filmId)
      .maybeSingle();
    if (filmError) throw filmError;
    films = filmRow || null;
  }

  assertCurrentWorkspaceMutation(isCurrent);
  let watchedRow = { ...data, films };
  if (workspaceState) {
    if (Array.isArray(workspaceState.watchlist)) {
      workspaceState.watchlist = workspaceState.watchlist.filter(
        (row) => row.film_id !== filmId,
      );
    }
    if (Array.isArray(workspaceState.watched)) {
      workspaceState.watched.push(watchedRow);
    }
  }
  return watchedRow;
};

/**
 * Adds recognised catalog films as seen without replacing existing watched facts.
 * Removes the selected films from this account's watchlist after the insert;
 * a failed cleanup can be retried without changing ratings, dates, or reviews.
 * @param {string[]} filmIds Shared catalog film UUIDs.
 * @returns {Promise<string[]>} Film IDs now in the account's watched archive.
 */
window.addSupabaseSeenFilms = async function (filmIds) {
  let ids = [...new Set(filmIds || [])];
  if (!ids.length) return [];
  if (
    ids.some(
      (id) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ),
    )
  )
    throw new Error("Invalid film identity.");
  if (window.state?.isPublicProfileView || window.resolveActiveProfileSlug?.())
    throw new Error("Public profiles are read-only.");
  let ready = await window.ensureSupabaseClient();
  let auth = await window.resolveSupabaseAuthState();
  if (!ready || auth.status !== "signed-in")
    throw new Error("Sign in to add films.");
  let userId = auth.user.id;
  let isCurrent = beginWorkspaceMutation();
  for (let offset = 0; offset < ids.length; offset += 100) {
    let chunk = ids.slice(offset, offset + 100);
    assertCurrentWorkspaceMutation(isCurrent);
    let { error } = await ready.client.from("watched").upsert(
      chunk.map((filmId) => ({ user_id: userId, film_id: filmId })),
      { onConflict: "user_id,film_id", ignoreDuplicates: true },
    );
    if (error) throw error;
    // Invalidate even if the following cleanup fails: the insert is durable.
    workspaceState = null;
    window.invalidateCachedSupabaseHydrationSource?.();
    assertCurrentWorkspaceMutation(isCurrent);
    let { error: cleanupError } = await ready.client
      .from("watchlist")
      .delete()
      .eq("user_id", userId)
      .in("film_id", chunk);
    if (cleanupError) throw cleanupError;
  }
  assertCurrentWorkspaceMutation(isCurrent);
  return ids;
};

/**
 * Searches the shared film catalog by title - a read-open, eligibility-
 * free query (films: read all authenticated), used to find a film to
 * add to the watchlist or project without any TMDB search/import step.
 * Uses search_films_catalog RPC with fuzzy and prefix ranking (issue #717).
 * @param {string} query Title query, case-insensitive.
 * @returns {Promise<Object[]>} Up to 20 matching films.
 */
window.searchSupabaseFilmsByTitle = async function (query) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let trimmed = String(query || "").trim();
  if (!trimmed) return [];

  let { data, error } = await ready.client.rpc("search_films_catalog", {
    query_text: trimmed,
  });
  if (error) throw error;
  return data || [];
};

const RANKING_ENTRY_SELECT =
  "film_id, position, rank_confirmed, tie_group_id, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url)";

/**
 * Finds or creates the signed-in user's ranking row for a (scopeType,
 * scope) pair - e.g. ("decades", "2000s") vs ("centuries", "2000s"),
 * which share a display key but must not share a row. Matches rankings'
 * real unique (user_id, scope_type, scope) constraint (issue #428's
 * cutover-import-fidelity migration - a decade and century display key
 * can collide, so scope text alone can't identify a row). No dedicated
 * RPC exists for this (unlike find_or_create_film/person) - a scope's
 * ranking row is only ever needed by its own owner, so there's no
 * shared-catalog-style create-vs-reuse race to guard against across
 * different users.
 * @param {Object} client Ready Supabase client.
 * @param {string} scope
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @returns {Promise<string>} The ranking row's id.
 */
async function getOrCreateSupabaseRankingId(client, scope, scopeType) {
  let { data: existing, error: selectError } = await client
    .from("rankings")
    .select("id")
    .eq("scope", scope)
    .eq("scope_type", scopeType)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  let { data: created, error: insertError } = await client
    .from("rankings")
    .insert({ scope, scope_type: scopeType })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      let { data: retryExisting, error: retryError } = await client
        .from("rankings")
        .select("id")
        .eq("scope", scope)
        .eq("scope_type", scopeType)
        .single();
      if (retryError) throw retryError;
      return retryExisting.id;
    }
    throw insertError;
  }
  return created.id;
}

/**
 * Loads the signed-in user's ranking entries for one scope, ordered by
 * position, joined with films. Not cached - a fresh fetch every call,
 * left to the caller (a page-local variable, same as
 * rate-watched-supabase.js's queue) rather than a shared session cache.
 * @param {string} scope
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @returns {Promise<{rankingId: string, entries: Object[]}|{rankingId: null, entries: []}>}
 */
window.loadSupabaseRanking = async function (scope, scopeType) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return { rankingId: null, entries: [] };

  let rankingId = await getOrCreateSupabaseRankingId(
    ready.client,
    scope,
    scopeType,
  );
  let entries = await fetchAllSupabaseRows((withCount) =>
    ready.client
      .from("ranking_entries")
      .select(RANKING_ENTRY_SELECT, withCount ? { count: "exact" } : undefined)
      .eq("ranking_id", rankingId)
      .order("position")
      .order("film_id"),
  );
  return { rankingId, entries };
};

/**
 * Loads existing ranking scopes with fully paged entries, without creating empty rankings.
 * @returns {Promise<Object[]>} Rankings with ordered film entries.
 */
window.loadSupabaseStoredRankings = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let [rankings, entries] = await Promise.all([
    fetchAllSupabaseRows((withCount) =>
      ready.client
        .from("rankings")
        .select(
          "id, scope, scope_type",
          withCount ? { count: "exact" } : undefined,
        )
        .order("id"),
    ),
    fetchAllSupabaseRows((withCount) =>
      ready.client
        .from("ranking_entries")
        .select(
          `ranking_id, ${RANKING_ENTRY_SELECT}`,
          withCount ? { count: "exact" } : undefined,
        )
        .order("ranking_id")
        .order("position")
        .order("film_id"),
    ),
  ]);
  let byRanking = new Map();
  entries.forEach((entry) => {
    if (!byRanking.has(entry.ranking_id)) byRanking.set(entry.ranking_id, []);
    byRanking.get(entry.ranking_id).push(entry);
  });
  return rankings.map((ranking) => ({
    ...ranking,
    ranking_entries: byRanking.get(ranking.id) || [],
  }));
};

/**
 * Prepares the selected period's own ranking, carrying narrower ordering forward provisionally.
 * @param {string} scope Period key.
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType Period type.
 * @param {Object[]} watched Watched rows joined with films.
 * @returns {Promise<{rankingId: string, entries: Object[]}>} Selected ranking.
 */
window.prepareSupabasePeriodRanking = async function (
  scope,
  scopeType,
  watched,
) {
  let loaded = await window.loadSupabaseRanking(scope, scopeType);
  let eligible = watched.filter((row) =>
    window.supabaseRankingEntryInScope(scopeType, scope, row),
  );
  let existingIds = new Set(loaded.entries.map((entry) => entry.film_id));
  let missing = eligible.some(
    (row) =>
      window.supabaseRankingRatingKey(row) && !existingIds.has(row.film_id),
  );
  let sourceEntries = [];
  if (missing) {
    let stored = await window.loadSupabaseStoredRankings();
    let narrower = {
      years: "allTime",
      decades: "years",
      centuries: "decades",
      allTime: "centuries",
    }[scopeType];
    sourceEntries = stored
      .filter((ranking) => ranking.scope_type === narrower)
      .sort((a, b) => a.scope.localeCompare(b.scope))
      .flatMap((ranking) => ranking.ranking_entries);
  }
  if (
    await window.seedSupabaseYearRanking(
      loaded.rankingId,
      loaded.entries,
      eligible,
      null,
      sourceEntries,
    )
  ) {
    loaded = await window.loadSupabaseRanking(scope, scopeType);
  }
  // A year shelf with one film has no ordering decision to make. Broader
  // scopes require explicit confirmation even when they contain one film.
  if (scopeType === "years") {
    let byId = new Map(eligible.map((row) => [row.film_id, row]));
    let buckets = new Map();
    loaded.entries.forEach((entry) => {
      let key = window.supabaseRankingRatingKey(byId.get(entry.film_id));
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    });
    let singles = [...buckets.values()]
      .filter(
        (group) => group.length === 1 && group[0].rank_confirmed === false,
      )
      .flat();
    if (singles.length) {
      await window.confirmSupabaseRankingEntries(
        loaded.rankingId,
        singles.map((entry) => entry.film_id),
      );
      loaded = await window.loadSupabaseRanking(scope, scopeType);
    }
  }
  return loaded;
};

/**
 * Confirms the specified films in one ranking without changing other scopes.
 * @param {string} rankingId Selected ranking id.
 * @param {string[]} filmIds Films deliberately ordered in that ranking.
 */
window.confirmSupabaseRankingEntries = async function (rankingId, filmIds) {
  if (!filmIds.length) return;
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  // Keep PostgREST filter URLs bounded even for an all-time list with thousands of films.
  for (let index = 0; index < filmIds.length; index += 100) {
    let { error } = await ready.client
      .from("ranking_entries")
      .update({ rank_confirmed: true })
      .eq("ranking_id", rankingId)
      .in("film_id", filmIds.slice(index, index + 100));
    if (error) throw error;
  }
};

/**
 * Seeds missing rated watched films into a selected ranking’s exact-rating shelves without changing existing entries.
 * @param {string} rankingId Selected ranking id.
 * @param {Object[]} entries Existing ordered ranking entries.
 * @param {Object[]} watched Watched rows joined with films.
 * @param {string|null} year Selected year, or null for prefiltered period rows.
 * @param {Object[]} [sourceEntries] Preferred order inherited from a narrower period.
 * @returns {Promise<boolean>} Whether missing entries were submitted.
 */
window.seedSupabaseYearRanking = async function (
  rankingId,
  entries,
  watched,
  year,
  sourceEntries = [],
) {
  let preferred = new Map(
    sourceEntries.map((entry, index) => [entry.film_id, index]),
  );
  let byId = new Map(watched.map((row) => [row.film_id, row]));
  let rankedIds = new Set(entries.map((entry) => entry.film_id));
  let ratingValue = (row) =>
    window.supabaseRankingRatingSortValueFromKey(
      window.supabaseRankingRatingKey(row),
    );
  let missing = watched
    .filter(
      (row) =>
        (year === null || String(row.films?.year) === String(year)) &&
        window.supabaseRankingRatingKey(row) &&
        !rankedIds.has(row.film_id),
    )
    .sort(
      (a, b) =>
        ratingValue(b) - ratingValue(a) ||
        (preferred.get(a.film_id) ?? Infinity) -
          (preferred.get(b.film_id) ?? Infinity) ||
        a.film_id.localeCompare(b.film_id),
    );
  if (!missing.length) return false;
  let ordered = entries.slice();
  let additions = [];
  for (let row of missing) {
    if (rankedIds.has(row.film_id)) continue;
    let index = ordered.findIndex(
      (entry) => ratingValue(byId.get(entry.film_id)) < ratingValue(row),
    );
    if (index < 0) index = ordered.length;
    let entry = {
      ranking_id: rankingId,
      film_id: row.film_id,
      position: window.fractionalPositionBetween(
        ordered[index - 1]?.position || null,
        ordered[index]?.position || null,
      ),
      rank_confirmed: false,
    };
    ordered.splice(index, 0, entry);
    additions.push(entry);
    rankedIds.add(row.film_id);
  }
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.from("ranking_entries").upsert(additions, {
    onConflict: "ranking_id,film_id",
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return true;
};

/**
 * Adds a film to the end of a scope's ranking, straight through to
 * Supabase. Position uses the same simple monotonic base-36 timestamp
 * scheme addToSupabaseWatchlist() uses - always sorts after every
 * existing entry, no fractional-index gap management.
 * @param {string} scope
 * @param {string} filmId
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 */
window.addToSupabaseRanking = async function (scope, filmId, scopeType) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let rankingId = await getOrCreateSupabaseRankingId(
    ready.client,
    scope,
    scopeType,
  );
  let { error } = await ready.client.from("ranking_entries").insert({
    ranking_id: rankingId,
    film_id: filmId,
    position: Date.now().toString(36),
  });
  if (error) throw error;
};

/** Inserts or moves an Intake film at a chosen gap in one ranking. @param {string} rankingId Ranking row id. @param {Object[]} entries Full ordered ranking. @param {string} filmId Intake film id. @param {string|null} targetFilmId Comparison target, or null for an empty cohort. @param {'before'|'after'} position Side of the comparison target. @returns {Promise<string>} New sort key. */
window.placeSupabaseIntakeRankingFilm = async function (
  rankingId,
  entries,
  filmId,
  targetFilmId,
  position,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let withoutTarget = (entries || []).filter(
    (entry) => entry.film_id !== filmId,
  );
  let insertionIndex = withoutTarget.length;
  if (targetFilmId) {
    let targetIndex = withoutTarget.findIndex(
      (entry) => entry.film_id === targetFilmId,
    );
    if (targetIndex < 0)
      throw new Error("The comparison film is no longer ranked.");
    insertionIndex = targetIndex + (position === "after" ? 1 : 0);
  }
  let before = withoutTarget[insertionIndex - 1]?.position || null;
  let after = withoutTarget[insertionIndex]?.position || null;
  let newPosition = window.fractionalPositionBetween(before, after);
  let { error } = await ready.client.from("ranking_entries").upsert(
    {
      ranking_id: rankingId,
      film_id: filmId,
      position: newPosition,
      rank_confirmed: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ranking_id,film_id" },
  );
  if (error) throw error;
  return newPosition;
};

/**
 * Moves one ranking entry up or down by swapping its `position` value
 * with its immediate neighbor's - the minimal reorder operation that
 * proves the wiring pattern without needing a fractional-indexing
 * scheme. No optimistic-concurrency check on this swap (unlike
 * setSupabaseWatchedRating) - a deliberate scope cut for this PoC, not
 * an oversight; that guarantee is already proven elsewhere.
 * @param {string} rankingId
 * @param {Object[]} entries The full ordered list loadSupabaseRanking() returned.
 * @param {string} filmId The entry to move.
 * @param {'up'|'down'} direction
 */
window.moveSupabaseRankingEntry = async function (
  rankingId,
  entries,
  filmId,
  direction,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");

  let index = entries.findIndex((entry) => entry.film_id === filmId);
  let targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) return;

  let current = entries[index];
  let target = entries[targetIndex];
  let [{ error: firstError }, { error: secondError }] = await Promise.all([
    ready.client
      .from("ranking_entries")
      .update({ position: target.position })
      .eq("ranking_id", rankingId)
      .eq("film_id", current.film_id),
    ready.client
      .from("ranking_entries")
      .update({ position: current.position })
      .eq("ranking_id", rankingId)
      .eq("film_id", target.film_id),
  ]);
  if (firstError) throw firstError;
  if (secondError) throw secondError;
};

/**
 * Removes one film from a scope's ranking, straight through to Supabase.
 * @param {string} rankingId
 * @param {string} filmId
 */
window.removeFromSupabaseRanking = async function (rankingId, filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("ranking_entries")
    .delete()
    .eq("ranking_id", rankingId)
    .eq("film_id", filmId);
  if (error) throw error;
};

const PERSONAL_NOMINATION_SELECT =
  "id, category, placement, film_id, detail, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url), personal_nomination_recipients(recipient_name)";

/**
 * Finds or creates the signed-in user's personal_awards row for a
 * (scopeType, scope) pair - the same find-or-create-by-unique-
 * (user_id,scope_type,scope) shape getOrCreateSupabaseRankingId()
 * already establishes for rankings, for the same decade-vs-century
 * display-key-collision reason.
 * @param {Object} client Ready Supabase client.
 * @param {string} scope
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @returns {Promise<string>} The personal_awards row's id.
 */
async function getOrCreateSupabasePersonalAwardId(client, scope, scopeType) {
  let { data: existing, error: selectError } = await client
    .from("personal_awards")
    .select("id")
    .eq("scope", scope)
    .eq("scope_type", scopeType)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;

  let { data: created, error: insertError } = await client
    .from("personal_awards")
    .insert({ scope, scope_type: scopeType })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      let { data: retryExisting, error: retryError } = await client
        .from("personal_awards")
        .select("id")
        .eq("scope", scope)
        .eq("scope_type", scopeType)
        .single();
      if (retryError) throw retryError;
      return retryExisting.id;
    }
    throw insertError;
  }
  return created.id;
}

/**
 * Loads the signed-in user's personal nominations for one scope and
 * category, ordered by placement, joined with films. Not cached, same
 * page-specific-fetch posture as loadSupabaseRanking().
 * @param {string} scope
 * @param {string} category
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @returns {Promise<{personalAwardId: string, nominations: Object[]}|{personalAwardId: null, nominations: []}>}
 */
window.loadSupabasePersonalNominations = async function (
  scope,
  category,
  scopeType,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in")
    return { personalAwardId: null, nominations: [] };

  let personalAwardId = await getOrCreateSupabasePersonalAwardId(
    ready.client,
    scope,
    scopeType,
  );
  let { data, error } = await ready.client
    .from("personal_nominations")
    .select(PERSONAL_NOMINATION_SELECT)
    .eq("personal_award_id", personalAwardId)
    .eq("category", category)
    .order("placement");
  if (error) throw error;
  return { personalAwardId, nominations: data };
};

/**
 * Loads shared crew credits (every role backing a category in
 * window.AWARD_CATEGORY_CREDIT_JOBS, not just director) and the owner's
 * prior nomination credits for a set of ballot-candidate films, in
 * batches of films rather than one request per film/card.
 * @param {string[]} filmIds Film UUIDs.
 * @returns {Promise<{credits: Object[], nominations: Object[]}>}
 */
window.loadSupabaseAwardCandidateCredits = async function (filmIds) {
  let ids = [...new Set((filmIds || []).filter(Boolean))];
  if (!ids.length) return { credits: [], nominations: [] };
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return { credits: [], nominations: [] };
  let roles = [
    ...new Set(
      Object.values(window.AWARD_CATEGORY_CREDIT_JOBS || {}).map(
        (mapping) => mapping.role,
      ),
    ),
  ];
  if (!roles.length) roles = ["director"];
  // A film has many credit rows, so fewer films per request keeps each
  // response under PostgREST's row cap.
  let [credits, nominations] = await Promise.all([
    selectInChunks(
      ids,
      (chunk) =>
        ready.client
          .from("credits")
          .select("film_id, role, billing_order, people(name)")
          .in("film_id", chunk)
          .in("role", roles)
          .order("billing_order"),
      40,
    ),
    selectInChunks(ids, (chunk) =>
      ready.client
        .from("personal_nominations")
        .select(
          "film_id, category, detail, personal_nomination_recipients(recipient_name)",
        )
        .in("film_id", chunk),
    ),
  ]);
  return { credits, nominations };
};

/**
 * Persists TMDB-sourced crew for one film/role into the shared credits
 * catalog, mirroring the Google Sheets importer's own
 * find-or-create-person-then-insert-credit pattern
 * (src/data/google-sheets-supabase-import.js) so a nomination confirmed
 * with a TMDB-suggested recipient benefits every future viewer, not just
 * this session. `credits` has no update grant for `authenticated` (a
 * shared, append-only catalog fact) - a plain insert tolerating the
 * primary key's unique violation is "create if missing", the same
 * intentional shape the importer already uses. A name without a TMDB ID
 * links an existing person with that name, or else the person TMDB finds for
 * it on this film; a name matching neither is skipped and returned, since no
 * person is ever created without a TMDB ID.
 * @param {string} filmId Film UUID.
 * @param {string} role credits.role value (see window.AWARD_CATEGORY_CREDIT_JOBS).
 * @param {(string|{tmdbId?: number|null, name: string, profilePath?: string|null})[]} people TMDB crew or names to persist.
 * @returns {Promise<string[]>} Names that were not added.
 */
window.persistSupabaseFilmCredits = async function (filmId, role, people) {
  let notAdded = [];
  if (!filmId || !role || !people?.length) return notAdded;
  let ready = await window.ensureSupabaseClient();
  if (!ready) return notAdded;
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return notAdded;
  await window.ensureCatalogIdentity?.();
  let filmTmdbIds = null;
  for (let [index, person] of people.entries()) {
    let name =
      typeof person === "string"
        ? person.trim()
        : String(person?.name || "").trim();
    if (!name) continue;
    let tmdbId =
      typeof person === "object" && person?.tmdbId
        ? Number(person.tmdbId) || null
        : null;
    if (!tmdbId && !filmTmdbIds) {
      let { data: film } = await ready.client
        .from("films")
        .select("tmdb_id")
        .eq("id", filmId)
        .maybeSingle();
      filmTmdbIds = film?.tmdb_id ? [film.tmdb_id] : [];
    }
    let { personId } = await window.resolveSupabaseCatalogPerson(ready.client, {
      name,
      tmdbId,
      profilePath: typeof person === "object" ? person?.profilePath : null,
      creditedFilmTmdbIds: filmTmdbIds || [],
    });
    if (!personId) {
      notAdded.push(name);
      continue;
    }
    let { error: creditError } = await ready.client.from("credits").insert({
      film_id: filmId,
      person_id: personId,
      role,
      billing_order: index,
    });
    if (creditError && creditError.code !== "23505") throw creditError;
  }
  return notAdded;
};

/**
 * Removes one personal nomination, straight through to Supabase.
 * @param {string} nominationId
 */
window.removeSupabasePersonalNomination = async function (nominationId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("personal_nominations")
    .delete()
    .eq("id", nominationId);
  if (error) throw error;
};

/**
 * Applies a fully-decided merge order (issue #421's watchlist-merge
 * tool) to the tier-position slots the given film ids already occupy,
 * leaving every other item in the tier untouched - reassigns the merge
 * set's own existing `position` values to the new order rather than
 * computing fresh fractional positions, the Supabase-position-column
 * translation of the same "no second order model" guarantee
 * applyWatchlistTierMergeOrder() (src/imports/watchlists.js) already
 * has. No optimistic-concurrency check across the batch (unlike
 * setSupabaseWatchedRating) - the same deliberate scope cut already
 * accepted for moveSupabaseRankingEntry's position swap.
 * @param {string} tier
 * @param {string[]} orderedFilmIds Film ids in the desired final relative order.
 * @returns {Promise<{ok: boolean, changed?: number, reason?: string}>}
 */
window.applySupabaseWatchlistTierMergeOrder = async function (
  tier,
  orderedFilmIds,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let ids = (orderedFilmIds || []).map(String).filter(Boolean);
  let idSet = new Set(ids);
  if (idSet.size < 2 || idSet.size !== ids.length)
    return {
      ok: false,
      reason: "Choose at least two distinct watchlist films to merge.",
    };

  let tierItems = window.supabaseWatchlistTierItemsInOrder(tier);
  let byFilmId = new Map(tierItems.map((row) => [row.film_id, row]));
  let mergedRows = ids.map((filmId) => byFilmId.get(filmId)).filter(Boolean);
  let slotPositions = tierItems
    .filter((row) => idSet.has(row.film_id))
    .map((row) => row.position);

  if (mergedRows.length !== ids.length || slotPositions.length !== ids.length)
    return {
      ok: false,
      reason: "Some selected films are no longer in this tier.",
    };

  if (slotPositions.some((pos) => !pos)) {
    let firstMergedIndex = tierItems.findIndex((row) => idSet.has(row.film_id));
    let beforePos = null;
    for (let i = firstMergedIndex - 1; i >= 0; i--) {
      if (tierItems[i].position) {
        beforePos = tierItems[i].position;
        break;
      }
    }
    let lastMergedIndex = -1;
    for (let i = tierItems.length - 1; i >= 0; i--) {
      if (idSet.has(tierItems[i].film_id)) {
        lastMergedIndex = i;
        break;
      }
    }
    let afterPos = null;
    for (let i = lastMergedIndex + 1; i < tierItems.length; i++) {
      if (tierItems[i].position) {
        afterPos = tierItems[i].position;
        break;
      }
    }
    let generated = [];
    let cur = beforePos;
    for (let i = 0; i < mergedRows.length; i++) {
      let nextPos = window.fractionalPositionBetween(cur, afterPos);
      generated.push(nextPos);
      cur = nextPos;
    }
    slotPositions = generated;
  }

  let updates = mergedRows
    .map((row, index) => ({ row, newPosition: slotPositions[index] }))
    .filter(({ row, newPosition }) => row.position !== newPosition);

  let results = await Promise.all(
    updates.map(({ row, newPosition }) =>
      ready.client
        .from("watchlist")
        .update({ position: newPosition, updated_at: new Date().toISOString() })
        .eq("id", row.id),
    ),
  );
  let failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  assertCurrentWorkspaceMutation(isCurrent);
  updates.forEach(({ row, newPosition }) => {
    row.position = newPosition;
  });

  return { ok: true, changed: updates.length };
};

/**
 * Searches the shared catalog's people by name, for the local-rank-merge
 * tool's director picker (issue #422). No role filter - every person in
 * the shared catalog got there via a director credit (#412's import
 * only ever writes role: "director"), so a plain name search is
 * already a search over directors specifically.
 * @param {string} query Name substring, case-insensitive.
 * @returns {Promise<Object[]>} Up to 20 matching people (id, name).
 */
window.searchSupabaseDirectorsByName = async function (query) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let trimmed = String(query || "").trim();
  if (!trimmed) return [];
  let { data, error } = await ready.client
    .from("people")
    .select("id, name")
    .ilike("name", `%${trimmed}%`)
    .order("name")
    .limit(20);
  if (error) throw error;
  return data;
};

/**
 * Lists the signed-in user's own tags, for the local-rank-merge tool's
 * tag picker.
 * @returns {Promise<Object[]>} Tags (id, name), alphabetical.
 */
window.listSupabaseTags = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("tags")
    .select("id, name")
    .order("name");
  if (error) throw error;
  return data;
};

const LOCAL_RANK_FILM_SELECT =
  "id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, medium, type";

/**
 * Resolves a local-rank collection's display name and current films, in
 * an alphabetical-by-title default order - Supabase has no equivalent
 * to the old app's allTimeRank-derived implicit order (personal ratings/
 * rankings aren't migrated yet, issue #403), so this deliberately picks
 * a simpler, stable default instead of trying to replicate that.
 * @param {'person'|'tag'} kind
 * @param {string} collectionId people.id or tags.id.
 * @returns {Promise<{name: string, films: Object[]}|null>} `null` when
 *   the collection can't be found.
 */
window.loadSupabaseLocalRankCollectionFilms = async function (
  kind,
  collectionId,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");

  if (kind === "person") {
    let { data: person, error: personError } = await ready.client
      .from("people")
      .select("id, name")
      .eq("id", collectionId)
      .maybeSingle();
    if (personError) throw personError;
    if (!person) return null;
    let { data: credits, error: creditsError } = await ready.client
      .from("credits")
      .select(`film_id, films(${LOCAL_RANK_FILM_SELECT})`)
      .eq("person_id", collectionId)
      .eq("role", "director")
      .order("title", { foreignTable: "films" });
    if (creditsError) throw creditsError;
    return { name: person.name, films: credits.map((row) => row.films) };
  }

  if (kind === "tag") {
    let { data: tag, error: tagError } = await ready.client
      .from("tags")
      .select("id, name")
      .eq("id", collectionId)
      .maybeSingle();
    if (tagError) throw tagError;
    if (!tag) return null;
    let { data: filmTags, error: filmTagsError } = await ready.client
      .from("film_tags")
      .select(`film_id, films(${LOCAL_RANK_FILM_SELECT})`)
      .eq("tag_id", collectionId)
      .order("title", { foreignTable: "films" });
    if (filmTagsError) throw filmTagsError;
    return { name: tag.name, films: filmTags.map((row) => row.films) };
  }

  return null;
};

/**
 * Reads the signed-in user's stored explicit order for one local-rank
 * collection.
 * @param {'person'|'tag'} kind
 * @param {string} collectionId
 * @returns {Promise<string[]>} Explicit film ids, in stored order - `[]`
 *   when none stored yet.
 */
window.loadSupabaseLocalRankOrder = async function (kind, collectionId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("local_ranks")
    .select("film_id")
    .eq("collection_kind", kind)
    .eq("collection_id", collectionId)
    .order("position");
  if (error) throw error;
  return data.map((row) => row.film_id);
};

/**
 * Sets the signed-in user's explicit order for one local-rank
 * collection - a full replace (delete then insert), matching
 * local_ranks' composite primary key
 * (user_id, collection_kind, collection_id, film_id) and
 * setLocalRankOrder()'s own full-replace semantics.
 * @param {'person'|'tag'} kind
 * @param {string} collectionId
 * @param {string[]} filmIds New order.
 */
window.setSupabaseLocalRankOrder = async function (
  kind,
  collectionId,
  filmIds,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error: deleteError } = await ready.client
    .from("local_ranks")
    .delete()
    .eq("collection_kind", kind)
    .eq("collection_id", collectionId);
  if (deleteError) throw deleteError;

  let ids = (filmIds || []).filter(Boolean);
  if (!ids.length) return;
  let { error: insertError } = await ready.client.from("local_ranks").insert(
    ids.map((film_id, index) => ({
      collection_kind: kind,
      collection_id: collectionId,
      film_id,
      position: String(index).padStart(6, "0"),
    })),
  );
  if (insertError) throw insertError;
};

function supabaseRankingPairReviewKey(filmIdA, filmIdB) {
  return [String(filmIdA || ""), String(filmIdB || "")].sort().join("::");
}

/**
 * Loads the signed-in user's already-reviewed pair keys for one ranking
 * consistency scope (issue #429) - resumable progress, matching
 * ranking_pair_reviews' role as the durable replacement for the
 * previous window.state.rankingReviews[type][key] array.
 * @param {string} scope
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @returns {Promise<Set<string>>} Pair keys already reviewed.
 */
window.loadSupabaseRankingPairReviews = async function (scope, scopeType) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return new Set();

  let { data, error } = await ready.client
    .from("ranking_pair_reviews")
    .select("film_id_a, film_id_b")
    .eq("scope", scope)
    .eq("scope_type", scopeType);
  if (error) throw error;
  return new Set(
    data.map((row) =>
      supabaseRankingPairReviewKey(row.film_id_a, row.film_id_b),
    ),
  );
};

/**
 * Records one pair as reviewed without confirming a partially reviewed shelf.
 * Confirmation is explicit for the selected ranking.
 * @param {string} scope
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @param {string} rankingId
 * @param {string} filmIdA
 * @param {string} filmIdB
 */
window.resolveSupabaseRankingPairReview = async function (
  scope,
  scopeType,
  rankingId,
  filmIdA,
  filmIdB,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let [filmIdLower, filmIdUpper] = [filmIdA, filmIdB].sort();
  let { error: insertError } = await ready.client
    .from("ranking_pair_reviews")
    .upsert(
      {
        scope,
        scope_type: scopeType,
        film_id_a: filmIdLower,
        film_id_b: filmIdUpper,
      },
      { onConflict: "user_id,scope_type,scope,film_id_a,film_id_b" },
    );
  if (insertError) throw insertError;
};

/**
 * Reopens one reviewed pair after a session undo.
 * @param {string} scope
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @param {string} filmIdA
 * @param {string} filmIdB
 */
window.reopenSupabaseRankingPairReview = async function (
  scope,
  scopeType,
  filmIdA,
  filmIdB,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let [a, b] = [filmIdA, filmIdB].sort();
  let { error } = await ready.client
    .from("ranking_pair_reviews")
    .delete()
    .eq("scope", scope)
    .eq("scope_type", scopeType)
    .eq("film_id_a", a)
    .eq("film_id_b", b);
  if (error) throw error;
};

/**
 * Loads the signed-in user's own profile row (issue #430) - auto-created
 * by the handle_new_user() trigger on signup, so this always finds a row
 * once signed in.
 * @returns {Promise<{id: string, display_name: string|null, public_slug: string|null}|null>}
 */
window.loadSupabaseProfile = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return null;

  let { data, error } = await ready.client
    .from("profiles")
    .select(
      "id, display_name, public_slug, letterboxd_username, letterboxd_last_synced_at",
    )
    .eq("id", authState.user.id)
    .single();
  if (error) throw error;
  return data;
};

/**
 * Sets the signed-in user's public-profile display name. No eligibility
 * check on this write - profiles carries no security-sensitive column
 * (see the profiles RLS policy comment), so any authenticated user may
 * set their own.
 * @param {string} displayName
 * @returns {Promise<{id: string, display_name: string|null}>}
 */
window.setSupabaseProfileDisplayName = async function (displayName) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") throw new Error("Not signed in.");

  let { data, error } = await ready.client
    .from("profiles")
    .update({ display_name: displayName || null })
    .eq("id", authState.user.id)
    .select("id, display_name")
    .single();
  if (error) throw error;
  return data;
};

/**
 * Sets the signed-in user's Letterboxd username and optional last synced timestamp (issue #668).
 * @param {string|null} username
 * @param {string|null} [lastSyncedAt]
 * @returns {Promise<{id: string, letterboxd_username: string|null, letterboxd_last_synced_at: string|null}>}
 */
window.setSupabaseProfileLetterboxd = async function (
  username,
  lastSyncedAt = undefined,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") throw new Error("Not signed in.");

  let patch = {
    letterboxd_username: username ? String(username).trim() : null,
  };
  if (lastSyncedAt !== undefined) {
    patch.letterboxd_last_synced_at = lastSyncedAt;
  }

  let { data, error } = await ready.client
    .from("profiles")
    .update(patch)
    .eq("id", authState.user.id)
    .select(
      "id, display_name, public_slug, letterboxd_username, letterboxd_last_synced_at",
    )
    .single();
  if (error) throw error;
  return data;
};

/**
 * Updates the signed-in user's Letterboxd last-synced timestamp (issue #668).
 * @param {string} lastSyncedAt ISO timestamp
 * @returns {Promise<{id: string, letterboxd_last_synced_at: string|null}>}
 */
window.updateSupabaseProfileLetterboxdLastSynced = async function (
  lastSyncedAt,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") throw new Error("Not signed in.");

  let { data, error } = await ready.client
    .from("profiles")
    .update({ letterboxd_last_synced_at: lastSyncedAt })
    .eq("id", authState.user.id)
    .select("id, letterboxd_last_synced_at")
    .single();
  if (error) throw error;
  return data;
};

/**
 * Every table `delete_my_account()` cascades through when it deletes the
 * `auth.users` row (issue #431/#452) - verified directly against every
 * `references auth.users(id) on delete cascade` table across the schema
 * migrations, not just the narrower set the Data page's restore-format
 * backup (`the-oskars-supabase-backup`) already covers. Deliberately
 * excludes `eligibility`: it cascade-deletes too, but carries no
 * client-facing policy at all (see its own table comment in
 * 20260830000000_initial_schema.sql) - an ordinary authenticated user
 * cannot select it directly, and it holds an internal gating flag, not
 * anything the account authored.
 */
const SUPABASE_ACCOUNT_BACKUP_TABLES = [
  ["profiles", "*", ["id"]],
  ["watched", "*", ["id"]],
  ["watchlist", "*", ["position", "id"]],
  ["tags", "*", ["id"]],
  ["film_tags", "*", ["film_id", "tag_id"]],
  ["rankings", "*, ranking_entries(*)", ["id"]],
  [
    "personal_awards",
    "*, personal_nominations(*, personal_nomination_recipients(*))",
    ["id"],
  ],
  ["collections", "*, collection_items(*)", ["id"]],
  ["projects", "*", ["id"]],
  [
    "local_ranks",
    "*",
    ["collection_kind", "collection_id", "position", "film_id"],
  ],
  ["ranking_pair_reviews", "*", ["scope", "film_id_a", "film_id_b"]],
  ["award_reviews", "*", ["year", "category"]],
  ["award_pool_exclusions", "*", ["year", "film_id"]],
  ["collection_ballots", "*", ["id"]],
  ["entity_notes", "*", ["id"]],
  ["declined_official_watchlist_adds", "*", ["film_id"]],
  ["intake_workflows", "*", ["id"]],
];

/**
 * Builds a complete pre-deletion export of every row the signed-in
 * account owns - the "backup-before-delete" safeguard #431 asked for,
 * bypassed when `delete_my_account()` shipped without it (issue #452).
 * Deliberately a separate, wider format from
 * `the-oskars-supabase-backup` above: this isn't meant to be replayed
 * through restoreBackup()'s per-table upsert logic, just a complete,
 * accurate record of what existed at deletion time.
 * @returns {Promise<{format: string, version: number, exportedAt: string, account: {id: string, email: string|null}, tables: Object}>}
 */
window.buildSupabaseAccountBackup = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") throw new Error("Not signed in.");
  let client = ready.client;
  let tableRows = await Promise.all(
    SUPABASE_ACCOUNT_BACKUP_TABLES.map(([table, select, orderColumns]) =>
      fetchAllSupabaseRows((withCount) => {
        let query = client
          .from(table)
          .select(select, withCount ? { count: "exact" } : undefined);
        for (let column of orderColumns) query = query.order(column);
        return query;
      }),
    ),
  );
  let tables = {};
  SUPABASE_ACCOUNT_BACKUP_TABLES.forEach(([table], index) => {
    tables[table] = tableRows[index];
  });
  return {
    format: "the-oskars-account-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { id: authState.user.id, email: authState.user.email || null },
    tables,
  };
};

/**
 * Permanently deletes the signed-in Supabase account and its app-owned data.
 * @returns {Promise<void>}
 */
window.deleteSupabaseAccount = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") throw new Error("Not signed in.");
  let { error } = await ready.client.rpc("delete_my_account");
  if (error) throw error;
};

/**
 * Moves one ranking entry to an arbitrary new position between two given
 * neighbors (issue #432), using fractionalPositionBetween() - unlike
 * moveSupabaseRankingEntry's adjacent-only swap, this supports real
 * drag-and-drop to any spot in the list, not just moving one step.
 * @param {string} rankingId
 * @param {string} filmId The entry to move.
 * @param {Object[]} entries The full ordered list loadSupabaseRanking() returned (read for beforeFilmId/afterFilmId's current position values).
 * @param {string|null} beforeFilmId Neighbor the entry should sort after, or null to move to the very start.
 * @param {string|null} afterFilmId Neighbor the entry should sort before, or null to move to the very end.
 * @returns {Promise<string>} The entry's new position value.
 */
window.moveSupabaseRankingEntryToPosition = async function (
  rankingId,
  filmId,
  entries,
  beforeFilmId,
  afterFilmId,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let beforePosition = beforeFilmId
    ? entries.find((entry) => entry.film_id === beforeFilmId)?.position
    : null;
  let afterPosition = afterFilmId
    ? entries.find((entry) => entry.film_id === afterFilmId)?.position
    : null;
  let newPosition = window.fractionalPositionBetween(
    beforePosition,
    afterPosition,
  );
  let { error } = await ready.client
    .from("ranking_entries")
    .update({ position: newPosition })
    .eq("ranking_id", rankingId)
    .eq("film_id", filmId);
  if (error) throw error;
  return newPosition;
};

/**
 * Confirms every film in one year's exact-rating bucket as deliberately
 * ordered (issue #432, matching the previous confirmYearRankingBucket):
 * marks every entry's rank_confirmed and records every adjacent pair
 * within the bucket as reviewed, so ranking-review.html won't re-ask
 * about a pair already settled here.
 * @param {string} rankingId
 * @param {string} year
 * @param {Object[]} bucketEntries The bucket's entries, in position order.
 * @returns {Promise<{reviewed: number}>}
 */
window.resolveSupabaseYearRankingBucket = async function (
  rankingId,
  year,
  bucketEntries,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  if (bucketEntries.length < 2) return { reviewed: 0 };

  let filmIds = bucketEntries.map((entry) => entry.film_id);
  let { error: confirmError } = await ready.client
    .from("ranking_entries")
    .update({ rank_confirmed: true })
    .eq("ranking_id", rankingId)
    .in("film_id", filmIds);
  if (confirmError) throw confirmError;

  let reviewed = 0;
  for (let index = 0; index < bucketEntries.length - 1; index += 1) {
    await window.resolveSupabaseRankingPairReview(
      String(year),
      "years",
      rankingId,
      bucketEntries[index].film_id,
      bucketEntries[index + 1].film_id,
    );
    reviewed += 1;
  }
  return { reviewed };
};

/**
 * Loads the films hidden from every candidate pool for one annual ballot.
 * @param {number|string} year Awards year.
 * @returns {Promise<string[]>} Hidden film UUIDs.
 */
window.loadSupabaseAwardPoolExclusions = async function (year) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let rows = await fetchAllSupabaseRows((count) =>
    ready.client
      .from("award_pool_exclusions")
      .select("film_id", count ? { count: "exact" } : undefined)
      .eq("year", Number(year))
      .order("film_id"),
  );
  return rows.map((row) => row.film_id);
};

/**
 * Saves a film hidden from every category in one annual ballot.
 * @param {number|string} year Awards year.
 * @param {string} filmId Film UUID.
 */
window.hideSupabaseAwardPoolFilm = async function (year, filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("award_pool_exclusions")
    .upsert(
      { year: Number(year), film_id: filmId },
      { onConflict: "user_id,year,film_id", ignoreDuplicates: true },
    );
  if (error) throw error;
};

/**
 * Restores all globally hidden candidate films for one annual ballot.
 * @param {number|string} year Awards year.
 */
window.clearSupabaseAwardPoolExclusions = async function (year) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("award_pool_exclusions")
    .delete()
    .eq("year", Number(year));
  if (error) throw error;
};

/**
 * Returns the signed-in user's stored review outcome for one annual
 * category, or null if never reviewed (issue #435, matching the
 * previous annualAwardReview()).
 * @param {number|string} year
 * @param {string} category
 * @returns {Promise<{status: 'complete'|'none', reviewed_at: string}|null>}
 */
window.loadSupabaseAwardReview = async function (year, category) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("award_reviews")
    .select("status, reviewed_at")
    .eq("year", Number(year))
    .eq("category", category)
    .maybeSingle();
  if (error) throw error;
  return data;
};

/**
 * Marks an annual category deliberately complete or reviewed with no
 * nominees.
 * @param {number|string} year
 * @param {string} category
 * @param {'complete'|'none'} status
 */
window.setSupabaseAwardReview = async function (year, category, status) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.from("award_reviews").upsert(
    {
      year: Number(year),
      category,
      status,
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,year,category" },
  );
  if (error) throw error;
};

/**
 * Clears a stored annual outcome when ballot contents change.
 * @param {number|string} year
 * @param {string} category
 */
window.reopenSupabaseAwardReview = async function (year, category) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("award_reviews")
    .delete()
    .eq("year", Number(year))
    .eq("category", category);
  if (error) throw error;
};

/**
 * Loads every annual category outcome for the signed-in user. Build uses this
 * one batched read across all years instead of issuing one query per category
 * per year through supabaseAnnualAwardReviewProgress().
 * @returns {Promise<SupabaseAwardReview[]>}
 */
window.loadSupabaseAwardReviews = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return [];
  let { data, error } = await ready.client
    .from("award_reviews")
    .select("year, category, status, reviewed_at")
    .order("year")
    .order("category");
  if (error) throw error;
  return data;
};

/**
 * Derives category completion and winner-led ceremony data for a year
 * (issue #435, matching the previous annualAwardReviewProgress()).
 * Built entirely from already-existing pieces: getOrderedCategories()
 * (src/domain/category-order.js, pure, unconditionally loaded) and
 * loadSupabasePersonalNominations() (#429/#432).
 * @param {number|string} year
 * @returns {Promise<{personalAwardId: string|null, total: number, reviewed: number, complete: boolean, nextCategory: string, categories: Object[], winners: Object[]}>}
 */
window.supabaseAnnualAwardReviewProgress = async function (year) {
  let categoryNames = window.getOrderedCategories?.() || [];
  // Resolves (or creates) this year's personal_awards row, then batches
  // personal nominations across all categories and award reviews for this year
  // into two parallel queries instead of fanning out 36 separate category reads.
  let ready = await window.ensureSupabaseClient();
  let authState = ready ? await window.resolveSupabaseAuthState() : null;
  let personalAwardId =
    ready && authState?.status === "signed-in"
      ? await getOrCreateSupabasePersonalAwardId(
          ready.client,
          String(year),
          "years",
        )
      : null;
  let [nominationsRes, reviewsRes] = await Promise.all([
    personalAwardId
      ? ready.client
          .from("personal_nominations")
          .select(PERSONAL_NOMINATION_SELECT)
          .eq("personal_award_id", personalAwardId)
          .order("placement")
      : Promise.resolve({ data: [], error: null }),
    ready && authState?.status === "signed-in"
      ? ready.client
          .from("award_reviews")
          .select("year, category, status, reviewed_at")
          .eq("year", Number(year))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (nominationsRes.error) throw nominationsRes.error;
  if (reviewsRes.error) throw reviewsRes.error;

  let nominationsByCategory = new Map();
  for (let nomination of nominationsRes.data || []) {
    let list = nominationsByCategory.get(nomination.category);
    if (!list) {
      list = [];
      nominationsByCategory.set(nomination.category, list);
    }
    list.push(nomination);
  }

  let reviewsByCategory = new Map();
  for (let review of reviewsRes.data || []) {
    reviewsByCategory.set(review.category, review);
  }

  let categories = categoryNames.map((category) => {
    let nominations = nominationsByCategory.get(category) || [];
    let review = reviewsByCategory.get(category) || null;
    let winner =
      nominations.find((entry) => Number(entry.placement) === 1) || null;
    return {
      category,
      nominations,
      review,
      reviewed: Boolean(review),
      winner,
    };
  });
  return {
    personalAwardId,
    total: categories.length,
    reviewed: categories.filter((entry) => entry.reviewed).length,
    complete:
      categories.length > 0 && categories.every((entry) => entry.reviewed),
    nextCategory: categories.find((entry) => !entry.reviewed)?.category || "",
    categories,
    winners: categories.map((entry) => entry.winner).filter(Boolean),
  };
};

/**
 * Inserts a personal nomination with atomic placement-bump cascade
 * (issue #435) via the insert_personal_nomination RPC - see its
 * migration for the exact bump/capacity-truncation contract.
 * @param {string} personalAwardId
 * @param {string} category
 * @param {number} placement
 * @param {number} capacity
 * @param {string} filmId
 * @param {string} detail
 * @param {string[]} recipients
 * @returns {Promise<Object>} The inserted personal_nominations row.
 */
window.insertSupabasePersonalNomination = async function (
  personalAwardId,
  category,
  placement,
  capacity,
  filmId,
  detail,
  recipients,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("insert_personal_nomination", {
    p_personal_award_id: personalAwardId,
    p_category: category,
    p_placement: placement,
    p_capacity: capacity,
    p_film_id: filmId,
    p_detail: detail || "",
    p_recipients: [
      ...new Set((recipients || []).map((name) => name.trim()).filter(Boolean)),
    ],
  });
  if (error) throw error;
  return data;
};

/**
 * Deletes a personal nomination with atomic placement-shift-up (issue
 * #435) via the delete_personal_nomination RPC.
 * @param {string} personalAwardId
 * @param {string} category
 * @param {number} placement
 * @param {string} filmId
 */
window.deleteSupabasePersonalNomination = async function (
  personalAwardId,
  category,
  placement,
  filmId,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.rpc("delete_personal_nomination", {
    p_personal_award_id: personalAwardId,
    p_category: category,
    p_placement: placement,
    p_film_id: filmId,
  });
  if (error) throw error;
};

/**
 * Moves an already-placed personal nomination to a different placement in
 * the same category, atomically shifting every nomination between the old
 * and new spot, via the move_personal_nomination RPC - see its migration
 * for the exact shift contract. For reordering an existing nominee;
 * insertSupabasePersonalNomination() above is for adding one from the pool.
 * @param {string} personalAwardId
 * @param {string} category
 * @param {number} fromPlacement
 * @param {number} toPlacement
 * @param {string} filmId
 */
window.moveSupabasePersonalNomination = async function (
  personalAwardId,
  category,
  fromPlacement,
  toPlacement,
  filmId,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.rpc("move_personal_nomination", {
    p_personal_award_id: personalAwardId,
    p_category: category,
    p_from_placement: fromPlacement,
    p_to_placement: toPlacement,
    p_film_id: filmId,
  });
  if (error) throw error;
};

/**
 * Updates one nomination's detail field (role name, song title, or
 * other work-specific context) directly - no placement change, so no
 * bump cascade needed.
 * @param {string} nominationId
 * @param {string} detail
 */
window.updateSupabaseNominationDetail = async function (nominationId, detail) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("personal_nominations")
    .update({ detail: detail || null, updated_at: new Date().toISOString() })
    .eq("id", nominationId);
  if (error) throw error;
};

/**
 * Replaces one nomination's recipient list entirely (full delete then
 * insert, matching setSupabaseLocalRankOrder's own replace semantics).
 * @param {string} nominationId
 * @param {string[]} recipients
 * @returns {Promise<string[]>} New recipients left as plain text, with no catalog or TMDB person.
 */
window.updateSupabaseNominationRecipients = async function (
  nominationId,
  recipients,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let names = Array.from(
    new Set((recipients || []).map((name) => name.trim()).filter(Boolean)),
  );

  let { data: existingRows, error: selectError } = await ready.client
    .from("personal_nomination_recipients")
    .select("recipient_name")
    .eq("nomination_id", nominationId);
  if (selectError) throw selectError;

  let existingNames = new Set(
    (existingRows || []).map((r) => r.recipient_name),
  );
  let toAdd = names.filter((name) => !existingNames.has(name));
  let toDelete = (existingRows || []).filter(
    (r) => !names.includes(r.recipient_name),
  );

  let notAdded = [];
  if (toAdd.length) {
    await window.ensureCatalogIdentity?.();
    // A recipient links the existing person with that name, or else the
    // person TMDB finds for it; a name matching neither stays as plain
    // text, since no person is created without a TMDB ID. A lookup failure
    // also leaves plain text rather than blocking the award edit.
    let rows = [];
    for (let recipient_name of toAdd) {
      let personId = null;
      try {
        ({ personId } = await window.resolveSupabaseCatalogPerson(
          ready.client,
          { name: recipient_name },
        ));
      } catch (err) {
        console.warn(`Could not identify recipient "${recipient_name}"`, err);
      }
      if (!personId) notAdded.push(recipient_name);
      rows.push({
        nomination_id: nominationId,
        recipient_name,
        person_id: personId,
      });
    }
    let { error: insertError } = await ready.client
      .from("personal_nomination_recipients")
      .upsert(rows, {
        onConflict: "nomination_id,recipient_name",
        ignoreDuplicates: true,
      });
    if (insertError) throw insertError;
  }

  if (toDelete.length) {
    let { error: deleteError } = await ready.client
      .from("personal_nomination_recipients")
      .delete()
      .eq("nomination_id", nominationId)
      .in(
        "recipient_name",
        toDelete.map((r) => r.recipient_name),
      );
    if (deleteError) throw deleteError;
  }

  assertCurrentWorkspaceMutation(isCurrent);
  return notAdded;
};

// PostgREST's stock max_rows cap (supabase/config.toml). Several shared,
// non-personal tables already exceed this - the films catalog and
// official_categories/official_nominations among them - so a plain
// .select() would silently truncate them rather than error.
const SUPABASE_FETCH_PAGE_SIZE = 1000;

/**
 * Fetches every row of one table across as many `.range()` pages as
 * needed, learning the exact total from the first page (PostgREST's
 * Content-Range header, surfaced by supabase-js as `count` when the query
 * passes `{ count: "exact" }`) and firing the remaining pages in batches of
 * `maxConcurrency` via `Promise.all` - wall-clock time per batch is bounded
 * by its slowest request, not their sum. Mirrors
 * scripts/import-official-results-to-supabase.mjs's own fetchAll() in
 * spirit, but that Node script loops one page at a time (fine for a
 * one-off import; too slow for a page load).
 *
 * Default `maxConcurrency` is unbounded, matching every existing caller's
 * table-sized page counts. A caller whose query is heavy enough (e.g. a
 * multi-level join) and whose row count is large enough that firing every
 * page at once risks the database's `statement_timeout` under everyday
 * concurrent load should pass a modest cap instead - see
 * `loadSupabaseFilmCatalogForDataTools`.
 * @param {(withCount: boolean) => any} buildQuery Returns a FRESH,
 *   not-yet-sent query every call - e.g. `(withCount) =>
 *   client.from("official_categories").select("id,name", withCount ?
 *   { count: "exact" } : undefined)`. Never return/reuse a single shared
 *   builder: two in-flight `.range()` calls on the same builder instance
 *   would race each other's request state, since `.range()` mutates the
 *   builder rather than cloning it.
 * @param {number} [pageSize] Rows per page - defaults to PostgREST's max_rows.
 * @param {number} [maxConcurrency] Maximum pages in flight at once - defaults to unbounded.
 * @returns {Promise<Object[]>} Every row, first-page order then ascending range order.
 */
async function fetchAllSupabaseRows(
  buildQuery,
  pageSize = SUPABASE_FETCH_PAGE_SIZE,
  maxConcurrency = Infinity,
) {
  let first = await buildQuery(true).range(0, pageSize - 1);
  if (first.error) throw first.error;
  let rows = first.data || [];
  let total = typeof first.count === "number" ? first.count : rows.length;
  if (rows.length >= total) return rows;
  let pageStarts = [];
  for (let from = pageSize; from < total; from += pageSize)
    pageStarts.push(from);
  for (let i = 0; i < pageStarts.length; i += maxConcurrency) {
    let batch = pageStarts.slice(i, i + maxConcurrency);
    let pages = await Promise.all(
      batch.map((from) => buildQuery(false).range(from, from + pageSize - 1)),
    );
    pages.forEach((page) => {
      if (page.error) throw page.error;
      rows = rows.concat(page.data || []);
    });
  }
  return rows;
}

/** Fetches all pages of a Supabase query using its exact count. @param {(withCount: boolean) => any} buildQuery Builds a fresh query, requesting count when true. @param {number} [pageSize] Maximum rows per page. @param {number} [maxConcurrency] Maximum pages in flight at once. @returns {Promise<Object[]>} All selected rows. */
window.fetchAllSupabaseRows = fetchAllSupabaseRows;

// A watched/watchlist row's own columns as every hydration read selects
// them; the film embed is added per query.
const HYDRATION_WATCHED_FIELDS =
  "id, film_id, rating, rating_modifier, date_watched, review, want_to_rewatch, rewatch_tier, rewatch_tier_modifier, music_score, music_rating, music_rating_value, views, platform, updated_at";
const HYDRATION_WATCHLIST_FIELDS =
  "id, film_id, tier, tier_modifier, position, reason, added_at, updated_at";

// Every field a legacy read-only page's FilmRecord might display -
// credits/tags/franchises embedded directly (one round trip, no per-film
// N+1 query) rather than a separate bulk fetch per film id, since
// PostgREST resolves nested resources server-side. people(id, name), not
// just name: credits.person_id is a real, already-correct identity (see
// issue #633) - reshapeSharedFilmFields() carries the id through so
// director lookups can use it instead of re-deriving identity from the
// name string client-side.
const LEGACY_HYDRATION_FILM_FIELDS =
  "id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, primary_country, medium, type, screenplay_type, adaptation_source, swedish_title, letterboxd_url, credits(role, uncredited, people(id, name)), film_tags(tags(name)), film_franchises(franchises(id, name, parent_id))";

/**
 * The independently fetchable parts of the signed-in user's archive, in the
 * order loadSupabaseHydrationDomains() reports them. `franchises` and
 * `catalogFilms` are the shared catalogs; everything else is per-user.
 */
window.SUPABASE_HYDRATION_DOMAINS = Object.freeze([
  "watched",
  "watchlist",
  "rankings",
  "personalAwards",
  "franchises",
  "catalogFilms",
  "people",
  "ownProjects",
  "profile",
]);

/**
 * Domains that hold a subset of another domain's rows (issue #633), mapped
 * to that domain: never needed for a complete archive, and satisfied by the
 * superset whenever it is loaded. `franchiseWatchlist` is the watchlist rows
 * whose film belongs to at least one franchise; `taggedWatchlist` those whose
 * film carries at least one tag.
 */
window.SUPABASE_HYDRATION_SUBSET_DOMAINS = Object.freeze({
  franchiseWatchlist: "watchlist",
  taggedWatchlist: "watchlist",
});

const EMPTY_HYDRATION_DOMAIN_VALUES = {
  watched: [],
  watchlist: [],
  rankings: [],
  personalAwards: [],
  franchises: [],
  catalogFilms: [],
  people: [],
  ownProjects: [],
  profile: null,
  franchiseWatchlist: [],
  taggedWatchlist: [],
};

async function supabaseResultData(query) {
  let result = await query;
  if (result.error) throw result.error;
  return result.data;
}

// Watchlist rows whose film has at least one row in the embed named by
// `embedPrefix` (e.g. "film_tags("): !inner at both levels filters the rows,
// and every embedded row of a matching film is still returned. Same row shape
// as the `watchlist` domain, plus `order`: the row's 1-based position in the
// whole watchlist, which its index in the subset isn't.
async function loadWatchlistWithEmbed(client, embedPrefix) {
  let filmFields = LEGACY_HYDRATION_FILM_FIELDS.replace(
    embedPrefix,
    embedPrefix.replace("(", "!inner("),
  );
  let rows = await fetchAllSupabaseRows((withCount) =>
    client
      .from("watchlist")
      .select(
        `${HYDRATION_WATCHLIST_FIELDS}, films!inner(${filmFields})`,
        withCount ? { count: "exact" } : undefined,
      )
      .order("position")
      .order("id"),
  );
  return withWatchlistOrders(client, rows);
}

// Adds `order`, each row's 1-based position in the whole watchlist, to rows
// that are only part of it.
async function withWatchlistOrders(client, rows) {
  if (!rows.length) return rows;
  let ids = rows.map((row) => row.id);
  let orders;
  try {
    orders = await fetchAllSupabaseRows((withCount) =>
      client
        .rpc(
          "read_watchlist_orders",
          { p_ids: ids },
          withCount ? { count: "exact" } : undefined,
        )
        .order("id"),
    );
  } catch (error) {
    // Without the RPC the rows still load; items are then numbered within
    // the subset instead of the whole watchlist.
    console.warn?.("read_watchlist_orders failed", error);
    return rows;
  }
  let orderById = new Map(orders.map((row) => [row.id, row.order]));
  return rows.map((row) => ({ ...row, order: orderById.get(row.id) }));
}

const HYDRATION_DOMAIN_LOADERS = {
  watched: (client) =>
    fetchAllSupabaseRows((withCount) =>
      client
        .from("watched")
        .select(
          `${HYDRATION_WATCHED_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
          withCount ? { count: "exact" } : undefined,
        )
        .order("id"),
    ),
  watchlist: async (client) => {
    try {
      let { data, error } = await client.rpc("read_full_watchlist_projection");
      if (!error && Array.isArray(data)) return data;
      if (error)
        console.warn?.(
          "read_full_watchlist_projection failed, falling back to paged hydration",
          error,
        );
    } catch (e) {
      console.warn?.(
        "read_full_watchlist_projection exception, falling back to paged hydration",
        e,
      );
    }
    return fetchAllSupabaseRows((withCount) =>
      client
        .from("watchlist")
        .select(
          `${HYDRATION_WATCHLIST_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
          withCount ? { count: "exact" } : undefined,
        )
        .order("position")
        .order("id"),
    );
  },
  franchiseWatchlist: (client) =>
    loadWatchlistWithEmbed(client, "film_franchises("),
  taggedWatchlist: (client) => loadWatchlistWithEmbed(client, "film_tags("),
  rankings: async (client) => {
    let [rankings, rankingEntries] = await Promise.all([
      supabaseResultData(
        client.from("rankings").select("id, scope, scope_type"),
      ),
      fetchAllSupabaseRows((withCount) =>
        client
          .from("ranking_entries")
          .select(
            "ranking_id, film_id, position, rank_confirmed, suppress_all_time_rank, tie_group_id, tie_group_title",
            withCount ? { count: "exact" } : undefined,
          )
          .order("ranking_id")
          .order("position")
          .order("film_id"),
      ),
    ]);
    let entriesByRankingId = new Map();
    rankingEntries.forEach((entry) => {
      let entries = entriesByRankingId.get(entry.ranking_id) || [];
      entries.push(entry);
      entriesByRankingId.set(entry.ranking_id, entries);
    });
    return (rankings || []).map((ranking) => ({
      ...ranking,
      ranking_entries: entriesByRankingId.get(ranking.id) || [],
    }));
  },
  personalAwards: (client) =>
    supabaseResultData(
      client
        .from("personal_awards")
        .select(
          "id, scope, scope_type, personal_nominations(id, category, placement, film_id, detail, personal_nomination_recipients(recipient_name, person_id))",
        )
        .order("placement", { foreignTable: "personal_nominations" }),
    ),
  // The shared catalogs are paginated (issue #463): a plain .select()
  // risks PostgREST's max_rows cap silently truncating them.
  franchises: (client) =>
    fetchAllSupabaseRows((withCount) =>
      client
        .from("franchises")
        .select(
          "id, name, parent_id",
          withCount ? { count: "exact" } : undefined,
        ),
    ),
  catalogFilms: async (client) => {
    try {
      let { data, error } = await client.rpc("read_catalog_film_summaries");
      if (!error && Array.isArray(data)) return data;
      if (error)
        console.warn?.(
          "read_catalog_film_summaries failed, falling back to paged hydration",
          error,
        );
    } catch (e) {
      console.warn?.(
        "read_catalog_film_summaries exception, falling back to paged hydration",
        e,
      );
    }
    return fetchAllSupabaseRows((withCount) =>
      client
        .from("films")
        .select(
          LEGACY_HYDRATION_FILM_FIELDS,
          withCount ? { count: "exact" } : undefined,
        ),
    );
  },
  people: (client) =>
    fetchAllSupabaseRows((withCount) =>
      client
        .from("people")
        .select(
          "id, name, portrait_url, portrait_source, portrait_source_url, portrait_provider_id, portrait_fetched_at",
          withCount ? { count: "exact" } : undefined,
        )
        .not("portrait_url", "is", null)
        .order("id"),
    ),
  // Every project the user owns (issue #458), queried from collections with
  // !inner on projects: collections.id is the project's own id (issue
  // #456), and the single-level order-by-foreignTable form is the proven
  // one.
  ownProjects: (client) =>
    supabaseResultData(
      client
        .from("collections")
        .select(
          "id, name, source_label, source_type, source_id, created_at, projects!inner(status, pinned, updated_at), collection_items(film_id, position)",
        )
        .order("position", { foreignTable: "collection_items" }),
    ),
  // Scoped by id, not left to RLS alone: published profiles are readable by
  // anyone (issue #452), so an unfiltered select returns several rows and
  // .maybeSingle() throws.
  profile: (client, userId) =>
    supabaseResultData(
      client
        .from("profiles")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle(),
    ),
};

/**
 * Loads the requested parts of the signed-in user's archive as raw rows
 * for src/domain/supabase-legacy-hydration.js (issue #633). Every domain
 * not requested comes back empty, and `domains` lists exactly the ones
 * that were loaded, so a partial source is never mistaken for the
 * complete archive. Signed out, every domain is empty.
 * @param {string[]} [domains] Names from SUPABASE_HYDRATION_DOMAINS; all when omitted.
 * @returns {Promise<Object>} Raw rows per domain plus `domains`.
 */
window.loadSupabaseHydrationDomains = async function (
  domains = window.SUPABASE_HYDRATION_DOMAINS,
) {
  let requested = Object.keys(HYDRATION_DOMAIN_LOADERS).filter((domain) =>
    domains.includes(domain),
  );
  let source = { ...EMPTY_HYDRATION_DOMAIN_VALUES, domains: requested };
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in") return source;
  let values = await Promise.all(
    requested.map((domain) =>
      HYDRATION_DOMAIN_LOADERS[domain](ready.client, authState.user.id),
    ),
  );
  requested.forEach((domain, index) => {
    source[domain] = values[index] ?? EMPTY_HYDRATION_DOMAIN_VALUES[domain];
  });
  return source;
};

/**
 * Loads the complete archive: every domain loadSupabaseHydrationDomains()
 * knows. Not cached here; edit-capable callers refresh it after writes
 * (issues #438, #440).
 * @returns {Promise<Object>} Raw rows, reshaped entirely by the caller.
 */
window.loadSupabaseLegacyHydrationSource = function () {
  return window.loadSupabaseHydrationDomains();
};

/**
 * Loads the watchlist and unseen-catalog half of the people index, one row
 * per credited person (issue #633, read_people_directory_edges()), so a
 * people page can skip the watchlist and shared-catalog hydration domains.
 * Cached per session alongside the hydration cache, and invalidated with it.
 * @param {Object} [options]
 * @param {boolean} [options.allWatchlistItems] Every watchlist item per person instead of a three-item preview.
 * @returns {Promise<Object[]>} `{person_id, name, watchlist_ids, watchlist_preview, catalog_films}` rows.
 */
window.loadSupabasePeopleDirectoryEdges = async function (options = {}) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let allWatchlistItems = Boolean(options.allWatchlistItems);
  let authState = await window.resolveSupabaseAuthState?.();
  let userId = authState?.status === "signed-in" ? authState.user?.id : null;
  let cached = window.readCachedPeopleDirectoryEdges?.(
    userId,
    allWatchlistItems,
  );
  if (cached) return cached;
  let rows = await fetchAllSupabaseRows((withCount) =>
    ready.client
      .rpc(
        "read_people_directory_edges",
        { p_all_watchlist_items: allWatchlistItems },
        withCount ? { count: "exact" } : undefined,
      )
      .order("person_id"),
  );
  window.writeCachedPeopleDirectoryEdges?.(userId, allWatchlistItems, rows);
  return rows;
};

// A nomination's first film embeds as `films`; the further films of a
// multi-film nomination as `official_nomination_extra_films`, by position.
const OFFICIAL_NOMINATION_FIELDS =
  "id, category_id, film_id, is_winner, source_id, source_title, original_title, source_category, detail, country, recipient_text, films(id, tmdb_id, tmdb_tv_ref, title, year), official_nomination_extra_films(position, films(id, tmdb_id, tmdb_tv_ref, title, year))";

/**
 * Loads every table src/domain/supabase-official-results-hydration.js
 * needs to rebuild state.officialResults from live data - every ceremony,
 * category, and nomination across every imported source
 * (academy-awards, cannes, guldbaggen), each nomination's matched film
 * embedded directly so no per-nomination lookup is needed. Deliberately
 * separate from loadSupabaseLegacyHydrationSource() above, and NOT called
 * from ensureOskarsData()'s shared bootstrap: only the handful of pages
 * that render official-results content call this, since paginating
 * ~1,900 categories and ~9,300 nominations on every one of the app's
 * pages would regress every other page's performance budget for no
 * benefit. Not cached - called fresh on every visit to a page that needs
 * it, matching every other page-specific Supabase read in this codebase.
 * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
 */
window.loadSupabaseOfficialResultsSource = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in")
    return { ceremonies: [], categories: [], nominations: [] };
  let client = ready.client;
  let [ceremoniesResult, categories, nominations] = await Promise.all([
    client
      .from("official_ceremonies")
      .select(
        "id, source, year, period_key, period_type, ceremony_label, source_url",
      ),
    fetchAllSupabaseRows((withCount) =>
      client
        .from("official_categories")
        .select(
          "id, ceremony_id, name",
          withCount ? { count: "exact" } : undefined,
        ),
    ),
    fetchAllSupabaseRows((withCount) =>
      client
        .from("official_nominations")
        .select(
          OFFICIAL_NOMINATION_FIELDS,
          withCount ? { count: "exact" } : undefined,
        ),
    ),
  ]);
  if (ceremoniesResult.error) throw ceremoniesResult.error;
  return {
    ceremonies: ceremoniesResult.data || [],
    categories,
    nominations,
  };
};

/**
 * Loads Academy Awards official-results data scoped to one film (issue
 * #633) - the read film.html actually needs (officialFilmContext() only
 * ever reads state.officialResults["academy-awards"], filtered to
 * nominations whose filmRef.id matches this one film), instead of
 * loadSupabaseOfficialResultsSource()'s unconditional ~1,900
 * categories/~9,300 nominations across every source. One query, filtered
 * by film_id, with its category/ceremony ancestors embedded (a plain
 * many-to-one join, not the child-side !inner+eq filtering the personal
 * compact reads use) - reshaped back into the same flat
 * {ceremonies, categories, nominations} arrays
 * loadSupabaseOfficialResultsSource() returns, so
 * buildOfficialResultsFromSupabase() keeps working completely unmodified
 * on either source. Every ceremony/category this film has ever been
 * nominated in is included even if unrelated films share them - nothing
 * here trims a category/ceremony down to just this film's own row within
 * it, since buildOfficialResultsFromSupabase() only ever reads the
 * nominations it's actually handed anyway.
 * @param {string} filmId
 * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
 */
window.loadSupabaseOfficialResultsForFilm = async function (filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  // A film is credited either as a nomination's film_id or as one of its
  // further films.
  let { data: extraLinks, error: extraError } = await ready.client
    .from("official_nomination_extra_films")
    .select("nomination_id")
    .eq("film_id", filmId);
  if (extraError) throw extraError;
  let extraIds = (extraLinks || []).map((row) => row.nomination_id);
  let { data, error } = await ready.client
    .from("official_nominations")
    .select(
      `${OFFICIAL_NOMINATION_FIELDS}, official_categories!inner(id, ceremony_id, name, official_ceremonies!inner(id, source, year, period_key, period_type, ceremony_label, source_url))`,
    )
    .or(
      extraIds.length
        ? `film_id.eq.${filmId},id.in.(${extraIds.join(",")})`
        : `film_id.eq.${filmId}`,
    )
    // official_categories!inner/official_ceremonies!inner above turn this
    // into a real inner-join filter - a non-academy-awards nomination row
    // is excluded entirely, not just missing its embed (confirmed against
    // real Postgres: without !inner on both levels, a plain .eq() here
    // still returns the row with the embed merely nulled out).
    .eq("official_categories.official_ceremonies.source", "academy-awards");
  if (error) throw error;
  let ceremoniesById = new Map();
  let categoriesById = new Map();
  let nominations = [];
  (data || []).forEach((row) => {
    let category = row.official_categories;
    let ceremony = category?.official_ceremonies;
    // Never actually null given the !inner filtering above - defensive
    // only, matching loadSupabaseOfficialResultsSource()'s own FK-orphan
    // guard.
    if (!category || !ceremony) return;
    ceremoniesById.set(ceremony.id, {
      id: ceremony.id,
      source: ceremony.source,
      year: ceremony.year,
      period_key: ceremony.period_key,
      period_type: ceremony.period_type,
      ceremony_label: ceremony.ceremony_label,
      source_url: ceremony.source_url,
    });
    categoriesById.set(category.id, {
      id: category.id,
      ceremony_id: category.ceremony_id,
      name: category.name,
    });
    nominations.push({
      id: row.id,
      category_id: row.category_id,
      film_id: row.film_id,
      is_winner: row.is_winner,
      source_id: row.source_id,
      source_title: row.source_title,
      original_title: row.original_title,
      source_category: row.source_category,
      detail: row.detail,
      country: row.country,
      recipient_text: row.recipient_text,
      films: row.films,
      official_nomination_extra_films: row.official_nomination_extra_films,
    });
  });
  return {
    ceremonies: [...ceremoniesById.values()],
    categories: [...categoriesById.values()],
    nominations,
  };
};

// PostgREST or()/ilike value quoting: double-quoted, with \ and " escaped,
// so a name containing a comma or parenthesis can't break the filter.
function postgrestQuoted(value) {
  return `"${String(value).replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

// ilike wildcards in a literal value, escaped so a name is matched as text.
function ilikeLiteral(value) {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Runs an .in() query (or update) in chunks of ids, so a long id list never
// becomes an over-long request URL. Each chunk's result must stay under
// PostgREST's row cap.
async function selectInChunks(ids, runChunk, chunkSize = 100) {
  let rows = [];
  for (let start = 0; start < ids.length; start += chunkSize) {
    let { data, error } = await runChunk(ids.slice(start, start + chunkSize));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

// Every ceremony (a few hundred rows) plus only the nominations `filter`
// keeps, in loadSupabaseOfficialResultsSource()'s flat shape. Returning
// every ceremony means a source with no matching nominations still
// replaces its bundled default with an empty live one, exactly as the
// complete read would. `categoryEmbed` must embed official_categories
// (with any ancestor the filter targets marked !inner at every level); a
// null `filter` matches no nominations.
async function loadScopedOfficialResults(client, categoryEmbed, filter) {
  let ceremoniesResult = await client
    .from("official_ceremonies")
    .select(
      "id, source, year, period_key, period_type, ceremony_label, source_url",
    );
  if (ceremoniesResult.error) throw ceremoniesResult.error;
  let rows = !filter
    ? []
    : await fetchAllSupabaseRows((withCount) =>
        filter(
          client
            .from("official_nominations")
            .select(
              `${OFFICIAL_NOMINATION_FIELDS}, ${categoryEmbed}`,
              withCount ? { count: "exact" } : undefined,
            ),
        ),
      );
  let categoriesById = new Map();
  let nominations = rows.map((row) => {
    let { official_categories: category, ...nomination } = row;
    if (category)
      categoriesById.set(category.id, {
        id: category.id,
        ceremony_id: category.ceremony_id,
        name: category.name,
      });
    return nomination;
  });
  return {
    ceremonies: ceremoniesResult.data || [],
    categories: [...categoriesById.values()],
    nominations,
  };
}

/**
 * Loads official results matching a person's recipient text (issue #633)
 * - the read person.html's officialPersonRecords() needs, instead of
 * loadSupabaseOfficialResultsSource()'s complete ~9,300 nominations.
 * officialPersonRecord() already matches by case-insensitive substring of
 * the recipient text against the person's name/aliases and then narrows
 * to exact person ids; the same substring filter runs here in SQL, so it
 * returns a superset the unchanged client logic narrows exactly as
 * before.
 * @param {string[]} needles Name and alias strings to match.
 * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
 */
window.loadSupabaseOfficialResultsForRecipients = async function (needles) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let terms = [
    ...new Set(
      (needles || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  ];
  return loadScopedOfficialResults(
    ready.client,
    "official_categories(id, ceremony_id, name)",
    !terms.length
      ? null
      : (query) =>
          query.or(
            terms
              .map(
                (term) =>
                  `recipient_text.ilike.${postgrestQuoted(`*${ilikeLiteral(term)}*`)}`,
              )
              .join(","),
          ),
  );
};

/**
 * Loads one official category's complete history across every source
 * (issue #633) - category.html only ever reads nominations whose category
 * name equals the page's category, so the other categories' nominations
 * are never fetched.
 * @param {string} categoryName Official category name, e.g. "Best Picture".
 * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
 */
window.loadSupabaseOfficialResultsForCategory = async function (categoryName) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  return loadScopedOfficialResults(
    ready.client,
    "official_categories!inner(id, ceremony_id, name)",
    (query) => query.eq("official_categories.name", String(categoryName)),
  );
};

/**
 * Loads every source's official results for one period key (issue #633) -
 * period.html's year view only ever reads `periods[key]` of each source.
 * @param {string} periodKey Ceremony period key, e.g. "2019".
 * @returns {Promise<{ceremonies: Object[], categories: Object[], nominations: Object[]}>}
 */
window.loadSupabaseOfficialResultsForPeriod = async function (periodKey) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  return loadScopedOfficialResults(
    ready.client,
    "official_categories!inner(id, ceremony_id, name, official_ceremonies!inner(period_key))",
    (query) =>
      query.eq(
        "official_categories.official_ceremonies.period_key",
        String(periodKey),
      ),
  );
};

/**
 * Loads the signed-in user's archive for a chosen set of films (issue #633),
 * shaped as a hydration `source` for buildLegacyStateFromSupabaseHydration():
 * their watched and watchlist rows, real ranks (read_ranking_positions),
 * every personal nomination on them, and their shared-catalog rows, plus
 * the franchise catalog for membership chains. Reads are chunked, so a long
 * film list never becomes one oversized request URL.
 * @param {string[]} filmIds Film uuids.
 * @param {{catalogFilmIds?: string[]}} [options] Films whose catalog rows to load; all of `filmIds` when omitted.
 * @returns {Promise<{watched: Object[], watchlist: Object[], rankings: Object[], personalAwards: Object[], franchises: Object[], catalogFilms: Object[]}>}
 */
window.loadSupabaseFilmsSource = async function (filmIds, options = {}) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let ids = [...new Set((filmIds || []).filter(Boolean))];
  let catalogIds = options.catalogFilmIds || ids;
  let [watched, watchlist, rankings, awardChunks, franchises, catalogFilms] =
    await Promise.all([
      selectInChunks(ids, (chunk) =>
        client
          .from("watched")
          .select(
            `${HYDRATION_WATCHED_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
          )
          .in("film_id", chunk)
          .order("id"),
      ),
      // Relative order only: a watchlist item's `order` comes from its
      // position in this array, and this is a subset of the watchlist -
      // sorted the same way, so relative order within it is unchanged.
      selectInChunks(ids, (chunk) =>
        client
          .from("watchlist")
          .select(
            `${HYDRATION_WATCHLIST_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
          )
          .in("film_id", chunk)
          .order("position")
          .order("id"),
      ),
      window.loadSupabaseRankingsForFilms(ids),
      selectInChunks(ids, (chunk) =>
        client
          .from("personal_awards")
          .select(
            "id, scope, scope_type, personal_nominations!inner(id, category, placement, film_id, detail, personal_nomination_recipients(recipient_name, person_id))",
          )
          .in("personal_nominations.film_id", chunk)
          .order("placement", { foreignTable: "personal_nominations" }),
      ),
      ids.length ? HYDRATION_DOMAIN_LOADERS.franchises(client) : [],
      selectInChunks(catalogIds, (chunk) =>
        client
          .from("films")
          .select(LEGACY_HYDRATION_FILM_FIELDS)
          .in("id", chunk),
      ),
    ]);
  // One award can come back from several chunks, each with that chunk's
  // nominations: merge them, keeping placement order.
  let awardsById = new Map();
  awardChunks.forEach((award) => {
    let merged = awardsById.get(award.id);
    if (!merged) awardsById.set(award.id, { ...award });
    else
      merged.personal_nominations = merged.personal_nominations.concat(
        award.personal_nominations || [],
      );
  });
  let personalAwards = [...awardsById.values()].map((award) => ({
    ...award,
    personal_nominations: [...(award.personal_nominations || [])].sort(
      (left, right) => Number(left.placement) - Number(right.placement),
    ),
  }));
  return {
    watched,
    watchlist,
    rankings,
    personalAwards,
    franchises,
    catalogFilms,
  };
};

/**
 * Loads one person's complete slice of the signed-in user's archive
 * (issue #633) - the compact read behind person.html, instead of the
 * whole archive. A person's films are the ones they're credited as
 * director on (credits.person_id - the only credit role this app stores)
 * plus the ones they're a personal-award recipient on (recipient
 * person_id, or an exact case-insensitive name match for rows written
 * before recipients carried an id). For exactly those films it returns
 * the watched/watchlist rows, real ranks (read_ranking_positions), every
 * personal nomination on them (collaborators on the same films included),
 * their shared-catalog rows (the Unseen section) and this person's own
 * projects - shaped as a `source` for the unchanged
 * buildLegacyStateFromSupabaseHydration()/rebuildPeopleIndex() pipeline,
 * so the person record it produces matches the complete read's.
 * @param {string} personId people.id uuid.
 * @returns {Promise<Object|null>} Scoped source plus `person`, or null if no such person.
 */
window.loadSupabasePersonDetail = async function (personId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let [personResult, directedResult] = await Promise.all([
    client
      .from("people")
      .select(
        "id, name, portrait_url, portrait_source, portrait_source_url, portrait_provider_id, portrait_fetched_at",
      )
      .eq("id", personId)
      .maybeSingle(),
    client
      .from("credits")
      .select("film_id")
      .eq("person_id", personId)
      .eq("role", "director"),
  ]);
  if (personResult.error) throw personResult.error;
  if (directedResult.error) throw directedResult.error;
  let person = personResult.data;
  if (!person) return null;
  let recipientResult = await client
    .from("personal_nomination_recipients")
    .select("personal_nominations!inner(film_id)")
    .or(
      `person_id.eq.${personId},recipient_name.ilike.${postgrestQuoted(ilikeLiteral(person.name))}`,
    );
  if (recipientResult.error) throw recipientResult.error;
  let directedIds = (directedResult.data || []).map((row) => row.film_id);
  let filmIds = [
    ...new Set([
      ...directedIds,
      ...(recipientResult.data || []).map(
        (row) => row.personal_nominations?.film_id,
      ),
    ]),
  ].filter(Boolean);
  let slug = window.normalizePersonName?.(person.name) || "";
  let [source, projectsResult] = await Promise.all([
    window.loadSupabaseFilmsSource(filmIds, { catalogFilmIds: directedIds }),
    client
      .from("collections")
      .select(
        "id, name, source_label, source_type, source_id, created_at, projects!inner(status, pinned, updated_at), collection_items(film_id, position)",
      )
      .eq("source_type", "person")
      .in("source_id", [personId, slug].filter(Boolean))
      .order("position", { foreignTable: "collection_items" }),
  ]);
  if (projectsResult.error) throw projectsResult.error;
  return {
    person,
    ...source,
    people: person.portrait_url ? [person] : [],
    ownProjects: projectsResult.data || [],
    profile: null,
  };
};

/**
 * Loads one watchlist item by id, with its full film join (credits,
 * tags, franchises) - the single-item detail read the watchlisted branch
 * of `film.html` needs, distinct from the bulk hydration query above.
 * @param {string} watchlistId
 * @returns {Promise<Object|null>}
 */
window.loadSupabaseWatchlistItemDetail = async function (watchlistId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("watchlist")
    .select(
      `${HYDRATION_WATCHLIST_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
    )
    .eq("id", watchlistId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

/**
 * Loads the caller's ranking entries for a set of films, each carrying
 * its real rank within the whole ranking (issue #633), shaped like
 * loadSupabaseLegacyHydrationSource()'s `rankings` so
 * buildLegacyStateFromSupabaseHydration() consumes it unchanged. The rank
 * comes from read_ranking_positions() in SQL: a compact read only has
 * these films' own entries, so the client can't derive rank from array
 * position the way the complete read does.
 * @param {string[]} filmIds
 * @returns {Promise<Object[]>} Rankings with nested, rank-ordered entries.
 */
window.loadSupabaseRankingsForFilms = async function (filmIds) {
  let ids = [...new Set((filmIds || []).filter(Boolean))];
  if (!ids.length) return [];
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("read_ranking_positions", {
    p_film_ids: ids,
  });
  if (error) throw error;
  let rankings = new Map();
  (data || []).forEach((row) => {
    let ranking = rankings.get(row.ranking_id);
    if (!ranking) {
      ranking = {
        id: row.ranking_id,
        scope: row.scope,
        scope_type: row.scope_type,
        ranking_entries: [],
      };
      rankings.set(row.ranking_id, ranking);
    }
    ranking.ranking_entries.push({
      ranking_id: row.ranking_id,
      film_id: row.film_id,
      position: row.position,
      rank: Number(row.rank),
      rank_confirmed: row.rank_confirmed,
      suppress_all_time_rank: row.suppress_all_time_rank,
      tie_group_id: row.tie_group_id,
      tie_group_title: row.tie_group_title,
    });
  });
  return [...rankings.values()];
};

let filmDetailInFlight = new Map();

/**
 * Clears in-flight film detail request deduplication promises.
 */
window.clearSupabaseFilmDetailInFlight = function () {
  filmDetailInFlight.clear();
};

/**
 * Loads one film's complete personal slice - the compact read behind
 * film.html's fast initial paint (issue #617) instead of eager full
 * archive hydration. Every table read here is scoped to `filmId` via
 * PostgREST's embedded-resource `!inner` + `.eq()` filtering (proven
 * against the real RLS policies, which are all already scoped to
 * `auth.uid()` on the owning parent row regardless of any extra WHERE
 * clause a caller adds - no new RLS or migration needed), so the
 * response shape is a drop-in, unmodified `source` argument for
 * `buildLegacyStateFromSupabaseHydration()`: the exact same reshape
 * logic every page already uses, just fed a one-film slice instead of
 * the complete archive.
 *
 * Two pieces of the full hydration are deliberately left out, not
 * forgotten. `catalogFilms`/`people` stay empty here, matching the
 * signed-out default shape above - the credits section they drive
 * (`rebuildPeopleIndex()`'s archive-wide alias/name index) is exactly
 * the shared people/franchise infrastructure issue #617 rules out
 * touching in this pass. `ownProjects` also stays empty: unlike
 * rankings/personal_awards, a project's progress needs its *complete*
 * item list (`window.projectProgress()` resolves every one of a
 * project's `filmRefs`, not just the one matching this film), so a
 * `collection_items` filter narrow enough to be cheap here would also
 * be too narrow to report an honest watched/total count - a two-query
 * "find the containing projects, then fetch them whole" round trip
 * would work but isn't worth it for this one secondary section. Both
 * sections defer until the real background full hydration lands,
 * unchanged, same as film.js already does for the watchlist-detail
 * view's archive-match-review section (a genuine cross-item check).
 *
 * A fresh session-cache entry is returned without a request, and
 * concurrent calls for the same film share one in-flight request.
 * @param {string} filmId
 * @returns {Promise<Object>} A `source`-shaped object scoped to one film.
 */
window.loadSupabaseFilmDetail = async function (filmId) {
  let authState = await window.resolveSupabaseAuthState?.();
  let userId = authState?.user?.id;
  if (userId) {
    let cached = window.readCachedSupabaseFilmDetail?.(userId, filmId);
    if (cached) return cached;
  }
  if (filmDetailInFlight.has(filmId)) {
    return filmDetailInFlight.get(filmId);
  }
  let promise = (async () => {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let client = ready.client;
    let [
      watchedResult,
      watchlistResult,
      rankingsResult,
      personalAwardsResult,
      franchisesResult,
    ] = await Promise.all([
      client
        .from("watched")
        .select(
          `${HYDRATION_WATCHED_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
        )
        .eq("film_id", filmId)
        .maybeSingle(),
      client
        .from("watchlist")
        .select(
          `${HYDRATION_WATCHLIST_FIELDS}, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
        )
        .eq("film_id", filmId)
        .maybeSingle(),
      window.loadSupabaseRankingsForFilms([filmId]).then(
        (data) => ({ data, error: null }),
        (error) => ({ data: null, error }),
      ),
      client
        .from("personal_awards")
        .select(
          "id, scope, scope_type, personal_nominations!inner(id, category, placement, film_id, detail, personal_nomination_recipients(recipient_name, person_id))",
        )
        .eq("personal_nominations.film_id", filmId)
        .order("placement", { foreignTable: "personal_nominations" }),
      HYDRATION_DOMAIN_LOADERS.franchises(client).then(
        (data) => ({ data, error: null }),
        (error) => ({ data: null, error }),
      ),
    ]);
    for (let result of [
      watchedResult,
      watchlistResult,
      rankingsResult,
      personalAwardsResult,
      franchisesResult,
    ])
      if (result.error) throw result.error;
    let payload = {
      watched: watchedResult.data ? [watchedResult.data] : [],
      watchlist: watchlistResult.data ? [watchlistResult.data] : [],
      rankings: rankingsResult.data || [],
      personalAwards: personalAwardsResult.data || [],
      franchises: franchisesResult.data || [],
      catalogFilms: [],
      people: [],
      ownProjects: [],
      profile: null,
    };
    if (userId) {
      window.writeCachedSupabaseFilmDetail?.(userId, filmId, payload);
    }
    return payload;
  })().finally(() => {
    filmDetailInFlight.delete(filmId);
  });
  filmDetailInFlight.set(filmId, promise);
  return promise;
};

/**
 * Loads the signed-in user's open projects containing one film, each with
 * its total item count and how many are watched (issue #636,
 * read_active_projects_for_film()) - film.html's Active projects section,
 * scoped to this film instead of the whole `ownProjects` domain plus every
 * other project's own film list.
 * @param {string} filmId Film uuid.
 * @returns {Promise<Object[]>} `{id, name, source_label, status, pinned, updated_at, total, watched_count}` rows, pinned/most-recently-updated first.
 */
window.loadSupabaseActiveProjectsForFilm = async function (filmId) {
  if (!window.isUuid?.(filmId)) return [];
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc(
    "read_active_projects_for_film",
    { p_film_id: filmId },
  );
  if (error) throw error;
  return data || [];
};

/**
 * Loads the signed-in user's own watched films whose title normalizes the
 * same as the given title (issue #636, read_watched_title_matches()) -
 * film.html's watchlist-detail Archive match review, scoped to one lookup
 * instead of walking every loaded watched film.
 * @param {string} title Watchlist item's title.
 * @returns {Promise<Object[]>} `{film_id, title, year}` rows.
 */
window.loadSupabaseWatchedTitleMatches = async function (title) {
  let normalized = String(title || "").trim();
  if (!normalized) return [];
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("read_watched_title_matches", {
    p_title: normalized,
  });
  if (error) throw error;
  return data || [];
};

/**
 * Atomically moves a watchlist film to watched and opens its Intake
 * (issue #439, wraps `create_watchlist_watched_intake()` - the same
 * atomicity #437's `create_fresh_watched_intake()` established, applied
 * to a film that's already in the shared catalog and on the caller's
 * watchlist rather than a brand-new one).
 * @param {string} watchlistId
 * @param {{rating?: number, ratingModifier?: string, dateWatched?: string, platform?: string, views?: number}} values
 * @returns {Promise<Object>} The joined intake_workflows row.
 */
window.createSupabaseWatchlistWatchedIntake = async function (
  watchlistId,
  values,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc(
    "create_watchlist_watched_intake",
    {
      p_watchlist_id: watchlistId,
      p_rating: values.rating ? Number(values.rating) : null,
      p_rating_modifier: values.ratingModifier || null,
      p_date_watched: values.dateWatched || null,
      p_platform: values.platform || null,
      p_views: values.views ? Number(values.views) : 1,
    },
  );
  if (error) throw error;
  let { data: joined, error: selectError } = await ready.client
    .from("intake_workflows")
    .select(INTAKE_WORKFLOW_SELECT)
    .eq("id", data.id)
    .single();
  if (selectError) throw selectError;
  await window.refreshSupabaseWorkspace();
  return joined;
};

/**
 * Updates a watchlist item's interest tier (and its optional minus/plus
 * refinement, default null/unmodified) straight through to Supabase.
 * @param {string} watchlistId
 * @param {string} tier
 * @param {'minus'|'plus'|''} [modifier]
 */
window.setSupabaseWatchlistTier = async function (watchlistId, tier, modifier) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let isCurrent = beginWorkspaceMutation();

  let cached = workspaceState?.watchlist?.find((row) => row.id === watchlistId);
  let staleUpdatedAt = cached?.updated_at;

  let query = ready.client
    .from("watchlist")
    .update({
      tier: tier || null,
      tier_modifier: modifier || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", watchlistId);

  if (staleUpdatedAt) {
    query = query.eq("updated_at", staleUpdatedAt);
  }

  let { data, error } = await query.select(WATCHLIST_SELECT).maybeSingle();
  if (error) throw error;

  if (staleUpdatedAt && !data) {
    let conflictErr = new Error(
      "Watchlist item was modified in another session. Refreshing before retrying.",
    );
    conflictErr.code = "OSKARS_STALE_WRITE";
    throw conflictErr;
  }

  assertCurrentWorkspaceMutation(isCurrent);
  if (workspaceState && data) {
    let idx = workspaceState.watchlist.findIndex(
      (row) => row.id === watchlistId,
    );
    if (idx >= 0) workspaceState.watchlist[idx] = data;
  }
};

/**
 * Finds or creates one of the signed-in user's own tags by name (tags
 * are per-user, unlike the shared/create-only films-people-credits
 * catalog - a real update/delete is fine here).
 * @param {Object} client Ready Supabase client.
 * @param {string} name
 * @returns {Promise<string>} The tag row's id.
 */
async function getOrCreateSupabaseTagId(client, name) {
  let { data: existing, error: selectError } = await client
    .from("tags")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing.id;
  let { data: created, error: insertError } = await client
    .from("tags")
    .insert({ name })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      let { data: retryExisting, error: retryError } = await client
        .from("tags")
        .select("id")
        .eq("name", name)
        .single();
      if (retryError) throw retryError;
      return retryExisting.id;
    }
    throw insertError;
  }
  return created.id;
}

/**
 * Adds one of the signed-in user's own tags to a film.
 * @param {string} filmId
 * @param {string} tagName
 */
window.addSupabaseFilmTag = async function (filmId, tagName) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let tagId = await getOrCreateSupabaseTagId(ready.client, tagName);
  let { error } = await ready.client
    .from("film_tags")
    .upsert(
      { film_id: filmId, tag_id: tagId },
      { onConflict: "user_id,film_id,tag_id" },
    );
  if (error) throw error;
};

/**
 * Removes one of the signed-in user's own tags from a film.
 * @param {string} filmId
 * @param {string} tagName
 */
window.removeSupabaseFilmTag = async function (filmId, tagName) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data: tag, error: selectError } = await ready.client
    .from("tags")
    .select("id")
    .eq("name", tagName)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!tag) return;
  let { error } = await ready.client
    .from("film_tags")
    .delete()
    .eq("film_id", filmId)
    .eq("tag_id", tag.id);
  if (error) throw error;
};

/**
 * Adds a film to a franchise, finding or creating the franchise (and its
 * direct parent, if named) by name first. `franchises`/`film_franchises`
 * are create-only for ordinary clients like the rest of the shared
 * catalog (docs/supabase-backend-decision.md's "Correcting a mistaken
 * shared-catalog write") - this can only ever add a new membership, not
 * edit or remove an existing one.
 * @param {string} filmId
 * @param {string} franchiseName
 * @param {string} [parentFranchiseName]
 */
window.addSupabaseFilmFranchiseMembership = async function (
  filmId,
  franchiseName,
  parentFranchiseName,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  async function findOrCreateFranchise(name, parentId) {
    let slug =
      window.normalizeFranchiseId?.(name) || window.normalizeTitle(name);
    let { data: existing, error: selectError } = await client
      .from("franchises")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing.id;
    let { data: created, error: insertError } = await client
      .from("franchises")
      .insert({ name, slug, parent_id: parentId || null })
      .select("id")
      .single();
    if (insertError) throw insertError;
    return created.id;
  }
  let parentId = parentFranchiseName
    ? await findOrCreateFranchise(parentFranchiseName, null)
    : null;
  let franchiseId = await findOrCreateFranchise(franchiseName, parentId);
  let { error } = await client
    .from("film_franchises")
    .insert({ film_id: filmId, franchise_id: franchiseId });
  if (error && error.code !== "23505") throw error;
};

/**
 * Loads the full shared franchise catalog (id/name/parent_id only) - the
 * small, shared/objective table `buildSupabaseFranchiseChains()`
 * (src/domain/supabase-legacy-hydration.js) needs to resolve a single
 * film's franchise ancestor chain outside the bulk hydration pass.
 * @returns {Promise<Object[]>}
 */
/**
 * Moves the signed-in user's rows stored under a legacy key to their new
 * key (issue #633's lazy person-key migration: a person's notes, local
 * ranks, director ballot and person project move from the name slug to
 * the people.id uuid the first time they're opened under it). Leaves the
 * legacy rows alone if anything already exists under the new key, rather
 * than merging or overwriting it. RLS keeps both reads and the update to
 * the caller's own rows.
 * @param {{table: string, kindColumn: string, kind: string, keyColumn: string, fromKey: string, toKey: string}} options
 * @returns {Promise<boolean>} Whether any rows were moved.
 */
window.adoptLegacySupabaseKey = async function ({
  table,
  kindColumn,
  kind,
  keyColumn,
  fromKey,
  toKey,
}) {
  if (!fromKey || !toKey || fromKey === toKey) return false;
  let ready = await window.ensureSupabaseClient();
  if (!ready) return false;
  let { count, error: existingError } = await ready.client
    .from(table)
    .select(keyColumn, { count: "exact", head: true })
    .eq(kindColumn, kind)
    .eq(keyColumn, toKey);
  if (existingError) throw existingError;
  if (count) return false;
  let { data, error } = await ready.client
    .from(table)
    .update({ [keyColumn]: toKey })
    .eq(kindColumn, kind)
    .eq(keyColumn, fromKey)
    .select(keyColumn);
  if (error) throw error;
  return (data || []).length > 0;
};

/**
 * Runs adoptLegacySupabaseKey() for every table a person's own data lives
 * in. Best-effort: a failure leaves that data on its old key, where
 * nothing reads it any more, so it's logged rather than thrown.
 * @param {string} slug Legacy name slug.
 * @param {string} personId people.id uuid.
 * @returns {Promise<void>}
 */
window.adoptLegacyPersonKeys = async function (slug, personId) {
  if (!slug || !personId || slug === personId) return;
  let moves = [
    ["entity_notes", "entity_kind", "person", "entity_key"],
    ["local_ranks", "collection_kind", "person", "collection_id"],
    ["collection_ballots", "collection_type", "director", "collection_id"],
    ["collections", "source_type", "person", "source_id"],
  ];
  await Promise.all(
    moves.map(([table, kindColumn, kind, keyColumn]) =>
      window
        .adoptLegacySupabaseKey({
          table,
          kindColumn,
          kind,
          keyColumn,
          fromKey: slug,
          toKey: personId,
        })
        .catch((error) =>
          console.warn(`Could not move ${table} to this person's id.`, error),
        ),
    ),
  );
};

/**
 * Loads one shared-catalog person's id and name (issue #633) - person.html
 * uses it to resolve a people.id uuid whose name slug the client-side
 * people index couldn't pin to a single row.
 * @param {string} personId
 * @returns {Promise<{id: string, name: string}|null>}
 */
window.loadSupabasePersonName = async function (personId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) return null;
  let { data, error } = await ready.client
    .from("people")
    .select("id, name")
    .eq("id", personId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

/**
 * Loads every franchise's id, name and parent, paginated like the
 * hydration `franchises` domain it shares its query with.
 * @returns {Promise<Object[]>} `{id, name, parent_id}` rows.
 */
window.loadSupabaseFranchiseCatalog = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  return HYDRATION_DOMAIN_LOADERS.franchises(ready.client);
};

let entityNotesCache = new Map();

async function resolveEntityNoteAccount() {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.auth.getSession();
  if (error) throw error;
  let userId = data?.session?.user?.id;
  if (!userId) throw new Error("Sign in to access entity notes.");
  return { client: ready.client, userId };
}

/**
 * Resets the in-memory entity notes cache.
 */
window.clearSupabaseEntityNotesCache = function () {
  entityNotesCache.clear();
};

/**
 * Loads the signed-in user's free-text note for one entity (issue #439).
 * Generic across every `entity_notes.entity_kind` value
 * ('person'|'period'|'franchise'|'tag'|'category'|'project'), matching
 * that table's own generic design - not just today's tag/franchise/
 * person/project callers. Cached in memory per authenticated user.
 * @param {string} entityKind
 * @param {string} entityKey
 * @returns {Promise<string>} The note text, or "" when none is set.
 */
window.loadSupabaseEntityNote = async function (entityKind, entityKey) {
  let { client, userId } = await resolveEntityNoteAccount();
  let cacheKey = JSON.stringify([userId, entityKind, entityKey]);
  if (entityNotesCache.has(cacheKey)) {
    return entityNotesCache.get(cacheKey);
  }
  let fetchPromise = (async () => {
    let { data, error } = await client
      .from("entity_notes")
      .select("note")
      .eq("user_id", userId)
      .eq("entity_kind", entityKind)
      .eq("entity_key", entityKey)
      .maybeSingle();
    if (error) throw error;
    let note = data?.note || "";
    if (entityNotesCache.get(cacheKey) === fetchPromise)
      entityNotesCache.set(cacheKey, note);
    return note;
  })();
  entityNotesCache.set(cacheKey, fetchPromise);
  try {
    return await fetchPromise;
  } catch (err) {
    if (entityNotesCache.get(cacheKey) === fetchPromise)
      entityNotesCache.delete(cacheKey);
    throw err;
  }
};

/**
 * Sets or clears the signed-in user's note for one entity. An empty note
 * deletes the row rather than storing "" - entity_notes.note is `not
 * null`, matching renderEntityNote()'s own "no note yet" empty state.
 * Updates the in-memory cache on success (issue #719).
 * @param {string} entityKind
 * @param {string} entityKey
 * @param {string} note
 */
window.setSupabaseEntityNote = async function (entityKind, entityKey, note) {
  let { client, userId } = await resolveEntityNoteAccount();
  let trimmed = String(note || "").trim();
  let cacheKey = JSON.stringify([userId, entityKind, entityKey]);
  if (!trimmed) {
    let { error } = await client
      .from("entity_notes")
      .delete()
      .eq("user_id", userId)
      .eq("entity_kind", entityKind)
      .eq("entity_key", entityKey);
    if (error) throw error;
    entityNotesCache.set(cacheKey, "");
    return;
  }
  let { error } = await client.from("entity_notes").upsert(
    {
      user_id: userId,
      entity_kind: entityKind,
      entity_key: entityKey,
      note: trimmed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entity_kind,entity_key" },
  );
  if (error) throw error;
  entityNotesCache.set(cacheKey, trimmed);
};

/**
 * Moves one film to an arbitrary position within a local-rank collection
 * (issue #439) - reuses `mergeSupabaseLocalRankOrder()`
 * (src/domain/supabase-local-rank.js, a Node-testable direct port of
 * local-rank.js's mergeLocalRankOrder() with no window.state coupling,
 * built for local-rank-merge.html's own cutover) to compute the merged
 * order, then re-derives fresh sequential positions for the whole
 * collection via `setSupabaseLocalRankOrder()`'s full-replace semantics
 * - local_ranks rows are opt-in (most films have none until first
 * explicitly moved), so there's no fixed neighbor position to
 * interpolate between the way moveSupabaseRankingEntryToPosition() can
 * for the always-fully-populated ranking_entries.
 * @param {'person'|'tag'|'franchise'} kind
 * @param {string} collectionId
 * @param {string[]} currentIds Every film id currently in the collection.
 * @param {string} fromFilmId
 * @param {string} toFilmId
 * @param {'before'|'after'} [position]
 * @returns {Promise<boolean>} Whether the move was applied.
 */
window.moveSupabaseLocalRankFilm = async function (
  kind,
  collectionId,
  currentIds,
  fromFilmId,
  toFilmId,
  position = "before",
) {
  if (!fromFilmId || !toFilmId || fromFilmId === toFilmId) return false;
  let stored = await window.loadSupabaseLocalRankOrder(kind, collectionId);
  let order = window.mergeSupabaseLocalRankOrder(stored, currentIds);
  if (!order.includes(fromFilmId) || !order.includes(toFilmId)) return false;
  let next = order.filter((filmId) => filmId !== fromFilmId);
  let toIndex = next.indexOf(toFilmId);
  next.splice(position === "after" ? toIndex + 1 : toIndex, 0, fromFilmId);
  await window.setSupabaseLocalRankOrder(kind, collectionId, next);
  return true;
};

/**
 * Bulk-assigns an interest tier to a set of watchlist items in one
 * request (issue #439) - the Supabase equivalent of the previous
 * setWatchlistTierForItems(). Always resets each item's minus/plus
 * refinement to null - a stale refinement from whatever tier an item
 * was in before a bulk reassignment would be actively misleading, and
 * there's no single sensible modifier to apply across a whole batch.
 * @param {string[]} watchlistIds
 * @param {string} tier
 */
window.setSupabaseWatchlistTierForItems = async function (watchlistIds, tier) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let ids = (watchlistIds || []).filter(Boolean);
  if (!ids.length) return;
  let updatedAt = new Date().toISOString();
  await selectInChunks(ids, (chunk) =>
    ready.client
      .from("watchlist")
      .update({
        tier: tier || null,
        tier_modifier: null,
        updated_at: updatedAt,
      })
      .in("id", chunk),
  );
};

/**
 * Moves one watchlist item to an arbitrary position within its own
 * interest tier (issue #439), using fractionalPositionBetween() -
 * matching moveSupabaseRankingEntryToPosition()'s established pattern,
 * since watchlist.position is the same kind of fractional/lexicographic
 * sort key. Both films must already share a tier; the caller (matching
 * the previous moveWatchlistItemWithinTier()'s own contract) is
 * responsible for that check.
 * @param {string} fromWatchlistId
 * @param {Object[]} tierItems Items that include both neighbours: raw watchlist rows (`position`) or WatchlistItems (`supabaseWatchlistPosition`).
 * @param {string|null} beforeWatchlistId Neighbor to sort after, or null for the very start.
 * @param {string|null} afterWatchlistId Neighbor to sort before, or null for the very end.
 * @returns {Promise<string>} The item's new position value.
 */
window.moveSupabaseWatchlistItemWithinTier = async function (
  fromWatchlistId,
  tierItems,
  beforeWatchlistId,
  afterWatchlistId,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let positionOf = (id) => {
    let item = id ? tierItems.find((candidate) => candidate.id === id) : null;
    return item ? (item.position ?? item.supabaseWatchlistPosition) : null;
  };
  let beforePosition = positionOf(beforeWatchlistId);
  let afterPosition = positionOf(afterWatchlistId);
  let newPosition = window.fractionalPositionBetween(
    beforePosition,
    afterPosition,
  );
  let { error } = await ready.client
    .from("watchlist")
    .update({ position: newPosition, updated_at: new Date().toISOString() })
    .eq("id", fromWatchlistId);
  if (error) throw error;
  return newPosition;
};

/**
 * Loads one tag's full collection: the tag row itself plus every watched
 * and watchlist row whose film carries it, as raw rows for
 * src/domain/supabase-legacy-hydration.js's reshape functions (issue
 * #439). Watchlist rows carry `order`, their position in the whole
 * watchlist (issue #633). Generic collection-film loading (the
 * franchise/person equivalents `franchise.html`/`person.html` will need)
 * is deliberately not built yet - franchise needs a sub-franchise subtree
 * roll-up with no equivalent here, so forcing one shape now would guess
 * at that shape rather than let it emerge from that page's own work.
 * @param {string} tagName
 * @returns {Promise<{tagId: string, watched: Object[], watchlist: Object[]}|null>} `null` when the tag doesn't exist yet.
 */
window.loadSupabaseTagCollection = async function (tagName) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let { data: tag, error: tagError } = await client
    .from("tags")
    .select("id")
    .eq("name", tagName)
    .maybeSingle();
  if (tagError) throw tagError;
  if (!tag) return null;
  // `tagged` only filters: every film keeps all of its own tags in
  // film_tags. Paginated, so a tag on more films than PostgREST's row cap
  // is never truncated.
  let films = `films!inner(${LEGACY_HYDRATION_FILM_FIELDS}, tagged:film_tags!inner(tag_id))`;
  let [watched, watchlist] = await Promise.all([
    fetchAllSupabaseRows((withCount) =>
      client
        .from("watched")
        .select(
          `${HYDRATION_WATCHED_FIELDS}, ${films}`,
          withCount ? { count: "exact" } : undefined,
        )
        .eq("films.tagged.tag_id", tag.id)
        .order("id"),
    ),
    fetchAllSupabaseRows((withCount) =>
      client
        .from("watchlist")
        .select(
          `${HYDRATION_WATCHLIST_FIELDS}, ${films}`,
          withCount ? { count: "exact" } : undefined,
        )
        .eq("films.tagged.tag_id", tag.id)
        .order("position")
        .order("id"),
    ).then((rows) => withWatchlistOrders(client, rows)),
  ]);
  return { tagId: tag.id, watched, watchlist };
};

/**
 * Loads one film's effective catalog tags (issue #797): the shared,
 * owner-curated genres and groupings, kept apart from the user's personal
 * film_tags. Rows the owner removed are excluded.
 * @param {string} filmId Supabase film id.
 * @returns {Promise<CatalogTagRecord[]>} Tags sorted by name.
 */
window.loadSupabaseFilmCatalogTags = async function (filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("film_catalog_tags")
    .select("catalog_tags(id, name, kind)")
    .eq("film_id", filmId)
    .eq("removed", false);
  if (error) throw error;
  return (data || [])
    .map((row) => row.catalog_tags)
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
};

/**
 * Loads the catalog tags of every film the signed-in user has watched or
 * watchlisted (issue #797), one lazy read for the tag index. Callers join the
 * rows with the already hydrated films.
 * @returns {Promise<Array<{filmId: string, source: 'watched'|'watchlist', tags: CatalogTagRecord[]}>>} One row per film and source that has catalog tags.
 */
window.loadSupabaseOwnCatalogTagMemberships = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let embed =
    "film_id, films!inner(film_catalog_tags!inner(catalog_tags(id, name, kind)))";
  let rows = await Promise.all(
    ["watched", "watchlist"].map(async (source) =>
      (
        await fetchAllSupabaseRows((withCount) =>
          client
            .from(source)
            .select(embed, withCount ? { count: "exact" } : undefined)
            .eq("films.film_catalog_tags.removed", false)
            .order("id"),
        )
      ).map((row) => ({
        filmId: row.film_id,
        source,
        tags: (row.films?.film_catalog_tags || [])
          .map((entry) => entry.catalog_tags)
          .filter(Boolean),
      })),
    ),
  );
  return rows.flat().filter((row) => row.tags.length);
};

/**
 * Loads one catalog tag's collection in the user's archive (issue #797): the
 * same raw watched/watchlist rows loadSupabaseTagCollection() returns, for
 * films carrying the catalog tag. Lookup is case-insensitive.
 * @param {string} tagName Catalog tag name.
 * @returns {Promise<{tagId: string, kind: string, name: string, watched: Object[], watchlist: Object[]}|null>} `null` when no catalog tag has the name.
 */
window.loadSupabaseCatalogTagCollection = async function (tagName) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let { data: tag, error: tagError } = await client
    .from("catalog_tags")
    .select("id, name, kind")
    .ilike("name", ilikeLiteral(tagName))
    .maybeSingle();
  if (tagError) throw tagError;
  if (!tag) return null;
  let films = `films!inner(${LEGACY_HYDRATION_FILM_FIELDS}, tagged:film_catalog_tags!inner(tag_id, removed))`;
  let filter = (query) =>
    query.eq("films.tagged.tag_id", tag.id).eq("films.tagged.removed", false);
  let [watched, watchlist] = await Promise.all([
    fetchAllSupabaseRows((withCount) =>
      filter(
        client
          .from("watched")
          .select(
            `${HYDRATION_WATCHED_FIELDS}, ${films}`,
            withCount ? { count: "exact" } : undefined,
          ),
      ).order("id"),
    ),
    fetchAllSupabaseRows((withCount) =>
      filter(
        client
          .from("watchlist")
          .select(
            `${HYDRATION_WATCHLIST_FIELDS}, ${films}`,
            withCount ? { count: "exact" } : undefined,
          ),
      )
        .order("position")
        .order("id"),
    ).then((rows) => withWatchlistOrders(client, rows)),
  ]);
  return {
    tagId: tag.id,
    kind: tag.kind,
    name: tag.name,
    watched,
    watchlist,
  };
};

// A project is now workflow state (status/pinned) on top of a collection
// row sharing its id (issue #456) - name/source_label/the film list all
// live on collections. Flattens the joined shape back to the flat
// {id, name, status, pinned, source_label, created_at, updated_at} every
// caller already expects, so project.js/projects.js need no changes.
// created_at intentionally reads from the collection ("when was this
// list first made") rather than the project row ("when was this
// promoted") - identical for every project today (creation and
// promotion are the same instant via create_project()), genuinely
// different once promote_collection_to_project() is used on an older
// collection. updated_at stays the project's own - it already only ever
// tracked "status/pinned last touched," never item changes.
function flattenProjectRow(row) {
  let collection = row.collections || {};
  return {
    id: row.id,
    name: collection.name,
    status: row.status,
    pinned: row.pinned,
    source_label: collection.source_label,
    created_at: collection.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Creates a project (a collection plus its promoted workflow state) and
 * its initial ordered items atomically (issue #439/#456) via the
 * create_project() RPC - a project here is a generic named film
 * collection, not tied to a live-refreshable source the way the
 * previous model's person/franchise/tag/watchlist-filter/watch-goal/
 * official-results source types were. sourceLabel is purely descriptive
 * text captured once ("From Verify Director"), never re-derived.
 * @param {string} name
 * @param {string[]} filmIds Supabase film ids (unknown ids are silently skipped by the RPC).
 * @param {string} [sourceLabel]
 * @returns {Promise<Object>} The new project row.
 */
window.createSupabaseProject = async function (name, filmIds, sourceLabel) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("create_project", {
    p_name: name,
    p_film_ids: filmIds || [],
    p_source_label: sourceLabel || null,
  });
  if (error) throw error;
  // create_project() returns the slim projects row only (matching
  // create_fresh_watched_intake's precedent) - rehydrate the full joined
  // shape the caller actually needs, same two-step pattern
  // createSupabaseFreshWatchedIntake already uses.
  let { data: joined, error: selectError } = await ready.client
    .from("projects")
    .select(
      "id, status, pinned, updated_at, collections(name, source_label, created_at)",
    )
    .eq("id", data.id)
    .single();
  if (selectError) throw selectError;
  return flattenProjectRow(joined);
};

/**
 * Creates or refreshes a source-backed project (issue #455) via the
 * start_project_from_source() RPC - unlike createSupabaseProject() above,
 * a second call for the same (sourceType, sourceId) lands on the same
 * project (its collection's source_label and item list refreshed to
 * match) instead of creating a duplicate. sourceType/sourceId are the
 * same opaque strings window.projectSourceRecord() already keys its
 * person/franchise/tag/watchlist-filter/official-results/watch-goal
 * sources by.
 * @param {string} sourceType
 * @param {string} sourceId
 * @param {string} name
 * @param {string[]} filmIds Supabase film ids (unknown ids are silently skipped by the RPC).
 * @param {string} [sourceLabel]
 * @returns {Promise<Object>} The project row.
 */
window.createSupabaseProjectFromSource = async function (
  sourceType,
  sourceId,
  name,
  filmIds,
  sourceLabel,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("start_project_from_source", {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_name: name,
    p_film_ids: filmIds || [],
    p_source_label: sourceLabel || null,
  });
  if (error) throw error;
  let { data: joined, error: selectError } = await ready.client
    .from("projects")
    .select(
      "id, status, pinned, updated_at, collections(name, source_label, created_at)",
    )
    .eq("id", data.id)
    .single();
  if (selectError) throw selectError;
  return flattenProjectRow(joined);
};

/**
 * Lists the signed-in user's own projects for the projects.html hub,
 * newest-updated first, with each project's raw item count (issue #439).
 * Per-project watched/queue progress is deliberately not computed here -
 * that needs a watched/watchlist cross-reference per item, cheap enough
 * on one project's detail page (loadSupabaseProject) but not worth a
 * join-heavy query across every project just for the hub listing.
 * @returns {Promise<Object[]>}
 */
window.listSupabaseProjects = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("projects")
    .select(
      "id, status, pinned, updated_at, collections(name, source_label, created_at, collection_items(count))",
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    ...flattenProjectRow(row),
    itemCount: row.collections?.collection_items?.[0]?.count || 0,
  }));
};

// One collection's items (a project's too: its id is its collection's id,
// issue #456), each resolved to the user's watched row, else their watchlist
// row, else "missing". Items are paginated and the per-film reads chunked,
// so a long list is neither truncated at PostgREST's row cap nor sent as
// one oversized URL.
async function loadCollectionMembers(client, collectionId) {
  let itemRows = await fetchAllSupabaseRows((withCount) =>
    client
      .from("collection_items")
      .select(
        `film_id, position, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
        withCount ? { count: "exact" } : undefined,
      )
      .eq("collection_id", collectionId)
      .order("position")
      .order("film_id"),
  );
  let filmIds = itemRows.map((row) => row.film_id);
  let [watchedRows, watchlistRows, franchiseCatalog] = await Promise.all([
    selectInChunks(filmIds, (ids) =>
      client
        .from("watched")
        .select(HYDRATION_WATCHED_FIELDS)
        .in("film_id", ids),
    ),
    selectInChunks(filmIds, (ids) =>
      client
        .from("watchlist")
        .select(HYDRATION_WATCHLIST_FIELDS)
        .in("film_id", ids),
    ),
    window.loadSupabaseFranchiseCatalog(),
  ]);
  let chains = window.buildSupabaseFranchiseChains(franchiseCatalog);
  let watchedByFilmId = new Map(watchedRows.map((row) => [row.film_id, row]));
  let watchlistByFilmId = new Map(
    watchlistRows.map((row) => [row.film_id, row]),
  );

  let items = itemRows.map((row, index) => {
    let watchedRow = watchedByFilmId.get(row.film_id);
    let watchlistRow = watchlistByFilmId.get(row.film_id);
    if (watchedRow) {
      let film = window.supabaseLegacyHydrationFilmFromWatched(
        Object.assign({}, watchedRow, { films: row.films }),
        chains,
      );
      return {
        position: row.position,
        status: "watched",
        rewatch: Boolean(film.wantToRewatch),
        film,
      };
    }
    if (watchlistRow) {
      let item = window.supabaseLegacyHydrationWatchlistItem(
        Object.assign({}, watchlistRow, { films: row.films }),
        index,
        chains,
      );
      return { position: row.position, status: "watchlist", item };
    }
    return {
      position: row.position,
      status: "missing",
      film: {
        id: row.film_id,
        supabaseFilmId: row.film_id,
        title: row.films?.title || "",
        year: row.films?.year != null ? String(row.films.year) : "",
      },
    };
  });
  return {
    items,
    rawItems: itemRows.map((row) => ({
      film_id: row.film_id,
      position: row.position,
    })),
  };
}

/**
 * Loads one project's items, reshaped into the same FilmRecord/
 * WatchlistItem shapes supabase-legacy-hydration.js's per-item functions
 * already produce (issue #439), so project.js can reuse the same shared
 * film-card/row helpers every other collection page does. Each item
 * resolves to "watched" (the user has a watched row for the film),
 * "watchlist" (a watchlist row instead), or "missing" (neither - the
 * film is in the project but the user has no personal record of it yet,
 * a real, honestly-represented state in this source-agnostic model).
 * @param {string} projectId
 * @returns {Promise<{project: Object, items: Object[], rawItems: {film_id: string, position: string}[]}|null>}
 */
window.loadSupabaseProject = async function (projectId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let { data: projectRow, error: projectError } = await client
    .from("projects")
    .select(
      "id, status, pinned, updated_at, collections(name, source_label, created_at)",
    )
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!projectRow) return null;
  let project = flattenProjectRow(projectRow);

  // collection_items.collection_id is the same uuid as this project's own
  // id (projects.id references collections.id directly, issue #456).
  let { items, rawItems } = await loadCollectionMembers(client, projectId);
  return { project, items, rawItems };
};

// A bare collection (issue #449/#459): a named, ordered film list with
// no workflow state at all - the base entity flattenProjectRow's own
// collection is already an extension on top of. Flattens the raw
// collections row to the flat shape callers expect, mirroring
// flattenProjectRow's shape minus status/pinned (a bare collection has
// neither column).
function flattenCollectionRow(row) {
  return {
    id: row.id,
    name: row.name,
    source_label: row.source_label,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Creates a bare collection and its initial ordered items atomically
 * (issue #449/#456) via the create_collection() RPC - unlike
 * createSupabaseProject(), this never promotes to a project, so no
 * status/pinned workflow state is created alongside it.
 * create_collection() already returns the full collections row directly
 * (unlike create_project()'s slim-then-rehydrate pattern), so no second
 * query is needed here.
 * @param {string} name
 * @param {string[]} filmIds Supabase film ids (unknown ids are silently skipped by the RPC).
 * @param {string} [sourceLabel]
 * @returns {Promise<Object>} The new collection row.
 */
window.createSupabaseCollection = async function (name, filmIds, sourceLabel) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("create_collection", {
    p_name: name,
    p_film_ids: filmIds || [],
    p_source_label: sourceLabel || null,
  });
  if (error) throw error;
  return flattenCollectionRow(data);
};

/**
 * Lists the signed-in user's own collections that have NOT been
 * promoted to a project, for the collections.html hub (issue #449) -
 * promoted collections stay exclusively on projects.html's own listing
 * (listSupabaseProjects). Filters client-side on the embedded projects
 * relationship being empty, rather than an unproven server-side
 * null-filter on an embed.
 * @param {{includePosters?: boolean}} [options] Whether to include up to three ordered poster previews per collection.
 * @returns {Promise<Object[]>}
 */
window.listSupabaseCollections = async function (options = {}) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let fields =
    "id, name, source_label, created_at, updated_at, collection_items(count), projects(id)";
  if (options.includePosters)
    fields +=
      ", preview_items:collection_items(position, films(id, title, year, poster_url))";
  let query = ready.client
    .from("collections")
    .select(fields)
    .order("updated_at", { ascending: false });
  if (options.includePosters)
    query = query
      .order("position", { referencedTable: "preview_items" })
      .limit(3, { referencedTable: "preview_items" });
  let { data, error } = await query;
  if (error) throw error;
  return (data || [])
    .filter((row) => !row.projects)
    .map((row) => ({
      ...flattenCollectionRow(row),
      itemCount: row.collection_items?.[0]?.count || 0,
      ...(options.includePosters
        ? {
            posterFilms: (row.preview_items || [])
              .map((item) => item.films)
              .filter(Boolean),
          }
        : {}),
    }));
};

/**
 * Loads one collection's items, the same shape loadSupabaseProject()
 * produces (issue #449) so collection.js can reuse the same shared
 * film-card/row helpers project.js already does. Also reports whether
 * this collection has already been promoted to a project (a stale
 * bookmark to collection.html?id=<id> after promoting elsewhere,
 * collection.js redirects straight to project.html instead of showing a
 * confusing duplicate "promote" affordance).
 * @param {string} collectionId
 * @returns {Promise<{collection: Object, alreadyPromoted: boolean, items: Object[], rawItems: {film_id: string, position: string}[]}|null>}
 */
window.loadSupabaseCollection = async function (collectionId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let client = ready.client;
  let { data: collectionRow, error: collectionError } = await client
    .from("collections")
    .select("id, name, source_label, created_at, updated_at, projects(id)")
    .eq("id", collectionId)
    .maybeSingle();
  if (collectionError) throw collectionError;
  if (!collectionRow) return null;
  let alreadyPromoted = Boolean(collectionRow.projects);
  let collection = flattenCollectionRow(collectionRow);

  let { items, rawItems } = await loadCollectionMembers(client, collectionId);
  return { collection, alreadyPromoted, items, rawItems };
};

/**
 * Promotes a bare collection into a project (issue #449), giving it
 * workflow state (status/pinned) via promote_collection_to_project() -
 * "an explicit promotion, not an automatic one." The collection keeps
 * its exact id, so the caller just navigates to project.html?id=<same
 * id> afterward rather than needing the RPC's own return value.
 * @param {string} collectionId
 */
window.promoteSupabaseCollectionToProject = async function (collectionId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.rpc("promote_collection_to_project", {
    p_collection_id: collectionId,
  });
  if (error) throw error;
};

/**
 * @param {string} projectId
 * @param {'active'|'complete'|'archived'} status
 */
window.setSupabaseProjectStatus = async function (projectId, status) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("projects")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
};

/**
 * @param {string} projectId
 * @param {boolean} pinned
 */
window.setSupabaseProjectPinned = async function (projectId, pinned) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("projects")
    .update({ pinned: Boolean(pinned), updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
};

/**
 * Permanently removes a collection (issue #456/#459 - renamed from
 * deleteSupabaseProject, since it always operated on collections, not
 * projects specifically: deleting only a projects row would silently
 * demote a project back to a bare, unmanageable collection instead of
 * removing it). Cascades through both projects and collection_items
 * without touching any referenced film/watched/watchlist data. Used by
 * both project.js (a promoted collection) and collection.js (a bare
 * one) - the delete is identical either way.
 * @param {string} collectionId
 */
window.deleteSupabaseCollection = async function (collectionId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("collections")
    .delete()
    .eq("id", collectionId);
  if (error) throw error;
};

/**
 * Removes one film from a collection's item list (issue #459 - renamed
 * from removeSupabaseProjectItem, which already operated purely on
 * collection_items). Used by both project.js and collection.js.
 * @param {string} collectionId
 * @param {string} filmId
 */
window.removeSupabaseCollectionItem = async function (collectionId, filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("collection_items")
    .delete()
    .eq("collection_id", collectionId)
    .eq("film_id", filmId);
  if (error) throw error;
};

/** Adds a film to the end of a collection's ordered item list. @param {string} collectionId Collection id. @param {string} filmId Shared film id. @returns {Promise<void>} Resolves after the item is inserted. */
window.addSupabaseCollectionItem = async function (collectionId, filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data: existingItems, error: existingError } = await ready.client
    .from("collection_items")
    .select("film_id, position")
    .eq("collection_id", collectionId)
    .order("position");
  if (existingError) throw existingError;
  if ((existingItems || []).some((item) => item.film_id === filmId))
    throw new Error("This film is already in the collection.");
  let lastPosition =
    existingItems?.[existingItems.length - 1]?.position || null;
  let { error } = await ready.client.from("collection_items").insert({
    collection_id: collectionId,
    film_id: filmId,
    position: window.fractionalPositionBetween(lastPosition, null),
  });
  if (error) throw error;
};

/**
 * Moves one collection item to an arbitrary position in the queue
 * (issue #439/#459 - renamed from moveSupabaseProjectItem, which already
 * operated purely on collection_items), using fractionalPositionBetween() -
 * matching moveSupabaseWatchlistItemWithinTier()'s established pattern.
 * Used by both project.js and collection.js.
 * @param {string} collectionId
 * @param {string} fromFilmId
 * @param {{film_id: string, position: string}[]} rawItems The collection's full item list in position order.
 * @param {string|null} beforeFilmId Neighbor to sort after, or null for the very start.
 * @param {string|null} afterFilmId Neighbor to sort before, or null for the very end.
 * @returns {Promise<string>} The item's new position value.
 */
window.moveSupabaseCollectionItem = async function (
  collectionId,
  fromFilmId,
  rawItems,
  beforeFilmId,
  afterFilmId,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let beforePosition = beforeFilmId
    ? rawItems.find((item) => item.film_id === beforeFilmId)?.position
    : null;
  let afterPosition = afterFilmId
    ? rawItems.find((item) => item.film_id === afterFilmId)?.position
    : null;
  let newPosition = window.fractionalPositionBetween(
    beforePosition,
    afterPosition,
  );
  let { error } = await ready.client
    .from("collection_items")
    .update({ position: newPosition })
    .eq("collection_id", collectionId)
    .eq("film_id", fromFilmId);
  if (error) throw error;
  return newPosition;
};

// --- Owner data-tools (local-only page): missing metadata + duplicate
// detection/merge across the whole shared catalog. Reads the full films/
// people tables rather than a single page's slice, so every function here
// is paginated via fetchAllSupabaseRows like the legacy-hydration catalog
// fetch above.

// Capped, not the unbounded default: data-tools loads the film and people
// catalogs fully in parallel, and the film query's credits->people join is
// heavy enough that firing every page of both at once (23+ concurrent
// requests at today's catalog size) risks the hosted database's
// authenticated-role statement_timeout under everyday concurrent load -
// another tab open, this same page's own background-job poller, or
// ordinary concurrent catalog writes.
const DATA_TOOLS_FETCH_CONCURRENCY = 4;

/**
 * Loads every row of the shared film catalog, for the local-only data-tools
 * page's missing-metadata and duplicate-detection views.
 * @returns {Promise<Object[]>} Every film row.
 */
window.loadSupabaseFilmCatalogForDataTools = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  return fetchAllSupabaseRows(
    (withCount) =>
      ready.client
        .from("films")
        .select(
          "id, tmdb_id, tmdb_tv_ref, tmdb_field_outcomes, owner_decided_fields, tmdb_verification:tmdb_metadata_verification->header, genre, type, adaptation_source, letterboxd_url, title, swedish_title, year, poster_url, country, primary_country, runtime_minutes, tmdb_verified_at, medium, screenplay_type, original_language, credits(person_id, role, billing_order, character_name, uncredited, people(id, name, tmdb_id))",
          withCount ? { count: "exact" } : undefined,
        ),
    SUPABASE_FETCH_PAGE_SIZE,
    DATA_TOOLS_FETCH_CONCURRENCY,
  );
};

/** Reloads one shared film after enrichment has changed its credit links. @param {string} filmId Film UUID. @returns {Promise<Object>} Current catalog row. */
window.loadSupabaseFilmCatalogEditorRow = async function (filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("films")
    .select(
      "id, tmdb_id, tmdb_tv_ref, tmdb_field_outcomes, owner_decided_fields, tmdb_verification:tmdb_metadata_verification->header, genre, type, adaptation_source, letterboxd_url, title, swedish_title, year, poster_url, country, primary_country, runtime_minutes, tmdb_verified_at, medium, screenplay_type, original_language, credits(person_id, role, billing_order, character_name, uncredited, people(id, name, tmdb_id))",
    )
    .eq("id", filmId)
    .single();
  if (error) throw error;
  return data;
};

/**
 * Loads every row of the shared people catalog, for the local-only
 * data-tools page's missing-metadata and duplicate-detection views.
 * @returns {Promise<Object[]>} Every person row.
 */
window.loadSupabasePeopleCatalogForDataTools = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  return fetchAllSupabaseRows(
    (withCount) =>
      ready.client
        .from("people")
        .select(
          "id, tmdb_id, name, source_url, portrait_url, portrait_source, portrait_source_url, portrait_provider_id, portrait_fetched_at, tmdb_verified_at",
          withCount ? { count: "exact" } : undefined,
        ),
    SUPABASE_FETCH_PAGE_SIZE,
    DATA_TOOLS_FETCH_CONCURRENCY,
  );
};

/**
 * Finds each given person's locally-credited films' TMDB ids (only films
 * that already carry one), for ambiguous-namesake disambiguation during a
 * portrait fetch batch: a same-named TMDB search result that appears in
 * the real cast/crew of a film this person is already locally credited on
 * is confirmed correct, a strictly stronger signal than popularity or
 * profile-photo presence alone (see window.lookupTmdbPersonPortrait).
 * Scoped to just the given person ids, not embedded on the full people
 * catalog query above - this is only useful for the small subset actually
 * missing a tmdb_id in a given batch run, and embedding it on every row of
 * the full catalog (used elsewhere for duplicate detection) would carry
 * nested credit/film data nobody there needs.
 * @param {string[]} personIds
 * @returns {Promise<Map<string, number[]>>} Person id -> distinct locally-credited films' TMDB ids.
 */
window.loadSupabasePersonCreditFilmTmdbIds = async function (personIds) {
  let ids = [...new Set(personIds || [])].filter(Boolean);
  let byPerson = new Map();
  if (!ids.length) return byPerson;
  let ready = await window.ensureSupabaseClient();
  if (!ready) return byPerson;
  let CHUNK_SIZE = 100;
  for (let index = 0; index < ids.length; index += CHUNK_SIZE) {
    let chunk = ids.slice(index, index + CHUNK_SIZE);
    let rows = await fetchAllSupabaseRows((withCount) =>
      ready.client
        .from("credits")
        .select(
          "person_id, films(tmdb_id)",
          withCount ? { count: "exact" } : undefined,
        )
        .in("person_id", chunk),
    );
    rows.forEach((row) => {
      let tmdbId = row.films?.tmdb_id;
      if (!tmdbId) return;
      if (!byPerson.has(row.person_id)) byPerson.set(row.person_id, new Set());
      byPerson.get(row.person_id).add(tmdbId);
    });
  }
  let plain = new Map();
  byPerson.forEach((set, personId) => plain.set(personId, [...set]));
  return plain;
};

/**
 * Writes a fetched poster straight to the shared film catalog. Also
 * corrects the stored year when the poster lookup found the film under a
 * neighboring year instead (Oscar-eligibility-derived years can be one
 * year off from TMDB's own release year - see lookupTmdbFilmPoster in
 * src/domain/supabase-metadata-batch.js).
 * @param {string} filmId
 * @param {string} posterUrl
 * @param {number} [year] Corrected release year, if the match was found under a different year than currently stored.
 * @returns {Promise<void>}
 */
window.setSupabaseFilmPoster = async function (filmId, posterUrl, year) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let update = { poster_url: posterUrl };
  if (year !== undefined && year !== null) update.year = year;
  let { error } = await ready.client
    .from("films")
    .update(update)
    .eq("id", filmId);
  if (error) throw error;
};

/**
 * Writes fetched poster + country/runtime/tmdb_id metadata straight to
 * the shared film catalog, in one call - the broader sibling of
 * setSupabaseFilmPoster, for window.lookupTmdbFilmMetadata's fuller
 * result. Only ever fills in a field that was actually resolved (a null/
 * undefined field here leaves the stored value untouched, it never
 * blanks out existing data). A film always keeps a TMDB identity: tmdbId
 * (a movie) and tvTmdbRef (TV content) each replace the other atomically,
 * so a correction from a wrong movie match to real TV content clears the
 * stale movie id, and neither can be cleared on its own. Likewise
 * `markVerified`/`clearVerified` control tmdb_verified_at - once "Verify
 * TMDB links" confirms a film's id (or the owner explicitly confirms/
 * corrects it), it's skipped by future checks until something clears
 * that verification again.
 * @param {string} filmId
 * @param {{title?: string, posterUrl?: string, year?: number, country?: string, primaryCountry?: string, runtimeMinutes?: number, tmdbId?: string|number|null, tvTmdbRef?: string, markVerified?: boolean, clearVerified?: boolean, directors?: (string|{tmdbId?: number|null, name: string, profilePath?: string|null})[], director?: string}} fields
 * @returns {Promise<void>}
 */
window.setSupabaseFilmMetadata = async function (filmId, fields) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let update = {};
  if (fields.title != null) update.title = fields.title;
  if (fields.posterUrl != null) update.poster_url = fields.posterUrl;
  if (fields.year != null) update.year = fields.year;
  if (fields.country != null) update.country = fields.country;
  if (fields.primaryCountry != null)
    update.primary_country = fields.primaryCountry;
  if (fields.runtimeMinutes != null)
    update.runtime_minutes = fields.runtimeMinutes;
  if (fields.tvTmdbRef != null) {
    if (fields.tmdbId != null)
      throw new Error("Choose either a movie or TV identity.");
    if (
      !/^TV:[1-9]\d*(?:\/S(?:0|[1-9]\d*)(?:E[1-9]\d*)?)?$/.test(
        fields.tvTmdbRef,
      )
    )
      throw new Error("Invalid TMDB TV reference.");
    update.tmdb_tv_ref = fields.tvTmdbRef;
    update.tmdb_id = null;
  } else if (fields.tmdbId != null) {
    update.tmdb_id = fields.tmdbId;
    update.tmdb_tv_ref = null;
  }
  if (fields.markVerified) update.tmdb_verified_at = new Date().toISOString();
  else if (fields.clearVerified) update.tmdb_verified_at = null;
  if (fields.medium != null) update.medium = fields.medium;
  if (fields.screenplayType != null)
    update.screenplay_type = fields.screenplayType;
  if (fields.originalLanguage != null)
    update.original_language = fields.originalLanguage;
  if (Object.keys(update).length > 0) {
    let { error } = await ready.client
      .from("films")
      .update(update)
      .eq("id", filmId);
    if (error) throw error;
  }
  let directors = fields.directors?.length
    ? fields.directors
    : typeof fields.director === "string" && fields.director.trim()
      ? fields.director
          .split(",")
          .map((s) => ({ name: s.trim() }))
          .filter((d) => d.name)
      : null;
  if (directors?.length && window.persistSupabaseFilmCredits) {
    await window.persistSupabaseFilmCredits(filmId, "director", directors);
  }
};

/**
 * Writes a fetched portrait, with its TMDB provenance, straight to the
 * shared people catalog.
 * @param {string} personId
 * @param {{url: string, source?: string, sourceUrl?: string, providerId?: string}} posterRecord
 * @returns {Promise<string>} Canonical person id after identity reconciliation.
 */
window.setSupabasePersonPortrait = async function (personId, posterRecord) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  if (
    posterRecord.source !== "tmdb" ||
    !/^[1-9][0-9]*$/.test(String(posterRecord.providerId || ""))
  )
    throw new Error("A resolved TMDB person identity is required.");
  let { data, error } = await ready.client.rpc("save_person_tmdb_portrait", {
    p_person_id: personId,
    p_tmdb_id: Number(posterRecord.providerId),
    p_portrait_url: posterRecord.url,
  });
  if (error) throw error;
  window.invalidateSupabaseHydrationCache?.();
  return data;
};

/**
 * Updates a person row's metadata (name, tmdb_id, verification timestamp)
 * in the shared catalog.
 * @param {string} personId Person UUID.
 * @param {{name?: string, tmdbId?: number|null, markVerified?: boolean, clearVerified?: boolean}} fields
 * @returns {Promise<void>}
 */
window.setSupabasePersonMetadata = async function (personId, fields) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let update = {};
  if (fields.name != null) update.name = fields.name;
  if (fields.tmdbId != null) update.tmdb_id = fields.tmdbId;
  if (fields.markVerified) update.tmdb_verified_at = new Date().toISOString();
  else if (fields.clearVerified) update.tmdb_verified_at = null;
  if (Object.keys(update).length > 0) {
    let { error } = await ready.client
      .from("people")
      .update(update)
      .eq("id", personId);
    if (error) throw error;
  }
};

/**
 * Merges a duplicate film row into the canonical one, repointing every
 * reference and deleting the duplicate (public.merge_films RPC).
 * @param {string} keepId Canonical film id to keep.
 * @param {string} removeId Duplicate film id to remove.
 * @returns {Promise<void>}
 */
window.mergeSupabaseFilms = async function (keepId, removeId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.rpc("merge_films", {
    keep_id: keepId,
    remove_id: removeId,
  });
  if (error) throw error;
};

/**
 * Reports whether a write failed because another film row already holds
 * the TMDB movie ID or TV reference it tried to set.
 * @param {*} error Supabase/PostgREST error.
 * @returns {boolean} True for a films TMDB identity unique violation.
 */
window.isTmdbIdentityConflict = function (error) {
  return (
    error?.code === "23505" &&
    /films_tmdb_(id|tv_ref)_key/.test(
      `${error.message || ""} ${error.details || ""}`,
    )
  );
};

/**
 * Merges a film into the other catalog row that already holds the TMDB
 * identity it was given, keeping the holder's metadata and repointing
 * every reference (public.merge_films RPC).
 * @param {string} filmId Film whose identity write collided; it is removed.
 * @param {{tmdbId?: number|null, tvTmdbRef?: string|null}} identity The identity the film was given.
 * @returns {Promise<{id: string, title: string, year: number|null}|null>} The surviving holder, or null when no other row holds that identity.
 */
window.mergeSupabaseFilmIntoTmdbIdentityHolder = async function (
  filmId,
  identity,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let query = ready.client
    .from("films")
    .select("id,title,year")
    .neq("id", filmId);
  if (identity?.tvTmdbRef) query = query.eq("tmdb_tv_ref", identity.tvTmdbRef);
  else if (identity?.tmdbId != null)
    query = query.eq("tmdb_id", identity.tmdbId);
  else return null;
  let { data: holder, error } = await query.maybeSingle();
  if (error) throw error;
  if (!holder) return null;
  await window.mergeSupabaseFilms(holder.id, filmId);
  return holder;
};

/**
 * Merges a duplicate person row into the canonical one, repointing every
 * reference and deleting the duplicate (public.merge_people RPC).
 * @param {string} keepId Canonical person id to keep.
 * @param {string} removeId Duplicate person id to remove.
 * @returns {Promise<void>}
 */
window.mergeSupabasePeople = async function (keepId, removeId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.rpc("merge_people", {
    keep_id: keepId,
    remove_id: removeId,
  });
  if (error) throw error;
};

/**
 * Permanently deletes a film row that genuinely doesn't correspond to a
 * real film (a bad import, a bogus title), removing every reference to it
 * across the whole schema first (public.delete_film_permanently RPC) -
 * distinct from mergeSupabaseFilms, which is for a genuine duplicate of a
 * film that DOES exist and has a canonical row to repoint to.
 * @param {string} filmId
 * @returns {Promise<void>}
 */
window.deleteSupabaseFilmPermanently = async function (filmId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client.rpc("delete_film_permanently", {
    target_id: filmId,
  });
  if (error) throw error;
};

/**
 * Loads every dismissed-duplicate-pair record - a prior "not duplicates"
 * decision recorded from the data-tools duplicates review, so a fuzzy
 * match already reviewed and rejected doesn't keep reappearing.
 * @returns {Promise<{entity_type: string, id_a: string, id_b: string}[]>}
 */
window.loadDismissedDuplicatePairs = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  return fetchAllSupabaseRows((withCount) =>
    ready.client
      .from("dismissed_duplicate_pairs")
      .select(
        "entity_type, id_a, id_b",
        withCount ? { count: "exact" } : undefined,
      ),
  );
};

/**
 * Records every pairwise combination within a reviewed duplicate group as
 * "not duplicates", so the group (or any already-reviewed pair within a
 * later, larger group) stops reappearing. Uses upsert with
 * ignoreDuplicates so re-dismissing an already-dismissed pair (e.g. a
 * group re-reviewed after a new row joined it) is a harmless no-op rather
 * than a conflict error.
 * @param {"film"|"person"} entityType
 * @param {string[]} ids Every row id in the reviewed group (2 or more).
 * @returns {Promise<void>}
 */
window.dismissSupabaseDuplicateGroup = async function (entityType, ids) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let rows = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      let [idA, idB] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      rows.push({ entity_type: entityType, id_a: idA, id_b: idB });
    }
  }
  if (!rows.length) return;
  let { error } = await ready.client
    .from("dismissed_duplicate_pairs")
    .upsert(rows, {
      onConflict: "entity_type,id_a,id_b",
      ignoreDuplicates: true,
    });
  if (error) throw error;
};

/** Reconciles a person's stored TMDB provenance atomically without another search. @param {string} personId Person row id. @returns {Promise<string>} Canonical person id. */
window.reconcileSupabasePersonIdentity = async function (personId) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc("reconcile_person_identity", {
    p_person_id: personId,
  });
  if (error) throw error;
  window.invalidateSupabaseHydrationCache?.();
  return data;
};
