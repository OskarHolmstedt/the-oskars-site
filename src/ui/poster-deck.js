/** @file Renders the reusable layered poster deck used by creative journey surfaces. */

(function () {
  /** Renders up to five films as a compact layered deck. @param {(FilmRecord|SupabaseFilmRow)[]} films Poster source films. @param {{classes?: string, limit?: number, priority?: string, hero?: boolean}} [options] Presentation options. @returns {string} Poster deck HTML. */
  window.renderPosterDeck = function (films, options = {}) {
    let escape = window.pageEscape || ((value) => String(value ?? ""));
    let limit = Number.isFinite(Number(options.limit))
      ? Number(options.limit)
      : 5;
    let isPriority = options.priority === "high" || options.hero;
    let cards = (films || []).slice(0, limit).map((film, index) => {
      let poster =
        window.normalizePosterRecord?.(film.poster) ||
        (film.poster_url ? { url: film.poster_url } : null);
      let title = window.localizedFilmTitle?.(film) || film.title || "?";
      let imgAttrs =
        isPriority && index === 0
          ? 'fetchpriority="high" decoding="async"'
          : 'loading="lazy" decoding="async"';
      let media = poster
        ? `<img src="${escape(poster.url)}" alt="" ${imgAttrs}>`
        : `<span>${escape(String(title).slice(0, 1).toUpperCase())}</span>`;
      return `<span class="poster-deck-card${poster ? "" : " is-placeholder"}" style="--deck-index:${index}" aria-hidden="true">${media}</span>`;
    });
    return `<div class="poster-deck ${escape(options.classes || "")}">${cards.join("")}</div>`;
  };
})();
