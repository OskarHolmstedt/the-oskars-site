/** @file Owns targeted watchlist membership, tier changes, and shelf ordering. */

(function () {
  /**
   * Reads every confirmed watchlist shelf and merge group for the active owner.
   * @returns {Promise<Object[]>}
   */
  window.loadSupabaseWatchlistOrderGroups = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let ownerId = window.getSupabaseCurrentUser?.()?.id;
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let groups = [];
    for (let offset = 0; ; offset += 500) {
      let { data, error } = await ready.client
        .from("watchlist_order_groups")
        .select("id,tier,kind,years,film_ids")
        .eq("user_id", ownerId)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      groups.push(...(data || []));
      if ((data || []).length < 500) return groups;
    }
  };

  /**
   * Adds a film (already in the shared catalog) to the signed-in user's
   * watchlist, straight through to Supabase, then updates the in-memory
   * cache. `position` uses a simple monotonic base-36 timestamp string so
   * new adds sort to the end - no fractional-index reordering scheme is
   * implemented here.
   * @param {string} filmId Shared catalog film id.
   * @param {{tier?: string, tierModifier?: string, reason?: string, position?: string}} [options]
   * @returns {Promise<Object>} The new, cache-shaped watchlist row.
   */
  window.addToSupabaseWatchlist = async function (filmId, options = {}) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let { data, error } = await ready.client
      .from("watchlist")
      .insert({
        film_id: filmId,
        tier: options.tier || null,
        tier_modifier: options.tierModifier || null,
        reason: options.reason || null,
        position: options.position || Date.now().toString(36),
      })
      .select(window.supabaseWorkspaceContext.WATCHLIST_SELECT)
      .single();
    if (error) throw error;

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState)
      window.supabaseWorkspaceContext.workspaceState.watchlist.push(data);
    return data;
  };

  /**
   * Adds a catalog-resolved film to the watchlist without reconciling the archive.
   * @param {Object} record Film identity and initial watchlist fields.
   * @returns {Promise<Object>} Inserted watchlist row with its catalog identity.
   */
  window.addSupabaseWatchlistRecord = async function (record) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    await window.ensureCatalogIdentity?.();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let filmId = record.supabaseFilmId || null;
    if (!filmId) {
      let resolved = await window.resolveSupabaseCatalogFilm(
        ready.client,
        record,
        {
          p_poster_url: record.poster?.url || null,
          p_country: record.country || null,
          p_primary_country: record.primaryCountry || null,
          p_runtime_minutes: Number(record.runtimeMinutes) || null,
          p_medium: record.medium || null,
          p_type: record.type || null,
          p_swedish_title: record.swedishTitle || null,
          p_genre: record.genre || null,
          p_screenplay_type: ["original", "adapted"].includes(
            record.screenplayType,
          )
            ? record.screenplayType
            : null,
          p_adaptation_source: record.adaptationSource || null,
          p_letterboxd_url: record.letterboxdUrl || null,
        },
      );
      filmId = resolved.filmId;
    }
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (!filmId)
      throw new Error("No catalog or TMDB match was found for this film.");
    let row = await window.addToSupabaseWatchlist(filmId, {
      tier: record.tier,
      tierModifier: record.tierModifier,
      reason: record.reason,
    });
    try {
      for (let tag of record.tags || []) {
        window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(
          isCurrent,
        );
        await window.addSupabaseFilmTag(filmId, tag);
      }
    } catch (err) {
      if (isCurrent()) {
        try {
          await window.removeFromSupabaseWatchlist(row.id);
        } catch (cleanupError) {
          err.message += " " + cleanupError.message;
        }
      }
      throw err;
    }
    window.invalidateCachedSupabaseHydrationSource?.();
    return row;
  };

  /**
   * Removes one row from the signed-in user's watchlist, straight through
   * to Supabase, then updates the in-memory cache.
   * @param {string} watchlistId The watchlist row's id (from a cached entry).
   */
  window.removeFromSupabaseWatchlist = async function (watchlistId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let { error } = await ready.client
      .from("watchlist")
      .delete()
      .eq("id", watchlistId);
    if (error) throw error;

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState) {
      window.supabaseWorkspaceContext.workspaceState.watchlist =
        window.supabaseWorkspaceContext.workspaceState.watchlist.filter(
          (row) => row.id !== watchlistId,
        );
    }
  };

  /**
   * Applies a complete reviewed watchlist tier merge order while preserving fractional shelf positions.
   * @param {string} tier
   * @param {string[]} orderedFilmIds Film ids in the desired final relative order.
   * @returns {Promise<{ok: boolean, changed?: number, reason?: string}>}
   */
  window.applySupabaseWatchlistTierMergeOrder = async function (
    tier,
    orderedFilmIds,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let ids = (orderedFilmIds || []).map(String).filter(Boolean);
    let idSet = new Set(ids);
    if (idSet.size < 2 || idSet.size !== ids.length)
      return {
        ok: false,
        reason: "Choose at least two distinct watchlist films to merge.",
      };

    let tierItems = window.supabaseWatchlistTierItemsInOrder(tier);
    let byFilmId = new Map(tierItems.map((row) => [row.film_id, row]));
    let mergedRows = ids.map((filmId) => byFilmId.get(filmId)).filter(Boolean);
    let slotPositions = tierItems
      .filter((row) => idSet.has(row.film_id))
      .map((row) => row.position);

    if (mergedRows.length !== ids.length || slotPositions.length !== ids.length)
      return {
        ok: false,
        reason: "Some selected films are no longer in this tier.",
      };

    if (slotPositions.some((pos) => !pos)) {
      let firstMergedIndex = tierItems.findIndex((row) =>
        idSet.has(row.film_id),
      );
      let beforePos = null;
      for (let i = firstMergedIndex - 1; i >= 0; i--) {
        if (tierItems[i].position) {
          beforePos = tierItems[i].position;
          break;
        }
      }
      let lastMergedIndex = -1;
      for (let i = tierItems.length - 1; i >= 0; i--) {
        if (idSet.has(tierItems[i].film_id)) {
          lastMergedIndex = i;
          break;
        }
      }
      let afterPos = null;
      for (let i = lastMergedIndex + 1; i < tierItems.length; i++) {
        if (tierItems[i].position) {
          afterPos = tierItems[i].position;
          break;
        }
      }
      let generated = [];
      let cur = beforePos;
      for (let i = 0; i < mergedRows.length; i++) {
        let nextPos = window.fractionalPositionBetween(cur, afterPos);
        generated.push(nextPos);
        cur = nextPos;
      }
      slotPositions = generated;
    }

    let updates = mergedRows
      .map((row, index) => ({ row, newPosition: slotPositions[index] }))
      .filter(({ row, newPosition }) => row.position !== newPosition);

    let results = await Promise.all(
      updates.map(({ row, newPosition }) =>
        ready.client
          .from("watchlist")
          .update({
            position: newPosition,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id),
      ),
    );
    let failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    updates.forEach(({ row, newPosition }) => {
      row.position = newPosition;
    });

    return { ok: true, changed: updates.length };
  };

  /**
   * Updates a watchlist item's interest tier (and its optional minus/plus
   * refinement, default null/unmodified) straight through to Supabase.
   * @param {string} watchlistId
   * @param {string} tier
   * @param {'minus'|'plus'|''} [modifier]
   * @returns {Promise<Object|null>} The updated, cache-shaped watchlist row.
   */
  window.setSupabaseWatchlistTier = async function (
    watchlistId,
    tier,
    modifier,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let cached =
      window.supabaseWorkspaceContext.workspaceState?.watchlist?.find(
        (row) => row.id === watchlistId,
      );
    let staleUpdatedAt = cached?.updated_at;

    let query = ready.client
      .from("watchlist")
      .update({
        tier: tier || null,
        tier_modifier: modifier || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", watchlistId);

    if (staleUpdatedAt) {
      query = query.eq("updated_at", staleUpdatedAt);
    }

    let { data, error } = await query
      .select(window.supabaseWorkspaceContext.WATCHLIST_SELECT)
      .maybeSingle();
    if (error) throw error;

    if (staleUpdatedAt && !data) {
      throw Object.assign(
        new Error(
          "Watchlist item was modified in another session. Refreshing before retrying.",
        ),
        { code: "OSKARS_STALE_WRITE" },
      );
    }

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState && data) {
      let idx =
        window.supabaseWorkspaceContext.workspaceState.watchlist.findIndex(
          (row) => row.id === watchlistId,
        );
      if (idx >= 0)
        window.supabaseWorkspaceContext.workspaceState.watchlist[idx] = data;
    }
    return data;
  };

  /**
   * Bulk-assigns an interest tier to selected watchlist items in bounded
   * requests, applying the selected exact tier and modifier to each item.
   * @param {string[]} watchlistIds
   * @param {string} tier
   */
  window.setSupabaseWatchlistTierForItems = async function (
    watchlistIds,
    tier,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let ids = (watchlistIds || []).filter(Boolean);
    if (!ids.length) return;
    let parsed = window.parseWatchlistTier(tier);
    let updatedAt = new Date().toISOString();
    await window.supabaseWorkspaceContext.selectInChunks(ids, (chunk) =>
      ready.client
        .from("watchlist")
        .update({
          tier: parsed.tier || null,
          tier_modifier: parsed.modifier || null,
          updated_at: updatedAt,
        })
        .in("id", chunk),
    );
  };

  /**
   * Moves one watchlist item to an arbitrary position within its own
   * interest tier, using fractionalPositionBetween() -
   * matching moveSupabaseRankingEntryToPosition()'s established pattern,
   * since watchlist.position is the same kind of fractional/lexicographic
   * sort key. Both films must already share a tier; the caller (matching
   * the previous moveWatchlistItemWithinTier()'s own contract) is
   * responsible for that check.
   * @param {string} fromWatchlistId
   * @param {Object[]} tierItems Items that include both neighbours: raw watchlist rows (`position`) or WatchlistItems (`supabaseWatchlistPosition`).
   * @param {string|null} beforeWatchlistId Neighbor to sort after, or null for the very start.
   * @param {string|null} afterWatchlistId Neighbor to sort before, or null for the very end.
   * @returns {Promise<string>} The item's new position value.
   */
  window.moveSupabaseWatchlistItemWithinTier = async function (
    fromWatchlistId,
    tierItems,
    beforeWatchlistId,
    afterWatchlistId,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let positionOf = (id) => {
      let item = id ? tierItems.find((candidate) => candidate.id === id) : null;
      return item ? (item.position ?? item.supabaseWatchlistPosition) : null;
    };
    let beforePosition = positionOf(beforeWatchlistId);
    let afterPosition = positionOf(afterWatchlistId);
    let newPosition = window.fractionalPositionBetween(
      beforePosition,
      afterPosition,
    );
    let { error } = await ready.client
      .from("watchlist")
      .update({ position: newPosition, updated_at: new Date().toISOString() })
      .eq("id", fromWatchlistId);
    if (error) throw error;
    return newPosition;
  };

  /**
   * Moves one watchlist row between neighbours in its complete exact-tier shelf.
   * @param {string} fromId Moved watchlist row id.
   * @param {string} toId Target watchlist row id.
   * @param {'before'|'after'} position Relative placement.
   * @returns {Promise<Object>} Validated move outcome.
   */
  window.moveSupabasePeriodWatchlistItem = async function (
    fromId,
    toId,
    position,
  ) {
    let items = window.state.watchlist || [];
    let from = items.find((item) => item.id === fromId);
    let target = items.find((item) => item.id === toId);
    if (!from || !target || fromId === toId)
      return { ok: false, reason: "Choose two different watchlist films." };
    let grade = (item) =>
      window.watchlistTierGrade(item.tier, item.tierModifier);
    if (grade(from) !== grade(target))
      return {
        ok: false,
        reason:
          "Watchlist ordering moves are limited to the same interest tier.",
      };
    let shelf = items
      .filter((item) => grade(item) === grade(from))
      .sort(
        (a, b) => Number(a.order || Infinity) - Number(b.order || Infinity),
      );
    let remaining = shelf.filter((item) => item.id !== fromId);
    let index = remaining.findIndex((item) => item.id === toId);
    let beforeId =
      position === "after" ? toId : remaining[index - 1]?.id || null;
    let afterId =
      position === "after" ? remaining[index + 1]?.id || null : toId;
    await window.moveSupabaseWatchlistItemWithinTier(
      fromId,
      shelf,
      beforeId,
      afterId,
    );
    window.invalidateCachedSupabaseHydrationSource?.();
    return { ok: true };
  };

  /**
   * Sets the specified watchlist rows' tiers and optionally restores their saved positions.
   * @param {Object[]} rows Explicit row ids, tier/modifier pairs, versions, and optional positions.
   * @returns {Promise<void>} Resolves after the selected rows are saved.
   */
  window.setSupabaseWatchlistTierRows = async function (rows) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    for (let row of rows) {
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      if (!row.id || !row.updatedAt)
        throw new Error("Refresh the watchlist before editing it.");
      let payload = {
        tier: row.tier || null,
        tier_modifier: row.tierModifier || null,
        updated_at: new Date().toISOString(),
      };
      if (Object.hasOwn(row, "position"))
        payload.position = row.position || null;
      let query = ready.client
        .from("watchlist")
        .update(payload)
        .eq("id", row.id);
      query = query.eq("updated_at", row.updatedAt);
      let { data, error } = await query.select("id,updated_at").maybeSingle();
      if (error) throw error;
      if (!data)
        throw Object.assign(
          new Error(
            "Watchlist item changed elsewhere. Refresh before continuing.",
          ),
          { code: "OSKARS_STALE_WRITE" },
        );
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      row.updatedAt = data.updated_at;
    }
    window.invalidateCachedSupabaseHydrationSource?.();
  };
})();
