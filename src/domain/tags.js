/**
 * @file Normalizes film tags and owns the aggregate-version-cached tag index.
 */

/** Normalizes one tag for storage and display. @param {*} value Tag value. @returns {string} Normalized tag. */
window.normalizeFilmTag = function (value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim();
};

/** Parses and deduplicates tags case-insensitively. @param {string|string[]} value Tag input. @returns {string[]} Tags. */
window.parseFilmTags = function (value) {
  let values = Array.isArray(value)
    ? value
    : String(value || "").split(/[,;\n]+/);
  let seen = new Set();
  return values.map(window.normalizeFilmTag).filter((tag) => {
    let key = tag.toLocaleLowerCase();
    return tag && !seen.has(key) && seen.add(key);
  });
};

/** Formats tags as comma-separated text. @param {string|string[]} value Tag input. @returns {string} Formatted tags. */
window.formatFilmTags = function (value) {
  return window.parseFilmTags(value).join(", ");
};

function buildFilmTagIndex() {
  let index = new Map();
  function add(tag, film, source) {
    let key = tag.toLocaleLowerCase();
    let entry = index.get(key) || { name: tag, films: [], watchlist: [] };
    entry[source].push(film);
    index.set(key, entry);
  }
  Object.values(window.state.filmsById || {}).forEach((film) => {
    window.parseFilmTags(film.tags).forEach((tag) => {
      add(tag, film, "films");
    });
  });
  (window.state.watchlist || []).forEach((item) => {
    window
      .parseFilmTags(item.tags)
      .forEach((tag) => add(tag, item, "watchlist"));
  });
  index.forEach((entry) => {
    entry.ratingStatistics = window.collectionRatingStatistics(entry.films);
  });
  return index;
}

function filmTagLookup() {
  let version = Number(window.state.aggregateVersion) || 0;
  let cache = window.state._tagIndexLookup;
  if (cache?.version === version) return cache;
  let byKey = buildFilmTagIndex();
  let list = [...byKey.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  cache = { version, byKey, list };
  window.state._tagIndexLookup = cache;
  return cache;
}

/** Finds archive films carrying a tag. @param {string} tag Tag. @returns {FilmRecord[]} Films. */
window.filmsByTag = function (tag) {
  let key = window.normalizeFilmTag(tag).toLocaleLowerCase();
  return filmTagLookup().byKey.get(key)?.films || [];
};

/** Finds watchlist items carrying a tag. @param {string} tag Tag. @returns {WatchlistItem[]} Items. */
window.watchlistItemsForTag = function (tag) {
  let key = window.normalizeFilmTag(tag).toLocaleLowerCase();
  return filmTagLookup().byKey.get(key)?.watchlist || [];
};

/** Finds one indexed tag record. @param {string} tag Tag. @returns {TagRecord|null} Tag record. */
window.tagRecord = function (tag) {
  let key = window.normalizeFilmTag(tag).toLocaleLowerCase();
  return filmTagLookup().byKey.get(key) || null;
};

/** Returns the sorted cached tag index. @returns {TagRecord[]} Tag records. */
window.getFilmTagIndex = function () {
  return filmTagLookup().list;
};
