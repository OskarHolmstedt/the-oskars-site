/**
 * @file Implements resilient TMDB lookup requests and provider-specific result shaping.
 */

// TMDB TV references: a stored tmdbId is either a plain movie id (all
// existing data) or the explicit "TV:<seriesId>", "TV:<seriesId>/S<season>",
// or "TV:<seriesId>/S<season>E<episode>" notation for a whole series, one
// season, or one episode tracked as an archive entry. Every TMDB endpoint
// construction in this file routes through parseTmdbReference/
// tmdbResourcePath so a stored id is never used directly as a /movie/{id}
// path segment.

/**
 * Parses a stored tmdbId into a structured TMDB reference. Anything not
 * matching the explicit TV notation is treated as a movie id, preserving
 * existing behavior for every id already in the archive.
 * @param {string|number} value Stored tmdbId.
 * @returns {{mediaType: "movie"|"tv", id: string, season: number|null, episode: number|null}} Parsed reference.
 */
window.parseTmdbReference = function (value) {
  let raw = String(value ?? "").trim();
  let match = raw.match(/^TV:(\d+)(?:\/S(\d+)(?:E(\d+))?)?$/i);
  if (!match) return { mediaType: "movie", id: raw, season: null, episode: null };
  return {
    mediaType: "tv",
    id: match[1],
    season: match[2] !== undefined ? Number(match[2]) : null,
    episode: match[3] !== undefined ? Number(match[3]) : null,
  };
};

/**
 * Builds the TMDB API path segment for a parsed reference (movie, whole
 * series, one season, or one episode).
 * @param {{mediaType: string, id: string, season: number|null, episode: number|null}} reference Parsed reference.
 * @returns {string} Path segment appended after window.TMDB_API_BASE + "/".
 */
window.tmdbResourcePath = function (reference) {
  if (reference.mediaType !== "tv")
    return `movie/${encodeURIComponent(reference.id)}`;
  let path = `tv/${encodeURIComponent(reference.id)}`;
  if (reference.season !== null) path += `/season/${reference.season}`;
  if (reference.episode !== null) path += `/episode/${reference.episode}`;
  return path;
};

// themoviedb.org's public website URLs use the identical path shape to the
// API ("movie/{id}", "tv/{id}", "tv/{id}/season/{s}", "tv/{id}/season/{s}/
// episode/{e}"), so tmdbResourcePath(reference) doubles as the public path
// too — https://www.themoviedb.org/${tmdbResourcePath(reference)}.

