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
      let order = plan.peers.map((row) => row.film_id);
      order.splice(plan.index, 0, id);
      params = {
        p_film_id: id,
        p_expected: plan.snapshots,
        p_order: order,
        p_position: window.fractionalPositionBetween(
          plan.peers[plan.index - 1]?.position || null,
          plan.peers[plan.index]?.position || null,
        ),
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
      await window.loadSupabaseWorkspace({ parts: ["watched"], force: true });
      context.assertCurrentWorkspaceMutation(isCurrent);
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
