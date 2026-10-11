/** @file Owns catalog maintenance, identity repairs, and protected metadata enrichment. */

(function () {
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
    return window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) =>
        ready.client
          .from("films")
          .select(
            "id, tmdb_id, tmdb_tv_ref, tmdb_field_outcomes, owner_decided_fields, tmdb_verification:tmdb_metadata_verification->header, genre, type, adaptation_source, letterboxd_url, title, swedish_title, year, poster_url, country, primary_country, runtime_minutes, tmdb_verified_at, medium, screenplay_type, original_language, credits(person_id, role, billing_order, character_name, uncredited, people(id, name, tmdb_id))",
            withCount ? { count: "exact" } : undefined,
          ),
      window.supabaseWorkspaceContext.SUPABASE_FETCH_PAGE_SIZE,
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
    return window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) =>
        ready.client
          .from("people")
          .select(
            "id, tmdb_id, name, source_url, portrait_url, portrait_source, portrait_source_url, portrait_provider_id, portrait_fetched_at, tmdb_verified_at",
            withCount ? { count: "exact" } : undefined,
          ),
      window.supabaseWorkspaceContext.SUPABASE_FETCH_PAGE_SIZE,
      DATA_TOOLS_FETCH_CONCURRENCY,
    );
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
    if (identity?.tvTmdbRef)
      query = query.eq("tmdb_tv_ref", identity.tvTmdbRef);
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
    return window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
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
    window.invalidateCachedSupabaseHydrationSource?.();
    return data;
  };
})();
