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

// Only whole-title equality may ignore punctuation ("the '60s" vs "the
// 60s"). The substring tier keeps it: without punctuation "Twin Peaks: The
// Return" is contained in the unrelated short "Twin Peaks The Return: Bad
// Binoculars".
function titleWords(value) {
  return looseComparableTitle(value)
    .replace(/'/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

// Translated titles only count as exact matches; as substrings they would
// admit far too many unrelated films.
function scoreTitleMatch(filmTitle, titles, exactOnlyTitles = []) {
  let title = looseComparableTitle(filmTitle);
  let words = titleWords(filmTitle);
  let candidates = titles.map(looseComparableTitle).filter(Boolean);
  if (
    candidates.includes(title) ||
    (words &&
      [...titles, ...exactOnlyTitles].some(
        (value) => titleWords(value) === words,
      ))
  )
    return 100;
  return candidates.some(
    (value) => value.includes(title) || title.includes(value),
  )
    ? 30
    : 0;
}

function scoreTmdbMovieMatch(film, result, index, details) {
  let year = String(film?.year || "");
  let titleScore = scoreTitleMatch(
    film?.title,
    [
      result?.title,
      result?.original_title,
      details?.title,
      details?.original_title,
      ...(details?.alternative_titles?.titles || []).map((item) => item?.title),
    ],
    (details?.translations?.translations || []).map(
      (item) => item?.data?.title,
    ),
  );
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
  let matches = (results || [])
    .filter((result) => result?.poster_path)
    .map((result, index) => ({
      result,
      score: scoreTmdbMovieMatch(film, result, index),
    }))
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
function scoreTmdbTvMatch(film, result, index) {
  let year = String(film?.year || "");
  return (
    scoreTitleMatch(film?.title, [result?.name, result?.original_name]) +
    (year && posterYear(result?.first_air_date) === year ? 50 : 0) -
    index
  );
}

/**
 * Selects the best TMDB TV series. With a known year the series must have
 * first aired in it, or within `yearTolerance` years of it; only an exact
 * title clears the bar without the same-year bonus.
 * @param {FilmRecord} film Film-like record.
 * @param {Object[]} results Results.
 * @param {number} [yearTolerance] Years the first-air year may differ by.
 * @returns {Object|null} Result.
 */
window.selectTmdbTvShow = function (film, results, yearTolerance = 0) {
  let year = Number(film?.year) || null;
  let matches = (results || [])
    .filter((result) => {
      if (!year) return true;
      let aired = Number(posterYear(result?.first_air_date));
      return Boolean(aired) && Math.abs(aired - year) <= yearTolerance;
    })
    .map((result, index) => ({
      result,
      score: scoreTmdbTvMatch(film, result, index),
    }))
    .sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 80 ? matches[0].result : null;
};

/**
 * Selects the season of a TMDB series whose "<series> <season name>" title
 * equals the film's title, ignoring punctuation ("Twin Peaks: The Return" is
 * Twin Peaks season 3, "Cunk on Earth" is season 2 "Earth" of "Cunk on...").
 * With a known year the season must have aired within a year of it.
 * @param {FilmRecord} film Film-like record.
 * @param {{name?: string, original_name?: string, seasons?: {season_number: number, name?: string, air_date?: string}[]}} series TMDB series details.
 * @returns {{season_number: number, name?: string, air_date?: string, poster_path?: string}|null} The matching season.
 */
window.selectTmdbTvSeason = function (film, series) {
  let words = titleWords(film?.title);
  let year = Number(film?.year) || null;
  let seriesNames = [series?.name, series?.original_name]
    .map(titleWords)
    .filter(Boolean);
  if (!words || !seriesNames.length) return null;
  return (
    (series?.seasons || []).find((season) => {
      if (!(Number(season?.season_number) >= 1)) return false;
      let seasonName = titleWords(season?.name);
      if (!seasonName) return false;
      if (!seriesNames.some((name) => `${name} ${seasonName}` === words))
        return false;
      let aired = Number(posterYear(season?.air_date));
      return !year || (Boolean(aired) && Math.abs(aired - year) <= 1);
    }) || null
  );
};

/**
 * Tests whether a TMDB series name begins the film's title, the only case in
 * which one of its seasons can match it.
 * @param {FilmRecord} film Film-like record.
 * @param {{name?: string, original_name?: string}} series TMDB series search result.
 * @returns {boolean} Whether the series is worth checking season by season.
 */
window.tmdbSeriesPrefixesTitle = function (film, series) {
  let words = titleWords(film?.title);
  return [series?.name, series?.original_name]
    .map(titleWords)
    .some((name) => name && words.startsWith(`${name} `));
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
