/** @file Owns film/person metadata, poster, and portrait lookup application. */

// Every TMDB request uses the Cloudflare Worker, which authenticates upstream
// server-side (issues #347 and #356). Browser configuration cannot bypass or
// replace this boundary.
window.TMDB_API_BASE =
  "https://oskars-tmdb-proxy.oskarholmstedt.workers.dev/3";

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

/**
 * Resolves the fetch implementation shared by every TMDB lookup entry point.
 * @param {Object} [options] Caller options (fetchFn override).
 * @param {Object} [config] Requirement controls.
 * @param {string} [config.fetchError] Error text when no fetch implementation is available.
 * @returns {{fetchFn: Function}} Resolved fetch function.
 */
window.resolveProviderCall = function (options = {}, config = {}) {
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error(
      config.fetchError || "This lookup requires browser network access.",
    );
  return { fetchFn };
};

function storedWatchedFilm(filmId) {
  return (
    window.findFilmById(filmId) || window.findWatchedFilmById?.(filmId) || null
  );
}

function storedWatchedFilmSources(filmId, film) {
  let sources = window.findSourceFilmsById?.(filmId) || [];
  if (!sources.includes(film)) sources.push(film);
  return sources;
}

/** Looks up TMDB metadata for a film. @param {FilmRecord} film Film. @param {Object} [options] Provider controls. @returns {Promise<Object|null>} Metadata. */
window.lookupTmdbMovieMetadata = async function (film, options = {}) {
  if (!film?.title && !film?.tmdbId)
    throw new Error("A film title or TMDB ID is required for metadata lookup.");
  let { fetchFn } = window.resolveProviderCall(options, {
    fetchError: "Metadata lookup requires browser network access.",
  });
  let match = film.tmdbId
    ? {
        id: film.tmdbId,
        poster_path: film.poster?.providerId === String(film.tmdbId) ? "" : "",
      }
    : await window.lookupTmdbMovieSearch(film, fetchFn);
  if (!match?.id) return null;
  let reference = window.parseTmdbReference(match.id);
  // A movie (not TV) tmdbId another eligible account already looked up may
  // already be shared (docs/shared-film-metadata-decision.md) - a free
  // Firestore read that skips the heavier TMDB "details" request below.
  // trySharedFilmMetadata fails open (null) on any error or ineligibility.
  if (!match._details && reference.mediaType === "movie" && !options.skipSharedArchive) {
    let shared = await window.trySharedFilmMetadata?.(match.id);
    if (shared) return shared;
  }
  let details =
    match._details ||
    (await window.lookupTmdbMovieDetails(match.id, fetchFn));
  // An episode's crew/guest_stars are native root fields, not nested under
  // an appended "credits" resource the way movie/series/season credits are.
  let directors = (details.credits?.crew || details.crew || [])
    .filter((person) => person.job === "Director")
    .map((person) => String(person.name || "").trim())
    .filter(Boolean);
  // TV series/season report origin_country as ISO codes directly, already
  // matching this app's stored country format; movies report full
  // production_countries objects instead.
  let productionCountries =
    reference.mediaType === "tv"
      ? (details.origin_country || []).map((code) => String(code || "").trim())
      : (details.production_countries || [])
          .map((country) => String(country.name || "").trim())
          .filter(Boolean);
  let country = productionCountries.join(", ");
  let swedishTitle = window.tmdbTranslatedTitle?.(details, "sv", "SE") || "";
  let posterPath =
    match.poster_path || details.poster_path || details.still_path || "";
  // Episodes report their own runtime like a movie does; a whole series or
  // season has no single runtime, only a typical episode_run_time list.
  let runtimeMinutes =
    Number(details.runtime) > 0
      ? Number(details.runtime)
      : Number(details.episode_run_time?.[0]) > 0
        ? Number(details.episode_run_time[0])
        : "";
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
          sourceUrl: `https://www.themoviedb.org/${window.tmdbResourcePath(reference)}`,
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
  // TV translation entries carry the localized value in .data.name; movie
  // entries use .data.title.
  let match = exact || languageOnly;
  let title = String(match?.data?.title || match?.data?.name || "").trim();
  let originalTitle = String(details?.title || details?.name || "");
  if (!title || window.normalizeTitle(title) === window.normalizeTitle(originalTitle))
    return "";
  return title;
};

