/** @file Renders the Oscar, watch-goal, bracket, and known-film completion dashboard. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("completionPage");
  document.title = `${ui("Completion")} · The Oskars`;

  // Completion hub (issue #17): directors, franchises, and projects ranked by
  // progress toward watching everything the archive + watchlist know about.
  let finishCollectTimer =
    window.startOskarsPerformance?.("completion:collect");
  let hub = window.completionHubData();
  // Award-bracket completion (moved here from the Data Health report): how
  // much of each imported award period's category slots are filled in,
  // independent of watch progress below.
  let bracketCompletion = window.awardBracketCompletion();
  let bracketCategoryCompletion = window.awardBracketCategoryCompletion();
  let oscarCompletion = window.officialOscarCompletion();
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  const OSCAR_WATCHLIST_TIER_KEY = "oskars-oscar-watchlist-tier";
  function preferredOscarWatchlistTier() {
    try {
      return (
        window.normalizeWatchlistTier(
          localStorage.getItem(OSCAR_WATCHLIST_TIER_KEY),
        ) || "C"
      );
    } catch (err) {
      return "C";
    }
  }
  let oscarWatchlistTier = preferredOscarWatchlistTier();
  let oscarWatchlistStatus = "";
  let pendingOscarWatchlistPlan = null;
  let lastOscarWatchlistAddition = null;
  // Watch-count goals per period: how many films have actually been watched
  // from each year/decade/century against a flat target, separate from
  // award nominee coverage above.
  let watchGoalYears = window.watchGoalProgress("year");
  let watchGoalDecades = window.watchGoalProgress("decade");
  let watchGoalCenturies = window.watchGoalProgress("century");
  finishCollectTimer?.(
    `${hub.directors.length} directors, ${hub.franchises.length} franchises, ${hub.projects.length} projects, ${oscarCompletion.films.length} official Oscar film(s), ${bracketCompletion.length} bracket period(s), ${watchGoalYears.length}/${watchGoalDecades.length}/${watchGoalCenturies.length} year/decade/century goal(s)`,
  );

  const PAGE_SIZE = 10;
  let layout = window.filmViewMode("list");
  let pageState = {};

  // Per-section sort state, toggled by table headers or grid controls.
  // `dir` is 1 for ascending, -1 for descending.
  let sortState = {
    directors: { key: "percent", dir: -1 },
    franchises: { key: "percent", dir: -1 },
    projects: { key: "percent", dir: -1 },
    oscarPeriods: { key: "nomineePercent", dir: -1 },
    brackets: { key: "percent", dir: -1 },
    watchGoalYears: { key: "percent", dir: -1 },
    watchGoalDecades: { key: "percent", dir: -1 },
    watchGoalCenturies: { key: "percent", dir: -1 },
  };
  let sortDefaultDir = {
    name: 1,
    period: 1,
    watchedCount: -1,
    watchlistCount: -1,
    filledSlots: -1,
    completeCategories: -1,
    winnerPercent: -1,
    nomineePercent: -1,
    percent: -1,
  };

  function sortRows(rows, section, valueOf) {
    let state = sortState[section];
    return [...rows].sort((left, right) => {
      let leftValue = valueOf(left, state.key);
      let rightValue = valueOf(right, state.key);
      if (typeof leftValue === "string" || typeof rightValue === "string")
        return (
          state.dir *
          String(leftValue || "").localeCompare(String(rightValue || ""))
        );
      return state.dir * ((leftValue || 0) - (rightValue || 0));
    });
  }

  function sortHeader(section, key, label) {
    let state = sortState[section];
    let active = state.key === key;
    let arrow = active ? (state.dir === 1 ? " ↑" : " ↓") : "";
    return `<button type="button" data-sort-section="${escape(section)}" data-sort-key="${escape(key)}" aria-pressed="${active ? "true" : "false"}">${escape(label)}${arrow}</button>`;
  }

  function paginateRows(rows, section, itemLabel) {
    let pagination = window.paginationState(
      rows.length,
      pageState[section] || 1,
      PAGE_SIZE,
    );
    pageState[section] = pagination.page;
    let controls = window.renderPaginationControls({
      total: rows.length,
      page: pagination.page,
      pageSize: PAGE_SIZE,
      dataAttribute: "data-completion-page",
      itemLabel,
      ariaLabel: ui("Completion pages"),
    });
    return {
      rows: rows.slice(pagination.sliceStart, pagination.sliceEnd),
      start: pagination.sliceStart,
      controls: controls
        ? `<div data-completion-pagination="${escape(section)}">${controls}</div>`
        : "",
    };
  }

  function meterHtml(percent) {
    return `<div class="completion-meter"><b>${escape(percent)}%</b><div class="project-progress-meter" aria-label="${escape(ui("{percent} percent complete", { percent }))}"><span style="width:${escape(percent)}%"></span></div></div>`;
  }

  function completionRowValue(row, key) {
    if (key === "name") return row.name || "";
    if (key === "watchedCount") return row.watchedCount || 0;
    if (key === "watchlistCount") return row.watchlistCount || 0;
    return row.percent || 0;
  }

  function completionViewUrl(view) {
    return `completion.html?view=${escape(view)}`;
  }

  function completionGridControls(section, options) {
    let state = sortState[section];
    return `<div class="completion-grid-controls">${window.renderSortAxisControl({
      escape,
      value: state.key,
      attribute: `data-completion-sort-axis="${escape(section)}"`,
      axes: [
        { value: "name", label: options.nameLabel },
        { value: "watchedCount", label: ui("Watched") },
        { value: "watchlistCount", label: ui("To watch") },
        { value: "percent", label: ui("Complete") },
      ],
    })}${window.renderChronologyControl({
      order: state.dir === 1 ? "asc" : "desc",
      iconOnly: true,
      escape,
      title: ui("Reverse order"),
      attribute: `data-completion-sort-direction="${escape(section)}"`,
    })}</div>`;
  }

  function periodGridControls(section, axes) {
    let state = sortState[section];
    return `<div class="completion-grid-controls">${window.renderSortAxisControl({
      escape,
      value: state.key,
      attribute: `data-completion-sort-axis="${escape(section)}"`,
      axes,
    })}${window.renderChronologyControl({
      order: state.dir === 1 ? "asc" : "desc",
      iconOnly: true,
      escape,
      title: ui("Reverse order"),
      attribute: `data-completion-sort-direction="${escape(section)}"`,
    })}</div>`;
  }

  function periodGrid(cards, classes = "", itemCount = 0) {
    let countClass = itemCount === PAGE_SIZE
      ? " completion-period-grid--full-page"
      : "";
    return `<div class="completion-period-grid${countClass} ${escape(classes)}">${cards}</div>`;
  }

  function minimalSourceProjectAction(sourceType, sourceId, options = {}) {
    let actionClass = `sort-order-button completion-project-action${options.shortAction ? " completion-project-action--short" : ""}`;
    return window.renderSourceProjectAction(sourceType, sourceId, {
      escape,
      compact: true,
      buttonClass: actionClass,
      linkClass: `${actionClass} completion-project-action--view`,
      linkOnlyWhenExisting: true,
      startLabel: options.startLabel,
      viewText: options.viewText,
    });
  }

  function projectColumnActionOptions() {
    return {
      startLabel: "Start",
      viewText: window.t?.("action.view", "View") || "View",
      shortAction: true,
    };
  }

  function completionSourceProject(row, options = {}) {
    let sourceType = row.type === "director"
      ? "person"
      : row.type === "franchise"
        ? "franchise"
        : "";
    if (!sourceType) return null;
    return {
      action: minimalSourceProjectAction(sourceType, row.id, options),
    };
  }

  function completionGridMedia(row) {
    if (row.type === "director") {
      let person = (state.peopleById || {})[row.id];
      return person ? window.renderPersonPortrait(person, "card") : "";
    }
    if (row.type === "franchise") {
      let franchise = (state.franchisesById || {})[row.id];
      let film = franchise
        ? window.franchiseRepresentativeFilm(franchise)
        : null;
      return film ? window.renderFilmPoster(film, "card") : "";
    }
    let project = window.findProjectById?.(row.id);
    let film = project
      ? window.projectRepresentativeFilm(window.projectProgress(project))
      : null;
    return film ? window.renderFilmPoster(film, "card") : "";
  }

  function completionGrid(rows, start) {
    return `<div class="completion-ranking-grid">${rows
      .map(
        (row, index) => {
          let media = completionGridMedia(row);
          let sourceProject = completionSourceProject(row);
          return `<article class="completion-ranking-card completion-ranking-card--${escape(row.type)}${media ? " completion-ranking-card--media" : ""}">
    ${media ? `<div class="completion-ranking-card-media">${media}</div>` : ""}
    <div class="completion-ranking-card-body"><header><span class="leaderboard-position">#${start + index + 1}</span><h3><a href="${escape(row.href)}">${escape(row.name)}</a></h3>${sourceProject?.action || ""}</header>
    <div class="completion-ranking-card-stats"><span><b>${row.watchedCount}</b> ${escape(ui("Watched"))}</span><span><b>${row.watchlistCount}</b> ${escape(ui("To watch"))}</span></div>
    ${meterHtml(row.percent)}
    </div>
  </article>`;
        },
      )
      .join("")}</div>`;
  }

  function completionTable(section, rows, completeCount, options) {
    if (!rows.length && !completeCount) {
      return `<p class="completion-empty">${escape(options.emptyText)}</p>`;
    }
    let sorted = sortRows(rows, section, completionRowValue);
    let page = paginateRows(sorted, section, options.itemLabel);
    let body = page.rows
      .map((row, index) => {
        let sourceProject = completionSourceProject(
          row,
          projectColumnActionOptions(),
        );
        return `<tr>
    <td class="leaderboard-position">${page.start + index + 1}</td>
    <td class="film-table-cell"><span><a class="table-film-link" href="${escape(row.href)}"><strong>${escape(row.name)}</strong></a></span></td>
    <td>${row.watchedCount}</td>
    <td>${row.watchlistCount}</td>
    <td class="completion-cell">${meterHtml(row.percent)}</td>
    ${sourceProject ? `<td>${sourceProject.action}</td>` : ""}
  </tr>`;
      })
      .join("");
    let completeNote = completeCount
      ? `<p class="completion-note">${escape(ui("{count} more already at 100% of known films.", { count: completeCount }))}</p>`
      : "";
    let ranking = page.rows.length
      ? layout === "grid"
        ? `${completionGridControls(section, options)}${completionGrid(page.rows, page.start)}`
        : window.renderLeaderboardTable({
          headers: [
            escape("#"),
            sortHeader(section, "name", options.nameLabel),
            sortHeader(section, "watchedCount", ui("Watched")),
            sortHeader(section, "watchlistCount", ui("To watch")),
            sortHeader(section, "percent", ui("Complete")),
            ...(section === "directors" || section === "franchises"
              ? [escape(ui("Project"))]
              : []),
          ],
          rows: body,
          classes: "completion-table",
        })
      : `<p class="completion-empty">${escape(ui("Nothing in progress."))}</p>`;
    return `${ranking}${page.controls}${completeNote}`;
  }

  function bracketRowValue(row, key) {
    if (key === "period") return row.period || "";
    if (key === "filledSlots") return row.filledSlots || 0;
    if (key === "completeCategories") return row.completeCategories || 0;
    return row.totalSlots ? row.filledSlots / row.totalSlots : 0;
  }

  function bracketCompletionTable(periods) {
    if (!periods.length) {
      return `<p class="completion-empty">${escape(ui("No award bracket data imported yet."))}</p>`;
    }
    let incomplete = periods.filter(
      (period) => period.filledSlots < period.totalSlots,
    );
    let completeCount = periods.length - incomplete.length;
    let sorted = sortRows(incomplete, "brackets", bracketRowValue);
    let page = paginateRows(sorted, "brackets", ui("periods"));
    let body = page.rows
      .map((period) => {
        let percent = period.totalSlots
          ? Math.round((period.filledSlots / period.totalSlots) * 100)
          : 0;
        return `<tr>
    <td><a class="period-link" href="${escape(`${window.periodPageUrl(period.periodType, period.period)}&view=awards`)}"><strong>${escape(period.period)}</strong></a></td>
    <td>${period.filledSlots} / ${period.totalSlots}</td>
    <td>${period.completeCategories} / ${period.categoryCount}</td>
    <td class="completion-cell">${meterHtml(percent)}</td>
  </tr>`;
      })
      .join("");
    let completeNote = completeCount
      ? `<p class="completion-note">${escape(ui("{count} more already fully filled.", { count: completeCount }))}</p>`
      : "";
    let content = page.rows.length
      ? layout === "grid"
        ? `${periodGridControls("brackets", [
          { value: "period", label: ui("Period") },
          { value: "filledSlots", label: ui("Slots filled") },
          { value: "completeCategories", label: ui("Categories complete") },
          { value: "percent", label: ui("Progress") },
        ])}${periodGrid(
          page.rows
            .map((period) => {
              let percent = period.totalSlots
                ? Math.round((period.filledSlots / period.totalSlots) * 100)
                : 0;
              return `<article class="completion-period-card"><h4><a href="${escape(`${window.periodPageUrl(period.periodType, period.period)}&view=awards`)}">${escape(period.period)}</a></h4><div class="completion-period-card-stats"><span><b>${period.filledSlots} / ${period.totalSlots}</b> ${escape(ui("Slots filled"))}</span><span><b>${period.completeCategories} / ${period.categoryCount}</b> ${escape(ui("Categories complete"))}</span></div>${meterHtml(percent)}</article>`;
            })
            .join(""),
          "completion-bracket-period-grid",
          page.rows.length,
        )}`
        : window.renderLeaderboardTable({
          headers: [
            sortHeader("brackets", "period", ui("Period")),
            sortHeader("brackets", "filledSlots", ui("Slots filled")),
            sortHeader(
              "brackets",
              "completeCategories",
              ui("Categories complete"),
            ),
            sortHeader("brackets", "percent", ui("Progress")),
          ],
          rows: body,
          classes: "completion-table",
        })
      : `<p class="completion-empty">${escape(ui("All imported brackets are fully filled."))}</p>`;
    return `${content}${page.controls}${completeNote}`;
  }

  function fixedCategoryGrid(categories, renderCard, classes) {
    let rowsByCategory = new Map(
      categories.map((row) => [row.category, row]),
    );
    let slots = window.getCategoryPresentationSlots();
    let presented = new Set([
      "Best Picture",
      ...slots.filter(Boolean),
    ]);
    let card = (category) => {
      if (!category)
        return '<div class="category-board-spacer" aria-hidden="true"></div>';
      let row = rowsByCategory.get(category);
      return row
        ? renderCard(row)
        : '<div class="category-board-spacer" aria-hidden="true"></div>';
    };
    let extras = categories
      .filter((row) => !presented.has(row.category))
      .map(renderCard)
      .join("");
    return `<div class="category-index-grid completion-category-grid ${escape(classes)}">${card("Best Picture")}${slots.map(card).join("")}${extras}</div>`;
  }

  function bracketCategoryCompletionGrid(categories) {
    if (!categories.length || !categories[0].periodCount) {
      return `<p class="completion-empty">${escape(ui("No annual award brackets with watched films yet."))}</p>`;
    }
    return fixedCategoryGrid(
      categories,
      (row) => `<article class="browse-index-card category-index-card completion-category-card${row.category === "Best Picture" ? " full-width" : ""}">
    <h2><a href="${escape(window.categoryPageUrl(row.category))}">${escape(window.localizedCategoryName?.(row.category) || row.category)}</a></h2>
    <div class="completion-category-progress completion-bracket-category-progress"><div><span>${escape(ui("Slots filled"))}</span><b>${row.filledSlots} / ${row.totalSlots}</b>${meterHtml(row.percent)}</div><div><span>${escape(ui("Periods complete"))}</span><b>${row.completePeriods} / ${row.periodCount}</b></div></div>
  </article>`,
      "completion-bracket-category-grid",
    );
  }

  function watchGoalRowValue(row, key) {
    if (key === "period") return row.period || "";
    if (key === "watchedCount") return row.watchedCount || 0;
    return row.target ? row.watchedCount / row.target : 0;
  }

  function watchGoalTable(section, rows, periodType) {
    if (!rows.length) {
      return `<p class="completion-empty">${escape(ui("No watched films yet."))}</p>`;
    }
    let incomplete = rows.filter((row) => row.watchedCount < row.target);
    let completeCount = rows.length - incomplete.length;
    let sorted = sortRows(incomplete, section, watchGoalRowValue);
    let page = paginateRows(sorted, section, ui("periods"));
    let body = page.rows
      .map((row) => {
        let percent = Math.round((row.watchedCount / row.target) * 100);
        let project = window.projectForSource?.("watch-goal", row.sourceId);
        let projectAction =
          project || row.projectCandidateCount
            ? minimalSourceProjectAction(
              "watch-goal",
              row.sourceId,
              projectColumnActionOptions(),
            )
            : "";
        return `<tr>
    <td><a class="period-link" href="${escape(`${window.periodPageUrl(periodType, row.period)}&view=films`)}"><strong>${escape(row.period)}</strong></a></td>
    <td>${row.watchedCount} / ${row.target}</td>
    <td class="completion-cell">${meterHtml(percent)}</td>
    <td>${projectAction}</td>
  </tr>`;
      })
      .join("");
    let completeNote = completeCount
      ? `<p class="completion-note">${escape(ui("{count} more already at or past the goal.", { count: completeCount }))}</p>`
      : "";
    let content = page.rows.length
      ? layout === "grid"
        ? `${periodGridControls(section, [
          { value: "period", label: ui("Period") },
          { value: "watchedCount", label: ui("Watched") },
          { value: "percent", label: ui("Progress") },
        ])}${periodGrid(
          page.rows
            .map((row) => {
              let percent = Math.round((row.watchedCount / row.target) * 100);
              let project = window.projectForSource?.(
                "watch-goal",
                row.sourceId,
              );
              let projectAction =
                project || row.projectCandidateCount
                  ? minimalSourceProjectAction("watch-goal", row.sourceId)
                  : "";
              return `<article class="completion-period-card"><header><h4><a href="${escape(`${window.periodPageUrl(periodType, row.period)}&view=films`)}">${escape(row.period)}</a></h4>${projectAction}</header><div class="completion-period-card-stats"><span><b>${row.watchedCount} / ${row.target}</b> ${escape(ui("Watched"))}</span></div>${meterHtml(percent)}</article>`;
            })
            .join(""),
          "completion-watch-goal-grid",
          page.rows.length,
        )}`
        : window.renderLeaderboardTable({
          headers: [
            sortHeader(section, "period", ui("Period")),
            sortHeader(section, "watchedCount", ui("Watched")),
            sortHeader(section, "percent", ui("Progress")),
            escape(ui("Project")),
          ],
          rows: body,
          classes: "completion-table",
        })
      : `<p class="completion-empty">${escape(ui("Every period has reached its goal."))}</p>`;
    return `${content}${page.controls}${completeNote}`;
  }

  function watchGoalSubsection(section, label, rows, periodType) {
    return `<div class="completion-subsection"><h3>${escape(label)}</h3>${watchGoalTable(section, rows, periodType)}</div>`;
  }

  function oscarGroupProgress(group) {
    return `<div class="oscar-completion-progress"><b>${group.watchedCount} / ${group.total}</b>${meterHtml(group.percent)}</div>`;
  }

  function oscarProjectAction(group, label) {
    let action = minimalSourceProjectAction("official-results", group.sourceId);
    return `<div class="oscar-project-action"><span>${escape(label)}</span><div>${action}${oscarWatchlistButton(group)}</div></div>`;
  }

  function oscarProjectButton(group, options = {}) {
    return minimalSourceProjectAction(
      "official-results",
      group.sourceId,
      options,
    );
  }

  function oscarWatchlistButton(group, options = {}) {
    if (!canEdit) return "";
    let plan = window.officialOscarWatchlistPlan?.(
      group.sourceId,
      oscarCompletion,
    );
    if (!plan || (!plan.ready.length && !plan.needsReview.length)) return "";
    let label = plan.ready.length
      ? options.shortLabel
        ? ui("Add unseen")
        : ui("Add {count} unseen", { count: plan.ready.length })
      : ui("Review {count}", { count: plan.needsReview.length });
    let title = plan.needsReview.length
      ? ui("{ready} ready; {review} need year review", {
          ready: plan.ready.length,
          review: plan.needsReview.length,
        })
      : ui("Add unseen films to tier {tier}", {
          tier: oscarWatchlistTier,
        });
    return `<button type="button" class="sort-order-button completion-watchlist-action" data-add-oscar-watchlist="${escape(group.sourceId)}" title="${escape(title)}">${escape(label)}</button>`;
  }

  function oscarWatchlistActionPair(group, options = {}) {
    return `${oscarProjectButton(group, options)}${oscarWatchlistButton(group, {
      shortLabel: true,
    })}`;
  }

  function oscarSummaryCard(title, subtitle, group) {
    return `<article class="oscar-completion-card"><header><div><span class="eyebrow">${escape(ui("Oscar completion"))}</span><h3>${escape(title)}</h3><p>${escape(subtitle)}</p></div>${oscarGroupProgress(group)}</header>${oscarProjectAction(group, ui("Collection project"))}</article>`;
  }

  function oscarCategoryMetric(group, label) {
    return `<div class="oscar-category-metric"><div class="oscar-category-metric-header"><span><b>${escape(label)}</b><strong>${group.watchedCount} / ${group.total}</strong></span><div class="oscar-category-actions">${oscarWatchlistActionPair(group)}</div></div>${meterHtml(group.percent)}</div>`;
  }

  function oscarPeriodRowValue(row, key) {
    if (key === "period") return row.period || "";
    if (key === "winnerPercent") return row.winners.percent || 0;
    return row.nominees.percent || 0;
  }

  function oscarPeriodCompletion(periods) {
    let incomplete = periods.filter(
      (period) => period.nominees.watchedCount < period.nominees.total,
    );
    let completeCount = periods.length - incomplete.length;
    let sorted = sortRows(incomplete, "oscarPeriods", oscarPeriodRowValue);
    let page = paginateRows(sorted, "oscarPeriods", ui("periods"));
    let rows = page.rows
      .map((period) => {
        let projectAction = oscarWatchlistActionPair(
          period.nominees,
          projectColumnActionOptions(),
        );
        return `<tr>
    <td><a class="period-link" href="${escape(period.href)}"><strong>${escape(period.period)}</strong></a></td>
    <td class="completion-cell">${oscarGroupProgress(period.winners)}</td>
    <td class="completion-cell">${oscarGroupProgress(period.nominees)}</td>
    <td>${projectAction}</td>
  </tr>`;
      })
      .join("");
    let completeNote = completeCount
      ? `<p class="completion-note">${escape(ui("{count} more official periods already fully watched.", { count: completeCount }))}</p>`
      : "";
    let content = page.rows.length
      ? layout === "grid"
        ? `${periodGridControls("oscarPeriods", [
          { value: "period", label: ui("Period") },
          { value: "winnerPercent", label: ui("Winners") },
          { value: "nomineePercent", label: ui("Nominees") },
        ])}${periodGrid(
          page.rows
            .map(
              (period) => `<article class="completion-period-card completion-oscar-period-card"><header><h4><a href="${escape(period.href)}">${escape(period.period)}</a></h4><div class="oscar-category-actions">${oscarWatchlistActionPair(period.nominees)}</div></header><div class="completion-oscar-period-metrics"><div><span>${escape(ui("Winners"))}</span>${oscarGroupProgress(period.winners)}</div><div><span>${escape(ui("Nominees"))}</span>${oscarGroupProgress(period.nominees)}</div></div></article>`,
            )
            .join(""),
          "completion-oscar-period-grid",
          page.rows.length,
        )}`
        : window.renderLeaderboardTable({
          headers: [
            sortHeader("oscarPeriods", "period", ui("Period")),
            sortHeader("oscarPeriods", "winnerPercent", ui("Winners watched")),
            sortHeader("oscarPeriods", "nomineePercent", ui("Nominees watched")),
            escape(ui("Actions")),
          ],
          rows,
          classes: "completion-table",
        })
      : `<p class="completion-empty">${escape(ui("Every official Oscar period is fully watched."))}</p>`;
    return `${content}${page.controls}${completeNote}`;
  }

  function oscarCategoryGrid(categories) {
    if (!categories.length)
      return `<p class="completion-empty">${escape(ui("No official Academy Awards data imported yet."))}</p>`;
    return fixedCategoryGrid(
      categories,
      (row) => `<article class="browse-index-card category-index-card completion-category-card completion-oscar-category-card${row.category === "Best Picture" ? " full-width" : ""}">
    <h2><a href="${escape(window.categoryPageUrl(row.category))}&view=official">${escape(window.localizedCategoryName?.(row.category) || row.category)}</a></h2>
    <div class="completion-category-progress">${oscarCategoryMetric(row.winners, ui("Winners"))}${oscarCategoryMetric(row.nominees, ui("Nominees"))}</div>
  </article>`,
      "completion-oscar-category-grid",
    );
  }

  function oscarCompletionHtml() {
    if (!oscarCompletion.source || !oscarCompletion.periodKeys.length)
      return `<p class="completion-empty">${escape(ui("No official Academy Awards data imported yet."))}</p>`;
    let firstPeriod = oscarCompletion.periodKeys[0];
    let lastPeriod =
      oscarCompletion.periodKeys[oscarCompletion.periodKeys.length - 1];
    let overallPlan = window.officialOscarWatchlistPlan?.(
      oscarCompletion.nominees.sourceId,
      oscarCompletion,
    );
    let tierOptions = window.WATCHLIST_TIERS.map(
      (tier) =>
        `<option value="${tier}"${tier === oscarWatchlistTier ? " selected" : ""}>${tier}</option>`,
    ).join("");
    let watchlistTools = canEdit
      ? `<div class="oscar-watchlist-tools"><label><span>${escape(ui("Add unseen to interest tier"))}</span><select data-oscar-watchlist-tier>${tierOptions}</select></label><span>${escape(ui("Unambiguous scopes add immediately."))}</span></div>${oscarWatchlistStatus ? `<p class="data-panel-status oscar-watchlist-status" role="status" data-oscar-watchlist-status>${escape(oscarWatchlistStatus)}${lastOscarWatchlistAddition?.length ? ` <button type="button" class="link-button" data-undo-oscar-watchlist>${escape(ui("Undo"))}</button>` : ""}</p>` : ""}`
      : "";
    let reviewQueue = overallPlan?.needsReview.length
      ? `<details class="oscar-watchlist-review"><summary>${escape(ui("{count} films need year review", { count: overallPlan.needsReview.length }))}</summary><p>${escape(ui("Multi-year ceremonies stay out of the watchlist until their release year is known."))}</p><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Film"))}</th><th>${escape(ui("Ceremony"))}</th><th>${escape(ui("Possible years"))}</th></tr></thead><tbody>${overallPlan.needsReview
          .map(
            (candidate) => `<tr><td><strong>${escape(candidate.title)}</strong></td><td><a class="period-link" href="${escape(candidate.href)}">${escape(candidate.periodKey)}</a></td><td>${escape(candidate.possibleYears.join(" / "))}</td></tr>`,
          )
          .join("")}</tbody></table></div></details>`
      : "";
    return `${watchlistTools}<p class="completion-note oscar-completion-scope">${escape(ui("Based on {count} imported Academy Awards periods, {first}–{last}.", {
      count: oscarCompletion.periodKeys.length,
      first: firstPeriod,
      last: lastPeriod,
    }))}</p>${reviewQueue}<div class="oscar-completion-highlights">${oscarSummaryCard(
      ui("Oscar-winning films watched"),
      ui("Distinct films that won at least one imported category."),
      oscarCompletion.winners,
    )}${oscarSummaryCard(
      ui("Oscar-nominated films watched"),
      ui("Distinct nominated films, including winners."),
      oscarCompletion.nominees,
    )}</div><div class="completion-subsection"><h3>${escape(ui("Years"))}</h3>${oscarPeriodCompletion(oscarCompletion.periods)}</div><div class="completion-subsection"><h3>${escape(ui("By category"))}</h3>${oscarCategoryGrid(oscarCompletion.categories)}</div>`;
  }

  function oscarWatchlistDialog() {
    let plan = pendingOscarWatchlistPlan;
    if (!plan) return "";
    let reviewRows = plan.needsReview
      .slice(0, 20)
      .map(
        (candidate) => `<li><strong>${escape(candidate.title)}</strong> · ${escape(candidate.periodKey)} (${escape(candidate.possibleYears.join(" / "))})</li>`,
      )
      .join("");
    return `<dialog id="oscarWatchlistDialog" class="oscar-watchlist-dialog"><form method="dialog"><h2>${escape(ui("Add unseen Oscar films?"))}</h2><p>${escape(ui("{ready} films are ready for tier {tier}. {review} need year review and will be skipped.", {
      ready: plan.ready.length,
      tier: oscarWatchlistTier,
      review: plan.needsReview.length,
    }))}</p>${reviewRows ? `<details open><summary>${escape(ui("Needs review"))}</summary><ul>${reviewRows}</ul></details>` : ""}<div class="dialog-actions"><button type="button" data-cancel-oscar-watchlist>${escape(ui("Cancel"))}</button>${plan.ready.length ? `<button type="button" data-confirm-oscar-watchlist>${escape(ui("Add {count} films", { count: plan.ready.length }))}</button>` : ""}</div></form></dialog>`;
  }

  function updateOscarWatchlistStatus(message) {
    oscarWatchlistStatus = message;
    let status = container.querySelector("[data-oscar-watchlist-status]");
    if (status) status.firstChild.textContent = message;
  }

  async function enrichOscarWatchlistItems(items) {
    if (!items.length || typeof window.fetch !== "function") return;
    let settings = window.getPosterSettings?.() || {};
    let metadata = { attempted: 0, found: 0, failed: 0 };
    if (settings.tmdbCredential && window.fetchWatchlistMetadata) {
      updateOscarWatchlistStatus(
        ui("Fetching metadata for {count} films…", { count: items.length }),
      );
      metadata = await window.fetchWatchlistMetadata(items, {
        settings,
        limit: items.length,
        concurrency: 3,
        onProgress(done, total) {
          updateOscarWatchlistStatus(
            ui("Fetching metadata: {done}/{total}", { done, total }),
          );
        },
      });
    }
    let posterCandidates = items.filter((item) => !item.poster);
    let posters = { attempted: 0, found: 0, failed: 0 };
    if (posterCandidates.length && window.fetchWatchlistPosters) {
      updateOscarWatchlistStatus(
        ui("Fetching posters for {count} films…", {
          count: posterCandidates.length,
        }),
      );
      posters = await window.fetchWatchlistPosters(posterCandidates, {
        settings,
        limit: posterCandidates.length,
        concurrency: 3,
        onProgress(done, total) {
          updateOscarWatchlistStatus(
            ui("Fetching posters: {done}/{total}", { done, total }),
          );
        },
      });
    }
    oscarWatchlistStatus = ui(
      "Added {count} films. Found metadata for {metadata} and posters for {posters}.",
      {
        count: items.length,
        metadata: metadata.found,
        posters: posters.found,
      },
    );
    render();
  }

  async function addOscarWatchlistSource(sourceId) {
    let plan = window.officialOscarWatchlistPlan?.(sourceId);
    if (!plan) return;
    oscarWatchlistStatus = ui("Adding {count} films…", {
      count: plan.ready.length,
    });
    pendingOscarWatchlistPlan = null;
    render();
    let result = window.applyOfficialOscarWatchlistPlan?.(
      sourceId,
      oscarWatchlistTier,
    );
    if (!result?.ok) {
      oscarWatchlistStatus = result?.reason || ui("Films could not be added.");
      render();
      return;
    }
    if (result.persisted?.then) await result.persisted;
    lastOscarWatchlistAddition = result.added.map((item) => item.id);
    oscarCompletion = window.officialOscarCompletion();
    oscarWatchlistStatus = result.added.length
      ? ui("Added {count} films to tier {tier}.", {
          count: result.added.length,
          tier: result.tier,
        })
      : ui("No new films to add.");
    render();
    if (result.added.length) await enrichOscarWatchlistItems(result.added);
  }

  function completionSection(id, title, subtitle, bodyHtml) {
    return `<section class="completion-section" id="completion-${escape(id)}" data-collapsible-section><header class="completion-section-header" data-collapsible-heading><div><h2>${escape(title)}</h2><p>${escape(subtitle)}</p></div></header><div class="completion-section-body" data-collapsible-body>${bodyHtml}</div></section>`;
  }

  let inProgressTotal =
    hub.directors.length + hub.franchises.length + hub.projects.length;
  let bracketSummary = bracketCompletion.reduce(
    (summary, row) => ({
      filled: summary.filled + row.filledSlots,
      total: summary.total + row.totalSlots,
    }),
    { filled: 0, total: 0 },
  );
  let watchGoals = [
    ...watchGoalYears,
    ...watchGoalDecades,
    ...watchGoalCenturies,
  ];
  let reachedWatchGoals = watchGoals.filter(
    (row) => row.watchedCount >= row.target,
  ).length;

  function render() {
    let summaryHtml = window.renderDetailStats({
      classes: "completion-summary",
      itemsHtml: `
  <span><b>${oscarCompletion.winners.watchedCount}/${oscarCompletion.winners.total}</b> ${escape(ui("Oscar-winning films watched"))}</span>
  <span><b>${oscarCompletion.nominees.watchedCount}/${oscarCompletion.nominees.total}</b> ${escape(ui("Oscar-nominated films watched"))}</span>
  <span><b>${hub.directors.length}</b> ${escape(ui("Directors in progress"))}</span>
  <span><b>${hub.franchises.length}</b> ${escape(ui("Franchises in progress"))}</span>
  <span><b>${hub.projects.length}</b> ${escape(ui("Projects in progress"))}</span>
  <span><b>${hub.completeDirectors + hub.completeFranchises + hub.completeProjects}</b> ${escape(ui("Complete"))}</span>
  <span><b>${bracketSummary.filled}/${bracketSummary.total}</b> ${escape(ui("Bracket slots filled"))}</span>
  <span><b>${reachedWatchGoals}/${watchGoals.length}</b> ${escape(ui("Watch goals reached"))}</span>
`,
    });

    container.innerHTML = `<header class="completion-hero">
  <h1>${escape(ui("Completion"))}</h1>
  <p>${escape(ui("Oscar completion covers every imported official nominee. Director, franchise, and project completion covers known films in the archive and watchlist."))}</p>
  ${summaryHtml}
</header>
<div class="completion-view-toolbar"><span>${escape(ui("Completion display"))}</span>${window.renderFilmViewToggle({
      view: layout,
      listUrl: completionViewUrl("list"),
      gridUrl: completionViewUrl("grid"),
      escape,
      ariaLabel: ui("Completion display"),
    })}</div>
${completionSection(
  "watch-goals",
  ui("Watch goals"),
  ui(
    "Coverage targets per period — {yearGoal} films per year, {decadeGoal} per decade, {centuryGoal} per century — separate from award nominee coverage.",
    {
      yearGoal: window.WATCH_GOAL_TARGETS.year,
      decadeGoal: window.WATCH_GOAL_TARGETS.decade,
      centuryGoal: window.WATCH_GOAL_TARGETS.century,
    },
  ),
  `${watchGoalSubsection("watchGoalYears", ui("Years"), watchGoalYears, "year")}${watchGoalSubsection("watchGoalDecades", ui("Decades"), watchGoalDecades, "decade")}${watchGoalSubsection("watchGoalCenturies", ui("Centuries"), watchGoalCenturies, "century")}`,
)}
${completionSection(
  "directors",
  ui("Directors"),
  ui("Directors with at least 3 known films and something left to watch."),
  completionTable("directors", hub.directors, hub.completeDirectors, {
    nameLabel: ui("Director"),
    itemLabel: ui("directors"),
    emptyText: ui("No director watchlist data yet."),
  }),
)}
${completionSection(
  "franchises",
  ui("Franchises"),
  ui("Multi-film franchises with unwatched entries, ranked by progress."),
  completionTable("franchises", hub.franchises, hub.completeFranchises, {
    nameLabel: ui("Franchise"),
    itemLabel: ui("franchises"),
    emptyText: ui("No franchise watchlist data yet."),
  }),
)}
${completionSection(
  "projects",
  ui("Projects"),
  ui("Open watch projects ranked by progress."),
  completionTable("projects", hub.projects, hub.completeProjects, {
    nameLabel: ui("Project"),
    itemLabel: ui("projects"),
    emptyText: ui("No projects yet"),
  }),
)}
${completionSection(
  "oscars",
  ui("Oscar film completion"),
  ui("Films watched from the imported official Academy Awards winners and nominees — overall, by year, and by category."),
  oscarCompletionHtml(),
)}
${completionSection(
  "brackets",
  ui("Award brackets"),
  ui("How much of each imported award period's category slots are filled in — data entry, not watch progress."),
  `${bracketCompletionTable(bracketCompletion)}<div class="completion-subsection completion-bracket-categories"><h3>${escape(ui("By category"))}</h3><p>${escape(ui("Annual award slots across years with at least one watched film."))}</p>${bracketCategoryCompletionGrid(bracketCategoryCompletion)}</div>`,
)}
${inProgressTotal || oscarCompletion.nominees.total ? "" : `<div class="detail-empty"><h2>${escape(ui("Nothing in progress."))}</h2><p>${escape(ui("Import a watchlist or start a project to track completion."))}</p></div>`}
${oscarWatchlistDialog()}`;

    container
      .querySelectorAll(".completion-section .leaderboard-wrap")
      .forEach((wrapper) => wrapper.setAttribute("data-collapsible-skip", ""));
    window.enhanceCollapsibles?.(container);
  }

  let finishRenderTimer = window.startOskarsPerformance?.("completion:render");
  render();
  finishRenderTimer?.(
    `${inProgressTotal} in progress, ${hub.completeDirectors + hub.completeFranchises + hub.completeProjects} complete, ${oscarCompletion.nominees.watchedCount}/${oscarCompletion.nominees.total} official Oscar films watched, ${bracketCompletion.length} bracket period(s)`,
  );

  container.addEventListener("click", async (event) => {
    let addWatchlistButton = event.target.closest(
      "[data-add-oscar-watchlist]",
    );
    if (addWatchlistButton) {
      let sourceId = addWatchlistButton.dataset.addOscarWatchlist;
      let plan = window.officialOscarWatchlistPlan?.(sourceId);
      if (!plan) return;
      if (plan.needsReview.length) {
        pendingOscarWatchlistPlan = plan;
        render();
        let dialog = container.querySelector("#oscarWatchlistDialog");
        if (dialog?.showModal) dialog.showModal();
        else dialog?.setAttribute("open", "");
      } else await addOscarWatchlistSource(sourceId);
      return;
    }
    if (event.target.closest("[data-confirm-oscar-watchlist]")) {
      let sourceId = pendingOscarWatchlistPlan?.sourceId;
      if (sourceId) await addOscarWatchlistSource(sourceId);
      return;
    }
    if (event.target.closest("[data-cancel-oscar-watchlist]")) {
      pendingOscarWatchlistPlan = null;
      render();
      return;
    }
    if (event.target.closest("[data-undo-oscar-watchlist]")) {
      let result = window.undoOfficialOscarWatchlistAdd?.(
        lastOscarWatchlistAddition || [],
      );
      if (result?.persisted?.then) await result.persisted;
      lastOscarWatchlistAddition = null;
      oscarCompletion = window.officialOscarCompletion();
      oscarWatchlistStatus = result?.ok
        ? ui("Removed {count} recently added films.", {
            count: result.removed.length,
          })
        : result?.reason || ui("Undo failed.");
      render();
      return;
    }
    let projectButton = event.target.closest(
      "[data-start-project-source]",
    );
    if (projectButton) {
      projectButton.disabled = true;
      await window.startProjectFromSourceAndOpen?.(
        projectButton.dataset.startProjectSource,
        projectButton.dataset.projectSourceId,
      );
      projectButton.disabled = false;
      return;
    }
    let pageButton = event.target.closest("[data-completion-page]");
    if (pageButton) {
      let pagination = pageButton.closest("[data-completion-pagination]");
      if (pagination) {
        pageState[pagination.dataset.completionPagination] = Number(
          pageButton.dataset.completionPage,
        );
        render();
      }
      return;
    }
    let directionButton = event.target.closest(
      "[data-completion-sort-direction]",
    );
    if (directionButton) {
      let section = directionButton.dataset.completionSortDirection;
      sortState[section].dir *= -1;
      pageState[section] = 1;
      render();
      return;
    }
    let button = event.target.closest("[data-sort-section]");
    if (!button) return;
    let section = button.dataset.sortSection;
    let key = button.dataset.sortKey;
    let state = sortState[section];
    pageState[section] = 1;
    if (state.key === key) state.dir *= -1;
    else {
      state.key = key;
      state.dir = sortDefaultDir[key] ?? -1;
    }
    render();
  });

  container.addEventListener("change", (event) => {
    let tierInput = event.target.closest("[data-oscar-watchlist-tier]");
    if (tierInput) {
      let tier = window.normalizeWatchlistTier?.(tierInput.value);
      if (tier) {
        oscarWatchlistTier = tier;
        try {
          localStorage.setItem(OSCAR_WATCHLIST_TIER_KEY, tier);
        } catch (err) {}
      }
      return;
    }
    let input = event.target.closest("[data-completion-sort-axis]");
    if (!input) return;
    let section = input.dataset.completionSortAxis;
    pageState[section] = 1;
    sortState[section].key = input.value;
    sortState[section].dir = sortDefaultDir[input.value] ?? -1;
    render();
  });
})();
