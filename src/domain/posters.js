/**
 * @file Owns image-provider settings and film/person metadata, poster, and portrait lookup application.
 */

window.POSTER_SETTINGS_KEY = "oskarsPosterSettings";

/** Returns saved image-provider settings with local configuration overrides. @returns {Object} Provider settings. */
window.getPosterSettings = function () {
  let defaults = {
    tmdbCredential: String(window.OSKARS_LOCAL_CONFIG?.tmdbCredential || ""),
    wikimediaFallback: true,
  };
  try {
    let saved = JSON.parse(
      localStorage.getItem(window.POSTER_SETTINGS_KEY) || "{}",
    );
    return {
      tmdbCredential: String(saved.tmdbCredential || defaults.tmdbCredential),
      wikimediaFallback: saved.wikimediaFallback !== false,
    };
  } catch (err) {
    return defaults;
  }
};

/** Saves mutable image-provider preferences. @param {Object} settings Provider settings. @returns {Object} Saved settings. */
window.savePosterSettings = function (settings) {
  let value = {
    tmdbCredential: String(settings?.tmdbCredential || "").trim(),
    wikimediaFallback: settings?.wikimediaFallback !== false,
  };
  localStorage.setItem(window.POSTER_SETTINGS_KEY, JSON.stringify(value));
  return value;
};

