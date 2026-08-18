/** @file Builds and updates the year-oriented queue of unrated watched records. */

(function () {
  /** Lists every unique watched record with a concrete release year. @returns {FilmRecord[]} Watched records. */
  window.watchedFilmsForRating = function () {
    let films = new Map();
    Object.values(state.filmsById || {}).forEach((film) => {
      if (film?.id && /^\d{4}$/.test(String(film.year || "")))
        films.set(film.id, film);
    });
    (state.watchedOther || []).forEach((film) => {
      if (film?.id && /^\d{4}$/.test(String(film.year || "")))
        films.set(film.id, film);
    });
    return [...films.values()];
  };

  /** Groups unrated watched records by release year. @returns {Map<string, FilmRecord[]>} Year queues in chronological film order. */
  window.unratedWatchedFilmsByYear = function () {
    let grouped = new Map();
    window.watchedFilmsForRating()
      .filter((film) => !window.filmRatingGrade?.(film))
      .sort(
        (left, right) =>
          Number(left.year) - Number(right.year) ||
          window.compareEnglishTitles(left.title, right.title),
      )
      .forEach((film) => {
        let year = String(film.year);
        let films = grouped.get(year) || [];
        films.push(film);
        grouped.set(year, films);
      });
    return grouped;
  };

  /** Applies one exact rating through the shared film metadata mutation. @param {string} filmId Watched record id. @param {string} rating Exact rating text. @param {Object} [options] Save controls. @returns {FilmRecord|null} Updated record. */
  window.setWatchedFilmRating = function (filmId, rating, options = {}) {
    let film =
      window.findFilmById?.(filmId) || window.findWatchedFilmById?.(filmId);
    let parsed = window.parseFilmRating?.(rating) || { value: 0 };
    if (!film) throw new Error("Watched film not found.");
    if (!parsed.value) throw new Error("Choose a rating before saving.");
    let updated = window.updateFilmMetadata(
      film.id,
      Object.assign(window.filmMetadataFormValues(film), {
        rating: window.renderFilmRating({
          ratingValue: parsed.value,
          ratingModifier: parsed.modifier,
        }),
      }),
    );
    if (options.save !== false) window.save?.({ immediate: true });
    return updated;
  };

  /** Restores a prior rating, including the unrated state used by session undo. @param {string} filmId Watched record id. @param {string} rating Prior exact rating or empty text. @param {Object} [options] Save controls. @returns {FilmRecord|null} Updated record. */
  window.restoreWatchedFilmRating = function (filmId, rating, options = {}) {
    let film =
      window.findFilmById?.(filmId) || window.findWatchedFilmById?.(filmId);
    if (!film) throw new Error("Watched film not found.");
    let parsed = window.parseFilmRating?.(rating) || { value: 0 };
    let updated = window.updateFilmMetadata(
      film.id,
      Object.assign(window.filmMetadataFormValues(film), {
        rating: parsed.value
          ? window.renderFilmRating({
              ratingValue: parsed.value,
              ratingModifier: parsed.modifier,
            })
          : "",
      }),
    );
    if (options.save !== false) window.save?.({ immediate: true });
    return updated;
  };
})();
