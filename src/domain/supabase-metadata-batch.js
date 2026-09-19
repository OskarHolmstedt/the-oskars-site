/**
 * @file Owner data-tools support: bounded TMDB metadata batches and
 * fuzzy duplicate-candidate grouping for the shared Supabase film/people
 * catalog.
 *
 * Deliberately does NOT reuse src/domain/image-batches.js's
 * runBoundedLookupBatch() - that runner hard-calls `window.save({immediate:
 * true})` at its save checkpoint (a legacy IndexedDB/localStorage
 * persistence call), which this Supabase-only page never loads and would
 * throw partway through any batch of 3+ successful finds. The pure TMDB
 * lookup functions in src/domain/image-providers.js (lookupTmdbPoster,
 * lookupTmdbPersonPortrait) have no such coupling and are reused as-is.
 */

/**
 * Runs a small bounded-concurrency worker pool over a candidate list,
 * calling `lookup` then `apply` for each, tolerating individual failures
 * without aborting the batch.
 * @param {Object[]} items Candidate items.
 * @param {{lookup: (item:Object) => Promise<*>, apply: (item:Object, value:*) => Promise<void>, concurrency?: number, onProgress?: (done:number, total:number, item:Object) => void}} config
 * @returns {Promise<{attempted: number, found: number, failed: number, failures: {item: Object, reason: string}[]}>}
 */
window.runSupabaseMetadataBatch = async function (items, config) {
  let candidates = items || [];
  let result = {
    attempted: candidates.length,
    found: 0,
    failed: 0,
    failures: [],
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let item = candidates[cursor++];
      try {
        let value = await config.lookup(item);
        if (value) {
          await config.apply(item, value);
          result.found += 1;
        } else {
          result.failed += 1;
          result.failures.push({ item, reason: "No match found." });
        }
      } catch (err) {
        result.failed += 1;
        result.failures.push({ item, reason: String(err?.message || err) });
      }
      config.onProgress?.(
        result.found + result.failed,
        candidates.length,
        item,
      );
    }
  }
  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(config.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  return result;
};

/**
 * Some standalone "films" only exist on TMDB as an episode of an
 * anthology TV series - Steve McQueen's Small Axe (five films, one TMDB
 * TV show) is the found-live example: TMDB has no top-level "Mangrove"
 * movie or show at all, only an episode titled "Mangrove" under the show
 * "Small Axe" (id 90705). There is no TMDB API to search episode titles
 * directly (confirmed against the real API - /search/tv and /search/multi
 * both only match show/movie/person-level titles, never an episode's own
 * name), so this has to be a manually curated map instead of something
 * auto-discoverable, extended as more anthology cases turn up. Keyed by
 * the same fuzzy title+year key groupSupabaseFilmDuplicates uses.
 */
const KNOWN_TV_EPISODE_FILMS = {
  "mangrove::2020": { showId: 90705, season: 1, episode: 1 },
  "lovers rock::2020": { showId: 90705, season: 1, episode: 2 },
  "red white and blue::2020": { showId: 90705, season: 1, episode: 3 },
  "alex wheatle::2020": { showId: 90705, season: 1, episode: 4 },
  "education::2020": { showId: 90705, season: 1, episode: 5 },
};

async function lookupKnownTvEpisodePoster(film, fetchFn) {
  let key = `${window.fuzzyDuplicateKey(film.title)}::${film.year ?? ""}`;
  let ref = KNOWN_TV_EPISODE_FILMS[key];
  if (!ref) return null;
  let reference = window.parseTmdbReference(
    `TV:${ref.showId}/S${ref.season}E${ref.episode}`,
  );
  let episode = await window.requestPosterJson(
    fetchFn,
    `${window.TMDB_API_BASE}/${window.tmdbResourcePath(reference)}?language=en-US`,
    { headers: { accept: "application/json" } },
    "TMDB",
    2,
  );
  if (!episode?.still_path) return null;
  return window.normalizePosterRecord({
    url: `https://image.tmdb.org/t/p/w500${episode.still_path}`,
    source: "tmdb",
    sourceUrl: `https://www.themoviedb.org/${window.tmdbResourcePath(reference)}`,
    providerId: `TV:${ref.showId}/S${ref.season}E${ref.episode}`,
  });
}

