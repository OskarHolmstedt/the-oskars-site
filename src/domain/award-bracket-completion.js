/**
 * @file Computes per-period award-bracket completion (filled placement slots
 * per category), shared by the Data Health report and the Completion hub.
 */

function getImportedBracketPeriods() {
  return Object.entries(state.years || {})
    .map(([key, source]) => {
      let periodType =
        source.periodType || (/^\d{4}$/.test(key) ? "years" : "");
      if (!periodType) return null;
      let capacities =
        periodType === "years"
          ? [10, 5]
          : periodType === "decades"
            ? [20, 10]
            : periodType === "centuries"
              ? [40, 20]
              : periodType === "allTime"
                ? [50, 25]
                : null;
      return capacities
        ? {
            key,
            source,
            periodType,
            pictureCapacity: capacities[0],
            categoryCapacity: capacities[1],
          }
        : null;
    })
    .filter(Boolean);
}

// Build the imported-award working set once per Data Health collection. The
// bracket checks previously rescanned every film and award once per category,
// then scanned them all again for eligibility validation. Keep the source film
// for placement/tie semantics and the canonical film for validation.
function dataHealthBracketAwardIndex(periods) {
  let index = new Map();
  periods.forEach((period) => {
    let entries = [];
    let byCategory = new Map();
    (period.source.films || []).forEach((sourceFilm) => {
      let film = state.filmsById[sourceFilm.id] || sourceFilm;
      (sourceFilm.awards || []).forEach((award) => {
        if (
          String(award.year || "") !== period.key ||
          window.getAwardPeriodType(award) !== period.periodType
        )
          return;
        let entry = { sourceFilm, film, award };
        entries.push(entry);
        let categoryEntries = byCategory.get(award.category) || [];
        categoryEntries.push(entry);
        byCategory.set(award.category, categoryEntries);
      });
    });
    index.set(period, { entries, byCategory });
  });
  return index;
}

function computeBracketCompletion(
  bracketPeriods,
  bracketAwardIndex,
  orderedCategories,
) {
  return bracketPeriods.map((period) => {
    let periodAwards = bracketAwardIndex.get(period);
    let filledSlots = 0;
    let totalSlots = 0;
    let completeCategories = 0;
    orderedCategories.forEach((category) => {
      let capacity =
        category === "Best Picture"
          ? period.pictureCapacity
          : period.categoryCapacity;
      let awardEntries = periodAwards.byCategory.get(category) || [];
      let uniquePlacements = [
        ...new Set(
          awardEntries
            .map((entry) => Number(entry.award.placement))
            .filter(Number.isFinite),
        ),
      ];
      filledSlots += uniquePlacements.length;
      totalSlots += capacity;
      if (uniquePlacements.length === capacity) completeCategories += 1;
    });
    return {
      period: period.key,
      periodType: period.periodType,
      filledSlots,
      totalSlots,
      completeCategories,
      categoryCount: orderedCategories.length,
    };
  });
}

function computeAnnualCategoryCompletion(
  bracketPeriods,
  bracketAwardIndex,
  orderedCategories,
) {
  let annualPeriods = new Map(
    bracketPeriods
      .filter((period) => period.periodType === "years")
      .map((period) => [period.key, period]),
  );
  let watchedYears = new Set(
    Object.values(state.filmsById || {})
      .map((film) => String(film?.year || ""))
      .filter((year) => /^\d{4}$/.test(year)),
  );
  return orderedCategories.map((category) => {
    let capacity = category === "Best Picture" ? 10 : 5;
    let filledSlots = 0;
    let completePeriods = 0;
    watchedYears.forEach((year) => {
      let period = annualPeriods.get(year);
      let awardEntries =
        (period && bracketAwardIndex.get(period)?.byCategory.get(category)) ||
        [];
      let placements = new Set(
        awardEntries
          .map((entry) => Number(entry.award.placement))
          .filter(Number.isFinite),
      );
      filledSlots += placements.size;
      if (placements.size === capacity) completePeriods += 1;
    });
    let totalSlots = watchedYears.size * capacity;
    return {
      category,
      filledSlots,
      totalSlots,
      completePeriods,
      periodCount: watchedYears.size,
      percent: totalSlots ? Math.round((filledSlots / totalSlots) * 100) : 0,
    };
  });
}

/**
 * Award-bracket completion (filled placement slots per imported period) on
 * its own, independent of the rest of the Data Health diagnostic pass
 * (findings, eligibility, aliases, images) — used by the Completion hub.
 */
window.awardBracketCompletion = function () {
  let orderedCategories = getOrderedCategories();
  let bracketPeriods = getImportedBracketPeriods();
  let bracketAwardIndex = dataHealthBracketAwardIndex(bracketPeriods);
  return computeBracketCompletion(
    bracketPeriods,
    bracketAwardIndex,
    orderedCategories,
  );
};

/**
 * Aggregates annual bracket completion by category, counting only years that
 * contain at least one watched film.
 * @returns {Object[]} Category completion rows.
 */
window.awardBracketCategoryCompletion = function () {
  let orderedCategories = getOrderedCategories();
  let bracketPeriods = getImportedBracketPeriods();
  let bracketAwardIndex = dataHealthBracketAwardIndex(bracketPeriods);
  return computeAnnualCategoryCompletion(
    bracketPeriods,
    bracketAwardIndex,
    orderedCategories,
  );
};
