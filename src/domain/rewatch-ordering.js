/** @file Owns account-scoped confirmed rewatchlist shelves and constructed groups over private rewatch positions. */

(function () {
  let savedGroups = [];
  let ownerId = null;

  function currentGroups() {
    return ownerId === window.getSupabaseCurrentUser?.()?.id ? savedGroups : [];
  }

  /**
   * Loads persisted rewatch ordering progress for the active account.
   * @returns {Promise<void>}
   */
  window.loadRewatchOrdering = async function () {
    let userId = window.getSupabaseCurrentUser?.()?.id;
    let data = await window.loadSupabaseRewatchOrderGroups();
    if (userId !== window.getSupabaseCurrentUser?.()?.id)
      throw new Error("Account changed while loading rewatch ordering.");
    ownerId = userId;
    savedGroups = data || [];
  };

  /**
   * Returns the year shelf key, with 0 reserved for unknown release years.
   * @param {Object} row
   * @returns {number}
   */
  window.rewatchOrderYear = function (row) {
    return Number.isInteger(row.films?.year) ? row.films.year : 0;
  };

  function scope(tier, years, tierRows) {
    let selected = new Set(years);
    return (tierRows || window.supabaseRewatchTierItemsInOrder(tier)).filter(
      (row) => selected.has(window.rewatchOrderYear(row)),
    );
  }

  function matches(group, tierRows) {
    let rows = scope(group.tier, group.years, tierRows);
    return (
      rows.length === group.film_ids.length &&
      rows.every(
        (row, index) =>
          row.rewatch_position != null &&
          row.rewatch_position !== "" &&
          row.film_id === group.film_ids[index],
      )
    );
  }

  function shelvesForRows(tier, rows) {
    let byYear = new Map();
    for (let row of rows) {
      let year = window.rewatchOrderYear(row);
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
   * Describes pending and confirmed year shelves for an exact rewatch tier.
   * @param {string} tier
   * @returns {Object[]}
   */
  window.rewatchOrderingShelves = function (tier) {
    return shelvesForRows(tier, window.supabaseRewatchTierItemsInOrder(tier));
  };

  /**
   * Returns disjoint confirmed groups, falling back to confirmed atomic years when a composite changes.
   * @param {string} tier
   * @returns {Object[]}
   */
  window.rewatchOrderingBlocks = function (tier) {
    let covered = new Set();
    let blocks = [];
    let tierRows = window.supabaseRewatchTierItemsInOrder(tier);
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
    let populatedYears = [
      ...new Set(
        tierRows.map((r) => window.rewatchOrderYear(r)).filter((y) => y > 0),
      ),
    ];
    let decadePopulatedYears = new Map();
    for (let y of populatedYears) {
      let dec = window.getDecadeKey
        ? window.getDecadeKey(y)
        : `${Math.floor(y / 10) * 10}s`;
      if (!decadePopulatedYears.has(dec))
        decadePopulatedYears.set(dec, new Set());
      decadePopulatedYears.get(dec).add(y);
    }
    return blocks
      .map(({ years }) => {
        let blockDecades = new Set(
          years
            .filter((y) => y > 0)
            .map((y) =>
              window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`,
            ),
        );
        let completeDecades = [];
        for (let dec of blockDecades) {
          let allYearsInDecade = decadePopulatedYears.get(dec);
          if (
            allYearsInDecade &&
            allYearsInDecade.size > 0 &&
            [...allYearsInDecade].every((y) => years.includes(y))
          ) {
            completeDecades.push(dec);
          }
        }
        return {
          id: years.join(","),
          years,
          label: years.includes(0)
            ? years.map((year) => year || "Unknown year").join(", ")
            : window.formatShelfMergeBlockLabel(years, { completeDecades }),
          count: scope(tier, years, tierRows).length,
          isSingle: years.length === 1,
          decades: [...blockDecades],
          completeDecades,
          isDecadeComplete: completeDecades.length > 0,
        };
      })
      .sort((a, b) => Math.min(...a.years) - Math.min(...b.years));
  };

  /**
   * Splits constructed groups back to confirmed years without changing global positions.
   * @param {string} tier
   * @param {string} [blockId] One composite's year key, or every composite when omitted.
   * @returns {Promise<void>}
   */
  window.splitRewatchOrderingGroups = async function (tier, blockId) {
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
      .from("rewatch_order_groups")
      .delete()
      .eq("user_id", ownerId)
      .in(
        "id",
        targets.map((group) => group.id),
      );
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    await window.loadRewatchOrdering();
  };

  /**
   * Atomically saves a confirmed year shelf or a merge of two reviewed groups for rewatchlist.
   * @param {string} tier
   * @param {number[]} years
   * @param {Object[]} rows Rows in the reviewed order, including their original versions.
   * @param {number[][]} [inputs] The two merged groups' year sets.
   * @returns {Promise<void>}
   */
  window.saveRewatchOrdering = async function (tier, years, rows, inputs) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let tierRows = window.supabaseRewatchTierItemsInOrder(tier);
    let selected = new Set(rows.map((row) => row.film_id));
    let unrelatedPositions = new Set(
      tierRows
        .filter((row) => !selected.has(row.film_id))
        .map((row) => row.rewatch_position)
        .filter((pos) => pos != null && pos > 0),
    );
    let selectedTierRows = tierRows.filter((row) => selected.has(row.film_id));
    let slots = selectedTierRows
      .map((row) => row.rewatch_position)
      .filter((pos) => pos != null && pos > 0);
    let allDistinct = new Set(slots).size === rows.length;
    if (
      !allDistinct ||
      slots.length !== rows.length ||
      slots.some((pos) => unrelatedPositions.has(pos))
    ) {
      let existingPositions = new Set(
        tierRows.map((r) => r.rewatch_position).filter(Boolean),
      );
      let maxPos = Math.max(0, ...existingPositions);
      slots = rows.map((_, i) => maxPos + i + 1);
    } else {
      slots.sort((a, b) => a - b);
    }
    let entries = rows.map((row, index) => ({
      film_id: row.film_id,
      updated_at: row.updated_at,
      position: slots[index],
    }));
    let { error } = await ready.client.rpc("save_rewatch_order", {
      p_tier: tier,
      p_years: years,
      p_entries: entries,
      p_inputs: inputs || null,
    });
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    window.invalidateCachedSupabaseHydrationSource?.();
    await window.loadSupabaseWorkspace({ parts: ["watched"], force: true });
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    await window.loadRewatchOrdering();
  };
})();
