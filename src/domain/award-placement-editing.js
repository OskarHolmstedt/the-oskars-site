/** @file Plans and applies award-placement reorder and nomination-deletion edits through the shared placement-plan pipeline. */

/** Builds a dry-run dense reorder within one period and category. @param {string} year Period key. @param {string} category Category. @param {string} fromFilmId Moved film id. @param {number} fromPlacement Old placement. @param {string} toFilmId Target film id. @param {number} toPlacement Target placement. @returns {NominationPlacementPlan} Reorder plan. */
window.planAwardPlacementReorder = function (
  year,
  category,
  fromFilmId,
  fromPlacement,
  toFilmId,
  toPlacement,
) {
  let key = String(year || "");
  let source = window.state.years?.[key];
  if (!source?.films?.length) {
    return window.createNominationPlacementPlan({
      operation: "reorder",
      ok: false,
      periodKey: key,
      category,
      errors: ["Award period has no nominations."],
    });
  }
  let periodType = window.getAwardPeriodType({ year: key }, source.periodType);

  function filmMatchesId(film, id) {
    return (
      window.filmMatchesId?.(film, id, { periodType, periodKey: key }) || false
    );
  }

  function filmIdentityKey(film) {
    return (
      window.filmIdentityKey?.(film, {
        canonical: true,
        includePeriodKey: true,
      }) ||
      `${String(film?.year || "")}\n${window.normalizeTitle(film?.title || "")}`
    );
  }

  function awardMatchesTarget(award) {
    return (
      award?.category === category &&
      String(award.year || "") === key &&
      window.getAwardPeriodType(award, periodType) === periodType
    );
  }

  let nextSource = window.cloneRecord(source);
  nextSource.films = (source.films || []).map(window.cloneRecord);
  let candidateEntries = [];
  nextSource.films.forEach((film, filmIndex) => {
    (film.awards || []).forEach((award, awardIndex) => {
      if (!awardMatchesTarget(award)) return;
      candidateEntries.push({
        film,
        award,
        filmIndex,
        awardIndex,
        filmKey: filmIdentityKey(film),
        originalPlacement: Number(award.placement) || 9999,
      });
    });
  });
  if (!candidateEntries.length) {
    return window.createNominationPlacementPlan({
      operation: "reorder",
      ok: false,
      periodType,
      periodKey: key,
      category,
      errors: ["Category has no nominations in this period."],
    });
  }

  let errors = [];
  let warnings = [];
  let rawByFilm = new Map();
  let rawByPlacement = new Map();
  candidateEntries.forEach((entry) => {
    let sameFilm = rawByFilm.get(entry.filmKey) || [];
    sameFilm.push(entry);
    rawByFilm.set(entry.filmKey, sameFilm);
    let placement = Number(entry.award.placement);
    let samePlacement = rawByPlacement.get(placement) || [];
    samePlacement.push(entry);
    rawByPlacement.set(placement, samePlacement);
    let validation = window.validateAward(entry.film, entry.award, {
      periodType,
    });
    validation.errors.forEach((error) =>
      errors.push(`${entry.film.title}: ${error}`),
    );
    validation.warnings.forEach((warning) =>
      warnings.push(`${entry.film.title}: ${warning}`),
    );
  });
  rawByFilm.forEach((entries) => {
    if (entries.length > 1)
      errors.push(`${entries[0].film.title} has duplicate ${category} entries.`);
  });
  rawByPlacement.forEach((entries, placement) => {
    if (entries.length > 2)
      errors.push(`Placement #${placement} is shared by ${entries.length} films.`);
    else if (entries.length === 2)
      warnings.push(
        `Existing tie at #${placement}: ${entries.map((entry) => entry.film.title).join(" / ")}.`,
      );
  });
  if (errors.length) {
    return window.createNominationPlacementPlan({
      operation: "reorder",
      ok: false,
      periodType,
      periodKey: key,
      category,
      warnings,
      errors,
    });
  }

  let entriesByFilm = new Map();
  candidateEntries.forEach((entry) => {
    let existing = entriesByFilm.get(entry.filmKey);
    let isDragged =
      (filmMatchesId(entry.film, fromFilmId) &&
        Number(entry.award.placement) === Number(fromPlacement)) ||
      (filmMatchesId(entry.film, toFilmId) &&
        Number(entry.award.placement) === Number(toPlacement));
    let existingIsDragged =
      existing &&
      ((filmMatchesId(existing.film, fromFilmId) &&
        Number(existing.award.placement) === Number(fromPlacement)) ||
        (filmMatchesId(existing.film, toFilmId) &&
          Number(existing.award.placement) === Number(toPlacement)));
    if (
      !existing ||
      (isDragged && !existingIsDragged) ||
      (isDragged === existingIsDragged &&
        (entry.originalPlacement < existing.originalPlacement ||
          (entry.originalPlacement === existing.originalPlacement &&
            entry.awardIndex < existing.awardIndex)))
    ) {
      entriesByFilm.set(entry.filmKey, entry);
    }
  });

  nextSource.films.forEach((film) => {
    film.awards = (film.awards || []).filter(
      (award) => !awardMatchesTarget(award),
    );
  });
  let entries = [...entriesByFilm.values()];
  entries.forEach((entry) => {
    entry.award = window.cloneRecord(entry.award);
    entry.film.awards ||= [];
    entry.film.awards.push(entry.award);
  });
  let fromEntry =
    entries.find(
      (entry) =>
        Number(entry.award.placement) === Number(fromPlacement) &&
        filmMatchesId(entry.film, fromFilmId),
    ) || entries.find((entry) => filmMatchesId(entry.film, fromFilmId));
  let toEntry =
    entries.find(
      (entry) =>
        Number(entry.award.placement) === Number(toPlacement) &&
        filmMatchesId(entry.film, toFilmId),
    ) || entries.find((entry) => filmMatchesId(entry.film, toFilmId));
  if (!fromEntry || !toEntry) {
    return window.createNominationPlacementPlan({
      operation: "reorder",
      ok: false,
      periodType,
      periodKey: key,
      category,
      warnings,
      errors: ["Dragged or target nomination was not found."],
    });
  }

  entries.sort(
    (left, right) =>
      left.originalPlacement - right.originalPlacement ||
      left.filmIndex - right.filmIndex ||
      left.awardIndex - right.awardIndex,
  );
  let fromIndex = entries.indexOf(fromEntry);
  let toIndex = entries.indexOf(toEntry);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return window.createNominationPlacementPlan({
      operation: "reorder",
      ok: false,
      periodType,
      periodKey: key,
      category,
      warnings,
      errors: ["Choose a different placement."],
    });
  }
  entries.splice(fromIndex, 1);
  entries.splice(toIndex, 0, fromEntry);

  // Dense (not Olympic/skip-style) resequencing: two films sharing 3rd
  // place, the next distinct film gets 4th, not 5th - a tie costs one
  // slot, not two. Untouched adjacent ties (from before this reorder)
  // survive as a group; the dragged entry always gets its own fresh rank,
  // since drag/drop should never silently create a new tie.
  let rank = 0;
  entries.forEach((entry, index) => {
    let previous = entries[index - 1];
    let sameGroup =
      index > 0 &&
      entry !== fromEntry &&
      previous !== fromEntry &&
      entry.originalPlacement === previous.originalPlacement;
    if (!sameGroup) rank += 1;
    entry.award.placement = rank;
  });
  let capacity =
    category === "Best Picture"
      ? window.PERIOD_LIMITS[periodType]?.picture
      : window.PERIOD_LIMITS[periodType]?.category;
  if (rank > capacity) {
    return window.createNominationPlacementPlan({
      operation: "reorder",
      ok: false,
      periodType,
      periodKey: key,
      category,
      warnings,
      errors: [`${category} exceeds its capacity of ${capacity}.`],
    });
  }

  let changes = entries
    .filter(
      (entry) =>
        Number(entry.originalPlacement) !== Number(entry.award.placement),
    )
    .map((entry) => ({
      filmId: entry.film.id,
      title: entry.film.title,
      before: entry.originalPlacement,
      after: Number(entry.award.placement),
      kind: "moved",
    }));
  let nextPeriods = { [key]: nextSource };
  Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
    if (periodKey === key) return;
    let nextPeriod = window.cloneRecord(period);
    let changed = false;
    nextPeriod.films = (period.films || []).map((film) => {
      let nextFilm = window.cloneRecord(film);
      let beforeCount = (nextFilm.awards || []).length;
      nextFilm.awards = (nextFilm.awards || []).filter(
        (award) => !awardMatchesTarget(award),
      );
      if (nextFilm.awards.length !== beforeCount) changed = true;
      return nextFilm;
    });
    if (changed) nextPeriods[periodKey] = nextPeriod;
  });
  return window.createNominationPlacementPlan({
    operation: "reorder",
    periodType,
    periodKey: key,
    category,
    changes,
    warnings,
    nextPeriods,
    editType: "award placement reorder",
    summary: `${key} · ${category}`,
    sheetHint: `${key} / ${category}`,
    context: {
      period: key,
      category,
      fromFilmId,
      fromPlacement,
      toFilmId,
      toPlacement,
    },
  });
};