/** Validates and normalizes an image reference. @param {PosterRecord|Object|null} poster Image input. @returns {PosterRecord|null} Image record. */
window.normalizePosterRecord = function (poster) {
  if (!poster || !/^https?:\/\//i.test(String(poster.url || ""))) return null;
  return {
    url: String(poster.url).trim(),
    source: ["tmdb", "wikimedia", "manual"].includes(poster.source)
      ? poster.source
      : "manual",
    sourceUrl: /^https?:\/\//i.test(String(poster.sourceUrl || ""))
      ? String(poster.sourceUrl).trim()
      : "",
    providerId: String(poster.providerId || "").trim(),
    fetchedAt: String(poster.fetchedAt || new Date().toISOString()),
  };
};

/** Looks up TMDB metadata for a film. @param {FilmRecord} film Film. @param {Object} [options] Provider controls. @returns {Promise<Object|null>} Metadata. */
window.lookupTmdbMovieMetadata = async function (film, options = {}) {
  if (!film?.title && !film?.tmdbId)
    throw new Error("A film title or TMDB ID is required for metadata lookup.");
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  let credential = settings.tmdbCredential;
  if (!credential)
    throw new Error("A TMDB credential is required for metadata lookup.");
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("Metadata lookup requires browser network access.");
  let match = film.tmdbId
    ? {
        id: film.tmdbId,
        poster_path: film.poster?.providerId === String(film.tmdbId) ? "" : "",
      }
    : await window.lookupTmdbMovieSearch(film, credential, fetchFn);
  if (!match?.id) return null;
  let details =
    match._details ||
    (await window.lookupTmdbMovieDetails(match.id, credential, fetchFn));
  let directors = (details.credits?.crew || [])
    .filter((person) => person.job === "Director")
    .map((person) => String(person.name || "").trim())
    .filter(Boolean);
  let productionCountries = (details.production_countries || [])
    .map((country) => String(country.name || "").trim())
    .filter(Boolean);
  let country = productionCountries.join(", ");
  let swedishTitle = window.tmdbTranslatedTitle?.(details, "sv", "SE") || "";
  let posterPath = match.poster_path || details.poster_path || "";
  let runtimeMinutes = Number(details.runtime) > 0 ? Number(details.runtime) : "";
  return {
    tmdbId: String(match.id),
    director: directors.join(", "),
    country,
    primaryCountry: productionCountries[0] || "",
    swedishTitle,
    runtimeMinutes,
    poster: posterPath
      ? window.normalizePosterRecord({
          url: `https://image.tmdb.org/t/p/w500${posterPath}`,
          source: "tmdb",
          sourceUrl: `https://www.themoviedb.org/movie/${match.id}`,
          providerId: match.id,
        })
      : null,
  };
};

/** Selects a translated TMDB title. @param {Object} details TMDB details. @param {string} [language] Language. @param {string} [country] Country. @returns {string} Title. */
window.tmdbTranslatedTitle = function (
  details,
  language = "sv",
  country = "SE",
) {
  let translations = details?.translations?.translations || [];
  let exact = translations.find(
    (item) =>
      String(item.iso_639_1 || "").toLowerCase() === language &&
      String(item.iso_3166_1 || "").toUpperCase() === country,
  );
  let languageOnly = translations.find(
    (item) => String(item.iso_639_1 || "").toLowerCase() === language,
  );
  let title = String((exact || languageOnly)?.data?.title || "").trim();
  if (
    !title ||
    window.normalizeTitle(title) === window.normalizeTitle(details?.title || "")
  )
    return "";
  return title;
};

/** Applies fetched TMDB metadata to source copies of a film. @param {string} filmId Film id. @param {Object} metadata Metadata. @param {Object} [options] Save controls. @returns {boolean} Whether changed. */
window.setFilmTmdbMetadata = function (filmId, metadata, options = {}) {
  let film = window.findFilmById(filmId);
  if (!film || !metadata) return false;
  let beforeLog = options.log && {
    tmdbId: film.tmdbId,
    director: film.director,
    country: film.country,
    primaryCountry: film.primaryCountry,
    swedishTitle: film.swedishTitle,
    runtimeMinutes: film.runtimeMinutes,
    posterUrl: film.poster?.url || "",
  };
  function applyMetadata(target) {
    if (metadata.tmdbId) target.tmdbId = String(metadata.tmdbId);
    if (metadata.director && (!target.director || options.overwrite))
      target.director = String(metadata.director).trim();
    if (metadata.director && (!target.directors?.length || options.overwrite)) {
      target.directors = String(metadata.director)
        .split(/\s*(?:,|;|\/|\s+&\s+|\s+and\s+)\s*/i)
        .map((value) => value.trim())
        .filter(Boolean);
    }
    if (metadata.country && (!target.country || options.overwrite))
      target.country = String(metadata.country).trim();
    if (
      metadata.primaryCountry &&
      (!target.primaryCountry || options.overwrite)
    )
      target.primaryCountry = String(metadata.primaryCountry).trim();
    if (metadata.swedishTitle && (!target.swedishTitle || options.overwrite))
      target.swedishTitle = String(metadata.swedishTitle).trim();
    if (metadata.runtimeMinutes && (!target.runtimeMinutes || options.overwrite))
      target.runtimeMinutes = metadata.runtimeMinutes;
    if (metadata.poster && (!target.poster || options.overwritePoster))
      target.poster = metadata.poster;
    window.normalizeFilmMetadata?.(target);
  }
  Object.values(state.years || {}).forEach((period) => {
    (period.films || []).forEach((sourceFilm) => {
      if (window.sameFilmIdentity(sourceFilm, film)) applyMetadata(sourceFilm);
    });
  });
  applyMetadata(film);
  window.markAggregatesDirty?.("film metadata enriched");
  if (beforeLog && window.recordEdit) {
    let afterLog = {
      tmdbId: film.tmdbId,
      director: film.director,
      country: film.country,
      primaryCountry: film.primaryCountry,
      swedishTitle: film.swedishTitle,
      runtimeMinutes: film.runtimeMinutes,
      posterUrl: film.poster?.url || "",
    };
    let changes = window.editLogChanges(beforeLog, afterLog, [
      { key: "tmdbId", label: "TMDB ID" },
      "director",
      "country",
      "primaryCountry",
      { key: "swedishTitle", label: "Swedish title" },
      { key: "runtimeMinutes", label: "runtime" },
      { key: "posterUrl", label: "poster URL" },
    ]);
    if (changes.length) {
      window.recordEdit({
        type: "film enrichment",
        summary: `${film.title || "Film"} (${film.year || ""})`,
        sheetHint: "Film metadata columns",
        changes,
        context: { filmId: film.id },
      });
    }
  }
  if (options.save !== false) window.save();
  return true;
};

/** Looks up and applies metadata for one film. @param {string} filmId Film id. @param {Object} [options] Provider controls. @returns {Promise<Object|null>} Applied metadata. */
window.loadFilmMetadata = async function (filmId, options = {}) {
  let film = window.findFilmById(filmId);
  if (!film) throw new Error("Film not found.");
  let metadata = await window.lookupTmdbMovieMetadata(film, options);
  if (!metadata) return null;
  window.setFilmTmdbMetadata(filmId, metadata, {
    save: false,
    log: options.log !== false,
    overwrite: options.overwrite,
    overwritePoster: options.overwritePoster,
  });
  window.save();
  return metadata;
};

/** Looks up a film poster using configured provider precedence. @param {FilmRecord} film Film. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Poster. */
window.lookupFilmPoster = async function (film, options = {}) {
  if (!film?.title)
    throw new Error("A film title is required for poster lookup.");
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("Poster lookup requires browser network access.");
  let tmdbError = null;
  try {
    let poster = await window.lookupTmdbPoster(
      film,
      settings.tmdbCredential,
      fetchFn,
    );
    if (poster) return poster;
  } catch (err) {
    tmdbError = err;
  }
  if (settings.wikimediaFallback) {
    let poster = await window.lookupWikimediaPoster(film, fetchFn);
    if (poster) return poster;
  }
  if (tmdbError) throw tmdbError;
  return null;
};

/** Applies a poster to source copies of a film. @param {string} filmId Film id. @param {PosterRecord} poster Poster. @param {Object} [options] Save controls. @returns {boolean} Whether changed. */
window.setFilmPoster = function (filmId, poster, options = {}) {
  let film = window.findFilmById(filmId);
  if (!film) return false;
  let normalized = poster ? window.normalizePosterRecord(poster) : null;
  if (poster && !normalized)
    throw new Error("Poster URL must use HTTP or HTTPS.");
  Object.values(state.years || {}).forEach((period) => {
    (period.films || []).forEach((sourceFilm) => {
      if (window.sameFilmIdentity(sourceFilm, film)) {
        if (normalized) sourceFilm.poster = window.cloneRecord(normalized);
        else delete sourceFilm.poster;
      }
    });
  });
  if (normalized) film.poster = normalized;
  else delete film.poster;
  window.markAggregatesDirty?.("film poster updated");
  if (options.save !== false) window.save();
  return true;
};

/** Looks up and applies a poster for one film. @param {string} filmId Film id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Applied poster. */
window.loadFilmPoster = async function (filmId, options = {}) {
  let film = window.findFilmById(filmId);
  if (!film) throw new Error("Film not found.");
  try {
    let poster = await window.lookupFilmPoster(film, options);
    if (!poster) {
      window.recordImageImportFailure("poster");
      window.save();
      return null;
    }
    window.setFilmPoster(filmId, poster);
    return poster;
  } catch (err) {
    window.recordImageImportFailure("poster");
    window.save();
    throw err;
  }
};

/** Lists poster options for one archive film. @param {string} filmId Film id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord[]>} Posters. */
window.loadFilmPosterOptions = async function (filmId, options = {}) {
  let film = window.findFilmById(filmId);
  if (!film) throw new Error("Film not found.");
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  if (!settings.tmdbCredential)
    throw new Error("A TMDB credential is required for poster browsing.");
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("Poster browsing requires browser network access.");
  return window.lookupTmdbPosterOptions(
    film,
    settings.tmdbCredential,
    fetchFn,
    options,
  );
};

// Watchlist counterpart of loadFilmPosterOptions (issue #25): the same TMDB
// poster browsing against the item's film-like record; selection persists
// through setWatchlistPoster.
/** Lists poster options for one watchlist film. @param {string} itemId Item id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord[]>} Posters. */
window.loadWatchlistPosterOptions = async function (itemId, options = {}) {
  let item = window.findWatchlistItemById?.(itemId);
  if (!item) throw new Error("Watchlist film not found.");
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  if (!settings.tmdbCredential)
    throw new Error("A TMDB credential is required for poster browsing.");
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("Poster browsing requires browser network access.");
  return window.lookupTmdbPosterOptions(
    window.watchlistFilmLike(item),
    settings.tmdbCredential,
    fetchFn,
    options,
  );
};

/** Looks up a person portrait. @param {PersonRecord} person Person. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Portrait. */
window.lookupPersonPortrait = async function (person, options = {}) {
  if (!person?.name)
    throw new Error("A person name is required for portrait lookup.");
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("Portrait lookup requires browser network access.");
  return window.lookupTmdbPersonPortrait(
    person,
    settings.tmdbCredential,
    fetchFn,
  );
};

/** Applies a portrait to a person id. @param {string} personId Person id. @param {PosterRecord} portrait Portrait. @param {Object} [options] Save controls. @returns {boolean} Whether changed. */
window.setPersonPortrait = function (personId, portrait, options = {}) {
  let normalizedId =
    window.normalizePersonName?.(personId) ||
    window.recipientPersonId(personId);
  let canonicalName = state.peopleAliases?.[normalizedId];
  let canonicalId = canonicalName
    ? window.normalizePersonName(canonicalName)
    : normalizedId;
  let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[
    canonicalId
  ];
  if (!person) return false;
  let normalized = portrait ? window.normalizePosterRecord(portrait) : null;
  if (portrait && !normalized)
    throw new Error("Portrait URL must use HTTP or HTTPS.");
  state.personPortraits ||= {};
  if (normalized) state.personPortraits[canonicalId] = normalized;
  else delete state.personPortraits[canonicalId];
  person.portrait = normalized;
  if (options.save !== false) window.save();
  return true;
};

/** Looks up and applies a portrait for one person. @param {string} personId Person id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Applied portrait. */
window.loadPersonPortrait = async function (personId, options = {}) {
  let normalizedId =
    window.normalizePersonName?.(personId) ||
    window.recipientPersonId(personId);
  let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[
    normalizedId
  ];
  if (!person) throw new Error("Person not found.");
  try {
    let portrait = await window.lookupPersonPortrait(person, options);
    if (!portrait) {
      window.recordImageImportFailure("portrait");
      window.save();
      return null;
    }
    window.setPersonPortrait(person.id, portrait);
    return portrait;
  } catch (err) {
    window.recordImageImportFailure("portrait");
    window.save();
    throw err;
  }
};