/** Requests provider JSON with timeouts and retries. @param {Function} fetchFn Fetch implementation. @param {string} url URL. @param {Object} options Fetch options. @param {string} provider Provider label. @param {number} attempts Attempts. @returns {Promise<Object>} Parsed JSON. */
window.requestPosterJson = async function (
  fetchFn,
  url,
  options,
  provider,
  attempts,
) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let controller =
      typeof AbortController === "function" ? new AbortController() : null;
    let timeout = controller
      ? setTimeout(() => controller.abort(), 9000)
      : null;
    try {
      let response = await fetchFn(
        url,
        Object.assign(
          {},
          options,
          controller ? { signal: controller.signal } : {},
        ),
      );
      if (!response.ok) {
        let error = new Error(
          `${provider} request failed (${response.status})`,
        );
        if (response.status < 500 && response.status !== 429) throw error;
        lastError = error;
      } else {
        return await response.json();
      }
    } catch (err) {
      lastError =
        err.name === "AbortError"
          ? new Error(`${provider} request timed out`)
          : err;
      if (
        /\(4\d\d\)$/.test(lastError.message) &&
        !/\(429\)$/.test(lastError.message)
      )
        throw lastError;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (attempt + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw lastError || new Error(`${provider} request failed`);
};

/** Returns deduplicated title variants for TMDB search. @param {string} title Film title. @returns {string[]} Variants. */
window.tmdbMovieSearchTitleVariants = function (title) {
  let raw = String(title || "").trim();
  if (!raw) return [];
  let variants = [raw];
  if (/\s&\s/.test(raw)) variants.push(raw.replace(/\s&\s/g, " and "));
  if (/\sand\s/i.test(raw)) variants.push(raw.replace(/\sand\s/gi, " & "));
  // A trailing parenthetical translation stored alongside a foreign
  // title ("Neecha Nagar (Lowly City)") isn't part of TMDB's own title at
  // all and makes the whole query match nothing - found live, the bare
  // title alone finds it instantly.
  if (/\s*\([^)]*\)\s*$/.test(raw))
    variants.push(raw.replace(/\s*\([^)]*\)\s*$/, "").trim());
  // A heavily comma-punctuated title can make TMDB's own search return
  // zero results even though the exact same title (minus one comma)
  // finds the film immediately - found live with "Jeanne Dielman, 23,
  // quai du Commerce, 1080 Bruxelles" style titles.
  if (raw.includes(",")) variants.push(raw.replace(/,/g, ""));
  let seen = new Set();
  return variants.filter((variant) => {
    let key = window.normalizeTitle?.(variant) || String(variant).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function tmdbMovieSearchParams(film, queryTitle) {
  let params = new URLSearchParams({
    query: queryTitle || film.title,
    include_adult: "false",
    language: "en-US",
  });
  if (/^\d{4}$/.test(String(film.year || ""))) params.set("year", film.year);
  return params;
}

/** Tests whether an ID-less record may use TMDB movie-title search. @param {FilmRecord|WatchedOtherEntry} film Film-like record. @returns {boolean} Whether movie search is appropriate. */
window.tmdbMovieSearchEligible = function (film) {
  return !/series\b/i.test(String(film?.type || "").trim());
};

/** Finds the best TMDB poster for a film. @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @returns {Promise<PosterRecord|null>} Poster. */
window.lookupTmdbPoster = async function (film, fetchFn) {
  if (film.tmdbId) {
    let reference = window.parseTmdbReference(film.tmdbId);
    let details = await window.lookupTmdbMovieDetails(
      film.tmdbId,
      fetchFn,
    );
    let posterPath = details.poster_path || details.still_path || "";
    if (!posterPath) return null;
    return window.normalizePosterRecord({
      url: `https://image.tmdb.org/t/p/w500${posterPath}`,
      source: "tmdb",
      sourceUrl: `https://www.themoviedb.org/${window.tmdbResourcePath(reference)}`,
      providerId: film.tmdbId,
    });
  }
  if (!window.tmdbMovieSearchEligible(film)) return null;
  for (let queryTitle of window.tmdbMovieSearchTitleVariants(film.title)) {
    let params = tmdbMovieSearchParams(film, queryTitle);
    let data = await window.requestPosterJson(
      fetchFn,
      `${window.TMDB_API_BASE}/search/movie?${params}`,
      { headers: { accept: "application/json" } },
      "TMDB",
      2,
    );
    let match = window.selectTmdbPoster(film, data.results);
    if (match) {
      return window.normalizePosterRecord({
        url: `https://image.tmdb.org/t/p/w500${match.poster_path}`,
        source: "tmdb",
        sourceUrl: `https://www.themoviedb.org/movie/${match.id}`,
        providerId: match.id,
      });
    }
  }
  return null;
};

/** Lists ranked TMDB poster choices for a film. @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @param {Object} [options] Lookup controls. @returns {Promise<PosterRecord[]>} Posters. */
window.lookupTmdbPosterOptions = async function (
  film,
  fetchFn,
  options = {},
) {
  let apiParams = new URLSearchParams({ include_image_language: "en,null" });
  let match = film.tmdbId
    ? { id: film.tmdbId, poster_path: film.poster?.source === "tmdb" ? "" : "" }
    : await window.lookupTmdbMovieSearch(film, fetchFn);
  if (!match?.id) return [];
  let reference = window.parseTmdbReference(match.id);
  let data = await window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/${window.tmdbResourcePath(reference)}/images?${apiParams}`,
    { headers: { accept: "application/json" } },
    "TMDB",
    2,
  );
  // A specific episode has no posters of its own — TMDB's episode images
  // endpoint returns "stills" instead of "posters"/"backdrops".
  let posters = (
    (reference.episode !== null ? data.stills : data.posters) || []
  ).filter((poster) => poster?.file_path);
  if (
    match.poster_path &&
    !posters.some((poster) => poster.file_path === match.poster_path)
  ) {
    posters.unshift({
      file_path: match.poster_path,
      vote_average: 0,
      vote_count: 0,
    });
  }
  posters.sort(
    (left, right) =>
      Number(right.vote_count || 0) - Number(left.vote_count || 0) ||
      Number(right.vote_average || 0) - Number(left.vote_average || 0),
  );
  let seen = new Set();
  return posters
    .map((poster) => {
      let record = window.normalizePosterRecord({
        url: `https://image.tmdb.org/t/p/w500${poster.file_path}`,
        source: "tmdb",
        sourceUrl: `https://www.themoviedb.org/${window.tmdbResourcePath(reference)}/images`,
        providerId: match.id,
      });
      if (!record || seen.has(record.url)) return null;
      seen.add(record.url);
      return Object.assign(record, {
        filePath: String(poster.file_path || ""),
        width: Number(poster.width) || null,
        height: Number(poster.height) || null,
        language: String(poster.iso_639_1 || ""),
        votes: Number(poster.vote_count) || 0,
        score: Number(poster.vote_average) || 0,
      });
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Number(options.limit) || 12));
};

