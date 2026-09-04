/** @file Resolves imported collection-specific Oskars brackets and their films for collection pages. */

(function () {
  /** Normalizes a supported collection-award type. @param {*} value Raw type label. @returns {'director'|'franchise'|''} Canonical type. */
  window.normalizeCollectionAwardType = function (value) {
    let type = String(value || "").trim().toLowerCase();
    if (type === "director" || type === "directors") return "director";
    if (type === "franchise" || type === "franchises") return "franchise";
    return "";
  };

  /** Resolves a collection-award display name to its canonical id. @param {string} type Collection type. @param {string} name Display name. @returns {string} Canonical id. */
  window.collectionAwardCollectionId = function (type, name) {
    let normalizedType = window.normalizeCollectionAwardType(type);
    if (normalizedType === "director") {
      let variantId = window.normalizePersonName?.(name) || normalizeTitle(name);
      let canonicalName = window.state.peopleAliases?.[variantId] || name;
      return (
        window.normalizePersonName?.(canonicalName) || normalizeTitle(canonicalName)
      );
    }
    if (normalizedType === "franchise")
      return window.normalizeFranchiseId?.(name) || normalizeTitle(name);
    return "";
  };

  /** Returns one stored collection bracket. @param {string} type Collection type. @param {string} id Canonical collection id. @returns {CollectionAwardBracket|null} Stored bracket. */
  window.collectionAwardBracket = function (type, id) {
    let normalizedType = window.normalizeCollectionAwardType(type);
    if (!normalizedType || !id) return null;
    return window.state.collectionAwards?.[normalizedType]?.[id] || null;
  };

  function memberRecords(type, id) {
    let records = [];
    if (type === "director") {
      let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[id];
      if (!person) return records;
      (person.filmIds || []).forEach((filmId) => {
        let film = state.filmsById?.[filmId];
        if (film) records.push({ film, href: window.filmPageUrl(film.id) });
      });
      (person.watchedOtherIds || []).forEach((filmId) => {
        let film = (state.watchedOther || []).find((item) => item.id === filmId);
        if (film)
          records.push({
            film,
            href: `${window.periodPageUrl("year", film.year)}&view=other`,
          });
      });
      (person.watchlistIds || []).forEach((itemId) => {
        let item = window.findWatchlistItemById?.(itemId);
        if (item)
          records.push({
            film: window.watchlistFilmLike?.(item) || item,
            href: window.filmPageUrl(item.supabaseFilmId),
          });
      });
    } else if (type === "franchise") {
      let franchise = (window.ensureFranchiseIndex?.() || state.franchisesById || {})[id];
      if (!franchise) return records;
      (franchise.films || []).forEach((entry) => {
        let film = state.filmsById?.[entry.filmId];
        if (film) records.push({ film, href: window.filmPageUrl(film.id) });
      });
      (franchise.otherFilms || []).forEach((entry) => {
        let film = (state.watchedOther || []).find(
          (item) => item.id === entry.filmId,
        );
        if (film)
          records.push({
            film,
            href: `${window.periodPageUrl("year", film.year)}&view=other`,
          });
      });
      (franchise.watchlistFilms || []).forEach((entry) => {
        let item = window.findWatchlistItemById?.(entry.itemId);
        if (item)
          records.push({
            film: window.watchlistFilmLike?.(item) || item,
            href: window.filmPageUrl(item.supabaseFilmId),
          });
      });
    }
    let seen = new Set();
    return records.filter((record) => {
      let key = record.film.id || `${record.film.year || ""}::${normalizeTitle(record.film.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Builds the read-only category model for one collection bracket. @param {string} type Collection type. @param {string} id Canonical collection id. @returns {Object|null} Resolved bracket view model. */
  window.collectionAwardViewModel = function (type, id) {
    let normalizedType = window.normalizeCollectionAwardType(type);
    let bracket = window.collectionAwardBracket(normalizedType, id);
    if (!bracket) return null;
    let members = memberRecords(normalizedType, id);
    let byTitle = new Map();
    members.forEach((record) => {
      let key = normalizeTitle(record.film.title);
      let matches = byTitle.get(key) || [];
      matches.push(record);
      byTitle.set(key, matches);
    });
    let unresolved = [];
    let categories = new Map();
    (bracket.nominations || []).forEach((nomination) => {
      let matches = byTitle.get(normalizeTitle(nomination.sourceTitle)) || [];
      let resolved = matches.length === 1 ? matches[0] : null;
      let entry = {
        ...nomination,
        film: resolved?.film || null,
        href: resolved?.href || "",
        ambiguous: matches.length > 1,
      };
      if (!resolved) unresolved.push(entry);
      let list = categories.get(nomination.category) || [];
      list.push(entry);
      categories.set(nomination.category, list);
    });
    return {
      bracket,
      categories: [...categories.entries()]
        .map(([category, nominations]) => ({
          category,
          nominations: nominations.sort(
            (left, right) =>
              Number(left.placement) - Number(right.placement) ||
              window.compareEnglishTitles(left.sourceTitle, right.sourceTitle),
          ),
        }))
        .sort(
          (left, right) =>
            window.categorySortIndex(left.category) -
              window.categorySortIndex(right.category) ||
            left.category.localeCompare(right.category),
        ),
      unresolved,
      memberCount: members.length,
    };
  };
})();
