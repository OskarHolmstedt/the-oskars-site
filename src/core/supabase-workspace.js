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
  "id, film_id, rating, rating_modifier, date_watched, review, platform, views, updated_at, films(id, tmdb_id, title, year, poster_url, runtime_minutes, country, medium, type)";
const WATCHLIST_SELECT =
  "id, film_id, tier, position, reason, updated_at, films(id, tmdb_id, title, year, poster_url, runtime_minutes, country, medium, type)";

let workspaceState = null;
let workspaceLoadPromise = null;
let workspaceOwnerId = null; // whose signed-in id workspaceState belongs to

// The cache above is bound to whoever was signed in when it was fetched.
// Found running through an account-switch sequence by hand: nothing
// cleared it on sign-out or on signing in as someone else, so
// getSupabaseWorkspace() could hand a later account the previous
// account's rows for the rest of the page's life. Subscribed once, at
// module load, rather than left to whatever page happens to also
// subscribe - a same-account token refresh reports the same user id and
// is correctly a no-op here.
window.onSupabaseAuthChange?.((user) => {
  let currentUserId = user?.id || null;
  if (workspaceState !== null && currentUserId !== workspaceOwnerId) {
    workspaceState = null;
    workspaceOwnerId = null;
  }
});

async function fetchWorkspace() {
  // A signed-out/unconfigured caller isn't a bug to throw about - it's
  // the ordinary "haven't logged in yet" state, resolved gracefully to
  // an empty workspace. But it's a *different* state from "genuinely
  // couldn't check" (offline/error), which does propagate as a real
  // error rather than silently masquerading as "you have nothing yet."
  // Checking the client alone isn't enough here - the client itself
  // initializes fine even fully signed out (found running this in a real
  // browser with no session: an anonymous caller has no grant on
  // watched's private columns at all, so the query below would surface
  // as a confusing "permission denied" instead of this clean distinction).
  let authState = await window.resolveSupabaseAuthState();
  if (
    authState.status === "unconfigured" ||
    authState.status === "signed-out"
  ) {
    return { watched: [], watchlist: [], loadedAt: null };
  }
  if (authState.status !== "signed-in") {
    throw new Error(
      authState.error ||
        `Could not resolve the signed-in account (${authState.status}).`,
    );
  }

  let ready = await window.ensureSupabaseClient();
  if (!ready) return { watched: [], watchlist: [], loadedAt: null };

  let [watchedResult, watchlistResult] = await Promise.all([
    ready.client.from("watched").select(WATCHED_SELECT),
    ready.client.from("watchlist").select(WATCHLIST_SELECT),
  ]);
  if (watchedResult.error) throw watchedResult.error;
  if (watchlistResult.error) throw watchlistResult.error;

  return {
    watched: watchedResult.data,
    watchlist: watchlistResult.data,
    loadedAt: new Date().toISOString(),
  };
}

/**
 * Fetches the signed-in user's watched/watchlist rows (joined with their
 * films) once and caches the result for the rest of the session.
 * Concurrent callers during the first load share one in-flight request
 * rather than each triggering their own.
 * @param {{force?: boolean}} [options] `force: true` re-fetches even if
 *   already cached — the explicit "refresh" case, never automatic.
 * @returns {Promise<{watched: Object[], watchlist: Object[], loadedAt: string|null}>}
 */
window.loadSupabaseWorkspace = async function (options = {}) {
  if (workspaceState && !options.force) return workspaceState;
  if (workspaceLoadPromise && !options.force) return workspaceLoadPromise;
  workspaceLoadPromise = fetchWorkspace();
  try {
    workspaceState = await workspaceLoadPromise;
    workspaceOwnerId = window.getSupabaseCurrentUser()?.id || null;
  } finally {
    workspaceLoadPromise = null;
  }
  return workspaceState;
};

/**
 * Synchronous accessor to whatever loadSupabaseWorkspace() last resolved
 * - null before the first successful load.
 * @returns {{watched: Object[], watchlist: Object[], loadedAt: string|null}|null}
 */
