/** @file Owns account-scoped session state, shared query helpers, paging, and archive hydration for the Supabase data-access areas. */

(function () {
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
      throw Object.assign(
        new Error("Account changed while performing operation."),
        { code: "OSKARS_ACCOUNT_CHANGED" },
      );
    }
  }

  // Account changes invalidate pending reads as well as cached rows. Token
  // refreshes for the same account preserve both.
  window.onSupabaseAuthChange?.((user) =>
    syncWorkspaceAccount(user?.id || null),
  );

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
              .select(
                WATCHED_SELECT,
                withCount ? { count: "exact" } : undefined,
              )
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
   * ; a later request for a missing part fetches just that part.
   * A part that was never requested reads as an empty array.
   * @param {{force?: boolean, parts?: ('watched'|'watchlist')[]}} [options]
   *   `force: true` re-fetches the requested parts even if already cached -
   *   the explicit "refresh" case, never automatic. `parts` defaults to both.
   * @returns {Promise<{watched: Object[], watchlist: Object[], parts: string[], loadedAt: string|null}>}
   */
  window.loadSupabaseWorkspace = async function (options = {}) {
    let parts = options.parts || WORKSPACE_PARTS;
    let authState = await window.resolveSupabaseAuthState();
    if (
      !["signed-in", "signed-out", "unconfigured"].includes(authState.status)
    ) {
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
   * Re-fetches the cached workspace only when explicitly requested by a caller.
   * @returns {Promise<{watched: Object[], watchlist: Object[], loadedAt: string|null}>}
   */
  window.refreshSupabaseWorkspace = function () {
    return window.loadSupabaseWorkspace({ force: true });
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
  // just name: credits.person_id is the resolved catalog identity.
  // reshapeSharedFilmFields() carries the id through so
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
   * Domains that hold a subset of another domain's rows, mapped
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
        let { data, error } = await client.rpc(
          "read_full_watchlist_projection",
        );
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
          client.from("rankings").select("id, scope, scope_type").order("id"),
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
          .order("placement", { foreignTable: "personal_nominations" })
          .order("id"),
      ),
    // The shared catalogs are paginated : a plain .select()
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
    // Projects share their collection id; the inner embed excludes bare collections.
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
    // anyone, so an unfiltered select returns several rows and
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
   * for src/domain/supabase-legacy-hydration.js . Every domain
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
   * .
   * @returns {Promise<Object>} Raw rows, reshaped entirely by the caller.
   */
  window.loadSupabaseLegacyHydrationSource = function () {
    return window.loadSupabaseHydrationDomains();
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

  /** Shares account guards, cached state, and query shapes with the data-access areas. */
  window.supabaseWorkspaceContext = {
    get WATCHED_SELECT() {
      return WATCHED_SELECT;
    },
    get WATCHLIST_SELECT() {
      return WATCHLIST_SELECT;
    },
    get workspaceState() {
      return workspaceState;
    },
    set workspaceState(value) {
      workspaceState = value;
    },
    get beginWorkspaceMutation() {
      return beginWorkspaceMutation;
    },
    get assertCurrentWorkspaceMutation() {
      return assertCurrentWorkspaceMutation;
    },
    get SUPABASE_FETCH_PAGE_SIZE() {
      return SUPABASE_FETCH_PAGE_SIZE;
    },
    get fetchAllSupabaseRows() {
      return fetchAllSupabaseRows;
    },
    get HYDRATION_WATCHED_FIELDS() {
      return HYDRATION_WATCHED_FIELDS;
    },
    get HYDRATION_WATCHLIST_FIELDS() {
      return HYDRATION_WATCHLIST_FIELDS;
    },
    get LEGACY_HYDRATION_FILM_FIELDS() {
      return LEGACY_HYDRATION_FILM_FIELDS;
    },
    get withWatchlistOrders() {
      return withWatchlistOrders;
    },
    get HYDRATION_DOMAIN_LOADERS() {
      return HYDRATION_DOMAIN_LOADERS;
    },
    get postgrestQuoted() {
      return postgrestQuoted;
    },
    get ilikeLiteral() {
      return ilikeLiteral;
    },
    get selectInChunks() {
      return selectInChunks;
    },
  };
})();
