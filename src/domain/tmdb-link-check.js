/** @file Verifies stored TMDB ids resolve to the expected media type and identity, on explicit request. */

// TMDB link check (issues #42/#280/#288/#289): a *bare* tmdbId is treated as a movie
// id, but sheet-imported ids can accidentally point to TV or to an unrelated
// movie. This probes TMDB only on an explicit button press and reports bare
// ids that resolve as TV, as nothing at all, or with different identity
// metadata. Ids already using the explicit "TV:" notation
// (parseTmdbReference) are
// deliberate, not an accidental mixup, and are excluded from this check —
// there is nothing to flag about an id that already declares what it is.
// Results are session-only; nothing is persisted.
let mediaTypeCheckAttempts = new Set();

async function fetchTmdbResource(kind, id, credential, fetchFn) {
  let params = new URLSearchParams({ language: "en-US" });
  if (kind === "movie")
    params.set(
      "append_to_response",
      "alternative_titles,translations,release_dates",
    );
  let headers = window.tmdbAuthHeaders(credential, params);
  let response = await fetchFn(
    `${window.TMDB_API_BASE}/${kind}/${encodeURIComponent(id)}?${params}`,
    { headers },
  );
  if (response.status === 404) return { exists: false };
  if (!response.ok) throw new Error(`TMDB request failed (${response.status})`);
  let data = await response.json();
  let runtimeOptions = window.tmdbRuntimeOptions(data);
  let releaseYearOptions = window.tmdbReleaseYearOptions(data);
  return {
    exists: true,
    title: String(data.title || data.name || ""),
    originalTitle: String(data.original_title || data.original_name || ""),
    alternativeTitles: (data.alternative_titles?.titles || [])
      .map((entry) => String(entry?.title || ""))
      .filter(Boolean),
    releaseYear: String(data.release_date || data.first_air_date || "").match(
      /^\d{4}/,
    )?.[0] || "",
    releaseYearOptions,
    runtimeMinutes: Number(data.runtime) || 0,
    runtimeOptions,
  };
}

/**
 * Returns distinct positive runtime values in source order.
 * @param {Array<number|string>} values Runtime candidates.
 * @returns {number[]} Normalized runtime candidates.
 */
function distinctPositiveRuntimes(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  );
}

/**
 * Collects the primary and country/language-specific runtimes from a TMDB
 * movie details response.
 * @param {Object} data TMDB movie details with appended translations.
 * @returns {number[]} Distinct positive runtime candidates.
 */
window.tmdbRuntimeOptions = function (data) {
  return distinctPositiveRuntimes([
    data?.runtime,
    ...(data?.translations?.translations || []).map(
      (translation) => translation?.data?.runtime,
    ),
  ]);
};

/**
 * Collects the primary and regional years from a TMDB movie details response.
 * @param {Object} data TMDB movie details with appended release dates.
 * @returns {string[]} Distinct four-digit release years.
 */
window.tmdbReleaseYearOptions = function (data) {
  let dates = [
    data?.release_date,
    ...(data?.release_dates?.results || []).flatMap((region) =>
      (region?.release_dates || []).map((release) => release?.release_date),
    ),
  ];
  return Array.from(
    new Set(
      dates
        .map((date) => String(date || "").match(/^\d{4}/)?.[0] || "")
        .filter(Boolean),
    ),
  );
};

/**
 * Classifies movie/TV TMDB probe results and verifies movie identity when a
 * local film is supplied.
 * @param {Object} movieResult Movie result.
 * @param {Object|null} tvResult TV result.
 * @param {FilmRecord} [film] Local watched film.
 * @returns {Object} Verdict.
 */
