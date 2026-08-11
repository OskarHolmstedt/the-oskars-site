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

/** Calculates points only for annual awards. @param {AwardRecord} award Award. @returns {number} Points. */
window.annualAwardPoints = function (award) {
  return window.awardScorePeriodType(award) === "years"
    ? window.awardPoints(award)
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
    let year = window.filmConcreteYear?.(film?.year) || String(film?.year || "");
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
  return value === null || value === undefined || !Number.isFinite(Number(value))
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
  return [stars, window.formatRatingStatistic(numeric)].filter(Boolean).join(" ");
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

/** Calculates normalized scores for all period types. @param {AwardRecord[]} awards Awards. @returns {AwardScores} Scores. */
window.calculateNormalizedAwardsScores = function (awards) {
  return {
    year: window.calculateNormalizedAwardsScore(awards, "years"),
    decade: window.calculateNormalizedAwardsScore(awards, "decades"),
    century: window.calculateNormalizedAwardsScore(awards, "centuries"),
    allTime: window.calculateNormalizedAwardsScore(awards, "allTime"),
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

function getFilmStats(film, periodKey, periodType) {
  let awards = (film.awards || []).filter((award) =>
    isAwardVisibleForPeriod(award, periodKey, periodType),
  );
  return calculateAwardStats(awards);
}
