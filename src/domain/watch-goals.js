/**
 * @file Tracks watch-count goals per period (year/decade/century) — how many
 * watched films exist for each period against a configurable target,
 * independent of award nominee coverage (see award-bracket-completion.js).
 */

window.WATCH_GOAL_TARGETS = { year: 10, decade: 20, century: 40 };

function watchGoalPeriodKey(periodType, year) {
  let numericYear = Number(year);
  if (!Number.isFinite(numericYear)) return null;
  if (periodType === "year") return String(numericYear);
  if (periodType === "decade") return window.getDecadeKey(numericYear);
  return window.getCenturyKey(numericYear);
}

function watchGoalSourceParts(sourceId) {
  let [periodType, ...periodParts] = String(sourceId || "").split(":");
  let period = periodParts.join(":");
  return ["year", "decade", "century"].includes(periodType) && period
    ? { periodType, period }
    : null;
}

function watchGoalWatchlistCandidates(periodType, period) {
  return (state.watchlist || [])
    .filter(
      (item) =>
        item &&
        !window.findWatchlistArchiveFilm?.(item) &&
        watchGoalPeriodKey(periodType, item.year) === period,
    )
    .sort(window.compareWatchlistItems);
}

/** Builds the stable source id for one period watch goal. @param {'year'|'decade'|'century'} periodType Period type. @param {string} period Period key. @returns {string} Source id. */
window.watchGoalSourceId = function (periodType, period) {
  return `${periodType}:${period}`;
};

/** Resolves one watch-goal gap into the highest-priority matching watchlist films. @param {string} sourceId Watch-goal source id. @returns {Object|null} Project source. */
window.watchGoalProjectSource = function (sourceId) {
  let source = watchGoalSourceParts(sourceId);
  if (!source) return null;
  let target = window.WATCH_GOAL_TARGETS[source.periodType];
  let watchedCount = Object.values(state.filmsById || {}).filter(
    (film) =>
      film?.id &&
      film.title &&
      watchGoalPeriodKey(source.periodType, film.year) === source.period,
  ).length;
  let gap = Math.max(0, target - watchedCount);
  let candidates = watchGoalWatchlistCandidates(
    source.periodType,
    source.period,
  ).slice(0, gap);
  return {
    name: `${source.period} watch goal`,
    sourceLabel: `${source.period} · ${watchedCount}/${target} watched`,
    sourceHref: `${window.periodPageUrl(source.periodType, source.period)}&view=watchlist`,
    filmRefs: window.projectRefsForWatchlistItems(candidates),
  };
};

/**
 * Watched-film counts per period against WATCH_GOAL_TARGETS, for every
 * period with at least one watched film.
 * @param {"year"|"decade"|"century"} periodType
 * @returns {{period: string, watchedCount: number, target: number}[]}
 */
window.watchGoalProgress = function (periodType) {
  let target = window.WATCH_GOAL_TARGETS[periodType];
  let counts = new Map();
  let candidateCounts = new Map();
  Object.values(state.filmsById || {}).forEach((film) => {
    if (!film?.id || !film.title) return;
    let key = watchGoalPeriodKey(periodType, film.year);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  (state.watchlist || []).forEach((item) => {
    if (!item || window.findWatchlistArchiveFilm?.(item)) return;
    let key = watchGoalPeriodKey(periodType, item.year);
    if (!key) return;
    candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([period, watchedCount]) => ({
      period,
      watchedCount,
      target,
      sourceId: window.watchGoalSourceId(periodType, period),
      projectCandidateCount: Math.min(
        Math.max(0, target - watchedCount),
        candidateCounts.get(period) || 0,
      ),
    }))
    .sort((left, right) => left.period.localeCompare(right.period));
};
