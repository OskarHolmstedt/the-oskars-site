/**
 * @file Applies film, award-credit, all-time ranking, and bracket-placement edits across source records.
 */

/** Finds an award on a film by category, placement, and period. @param {FilmRecord} film Film. @param {string} category Category. @param {number} placement Placement. @param {string} year Period key. @returns {AwardRecord|null} Award. */
window.findAwardOnFilm = function (film, category, placement, year) {
  if (!film) return null;
  return (film.awards || []).find(
    (award) =>
      award.category === category &&
      Number(award.placement) === Number(placement) &&
      (!year || !award.year || String(award.year) === String(year)),
  );
};

/** Finds every authoritative source record for a canonical film id. @param {string} id Film id. @returns {FilmRecord[]} Source films. */
window.findSourceFilmsById = function (id) {
  let matches = [];
  let seen = new Set();
  Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
    (period.films || []).forEach((film) => {
      if (
        window.filmMatchesId?.(film, id, {
          periodType: period.periodType,
          periodKey,
        }) &&
        !seen.has(film)
      ) {
        seen.add(film);
        matches.push(film);
      }
    });
  });
  (window.state.watchedOther || []).forEach((film) => {
    if (film.id === id && !seen.has(film)) {
      seen.add(film);
      matches.push(film);
    }
  });
  return matches;
};

/**
 * Builds the complete form-shaped metadata values for a film, matching the
 * shape `updateFilmMetadata` accepts, so callers can override individual
 * fields without dropping the rest.
 * @param {FilmRecord} film Film record.
 * @returns {Object} Full metadata values in edit-form shape.
 */
window.filmMetadataFormValues = function (film) {
  return {
    title: film.title || "",
    year: String(film.year || ""),
    director: film.director || "",
    rating: film.rating || "",
    country: film.country || "",
    primaryCountry: film.primaryCountry || "",
    url: film.url || "",
    medium: film.medium || "unknown",
    screenplayType: film.screenplayType || "unknown",
    adaptationSource: film.adaptationSource || "",
    franchises: window.formatFranchiseMemberships(film.franchises),
    tags: [...(film.tags || [])],
    review: film.review || "",
    wantToRewatch: Boolean(film.wantToRewatch),
    rewatchTier: film.rewatchTier || "",
    allTimeRank: film.allTimeRank || "",
    centuryRank: film.centuryRank || "",
    decadeRank: film.decadeRank || "",
    yearRank: film.yearRank || "",
    posterUrl: film.poster?.url || "",
  };
};

// Typed, form-shaped snapshot of the film fields whose edits are reversible
// (issue #132). Identity (title/year), ranks, and the poster record stay out:
// their restoration is not an unambiguous field write.
let FILM_UNDO_FIELD_LABELS = {
  director: "director",
  rating: "rating",
  country: "country",
  primaryCountry: "primary country",
  url: "url",
  medium: "medium",
  screenplayType: "screenplay type",
  adaptationSource: "adaptation source",
  review: "review",
  tags: "tags",
  franchises: "franchises",
  wantToRewatch: "rewatchlist",
  rewatchTier: "rewatch tier",
};

function filmUndoSnapshot(source) {
  let snapshot = {};
  Object.keys(FILM_UNDO_FIELD_LABELS).forEach((key) => {
    snapshot[key] =
      key === "wantToRewatch"
        ? Boolean(source.wantToRewatch)
        : key === "tags"
        ? [...(source.tags || [])]
        : key === "franchises"
          ? window.formatFranchiseMemberships(source.franchises)
          : String(source[key] ?? "").trim();
  });
  return snapshot;
}

