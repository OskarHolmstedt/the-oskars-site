/**
 * @file Derives watched-film completion, project sources, and watchlist plans for canonical curated lists (IMDb Top 250, Letterboxd Top 250, Sight & Sound, TIME 100).
 */

(function () {
  /**
   * Retrieves a canonical list definition by its stable ID.
   * @param {string} listId List identifier.
   * @returns {CanonicalListDefinition|null} List definition.
   */
  window.canonicalListById = function (listId) {
    let lists = window.CANONICAL_LISTS || [];
    return lists.find((list) => list.id === listId) || null;
  };

  function watchedRecords(stateRef) {
    let records = [];
    Object.values(stateRef?.years || {}).forEach((period) => {
      (period.films || []).forEach((film) => {
        if (film?.id && film.title) records.push(film);
      });
    });
    (stateRef?.watchedOther || []).forEach((film) => {
      if (film?.id && film.title) records.push(film);
    });
    return records;
  }

  function recordsByTitle(records) {
    let byTitle = new Map();
    (records || []).forEach((record) => {
      let key = window.normalizeTitle(record.title);
      if (!key) return;
      let list = byTitle.get(key);
      if (!list) {
        list = [];
        byTitle.set(key, list);
      }
      list.push(record);
    });
    return byTitle;
  }

  function matchCandidate(candidates, year, tmdbId) {
    if (!candidates || !candidates.length) return null;
    if (tmdbId) {
      let tmdbMatch = candidates.find(
        (film) => String(film.tmdbId || "") === String(tmdbId),
      );
      if (tmdbMatch) return tmdbMatch;
    }
    let targetYear = Number(year);
    if (!Number.isFinite(targetYear)) return candidates[0] || null;
    let exact = candidates.find((film) => Number(film.year) === targetYear);
    if (exact) return exact;
    // Tolerance of 1 year for festival premiere vs theatrical release variance
    return (
      candidates.find(
        (film) => Math.abs(Number(film.year) - targetYear) <= 1,
      ) || null
    );
  }

  /**
   * Calculates watched and watchlist completion for one canonical curated list.
   * @param {string} listId Canonical list identifier.
   * @param {Object} [options] Computation options.
   * @param {Object} [options.state] Explicit state to read instead of window.state.
   * @returns {CanonicalListCompletion|null} Computed completion model.
   */
  window.canonicalListCompletion = function (listId, options = {}) {
    let definition = window.canonicalListById(listId);
    if (!definition) return null;
    let stateRef = options.state || window.state || {};
    let watched = watchedRecords(stateRef);
    let watchedByTitle = recordsByTitle(watched);
    let watchlistByTitle = recordsByTitle(stateRef.watchlist || []);

    let resolvedItems = (definition.items || []).map((item) => {
      let titleKey = window.normalizeTitle(item.title);
      let watchedMatch = matchCandidate(
        watchedByTitle.get(titleKey),
        item.year,
        item.tmdbId,
      );
      let watchlistMatch = watchedMatch
        ? null
        : matchCandidate(
            watchlistByTitle.get(titleKey),
            item.year,
            item.tmdbId,
          );

      let isWatched = Boolean(watchedMatch);
      let href = "";
      if (watchedMatch) {
        href = window.filmPageUrl(watchedMatch.id);
      } else if (watchlistMatch) {
        href = window.filmPageUrl(
          watchlistMatch.supabaseFilmId || watchlistMatch.id,
        );
      }

      return {
        rank: item.rank,
        title: item.title,
        year: String(item.year || ""),
        director: item.director || "",
        tmdbId: item.tmdbId || "",
        watched: isWatched,
        watchedFilm: watchedMatch || null,
        watchlistItem: watchlistMatch || null,
        href,
      };
    });

    let watchedItems = resolvedItems.filter((item) => item.watched);
    let unseenItems = resolvedItems.filter((item) => !item.watched);
    let watchlistCount = unseenItems.filter(
      (item) => item.watchlistItem,
    ).length;
    let total = resolvedItems.length;
    let watchedCount = watchedItems.length;
    let percent = total ? Math.round((watchedCount / total) * 100) : 0;

    // Next item: first unseen item on watchlist, or simply lowest rank unseen
    let nextItem =
      unseenItems.find((item) => item.watchlistItem) || unseenItems[0] || null;

    return {
      id: definition.id,
      name: definition.name,
      description: definition.description || "",
      sourceUrl: definition.sourceUrl || "",
      snapshotDate: definition.snapshotDate || "",
      total,
      watchedCount,
      watchlistCount,
      unseenCount: total - watchedCount,
      percent,
      items: resolvedItems,
      unseen: unseenItems,
      watched: watchedItems,
      nextItem,
    };
  };

  /**
   * Calculates completion models for all registered canonical lists.
   * @param {Object} [options] Computation options.
   * @param {Object} [options.state] Explicit state to read.
   * @returns {Map<string, CanonicalListCompletion>} Map of listId to completion model.
   */
  window.allCanonicalListsCompletion = function (options = {}) {
    let lists = window.CANONICAL_LISTS || [];
    let map = new Map();
    lists.forEach((list) => {
      let model = window.canonicalListCompletion(list.id, options);
      if (model) map.set(list.id, model);
    });
    return map;
  };

  /**
   * Resolves a canonical list into a project source with film references.
   * @param {string} listId Canonical list identifier.
   * @param {CanonicalListCompletion} [completion] Pre-computed completion model.
   * @returns {Object|null} Project source record.
   */
  window.canonicalListProjectSource = function (listId, completion) {
    let model = completion || window.canonicalListCompletion(listId);
    if (!model) return null;

    let filmRefs = model.items.map((item) => {
      if (item.watchedFilm) {
        return window.projectFilmRef("archive", item.watchedFilm.id, {
          rank: item.rank,
        });
      }
      if (item.watchlistItem) {
        return window.projectFilmRef(
          "watchlist",
          item.watchlistItem.id || window.watchlistItemId(item.watchlistItem),
          {
            rank: item.rank,
          },
        );
      }
      return window.projectFilmRef("canonical", `${listId}::${item.rank}`, {
        rank: item.rank,
        title: item.title,
        year: item.year,
        director: item.director,
        tmdbId: item.tmdbId,
      });
    });

    return {
      name: model.name,
      sourceLabel: `${model.name} · ${model.watchedCount}/${model.total} watched`,
      sourceHref: `completion.html#completion-canonical-list-${model.id}`,
      filmRefs,
      films: model.items,
    };
  };

  /**
   * Plans batch addition of unseen films from a canonical list to the watchlist.
   * @param {string} listId Canonical list identifier.
   * @param {CanonicalListCompletion} [completion] Pre-computed completion model.
   * @returns {CanonicalListWatchlistPlan|null} Watchlist addition plan.
   */
  window.canonicalListWatchlistPlan = function (listId, completion) {
    let model = completion || window.canonicalListCompletion(listId);
    if (!model) return null;

    let ready = [];
    let alreadyWatched = [];
    let alreadyWatchlisted = [];

    model.items.forEach((item) => {
      if (item.watched) {
        alreadyWatched.push(item);
        return;
      }
      if (item.watchlistItem) {
        alreadyWatchlisted.push(item);
        return;
      }
      ready.push({
        title: item.title,
        year: item.year,
        director: item.director,
        tmdbId: item.tmdbId,
        rank: item.rank,
      });
    });

    return {
      listId: model.id,
      sourceLabel: model.name,
      sourceHref: `completion.html#completion-canonical-list-${model.id}`,
      ready,
      alreadyWatched,
      alreadyWatchlisted,
    };
  };

  /**
   * Adds unseen films from a canonical list to the user's watchlist in a chosen interest tier.
   * @param {string} listId Canonical list identifier.
   * @param {string} tier Target interest tier ('S'|'A'|'B'|'C'|'D'|'E'|'F').
   * @param {Object} [options] Persistence options.
   * @returns {Object} Result { ok, added, plan, tier, persisted }.
   */
  window.applyCanonicalListWatchlistPlan = function (
    listId,
    tier,
    options = {},
  ) {
    if (window.oskarsCapabilities && !window.oskarsCapabilities().canEdit)
      return { ok: false, reason: "Watchlist editing is unavailable." };
    let normalizedTier = window.normalizeWatchlistTier?.(tier);
    if (!normalizedTier)
      return { ok: false, reason: "Choose an interest tier." };
    let plan = window.canonicalListWatchlistPlan(listId);
    if (!plan) return { ok: false, reason: "Canonical list not found." };

    let tag = plan.sourceLabel;
    let added = [];
    window.state.watchlist ||= [];

    plan.ready.forEach((candidate) => {
      let item = window.normalizeWatchlistItem?.({
        title: candidate.title,
        year: candidate.year,
        tier: normalizedTier,
        tags: [tag],
        ...(candidate.tmdbId ? { tmdbId: candidate.tmdbId } : {}),
      });
      if (!item) return;
      if (window.findWatchlistItemById?.(item.id)) return;
      window.state.watchlist.push(item);
      added.push(item);
    });

    if (!added.length)
      return { ok: true, added, plan, tier: normalizedTier, persisted: null };

    window.recomputeWatchlistOrder?.();
    window.markAggregatesDirty?.(
      `canonical list ${tag} films added to watchlist`,
    );
    window.recordEdit?.({
      type: "canonical list watchlist added",
      summary: `Added ${added.length} film(s) from ${plan.sourceLabel} to tier ${normalizedTier}`,
      sheetHint: "Watchlist",
      changes: [
        { field: "films added", before: "0", after: String(added.length) },
        { field: "tier", before: "", after: normalizedTier },
      ],
      context: {
        listId,
        tier: normalizedTier,
        watchlistIds: added.map((item) => item.id),
      },
    });

    let persisted =
      options.save === false
        ? null
        : window.save?.({ immediate: true, rebuild: true });
    return { ok: true, added, plan, tier: normalizedTier, persisted };
  };

  /**
   * Undoes a recent canonical list watchlist addition batch.
   * @param {string} listId Canonical list identifier.
   * @param {string[]} ids Watchlist item IDs to remove.
   * @param {Object} [options] Persistence options.
   * @returns {Object} Undo result.
   */
  window.undoCanonicalListWatchlistAdd = function (listId, ids, options = {}) {
    if (window.oskarsCapabilities && !window.oskarsCapabilities().canEdit)
      return { ok: false, reason: "Watchlist editing is unavailable." };
    let definition = window.canonicalListById(listId);
    let tag = window.normalizeTitle(definition?.name || listId);
    let targets = new Set((ids || []).map(String));
    let removed = [];

    window.state.watchlist = (window.state.watchlist || []).filter((item) => {
      let id = item.id || window.watchlistItemId?.(item);
      let isMatchingAddition = (item.tags || []).some(
        (itemTag) => window.normalizeTitle(itemTag) === tag,
      );
      if (!targets.has(id) || !isMatchingAddition) return true;
      removed.push(item);
      return false;
    });

    if (!removed.length) return { ok: true, removed, persisted: null };
    window.recomputeWatchlistOrder?.();
    window.markAggregatesDirty?.("canonical list watchlist addition undone");
    window.recordEdit?.({
      type: "canonical list watchlist add undone",
      summary: `Removed ${removed.length} recently added film(s) from the watchlist`,
      sheetHint: "Watchlist",
      changes: [
        { field: "films removed", before: String(removed.length), after: "0" },
      ],
      context: { listId, watchlistIds: removed.map((item) => item.id) },
    });

    let persisted =
      options.save === false
        ? null
        : window.save?.({ immediate: true, rebuild: true });
    return { ok: true, removed, persisted };
  };
})();
