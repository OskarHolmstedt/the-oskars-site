/**
 * @file Client-side index over the shared film-metadata discovery archive
 * (`sharedArchive/sharedFilmMetadata`, published by
 * scripts/publish-shared-film-metadata-archive.mjs from the
 * `/sharedFilmMetadata/<tmdbId>` collection - see
 * docs/shared-film-discovery-decision.md). Lets director filmographies,
 * period pages, and global search surface films other eligible accounts
 * have already shared, even when the viewer has never personally watched
 * or watchlisted them.
 */

window.OSKARS_SHARED_FILM_ARCHIVE = {};
window.OSKARS_SHARED_FILM_ARCHIVE_BY_DIRECTOR = {};
window.OSKARS_SHARED_FILM_ARCHIVE_VERSION = 0;
window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "idle";
let sharedFilmArchiveListeners = new Set();

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
  window.OSKARS_SHARED_FILM_ARCHIVE_VERSION += 1;
  window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "ready";
  sharedFilmArchiveListeners.forEach((listener) => listener());
};

/**
 * Updates shared-film loading status without replacing the current archive.
 * @param {'idle'|'loading'|'ready'|'unavailable'} status Current pull status.
 */
window.setSharedFilmArchiveStatus = function (status) {
  window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = status;
  sharedFilmArchiveListeners.forEach((listener) => listener());
};

/**
 * Subscribes to shared-film archive or loading-status changes.
 * @param {Function} listener Called after a status or archive change.
 * @returns {Function} Unsubscribes the listener.
 */
window.onSharedFilmArchiveChange = function (listener) {
  sharedFilmArchiveListeners.add(listener);
  return () => sharedFilmArchiveListeners.delete(listener);
};

/**
 * Returns objective director names carried by one shared-film record.
 * @param {Object} film Shared film record.
 * @returns {string[]} Director names.
 */
window.sharedArchiveFilmDirectorNames = function (film) {
  return Object.values(film?.people || {})
    .filter((credit) => (credit.professions || []).includes("Director"))
    .map((credit) => String(credit.name || ""))
    .filter(Boolean);
};

function sharedArchiveTitleYearKey(record) {
  return `${record?.year || ""}::${window.normalizeTitle(record?.title || "")}`;
}

/**
 * Removes shared films already present in watched, other-watched, or watchlist data.
 * @param {Object[]} [candidates] Shared-film candidates; defaults to the complete archive.
 * @returns {Object[]} Shared films absent from every personal collection.
 */
window.sharedArchiveFilmsOutsideCollection = function (
  candidates = Object.values(window.OSKARS_SHARED_FILM_ARCHIVE || {}),
) {
  if (!candidates.length) return [];
  let ownTmdbIds = new Set();
  let ownTitleYearKeys = new Set();
  function noteOwn(record) {
    if (!record) return;
    let tmdbId = String(record.tmdbId || "").trim();
    if (tmdbId) ownTmdbIds.add(tmdbId);
    else ownTitleYearKeys.add(sharedArchiveTitleYearKey(record));
  }
  Object.values(window.state?.filmsById || {}).forEach(noteOwn);
  (window.state?.watchedOther || []).forEach(noteOwn);
  (window.state?.watchlist || []).forEach(noteOwn);
  return candidates.filter(
    (film) =>
      !ownTmdbIds.has(String(film.tmdbId || "")) &&
      !ownTitleYearKeys.has(sharedArchiveTitleYearKey(film)),
  );
};

/**
 * Returns shared-only films whose release year belongs to one period.
 * @param {'year'|'decade'|'century'|'alltime'} type Period URL type.
 * @param {string} key Period key.
 * @returns {Object[]} Chronologically sorted shared-film records.
 */
window.sharedArchiveFilmsForPeriod = function (type, key) {
  return window
    .sharedArchiveFilmsOutsideCollection()
    .filter((film) => {
      if (!/^\d{4}$/.test(String(film.year || ""))) return false;
      if (type === "alltime") return true;
      if (type === "year") return String(film.year) === String(key);
      if (type === "decade") return window.getDecadeKey(film.year) === key;
      if (type === "century") return window.getCenturyKey(film.year) === key;
      return false;
    })
    .sort(
      (left, right) =>
        Number(left.year) - Number(right.year) ||
        window.compareEnglishTitles(left.title, right.title),
    );
};

/**
 * Adds one shared-film record through the normal watchlist persistence path.
 * @param {string|number} tmdbId Shared film TMDB id.
 * @returns {Object} Normal addWatchlistItem result.
 */
window.addSharedArchiveFilmToWatchlist = function (tmdbId) {
  let film = window.OSKARS_SHARED_FILM_ARCHIVE?.[String(tmdbId || "")];
  if (!film) return { ok: false, reason: "Could not add this film." };
  return window.addWatchlistItem({
    title: film.title,
    year: film.year,
    tmdbId: film.tmdbId,
    swedishTitle: film.swedishTitle,
    poster: film.poster,
    director: window.sharedArchiveFilmDirectorNames(film).join(", "),
  });
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
 * @returns {Object[]} Shared film records not already owned by the viewer.
 */
window.sharedArchiveFilmsForDirector = function (person) {
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
  return window.sharedArchiveFilmsOutsideCollection(candidates);
};
