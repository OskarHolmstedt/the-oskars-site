/**
 * @file Merges the shared catalog with the viewer's own watched/watchlist
 * relationship to it into one browsable list (issue #495) - the concrete
 * model #451's epic named but never built a merged list for: "The catalog
 * is the set of films known to the app. Unseen, Watchlisted, and Watched
 * are user-relationship states, not different film types." Pure and
 * Node-testable: takes the three already-hydrated sources as plain
 * arguments rather than reading `window.state`/`OSKARS_SHARED_FILM_ARCHIVE`
 * directly, so no Supabase client or DOM is needed to test it.
 */

/**
 * @typedef {Object} CatalogFilmRecord
 * @property {string} catalogStatus "watched", "watchlist", or "unseen".
 * @property {string} href film.html URL appropriate to that status.
 */

/**
 * Builds one deduplicated, status-tagged film per catalog entry - watched
 * and watchlist records overlay themselves onto the matching catalog film
 * by tmdbId (falling back to id) so a single entry always carries every
 * field every view/filter/sort already expects (poster, medium,
 * screenplayType, adaptationSource, country, runtimeMinutes, plus rating/
 * allTimeRank when watched or tier when watchlisted) - never two rows for
 * one film. A personal record with no catalog match at all (this archive's
 * own not-yet-imported-to-the-shared-table films) still gets its own row,
 * status intact, rather than being dropped.
 * @param {Object<string, Object>} catalogByTmdbId The full shared catalog, `OSKARS_SHARED_FILM_ARCHIVE`-shaped, keyed by tmdbId.
 * @param {Object[]} watchedFilms `state.filmsById`'s own values - the viewer's watched films.
 * @param {Object[]} watchlistItems `state.watchlist` - the viewer's watchlist.
 * @returns {CatalogFilmRecord[]} One row per known film, status-tagged.
 */
window.buildFullFilmCatalog = function (
  catalogByTmdbId,
  watchedFilms,
  watchlistItems,
) {
  let filmPageUrl = window.filmPageUrl || ((id) => `film.html?id=${id}`);
  let sharedPreviewUrl =
    window.sharedFilmPreviewUrl || ((tmdbId) => `film.html?tmdb=${tmdbId}`);
  let byKey = new Map();
  let keyByTmdbId = new Map();
  let keyById = new Map();
  let keyByTitleYear = new Map();

  function titleYearKey(record) {
    let title = window.normalizeTitle
      ? window.normalizeTitle(record?.title)
      : String(record?.title || "")
          .trim()
          .toLowerCase();
    if (!title) return "";
    let year =
      (window.filmConcreteYear ? window.filmConcreteYear(record?.year) : "") ||
      String(record?.year || "").trim();
    return `${title}::${year}`;
  }

  function keyFor(record) {
    let tmdbId = String(record?.tmdbId || "").trim();
    if (tmdbId) return `tmdb:${tmdbId}`;
    let id = String(record?.id || record?.supabaseFilmId || "").trim();
    if (id) return `id:${id}`;
    let ty = titleYearKey(record);
    return ty
      ? `title:${ty}`
      : `title:${String(record?.title || "").toLowerCase()}::${record?.year || ""}`;
  }

  function findExistingKey(record) {
    let tmdbId = String(record?.tmdbId || "").trim();
    if (tmdbId && keyByTmdbId.has(tmdbId)) return keyByTmdbId.get(tmdbId);
    let id = String(record?.id || record?.supabaseFilmId || "").trim();
    if (id && keyById.has(id)) return keyById.get(id);
    let ty = titleYearKey(record);
    if (ty && keyByTitleYear.has(ty)) return keyByTitleYear.get(ty);
    return null;
  }

  function registerKeys(primaryKey, record) {
    let tmdbId = String(record?.tmdbId || "").trim();
    if (tmdbId) keyByTmdbId.set(tmdbId, primaryKey);
    let id = String(record?.id || record?.supabaseFilmId || "").trim();
    if (id) keyById.set(id, primaryKey);
    let ty = titleYearKey(record);
    if (ty) keyByTitleYear.set(ty, primaryKey);
  }

  Object.values(catalogByTmdbId || {}).forEach((film) => {
    let key = keyFor(film);
    let entry = {
      ...film,
      catalogStatus: "unseen",
      href: film.id ? filmPageUrl(film.id) : sharedPreviewUrl(film.tmdbId),
    };
    byKey.set(key, entry);
    registerKeys(key, entry);
  });
  (watchlistItems || []).forEach((item) => {
    let key = findExistingKey(item) || keyFor(item);
    let existing = byKey.get(key) || {};
    let resolvedId =
      item.supabaseFilmId || existing.supabaseFilmId || existing.id || item.id;
    let resolvedTmdbId = item.tmdbId || existing.tmdbId || "";
    let entry = {
      ...existing,
      ...item,
      tmdbId: resolvedTmdbId,
      catalogStatus: "watchlist",
      href: resolvedId
        ? filmPageUrl(resolvedId)
        : resolvedTmdbId
          ? sharedPreviewUrl(resolvedTmdbId)
          : filmPageUrl(""),
    };
    byKey.set(key, entry);
    registerKeys(key, entry);
  });
  (watchedFilms || []).forEach((film) => {
    let key = findExistingKey(film) || keyFor(film);
    let existing = byKey.get(key) || {};
    let resolvedId =
      film.id || existing.id || film.supabaseFilmId || existing.supabaseFilmId;
    let resolvedTmdbId = film.tmdbId || existing.tmdbId || "";
    let entry = {
      ...existing,
      ...film,
      tmdbId: resolvedTmdbId,
      catalogStatus: "watched",
      href: resolvedId
        ? filmPageUrl(resolvedId)
        : resolvedTmdbId
          ? sharedPreviewUrl(resolvedTmdbId)
          : filmPageUrl(""),
    };
    byKey.set(key, entry);
    registerKeys(key, entry);
  });
  return [...byKey.values()];
};

