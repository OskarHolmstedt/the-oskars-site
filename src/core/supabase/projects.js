/** @file Owns watch projects, custom collections, memberships, and source selection. */

(function () {
  /**
   * Loads the signed-in user's open projects containing one film, with total and watched counts, pinned and most recently updated first.
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

  // A project is now workflow state (status/pinned) on top of a collection
  // row sharing its id - name/source_label/the film list all
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
   * its initial ordered items atomically via the
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
   * Creates or refreshes a source-backed project  via the
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
   * newest-updated first, with its raw item count and first five queue films.
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
        "id, status, pinned, updated_at, collections(name, source_label, created_at, collection_items(count), poster_items:collection_items(position, film_id, films(id, title, poster_url)))",
      )
      .order("updated_at", { ascending: false })
      .order("position", { referencedTable: "collections.poster_items" })
      .order("film_id", { referencedTable: "collections.poster_items" })
      .limit(5, { referencedTable: "collections.poster_items" });
    if (error) throw error;
    return (data || []).map((row) => ({
      ...flattenProjectRow(row),
      itemCount: row.collections?.collection_items?.[0]?.count || 0,
      posterFilms: (row.collections?.poster_items || [])
        .map((item) => item.films)
        .filter(Boolean),
    }));
  };

  // One collection's items (a project's too: its id is its collection's id,
  // each resolved to the user's watched row, else their watchlist
  // row, else "missing". Items are paginated and the per-film reads chunked,
  // so a long list is neither truncated at PostgREST's row cap nor sent as
  // one oversized URL.
  async function loadCollectionMembers(client, collectionId) {
    let itemRows = await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) =>
        client
          .from("collection_items")
          .select(
            `film_id, position, films(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS})`,
            withCount ? { count: "exact" } : undefined,
          )
          .eq("collection_id", collectionId)
          .order("position")
          .order("film_id"),
    );
    let filmIds = itemRows.map((row) => row.film_id);
    let [watchedRows, watchlistRows, franchiseCatalog] = await Promise.all([
      window.supabaseWorkspaceContext.selectInChunks(filmIds, (ids) =>
        client
          .from("watched")
          .select(window.supabaseWorkspaceContext.HYDRATION_WATCHED_FIELDS)
          .in("film_id", ids),
      ),
      window.supabaseWorkspaceContext.selectInChunks(filmIds, (ids) =>
        client
          .from("watchlist")
          .select(window.supabaseWorkspaceContext.HYDRATION_WATCHLIST_FIELDS)
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
   * already produce, so project.js can reuse the same shared
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
    // id (projects.id references collections.id directly).
    let { items, rawItems } = await loadCollectionMembers(client, projectId);
    return { project, items, rawItems };
  };

  // A bare collection: a named, ordered film list with
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
   * via the create_collection() RPC - unlike
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
  window.createSupabaseCollection = async function (
    name,
    filmIds,
    sourceLabel,
  ) {
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
   * promoted to a project, for the collections.html hub -
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
   * produces  so collection.js can reuse the same shared
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
   * Promotes a bare collection into a project, giving it
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
   * Permanently removes a collection and its project and item rows without touching referenced film, watched, or watchlist data.
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
   * Removes one film from a collection's item list for either a project or a custom collection.
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
   * Moves one collection item between its queue neighbors using fractional positions.
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

  /** Searches catalog people or franchises for project creation.
   * @param {'person'|'franchise'} kind Source kind.
   * @param {string} query Name search.
   * @returns {Promise<Object[]>} Matching sources.
   */
  window.searchSupabaseProjectSources = async function (kind, query) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let term = String(query || "")
      .trim()
      .replace(/[%_]/g, "");
    if (!term) return [];
    let { data, error } = await ready.client
      .from(kind === "person" ? "people" : "franchises")
      .select("id, name")
      .ilike("name", `%${term}%`)
      .order("name")
      .limit(20);
    if (error) throw error;
    return data || [];
  };

  /** Loads known catalog films for a filmography or franchise, including child franchises.
   * @param {'person'|'franchise'} kind Source kind.
   * @param {string} id Source identity.
   * @returns {Promise<Object[]>} Deduplicated films in release order.
   */
  window.loadSupabaseProjectSourceFilms = async function (kind, id) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let ids = new Set([id]);
    if (kind === "franchise") {
      let catalog = await window.loadSupabaseFranchiseCatalog();
      let added;
      do {
        added = false;
        for (let row of catalog) {
          if (ids.has(row.parent_id) && !ids.has(row.id)) {
            ids.add(row.id);
            added = true;
          }
        }
      } while (added);
    }
    let rows = await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) => {
        let request = ready.client
          .from(kind === "person" ? "credits" : "film_franchises")
          .select(
            "film_id, films(id, title, year)",
            withCount ? { count: "exact" } : undefined,
          )
          .order("film_id");
        return kind === "person"
          ? request.eq("person_id", id).order("role")
          : request.in("franchise_id", [...ids]).order("franchise_id");
      },
    );
    let films = new Map();
    for (let row of rows) if (row.films) films.set(row.film_id, row.films);
    return [...films.values()].sort(
      (a, b) => (a.year || 0) - (b.year || 0) || a.title.localeCompare(b.title),
    );
  };
})();
