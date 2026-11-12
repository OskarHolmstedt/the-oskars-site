/** @file Owns account-scoped confirmed watched shelves and constructed groups over the exact-rating order. */

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
  window.loadWatchedOrdering = async function () {
    let userId = window.getSupabaseCurrentUser?.()?.id;
    let data = await window.loadSupabaseWatchedOrderGroups();
    if (userId !== window.getSupabaseCurrentUser?.()?.id)
      throw new Error("Account changed while loading watched ordering.");
    ownerId = userId;
    savedGroups = data || [];
  };

  /**
   * Returns the year shelf key, with 0 reserved for unknown release years.
   * @param {Object} row
   * @returns {number}
   */
  window.watchedOrderYear = function (row) {
    return Number.isInteger(row.films?.year) ? row.films.year : 0;
  };

  function scope(tier, years, tierRows) {
    let selected = new Set(years);
    return (tierRows || window.supabaseWatchedRatingItemsInOrder(tier)).filter(
      (row) => selected.has(window.watchedOrderYear(row)),
    );
  }

  function matches(group, tierRows) {
    let rows = scope(group.rating_key, group.years, tierRows);
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
      let year = window.watchedOrderYear(row);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(row);
    }
    let confirmedYears = new Set(
      currentGroups()
        .filter((group) => group.rating_key === tier && matches(group, rows))
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
  window.watchedOrderingShelves = function (tier) {
    return shelvesForRows(tier, window.supabaseWatchedRatingItemsInOrder(tier));
  };

  /**
   * Returns disjoint confirmed groups, falling back to confirmed atomic years when a composite changes.
   * @param {string} tier
   * @returns {Object[]}
   */
  window.watchedOrderingBlocks = function (tier) {
    let covered = new Set();
    let blocks = [];
    let tierRows = window.supabaseWatchedRatingItemsInOrder(tier);
    let composites = currentGroups()
      .filter(
        (group) =>
          group.rating_key === tier &&
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
        tierRows.map((r) => window.watchedOrderYear(r)).filter((y) => y > 0),
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
  window.splitWatchedOrderingGroups = async function (tier, blockId) {
    let targets = currentGroups().filter(
      (group) =>
        group.rating_key === tier &&
        group.kind === "merge" &&
        (!blockId || group.years.join(",") === blockId),
    );
    if (!targets.length) return;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let { error } = await ready.client
      .from("watched_order_groups")
      .delete()
      .eq("user_id", ownerId)
      .in(
        "id",
        targets.map((group) => group.id),
      );
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    await window.loadWatchedOrdering();
  };
})();