/** Updates metadata on every source copy of a film. @param {string} id Film id. @param {Object} values Metadata values. @param {Object} [options] Logging options. @returns {FilmRecord|null} Updated canonical film. */
window.updateFilmMetadata = function (id, values, options = {}) {
  let film = window.findFilmById(id) || window.findWatchedFilmById?.(id);
  if (!film) throw new Error("Film not found.");
  let beforeLog = {
    title: film.title,
    year: film.year,
    director: film.director,
    rating: film.rating,
    country: film.country,
    primaryCountry: film.primaryCountry,
    url: film.url,
    medium: film.medium,
    screenplayType: film.screenplayType,
    adaptationSource: film.adaptationSource,
    franchises: film.franchises,
    tags: film.tags,
    review: film.review,
    wantToRewatch: Boolean(film.wantToRewatch),
    rewatchTier: film.rewatchTier || "",
    allTimeRank: film.allTimeRank,
    centuryRank: film.centuryRank,
    decadeRank: film.decadeRank,
    yearRank: film.yearRank,
    posterUrl: film.poster?.url || "",
  };
  let title = String(values.title || "").trim();
  let year = String(values.year || "").trim();
  if (!title) throw new Error("Title is required.");
  if (!/^\d{4}$/.test(year)) throw new Error("Year must contain four digits.");
  let nextId = window.makeFilmId(year, title);
  let duplicate = Object.values(state.filmsById || {}).find(
    (candidate) => candidate.id !== film.id && candidate.id === nextId,
  );
  if (duplicate)
    throw new Error(`${duplicate.title} (${year}) already exists.`);

  let posterUrl = String(values.posterUrl || "").trim();
  if (posterUrl && !/^https?:\/\//i.test(posterUrl))
    throw new Error("Poster URL must use HTTP or HTTPS.");
  let sources = window.findSourceFilmsById(id);
  if (!sources.length) sources = [film];
  let directors = window.splitRecipientNames(values.director);
  let rankFields = ["allTimeRank", "centuryRank", "decadeRank", "yearRank"];

  sources.forEach((source) => {
    let sourceUsesActualYear = /^\d{4}$/.test(String(source.year || ""));
    source.title = title;
    source.normalizedTitle = window.normalizeTitle(title);
    if (sourceUsesActualYear) source.year = year;
    source.id = window.makeFilmId(
      sourceUsesActualYear ? year : source.year,
      title,
    );
    source.director = String(values.director || "").trim();
    source.directors = directors;
    // Drop the parsed rating fields so normalizeFilmMetadata re-derives them
    // from the new text; a stale ratingValue would otherwise overwrite it.
    source.rating = String(values.rating || "").trim();
    delete source.ratingValue;
    delete source.ratingModifier;
    source.country = String(values.country || "").trim();
    source.primaryCountry = String(values.primaryCountry || "").trim();
    source.url = String(values.url || "").trim();
    source.medium = values.medium || "unknown";
    source.screenplayType = values.screenplayType || "unknown";
    source.adaptationSource =
      source.screenplayType === "original"
        ? ""
        : window.normalizeAdaptationSource(values.adaptationSource);
    source.franchises = window.parseFranchiseMemberships(values.franchises);
    source.tags = window.parseFilmTags(
      values.tags === undefined ? source.tags : values.tags,
    );
    source.review =
      values.review === undefined
        ? String(source.review || "").trim()
        : String(values.review || "").trim();
    if (values.wantToRewatch === true || values.wantToRewatch === "on")
      source.wantToRewatch = true;
    else delete source.wantToRewatch;
    source.rewatchTier = source.wantToRewatch
      ? window.normalizeWatchlistTier(values.rewatchTier)
      : "";
    source.liveAction =
      source.medium === "animation"
        ? "Animation"
        : source.medium === "live-action"
          ? "Live action"
          : source.medium === "hybrid"
            ? "Hybrid"
            : "";
    source.adaptation =
      source.screenplayType === "original"
        ? "Original"
        : source.screenplayType === "adapted"
          ? "Adapted"
          : "";
    rankFields.forEach((field) => {
      let rank = Number(values[field]);
      source[field] = Number.isInteger(rank) && rank > 0 ? rank : null;
    });
    if (!posterUrl) delete source.poster;
    else if (source.poster?.url !== posterUrl) {
      source.poster = {
        url: posterUrl,
        source: "manual",
        sourceUrl: "",
        fetchedAt: new Date().toISOString(),
      };
    }
    window.normalizeFilmMetadata(source);
  });

  window.markAggregatesDirty?.("film metadata updated");
  window.ensureAggregatesFresh?.();
  let updatedFilm =
    window.findFilmById(nextId) ||
    window.findWatchedFilmById?.(nextId) ||
    Object.values(state.filmsById || {}).find(
      (candidate) =>
        candidate.normalizedTitle === window.normalizeTitle(title) &&
        String(candidate.year) === year,
    );
  if (options.log !== false && updatedFilm && window.recordEdit) {
    let afterLog = {
      title: updatedFilm.title,
      year: updatedFilm.year,
      director: updatedFilm.director,
      rating: updatedFilm.rating,
      country: updatedFilm.country,
      primaryCountry: updatedFilm.primaryCountry,
      url: updatedFilm.url,
      medium: updatedFilm.medium,
      screenplayType: updatedFilm.screenplayType,
      adaptationSource: updatedFilm.adaptationSource,
      franchises: updatedFilm.franchises,
      tags: updatedFilm.tags,
      review: updatedFilm.review,
      wantToRewatch: Boolean(updatedFilm.wantToRewatch),
      rewatchTier: updatedFilm.rewatchTier || "",
      allTimeRank: updatedFilm.allTimeRank,
      centuryRank: updatedFilm.centuryRank,
      decadeRank: updatedFilm.decadeRank,
      yearRank: updatedFilm.yearRank,
      posterUrl: updatedFilm.poster?.url || "",
    };
    let changes = window.editLogChanges(beforeLog, afterLog, [
      "title",
      "year",
      "director",
      "rating",
      "country",
      { key: "primaryCountry", label: "primary country" },
      "url",
      { key: "medium", label: "medium" },
      { key: "screenplayType", label: "screenplay type" },
      { key: "adaptationSource", label: "adaptation source" },
      "franchises",
      "tags",
      "review",
      { key: "wantToRewatch", label: "rewatchlist" },
      { key: "rewatchTier", label: "rewatch tier" },
      { key: "allTimeRank", label: "all-time rank" },
      { key: "centuryRank", label: "century rank" },
      { key: "decadeRank", label: "decade rank" },
      { key: "yearRank", label: "year rank" },
      { key: "posterUrl", label: "poster URL" },
    ]);
    if (changes.length) {
      // Reversible payload (issue #132): only when the film kept its
      // identity and every changed field is a supported typed field - a
      // partial undo would silently keep part of the edit.
      let undoBefore = filmUndoSnapshot(beforeLog);
      let undoAfter = filmUndoSnapshot(updatedFilm);
      let undoFields = Object.keys(FILM_UNDO_FIELD_LABELS)
        .filter(
          (key) =>
            JSON.stringify(undoBefore[key]) !== JSON.stringify(undoAfter[key]),
        )
        .map((key) => ({
          key,
          label: FILM_UNDO_FIELD_LABELS[key],
          before: undoBefore[key],
          after: undoAfter[key],
        }));
      window.recordEdit({
        type: "film metadata",
        summary: `${beforeLog.title || updatedFilm.title} (${beforeLog.year || updatedFilm.year || ""})`,
        sheetHint: "Film metadata / ranked list rows",
        changes,
        undo:
          updatedFilm.id === id &&
          undoFields.length &&
          undoFields.length === changes.length
            ? {
                version: 1,
                kind: "film-metadata",
                target: { filmId: updatedFilm.id },
                fields: undoFields,
              }
            : null,
        context: { filmId: updatedFilm.id, previousFilmId: id },
      });
    }
  }
  return updatedFilm;
};

/** Renames a film across its source records. @param {string} id Film id. @param {string} title New title. @returns {boolean} Whether renamed. */
window.renameFilm = function (id, title) {
  let film = window.findFilmById(id);
  let nextTitle = String(title || "").trim();
  if (!film || !nextTitle) return false;
  let oldId = film.id;
  let nextId = window.makeFilmId(film.year, nextTitle);
  if (nextId !== oldId && window.state.filmsById[nextId]) return false;
  let sources = window.findSourceFilmsById(oldId);
  if (!sources.length) sources = [film];
  sources.forEach((entry) => {
    entry.title = nextTitle;
    entry.normalizedTitle = window.normalizeTitle(nextTitle);
    entry.id = nextId;
  });
  window.markAggregatesDirty?.("film renamed");
  window.ensureAggregatesFresh?.();
  return true;
};

/** Updates award recipients across source copies after validation. @param {string} filmId Film id. @param {string} category Category. @param {number} placement Placement. @param {string} year Period key. @param {*} value Recipients. @returns {boolean} Whether updated. */
window.updateAwardRecipient = function (
  filmId,
  category,
  placement,
  year,
  value,
) {
  let sources = window.findSourceFilmsById(filmId);
  let canonical = window.findFilmById(filmId);
  let currentAward = window.findAwardOnFilm(
    canonical,
    category,
    placement,
    year,
  );
  if (!currentAward) return false;
  let candidate = window.cloneRecord(currentAward);
  let beforeText = window.awardRecipientText(currentAward);
  window.setAwardRecipients(candidate, value);
  let validation = window.validateAward(canonical, candidate, {
    periodType: window.getAwardPeriodType(candidate),
  });
  window.lastRuleViolation = validation;
  if (!validation.valid) return false;
  let changed = false;
  sources.forEach((film) => {
    let award = window.findAwardOnFilm(film, category, placement, year);
    if (!award) return;
    window.setAwardRecipients(award, value);
    changed = true;
  });
  if (!changed) return false;
  window.markAggregatesDirty?.("award recipients updated");
  window.ensureAggregatesFresh?.();
  let afterText = window.awardRecipientText(candidate);
  if (beforeText !== afterText && window.recordEdit) {
    window.recordEdit({
      type: "award credit",
      summary: `${canonical.title} (${year}) · ${category} #${placement}`,
      sheetHint: `${year} / ${category} recipients`,
      changes: [{ field: "recipients", before: beforeText, after: afterText }],
      context: { filmId, period: year, category, placement },
    });
  }
  return true;
};

/** Updates award detail across source copies. @param {string} filmId Film id. @param {string} category Category. @param {number} placement Placement. @param {string} year Period key. @param {*} value Detail. @returns {boolean} Whether updated. */
window.updateAwardDetail = function (filmId, category, placement, year, value) {
  let changed = false;
  let canonical = window.findFilmById(filmId);
  let currentAward = window.findAwardOnFilm(
    canonical,
    category,
    placement,
    year,
  );
  let beforeDetail = window.awardDetail(currentAward);
  let afterDetail = String(value || "").trim();
  window.findSourceFilmsById(filmId).forEach((film) => {
    let award = window.findAwardOnFilm(film, category, placement, year);
    if (!award) return;
    award.detail = String(value || "").trim();
    delete award.role;
    changed = true;
  });
  if (!changed) return false;
  window.markAggregatesDirty?.("award detail updated");
  window.ensureAggregatesFresh?.();
  if (beforeDetail !== afterDetail && window.recordEdit) {
    window.recordEdit({
      type: "award detail",
      summary: `${canonical?.title || "Film"} (${year}) · ${category} #${placement}`,
      sheetHint: `${year} / ${category} detail`,
      changes: [{ field: "detail", before: beforeDetail, after: afterDetail }],
      context: { filmId, period: year, category, placement },
    });
  }
  return true;
};

function rankingFilmIdentity(film) {
  return (
    window.filmIdentityKey?.(film, { includePeriodKey: true }) ||
    `${window.filmConcreteYear?.(film?.year) || String(film?.year || "")}\n${window.normalizeTitle(film?.title || "")}`
  );
}

/**
 * Builds a film's exact-rating bucket key (star value plus modifier).
 * @param {FilmRecord} film Film record.
 * @returns {string} Bucket key, or "" when unrated.
 */
window.rankingRatingKey = function (film) {
  let parsed = window.parseFilmRating?.(film) || { value: 0, modifier: "" };
  return parsed.value ? `${parsed.value}|${parsed.modifier || ""}` : "";
};

/**
 * Returns a rating bucket key's exact sortable grade from 1 through 30.
 * @param {string} key Bucket key from `rankingRatingKey`.
 * @returns {number}
 */
window.rankingRatingSortValueFromKey = function (key) {
  let parts = String(key || "").split("|");
  let value = Number(parts[0]) || 0;
  let modifier = parts[1] || "";
  return window.filmRatingGrade?.({
    ratingValue: value,
    ratingModifier: modifier,
  }) || 0;
};

/**
 * Lists ranked all-time source films in their current dense-rank order.
 * @returns {FilmRecord[]}
 */
window.allTimeSourceFilmsInOrder = function allTimeSourceFilmsInOrder() {
  return [...(window.state.years?.alltime?.films || [])]
    .filter(
      (film) =>
        film?.title &&
        !film.suppressAllTimeRank &&
        /^\d{4}$/.test(
          String(window.filmConcreteYear?.(film.year) || film.year || ""),
        ),
    )
    .sort(
      (left, right) =>
        Number(left.allTimeRank || left.rank || 999999) -
          Number(right.allTimeRank || right.rank || 999999) ||
        window.compareEnglishTitles(left.title, right.title),
    );
};

function findAllTimeSourceFilmById(id) {
  let canonical = window.findFilmById?.(id);
  let targetIdentity = canonical ? rankingFilmIdentity(canonical) : "";
  return (
    allTimeSourceFilmsInOrder().find(
      (film) =>
        film.id === id ||
        (targetIdentity && rankingFilmIdentity(film) === targetIdentity),
    ) || null
  );
}

/** Recomputes all-time, year, decade, and century ranks from all-time order. */
window.recomputeAllTimeRankProjections = function () {
  let sourceFilms = allTimeSourceFilmsInOrder();
  let watchedFilms = (window.state.watchedOther || []).filter(
    (film) => film?.title && Number(film.allTimeRank) > 0,
  );
  let allTimeFilms = [...sourceFilms, ...watchedFilms]
    .filter(
      (film, index, films) =>
        films.findIndex(
          (candidate) => rankingFilmIdentity(candidate) === rankingFilmIdentity(film),
        ) === index,
    )
    .sort(
      (left, right) =>
        Number(left.allTimeRank || left.rank || 999999) -
          Number(right.allTimeRank || right.rank || 999999) ||
        window.compareEnglishTitles(left.title, right.title),
    );
  let sourceIdentities = new Set(sourceFilms.map(rankingFilmIdentity));
  let unrankedSourceFilms = (window.state.years?.alltime?.films || []).filter(
    (film) => film?.suppressAllTimeRank,
  );
  if (window.state.years?.alltime)
    window.state.years.alltime.films = [
      ...allTimeFilms.filter((film) => sourceIdentities.has(rankingFilmIdentity(film))),
      ...unrankedSourceFilms,
    ];
  let identityRanks = new Map();
  let yearGroups = new Map();
  let decadeGroups = new Map();
  let centuryGroups = new Map();

  let nextAllTimeRank = 1;
  let allTimeGroupRanks = new Map();
  allTimeFilms.forEach((film) => {
    let year = window.filmConcreteYear?.(film.year) || String(film.year || "");
    let allTimeRank =
      film.rankingGroupId && allTimeGroupRanks.has(film.rankingGroupId)
        ? allTimeGroupRanks.get(film.rankingGroupId)
        : nextAllTimeRank;
    if (film.rankingGroupId && !allTimeGroupRanks.has(film.rankingGroupId)) {
      allTimeGroupRanks.set(film.rankingGroupId, allTimeRank);
    }
    if (!film.rankingGroupId || allTimeRank === nextAllTimeRank)
      nextAllTimeRank += 1;
    film.allTimeRank = allTimeRank;
    film.rank = allTimeRank;
    let identity = rankingFilmIdentity(film);
    identityRanks.set(identity, {
      allTimeRank,
      rankConfirmed: film.rankConfirmed,
      yearRank: null,
      decadeRank: null,
      centuryRank: null,
    });
    if (/^\d{4}$/.test(String(year))) {
      let yearKey = String(year);
      let decadeKey = window.getDecadeKey(year);
      let centuryKey = window.getCenturyKey(year);
      if (!yearGroups.has(yearKey)) yearGroups.set(yearKey, []);
      if (!decadeGroups.has(decadeKey)) decadeGroups.set(decadeKey, []);
      if (!centuryGroups.has(centuryKey)) centuryGroups.set(centuryKey, []);
      yearGroups.get(yearKey).push(film);
      decadeGroups.get(decadeKey).push(film);
      centuryGroups.get(centuryKey).push(film);
    }
  });

  function assignGroupRanks(groups, field) {
    groups.forEach((films) => {
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
        let ranks = identityRanks.get(rankingFilmIdentity(film));
        if (ranks) ranks[field] = rank;
      });
    });
  }
  assignGroupRanks(yearGroups, "yearRank");
  assignGroupRanks(decadeGroups, "decadeRank");
  assignGroupRanks(centuryGroups, "centuryRank");

  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      let ranks = identityRanks.get(rankingFilmIdentity(film));
      if (!ranks) return;
      film.allTimeRank = ranks.allTimeRank;
      film.yearRank = ranks.yearRank;
      film.decadeRank = ranks.decadeRank;
      film.centuryRank = ranks.centuryRank;
      film.rankConfirmed = ranks.rankConfirmed;
      if (period.periodType === "years") film.rank = ranks.yearRank;
      else if (period.periodType === "decades") film.rank = ranks.decadeRank;
      else if (period.periodType === "centuries") film.rank = ranks.centuryRank;
      else if (period.periodType === "allTime") film.rank = ranks.allTimeRank;
    });
  });

  Object.values(window.state.filmsById || {}).forEach((film) => {
    let ranks = identityRanks.get(rankingFilmIdentity(film));
    if (!ranks) return;
    film.allTimeRank = ranks.allTimeRank;
    film.yearRank = ranks.yearRank;
    film.decadeRank = ranks.decadeRank;
    film.centuryRank = ranks.centuryRank;
    film.rankConfirmed = ranks.rankConfirmed;
    film.rank = ranks.allTimeRank;
  });
};

