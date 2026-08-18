/**
 * @file Defines bracket capacities, film metadata normalization, award period identity, and eligibility validation.
 */

window.PERIOD_LIMITS = {
  years: { picture: 10, category: 5 },
  decades: { picture: 20, category: 10 },
  centuries: { picture: 40, category: 20 },
  allTime: { picture: 50, category: 25 },
};

/** Returns picture and category capacities for a period type. @param {string} periodType Period type. @returns {{picture: number, category: number}} Capacities. */
window.bracketCapacities = function (periodType) {
  let type = window.normalizeAwardPeriodType?.(periodType) || periodType;
  let limits = window.PERIOD_LIMITS[type] || window.PERIOD_LIMITS.years;
  return {
    picture:
      Number(limits.picture) || Number(window.PERIOD_LIMITS.years.picture),
    category:
      Number(limits.category) || Number(window.PERIOD_LIMITS.years.category),
  };
};

/** Returns the Best Picture capacity for a period type. @param {string} periodType Period type. @returns {number} Capacity. */
window.bracketPictureCapacity = function (periodType) {
  return window.bracketCapacities(periodType).picture;
};

function normalizeMetadataValue(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function normalizeFilmMedium(value) {
  let medium = normalizeMetadataValue(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (/\b(?:anim|animated|animation|animerad|tecknad)\b/.test(medium))
    return "animation";
  if (/\b(?:hybrid|mixed|mixad)\b/.test(medium)) return "hybrid";
  if (/\b(?:live action|liveaction|spelfilm)\b/.test(medium))
    return "live-action";
  return "unknown";
}

/** Normalizes an adaptation source label. @param {*} value Source value. @returns {string} Canonical label or empty string. */
window.normalizeAdaptationSource = function (value) {
  let source = String(value || "")
    .normalize("NFKC")
    .trim();
  if (!source || /^(?:-|–|—|original|none|n\/?a)$/i.test(source)) return "";
  let key = source
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let canonical = {
    book: "Novel",
    novels: "Novel",
    novel: "Novel",
    play: "Play",
    "stage play": "Play",
    theatre: "Play",
    theater: "Play",
    "short story": "Short story",
    "short stories": "Short story",
    comic: "Comic",
    comics: "Comic",
    "comic book": "Comic",
    "graphic novel": "Graphic novel",
    "video game": "Video game",
    videogame: "Video game",
    musical: "Musical",
    television: "Television",
    tv: "Television",
    memoir: "Memoir",
    biography: "Biography",
    nonfiction: "Nonfiction",
  }[key];
  return canonical || source.charAt(0).toUpperCase() + source.slice(1);
};

/** Builds a case-insensitive adaptation-source key. @param {*} value Source value. @returns {string} Source key. */
window.adaptationSourceKey = function (value) {
  return window.normalizeAdaptationSource(value).toLocaleLowerCase();
};

/** Returns sorted adaptation sources present on films. @param {FilmRecord[]} [films] Films. @returns {string[]} Sources. */
window.getAdaptationSources = function (
  films = Object.values(state.filmsById || {}),
) {
  return [
    ...new Set(
      films
        .map((film) => window.normalizeAdaptationSource(film.adaptationSource))
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
};

function parsePeople(value) {
  let values = Array.isArray(value) ? value : window.splitRecipientNames(value);
  return values
    .map((name) => window.normalizePersonName?.(name) || normalizeTitle(name))
    .filter(Boolean);
}

function parseCountries(value) {
  let values = Array.isArray(value)
    ? value
    : window.countryListValues?.(value) ||
      String(value || "").split(/\s*(?:,|\/|;|&|\band\b|\+)\s*/i);
  return values
    .map((country) =>
      normalizeMetadataValue(window.normalizeCountryName?.(country) || country),
    )
    .filter(Boolean);
}

function isUsOrUkCountry(value) {
  let code = window.countryCodeFor?.(value);
  if (code === "US" || code === "GB") return true;
  let country = normalizeMetadataValue(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
  return [
    "us",
    "usa",
    "u s",
    "u s a",
    "united states",
    "united states of america",
    "america",
    "uk",
    "u k",
    "united kingdom",
    "great britain",
    "britain",
    "england",
    "scotland",
    "wales",
    "northern ireland",
  ].includes(country);
}
/** Tests whether a country denotes the United States or United Kingdom. @param {*} value Country. @returns {boolean} Whether it is US/UK. */
window.isUsOrUkCountry = isUsOrUkCountry;

// Watched dates arrive from the ranked-list sheet as compact YYMMDD strings
// (e.g. 251118) alongside occasional ISO dates. Parsing returns the canonical
// ISO YYYY-MM-DD form, or '' when the value is not a real date. Stored film
// records are normalized to ISO on import rather than keeping the raw sheet
// string — the sheet stays the source of truth and a re-import reproduces it.
/** Parses compact or ISO watch dates to canonical ISO. @param {*} value Date value. @returns {string} ISO date or empty string. */
window.parseWatchedDate = function (value) {
  let text = String(value || "").trim();
  if (!text) return "";
  let year, month, day;
  let iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (/^\d{6}$/.test(text)) {
    // Two-digit years pivot at 70: personal watch dates fall in 1970-2069.
    let shortYear = Number(text.slice(0, 2));
    year = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
    month = Number(text.slice(2, 4));
    day = Number(text.slice(4, 6));
  } else {
    return "";
  }
  let date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

// ISO when the value is understood, '' for dash/placeholder cells, and the
// raw string otherwise so unrecognized-but-meaningful values survive.
/** Normalizes understood watch dates while preserving meaningful unknown text. @param {*} value Date value. @returns {string} Normalized value. */
window.normalizeWatchedDate = function (value) {
  let text = String(value || "").trim();
  if (!text || /^(?:-+|–|—|\?+|n\/?a|none|\d{1,2})$/i.test(text)) return "";
  return window.parseWatchedDate(text) || text;
};

/** Normalizes shared metadata fields on a film in place. @param {FilmRecord|null} film Film. @returns {FilmRecord|null} Normalized film. */
window.normalizeFilmMetadata = function (film) {
  if (!film) return film;
  let countries =
    window.countryListValues?.(film.country) || parseCountries(film.country);
  film.country = countries.join(", ");
  film.primaryCountry =
    window.primaryCountryValue?.(film) || countries[0] || "";
  window.normalizeFilmRatingFields?.(film);

  film.medium = normalizeFilmMedium(film.medium || film.liveAction);

  let screenplay = normalizeMetadataValue(
    film.screenplayType || film.adaptation,
  );
  film.screenplayType = screenplay.includes("adapt")
    ? "adapted"
    : screenplay.includes("original")
      ? "original"
      : "unknown";
  film.adaptationSource = window.normalizeAdaptationSource(
    film.adaptationSource,
  );
  if (film.screenplayType === "original") film.adaptationSource = "";
  else if (film.adaptationSource && film.screenplayType === "unknown")
    film.screenplayType = "adapted";

  let directors = film.directors?.length
    ? film.directors
    : String(film.director || "").split(/\s*(?:,|&|\band\b)\s*/i);
  film.directors = directors.map((name) => String(name).trim()).filter(Boolean);
  let tags = window.parseFilmTags ? window.parseFilmTags(film.tags) : [];
  if (tags.length) film.tags = tags;
  else delete film.tags;
  let review = String(film.review || "").trim();
  if (review) film.review = review;
  else delete film.review;
  let dateWatched = window.normalizeWatchedDate(film.dateWatched);
  if (dateWatched) film.dateWatched = dateWatched;
  else delete film.dateWatched;
  if (film.poster && window.normalizePosterRecord) {
    film.poster = window.normalizePosterRecord(film.poster);
    if (!film.poster) delete film.poster;
  }
  if (window.normalizeFranchiseMemberships)
    film.franchises = window.normalizeFranchiseMemberships(film.franchises);
  (film.awards || []).forEach(window.normalizeAwardRecipients);
  return film;
};

/** Maps URL-facing period types to internal names. @param {*} value Period type. @returns {string} Internal type. */
window.normalizeAwardPeriodType = function (value) {
  let type = String(value || "").trim();
  return type === "year"
    ? "years"
    : type === "decade"
      ? "decades"
      : type === "century"
        ? "centuries"
        : type === "alltime"
          ? "allTime"
          : type;
};

/** Resolves an award's internal period type. @param {AwardRecord} award Award. @param {string} [fallback] Fallback type. @returns {string} Period type. */
window.getAwardPeriodType = function (award, fallback) {
  let explicitType = window.normalizeAwardPeriodType(
    award?.periodType || fallback,
  );
  if (explicitType) return explicitType;
  let key = String(award?.year || "");
  if (key === "alltime") return "allTime";
  if (/^\d{4}$/.test(key)) return "years";
  return state.years?.[key]?.periodType || "";
};

/** Validates placement and category-specific award eligibility. @param {FilmRecord} film Film. @param {AwardRecord} award Award. @param {Object} [context] Validation context. @returns {{valid: boolean, errors: string[], warnings: string[]}} Validation result. */
window.validateAward = function (film, award, context = {}) {
  let errors = [];
  let warnings = [];
  let periodType = window.getAwardPeriodType(award, context.periodType);
  let limits = window.PERIOD_LIMITS[periodType];
  let placement = Number(award?.placement);

  if (limits) {
    let limit =
      award.category === "Best Picture" ? limits.picture : limits.category;
    if (!Number.isInteger(placement) || placement < 1 || placement > limit) {
      errors.push(
        `${award.category} placement must be between 1 and ${limit}.`,
      );
    }
  }

  if (context.placementOwners) {
    let key = `${periodType}\n${award.category}\n${award.year || ""}\n${placement}`;
    let owners = context.placementOwners.get(key);
    if (owners && !context.allowTie && !owners.has(film.title)) {
      errors.push(
        `${award.category} placement ${placement} is already assigned to ${[...owners].join(", ")}.`,
      );
    }
  }

  // Bulk validators may establish this invariant once for a shared film.
  // Interactive callers retain the defensive per-call normalization default.
  if (!context.filmMetadataNormalized) window.normalizeFilmMetadata(film);

  if (award.category === "Best Animated Picture") {
    if (film.medium === "unknown")
      warnings.push("Animation eligibility is unknown.");
    else if (film.medium !== "animation")
      errors.push(
        `Best Animated Picture requires animation, not ${film.medium}.`,
      );
  }

  if (award.category === "Best International Picture") {
    let primaryCountry = window.primaryCountryValue?.(film) || "";
    if (!primaryCountry)
      warnings.push("International eligibility primary country is unknown.");
    else if (isUsOrUkCountry(primaryCountry))
      warnings.push(
        "Best International Picture recipient has a US/UK primary country.",
      );
  }

  if (award.category === "Best Director") {
    let credited = window
      .awardRecipients(award)
      .map((record) => record.personId);
    let directors = parsePeople(film.directors);
    if (!directors.length) warnings.push("Director metadata is missing.");
    else if (!credited.length)
      warnings.push("Best Director recipient is missing.");
    else if (!credited.some((name) => directors.includes(name))) {
      errors.push(
        `Best Director recipient does not match ${film.directors.join(", ")}.`,
      );
    }
  }

  if (award.category === "Best Original Screenplay") {
    if (film.screenplayType === "unknown")
      warnings.push("Screenplay origin is unknown.");
    else if (film.screenplayType !== "original")
      errors.push("Best Original Screenplay requires an original screenplay.");
  }

  if (award.category === "Best Adapted Screenplay") {
    if (film.screenplayType === "unknown")
      warnings.push("Screenplay origin is unknown.");
    else if (film.screenplayType !== "adapted")
      errors.push("Best Adapted Screenplay requires an adapted screenplay.");
  }

  return { valid: errors.length === 0, errors, warnings };
};

/** Adds a valid, non-duplicate award and updates placement ownership. @param {FilmRecord} film Film. @param {AwardRecord} award Award. @param {Object} [context] Validation context. @returns {Object} Validation result with added status. */
window.tryAddAward = function (film, award, context = {}) {
  window.normalizeAwardRecipients(award);
  let result = window.validateAward(film, award, context);
  if (
    result.valid &&
    !(film.awards || []).some((existing) => window.sameAward(existing, award))
  ) {
    film.awards ||= [];
    film.awards.push(award);
    if (context.placementOwners) {
      let periodType = window.getAwardPeriodType(award, context.periodType);
      let key = `${periodType}\n${award.category}\n${award.year || ""}\n${Number(award.placement)}`;
      let owners = context.placementOwners.get(key) || new Set();
      owners.add(film.title);
      context.placementOwners.set(key, owners);
    }
    result.added = true;
  } else {
    result.added = false;
  }
  return result;
};

/**
 * Lists which of the given films are eligible for a category, without
 * requiring a real award record yet - for a "pick nominees" picker. Mirrors
 * watched-intake.js's per-film eligibility loop with the axes swapped (loop
 * films for one fixed category, instead of categories for one fixed film).
 * @param {FilmRecord[]} films Candidate films.
 * @param {string} category Category name.
 * @param {string} [periodType] Period type ("years" by default).
 * @returns {{film: FilmRecord, warnings: string[]}[]} Eligible films with any non-blocking warnings.
 */
window.eligibleFilmsForCategory = function (films, category, periodType = "years") {
  return (films || []).reduce((eligible, film) => {
    let normalized = window.cloneRecord(film);
    window.normalizeFilmMetadata?.(normalized);
    let directorRecipient = (normalized.directors || []).join(", ");
    let award = window.setAwardRecipients(
      { category, placement: 1, year: normalized.year || "", periodType },
      category === "Best Director" ? directorRecipient : "",
    );
    let validation = window.validateAward(normalized, award, {
      periodType,
      filmMetadataNormalized: true,
    });
    if (validation.valid) eligible.push({ film, warnings: validation.warnings });
    return eligible;
  }, []);
};

/**
 * Lists a period's current nominees for one category, ordered by placement.
 * The same query is independently reimplemented per-caller elsewhere
 * (watched-intake.js, period.js, period/award-view.js) - this is a shared
 * version for new callers, existing call sites are left as-is.
 * @param {string} periodKey Period key, e.g. "2024".
 * @param {string} periodType Period type ("years", "decades", "centuries", "allTime").
 * @param {string} category Category name.
 * @returns {{film: FilmRecord, award: AwardRecord}[]}
 */
window.nomineesForCategory = function (periodKey, periodType, category) {
  return (window.state.years?.[periodKey]?.films || [])
    .flatMap((film) =>
      (film.awards || [])
        .filter(
          (award) =>
            award.category === category &&
            String(award.year || "") === String(periodKey) &&
            window.getAwardPeriodType(award) === periodType,
        )
        .map((award) => ({ film, award })),
    )
    .sort((left, right) => Number(left.award.placement) - Number(right.award.placement));
};

/** Returns every personal award entry for a category across canonical watched films. @param {string} category Category name. @returns {{film: FilmRecord, award: AwardRecord}[]} Award entries. */
window.awardCategoryEntries = function (category) {
  return Object.values(window.state.filmsById || {}).flatMap((film) =>
    (film.awards || [])
      .filter((award) => award.category === category)
      .map((award) => ({ film, award })),
  );
};

/** Returns the unique personal watched films represented by an award category. @param {string} category Category name. @returns {FilmRecord[]} Films. */
window.filmsForAwardCategory = function (category) {
  let seen = new Set();
  return window
    .awardCategoryEntries(category)
    .map((entry) => entry.film)
    .filter((film) => film?.id && !seen.has(film.id) && seen.add(film.id));
};