// The Films browse's own predicates and ordering (issue #642), shared by
// films.html's complete-archive path and the parity tests for
// read_film_catalog_page(), which applies the same rules in SQL.

/** Counts a film's personal award wins (placement 1). @param {FilmRecord} film Film. @returns {number} Wins. */
window.filmPersonalAwardWins = function (film) {
  return (film?.awards || []).filter((award) => Number(award.placement) === 1)
    .length;
};

/**
 * Tests the Films "Personal award" filter.
 * @param {Object} film Catalog record.
 * @param {''|'won'|'nominated'} value Filter value.
 * @returns {boolean} Whether the film matches.
 */
window.filmMatchesPersonalAward = function (film, value) {
  if (!value) return true;
  return value === "won"
    ? window.filmPersonalAwardWins(film) > 0
    : (film?.awards || []).length > 0;
};

/**
 * Tests the Films "Tag" filter against the viewer's own tags on the film;
 * shared-catalog records carry none.
 * @param {Object} film Catalog record.
 * @param {string} value Tag name.
 * @returns {boolean} Whether the film matches.
 */
window.filmMatchesCatalogTag = function (film, value) {
  if (!value) return true;
  let needle = window.normalizeFilmTag(value).toLocaleLowerCase();
  return window
    .parseFilmTags(film?.tags)
    .some((tag) => tag.toLocaleLowerCase() === needle);
};

/**
 * Tests the Films free-text search: a case-insensitive substring of the
 * title or of any credited director's name.
 * @param {Object} film Catalog record.
 * @param {string} query Search text.
 * @returns {boolean} Whether the film matches.
 */
window.filmMatchesCatalogSearch = function (film, query) {
  let needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  if (
    String(film?.title || "")
      .toLowerCase()
      .includes(needle)
  )
    return true;
  let directors = film?.director
    ? [film.director]
    : Object.values(film?.people || {})
        .filter((person) => person.professions?.includes("Director"))
        .map((person) => person.name);
  return directors.some((name) =>
    String(name || "")
      .toLowerCase()
      .includes(needle),
  );
};

/**
 * Returns a catalog record's primary value for a Films sort axis.
 * @param {Object} film Catalog record.
 * @param {'title'|'year'|'rating'|'runtime'|'tier'|'awards'|'communityRating'} sort Sort axis.
 * @returns {number|string} Sort value.
 */
