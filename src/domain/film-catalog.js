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