/** Finds a TMDB movie using titles and alternative-title details. @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @returns {Promise<Object|null>} TMDB result. */
window.lookupTmdbMovieSearch = async function (film, fetchFn) {
  if (!window.tmdbMovieSearchEligible(film)) return null;
  for (let queryTitle of window.tmdbMovieSearchTitleVariants(film.title)) {
    let params = tmdbMovieSearchParams(film, queryTitle);
    let data = await window.requestPosterJson(
      fetchFn,
      `${window.TMDB_API_BASE}/search/movie?${params}`,
      { headers: { accept: "application/json" } },
      "TMDB",
      2,
    );
    let directMatch = window.selectTmdbMovie(film, data.results);
    if (directMatch) return directMatch;
    let candidates = (data.results || [])
      .slice(0, 8)
      .filter(
        (result) =>
          !film.year ||
          posterYear(result.release_date) === String(film.year || ""),
      );
    let detailsById = {};
    for (let result of candidates) {
      try {
        detailsById[result.id] = await window.lookupTmdbMovieDetails(
          result.id,
          fetchFn,
        );
      } catch (err) {
        console.warn(
          `TMDB alternative-title lookup failed for ${result.title || result.id}`,
          err,
        );
      }
    }
    let alternativeMatch = window.selectTmdbMovie(
      film,
      candidates,
      detailsById,
    );
    if (alternativeMatch && detailsById[alternativeMatch.id])
      alternativeMatch._details = detailsById[alternativeMatch.id];
    if (alternativeMatch) return alternativeMatch;
  }
  return null;
};

/**
 * Finds a TMDB series when movie search finds nothing - a fallback, not a
 * first attempt, since most watched titles are movies. Returns a match with
 * `id` already in the "TV:<seriesId>" notation parseTmdbReference expects,
 * so every downstream consumer (lookupTmdbMovieDetails, tmdbResourcePath)
 * works unchanged.
 * @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @returns {Promise<Object|null>} TMDB result.
 */
window.lookupTmdbTvSearch = async function (film, fetchFn) {
  for (let queryTitle of window.tmdbMovieSearchTitleVariants(film.title)) {
    let params = new URLSearchParams({
      query: queryTitle || film.title,
      include_adult: "false",
      language: "en-US",
    });
    let data = await window.requestPosterJson(
      fetchFn,
      `${window.TMDB_API_BASE}/search/tv?${params}`,
      { headers: { accept: "application/json" } },
      "TMDB",
      2,
    );
    let match = window.selectTmdbTvShow(film, data.results);
    if (match) return { ...match, id: `TV:${match.id}` };
  }
  return null;
};

/**
 * Fetches TMDB details and alternative titles for a movie, or for a TV
 * series/season/episode when the id uses the explicit "TV:" notation
 * (parseTmdbReference).
 * @param {string|number} tmdbId Stored TMDB id.
 * @param {Function} fetchFn Fetch implementation.
 * @returns {Promise<Object>} Details.
 */
