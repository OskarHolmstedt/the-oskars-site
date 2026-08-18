/**
 * @file Finds head-to-head ranking-consistency pairs for issue #138's
 * review tool: adjacent films sharing an exact rating bucket, so a
 * session can audit "do I still prefer the film above this one?" without
 * an exhaustive tournament. Reuses editing.js's existing bucket/order
 * helpers and its guarded `moveRankedFilmWithinRating` mutation - this
 * file only finds pairs, it never mutates ranking state itself.
 */

/**
 * Builds a stable identity key for one consistency pair, independent of
 * which film is currently ranked above the other.
 * @param {string} aboveId Currently higher-ranked film id.
 * @param {string} belowId Currently lower-ranked film id.
 * @returns {string}
 */
window.rankingConsistencyPairKey = function (aboveId, belowId) {
  return [String(aboveId || ""), String(belowId || "")].sort().join("::");
};

/**
 * Lists every currently-adjacent, same-exact-rating film pair eligible for
 * a consistency review, highest rating first. Recomputed fresh on every
 * call from live ranking state, so it always reflects the latest order -
 * including any moves applied earlier in the same session.
 * @param {Set<string>} [excludeKeys] Pair keys already resolved this session.
 * @returns {{key:string, above:FilmRecord, below:FilmRecord}[]}
 */
window.rankingConsistencyPairs = function (excludeKeys) {
  return buildRankingConsistencyPairs(window.allTimeSourceFilmsInOrder(), excludeKeys);
};

/**
 * Same as `rankingConsistencyPairs`, scoped to one year's watched films -
 * for a "resolve this year's ties" flow instead of an archive-wide audit.
 * @param {string|number} year Concrete film year, e.g. "2024".
 * @param {Set<string>} [excludeKeys] Pair keys already resolved this session.
 * @returns {{key:string, above:FilmRecord, below:FilmRecord}[]}
 */
window.rankingConsistencyPairsForYear = function (year, excludeKeys) {
  let target = String(year || "");
  let films = window.allTimeSourceFilmsInOrder().filter(
    (film) =>
      String(window.filmConcreteYear?.(film.year) || film.year || "") ===
      target,
  );
  return buildRankingConsistencyPairs(films, excludeKeys);
};

/** Normalizes ranking-review URL scope names. @param {string} type Scope type. @returns {'years'|'decades'|'centuries'|'allTime'} Canonical scope type. */
window.normalizeRankingReviewScopeType = function (type) {
  return {
    year: "years",
    years: "years",
    decade: "decades",
    decades: "decades",
    century: "centuries",
    centuries: "centuries",
    alltime: "allTime",
    allTime: "allTime",
  }[type] || "allTime";
};

/** Lists films inside a year heat or progressive final. @param {string} type Scope type. @param {string} key Scope key. @returns {FilmRecord[]} Ranked films in canonical order. */
window.rankingReviewScopeFilms = function (type, key) {
  type = window.normalizeRankingReviewScopeType(type);
  key = type === "allTime" ? "alltime" : String(key || "");
  return window.allTimeSourceFilmsInOrder().filter((film) => {
    let year = String(window.filmConcreteYear?.(film.year) || film.year || "");
    if (type === "years") return year === key;
    if (type === "decades") return window.getDecadeKey(year) === key;
    if (type === "centuries") return window.getCenturyKey(year) === key;
    return true;
  });
};

function rankingReviewBucket(type, key) {
  type = window.normalizeRankingReviewScopeType(type);
  key = type === "allTime" ? "alltime" : String(key || "");
  window.state.rankingReviews ||= {
    years: {}, decades: {}, centuries: {}, allTime: {},
  };
  window.state.rankingReviews[type] ||= {};
  window.state.rankingReviews[type][key] ||= [];
  return window.state.rankingReviews[type][key];
}

/** Returns durable reviewed pair keys for one heat/final. @param {string} type Scope type. @param {string} key Scope key. @returns {Set<string>} Reviewed keys. */
window.rankingReviewResolvedKeys = function (type, key) {
  return new Set(rankingReviewBucket(type, key));
};

