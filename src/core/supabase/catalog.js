/** @file Owns shared film/person catalog reads, detail projections, credits, and identity-key adoption. */

(function () {
  /**
   * Searches the shared film catalog by title - a read-open, eligibility-
   * free query (films: read all authenticated), used to find a film to
   * add to the watchlist or project without any TMDB search/import step.
   * Uses search_films_catalog RPC with fuzzy and prefix ranking .
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

  /**
   * Persists TMDB-sourced crew for one film/role into the shared credits
   * catalog, mirroring the Google Sheets importer's own
   * find-or-create-person-then-insert-credit pattern
   * (src/imports/google-sheets-supabase-import.js) so a nomination confirmed
   * with a TMDB-suggested recipient benefits every future viewer, not just
   * this session. `credits` has no update grant for `authenticated` (a
   * shared, append-only catalog fact). Conflict-ignoring inserts create missing
   * credits without changing existing rows or producing duplicate errors. A name
   * without a TMDB ID links an existing person, or else the person TMDB finds for
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
      let { personId } = await window.resolveSupabaseCatalogPerson(
        ready.client,
        {
          name,
          tmdbId,
          profilePath: typeof person === "object" ? person?.profilePath : null,
          creditedFilmTmdbIds: filmTmdbIds || [],
        },
      );
      if (!personId) {
        notAdded.push(name);
        continue;
      }
      let { error: creditError } = await ready.client
        .from("credits")
        .upsert(
          { film_id: filmId, person_id: personId, role, billing_order: index },
          { onConflict: "film_id,person_id,role", ignoreDuplicates: true },
        );
      if (creditError) throw creditError;
    }
    return notAdded;
  };

  /**
   * Searches shared catalog people by name for the director picker, without filtering their credit roles.
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

  /**
   * Loads the watchlist and unseen-catalog half of the people index, one row
   * per credited person), so a
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
    let rows = await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) =>
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

  /**
   * Loads the signed-in user's archive for a chosen set of films,
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
        window.supabaseWorkspaceContext.selectInChunks(ids, (chunk) =>
          client
            .from("watched")
            .select(
              `${window.supabaseWorkspaceContext.HYDRATION_WATCHED_FIELDS}, films(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS})`,
            )
            .in("film_id", chunk)
            .order("id"),
        ),
        // Relative order only: a watchlist item's `order` comes from its
        // position in this array, and this is a subset of the watchlist -
        // sorted the same way, so relative order within it is unchanged.
        window.supabaseWorkspaceContext.selectInChunks(ids, (chunk) =>
          client
            .from("watchlist")
            .select(
              `${window.supabaseWorkspaceContext.HYDRATION_WATCHLIST_FIELDS}, films(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS})`,
            )
            .in("film_id", chunk)
            .order("position")
            .order("id"),
        ),
        window.loadSupabaseRankingsForFilms(ids),
        window.supabaseWorkspaceContext.selectInChunks(ids, (chunk) =>
          client
            .from("personal_awards")
            .select(
              "id, scope, scope_type, personal_nominations!inner(id, category, placement, film_id, detail, personal_nomination_recipients(recipient_name, person_id))",
            )
            .in("personal_nominations.film_id", chunk)
            .order("placement", { foreignTable: "personal_nominations" }),
        ),
        ids.length
          ? window.supabaseWorkspaceContext.HYDRATION_DOMAIN_LOADERS.franchises(
              client,
            )
          : [],
        window.supabaseWorkspaceContext.selectInChunks(catalogIds, (chunk) =>
          client
            .from("films")
            .select(
              window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS,
            )
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
   * - the compact read behind person.html, instead of the
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
        `person_id.eq.${personId},recipient_name.ilike.${window.supabaseWorkspaceContext.postgrestQuoted(window.supabaseWorkspaceContext.ilikeLiteral(person.name))}`,
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
        `${window.supabaseWorkspaceContext.HYDRATION_WATCHLIST_FIELDS}, films(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS})`,
      )
      .eq("id", watchlistId)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  let filmDetailInFlight = new Map();

  /**
   * Clears in-flight film detail request deduplication promises.
   */
  window.clearSupabaseFilmDetailInFlight = function () {
    filmDetailInFlight.clear();
  };

  /**
   * Loads one film and its account-scoped personal facts without depending on complete archive hydration.
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
            `${window.supabaseWorkspaceContext.HYDRATION_WATCHED_FIELDS}, films(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS})`,
          )
          .eq("film_id", filmId)
          .maybeSingle(),
        client
          .from("watchlist")
          .select(
            `${window.supabaseWorkspaceContext.HYDRATION_WATCHLIST_FIELDS}, films(${window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS})`,
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
        window.supabaseWorkspaceContext.HYDRATION_DOMAIN_LOADERS.franchises(
          client,
        ).then(
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
      let catalogFilms = [];
      if (
        !watchedResult.data &&
        !watchlistResult.data &&
        window.isUuid?.(filmId)
      ) {
        try {
          let { data, error } = await client.rpc(
            "read_catalog_film_summaries",
            {
              p_ids: [filmId],
            },
          );
          if (!error && Array.isArray(data) && data.length) {
            catalogFilms = data;
          } else {
            let { data: fallbackFilm, error: fallbackError } = await client
              .from("films")
              .select(
                window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS,
              )
              .eq("id", filmId)
              .maybeSingle();
            if (!fallbackError && fallbackFilm) catalogFilms = [fallbackFilm];
          }
        } catch {
          let { data: fallbackFilm } = await client
            .from("films")
            .select(
              window.supabaseWorkspaceContext.LEGACY_HYDRATION_FILM_FIELDS,
            )
            .eq("id", filmId)
            .maybeSingle();
          if (fallbackFilm) catalogFilms = [fallbackFilm];
        }
      }
      let payload = {
        watched: watchedResult.data ? [watchedResult.data] : [],
        watchlist: watchlistResult.data ? [watchlistResult.data] : [],
        rankings: rankingsResult.data || [],
        personalAwards: personalAwardsResult.data || [],
        franchises: franchisesResult.data || [],
        catalogFilms,
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
   * Loads a single film's detail payload by TMDB id or TV reference, delegating
   * to loadSupabaseFilmDetail() once resolved to a films.id UUID.
   * @param {string|number} tmdbId TMDB id or TV reference (e.g. 12345 or "TV:6789").
   * @returns {Promise<Object|null>} Hydration source payload for this film, or null.
   */
  window.loadSupabaseFilmDetailByTmdbId = async function (tmdbId) {
    let id = String(tmdbId || "").trim();
    if (!id) return null;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let client = ready.client;
    let query = client.from("films").select("id");
    if (/^TV:/i.test(id)) {
      query = query.eq("tmdb_tv_ref", id);
    } else {
      let num = Number(id);
      if (!Number.isInteger(num) || num <= 0) return null;
      query = query.eq("tmdb_id", num);
    }
    let { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data?.id) return null;
    return window.loadSupabaseFilmDetail(data.id);
  };

  /**
   * Loads the signed-in user's own watched films whose title normalizes the
   * same as the given title) -
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
   * Adds a film to a franchise, finding or creating the franchise (and its
   * direct parent, if named) by name first. `franchises`/`film_franchises`
   * are create-only for ordinary clients like the rest of the shared
   * catalog (docs/supabase-backend-decision.md's "Correcting a mistaken
   * shared-catalog write") - this can only ever add a new membership, not
   * edit or remove an existing one.
   * @param {string} filmId
   * @param {string} franchiseName
   * @param {string|string[]} [parentFranchiseName] Direct parent or complete ancestor chain.
   * @param {number|null} [position] New membership position.
   */
  window.addSupabaseFilmFranchiseMembership = async function (
    filmId,
    franchiseName,
    parentFranchiseName,
    position,
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
    let parentId = null;
    for (let name of (Array.isArray(parentFranchiseName)
      ? parentFranchiseName
      : [parentFranchiseName]
    ).filter(Boolean))
      parentId = await findOrCreateFranchise(name, parentId);
    let franchiseId = await findOrCreateFranchise(franchiseName, parentId);
    let { error } = await client.from("film_franchises").insert({
      film_id: filmId,
      franchise_id: franchiseId,
      position: Number(position) || null,
    });
    if (error && error.code !== "23505") throw error;
  };

  /**
   * Adopts a resolved catalog identity key for existing account-owned notes or local rankings.
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
   * Loads one shared-catalog person's id and name - person.html
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
    return window.supabaseWorkspaceContext.HYDRATION_DOMAIN_LOADERS.franchises(
      ready.client,
    );
  };

  /**
   * Loads the director credits and franchise links of every film on the
   * signed-in user's watched rows or watchlist, plus the franchise hierarchy -
   * the input indexSupabaseQueueMembership() turns into director and
   * franchise groups for the queue pages.
   * @param {'watched'|'watchlist'} part Whose films to read.
   * @returns {Promise<{rows: Object[], franchises: Object[]}>} `rows` are `{film_id, films: {credits, film_franchises}}`; `franchises` are `{id, name, parent_id}`.
   */
  window.loadSupabaseQueueMembership = async function (part) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let ownerId = window.getSupabaseCurrentUser?.()?.id;
    if (!ownerId) throw new Error("Sign in to group your films.");
    let [rows, franchises] = await Promise.all([
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        ready.client
          .from(part)
          .select(
            "film_id, films(credits(role, people(id, name)), film_franchises(franchise_id))",
            withCount ? { count: "exact" } : undefined,
          )
          .eq("user_id", ownerId)
          .eq("films.credits.role", "director")
          .order("id"),
      ),
      window.supabaseWorkspaceContext.HYDRATION_DOMAIN_LOADERS.franchises(
        ready.client,
      ),
    ]);
    if (window.getSupabaseCurrentUser?.()?.id !== ownerId)
      throw new Error("Account changed while loading — reload first.");
    return { rows, franchises };
  };
})();
