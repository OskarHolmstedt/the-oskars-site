/** @file Reads the private compact Period Watchlist projection (issue #598) and reshapes it into the same WatchlistItem/entry shape the existing legacy-hydration render path already uses, without mutating the shared shell. */

(function () {
  /**
   * Builds the `read_watchlist_page()` RPC's `p_filters` jsonb argument from
   * a `WatchlistFilters` object (src/pages/period/watchlist-view.js).
   * @param {Object} filters Watchlist filter/sort state.
   * @returns {Object}
   */
  function rpcFilters(filters) {
    return {
      periodType: filters.type,
      periodKey: filters.key,
      tiers: filters.tierFilter,
      subCentury: filters.subCentury || "all",
      subDecade: filters.subDecade || "all",
      subYear: filters.subYear || "all",
      director: filters.director || "",
      search: filters.search || "",
      minRuntime: Number(filters.minRuntime) || 0,
      maxRuntime: Number(filters.maxRuntime) || 0,
    };
  }

  /**
   * Reshapes a raw `read_watchlist_page()` response into the same
   * `{item, index, archiveFilm}` entry shape `periodWatchlistEntries()`
   * already returns, through the existing, unmodified
   * window.supabaseLegacyHydrationWatchlistItem() so every downstream
   * renderer (renderWatchlistCard/Row, watchlistFilmLike, ...) works
   * unchanged. Pure - no network/auth calls, so it's the unit under real
   * test (mirrors buildSupabaseStatsModel's split from
   * loadSupabaseStatsProjection). Franchise ancestor chains are
   * intentionally not resolved (an empty chain table is passed) since
   * watchlist cards never render `.franchises` and a real ancestor-chain
   * fetch would need the complete franchise catalog, defeating the point
   * of a compact read.
   * @param {Object} data Raw `read_watchlist_page()` jsonb result.
   * @returns {{totalCount:number, tierCounts:Object, subPeriodCounts:Object, orderedIds:string[], page:Object[]}}
   */
  window.buildSupabaseWatchlistPageModel = function (data) {
    if (data?.version !== 2)
      throw new Error("Unsupported compact Watchlist response.");
    let chains = window.buildSupabaseFranchiseChains([]);
    let page = (data.page || [])
      .map((row) =>
        window.supabaseLegacyHydrationWatchlistItem(row, row.absOrder, chains),
      )
      .filter(Boolean)
      .map((item, pageIndex) => ({
        item,
        // Only used as a stable secondary sort key by the LEGACY
        // client-side sort (periodWatchlistEntries), which never runs on
        // compact-sourced entries - the server already returned these in
        // final sorted order, so this only needs to preserve that order,
        // not reproduce the legacy value.
        index: pageIndex,
        archiveFilm: null,
      }));
    return {
      totalCount: Number(data.totalCount) || 0,
      tierCounts: data.tierCounts || {},
      subPeriodCounts: data.subPeriodCounts || {
        century: {},
        decade: {},
        year: {},
      },
      orderedIds: data.orderedIds || [],
      page,
    };
  };

  /**
   * Reads one page of the compact Period Watchlist projection for the
   * "rank"/"shuffle" sort axes only - the RPC itself rejects any other
   * axis (issue #598's own explicit scope limit; the "title"/"year"/
   * "runtime" axes stay on the full-hydration path).
   * @param {Object} filters Watchlist filter/sort state (must have order "rank" or "shuffle").
   * @param {Object} [options] Pagination.
   * @param {number} [options.limit] Page size.
   * @param {number} [options.offset] Zero-based row offset into the ordered, filtered set.
   * @returns {Promise<{totalCount:number, tierCounts:Object, subPeriodCounts:Object, orderedIds:string[], page:Object[]}>}
   */
  window.loadSupabaseWatchlistPage = async function (filters, options = {}) {
    if (
      window.resolveActiveProfileSlug?.() ||
      window.state?.isPublicProfileView
    )
      throw new Error(
        "The compact Watchlist read is unavailable in public mode.",
      );
    if (filters.order !== "rank" && filters.order !== "shuffle")
      throw new Error(
        `Unsupported watchlist sort axis for the compact read: ${filters.order}`,
      );
    let auth = await window.resolveSupabaseAuthState();
    if (auth.status !== "signed-in")
      throw new Error("Sign in to view your watchlist.");
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client.rpc("read_watchlist_page", {
      p_filters: rpcFilters(filters),
      p_order: filters.order,
      p_direction: filters.direction || "asc",
      p_shuffle_seed: filters.shuffleSeed || "",
      p_limit: Number(options.limit) || 60,
      p_offset: Number(options.offset) || 0,
    });
    if (error) throw error;
    return window.buildSupabaseWatchlistPageModel(data);
  };
})();
