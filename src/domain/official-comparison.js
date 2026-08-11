/** @file Derives personal Oskars winner agreement with annual official award results. */

(function () {
  function categoryOrder(left, right) {
    return (
      window.categorySortIndex(left) - window.categorySortIndex(right) ||
      left.localeCompare(right)
    );
  }

  function compatibleFilmId(nomination, representedYears) {
    let filmRef = nomination?.filmRef;
    return filmRef?.id && representedYears.has(String(filmRef.year || ""))
      ? filmRef.id
      : "";
  }

  /**
   * Compares personal placement-one films with official winners for one annual period.
   * @param {Object} input Comparison inputs.
   * @param {string} input.periodKey Official annual or historical-span period key.
   * @param {PeriodAwardEntry[]} input.personalEntries Personal annual award entries.
   * @param {OfficialResultsPeriod|null} input.officialPeriod Official results for the period.
   * @returns {OfficialAwardPeriodComparison} Derived comparison model.
   */
  window.officialAwardPeriodComparison = function ({
    periodKey,
    personalEntries,
    officialPeriod,
  }) {
    let representedYears = new Set(
      window.officialResultPeriodYears(periodKey),
    );
    let personalWinnersByCategory = new Map();
    (personalEntries || [])
      .filter((entry) => Number(entry?.award?.placement) === 1)
      .sort(
        (left, right) =>
          categoryOrder(left.award.category, right.award.category) ||
          String(left.film?.id || "").localeCompare(
            String(right.film?.id || ""),
          ),
      )
      .forEach((entry) => {
        if (!personalWinnersByCategory.has(entry.award.category))
          personalWinnersByCategory.set(entry.award.category, entry);
      });

    let officialWinnersByCategory = new Map();
    (officialPeriod?.nominations || [])
      .filter((nomination) => nomination.winner)
      .forEach((nomination) => {
        let entries =
          officialWinnersByCategory.get(nomination.category) || [];
        entries.push(nomination);
        officialWinnersByCategory.set(nomination.category, entries);
      });

    let categoryNames = [
      ...new Set([
        ...personalWinnersByCategory.keys(),
        ...officialWinnersByCategory.keys(),
      ]),
    ].sort(categoryOrder);
    let categories = categoryNames.map((category) => {
      let personalWinner = personalWinnersByCategory.get(category) || null;
      let personalFilmIds = personalWinner
        ? [personalWinner.film?.id, personalWinner.award?.sourceFilmId]
            .map((value) => String(value || ""))
            .filter((value, index, values) =>
              value ? values.indexOf(value) === index : false,
            )
        : [];
      let officialWinners = officialWinnersByCategory.get(category) || [];
      let comparableOfficialWinners = officialWinners.filter((nomination) =>
        Boolean(compatibleFilmId(nomination, representedYears)),
      );
      let comparable =
        personalFilmIds.length > 0 && comparableOfficialWinners.length > 0;
      let agreement =
        comparable &&
        comparableOfficialWinners.some((nomination) =>
          personalFilmIds.includes(
            compatibleFilmId(nomination, representedYears),
          ),
        );
      return {
        category,
        personalWinner,
        personalFilmIds,
        officialWinners,
        comparableOfficialWinners,
        status: comparable
          ? agreement
            ? "agreement"
            : "disagreement"
          : "unresolved",
      };
    });
    let categoriesByName = new Map(
      categories.map((entry) => [entry.category, entry]),
    );
    let comparedCategories = categories.filter(
      (entry) => entry.status !== "unresolved",
    );
    let matches = comparedCategories.filter(
      (entry) => entry.status === "agreement",
    ).length;
    return {
      periodKey,
      representedYears: [...representedYears],
      categories,
      categoriesByName,
      matches,
      differences: comparedCategories.length - matches,
      comparedCount: comparedCategories.length,
      agreementPercent: comparedCategories.length
        ? Math.round((matches / comparedCategories.length) * 100)
        : 0,
    };
  };

  /**
   * Aggregates annual personal-vs-official agreement across one category.
   * @param {Object} input Comparison inputs.
   * @param {string} input.category Canonical award category.
   * @param {PeriodAwardEntry[]} input.personalEntries Personal category entries.
   * @param {OfficialResultsSource|null} input.officialSource Academy Awards source.
   * @returns {OfficialAwardCategoryHistoryComparison} Derived category history.
   */
  window.officialAwardCategoryHistoryComparison = function ({
    category,
    personalEntries,
    officialSource,
  }) {
    let personalEntriesByPeriod = new Map();
    (personalEntries || [])
      .filter((entry) => entry?.award?.category === category)
      .forEach((entry) => {
        let periodKey = String(entry.award.year || "");
        let entries = personalEntriesByPeriod.get(periodKey) || [];
        entries.push(entry);
        personalEntriesByPeriod.set(periodKey, entries);
      });
    let periods = Object.entries(officialSource?.periods || {})
      .map(([periodKey, period]) => [
        periodKey,
        period,
        (period?.nominations || []).filter(
          (nomination) => nomination.category === category,
        ),
      ])
      .filter(([, , nominations]) => nominations.length)
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .map(([periodKey, officialPeriod, officialNominations]) => {
        let periodComparison = window.officialAwardPeriodComparison({
          periodKey,
          personalEntries: personalEntriesByPeriod.get(periodKey) || [],
          officialPeriod: Object.assign({}, officialPeriod, {
            nominations: officialNominations,
          }),
        });
        let categoryComparison =
          periodComparison.categoriesByName.get(category) || {
            category,
            personalWinner: null,
            personalFilmIds: [],
            officialWinners: [],
            comparableOfficialWinners: [],
            status: "unresolved",
          };
        return {
          periodKey,
          representedYears: periodComparison.representedYears,
          categoryComparison,
          periodComparison,
          status: categoryComparison.status,
        };
      });
    let comparedPeriods = periods.filter(
      (period) => period.status !== "unresolved",
    );
    let matches = comparedPeriods.filter(
      (period) => period.status === "agreement",
    ).length;
    return {
      category,
      periods,
      periodsByKey: new Map(periods.map((period) => [period.periodKey, period])),
      matches,
      differences: comparedPeriods.length - matches,
      comparedCount: comparedPeriods.length,
      agreementPercent: comparedPeriods.length
        ? Math.round((matches / comparedPeriods.length) * 100)
        : 0,
    };
  };

  function agreementBreakdown(records, keyForRecord) {
    let grouped = new Map();
    records.forEach((record) => {
      let key = keyForRecord(record);
      if (!key) return;
      let row = grouped.get(key) || {
        key,
        matches: 0,
        differences: 0,
        comparedCount: 0,
        agreementPercent: 0,
      };
      row.comparedCount += 1;
      if (record.status === "agreement") row.matches += 1;
      else row.differences += 1;
      grouped.set(key, row);
    });
    return [...grouped.values()].map((row) =>
      Object.assign(row, {
        agreementPercent: Math.round(
          (row.matches / row.comparedCount) * 100,
        ),
      }),
    );
  }

  /**
   * Aggregates all comparable annual category results for Statistics.
   * @param {Object} input Comparison inputs.
   * @param {PeriodAwardEntry[]} input.personalEntries Personal annual entries.
   * @param {OfficialResultsSource|null} input.officialSource Academy Awards source.
   * @returns {OfficialAwardAgreementStatistics} Overall and grouped agreement.
   */
  window.officialAwardAgreementStatistics = function ({
    personalEntries,
    officialSource,
  }) {
    let personalEntriesByPeriod = new Map();
    (personalEntries || []).forEach((entry) => {
      let periodKey = String(entry?.award?.year || "");
      if (!periodKey) return;
      let entries = personalEntriesByPeriod.get(periodKey) || [];
      entries.push(entry);
      personalEntriesByPeriod.set(periodKey, entries);
    });
    let records = [];
    let comparedPeriodKeys = new Set();
    Object.entries(officialSource?.periods || {})
      .sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      )
      .forEach(([periodKey, officialPeriod]) => {
        let comparison = window.officialAwardPeriodComparison({
          periodKey,
          personalEntries: personalEntriesByPeriod.get(periodKey) || [],
          officialPeriod,
        });
        let comparedCategories = comparison.categories.filter(
          (category) => category.status !== "unresolved",
        );
        if (comparedCategories.length) comparedPeriodKeys.add(periodKey);
        comparedCategories.forEach((category) =>
          records.push({
            periodKey,
            representedYears: comparison.representedYears,
            category: category.category,
            status: category.status,
          }),
        );
      });
    let matches = records.filter(
      (record) => record.status === "agreement",
    ).length;
    let categoryRows = agreementBreakdown(
      records,
      (record) => record.category,
    ).sort(
      (left, right) =>
        right.agreementPercent - left.agreementPercent ||
        right.comparedCount - left.comparedCount ||
        categoryOrder(left.key, right.key),
    );
    let decadeRows = agreementBreakdown(records, (record) => {
      let years = record.representedYears || [];
      let endYear = years[years.length - 1];
      return /^\d{4}$/.test(String(endYear || ""))
        ? window.getDecadeKey(endYear)
        : "";
    }).sort((left, right) =>
      right.key.localeCompare(left.key, undefined, { numeric: true }),
    );
    return {
      matches,
      differences: records.length - matches,
      comparedCount: records.length,
      agreementPercent: records.length
        ? Math.round((matches / records.length) * 100)
        : 0,
      categoryCount: categoryRows.length,
      periodCount: comparedPeriodKeys.size,
      categoryRows,
      decadeRows,
    };
  };

  /**
   * Reports whether an official nomination is the personal winner for its category.
   * @param {OfficialNomination} nomination Official nomination.
   * @param {OfficialAwardPeriodComparison|null} comparison Annual comparison model.
   * @returns {boolean} Whether the canonical, year-compatible film ids match.
   */
  window.officialNominationIsPersonalPick = function (
    nomination,
    comparison,
  ) {
    let category = comparison?.categoriesByName?.get(nomination?.category);
    if (!category?.personalFilmIds?.length) return false;
    let filmId = compatibleFilmId(
      nomination,
      new Set(comparison.representedYears || []),
    );
    return Boolean(filmId && category.personalFilmIds.includes(filmId));
  };
})();
