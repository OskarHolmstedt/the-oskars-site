/**
 * @file Client-side index over the shared film-metadata discovery archive
 * (`sharedArchive/sharedFilmMetadata`, published by
 * scripts/publish-shared-film-metadata-archive.mjs from the
 * `/sharedFilmMetadata/<tmdbId>` collection - see
 * docs/shared-film-discovery-decision.md). Lets a director's filmography
 * page surface films other eligible accounts have already shared, even
 * when the viewer has never personally watched or watchlisted them.
 */

window.OSKARS_SHARED_FILM_ARCHIVE = {};
window.OSKARS_SHARED_FILM_ARCHIVE_BY_DIRECTOR = {};

/**
 * Groups a flat tmdbId-keyed shared-film map by director personId, sorted
 * chronologically within each director. Pure function of the map alone.
 * @param {Object} map `{ [tmdbId]: {tmdbId, title, year, people, ...} }`.
 * @returns {Record<string, Object[]>} personId -> shared film records.
 */
window.rebuildSharedFilmArchiveByDirectorIndex = function (map) {
  let byDirectorId = {};
  Object.values(map || {}).forEach((film) => {
    Object.entries(film.people || {}).forEach(([personId, credit]) => {
      if (!(credit.professions || []).includes("Director")) return;
      (byDirectorId[personId] ||= []).push(film);
    });
  });
  Object.values(byDirectorId).forEach((list) =>
    list.sort(
      (a, b) =>
        Number(a.year || 0) - Number(b.year || 0) ||
        window.compareEnglishTitles(a.title, b.title),
    ),
  );
  return byDirectorId;
};

/**
 * Applies a freshly-pulled sharedFilmMetadata archive section, rebuilding
 * the by-director index alongside it. The index only ever changes as a
 * result of a successful pull (sign-in / periodic recheck / reconnect),
 * never as a side effect of local mutations, so an eager synchronous
 * rebuild here is correct - unlike window.watchlistItemsByDirector, which
 * caches lazily against the viewer's own constantly-changing local state.
 * @param {Object} map Raw pulled `sharedFilmMetadata` flat map.
 */
window.applySharedFilmArchive = function (map) {
  window.OSKARS_SHARED_FILM_ARCHIVE = map || {};
  window.OSKARS_SHARED_FILM_ARCHIVE_BY_DIRECTOR =
    window.rebuildSharedFilmArchiveByDirectorIndex(
      window.OSKARS_SHARED_FILM_ARCHIVE,
    );
};

/**
 * Shared-archive films credited to a director that the viewer doesn't
 * already have in their own collection (ranked, other-watched, or
 * watchlisted) - a third "known but not mine" presence alongside those.
 *
 * Known gap, accepted rather than silently ignored: the shared archive's
 * `people` map is keyed by raw normalizePersonName(name) with no alias
 * resolution, while `person.id` here is alias-resolved locally
 * (state.peopleAliases, never shared). This checks every alias the
 * viewer's own data already knows for this person, but can't find a
 * shared entry keyed under a spelling variant the viewer has never
 * locally encountered in any form. Cross-account alias reconciliation is
 * a separate feature, not attempted here.
 * @param {PersonRecord} person Local person record (id, aliases, filmIds, watchedOtherIds).
 * @param {WatchlistItem[]} [watchlistItems] This director's current watchlist items.
 * @returns {Object[]} Shared film records not already owned by the viewer.
 */
window.sharedArchiveFilmsForDirector = function (person, watchlistItems = []) {
  if (!person) return [];
  let variantIds = new Set(
    [person.id, ...(person.aliases || []).map((name) => window.normalizePersonName(name))].filter(
      Boolean,
    ),
  );
  let seenTmdbIds = new Set();
  let candidates = [];
  variantIds.forEach((id) => {
    (window.OSKARS_SHARED_FILM_ARCHIVE_BY_DIRECTOR[id] || []).forEach((film) => {
      let tmdbId = String(film.tmdbId || "");
      if (!tmdbId || seenTmdbIds.has(tmdbId)) return;
      seenTmdbIds.add(tmdbId);
      candidates.push(film);
    });
  });
  if (!candidates.length) return candidates;

  let ownTmdbIds = new Set();
  let ownTitleYearKeys = new Set();
  function noteOwn(record) {
    if (!record) return;
    let tmdbId = String(record.tmdbId || "").trim();
    if (tmdbId) ownTmdbIds.add(tmdbId);
    else
      ownTitleYearKeys.add(
        `${record.year || ""}::${window.normalizeTitle(record.title || "")}`,
      );
  }
  (person.filmIds || []).forEach((id) => noteOwn(state.filmsById?.[id]));
  (person.watchedOtherIds || []).forEach((id) =>
    noteOwn((state.watchedOther || []).find((film) => film.id === id)),
  );
  watchlistItems.forEach(noteOwn);

  return candidates.filter(
    (film) =>
      !ownTmdbIds.has(String(film.tmdbId)) &&
      !ownTitleYearKeys.has(
        `${film.year || ""}::${window.normalizeTitle(film.title || "")}`,
      ),
  );
};
