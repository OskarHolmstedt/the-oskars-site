/**
 * @file Owns canonical film identity, aggregate freshness, film-store merging,
 * and lightweight membership entries for derived periods.
 */

/**
 * Normalizes a film title for matching and identifier construction.
 * @param {*} t Title-like value.
 * @returns {string} Compatibility-normalized, whitespace-collapsed lowercase title.
 */
window.normalizeTitle = function (t) {
  if (!t) return "";
  // remove common invisible/formatting characters
  let s = String(t)
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "");
  s = s.replace(/\s+/g, " ").trim().toLowerCase();
  return s;
};

/**
 * Maps a year to its decade range key.
 * @param {string|number} year Year-like value.
 * @returns {string} Decade key such as `1990s`, or `unknown`.
 */
window.getDecadeKey = function (year) {
  let y = Number(year);
  if (!isFinite(y)) return "unknown";
  return Math.floor(y / 10) * 10 + "s";
};

/**
 * Maps a year to its hundred-year range key.
 * @param {string|number} year Year-like value.
 * @returns {string} Century key such as `1900s`, or `unknown`.
 */
window.getCenturyKey = function (year) {
  let y = Number(year);
  if (!isFinite(y)) return "unknown";
  return Math.floor(y / 100) * 100 + "s";
};

/**
 * Builds the canonical year-and-title film identifier.
 * @param {string|number} year Film year or an empty value.
 * @param {*} title Film title.
 * @returns {string} Canonical film identifier.
 */
window.makeFilmId = function (year, title) {
  let n = normalizeTitle(title || "");
  let y = year || "";
  return (y ? y + "::" : "") + n;
};

/**
 * Marks derived aggregates stale and optionally records a diagnostic reason.
 * @param {string} [reason] Diagnostic reason for the source-state mutation.
 * @returns {boolean} Always true after marking the state.
 */
window.markAggregatesDirty = function (reason = "") {
  window.state._aggregatesDirty = true;
  if (reason) {
    window.state._aggregateDirtyReasons ||= new Set();
    window.state._aggregateDirtyReasons.add(String(reason));
  }
  return true;
};

/**
 * Reports whether source-state mutations have made aggregates stale.
 * @returns {boolean} Whether aggregates require rebuilding.
 */
window.aggregatesAreDirty = function () {
  return Boolean(window.state?._aggregatesDirty);
};

/**
 * Marks the current aggregate snapshot fresh and clears diagnostic reasons.
 */
window.clearAggregatesDirty = function () {
  if (!window.state) return;
  window.state._aggregatesDirty = false;
  window.state._aggregateDirtyReasons = null;
};

/**
 * Rebuilds dirty aggregates before returning application state.
 * @returns {OskarsState} State with fresh aggregates when rebuilding is available.
 */
window.ensureAggregatesFresh = function () {
  if (window.aggregatesAreDirty?.() && window.rebuildAggregates) {
    window.rebuildAggregates();
  }
  return window.state;
};

function periodEntryLookup(periodType, key, list) {
  window.state._periodEntryLookup ||= new Map();
  let bucketKey = `${periodType}\n${key}`;
  let lookup = window.state._periodEntryLookup.get(bucketKey);
  if (lookup?.source === list) return lookup.byId;
  let byId = new Map();
  (list || []).forEach((entry) => {
    if (entry?.id) byId.set(entry.id, entry);
  });
  window.state._periodEntryLookup.set(bucketKey, { source: list, byId });
  return byId;
}

/**
 * Adds or updates a lightweight film entry in a derived period.
 * @param {'years'|'decades'|'centuries'|'allTime'} periodType Period collection.
 * @param {string} key Period key within the collection.
 * @param {string} id Canonical film id.
 * @param {Object} [meta] PeriodFilmEntry fields to merge when defined.
 */
window.addToPeriod = function (periodType, key, id, meta) {
  window.state.periods ||= {
    years: {},
    decades: {},
    centuries: {},
    allTime: { films: [] },
  };
  window.state.periods[periodType] ||= {};
  window.state.periods[periodType][key] ||= { films: [] };
  let list = window.state.periods[periodType][key].films;
  let lookup = periodEntryLookup(periodType, key, list);
  let existing = lookup.get(id);
  if (!existing) {
    existing = Object.assign({ id }, meta || {});
    list.push(existing);
    lookup.set(id, existing);
  } else if (meta) {
    Object.entries(meta).forEach(([name, value]) => {
      if (value !== null && value !== undefined) existing[name] = value;
    });
  }
};

function filmStoreLookup() {
  let lookup = window.state._filmStoreLookup;
  if (lookup?.source === window.state.filmsById) return lookup;
  lookup = { source: window.state.filmsById, byTitle: new Map() };
  Object.values(window.state.filmsById || {}).forEach((film) => {
    let title = film.normalizedTitle || normalizeTitle(film.title);
    if (!title) return;
    film.normalizedTitle ||= title;
    let candidates = lookup.byTitle.get(title) || [];
    candidates.push(film);
    lookup.byTitle.set(title, candidates);
  });
  window.state._filmStoreLookup = lookup;
  return lookup;
}

