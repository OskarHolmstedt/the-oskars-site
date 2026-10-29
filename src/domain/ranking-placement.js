/** @file Owns Watched and Rewatchlist adapters for the Rankings staged placement journey. */
(function () {
  let orderEntries = (entries) =>
    [...entries].sort((a, b) =>
      a.position < b.position
        ? -1
        : a.position > b.position
          ? 1
          : a.film_id.localeCompare(b.film_id),
    );
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
  let grade = (row) =>
    window.supabaseRankingRatingSortValueFromKey(rating(row));
  let positioned = (entry) => entry.position != null && entry.position !== "";

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

  // A single topological order preserves every saved scope's peer relationships,
  // including films missing from broader rankings. Contradictory scopes need review.
  function compatiblePeers(scopes, byId, selected) {
    let nodes = new Map();
    let edges = new Map();
    let incoming = new Map();
    for (let scope of scopes) {
      let entries = scope.entries.filter(
        (entry) =>
          entry.film_id !== selected.film_id &&
          byId.has(entry.film_id) &&
          rating(byId.get(entry.film_id)) === rating(selected),
      );
      for (let entry of entries) {
        nodes.set(entry.film_id, byId.get(entry.film_id));
        if (!edges.has(entry.film_id)) {
          edges.set(entry.film_id, new Set());
          incoming.set(entry.film_id, 0);
        }
      }
      for (let i = 1; i < entries.length; i++) {
        let from = entries[i - 1].film_id,
          to = entries[i].film_id;
        if (!edges.get(from).has(to)) {
          edges.get(from).add(to);
          incoming.set(to, incoming.get(to) + 1);
        }
      }
    }
    let queue = [...nodes.keys()].filter((id) => !incoming.get(id));
    let result = [];
    for (let i = 0; i < queue.length; i++) {
      let id = queue[i];
      result.push(nodes.get(id));
      for (let next of edges.get(id)) {
        incoming.set(next, incoming.get(next) - 1);
        if (!incoming.get(next)) queue.push(next);
      }
    }
    if (result.length !== nodes.size)
      throw new Error(
        "These period rankings disagree. Review consistency before placing this film.",
      );
    return result;
  }

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
      let byId = new Map(items.map((row) => [row.film_id, row]));
      scopes = scopes.map((scope) => {
        let stored = workspace.rankings.find(
          (row) => row.scope_type === scope.type && row.scope === scope.key,
        );
        let expected = (stored?.ranking_entries || [])
          .map(window.rankingPlacementEntrySnapshot)
          .sort((a, b) => a.film_id.localeCompare(b.film_id));
        let entries = orderEntries(expected.filter(positioned));
        if (entries.find((entry) => entry.film_id === id)?.tie_group_id)
          throw new Error(
            "This film belongs to a ranking tie. Review its tie before placing it individually.",
          );
        for (let i = 1; i < entries.length; i++) {
          if (
            entries[i - 1].position === entries[i].position ||
            (byId.has(entries[i - 1].film_id) &&
              byId.has(entries[i].film_id) &&
              grade(byId.get(entries[i - 1].film_id)) <
                grade(byId.get(entries[i].film_id)))
          )
            throw new Error(
              "This ranking needs review before placement: check duplicate positions and rating order.",
            );
        }
        return { ...scope, expected, entries, rankingId: stored?.id || null };
      });
      peers = compatiblePeers(scopes, byId, selected);
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
    if (category === "watched") {
      let indexes = new Map(peers.map((row, index) => [row.film_id, index]));
      let ranges = [];
      for (let scope of scopes) {
        let groups = new Map();
        for (let entry of scope.entries) {
          if (!entry.tie_group_id || !indexes.has(entry.film_id)) continue;
          let members = groups.get(entry.tie_group_id) || [];
          members.push(indexes.get(entry.film_id));
          groups.set(entry.tie_group_id, members);
        }
        for (let members of groups.values())
          if (members.length > 1)
            ranges.push([Math.min(...members), Math.max(...members)]);
      }
      plan.isLegalIndex = (index) =>
        !ranges.some(([start, end]) => index > start && index <= end);
    }
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
              : Boolean(
                  window
                    .getSupabaseWorkspace()
                    ?.rankings?.find(
                      (scope) =>
                        scope.scope_type === "years" &&
                        scope.scope === String(row.films?.year),
                    )
                    ?.ranking_entries?.some(
                      (entry) =>
                        entry.film_id === row.film_id && positioned(entry),
                    ),
                ),
        }),
        createPlan: (items, id) =>
          window.createRankingPlacement(category, items, id),
        groupLabel: (plan) => plan.group,
        save: (plan) => window.saveRankingPlacement(plan),
      },
    });
  };
})();
