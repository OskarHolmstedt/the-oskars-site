/**
 * @file Calculates award scores, normalized scores, film statistics, and viewing aggregates.
 */

function scorePeriodTypeForKey(periodKey) {
  let key = String(periodKey || "");
  if (key === "alltime") return "allTime";
  if (/^\d{4}$/.test(key)) return "years";
  return state.years?.[key]?.periodType || "";
}

function isAwardVisibleForPeriod(award, periodKey, periodType) {
  if (!award) return false;
  if (!award.year) return true;
  let expectedType =
    window.normalizeAwardPeriodType(periodType) ||
    scorePeriodTypeForKey(periodKey);
  if (expectedType && window.getAwardPeriodType(award) !== expectedType)
    return false;
  if (periodKey === "alltime") return String(award.year || "") === "alltime";
  return String(award.year) === String(periodKey);
}

/** Resolves the scoring period type for an award. @param {AwardRecord} award Award. @returns {string} Period type. */
window.awardScorePeriodType = function (award) {
  let explicitType = window.normalizeAwardPeriodType(award?.periodType);
  if (explicitType) return explicitType;
  let period = String(award?.year ?? award?.period ?? "");
  if (/^\d{4}$/.test(period)) return "years";
  if (period === "alltime") return "allTime";
  return state.years?.[period]?.periodType || "";
};

/** Calculates placement points for one award. @param {AwardRecord} award Award. @returns {number} Points. */
window.awardPoints = function (award) {
  let periodType = window.awardScorePeriodType(award);
  let limits = window.PERIOD_LIMITS[periodType];
  if (!limits) return 0;
  let capacity =
    award.category === "Best Picture" ? limits.picture : limits.category;
  let placement = Number(award.placement);
  return Number.isInteger(placement) && placement >= 1 && placement <= capacity
    ? capacity - placement + 1
    : 0;
};

/** Sums award points with an optional period filter. @param {AwardRecord[]} awards Awards. @param {string} [periodType] Period type. @returns {number} Score. */
window.calculateAwardsScore = function (awards, periodType) {
  return (awards || []).reduce(
    (score, award) =>
      score +
      (!periodType || window.awardScorePeriodType(award) === periodType
        ? window.awardPoints(award)
        : 0),
    0,
  );
};

/** Calculates the attainable perfect-film score for a period type. @param {string} periodType Period type. @returns {number} Maximum. */
window.awardScoreMaximum = function (periodType) {
  let limits = window.PERIOD_LIMITS[periodType];
  if (!limits) return 0;
  let categories = window.getOrderedCategories
    ? window.getOrderedCategories()
    : window.categories || [];
  let uniqueCategories = [...new Set(categories)];
  let categorySlots = uniqueCategories.filter(
    (category) => category !== "Best Picture",
  ).length;
  // A film can be original or adapted, never both. Treat the two screenplay
  // categories as one attainable slot when defining a perfect film score.
  if (
    uniqueCategories.includes("Best Original Screenplay") &&
    uniqueCategories.includes("Best Adapted Screenplay")
  ) {
    categorySlots -= 1;
  }
  return limits.picture + Math.max(0, categorySlots) * limits.category;
};

/** Normalizes award score to an attainable zero-to-one range. @param {AwardRecord[]} awards Awards. @param {string} [periodType] Period type. @returns {number} Normalized score. */
window.calculateNormalizedAwardsScore = function (awards, periodType) {
  let eligibleAwards = (awards || []).filter(
    (award) => !periodType || window.awardScorePeriodType(award) === periodType,
  );
  if (!eligibleAwards.length) return 0;
  let periodKeys = new Set(
    eligibleAwards.map((award) => String(award.year ?? award.period ?? "")),
  );
  let effectiveType =
    periodType || window.awardScorePeriodType(eligibleAwards[0]);
  let maximum =
    window.awardScoreMaximum(effectiveType) * Math.max(1, periodKeys.size);
  if (!maximum) return 0;
  return Math.max(
    0,
    Math.min(
      1,
      window.calculateAwardsScore(eligibleAwards, periodType) / maximum,
    ),
  );
};