/** Applies fetched TMDB metadata to source copies of a film. @param {string} filmId Film id. @param {Object} metadata Metadata. @param {Object} [options] Save controls. @returns {boolean} Whether changed. */
window.setFilmTmdbMetadata = function (filmId, metadata, options = {}) {
  let film = storedWatchedFilm(filmId);
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
  storedWatchedFilmSources(filmId, film).forEach(applyMetadata);
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
  window.pushSharedFilmMetadata?.(film, metadata);
  if (options.save !== false) window.save();
  return true;
};

// Deliberately without loadFilmPoster/loadPersonPortrait's try/catch +
// recordImageImportFailure wrapper: window.state.imageImportStats only
// tracks posterFailures/portraitFailures, so a metadata failure would have
// nowhere correct to record itself — adding the wrapper would either silently
// miscount into posterFailures or require a product decision (a new counter)
// this refactor isn't making.
/** Looks up and applies metadata for one film. @param {string} filmId Film id. @param {Object} [options] Provider controls. @returns {Promise<Object|null>} Applied metadata. */
window.loadFilmMetadata = async function (filmId, options = {}) {
  let film = storedWatchedFilm(filmId);
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

/** Looks up a film poster from TMDB. @param {FilmRecord} film Film. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Poster. */
window.lookupFilmPoster = async function (film, options = {}) {
  if (!film?.title)
    throw new Error("A film title is required for poster lookup.");
  let { fetchFn } = window.resolveProviderCall(options, {
    fetchError: "Poster lookup requires browser network access.",
  });
  return window.lookupTmdbPoster(film, fetchFn);
};

/** Applies a poster to source copies of a film. @param {string} filmId Film id. @param {PosterRecord} poster Poster. @param {Object} [options] Save controls. @returns {boolean} Whether changed. */
window.setFilmPoster = function (filmId, poster, options = {}) {
  let film = storedWatchedFilm(filmId);
  if (!film) return false;
  let normalized = poster ? window.normalizePosterRecord(poster) : null;
  if (poster && !normalized)
    throw new Error("Poster URL must use HTTP or HTTPS.");
  storedWatchedFilmSources(filmId, film).forEach((sourceFilm) => {
    if (normalized) sourceFilm.poster = window.cloneRecord(normalized);
    else delete sourceFilm.poster;
  });
  window.markAggregatesDirty?.("film poster updated");
  if (options.save !== false) window.save();
  return true;
};

/** Looks up and applies a poster for one film. @param {string} filmId Film id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Applied poster. */
window.loadFilmPoster = async function (filmId, options = {}) {
  let film = storedWatchedFilm(filmId);
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

/** Lists poster options for one watched film. @param {string} filmId Film id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord[]>} Posters. */
window.loadFilmPosterOptions = async function (filmId, options = {}) {
  let film = storedWatchedFilm(filmId);
  if (!film) throw new Error("Film not found.");
  let { fetchFn } = window.resolveProviderCall(options, {
    fetchError: "Poster browsing requires browser network access.",
  });
  return window.lookupTmdbPosterOptions(film, fetchFn, options);
};

// Watchlist counterpart of loadFilmPosterOptions (issue #25): the same TMDB
// poster browsing against the item's film-like record; selection persists
// through setWatchlistPoster.
/** Lists poster options for one watchlist film. @param {string} itemId Item id. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord[]>} Posters. */
window.loadWatchlistPosterOptions = async function (itemId, options = {}) {
  let item = window.findWatchlistItemById?.(itemId);
  if (!item) throw new Error("Watchlist film not found.");
  let { fetchFn } = window.resolveProviderCall(options, {
    fetchError: "Poster browsing requires browser network access.",
  });
  return window.lookupTmdbPosterOptions(
    window.watchlistFilmLike(item),
    fetchFn,
    options,
  );
};

/** Looks up a person portrait. @param {PersonRecord} person Person. @param {Object} [options] Provider controls. @returns {Promise<PosterRecord|null>} Portrait. */
window.lookupPersonPortrait = async function (person, options = {}) {
  if (!person?.name)
    throw new Error("A person name is required for portrait lookup.");
  let { fetchFn } = window.resolveProviderCall(options, {
    fetchError: "Portrait lookup requires browser network access.",
  });
  return window.lookupTmdbPersonPortrait(person, fetchFn);
};

/** Applies a portrait to a person id. @param {string} personId Person id. @param {PosterRecord} portrait Portrait. @param {Object} [options] Save controls. @returns {boolean} Whether changed. */
window.setPersonPortrait = function (personId, portrait, options = {}) {
  let normalizedId = window.normalizePersonName(personId);
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
  let normalizedId = window.normalizePersonName(personId);
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
