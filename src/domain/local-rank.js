/** @file Independent within-collection film ordering for franchises, directors, and tags (issue #165) — an explicit order that doesn't have to agree with the implicit global-rank-derived order every collection page still shows too. Neither franchises, directors, nor tags have a persisted record of their own (`state.franchisesById`/`state.peopleById` are derived from film/watchlist records; tags are plain strings), so this follows the same pattern as `state.entityNotes`: a canonical side-table keyed by collection kind, then entity id. */

(function () {
  const LOCAL_RANK_GROUPS = ["franchises", "people", "tags"];

  function localRankGroup(type) {
    return LOCAL_RANK_GROUPS.includes(type) ? type : null;
  }

  /**
   * Merges a stored local order with a collection's current implicit order.
   * Stored ids still present in the collection come first, in their stored
   * order; any remaining current ids (new additions, or every id when no
   * order has been stored yet) are appended in their given order.
   * @param {string[]} storedOrder Explicit film ids, in preferred order.
   * @param {string[]} currentIds Current collection film ids, already in
   *   implicit (global-rank-derived) order.
   * @returns {string[]} Final film id order.
   */
  window.mergeLocalRankOrder = function (storedOrder, currentIds) {
    let currentSet = new Set(currentIds || []);
    let seen = new Set();
    let ordered = (storedOrder || []).filter((id) => {
      if (!currentSet.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    (currentIds || []).forEach((id) => {
      if (!seen.has(id)) ordered.push(id);
    });
    return ordered;
  };

  /**
   * Reads the stored local order for one collection.
   * @param {'franchises'|'people'|'tags'} type Collection kind.
   * @param {string} id Collection entity id.
   * @returns {string[]} Explicit film ids, or `[]` when none stored yet.
   */
  window.localRankOrder = function (type, id) {
    let group = localRankGroup(type);
    if (!group || !id) return [];
    return state.localRanks?.[group]?.[id] || [];
  };

  /**
   * Computes each film's 1-indexed local-rank position for a collection,
   * falling back to the implicit order for films with no explicit position.
   * @param {'franchises'|'people'|'tags'} type Collection kind.
   * @param {string} id Collection entity id.
   * @param {string[]} currentIds Current collection film ids, in implicit order.
   * @returns {Map<string, number>} Film id to 1-indexed position.
   */
  window.localRankPositions = function (type, id, currentIds) {
    let order = window.mergeLocalRankOrder(
      window.localRankOrder(type, id),
      currentIds,
    );
    return new Map(order.map((filmId, index) => [filmId, index + 1]));
  };

  /**
   * Sets the explicit local order for a collection.
   * @param {'franchises'|'people'|'tags'} type Collection kind.
   * @param {string} id Collection entity id.
   * @param {string[]} filmIds New order.
   * @param {Object} [options] Save controls.
   * @returns {boolean} Whether the order was stored.
   */
  window.setLocalRankOrder = function (type, id, filmIds, options = {}) {
    let group = localRankGroup(type);
    if (!group || !id) return false;
    state.localRanks ||= { franchises: {}, people: {}, tags: {} };
    state.localRanks[group] ||= {};
    state.localRanks[group][id] = [...(filmIds || [])];
    if (options.save !== false) window.save();
    return true;
  };

  /**
   * Moves one film relative to another within a collection's local order.
   * Initializes an explicit order from the current merged (implicit-backed)
   * order on first use, so a single drag doesn't require the whole
   * collection to already have one.
   * @param {'franchises'|'people'|'tags'} type Collection kind.
   * @param {string} id Collection entity id.
   * @param {string[]} currentIds Current collection film ids, in implicit order.
   * @param {string} fromFilmId Film being moved.
   * @param {string} toFilmId Reference film.
   * @param {'before'|'after'} [position] Placement relative to the reference film.
   * @param {Object} [options] Save controls.
   * @returns {boolean} Whether the move applied.
   */
  function byAllTimeRank(left, right) {
    let leftRank = Number(left.allTimeRank);
    let rightRank = Number(right.allTimeRank);
    let leftKnown = Number.isFinite(leftRank) && leftRank > 0;
    let rightKnown = Number.isFinite(rightRank) && rightRank > 0;
    if (leftKnown && rightKnown)
      return (
        leftRank - rightRank ||
        window.compareEnglishTitles(left.title, right.title)
      );
    if (leftKnown) return -1;
    if (rightKnown) return 1;
    return (
      Number(left.year || 0) - Number(right.year || 0) ||
      window.compareEnglishTitles(left.title, right.title)
    );
  }

  /**
   * Resolves a collection's display name and current films in implicit
   * (global-rank-derived) order, for callers with no page-specific context
   * of their own (the merge-sort tool, `local-rank-merge.html`). Mirrors
   * franchise.js/person.js's own allTimeRank-based sort; tags have no
   * existing rank concept, so highest-rating-first is used, matching the
   * tag page's own local-rank fallback.
   * @param {'franchises'|'people'|'tags'} type Collection kind.
   * @param {string} id Collection entity id.
   * @returns {{name: string, films: FilmRecord[]}|null} `null` when the
   *   collection can't be found.
   */
  window.localRankCollectionFilms = function (type, id) {
    if (type === "franchises") {
      let franchise = (
        window.ensureFranchiseIndex?.() ||
        state.franchisesById ||
        {}
      )[id];
      if (!franchise) return null;
      let films = (franchise.films || [])
        .map((entry) => state.filmsById[entry.filmId])
        .filter(Boolean)
        .sort(byAllTimeRank);
      return { name: franchise.name, films };
    }
    if (type === "people") {
      let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[
        id
      ];
      if (!person) return null;
      let films = (person.filmIds || [])
        .map((filmId) => state.filmsById[filmId])
        .filter(Boolean)
        .sort(byAllTimeRank);
      return { name: person.name, films };
    }
    if (type === "tags") {
      let tag = window.tagRecord?.(id);
      if (!tag) return null;
      let films = [...(tag.films || [])].sort(
        (left, right) =>
          (window.filmRatingSortValue(right) || 0) -
          (window.filmRatingSortValue(left) || 0),
      );
      return { name: tag.name, films };
    }
    return null;
  };

  window.moveLocalRankFilm = function (
    type,
    id,
    currentIds,
    fromFilmId,
    toFilmId,
    position = "before",
    options = {},
  ) {
    if (!fromFilmId || !toFilmId || fromFilmId === toFilmId) return false;
    let order = window.mergeLocalRankOrder(
      window.localRankOrder(type, id),
      currentIds,
    );
    if (!order.includes(fromFilmId) || !order.includes(toFilmId)) return false;
    let next = order.filter((filmId) => filmId !== fromFilmId);
    let toIndex = next.indexOf(toFilmId);
    next.splice(position === "after" ? toIndex + 1 : toIndex, 0, fromFilmId);
    return window.setLocalRankOrder(type, id, next, options);
  };
})();
