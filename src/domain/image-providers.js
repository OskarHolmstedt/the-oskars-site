/**
 * @file Implements resilient TMDB lookup requests and provider-specific result shaping.
 */

// Writing-crew job titles that signal a screenplay is adapted from a
// pre-existing source (novel, comic, play, etc.) rather than being an
// original creation. Matched case-insensitively against the `job` field
// on each crew member in department "Writing".
const ADAPTED_SCREENPLAY_JOBS = new Set([
  "novel",
  "book",
  "comic book",
  "graphic novel",
  "characters",
  "theatre play",
  "play",
  "based on the play",
  "short story",
  "based on characters by",
  "based on",
  "based on the novel",
  "based on the book",
  "based on the comic book",
  "based on the graphic novel",
]);

/** Returns explicit underlying-source credits, excluding ordinary screenplay development jobs. @param {Object[]} crew TMDB crew. @returns {string[]} Distinct source-material jobs. */
window.tmdbSourceMaterialJobs = function (crew) {
  return [
    ...new Set(
      (crew || [])
        .filter((person) =>
          ADAPTED_SCREENPLAY_JOBS.has(
            String(person?.job || "")
              .trim()
              .toLowerCase(),
          ),
        )
        .map((person) => person.job.trim()),
    ),
  ];
};

// TMDB keywords that name earlier material as a film's basis. Remakes and
// franchise entries count as adapted, the catalog's convention; a true story
// or a real person alone is not source material.
const ADAPTED_SCREENPLAY_KEYWORDS = new Set([
  "remake",
  "live action remake",
  "sequel",
  "prequel",
  "spin off",
  "reboot",
]);
const NON_SOURCE_KEYWORDS = new Set([
  "based on true story",
  "based on real person",
  "based on real events",
]);

/** Returns TMDB keywords that name earlier material as a film's basis. @param {Object|null} details TMDB details with appended keywords. @returns {string[]} Distinct matching keyword names. */
window.tmdbSourceMaterialKeywords = function (details) {
  let keywords =
    details?.keywords?.keywords || details?.keywords?.results || [];
  return [
    ...new Set(
      keywords
        .map((keyword) =>
          String(keyword?.name || "")
            .trim()
            .toLowerCase(),
        )
        .filter(
          (name) =>
            ADAPTED_SCREENPLAY_KEYWORDS.has(name) ||
            (name.startsWith("based on ") && !NON_SOURCE_KEYWORDS.has(name)),
        ),
    ),
  ];
};

// Genre 16 is TMDB's canonical Animation genre id.
const TMDB_ANIMATION_GENRE_ID = 16;

/**
 * Extracts film classification signals (medium, screenplay type, language)
 * from an already-fetched TMDB movie-details response. Avoids additional
 * API calls — this is a pure derivation over data `lookupTmdbMovieDetails`
 * already returns (genres, credits.crew, keywords, original_language).
 *
 * All three signals are heuristics: TMDB data is crowdsourced and sometimes
 * incomplete. The caller treats an unknown/null result the same as missing
 * data and never hard-blocks on it.
 *
 * @param {Object|null} details TMDB movie-details response (may be null for TV).
 * @returns {{medium: 'animation'|'live-action'|null, screenplayType: 'original'|'adapted'|null, originalLanguage: string|null}}
 */
