/**
 * @file Owns previewable nomination insertion and removal of opinion data.
 * Manual film creation used to live here too (window.addFilm) - removed in
 * favor of Intake's guided workflow as the single path for adding a new
 * watched film, since the Editor version bypassed Intake's rating/ranking/
 * placement steps and (unlike Intake) never persisted the new film at all.
 */

function nominationPeriodIdentity(periodType, periodKey) {
  let key =
    periodType === "allTime" ? "alltime" : String(periodKey || "").trim();
  if (periodType === "years" && !/^\d{4}$/.test(key))
    throw new Error("Year must contain four digits.");
  if (
    (periodType === "decades" || periodType === "centuries") &&
    !/^\d{4}s$/.test(key)
  ) {
    throw new Error("Decade and century keys must look like 1980s or 1900s.");
  }
  return key;
}

function periodRankField(periodType) {
  return periodType === "years"
    ? "yearRank"
    : periodType === "decades"
      ? "decadeRank"
      : periodType === "centuries"
        ? "centuryRank"
        : null;
}

/** Builds a dry-run nomination insertion including shifts and overflow. @param {Object} values Nomination form values. @returns {NominationPlacementPlan} Insertion plan. */
window.planNominationInsertion = function (values = {}) {
  let periodType = values.periodType;
  let category = String(values.category || "").trim();
  let film =
    window.findFilmById(values.filmId) ||
    window.findWatchedFilmById?.(values.filmId);
  let key = "";
  let errors = [];
  try {
    key = nominationPeriodIdentity(periodType, values.periodKey);
  } catch (error) {
    errors.push(error.message);
  }
  if (!film) errors.push("Select a film.");
  let limits = window.PERIOD_LIMITS[periodType];
  if (!limits) errors.push("Unknown period type.");
  if (!category) errors.push("Select a category.");
  let capacity =
    category === "Best Picture" ? limits?.picture : limits?.category;
  let placement = Number(values.placement);
  if (
    capacity &&
    (!Number.isInteger(placement) || placement < 1 || placement > capacity)
  ) {
    errors.push(`Position must be between 1 and ${capacity}.`);
  }
  if (errors.length) {
    return window.createNominationPlacementPlan({
      operation: "insert",
      ok: false,
      periodType,
      periodKey: key,
      category,
      errors,
    });
  }

  let currentSource = window.state.years?.[key] || { films: [] };
  let nextSource = window.cloneRecord(currentSource);
  nextSource.films = (currentSource.films || []).map(window.cloneRecord);
  if (periodType !== "years") nextSource.periodType = periodType;
  let sourceFilm = nextSource.films.find(
    (candidate) =>
      candidate.id === film.id ||
      (String(candidate.year || "") === String(film.year || "") &&
        normalizeTitle(candidate.title) === normalizeTitle(film.title)),
  );
  // Acting categories and Best Song allow more than one nominee from the
  // same film (two supporting performances, two original songs) - only a
  // literal repeat of the same recipient blocks those; every other category
  // still allows just the one nomination per film per period.
  let multiNominee = window.isMultiNomineeCategory?.(category);
  let recipientKey = multiNominee
    ? window.awardRecipientKey({ recipientText: values.recipient })
    : "";
  if (
    sourceFilm &&
    (sourceFilm.awards || []).some(
      (award) =>
        award.category === category &&
        String(award.year || "") === key &&
        window.getAwardPeriodType(award) === periodType &&
        (!multiNominee || window.awardRecipientKey(award) === recipientKey),
    )
  ) {
    errors.push(`${film.title} is already nominated for ${category} in ${key}.`);
  }

  let award = window.setAwardRecipients(
    {
      category,
      placement,
      detail: String(values.detail || "").trim(),
      year: key,
      periodType,
    },
    values.recipient,
  );
  let validation = window.validateAward(film, award, { periodType });
  errors.push(...validation.errors);
  let warnings = [...validation.warnings];
  let tie = Boolean(values.tie);
  let occupants = nextSource.films.filter((candidate) =>
    (candidate.awards || []).some(
      (existing) =>
        existing.category === category &&
        String(existing.year || "") === key &&
        window.getAwardPeriodType(existing) === periodType &&
        Number(existing.placement) === placement,
    ),
  );
  if (tie && occupants.length >= 2)
    errors.push(`Placement #${placement} already has ${occupants.length} films.`);
  if (tie && occupants.length === 1)
    warnings.push(
      `${film.title} will share #${placement} with ${occupants[0].title}.`,
    );
  if (errors.length) {
    return window.createNominationPlacementPlan({
      operation: "insert",
      ok: false,
      periodType,
      periodKey: key,
      category,
      warnings,
      errors,
    });
  }

  if (!sourceFilm) {
    sourceFilm = window.cloneRecord(film);
    nextSource.films.push(sourceFilm);
  }
  sourceFilm.awards ||= [];
  let changes = [];
  let shifted = 0;
  let removed = [];
  let rankField = periodRankField(periodType);
  if (!tie) {
    nextSource.films.forEach((candidate) => {
      let awards = candidate.awards || [];
      for (let index = awards.length - 1; index >= 0; index--) {
        let existing = awards[index];
        if (
          existing.category !== category ||
          String(existing.year || "") !== key ||
          window.getAwardPeriodType(existing) !== periodType ||
          Number(existing.placement) < placement
        )
          continue;
        let before = Number(existing.placement);
        if (before >= capacity) {
          awards.splice(index, 1);
          removed.push({ title: candidate.title, placement: before });
          changes.push({
            filmId: candidate.id,
            title: candidate.title,
            before,
            after: null,
            kind: "removed",
          });
          if (category === "Best Picture" && rankField) {
            candidate[rankField] = null;
            candidate.rank = null;
          }
        } else {
          existing.placement = before + 1;
          shifted += 1;
          changes.push({
            filmId: candidate.id,
            title: candidate.title,
            before,
            after: existing.placement,
            kind: "moved",
          });
          if (category === "Best Picture" && rankField) {
            candidate[rankField] = existing.placement;
            candidate.rank = existing.placement;
          }
        }
      }
    });
  }

  sourceFilm.awards.push(award);
  changes.unshift({
    filmId: sourceFilm.id,
    title: film.title,
    before: null,
    after: placement,
    kind: "added",
  });
  if (category === "Best Picture" && rankField) {
    sourceFilm[rankField] = placement;
    sourceFilm.rank = placement;
  }
  if (periodType !== "allTime") {
    nextSource.films = nextSource.films.filter((candidate) =>
      (candidate.awards || []).some(
        (existing) => String(existing.year || "") === key,
      ),
    );
  }

  return window.createNominationPlacementPlan({
    operation: "insert",
    periodType,
    periodKey: key,
    category,
    changes,
    warnings,
    nextPeriods: { [key]: nextSource },
    editType: "nomination added",
    summary: `${film.title} (${key}) · ${category} #${placement}`,
    sheetHint: `${key} / ${category}`,
    context: { filmId: film.id, period: key, category, placement, tie },
    logChanges: [
      {
        field: "recipients",
        before: "",
        after: window.awardRecipientText(award),
      },
      { field: "detail", before: "", after: window.awardDetail(award) },
    ],
    result: { award, shifted, removed, warnings },
  });
};

