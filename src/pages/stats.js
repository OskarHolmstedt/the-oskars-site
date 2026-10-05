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
  let overall;
  let personalAnnualAwardEntries;
  let awardAgreement;
  let archiveFilms = [];
  let availableYears = [];
  let selectedWatchYear = "";

  function collectLegacyStatistics() {
    let finishStatistics = window.startOskarsPerformance?.("stats:statistics");
    archiveFilms = Object.values(window.state?.filmsById || {});
    stats = window.viewingStatistics(archiveFilms);
    overall = window.overallFilmStatistics(archiveFilms);
    availableYears = window.availableWatchYears(archiveFilms);
    let paramYear = new URLSearchParams(window.location.search).get(
      "watchYear",
    );
    selectedWatchYear =
      paramYear && availableYears.includes(paramYear)
        ? paramYear
        : availableYears[0] || "";
    finishStatistics?.();
    let finishAwardEntries =
      window.startOskarsPerformance?.("stats:awardEntries");
    personalAnnualAwardEntries = archiveFilms.flatMap((film) =>
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

  let inspectorExpanded = false;
  let inspectorFilter = "all";

  function winnerDisplay(winner, isOfficial = false) {
    if (!winner) return `<span class="stats-empty">—</span>`;
    let title;
    let year;
    let url;
    let recipient;
    if (isOfficial) {
      title =
        window.formatOfficialField(winner.sourceTitle) ||
        winner.filmRef?.title ||
        "";
      year = winner.filmRef?.year || "";
      url = winner.filmRef?.id ? window.filmPageUrl(winner.filmRef.id) : "";
      recipient = window.formatOfficialField(winner.recipient);
    } else {
      let film =
        winner.film ||
        (winner.filmId ? window.findFilmById?.(winner.filmId) : null);
      title = window.localizedFilmTitle?.(film) || film?.title || "";
      year = film?.year || "";
      url = film?.id ? window.filmPageUrl(film.id) : "";
      recipient = winner.award?.recipientText || winner.recipient || "";
    }
    let titleHtml = url
      ? `<a class="table-film-link" href="${escape(url)}">${escape(title || "—")}</a>`
      : escape(title || "—");
    let meta = year ? `<small>${escape(year)}</small>` : "";
    let recipientHtml = recipient
      ? `<small class="nominee-recipient-credit">${escape(recipient)}</small>`
      : "";
    return `<div class="stats-awards-inspector-film">${titleHtml}${meta}${recipientHtml}</div>`;
  }

  function agreementInspectorTable(records) {
    if (!records?.length)
      return `<p class="stats-empty">${escape(ui("No comparison records for this filter."))}</p>`;
    let rowsHtml = records
      .map((record) => {
        let periodUrl =
          window.periodPageUrl?.("year", record.periodKey) ||
          `period.html?type=year&key=${escape(record.periodKey)}`;
        let categoryUrl =
          window.categoryPageUrl?.(record.category) ||
          `category.html?name=${encodeURIComponent(record.category)}`;
        let categoryName =
          window.localizedCategoryName?.(record.category) || record.category;
        let isMatch = record.status === "agreement";
        let statusBadge = `<span class="period-award-comparison is-${record.status}"><span aria-hidden="true">${isMatch ? "✓" : "≠"}</span> ${escape(ui(isMatch ? "Match" : "Different"))}</span>`;
        let personalHtml = (record.personalWinners || [])
          .map((w) => winnerDisplay(w, false))
          .join("");
        let officialHtml = (record.officialWinners || [])
          .map((w) => winnerDisplay(w, true))
          .join("");
        return `<tr>
          <td><a href="${escape(periodUrl)}"><b>${escape(record.periodKey)}</b></a></td>
          <td><a href="${escape(categoryUrl)}">${escape(categoryName)}</a></td>
          <td>${statusBadge}</td>
          <td>${personalHtml || `<span class="stats-empty">—</span>`}</td>
          <td>${officialHtml || `<span class="stats-empty">—</span>`}</td>
        </tr>`;
      })
      .join("");
    return `<div class="stats-awards-inspector-table-wrap">
      <table class="stats-awards-inspector-table">
        <thead>
          <tr>
            <th scope="col">${escape(ui("Period"))}</th>
            <th scope="col">${escape(ui("Category"))}</th>
            <th scope="col">${escape(ui("Status"))}</th>
            <th scope="col">${escape(ui("Your winner (Oskars)"))}</th>
            <th scope="col">${escape(ui("Academy winner (Oscars)"))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }

  function awardsContent() {
    let links = `<div class="stats-awards-links"><a class="button-link" href="categories.html">${escape(ui("Browse award categories"))}</a><a class="button-link" href="periods.html">${escape(ui("Browse award periods"))}</a></div>`;
    if (!awardAgreement.comparedCount)
      return `<p class="stats-empty stats-awards-empty">${escape(ui("No comparable Oskars and Oscars winners yet."))}</p>${links}`;
    let scoreContext = ui("{matches} of {total} comparable category-periods", {
      matches: awardAgreement.matches,
      total: awardAgreement.comparedCount,
    });
    let filteredRecords =
      inspectorFilter === "matches"
        ? (awardAgreement.records || []).filter((r) => r.status === "agreement")
        : inspectorFilter === "differences"
          ? (awardAgreement.records || []).filter(
              (r) => r.status === "disagreement",
            )
          : awardAgreement.records || [];
    let inspectorHtml = `
    <div class="stats-awards-inspector-content">
      <div class="stats-awards-inspector-header">
        <h3>${escape(ui("Oskars–Oscars comparison details"))}</h3>
        <div class="stats-awards-inspector-filters" role="tablist" aria-label="${escape(ui("Filter comparisons"))}">
          <a class="button-link${inspectorFilter === "all" ? " is-active" : ""}" href="#all" data-inspector-filter="all">${escape(ui("All"))} (${awardAgreement.comparedCount})</a>
          <a class="button-link${inspectorFilter === "matches" ? " is-active" : ""}" href="#matches" data-inspector-filter="matches">${escape(ui("Matches"))} (${awardAgreement.matches})</a>
          <a class="button-link${inspectorFilter === "differences" ? " is-active" : ""}" href="#differences" data-inspector-filter="differences">${escape(ui("Differences"))} (${awardAgreement.differences})</a>
        </div>
      </div>
      ${agreementInspectorTable(filteredRecords)}
    </div>`;

    return `<div class="stats-awards-overview">
      <details id="statsAwardsInspector" class="stats-awards-inspector-details"${inspectorExpanded ? " open" : ""}>
        <summary class="stats-awards-score stats-awards-score--interactive" title="${escape(ui("Click to inspect matching and differing films"))}">
          <strong>${awardAgreement.agreementPercent}%</strong>
          <span>${escape(ui("Overall agreement"))}</span>
          <small>${escape(scoreContext)} · <b>${escape(ui(inspectorExpanded ? "Hide details" : "Click to inspect"))}</b></small>
        </summary>
        ${inspectorHtml}
      </details>
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

  function overallContent() {
    let year = overall.strongestYear;
    let director = overall.directorRows[0];
    let film = overall.nominationRows[0];
    function card(title, value, context, href) {
      return `<article class="stats-insight"><h3>${escape(ui(title))}</h3><strong>${escape(value)}</strong><p>${escape(context)}</p><a href="${escape(href)}">${escape(ui("Explore the evidence"))} →</a></article>`;
    }
    let cards = [
      card(
        "Strongest release year",
        year ? year.key : ui("Not enough ratings yet"),
        year
          ? ui(
              "{average}/5 from {rated} rated films of {total}. Minimum five rated films per year.",
              {
                average: window.formatRatingStatistic(year.mean),
                rated: year.ratedCount,
                total: year.totalCount,
              },
            )
          : ui(
              "A year needs at least five rated films to lead this comparison.",
            ),
        "#stats-overall-years",
      ),
      card(
        "Most-awarded director",
        director?.name || "—",
        director
          ? ui(
              "{wins} annual wins across {films} nominated films. Counts wins for their films in every category; co-directors share credit.",
              { wins: director.wins, films: director.filmCount },
            )
          : ui("No annual wins with director credits yet."),
        "#stats-overall-directors",
      ),
      card(
        "Most-nominated film",
        film ? window.localizedFilmTitle?.(film.film) || film.film.title : "—",
        film
          ? ui(
              "{nominations} annual nominations, including {wins} wins. Every recorded category placement counts.",
              { nominations: film.nominations, wins: film.wins },
            )
          : ui("No annual nominations yet."),
        "#stats-overall-films",
      ),
      card(
        "Rating snapshot",
        stats.ratedCount
          ? `${window.formatRatingStatistic(stats.averageRating)}/5`
          : "—",
        ui(
          "{rated}/{total} films rated. Population standard deviation {spread} on the five-point scale.",
          {
            rated: stats.ratedCount,
            total: stats.filmCount,
            spread: window.formatRatingStatistic(stats.ratingStandardDeviation),
          },
        ),
        "#stats-ratings",
      ),
      card(
        "Oskars and Oscars",
        awardAgreement.comparedCount
          ? `${awardAgreement.agreementPercent}%`
          : "—",
        ui(
          "{matches}/{total} comparable category-periods agree. Only periods with both winners are included.",
          {
            matches: awardAgreement.matches,
            total: awardAgreement.comparedCount,
          },
        ),
        "#stats-awards",
      ),
    ];
    return `<div class="stats-insights">${cards.join("")}</div>`;
  }

  function overallTables() {
    let years = statsTable(
      [ui("Release year"), ui("Average rating"), ui("Rated coverage")],
      overall.yearRows.map(
        (row) =>
          `<tr><th scope="row"><a href="${escape(window.periodPageUrl("year", row.key))}">${escape(row.key)}</a>${row.ratedCount < overall.minimumRatedFilms ? ` <small>${escape(ui("Small sample"))}</small>` : ""}</th><td>${window.formatAverageRating(row.mean)}</td><td>${row.ratedCount}/${row.totalCount} (${row.coveragePercent}%)</td></tr>`,
      ),
    );
    let directors = statsTable(
      [ui("Director"), ui("Wins"), ui("Nominations"), ui("Films")],
      overall.directorRows.map(
        (row) =>
          `<tr><th scope="row"><a href="${escape(window.personPageUrl(row.id))}">${escape(row.name)}</a></th><td>${row.wins}</td><td>${row.nominations}</td><td>${row.filmCount}</td></tr>`,
      ),
    );
    let films = statsTable(
      [ui("Film"), ui("Nominations"), ui("Wins")],
      overall.nominationRows.map(
        (row) =>
          `<tr><th scope="row"><a href="${escape(window.filmPageUrl(row.film.id))}">${escape(window.localizedFilmTitle?.(row.film) || row.film.title)}</a> <small>${escape(row.film.year || ui("Unknown"))}</small></th><td>${row.nominations}</td><td>${row.wins}</td></tr>`,
      ),
    );
    return `<p class="stats-evidence-note">${escape(ui("Annual Oskars only; decade, century, all-time and collection awards are excluded. Director credits cover {known}/{total} nominated films. Missing credits contribute no director wins.", { known: overall.creditedAwardFilmCount, total: overall.awardFilmCount }))}</p><div class="stats-grid"><details id="stats-overall-years" class="stats-evidence"><summary>${escape(ui("Top-rated years"))} (${overall.yearRows.length})</summary>${years}</details><details id="stats-overall-directors" class="stats-evidence"><summary>${escape(ui("Directors by film award wins"))} (${overall.directorRows.length})</summary>${directors}</details><details id="stats-overall-films" class="stats-evidence"><summary>${escape(ui("Films by nominations"))} (${overall.nominationRows.length})</summary>${films}</details></div>`;
  }

  function yearlyContent() {
    if (!availableYears.length) {
      return `<p class="stats-empty">${escape(ui("No watch dates recorded yet."))}</p>`;
    }
    let currentYear = availableYears.includes(selectedWatchYear)
      ? selectedWatchYear
      : availableYears[0];
    let yearly = window.yearlyViewingStatistics(
      currentYear,
      archiveFilms,
      archiveFilms,
    );

    let yearPills = availableYears
      .map(
        (year) =>
          `<a class="button-link${year === currentYear ? " is-active" : ""}" href="#stats-yearly" data-watch-year="${escape(year)}">${escape(year)}</a>`,
      )
      .join("");

    let pickerHtml = `<div class="stats-year-picker" role="tablist" aria-label="${escape(ui("Select watch year"))}">${yearPills}</div>`;

    let comparisonBadges = [];
    if (yearly.comparison.hasPreviousYear) {
      let prevYear = yearly.comparison.previousYear;
      let filmDiff = yearly.comparison.filmCountDiff;
      let sign = filmDiff > 0 ? "+" : "";
      comparisonBadges.push(
        `<span class="stats-year-comparison-pill ${filmDiff >= 0 ? "is-positive" : "is-negative"}">${escape(ui("{diff} films vs {year}", { diff: `${sign}${filmDiff}`, year: prevYear }))}</span>`,
      );
      let hoursDiff = hours(yearly.comparison.knownRuntimeMinutesDiff);
      let hSign = hoursDiff > 0 ? "+" : "";
      if (hoursDiff !== 0) {
        comparisonBadges.push(
          `<span class="stats-year-comparison-pill ${hoursDiff >= 0 ? "is-positive" : "is-negative"}">${escape(ui("{diff} hours vs {year}", { diff: `${hSign}${hoursDiff}`, year: prevYear }))}</span>`,
        );
      }
      if (yearly.comparison.averageRatingDiff !== null) {
        let rDiff = yearly.comparison.averageRatingDiff;
        let rSign = rDiff > 0 ? "+" : "";
        comparisonBadges.push(
          `<span class="stats-year-comparison-pill ${rDiff >= 0 ? "is-positive" : "is-negative"}">${escape(ui("{diff} rating vs {year}", { diff: `${rSign}${window.formatRatingStatistic(rDiff)}`, year: prevYear }))}</span>`,
        );
      }
    }
    let comparisonHtml = comparisonBadges.length
      ? `<div class="stats-year-comparison">${comparisonBadges.join("")}</div>`
      : "";

    let activeMonth = yearly.mostActiveMonth;
    let topDirector = yearly.topDirector;
    let topDecade = yearly.topReleaseDecade;
    let topRated = yearly.topRatedFilms[0];

    function card(title, value, context, href) {
      let linkHtml = href
        ? `<a href="${escape(href)}">${escape(ui("Explore the evidence"))} →</a>`
        : "";
      return `<article class="stats-insight"><h3>${escape(ui(title))}</h3><strong>${escape(value)}</strong><p>${escape(context)}</p>${linkHtml}</article>`;
    }

    let cards = [
      card(
        "Viewing volume",
        ui("{count} films", { count: yearly.filmCount }),
        ui(
          "{count} films watched in {year}. {hours} known hours. {rewatches} rewatched.",
          {
            count: yearly.filmCount,
            year: currentYear,
            hours: hours(yearly.knownRuntimeMinutes),
            rewatches: yearly.rewatchedFilmCount,
          },
        ),
        "#stats-yearly-months",
      ),
      card(
        "Most active month",
        activeMonth ? ui(activeMonth.monthName) : "—",
        activeMonth
          ? ui("{count} films watched in {month} ({percent}% of the year).", {
              count: activeMonth.count,
              month: ui(activeMonth.monthName),
              percent: percent(activeMonth.count, yearly.filmCount),
            })
          : ui("No dated viewings in this month."),
        "#stats-yearly-months",
      ),
      card(
        "Top director",
        topDirector ? topDirector.name : "—",
        topDirector
          ? ui("{count} films watched directed by {name}.", {
              count: topDirector.count,
              name: topDirector.name,
            })
          : ui("No credited directors for this year's watched films."),
        "#stats-yearly-directors",
      ),
      card(
        "Top release decade",
        topDecade ? topDecade.key : "—",
        topDecade
          ? ui("{count} films from this decade watched in {year}.", {
              count: topDecade.count,
              year: currentYear,
            })
          : ui("No release decade data."),
        "#stats-yearly-eras",
      ),
      card(
        "Rating snapshot",
        yearly.ratedCount
          ? `${window.formatRatingStatistic(yearly.averageRating)}/5`
          : "—",
        yearly.ratedCount
          ? ui("{rated}/{total} films rated. Average rating {average}/5.", {
              rated: yearly.ratedCount,
              total: yearly.filmCount,
              average: window.formatRatingStatistic(yearly.averageRating),
            })
          : ui("No rated films in this year."),
        "#stats-yearly-ratings",
      ),
      card(
        "Top rated film",
        topRated
          ? window.localizedFilmTitle?.(topRated) || topRated.title
          : "—",
        topRated
          ? `${window.renderFilmRating?.(topRated) || ""} (${topRated.year || ""})`
          : ui("No rated films in this year."),
        topRated?.id ? window.filmPageUrl(topRated.id) : "",
      ),
    ];

    let monthTable = statsTable(
      [ui("Month"), ui("Films")],
      yearly.monthlyRows.map((m) => {
        let label = ui(m.monthName);
        return `<tr><th scope="row">${escape(label)}</th><td>${countBar(m.count, yearly.filmCount)}</td></tr>`;
      }),
      ui("No monthly data yet."),
    );

    let directorsTable = statsTable(
      [ui("Director"), ui("Films"), ui("Average rating")],
      yearly.directorRows.slice(0, 15).map((d) => {
        let link = `<a href="${escape(window.personPageUrl(d.id))}">${escape(d.name)}</a>`;
        let avg =
          d.averageRating !== null
            ? window.formatAverageRating(d.averageRating)
            : "—";
        return `<tr><th scope="row">${link}</th><td>${countBar(d.count, yearly.filmCount)}</td><td>${avg}</td></tr>`;
      }),
      ui("No director data yet."),
    );

    let countriesTable = countTable(yearly.countryRows, {
      label: ui("Country"),
      limit: 15,
      total: yearly.filmCount,
      emptyText: ui("No country data yet."),
    });

    let releaseDecadesTable = statsTable(
      [ui("Release decade"), ui("Films"), ui("Average rating")],
      yearly.releaseDecadeRows.map((row) => {
        let link = `<a href="${escape(window.periodPageUrl("decade", row.key))}">${escape(row.key)}</a>`;
        let avg =
          row.averageRating !== null
            ? window.formatAverageRating(row.averageRating)
            : "—";
        return `<tr><th scope="row">${link}</th><td>${countBar(row.count, yearly.filmCount)}</td><td>${avg}</td></tr>`;
      }),
      ui("No release decade data yet."),
    );

    let releaseYearsTable = statsTable(
      [ui("Release year"), ui("Films"), ui("Average rating")],
      yearly.releaseYearRows.slice(0, 15).map((row) => {
        let link = `<a href="${escape(window.periodPageUrl("year", row.key))}">${escape(row.key)}</a>`;
        let avg =
          row.averageRating !== null
            ? window.formatAverageRating(row.averageRating)
            : "—";
        return `<tr><th scope="row">${link}</th><td>${countBar(row.count, yearly.filmCount)}</td><td>${avg}</td></tr>`;
      }),
      ui("No release year data yet."),
    );

    let topFilmsTable = statsTable(
      [ui("Film"), ui("Rating"), ui("Date watched")],
      yearly.topRatedFilms.slice(0, 15).map((film) => {
        let link = `<a href="${escape(window.filmPageUrl(film.id))}">${escape(window.localizedFilmTitle?.(film) || film.title)}</a> <small>${escape(film.year || "")}</small>`;
        let ratingStr = window.renderFilmRating?.(film) || "—";
        let dateStr =
          window.formatWatchedDate?.(film.dateWatched) ||
          film.dateWatched ||
          "—";
        return `<tr><th scope="row">${link}</th><td>${escape(ratingStr)}</td><td>${escape(dateStr)}</td></tr>`;
      }),
      ui("No rated films yet."),
    );

    let comparisonDetailsHtml = "";
    if (yearly.comparison.hasPreviousYear) {
      let pYear = yearly.comparison.previousYear;
      let prevYearStats = window.yearlyViewingStatistics(
        pYear,
        archiveFilms,
        archiveFilms,
        { skipComparison: true },
      );
      let rows = [
        `<tr><th scope="row">${escape(ui("Films watched"))}</th><td>${yearly.filmCount}</td><td>${prevYearStats.filmCount}</td><td><b>${yearly.comparison.filmCountDiff > 0 ? `+${yearly.comparison.filmCountDiff}` : yearly.comparison.filmCountDiff}</b></td></tr>`,
        `<tr><th scope="row">${escape(ui("Total watch time"))}</th><td>${hours(yearly.knownRuntimeMinutes)}h</td><td>${hours(prevYearStats.knownRuntimeMinutes)}h</td><td><b>${hours(yearly.comparison.knownRuntimeMinutesDiff) > 0 ? `+${hours(yearly.comparison.knownRuntimeMinutesDiff)}h` : `${hours(yearly.comparison.knownRuntimeMinutesDiff)}h`}</b></td></tr>`,
        `<tr><th scope="row">${escape(ui("Average rating"))}</th><td>${window.formatRatingStatistic(yearly.averageRating)}</td><td>${window.formatRatingStatistic(prevYearStats.averageRating)}</td><td><b>${yearly.comparison.averageRatingDiff !== null ? (yearly.comparison.averageRatingDiff > 0 ? `+${window.formatRatingStatistic(yearly.comparison.averageRatingDiff)}` : window.formatRatingStatistic(yearly.comparison.averageRatingDiff)) : "—"}</b></td></tr>`,
        `<tr><th scope="row">${escape(ui("Rewatches"))}</th><td>${yearly.rewatchedFilmCount}</td><td>${prevYearStats.rewatchedFilmCount}</td><td><b>${yearly.comparison.rewatchedFilmCountDiff > 0 ? `+${yearly.comparison.rewatchedFilmCountDiff}` : yearly.comparison.rewatchedFilmCountDiff}</b></td></tr>`,
      ];
      let compTable = statsTable(
        [
          ui("Metric"),
          ui("Current year ({year})", { year: currentYear }),
          ui("Previous year ({year})", { year: pYear }),
          ui("Change"),
        ],
        rows,
      );
      comparisonDetailsHtml = `<details class="stats-evidence" id="stats-yearly-comparison"><summary>${escape(ui("Year-over-year comparison ({current} vs {previous})", { current: currentYear, previous: pYear }))}</summary>${compTable}</details>`;
    }

    return `${pickerHtml}
    ${comparisonHtml}
    <div class="stats-insights">${cards.join("")}</div>
    <div class="stats-grid">
      <div id="stats-yearly-months">${split(ui("Monthly viewing"), monthTable)}</div>
      <div id="stats-yearly-ratings">${split(ui("Top rated films in {year}", { year: currentYear }), topFilmsTable)}</div>
    </div>
    <div class="stats-grid stats-grid--three" style="margin-top: 18px;">
      <div id="stats-yearly-directors">${split(ui("Top directors in {year}", { year: currentYear }), directorsTable)}</div>
      <div id="stats-yearly-eras">${split(ui("Release decades in {year}", { year: currentYear }), releaseDecadesTable)}</div>
      <div id="stats-yearly-countries">${split(ui("Top countries in {year}", { year: currentYear }), countriesTable)}</div>
    </div>
    <div class="stats-grid" style="margin-top: 18px;">
      ${split(ui("Release years in {year}", { year: currentYear }), releaseYearsTable)}
      ${split(ui("Platforms in {year}", { year: currentYear }), countTable(yearly.platformRows, { label: ui("Platform"), total: yearly.filmCount, emptyText: ui("No platform data yet.") }))}
    </div>
    ${comparisonDetailsHtml ? `<div style="margin-top: 24px;">${comparisonDetailsHtml}</div>` : ""}`;
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
${overallContent()}
<nav class="stats-navigation" aria-label="${escape(ui("Statistics sections"))}">${["overall", "yearly", "ratings", "coverage", "habits", "awards"].map((id) => `<a href="#stats-${id}">${escape(ui({ overall: "Overall statistics", yearly: "Year in review", ratings: "Ratings", coverage: "Coverage", habits: "Viewing habits", awards: "Awards" }[id]))}</a>`).join("")}</nav>
${section("overall", ui("Overall statistics"), ui("Ranked evidence behind the highlights. Small samples remain visible but cannot lead the strongest-year insight."), overallTables())}
${section("yearly", ui("Year in review"), ui("A yearly snapshot of viewing volume, tastes, and habits for any calendar year with recorded watch dates."), yearlyContent())}
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
  `<p class="stats-evidence-note">${escape(ui("Coverage: watch dates {dates}/{total}; runtime {runtime}/{total}; recorded view counts {views}/{total}. Missing values are excluded from their summaries.", { dates: stats.datedCount, runtime: stats.runtimeKnownCount, views: stats.viewKnownCount, total: stats.filmCount }))}</p>
  <div class="stats-facts">
    <span><b>${stats.rewatchedFilmCount}</b>${escape(ui("rewatched films"))}</span>
    <span><b>${stats.extraViewCount}</b>${escape(ui("extra recorded views"))}</span>
    <span><b>${hours(stats.viewAdjustedRuntimeMinutes)}</b>${escape(ui("view-adjusted hours"))}<small>${escape(ui("where runtime and views are both known"))}</small></span>
    <span><b>${stats.runtimeKnownCount}</b>${escape(ui("films with runtime"))}<small>${escape(ui("{hours} hours once each", { hours: hours(stats.knownRuntimeMinutes) }))}</small></span>
  </div>
  <div class="stats-grid stats-grid--three">
    ${split(ui("Watch years"), countTable(stats.watchYearRows, { label: ui("Year"), total: stats.datedCount, format: (year) => `<a href="#stats-yearly" data-watch-year="${escape(year)}">${escape(year)}</a>`, emptyText: ui("No watch dates yet.") }))}
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

    let detailsEl = container.querySelector("#statsAwardsInspector");
    detailsEl?.addEventListener("toggle", () => {
      inspectorExpanded = detailsEl.open;
      let labelEl = detailsEl.querySelector("summary small b");
      if (labelEl)
        labelEl.textContent = ui(
          inspectorExpanded ? "Hide details" : "Click to inspect",
        );
    });
    container.querySelectorAll("[data-inspector-filter]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        inspectorFilter = e.currentTarget.dataset.inspectorFilter || "all";
        renderStatsPage();
      });
    });

    container.querySelectorAll("[data-watch-year]").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        let year = e.currentTarget.dataset.watchYear;
        if (year && year !== selectedWatchYear) {
          selectedWatchYear = year;
          try {
            let url = new URL(window.location.href);
            url.searchParams.set("watchYear", year);
            window.history.replaceState({}, "", url.toString());
          } catch (err) {}
          renderStatsPage();
          let yearlySec = container.querySelector("#stats-yearly");
          yearlySec?.scrollIntoView({ behavior: "smooth" });
        }
      });
    });

    container.querySelectorAll(".stats-insight a").forEach((link) => {
      link.addEventListener("click", () => {
        let target = container.querySelector(link.getAttribute("href"));
        if (target?.tagName === "DETAILS") target.open = true;
      });
    });
    let hashTarget =
      /^#stats-(overall-(years|directors|films)|yearly(-comparison)?)$/.test(
        window.location?.hash || "",
      )
        ? container.querySelector(window.location.hash)
        : null;
    if (hashTarget && hashTarget.tagName === "DETAILS") hashTarget.open = true;
    window.enhanceHorizontalScroll?.(container);

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
        archiveFilms = model.films || [];
        stats = model.statistics;
        overall = model.overall;
        awardAgreement = model.agreement;
        availableYears = window.availableWatchYears(archiveFilms);
        let paramYear = new URLSearchParams(window.location.search).get(
          "watchYear",
        );
        selectedWatchYear =
          paramYear && availableYears.includes(paramYear)
            ? paramYear
            : availableYears[0] || "";
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
