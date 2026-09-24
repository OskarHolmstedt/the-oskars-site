/** @file Renders archive viewing statistics, distributions, metadata coverage, dates, and runtime summaries. */

(function () {
  let escape = window.pageEscape;
  let ui =
    window.uiText ||
    ((text, values) =>
      values
        ? String(text || "").replace(/\{([^}]+)\}/g, (m, k) =>
            k in values ? values[k] : m,
          )
        : text);
  if (!window.OSKARS_STATS_COMPACT) window.load();
  let container = document.getElementById("statsPage");
  document.title = `${ui("Statistics")} · The Oskars`;

  let stats;
  let personalAnnualAwardEntries;
  let awardAgreement;
  function collectLegacyStatistics() {
    let finishStatistics = window.startOskarsPerformance?.("stats:statistics");
    stats = window.viewingStatistics();
    finishStatistics?.();
    let finishAwardEntries =
      window.startOskarsPerformance?.("stats:awardEntries");
    personalAnnualAwardEntries = Object.values(
      window.state?.filmsById || {},
    ).flatMap((film) =>
      (film.awards || [])
        .filter((award) => window.getAwardPeriodType(award) === "years")
        .map((award) => ({ film, award })),
    );
    finishAwardEntries?.();
  }

  function percent(count, total = stats.filmCount) {
    return total ? Math.round((count / total) * 100) : 0;
  }

  function hours(minutes) {
    return Math.round(Number(minutes || 0) / 60);
  }

  function countBar(count, total) {
    let width = Math.min(100, Math.max(2, percent(count, total)));
    return `<span class="stats-count"><b>${escape(count)}</b><span class="stats-bar" aria-hidden="true"><i style="width:${width}%"></i></span><small>${escape(percent(count, total))}%</small></span>`;
  }

  function statsTable(headers, rows, emptyText) {
    if (!rows.length)
      return `<p class="stats-empty">${escape(emptyText || ui("No data yet."))}</p>`;
    return window.renderLeaderboardTable({
      headers: headers.map(escape),
      rows: rows.join(""),
      classes: "stats-table",
    });
  }

  function countTable(rows, options = {}) {
    let shown = options.limit ? rows.slice(0, options.limit) : rows;
    let total = options.total || shown.reduce((sum, row) => sum + row.count, 0);
    return statsTable(
      [options.label || ui("Value"), ui("Films")],
      shown.map(
        (row) =>
          `<tr><th scope="row">${escape(options.format?.(row.key) || row.key)}</th><td>${countBar(row.count, total)}</td></tr>`,
      ),
      options.emptyText,
    );
  }

  function section(id, title, description, content) {
    return `<section class="stats-section" id="stats-${escape(id)}"><header><h2>${escape(title)}</h2><p>${escape(description)}</p></header>${content}</section>`;
  }

  function split(title, content) {
    return `<section class="stats-panel"><h3>${escape(title)}</h3>${content}</section>`;
  }

  function ratingLabel(value) {
    return window.renderFilmRating?.({ ratingValue: Number(value) }) || value;
  }

  function mediumLabel(value) {
    return value === "live-action"
      ? ui("Live action")
      : value === "animation"
        ? ui("Animation")
        : value === "hybrid"
          ? ui("Hybrid")
          : ui("Unknown");
  }

  function screenplayLabel(value) {
    return value === "original"
      ? ui("Original")
      : value === "adapted"
        ? ui("Adapted")
        : ui("Unknown");
  }

  function ratingPeriodTable(type, label, rows) {
    return statsTable(
      [
        label,
        ui("Average rating"),
        ui("Standard deviation"),
        ui("Rated coverage"),
      ],
      rows.map(
        (row) => `<tr>
      <th scope="row"><a href="${escape(window.periodPageUrl(type, row.key))}">${escape(row.key)}</a></th>
      <td>${window.formatAverageRating(row.mean)}</td>
      <td>${window.formatRatingStatistic(row.standardDeviation)}</td>
      <td>${row.ratedCount}/${row.totalCount} (${row.coveragePercent}%)</td>
    </tr>`,
      ),
      ui("No release-year data yet."),
    );
  }

  function agreementValue(row) {
    return `<span class="stats-agreement-value"><b>${row.agreementPercent}%</b><span class="stats-agreement-bar" aria-hidden="true"><i style="width:${row.agreementPercent}%"></i></span><small>${row.matches}/${row.comparedCount}</small></span>`;
  }

  function agreementTable(rows, options = {}) {
    return statsTable(
      [
        options.label || ui("Value"),
        ui("Agreement"),
        ui("Matches"),
        ui("Differences"),
      ],
      rows.map((row) => {
        let label = options.format?.(row.key) || row.key;
        let labelHtml = options.url
          ? `<a href="${escape(options.url(row.key))}">${escape(label)}</a>`
          : escape(label);
        return `<tr><th scope="row">${labelHtml}</th><td>${agreementValue(row)}</td><td>${row.matches}</td><td>${row.differences}</td></tr>`;
      }),
      ui("No comparable Oskars and Oscars winners yet."),
    );
  }

  function awardsContent() {
    let links = `<div class="stats-awards-links"><a class="button-link" href="categories.html">${escape(ui("Browse award categories"))}</a><a class="button-link" href="periods.html">${escape(ui("Browse award periods"))}</a></div>`;
    if (!awardAgreement.comparedCount)
      return `<p class="stats-empty stats-awards-empty">${escape(ui("No comparable Oskars and Oscars winners yet."))}</p>${links}`;
    let scoreContext = ui("{matches} of {total} comparable category-periods", {
      matches: awardAgreement.matches,
      total: awardAgreement.comparedCount,
    });
    return `<div class="stats-awards-overview">
      <div class="stats-awards-score"><strong>${awardAgreement.agreementPercent}%</strong><span>${escape(ui("Overall agreement"))}</span><small>${escape(scoreContext)}</small></div>
      <div class="stats-facts stats-awards-facts">
        <span><b>${awardAgreement.comparedCount}</b>${escape(ui("Comparable category-periods"))}</span>
        <span><b>${awardAgreement.categoryCount}</b>${escape(ui("Categories compared"))}</span>
        <span><b>${awardAgreement.periodCount}</b>${escape(ui("Award periods compared"))}</span>
      </div>
    </div>
    <div class="stats-grid stats-awards-breakdowns">
      ${split(ui("By category"), agreementTable(awardAgreement.categoryRows, { label: ui("Category"), format: (category) => window.localizedCategoryName?.(category) || category, url: (category) => `${window.categoryPageUrl(category)}&view=progression` }))}
      ${split(ui("By decade"), agreementTable(awardAgreement.decadeRows, { label: ui("Decade"), url: (decade) => window.periodPageUrl("decade", decade) }))}
    </div>
    ${links}`;
  }

  function renderStatsPage() {
    let finishRenderTimer = window.startOskarsPerformance?.("stats:render");
    if (!window.OSKARS_STATS_COMPACT) {
      let finishCollectTimer = window.startOskarsPerformance?.("stats:collect");
      awardAgreement = window.officialAwardAgreementStatistics({
        personalEntries: personalAnnualAwardEntries,
        officialSource:
          window.state?.officialResults?.["academy-awards"] || null,
      });
      finishCollectTimer?.();
    }
    let viewingSummary = window.renderDetailStats({
      classes: "stats-summary",
      itemsHtml: `
  <span><b>${stats.filmCount}</b> ${escape(ui("films watched"))}</span>
  ${window.renderRatingStatisticsItems(stats.ratingStatistics, { escape, ui })}
  <span><b>${stats.datedCount}</b> ${escape(ui("with a watch date"))}</span>
  <span><b>${hours(stats.knownRuntimeMinutes)}</b> ${escape(ui("known hours"))}</span>
`,
    });

    container.innerHTML = `<header class="stats-hero">
  <span class="eyebrow">${escape(ui("The archive by the numbers"))}</span>
  <h1>${escape(ui("Viewing statistics"))}</h1>
  <p>${escape(ui("A read-only summary of ratings, coverage, and viewing habits. Counts reflect the currently loaded archive."))}</p>
  ${viewingSummary}
</header>
${section(
  "ratings",
  ui("Ratings"),
  ui("Ratings use 30 evenly spaced grades normalized to the five-point scale."),
  `<div class="stats-grid">${split(ui("Distribution"), countTable(stats.ratingRows, { label: ui("Rating"), total: stats.ratedCount, format: ratingLabel, emptyText: ui("No ratings yet.") }))}${split(ui("By release year"), ratingPeriodTable("year", ui("Release year"), stats.yearRows))}${split(ui("By release decade"), ratingPeriodTable("decade", ui("Release decade"), stats.decadeRows))}${split(ui("By release century"), ratingPeriodTable("century", ui("Release century"), stats.centuryRows))}</div>`,
)}
${section(
  "coverage",
  ui("Coverage"),
  ui("What the watched archive spans, including explicit unknown values."),
  `<div class="stats-grid stats-grid--three">
    ${split(ui("Medium"), countTable(stats.mediaRows, { label: ui("Medium"), total: stats.filmCount, format: mediumLabel }))}
    ${split(ui("Screenplay"), countTable(stats.screenplayRows, { label: ui("Screenplay"), total: stats.filmCount, format: screenplayLabel }))}
    ${split(ui("Top countries"), countTable(stats.countryRows, { label: ui("Country"), limit: 20, total: stats.filmCount, emptyText: ui("No country data yet.") }))}
  </div>`,
)}
${section(
  "habits",
  ui("Viewing habits"),
  ui(
    "Watch dates describe one recorded viewing date per film; view counts and runtime are summarized separately.",
  ),
  `<div class="stats-facts">
    <span><b>${stats.rewatchedFilmCount}</b>${escape(ui("rewatched films"))}</span>
    <span><b>${stats.extraViewCount}</b>${escape(ui("extra recorded views"))}</span>
    <span><b>${hours(stats.viewAdjustedRuntimeMinutes)}</b>${escape(ui("view-adjusted hours"))}<small>${escape(ui("where runtime and views are both known"))}</small></span>
    <span><b>${stats.runtimeKnownCount}</b>${escape(ui("films with runtime"))}<small>${escape(ui("{hours} hours once each", { hours: hours(stats.knownRuntimeMinutes) }))}</small></span>
  </div>
  <div class="stats-grid stats-grid--three">
    ${split(ui("Watch years"), countTable(stats.watchYearRows, { label: ui("Year"), total: stats.datedCount, emptyText: ui("No watch dates yet.") }))}
    ${split(ui("Recent watch months"), countTable(stats.watchMonthRows, { label: ui("Month"), limit: 24, total: stats.datedCount, emptyText: ui("No watch dates yet.") }))}
    ${split(ui("Platforms"), countTable(stats.platformRows, { label: ui("Platform"), limit: 20, total: stats.platformRows.reduce((sum, row) => sum + row.count, 0), emptyText: ui("No platform data yet.") }))}
    ${split(ui("Recorded views per film"), countTable(stats.viewRows, { label: ui("Views"), total: stats.viewKnownCount, emptyText: ui("No view-count data yet.") }))}
  </div>`,
)}
${section(
  "awards",
  ui("Awards"),
  ui(
    "How often your annual category winner matches the official Academy winner.",
  ),
  awardsContent(),
)} `;
    finishRenderTimer?.(
      `${stats.filmCount} films, ${stats.ratingRows.length} rating rows, ${stats.decadeRows.length} decade rows`,
    );
  }
  if (!window.OSKARS_STATS_COMPACT) {
    collectLegacyStatistics();
    renderStatsPage();
    window
      .hydrateOfficialResultsFromSupabase?.()
      .then(renderStatsPage, () => {});
    return;
  }

  let generation = 0;
  let owner = window.getSupabaseCurrentUser?.()?.id || null;
  let loadedAt = null;
  let pending = null;

  function refreshStats() {
    if (!owner) return Promise.resolve();
    if (pending) return pending;
    let requestGeneration = generation;
    let requestOwner = owner;
    let current = () =>
      generation === requestGeneration &&
      requestOwner &&
      requestOwner === window.getSupabaseCurrentUser?.()?.id &&
      !window.resolveActiveProfileSlug?.() &&
      !window.state?.isPublicProfileView;
    container.innerHTML = `<p role="status">${escape(ui("Loading statistics…"))}</p>`;
    let finish = window.startOskarsPerformance?.("stats:dataReady");
    let request = (async () => {
      try {
        let source = await window.loadSupabaseStatsProjection();
        if (!current()) return;
        if (!source.hasLiveAcademy) await window.loadStatsOfficialFallback();
        if (!current()) return;
        let model = window.buildSupabaseStatsModel(
          source,
          window.OSKARS_BUNDLED_OFFICIAL_RESULTS?.["academy-awards"],
        );
        stats = model.statistics;
        awardAgreement = model.agreement;
        loadedAt = Date.now();
        renderStatsPage();
        finish?.();
        window.refreshFocusedShellBackdrop?.();
      } catch (error) {
        if (!current()) return;
        console.warn("Could not load compact Stats.", error);
        container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load statistics."))}</h2><button type="button" data-stats-retry>${escape(ui("Try again"))}</button><p><a href="stats.html?statsSource=legacy">${escape(ui("Use the existing statistics view"))}</a></p></section>`;
        container
          .querySelector("[data-stats-retry]")
          ?.addEventListener("click", refreshStats);
      } finally {
        if (pending === request) pending = null;
      }
    })();
    pending = request;
    return request;
  }
  function invalidateStats() {
    generation += 1;
    pending = null;
    loadedAt = null;
    container.innerHTML = "";
    if (owner) refreshStats();
  }
  window.onSupabaseAuthChange?.((user) => {
    let nextOwner = user?.id || null;
    if (owner === nextOwner) return;
    owner = nextOwner;
    invalidateStats();
  });
  window.addEventListener("oskars:hydration-invalidated", invalidateStats);
  window.addEventListener("focus", () => {
    if (
      loadedAt === null ||
      Date.now() - loadedAt >= window.OSKARS_HYDRATION_CACHE_TTL_MS
    )
      refreshStats();
  });
  refreshStats();
})();