const SMALL_NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];

// TMDB is inconsistent about spelling out small numbers in a title -
// "Ocean's Eight" vs a stored "Ocean's 8", "The Fantastic 4: First Steps"
// vs a stored "The Fantastic Four: First Steps" (found live, both real
// cases). comparableFilmTitle (src/domain/film-matching.js) doesn't
// normalize this, so isExactTitleMatch tries both a word and a digit
// rendering before giving up, instead of loosening comparableFilmTitle
// itself for every other caller.
function numberWordVariants(value) {
  let asWords = String(value).replace(/\b\d+\b/g, (digits) => {
    let n = Number(digits);
    return SMALL_NUMBER_WORDS[n] || digits;
  });
  let asDigits = String(value).replace(
    new RegExp(`\\b(${SMALL_NUMBER_WORDS.join("|")})\\b`, "gi"),
    (word) => String(SMALL_NUMBER_WORDS.indexOf(word.toLowerCase())),
  );
  return [value, asWords, asDigits];
}

// Mirrors tmdbMovieSearchTitleVariants' own parenthetical-stripping
// (src/domain/image-providers.js) - needed again here because
// selectTmdbPoster (src/domain/poster-selection.js) scores against the
// film's original, un-stripped title regardless of which search-query
// variant actually found the result. Without this, a real match found
// via the stripped-title search (e.g. "Neecha Nagar (Lowly City)" ->
// "Neecha Nagar") would score a substring-only 80 from selectTmdbPoster,
// then get correctly rejected here anyway since "neecha nagar (lowly
// city)" isn't equal to "neecha nagar" - found live.
function parentheticalStrippedVariant(value) {
  return String(value)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/**
 * Verifies a title-search movie match's real TMDB title is an exact match
 * to the film's own title (allowing for the same parenthetical-suffix and
 * number-word/digit variance the search itself already tolerates) -
 * selectTmdbPoster/selectTmdbMovie (src/domain/poster-selection.js) also
 * accept a much looser signal (any substring containment either
 * direction, worth 30 points) combined with a correct release year
 * (worth 50) landing exactly on their shared 80-point acceptance
 * threshold. Found live: two real production rows (Mangrove, Education -
 * both Small Axe films) had already been silently attached to a
 * completely different, unrelated same-year film this way ("White
 * Mangrove", "The Education"). That threshold is reasonable for the
 * legacy single-film-edit flow, where a human sees the wrong poster
 * immediately and can reject it - this tool's whole point is
 * unsupervised bulk writes, so the acceptance bar has to be stricter.
 * Only called for a title-search-found match (no existing tmdb_id); an
 * id-based lookup already carries its own trusted identity.
 * @param {string} title
 * @param {number|string} providerId TMDB movie id from the loose match.
 * @param {Function} fetchFn
 * @returns {Promise<boolean>}
 */
async function isExactTitleMatch(title, providerId, fetchFn) {
  let details = await window.lookupTmdbMovieDetails(providerId, fetchFn);
  let candidates = [details?.title, details?.original_title]
    .flatMap((value) => numberWordVariants(value || ""))
    .map((value) => window.comparableFilmTitle(value))
    .filter(Boolean);
  let ownVariants = [title, parentheticalStrippedVariant(title)]
    .flatMap((value) => numberWordVariants(value))
    .map((value) => window.comparableFilmTitle(value));
  return ownVariants.some((variant) => candidates.includes(variant));
}

/**
 * Looks up a poster for a Supabase film row: a curated TV-episode
 * reference first (see KNOWN_TV_EPISODE_FILMS), then TMDB movie search
 * (verified against a false-positive substring+year match - see
 * isExactTitleMatch), falling back to the film's neighboring release
 * years, then to a plain TV-show-title search if nothing else matched.
 *
 * The year fallback exists because Oscar eligibility runs on US
 * theatrical release date, not a film's general/international release
 * year - a title that qualified in December of year N (a brief awards-
 * qualifying run) can show up in awards-derived data stamped year N, N-1,
 * or N+1 depending on the source, one year off from what TMDB calls its
 * primary release year. Only tried when the film has no tmdb_id yet (an
 * id-based lookup has no year ambiguity to correct in the first place)
 * and only ±1 year, not an unconstrained search - a same-titled remake in
 * a completely different decade should never silently get attached here.
 * When a neighboring year is what actually matches, the caller is told so
 * it can correct the stored year, not just the poster.
 *
 * The TV-show-title fallback covers archived "films" (miniseries, TV
 * movies) only catalogued as TV on TMDB under their own name, found live
 * from a real run's "No match found" list turning out to be TV titles.
 * lookupTmdbTvSearch (src/domain/image-providers.js) returns the raw
 * TMDB result, not a normalized PosterRecord like the movie path - built
 * here the same way lookupTmdbPoster's own movie branch does.
 * @param {{tmdb_id: number|null, title: string, year: number|null}} film
 * @param {Function} fetchFn
 * @returns {Promise<{poster: PosterRecord, correctedYear: number|null}|null>}
 */
window.lookupTmdbFilmPoster = async function (film, fetchFn) {
  let knownEpisode = await lookupKnownTvEpisodePoster(film, fetchFn);
  if (knownEpisode)
    return { poster: knownEpisode, correctedYear: null, mediaType: "tv" };

  // A missing year must still try a bare, unconstrained search - the
  // ±1 neighbors of a non-finite year are also non-finite, so filtering
  // them out left candidateYears empty and the whole loop below a
  // silent no-op (every year-less film failed outright, found live).
  let candidateYears = film.tmdb_id
    ? [film.year]
    : Number.isFinite(film.year)
      ? [film.year, film.year - 1, film.year + 1]
      : [null];
  // A digit/word swap ("The Fantastic Four" vs TMDB's own "The Fantastic
  // 4") isn't a substring either direction, so selectTmdbPoster
  // (src/domain/poster-selection.js) never reaches its 80-point
  // threshold at all with the stored title - isExactTitleMatch's own
  // number-word tolerance never even gets a candidate to check. Only
  // searching with the stored title's own number-word variant (which
  // selectTmdbPoster then scores AS an exact match once the query finds
  // the right film) fixes this - found live.
  let titleVariants = film.tmdb_id
    ? [film.title]
    : [...new Set(numberWordVariants(film.title))];
  for (let year of candidateYears) {
    let variantPosters = await Promise.all(
      titleVariants.map(async (title) => {
        let poster = await window.lookupTmdbPoster(
          { tmdbId: film.tmdb_id, title, year },
          fetchFn,
        );
        if (!poster) return null;
        if (
          film.tmdb_id ||
          (await isExactTitleMatch(title, poster.providerId, fetchFn))
        )
          return {
            poster,
            correctedYear: year !== film.year ? year : null,
            mediaType: "movie",
          };
        return null;
      }),
    );
    let match = variantPosters.find(Boolean);
    if (match) return match;
  }
  for (let year of candidateYears) {
    let tvMatches = await Promise.all(
      titleVariants.map(async (title) => {
        let tvMatch = await window.lookupTmdbTvSearch({ title, year }, fetchFn);
        if (!tvMatch?.poster_path) return null;
        let tvId = String(tvMatch.id).replace(/^TV:/, "");
        return {
          poster: window.normalizePosterRecord({
            url: `https://image.tmdb.org/t/p/w500${tvMatch.poster_path}`,
            source: "tmdb",
            sourceUrl: `https://www.themoviedb.org/tv/${tvId}`,
            providerId: `TV:${tvId}`,
          }),
          correctedYear: year !== film.year ? year : null,
          mediaType: "tv",
        };
      }),
    );
    let match = tvMatches.find(Boolean);
    if (match) return match;
  }
  return null;
};

/**
 * Fetches richer metadata (country, runtime) alongside the poster, for
 * either a verified movie match or a TV match (whole series, or the
 * curated anthology-episode map in lookupKnownTvEpisodePoster) - TMDB's TV
 * show details carry `production_countries` in the same shape a movie's
 * do, and lookupTmdbTvMetadataFields (src/domain/image-providers.js)
 * derives a real total runtime for whichever TV granularity matched.
 * Reuses lookupTmdbFilmPoster's whole verified matching pipeline (year/
 * title-variant fallback, false-positive rejection) rather than the
 * legacy window.lookupTmdbMovieMetadata's own separate, weaker search+
 * select (src/domain/posters.js) - a second, unverified way to find "the
 * right film" is exactly the kind of duplicate matching logic that caused
 * this session's false-positive bugs in the first place.
 *
 * tmdbId always comes back null for a TV match: films.tmdb_id is a plain
 * integer column that only ever means a linked MOVIE id (see the
 * reference-notation comment atop image-providers.js) - a TV show/season/
 * episode has no such id to store there, so this is left honestly unset
 * rather than writing a value nothing downstream can safely interpret.
 * @param {{tmdb_id: number|null, title: string, year: number|null}} film
 * @param {Function} fetchFn
 * @returns {Promise<{poster: PosterRecord, correctedYear: number|null, country: string|null, primaryCountry: string|null, runtimeMinutes: number|null, tmdbId: string|null}|null>}
 */
window.lookupTmdbFilmMetadata = async function (film, fetchFn) {
  let result = await window.lookupTmdbFilmPoster(film, fetchFn);
  if (!result) return result;
  if (result.mediaType === "tv") {
    let reference = window.parseTmdbReference(result.poster.providerId);
    let { country, primaryCountry, runtimeMinutes } =
      await window.lookupTmdbTvMetadataFields(reference, fetchFn);
    return { ...result, country, primaryCountry, runtimeMinutes, tmdbId: null };
  }
  let details = await window.lookupTmdbMovieDetails(
    result.poster.providerId,
    fetchFn,
  );
  let countries = (details?.production_countries || [])
    .map((country) => String(country.name || "").trim())
    .filter(Boolean);
  return {
    ...result,
    country: countries.join(", ") || null,
    primaryCountry: countries[0] || null,
    runtimeMinutes:
      Number(details?.runtime) > 0 ? Number(details.runtime) : null,
    tmdbId: String(result.poster.providerId),
  };
};

/** Normalizes a title/name for fuzzy duplicate matching: NFKD diacritic-stripped, lowercased, punctuation-collapsed. @param {string} value Raw text. @returns {string} Normalized key. */
window.fuzzyDuplicateKey = function (value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

/**
 * Groups films into possible-duplicate clusters by fuzzy title + year - a
 * year-less row is treated as a wildcard that matches any real year for
 * the same title, rather than requiring an exact match. Found live: a
 * film added twice from two import sources - once matched by tmdb_id with
 * no year ever recorded, once with a confirmed year and no tmdb_id -
 * never showed up as a duplicate at all under a strict year match
 * (Automated Trucking, The Last Mrs. Parrish, Merrily We Roll Along all
 * follow exactly this shape). If a title has more than one distinct real
 * year (a genuine remake, not a duplicate), a year-less row gets attached
 * to each of them - a manual-review false positive the surrounding UI
 * already expects and calls out, not a merge that happens on its own.
 * @param {{id: string, tmdb_id: number|null, title: string, year: number|null, poster_url: string|null}[]} films
 * @returns {{key: string, rows: Object[]}[]} Groups with more than one row, sorted by group size descending.
 */
window.groupSupabaseFilmDuplicates = function (films) {
  let byTitle = new Map();
  (films || []).forEach((film) => {
    let key = window.fuzzyDuplicateKey(film.title);
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(film);
  });
  let groups = [];
  byTitle.forEach((rows, titleKey) => {
    if (rows.length < 2) return;
    let withoutYear = rows.filter((film) => film.year == null);
    let byYear = new Map();
    rows
      .filter((film) => film.year != null)
      .forEach((film) => {
        if (!byYear.has(film.year)) byYear.set(film.year, []);
        byYear.get(film.year).push(film);
      });
    if (!byYear.size) {
      groups.push({ key: titleKey, rows: withoutYear });
      return;
    }
    byYear.forEach((yearRows, year) => {
      let combined = withoutYear.length
        ? [...yearRows, ...withoutYear]
        : yearRows;
      if (combined.length > 1)
        groups.push({ key: `${titleKey}::${year}`, rows: combined });
    });
  });
  return groups.sort((left, right) => right.rows.length - left.rows.length);
};

/**
 * Groups people into possible-duplicate clusters by fuzzy name.
 * @param {{id: string, tmdb_id: number|null, name: string, portrait_url: string|null}[]} people
 * @returns {{key: string, rows: Object[]}[]} Groups with more than one row, sorted by group size descending.
 */
window.groupSupabasePersonDuplicates = function (people) {
  let groups = new Map();
  (people || []).forEach((person) => {
    let key = window.fuzzyDuplicateKey(person.name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(person);
  });
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => ({ key, rows }))
    .sort((left, right) => right.rows.length - left.rows.length);
};

/**
 * Builds the stable, order-independent key a dismissed-duplicate-pair row
 * is stored/looked-up under - matches the ordering the
 * dismissed_duplicate_pairs table's own `id_a < id_b` check constraint
 * requires, so a key built here always matches what
 * dismissSupabaseDuplicateGroup (src/core/supabase-workspace.js) writes.
 * @param {string} idA
 * @param {string} idB
 * @returns {string}
 */
window.duplicatePairKey = function (idA, idB) {
  return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
};

/**
 * Hides a duplicate-candidate group once every pairwise relationship in it
 * has already been reviewed and dismissed as "not duplicates" - a group
 * where even one pair is still unreviewed keeps showing (in full), since a
 * later new row joining an old dismissed pair's fuzzy bucket is a
 * genuinely new candidate that still needs a human look, not something to
 * silently inherit its neighbor's old "not a duplicate" verdict.
 * @param {{key: string, rows: {id: string}[]}[]} groups
 * @param {Set<string>} dismissedPairKeys Keys from window.duplicatePairKey for every already-dismissed pair.
 * @returns {{key: string, rows: {id: string}[]}[]}
 */
window.filterDismissedDuplicateGroups = function (groups, dismissedPairKeys) {
  return (groups || []).filter((group) => {
    let ids = group.rows.map((row) => row.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (!dismissedPairKeys.has(window.duplicatePairKey(ids[i], ids[j])))
          return true;
      }
    }
    return false;
  });
};

/**
 * Finds year-less, tmdb_id-less films whose title fuzzy-matches another
 * film in the catalog that DOES have a real year - a bare title search for
 * these has no year to disambiguate a remake/re-release from the original,
 * and TMDB's own popularity-first result ordering means the better-known
 * original wins every time. Found live: a null-year "American Psycho" row
 * (the undated 2026 remake) was auto-assigned the 2000 classic's exact
 * poster this way, since both are genuine exact-title matches and only the
 * year would have told them apart. Reuses groupSupabaseFilmDuplicates'
 * existing null-year-as-wildcard grouping rather than re-deriving the same
 * fuzzy match from scratch - any group it produces that mixes a null-year
 * row with a real-year row is exactly this ambiguous case.
 * A film that already carries a tmdb_id is excluded even if its year is
 * still null - once an id is confirmed (typically via the manual-match
 * override this flag exists to justify), there is no more title-search
 * ambiguity left to guard against, even when the confirmed TMDB entry
 * itself has no release date of its own to copy back (a genuinely
 * "Rumored"/unreleased title, found live: TMDB id 1249693, the very
 * American Psycho remake this whole feature was built for, has
 * `release_date: ''`). Without this, a film could never leave this list
 * even after a correct, deliberate manual match - the exact bug reported
 * live: an owner assigned that id, the poster/tmdb_id wrote through fine,
 * but the film stayed stuck under "Ambiguous" forever since its year was
 * still null.
 * @param {{id: string, tmdb_id: number|null, title: string, year: number|null}[]} films
 * @returns {Set<string>} Ids of films that should be excluded from automatic search-based lookup.
 */
window.findAmbiguousNullYearFilms = function (films) {
  let ids = new Set();
  window.groupSupabaseFilmDuplicates(films).forEach((group) => {
    if (!group.rows.some((film) => film.year != null)) return;
    group.rows.forEach((film) => {
      if (film.year == null && !film.tmdb_id) ids.add(film.id);
    });
  });
  return ids;
};

/**
 * Looks up an EXACT, owner-confirmed TMDB reference - movie, whole TV
 * series, one season, or one episode - with no search, no scoring, no
 * isExactTitleMatch verification, since a human has already confirmed the
 * match themselves (the intended use is exactly the ambiguous null-year
 * case findAmbiguousNullYearFilms flags, where automatic search can't
 * safely tell a remake from the original - or a title TMDB only lists as
 * TV content, which automatic search can find but never treats as
 * anything more than a poster - see lookupTmdbFilmMetadata).
 *
 * tmdbId comes back null for a TV reference: films.tmdb_id is a plain
 * integer column that only ever means a linked MOVIE id (see the
 * reference-notation comment atop image-providers.js), so a TV match
 * leaves it honestly unset rather than writing a value nothing downstream
 * can safely interpret as a movie id.
 * @param {{mediaType: "movie"|"tv", id: string, season: number|null, episode: number|null}} reference
 * @param {Function} fetchFn
 * @returns {Promise<{poster: PosterRecord|null, year: number|null, country: string|null, primaryCountry: string|null, runtimeMinutes: number|null, releaseYearOptions: string[], runtimeOptions: number[], tmdbId: string|null, title: string}|null>}
 */
window.lookupTmdbReferenceMatch = async function (reference, fetchFn) {
  if (reference.mediaType === "tv") {
    let details = await window.lookupTmdbMovieDetails(
      `TV:${reference.id}${reference.season !== null ? `/S${reference.season}${reference.episode !== null ? `E${reference.episode}` : ""}` : ""}`,
      fetchFn,
    );
    if (!details?.id) return null;
    let posterPath = details.poster_path || details.still_path || null;
    let { country, primaryCountry, runtimeMinutes } =
      await window.lookupTmdbTvMetadataFields(reference, fetchFn);
    return {
      poster: posterPath
        ? window.normalizePosterRecord({
            url: `https://image.tmdb.org/t/p/w500${posterPath}`,
            source: "tmdb",
            sourceUrl: `https://www.themoviedb.org/${window.tmdbResourcePath(reference)}`,
            providerId: `TV:${reference.id}${reference.season !== null ? `/S${reference.season}${reference.episode !== null ? `E${reference.episode}` : ""}` : ""}`,
          })
        : null,
      year: null,
      country,
      primaryCountry,
      runtimeMinutes,
      tmdbId: null,
      title: details.name || details.title || "",
    };
  }
  let details = await window.lookupTmdbMovieDetails(reference.id, fetchFn);
  if (!details?.id) return null;
  let countries = (details.production_countries || [])
    .map((country) => String(country.name || "").trim())
    .filter(Boolean);
  let year = details.release_date
    ? Number(String(details.release_date).slice(0, 4))
    : null;
  return {
    poster: details.poster_path
      ? window.normalizePosterRecord({
          url: `https://image.tmdb.org/t/p/w500${details.poster_path}`,
          source: "tmdb",
          sourceUrl: `https://www.themoviedb.org/movie/${details.id}`,
          providerId: String(details.id),
        })
      : null,
    year: Number.isFinite(year) ? year : null,
    country: countries.join(", ") || null,
    primaryCountry: countries[0] || null,
    runtimeMinutes:
      Number(details.runtime) > 0 ? Number(details.runtime) : null,
    // Every OTHER legitimate release year/runtime TMDB lists (regional
    // release dates, translated-cut runtimes) - lets a caller that force-
    // corrects a film's data (applyConfirmedTmdbMatch,
    // src/pages/data-tools.js) tell "the existing value is a different
    // but still genuinely valid one" from "the existing value is just
    // wrong", rather than always overwriting with only this single
    // "primary" pick.
    releaseYearOptions: window.tmdbReleaseYearOptions(details),
    runtimeOptions: window.tmdbRuntimeOptions(details),
    tmdbId: String(details.id),
    title: details.title || details.original_title || "",
  };
};

/**
 * Parses an owner-pasted TMDB reference: a bare numeric id (assumed to be
 * a movie, TMDB's overwhelmingly common case) or a themoviedb.org URL for
 * a movie, TV show, TV season, or TV episode.
 * @param {string} input
 * @returns {{mediaType: "movie"|"tv", id: string, season: number|null, episode: number|null}|null}
 */
window.parseTmdbReferenceInput = function (input) {
  let trimmed = String(input || "").trim();
  if (/^\d+$/.test(trimmed))
    return { mediaType: "movie", id: trimmed, season: null, episode: null };
  let movieMatch = trimmed.match(/themoviedb\.org\/movie\/(\d+)/);
  if (movieMatch)
    return {
      mediaType: "movie",
      id: movieMatch[1],
      season: null,
      episode: null,
    };
  // [^/]* skips the descriptive slug TMDB's real URLs carry right after
  // the show id (e.g. "tv/1396-breaking-bad/season/1") - without it,
  // "/season/" would need to immediately follow the digits, which never
  // happens once a slug is present (found live: broke every real pasted
  // season/episode URL, only ever matching a bare-id show URL).
  let tvMatch = trimmed.match(
    /themoviedb\.org\/tv\/(\d+)[^/]*(?:\/season\/(\d+)(?:\/episode\/(\d+))?)?/,
  );
  if (!tvMatch) return null;
  return {
    mediaType: "tv",
    id: tvMatch[1],
    season: tvMatch[2] !== undefined ? Number(tvMatch[2]) : null,
    episode: tvMatch[3] !== undefined ? Number(tvMatch[3]) : null,
  };
};

/** Reads a consistent TMDB person identity from stored portrait provenance. @param {Object} person Shared person row. @returns {number|null} Recorded TMDB person id. */
window.personPortraitTmdbIdentity = function (person) {
  if (person.portrait_source !== "tmdb") return null;
  let provider = String(person.portrait_provider_id || "");
  let source = String(person.portrait_source_url || "");
  let sourceId = source.match(
    /^https:\/\/www\.themoviedb\.org\/person\/([0-9]{1,10})(?:[^0-9]|$)/,
  )?.[1];
  if ((provider && !/^[0-9]{1,10}$/.test(provider)) || (source && !sourceId))
    return null;
  if (provider && sourceId && Number(provider) !== Number(sourceId))
    return null;
  let id = Number(provider || sourceId);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};

/** Finds unlinked people with unambiguous stored TMDB evidence, excluding dismissed pairs. @param {Object[]} people Shared person rows. @param {Set<string>} [dismissed] Dismissed duplicate pair keys. @returns {Object[]} Person and resolved TMDB identity pairs. */
window.personIdentityRepairCandidates = function (
  people,
  dismissed = new Set(),
) {
  let nameKey = (name) =>
    String(name || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  let asset = (url) =>
    String(url || "").match(
      /^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+\/([^/?#]+)/,
    )?.[1] || "";
  let byId = new Map();
  let byPortrait = new Map();
  for (let person of people || []) {
    if (!person.tmdb_id) continue;
    byId.set(Number(person.tmdb_id), person);
    if (!asset(person.portrait_url)) continue;
    let key = `${nameKey(person.name)}::${asset(person.portrait_url)}`;
    if (!byPortrait.has(key)) byPortrait.set(key, []);
    byPortrait.get(key).push(person);
  }
  let result = [];
  for (let person of people || []) {
    if (person.tmdb_id || !asset(person.portrait_url)) continue;
    let tmdbId = window.personPortraitTmdbIdentity(person);
    if (
      !tmdbId &&
      person.portrait_provider_id == null &&
      person.portrait_source_url == null
    ) {
      let matches =
        byPortrait.get(
          `${nameKey(person.name)}::${asset(person.portrait_url)}`,
        ) || [];
      if (matches.length === 1) tmdbId = Number(matches[0].tmdb_id);
    }
    if (!tmdbId) continue;
    let keeper = byId.get(tmdbId);
    if (
      keeper &&
      (nameKey(keeper.name) !== nameKey(person.name) ||
        dismissed.has(window.duplicatePairKey(keeper.id, person.id)))
    )
      continue;
    result.push({ person, tmdbId });
  }
  return result;
};