window.filmCatalogSortValue = function (film, sort) {
  if (sort === "communityRating") return film?.communityRatingAverage ?? 0;
  if (sort === "year") return Number(film?.year) || -Infinity;
  if (sort === "rating") return window.filmRatingSortValue?.(film) || 0;
  if (sort === "runtime") return Number(film?.runtimeMinutes) || -Infinity;
  if (sort === "tier") {
    let tier = film?.tier;
    let modifier = film?.tier_modifier || film?.tierModifier || "";
    return window.watchlistTierGrade
      ? window.watchlistTierGrade(tier, modifier)
      : window.watchlistTierRank(tier);
  }
  if (sort === "awards") return window.filmPersonalAwardWins(film);
  return String(film?.title || "").toLowerCase();
};

// English, numeric, case- and accent-insensitive, and independent of the
// viewer's locale, so the database's ICU collation (english_title_order)
// orders ties the same way.
const catalogTitleCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Orders two catalog records for the Films browse: the sort axis (reversed
 * for "desc"), then the English title with leading articles moved last,
 * then the title itself, then the film id - so every tie has one defined
 * order.
 * @param {Object} left Catalog record.
 * @param {Object} right Catalog record.
 * @param {string} sort Sort axis.
 * @param {'asc'|'desc'} order Direction.
 * @returns {number} Comparison result.
 */
window.compareFilmCatalogEntries = function (left, right, sort, order) {
  if (sort === "communityRating") {
    let leftMissing = !(left?.communityRatingCount > 0);
    let rightMissing = !(right?.communityRatingCount > 0);
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
  }
  let leftValue = window.filmCatalogSortValue(left, sort);
  let rightValue = window.filmCatalogSortValue(right, sort);
  let primary = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  if (primary) return order === "desc" ? -primary : primary;
  let leftId = String(left?.supabaseFilmId || left?.id || "");
  let rightId = String(right?.supabaseFilmId || right?.id || "");
  return (
    catalogTitleCollator.compare(
      window.englishTitleSortKey(left?.title),
      window.englishTitleSortKey(right?.title),
    ) ||
    catalogTitleCollator.compare(
      String(left?.title || ""),
      String(right?.title || ""),
    ) ||
    (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)
  );
};

// The shared film-filters.js vocabulary entries the Films browse uses.
const FILM_CATALOG_FILTERS = [
  "period",
  "medium",
  "screenplay",
  "adaptationSource",
  "country",
  "minimumRating",
  "maximumRating",
  "minimumRuntime",
  "maximumRuntime",
  "watchlistTier",
  "category",
];

/**
 * Filters catalog records by a Films view: the shared film filters,
 * status, search, tag and personal award, plus any predicate the caller
 * adds for filters that need its own indexes (franchise, official result,
 * collection expressions).
 * @param {Object[]} films Catalog records.
 * @param {Object} view films.html's URL state.
 * @param {(film: Object) => boolean} [extraMatch] Additional predicate.
 * @returns {Object[]} Matching records.
 */
window.filterFilmCatalog = function (films, view, extraMatch) {
  let filmFilters = Object.fromEntries(
    FILM_CATALOG_FILTERS.map((name) => [name, view?.[name] || ""]),
  );
  return (films || []).filter(
    (film) =>
      window.filmMatchesFilters(film, filmFilters, {
        period: { alltimeMatchesAll: true },
      }) &&
      (!view?.status || film.catalogStatus === view.status) &&
      window.filmMatchesCatalogSearch(film, view?.q) &&
      window.filmMatchesCatalogTag(film, view?.tags) &&
      window.filmMatchesPersonalAward(film, view?.personalAward) &&
      (!extraMatch || extraMatch(film)),
  );
};

/**
 * Sorts catalog records by a Films view's sort axis and direction.
 * @param {Object[]} films Catalog records.
 * @param {Object} view films.html's URL state.
 * @returns {Object[]} A sorted copy.
 */
window.sortFilmCatalog = function (films, view) {
  return [...(films || [])].sort((left, right) =>
    window.compareFilmCatalogEntries(
      left,
      right,
      view?.sort || "title",
      view?.order || "asc",
    ),
  );
};