function viewingCountRows(values, options = {}) {
  let counts = new Map();
  values.forEach((value) => {
    let key = String(value || "").trim();
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort(
      options.chronological
        ? (left, right) => left.key.localeCompare(right.key)
        : (left, right) =>
            right.count - left.count || left.key.localeCompare(right.key),
    );
}

function ratingStatisticsFilmKey(film) {
  let id = String(film?.id || "").trim();
  if (id) return `id:${id}`;
  let title = window.normalizeTitle?.(film?.normalizedTitle || film?.title);
  if (title) {
    let year =
      window.filmConcreteYear?.(film?.year) || String(film?.year || "");
    return `film:${year}::${title}`;
  }
  return film;
}

/** Calculates modifier-aware population statistics for unique films. @param {FilmRecord[]} [films] Films. @returns {RatingStatistics} Rating statistics. */
window.collectionRatingStatistics = function (films = []) {
  let seen = new Set();
  let uniqueFilms = (films || []).filter((film) => {
    if (!film) return false;
    let key = ratingStatisticsFilmKey(film);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let grades = uniqueFilms
    .map((film) => window.filmRatingGrade?.(film) || 0)
    .filter((grade) => Number.isInteger(grade) && grade > 0);
  let totalCount = uniqueFilms.length;
  let ratedCount = grades.length;
  if (!ratedCount) {
    return {
      totalCount,
      ratedCount: 0,
      coveragePercent: 0,
      mean: null,
      variance: null,
      standardDeviation: null,
      minimum: null,
      maximum: null,
    };
  }
  let meanGrade = grades.reduce((sum, grade) => sum + grade, 0) / ratedCount;
  let gradeVariance =
    grades.reduce((sum, grade) => sum + (grade - meanGrade) ** 2, 0) /
    ratedCount;
  return {
    totalCount,
    ratedCount,
    coveragePercent: Math.round((ratedCount / totalCount) * 100),
    mean: meanGrade / 6,
    variance: gradeVariance / 36,
    standardDeviation: Math.sqrt(gradeVariance) / 6,
    minimum: Math.min(...grades) / 6,
    maximum: Math.max(...grades) / 6,
  };
};

/** Formats a nullable rating statistic to two decimals. @param {number|null|undefined} value Statistic. @returns {string} Formatted statistic. */
window.formatRatingStatistic = function (value) {
  return value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toFixed(2);
};

/** Formats a normalized average with its nearest star-grade label and precise decimal. @param {number|null|undefined} value Average rating. @returns {string} Star label and decimal, or an em dash. */
window.formatAverageRating = function (value) {
  let numeric = Number(value);
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(numeric) ||
    numeric <= 0
  )
    return "—";
  let grade = Math.max(1, Math.min(30, Math.round(numeric * 6)));
  let rating = window.filmRatingFromGrade?.(grade);
  let stars = rating ? window.renderFilmRating?.(rating) || "" : "";
  return [stars, window.formatRatingStatistic(numeric)]
    .filter(Boolean)
    .join(" ");
};

function viewingRatingPeriodRows(records, keyForFilm) {
  let periods = new Map();
  records.forEach((film) => {
    let key = keyForFilm(film);
    if (!key || key === "unknown") return;
    let films = periods.get(key) || [];
    films.push(film);
    periods.set(key, films);
  });
  return [...periods]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, films]) => {
      let statistics = window.collectionRatingStatistics(films);
      return Object.assign(
        {
          key,
          count: statistics.totalCount,
          averageRating: statistics.mean,
          ratingCoveragePercent: statistics.coveragePercent,
          ratingVariance: statistics.variance,
          ratingStandardDeviation: statistics.standardDeviation,
          minimumRating: statistics.minimum,
          maximumRating: statistics.maximum,
        },
        statistics,
      );
    });
}

