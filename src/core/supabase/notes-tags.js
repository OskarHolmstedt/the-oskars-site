/** @file Owns private entity notes and film tag membership reads and writes. */

(function () {
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
   * Loads the signed-in user's free-text note for one entity .
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
   * Updates the in-memory cache on success .
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
   * Loads the tagged watched/watchlist film collection. Watchlist rows carry their position in the whole watchlist as `order`.
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
    let films = `films!inner(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS}, tagged:film_tags!inner(tag_id))`;
    let [watched, watchlist] = await Promise.all([
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        client
          .from("watched")
          .select(
            `${window.supabaseWorkspaceContext.HYDRATION_WATCHED_FIELDS}, ${films}`,
            withCount ? { count: "exact" } : undefined,
          )
          .eq("films.tagged.tag_id", tag.id)
          .order("id"),
      ),
      window.supabaseWorkspaceContext
        .fetchAllSupabaseRows((withCount) =>
          client
            .from("watchlist")
            .select(
              `${window.supabaseWorkspaceContext.HYDRATION_WATCHLIST_FIELDS}, ${films}`,
              withCount ? { count: "exact" } : undefined,
            )
            .eq("films.tagged.tag_id", tag.id)
            .order("position")
            .order("id"),
        )
        .then((rows) =>
          window.supabaseWorkspaceContext.withWatchlistOrders(client, rows),
        ),
    ]);
    return { tagId: tag.id, watched, watchlist };
  };

  /**
   * Loads one film's effective catalog tags : the shared,
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
   * watchlisted, one lazy read for the tag index. Callers join the
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
      /** @type {('watched'|'watchlist')[]} */ (["watched", "watchlist"]).map(
        async (source) =>
          (
            await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
              (withCount) =>
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
   * Loads one catalog tag's collection in the user's archive : the
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
      .ilike("name", window.supabaseWorkspaceContext.ilikeLiteral(tagName))
      .maybeSingle();
    if (tagError) throw tagError;
    if (!tag) return null;
    let films = `films!inner(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS}, tagged:film_catalog_tags!inner(tag_id, removed))`;
    let filter = (query) =>
      query.eq("films.tagged.tag_id", tag.id).eq("films.tagged.removed", false);
    let [watched, watchlist] = await Promise.all([
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        filter(
          client
            .from("watched")
            .select(
              `${window.supabaseWorkspaceContext.HYDRATION_WATCHED_FIELDS}, ${films}`,
              withCount ? { count: "exact" } : undefined,
            ),
        ).order("id"),
      ),
      window.supabaseWorkspaceContext
        .fetchAllSupabaseRows((withCount) =>
          filter(
            client
              .from("watchlist")
              .select(
                `${window.supabaseWorkspaceContext.HYDRATION_WATCHLIST_FIELDS}, ${films}`,
                withCount ? { count: "exact" } : undefined,
              ),
          )
            .order("position")
            .order("id"),
        )
        .then((rows) =>
          window.supabaseWorkspaceContext.withWatchlistOrders(client, rows),
        ),
    ]);
    return {
      tagId: tag.id,
      kind: tag.kind,
      name: tag.name,
      watched,
      watchlist,
    };
  };
})();
