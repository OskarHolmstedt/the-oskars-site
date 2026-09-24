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
 * Parses a decade or century key into its inclusive [startYear, endYear] span.
 * @param {'decades'|'centuries'|'decade'|'century'} periodType Period type.
 * @param {string|number} key Range key like "1990s" or "1900s".
 * @returns {[number, number]|null} Inclusive year span or null.
 */
window.getPeriodKeyYearSpan = function (periodType, key) {
  let start = parseInt(String(key || ""), 10);
  if (!Number.isFinite(start)) return null;
  let normalized = String(periodType || "").toLowerCase();
  if (normalized === "decades" || normalized === "decade") {
    return [start, start + 9];
  }
  if (normalized === "centuries" || normalized === "century") {
    return [start, start + 99];
  }
  return null;
};

/**
 * Derives a public-profile URL slug from an owner-chosen display name
 * (issue #253) - the display name is the single source of truth, so the
 * publish panel never needs a separately-typed, driftable slug field.
 * Pure and backend-agnostic (moved here from canonical-data.js for
 * issue #430, since state.js - unlike canonical-data.js - loads
 * unconditionally on every entry, Supabase-backed or not).
 * @param {string} name Owner-chosen public profile display name.
 * @returns {string} URL-safe slug, empty if name has no alphanumeric content.
 */
