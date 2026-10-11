/** @file Builds the year-oriented queue of unrated watched records. */

(function () {
  function watchedFilmsForRating() {
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
  }

  /** Groups unrated watched records by release year. @returns {Map<string, FilmRecord[]>} Year queues in chronological film order. */
  window.unratedWatchedFilmsByYear = function () {
    let grouped = new Map();
    watchedFilmsForRating()
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
})();