/**
 * Orders rating buckets highest-first, flattens them into the all-time
 * order, assigns dense all-time ranks (keeping `rankingGroupId` groups on
 * one shared rank), and recomputes year/decade/century projections. Shared
 * by every caller that produces a resorted `buckets` map, so rank
 * assignment and projection stay in exactly one place.
 * @param {Map<string, FilmRecord[]>} buckets Films grouped by exact rating key.
 * @returns {FilmRecord[]} The flattened, ranked film order (excludes suppressed films).
 */
function flattenRankingBucketsAndRecompute(buckets) {
  let orderedKeys = [...buckets.keys()].sort(
    (left, right) =>
      rankingRatingSortValueFromKey(right) -
      rankingRatingSortValueFromKey(left),
  );
  let unrankedSourceFilms = (window.state.years?.alltime?.films || []).filter(
    (film) => film?.suppressAllTimeRank,
  );
  let orderedRankedFilms = orderedKeys.flatMap((key) => buckets.get(key));
  window.state.years.alltime.films = [
    ...orderedRankedFilms,
    ...unrankedSourceFilms,
  ];
  let nextRank = 1;
  let rankingGroupRanks = new Map();
  orderedRankedFilms.forEach((film) => {
    let rank =
      film.rankingGroupId && rankingGroupRanks.has(film.rankingGroupId)
        ? rankingGroupRanks.get(film.rankingGroupId)
        : nextRank;
    if (film.rankingGroupId && !rankingGroupRanks.has(film.rankingGroupId)) {
      rankingGroupRanks.set(film.rankingGroupId, rank);
    }
    if (!film.rankingGroupId || rank === nextRank) nextRank += 1;
    film.allTimeRank = rank;
    film.rank = rank;
  });
  window.recomputeAllTimeRankProjections();
  return orderedRankedFilms;
}

