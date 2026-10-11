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
  let isRankTrackedCategory = (cat) => cat === "Best Picture";
  let capacity = isRankTrackedCategory(category)
    ? limits?.picture
    : limits?.category;
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
    errors.push(
      `${film.title} is already nominated for ${category} in ${key}.`,
    );
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
    errors.push(
      `Placement #${placement} already has ${occupants.length} films.`,
    );
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
          if (isRankTrackedCategory(category) && rankField) {
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
          if (isRankTrackedCategory(category) && rankField) {
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
  if (isRankTrackedCategory(category) && rankField) {
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
