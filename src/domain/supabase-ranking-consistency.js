/**
 * @file Finds unresolved adjacent exact-rating comparisons inside one independently
 * stored Supabase period ranking, excluding same-narrower-period comparisons in finals.
 */

/** Builds a stable identity key for one consistency pair. @param {string} filmIdA @param {string} filmIdB @returns {string} */
window.supabaseRankingConsistencyPairKey = function (filmIdA, filmIdB) {
  return [String(filmIdA || ""), String(filmIdB || "")].sort().join("::");
};

/**
 * A ranking entry's exact-rating bucket key, or "" when unrated.
 * @param {{rating?: number, rating_modifier?: string}} watchedRow
 * @returns {string}
 */
window.supabaseRankingRatingKey = function (watchedRow) {
  let parsed = window.parseFilmRating({
    ratingValue: watchedRow?.rating,
    ratingModifier: watchedRow?.rating_modifier,
  });
  return parsed.value ? `${parsed.value}|${parsed.modifier || ""}` : "";
};

/**
 * A rating bucket key's exact sortable grade from 1 through 30 (issue
 * #432), companion to supabaseRankingRatingKey - reuses
 * src/ui/film-rating.js's filmRatingGrade rather than duplicating its
 * star/modifier-to-grade math.
 * @param {string} key Bucket key from supabaseRankingRatingKey.
 * @returns {number}
 */
window.supabaseRankingRatingSortValueFromKey = function (key) {
  let parts = String(key || "").split("|");
  let value = Number(parts[0]) || 0;
  let modifier = parts[1] || "";
  return (
    window.filmRatingGrade?.({
      ratingValue: value,
      ratingModifier: modifier,
    }) || 0
  );
};

/** Normalizes ranking-review URL scope names. @param {string} type Scope type. @returns {'years'|'decades'|'centuries'|'allTime'} */
window.normalizeSupabaseRankingReviewScopeType = function (type) {
  return (
    {
      year: "years",
      years: "years",
      decade: "decades",
      decades: "decades",
      century: "centuries",
      centuries: "centuries",
      alltime: "allTime",
      allTime: "allTime",
    }[type] || "allTime"
  );
};

/** Tests whether a joined film row belongs to one ranking scope. @param {string} scopeType @param {string} scopeKey @param {Object} entry @returns {boolean} */
window.supabaseRankingEntryInScope = function (scopeType, scopeKey, entry) {
  if (scopeType === "allTime") return true;
  let year = entry.films?.year;
  if (scopeType === "years") return String(year) === String(scopeKey);
  if (scopeType === "decades") return window.getDecadeKey(year) === scopeKey;
  return window.getCenturyKey(year) === scopeKey;
};

function supabasePairCrossesNarrowerScope(scopeType, above, below) {
  let aboveYear = above.films?.year;
  let belowYear = below.films?.year;
  if (scopeType === "years") return true;
  if (scopeType === "decades") return aboveYear !== belowYear;
  if (scopeType === "centuries")
    return window.getDecadeKey(aboveYear) !== window.getDecadeKey(belowYear);
  return window.getCenturyKey(aboveYear) !== window.getCenturyKey(belowYear);
}

/**
 * Lists unresolved, overall-adjacent, same-rating comparisons for one
 * heat/final, excluding decisions already settled at a narrower scope
 * and any extra session-only exclusions (skips).
 * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
 * @param {string} scopeKey
 * @param {Object[]} allEntries The selected ranking’s position-ordered entries.
 * @param {Map<string, Object>} watchedByFilmId film_id -> watched row (rating, rating_modifier).
 * @param {Set<string>} resolvedKeys Already-reviewed pair keys for this scope.
 * @param {Set<string>} [extraExcludeKeys] Session-only exclusions (skips).
 * @returns {{key: string, above: Object, below: Object}[]}
 */
window.supabaseRankingConsistencyPairs = function (
  scopeType,
  scopeKey,
  allEntries,
  watchedByFilmId,
  resolvedKeys,
  extraExcludeKeys,
) {
  let pairs = [];
  for (let index = 0; index < allEntries.length - 1; index += 1) {
    let above = allEntries[index];
    let below = allEntries[index + 1];
    if (
      !window.supabaseRankingEntryInScope(scopeType, scopeKey, above) ||
      !window.supabaseRankingEntryInScope(scopeType, scopeKey, below)
    )
      continue;
    let aboveKey = window.supabaseRankingRatingKey(
      watchedByFilmId.get(above.film_id),
    );
    let belowKey = window.supabaseRankingRatingKey(
      watchedByFilmId.get(below.film_id),
    );
    if (!aboveKey || aboveKey !== belowKey) continue;
    if (!supabasePairCrossesNarrowerScope(scopeType, above, below)) continue;
    let key = window.supabaseRankingConsistencyPairKey(
      above.film_id,
      below.film_id,
    );
    if (resolvedKeys?.has(key)) continue;
    if (extraExcludeKeys?.has(key)) continue;
    pairs.push({ key, above, below });
  }
  return pairs;
};
