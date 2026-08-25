/** @file Controls category history, progression, competition views, URL state, and category notes. */

(function () {
  let categoryEscape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let categoryLabel = (category) =>
    window.localizedCategoryName?.(category) || category;

  function periodType(award) {
    let type = window.getAwardPeriodType(award);
    return type === "allTime" ? "allTime" : type;
  }

  window.load();
  let category = window.pageQueryParam("name");
  let container = document.getElementById("categoryPage");
  let typeLabels = {
    years: "Years",
    decades: "Decades",
    centuries: "Centuries",
    allTime: "All-time",
  };
  let typeOrder = ["years", "decades", "centuries", "allTime"];
  let requestedTypes = window.pageQueryParam("types");
  let selectedTypes = requestedTypes
    ? new Set(
        requestedTypes === "none"
          ? []
          : requestedTypes
              .split(",")
              .filter((type) => typeOrder.includes(type)),
      )
    : new Set(typeOrder);
  let requestedViewMode = window.pageQueryParam("view");
  let viewMode = ["progression", "official"].includes(requestedViewMode)
    ? requestedViewMode
    : "rankings";
  let chronologyOrder =
    window.pageQueryParam("order") === "desc" ? "desc" : "asc";
  let chronologyFactor = chronologyOrder === "desc" ? -1 : 1;
  // Rankings and official results share one list/grid display toggle; each
  // keeps its own pre-toggle default so existing links/bookmarks render the
  // same as before. Winners and progression have no toggle - the param is
  // simply ignored there.
  function defaultDisplayMode(mode) {
    return mode === "official" ? "grid" : "list";
  }
  let requestedDisplayMode = window.pageQueryParam("display");
  let displayModeExplicit =
    requestedDisplayMode === "list" || requestedDisplayMode === "grid";
  let displayMode = displayModeExplicit
    ? requestedDisplayMode
    : defaultDisplayMode(viewMode);

  if (!category) {
    document.title = `${ui("Category not found")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${categoryEscape(ui("Category not found"))}</h1><a href="index.html">${categoryEscape(ui("Return home"))}</a></div>`;
    return;
  }

  let entries = window
    .awardCategoryEntries(category)
    .map((entry) => Object.assign(entry, { type: periodType(entry.award) }));
  let ratingStatistics = window.collectionRatingStatistics(
    window.filmsForAwardCategory(category),
  );
  let officialCategoryComparison =
    window.officialAwardCategoryHistoryComparison({
      category,
      personalEntries: entries,
      officialSource:
        window.state?.officialResults?.["academy-awards"] || null,
    });
  let officialNominationSources = new WeakMap();

  function updateViewUrl() {
    if (!window.history?.replaceState || !window.location?.href) return;
    let url = new URL(window.location.href);
    if (viewMode !== "rankings") url.searchParams.set("view", viewMode);
    else url.searchParams.delete("view");
    if (selectedTypes.size === typeOrder.length)
      url.searchParams.delete("types");
    else
      url.searchParams.set(
        "types",
        selectedTypes.size
          ? typeOrder.filter((type) => selectedTypes.has(type)).join(",")
          : "none",
      );
    if (displayMode !== defaultDisplayMode(viewMode))
      url.searchParams.set("display", displayMode);
    else url.searchParams.delete("display");
    window.history.replaceState(null, "", url);
  }

  function chronologyUrl() {
    let url = window.categoryPageUrl(category);
    if (viewMode !== "rankings") url += `&view=${encodeURIComponent(viewMode)}`;
    if (selectedTypes.size !== typeOrder.length)
      url += `&types=${encodeURIComponent(selectedTypes.size ? typeOrder.filter((type) => selectedTypes.has(type)).join(",") : "none")}`;
    if (displayMode !== defaultDisplayMode(viewMode))
      url += `&display=${encodeURIComponent(displayMode)}`;
    if (chronologyOrder === "asc") url += "&order=desc";
    return url;
  }

  function displayModeUrl(mode) {
    let url = window.categoryPageUrl(category);
    if (viewMode !== "rankings") url += `&view=${encodeURIComponent(viewMode)}`;
    if (selectedTypes.size !== typeOrder.length)
      url += `&types=${encodeURIComponent(selectedTypes.size ? typeOrder.filter((type) => selectedTypes.has(type)).join(",") : "none")}`;
    if (mode !== defaultDisplayMode(viewMode))
      url += `&display=${encodeURIComponent(mode)}`;
    if (chronologyOrder === "desc") url += "&order=desc";
    return url;
  }

  function creditForEntry(entry) {
    return window.renderAwardCreditHtml({
      film: entry.film,
      award: entry.award,
      escape: categoryEscape,
    });
  }

  function rankingEntryCard(entry) {
    let credit = creditForEntry(entry);
    let image = window.renderAwardWinnerImage(
      entry.film,
      entry.award,
      "winner",
    );
    let place =
      placementEmoji[entry.award.placement] ||
      `<b>${categoryEscape(entry.award.placement)}</b>`;
    let isWinner = Number(entry.award.placement) === 1;
    return `<article class="category-winner-card${isWinner ? " is-winner" : ""}">
    ${image ? `<div class="category-winner-visual">${image}</div>` : ""}
    <div class="category-winner-title-row"><span class="category-winner-place">${place}</span><a class="category-winner-film table-film-link${credit.hasRecipient ? " nominee-film-link" : ""}" href="${categoryEscape(window.filmPageUrl(entry.film.id))}">${categoryEscape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</a></div>
    ${credit.html ? `<div class="category-winner-credit nominee-recipient-credit">${credit.html}</div>` : ""}
  </article>`;
  }

  function entryPeriod(entry) {
    return String(entry?.award?.year || "");
  }

  function winnerEntries(type) {
    return entries.filter(
      (entry) => entry.type === type && Number(entry.award.placement) === 1,
    );
  }

  function entryFilmKey(entry) {
    if (!entry?.film) return "";
    return (
      entry.film.id ||
      `${window.normalizeTitle(entry.film.title)}::${entry.film.year || ""}`
    );
  }

  function sameEntryFilm(left, right) {
    return Boolean(left && right && entryFilmKey(left) === entryFilmKey(right));
  }

  function winnerMap(type) {
    let map = new Map();
    winnerEntries(type).forEach((entry) => {
      let period = entryPeriod(entry);
      if (period && !map.has(period)) map.set(period, entry);
    });
    return map;
  }

  function decadeStart(decade) {
    return window.pagePeriodNumber(decade);
  }

  function decadeForYear(year) {
    return window.getDecadeKey(year);
  }

  function centuryForDecade(decade) {
    return window.getCenturyKey(decadeStart(decade));
  }

  function progressionFilmCell(entry, options = {}) {
    if (!entry) return '<span class="category-progression-empty">—</span>';
    let classes = ["category-progression-film"];
    if (options.promoted) classes.push("is-promoted");
    else if (options.rollup || options.yearWinner) classes.push("is-stopped");
    if (options.champion) classes.push("is-champion");
    if (["agreement", "disagreement"].includes(options.officialStatus))
      classes.push(`has-oscar-${options.officialStatus}`);
    let period = entryPeriod(entry);
    let credit = creditForEntry(entry);
    let image = window.renderAwardWinnerImage(
      entry.film,
      entry.award,
      "progression",
    );
    let meta = options.showMeta
      ? `<small>${categoryEscape(entry.film.year || "")}${period ? ` · ${categoryEscape(period)}` : ""}</small>`
      : "";
    let officialStatusHtml = ["agreement", "disagreement"].includes(
      options.officialStatus,
    )
      ? `<span class="category-progression-oscar-status period-award-comparison is-${options.officialStatus}" title="${categoryEscape(ui(options.officialStatus === "agreement" ? "Your pick matches the Oscar winner" : "Your pick differs from the Oscar winner"))}"><span aria-hidden="true">${options.officialStatus === "agreement" ? "✓" : "≠"}</span> ${categoryEscape(ui(options.officialStatus === "agreement" ? "Match" : "Different"))}</span>`
      : "";
    return `<div class="${classes.join(" ")}">
    ${image ? `<div class="category-progression-media">${image}</div>` : ""}
    <a class="table-film-link${credit.hasRecipient ? " nominee-film-link" : ""}" href="${categoryEscape(window.filmPageUrl(entry.film.id))}">${categoryEscape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</a>
    ${officialStatusHtml}
    ${meta}
    ${options.showCredit && credit.html ? `<span class="nominee-recipient-credit">${credit.html}</span>` : ""}
  </div>`;
  }

  function groupedRowSpan(values, index) {
    let value = values[index];
    if (index > 0 && values[index - 1] === value) return 0;
    let span = 1;
    while (index + span < values.length && values[index + span] === value)
      span += 1;
    return span;
  }

  // Historical official results are grouped by source before ceremony so
  // award bodies that share a year never appear to be one combined result.
  function officialCategorySources() {
    return Object.values(state.officialResults || {})
      .map((source) => {
        let periods = Object.entries(source.periods || {})
          .map(([periodKey, period]) => {
            let nominations = (period.nominations || []).filter(
              (nomination) => nomination.category === category,
            );
            nominations.forEach((nomination) =>
              officialNominationSources.set(nomination, source.id),
            );
            return { periodKey, period, nominations };
          })
          .filter((entry) => entry.nominations.length);
        return { source, periods };
      })
      .filter((entry) => entry.periods.length)
      .sort(
        (left, right) =>
          Number(right.source.id === "academy-awards") -
            Number(left.source.id === "academy-awards") ||
          left.source.name.localeCompare(right.source.name) ||
          left.source.id.localeCompare(right.source.id),
      );
  }

  function officialResultCreditParts(nomination, showSourceCategory) {
    return [
      nomination.recipient,
      nomination.detail,
      showSourceCategory ? nomination.sourceCategory : "",
    ]
      .filter(Boolean)
      .map(categoryEscape);
  }

  function officialResultTitleHtml(nomination, classes) {
    let title = categoryEscape(nomination.sourceTitle);
    let film = nomination.filmRef;
    return film?.id
      ? `<a class="${classes} table-film-link" href="${categoryEscape(window.filmPageUrl(film.id))}">${title}</a>`
      : `<span class="${classes}">${title}</span>`;
  }

  function officialNominationIsPersonalPick(nomination, periodKey) {
    if (officialNominationSources.get(nomination) !== "academy-awards")
      return false;
    return window.officialNominationIsPersonalPick(
      nomination,
      officialCategoryComparison.periodsByKey.get(periodKey)
        ?.periodComparison || null,
    );
  }

  function officialEntryCard(nomination, showSourceCategory, periodKey) {
    // nomination.filmRef only carries {id, title, year} (no poster), so
    // resolve the full film record for a poster - and pass the nomination
    // itself as the "award": it already has a plain .recipient string,
    // which is exactly the shape renderAwardWinnerImage/awardRecipients
    // expects, so a matched recipient's portrait is used when known,
    // falling back to the film poster same as full rankings' cards.
    let film = nomination.filmRef
      ? window.findFilmById(nomination.filmRef.id)
      : null;
    let image = window.renderAwardWinnerImage(film, nomination, "winner");
    let creditParts = officialResultCreditParts(nomination, showSourceCategory);
    let label = nomination.winner
      ? ui("Official winner")
      : ui("Official nominee");
    let isPersonalPick = officialNominationIsPersonalPick(
      nomination,
      periodKey,
    );
    return `<article class="category-winner-card${nomination.winner ? " is-winner" : ""}${isPersonalPick ? " is-personal-pick" : ""}">
    ${image ? `<div class="category-winner-visual">${image}</div>` : ""}
    <div class="category-winner-title-row"><span class="category-winner-place" aria-label="${categoryEscape(label)}">${nomination.winner ? "🏆" : ""}</span>${officialResultTitleHtml(nomination, "category-winner-film")}${isPersonalPick ? `<strong class="category-official-personal-pick">${categoryEscape(ui("Your pick"))}</strong>` : ""}</div>
    ${creditParts.length ? `<div class="category-winner-credit nominee-recipient-credit">${creditParts.join(" · ")}</div>` : ""}
  </article>`;
  }

  function officialResultRow(nomination, showSourceCategory, periodKey) {
    let creditParts = officialResultCreditParts(nomination, showSourceCategory);
    let isPersonalPick = officialNominationIsPersonalPick(
      nomination,
      periodKey,
    );
    return `<tr${isPersonalPick ? ' class="is-personal-pick"' : ""}>
      <td class="detail-place">${nomination.winner ? "🏆" : ""}</td>
      <td>${officialResultTitleHtml(nomination, "")}${isPersonalPick ? `<strong class="category-official-personal-pick">${categoryEscape(ui("Your pick"))}</strong>` : ""}</td>
      <td>${creditParts.length ? `<span class="nominee-recipient-credit">${creditParts.join(" · ")}</span>` : ""}</td>
    </tr>`;
  }

  function renderOfficialResultsView() {
    let sources = officialCategorySources();
    if (!sources.length)
      return `<div class="detail-empty">${categoryEscape(ui("No official results data for this category."))}</div>`;
    let sections = sources
      .map(({ source, periods }) => {
        let periodSections = periods
          .slice()
          .sort(
            (left, right) =>
              chronologyFactor *
              (Number(left.period.ceremony) - Number(right.period.ceremony)),
          )
          .map(({ periodKey, period, nominations }) => {
            let sourceCategories = new Set(
              nominations
                .map((nomination) => nomination.sourceCategory)
                .filter(Boolean),
            );
            let showSourceCategory = sourceCategories.size > 1;
            let sortedNominations = nominations.slice().sort(
              (left, right) =>
                Number(right.winner) - Number(left.winner) ||
                left.sourceTitle.localeCompare(right.sourceTitle),
            );
            let ceremony = period.ceremony
              ? `${ui("Ceremony")} ${period.ceremony}`
              : "";
            let body =
              displayMode === "grid"
                ? `<div class="category-winner-grid">${sortedNominations.map((nomination) => officialEntryCard(nomination, showSourceCategory, periodKey)).join("")}</div>`
                : window.renderLeaderboardTable({
                    headers: [ui("Place"), ui("Film"), ui("Credit")].map(
                      categoryEscape,
                    ),
                    rows: sortedNominations
                      .map((nomination) =>
                        officialResultRow(
                          nomination,
                          showSourceCategory,
                          periodKey,
                        ),
                      )
                      .join(""),
                    classes: "category-results",
                  });
            return `<div class="category-period-result">
        <div><h3><a class="period-link" href="${categoryEscape(window.periodPageUrl("years", periodKey))}">${categoryEscape(periodKey)}</a></h3>
        ${ceremony ? `<p class="category-official-meta">${categoryEscape(ceremony)}</p>` : ""}
        ${body}</div>
      </div>`;
          })
          .join("");
        return `<section class="category-official-source" data-official-source="${categoryEscape(source.id)}" aria-label="${categoryEscape(source.name)}">
        <header><span class="eyebrow">${categoryEscape(ui("Official results"))}</span><h2>${categoryEscape(source.name)}</h2></header>
        <div class="category-official-source-history">${periodSections}</div>
      </section>`;
      })
      .join("");
    return `<div class="category-official-results">${sections}</div>`;
  }

  function renderProgressionView() {
    let yearWinners = winnerMap("years");
    let decadeWinners = winnerMap("decades");
    let centuryWinners = winnerMap("centuries");
    let allTimeWinner = winnerEntries("allTime")[0] || null;
    let decadeKeys = new Set();
    yearWinners.forEach((entry, year) => {
      let decade = decadeForYear(year);
      if (/^\d{4}s$/.test(decade)) decadeKeys.add(decade);
    });
    decadeWinners.forEach((entry, decade) => {
      if (/^\d{4}s$/.test(decade)) decadeKeys.add(decade);
    });
    let decades = [...decadeKeys].sort(
      (left, right) =>
        chronologyFactor *
        (window.pagePeriodNumber(left) - window.pagePeriodNumber(right)),
    );
    let centuryKeys = decades.map(centuryForDecade);
    let allTimeRowSpan = decades.length;
    let yearDigits = Array.from({ length: 10 }, (_, index) => String(index));
    let rows = decades
      .map((decade, decadeIndex) => {
        let start = decadeStart(decade);
        let decadeWinner = decadeWinners.get(decade);
        let century = centuryForDecade(decade);
        let centuryWinner = centuryWinners.get(century);
        let centuryRowSpan = groupedRowSpan(centuryKeys, decadeIndex);
        let yearCells = yearDigits
          .map((digit, offset) => {
            let year = String(start + offset);
            let winner = yearWinners.get(year);
            let officialStatus =
              officialCategoryComparison.periodsByKey.get(year)?.status;
            return `<td class="category-progression-year-cell">
        <a class="period-link category-progression-year" href="${categoryEscape(window.periodPageUrl("year", year))}">${categoryEscape(year)}</a>
        ${progressionFilmCell(winner, { promoted: sameEntryFilm(winner, decadeWinner), yearWinner: true, officialStatus })}
      </td>`;
          })
          .join("");
        return `<tr class="category-progression-row">
      <th class="category-progression-period"><a class="period-link" href="${categoryEscape(window.periodPageUrl("decade", decade))}">${categoryEscape(decade)}</a></th>
      ${yearCells}
      <td>${progressionFilmCell(decadeWinner, { promoted: sameEntryFilm(decadeWinner, centuryWinner), rollup: true, showMeta: true, showCredit: true })}</td>
      ${centuryRowSpan ? `<td class="category-progression-rollup-cell" rowspan="${centuryRowSpan}"><a class="period-link category-progression-rollup-period" href="${categoryEscape(window.periodPageUrl("century", century))}">${categoryEscape(century)}</a>${progressionFilmCell(centuryWinner, { promoted: sameEntryFilm(centuryWinner, allTimeWinner), rollup: true, showMeta: true, showCredit: true })}</td>` : ""}
      ${decadeIndex === 0 ? `<td class="category-progression-rollup-cell category-progression-alltime-cell" rowspan="${allTimeRowSpan}">${progressionFilmCell(allTimeWinner, { champion: true, showMeta: true, showCredit: true })}</td>` : ""}
    </tr>`;
      })
      .join("");
    return window.renderProgressionTable({
      headers: [
        ui("Decade"),
        ...yearDigits,
        ui("Decade"),
        ui("Century"),
        ui("All-time"),
      ],
      bandHeaders: [
        { label: ui("Year winners"), span: 11 },
        { label: ui("Rollup winners"), span: 3 },
      ],
      classes: ["category-progression-table"],
      wrapClass: "category-progression-wrap",
      colWidths: [28, ...yearDigits.map(() => 82), 108, 114, 120],
      skipCollapse: true,
      rows,
      emptyText: ui("No winner progression for this category."),
    });
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("category:render");
    let controls = typeOrder
      .map(
        (type) =>
          `<label><input type="checkbox" data-category-period-type="${type}" ${selectedTypes.has(type) ? "checked" : ""}> ${categoryEscape(ui(typeLabels[type]))}</label>`,
      )
      .join("");
    let categoryLinks = window
      .getOrderedCategories()
      .map(
        (item) =>
          `<a href="${categoryEscape(window.categoryPageUrl(item))}"${item === category ? ' class="current" aria-current="page"' : ""}>${categoryEscape(categoryLabel(item))}</a>`,
      )
      .join("");
    let visibleEntries = entries.filter((entry) =>
      selectedTypes.has(entry.type),
    );
    let displayedEntries =
      viewMode === "rankings"
        ? visibleEntries
        : entries.filter((entry) => Number(entry.award.placement) === 1);
    let agreementSummary = officialCategoryComparison.comparedCount
      ? `<span class="category-official-agreement-summary"><b>${officialCategoryComparison.matches}/${officialCategoryComparison.comparedCount}</b> ${categoryEscape(ui("Oskars–Oscars agreement"))} · ${officialCategoryComparison.agreementPercent}%</span>`
      : "";
    let finishSectionsTimer =
      window.startOskarsPerformance?.("category:sections");
    let sections =
      viewMode === "official"
        ? renderOfficialResultsView()
        : viewMode === "progression"
        ? renderProgressionView()
        : typeOrder
            .filter((type) => selectedTypes.has(type))
            .map((type) => {
              let typeEntries = visibleEntries.filter(
                (entry) => entry.type === type,
              );
              if (!typeEntries.length) return "";
              let periods = [
                ...new Set(
                  typeEntries.map((entry) => String(entry.award.year || "")),
                ),
              ].sort(
                (left, right) =>
                  chronologyFactor *
                  (window.pagePeriodNumber(left) -
                    window.pagePeriodNumber(right)),
              );
              let periodTables = periods
                .map((period) => {
                  let periodEntries = typeEntries
                    .filter(
                      (entry) => String(entry.award.year || "") === period,
                    )
                    .sort(
                      (left, right) =>
                        Number(left.award.placement) -
                        Number(right.award.placement),
                    );
                  if (displayMode === "grid") {
                    let cards = periodEntries
                      .map(rankingEntryCard)
                      .join("");
                    return `<div class="category-period-result"><div><h3><a class="period-link" href="${categoryEscape(window.periodPageUrl(type, period))}">${categoryEscape(period)}</a></h3><div class="category-winner-grid">${cards}</div></div></div>`;
                  }
                  let rows = periodEntries
                    .map((entry) => {
                      let credit = creditForEntry(entry);
                      return `<tr>
            <td class="detail-place">${placementEmoji[entry.award.placement] || `<b>${categoryEscape(entry.award.placement)}</b>`}</td>
            <td><a class="table-film-link${credit.hasRecipient ? " nominee-film-link" : ""}" href="${categoryEscape(window.filmPageUrl(entry.film.id))}">${categoryEscape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</a><span class="leaderboard-meta">${categoryEscape(entry.film.year || "")}</span></td>
            <td>${credit.html ? `<span class="nominee-recipient-credit">${credit.html}</span>` : ""}</td>
          </tr>`;
                    })
                    .join("");
                  let winner = periodEntries.find(
                    (entry) => Number(entry.award.placement) === 1,
                  );
                  let winnerImage = winner
                    ? window.renderAwardWinnerImage(
                        winner.film,
                        winner.award,
                        "winner",
                      )
                    : "";
                  let table = window.renderLeaderboardTable({
                    headers: [ui("Place"), ui("Film"), ui("Credit")].map(
                      categoryEscape,
                    ),
                    rows,
                    classes: "category-results",
                  });
                  return `<div class="category-period-result${winnerImage ? " has-winner-poster" : ""}">${winnerImage}<div><h3><a class="period-link" href="${categoryEscape(window.periodPageUrl(type, period))}">${categoryEscape(period)}</a></h3>${table}</div></div>`;
                })
                .join("");
              return `<section class="category-period-section"><h2>${categoryEscape(ui(typeLabels[type]))}</h2>${periodTables}</section>`;
            })
            .join("");
    finishSectionsTimer?.(
      `${viewMode}, ${visibleEntries.length} visible entry(s), ${displayedEntries.length} displayed entry(s)`,
    );

    document.title = `${categoryLabel(category)} · The Oskars`;
    container.innerHTML = `<header class="film-detail-header category-detail-header"><div><h1>${categoryEscape(categoryLabel(category))}</h1></div>
      <nav class="category-jump-nav" aria-label="${categoryEscape(ui("Award categories"))}"><b>${categoryEscape(ui("Categories"))}</b><div class="category-jump-list">${categoryLinks}</div></nav>
    </header>
    ${window.renderDetailStats({ itemsHtml: `<span><b>${displayedEntries.length}</b> ${categoryEscape(viewMode === "rankings" ? ui("Nominations") : ui("Winners"))}</span><span><b>${new Set(displayedEntries.map((entry) => entry.award.year)).size}</b> ${categoryEscape(ui("Periods"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape: categoryEscape, ui })}${agreementSummary}` })}
    ${window.renderEntityNote("categories", category, ui("Category note"))}
    ${window.renderChronologyControl({ order: chronologyOrder, href: chronologyUrl(), escape: categoryEscape })}
    <div class="category-view-toolbar"><fieldset class="category-view-controls"><legend>${categoryEscape(ui("View"))}</legend><label><input type="radio" name="categoryViewMode" value="rankings" ${viewMode === "rankings" ? "checked" : ""}> ${categoryEscape(ui("Full rankings"))}</label><label><input type="radio" name="categoryViewMode" value="progression" ${viewMode === "progression" ? "checked" : ""}> ${categoryEscape(ui("Progression"))}</label><label><input type="radio" name="categoryViewMode" value="official" ${viewMode === "official" ? "checked" : ""}> ${categoryEscape(ui("Official results"))}</label></fieldset>
    ${
      viewMode === "rankings" || viewMode === "official"
        ? window.renderFilmViewToggle({
            view: displayMode,
            listUrl: displayModeUrl("list"),
            gridUrl: displayModeUrl("grid"),
            escape: categoryEscape,
            classes: "category-display-toggle",
            ariaLabel: ui("Category display"),
          })
        : ""
    }</div>
    ${viewMode === "progression" || viewMode === "official" ? "" : `<fieldset class="category-period-controls"><legend>${categoryEscape(ui("Competitions"))}</legend>${controls}</fieldset>`}
    ${sections || `<div class="detail-empty">${categoryEscape(ui(viewMode === "rankings" ? "No nominations for the selected competitions" : "No winners for the selected competitions"))}</div>`}`;
    window.enhanceCollapsibles?.(container);
    finishRenderTimer?.(
      `${category}, ${viewMode}, ${displayedEntries.length} displayed entry(s)`,
    );
  }

  render();
  window.bindEntityNoteEditor(container);
  window.addEventListener?.("oskars:localechange", render);
  container.addEventListener("change", (event) => {
    let viewInput = event.target.closest('input[name="categoryViewMode"]');
    if (viewInput) {
      viewMode = viewInput.value;
      if (!displayModeExplicit) displayMode = defaultDisplayMode(viewMode);
      updateViewUrl();
      render();
      return;
    }
    let input = event.target.closest("[data-category-period-type]");
    if (!input) return;
    if (input.checked) selectedTypes.add(input.dataset.categoryPeriodType);
    else selectedTypes.delete(input.dataset.categoryPeriodType);
    updateViewUrl();
    render();
  });
})();
