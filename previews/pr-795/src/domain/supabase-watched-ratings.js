/**
 * @file Pure functions over getSupabaseWorkspace().watched (issue #414,
 * now backing the real rate-watched.html - issue #420) - the
 * Supabase-row-shaped counterpart to src/domain/watched-ratings.js's
 * FilmRecord-shaped logic. Deliberately doesn't reuse parseFilmRating()/
 * filmRatingGrade() to decide "is this rated" - those exist to parse the
 * old star-glyph text format (e.g. "★★★★—"); a Supabase watched row's
 * `rating` column is already a plain number (or null), so checking it
 * directly is simpler and doesn't route through text-parsing machinery
 * built for a different storage shape.
 *
 * No DOM, no Supabase SDK import - directly Node-testable, unlike
 * supabase-workspace.js itself (blocked by its CDN import()).
 */

/**
 * Every watched row with a concrete release year, from the session
 * workspace cache.
 * @returns {Object[]} Watched rows (each already joined with its film).
 */
window.watchedFilmsForSupabaseRating = function () {
  let workspace = window.getSupabaseWorkspace?.();
  return (workspace?.watched || []).filter((row) =>
    Number.isInteger(row.films?.year),
  );
};

/**
 * Groups unrated watched rows by release year.
 * @returns {Map<number, Object[]>} Year -> rows, each year's rows sorted by title.
 */
window.unratedSupabaseWatchedFilmsByYear = function () {
  let grouped = new Map();
  window
    .watchedFilmsForSupabaseRating()
    .filter((row) => !row.rating)
    .sort(
      (left, right) =>
        left.films.year - right.films.year ||
        String(left.films.title).localeCompare(String(right.films.title)),
    )
    .forEach((row) => {
      let year = row.films.year;
      let rows = grouped.get(year) || [];
      rows.push(row);
      grouped.set(year, rows);
    });
  return grouped;
};
