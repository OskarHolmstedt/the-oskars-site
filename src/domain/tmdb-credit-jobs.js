/**
 * @file Maps annual award categories with a single-recipient credit field
 * (director, cinematographer, composer, ...) to the real TMDB crew `job`
 * strings that identify that person, so a nomination with no known local
 * credit (nobody has nominated this film for this category before, and
 * the Google Sheets import never carried anything but the director) can
 * still auto-suggest the right person - reusing the film's already-
 * fetched-elsewhere TMDB credits (window.lookupTmdbMovieDetails already
 * requests append_to_response=credits for every metadata lookup) rather
 * than a second, separate crew endpoint.
 *
 * Deliberately excludes:
 * - Best Picture, Best International Picture, Best Animated Picture,
 *   Best Casting, Best Production Design - no profession/role mapping
 *   exists for these at all yet (window.PERSON_AWARD_PROFESSIONS), so
 *   they're out of scope here too, matching the user's own framing
 *   ("this would only apply to films with a recipient field").
 * - The four acting categories - TMDB's cast list has no signal for
 *   "lead" vs "supporting" or which specific actor a nomination means;
 *   see the separate billing-sorted cast list feature instead of a
 *   single auto-suggestion.
 * - Best Song - the recipient is a songwriter, but a film can carry
 *   multiple original songs by different writers with no per-song
 *   attribution available from a film-level TMDB crew list, so a single
 *   suggestion here could as easily be wrong as right.
 *
 * Real TMDB job strings confirmed live via the app's own TMDB proxy
 * (Dark Knight, Dune, Frozen, Guardians of the Galaxy) rather than
 * TMDB's docs alone, since the docs don't enumerate every job string in
 * use.
 */

/** Category -> {role, tmdbJobs}. `role` is the credits.role value this
 * category's fetched/confirmed people are stored under - shared across
 * Best Original Screenplay/Best Adapted Screenplay (both are just "the
 * screenwriter(s)", never both at once for one real film). */
window.AWARD_CATEGORY_CREDIT_JOBS = {
  "Best Director": { role: "director", tmdbJobs: ["Director"] },
  "Best Cinematography": {
    role: "cinematographer",
    tmdbJobs: ["Director of Photography"],
  },
  "Best Score": { role: "composer", tmdbJobs: ["Original Music Composer"] },
  "Best Editing": { role: "editor", tmdbJobs: ["Editor"] },
  "Best Original Screenplay": {
    role: "screenwriter",
    tmdbJobs: ["Screenplay", "Writer"],
  },
  "Best Adapted Screenplay": {
    role: "screenwriter",
    tmdbJobs: ["Screenplay", "Writer"],
  },
  "Best Costume Design": {
    role: "costume-designer",
    tmdbJobs: ["Costume Design"],
  },
  "Best Visual Effects": {
    role: "visual-effects-supervisor",
    tmdbJobs: ["Visual Effects Supervisor"],
  },
};

/** Returns a category's credit role/job mapping, or null when this category has no auto-fetchable single-recipient credit. @param {string} category Award category. @returns {{role: string, tmdbJobs: string[]}|null} Mapping. */
window.awardCategoryCreditJob = function (category) {
  return window.AWARD_CATEGORY_CREDIT_JOBS[category] || null;
};

/**
 * Extracts a category's matching crew from an already-fetched TMDB movie
 * details response (details.credits.crew), preserving TMDB's own crew
 * order (stable, not re-sorted - unlike cast, TMDB gives no explicit
 * billing field for crew).
 * @param {Object} details TMDB movie details (from lookupTmdbMovieDetails).
 * @param {string} category Award category.
 * @returns {{tmdbId: number, name: string, profilePath: string|null}[]} Matching crew, deduplicated by person.
 */
