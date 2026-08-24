/**
 * @file Implements resilient TMDB and Wikimedia lookup requests and provider-specific result shaping.
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

/**
 * Builds TMDB request headers for a credential, adding the credential to
 * `params` as `api_key` when it isn't a v4 read-access token (those start
 * with "eyJ" and go in the Authorization header instead).
 * @param {string} credential TMDB v3 API key or v4 read-access token.
 * @param {URLSearchParams} params Request params, mutated in place.
 * @returns {{accept: string, Authorization?: string}} Request headers.
 */
window.tmdbAuthHeaders = function (credential, params) {
  let headers = { accept: "application/json" };
  if (String(credential).startsWith("eyJ"))
    headers.Authorization = `Bearer ${credential}`;
  else params.set("api_key", credential);
  return headers;
};

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
  let seen = new Set();
  return variants.filter((variant) => {
    let key = window.normalizeTitle?.(variant) || String(variant).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function tmdbMovieSearchParams(film, credential, queryTitle) {
  let params = new URLSearchParams({
    query: queryTitle || film.title,
    include_adult: "false",
    language: "en-US",
  });
  if (/^\d{4}$/.test(String(film.year || ""))) params.set("year", film.year);
  let headers = window.tmdbAuthHeaders(credential, params);
  return { params, headers };
}

/** Tests whether an ID-less record may use TMDB movie-title search. @param {FilmRecord|WatchedOtherEntry} film Film-like record. @returns {boolean} Whether movie search is appropriate. */
window.tmdbMovieSearchEligible = function (film) {
  return !/series\b/i.test(String(film?.type || "").trim());
};

/** Finds the best TMDB poster for a film. @param {FilmRecord} film Film. @param {string} credential Credential. @param {Function} fetchFn Fetch implementation. @returns {Promise<PosterRecord|null>} Poster. */
window.lookupTmdbPoster = async function (film, credential, fetchFn) {
  if (!credential) return null;
  if (film.tmdbId) {
    let reference = window.parseTmdbReference(film.tmdbId);
    let details = await window.lookupTmdbMovieDetails(
      film.tmdbId,
      credential,
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
    let { params, headers } = tmdbMovieSearchParams(
      film,
      credential,
      queryTitle,
    );
    let data = await window.requestPosterJson(
      fetchFn,
      `${window.TMDB_API_BASE}/search/movie?${params}`,
      { headers },
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

/** Lists ranked TMDB poster choices for a film. @param {FilmRecord} film Film. @param {string} credential Credential. @param {Function} fetchFn Fetch implementation. @param {Object} [options] Lookup controls. @returns {Promise<PosterRecord[]>} Posters. */
window.lookupTmdbPosterOptions = async function (
  film,
  credential,
  fetchFn,
  options = {},
) {
  if (!credential) return [];
  let apiParams = new URLSearchParams({ include_image_language: "en,null" });
  let headers = window.tmdbAuthHeaders(credential, apiParams);
  let match = film.tmdbId
    ? { id: film.tmdbId, poster_path: film.poster?.source === "tmdb" ? "" : "" }
    : await window.lookupTmdbMovieSearch(film, credential, fetchFn);
  if (!match?.id) return [];
  let reference = window.parseTmdbReference(match.id);
  let data = await window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/${window.tmdbResourcePath(reference)}/images?${apiParams}`,
    { headers },
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

/** Finds a TMDB movie using titles and alternative-title details. @param {FilmRecord} film Film. @param {string} credential Credential. @param {Function} fetchFn Fetch implementation. @returns {Promise<Object|null>} TMDB result. */
window.lookupTmdbMovieSearch = async function (film, credential, fetchFn) {
  if (!credential || !window.tmdbMovieSearchEligible(film)) return null;
  for (let queryTitle of window.tmdbMovieSearchTitleVariants(film.title)) {
    let { params, headers } = tmdbMovieSearchParams(
      film,
      credential,
      queryTitle,
    );
    let data = await window.requestPosterJson(
      fetchFn,
      `${window.TMDB_API_BASE}/search/movie?${params}`,
      { headers },
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
          credential,
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
 * Fetches TMDB details and alternative titles for a movie, or for a TV
 * series/season/episode when the id uses the explicit "TV:" notation
 * (parseTmdbReference).
 * @param {string|number} tmdbId Stored TMDB id.
 * @param {string} credential Credential.
 * @param {Function} fetchFn Fetch implementation.
 * @returns {Promise<Object>} Details.
 */
window.lookupTmdbMovieDetails = async function (tmdbId, credential, fetchFn) {
  let reference = window.parseTmdbReference(tmdbId);
  let params = new URLSearchParams({
    language: "en-US",
    append_to_response: "credits,alternative_titles,translations",
  });
  let headers = window.tmdbAuthHeaders(credential, params);
  return window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/${window.tmdbResourcePath(reference)}?${params}`,
    { headers },
    "TMDB",
    2,
  );
};

/** Finds a TMDB portrait for a person. @param {PersonRecord} person Person. @param {string} credential Credential. @param {Function} fetchFn Fetch implementation. @returns {Promise<PosterRecord|null>} Portrait. */
window.lookupTmdbPersonPortrait = async function (person, credential, fetchFn) {
  if (!credential)
    throw new Error("A TMDB credential is required for portrait lookup.");
  let params = new URLSearchParams({
    query: person.name,
    include_adult: "false",
    language: "en-US",
  });
  let headers = window.tmdbAuthHeaders(credential, params);
  let data = await window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/search/person?${params}`,
    { headers },
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

/** Finds a Wikimedia poster for a film. @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @returns {Promise<PosterRecord|null>} Poster. */
window.lookupWikimediaPoster = async function (film, fetchFn) {
  let search = `intitle:\"${film.title}\" ${film.year || ""} film`.trim();
  let params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: search,
    gsrnamespace: "0",
    gsrlimit: "6",
    prop: "pageimages|info|pageterms",
    piprop: "thumbnail|original",
    pithumbsize: "780",
    inprop: "url",
    wbptterms: "description",
    redirects: "1",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  let data = await window.requestPosterJson(
    fetchFn,
    `https://en.wikipedia.org/w/api.php?${params}`,
    {},
    "Wikimedia",
    3,
  );
  let match = window.selectWikimediaPoster(film, data.query?.pages);
  if (!match) return null;
  return window.normalizePosterRecord({
    url: match.thumbnail?.source || match.original?.source,
    source: "wikimedia",
    sourceUrl:
      match.fullurl || `https://en.wikipedia.org/?curid=${match.pageid}`,
    providerId: match.pageid,
  });
};
