/** @file Reads films.html's paged browse from Postgres (issue #642, read_film_catalog_page()) and turns one page of film ids into the same catalog records buildFullFilmCatalog() produces over the complete archive. */

(function () {
  // Filters read_film_catalog_page() has no SQL form for; any of them sends
  // films.html back to its complete-archive path.
  const COMPLETE_ARCHIVE_FILTERS = [];

  /**
   * Reports whether a Films view needs the complete archive rather than the
   * paged read.
   * @param {Object} view films.html's URL state.
   * @param {{groups: Object[]}} collectionExpression Parsed collection filter.
   * @returns {boolean} Whether the complete archive is needed.
   */
  window.filmCatalogNeedsCompleteArchive = function (
    view,
    collectionExpression,
  ) {
    return (
      COMPLETE_ARCHIVE_FILTERS.some((name) => Boolean(view?.[name])) ||
      (collectionExpression?.groups || []).some((group) => group.items.length)
    );
  };

  /**
   * Builds read_film_catalog_page()'s p_filters from films.html's URL state,
   * normalized the way the page's own predicates normalize them.
   * @param {Object} view films.html's URL state.
   * @returns {Object} RPC filters.
   */
  window.filmCatalogRpcFilters = function (view) {
    let tier = view.watchlistTier
      ? view.watchlistTier === "unset"
        ? "unset"
        : window.normalizeWatchlistTier(view.watchlistTier)
      : "";
    return {
      status: view.status || "",
      period: view.period || "",
      medium: view.medium || "",
      screenplay: view.screenplay || "",
      adaptationSource: view.adaptationSource || "",
      country: view.country || "",
      franchise: view.franchise || "",
      officialResult: view.officialResult || "",
      minimumRating: Number(view.minimumRating) || 0,
      maximumRating: Number(view.maximumRating) || 0,
      minimumRuntime: Number(view.minimumRuntime) || 0,
      maximumRuntime: Number(view.maximumRuntime) || 0,
      watchlistTier: tier,
      category: view.category || "",
      personalAward: view.personalAward || "",
      tag: view.tags
        ? window.normalizeFilmTag(view.tags).toLocaleLowerCase()
        : "",
      catalogTag: String(view.catalogTag || "").trim(),
      search: String(view.q || "")
        .trim()
        .toLowerCase(),
    };
  };

  /**
   * Builds the catalog records for one page of films from a hydration
   * source scoped to them, through the same reshape, aggregate and merge
   * steps the complete archive goes through, in the page's order.
   * @param {Object} source loadSupabaseFilmsSource() result for the page.
   * @param {string[]} pageIds Film uuids in page order.
   * @returns {{films: Object[], watchedOtherIds: Set<string>}}
   */
  window.buildFilmCatalogPageRecords = function (source, pageIds) {
    let pageState = Object.assign(
      window.createEmptyState(),
      window.buildLegacyStateFromSupabaseHydration(source),
    );
    let savedState = window.state;
    window.state = pageState;
    try {
      window.rebuildAggregates();
    } finally {
      window.state = savedState;
    }
    let watchedOther = pageState.watchedOther || [];
    let records = window.buildFullFilmCatalog(
      window.buildSharedFilmArchiveFromSupabase(
        source.catalogFilms,
        source.franchises,
      ),
      [...Object.values(pageState.filmsById || {}), ...watchedOther],
      pageState.watchlist || [],
    );
    let byFilmId = new Map(
      records.map((record) => [record.supabaseFilmId || record.id, record]),
    );
    return {
      films: pageIds.map((id) => byFilmId.get(id)).filter(Boolean),
      watchedOtherIds: new Set(watchedOther.map((film) => film.id)),
    };
  };

  /**
   * Reads published other-user averages for complete-archive sorting.
   * @returns {Promise<Record<string, {average: number, count: number}>>} Ratings by film id.
   */
  window.loadSupabaseFilmCommunityRatings = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client.rpc("read_film_community_ratings");
    if (error) throw error;
    return data || {};
  };

  // Status counts and option lists don't depend on the filters: fetched
  // once per account, dropped whenever a write invalidates the archive.
  let facetsByUser = new Map();
  window.addEventListener?.("oskars:hydration-invalidated", () =>
    facetsByUser.clear(),
  );

  /**
   * Reads the catalog tag option list and, for a selected tag, the ids of its
   * films, for the complete-archive Films path: it filters in the browser but
   * takes read_film_catalog_page()'s catalog tag matches rather than a second
   * definition of them.
   * @param {string} tagName Selected catalog tag, or '' for the option list alone.
   * @returns {Promise<{names: string[], ids: Set<string>}>} Catalog tag names with films, and the selected tag's film ids.
   */
  window.loadSupabaseFilmCatalogTagFilter = async function (tagName) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client.rpc("read_film_catalog_page", {
      p_filters: { catalogTag: tagName },
      p_limit: tagName ? 1000000 : 0,
      p_include_facets: true,
    });
    if (error) throw error;
    if (data?.version !== 1)
      throw new Error("Unsupported film catalog response.");
    return {
      names: data.facets?.catalogTags || [],
      ids: new Set(data.pageIds || []),
    };
  };

  /**
   * Reads one page of the Films browse: the page's catalog records in
   * order, the matching total, and the status counts and option lists.
   * @param {Object} view films.html's URL state (sort, order, filters).
   * @param {{limit: number, offset: number}} page Page window.
   * @returns {Promise<{totalCount: number, films: Object[], watchedOtherIds: Set<string>, facets: Object}>}
   */
  window.loadSupabaseFilmCatalogPage = async function (view, page) {
    let auth = await window.resolveSupabaseAuthState();
    if (auth.status !== "signed-in")
      throw new Error("Sign in to browse your films.");
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let facets = facetsByUser.get(auth.user.id) || null;
    let { data, error } = await ready.client.rpc("read_film_catalog_page", {
      p_filters: window.filmCatalogRpcFilters(view),
      p_sort: view.sort || "title",
      p_direction: view.order === "desc" ? "desc" : "asc",
      p_limit: page.limit,
      p_offset: page.offset,
      p_include_facets: !facets,
    });
    if (error) throw error;
    if (data?.version !== 1)
      throw new Error("Unsupported film catalog response.");
    if (!facets) {
      facets = data.facets;
      facetsByUser.set(auth.user.id, facets);
    }
    let pageIds = data.pageIds || [];
    let source = await window.loadSupabaseFilmsSource(pageIds);
    let records = window.buildFilmCatalogPageRecords(source, pageIds);
    for (let film of records.films) {
      let rating = data.communityRatings?.[film.supabaseFilmId || film.id];
      film.communityRatingAverage = rating?.average ?? null;
      film.communityRatingCount = rating?.count || 0;
    }
    return {
      totalCount: Number(data.totalCount) || 0,
      facets,
      ...records,
    };
  };
})();