/** Inserts a nomination through the shared placement-plan application path. @param {Object} values Nomination form values. @returns {Object} Insert result. */
window.insertNomination = function (values) {
  let plan = window.planNominationInsertion(values);
  window.lastRuleViolation = {
    valid: plan.ok,
    errors: plan.errors,
    warnings: plan.warnings,
  };
  if (!plan.ok) throw new Error(plan.errors.join("\n"));
  let result = window.applyNominationPlacementPlan(plan);
  if (!result.ok) throw new Error(result.reason || "Nomination was not added.");
  result.film =
    window.findFilmById(values.filmId) ||
    window.findWatchedFilmById?.(values.filmId);
  return result;
};

// Deletes every stored value that encodes a personal opinion (issue #75):
// award placements, star ratings, all rank fields, music-score opinion
// inputs, reviews, franchise membership ranks, watchlist interest tiers and
// hand-made order, rewatch intent, watched-other ratings, entity notes, local
// rank orders (issue #165), and cross-source conflict records. Factual data
// stays: which films were watched (and when/where), credits, countries,
// runtimes, tags, franchise memberships, projects, aliases, and a separate
// music-quality star rating where the app wants to store it.
/** Removes every persisted personal-opinion field while preserving factual data. @returns {Record<string, number>} Removal counts. */
window.clearOpinionData = function () {
  let report = {
    films: 0,
    awards: 0,
    ratings: 0,
    ranks: 0,
    reviews: 0,
    rewatchIntents: 0,
    scores: 0,
    franchiseRanks: 0,
    tiers: 0,
    watchedOtherRatings: 0,
    notes: 0,
    localRanks: 0,
    rankingReviews: 0,
    awardReviews: 0,
    sourceConflicts: 0,
  };
  const RANK_FIELDS = [
    "rank",
    "yearRank",
    "decadeRank",
    "centuryRank",
    "allTimeRank",
  ];

  function clearFranchiseRanks(memberships) {
    (memberships || []).forEach((membership) => {
      if (membership && membership.rank != null) {
        membership.rank = null;
        report.franchiseRanks += 1;
      }
    });
  }

  Object.values(state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      let touched = false;
      if ((film.awards || []).length) {
        report.awards += film.awards.length;
        film.awards = [];
        touched = true;
      }
      if (film.rating || film.ratingValue || film.ratingModifier) {
        report.ratings += 1;
        delete film.rating;
        delete film.ratingValue;
        delete film.ratingModifier;
        touched = true;
      }
      // Rank fields aren't deleted here - they're derived projections of
      // one global all-time order, so they get reset (not blanked) below
      // via resetRankingToDefaultOrder, after ratings/awards are cleared.
      if (RANK_FIELDS.some((field) => film[field] != null && film[field] !== ""))
        touched = true;
      if (film.suppressAllTimeRank !== undefined) {
        delete film.suppressAllTimeRank;
        touched = true;
      }
      if (film.rankingGroupId || film.rankingGroupTitle) {
        delete film.rankingGroupId;
        delete film.rankingGroupTitle;
        touched = true;
      }
      if (film.rankConfirmed !== undefined) {
        delete film.rankConfirmed;
        touched = true;
      }
      if (film.review) {
        report.reviews += 1;
        delete film.review;
        touched = true;
      }
      if (film.wantToRewatch) {
        report.rewatchIntents += 1;
        delete film.wantToRewatch;
        delete film.rewatchTier;
        touched = true;
      }
      if (film.musicScore != null) {
        report.scores += 1;
        film.musicScore = null;
        touched = true;
      }
      if (
        film.musicRating ||
        film.musicRatingValue != null ||
        Object.prototype.hasOwnProperty.call(film, "musicRating") ||
        Object.prototype.hasOwnProperty.call(film, "musicRatingValue")
      ) {
        report.ratings += 1;
        delete film.musicRating;
        delete film.musicRatingValue;
        touched = true;
      }
      clearFranchiseRanks(film.franchises);
      if (touched) report.films += 1;
    });
  });

  (state.watchlist || []).forEach((item) => {
    if (window.normalizeWatchlistTier?.(item.tier)) {
      report.tiers += 1;
    }
    item.tier = "";
    delete item.order;
    clearFranchiseRanks(item.franchises);
  });

  (state.watchedOther || []).forEach((entry) => {
    if (entry.rating || entry.ratingValue != null) {
      report.watchedOtherRatings += 1;
      entry.rating = "";
      entry.ratingValue = null;
    }
    if (entry.wantToRewatch) {
      report.rewatchIntents += 1;
      delete entry.wantToRewatch;
      delete entry.rewatchTier;
    }
  });

  Object.keys(state.entityNotes || {}).forEach((group) => {
    report.notes += Object.keys(state.entityNotes[group] || {}).length;
    state.entityNotes[group] = {};
  });

  Object.keys(state.localRanks || {}).forEach((group) => {
    report.localRanks += Object.keys(state.localRanks[group] || {}).length;
    state.localRanks[group] = {};
  });

  Object.values(state.rankingReviews || {}).forEach((scopes) => {
    Object.values(scopes || {}).forEach((keys) => {
      report.rankingReviews += (keys || []).length;
    });
  });
  state.rankingReviews = { years: {}, decades: {}, centuries: {}, allTime: {} };

  Object.values(state.awardReviews?.years || {}).forEach((categories) => {
    report.awardReviews += Object.keys(categories || {}).length;
  });
  state.awardReviews = { years: {} };

  report.sourceConflicts = (state.sourceConflicts || []).length;
  state.sourceConflicts = [];

  report.ranks = window.resetRankingToDefaultOrder?.().changed || 0;
  window.recomputeWatchlistOrder?.();
  window.rebuildAggregates?.();
  return report;
};

