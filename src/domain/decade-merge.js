/**
 * @file Collects period-category merge candidates (annual→decade,
 * decade→century, century→all-time) and plans explicit category
 * replacement through the shared nomination plan boundary. One generic
 * core (issue #140) backs three named public entry points so the
 * completed annual→decade path (issue #126) keeps its exact behavior,
 * wording, and test contract while decade→century and century→all-time
 * reuse the same candidate-dedup, validation, and apply machinery.
 */

(function () {
  function periodAward(award, periodKey, category, periodType) {
    return (
      award?.category === category &&
      String(award.year || "") === periodKey &&
      window.getAwardPeriodType(award, periodType) === periodType
    );
  }

  function candidateKey(film) {
    return (
      window.filmIdentityKey?.(film, { canonical: true }) ||
      `${String(film?.year || "")}\n${window.normalizeTitle(film?.title || "")}`
    );
  }

  function periodKeySortValue(key) {
    return Number(String(key || "").replace(/s$/, "")) || 0;
  }

  function decadeYears(decadeKey) {
    let match = String(decadeKey || "").match(/^(\d{4})s$/);
    if (!match) return [];
    let first = Number(match[1]);
    return Array.from({ length: 10 }, (_, index) => String(first + index));
  }

  // A decade key and a century key are byte-identical whenever the decade
  // starts a century (getDecadeKey(1900) === getCenturyKey(1900) === "1900s"),
  // since state.years is one flat map keyed by that string, that slot can
  // only ever hold one record. The periodType check in collectPeriodMerge­
  // Candidates/periodMergeCategories below already excludes it correctly
  // when it holds the century itself rather than a decade - that century's
  // first decade simply contributes no candidates, same as any other
  // unpopulated child period.
  function centuryDecadeKeys(centuryKey) {
    let match = /^(\d+)00s$/.exec(String(centuryKey || ""));
    if (!match) return [];
    let start = Number(match[1]) * 100;
    return Array.from({ length: 10 }, (_, index) =>
      window.getDecadeKey(String(start + index * 10)),
    );
  }

  function allTimeCenturyKeys() {
    return Object.keys(window.state.years || {})
      .filter((key) => window.state.years[key]?.periodType === "centuries")
      .sort((left, right) => periodKeySortValue(left) - periodKeySortValue(right));
  }

  let MERGE_LEVELS = {
    decades: {
      periodType: "decades",
      childPeriodType: "years",
      childKeys: decadeYears,
      sourceAdjective: "annual",
      destinationNoun: "decade",
      rankField: "decadeRank",
      editType: "decade category merge",
      heading: "",
      sourceUnitError: "needs a valid annual source year",
    },
    centuries: {
      periodType: "centuries",
      childPeriodType: "decades",
      childKeys: centuryDecadeKeys,
      sourceAdjective: "decade",
      destinationNoun: "century",
      rankField: "centuryRank",
      editType: "century category merge",
      heading: "Merge decade category?",
      sourceUnitError: "needs a valid decade source",
    },
    allTime: {
      periodType: "allTime",
      childPeriodType: "centuries",
      childKeys: allTimeCenturyKeys,
      sourceAdjective: "century",
      destinationNoun: "all-time bracket",
      rankField: "allTimeRank",
      editType: "all-time category merge",
      heading: "Merge century category?",
      sourceUnitError: "needs a valid century source",
    },
  };

  function periodMergeCategories(level, destKey) {
    let found = new Set();
    level.childKeys(destKey).forEach((childKey) => {
      let period = window.state.years?.[childKey];
      if (!period?.films?.length || period.periodType !== level.childPeriodType)
        return;
      period.films.forEach((film) =>
        (film.awards || []).forEach((award) => {
          if (
            award.category &&
            periodAward(award, childKey, award.category, level.childPeriodType)
          )
            found.add(award.category);
        }),
      );
    });
    let ordered = window.getOrderedCategories?.() || [];
    return [
      ...ordered.filter((category) => found.has(category)),
      ...[...found].filter((category) => !ordered.includes(category)).sort(),
    ];
  }

  function collectPeriodMergeCandidates(level, destKey, category) {
    let byIdentity = new Map();
    level.childKeys(destKey).forEach((childKey) => {
      let period = window.state.years?.[childKey];
      if (!period?.films?.length || period.periodType !== level.childPeriodType)
        return;
      period.films.forEach((film) => {
        (film.awards || []).forEach((award) => {
          if (!periodAward(award, childKey, category, level.childPeriodType))
            return;
          let identity = candidateKey(film);
          let candidate = byIdentity.get(identity);
          if (!candidate) {
            candidate = {
              filmId: film.id || identity,
              identity,
              title: film.title || "Untitled",
              year: film.year || "",
              film: window.cloneRecord(film),
              sources: [],
            };
            byIdentity.set(identity, candidate);
          }
          candidate.sources.push({
            year: childKey,
            placement: Number(award.placement),
            award: window.cloneRecord(award),
          });
        });
      });
    });
    return [...byIdentity.values()]
      .map((candidate) => {
        candidate.sources.sort(
          (left, right) =>
            periodKeySortValue(left.year) - periodKeySortValue(right.year) ||
            left.placement - right.placement,
        );
        candidate.primaryYear = candidate.sources[0]?.year || "";
        return candidate;
      })
      .sort(
        (left, right) =>
          periodKeySortValue(left.primaryYear) -
            periodKeySortValue(right.primaryYear) ||
          left.sources[0].placement - right.sources[0].placement ||
          left.title.localeCompare(right.title),
      );
  }

  function periodMergeEmptyPlan(level, destKey, category, errors) {
    return window.createNominationPlacementPlan({
      operation: "merge",
      ok: false,
      periodType: level.periodType,
      periodKey: destKey,
      category,
      errors,
      heading: level.heading,
    });
  }

  function sameCandidate(film, candidate) {
    return candidateKey(film) === candidate.identity;
  }

  function awardCredit(award) {
    return JSON.stringify({
      recipient: award?.recipient || award?.recipients || "",
      detail: award?.detail || "",
    });
  }

  function awardCreditText(award) {
    return (
      [window.awardRecipientText?.(award), award?.detail]
        .filter(Boolean)
        .join(" · ") || "none"
    );
  }

  /** Builds a non-mutating period-category replacement plan. @param {Object} level Merge level descriptor. @param {Object} values Merge selection. @returns {NominationPlacementPlan} Merge plan. */
  function planPeriodCategoryMerge(level, values = {}) {
    let destKey = String(values.periodKey || "");
    let category = String(values.category || "");
    let childKeys = level.childKeys(destKey);
    if (!childKeys.length)
      return periodMergeEmptyPlan(level, destKey, category, [
        `Invalid ${level.destinationNoun}.`,
      ]);
    let categories = periodMergeCategories(level, destKey);
    if (!category || !categories.includes(category))
      return periodMergeEmptyPlan(level, destKey, category, [
        `Category has no ${level.sourceAdjective} candidates in this ${level.destinationNoun}.`,
      ]);
    let currentTarget = window.state.years?.[destKey];
    if (currentTarget?.periodType && currentTarget.periodType !== level.periodType)
      return periodMergeEmptyPlan(level, destKey, category, [
        "The target key belongs to a different period type.",
      ]);

    let candidates = collectPeriodMergeCandidates(level, destKey, category);
    let candidateById = new Map(
      candidates.map((candidate) => [candidate.filmId, candidate]),
    );
    let selections = (values.assignments || []).map((assignment) => ({
      filmId: String(assignment.filmId || ""),
      placement: Number(assignment.placement),
      sourceYear: String(assignment.sourceYear || ""),
    }));
    let errors = [];
    let warnings = [];
    if (!selections.length)
      errors.push(`Select at least one ${level.sourceAdjective} candidate.`);
    let selectedIds = new Set();
    let placementCounts = new Map();
    let capacities = window.bracketCapacities(level.periodType);
    let capacity =
      category === "Best Picture" ? capacities.picture : capacities.category;
    selections.forEach((selection) => {
      let candidate = candidateById.get(selection.filmId);
      if (!candidate) {
        errors.push(
          `A selected candidate is not in the ${level.sourceAdjective} source pool.`,
        );
        return;
      }
      if (selectedIds.has(selection.filmId))
        errors.push(`${candidate.title} is selected more than once.`);
      selectedIds.add(selection.filmId);
      if (
        !Number.isInteger(selection.placement) ||
        selection.placement < 1 ||
        selection.placement > capacity
      )
        errors.push(
          `${candidate.title} placement must be between 1 and ${capacity}.`,
        );
      placementCounts.set(
        selection.placement,
        (placementCounts.get(selection.placement) || 0) + 1,
      );
      let source = candidate.sources.find(
        (item) => item.year === selection.sourceYear,
      );
      if (!source) errors.push(`${candidate.title} ${level.sourceUnitError}.`);
      else {
        let validationFilm = window.cloneRecord(candidate.film);
        let validationAward = Object.assign({}, source.award, {
          year: destKey,
          periodType: level.periodType,
          category,
          placement: selection.placement,
        });
        let validation = window.validateAward(validationFilm, validationAward, {
          periodType: level.periodType,
        });
        validation.errors.forEach((error) =>
          errors.push(`${candidate.title}: ${error}`),
        );
        validation.warnings.forEach((warning) =>
          warnings.push(`${candidate.title}: ${warning}`),
        );
      }
    });
    placementCounts.forEach((count, placement) => {
      if (count > 2) errors.push(`Placement #${placement} is shared by ${count} films.`);
    });
    let used = [...placementCounts.keys()]
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    if (used.length && used.some((placement, index) => placement !== index + 1))
      errors.push("Placements must be dense from #1 through the highest placement.");
    if (errors.length)
      return window.createNominationPlacementPlan({
        operation: "merge",
        ok: false,
        periodType: level.periodType,
        periodKey: destKey,
        category,
        warnings,
        errors,
        heading: level.heading,
      });

    let target = currentTarget
      ? window.cloneRecord(currentTarget)
      : { films: [], periodType: level.periodType };
    target.periodType = level.periodType;
    target.films ||= [];
    let existing = [];
    target.films.forEach((film) => {
      (film.awards || []).forEach((award) => {
        if (periodAward(award, destKey, category, level.periodType))
          existing.push({ film, award: window.cloneRecord(award) });
      });
      film.awards = (film.awards || []).filter(
        (award) => !periodAward(award, destKey, category, level.periodType),
      );
      if (category === "Best Picture" && existing.some((entry) => entry.film === film)) {
        film[level.rankField] = null;
        film.rank = null;
      }
    });

    let selectedResults = [];
    selections.sort(
      (left, right) =>
        left.placement - right.placement ||
        candidateById.get(left.filmId).title.localeCompare(
          candidateById.get(right.filmId).title,
        ),
    );
    selections.forEach((selection) => {
      let candidate = candidateById.get(selection.filmId);
      let source = candidate.sources.find(
        (item) => item.year === selection.sourceYear,
      );
      let targetFilm = target.films.find((film) => sameCandidate(film, candidate));
      if (!targetFilm) {
        targetFilm = window.cloneRecord(candidate.film);
        targetFilm.awards = [];
        target.films.push(targetFilm);
      }
      let award = Object.assign({}, window.cloneRecord(source.award), {
        year: destKey,
        periodType: level.periodType,
        category,
        placement: selection.placement,
      });
      targetFilm.awards ||= [];
      targetFilm.awards.push(award);
      if (category === "Best Picture") {
        targetFilm[level.rankField] = selection.placement;
        targetFilm.rank = selection.placement;
      }
      selectedResults.push({ candidate, source, award });
    });
    target.films = target.films.filter(
      (film) => (film.awards || []).length || film.sourceUrl,
    );

    let nextPeriods = { [destKey]: target };
    Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
      if (periodKey === destKey) return;
      let next = window.cloneRecord(period);
      let changed = false;
      next.films = (next.films || [])
        .map((film) => {
          let before = (film.awards || []).length;
          film.awards = (film.awards || []).filter(
            (award) => !periodAward(award, destKey, category, level.periodType),
          );
          if (film.awards.length !== before) changed = true;
          return film;
        })
        .filter((film) => (film.awards || []).length || film.sourceUrl);
      if (changed) nextPeriods[periodKey] = next;
    });

    let previousByIdentity = new Map(
      existing.map((entry) => [candidateKey(entry.film), entry]),
    );
    let resultByIdentity = new Map(
      selectedResults.map((entry) => [entry.candidate.identity, entry]),
    );
    let changes = [];
    existing.forEach((entry) => {
      let result = resultByIdentity.get(candidateKey(entry.film));
      if (!result)
        changes.push({
          filmId: entry.film.id,
          title: entry.film.title,
          before: entry.award.placement,
          after: 0,
          kind: "removed",
        });
    });
    selectedResults.forEach((entry) => {
      let previous = previousByIdentity.get(entry.candidate.identity);
      if (!previous || Number(previous.award.placement) !== Number(entry.award.placement))
        changes.push({
          filmId: entry.candidate.filmId,
          title: entry.candidate.title,
          before: previous?.award.placement || 0,
          after: entry.award.placement,
          kind: previous ? "moved" : "added",
        });
    });
    let duplicates = candidates.filter((candidate) => candidate.sources.length > 1);
    let notes = [
      `${candidates.length} candidate(s) from ${childKeys[0]}–${childKeys[childKeys.length - 1]}.`,
      existing.length
        ? `Existing bracket: ${existing.map((entry) => `#${entry.award.placement} ${entry.film.title}`).join("; ")}.`
        : "Existing bracket: empty.",
      ...duplicates.map(
        (candidate) =>
          `${candidate.title} appears in ${candidate.sources.map((source) => `${source.year} #${source.placement}`).join(" and ")}.`,
      ),
      ...selectedResults.map(
        (entry) =>
          `#${entry.award.placement} ${entry.candidate.title} ← ${entry.source.year} ${level.sourceAdjective} #${entry.source.placement}.`,
      ),
      ...selectedResults.flatMap((entry) => {
        let previous = previousByIdentity.get(entry.candidate.identity);
        return previous && awardCredit(previous.award) !== awardCredit(entry.award)
          ? [
              `${entry.candidate.title} credit: ${awardCreditText(previous.award)} → ${awardCreditText(entry.award)}.`,
            ]
          : [];
      }),
      ...[...placementCounts.entries()]
        .filter(([, count]) => count === 2)
        .map(([placement]) => `Tie at #${placement}.`),
    ];
    let logChanges = selectedResults.flatMap((entry) => {
      let previous = previousByIdentity.get(entry.candidate.identity);
      return previous && awardCredit(previous.award) !== awardCredit(entry.award)
        ? [
            {
              field: `${entry.candidate.title} credit`,
              before: awardCredit(previous.award),
              after: awardCredit(entry.award),
            },
          ]
        : [];
    });
    return window.createNominationPlacementPlan({
      operation: "merge",
      periodType: level.periodType,
      periodKey: destKey,
      category,
      changes,
      notes,
      warnings,
      nextPeriods,
      logChanges,
      sourceKeys: childKeys.filter((key) => window.state.years?.[key]),
      editType: level.editType,
      summary: `${destKey} · ${category}`,
      sheetHint: `${destKey} / ${category}`,
      heading: level.heading,
      context: { period: destKey, category, sourceYears: childKeys },
      result: { candidates, selections, duplicates, existing },
    });
  }

  /** Returns categories found in the decade's populated annual brackets. @param {string} decadeKey Decade key. @returns {string[]} Categories. */
  window.decadeAnnualCategories = function (decadeKey) {
    return periodMergeCategories(MERGE_LEVELS.decades, decadeKey);
  };

  /** Collects canonically deduplicated annual candidates with source provenance. @param {string} decadeKey Decade key. @param {string} category Category. @returns {Object[]} Candidates. */
  window.collectDecadeCategoryCandidates = function (decadeKey, category) {
    return collectPeriodMergeCandidates(MERGE_LEVELS.decades, decadeKey, category);
  };

  /** Builds a non-mutating annual-to-decade category replacement plan. @param {Object} values Merge selection ({decadeKey, category, assignments}). @returns {NominationPlacementPlan} Merge plan. */
  window.planDecadeCategoryMerge = function (values = {}) {
    return planPeriodCategoryMerge(
      MERGE_LEVELS.decades,
      Object.assign({}, values, { periodKey: values.decadeKey }),
    );
  };

  /** Returns categories found in the century's populated decade brackets. @param {string} centuryKey Century key. @returns {string[]} Categories. */
  window.centuryDecadeCategories = function (centuryKey) {
    return periodMergeCategories(MERGE_LEVELS.centuries, centuryKey);
  };

  /** Collects canonically deduplicated decade candidates with source provenance. @param {string} centuryKey Century key. @param {string} category Category. @returns {Object[]} Candidates. */
  window.collectCenturyDecadeCandidates = function (centuryKey, category) {
    return collectPeriodMergeCandidates(MERGE_LEVELS.centuries, centuryKey, category);
  };

  /** Builds a non-mutating decade-to-century category replacement plan. @param {Object} values Merge selection ({centuryKey, category, assignments}). @returns {NominationPlacementPlan} Merge plan. */
  window.planCenturyDecadeMerge = function (values = {}) {
    return planPeriodCategoryMerge(
      MERGE_LEVELS.centuries,
      Object.assign({}, values, { periodKey: values.centuryKey }),
    );
  };

  /** Returns categories found in the archive's populated century brackets. @returns {string[]} Categories. */
  window.allTimeCenturyCategories = function () {
    return periodMergeCategories(MERGE_LEVELS.allTime, "alltime");
  };

  /** Collects canonically deduplicated century candidates with source provenance. @param {string} category Category. @returns {Object[]} Candidates. */
  window.collectAllTimeCenturyCandidates = function (category) {
    return collectPeriodMergeCandidates(MERGE_LEVELS.allTime, "alltime", category);
  };

  /** Builds a non-mutating century-to-all-time category replacement plan. @param {Object} values Merge selection ({category, assignments}). @returns {NominationPlacementPlan} Merge plan. */
  window.planAllTimeCenturyMerge = function (values = {}) {
    return planPeriodCategoryMerge(
      MERGE_LEVELS.allTime,
      Object.assign({}, values, { periodKey: "alltime" }),
    );
  };
})();
