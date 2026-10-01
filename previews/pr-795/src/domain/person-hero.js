/**
 * @file Builds the person-detail hero's personal-relationship signal and
 * signature-works selection (issue #204) - pure functions over the same
 * film/award records person.js already collects, so they're Node-testable
 * without window.state or the DOM.
 */

/**
 * Signature works: this person's own watched films, best-of-archive first
 * (their existing all-time rank, then rating, then title for determinism)
 * rather than chronological - the "why this person matters" films, not an
 * exhaustive list. Returns the same film records the caller passed in, just
 * reordered and truncated; never mutates them.
 * @param {FilmRecord[]} films Watched films this person is credited on.
 * @param {number} [limit] Maximum films to return.
 * @returns {FilmRecord[]} Up to `limit` signature films, best first.
 */
window.personSignatureFilms = function (films, limit = 5) {
  return [...(films || [])]
    .sort(
      (left, right) =>
        (Number(left.allTimeRank) || Infinity) -
          (Number(right.allTimeRank) || Infinity) ||
        (Number(right.ratingValue) || 0) - (Number(left.ratingValue) || 0) ||
        window.compareEnglishTitles(left.title, right.title),
    )
    .slice(0, limit);
};

// Every name credited on a film besides the film's own director field
// (i.e. every award-recognized recipient) plus the director field itself -
// the full set of "who else worked on this, as far as this archive tracks
// credits" (issue #406's field audit: there's no separate full cast/crew
// table, only award-category credits, so this is deliberately bounded by
// what's actually recorded, not a claim of the film's real full credits).
function personHeroFilmCreditNames(film) {
  let names = [...(film?.directors || [])];
  (film?.awards || []).forEach((award) =>
    window
      .awardRecipients(award)
      .forEach((recipient) => names.push(recipient.name)),
  );
  return names;
}

/**
 * The person this archive has most often credited alongside the given
 * person, across their watched films - a real, sourced relationship signal
 * bounded by this archive's own award-credit data (never a claim about a
 * full real-world filmography or a fetched biography, matching #204's
 * explicit non-goals). Requires at least two shared films to be meaningful;
 * a single shared credit is too common to call out.
 * @param {PersonRecord} person The person whose collaborator to find.
 * @param {FilmRecord[]} films This person's own watched films.
 * @returns {{id: string, name: string, filmTitles: string[]}|null} The most frequent collaborator, or null.
 */
window.personFrequentCollaborator = function (person, films) {
  let byId = new Map();
  (films || []).forEach((film) => {
    let seenInFilm = new Set();
    personHeroFilmCreditNames(film).forEach((name) => {
      let id = window.normalizePersonName(name);
      if (!id || id === person?.id || seenInFilm.has(id)) return;
      seenInFilm.add(id);
      let entry = byId.get(id) || { id, name, filmTitles: [] };
      entry.filmTitles.push(film.title);
      byId.set(id, entry);
    });
  });
  let ranked = [...byId.values()]
    .filter((entry) => entry.filmTitles.length >= 2)
    .sort(
      (left, right) =>
        right.filmTitles.length - left.filmTitles.length ||
        window.compareEnglishTitles(left.name, right.name),
    );
  return ranked[0] || null;
};

/**
 * The single personal-relationship line for the hero: the frequent
 * collaborator when one exists, otherwise a fallback grounded in what the
 * viewer has actually done (rated, completed) rather than a generic
 * biography fact - deliberately null for a genuinely sparse person (a
 * single watched film with no repeat collaborator and no notable rating
 * signal), matching #204's stopping rule against inventing a relationship
 * that isn't there.
 * @param {PersonRecord} person The person.
 * @param {FilmRecord[]} films This person's own watched films.
 * @param {{ratedCount: number, mean: number}} ratingStatistics Their films' rating statistics.
 * @param {{watchedCount: number, watchlistCount: number}|null} completion Director completion, when applicable.
 * @returns {{text: string, collaboratorId?: string}|null} The relationship signal, or null.
 */
window.personRelationshipSignal = function (
  person,
  films,
  ratingStatistics,
  completion,
) {
  let collaborator = window.personFrequentCollaborator(person, films);
  if (collaborator)
    return {
      text: `Often credited with ${collaborator.name} — ${collaborator.filmTitles.length} films together in your archive.`,
      collaboratorId: collaborator.id,
    };
  if (
    completion &&
    completion.watchedCount > 0 &&
    completion.watchlistCount === 0
  )
    return {
      text: `You've watched every one of their ${completion.watchedCount} films in your archive.`,
    };
  if (ratingStatistics?.ratedCount >= 2 && ratingStatistics.mean >= 4)
    return {
      text: `You've rated their work ${window.formatAverageRating?.(ratingStatistics.mean) ?? ratingStatistics.mean} on average across ${ratingStatistics.ratedCount} films.`,
    };
  return null;
};