function addFilmStoreLookupRecord(film) {
  let title = film?.normalizedTitle || normalizeTitle(film?.title);
  if (!title) return;
  film.normalizedTitle ||= title;
  let lookup = filmStoreLookup();
  let candidates = lookup.byTitle.get(title) || [];
  if (!candidates.includes(film)) candidates.push(film);
  lookup.byTitle.set(title, candidates);
}

/**
 * Finds canonical films sharing a normalized title.
 * @param {*} title Title-like value to normalize.
 * @returns {FilmRecord[]} Matching canonical records.
 */
window.filmStoreCandidatesByTitle = function (title) {
  let normalizedTitle = normalizeTitle(title || "");
  if (!normalizedTitle) return [];
  return filmStoreLookup().byTitle.get(normalizedTitle) || [];
};

/**
 * Merges a source film into the canonical store and requested derived periods.
 * @param {string|number} year Source period or concrete year.
 * @param {FilmRecord} film Source film record.
 * @param {Object} [options] Merge and period-membership controls.
 * @param {boolean} [options.replaceRanks] Whether incoming ranks replace existing ranks.
 * @param {boolean} [options.addToDerivedPeriods] Whether concrete year, decade, and century entries are added.
 * @param {boolean} [options.addToAllTime] Whether an all-time entry is added.
 * @param {'years'|'decades'|'centuries'|'allTime'} [options.periodType] Explicit source period type.
 * @param {string} [options.periodKey] Explicit source period key.
 * @returns {FilmRecord} Canonical merged film record.
 */
