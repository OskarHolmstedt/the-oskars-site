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

// Exposed (not just a private top-level function) so
// checkSupabaseFilmTmdbLinks below can reuse the exact same TMDB-probing
// logic rather than a second, parallel implementation.
window.fetchTmdbResource = async function fetchTmdbResource(kind, id, fetchFn) {
  let params = new URLSearchParams({ language: "en-US" });
  if (kind === "movie")
    params.set(
      "append_to_response",
      "alternative_titles,translations,release_dates",
    );
  let response = await fetchFn(
    `${window.TMDB_API_BASE}/${kind}/${encodeURIComponent(id)}?${params}`,
    { headers: { accept: "application/json" } },
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
    releaseYear:
      String(data.release_date || data.first_air_date || "").match(
        /^\d{4}/,
      )?.[0] || "",
    releaseYearOptions,
    runtimeMinutes: Number(data.runtime) || 0,
    runtimeOptions,
  };
};

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
        let movie = await window.fetchTmdbResource(
          "movie",
          film.tmdbId,
          fetchFn,
        );
        let tv = movie.exists
          ? null
          : await window.fetchTmdbResource("tv", film.tmdbId, fetchFn);
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

// Separate session-attempt tracking from checkTmdbMediaTypes' own
// mediaTypeCheckAttempts (above) - that one keys off the legacy
// window.state.filmsById shape's ids; this one is for the owner
// data-tools page's raw Supabase film rows. Both are keyed by the same
// underlying film uuid, but kept as separate sets so neither caller's
// batching state leaks into the other's.
let supabaseLinkCheckAttempts = new Set();

/**
 * Batch-checks stored film tmdb_ids for movie identity and media-type
 * mismatches (an id that silently resolves as TV, or resolves as an
 * unrelated movie with a different title/year/runtime) - operates
 * directly on the raw Supabase film shape data-tools.html already has
 * loaded, unlike checkTmdbMediaTypes above (built for the legacy
 * window.state.filmsById shape, and currently unreachable from any page's
 * UI since #216 stripped data.html's ad-hoc batch tools down to pure
 * account maintenance). Session-attempt tracking is in-memory only, but a
 * film's own pass/fail state persists across sessions via tmdb_verified_at
 * (a caller's job to write - this function only reports, it never
 * persists anything itself): a film already marked verified is skipped by
 * default, so a re-run only spends real TMDB requests on films that
 * haven't been confirmed correct yet, not the whole catalog every time. A
 * `limit` also bounds how many NEW films get checked per call so the
 * owner can work through a large catalog in several clicks rather than
 * one very long-running request. `force` widens that session's queue to
 * already-verified films too, but the attempt set still advances through
 * the queue instead of rechecking its first page on every click.
 * @param {Object[]} films Raw Supabase film rows (id, tmdb_id, title, year, swedish_title, runtime_minutes, tmdb_verified_at).
 * @param {{fetchFn?: Function, limit?: number, concurrency?: number, force?: boolean, onProgress?: (done:number, total:number, film:Object) => void}} [options]
 * @returns {Promise<{attempted: number, ok: number, okFilms: Object[], issues: {film: Object, status: string, detail: string}[], failed: number, remaining: number}>}
 */
window.checkSupabaseFilmTmdbLinks = async function (films, options = {}) {
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("TMDB link checks require browser network access.");
  let limit = Math.max(1, Number(options.limit) || 300);
  // A film already marked verified (tmdb_verified_at set - by a prior
  // "ok" result here, or the owner explicitly confirming/correcting it in
  // data-tools.js) is skipped by default: re-probing TMDB for the exact
  // same already-confirmed id on every single run wastes real requests
  // for no new information. `force` re-includes them (an explicit
  // "recheck everything" pass) - the caller is responsible for clearing
  // tmdb_verified_at on anything that no longer passes. Session attempts
  // remain excluded in either mode so repeated bounded batches advance.
  let eligible = (films || []).filter(
    (film) =>
      film.tmdb_id &&
      window.parseTmdbReference(film.tmdb_id).mediaType === "movie" &&
      (options.force || !film.tmdb_verified_at),
  );
  let candidates = eligible
    .filter((film) => !supabaseLinkCheckAttempts.has(film.id))
    .slice(0, limit);
  candidates.forEach((film) => supabaseLinkCheckAttempts.add(film.id));

  let result = {
    attempted: candidates.length,
    ok: 0,
    okFilms: [],
    issues: [],
    failed: 0,
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let film = candidates[cursor++];
      try {
        let movie = await window.fetchTmdbResource(
          "movie",
          film.tmdb_id,
          fetchFn,
        );
        let tv = movie.exists
          ? null
          : await window.fetchTmdbResource("tv", film.tmdb_id, fetchFn);
        let verdict = window.classifyTmdbMediaCheck(movie, tv, {
          title: film.title,
          swedishTitle: film.swedish_title,
          year: film.year,
          runtimeMinutes: film.runtime_minutes,
        });
        if (verdict.status === "ok") {
          result.ok += 1;
          result.okFilms.push(film);
        } else {
          result.issues.push({
            film,
            status: verdict.status,
            detail: verdict.detail,
          });
        }
      } catch (err) {
        result.failed += 1;
        // A network hiccup shouldn't consume the film's one attempt.
        supabaseLinkCheckAttempts.delete(film.id);
      }
      options.onProgress?.(
        result.ok + result.issues.length + result.failed,
        candidates.length,
        film,
      );
    }
  }
  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 4),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  result.remaining = eligible.filter(
    (film) => !supabaseLinkCheckAttempts.has(film.id),
  ).length;
  return result;
};
