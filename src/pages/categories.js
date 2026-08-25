/** @file Renders the category index as a canonical poster-card gallery with winner context. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();

  function categoryPosterFilms(category) {
    let candidates = new Map();
    Object.values(state.filmsById || {}).forEach((film) => {
      (film.awards || []).forEach((award) => {
        if (award.category !== category) return;
        let candidate = candidates.get(film.id) || {
          film,
          winner: false,
          latestYear: 0,
        };
        candidate.winner ||= Number(award.placement) === 1;
        if (/^\d{4}$/.test(String(award.year || "")))
          candidate.latestYear = Math.max(
            candidate.latestYear,
            Number(award.year),
          );
        candidates.set(film.id, candidate);
      });
    });
    return [...candidates.values()]
      .sort(
        (left, right) =>
          Number(Boolean(window.normalizePosterRecord?.(right.film.poster))) -
            Number(Boolean(window.normalizePosterRecord?.(left.film.poster))) ||
          Number(right.winner) - Number(left.winner) ||
          right.latestYear - left.latestYear ||
          Number(left.film.allTimeRank || Number.MAX_SAFE_INTEGER) -
            Number(right.film.allTimeRank || Number.MAX_SAFE_INTEGER) ||
          String(left.film.title || "").localeCompare(
            String(right.film.title || ""),
          ),
      )
      .map((candidate) => candidate.film)
      .slice(0, 5);
  }

  function render() {
    let finishRenderTimer =
      window.startOskarsPerformance?.("categories:render");
    document.title = `${ui("Categories")} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Categories"))}</h1><p>${escape(ui("Browse every award category across years, decades, centuries, and all-time."))}</p>`,
    });
    document.getElementById("categoriesPage").innerHTML =
      `${header}<section class="category-index-section category-gallery-section" aria-labelledby="categoryIndexHeading"><div class="section-heading"><div><span class="eyebrow">${escape(ui("The award board"))}</span><h2 id="categoryIndexHeading">${escape(ui("Choose a category"))}</h2></div><p>${escape(ui("Browse the winners that have shaped each category, then open its complete history."))}</p></div>${window.renderCategoryIndexBoard({ visual: true, posterFilmsForCategory: categoryPosterFilms })}</section>`;
    finishRenderTimer?.();
  }

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