window.addFilmToStore = function (year, film, options = {}) {
  // A film has one canonical object; periods contain lightweight ID/rank entries.
  window.state.filmsById ||= {};
  window.state.periods ||= {
    years: {},
    decades: {},
    centuries: {},
    allTime: { films: [] },
  };
  window.normalizeFilmMetadata?.(film);

  let norm = normalizeTitle(film.title);
  let effectiveYear =
    window.filmConcreteYear(film.year) || window.filmConcreteYear(year);
  let existing = window.findExistingFilmStoreRecord(
    film,
    effectiveYear,
    options,
  );

  if (existing) {
    let oldId = existing.id;
    let preserveExistingRankForUnrankedMetadata = Boolean(
      film.suppressAllTimeRank && Number(existing.allTimeRank) > 0,
    );
    existing.rank =
      options.replaceRanks && !preserveExistingRankForUnrankedMetadata
        ? film.rank || null
        : existing.rank || film.rank;
    existing.yearRank =
      options.replaceRanks && !preserveExistingRankForUnrankedMetadata
        ? film.yearRank || null
        : film.yearRank || existing.yearRank;
    existing.decadeRank =
      options.replaceRanks && !preserveExistingRankForUnrankedMetadata
        ? film.decadeRank || null
        : film.decadeRank || existing.decadeRank;
    existing.centuryRank =
      options.replaceRanks && !preserveExistingRankForUnrankedMetadata
        ? film.centuryRank || null
        : film.centuryRank || existing.centuryRank;
    existing.allTimeRank =
      options.replaceRanks && !preserveExistingRankForUnrankedMetadata
        ? film.allTimeRank || null
        : film.allTimeRank || existing.allTimeRank;
    if (!existing.rating && film.rating) {
      existing.rating = film.rating;
      existing.ratingValue = film.ratingValue;
      existing.ratingModifier = film.ratingModifier || "";
    }
    existing.director = existing.director || film.director;
    existing.directors = existing.directors?.length
      ? existing.directors
      : film.directors;
    existing.country = existing.country || film.country || "";
    existing.medium =
      existing.medium && existing.medium !== "unknown"
        ? existing.medium
        : film.medium;
    existing.screenplayType =
      existing.screenplayType && existing.screenplayType !== "unknown"
        ? existing.screenplayType
        : film.screenplayType;
    existing.adaptationSource =
      existing.adaptationSource || film.adaptationSource || "";
    existing.url = existing.url || film.url;
    existing.letterboxdUrl = existing.letterboxdUrl || film.letterboxdUrl || "";
    existing.tmdbId = existing.tmdbId || film.tmdbId || "";
    existing.type = existing.type || film.type || "";
    existing.platform = existing.platform || film.platform || "";
    existing.dateWatched = existing.dateWatched || film.dateWatched || "";
    existing.views = existing.views || film.views || null;
    existing.personalScore =
      existing.personalScore || film.personalScore || null;
    existing.runtimeMinutes =
      existing.runtimeMinutes || film.runtimeMinutes || null;
    existing.globalRank = existing.globalRank || film.globalRank || null;
    existing.rankingGroupId =
      existing.rankingGroupId || film.rankingGroupId || "";
    existing.rankingGroupTitle =
      existing.rankingGroupTitle || film.rankingGroupTitle || "";
    // Boolean, so `false` (reset-but-unconfirmed) is a real value that a
    // naive `||` merge would wipe out - local state always wins when set.
    if (
      !Object.prototype.hasOwnProperty.call(existing, "rankConfirmed") &&
      Object.prototype.hasOwnProperty.call(film, "rankConfirmed")
    ) {
      existing.rankConfirmed = film.rankConfirmed;
    }
    if (film.compositeParts?.length)
      existing.compositeParts = film.compositeParts;
    if (film.canonicalComposite)
      existing.canonicalComposite = film.canonicalComposite;
    if (
      Object.prototype.hasOwnProperty.call(film, "suppressAllTimeRank") &&
      !preserveExistingRankForUnrankedMetadata
    ) {
      existing.suppressAllTimeRank = Boolean(film.suppressAllTimeRank);
    }
    existing.poster =
      existing.poster ||
      window.normalizePosterRecord?.(film.poster) ||
      film.poster;
    existing.tags =
      window.parseFilmTags?.([
        ...(existing.tags || []),
        ...(film.tags || []),
      ]) ||
      existing.tags ||
      film.tags ||
      [];
    existing.review = existing.review || film.review || "";
    if (effectiveYear && !/^\d{4}$/.test(String(existing.year || ""))) {
      existing.year = effectiveYear;
      existing.id = window.makeFilmId(effectiveYear, existing.title);
      window.replaceFilmStoreId(oldId, existing.id, existing);
    } else {
      existing.year = existing.year || effectiveYear || film.year || year;
    }
    if (
      film.id &&
      existing.id &&
      film.id !== existing.id &&
      (!window.filmConcreteYear(film.year) ||
        window.periodKeyContainsYear(film.year, existing.year))
    ) {
      window.replaceFilmStoreId(film.id, existing.id, existing);
      film.id = existing.id;
    }
    mergeAwardsSimple((existing.awards ||= []), (film.awards ||= []));
    window.normalizeFilmRatingFields?.(existing);
  } else {
    let idNew = window.makeFilmId(effectiveYear || year, film.title);
    let copy = window.cloneRecord(film);
    copy.id = idNew;
    copy.normalizedTitle = norm;
    copy.year ||= effectiveYear || year;
    copy.awards ||= [];
    window.state.filmsById[idNew] = copy;
    addFilmStoreLookupRecord(copy);
    existing = copy;
  }

  if (effectiveYear && options.addToDerivedPeriods !== false) {
    addToPeriod("years", effectiveYear, existing.id, {
      rank: film.yearRank || film.rank,
    });
    addToPeriod("decades", window.getDecadeKey(effectiveYear), existing.id, {
      rank: film.decadeRank || film.rank,
    });
    addToPeriod("centuries", window.getCenturyKey(effectiveYear), existing.id, {
      rank: film.centuryRank || film.rank,
    });
  }

  if (options.periodType && options.periodKey) {
    let rankField =
      options.periodType === "decades"
        ? film.decadeRank
        : options.periodType === "centuries"
          ? film.centuryRank
          : options.periodType === "allTime"
            ? film.allTimeRank
            : film.yearRank;
    addToPeriod(options.periodType, options.periodKey, existing.id, {
      rank: rankField || film.rank,
    });
  }

  if (options.addToAllTime !== false) {
    addToPeriod("allTime", "all", existing.id, {
      rank: film.allTimeRank || film.rank,
    });
  }

  return existing;
};

function mergeAwardsSimple(existingAwards, newAwards) {
  (newAwards || []).forEach((a) => {
    let found = existingAwards.find((x) => window.sameAward(x, a));
    if (!found) existingAwards.push(a);
  });
}

// Period is part of award identity: first place in a year, decade, and century
// are three distinct results even when every other field is identical.
/**
 * Compares awards by period, placement, recipient, and detail identity.
 * @param {AwardRecord} a First award.
 * @param {AwardRecord} b Second award.
 * @returns {boolean} Whether the awards represent the same result.
 */
window.sameAward = function (a, b) {
  return (
    a.category === b.category &&
    Number(a.placement) === Number(b.placement) &&
    String(a.year || "") === String(b.year || "") &&
    window.getAwardPeriodType(a) === window.getAwardPeriodType(b) &&
    window.awardRecipientKey(a) === window.awardRecipientKey(b) &&
    window.awardDetail(a) === window.awardDetail(b)
  );
};

/**
 * Finds a canonical film by id.
 * @param {string} id Canonical film id.
 * @returns {FilmRecord|null} Matching film, or null.
 */
window.findFilmById = function (id) {
  if (!id) return null;
  return window.state.filmsById?.[id] || null;
};
