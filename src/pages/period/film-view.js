/** @file Renders period film cards, award context, ranking-edit attributes, and pagination. */

/**
 * Renders period film cards with rank, awards, statistics, and edit attributes.
 * @param {Object} options Films and page-supplied period rendering callbacks.
 * @returns {string}
 */
window.renderPeriodFilmGrid = function (options) {
  let {
    films,
    type,
    key,
    rankForFilm,
    awardInPeriod,
    filmDirector,
    renderFilmStats,
    shortenCredit,
    escape,
    rankingEditMode = false,
    canonicalRankContextHtml = () => "",
    showRewatchTier = false,
    showAwards = true,
  } = options;
  return (
    films
      .map((film, index) => {
        let rank = rankForFilm(film);
        let canonicalContext = canonicalRankContextHtml(film, escape);
        let director = filmDirector(film);
        // Hidden entirely rather than just visually collapsed (issue #222),
        // so cards with and without awards render at the same uniform height.
        let awardCards = !showAwards
          ? ""
          : (film.awards || [])
              .filter(awardInPeriod)
              .sort(
                (left, right) =>
                  categorySortIndex(left.category) -
                    categorySortIndex(right.category) ||
                  left.placement - right.placement,
              )
              .map((award) => {
                let credit = window.renderPeriodAwardCredit(
                  { film, award },
                  award.category,
                  escape,
                );
                return `<div class="card"><span class="award-placement ${placementEmoji[award.placement] ? "medal" : "numeric"}">${escape(placementEmoji[award.placement] || award.placement || "")}</span><span class="separator">&nbsp;</span><a class="category-link" href="${escape(window.categoryPageUrl(award.category))}">${escape(award.category)}</a>${credit ? `<span class="separator"> — </span>${credit}` : ""}</div>`;
              })
              .join("");
        return window.renderSharedFilmCard(film, {
          classes: rankingEditMode ? ["ranking-edit-card"] : [],
          attributes: rankingEditMode
            ? {
                draggable: "true",
                "data-drag-type": "ranking",
                "data-ranking-film-id": film.id,
                "data-ranking-index": index,
                "data-ranking-rank": rank || "",
              }
            : {},
          openFilm: !rankingEditMode,
          titleHtml: rankingEditMode
            ? `<span class="table-film-link">${escape(film.title)}</span>`
            : undefined,
          rankLabel:
            rank && film.rankConfirmed !== false
              ? `${rank}.`
              : canonicalContext
                ? ""
                : type === "year"
                  ? "NR"
                  : "",
          showYear: type !== "year" && /^\d{4}$/.test(String(film.year || "")),
          director: director ? shortenCredit(director) : "",
          directorTitle: director,
          directorPrefix: "by ",
          escape,
          bodyHtml: `${showRewatchTier ? window.renderWatchlistTierBadge(film.rewatchTier, { escape }) : ""}${renderFilmStats(getFilmStats(film, key))}${canonicalContext}${awardCards}`,
        });
      })
      .join("") || "<p>No films</p>"
  );
};

/**
 * Renders period-film pagination controls.
 * @param {Object} options Total, page, and page-size values.
 * @returns {string}
 */
window.renderFilmPagination = function (options) {
  return window.renderPaginationControls({
    total: options.total,
    page: options.page,
    pageSize: options.pageSize || 100,
    dataAttribute: "data-film-page",
    itemLabel: window.uiText?.("films") || "films",
    ariaLabel: window.uiText?.("Film pages") || "Film pages",
  });
};
