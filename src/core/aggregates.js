/**
 * @file Rebuilds the canonical film store and period indexes derived from
 * source records in `state.years`, and invalidates the lazily built indexes
 * that depend on those aggregates.
 */

/**
 * Clears derived people, credit-subject, franchise, and tag indexes.
 */
window.invalidateDerivedIndexes = function () {
  window.state._tagIndexLookup = null;
  window.state.peopleById = {};
  window.state.peopleIndexVersion = -1;
  window.state.peopleCreditIssues = [];
  window.state.personAliasCandidates = null;
  window.state.creditSubjectsById = {};
  window.state.creditSubjectsVersion = -1;
  window.state.franchisesById = {};
  window.state.franchiseIndexVersion = -1;
};

/**
 * Rebuilds canonical films and period entries from authoritative source periods.
 */
window.rebuildAggregates = function () {
  let done = window.startOskarsPerformance?.("rebuildAggregates");
  // state.years is authoritative. Rebuilding avoids persisting several large,
  // potentially stale copies of the same films.
  window.state.filmsById = {};
  window.state._filmStoreLookup = null;
  window.state._periodEntryLookup = null;
  window.state._watchlistArchiveLookup = null;
  window.state._watchlistItemLookup = null;
  window.state._watchlistDirectorLookup = null;
  window.invalidateDerivedIndexes?.();
  window.state.periods = {
    years: {},
    decades: {},
    centuries: {},
    allTime: { films: [] },
  };

  // Century labels are range buckets: 1900s means 1900-1999 and 2000s means
  // 2000-2099. Recalculate ranked-list positions when loading older snapshots
  // that used ordinal-century boundaries.
  if ((window.state.centuryRangeVersion || 0) < 1) {
    let centuryGroups = {};
    (window.state.years?.alltime?.films || [])
      .filter((film) => /^\d{4}$/.test(String(film.year || "")))
      .sort(
        (left, right) =>
          Number(left.allTimeRank || left.rank || 999999) -
          Number(right.allTimeRank || right.rank || 999999),
      )
      .forEach((film) => {
        let century = window.getCenturyKey(film.year);
        centuryGroups[century] ||= [];
        centuryGroups[century].push(film);
      });
    Object.values(centuryGroups).forEach((films) =>
      films.forEach((film, index) => {
        film.centuryRank = index + 1;
      }),
    );
    window.state.centuryRangeVersion = 1;
  }

  function rankForPeriodType(film, periodType) {
    return periodType === "years"
      ? film.yearRank || film.rank
      : periodType === "decades"
        ? film.decadeRank || film.rank
        : periodType === "centuries"
          ? film.centuryRank || film.rank
          : periodType === "allTime"
            ? film.allTimeRank || film.rank
            : film.rank;
  }

  function directPeriodTypesForSourceFilm(film, periodKey, sourcePeriod) {
    if (sourcePeriod.periodType) return [sourcePeriod.periodType];
    let types = new Set(
      (film.awards || [])
        .filter((award) => String(award.year || "") === String(periodKey))
        .map((award) => window.getAwardPeriodType(award))
        .filter(Boolean),
    );
    if (!types.size && sourcePeriod.periodType)
      types.add(sourcePeriod.periodType);
    return [...types];
  }

  let doneFilmStore = window.startOskarsPerformance?.(
    "rebuildAggregates:filmsAndPeriods",
  );
  Object.keys(window.state.years).forEach((year) => {
    let sourcePeriod = window.state.years[year];
    let films = sourcePeriod.films || [];
    films.forEach((f) => {
      let canonical = window.addFilmToStore(year, f, {
        addToAllTime: year === "alltime",
        addToDerivedPeriods: year !== "alltime",
      });
      directPeriodTypesForSourceFilm(f, year, sourcePeriod).forEach(
        (periodType) => {
          let periodKey = periodType === "allTime" ? "all" : year;
          window.addToPeriod(periodType, periodKey, canonical.id, {
            rank: rankForPeriodType(f, periodType),
          });
        },
      );
    });
  });
  doneFilmStore?.(`${Object.keys(window.state.filmsById || {}).length} films`);
  window.state.aggregateVersion =
    (Number(window.state.aggregateVersion) || 0) + 1;
  // People and credit subjects are comparatively expensive and many pages do
  // not use them. Consumers synchronously build both through
  // ensurePeopleIndex()/ensureCreditSubjects() on first use.
  window.clearAggregatesDirty?.();
  done?.(`${Object.keys(window.state.filmsById || {}).length} films`);
};
