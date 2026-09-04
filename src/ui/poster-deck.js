/** @file Renders the reusable layered poster deck used by creative journey surfaces. */

(function () {
  /** Renders up to five films as a compact layered deck. @param {(FilmRecord|SupabaseFilmRow)[]} films Poster source films. @param {{classes?: string, limit?: number}} [options] Presentation options. @returns {string} Poster deck HTML. */
  window.renderPosterDeck = function (films, options = {}) {
    let escape = window.pageEscape || ((value) => String(value ?? ""));
    let limit = Number(options.limit) || 5;
    let cards = (films || []).slice(0, limit).map((film, index) => {
      let poster =
        window.normalizePosterRecord?.(film.poster) ||
        (film.poster_url ? { url: film.poster_url } : null);
      let title = window.localizedFilmTitle?.(film) || film.title || "?";
      let media = poster
        ? `<img src="${escape(poster.url)}" alt="" loading="lazy" decoding="async">`
        : `<span>${escape(String(title).slice(0, 1).toUpperCase())}</span>`;
      return `<span class="poster-deck-card${poster ? "" : " is-placeholder"}" style="--deck-index:${index}" aria-hidden="true">${media}</span>`;
    });
    return `<div class="poster-deck ${escape(options.classes || "")}">${cards.join("")}</div>`;
  };
})();
