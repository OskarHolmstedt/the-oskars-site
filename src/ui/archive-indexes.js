/** @file Builds the shared period matrix and category board used by archive indexes and primary-navigation previews. */

(function () {
  function escapeHtml(value) {
    let escape = window.pageEscape || ((text) => String(text ?? ""));
    return escape(value);
  }

  function ui(text, values) {
    return (window.uiText || ((fallback) => fallback))(text, values);
  }

  function categorySummaries() {
    let summaries = new Map(
      (window.getOrderedCategories?.() || []).map((category) => [
        category,
        { nominations: 0, winners: 0, latestWinner: null, latestYear: 0 },
      ]),
    );
    Object.values(window.state?.filmsById || {}).forEach((film) => {
      (film.awards || []).forEach((award) => {
        let summary = summaries.get(award.category);
        if (!summary) return;
        summary.nominations += 1;
        if (Number(award.placement) !== 1) return;
        summary.winners += 1;
        let year = Number(award.year);
        let annual = /^\d{4}$/.test(String(award.year || ""));
        if (
          annual &&
          (year > summary.latestYear ||
            (year === summary.latestYear &&
              Number(film.allTimeRank || Number.MAX_SAFE_INTEGER) <
                Number(
                  summary.latestWinner?.allTimeRank || Number.MAX_SAFE_INTEGER,
                )))
        ) {
          summary.latestWinner = film;
          summary.latestYear = year;
        }
      });
    });
    return summaries;
  }

  function categoryCard(category, summary, options) {
    if (!category)
      return '<div class="category-board-spacer" aria-hidden="true"></div>';
    let escape = escapeHtml;
    let name = window.localizedCategoryName?.(category) || category;
    let href = window.categoryPageUrl(category);
    let fullWidth = category === "Best Picture";
    if (options.compact) {
      return `<a class="category-preview-link${fullWidth ? " full-width" : ""}" href="${escape(href)}"><span>${escape(name)}</span><small>${escape(ui("{count} winners", { count: summary.winners }))}</small></a>`;
    }
    let latest = summary.latestWinner;
    let latestHtml = latest
      ? `<p>${escape(ui("Latest winner"))}: <a href="${escape(window.filmPageUrl(latest.id))}">${escape(window.localizedFilmTitle?.(latest) || latest.title || "?")}</a> <span>(${escape(summary.latestYear)})</span></p>`
      : `<p>${escape(ui("No winner selected yet"))}</p>`;
    if (options.visual) {
      let films = options.posterFilmsForCategory?.(category) || [];
      let deck = window.renderPosterDeck?.(films, {
        classes: `category-gallery-poster-deck${fullWidth ? " poster-deck--featured" : ""}`,
      });
      let visualLatestHtml = latest
        ? `<p>${escape(ui("Latest winner"))}: <strong>${escape(window.localizedFilmTitle?.(latest) || latest.title || "?")}</strong> <span>(${escape(summary.latestYear)})</span></p>`
        : `<p>${escape(ui("No winner selected yet"))}</p>`;
      return `<article class="category-gallery-card${fullWidth ? " full-width" : ""}"><a class="category-gallery-card-link" href="${escape(href)}">${deck || ""}<div class="category-gallery-card-body"><span class="eyebrow">${escape(ui("Award category"))}</span><h2>${escape(name)}</h2><div class="category-index-totals"><span><b>${summary.nominations}</b> ${escape(ui("nominations"))}</span><span><b>${summary.winners}</b> ${escape(ui("winners"))}</span></div>${visualLatestHtml}<span class="category-gallery-card-action">${escape(ui("Open category"))} →</span></div></a></article>`;
    }
    return `<article class="browse-index-card category-index-card${fullWidth ? " full-width" : ""}"><h2><a href="${escape(href)}">${escape(name)}</a></h2><div class="category-index-totals"><span><b>${summary.nominations}</b> ${escape(ui("nominations"))}</span><span><b>${summary.winners}</b> ${escape(ui("winners"))}</span></div>${latestHtml}</article>`;
  }

  /** Returns populated annual period keys in chronological order. @returns {string[]} Year keys. */
  window.periodIndexYears = function () {
    let keys = new Set([
      ...Object.keys(window.state?.years || {}),
      ...Object.keys(window.state?.periods?.years || {}),
      ...(window.watchlistPeriodKeys?.("year") || []),
    ]);
    return [...keys]
      .filter((key) => /^\d{4}$/.test(key))
      .sort((left, right) => Number(left) - Number(right));
  };

  /** Returns the static decade range needed to contain the archive and current decade. @param {string[]} [years] Populated year keys. @returns {string[]} Decade keys. */
  window.periodIndexDecades = function (years = window.periodIndexYears()) {
    let currentYear = new Date().getFullYear();
    let currentDecade = Math.floor(currentYear / 10) * 10;
    let populatedDecades = years
      .map(Number)
      .filter((year) => Number.isFinite(year) && year > 0)
      .map((year) => Math.floor(year / 10) * 10);
    let firstDecade = Math.min(1900, ...populatedDecades);
    let finalDecade = Math.max(currentDecade, ...populatedDecades);
    let decades = [];
    for (let decade = firstDecade; decade <= finalDecade; decade += 10)
      decades.push(`${decade}s`);
    return decades;
  };

  /** Renders the exact year/decade/century navigation matrix. @param {{compact?: boolean}} [options] Presentation options. @returns {string} Matrix HTML. */
  window.renderPeriodIndexMatrix = function (options = {}) {
    let escape = escapeHtml;
    let years = window.periodIndexYears();
    let populatedYears = new Set(years);
    let decades = window.periodIndexDecades(years);
    let digitHeaders = Array.from(
      { length: 10 },
      (_, digit) => `<th scope="col">${digit}</th>`,
    ).join("");
    let previousCentury = "";
    let rows = decades
      .map((decade) => {
        let start = Number(decade.replace(/\D/g, ""));
        let century = `${Math.floor(start / 100) * 100}s`;
        let allTimeCell =
          previousCentury === ""
            ? `<th class="period-alltime-cell" scope="rowgroup"><a href="${escape(window.periodPageUrl("alltime", "alltime"))}">${escape(ui("All-time"))}</a></th>`
            : '<td class="period-alltime-gap" aria-hidden="true"></td>';
        let centuryCell =
          century !== previousCentury
            ? `<th class="period-century-cell" scope="rowgroup"><a href="${escape(window.periodPageUrl("century", century))}">${escape(century)}</a></th>`
            : '<td class="period-century-gap" aria-hidden="true"></td>';
        previousCentury = century;
        let yearCells = Array.from({ length: 10 }, (_, digit) => {
          let year = String(start + digit);
          return populatedYears.has(year)
            ? `<td><a href="${escape(window.periodPageUrl("year", year))}">${escape(year)}</a></td>`
            : `<td><span class="period-year-missing" title="${escape(ui("No films for {year}", { year }))}" aria-label="${escape(ui("{year}, no films", { year }))}">${escape(year)}</span></td>`;
        }).join("");
        return `<tr>${allTimeCell}${centuryCell}<th scope="row"><a href="${escape(window.periodPageUrl("decade", decade))}">${escape(decade)}</a></th>${yearCells}</tr>`;
      })
      .join("");
    return `<div class="period-year-grid-wrap${options.compact ? " period-year-grid-wrap--compact" : ""}"><table class="period-year-grid"><thead><tr><th scope="col">${escape(ui("All-time"))}</th><th scope="col">${escape(ui("Century"))}</th><th scope="col">${escape(ui("Decade"))}</th>${digitHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
  };

  /** Renders the canonical category board with compact-preview or visual-card treatment. @param {{compact?: boolean, visual?: boolean, posterFilmsForCategory?: function(string): FilmRecord[]}} [options] Presentation options. @returns {string} Category board HTML. */
  window.renderCategoryIndexBoard = function (options = {}) {
    let summaries = categorySummaries();
    let empty = {
      nominations: 0,
      winners: 0,
      latestWinner: null,
      latestYear: 0,
    };
    let bestPicture = categoryCard(
      "Best Picture",
      summaries.get("Best Picture") || empty,
      options,
    );
    let paired = (window.getCategoryPresentationSlots?.() || [])
      .map((category) =>
        categoryCard(category, summaries.get(category) || empty, options),
      )
      .join("");
    return `<div class="category-index-grid${options.compact ? " category-index-grid--compact" : ""}${options.visual ? " category-index-grid--visual" : ""}">${bestPicture}${paired}</div>`;
  };
})();