window.tmdbCrewCreditCandidates = function (details, category) {
  let mapping = window.awardCategoryCreditJob(category);
  if (!mapping) return [];
  let jobs = new Set(mapping.tmdbJobs);
  let crew = details?.credits?.crew || [];
  let seen = new Set();
  return crew
    .filter((member) => jobs.has(member.job))
    .filter((member) => {
      if (!member.id || seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    })
    .map((member) => ({
      tmdbId: Number(member.id),
      name: String(member.name || "").trim(),
      profilePath: member.profile_path || null,
    }))
    .filter((member) => member.tmdbId && member.name);
};

/**
 * Fetches one film's TMDB crew credit for a category, on demand - the
 * "point of nomination" fetch: only called for a film/category pair with
 * no already-known credit (see window.loadSupabaseAwardCandidateCredits),
 * never pre-fetched for every candidate film up front. Reuses
 * window.lookupTmdbMovieDetails (src/domain/image-providers.js), which
 * already requests append_to_response=credits for every metadata lookup
 * elsewhere in the app - no new TMDB endpoint, no extra request shape.
 * Returns null (not throwing) on a missing tmdb_id, no mapping for this
 * category, or any fetch failure - an auto-suggestion is a nice-to-have,
 * never something that should block or error out the nomination form.
 * @param {{tmdb_id: number|string|null}} film Film row (needs tmdb_id).
 * @param {string} category Award category.
 * @returns {Promise<{role: string, people: {tmdbId: number, name: string, profilePath: string|null}[]}|null>}
 */
window.fetchTmdbCategoryCredit = async function (film, category) {
  let mapping = window.awardCategoryCreditJob(category);
  if (!mapping || !film?.tmdb_id) return null;
  try {
    let details = await window.lookupTmdbMovieDetails(
      film.tmdb_id,
      window.fetch.bind(window),
    );
    let people = window.tmdbCrewCreditCandidates(details, category);
    if (!people.length) return null;
    return { role: mapping.role, people };
  } catch {
    return null;
  }
};

/**
 * Extracts a film's full billing-sorted cast from an already-fetched
 * TMDB movie details response. Unlike crew, TMDB cast entries carry an
 * explicit `order` field (billing order) - confirmed live via the app's
 * own TMDB proxy that the array already arrives sorted ascending by it,
 * but re-sorted defensively here anyway rather than trusting an external
 * API's array order to hold forever.
 *
 * There is deliberately no single-name auto-suggestion for the acting
 * categories the way there is for director/cinematographer/etc: TMDB's
 * cast list has no signal for "lead" vs "supporting", or which of
 * several credited actors a real nomination means - seeing the whole
 * billing-ordered list and picking is the honest alternative (see
 * window.isMultiNomineeCategory / creditSubjectType "role"). `gender`
 * (TMDB's own self-reported field: 0 not set, 1 female, 2 male, 3
 * non-binary) rides along unfiltered here - it's only ever used to narrow
 * which cast members are shown by default for a gendered Actor/Actress
 * category (window.ACTOR_CATEGORY_GENDER, src/domain/people/index.js),
 * never to exclude anyone outright.
 * @param {Object} details TMDB movie details (from lookupTmdbMovieDetails).
 * @returns {{tmdbId: number, name: string, character: string, order: number, profilePath: string|null, gender: number}[]}
 */
window.tmdbCastCandidates = function (details) {
  let cast = details?.credits?.cast || [];
  let seen = new Set();
  return cast
    .filter((member) => {
      if (!member.id || seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    })
    .map((member) => ({
      tmdbId: Number(member.id),
      name: String(member.name || "").trim(),
      character: String(member.character || "").trim(),
      order: Number.isFinite(member.order) ? member.order : Number.MAX_SAFE_INTEGER,
      profilePath: member.profile_path || null,
      gender: Number.isFinite(member.gender) ? member.gender : 0,
    }))
    .filter((member) => member.tmdbId && member.name)
    .sort((left, right) => left.order - right.order);
};

/**
 * Fetches one film's full TMDB cast, on demand - the acting-category
 * equivalent of fetchTmdbCategoryCredit, called only once a Lead/
 * Supporting Actor/Actress nomination form is actually open for this
 * film (never prefetched for the whole pool). Returns [] (not throwing)
 * on a missing tmdb_id or any fetch failure.
 * @param {{tmdb_id: number|string|null}} film Film row (needs tmdb_id).
 * @returns {Promise<{tmdbId: number, name: string, character: string, order: number, profilePath: string|null}[]>}
 */
window.fetchTmdbFilmCast = async function (film) {
  if (!film?.tmdb_id) return [];
  try {
    let details = await window.lookupTmdbMovieDetails(
      film.tmdb_id,
      window.fetch.bind(window),
    );
    return window.tmdbCastCandidates(details);
  } catch {
    return [];
  }
};