window.extractTmdbFilmClassification = function (details) {
  if (!details || details._media_type === "tv") {
    return { medium: null, screenplayType: null, originalLanguage: null };
  }

  // Medium: animation if genre 16 is present, otherwise live-action.
  let genres = details.genres || [];
  /** @type {'animation'|'live-action'} */
  let medium = genres.some((g) => g?.id === TMDB_ANIMATION_GENRE_ID)
    ? "animation"
    : "live-action";

  // Screenplay type: source-material writing jobs or source keywords mean
  // adapted. Ordinary story, screenplay and adaptation jobs remain original;
  // with neither writing credits nor source keywords the type stays empty.
  let crew = details?.credits?.crew || details?.crew || [];
  let writingCrew = crew.filter(
    (person) =>
      String(person?.department || "").toLowerCase() === "writing" ||
      /^(writer|screenplay|story|screen story|original story|adaptation)$/i.test(
        String(person?.job || "").trim(),
      ) ||
      ADAPTED_SCREENPLAY_JOBS.has(
        String(person?.job || "")
          .toLowerCase()
          .trim(),
      ),
  );
  /** @type {'original'|'adapted'|null} */
  let screenplayType = null;
  if (
    window.tmdbSourceMaterialJobs(writingCrew).length ||
    window.tmdbSourceMaterialKeywords(details).length
  )
    screenplayType = "adapted";
  else if (writingCrew.length) screenplayType = "original";

  let originalLanguage = details.original_language
    ? String(details.original_language).trim().toLowerCase()
    : null;

  return { medium, screenplayType, originalLanguage };
};

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
  if (!match)
    return { mediaType: "movie", id: raw, season: null, episode: null };
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
  return window.withRetry(
    async () => {
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
          throw Object.assign(
            new Error(`${provider} request failed (${response.status})`),
            { status: response.status },
          );
        }
        return await response.json();
      } catch (err) {
        if (err.name === "AbortError") {
          let timeoutError = new Error(`${provider} request timed out`, {
            cause: err,
          });
          timeoutError.name = "AbortError";
          throw timeoutError;
        }
        throw err;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
    { maxAttempts: attempts, baseDelayMs: 300 },
  );
};

/**
 * Extracts a candidate film title from a Letterboxd URL slug.
 * @param {string} url Letterboxd URL.
 * @returns {string|null} Extracted title or null.
 */