// Read-only aggregate model for the Statistics page (issue #68). Keeping the
// calculations here makes the page controller a renderer and gives every
// count one definition that can be exercised without a browser DOM.
/** Builds the read-only aggregate model for viewing statistics. @param {FilmRecord[]} [films] Films. @returns {Object} Statistics model. */
window.viewingStatistics = function (
  films = Object.values(window.state?.filmsById || {}),
) {
  let records = (films || []).filter(Boolean);
  let ratings = records
    .map((film) => ({
      film,
      rating: window.parseFilmRating?.(film) || { value: 0 },
    }))
    .filter((entry) => entry.rating.value > 0);
  let ratingRows = viewingCountRows(
    ratings.map((entry) => entry.rating.value),
    { chronological: true },
  ).sort((left, right) => Number(right.key) - Number(left.key));
  let ratingStatistics = window.collectionRatingStatistics(records);

  let yearRows = viewingRatingPeriodRows(records, (film) => {
    let year = String(window.filmConcreteYear?.(film.year) || film.year || "");
    return /^\d{4}$/.test(year) ? year : "";
  });
  let decadeRows = viewingRatingPeriodRows(
    records,
    (film) => window.getDecadeKey?.(film.year) || "unknown",
  );
  let centuryRows = viewingRatingPeriodRows(
    records,
    (film) => window.getCenturyKey?.(film.year) || "unknown",
  );

  let countries = [];
  records.forEach((film) =>
    countries.push(...(window.countryListValues?.(film.country) || [])),
  );
  let platforms = viewingCountRows(
    records
      .map((film) => film.platform)
      .filter((value) => value && !/^(?:-|–|—)$/.test(String(value).trim())),
  );
  let media = viewingCountRows(
    records.map((film) =>
      film.medium && film.medium !== "unknown" ? film.medium : "unknown",
    ),
  );
  let screenplays = viewingCountRows(
    records.map((film) =>
      film.screenplayType && film.screenplayType !== "unknown"
        ? film.screenplayType
        : "unknown",
    ),
  );

  let dated = records
    .map((film) => ({
      film,
      date: window.parseWatchedDate?.(film.dateWatched) || "",
    }))
    .filter((entry) => entry.date);
  let watchYears = viewingCountRows(
    dated.map((entry) => entry.date.slice(0, 4)),
    { chronological: true },
  ).sort((left, right) => right.key.localeCompare(left.key));
  let watchMonths = viewingCountRows(
    dated.map((entry) => entry.date.slice(0, 7)),
    { chronological: true },
  ).sort((left, right) => right.key.localeCompare(left.key));

  let viewRecords = records
    .map((film) => ({ film, views: Number(film.views) }))
    .filter((entry) => Number.isInteger(entry.views) && entry.views > 0);
  let viewRows = viewingCountRows(
    viewRecords.map((entry) => entry.views),
    { chronological: true },
  ).sort((left, right) => Number(left.key) - Number(right.key));
  let rewatches = viewRecords.filter((entry) => entry.views > 1);
  let runtimeRecords = records
    .map((film) => ({
      film,
      minutes: Number(film.runtimeMinutes),
      views: Number(film.views),
    }))
    .filter((entry) => Number.isFinite(entry.minutes) && entry.minutes > 0);
  let knownRuntimeMinutes = runtimeRecords.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );
  let viewAdjustedRuntime = runtimeRecords.filter(
    (entry) => Number.isInteger(entry.views) && entry.views > 0,
  );

  return {
    filmCount: records.length,
    ratingStatistics,
    ratedCount: ratingStatistics.ratedCount,
    averageRating: ratingStatistics.mean,
    ratingCoveragePercent: ratingStatistics.coveragePercent,
    ratingVariance: ratingStatistics.variance,
    ratingStandardDeviation: ratingStatistics.standardDeviation,
    minimumRating: ratingStatistics.minimum,
    maximumRating: ratingStatistics.maximum,
    ratingRows,
    yearRows,
    decadeRows,
    centuryRows,
    mediaRows: media,
    screenplayRows: screenplays,
    countryRows: viewingCountRows(countries),
    platformRows: platforms,
    datedCount: dated.length,
    watchYearRows: watchYears,
    watchMonthRows: watchMonths,
    viewKnownCount: viewRecords.length,
    viewRows,
    rewatchedFilmCount: rewatches.length,
    extraViewCount: rewatches.reduce((sum, entry) => sum + entry.views - 1, 0),
    runtimeKnownCount: runtimeRecords.length,
    knownRuntimeMinutes,
    adjustedRuntimeKnownCount: viewAdjustedRuntime.length,
    viewAdjustedRuntimeMinutes: viewAdjustedRuntime.reduce(
      (sum, entry) => sum + entry.minutes * entry.views,
      0,
    ),
  };
};

