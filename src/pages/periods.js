/** @file Renders the period index as populated century, decade, and year navigation. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  function yearGrid(decadeKeys, populatedYears) {
    let digitHeaders = Array.from(
      { length: 10 },
      (_, digit) => `<th scope="col">${digit}</th>`,
    ).join("");
    let previousCentury = "";
    let rows = decadeKeys
      .map((decade) => {
        let start = Number(String(decade).replace(/\D/g, ""));
        let century = window.getCenturyKey(start);
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
    return `<div class="period-year-grid-wrap"><table class="period-year-grid"><thead><tr><th scope="col">${escape(ui("All-time"))}</th><th scope="col">${escape(ui("Century"))}</th><th scope="col">${escape(ui("Decade"))}</th>${digitHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function staticDecadeKeys(populatedYears = []) {
    let currentYear = new Date().getFullYear();
    let currentDecade = Math.floor(currentYear / 10) * 10;
    let populatedDecades = populatedYears
      .map((year) => Number(year))
      .filter((year) => Number.isFinite(year) && year > 0)
      .map((year) => Math.floor(year / 10) * 10);
    let firstDecade = Math.min(1900, ...populatedDecades);
    let finalDecade = Math.max(currentDecade, ...populatedDecades);
    let decades = [];
    for (let decade = firstDecade; decade <= finalDecade; decade += 10) {
      decades.push(`${decade}s`);
    }
    return decades;
  }
  let yearKeys = new Set([
    ...Object.keys(state.years || {}).filter((key) => /^\d{4}$/.test(key)),
    ...Object.keys(state.periods?.years || {}).filter((key) =>
      /^\d{4}$/.test(key),
    ),
    ...(window.watchlistPeriodKeys?.("year") || []),
  ]);
  let years = [...yearKeys].sort((a, b) => Number(a) - Number(b));
  let decades = staticDecadeKeys(years);
  let container = document.getElementById("periodsPage");

  function render() {
    let doneRender = window.startOskarsPerformance?.("periods:render");
    document.title = `${ui("Periods")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ classes: "periods-header", mainHtml: `<h1>${escape(ui("Periods"))}</h1><p>${escape(ui("Move through the award brackets and film views at every scale."))}</p>` })}
    ${yearGrid(decades, new Set(years))}`;
    window.enhanceHorizontalScroll?.(container);
    doneRender?.();
  }

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