/** Moves an all-time film within its exact-rating bucket. @param {string} fromFilmId Moved film id. @param {string} toFilmId Target film id. @param {'before'|'after'} [position] Position. @returns {{ok: boolean, reason: string}|{ok: boolean}} Result. */
window.moveRankedFilmWithinRating = function (
  fromFilmId,
  toFilmId,
  position = "before",
) {
  if (!fromFilmId || !toFilmId || fromFilmId === toFilmId)
    return { ok: false, reason: "Choose two different films." };
  let fromFilm = findAllTimeSourceFilmById(fromFilmId);
  let toFilm = findAllTimeSourceFilmById(toFilmId);
  if (!fromFilm || !toFilm)
    return {
      ok: false,
      reason: "Both films must exist in the all-time ranked list.",
    };
  let fromRatingKey = rankingRatingKey(fromFilm);
  let toRatingKey = rankingRatingKey(toFilm);
  if (!fromRatingKey || !toRatingKey)
    return {
      ok: false,
      reason: "Both films need ratings before they can be ranked.",
    };
  if (fromRatingKey !== toRatingKey)
    return {
      ok: false,
      reason: "Ranking moves are limited to the same exact rating.",
    };
  let beforeRank = fromFilm.allTimeRank || fromFilm.rank || "";

  let allTimeFilms = allTimeSourceFilmsInOrder();
  let rankBefore = new Map(
    allTimeFilms.map((film) => [
      film.id,
      {
        allTimeRank: film.allTimeRank ?? null,
        yearRank: film.yearRank ?? null,
        decadeRank: film.decadeRank ?? null,
        centuryRank: film.centuryRank ?? null,
      },
    ]),
  );
  let buckets = new Map();
  allTimeFilms.forEach((film) => {
    let key = rankingRatingKey(film);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(film);
  });
  let bucket = [...(buckets.get(fromRatingKey) || [])];
  let fromIndex = bucket.indexOf(fromFilm);
  let toIndex = bucket.indexOf(toFilm);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex)
    return { ok: false, reason: "No ranking move needed." };
  bucket.splice(fromIndex, 1);
  toIndex = bucket.indexOf(toFilm);
  bucket.splice(position === "after" ? toIndex + 1 : toIndex, 0, fromFilm);
  buckets.set(fromRatingKey, bucket);

  // The two films the user actually placed relative to each other are a
  // deliberate decision, not the mechanical default order - mark them
  // confirmed so displays can stop showing NR for them.
  fromFilm.rankConfirmed = true;
  toFilm.rankConfirmed = true;

  flattenRankingBucketsAndRecompute(buckets);
  window.markAggregatesDirty?.("all-time ranking reordered");
  window.ensureAggregatesFresh?.();
  if (window.recordEdit) {
    // Bounded movement payload for issue #139: every film whose all-time or
    // period rank actually changed as a result of this move (not a
    // whole-archive snapshot - moving within one exact-rating bucket only
    // ripples through that bucket and its members' year/decade/century
    // peers). Capped defensively; the move itself always succeeds even if
    // an unusually large ripple gets truncated for display.
    let RANKING_MOVEMENT_MAX_FILMS = 50;
    let movedRanks = [];
    allTimeSourceFilmsInOrder().forEach((film) => {
      let before = rankBefore.get(film.id);
      if (!before) return;
      let after = {
        allTimeRank: film.allTimeRank ?? null,
        yearRank: film.yearRank ?? null,
        decadeRank: film.decadeRank ?? null,
        centuryRank: film.centuryRank ?? null,
      };
      if (
        before.allTimeRank !== after.allTimeRank ||
        before.yearRank !== after.yearRank ||
        before.decadeRank !== after.decadeRank ||
        before.centuryRank !== after.centuryRank
      )
        movedRanks.push({
          id: film.id,
          title: film.title,
          year: film.year,
          before,
          after,
        });
    });
    window.recordEdit({
      type: "all-time ranking reorder",
      summary: `${fromFilm.title} ${position} ${toFilm.title}`,
      sheetHint: "All-time ranked list",
      changes: [
        {
          field: fromFilm.title,
          before: String(beforeRank),
          after: String(fromFilm.allTimeRank || ""),
        },
        {
          field: "moved",
          before: "",
          after:
            position === "after"
              ? `after ${toFilm.title}`
              : `before ${toFilm.title}`,
        },
      ],
      target: { type: "film", id: fromFilm.id, label: fromFilm.title },
      context: {
        fromFilmId,
        toFilmId,
        position,
        ratingKey: fromRatingKey,
        movedRanks: movedRanks.slice(0, RANKING_MOVEMENT_MAX_FILMS),
        movedRanksTotal: movedRanks.length,
        movedRanksTruncated: movedRanks.length > RANKING_MOVEMENT_MAX_FILMS,
      },
    });
  }
  return { ok: true };
};

