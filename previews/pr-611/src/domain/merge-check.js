/**
 * @file Ports the owner's Google Sheets "CHECK MERGES" script: detects a
 * lower-ranked nominee leaking into a wider award period (year -> decade
 * -> century -> all-time) ahead of a higher-ranked sibling from the same
 * narrower period. Read-only over window.state.years - never mutates an
 * award placement.
 *
 * Two cases the sheet script also recognized are informational rather
 * than a violation: an "auteur" exception (the missing film's director is
 * already represented in the wider bracket - only checked for categories
 * where that's a deliberate anti-overrepresentation choice, matching the
 * sheet's AUTEUR_SUPPRESSION_CATEGORIES) and a "franchise" exception (the
 * missing film's franchise is already represented, checked for every
 * category). A film whose higher-ranked child placement shares a
 * recipient with the wider bracket is dropped from the report entirely,
 * exactly as the sheet's "personregeln" does - that's the ordinary,
 * expected way an overrepresented person gets excluded on the way up.
 *
 * A separate check flags the same person (or, in a team-constellation
 * category, the same collaborator group) holding two placements within
 * one bracket, unless the pool of eligible candidates across that
 * bracket's own children was too small to avoid it.
 */

(function () {
  /** Categories where a missing higher-ranked film is excused once its
   * director already has a placement in the wider bracket - mirrors the
   * sheet's AUTEUR_SUPPRESSION_CATEGORIES, translated to this app's real
   * category names. */
  const AUTEUR_SUPPRESSION_CATEGORIES = new Set([
    "Best Picture",
    "Best Casting",
    "Best Production Design",
    "Best Costume Design",
  ]);

  /** Categories where a collaborator constellation may hold parallel
   * placements without needing more unique candidates - mirrors the
   * sheet's TEAM_CONSTELLATION_CATEGORIES. */
  const TEAM_CONSTELLATION_CATEGORIES = new Set([
    "Best Song",
    "Best Original Screenplay",
    "Best Adapted Screenplay",
  ]);

  const LEVELS = {
    decades: {
      childType: "years",
      parentType: "decades",
      label: "Year → Decade",
      parentKeyFor: (childKey) => window.getDecadeKey(childKey),
    },
    centuries: {
      childType: "decades",
      parentType: "centuries",
      label: "Decade → Century",
      parentKeyFor: (childKey) => window.getCenturyKey(parseInt(childKey, 10)),
    },
    allTime: {
      childType: "centuries",
      parentType: "allTime",
      label: "Century → All-time",
      parentKeyFor: () => "alltime",
    },
  };

  function periodAward(award, periodKey, category, periodType) {
    return (
      award?.category === category &&
      String(award.year || "") === periodKey &&
      window.getAwardPeriodType(award, periodType) === periodType
    );
  }

  function periodsByType(periodType) {
    return Object.entries(window.state?.years || {}).filter(
      ([, period]) => period?.periodType === periodType,
    );
  }

  function directorIds(film) {
    return (film?.directors || [])
      .map((name) => window.normalizePersonName(name))
      .filter(Boolean);
  }

  function franchiseIds(film) {
    return (film?.franchises || [])
      .map((membership) => membership?.id)
      .filter(Boolean);
  }

  /** Collects one period+category's current nominees, sorted by placement. */
  function periodCategoryNominees(periodKey, periodType, category) {
    let period = window.state?.years?.[periodKey];
    if (!period?.films?.length) return [];
    let list = [];
    period.films.forEach((film) => {
      (film.awards || []).forEach((award) => {
        if (!periodAward(award, periodKey, category, periodType)) return;
        list.push({
          placement: Number(award.placement),
          film,
          award,
          identity: window.filmIdentityKey(film, { canonical: true }),
          personIds: (award.recipients || [])
            .map((recipient) => recipient.personId)
            .filter(Boolean),
          directorIds: directorIds(film),
          franchiseIds: franchiseIds(film),
        });
      });
    });
    return list.sort((a, b) => a.placement - b.placement);
  }

  function nomineeLabel(nominee) {
    let title = nominee?.film?.title || "Untitled";
    return nominee?.film?.year ? `${title} (${nominee.film.year})` : title;
  }

  /** Checks one child period's ordering against its parent's actual placements. */
  function checkPairMerge(level, childKey, category, problems) {
    let parentKey = level.parentKeyFor(childKey);
    if (!parentKey) return;
    let childNominees = periodCategoryNominees(
      childKey,
      level.childType,
      category,
    );
    if (!childNominees.length) return;
    let parentNominees = periodCategoryNominees(
      parentKey,
      level.parentType,
      category,
    );
    if (!parentNominees.length) return;

    let parentFilmIds = new Set(parentNominees.map((n) => n.identity));
    let parentPersonIds = new Set(parentNominees.flatMap((n) => n.personIds));
    let parentFranchiseIds = new Set(
      parentNominees.flatMap((n) => n.franchiseIds),
    );
    let parentDirectorIds = new Set(
      parentNominees.flatMap((n) => n.directorIds),
    );
    let allowAuteur = AUTEUR_SUPPRESSION_CATEGORIES.has(category);

    for (let lowerIdx = 1; lowerIdx < childNominees.length; lowerIdx++) {
      let lower = childNominees[lowerIdx];
      if (!parentFilmIds.has(lower.identity)) continue;

      for (let higherIdx = 0; higherIdx < lowerIdx; higherIdx++) {
        let higher = childNominees[higherIdx];
        if (parentFilmIds.has(higher.identity)) continue;

        // The sheet's "personregeln": a missing higher-ranked nominee whose
        // own recipient is already represented in the parent bracket isn't
        // reported at all - that's ordinary, expected suppression.
        if (higher.personIds.some((id) => parentPersonIds.has(id))) continue;

        let matchedDirector = allowAuteur
          ? higher.directorIds.find((id) => parentDirectorIds.has(id))
          : null;
        let suppressedByFranchise = higher.franchiseIds.some((id) =>
          parentFranchiseIds.has(id),
        );

        let base = {
          level: level.label,
          category,
          childKey,
          parentKey,
          higher: nomineeLabel(higher),
          higherPlacement: higher.placement,
          lower: nomineeLabel(lower),
          lowerPlacement: lower.placement,
        };
        if (matchedDirector) {
          problems.push({
            ...base,
            type: "AUTEUR_INFO",
            message: `"${higher.film.title}" is missing from ${parentKey}, but its director is already represented in ${category} there.`,
          });
        } else if (suppressedByFranchise) {
          problems.push({
            ...base,
            type: "FRANCHISE_INFO",
            message: `"${higher.film.title}" is missing from ${parentKey}, but its franchise is already represented in ${category} there.`,
          });
        } else {
          problems.push({
            ...base,
            type: "BROKEN_ORDER",
            message: `#${lower.placement} "${lower.film.title}" made it to ${parentKey} ahead of #${higher.placement} "${higher.film.title}" from ${childKey} in ${category}.`,
          });
        }
      }
    }
  }

  function childKeysForParent(level, parentKey) {
    if (level.parentType === "decades")
      return periodsByType("years")
        .map(([key]) => key)
        .filter((year) => window.getDecadeKey(year) === parentKey);
    if (level.parentType === "centuries")
      return periodsByType("decades")
        .map(([key]) => key)
        .filter(
          (decadeKey) =>
            window.getCenturyKey(parseInt(decadeKey, 10)) === parentKey,
        );
    if (level.parentType === "allTime")
      return periodsByType("centuries").map(([key]) => key);
    return [];
  }

  function eligiblePoolSize(childKeys, childType, category, isTeam) {
    let units = new Set();
    childKeys.forEach((childKey) => {
      periodCategoryNominees(childKey, childType, category).forEach(
        (nominee) => {
          if (isTeam) {
            let key = nominee.personIds.slice().sort().join(" +++ ");
            if (key) units.add(key);
          } else {
            nominee.personIds.forEach((id) => units.add(id));
          }
        },
      );
    });
    return units.size;
  }

  /** Checks one parent bracket for a duplicate recipient/constellation. */
  function checkDuplicatesInParent(level, parentKey, category, problems) {
    let nominees = periodCategoryNominees(
      parentKey,
      level.parentType,
      category,
    );
    if (!nominees.length) return;
    let hasAnyPerson = nominees.some((nominee) => nominee.personIds.length);
    if (!hasAnyPerson) return;

    let isTeam = TEAM_CONSTELLATION_CATEGORIES.has(category);
    let capacities = window.bracketCapacities(level.parentType);
    let capacity =
      category === "Best Picture" ? capacities.picture : capacities.category;
    let poolSize = eligiblePoolSize(
      childKeysForParent(level, parentKey),
      level.childType,
      category,
      isTeam,
    );
    let justified = nominees.length < capacity || poolSize <= capacity;

    let seen = new Map();
    nominees.forEach((nominee) => {
      let units = isTeam
        ? [nominee.personIds.slice().sort().join(" +++ ")]
        : nominee.personIds;
      units.filter(Boolean).forEach((unit) => {
        let first = seen.get(unit);
        if (!first) {
          seen.set(unit, nominee);
          return;
        }
        let base = {
          level: `${level.parentType} bracket`,
          category,
          parentKey,
          higher: nomineeLabel(first),
          higherPlacement: first.placement,
          lower: nomineeLabel(nominee),
          lowerPlacement: nominee.placement,
        };
        problems.push(
          justified
            ? {
                ...base,
                type: "INFO_LIMITED_POOL",
                message: `A nominee holds two placements in ${parentKey} (${category}) - #${first.placement} and #${nominee.placement} - but only ${poolSize} eligible candidate(s) existed across its source periods.`,
              }
            : {
                ...base,
                type: "DUPLICATE_VIOLATION",
                message: `A nominee holds two placements in ${parentKey} (${category}): #${first.placement} "${first.film.title}" and #${nominee.placement} "${nominee.film.title}", even though other candidates were available.`,
              },
        );
      });
    });
  }

  function allCategoriesInUse() {
    let ordered = window.getOrderedCategories?.() || [];
    let extra = new Set();
    Object.values(window.state?.years || {}).forEach((period) => {
      (period.films || []).forEach((film) =>
        (film.awards || []).forEach((award) => {
          if (award.category && !ordered.includes(award.category))
            extra.add(award.category);
        }),
      );
    });
    return ordered.concat([...extra].sort());
  }

  const SEVERITY_WEIGHT = {
    BROKEN_ORDER: 1,
    DUPLICATE_VIOLATION: 1,
    AUTEUR_INFO: 2,
    FRANCHISE_INFO: 3,
    INFO_LIMITED_POOL: 4,
  };

  /**
   * Runs the full year->decade->century->all-time ordering and duplicate
   * check over the current owner's live window.state.years. Pure/read-only:
   * call window.ensureOskarsData() first so state.years is populated.
   * @returns {{problems: Object[], summary: Record<string, number>}}
   */
  window.runMergeConsistencyCheck = function () {
    let problems = [];
    let categories = allCategoriesInUse();

    Object.values(LEVELS).forEach((level) => {
      periodsByType(level.childType).forEach(([childKey]) => {
        categories.forEach((category) =>
          checkPairMerge(level, childKey, category, problems),
        );
      });
    });

    Object.values(LEVELS).forEach((level) => {
      periodsByType(level.parentType).forEach(([parentKey]) => {
        categories.forEach((category) =>
          checkDuplicatesInParent(level, parentKey, category, problems),
        );
      });
    });

    problems.sort((a, b) => {
      let weight = SEVERITY_WEIGHT[a.type] - SEVERITY_WEIGHT[b.type];
      if (weight) return weight;
      if (a.category !== b.category)
        return a.category.localeCompare(b.category);
      return String(a.childKey || a.parentKey || "").localeCompare(
        String(b.childKey || b.parentKey || ""),
      );
    });

    return {
      problems,
      summary: {
        brokenOrder: problems.filter((p) => p.type === "BROKEN_ORDER").length,
        duplicateViolations: problems.filter(
          (p) => p.type === "DUPLICATE_VIOLATION",
        ).length,
        auteurInfo: problems.filter((p) => p.type === "AUTEUR_INFO").length,
        franchiseInfo: problems.filter((p) => p.type === "FRANCHISE_INFO")
          .length,
        limitedPoolInfo: problems.filter((p) => p.type === "INFO_LIMITED_POOL")
          .length,
      },
    };
  };
})();
