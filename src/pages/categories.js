/** @file Renders the category index with archive nomination and winner summaries. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let categorySummaries = new Map(
    window
      .getOrderedCategories()
      .map((category) => [category, { nominations: 0, winners: 0 }]),
  );
  Object.values(state.filmsById || {}).forEach((film) =>
    (film.awards || []).forEach((award) => {
      let summary = categorySummaries.get(award.category);
      if (!summary) return;
      summary.nominations++;
      if (Number(award.placement) === 1) summary.winners++;
    }),
  );
  function categoryCard(category, fullWidth = false) {
    if (!category)
      return '<div class="category-board-spacer" aria-hidden="true"></div>';
    let summary = categorySummaries.get(category) || {
      nominations: 0,
      winners: 0,
    };
    return `<article class="browse-index-card category-index-card${fullWidth ? " full-width" : ""}"><h2><a href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a></h2><div><span><b>${summary.nominations}</b> ${escape(ui("nominations"))}</span><span><b>${summary.winners}</b> ${escape(ui("winners"))}</span></div></article>`;
  }

  function render() {
    let finishRenderTimer =
      window.startOskarsPerformance?.("categories:render");
    let bestPicture = categoryCard("Best Picture", true);
    let pairedCards = window
      .getCategoryPresentationSlots()
      .map((category) => categoryCard(category))
      .join("");
    document.title = `${ui("Categories")} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Categories"))}</h1><p>${escape(ui("Browse every award category across years, decades, centuries, and all-time."))}</p>`,
    });
    document.getElementById("categoriesPage").innerHTML =
      `${header}<div class="category-index-grid">${bestPicture}${pairedCards}</div>`;
    finishRenderTimer?.();
  }

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