window.publicProfileSlugify = function (name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

/** Compatibility alias for publicProfileSlugify. */
window.slugify = window.publicProfileSlugify;

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

function filmStoreLookup(store = window.state) {
  let lookup = store._filmStoreLookup;
  if (lookup?.source === store.filmsById) return lookup;
  lookup = { source: store.filmsById, byTitle: new Map() };
  Object.values(store.filmsById || {}).forEach((film) => {
    let title = film.normalizedTitle || normalizeTitle(film.title);
    if (!title) return;
    film.normalizedTitle ||= title;
    let candidates = lookup.byTitle.get(title) || [];
    candidates.push(film);
    lookup.byTitle.set(title, candidates);
  });
  store._filmStoreLookup = lookup;
  return lookup;
}

function addFilmStoreLookupRecord(film, store = window.state) {
  let title = film?.normalizedTitle || normalizeTitle(film?.title);
  if (!title) return;
  film.normalizedTitle ||= title;
  let lookup = filmStoreLookup(store);
  let candidates = lookup.byTitle.get(title) || [];
  if (!candidates.includes(film)) candidates.push(film);
  lookup.byTitle.set(title, candidates);
}

/**
 * Finds canonical films sharing a normalized title.
 * @param {*} title Title-like value to normalize.
 * @param {Object} [store] Isolated canonical store, or the application state.
 * @returns {FilmRecord[]} Matching canonical records.
 */
window.filmStoreCandidatesByTitle = function (title, store = window.state) {
  let normalizedTitle = normalizeTitle(title || "");
  if (!normalizedTitle) return [];
  return filmStoreLookup(store).byTitle.get(normalizedTitle) || [];
};

/**
 * Merges a source film into the canonical store and requested derived periods.
 * @param {string|number} year Source period or concrete year.
 * @param {FilmRecord} film Source film record.
 * @param {Object} [options] Merge and period-membership controls.
 * @param {Object} [options.store] Isolated canonical store; skips derived period indexing.
 * @param {boolean} [options.replaceRanks] Whether incoming ranks replace existing ranks.
 * @param {boolean} [options.addToDerivedPeriods] Whether concrete year, decade, and century entries are added.
 * @param {boolean} [options.addToAllTime] Whether an all-time entry is added.
 * @param {'years'|'decades'|'centuries'|'allTime'} [options.periodType] Explicit source period type.
 * @param {string} [options.periodKey] Explicit source period key.
 * @returns {FilmRecord} Canonical merged film record.
 */
window.addFilmToStore = function (year, film, options = {}) {
  let store = options.store || window.state;
  // A film has one canonical object; periods contain lightweight ID/rank entries.
  store.filmsById ||= {};
  store.periods ||= {
    years: {},
    decades: {},
    centuries: {},
    allTime: { films: [] },
  };
  window.normalizeFilmMetadata?.(film);

  let norm = normalizeTitle(film.title);
  let filmYearIsConcrete = window.filmConcreteYear(film.year);
  let effectiveYear = filmYearIsConcrete || window.filmConcreteYear(year);
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
        : film.rank || existing.rank;
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
      : film.directors
        ? [...film.directors]
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
    existing.supabaseFilmId =
      existing.supabaseFilmId || film.supabaseFilmId || "";
    existing.type = existing.type || film.type || "";
    existing.platform = existing.platform || film.platform || "";
    existing.dateWatched = existing.dateWatched || film.dateWatched || "";
    existing.views = existing.views ?? film.views ?? null;
    existing.musicScore = existing.musicScore ?? film.musicScore ?? null;
    existing.musicRating = existing.musicRating || film.musicRating || "";
    existing.musicRatingValue =
      existing.musicRatingValue ?? film.musicRatingValue ?? null;
    existing.runtimeMinutes =
      existing.runtimeMinutes ?? film.runtimeMinutes ?? null;
    if (film.rankConfirmedByScope)
      existing.rankConfirmedByScope = { ...film.rankConfirmedByScope };
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
      existing.compositeParts = film.compositeParts.map((part) =>
        typeof part === "object" && part ? { ...part } : part,
      );
    if (film.canonicalComposite)
      existing.canonicalComposite =
        typeof film.canonicalComposite === "object" && film.canonicalComposite
          ? { ...film.canonicalComposite }
          : film.canonicalComposite;
    if (
      Object.prototype.hasOwnProperty.call(film, "suppressAllTimeRank") &&
      !preserveExistingRankForUnrankedMetadata
    ) {
      existing.suppressAllTimeRank = Boolean(film.suppressAllTimeRank);
    }
    existing.poster =
      existing.poster ||
      window.normalizePosterRecord?.(film.poster) ||
      (film.poster && typeof film.poster === "object"
        ? { ...film.poster }
        : film.poster);
    existing.tags =
      existing.tags?.length || film.tags?.length
        ? window.parseFilmTags?.([
            ...(existing.tags || []),
            ...(film.tags || []),
          ]) ||
          existing.tags ||
          (film.tags ? [...film.tags] : [])
        : existing.tags || (film.tags ? [...film.tags] : []);
    existing.review = existing.review || film.review || "";
    if (effectiveYear && !/^\d{4}$/.test(String(existing.year || ""))) {
      existing.year = effectiveYear;
      // A real Supabase id never derives from year/title, so a record
      // that already has one keeps it - only the legacy year::title id
      // needs recomputing when a placeholder period year resolves to a
      // concrete one (issue #454).
      if (!existing.supabaseFilmId) {
        existing.id = window.makeFilmId(effectiveYear, existing.title);
        window.replaceFilmStoreId(oldId, existing.id, existing, store);
      }
    } else {
      existing.year = existing.year || effectiveYear || film.year || year;
    }
    if (
      film.id &&
      existing.id &&
      film.id !== existing.id &&
      (!filmYearIsConcrete ||
        window.periodKeyContainsYear(film.year, existing.year))
    ) {
      window.replaceFilmStoreId(film.id, existing.id, existing, store);
      film.id = existing.id;
    }
    window.mergeAwards((existing.awards ||= []), (film.awards ||= []));
    window.normalizeFilmRatingFields?.(existing);
  } else {
    // Prefer the real Supabase films.id (issue #454) over the legacy
    // year::title primitive, so a film's identity is stable across a
    // title/year correction and doesn't depend on which state it's in
    // (Unseen/Watchlisted/Watched). Only offline-built records with no
    // known Supabase id yet (import preview, before a round-trip) fall
    // back to the legacy scheme.
    let idNew =
      film.supabaseFilmId ||
      window.makeFilmId(effectiveYear || year, film.title);
    let copy = window.cloneRecord(film);
    copy.id = idNew;
    copy.normalizedTitle = norm;
    copy.year ||= effectiveYear || year;
    copy.awards ||= [];
    store.filmsById[idNew] = copy;
    addFilmStoreLookupRecord(copy, store);
    existing = copy;
  }

  if (options.store) return existing;

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
    let rankProp = window.getRankFieldForPeriodType(options.periodType);
    let rankField = film[rankProp];
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

/**
 * Deduplicating award merger that appends new awards without duplicates.
 * @param {AwardRecord[]} existingAwards Target awards list.
 * @param {AwardRecord[]} newAwards Awards to merge in.
 * @returns {AwardRecord[]} The existingAwards array.
 */
window.mergeAwards = function (existingAwards, newAwards) {
  let list = existingAwards || [];
  (newAwards || []).forEach((a) => {
    let found = list.find((x) => window.sameAward(x, a));
    if (!found) list.push(a);
  });
  return list;
};

// Period is part of award identity: first place in a year, decade, and century
// are three distinct results even when every other field is identical.
/**
 * Compares awards by period, placement, recipient, and detail identity.
 * @param {AwardRecord} a First award.
 * @param {AwardRecord} b Second award.
 * @returns {boolean} Whether the awards represent the same result.
 */
window.sameAward = function (a, b) {
  let placementA = Number(a.placement);
  let placementB = Number(b.placement);
  // Number(a.placement) === Number(b.placement) is false for two "not
  // placed" awards (NaN === NaN is false) - both-NaN counts as a match so
  // two structurally-identical not-placed entries still de-dupe.
  let samePlacement =
    placementA === placementB ||
    (Number.isNaN(placementA) && Number.isNaN(placementB));
  return (
    a.category === b.category &&
    samePlacement &&
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

/**
 * Reports confirmation in the requested scope, retaining the shared flag for legacy records.
 * @param {FilmRecord} film Film record.
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType Ranking scope.
 * @returns {boolean} Whether the rank is deliberately confirmed.
 */
window.isFilmRankConfirmed = function (film, scopeType) {
  if (
    film?.rankConfirmedByScope &&
    typeof film.rankConfirmedByScope[scopeType] === "boolean"
  )
    return film.rankConfirmedByScope[scopeType];
  return film?.rankConfirmed !== false;
};