/**
 * Resets the all-time order to a default: rating (descending), then
 * release year (ascending), then title - optionally scoped to films
 * released within [fromYear, toYear]. Films outside the given range keep
 * their current position within their rating bucket; only the relative
 * order among in-scope films changes (a stable partial resort, not a
 * whole-bucket reshuffle). Rank fields are derived projections of one
 * global order (recomputeAllTimeRankProjections), so scoping by period
 * type isn't meaningful here - only by which films are involved.
 * @param {Object} [options] Scope controls.
 * @param {number} [options.fromYear] Inclusive lower release-year bound.
 * @param {number} [options.toYear] Inclusive upper release-year bound.
 * @returns {{changed: number}} Count of films whose all-time rank changed.
 */
window.resetRankingToDefaultOrder = function (options = {}) {
  let fromYear = Number.isFinite(options.fromYear)
    ? options.fromYear
    : -Infinity;
  let toYear = Number.isFinite(options.toYear) ? options.toYear : Infinity;

  function filmYear(film) {
    return Number(window.filmConcreteYear?.(film.year) || film.year) || null;
  }
  function inScope(film) {
    let year = filmYear(film);
    return year != null && year >= fromYear && year <= toYear;
  }

  let allTimeFilms = allTimeSourceFilmsInOrder();
  let rankBefore = new Map(
    allTimeFilms.map((film) => [film.id, film.allTimeRank ?? null]),
  );

  let buckets = new Map();
  allTimeFilms.forEach((film) => {
    let key = rankingRatingKey(film);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(film);
  });

  buckets.forEach((bucketFilms, key) => {
    // Each rankingGroupId is one atomic sort/scope unit so tied films
    // never separate - both the shared rank-assignment tail and
    // rankingConsistencyPairs assume group members stay adjacent. A group
    // is only in scope when every member falls in range, so a tied film
    // outside the requested range never gets swept along.
    let unitByGroup = new Map();
    let units = [];
    bucketFilms.forEach((film) => {
      if (film.rankingGroupId) {
        let unit = unitByGroup.get(film.rankingGroupId);
        if (!unit) {
          unit = {
            films: [],
            title: film.rankingGroupTitle || film.title,
          };
          unitByGroup.set(film.rankingGroupId, unit);
          units.push(unit);
        }
        unit.films.push(film);
      } else {
        units.push({ films: [film], title: film.title });
      }
    });
    units.forEach((unit) => {
      let years = unit.films.map(filmYear).filter((year) => year != null);
      unit.year = years.length ? Math.min(...years) : null;
      unit.scoped = unit.films.every((film) => inScope(film));
      // A reset drops back to the mechanical default order, not a real
      // opinion - every film the reset actually touches goes back to
      // unconfirmed (NR) until it's deliberately placed again.
      if (unit.scoped)
        unit.films.forEach((film) => {
          film.rankConfirmed = false;
        });
    });

    let scopedIndexes = [];
    units.forEach((unit, index) => {
      if (unit.scoped) scopedIndexes.push(index);
    });
    let resorted = scopedIndexes
      .map((index) => units[index])
      .sort(
        (left, right) =>
          (left.year ?? Infinity) - (right.year ?? Infinity) ||
          window.compareEnglishTitles(left.title, right.title),
      );
    scopedIndexes.forEach((index, order) => {
      units[index] = resorted[order];
    });

    buckets.set(
      key,
      units.flatMap((unit) => unit.films),
    );
  });

  flattenRankingBucketsAndRecompute(buckets);

  let changed = 0;
  allTimeSourceFilmsInOrder().forEach((film) => {
    if (rankBefore.get(film.id) !== (film.allTimeRank ?? null)) changed += 1;
  });
  return { changed };
};

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
