/**
 * @file Defines film year, period, identity, matching, and canonical-id replacement rules.
 */

/** Returns a valid four-digit year. @param {*} value Year value. @returns {string} Year or empty string. */
window.filmConcreteYear = function (value) {
  let year = String(value || "").trim();
  return /^\d{4}$/.test(year) ? year : "";
};

/**
 * Normalizes a film title for comparison with external metadata without
 * changing the stricter normalization used by persisted local identities.
 * @param {*} value Film title.
 * @returns {string} Accent- and punctuation-compatible comparison title.
 */
window.comparableFilmTitle = function (value) {
  return window
    .normalizeTitle(String(value || "").replace(/\s*&\s*/g, " and "))
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201a\u201b\u02bc\u02bb\u2032\u00b4`]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
};

/** Returns a valid decade or century key. @param {*} value Period value. @returns {string} Period key or empty string. */
window.filmPeriodKey = function (value) {
  let key = String(value || "").trim();
  return /^\d{4}s$/.test(key) ? key : "";
};

/** Tests whether a range key contains a year. @param {string} periodKey Range key. @param {*} year Year. @returns {boolean} Whether it contains the year. */
window.periodKeyContainsYear = function (periodKey, year) {
  let key = String(periodKey || "").trim();
  let concreteYear = window.filmConcreteYear(year);
  if (!/^\d{4}s$/.test(key) || !concreteYear) return false;
  return (
    window.getDecadeKey(concreteYear) === key ||
    window.getCenturyKey(concreteYear) === key
  );
};

/** Tests a typed period key against a year. @param {string} periodType Period type. @param {string} periodKey Period key. @param {*} year Year. @returns {boolean} Whether it contains the year. */
window.periodTypeKeyContainsYear = function (periodType, periodKey, year) {
  let type = window.normalizeAwardPeriodType?.(periodType) || periodType;
  let key = String(periodKey || "").trim();
  let concreteYear = window.filmConcreteYear(year);
  if (!key || !concreteYear) return false;
  if (type === "years") return key === concreteYear;
  if (type === "decades") return window.getDecadeKey(concreteYear) === key;
  if (type === "centuries") return window.getCenturyKey(concreteYear) === key;
  return window.periodKeyContainsYear(key, concreteYear);
};

/** Compares title/year identities with range-aware matching. @param {FilmRecord} left First film. @param {FilmRecord} right Second film. @returns {boolean} Whether identities match. */
window.sameFilmIdentity = function (left, right) {
  if (
    window.normalizeTitle(left?.title) !== window.normalizeTitle(right?.title)
  )
    return false;
  let leftYear = window.filmConcreteYear(left?.year);
  let rightYear = window.filmConcreteYear(right?.year);
  let leftPeriod = leftYear ? "" : window.filmPeriodKey(left?.year);
  let rightPeriod = rightYear ? "" : window.filmPeriodKey(right?.year);
  if (leftYear && rightYear) return leftYear === rightYear;
  if (leftYear && rightPeriod)
    return window.periodKeyContainsYear(rightPeriod, leftYear);
  if (rightYear && leftPeriod)
    return window.periodKeyContainsYear(leftPeriod, rightYear);
  if (leftPeriod && rightPeriod) return leftPeriod === rightPeriod;
  return !(leftYear || leftPeriod) || !(rightYear || rightPeriod);
};

/** Builds a normalized film identity key. @param {FilmRecord} film Film. @param {Object} [options] Key controls. @returns {string} Identity key. */
window.filmIdentityKey = function (film, options = {}) {
  let title = window.normalizeTitle(film?.title || "");
  if (!title) return "";
  let year = "";
  if (options.canonical && film?.id) {
    let canonical = window.findFilmById?.(film.id);
    if (canonical?.title) title = window.normalizeTitle(canonical.title);
    year = window.filmConcreteYear(canonical?.year);
  }
  year ||=
    window.filmConcreteYear(film?.year) ||
    (options.includePeriodKey ? String(film?.year || "").trim() : "");
  return `${year}\n${title}`;
};

/** Matches a source film to a canonical id with period context. @param {FilmRecord} film Film. @param {string} id Canonical id. @param {Object} [options] Period context. @returns {boolean} Whether it matches. */
window.filmMatchesId = function (film, id, options = {}) {
  if (!film || !id) return false;
  if (film.id && film.id === id) return true;
  let canonical = window.findFilmById?.(id);
  if (!canonical) return false;
  if (
    window.normalizeTitle(film.title) !== window.normalizeTitle(canonical.title)
  )
    return false;
  let filmYear = window.filmConcreteYear(film.year);
  let canonicalYear = window.filmConcreteYear(canonical.year);
  let filmPeriod = filmYear ? "" : window.filmPeriodKey(film.year);
  if (filmYear && canonicalYear) return filmYear === canonicalYear;
  if (!canonicalYear) return true;
  let periodType =
    window.normalizeAwardPeriodType?.(options.periodType) || options.periodType;
  let periodKey = String(options.periodKey || "").trim();
  if (filmPeriod)
    return periodType && periodKey
      ? window.periodTypeKeyContainsYear(periodType, periodKey, canonicalYear)
      : window.periodKeyContainsYear(filmPeriod, canonicalYear);
  return true;
};

/** Finds a film by normalized title and optional concrete year. @param {FilmRecord} film Identity query. @param {FilmRecord[]} [films] Candidates. @returns {FilmRecord|null} Match. */
window.findFilmByTitleYear = function (
  film,
  films = Object.values(window.state?.filmsById || {}),
) {
  let title = window.normalizeTitle(film?.title || "");
  let year = window.filmConcreteYear(film?.year);
  if (!title) return null;
  return (
    (films || []).find(
      (candidate) =>
        window.normalizeTitle(candidate?.title || "") === title &&
        (!year || String(candidate?.year || "") === year),
    ) || null
  );
};

// A tied placement (e.g. a two-part release nominated together) is
// authored as one cell with semicolon-separated titles, not comma — real
// titles contain a comma far too often ("Crouching Tiger, Hidden Dragon")
// to be a safe delimiter, but essentially never contain a semicolon.
/** Splits semicolon-authored tied film titles. @param {*} value Title cell. @returns {string[]} Titles. */
window.splitTieCandidateTitles = function (value) {
  return String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
};

/** Finds the canonical record eligible for an incoming film merge. @param {FilmRecord} film Incoming film. @param {*} effectiveYear Effective year. @param {Object} [options] Period context. @returns {FilmRecord|null} Existing record. */
window.findExistingFilmStoreRecord = function (
  film,
  effectiveYear,
  options = {},
) {
  let normalizedTitle = window.normalizeTitle(film?.title || "");
  let concreteYear = window.filmConcreteYear(effectiveYear);
  if (!normalizedTitle) return null;
  let candidates = window.filmStoreCandidatesByTitle
    ? window.filmStoreCandidatesByTitle(normalizedTitle)
    : Object.values(window.state?.filmsById || {}).filter(
        (candidate) =>
          candidate.normalizedTitle === normalizedTitle ||
          window.normalizeTitle(candidate.title) === normalizedTitle,
      );
  if (!concreteYear && options.periodType && options.periodKey) {
    return (
      candidates.find((candidate) =>
        window.periodTypeKeyContainsYear(
          options.periodType,
          options.periodKey,
          candidate.year,
        ),
      ) || null
    );
  }
  return (
    candidates.find((candidate) => {
      if (!concreteYear) return true;
      let existingYear = String(candidate.year || "").trim();
      return (
        existingYear === concreteYear ||
        window.periodTypeKeyContainsYear(
          options.periodType,
          existingYear,
          concreteYear,
        )
      );
    }) || null
  );
};

/** Replaces a canonical film id across source and derived indexes. @param {string} oldId Old id. @param {string} newId New id. @param {FilmRecord} film Canonical film. */
window.replaceFilmStoreId = function (oldId, newId, film) {
  if (!oldId || !newId || oldId === newId) return;
  if (window.state.filmsById?.[oldId] === film) {
    delete window.state.filmsById[oldId];
    window.state.filmsById[newId] = film;
  }
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((sourceFilm) => {
      if (sourceFilm.id === oldId) sourceFilm.id = newId;
    });
  });
  ["years", "decades", "centuries"].forEach((group) => {
    Object.values(window.state.periods?.[group] || {}).forEach((period) => {
      (period.films || []).forEach((entry) => {
        if (entry.id === oldId) entry.id = newId;
      });
    });
  });
  (window.state.periods?.allTime?.all?.films || []).forEach((entry) => {
    if (entry.id === oldId) entry.id = newId;
  });
};
