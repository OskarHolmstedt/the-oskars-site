/** @file Owns reusable staged insertion drafts and the exact-tier watchlist adapter. */
(function () {
  /**
   * Returns all tiered watchlist films from the Rankings workspace, ordered by exact tier, then title.
   * @returns {WatchlistItem[]} Films available for staged placement.
   */
  window.watchlistPlacementItems = function () {
    return (window.getSupabaseWorkspace()?.watchlist || [])
      .filter((row) => window.normalizeWatchlistTier(row.tier))
      .map((row) => ({
        id: row.id,
        supabaseFilmId: row.film_id,
        title: row.films?.title || "Unknown film",
        year: String(row.films?.year || ""),
        tier: window.normalizeWatchlistTier(row.tier),
        tierModifier: window.normalizeTierModifierValue(row.tier_modifier),
        supabaseWatchlistPosition: row.position || "",
        supabaseWatchlistUpdatedAt: row.updated_at || "",
        poster: row.films?.poster_url ? { url: row.films.poster_url } : null,
      }))
      .sort(
        (a, b) =>
          window.watchlistTierGrade(a.tier, a.tierModifier) -
            window.watchlistTierGrade(b.tier, b.tierModifier) ||
          a.title.localeCompare(b.title),
      );
  };

  /**
   * Creates a year-to-all-time insertion draft without changing existing films.
   * @param {WatchlistItem[]} items Complete watchlist.
   * @param {string} id Selected watchlist item id.
   * @returns {WatchlistPlacementPlan} In-memory insertion draft.
   */
  window.createWatchlistPlacement = function (items, id) {
    let film = items.find((item) => item.id === id);
    if (!film?.tier)
      throw new Error("Set an interest tier before placing this film.");
    let tier = window.watchlistTierKey(film.tier, film.tierModifier);
    let peers = items
      .filter(
        (item) =>
          item.id !== id &&
          item.supabaseWatchlistPosition &&
          window.watchlistTierKey(item.tier, item.tierModifier) === tier,
      )
      .sort((a, b) =>
        a.supabaseWatchlistPosition < b.supabaseWatchlistPosition
          ? -1
          : a.supabaseWatchlistPosition > b.supabaseWatchlistPosition
            ? 1
            : a.id.localeCompare(b.id),
      );
    for (let i = 1; i < peers.length; i++) {
      if (
        peers[i - 1].supabaseWatchlistPosition ===
        peers[i].supabaseWatchlistPosition
      )
        throw new Error(
          "This tier has duplicate positions. Merge its order before placing a film.",
        );
    }
    let year = Number(film.year) || 0;
    let stages = year
      ? [
          { label: String(year), span: 1 },
          { label: `${Math.floor(year / 10) * 10}s`, span: 10 },
          { label: `${Math.floor(year / 100) * 100}s`, span: 100 },
          { label: "All-time", span: Infinity },
        ]
      : [
          { label: "Unknown year", span: 1 },
          { label: "All-time", span: Infinity },
        ];
    let plan = window.createStagedPlacement(
      film,
      peers,
      stages.map((stage) => ({
        ...stage,
        includes: (item) =>
          stage.span === Infinity ||
          Math.floor((Number(item.year) || 0) / stage.span) ===
            Math.floor(year / stage.span),
      })),
    );
    return Object.assign(plan, { film, tier, year });
  };

  /**
   * Creates an insertion draft over ordered peers and caller-defined scope stages.
   * @template T
   * @param {T} item Selected item, excluded from peers by the caller.
   * @param {T[]} peers Already ordered, ranked candidates in the same ranking group.
   * @param {StagedPlacementStage<T>[]} stages Scope predicates in journey order.
   * @returns {StagedPlacementPlan<T>} Mutable in-memory draft; input records are untouched.
   */
  window.createStagedPlacement = function (item, peers, stages) {
    if (
      !stages.length ||
      stages.some((stage) => typeof stage.includes !== "function")
    )
      throw new Error(
        "Provide at least one placement stage with a scope filter.",
      );
    return {
      item,
      peers: [...peers],
      stages: [...stages],
      stage: 0,
      index: peers.length,
      lower: 0,
      upper: peers.length,
      history: [],
    };
  };

  /**
   * Returns legal insertion slots between the previous pool’s locked neighbours.
   * @template T
   * @param {StagedPlacementPlan<T>} plan Insertion draft.
   * @returns {StagedPlacementPool<T>} Current pool and legal global insertion indexes.
   */
  window.stagedPlacementPool = function (plan) {
    if (plan.stage >= plan.stages.length)
      throw new Error("This placement is already complete.");
    let scoped = plan.peers
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => plan.stages[plan.stage].includes(item))
      .map((peer, index) => ({ ...peer, rank: index + 1 }));
    let roof =
      plan.lower > 0
        ? { item: plan.peers[plan.lower - 1], index: plan.lower - 1 }
        : null;
    let bottom = plan.upper;
    while (
      bottom > plan.lower &&
      plan.isLegalIndex &&
      !plan.isLegalIndex(bottom)
    )
      bottom--;
    let anchor =
      bottom < plan.peers.length
        ? { item: plan.peers[bottom], index: bottom }
        : null;
    let above = scoped.filter(
      ({ index }) => index >= plan.lower && index < bottom,
    );
    return {
      scoped,
      roof,
      above,
      anchor,
      bottom,
      slots: [...above.map(({ index }) => index), bottom].filter(
        (index) => !plan.isLegalIndex || plan.isLegalIndex(index),
      ),
    };
  };

  /**
   * Places an item in a legal slot and advances while preserving all locked bounds.
   * @template T
   * @param {StagedPlacementPlan<T>} plan Insertion draft.
   * @param {number} index Global insertion index from the current pool.
   * @returns {boolean} Whether all stages are complete.
   */
  window.advanceStagedPlacement = function (plan, index) {
    let pool = window.stagedPlacementPool(plan);
    if (!pool.slots.includes(index))
      throw new Error("Choose a position inside this pool.");
    plan.history.push({
      index: plan.index,
      lower: plan.lower,
      upper: plan.upper,
    });
    let roof = pool.scoped.filter((peer) => peer.index < index).at(-1);
    let floor = pool.scoped.find((peer) => peer.index >= index);
    plan.lower = Math.max(plan.lower, roof ? roof.index + 1 : 0);
    plan.upper = Math.min(plan.upper, floor ? floor.index : plan.peers.length);
    plan.index = index;
    plan.stage++;
    return plan.stage === plan.stages.length;
  };

  /**
   * Returns the watchlist draft’s current legal pool through the shared engine.
   * @param {StagedPlacementPlan<WatchlistItem>} plan Insertion draft.
   * @returns {StagedPlacementPool<WatchlistItem>} Current pool.
   */
  window.watchlistPlacementPool = function (plan) {
    return window.stagedPlacementPool(plan);
  };

  /**
   * Advances a watchlist draft through the shared engine.
   * @param {StagedPlacementPlan<WatchlistItem>} plan Insertion draft.
   * @param {number} index Legal global insertion index.
   * @returns {boolean} Whether all stages are complete.
   */
  window.advanceWatchlistPlacement = function (plan, index) {
    return window.advanceStagedPlacement(plan, index);
  };
})();
