/**
 * @file Resolves a presentation-pack scope reference (project, franchise,
 * person, tag, category, period, or a watched-year recap) to the films and
 * watchlist items it covers, so the showcase page can generate a pack
 * without a second, unrelated presentation system.
 */

/** Ordered presentation-pack scope types. @type {string[]} */
window.PRESENTATION_PACK_SCOPE_TYPES = [
  "project",
  "franchise",
  "person",
  "tag",
  "category",
  "period",
  "year-recap",
];

function resolveProjectPackScope(id) {
  let project = window.findProjectById?.(id);
  if (!project) return null;
  let progress = window.projectProgress?.(project) || {};
  return {
    name: project.name,
    pageUrl: window.projectPageUrl(project.id),
    films: (progress.watched || []).map((record) => record.film).filter(Boolean),
    watchlist: (progress.watchlist || [])
      .map((record) => record.item)
      .filter(Boolean),
  };
}

function resolveFranchisePackScope(id) {
  let franchiseIndex =
    window.ensureFranchiseIndex?.() || window.state.franchisesById || {};
  let franchise = franchiseIndex[id];
  if (!franchise) return null;
  let films = (franchise.films || [])
    .map((entry) => window.state.filmsById?.[entry.filmId])
    .filter(Boolean);
  let watchlist = (franchise.watchlistFilms || [])
    .map((entry) => window.findWatchlistItemById?.(entry.itemId))
    .filter(Boolean);
  return {
    name: franchise.name,
    pageUrl: window.franchisePageUrl(franchise.id),
    films,
    watchlist,
  };
}

function resolvePersonPackScope(id) {
  let people = window.ensurePeopleIndex?.() || window.state.peopleById || {};
  let person = people[id];
  if (!person) return null;
  let films = (person.filmIds || [])
    .map((filmId) => window.findFilmById?.(filmId))
    .filter(Boolean);
  return {
    name: person.name,
    pageUrl: window.personPageUrl(person.id),
    films,
    watchlist: [],
  };
}

function resolveTagPackScope(id) {
  let record = window.tagRecord?.(id);
  if (!record) return null;
  return {
    name: record.name,
    pageUrl: window.tagPageUrl(record.name),
    films: record.films || [],
    watchlist: record.watchlist || [],
  };
}

function resolveCategoryPackScope(id) {
  let categories = window.getOrderedCategories?.() || [];
  if (!categories.includes(id)) return null;
  let films = Object.values(window.state.filmsById || {}).filter((film) =>
    (film.awards || []).some((award) => award.category === id),
  );
  return {
    name: id,
    pageUrl: window.categoryPageUrl(id),
    films,
    watchlist: [],
  };
}

// Mirrors period.js's own belongsToPeriod predicate (release year/decade/
// century, or any all-time-ranked film) without the canonical-composite
// merge-film special case, which is period.html editing machinery this
// read-only pack has no reason to duplicate.
function periodFilmMatches(film, type, key) {
  if (type === "alltime") return Number(film.allTimeRank) > 0;
  if (type === "year") return String(film.year || "") === key;
  if (type === "decade") return window.getDecadeKey(film.year) === key;
  if (type === "century") return window.getCenturyKey(film.year) === key;
  return false;
}

function resolvePeriodPackScope(id) {
  let [type, key] = String(id || "").split(":");
  let validShape =
    (type === "year" && /^\d{4}$/.test(key)) ||
    ((type === "decade" || type === "century") && /^\d{4}s$/.test(key)) ||
    (type === "alltime" && key === "alltime");
  if (!validShape) return null;
  let films = Object.values(window.state.filmsById || {}).filter((film) =>
    periodFilmMatches(film, type, key),
  );
  return {
    periodType: type,
    periodKey: key,
    pageUrl: window.periodPageUrl(type, key),
    films,
    watchlist: [],
    targetYear: type === "year" ? key : null,
  };
}

/**
 * Returns the calendar years with any watched-date film, most recent first.
 * @returns {string[]} Four-digit years.
 */
window.watchedRecapYears = function () {
  let years = new Set();
  Object.values(window.state.filmsById || {}).forEach((film) => {
    let date = window.parseWatchedDate?.(film.dateWatched);
    if (date) years.add(date.slice(0, 4));
  });
  return [...years].sort((left, right) => Number(right) - Number(left));
};

function resolveYearRecapPackScope(id) {
  if (!/^\d{4}$/.test(String(id || ""))) return null;
  let films = Object.values(window.state.filmsById || {}).filter((film) => {
    let date = window.parseWatchedDate?.(film.dateWatched);
    return date && date.slice(0, 4) === id;
  });
  return {
    recapYear: id,
    isYearRecap: true,
    pageUrl: "",
    films,
    watchlist: [],
  };
}

/**
 * Resolves a presentation-pack scope reference to its films, watchlist
 * items, and identifying data. `valid` reflects whether the referenced
 * entity itself exists (a project/franchise/person/tag can be deleted after
 * a pack URL was shared, and a category/period/year is well-formed or not);
 * an existing-but-empty scope still resolves valid with empty arrays, since
 * "nothing watched yet" is informative content, not a broken reference.
 * @param {string} type Scope type (see `PRESENTATION_PACK_SCOPE_TYPES`).
 * @param {string} id Scope-specific identifier.
 * @returns {{valid:boolean,name:(string|undefined),films:FilmRecord[],watchlist:WatchlistItem[],pageUrl:(string|undefined),targetYear:(string|null),periodType:(string|undefined),periodKey:(string|undefined),recapYear:(string|undefined),isYearRecap:boolean}} Resolved scope, or `{valid:false}`.
 */
window.resolvePresentationPackScope = function (type, id) {
  let resolver = {
    project: resolveProjectPackScope,
    franchise: resolveFranchisePackScope,
    person: resolvePersonPackScope,
    tag: resolveTagPackScope,
    category: resolveCategoryPackScope,
    period: resolvePeriodPackScope,
    "year-recap": resolveYearRecapPackScope,
  }[type];
  let resolved = id ? resolver?.(id) : null;
  if (!resolved) return { valid: false };
  return Object.assign(
    { valid: true, targetYear: null, isYearRecap: false },
    resolved,
  );
};
