/** @file Shared sort-key comparators for names, titles, seeded shuffle, mixed watched/watchlist film-axis rows, aggregate rating statistics, and all-time rank. */

/** Builds a surname-first person sort key. @param {*} value Person name. @returns {string} */
window.personSurnameSortKey = function (value) {
  let name = String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ");
  let withoutSuffix = name
    .replace(/,\s*((?:Jr|Sr)\.?|II|III|IV)\b/gi, "")
    .trim();
  let parts = withoutSuffix.split(" ").filter(Boolean);
  if (parts.length <= 1) return withoutSuffix;
  let surname = parts[parts.length - 1];
  let given = parts.slice(0, -1).join(" ");
  return `${surname}, ${given}`;
};

/** Compares person names by surname-first keys. @param {*} left Left name. @param {*} right Right name. @returns {number} */
window.comparePersonNamesBySurname = function (left, right) {
  return (
    String(window.personSurnameSortKey(left)).localeCompare(
      String(window.personSurnameSortKey(right)),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    ) ||
    String(left || "").localeCompare(String(right || ""), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );
};

/** Builds an English title sort key with leading articles moved last. @param {*} value Title or titled object. @returns {string} */
window.englishTitleSortKey = function (value) {
  let title = String(
    value && typeof value === "object" ? value.title : value || "",
  )
    .normalize("NFKC")
    .trim();
  let articleMatch = title.match(/^(the|an|a)\s+(.+)$/i);
  if (!articleMatch) return title;
  return `${articleMatch[2]}, ${articleMatch[1]}`;
};

/** Compares English titles while ignoring leading articles. @param {*} left Left title. @param {*} right Right title. @returns {number} */
window.compareEnglishTitles = function (left, right) {
  return (
    String(window.englishTitleSortKey(left)).localeCompare(
      String(window.englishTitleSortKey(right)),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    ) ||
    String(
      left && typeof left === "object" ? left.title : left || "",
    ).localeCompare(
      String(right && typeof right === "object" ? right.title : right || ""),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    )
  );
};

/** Builds a deterministic unsigned shuffle value. @param {*} key Item key. @param {string} [seed] Shuffle seed. @returns {number} */
window.seededShuffleValue = function (key, seed = "") {
  let text = `${seed}::${key}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

// A fresh, unique-enough seed for a "reshuffle" action - every multi-film
// view's shuffle button generates one of these so each click lands on a
// genuinely different order, not just the page's initial load order.
/** Generates a fresh shuffle seed for a user action. @returns {string} */
window.freshShuffleSeed = function () {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

/** Compares two keys in a deterministic seeded shuffle. @param {*} leftKey Left key. @param {*} rightKey Right key. @param {string} [seed] Shuffle seed. @returns {number} */
window.compareBySeededShuffle = function (leftKey, rightKey, seed = "") {
  return (
    window.seededShuffleValue(leftKey, seed) -
    window.seededShuffleValue(rightKey, seed)
  );
};

/**
 * Resolves one sort-axis value for a mixed watched/watchlist row, mapping
 * both record types onto one comparable scale per axis: `rank` is the
 * all-time rank (unranked and watchlist rows sort last), `rating` is the
 * star rating for watched films and the interest tier normalized onto the
 * same higher-is-better direction for watchlist items, and the award axes
 * (`wins`/`nominations`/`score`) count 0 for watchlist rows, which carry no
 * awards of their own yet.
 * @param {FilmAxisRecord} record Row to resolve.
 * @param {'year'|'rank'|'rating'|'wins'|'nominations'|'score'} axis Sort axis.
 * @returns {number} Comparable value on the axis's natural ascending scale.
 */
window.filmAxisSortValue = function (record, axis) {
  let film = record?.film;
  if (axis === "year") return Number((film || record?.item)?.year || 0);
  if (axis === "rank") {
    let rank = Number(film?.allTimeRank);
    return Number.isFinite(rank) && rank > 0 ? rank : 999999;
  }
  if (axis === "rating") {
    if (film) return window.filmRatingScore(film.rating) || 0;
    let tierRank = window.watchlistTierRank?.(record?.item?.tier);
    return Number.isFinite(tierRank) ? 6 - tierRank : -1;
  }
  if (axis === "wins")
    return film ? window.calculateAwardStats(film.awards || []).wins || 0 : 0;
  if (axis === "nominations")
    return film
      ? window.calculateAwardStats(film.awards || []).nominations || 0
      : 0;
  if (axis === "score")
    return film
      ? window.calculateAwardStats(film.awards || []).awardScore || 0
      : 0;
  return 0;
};

/**
 * Default direction for a film sort axis: axes where a higher value is
 * better (`rating`, `wins`, `nominations`, `score`) start descending so the
 * initial view is best-first; every other axis starts ascending.
 * @param {string} axis Sort axis.
 * @returns {'asc'|'desc'} Default order for the axis.
 */
window.defaultOrderForFilmAxis = function (axis) {
  return axis === "rating" ||
    axis === "wins" ||
    axis === "nominations" ||
    axis === "score"
    ? "desc"
    : "asc";
};

/**
 * Compares two mixed watched/watchlist rows on a shared sort axis:
 * `shuffle` runs the seeded shuffle over record ids, `title` compares
 * localized titles, and every other axis resolves through
 * `filmAxisSortValue`, tie-breaking by localized title A-Z regardless of
 * `order` so reversed views keep stable title runs.
 * @param {FilmAxisRecord} left Left row.
 * @param {FilmAxisRecord} right Right row.
 * @param {Object} options Comparison options.
 * @param {string} options.axis Any `filmAxisSortValue` axis, `title`, or `shuffle`.
 * @param {'asc'|'desc'} [options.order] Direction for the primary axis.
 * @param {string} [options.seed] Seed for the `shuffle` axis.
 * @returns {number} Negative when `left` sorts first.
 */
window.compareFilmAxisRecords = function (left, right, options = {}) {
  let title = (record) =>
    window.localizedFilmTitle?.(record?.film || record?.item) ||
    (record?.film || record?.item)?.title ||
    "";
  if (options.axis === "shuffle") {
    return window.compareBySeededShuffle(
      (left?.film || left?.item)?.id,
      (right?.film || right?.item)?.id,
      options.seed || "",
    );
  }
  let result =
    options.axis === "title"
      ? window.compareEnglishTitles(title(left), title(right))
      : window.filmAxisSortValue(left, options.axis) -
        window.filmAxisSortValue(right, options.axis);
  if (options.order === "desc") result = -result;
  if (options.axis === "title") return result;
  return result || window.compareEnglishTitles(title(left), title(right));
};

/**
 * Compares two entities by aggregate rating statistics: unrated entities
 * sort last, rated entities compare by mean (direction per `order`) then by
 * sample size (larger first). Callers add their own name tie-break for a
 * fully stable order.
 * @param {{ratedCount:number, mean:number}} leftStats Left entity's rating statistics.
 * @param {{ratedCount:number, mean:number}} rightStats Right entity's rating statistics.
 * @param {'asc'|'desc'} [order] Direction for the mean comparison.
 * @returns {number} Negative when `leftStats` sorts first, zero when statistics alone don't decide.
 */
window.compareByRatingStatistics = function (leftStats, rightStats, order) {
  if (!leftStats.ratedCount && rightStats.ratedCount) return 1;
  if (leftStats.ratedCount && !rightStats.ratedCount) return -1;
  if (!leftStats.ratedCount || !rightStats.ratedCount) return 0;
  let ratingResult = leftStats.mean - rightStats.mean;
  if (order === "desc") ratingResult = -ratingResult;
  if (ratingResult) return ratingResult;
  return rightStats.ratedCount - leftStats.ratedCount;
};

/**
 * Compares two items by all-time rank: ranked items sort first by rank,
 * unranked items sort after. Both branches can optionally tie-break by
 * English title (and the unranked branch by year before title), since a
 * couple of call sites intentionally omit those tie-breaks to match their
 * page's pre-existing sort behavior.
 * @param {*} left Left item.
 * @param {*} right Right item.
 * @param {(item:*) => FilmRecord} [filmOf] Resolves an item to its film (identity by default).
 * @param {Object} [options] Tie-break options.
 * @param {boolean} [options.rankTieBreak] Tie-break equal ranks by title (default true).
 * @param {boolean} [options.yearFallback] Tie-break unranked items by year before title (default true).
 * @returns {number} Negative when `left` sorts first.
 */
window.compareByAllTimeRank = function (
  left,
  right,
  filmOf = (item) => item,
  options = {},
) {
  let rankTieBreak = options.rankTieBreak !== false;
  let yearFallback = options.yearFallback !== false;
  let leftFilm = filmOf(left);
  let rightFilm = filmOf(right);
  let leftRank = Number(leftFilm?.allTimeRank);
  let rightRank = Number(rightFilm?.allTimeRank);
  let leftKnown = Number.isFinite(leftRank) && leftRank > 0;
  let rightKnown = Number.isFinite(rightRank) && rightRank > 0;
  if (leftKnown && rightKnown) {
    let rankResult = leftRank - rightRank;
    return rankTieBreak
      ? rankResult ||
          window.compareEnglishTitles(leftFilm?.title, rightFilm?.title)
      : rankResult;
  }
  if (leftKnown) return -1;
  if (rightKnown) return 1;
  return yearFallback
    ? Number(leftFilm?.year || 0) - Number(rightFilm?.year || 0) ||
        window.compareEnglishTitles(leftFilm?.title, rightFilm?.title)
    : window.compareEnglishTitles(leftFilm?.title, rightFilm?.title);
};

/**
 * Sorts a new array of items by all-time rank, via `compareByAllTimeRank`.
 * @param {*[]} items Items to sort.
 * @param {(item:*) => FilmRecord} [filmOf] Resolves an item to its film (identity by default).
 * @param {Object} [options] Tie-break options, forwarded to `compareByAllTimeRank`.
 * @returns {*[]} A new sorted array.
 */
window.rankByAllTimeRank = function (items, filmOf, options) {
  return [...items].sort((left, right) =>
    window.compareByAllTimeRank(left, right, filmOf, options),
  );
};
