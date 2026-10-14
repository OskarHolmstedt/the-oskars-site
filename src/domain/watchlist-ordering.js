/** @file Owns account-scoped confirmed watchlist shelves and constructed groups over the single global order. */

(function () {
  let savedGroups = [];
  let ownerId = null;

  function currentGroups() {
    return ownerId === window.getSupabaseCurrentUser?.()?.id ? savedGroups : [];
  }

  /**
   * Loads persisted ordering progress for the active account.
   * @returns {Promise<void>}
   */
  window.loadWatchlistOrdering = async function () {
    let userId = window.getSupabaseCurrentUser?.()?.id;
    let data = await window.loadSupabaseWatchlistOrderGroups();
    if (userId !== window.getSupabaseCurrentUser?.()?.id)
      throw new Error("Account changed while loading watchlist ordering.");
    ownerId = userId;
    savedGroups = data || [];
  };

  /**
   * Returns the year shelf key, with 0 reserved for unknown release years.
   * @param {Object} row
   * @returns {number}
   */
  window.watchlistOrderYear = function (row) {
    return Number.isInteger(row.films?.year) ? row.films.year : 0;
  };

  function scope(tier, years, tierRows) {
    let selected = new Set(years);
    return (tierRows || window.supabaseWatchlistTierItemsInOrder(tier)).filter(
      (row) => selected.has(window.watchlistOrderYear(row)),
    );
  }

  function matches(group, tierRows) {
    let rows = scope(group.tier, group.years, tierRows);
    return (
      rows.length === group.film_ids.length &&
      rows.every(
        (row, index) => row.position && row.film_id === group.film_ids[index],
      )
    );
  }

  function shelvesForRows(tier, rows) {
    let byYear = new Map();
    for (let row of rows) {
      let year = window.watchlistOrderYear(row);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(row);
    }
    let confirmedYears = new Set(
      currentGroups()
        .filter((group) => group.tier === tier && matches(group, rows))
        .flatMap((group) => group.years),
    );
    return [...byYear.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, items]) => ({
        year,
        items,
        confirmed: items.length === 1 || confirmedYears.has(year),
      }));
  }

  /**
   * Describes pending and confirmed year shelves for an exact tier.
   * @param {string} tier
   * @returns {Object[]}
   */
  window.watchlistOrderingShelves = function (tier) {
    return shelvesForRows(tier, window.supabaseWatchlistTierItemsInOrder(tier));
  };

  /**
   * Returns disjoint confirmed groups, falling back to confirmed atomic years when a composite changes.
   * @param {string} tier
   * @returns {Object[]}
   */
  window.watchlistOrderingBlocks = function (tier) {
    let covered = new Set();
    let blocks = [];
    let tierRows = window.supabaseWatchlistTierItemsInOrder(tier);
    let composites = currentGroups()
      .filter(
        (group) =>
          group.tier === tier &&
          group.kind === "merge" &&
          matches(group, tierRows),
      )
      .sort((a, b) => b.years.length - a.years.length);
    for (let group of composites) {
      if (group.years.some((year) => covered.has(year))) continue;
      group.years.forEach((year) => covered.add(year));
      blocks.push({ years: group.years });
    }
    for (let shelf of shelvesForRows(tier, tierRows)) {
      if (shelf.confirmed && !covered.has(shelf.year)) {
        blocks.push({ years: [shelf.year] });
      }
    }
    return blocks
      .map(({ years }) => ({
        id: years.join(","),
        years,
        label: years.includes(0)
          ? years.map((year) => year || "Unknown year").join(", ")
          : window.formatShelfMergeBlockLabel(years),
        count: scope(tier, years, tierRows).length,
        isSingle: years.length === 1,
      }))
      .sort((a, b) => Math.min(...a.years) - Math.min(...b.years));
  };

  /**
   * Splits constructed groups back to confirmed years without changing global positions.
   * @param {string} tier
   * @param {string} [blockId] One composite's year key, or every composite when omitted.
   * @returns {Promise<void>}
   */
  window.splitWatchlistOrderingGroups = async function (tier, blockId) {
    let targets = currentGroups().filter(
      (group) =>
        group.tier === tier &&
        group.kind === "merge" &&
        (!blockId || group.years.join(",") === blockId),
    );
    if (!targets.length) return;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let { error } = await ready.client
      .from("watchlist_order_groups")
      .delete()
      .eq("user_id", ownerId)
      .in(
        "id",
        targets.map((group) => group.id),
      );
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    await window.loadWatchlistOrdering();
  };

  /**
   * Atomically saves a confirmed year shelf or a merge of two reviewed groups.
   * @param {string} tier
   * @param {number[]} years
   * @param {Object[]} rows Rows in the reviewed order, including their original versions.
   * @param {number[][]} [inputs] The two merged groups' year sets.
   * @returns {Promise<void>}
   */
  window.saveWatchlistOrdering = async function (tier, years, rows, inputs) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let tierRows = window.supabaseWatchlistTierItemsInOrder(tier);
    let selected = new Set(rows.map((row) => row.film_id));
    let slots = tierRows
      .filter((row) => selected.has(row.film_id))
      .map((row) => row.position);
    if (
      slots.some((position) => !position) ||
      new Set(slots).size !== rows.length
    ) {
      // Allocate beyond existing keys; never move or collide with an unrelated film.
      let last =
        tierRows
          .map((row) => row.position)
          .filter(Boolean)
          .sort()
          .at(-1) || null;
      slots = rows.map(() => {
        last = window.fractionalPositionBetween(last, null);
        return last;
      });
    }
    let entries = rows.map((row, index) => ({
      film_id: row.film_id,
      updated_at: row.updated_at,
      position: slots[index],
    }));
    let { error } = await ready.client.rpc("save_watchlist_order", {
      p_tier: tier,
      p_years: years,
      p_entries: entries,
      p_inputs: inputs || null,
    });
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    window.invalidateCachedSupabaseHydrationSource?.();
    await window.loadSupabaseWorkspace({ parts: ["watchlist"], force: true });
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    await window.loadWatchlistOrdering();
  };
})();