/** Collects sorted unique four-digit watch years from films with recorded watch dates. @param {FilmRecord[]} [films] Films. @returns {string[]} Watch years in descending order. */
window.availableWatchYears = function (
  films = Object.values(window.state?.filmsById || {}),
) {
  let years = new Set();
  (films || []).forEach((film) => {
    let date = window.parseWatchedDate?.(film?.dateWatched) || "";
    if (date) {
      let year = date.slice(0, 4);
      if (/^\d{4}$/.test(year)) years.add(year);
    }
  });
  return [...years].sort((a, b) => b.localeCompare(a));
};

const YEARLY_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Calculates a calendar-year viewing breakdown and year-over-year comparison for recorded watch dates. @param {string} watchYear Four-digit watch year. @param {FilmRecord[]} [films] Films. @param {FilmRecord[]} [allFilms] Complete film archive for comparison. @param {Object} [options] Calculation options. @returns {Object} Yearly viewing statistics model. */
window.yearlyViewingStatistics = function (
  watchYear,
  films = Object.values(window.state?.filmsById || {}),
  allFilms = films,
  options = {},
) {
  let yearString = String(watchYear || "").trim();
  let pool = allFilms || films || [];
  let seen = new Set();
  let yearFilms = pool.filter((film) => {
    if (!film) return false;
    let date = window.parseWatchedDate?.(film.dateWatched) || "";
    if (date.slice(0, 4) !== yearString) return false;
    let key = ratingStatisticsFilmKey(film);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let ratings = yearFilms
    .map((film) => ({
      film,
      rating: window.parseFilmRating?.(film) || { value: 0 },
    }))
    .filter((entry) => entry.rating.value > 0);
  let ratingRows = viewingCountRows(
    ratings.map((entry) => entry.rating.value),
    { chronological: true },
  ).sort((left, right) => Number(right.key) - Number(left.key));
  let ratingStatistics = window.collectionRatingStatistics(yearFilms);

  let monthCounts = new Map();
  yearFilms.forEach((film) => {
    let date = window.parseWatchedDate?.(film.dateWatched) || "";
    if (date.length >= 7) {
      let month = date.slice(5, 7);
      monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
    }
  });
  let monthlyRows = YEARLY_MONTH_NAMES.map((name, index) => {
    let monthKey = String(index + 1).padStart(2, "0");
    let count = monthCounts.get(monthKey) || 0;
    return {
      monthKey,
      monthName: name,
      monthIndex: index + 1,
      count,
      datePrefix: `${yearString}-${monthKey}`,
    };
  });
  let activeMonths = monthlyRows
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count || a.monthIndex - b.monthIndex);
  let mostActiveMonth = activeMonths[0] || null;

  let directorsMap = new Map();
  yearFilms.forEach((film) => {
    let names = film.directors?.length
      ? film.directors
      : window.splitRecipientNames?.(film.director) || [];
    let grade = window.filmRatingGrade?.(film) || 0;
    let filmDirectors = new Set();
    names.forEach((name, index) => {
      let id =
        film.directorIds?.[index] || window.normalizePersonName?.(name) || name;
      if (filmDirectors.has(id)) return;
      filmDirectors.add(id);
      let entry = directorsMap.get(id) || {
        id,
        name,
        count: 0,
        grades: [],
        films: [],
      };
      entry.count += 1;
      if (grade > 0) entry.grades.push(grade);
      entry.films.push(film);
      directorsMap.set(id, entry);
    });
  });
  let directorRows = [...directorsMap.values()]
    .map((d) => ({
      id: d.id,
      name: d.name,
      count: d.count,
      ratedCount: d.grades.length,
      averageRating: d.grades.length
        ? d.grades.reduce((sum, g) => sum + g, 0) / d.grades.length / 6
        : null,
    }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        (b.averageRating || 0) - (a.averageRating || 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );

  let countries = [];
  yearFilms.forEach((film) =>
    countries.push(...(window.countryListValues?.(film.country) || [])),
  );
  let countryRows = viewingCountRows(countries);

  let releaseYearRows = viewingRatingPeriodRows(yearFilms, (film) => {
    let year = String(window.filmConcreteYear?.(film.year) || film.year || "");
    return /^\d{4}$/.test(year) ? year : "";
  }).sort((a, b) => b.count - a.count || b.key.localeCompare(a.key));

  let releaseDecadeRows = viewingRatingPeriodRows(
    yearFilms,
    (film) => window.getDecadeKey?.(film.year) || "unknown",
  ).sort((a, b) => b.count - a.count || b.key.localeCompare(a.key));

  let platforms = viewingCountRows(
    yearFilms
      .map((film) => film.platform)
      .filter((value) => value && !/^(?:-|–|—)$/.test(String(value).trim())),
  );
  let media = viewingCountRows(
    yearFilms.map((film) =>
      film.medium && film.medium !== "unknown" ? film.medium : "unknown",
    ),
  );
  let screenplays = viewingCountRows(
    yearFilms.map((film) =>
      film.screenplayType && film.screenplayType !== "unknown"
        ? film.screenplayType
        : "unknown",
    ),
  );

  let viewRecords = yearFilms
    .map((film) => ({ film, views: Number(film.views) }))
    .filter((entry) => Number.isInteger(entry.views) && entry.views > 0);
  let viewRows = viewingCountRows(
    viewRecords.map((entry) => entry.views),
    { chronological: true },
  ).sort((left, right) => Number(left.key) - Number(right.key));
  let rewatches = viewRecords.filter((entry) => entry.views > 1);

  let runtimeRecords = yearFilms
    .map((film) => ({
      film,
      minutes: Number(film.runtimeMinutes),
      views: Number(film.views),
    }))
    .filter((entry) => Number.isFinite(entry.minutes) && entry.minutes > 0);
  let knownRuntimeMinutes = runtimeRecords.reduce(
    (sum, entry) => sum + entry.minutes,
    0,
  );
  let viewAdjustedRuntime = runtimeRecords.filter(
    (entry) => Number.isInteger(entry.views) && entry.views > 0,
  );
  let viewAdjustedRuntimeMinutes = viewAdjustedRuntime.reduce(
    (sum, entry) => sum + entry.minutes * entry.views,
    0,
  );

  let topRatedFilms = [...yearFilms]
    .map((film) => ({
      film,
      grade: window.filmRatingGrade?.(film) || 0,
      date: window.parseWatchedDate?.(film.dateWatched) || "",
    }))
    .filter((entry) => entry.grade > 0)
    .sort(
      (a, b) =>
        b.grade - a.grade ||
        b.date.localeCompare(a.date) ||
        String(a.film.title).localeCompare(String(b.film.title)),
    )
    .map((entry) => entry.film);

  let comparison = { hasPreviousYear: false, previousYear: null };
  if (!options.skipComparison && /^\d{4}$/.test(yearString)) {
    let numericYear = Number(yearString);
    let candidatePrevYear = String(numericYear - 1);
    let allAvailable = window.availableWatchYears(pool);
    let prevYear = allAvailable.includes(candidatePrevYear)
      ? candidatePrevYear
      : allAvailable.find((y) => Number(y) < numericYear) || null;
    if (prevYear) {
      let prevStats = window.yearlyViewingStatistics(prevYear, pool, pool, {
        skipComparison: true,
      });
      if (prevStats && prevStats.filmCount > 0) {
        comparison = {
          hasPreviousYear: true,
          previousYear: prevYear,
          filmCountDiff: yearFilms.length - prevStats.filmCount,
          knownRuntimeMinutesDiff:
            knownRuntimeMinutes - prevStats.knownRuntimeMinutes,
          averageRatingDiff:
            ratingStatistics.mean !== null &&
            prevStats.ratingStatistics.mean !== null
              ? ratingStatistics.mean - prevStats.ratingStatistics.mean
              : null,
          rewatchedFilmCountDiff:
            rewatches.length - prevStats.rewatchedFilmCount,
        };
      }
    }
  }

  return {
    year: yearString,
    filmCount: yearFilms.length,
    films: yearFilms,
    ratingStatistics,
    ratedCount: ratingStatistics.ratedCount,
    averageRating: ratingStatistics.mean,
    ratingCoveragePercent: ratingStatistics.coveragePercent,
    ratingVariance: ratingStatistics.variance,
    ratingStandardDeviation: ratingStatistics.standardDeviation,
    minimumRating: ratingStatistics.minimum,
    maximumRating: ratingStatistics.maximum,
    ratingRows,
    monthlyRows,
    mostActiveMonth,
    directorRows,
    topDirector: directorRows[0] || null,
    countryRows,
    topCountry: countryRows[0] || null,
    releaseYearRows,
    topReleaseYear: releaseYearRows[0] || null,
    releaseDecadeRows,
    topReleaseDecade: releaseDecadeRows[0] || null,
    mediaRows: media,
    screenplayRows: screenplays,
    platformRows: platforms,
    viewRows,
    viewKnownCount: viewRecords.length,
    rewatchedFilmCount: rewatches.length,
    extraViewCount: rewatches.reduce((sum, entry) => sum + entry.views - 1, 0),
    runtimeKnownCount: runtimeRecords.length,
    knownRuntimeMinutes,
    adjustedRuntimeKnownCount: viewAdjustedRuntime.length,
    viewAdjustedRuntimeMinutes,
    topRatedFilms,
    comparison,
  };
};

/** Builds deterministic annual-award leaderboards and sample-qualified rating leaders. @param {FilmRecord[]} [films] Archive films. @returns {Object} Overall statistics with complete evidence rows. */
window.overallFilmStatistics = function (
  films = Object.values(window.state?.filmsById || {}),
) {
  let seen = new Set();
  let records = films.filter((film) => {
    if (!film) return false;
    let key = ratingStatisticsFilmKey(film);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let directors = new Map();
  let nominationRows = [];
  let awardFilmCount = 0;
  let creditedAwardFilmCount = 0;
  records.forEach((film) => {
    let awards = new Map();
    (film.awards || []).forEach((award) => {
      if (
        window.getAwardPeriodType(award) !== "years" ||
        !Number.isInteger(Number(award.placement)) ||
        Number(award.placement) < 1
      )
        return;
      // Distinct recipients in one category remain distinct nominations.
      let key =
        award.supabaseNominationId ||
        award.id ||
        JSON.stringify([
          award.year,
          award.category,
          award.placement,
          award.recipientText || "",
        ]);
      awards.set(key, award);
    });
    if (!awards.size) return;
    awardFilmCount += 1;
    let wins = [...awards.values()].filter(
      (award) => Number(award.placement) === 1,
    ).length;
    nominationRows.push({
      film: {
        id: film.id,
        title: film.title,
        year: film.year,
        swedishTitle: film.swedishTitle || "",
      },
      nominations: awards.size,
      wins,
    });
    let names = film.directors?.length
      ? film.directors
      : window.splitRecipientNames?.(film.director) || [];
    if (names.length) creditedAwardFilmCount += 1;
    let filmDirectors = new Set();
    names.forEach((name, index) => {
      let id =
        film.directorIds?.[index] || window.normalizePersonName?.(name) || name;
      if (filmDirectors.has(id)) return;
      filmDirectors.add(id);
      let row = directors.get(id) || {
        id,
        name,
        wins: 0,
        nominations: 0,
        filmCount: 0,
      };
      row.wins += wins;
      row.nominations += awards.size;
      row.filmCount += 1;
      directors.set(id, row);
    });
  });
  let yearRows = viewingRatingPeriodRows(records, (film) => {
    let year = String(window.filmConcreteYear?.(film.year) || film.year || "");
    return /^\d{4}$/.test(year) ? year : "";
  })
    .filter((row) => row.ratedCount > 0)
    .sort(
      (a, b) =>
        b.mean - a.mean ||
        b.ratedCount - a.ratedCount ||
        a.key.localeCompare(b.key),
    );
  return {
    minimumRatedFilms: 5,
    yearRows,
    strongestYear: yearRows.find((row) => row.ratedCount >= 5) || null,
    directorRows: [...directors.values()]
      .filter((row) => row.wins > 0)
      .sort(
        (a, b) =>
          b.wins - a.wins ||
          b.nominations - a.nominations ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      ),
    nominationRows: nominationRows.sort(
      (a, b) =>
        b.nominations - a.nominations ||
        b.wins - a.wins ||
        String(a.film.title).localeCompare(String(b.film.title)) ||
        String(a.film.id).localeCompare(String(b.film.id)),
    ),
    awardFilmCount,
    creditedAwardFilmCount,
  };
};

/** Formats a normalized award score to two decimals. @param {number} score Score. @returns {string} Formatted score. */
window.formatNormalizedAwardScore = function (score) {
  return Number(score || 0).toFixed(2);
};

/** Calculates scores for all period types. @param {AwardRecord[]} awards Awards. @returns {AwardScores} Scores. */
window.calculateAwardsScores = function (awards) {
  return {
    year: window.calculateAwardsScore(awards, "years"),
    decade: window.calculateAwardsScore(awards, "decades"),
    century: window.calculateAwardsScore(awards, "centuries"),
    allTime: window.calculateAwardsScore(awards, "allTime"),
  };
};

function calculateAwardStats(awards) {
  let placements = awards.reduce(
    (counts, award) => {
      let placement = Number(award.placement);
      if (placement === 1) counts.wins += 1;
      if (placement === 2) counts.second += 1;
      if (placement === 3) counts.third += 1;
      return counts;
    },
    { wins: 0, second: 0, third: 0 },
  );

  let winningCategories = new Set(
    awards
      .filter((award) => Number(award.placement) === 1)
      .map((award) => award.category),
  );
  // The Big Five are Picture, Director, both lead acting awards, and either
  // screenplay category. Big 4 means winning any four of those five groups.
  let bigWins = [
    winningCategories.has("Best Picture"),
    winningCategories.has("Best Director"),
    winningCategories.has("Best Lead Actor"),
    winningCategories.has("Best Lead Actress"),
    winningCategories.has("Best Original Screenplay") ||
      winningCategories.has("Best Adapted Screenplay"),
  ].filter(Boolean).length;

  return Object.assign(placements, {
    nominations: awards.length,
    awardScore: window.calculateAwardsScore(awards),
    normalizedAwardScore: window.calculateNormalizedAwardsScore(awards),
    bigWin: bigWins === 5 ? "Big 5" : bigWins === 4 ? "Big 4" : "",
  });
}

/**
 * Calculates film award summary statistics filtered to an optional period and period type.
 * @param {FilmRecord} film Film record.
 * @param {string} [periodKey] Period key to filter awards.
 * @param {string} [periodType] Period type (e.g. 'decade', 'century') to resolve collisions.
 * @returns {Object} Award placement and score summary.
 */
window.getFilmStats = function getFilmStats(film, periodKey, periodType) {
  let awards = (film.awards || []).filter((award) =>
    isAwardVisibleForPeriod(award, periodKey, periodType),
  );
  return calculateAwardStats(awards);
};
