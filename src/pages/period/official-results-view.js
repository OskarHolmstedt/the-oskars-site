/** @file Selects and renders read-only official award results for one year page. */

/**
 * Returns one official source period when it contains nominations.
 * @param {string} periodKey Source period key.
 * @param {string} [sourceId] Official source id.
 * @returns {{source: OfficialResultsSource, period: OfficialResultsPeriod}|null}
 */
window.officialResultsPeriod = function (
  periodKey,
  sourceId = "academy-awards",
) {
  let source = window.state?.officialResults?.[sourceId];
  let period = source?.periods?.[periodKey];
  return period?.nominations?.length ? { source, period } : null;
};

/**
 * Renders category-grouped official winners and nominees for a year.
 * @param {Object} input Official period rendering context.
 * @param {OfficialResultsSource} input.source Official source metadata.
 * @param {OfficialResultsPeriod} input.period Official source period.
 * @param {OfficialAwardPeriodComparison|null} [input.personalComparison] Personal winner comparison.
 * @param {(value:*) => string} [input.escape] HTML escaper.
 * @returns {string} Official-results HTML.
 */
window.renderPeriodOfficialResults = function ({
  source,
  period,
  personalComparison = null,
  escape = window.pageEscape,
}) {
  let ui = window.uiText || ((text) => text);
  let nominations = period?.nominations || [];
  let winners = nominations.filter((nomination) => nomination.winner).length;
  let groups = new Map();
  nominations.forEach((nomination) => {
    let entries = groups.get(nomination.category) || [];
    entries.push(nomination);
    groups.set(nomination.category, entries);
  });
  let categories = [...groups.keys()].sort(
    (left, right) =>
      window.categorySortIndex(left) - window.categorySortIndex(right) ||
      left.localeCompare(right),
  );

  function nominationHtml(nomination, showSourceCategory) {
    let isPersonalPick = window.officialNominationIsPersonalPick?.(
      nomination,
      personalComparison,
    );
    let title = escape(nomination.sourceTitle);
    let film = nomination.filmRef;
    let titleHtml = film?.id
      ? `<a class="official-result-film" href="${escape(window.filmPageUrl(film.id))}">${title}</a>`
      : `<span class="official-result-film">${title}</span>`;
    let creditParts = [];
    if (nomination.recipient)
      creditParts.push(`<span>${escape(nomination.recipient)}</span>`);
    if (nomination.detail)
      creditParts.push(`<span>${escape(nomination.detail)}</span>`);
    if (showSourceCategory && nomination.sourceCategory)
      creditParts.push(
        `<span class="official-result-source-category">${escape(nomination.sourceCategory)}</span>`,
      );
    let label = nomination.winner ? ui("Official winner") : ui("Official nominee");
    return `<li class="official-result-nomination${nomination.winner ? " is-winner" : ""}${isPersonalPick ? " is-personal-pick" : ""}">
      <span class="official-result-status" aria-label="${escape(label)}">${nomination.winner ? "🏆" : ""}</span>
      <div><div class="official-result-title">${titleHtml}${nomination.winner ? `<strong>${escape(ui("Winner"))}</strong>` : ""}${isPersonalPick ? `<strong class="official-result-personal-pick">${escape(ui("Your pick"))}</strong>` : ""}</div>${creditParts.length ? `<div class="official-result-credit">${creditParts.join('<span aria-hidden="true">·</span>')}</div>` : ""}</div>
    </li>`;
  }

  let categoryHtml = categories
    .map((category) => {
      let entries = groups.get(category).slice().sort(
        (left, right) =>
          Number(right.winner) - Number(left.winner) ||
          String(left.sourceCategory || "").localeCompare(
            String(right.sourceCategory || ""),
          ) ||
          left.sourceTitle.localeCompare(right.sourceTitle),
      );
      let sourceCategories = new Set(
        entries.map((entry) => entry.sourceCategory).filter(Boolean),
      );
      // Winner-only image, matching the personal award board's own
      // winner-only poster/portrait convention (award-view.js's
      // renderCategoryBoard) - nominees stay text-only here too.
      let winnerEntry = entries.find((entry) => entry.winner);
      let winnerImage = winnerEntry
        ? window.renderOfficialWinnerImage(winnerEntry, "winner")
        : "";
      return `<section class="official-result-category">
        <h2><a href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a></h2>
        <div class="official-result-content${winnerImage ? " has-winner-poster" : ""}">${winnerImage}<ul>${entries.map((entry) => nominationHtml(entry, sourceCategories.size > 1)).join("")}</ul></div>
      </section>`;
    })
    .join("");
  let ceremony = period.ceremony
    ? `${ui("Ceremony")} ${period.ceremony} · `
    : "";
  return `<section class="official-results-view" aria-label="${escape(ui("Official results"))}">
    <header><div><span class="eyebrow">${escape(source.name)}</span><h2>${escape(ui("Official results"))}</h2></div><p>${escape(ceremony)}${nominations.length} ${escape(ui("Nominations"))} · ${winners} ${escape(ui("Winners"))}</p></header>
    <div class="official-results-grid">${categoryHtml}</div>
  </section>`;
};