window.classifyTmdbMediaCheck = function (movieResult, tvResult, film) {
  if (movieResult?.exists) {
    if (!film) return { status: "ok", detail: "" };
    let localTitles = [film.title, film.swedishTitle]
      .map(window.comparableFilmTitle)
      .filter(Boolean);
    let remoteTitles = [
      movieResult.title,
      movieResult.originalTitle,
      ...(movieResult.alternativeTitles || []),
    ]
      .map(window.comparableFilmTitle)
      .filter(Boolean);
    let titleMatches = localTitles.some((title) =>
      remoteTitles.includes(title),
    );
    let localYear = window.filmConcreteYear?.(film.year) || "";
    let remoteYears = Array.from(
      new Set(
        [movieResult.releaseYear]
          .concat(movieResult.releaseYearOptions || [])
          .map((year) => window.filmConcreteYear?.(year) || "")
          .filter(Boolean),
      ),
    );
    let yearDiffers = Boolean(
      localYear && remoteYears.length && !remoteYears.includes(localYear),
    );
    let localRuntime = Number(film.runtimeMinutes) || 0;
    let remoteRuntimes = distinctPositiveRuntimes(
      [movieResult.runtimeMinutes].concat(movieResult.runtimeOptions || []),
    );
    let runtimeDiffers = Boolean(
      localRuntime &&
        remoteRuntimes.length &&
        !remoteRuntimes.includes(localRuntime),
    );
    let differences = [];
    if (!titleMatches)
      differences.push(
        `Title: "${film.title || "Untitled local film"}" → "${movieResult.title || movieResult.originalTitle || "Untitled TMDB movie"}"`,
      );
    if (yearDiffers)
      differences.push(
        `Release year: ${localYear} → ${remoteYears.join(" / ")}`,
      );
    if (runtimeDiffers)
      differences.push(
        `Runtime: ${localRuntime} min → ${remoteRuntimes
          .map((runtime) => `${runtime} min`)
          .join(" / ")}`,
      );
    if (!differences.length) return { status: "ok", detail: "" };
    return {
      status: "identity",
      detail: differences.join("; "),
    };
  }
  if (tvResult?.exists)
    return {
      status: "tv",
      detail: tvResult.title
        ? `Resolves as TV: ${tvResult.title}`
        : "Resolves as TV",
    };
  return { status: "missing", detail: "Not found on TMDB" };
};

window.tmdbMediaTypeSession = { checked: 0, issues: [] };

/**
 * Checks stored watched-film TMDB ids for movie identity and media type.
 * @param {Object} [options] Batch controls.
 * @returns {Promise<Object>} Check totals.
 */
window.checkTmdbMediaTypes = async function (options = {}) {
  let settings = Object.assign(
    {},
    window.getPosterSettings?.() || {},
    options.settings || {},
  );
  if (!settings.tmdbCredential)
    throw new Error("A TMDB credential is required for TMDB link checks.");
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("TMDB link checks require browser network access.");
  let limit = Math.max(1, Number(options.limit) || 250);
  let films = (
    options.films || Object.values(window.state.filmsById || {})
  ).filter(
    (film) =>
      film?.id &&
      film.title &&
      film.tmdbId &&
      !film.watchlistItem &&
      window.parseTmdbReference(film.tmdbId).mediaType === "movie",
  );
  let candidates = films
    .filter((film) => options.force || !mediaTypeCheckAttempts.has(film.id))
    .slice(0, limit);
  candidates.forEach((film) => mediaTypeCheckAttempts.add(film.id));

  let session = window.tmdbMediaTypeSession;
  let result = {
    attempted: candidates.length,
    ok: 0,
    issues: 0,
    failed: 0,
    remaining: 0,
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let film = candidates[cursor++];
      try {
        let movie = await fetchTmdbResource(
          "movie",
          film.tmdbId,
          settings.tmdbCredential,
          fetchFn,
        );
        let tv = movie.exists
          ? null
          : await fetchTmdbResource(
              "tv",
              film.tmdbId,
              settings.tmdbCredential,
              fetchFn,
            );
        let verdict = window.classifyTmdbMediaCheck(movie, tv, film);
        session.checked += 1;
        if (verdict.status === "ok") result.ok += 1;
        else {
          result.issues += 1;
          if (!session.issues.some((issue) => issue.id === film.id)) {
            session.issues.push({
              id: film.id,
              title: `${film.title}${film.year ? ` (${film.year})` : ""}`,
              href: window.filmPageUrl?.(film.id) || "",
              tmdbId: String(film.tmdbId),
              localType: String(film.type || "").trim(),
              status: verdict.status,
              detail: verdict.detail,
            });
          }
        }
      } catch (err) {
        console.warn(`TMDB media type check failed for ${film.title}`, err);
        result.failed += 1;
        // A network hiccup shouldn't consume the film's one attempt.
        mediaTypeCheckAttempts.delete(film.id);
      }
      options.onProgress?.(
        result.ok + result.issues + result.failed,
        candidates.length,
        film,
      );
    }
  }
  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  result.remaining = films.filter(
    (film) => !mediaTypeCheckAttempts.has(film.id),
  ).length;
  return result;
};