window.getSupabaseWorkspace = function () {
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
  "id, watched_id, version, source, steps, summary, completed_at, created_at, updated_at, watched(id, film_id, rating, rating_modifier, date_watched, platform, views, updated_at, films(id, tmdb_id, title, year, poster_url, runtime_minutes, country, medium, type))";

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

/** Atomically creates a shared film, watched row, and fresh Intake. @param {Object} values Form values. @returns {Promise<Object>} The joined workflow. */
window.createSupabaseFreshWatchedIntake = async function (values) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let directors = String(values.director || "")
    .split(/\s*(?:,|\band\b|&)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);
  let { data, error } = await ready.client.rpc("create_fresh_watched_intake", {
    p_title: String(values.title || "").trim(),
    p_year: Number(values.year),
    p_tmdb_id: values.tmdbId ? Number(values.tmdbId) : null,
    p_directors: directors,
    p_rating: values.rating ? Number(values.rating) : null,
    p_rating_modifier: values.ratingModifier || null,
    p_date_watched: values.dateWatched || null,
    p_platform: values.platform || null,
    p_views: values.views ? Number(values.views) : 1,
  });
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
 * @param {'minus'|'dot'|'plus'|''} modifier New rating modifier, or an empty string to clear it.
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
 * @param {{tier?: string, reason?: string}} [options]
 * @returns {Promise<Object>} The new, cache-shaped watchlist row.
 */
window.addToSupabaseWatchlist = async function (filmId, options = {}) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");

  let { data, error } = await ready.client
    .from("watchlist")
    .insert({
      film_id: filmId,
      tier: options.tier || null,
      reason: options.reason || null,
      position: Date.now().toString(36),
    })
    .select(WATCHLIST_SELECT)
    .single();
  if (error) throw error;

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

  let { error } = await ready.client
    .from("watchlist")
    .delete()
    .eq("id", watchlistId);
  if (error) throw error;

  if (workspaceState) {
    workspaceState.watchlist = workspaceState.watchlist.filter(
      (row) => row.id !== watchlistId,
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

  let watchedRow = { ...data, films: watchlistEntry?.films };
  if (workspaceState) {
    workspaceState.watchlist = workspaceState.watchlist.filter(
      (row) => row.film_id !== filmId,
    );
    workspaceState.watched.push(watchedRow);
  }
  return watchedRow;
};

/**
 * Searches the shared film catalog by title - a read-open, eligibility-
 * free query (films: read all authenticated), used to find a film to
 * add to the watchlist without any TMDB search/import step.
 * @param {string} query Title substring, case-insensitive.
 * @returns {Promise<Object[]>} Up to 20 matching films.
 */
window.searchSupabaseFilmsByTitle = async function (query) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let trimmed = String(query || "").trim();
  if (!trimmed) return [];

  let { data, error } = await ready.client
    .from("films")
    .select("id, tmdb_id, title, year, poster_url")
    .ilike("title", `%${trimmed}%`)
    .order("title")
    .limit(20);
  if (error) throw error;
  return data;
};

const RANKING_ENTRY_SELECT =
  "film_id, position, rank_confirmed, films(id, tmdb_id, title, year, poster_url)";

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
  if (insertError) throw insertError;
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
  let { data, error } = await ready.client
    .from("ranking_entries")
    .select(RANKING_ENTRY_SELECT)
    .eq("ranking_id", rankingId)
    .order("position");
  if (error) throw error;
  return { rankingId, entries: data };
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
  "id, category, placement, film_id, detail, films(id, tmdb_id, title, year, poster_url), personal_nomination_recipients(recipient_name)";

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
  if (insertError) throw insertError;
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
 * Nominates a film in a scope/category at a placement, straight through
 * to Supabase. No recipients (personal_nomination_recipients) - a
 * separate, more complex sub-concept (matching/creating people rows),
 * deliberately out of scope for this wiring PoC.
 * @param {string} scope
 * @param {string} category
 * @param {string} filmId
 * @param {number} placement
 * @param {string} [detail]
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 */
window.addSupabasePersonalNomination = async function (
  scope,
  category,
  filmId,
  placement,
  detail,
  scopeType,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let personalAwardId = await getOrCreateSupabasePersonalAwardId(
    ready.client,
    scope,
    scopeType,
  );
  let { error } = await ready.client.from("personal_nominations").insert({
    personal_award_id: personalAwardId,
    category,
    placement,
    film_id: filmId,
    detail: detail || null,
  });
  if (error) throw error;
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
  "id, tmdb_id, title, year, poster_url, runtime_minutes, country, medium, type";

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
 * Records one pair as reviewed and marks both films' ranking entries
 * deliberately confirmed - the same "not a mechanical default" signal
 * moveRankedFilmWithinRating() sets via rankConfirmed, now on
 * ranking_entries.rank_confirmed.
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

  let { error: confirmError } = await ready.client
    .from("ranking_entries")
    .update({ rank_confirmed: true })
    .eq("ranking_id", rankingId)
    .in("film_id", [filmIdA, filmIdB]);
  if (confirmError) throw confirmError;
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
    .select("id, display_name, public_slug")
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
  ["profiles", "*"],
  ["watched", "*"],
  ["watchlist", "*"],
  ["tags", "*"],
  ["film_tags", "*"],
  ["rankings", "*, ranking_entries(*)"],
  [
    "personal_awards",
    "*, personal_nominations(*, personal_nomination_recipients(*))",
  ],
  ["collections", "*, collection_items(*)"],
  ["projects", "*"],
  ["local_ranks", "*"],
  ["watchlist_project_sources", "*"],
  ["ranking_pair_reviews", "*"],
  ["award_reviews", "*"],
  ["entity_notes", "*"],
  ["declined_official_watchlist_adds", "*"],
  ["intake_workflows", "*"],
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
  let results = await Promise.all(
    SUPABASE_ACCOUNT_BACKUP_TABLES.map(([table, select]) =>
      client.from(table).select(select),
    ),
  );
  let tables = {};
  SUPABASE_ACCOUNT_BACKUP_TABLES.forEach(([table], index) => {
    if (results[index].error) throw results[index].error;
    tables[table] = results[index].data;
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
  let personalAwardId = null;
  let categories = [];
  for (let category of categoryNames) {
    let [loaded, review] = await Promise.all([
      window.loadSupabasePersonalNominations(String(year), category, "years"),
      window.loadSupabaseAwardReview(year, category),
    ]);
    personalAwardId = loaded.personalAwardId;
    let winner =
      loaded.nominations.find((entry) => Number(entry.placement) === 1) || null;
    categories.push({
      category,
      nominations: loaded.nominations,
      review,
      reviewed: Boolean(review),
      winner,
    });
  }
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
    p_recipients: recipients || [],
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
 */
window.updateSupabaseNominationRecipients = async function (
  nominationId,
  recipients,
) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error: deleteError } = await ready.client
    .from("personal_nomination_recipients")
    .delete()
    .eq("nomination_id", nominationId);
  if (deleteError) throw deleteError;

  let names = (recipients || []).map((name) => name.trim()).filter(Boolean);
  if (!names.length) return;
  let { error: insertError } = await ready.client
    .from("personal_nomination_recipients")
    .insert(
      names.map((recipient_name) => ({
        nomination_id: nominationId,
        recipient_name,
      })),
    );
  if (insertError) throw insertError;
};

// Every field a legacy read-only page's FilmRecord might display -
// credits/tags/franchises embedded directly (one round trip, no per-film
// N+1 query) rather than a separate bulk fetch per film id, since
// PostgREST resolves nested resources server-side.
const LEGACY_HYDRATION_FILM_FIELDS =
  "id, tmdb_id, title, year, poster_url, runtime_minutes, country, primary_country, medium, type, screenplay_type, adaptation_source, swedish_title, letterboxd_url, credits(role, people(name)), film_tags(tags(name)), film_franchises(franchises(id, name, parent_id))";

/**
 * Loads every table src/domain/supabase-legacy-hydration.js needs to
 * rebuild window.state's established view-model shape - watched, watchlist, every
 * ranking (all four scope types), every personal-award nomination (all
 * four scope types), the shared film and franchise catalogs, every
 * project the user owns (issue #458), and the profile display name. One
 * pass per page load, matching what the previous app always loaded
 * wholesale - not cached; edit-capable callers refresh it after writes
 * (issues #438, #440).
 * @returns {Promise<Object>} Raw rows, reshaped entirely by the caller.
 */
window.loadSupabaseLegacyHydrationSource = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let authState = await window.resolveSupabaseAuthState();
  if (authState.status !== "signed-in")
    return {
      watched: [],
      watchlist: [],
      rankings: [],
      personalAwards: [],
      franchises: [],
      catalogFilms: [],
      ownProjects: [],
      profile: null,
    };
  let client = ready.client;
  let [
    watchedResult,
    watchlistResult,
    rankingsResult,
    personalAwardsResult,
    franchisesResult,
    catalogFilmsResult,
    ownProjectsResult,
    profileResult,
  ] = await Promise.all([
    client
      .from("watched")
      .select(
        `id, film_id, rating, rating_modifier, date_watched, review, want_to_rewatch, rewatch_tier, music_score, music_rating, music_rating_value, views, platform, updated_at, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
      ),
    client
      .from("watchlist")
      .select(
        `id, film_id, tier, position, reason, added_at, updated_at, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
      )
      .order("position"),
    client
      .from("rankings")
      .select(
        "id, scope, scope_type, ranking_entries(film_id, position, rank_confirmed, suppress_all_time_rank, tie_group_id, tie_group_title)",
      )
      .order("position", { foreignTable: "ranking_entries" }),
    client
      .from("personal_awards")
      .select(
        "id, scope, scope_type, personal_nominations(id, category, placement, film_id, detail, personal_nomination_recipients(recipient_name))",
      )
      .order("placement", { foreignTable: "personal_nominations" }),
    client.from("franchises").select("id, name, parent_id"),
    client.from("films").select(LEGACY_HYDRATION_FILM_FIELDS),
    // issue #458: every project the signed-in user owns, with its
    // collection's source identity and full item list - lets
    // findProjectById()/projectForSource() answer "does a project exist
    // for this source" against real data instead of the never-hydrated
    // legacy state.projects.
    // Queried from collections (not projects) with !inner on projects so
    // the single-level order-by-foreignTable syntax already proven for
    // ranking_entries/personal_nominations above applies here too - a
    // projects->collections->collection_items path would need a
    // two-level dotted foreignTable path this codebase has no proven
    // example of. collections.id IS the project's own id (issue #456's
    // shared primary key), so no reshaping indirection is needed either.
    client
      .from("collections")
      .select(
        "id, name, source_label, source_type, source_id, created_at, projects!inner(status, pinned, updated_at), collection_items(film_id, position)",
      )
      .order("position", { foreignTable: "collection_items" }),
    client.from("profiles").select("display_name").maybeSingle(),
  ]);
  for (let result of [
    watchedResult,
    watchlistResult,
    rankingsResult,
    personalAwardsResult,
    franchisesResult,
    catalogFilmsResult,
    ownProjectsResult,
    profileResult,
  ])
    if (result.error) throw result.error;
  return {
    watched: watchedResult.data,
    watchlist: watchlistResult.data,
    rankings: rankingsResult.data,
    personalAwards: personalAwardsResult.data,
    franchises: franchisesResult.data,
    catalogFilms: catalogFilmsResult.data,
    ownProjects: ownProjectsResult.data,
    profile: profileResult.data,
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
      `id, film_id, tier, position, reason, added_at, updated_at, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
    )
    .eq("id", watchlistId)
    .maybeSingle();
  if (error) throw error;
  return data;
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
    .select(
      "id, watched_id, version, source, steps, summary, completed_at, created_at, updated_at, watched(id, film_id, rating, rating_modifier, date_watched, platform, views, updated_at, films(id, tmdb_id, title, year, poster_url, runtime_minutes, country, medium, type))",
    )
    .eq("id", data.id)
    .single();
  if (selectError) throw selectError;
  await window.refreshSupabaseWorkspace();
  return joined;
};

/**
 * Updates a watchlist item's interest tier straight through to Supabase.
 * @param {string} watchlistId
 * @param {string} tier
 */
window.setSupabaseWatchlistTier = async function (watchlistId, tier) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { error } = await ready.client
    .from("watchlist")
    .update({ tier: tier || null, updated_at: new Date().toISOString() })
    .eq("id", watchlistId);
  if (error) throw error;
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
  if (insertError) throw insertError;
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
window.loadSupabaseFranchiseCatalog = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("franchises")
    .select("id, name, parent_id");
  if (error) throw error;
  return data;
};

/**
 * Loads the signed-in user's free-text note for one entity (issue #439).
 * Generic across every `entity_notes.entity_kind` value
 * ('person'|'period'|'franchise'|'tag'|'category'|'project'), matching
 * that table's own generic design - not just today's tag/franchise/
 * person/project callers.
 * @param {string} entityKind
 * @param {string} entityKey
 * @returns {Promise<string>} The note text, or "" when none is set.
 */
window.loadSupabaseEntityNote = async function (entityKind, entityKey) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("entity_notes")
    .select("note")
    .eq("entity_kind", entityKind)
    .eq("entity_key", entityKey)
    .maybeSingle();
  if (error) throw error;
  return data?.note || "";
};

/**
 * Sets or clears the signed-in user's note for one entity. An empty note
 * deletes the row rather than storing "" - entity_notes.note is `not
 * null`, matching renderEntityNote()'s own "no note yet" empty state.
 * @param {string} entityKind
 * @param {string} entityKey
 * @param {string} note
 */
window.setSupabaseEntityNote = async function (entityKind, entityKey, note) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let trimmed = String(note || "").trim();
  if (!trimmed) {
    let { error } = await ready.client
      .from("entity_notes")
      .delete()
      .eq("entity_kind", entityKind)
      .eq("entity_key", entityKey);
    if (error) throw error;
    return;
  }
  let { error } = await ready.client.from("entity_notes").upsert(
    {
      entity_kind: entityKind,
      entity_key: entityKey,
      note: trimmed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,entity_kind,entity_key" },
  );
  if (error) throw error;
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
 * setWatchlistTierForItems().
 * @param {string[]} watchlistIds
 * @param {string} tier
 */
window.setSupabaseWatchlistTierForItems = async function (watchlistIds, tier) {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let ids = (watchlistIds || []).filter(Boolean);
  if (!ids.length) return;
  let { error } = await ready.client
    .from("watchlist")
    .update({ tier: tier || null, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
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
 * @param {Object[]} tierItems The full tier's items in position order (from getSupabaseWorkspace().watchlist, pre-filtered to one tier).
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
  let beforePosition = beforeWatchlistId
    ? tierItems.find((item) => item.id === beforeWatchlistId)?.position
    : null;
  let afterPosition = afterWatchlistId
    ? tierItems.find((item) => item.id === afterWatchlistId)?.position
    : null;
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
 * and watchlist film carrying it, in the shaped FilmRecord/WatchlistItem
 * form src/domain/supabase-legacy-hydration.js's reshape functions
 * already produce (issue #439). Generic collection-film loading (the
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
  let { data: filmTags, error: filmTagsError } = await client
    .from("film_tags")
    .select("film_id")
    .eq("tag_id", tag.id);
  if (filmTagsError) throw filmTagsError;
  let filmIds = filmTags.map((row) => row.film_id);
  if (!filmIds.length) return { tagId: tag.id, watched: [], watchlist: [] };
  let [watchedResult, watchlistResult] = await Promise.all([
    client
      .from("watched")
      .select(
        `id, film_id, rating, rating_modifier, date_watched, review, want_to_rewatch, rewatch_tier, music_score, music_rating, music_rating_value, views, platform, updated_at, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
      )
      .in("film_id", filmIds),
    client
      .from("watchlist")
      .select(
        `id, film_id, tier, position, reason, added_at, updated_at, films(${LEGACY_HYDRATION_FILM_FIELDS})`,
      )
      .in("film_id", filmIds)
      .order("position"),
  ]);
  if (watchedResult.error) throw watchedResult.error;
  if (watchlistResult.error) throw watchlistResult.error;
  return {
    tagId: tag.id,
    watched: watchedResult.data,
    watchlist: watchlistResult.data,
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
  let { data: itemRows, error: itemsError } = await client
    .from("collection_items")
    .select(`film_id, position, films(${LEGACY_HYDRATION_FILM_FIELDS})`)
    .eq("collection_id", projectId)
    .order("position");
  if (itemsError) throw itemsError;

  let filmIds = itemRows.map((row) => row.film_id);
  let [watchedResult, watchlistResult, franchiseCatalog] = await Promise.all([
    filmIds.length
      ? client
          .from("watched")
          .select(
            "id, film_id, rating, rating_modifier, date_watched, review, want_to_rewatch, rewatch_tier, music_score, music_rating, music_rating_value, views, platform, updated_at",
          )
          .in("film_id", filmIds)
      : Promise.resolve({ data: [] }),
    filmIds.length
      ? client
          .from("watchlist")
          .select("id, film_id, tier, position, reason, added_at, updated_at")
          .in("film_id", filmIds)
      : Promise.resolve({ data: [] }),
    window.loadSupabaseFranchiseCatalog(),
  ]);
  if (watchedResult.error) throw watchedResult.error;
  if (watchlistResult.error) throw watchlistResult.error;
  let chains = window.buildSupabaseFranchiseChains(franchiseCatalog);

  let watchedByFilmId = new Map(
    (watchedResult.data || []).map((row) => [row.film_id, row]),
  );
  let watchlistByFilmId = new Map(
    (watchlistResult.data || []).map((row) => [row.film_id, row]),
  );

  let items = itemRows.map((row, index) => {
    let watchedRow = watchedByFilmId.get(row.film_id);
    let watchlistRow = watchlistByFilmId.get(row.film_id);
    if (watchedRow) {
      let film = window.supabaseLegacyHydrationFilmFromWatched(
        Object.assign({}, watchedRow, { films: row.films }),
        chains,
      );
      return { position: row.position, status: "watched", film };
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
    project,
    items,
    rawItems: itemRows.map((row) => ({
      film_id: row.film_id,
      position: row.position,
    })),
  };
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
 * @returns {Promise<Object[]>}
 */
window.listSupabaseCollections = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client
    .from("collections")
    .select(
      "id, name, source_label, created_at, updated_at, collection_items(count), projects(id)",
    )
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || [])
    .filter((row) => !row.projects)
    .map((row) => ({
      ...flattenCollectionRow(row),
      itemCount: row.collection_items?.[0]?.count || 0,
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

  // collection_items.collection_id is this collection's own id directly.
  let { data: itemRows, error: itemsError } = await client
    .from("collection_items")
    .select(`film_id, position, films(${LEGACY_HYDRATION_FILM_FIELDS})`)
    .eq("collection_id", collectionId)
    .order("position");
  if (itemsError) throw itemsError;

  let filmIds = itemRows.map((row) => row.film_id);
  let [watchedResult, watchlistResult, franchiseCatalog] = await Promise.all([
    filmIds.length
      ? client
          .from("watched")
          .select(
            "id, film_id, rating, rating_modifier, date_watched, review, want_to_rewatch, rewatch_tier, music_score, music_rating, music_rating_value, views, platform, updated_at",
          )
          .in("film_id", filmIds)
      : Promise.resolve({ data: [] }),
    filmIds.length
      ? client
          .from("watchlist")
          .select("id, film_id, tier, position, reason, added_at, updated_at")
          .in("film_id", filmIds)
      : Promise.resolve({ data: [] }),
    window.loadSupabaseFranchiseCatalog(),
  ]);
  if (watchedResult.error) throw watchedResult.error;
  if (watchlistResult.error) throw watchlistResult.error;
  let chains = window.buildSupabaseFranchiseChains(franchiseCatalog);

  let watchedByFilmId = new Map(
    (watchedResult.data || []).map((row) => [row.film_id, row]),
  );
  let watchlistByFilmId = new Map(
    (watchlistResult.data || []).map((row) => [row.film_id, row]),
  );

  let items = itemRows.map((row, index) => {
    let watchedRow = watchedByFilmId.get(row.film_id);
    let watchlistRow = watchlistByFilmId.get(row.film_id);
    if (watchedRow) {
      let film = window.supabaseLegacyHydrationFilmFromWatched(
        Object.assign({}, watchedRow, { films: row.films }),
        chains,
      );
      return { position: row.position, status: "watched", film };
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
    collection,
    alreadyPromoted,
    items,
    rawItems: itemRows.map((row) => ({
      film_id: row.film_id,
      position: row.position,
    })),
  };
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
