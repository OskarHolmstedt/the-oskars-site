/**
 * @file Scores TMDB and Wikimedia search results against film or person identity.
 */

function posterYear(value) {
  return String(value || "").match(/^\d{4}/)?.[0] || "";
}

// Comparison-only title normalization for matching against external sources
// (TMDB, Wikimedia). NOT the same as window.normalizeTitle, which also
// derives persisted film/person/franchise IDs and must stay stable. This one
// additionally folds accent marks and the apostrophe/dash character variants
// that differ between locally-typed titles and what these APIs return (e.g.
// straight vs curly vs acute-accent apostrophes, or a plain hyphen vs an en
// dash or em dash), which otherwise makes an exact match silently fail.
function looseComparableTitle(value) {
  return normalizeTitle(String(value || "").replace(/\s*&\s*/g, " and "))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201a\u201b\u02bc\u02bb\u2032\u00b4`]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
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

/** Selects the best TMDB person with a profile image. @param {PersonRecord} person Person. @param {Object[]} results Results. @returns {Object|null} Result. */
window.selectTmdbPersonPortrait = function (person, results) {
  let name =
    window.normalizePersonName?.(person?.name) ||
    window.recipientPersonId(person?.name);
  let filmTitles = new Set(
    (person?.filmIds || [])
      .map((id) => looseComparableTitle(window.state.filmsById?.[id]?.title))
      .filter(Boolean),
  );
  let matches = (results || [])
    .filter((result) => result?.profile_path)
    .map((result, index) => {
      let resultName =
        window.normalizePersonName?.(result.name) ||
        window.recipientPersonId(result.name);
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

/** Selects the best Wikimedia film page with an image. @param {FilmRecord} film Film. @param {Object[]} pages Pages. @returns {Object|null} Page. */
window.selectWikimediaPoster = function (film, pages) {
  let title = looseComparableTitle(film?.title);
  let year = String(film?.year || "");
  let matches = (pages || [])
    .filter((page) => {
      let image = page?.thumbnail || page?.original;
      let description = String(
        page?.terms?.description?.[0] || "",
      ).toLowerCase();
      let imageName = String(page?.pageimage || "").toLowerCase();
      let filmDescription =
        /\b(film|movie|motion picture|documentary|animated short)\b/.test(
          description,
        );
      let matchingYear =
        !year ||
        String(page.title || "").includes(year) ||
        description.includes(year);
      let portrait =
        !image?.width || !image?.height || image.height / image.width >= 1.2;
      let bookDescription =
        /\b(book|novel)\b/.test(description) && !filmDescription;
      let bookImage =
        /(?:book|novel|edition|cover)[_. -]/.test(imageName) &&
        !imageName.includes("poster");
      let likelyBookCover = bookDescription || bookImage;
      return (
        image?.source &&
        filmDescription &&
        matchingYear &&
        portrait &&
        !likelyBookCover
      );
    })
    .map((page, index) => {
      let pageTitle = looseComparableTitle(page.title).replace(
        /\s*\([^)]*film\)\s*$/,
        "",
      );
      let description = normalizeTitle(page.terms?.description?.[0]);
      let score =
        (pageTitle === title
          ? 100
          : pageTitle.includes(title) || title.includes(pageTitle)
            ? 30
            : 0) +
        (year &&
        (String(page.title || "").includes(year) || description.includes(year))
          ? 50
          : 0) -
        Number(page.index || index);
      return { page, score };
    })
    .sort((left, right) => right.score - left.score);
  return matches[0]?.score >= 80 ? matches[0].page : null;
};
