/** @file Owns targeted watched-film facts and personal form persistence for signed-in accounts. */

(function () {
  /**
   * Updates one watched film's rating in Supabase and the session cache,
   * preserving optimistic concurrency without requiring a full refresh.
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
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let cached = window.supabaseWorkspaceContext.workspaceState?.watched?.find(
      (row) => row.id === watchedId,
    );
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
      .select(window.supabaseWorkspaceContext.WATCHED_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw Object.assign(
        new Error(
          "This film's rating was changed elsewhere since it was last loaded - refresh before retrying.",
        ),
        { code: "OSKARS_STALE_WRITE" },
      );
    }

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState) {
      let idx =
        window.supabaseWorkspaceContext.workspaceState.watched.findIndex(
          (row) => row.id === watchedId,
        );
      if (idx >= 0)
        window.supabaseWorkspaceContext.workspaceState.watched[idx] = data;
    }
    return data;
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
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let { error } = await ready.client
      .from("watched")
      .delete()
      .eq("id", watchedId);
    if (error) throw error;

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState) {
      window.supabaseWorkspaceContext.workspaceState.watched =
        window.supabaseWorkspaceContext.workspaceState.watched.filter(
          (row) => row.id !== watchedId,
        );
    }
  };

  /**
   * Sets or clears rewatch intent on a watched film row.
   * @param {string} filmId Supabase film id.
   * @param {boolean} wantToRewatch Whether the user wants to rewatch this film.
   * @returns {Promise<void>}
   */
  window.setSupabaseWatchedRewatch = async function (filmId, wantToRewatch) {
    let ready = await window.ensureSupabaseClient();
    let auth = await window.resolveSupabaseAuthState();
    if (!ready || auth.status !== "signed-in")
      throw new Error("Sign in to update rewatch status.");
    let userId = auth.user.id;
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let { error } = await ready.client
      .from("watched")
      .update({
        want_to_rewatch: Boolean(wantToRewatch),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("film_id", filmId);
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState?.watched) {
      let row = window.supabaseWorkspaceContext.workspaceState.watched.find(
        (r) => r.film_id === filmId,
      );
      if (row) row.want_to_rewatch = Boolean(wantToRewatch);
    }
    window.invalidateCachedSupabaseHydrationSource?.();
  };

  /**
   * Updates only the requested personal fields on one versioned watched row.
   * @param {FilmRecord} film Hydrated watched film, including its row version.
   * @param {Object} changes Personal fields in film view-model shape.
   * @returns {Promise<Object|null>} Updated watched row, or null for an empty change.
   */
  window.updateSupabaseWatchedFilm = async function (film, changes) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    if (!film.supabaseWatchedId || !film.supabaseWatchedUpdatedAt)
      throw new Error("Refresh this watched film before editing it.");
    let fields = {
      review: "review",
      wantToRewatch: "want_to_rewatch",
      rewatchTier: "rewatch_tier",
      rewatchTierModifier: "rewatch_tier_modifier",
    };
    let payload = {};
    for (let [key, column] of Object.entries(fields)) {
      if (Object.hasOwn(changes, key))
        payload[column] =
          key === "wantToRewatch"
            ? Boolean(changes[key])
            : changes[key] || null;
    }
    if (Object.hasOwn(changes, "rating")) {
      let rating = window.parseFilmRating(changes.rating);
      payload.rating = Number(rating.value) || null;
      payload.rating_modifier = rating.modifier || null;
    }
    if (!Object.keys(payload).length) return null;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let { data, error } = await ready.client
      .from("watched")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", film.supabaseWatchedId)
      .eq("updated_at", film.supabaseWatchedUpdatedAt)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      throw Object.assign(
        new Error(
          "This watched film changed elsewhere. Refresh before continuing.",
        ),
        { code: "OSKARS_STALE_WRITE" },
      );
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let cached = window.supabaseWorkspaceContext.workspaceState?.watched?.find(
      (row) => row.id === data.id,
    );
    if (cached) Object.assign(cached, data);
    film.supabaseWatchedUpdatedAt = data.updated_at;
    for (let source of window.findSourceFilmsById?.(film.id) || [])
      source.supabaseWatchedUpdatedAt = data.updated_at;
    window.invalidateCachedSupabaseHydrationSource?.();
    return data;
  };

  /**
   * Persists a validated film form's personal edits and additive memberships.
   * @param {FilmRecord} before Film before local validation.
   * @param {FilmRecord} after Validated film form result.
   * @returns {Promise<void>} Resolves after the affected records are written.
   */
  window.persistSupabaseFilmForm = async function (before, after) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let changes = {};
    for (let key of [
      "rating",
      "review",
      "wantToRewatch",
      "rewatchTier",
      "rewatchTierModifier",
    ]) {
      if ((before[key] || "") !== (after[key] || "")) changes[key] = after[key];
    }
    if (Object.keys(changes).length)
      await window.updateSupabaseWatchedFilm(after, changes);
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let filmId = after.supabaseFilmId;
    for (let tag of before.tags || []) {
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      if (!(after.tags || []).includes(tag))
        await window.removeSupabaseFilmTag(filmId, tag);
    }
    for (let tag of after.tags || []) {
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      if (!(before.tags || []).includes(tag))
        await window.addSupabaseFilmTag(filmId, tag);
    }
    for (let membership of after.franchises || []) {
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      if (
        !(before.franchises || []).some(
          (entry) => JSON.stringify(entry) === JSON.stringify(membership),
        )
      )
        await window.addSupabaseFilmFranchiseMembership(
          filmId,
          membership.name,
          membership.parentChainNames || membership.parentNames || [],
          membership.rank,
        );
    }
    for (let award of after.awards || []) {
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      let original = (before.awards || []).find(
        (entry) => entry.supabaseNominationId === award.supabaseNominationId,
      );
      if (!original) continue;
      let names = (value) =>
        (value.recipients || []).map((person) =>
          typeof person === "string" ? person : person.name,
        );
      if (JSON.stringify(names(original)) !== JSON.stringify(names(award)))
        await window.updateSupabaseNominationRecipients(
          award.supabaseNominationId,
          names(award),
        );
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      let detail = window.awardDetail(award);
      if (window.awardDetail(original) !== detail)
        await window.updateSupabaseNominationDetail(
          award.supabaseNominationId,
          detail,
        );
    }
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
    if (
      window.state?.isPublicProfileView ||
      window.resolveActiveProfileSlug?.()
    )
      throw new Error("Public profiles are read-only.");
    let ready = await window.ensureSupabaseClient();
    let auth = await window.resolveSupabaseAuthState();
    if (!ready || auth.status !== "signed-in")
      throw new Error("Sign in to add films.");
    let userId = auth.user.id;
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    for (let offset = 0; offset < ids.length; offset += 100) {
      let chunk = ids.slice(offset, offset + 100);
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      let { error } = await ready.client.from("watched").upsert(
        chunk.map((filmId) => ({ user_id: userId, film_id: filmId })),
        { onConflict: "user_id,film_id", ignoreDuplicates: true },
      );
      if (error) throw error;
      // Invalidate even if the following cleanup fails: the insert is durable.
      window.supabaseWorkspaceContext.workspaceState = null;
      window.invalidateCachedSupabaseHydrationSource?.();
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      let { error: cleanupError } = await ready.client
        .from("watchlist")
        .delete()
        .eq("user_id", userId)
        .in("film_id", chunk);
      if (cleanupError) throw cleanupError;
    }
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    return ids;
  };
})();
