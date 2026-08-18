/** @file Owns the all-time ranking projection engine: dense-rank assignment, exact-rating-bucket ordering, and year/decade/century derived rank projection. */

// A ranking-workflow film may carry a provisional `.rank` before its
// `.allTimeRank` is finalized; this maps either onto the shared
// all-time-rank comparator's expected `allTimeRank` field.
function rankingComparatorFilmOf(item) {
  return { allTimeRank: item.allTimeRank || item.rank, title: item.title };
}

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
    .sort((left, right) =>
      window.compareByAllTimeRank(left, right, rankingComparatorFilmOf, {
        yearFallback: false,
      }),
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
    .sort((left, right) =>
      window.compareByAllTimeRank(left, right, rankingComparatorFilmOf, {
        yearFallback: false,
      }),
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