window.extractLetterboxdSlugTitle = function (url) {
  let text = String(url || "").trim();
  if (!text) return null;
  let match = text.match(/\/film\/([^/?#]+)/i);
  if (!match) return null;
  let slug = decodeURIComponent(match[1])
    .replace(/-\d{4}$/, "")
    .replace(/-/g, " ")
    .trim();
  return slug || null;
};

/**
 * Reads the TMDB reference a Letterboxd film page names: its body's
 * data-tmdb-id, else its TMDB link. Placeholder ids such as `tv/0` (a page
 * Letterboxd has not linked) are ignored. Kept in parity with
 * supabase/functions/letterboxd-film/index.ts.
 * @param {string} html Letterboxd film page HTML.
 * @returns {string|null} The movie ID or "TV:<id>[/S<season>[E<episode>]]" reference, or null.
 */
window.parseLetterboxdTmdbReference = function (html) {
  let text = String(html || "");
  let dataId = text.match(/data-tmdb-id=["']([1-9]\d*)["']/i)?.[1];
  if (dataId)
    return /data-tmdb-type=["']tv["']/i.test(text) ? `TV:${dataId}` : dataId;
  let link = text.match(
    /themoviedb\.org\/(movie|tv)\/([1-9]\d*)(?:\/season\/(\d+)(?:\/episode\/([1-9]\d*))?)?/i,
  );
  if (!link) return null;
  if (link[1].toLowerCase() === "movie") return link[2];
  let reference = `TV:${link[2]}`;
  if (link[3] !== undefined) reference += `/S${Number(link[3])}`;
  if (link[4] !== undefined) reference += `E${Number(link[4])}`;
  return reference;
};

/**
 * Resolves the TMDB reference a Letterboxd film link names. letterboxd.com
 * sends no CORS headers, so a page with a Supabase client asks the
 * letterboxd-film Edge Function; only a context without one (such as the
 * owner Sheets script under Node) fetches the page itself.
 * @param {string} url Letterboxd URL.
 * @param {Function} [fetchFn] Fetch implementation for the direct page fetch.
 * @returns {Promise<string|null>} TMDB ID or TV reference string, or null.
 */
window.lookupLetterboxdFilmTmdbId = async function (url, fetchFn) {
  let targetUrl = String(url || "").trim();
  if (!targetUrl || !/letterboxd\.com|boxd\.it/i.test(targetUrl)) return null;
  let ready = await window.ensureSupabaseClient?.().catch(() => null);
  if (ready?.client?.functions) {
    try {
      let { data } = await ready.client.functions.invoke("letterboxd-film", {
        body: { url: targetUrl },
      });
      let reference = String(data?.tmdbId ?? "");
      return data?.ok &&
        /^(?:[1-9]\d*|TV:[1-9]\d*(?:\/S\d+(?:E[1-9]\d*)?)?)$/.test(reference)
        ? reference
        : null;
    } catch (_err) {
      return null;
    }
  }
  let fetcher =
    fetchFn ||
    (typeof window !== "undefined" && window.fetch) ||
    (typeof fetch === "function" ? fetch : null);
  if (typeof fetcher !== "function") return null;
  try {
    let response = await fetcher(targetUrl, {
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!response || !response.ok) return null;
    let html = typeof response.text === "function" ? await response.text() : "";
    return window.parseLetterboxdTmdbReference(html);
  } catch (_err) {
    // Unsupported or unreachable network
  }
  return null;
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
  // A decade shorthand ("60s") vs expanded ("1960s") causes TMDB search
  // to return zero results when differing from TMDB's title.
  if (/\b([2-9]0)s\b/i.test(raw))
    variants.push(raw.replace(/\b([2-9]0)s\b/gi, "19$1s"));
  if (/\b([0-2]0)s\b/i.test(raw))
    variants.push(raw.replace(/\b([0-2]0)s\b/gi, "20$1s"));
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

function tmdbMovieSearchParams(film, queryTitle, yearOverride) {
  let params = new URLSearchParams({
    query: queryTitle || film.title,
    include_adult: "false",
    language: "en-US",
  });
  let year = yearOverride !== undefined ? yearOverride : film.year;
  if (/^\d{4}$/.test(String(year || ""))) params.set("year", year);
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
    let details = await window.lookupTmdbMovieDetails(film.tmdbId, fetchFn);
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
window.lookupTmdbPosterOptions = async function (film, fetchFn, options = {}) {
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

/**
 * Finds a TMDB movie using titles and alternative-title details.
 * TMDB's own `year` search parameter is a hard filter, not a ranking
 * hint (confirmed live: querying with an off-by-one year excludes the
 * correct film entirely, it isn't just deprioritized) - a film's
 * recorded year, year-1, and year+1 are all tried in turn, matching the
 * same tolerance src/domain/supabase-metadata-batch.js's
 * lookupTmdbFilmPoster already has for its own, separate search path.
 * @param {FilmRecord} film Film.
 * @param {Function} fetchFn Fetch implementation.
 * @returns {Promise<Object|null>} TMDB result.
 */
window.lookupTmdbMovieSearch = async function (film, fetchFn) {
  if (!window.tmdbMovieSearchEligible(film)) return null;
  let year = Number(film.year);
  // A missing/non-numeric year must still try one bare, unconstrained
  // search - the ±1 neighbors of a non-finite year are also non-finite,
  // so filtering them out would leave candidateYears empty and this
  // whole loop a silent no-op.
  let candidateYears = Number.isFinite(year)
    ? [year, year - 1, year + 1]
    : [null];
  for (let candidateYear of candidateYears) {
    // selectTmdbMovie's own +50 year-match bonus reads film.year - pass a
    // view with the *candidate* year being tried this pass, not the
    // film's originally recorded one, so a year-1/year+1 pass can still
    // score as a confident match instead of always missing its own bonus.
    let scoringFilm =
      candidateYear == null ? film : { ...film, year: candidateYear };
    for (let queryTitle of window.tmdbMovieSearchTitleVariants(film.title)) {
      let params = tmdbMovieSearchParams(film, queryTitle, candidateYear);
      let data = await window.requestPosterJson(
        fetchFn,
        `${window.TMDB_API_BASE}/search/movie?${params}`,
        { headers: { accept: "application/json" } },
        "TMDB",
        2,
      );
      let directMatch = window.selectTmdbMovie(scoringFilm, data.results);
      if (directMatch) return directMatch;
      // TMDB's year filter matches any release in that year, so a result
      // whose primary release is later (a festival premiere years before
      // its theatrical run) is still a candidate. It goes after the
      // primary-year results, keeping their rank penalty unchanged, and
      // without the year bonus only an exact title can select it.
      let topResults = (data.results || []).slice(0, 8);
      let primaryYear = (result) =>
        candidateYear == null ||
        posterYear(result.release_date) === String(candidateYear);
      let candidates = [
        ...topResults.filter(primaryYear),
        ...topResults.filter((result) => !primaryYear(result)),
      ];
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
        scoringFilm,
        candidates,
        detailsById,
      );
      if (alternativeMatch && detailsById[alternativeMatch.id])
        alternativeMatch._details = detailsById[alternativeMatch.id];
      if (alternativeMatch) return alternativeMatch;
    }
  }
  return null;
};

/**
 * Finds a TMDB series when movie search finds nothing - a fallback, not a
 * first attempt, since most watched titles are movies. Returns a match with
 * `id` already in the "TV:<seriesId>" notation parseTmdbReference expects,
 * so every downstream consumer (lookupTmdbMovieDetails, tmdbResourcePath)
 * works unchanged.
 * @param {FilmRecord} film Film.
 * @param {Function} fetchFn Fetch implementation.
 * @param {{yearTolerance?: number}} [options] Years an exact-title series' first-air year may differ by (default 0).
 * @returns {Promise<Object|null>} TMDB result.
 */
window.lookupTmdbTvSearch = async function (film, fetchFn, options = {}) {
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
    let match = window.selectTmdbTvShow(
      film,
      data.results,
      options.yearTolerance,
    );
    if (match) return { ...match, id: `TV:${match.id}` };
  }
  return null;
};

/**
 * Finds one season of a TMDB series catalogued under its own title, such as
 * "Twin Peaks: The Return" (Twin Peaks season 3). Only a series whose name
 * begins the title is fetched, and its "<series> <season name>" must equal
 * the title. Returns a match with `id` in "TV:<seriesId>/S<season>" notation.
 * @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @returns {Promise<Object|null>} TMDB result.
 */
window.lookupTmdbTvSeasonSearch = async function (film, fetchFn) {
  let title = String(film?.title || "").trim();
  let queries = [title, title.split(":")[0].trim()].filter(
    (query, index, all) => query && all.indexOf(query) === index,
  );
  let checked = new Set();
  for (let query of queries) {
    let params = new URLSearchParams({
      query,
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
    for (let series of (data.results || []).slice(0, 5)) {
      if (checked.has(series.id)) continue;
      checked.add(series.id);
      if (!window.tmdbSeriesPrefixesTitle(film, series)) continue;
      let details;
      try {
        details = await window.requestPosterJson(
          fetchFn,
          `${window.TMDB_API_BASE}/tv/${encodeURIComponent(series.id)}?language=en-US`,
          { headers: { accept: "application/json" } },
          "TMDB",
          2,
        );
      } catch (err) {
        console.warn(`TMDB season lookup failed for ${series.name}`, err);
        continue;
      }
      let season = window.selectTmdbTvSeason(film, details);
      if (season)
        return {
          ...series,
          id: `TV:${series.id}/S${season.season_number}`,
          poster_path: season.poster_path || series.poster_path,
        };
    }
  }
  return null;
};

/**
 * Finds a film on TMDB by title and year: a movie first, then a whole TV
 * series (an exact title may have first aired up to two years away, as
 * Letterboxd often dates a series by its premiere), then one season of a
 * series.
 * @param {FilmRecord} film Film. @param {Function} fetchFn Fetch implementation. @returns {Promise<Object|null>} TMDB result, with a TV match's `id` in "TV:" notation.
 */
window.lookupTmdbTitleMatch = async function (film, fetchFn) {
  return (
    (await window.lookupTmdbMovieSearch(film, fetchFn)) ||
    (await window.lookupTmdbTvSearch(film, fetchFn, { yearTolerance: 2 })) ||
    (await window.lookupTmdbTvSeasonSearch(film, fetchFn))
  );
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
    append_to_response:
      "credits,alternative_titles,translations,release_dates,keywords",
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
 * @param {string[]} [requestedFields] Fields eligible for fetching; skips aggregate runtime requests when excluded.
 * @returns {Promise<{country: string|null, primaryCountry: string|null, runtimeMinutes: number|null, director: string|null, directors: {tmdbId: number|null, name: string, profilePath: string|null}[], originalLanguage: string|null}>}
 */
window.lookupTmdbTvMetadataFields = async function (
  reference,
  fetchFn,
  requestedFields,
) {
  let show = await window.lookupTmdbMovieDetails(`TV:${reference.id}`, fetchFn);
  if (!show?.id) throw new Error("TV series details unavailable");
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
    if (!season?.id) throw new Error("TV season details unavailable");
    return (season?.episodes || []).map(
      (episode) => Number(episode.runtime) || 0,
    );
  }

  let directors = (show?.created_by || [])
    .map((person) => ({
      tmdbId: person.id ? Number(person.id) : null,
      name: String(person.name || "").trim(),
      profilePath: person.profile_path || null,
    }))
    .filter((person) => person.name);

  let runtimeMinutes;
  let wantsRuntime =
    !requestedFields || requestedFields.includes("runtime_minutes");
  if (reference.episode !== null) {
    let episode = await window.lookupTmdbMovieDetails(
      `TV:${reference.id}/S${reference.season}E${reference.episode}`,
      fetchFn,
    );
    if (!episode?.id) throw new Error("TV episode details unavailable");
    runtimeMinutes =
      Number(episode?.runtime) > 0 ? Number(episode.runtime) : null;
    let epDirectors = (episode?.crew || [])
      .filter((person) => person.job === "Director")
      .map((person) => ({
        tmdbId: person.id ? Number(person.id) : null,
        name: String(person.name || "").trim(),
        profilePath: person.profile_path || null,
      }))
      .filter((person) => person.name);
    if (epDirectors.length) directors = epDirectors;
  } else if (!wantsRuntime) {
    runtimeMinutes = null;
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
      realSeasons.map((season) => seasonEpisodeRuntimes(season.season_number)),
    );
    let total = allRuntimes.flat().reduce((sum, minutes) => sum + minutes, 0);
    runtimeMinutes = total > 0 ? total : null;
  }

  let director = directors.map((d) => d.name).join(", ") || null;
  return {
    country,
    primaryCountry,
    runtimeMinutes,
    director,
    directors,
    originalLanguage: show.original_language || null,
  };
};

/**
 * Confirms which of several identically-named TMDB person ids is the real
 * match, by checking whether it appears in the real cast/crew of a film
 * this person is already known to be locally credited on - a strictly
 * stronger signal than popularity or profile-photo presence, since it ties
 * the id to an already-confirmed real credit rather than a heuristic
 * guess. Only consulted when a name search returns more than one distinct
 * same-named person (see lookupTmdbPersonPortrait). Reuses
 * lookupTmdbMovieDetails, which already requests
 * append_to_response=credits for every metadata lookup elsewhere in the
 * app - no new TMDB endpoint.
 * @param {(number|string)[]} creditedFilmTmdbIds Locally-credited films' TMDB ids.
 * @param {number[]} candidateIds Ambiguous same-named TMDB person ids.
 * @param {Function} fetchFn
 * @returns {Promise<number|null>} The one confirmed id, or null if inconclusive.
 */
async function confirmTmdbPersonByLocalCredit(
  creditedFilmTmdbIds,
  candidateIds,
  fetchFn,
) {
  for (let filmTmdbId of creditedFilmTmdbIds || []) {
    let details = await window.lookupTmdbMovieDetails(filmTmdbId, fetchFn);
    let realCreditIds = new Set(
      [
        ...(details?.credits?.cast || []),
        ...(details?.credits?.crew || []),
      ].map((member) => member.id),
    );
    let confirmed = candidateIds.filter((id) => realCreditIds.has(id));
    if (confirmed.length === 1) return confirmed[0];
  }
  return null;
}

/**
 * Searches TMDB for people named exactly like `person` and narrows several
 * namesakes to one: the one credited on a film this person is known for, or
 * else the only one with a profile photo. Returns every search result for
 * that single person, or none when the namesakes stay ambiguous.
 */
async function tmdbSameNamedPeople(person, fetchFn) {
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
  let exact = (data.results || []).filter(
    (result) =>
      window.normalizePersonName(result.name) ===
      window.normalizePersonName(person.name),
  );
  let uniqueIds = [...new Set(exact.map((result) => result.id))];
  if (uniqueIds.length > 1) {
    let confirmedId = await confirmTmdbPersonByLocalCredit(
      person.creditedFilmTmdbIds,
      uniqueIds,
      fetchFn,
    );
    if (confirmedId != null) {
      exact = exact.filter((result) => result.id === confirmedId);
    } else {
      // Popularity alone cannot establish which namesake belongs to an
      // unlinked record, but a namesake with no profile photo at all is
      // never a plausible rival to one that has one.
      let withPhoto = exact.filter((result) => result.profile_path);
      if (new Set(withPhoto.map((result) => result.id)).size !== 1) return [];
      exact = withPhoto;
    }
  }
  return exact;
}

/**
 * Identifies a person on TMDB by exact name, telling namesakes apart the same
 * way portrait lookup does.
 * @param {{name: string, creditedFilmTmdbIds?: (number|string)[]}} person Person to identify.
 * @param {Function} fetchFn Fetch implementation.
 * @returns {Promise<{tmdbId: number, name: string, profilePath: string|null}|null>} The match, or null when none or several remain.
 */
window.lookupTmdbPersonIdentity = async function (person, fetchFn) {
  if (!String(person?.name || "").trim()) return null;
  let exact = await tmdbSameNamedPeople(person, fetchFn);
  if (new Set(exact.map((result) => result.id)).size !== 1) return null;
  let match = exact.find((result) => result.profile_path) || exact[0];
  return {
    tmdbId: Number(match.id),
    name: String(match.name || person.name).trim(),
    profilePath: match.profile_path || null,
  };
};

/** Finds a TMDB portrait for a person. @param {{name: string, tmdbId?: number|string|null, tmdb_id?: number|string|null, creditedFilmTmdbIds?: (number|string)[]}} person Person record or Supabase person row. @param {Function} fetchFn Fetch implementation. @returns {Promise<PosterRecord|null>} Portrait. */
window.lookupTmdbPersonPortrait = async function (person, fetchFn) {
  let knownId = person.tmdbId || person.tmdb_id;
  if (/^[1-9][0-9]*$/.test(String(knownId || ""))) {
    let match = await window.requestPosterJson(
      fetchFn,
      `${window.TMDB_API_BASE}/person/${knownId}?language=en-US`,
      { headers: { accept: "application/json" } },
      "TMDB",
      2,
    );
    if (!match?.profile_path || Number(match.id) !== Number(knownId))
      return null;
    return window.normalizePosterRecord({
      url: `https://image.tmdb.org/t/p/h632${match.profile_path}`,
      source: "tmdb",
      sourceUrl: `https://www.themoviedb.org/person/${match.id}`,
      providerId: match.id,
    });
  }
  let exact = await tmdbSameNamedPeople(person, fetchFn);
  if (!exact.length) return null;
  let match = window.selectTmdbPersonPortrait(person, exact);
  if (!match) return null;
  return window.normalizePosterRecord({
    url: `https://image.tmdb.org/t/p/h632${match.profile_path}`,
    source: "tmdb",
    sourceUrl: `https://www.themoviedb.org/person/${match.id}`,
    providerId: match.id,
  });
};

/** Searches TMDB for explicit film choices.
 * @param {{title: string, year?: string}} film Search terms.
 * @param {Function} [fetchFn] Fetch implementation.
 * @returns {Promise<Object[]>} Movie and TV candidates.
 */
window.searchTmdbFilmCandidates = async function (
  film,
  fetchFn = window.fetch.bind(window),
) {
  if (!film.title.trim()) return [];
  let batches = await Promise.all(
    ["movie", "tv"].map(async (kind) => {
      let params = new URLSearchParams({
        query: film.title.trim(),
        include_adult: "false",
        language: "en-US",
      });
      if (film.year)
        params.set(
          kind === "movie" ? "year" : "first_air_date_year",
          film.year,
        );
      let data = await window.requestPosterJson(
        fetchFn,
        `${window.TMDB_API_BASE}/search/${kind}?${params}`,
        { headers: { accept: "application/json" } },
        "TMDB",
        2,
      );
      return (data.results || []).slice(0, 10).map((result) => ({
        tmdbId: kind === "tv" ? `TV:${result.id}` : String(result.id),
        title: result.title || result.name,
        year: String(result.release_date || result.first_air_date || "").slice(
          0,
          4,
        ),
        posterUrl: result.poster_path
          ? `https://image.tmdb.org/t/p/w185${result.poster_path}`
          : "",
        mediaType: kind,
      }));
    }),
  );
  return batches.flat();
};
