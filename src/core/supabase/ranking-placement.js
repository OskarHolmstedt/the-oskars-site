/** @file Owns atomic staged placement writes and in-memory Rankings workspace updates. */
(function () {
  /**
   * Saves a completed watched or rewatch draft atomically and patches the current workspace.
   * @param {RankingPlacementPlan} plan Completed placement and reviewed snapshots.
   * @returns {Promise<void>} Resolves after persistence and cache invalidation.
   */
  window.saveRankingPlacement = async function (plan) {
    if (plan.stage !== plan.stages.length)
      throw new Error("Complete every pool before saving.");
    let context = window.supabaseWorkspaceContext;
    let isCurrent = context.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    context.assertCurrentWorkspaceMutation(isCurrent);
    let id = plan.item.film_id;
    let params;
    if (plan.category === "watched") {
      let aboveIds = new Set(
        plan.peers.slice(0, plan.index).map((row) => row.film_id),
      );
      let watchedById = new Map(
        (context.workspaceState?.watched || []).map((row) => [
          row.film_id,
          row,
        ]),
      );
      let value = (row) =>
        window.supabaseRankingRatingSortValueFromKey(
          window.supabaseRankingRatingKey(row),
        );
      params = {
        p_film_id: id,
        p_watched: plan.snapshots,
        p_scopes: plan.scopes.map((scope) => {
          let entries = scope.entries.filter((entry) => entry.film_id !== id);
          let index = entries.findIndex((entry) => {
            let row = watchedById.get(entry.film_id);
            return (
              value(row) < value(plan.item) ||
              (value(row) === value(plan.item) && !aboveIds.has(entry.film_id))
            );
          });
          if (index < 0) index = entries.length;
          return {
            scope_type: scope.type,
            scope: scope.key,
            expected: scope.expected,
            position: window.fractionalPositionBetween(
              entries[index - 1]?.position || null,
              entries[index]?.position || null,
            ),
          };
        }),
      };
    } else {
      let order = plan.peers.map((row) => row.id);
      order.splice(plan.index, 0, plan.item.id);
      params = { p_film_id: id, p_expected: plan.snapshots, p_order: order };
    }
    let { data, error } = await ready.client.rpc(
      plan.category === "watched" ? "place_watched_film" : "place_rewatch_film",
      params,
    );
    if (error) throw error;
    context.assertCurrentWorkspaceMutation(isCurrent);
    let workspace = context.workspaceState;
    if (plan.category === "watched") {
      for (let row of data || []) {
        let ranking = workspace.rankings.find(
          (scope) =>
            scope.scope_type === row.scope_type && scope.scope === row.scope,
        );
        if (!ranking) {
          ranking = {
            id: row.ranking_id,
            scope_type: row.scope_type,
            scope: row.scope,
            ranking_entries: [],
          };
          workspace.rankings.push(ranking);
        }
        let entry = ranking.ranking_entries.find(
          (entry) => entry.film_id === id,
        );
        if (!entry) {
          entry = { film_id: id };
          ranking.ranking_entries.push(entry);
        }
        Object.assign(entry, {
          ranking_id: row.ranking_id,
          position: row.position,
          rank_confirmed: true,
          suppress_all_time_rank: false,
        });
        ranking.ranking_entries.sort((a, b) =>
          a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
        );
      }
    } else {
      let rawById = new Map(workspace.watched.map((row) => [row.id, row]));
      let filmsById = new Map(
        Object.values(window.state?.filmsById || {}).map((film) => [
          film.supabaseFilmId,
          film,
        ]),
      );
      for (let row of data || []) {
        let raw = rawById.get(row.id);
        if (raw)
          Object.assign(raw, {
            rewatch_position: row.rewatch_position,
            updated_at: row.updated_at,
          });
        let film = filmsById.get(row.film_id);
        if (film)
          Object.assign(film, {
            rewatchPosition: row.rewatch_position,
            supabaseWatchedUpdatedAt: row.updated_at,
          });
      }
    }
    window.invalidateCachedSupabaseHydrationSource?.();
  };
})();
