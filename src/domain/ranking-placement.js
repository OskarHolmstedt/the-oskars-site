/** @file Owns Watched and Rewatchlist adapters for the Rankings staged placement journey. */
(function () {
  let tier = (row) =>
    window.watchlistTierKey(row.rewatch_tier, row.rewatch_tier_modifier);
  let rating = (row) => window.supabaseRankingRatingKey(row);
  let ratingLabel = (row) =>
    rating(row) === "unrated"
      ? "Unrated"
      : window.renderFilmRating({
          ratingValue: row.rating,
          ratingModifier: row.rating_modifier,
        });

  function scopesFor(row) {
    let year = row.films?.year;
    return [
      ...(Number.isInteger(year)
        ? [
            {
              type: "years",
              key: String(year),
              label: `Release year · ${year}`,
            },
            {
              type: "decades",
              key: window.getDecadeKey(year),
              label: `Decade · ${window.getDecadeKey(year)}`,
            },
            {
              type: "centuries",
              key: window.getCenturyKey(year),
              label: `Century · ${window.getCenturyKey(year)}`,
            },
          ]
        : []),
      { type: "allTime", key: "alltime", label: "All-time" },
    ];
  }

  /**
   * Returns current watched or marked rewatch rows without reading the database.
   * @param {'watched'|'rewatchlist'} category Selected category.
   * @returns {Object[]} Alphabetically ordered picker rows.
   */
  window.rankingPlacementItems = function (category) {
    return (window.getSupabaseWorkspace()?.watched || [])
      .filter((row) =>
        category === "rewatchlist"
          ? row.want_to_rewatch
          : window.supabaseRankingFilmEligible(row),
      )
      .slice()
      .sort((a, b) =>
        (a.films?.title || "").localeCompare(b.films?.title || ""),
      );
  };

  /**
   * Builds a draft preserving independent period rankings and exact rating or rewatch tier boundaries.
   * @param {'watched'|'rewatchlist'} category Selected category.
   * @param {Object[]} items Complete category candidates.
   * @param {string} id Film id from a candidate or deep link.
   * @returns {RankingPlacementPlan} Draft and immutable persistence snapshot.
   */
  window.createRankingPlacement = function (category, items, id) {
    let selected = items.find((row) => row.film_id === id);
    if (!selected)
      throw new Error(
        "This film is no longer available in this category. Choose another film.",
      );
    let workspace = window.getSupabaseWorkspace();
    let snapshots = (workspace.watched || [])
      .filter((row) => category === "watched" || row.want_to_rewatch)
      .map((row) => ({ id: row.id, updated_at: row.updated_at }));
    let scopes = scopesFor(selected);
    let peers;
    if (category === "watched") {
      let bucket = window
        .supabaseWatchedItemsInOrder(items)
        .filter((row) => rating(row) === rating(selected));
      if (selected.ranking_group_id)
        throw new Error(
          "Review the film's tie before placing it individually.",
        );
      peers = bucket.filter((row) => row.film_id !== id && row.position);
      scopes = [
        {
          type: "allTime",
          key: "alltime",
          label: "Exact rating",
          entries: bucket,
        },
      ];
      snapshots = bucket.map((row) => ({
        film_id: row.film_id,
        updated_at: row.updated_at,
      }));
    } else {
      peers = items
        .filter(
          (row) =>
            row.film_id !== id &&
            tier(row) === tier(selected) &&
            row.rewatch_position != null,
        )
        .sort(
          (a, b) =>
            a.rewatch_position - b.rewatch_position ||
            a.film_id.localeCompare(b.film_id),
        );
    }
    let stages = scopes.map((scope) => {
      let rankedIds = new Set(
        (scope.entries || []).map((entry) => entry.film_id),
      );
      return {
        label: scope.label,
        includes:
          category === "watched"
            ? (row) => rankedIds.has(row.film_id)
            : (row) =>
                window.supabaseRankingEntryInScope(scope.type, scope.key, {
                  films: { ...row.films, type: "" },
                }),
      };
    });
    let plan = Object.assign(
      window.createStagedPlacement(selected, peers, stages),
      {
        category,
        scopes,
        snapshots,
        group:
          category === "watched"
            ? ratingLabel(selected)
            : tier(selected) || "Untiered",
      },
    );
    if (category === "watched")
      plan.isLegalIndex = (index) =>
        !(
          peers[index - 1]?.ranking_group_id &&
          peers[index - 1].ranking_group_id === peers[index]?.ranking_group_id
        );
    return plan;
  };

  /**
   * Projects a ranking entry to the exact fields checked by atomic placement.
   * @param {Object} entry Stored entry.
   * @returns {Object} Canonical concurrency snapshot.
   */
  window.rankingPlacementEntrySnapshot = function (entry) {
    return {
      film_id: entry.film_id,
      position: entry.position,
      rank_confirmed: entry.rank_confirmed !== false,
      suppress_all_time_rank: Boolean(entry.suppress_all_time_rank),
      tie_group_id: entry.tie_group_id || null,
      tie_group_title: entry.tie_group_title || null,
    };
  };

  /**
   * Opens Watched or Rewatchlist placement using the shared accessible dialog.
   * @param {'watched'|'rewatchlist'} category Selected category.
   * @param {string} [initialId] Immediately selected film id.
   * @param {() => void} [onSaved] Refreshes hub metrics after saving.
   * @returns {void}
   */
  window.openRankingPlacement = function (
    category,
    initialId = "",
    onSaved = () => {},
  ) {
    let getItems = () => window.rankingPlacementItems(category);
    window.openStagedPlacement({
      items: getItems(),
      getItems,
      initialId,
      onSaved,
      focusFallback: "[data-ranking-placement-open]",
      labels: {
        dialog: `Place a ${category === "watched" ? "watched" : "rewatchlist"} film`,
        category: category.toUpperCase(),
        noun: "film",
        plural: "films",
        search: "Find a film",
        placeholder: "Title or year",
        picker:
          category === "watched"
            ? "Pick a watched film. Unranked means no saved release-year position. Placement stays within its exact rating."
            : "Pick a marked rewatch film. Placement stays within its exact interest tier, including Untiered.",
        firstPool:
          "Place it among ranked films in the same rating or interest tier.",
      },
      adapter: {
        readItem: (row) => ({
          id: row.film_id,
          title: row.films?.title || "Unknown film",
          metadata: `${row.films?.year || "Unknown year"} · ${category === "watched" ? ratingLabel(row) : tier(row) || "Untiered"}`,
          posterUrl: row.films?.poster_url || "",
          ranked:
            category === "rewatchlist"
              ? row.rewatch_position != null
              : Boolean(row.position),
        }),
        createPlan: (items, id) =>
          window.createRankingPlacement(category, items, id),
        groupLabel: (plan) => plan.group,
        save: (plan) => window.saveRankingPlacement(plan),
      },
    });
  };
})();
