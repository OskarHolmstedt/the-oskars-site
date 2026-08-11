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
