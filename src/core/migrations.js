/**
 * @file Structural migrations (generic state-shape changes tracked by version
 * flags) and personal archive repairs (narrow, idempotent cleanups for known
 * bad rows) run once during startup by bootstrap.js. Repair helpers are kept
 * named as repair... so future schema migrations don't get buried among
 * one-off data fixes.
 */

/**
 * Creates empty local state marked with every currently completed migration.
 * @returns {OskarsState} Cleared state ready to persist without restoring bundled data.
 */
window.createClearedLocalState = function () {
  let cleared = window.createEmptyState();
  cleared.dataVersion = window.OSKARS_BUNDLED_DATA_VERSION;
  cleared.centuryRangeVersion = 1;
  cleared.adaptationSourceVersion = 1;
  cleared.watchlistOrderVersion = 1;
  cleared.groupedRankProjectionVersion = 1;
  cleared.watchedDateVersion = 1;
  cleared.viewingFactsVersion = 1;
  return cleared;
};

// Structural migration: dateWatched used to store raw sheet cells, including
// literal '-' placeholders and compact YYMMDD strings. Saved states convert
// once to ISO (dropping placeholders); imports now normalize on entry.
/**
 * Migrates stored watch dates to canonical values once.
 * @returns {boolean} Whether the migration changed or versioned the state.
 */
window.repairWatchedDates = function () {
  if ((window.state.watchedDateVersion || 0) >= 1) return false;
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      if (film.dateWatched === undefined) return;
      let normalized =
        window.normalizeWatchedDate?.(film.dateWatched) ?? film.dateWatched;
      if (normalized) film.dateWatched = normalized;
      else delete film.dateWatched;
    });
  });
  window.state.watchedDateVersion = 1;
  return true;
};

// Structural migration: ranked-list viewing and classification cells once
// retained literal dash placeholders. A small batch of old saved watch dates
// also contains row-like one/two-digit values; those cannot be real dates,
// while other unrecognized text remains intentionally untouched.
/**
 * Removes legacy placeholders and invalid short watch dates once.
 * @returns {boolean} Whether the migration changed or versioned the state.
 */
window.repairViewingFacts = function () {
  if ((window.state.viewingFactsVersion || 0) >= 1) return false;
  let placeholder = (value) =>
    /^(?:-|–|—|n\/?a|none)$/i.test(String(value || "").trim());
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      ["platform", "type", "country"].forEach((field) => {
        if (placeholder(film[field])) delete film[field];
      });
      if (film.tags !== undefined) {
        let tags = Array.isArray(film.tags)
          ? film.tags
          : String(film.tags || "").split(/[,;\n]+/);
        film.tags = tags.filter(
          (tag) => !placeholder(tag) && String(tag || "").trim(),
        );
        if (!film.tags.length) delete film.tags;
      }
      if (/^\d{1,2}$/.test(String(film.dateWatched || "").trim()))
        delete film.dateWatched;
    });
  });
  window.state.viewingFactsVersion = 1;
  return true;
};

// Personal archive repair: fixes a misspelling that existed in saved/bundled
// data. This is not a generic title normalization migration.
/**
 * Corrects the known misspelled film title in source periods.
 * @returns {boolean} Whether a title was corrected.
 */
window.repairKnownFilmTitles = function () {
  let changed = false;
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      if (window.normalizeTitle(film.title) !== "dead poets soicety") return;
      film.title = "Dead Poets Society";
      film.normalizedTitle = "dead poets society";
      film.id = window.makeFilmId(film.year, film.title);
      changed = true;
    });
  });
  return changed;
};

// Personal archive repair: auto-generated project names used to carry a
// " watch project" suffix; the hub is context enough, so saved projects drop it once here.
/**
 * Removes the obsolete generated suffix from saved project names.
 * @returns {boolean} Whether a project name was changed.
 */
window.repairProjectNames = function () {
  let changed = false;
  (window.state.projects || []).forEach((project) => {
    let trimmed = String(project.name || "").replace(/\s+watch project$/i, "");
    if (trimmed && trimmed !== project.name) {
      project.name = trimmed;
      changed = true;
    }
  });
  return changed;
};

/**
 * Computes the persisted global watchlist order once when its helper is available.
 * @returns {boolean} Whether the migration ran.
 */
window.repairWatchlistGlobalOrder = function () {
  if ((window.state.watchlistOrderVersion || 0) >= 1) return false;
  if (!window.recomputeWatchlistOrder) return false;
  window.recomputeWatchlistOrder?.();
  window.state.watchlistOrderVersion = 1;
  return true;
};

/**
 * Projects grouped all-time ranks into each ranked period once.
 * @returns {boolean} Whether the migration ran.
 */