function pairCrossesNarrowerScope(type, pair) {
  type = window.normalizeRankingReviewScopeType(type);
  let aboveYear = String(window.filmConcreteYear?.(pair.above.year) || pair.above.year || "");
  let belowYear = String(window.filmConcreteYear?.(pair.below.year) || pair.below.year || "");
  if (type === "years") return true;
  if (type === "decades") return aboveYear !== belowYear;
  if (type === "centuries")
    return window.getDecadeKey(aboveYear) !== window.getDecadeKey(belowYear);
  return window.getCenturyKey(aboveYear) !== window.getCenturyKey(belowYear);
}

/** Lists unresolved adjacent comparisons for one heat/final, excluding decisions settled at narrower scopes. @param {string} type Scope type. @param {string} key Scope key. @param {Set<string>} [extraExcludeKeys] Session exclusions. @returns {{key:string, above:FilmRecord, below:FilmRecord}[]} Review pairs. */
window.rankingConsistencyPairsForScope = function (type, key, extraExcludeKeys) {
  let excluded = window.rankingReviewResolvedKeys(type, key);
  extraExcludeKeys?.forEach((pairKey) => excluded.add(pairKey));
  return buildRankingConsistencyPairs(
    window.rankingReviewScopeFilms(type, key),
    excluded,
  ).filter((pair) => pairCrossesNarrowerScope(type, pair));
};

/** Persists acceptance of one adjacent ordering and marks its films deliberately ranked. @param {string} type Scope type. @param {string} key Scope key. @param {{key:string, above:FilmRecord, below:FilmRecord}} pair Reviewed pair. @returns {boolean} Whether a new decision was recorded. */
window.resolveRankingReviewPair = function (type, key, pair) {
  let bucket = rankingReviewBucket(type, key);
  let added = !bucket.includes(pair.key);
  if (added) bucket.push(pair.key);
  pair.above.rankConfirmed = true;
  pair.below.rankConfirmed = true;
  return added;
};

/** Accepts a same-rating year shelf unchanged and persists every adjacent pair decision. @param {string|number} year Release year. @param {string} ratingKey Exact rating key. @returns {{ok:boolean, reviewed:number}} Result. */
window.confirmYearRankingBucket = function (year, ratingKey) {
  let films = window.rankingReviewScopeFilms("years", String(year)).filter(
    (film) => window.rankingRatingKey(film) === ratingKey,
  );
  if (!films.length) return { ok: false, reviewed: 0 };
  films.forEach((film) => { film.rankConfirmed = true; });
  let reviewed = 0;
  for (let index = 0; index < films.length - 1; index += 1) {
    let pair = {
      key: window.rankingConsistencyPairKey(films[index].id, films[index + 1].id),
      above: films[index],
      below: films[index + 1],
    };
    if (window.resolveRankingReviewPair("years", String(year), pair)) reviewed += 1;
  }
  return { ok: true, reviewed };
};

function buildRankingConsistencyPairs(films, excludeKeys) {
  let buckets = new Map();
  films.forEach((film) => {
    let key = window.rankingRatingKey(film);
    if (!key) return;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(film);
  });
  let orderedKeys = [...buckets.keys()].sort(
    (left, right) =>
      window.rankingRatingSortValueFromKey(right) -
      window.rankingRatingSortValueFromKey(left),
  );
  let pairs = [];
  orderedKeys.forEach((ratingKey) => {
    let bucketFilms = buckets.get(ratingKey);
    for (let index = 0; index < bucketFilms.length - 1; index++) {
      let above = bucketFilms[index];
      let below = bucketFilms[index + 1];
      if (above.rankingGroupId && above.rankingGroupId === below.rankingGroupId)
        continue;
      let key = window.rankingConsistencyPairKey(above.id, below.id);
      if (excludeKeys?.has(key)) continue;
      pairs.push({ key, above, below });
    }
  });
  return pairs;
}
