/**
 * @file Scores TMDB search results against film or person identity.
 */

function posterYear(value) {
  return String(value || "").match(/^\d{4}/)?.[0] || "";
}

// Comparison-only title normalization for matching against external sources
// from TMDB. NOT the same as window.normalizeTitle, which also
// derives persisted film/person/franchise IDs and must stay stable. This one
// additionally folds accent marks and the apostrophe/dash character variants
// that differ between locally-typed titles and what these APIs return (e.g.
// straight vs curly vs acute-accent apostrophes, or a plain hyphen vs an en
// dash or em dash), which otherwise makes an exact match silently fail.
function looseComparableTitle(value) {
  return window.comparableFilmTitle(value);
}

function tmdbMovieTitles(result, details) {
  return [
    result?.title,
    result?.original_title,
    details?.title,
    details?.original_title,
    ...(details?.alternative_titles?.titles || []).map((item) => item?.title),
  ]
    .map(looseComparableTitle)
    .filter(Boolean);
}

function scoreTmdbMovieMatch(film, result, index, details) {
  let title = looseComparableTitle(film?.title);
  let year = String(film?.year || "");
  let titles = tmdbMovieTitles(result, details);
  let titleScore = titles.includes(title)
    ? 100
    : titles.some((value) => value.includes(title) || title.includes(value))
      ? 30
      : 0;
  return (
    titleScore +
    (year && posterYear(result?.release_date || details?.release_date) === year
      ? 50
      : 0) -
    index
  );
}

/** Selects the best TMDB result with a poster. @param {FilmRecord} film Film. @param {Object[]} results Results. @returns {Object|null} Result. */
window.selectTmdbPoster = function (film, results) {
  let title = looseComparableTitle(film?.title);
  let year = String(film?.year || "");
  let matches = (results || [])
    .filter((result) => result?.poster_path)
    .map((result, index) => {
      let titles = [result.title, result.original_title]
        .map(looseComparableTitle)
        .filter(Boolean);
      let score =
        (titles.includes(title)
          ? 100
          : titles.some(
                (value) => value.includes(title) || title.includes(value),
              )
            ? 30
            : 0) +
        (year && posterYear(result.release_date) === year ? 50 : 0) -
        index;
      return { result, score };
    })
    .sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 80 ? matches[0].result : null;
};

/** Selects the best TMDB movie using optional alternative titles. @param {FilmRecord} film Film. @param {Object[]} results Results. @param {Record<string, Object>} [detailsById] Details. @returns {Object|null} Result. */
window.selectTmdbMovie = function (film, results, detailsById) {
  let matches = (results || [])
    .map((result, index) => {
      let score = scoreTmdbMovieMatch(
        film,
        result,
        index,
        detailsById?.[result.id],
      );
      return { result, score };
    })
    .sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 80 ? matches[0].result : null;
};

// TV's own search-result shape uses "name"/"original_name" instead of
// "title"/"original_title" and "first_air_date" instead of "release_date" -
// otherwise an exact mirror of scoreTmdbMovieMatch/selectTmdbMovie's scoring.
function tmdbTvTitles(result) {
  return [result?.name, result?.original_name]
    .map(looseComparableTitle)
    .filter(Boolean);
}

function scoreTmdbTvMatch(film, result, index) {
  let title = looseComparableTitle(film?.title);
  let year = String(film?.year || "");
  let titles = tmdbTvTitles(result);
  let titleScore = titles.includes(title)
    ? 100
    : titles.some((value) => value.includes(title) || title.includes(value))
      ? 30
      : 0;
  return (
    titleScore +
    (year && posterYear(result?.first_air_date) === year ? 50 : 0) -
    index
  );
}

/** Selects the best TMDB TV series. @param {FilmRecord} film Film-like record. @param {Object[]} results Results. @returns {Object|null} Result. */
window.selectTmdbTvShow = function (film, results) {
  let matches = (results || [])
    .map((result, index) => ({
      result,
      score: scoreTmdbTvMatch(film, result, index),
    }))
    .sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 80 ? matches[0].result : null;
};

/** Selects the best TMDB person with a profile image. @param {PersonRecord} person Person. @param {Object[]} results Results. @returns {Object|null} Result. */
window.selectTmdbPersonPortrait = function (person, results) {
  let name = window.normalizePersonName(person?.name);
  let filmTitles = new Set(
    (person?.filmIds || [])
      .map((id) => looseComparableTitle(window.state.filmsById?.[id]?.title))
      .filter(Boolean),
  );
  let matches = (results || [])
    .filter((result) => result?.profile_path)
    .map((result, index) => {
      let resultName = window.normalizePersonName(result.name);
      let knownForMatches = (result.known_for || []).filter((item) =>
        filmTitles.has(looseComparableTitle(item.title || item.name)),
      ).length;
      let score =
        (resultName === name ? 100 : 0) +
        knownForMatches * 25 +
        Math.min(10, Number(result.popularity || 0) / 10) -
        index / 100;
      return { result, score };
    })
    .sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 100 ? matches[0].result : null;
};
