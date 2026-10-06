/**
 * @file Rate watched: the owner's queue of watched films without a personal
 * rating, grouped by release year, director or franchise. The shared queue
 * controller (src/ui/supabase-queue-page.js) owns loading, grouping and
 * navigation; this supplies the compact rating input and saves each rating
 * straight to Supabase with setSupabaseWatchedRating().
 */

window.mountSupabaseQueuePage({
  container: document.getElementById("rateWatchedPage"),
  page: "rate-watched.html",
  part: "watched",
  timer: "rateWatched:render",
  title: "Rate watched",
  intro:
    "Give unrated watched films a rating, one release year, director or franchise at a time.",
  words: {
    open: "unrated",
    done: "rated",
    doneHeading: "Rated",
    nothing: "Nothing to rate",
    allDone: "Everything watched is rated.",
    noRows: "No watched films found for this account.",
    loadError: "Could not load your watched films",
  },
  isDone: (row) => Boolean(row.rating),
  // Exact 1-30 grade (rating expanded by its minus/plus refinement) - the
  // same scale Intake's rating shelves sort by.
  doneScore: (row) => window.supabaseIntakeRatingGrade?.(row) || 0,
  renderInput: (row) =>
    window.renderRatingInput({
      name: "rating",
      id: `rate-${row.id}`,
      required: true,
      compact: true,
    }),
  renderDoneValue: (row) =>
    window.renderFilmRating?.({
      ratingValue: row.rating,
      ratingModifier: row.rating_modifier,
    }) || "",
  enhance: (container) => window.enhanceRatingInputs?.(container),
  readInput: (form) => {
    let parsed = window.parseFilmRating(new FormData(form).get("rating"));
    if (!parsed.value) throw new Error("Choose a rating before saving.");
    return parsed;
  },
  save: (rowId, rating) =>
    window.setSupabaseWatchedRating(rowId, rating.value, rating.modifier),
});