/** Reorders dense award placements through the shared plan application path. @param {string} year Period key. @param {string} category Category. @param {string} fromFilmId Moved film id. @param {number} fromPlacement Old placement. @param {string} toFilmId Target film id. @param {number} toPlacement Target placement. @returns {boolean} Whether reordered. */
window.swapAwardPlacements = function (
  year,
  category,
  fromFilmId,
  fromPlacement,
  toFilmId,
  toPlacement,
) {
  let plan = window.planAwardPlacementReorder(
    year,
    category,
    fromFilmId,
    fromPlacement,
    toFilmId,
    toPlacement,
  );
  if (!plan.ok) return false;
  return window.applyNominationPlacementPlan(plan).ok;
};

/** Builds a dry-run deletion that compacts an emptied placement and preserves ties. @param {string} year Period key. @param {string} category Category. @param {string} filmId Deleted film id. @param {number} placement Deleted placement. @returns {NominationPlacementPlan} Deletion plan. */
window.planNominationDeletion = function (
  year,
  category,
  filmId,
  placement,
) {
  let key = String(year || "");
  let source = window.state.years?.[key];
  let targetPlacement = Number(placement);
  if (!source?.films?.length) {
    return window.createNominationPlacementPlan({
      operation: "delete",
      ok: false,
      periodKey: key,
      category,
      errors: ["Award period has no nominations."],
    });
  }
  let periodType = window.getAwardPeriodType({ year: key }, source.periodType);
  let rankField =
    periodType === "years"
      ? "yearRank"
      : periodType === "decades"
        ? "decadeRank"
        : periodType === "centuries"
          ? "centuryRank"
          : periodType === "allTime"
            ? "allTimeRank"
            : "";

  function filmMatchesId(film, id) {
    return (
      window.filmMatchesId?.(film, id, { periodType, periodKey: key }) ||
      film?.id === id
    );
  }

  function awardMatchesCategory(award) {
    return (
      award?.category === category &&
      String(award.year || "") === key &&
      window.getAwardPeriodType(award, periodType) === periodType
    );
  }

  let nextSource = window.cloneRecord(source);
  let entries = [];
  nextSource.films.forEach((film, filmIndex) => {
    (film.awards || []).forEach((award, awardIndex) => {
      if (!awardMatchesCategory(award)) return;
      entries.push({ film, award, filmIndex, awardIndex });
    });
  });
  let targets = entries.filter(
    (entry) =>
      filmMatchesId(entry.film, filmId) &&
      Number(entry.award.placement) === targetPlacement,
  );
  if (targets.length !== 1) {
    return window.createNominationPlacementPlan({
      operation: "delete",
      ok: false,
      periodType,
      periodKey: key,
      category,
      errors: [
        targets.length
          ? "Nomination deletion is ambiguous because duplicate entries exist."
          : "Nomination was not found.",
      ],
    });
  }

  let target = targets[0];
  target.film.awards.splice(target.awardIndex, 1);
  let remainingAtPlacement = entries.filter(
    (entry) =>
      entry !== target && Number(entry.award.placement) === targetPlacement,
  );
  let tieRetained = remainingAtPlacement.length > 0;
  let changes = [
    {
      filmId: target.film.id,
      title: target.film.title,
      before: targetPlacement,
      after: null,
      kind: "removed",
    },
  ];
  let affectedRanks = [
    {
      filmId: target.film.id,
      before: targetPlacement,
      after: null,
    },
  ];
  if (category === "Best Picture" && rankField) {
    target.film[rankField] = null;
    target.film.rank = null;
  }

  if (!tieRetained) {
    entries
      .filter(
        (entry) =>
          entry !== target &&
          Number(entry.award.placement) > targetPlacement,
      )
      .sort(
        (left, right) =>
          Number(left.award.placement) - Number(right.award.placement) ||
          left.filmIndex - right.filmIndex ||
          left.awardIndex - right.awardIndex,
      )
      .forEach((entry) => {
        let before = Number(entry.award.placement);
        entry.award.placement = before - 1;
        changes.push({
          filmId: entry.film.id,
          title: entry.film.title,
          before,
          after: entry.award.placement,
          kind: "moved",
        });
        affectedRanks.push({
          filmId: entry.film.id,
          before,
          after: entry.award.placement,
        });
        if (category === "Best Picture" && rankField) {
          entry.film[rankField] = entry.award.placement;
          entry.film.rank = entry.award.placement;
        }
      });
  }

  if (periodType !== "allTime" && !(target.film.awards || []).length) {
    nextSource.films.splice(nextSource.films.indexOf(target.film), 1);
  }

  let nextPeriods = { [key]: nextSource };
  Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
    if (periodKey === key) return;
    let nextPeriod = window.cloneRecord(period);
    let changed = false;
    nextPeriod.films = (nextPeriod.films || []).filter((film) => {
      let matchedRanks = affectedRanks.filter((change) =>
        filmMatchesId(film, change.filmId),
      );
      if (!matchedRanks.length) return true;
      let deleted = matchedRanks.find((change) => change.after === null);
      let shifted = matchedRanks.find((change) => change.after !== null);
      if (category === "Best Picture" && rankField) {
        let nextRank = shifted ? shifted.after : null;
        if (film[rankField] !== nextRank) {
          film[rankField] = nextRank;
          changed = true;
        }
      }
      film.awards = (film.awards || []).filter((award) => {
        if (!awardMatchesCategory(award)) return true;
        if (deleted && Number(award.placement) === deleted.before) {
          changed = true;
          return false;
        }
        if (shifted && Number(award.placement) === shifted.before) {
          award.placement = shifted.after;
          changed = true;
        }
        return true;
      });
      if (periodKey !== "alltime" && !film.awards.length) {
        changed = true;
        return false;
      }
      return true;
    });
    if (changed) nextPeriods[periodKey] = nextPeriod;
  });

  let warnings = tieRetained
    ? [
        `${remainingAtPlacement.map((entry) => entry.film.title).join(" / ")} remains at #${targetPlacement}; later placements do not shift.`,
      ]
    : [];
  return window.createNominationPlacementPlan({
    operation: "delete",
    periodType,
    periodKey: key,
    category,
    changes,
    warnings,
    nextPeriods,
    editType: "nomination deleted",
    summary: `${target.film.title} (${key}) · ${category} #${targetPlacement}`,
    sheetHint: `${key} / ${category}`,
    context: {
      filmId: target.film.id,
      period: key,
      category,
      placement: targetPlacement,
      tieRetained,
    },
    result: {
      removedAward: window.cloneRecord(target.award),
      shifted: changes.filter((change) => change.kind === "moved").length,
      tieRetained,
    },
  });
};

/** Deletes one nomination through the shared plan application path. @param {string} year Period key. @param {string} category Category. @param {string} filmId Deleted film id. @param {number} placement Deleted placement. @returns {Object} Delete result. */
window.deleteNomination = function (year, category, filmId, placement) {
  let plan = window.planNominationDeletion(year, category, filmId, placement);
  if (!plan.ok) return { ok: false, reason: plan.errors.join("\n"), plan };
  return window.applyNominationPlacementPlan(plan);
};