window.lookupTmdbMovieDetails = async function (tmdbId, fetchFn) {
  let reference = window.parseTmdbReference(tmdbId);
  let params = new URLSearchParams({
    language: "en-US",
    // release_dates (movie-only; silently ignored on a TV/season/episode
    // path, same as any other unsupported append_to_response value) lets
    // callers derive every regional release year via
    // window.tmdbReleaseYearOptions (src/domain/tmdb-link-check.js),
    // needed so a confirmed-correct TMDB match never overwrites an
    // already-valid local year with just the single "primary" one -
    // TMDB often lists several equally real release years/runtimes
    // across regions, and the local value matching any one of them is
    // not a mistake to correct.
    append_to_response: "credits,alternative_titles,translations,release_dates",
  });
  return window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/${window.tmdbResourcePath(reference)}?${params}`,
    { headers: { accept: "application/json" } },
    "TMDB",
    2,
  );
};

/**
 * Resolves country and total-runtime metadata for a TV reference (whole
 * series, one season, or one episode), reusing lookupTmdbMovieDetails
 * (which already dispatches a "TV:<id>[/S<season>[E<episode>]]" reference
 * to the right endpoint) rather than a parallel fetch implementation. A TV
 * show's own details carry `production_countries` in the identical shape
 * a movie's do - reused as-is. Runtime has no single value the way a
 * movie's does, so it's derived per granularity instead: an episode
 * reference uses that episode's own `runtime` directly (TMDB gives one
 * real number); a season or whole-series reference sums every real
 * episode's runtime across the seasons in scope (a season reference sums
 * just its own episodes; a whole-series reference sums every season,
 * skipping a "Specials" season 0) - the actual total time spent watching
 * the whole thing, matching how runtime_minutes is used elsewhere (a film
 * detail's own runtime, and an aggregate "total minutes watched" stat in
 * src/domain/stats.js) - not a single representative episode's length,
 * which would badly understate a multi-episode entry's real watch time.
 * @param {{mediaType: "tv", id: string, season: number|null, episode: number|null}} reference
 * @param {Function} fetchFn
 * @returns {Promise<{country: string|null, primaryCountry: string|null, runtimeMinutes: number|null}>}
 */
window.lookupTmdbTvMetadataFields = async function (reference, fetchFn) {
  let show = await window.lookupTmdbMovieDetails(`TV:${reference.id}`, fetchFn);
  let countries = (show?.production_countries || [])
    .map((country) => String(country.name || "").trim())
    .filter(Boolean);
  let country = countries.join(", ") || null;
  let primaryCountry = countries[0] || null;

  async function seasonEpisodeRuntimes(seasonNumber) {
    let season = await window.lookupTmdbMovieDetails(
      `TV:${reference.id}/S${seasonNumber}`,
      fetchFn,
    );
    return (season?.episodes || []).map(
      (episode) => Number(episode.runtime) || 0,
    );
  }

  let runtimeMinutes = null;
  if (reference.episode !== null) {
    let episode = await window.lookupTmdbMovieDetails(
      `TV:${reference.id}/S${reference.season}E${reference.episode}`,
      fetchFn,
    );
    runtimeMinutes =
      Number(episode?.runtime) > 0 ? Number(episode.runtime) : null;
  } else if (reference.season !== null) {
    let total = (await seasonEpisodeRuntimes(reference.season)).reduce(
      (sum, minutes) => sum + minutes,
      0,
    );
    runtimeMinutes = total > 0 ? total : null;
  } else {
    let realSeasons = (show?.seasons || []).filter(
      (season) => Number(season.season_number) >= 1,
    );
    let allRuntimes = await Promise.all(
      realSeasons.map((season) =>
        seasonEpisodeRuntimes(season.season_number),
      ),
    );
    let total = allRuntimes.flat().reduce((sum, minutes) => sum + minutes, 0);
    runtimeMinutes = total > 0 ? total : null;
  }

  return { country, primaryCountry, runtimeMinutes };
};

/** Finds a TMDB portrait for a person. @param {PersonRecord} person Person. @param {Function} fetchFn Fetch implementation. @returns {Promise<PosterRecord|null>} Portrait. */
window.lookupTmdbPersonPortrait = async function (person, fetchFn) {
  let params = new URLSearchParams({
    query: person.name,
    include_adult: "false",
    language: "en-US",
  });
  let data = await window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/search/person?${params}`,
    { headers: { accept: "application/json" } },
    "TMDB",
    2,
  );
  let match = window.selectTmdbPersonPortrait(person, data.results);
  if (!match) return null;
  return window.normalizePosterRecord({
    url: `https://image.tmdb.org/t/p/h632${match.profile_path}`,
    source: "tmdb",
    sourceUrl: `https://www.themoviedb.org/person/${match.id}`,
    providerId: match.id,
  });
};