window.repairGroupedRankProjections = function () {
  if ((window.state.groupedRankProjectionVersion || 0) >= 1) return false;
  let allTimeFilms = (window.state.years?.alltime?.films || []).filter(
    (film) =>
      film?.title &&
      !film.suppressAllTimeRank &&
      /^\d{4}$/.test(
        String(window.filmConcreteYear?.(film.year) || film.year || ""),
      ),
  );
  if (!allTimeFilms.length) {
    window.state.groupedRankProjectionVersion = 1;
    return true;
  }

  function identity(film) {
    return (
      window.filmIdentityKey?.(film, { includePeriodKey: true }) ||
      `${window.filmConcreteYear?.(film.year) || film.year || ""}\n${window.normalizeTitle(film.title)}`
    );
  }

  function assignRank(films, field) {
    let nextRank = 1;
    let groupRanks = new Map();
    films.forEach((film) => {
      let rank =
        film.rankingGroupId && groupRanks.has(film.rankingGroupId)
          ? groupRanks.get(film.rankingGroupId)
          : nextRank;
      if (film.rankingGroupId && !groupRanks.has(film.rankingGroupId)) {
        groupRanks.set(film.rankingGroupId, rank);
      }
      if (!film.rankingGroupId || rank === nextRank) nextRank += 1;
      film[field] = rank;
      if (field === "allTimeRank") film.rank = rank;
    });
  }

  let orderedAllTimeFilms = [...allTimeFilms].sort(
    (left, right) =>
      Number(left.allTimeRank || left.rank || 999999) -
        Number(right.allTimeRank || right.rank || 999999) ||
      window.compareEnglishTitles(left.title, right.title),
  );
  assignRank(orderedAllTimeFilms, "allTimeRank");

  let identityRanks = new Map();
  let yearGroups = new Map();
  let decadeGroups = new Map();
  let centuryGroups = new Map();
  orderedAllTimeFilms.forEach((film) => {
    let year = window.filmConcreteYear?.(film.year) || String(film.year || "");
    identityRanks.set(identity(film), {
      allTimeRank: film.allTimeRank,
      yearRank: null,
      decadeRank: null,
      centuryRank: null,
    });
    if (!/^\d{4}$/.test(year)) return;
    let yearKey = String(year);
    let decadeKey = window.getDecadeKey(year);
    let centuryKey = window.getCenturyKey(year);
    if (!yearGroups.has(yearKey)) yearGroups.set(yearKey, []);
    if (!decadeGroups.has(decadeKey)) decadeGroups.set(decadeKey, []);
    if (!centuryGroups.has(centuryKey)) centuryGroups.set(centuryKey, []);
    yearGroups.get(yearKey).push(film);
    decadeGroups.get(decadeKey).push(film);
    centuryGroups.get(centuryKey).push(film);
  });

  function assignPeriodRanks(groups, field) {
    groups.forEach((films) => {
      assignRank(films, field);
      films.forEach((film) => {
        let ranks = identityRanks.get(identity(film));
        if (ranks) ranks[field] = film[field];
      });
    });
  }
  assignPeriodRanks(yearGroups, "yearRank");
  assignPeriodRanks(decadeGroups, "decadeRank");
  assignPeriodRanks(centuryGroups, "centuryRank");

  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      let ranks = identityRanks.get(identity(film));
      if (!ranks) return;
      film.allTimeRank = ranks.allTimeRank;
      film.yearRank = ranks.yearRank;
      film.decadeRank = ranks.decadeRank;
      film.centuryRank = ranks.centuryRank;
      if (period.periodType === "years") film.rank = ranks.yearRank;
      else if (period.periodType === "decades") film.rank = ranks.decadeRank;
      else if (period.periodType === "centuries") film.rank = ranks.centuryRank;
      else if (period.periodType === "allTime") film.rank = ranks.allTimeRank;
    });
  });

  window.state.groupedRankProjectionVersion = 1;
  return true;
};

// Personal archive repair: early Google Sheets imports could assign a whole
// year bracket to an adjacent year. If the all-time list proves the bracket's
// canonical year, move the block once.
/**
 * Moves confidently misassigned year brackets to the year proven by all-time data.
 * @returns {boolean} Whether any source period was moved.
 */
window.repairMisassignedYearBracketPeriods = function () {
  let allTimeFilms = window.state.years?.alltime?.films || [];
  if (!allTimeFilms.length) return false;
  let changed = false;
  let allTimeByTitle = new Map();
  allTimeFilms.forEach((film) => {
    let title = window.normalizeTitle(film.title);
    let year = String(film.year || "");
    if (title && /^\d{4}$/.test(year) && !allTimeByTitle.has(title))
      allTimeByTitle.set(title, year);
  });

  Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
    if (!/^\d{4}$/.test(periodKey) || period?.periodType !== "years") return;
    let films = period.films || [];
    if (!films.length) return;
    let counts = new Map();
    let matched = 0;
    films.forEach((film) => {
      let year = allTimeByTitle.get(window.normalizeTitle(film.title));
      if (!year) return;
      matched += 1;
      counts.set(year, (counts.get(year) || 0) + 1);
    });
    if (!matched || counts.size !== 1) return;
    let [[canonicalYear, count]] = [...counts.entries()];
    if (canonicalYear === periodKey) return;
    let required = Math.max(2, Math.ceil(films.length * 0.6));
    if (count < required) return;

    window.state.years[canonicalYear] ||= { films: [], periodType: "years" };
    let target = window.state.years[canonicalYear];
    target.periodType = "years";
    films.forEach((film) => {
      let copy = window.cloneRecord(film);
      if (String(copy.year || "") === periodKey) copy.year = canonicalYear;
      copy.id = window.makeFilmId(copy.year || canonicalYear, copy.title);
      (copy.awards || []).forEach((award) => {
        if (String(award.year || "") === periodKey) award.year = canonicalYear;
      });
      let existing = target.films.find((candidate) =>
        window.sameFilmIdentity(candidate, copy),
      );
      if (existing) {
        (copy.awards || []).forEach((award) => {
          if (
            !existing.awards?.some((candidate) =>
              window.sameAward(candidate, award),
            )
          ) {
            existing.awards ||= [];
            existing.awards.push(award);
          }
        });
      } else {
        target.films.push(copy);
      }
    });
    delete window.state.years[periodKey];
    changed = true;
  });
  return changed;
};