/**
 * Removes award records matching a period-type + release-year scope,
 * leaving ratings/ranks/reviews/etc untouched. Every period-copy of a film
 * carries the full union of that film's awards, so - like
 * clearOpinionData above - this iterates state.years period by period and
 * filters each copy's own awards array; each award's own periodType/year
 * (via getAwardPeriodType's fallback pattern) decides its scope, not
 * whichever period bucket happens to be iterating it.
 * @param {Object} [options] Scope controls.
 * @param {Iterable<string>} [options.periodTypes] "years"|"decades"|"centuries"|"allTime" to remove; default: all four.
 * @param {number} [options.fromYear] Inclusive lower release-year bound.
 * @param {number} [options.toYear] Inclusive upper release-year bound.
 * @returns {{removed: number}} Count of distinct nominations removed.
 */
window.clearAwardsInScope = function (options = {}) {
  let periodTypes = new Set(
    options.periodTypes || ["years", "decades", "centuries", "allTime"],
  );
  let fromYear = Number.isFinite(options.fromYear)
    ? options.fromYear
    : -Infinity;
  let toYear = Number.isFinite(options.toYear) ? options.toYear : Infinity;

  function periodSpan(periodType, key) {
    if (periodType === "years") {
      let year = Number(key);
      return Number.isFinite(year) ? [year, year] : null;
    }
    if (periodType === "decades" || periodType === "centuries") {
      let year = parseInt(key, 10);
      if (!Number.isFinite(year)) return null;
      return [year, year + (periodType === "decades" ? 9 : 99)];
    }
    return null;
  }

  function matchesScope(award) {
    let periodType = window.getAwardPeriodType(award);
    if (!periodTypes.has(periodType)) return false;
    if (periodType === "allTime") return true;
    let span = periodSpan(periodType, String(award.year || ""));
    return Boolean(span) && span[0] <= toYear && span[1] >= fromYear;
  }

  let removedKeys = new Set();
  Object.values(state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      if (!(film.awards || []).length) return;
      film.awards = film.awards.filter((award) => {
        if (!matchesScope(award)) return true;
        removedKeys.add(
          `${film.id}::${award.category}::${award.placement}::${window.getAwardPeriodType(award)}::${award.year}`,
        );
        return false;
      });
    });
  });

  window.rebuildAggregates?.();
  return { removed: removedKeys.size };
};
