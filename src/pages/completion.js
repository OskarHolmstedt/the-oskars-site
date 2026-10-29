/** @file Renders the official-results (issue #344: every populated source, not just Oscars), watch-goal, bracket, and known-film completion dashboard. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("completionPage");
  document.title = `${ui("Completion")} · The Oskars`;

  // Compact Completion read (issue #597): official-results, award-bracket,
  // and watch-goal completion paint fast from a compact projection
  // instead of the eager full hydration every other entry still gets.
  // Directors/franchises/projects ("known collections") always need the
  // complete archive (the shared people/franchise indexes many other
  // pages also depend on), so hub starts empty and fills in once the
  // eager background full hydration below completes -
  // completionCompactActive never flips back to true once hydration
  // succeeds, so every other completion.js function (including every
  // write action) runs completely unmodified from that point on.
  let completionCompactActive = Boolean(window.OSKARS_COMPLETION_COMPACT);
  let compactCompletionSource = null;
  let compactWatchedState = null;
  let compactCompletionError = null;
  let officialResultsHydrated = false;
  let completionHydrationPromise = null;

  let canonicalLists = [];
  let canonicalListTiers = new Map();
  let canonicalListStatuses = new Map();
  let lastCanonicalListAdditions = new Map();
  let canonicalListFilters = new Map();
  let canonicalExpandedLists = new Set();

  function canonicalListTierKey(listId) {
    return `oskars-canonical-list-tier-${listId}`;
  }
  function preferredCanonicalListTier(listId) {
    try {
      return (
        window.watchlistTierKey(
          localStorage.getItem(canonicalListTierKey(listId)),
        ) || "C"
      );
    } catch (err) {
      return "C";
    }
  }

  function refreshCanonicalLists(stateOverride) {
    let options = stateOverride ? { state: stateOverride } : {};
    canonicalLists = [
      ...(window.allCanonicalListsCompletion?.(options) || new Map()).values(),
    ];
    canonicalLists.forEach((list) => {
      if (!canonicalListTiers.has(list.id)) {
        canonicalListTiers.set(list.id, preferredCanonicalListTier(list.id));
      }
    });
  }

  // Completion hub (issue #17): directors, franchises, and projects ranked by
  // progress toward watching everything the archive + watchlist know about.
  let finishCollectTimer =
    window.startOskarsPerformance?.("completion:collect");
  let emptyHub = {
    directors: [],
    franchises: [],
    projects: [],
    completeDirectors: 0,
    completeFranchises: 0,
    completeProjects: 0,
  };
  let hub = completionCompactActive ? emptyHub : window.completionHubData();
  // Award-bracket completion (moved here from the Data Health report): how
  // much of each imported award period's category slots are filled in,
  // independent of watch progress below.
  let bracketCompletion = completionCompactActive
    ? []
    : window.awardBracketCompletion();
  let bracketCategoryCompletion = completionCompactActive
    ? []
    : window.awardBracketCategoryCompletion();
  // One completion section per populated official-results source (issue
  // #344), not just Oscars - academy-awards sorts first to keep this page's
  // established section order, any other source follows in whatever order
  // Object.keys() returns (import order). The "oscar-*"/"official-oscar-*"
  // CSS classes below are deliberately kept as-is and reused for every
  // source: they're generic styling hooks now, not Oscar-specific, and
  // renaming them would touch styles/app.css and a long tail of test
  // literals for zero functional or visible benefit.
  // Reassigned by refreshOfficialCompletions() (legacy mode) or
  // applyCompactOfficialModel() (compact mode), including on the
  // post-hydration re-render.
  let officialSourceIds = [];
  let officialCompletions = new Map();
  function refreshOfficialCompletions() {
    let finishOfficial = window.startOskarsPerformance?.(
      "completion:officialCollect",
    );
    officialSourceIds = Object.keys(window.state?.officialResults || {}).sort(
      (a, b) => (a === "academy-awards" ? -1 : b === "academy-awards" ? 1 : 0),
    );
    officialCompletions = new Map(
      officialSourceIds.map((sourceId) => [
        sourceId,
        window.officialCollectionCompletion(sourceId),
      ]),
    );
    finishOfficial?.();
  }
  // Both the compact projection fetch and the live official-results fetch
  // (window.hydrateOfficialResultsFromSupabase(), already independent and
  // lazy) can resolve in either order - only recompute once both are in.
  function applyCompactOfficialModel() {
    if (!compactCompletionSource || !officialResultsHydrated) return;
    let finishOfficial = window.startOskarsPerformance?.(
      "completion:officialCollect",
    );
    officialCompletions = window.buildSupabaseCompletionOfficialModel(
      compactCompletionSource,
      window.state?.officialResults || {},
      compactWatchedState,
    );
    officialSourceIds = [...officialCompletions.keys()];
    ensureOfficialSortState();
    // Backfill only - never overwrite an existing entry, since a user's
    // in-session tier change must survive this. officialWatchlistTiers
    // starts empty in compact mode (officialSourceIds is [] until this
    // function's first real call), so this is the actual place new source
    // ids need a default tier, not just the legacy hydrateOfficialResults-
    // FromSupabase() callback below (which may resolve before or after
    // this, in either order).
    officialSourceIds.forEach((sourceId) => {
      if (!officialWatchlistTiers.has(sourceId))
        officialWatchlistTiers.set(
          sourceId,
          preferredOfficialWatchlistTier(sourceId),
        );
    });
    finishOfficial?.();
  }
  if (!completionCompactActive) {
    refreshOfficialCompletions();
    refreshCanonicalLists();
  }

  /**
   * Resolves once window.state holds the complete archive (issue #597).
   * A no-op once already hydrated. Runs when the directors, franchises or
   * projects section is seen (issue #636), and every write action below
   * (official watchlist-add, "Start project") calls it first, so a write
   * always waits for real data instead of risking a partial-state write;
   * #607's own
   * reconcile() guard is the last-resort backstop this is meant to make
   * normally unreachable, not depended on for correctness.
   * @returns {Promise<void>}
   */
  function ensureCompletionFullyHydrated() {
    if (!completionCompactActive) return Promise.resolve();
    if (completionHydrationPromise) return completionHydrationPromise;
    completionHydrationPromise = (
      window.ensureFocusedShellData?.() || Promise.resolve()
    )
      .then(() => {
        completionCompactActive = false;
        compactCompletionSource = null;
        compactWatchedState = null;
        refreshOfficialCompletions();
        refreshCanonicalLists();
        hub = window.completionHubData();
        bracketCompletion = window.awardBracketCompletion();
        bracketCategoryCompletion = window.awardBracketCategoryCompletion();
        watchGoalYears = window.watchGoalProgress("year");
        watchGoalDecades = window.watchGoalProgress("decade");
        watchGoalCenturies = window.watchGoalProgress("century");
        watchGoalAllTime = window.watchGoalProgress("alltime")?.[0] || null;
        ensureOfficialSortState();
        render();
      })
      .catch((error) => {
        // Leaves completionCompactActive true so a later interaction can
        // try again; the compact sections keep showing their last-fetched
        // data in the meantime, so a transient hydration failure doesn't
        // break browsing, only temporarily disables writes and the known-
        // collections section.
        completionHydrationPromise = null;
        throw error;
      });
    return completionHydrationPromise;
  }

  /** Fetches the compact Completion projection once (issue #597) and re-renders when it resolves. The complete archive loads only once a section that needs it is seen, or an action needs it (issue #636). */
  function ensureCompactCompletionFresh() {
    if (!completionCompactActive || compactCompletionSource) return;
    window
      .loadSupabaseCompletionWatchedProjection()
      .then((source) => {
        compactCompletionSource = source;
        let watchedState = window.buildSupabaseCompletionWatchedState(source);
        compactWatchedState = watchedState;
        let bracketModel = window.buildSupabaseCompletionBracketModel(
          source,
          watchedState,
        );
        bracketCompletion = bracketModel.bracketCompletion;
        bracketCategoryCompletion = bracketModel.bracketCategoryCompletion;
        let goalModel = window.buildSupabaseCompletionWatchGoalModel(
          source,
          watchedState,
        );
        watchGoalYears = goalModel.watchGoalYears;
        watchGoalDecades = goalModel.watchGoalDecades;
        watchGoalCenturies = goalModel.watchGoalCenturies;
        watchGoalAllTime =
          goalModel.watchGoalAllTime ||
          window.watchGoalProgress("alltime", { state: watchedState })?.[0] ||
          null;
        refreshCanonicalLists(watchedState);
        applyCompactOfficialModel();
        render();
      })
      .catch((error) => {
        compactCompletionError = error;
        render();
      });
  }
  ensureCompactCompletionFresh();

  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  function officialWatchlistTierKey(sourceId) {
    return `oskars-official-watchlist-tier-${sourceId}`;
  }
  function preferredOfficialWatchlistTier(sourceId) {
    try {
      return (
        window.watchlistTierKey(
          localStorage.getItem(officialWatchlistTierKey(sourceId)),
        ) || "C"
      );
    } catch (err) {
      return "C";
    }
  }
  let officialWatchlistTiers = new Map(
    officialSourceIds.map((sourceId) => [
      sourceId,
      preferredOfficialWatchlistTier(sourceId),
    ]),
  );
  // Status and last-addition stay independent per source (each section's own
  // watchlist action shouldn't clobber another section's), but only one
  // needs-review dialog is ever open at a time, so that stays a single value
  // carrying its own sourceId/scopeId (officialCollectionWatchlistPlan()'s
  // return already has both).
  let officialWatchlistStatuses = new Map();
  let lastOfficialWatchlistAdditions = new Map();
  let pendingOfficialWatchlistPlan = null;
  // Watch-count goals per period: how many films have actually been watched
  // from each year/decade/century against a flat target, separate from
  // award nominee coverage above.
  let watchGoalYears = completionCompactActive
    ? []
    : window.watchGoalProgress("year");
  let watchGoalDecades = completionCompactActive
    ? []
    : window.watchGoalProgress("decade");
  let watchGoalCenturies = completionCompactActive
    ? []
    : window.watchGoalProgress("century");
  let watchGoalAllTime = completionCompactActive
    ? null
    : window.watchGoalProgress("alltime")?.[0] || null;
  finishCollectTimer?.(
    `${hub.directors.length} directors, ${hub.franchises.length} franchises, ${hub.projects.length} projects, ${officialSourceIds.map((sourceId) => officialCompletions.get(sourceId).films.length).join("/")} official film(s) by source, ${bracketCompletion.length} bracket period(s), ${watchGoalYears.length}/${watchGoalDecades.length}/${watchGoalCenturies.length} year/decade/century goal(s)`,
  );

  const PAGE_SIZE = 10;
  let layout = window.filmViewMode("list");
  let pageState = {};

  // Per-section sort state, toggled by table headers or grid controls.
  // `dir` is 1 for ascending, -1 for descending.
  function officialPeriodsSortSection(sourceId) {
    return `officialPeriods:${sourceId}`;
  }
  let sortState = {
    canonicalLists: { key: "percent", dir: -1 },
    directors: { key: "percent", dir: -1 },
    franchises: { key: "percent", dir: -1 },
    projects: { key: "percent", dir: -1 },
  };
  // Backfill only - never overwrite an existing entry, since a user's
  // in-session sort change must survive a later call (the post-hydration
  // refresh below can introduce a source id that wasn't present yet at
  // this first call, e.g. one added to Supabase after the bundled
  // default was last regenerated - without this guard, sortRows/
  // sortHeader would dereference sortState[section].key on undefined
  // for that source and crash the whole page render).
  function ensureOfficialSortState() {
    officialSourceIds.forEach((sourceId) => {
      sortState[officialPeriodsSortSection(sourceId)] ||= {
        key: "nomineePercent",
        dir: -1,
      };
    });
  }
  ensureOfficialSortState();
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
    let tab = window.pageQueryParam("tab");
    return `completion.html?view=${escape(view)}${tab ? `&amp;tab=${escape(encodeURIComponent(tab))}` : ""}`;
  }

  function completionGridControls(section, options) {
    let state = sortState[section];
    return `<div class="completion-grid-controls">${window.renderSortAxisControl(
      {
        escape,
        value: state.key,
        attribute: `data-completion-sort-axis="${escape(section)}"`,
        axes: [
          { value: "name", label: options.nameLabel },
          { value: "watchedCount", label: ui("Watched") },
          { value: "watchlistCount", label: ui("To watch") },
          { value: "percent", label: ui("Complete") },
        ],
      },
    )}${window.renderChronologyControl({
      order: state.dir === 1 ? "asc" : "desc",
      iconOnly: true,
      escape,
      title: ui("Reverse order"),
      attribute: `data-completion-sort-direction="${escape(section)}"`,
    })}</div>`;
  }

  function periodGridControls(section, axes) {
    let state = sortState[section];
    return `<div class="completion-grid-controls">${window.renderSortAxisControl(
      {
        escape,
        value: state.key,
        attribute: `data-completion-sort-axis="${escape(section)}"`,
        axes,
      },
    )}${window.renderChronologyControl({
      order: state.dir === 1 ? "asc" : "desc",
      iconOnly: true,
      escape,
      title: ui("Reverse order"),
      attribute: `data-completion-sort-direction="${escape(section)}"`,
    })}</div>`;
  }

  function periodGrid(cards, classes = "", itemCount = 0) {
    let countClass =
      itemCount === PAGE_SIZE ? " completion-period-grid--full-page" : "";
    return `<div class="completion-period-grid${countClass} ${escape(classes)}">${cards}</div>`;
  }

  function minimalSourceProjectAction(sourceType, sourceId, options = {}) {
    let actionClass = `sort-order-button completion-project-action${options.shortAction ? " completion-project-action--short" : ""}`;
    return window.renderSourceProjectAction(sourceType, sourceId, {
      escape,
      compact: true,
      linkClass: `${actionClass} completion-project-action--view`,
      linkOnlyWhenExisting: true,
      viewText: options.viewText,
    });
  }

  function projectColumnActionOptions() {
    return {
      viewText: window.t?.("action.view", "View") || "View",
      shortAction: true,
    };
  }

  function completionSourceProject(row, options = {}) {
    let sourceType =
      row.type === "director"
        ? "person"
        : row.type === "franchise"
          ? "franchise"
          : "";
    if (!sourceType) return null;
    // A person project is keyed by people.id when known (issue #633).
    let sourceId =
      sourceType === "person"
        ? window.personStorageKey((state.peopleById || {})[row.id]) || row.id
        : row.id;
    return {
      action: minimalSourceProjectAction(sourceType, sourceId, options),
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
      .map((row, index) => {
        let media = completionGridMedia(row);
        let sourceProject = completionSourceProject(row);
        return `<article class="completion-ranking-card completion-ranking-card--${escape(row.type)}${media ? " completion-ranking-card--media" : ""}">
    ${media ? `<div class="completion-ranking-card-media">${media}</div>` : ""}
    <div class="completion-ranking-card-body"><header><span class="leaderboard-position">#${start + index + 1}</span><h3><a href="${escape(row.href)}">${escape(row.name)}</a></h3>${sourceProject?.action || ""}</header>
    <div class="completion-ranking-card-stats"><span><b>${row.watchedCount}</b> ${escape(ui("Watched"))}</span><span><b>${row.watchlistCount}</b> ${escape(ui("To watch"))}</span></div>
    ${meterHtml(row.percent)}
    </div>
  </article>`;
      })
      .join("")}</div>`;
  }

  function completionTable(section, rows, completeCount, options) {
    if (!rows.length && !completeCount) {
      return completionCompactActive
        ? `<p class="completion-empty" role="status" data-needs-complete-archive>${escape(ui("Loading…"))}</p>`
        : `<p class="completion-empty" role="status">${escape(options.emptyText)}</p>`;
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

  function fixedCategoryGrid(categories, renderCard, classes) {
    let rowsByCategory = new Map(categories.map((row) => [row.category, row]));
    let slots = window.getCategoryPresentationSlots();
    let presented = new Set(["Best Picture", ...slots.filter(Boolean)]);
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
      return `<p class="completion-empty" role="status">${escape(completionCompactActive && !compactCompletionSource ? ui("Loading…") : ui("No annual award brackets with watched films yet."))}</p>`;
    }
    return fixedCategoryGrid(
      categories,
      (
        row,
      ) => `<article class="browse-index-card category-index-card completion-category-card${row.category === "Best Picture" ? " full-width" : ""}">
    <h2><a href="${escape(window.categoryPageUrl(row.category))}">${escape(window.localizedCategoryName?.(row.category) || row.category)}</a></h2>
    <div class="completion-category-progress completion-bracket-category-progress"><div><span>${escape(ui("Slots filled"))}</span><b>${row.filledSlots} / ${row.totalSlots}</b>${meterHtml(row.percent)}</div><div><span>${escape(ui("Periods complete"))}</span><b>${row.completePeriods} / ${row.periodCount}</b></div></div>
  </article>`,
      "completion-bracket-category-grid",
    );
  }

  function completionPeriodMatrixDecades() {
    if (window.periodIndexDecades) {
      let years = window.periodIndexYears ? window.periodIndexYears() : [];
      let decades = window.periodIndexDecades(years);
      if (decades && decades.length) return decades;
    }
    let currentYear = new Date().getFullYear();
    let currentDecade = Math.floor(currentYear / 10) * 10;
    let list = [];
    for (let d = 1900; d <= currentDecade; d += 10) list.push(`${d}s`);
    return list;
  }

  function watchGoalsPeriodMatrixHtml() {
    if (completionCompactActive && !compactCompletionSource) {
      return `<div class="completion-period-matrix-wrap" data-completion-matrix="watch-goals"><p class="completion-empty" role="status">${escape(ui("Loading…"))}</p></div>`;
    }
    let decades = completionPeriodMatrixDecades();
    if (!decades.length) return "";

    let yearsGoalMap = new Map(watchGoalYears.map((g) => [g.period, g]));
    let decadesGoalMap = new Map(watchGoalDecades.map((g) => [g.period, g]));
    let centuriesGoalMap = new Map(
      watchGoalCenturies.map((g) => [g.period, g]),
    );

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
            ? (() => {
                let atGoal = watchGoalAllTime;
                let atWatched = atGoal ? atGoal.watchedCount : 0;
                let atTarget = atGoal
                  ? atGoal.target
                  : window.WATCH_GOAL_TARGETS?.alltime || 10;
                let atStats = atGoal?.thresholdStats;
                let atMetrics = atStats?.metrics || [];
                let atMet = (key) =>
                  Boolean(atMetrics.find((m) => m.key === key)?.met);
                let atIsAllMet = Boolean(atStats?.allMet);
                let atIsGoalMet = atWatched >= atTarget;
                let atIsInProgress = atWatched > 0 && !atIsGoalMet;
                let atClass = atIsAllMet
                  ? "is-all-met"
                  : atIsGoalMet
                    ? "is-goal-met"
                    : atIsInProgress
                      ? "is-in-progress"
                      : "is-empty";
                let atTooltip =
                  `${ui("All-time")}: ${atWatched}/${atTarget} ${ui("total")}` +
                  (atStats?.counts
                    ? `, ${atStats.counts.foreign}/${atStats.thresholds.foreign} ${ui("foreign")}, ${atStats.counts.animated}/${atStats.thresholds.animated} ${ui("animated")}, ${atStats.counts.adapted}/${atStats.thresholds.adapted} ${ui("adapted")}, ${atStats.counts.original}/${atStats.thresholds.original} ${ui("original")}`
                    : "") +
                  (atIsAllMet
                    ? ` (${ui("all thresholds met")})`
                    : atIsGoalMet
                      ? ` (${ui("goal reached")})`
                      : "");
                return `<th class="period-alltime-cell completion-matrix-alltime-cell" scope="rowgroup"><a class="completion-matrix-cell completion-matrix-cell--alltime ${atClass}" href="${escape(`${window.periodPageUrl("alltime", "alltime")}&view=films`)}" title="${escape(atTooltip)}" aria-label="${escape(atTooltip)}"><span class="completion-matrix-alltime-label">${escape(ui("All-time"))}</span><span class="completion-matrix-count">${atWatched}/${atTarget}</span><span class="completion-matrix-pips" aria-hidden="true"><i class="pip pip--total${atIsGoalMet ? " is-met" : ""}"></i><i class="pip pip--foreign${atMet("foreign") ? " is-met" : ""}"></i><i class="pip pip--animated${atMet("animated") ? " is-met" : ""}"></i><i class="pip pip--adapted${atMet("adapted") ? " is-met" : ""}"></i><i class="pip pip--original${atMet("original") ? " is-met" : ""}"></i></span></a></th>`;
              })()
            : '<td class="period-alltime-gap" aria-hidden="true"></td>';

        let centuryCell;
        if (century !== previousCentury) {
          let cGoal = centuriesGoalMap.get(century);
          let cWatched = cGoal ? cGoal.watchedCount : 0;
          let cTarget = cGoal
            ? cGoal.target
            : window.WATCH_GOAL_TARGETS?.century || 40;
          let cStats = cGoal?.thresholdStats;
          let cMetrics = cStats?.metrics || [];
          let cMet = (key) => Boolean(cMetrics.find((m) => m.key === key)?.met);
          let cIsAllMet = Boolean(cStats?.allMet);
          let cIsGoalMet = cWatched >= cTarget;
          let cIsInProgress = cWatched > 0 && !cIsGoalMet;
          let cClass = cIsAllMet
            ? "is-all-met"
            : cIsGoalMet
              ? "is-goal-met"
              : cIsInProgress
                ? "is-in-progress"
                : "is-empty";
          let cTooltip =
            `${century}: ${cWatched}/${cTarget} ${ui("total")}` +
            (cStats?.counts
              ? `, ${cStats.counts.foreign}/${cStats.thresholds.foreign} ${ui("foreign")}, ${cStats.counts.animated}/${cStats.thresholds.animated} ${ui("animated")}, ${cStats.counts.adapted}/${cStats.thresholds.adapted} ${ui("adapted")}, ${cStats.counts.original}/${cStats.thresholds.original} ${ui("original")}`
              : "") +
            (cIsAllMet
              ? ` (${ui("all thresholds met")})`
              : cIsGoalMet
                ? ` (${ui("goal reached")})`
                : "");
          centuryCell = `<th class="period-century-cell completion-matrix-century-cell" scope="rowgroup"><a class="completion-matrix-cell completion-matrix-cell--century ${cClass}" href="${escape(`${window.periodPageUrl("century", century)}&view=films`)}" title="${escape(cTooltip)}" aria-label="${escape(cTooltip)}"><span class="completion-matrix-century-label">${escape(century)}</span><span class="completion-matrix-count">${cWatched}/${cTarget}</span><span class="completion-matrix-pips" aria-hidden="true"><i class="pip pip--total${cIsGoalMet ? " is-met" : ""}"></i><i class="pip pip--foreign${cMet("foreign") ? " is-met" : ""}"></i><i class="pip pip--animated${cMet("animated") ? " is-met" : ""}"></i><i class="pip pip--adapted${cMet("adapted") ? " is-met" : ""}"></i><i class="pip pip--original${cMet("original") ? " is-met" : ""}"></i></span></a></th>`;
        } else {
          centuryCell =
            '<td class="period-century-gap" aria-hidden="true"></td>';
        }
        previousCentury = century;

        let dGoal = decadesGoalMap.get(decade);
        let dWatched = dGoal ? dGoal.watchedCount : 0;
        let dTarget = dGoal
          ? dGoal.target
          : window.WATCH_GOAL_TARGETS?.decade || 20;
        let dStats = dGoal?.thresholdStats;
        let dMetrics = dStats?.metrics || [];
        let dMet = (key) => Boolean(dMetrics.find((m) => m.key === key)?.met);
        let dIsAllMet = Boolean(dStats?.allMet);
        let dIsGoalMet = dWatched >= dTarget;
        let dIsInProgress = dWatched > 0 && !dIsGoalMet;
        let dClass = dIsAllMet
          ? "is-all-met"
          : dIsGoalMet
            ? "is-goal-met"
            : dIsInProgress
              ? "is-in-progress"
              : "is-empty";
        let dTooltip =
          `${decade}: ${dWatched}/${dTarget} ${ui("total")}` +
          (dStats?.counts
            ? `, ${dStats.counts.foreign}/${dStats.thresholds.foreign} ${ui("foreign")}, ${dStats.counts.animated}/${dStats.thresholds.animated} ${ui("animated")}, ${dStats.counts.adapted}/${dStats.thresholds.adapted} ${ui("adapted")}, ${dStats.counts.original}/${dStats.thresholds.original} ${ui("original")}`
            : "") +
          (dIsAllMet
            ? ` (${ui("all thresholds met")})`
            : dIsGoalMet
              ? ` (${ui("goal reached")})`
              : "");
        let decadeCell = `<th scope="row" class="completion-matrix-decade-cell"><a class="completion-matrix-cell completion-matrix-cell--decade ${dClass}" href="${escape(`${window.periodPageUrl("decade", decade)}&view=films`)}" title="${escape(dTooltip)}" aria-label="${escape(dTooltip)}"><span class="completion-matrix-decade-label">${escape(decade)}</span><span class="completion-matrix-count">${dWatched}/${dTarget}</span><span class="completion-matrix-pips" aria-hidden="true"><i class="pip pip--total${dIsGoalMet ? " is-met" : ""}"></i><i class="pip pip--foreign${dMet("foreign") ? " is-met" : ""}"></i><i class="pip pip--animated${dMet("animated") ? " is-met" : ""}"></i><i class="pip pip--adapted${dMet("adapted") ? " is-met" : ""}"></i><i class="pip pip--original${dMet("original") ? " is-met" : ""}"></i></span></a></th>`;

        let yearCells = Array.from({ length: 10 }, (_, digit) => {
          let year = String(start + digit);
          let goal = yearsGoalMap.get(year);
          let watchedCount = goal ? goal.watchedCount : 0;
          let target = goal
            ? goal.target
            : window.WATCH_GOAL_TARGETS?.year || 10;
          let stats = goal?.thresholdStats;
          let yMetrics = stats?.metrics || [];
          let yMet = (key) => Boolean(yMetrics.find((m) => m.key === key)?.met);
          let isAllMet = Boolean(stats?.allMet);
          let isGoalMet = watchedCount >= target;
          let isInProgress = watchedCount > 0 && !isGoalMet;
          let yClass = isAllMet
            ? "is-all-met"
            : isGoalMet
              ? "is-goal-met"
              : isInProgress
                ? "is-in-progress"
                : "is-empty";
          let yTooltip =
            watchedCount > 0
              ? `${year}: ${watchedCount}/${target} ${ui("total")}, ` +
                `${stats?.counts?.foreign || 0}/${stats?.thresholds?.foreign || 5} ${ui("foreign")}, ` +
                `${stats?.counts?.animated || 0}/${stats?.thresholds?.animated || 5} ${ui("animated")}, ` +
                `${stats?.counts?.adapted || 0}/${stats?.thresholds?.adapted || 5} ${ui("adapted")}, ` +
                `${stats?.counts?.original || 0}/${stats?.thresholds?.original || 5} ${ui("original")}` +
                (isAllMet
                  ? ` (${ui("all thresholds met")})`
                  : isGoalMet
                    ? ` (${ui("goal reached")})`
                    : "")
              : `${year}: 0/${target} (${ui("No watched films yet.")})`;
          return `<td class="completion-matrix-year-cell"><a class="completion-matrix-cell ${yClass}" href="${escape(`${window.periodPageUrl("year", year)}&view=films`)}" title="${escape(yTooltip)}" aria-label="${escape(yTooltip)}"><span class="completion-matrix-digit">${digit}</span><span class="completion-matrix-count">${watchedCount}/${target}</span><span class="completion-matrix-pips" aria-hidden="true"><i class="pip pip--total${isGoalMet ? " is-met" : ""}"></i><i class="pip pip--foreign${yMet("foreign") ? " is-met" : ""}"></i><i class="pip pip--animated${yMet("animated") ? " is-met" : ""}"></i><i class="pip pip--adapted${yMet("adapted") ? " is-met" : ""}"></i><i class="pip pip--original${yMet("original") ? " is-met" : ""}"></i></span></a></td>`;
        }).join("");

        return `<tr>${allTimeCell}${centuryCell}${decadeCell}${yearCells}</tr>`;
      })
      .join("");

    let legendHtml = `<div class="completion-matrix-legend" aria-label="${escape(ui("Watch goals legend"))}">
      <span class="completion-matrix-legend-item"><i class="completion-matrix-legend-chip is-all-met"></i> ${escape(ui("All thresholds met"))}</span>
      <span class="completion-matrix-legend-item"><i class="completion-matrix-legend-chip is-goal-met"></i> ${escape(ui("Goal reached"))}</span>
      <span class="completion-matrix-legend-item"><i class="completion-matrix-legend-chip is-in-progress"></i> ${escape(ui("In progress"))}</span>
      <span class="completion-matrix-legend-pips">${escape(ui("Pips"))}: <b>${escape(ui("total"))}</b> · <b>${escape(ui("foreign"))}</b> · <b>${escape(ui("animated"))}</b> · <b>${escape(ui("adapted"))}</b> · <b>${escape(ui("original"))}</b></span>
    </div>`;

    return `<div class="completion-period-matrix-wrap" data-completion-matrix="watch-goals">${legendHtml}<table class="completion-period-matrix"><caption class="sr-only">${escape(ui("Watch goals period matrix"))}</caption><thead><tr><th scope="col">${escape(ui("All-time"))}</th><th scope="col">${escape(ui("Century"))}</th><th scope="col">${escape(ui("Decade"))}</th>${digitHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function awardBracketsPeriodMatrixHtml() {
    if (completionCompactActive && !compactCompletionSource) {
      return `<div class="completion-period-matrix-wrap" data-completion-matrix="brackets"><p class="completion-empty" role="status">${escape(ui("Loading…"))}</p></div>`;
    }
    let decades = completionPeriodMatrixDecades();
    if (!decades.length) return "";

    let bracketMap = new Map(bracketCompletion.map((b) => [b.period, b]));

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
            ? (() => {
                let atBracket =
                  bracketMap.get("allTime") || bracketMap.get("alltime");
                let atFilled = atBracket ? atBracket.filledSlots : 0;
                let atTotal = atBracket ? atBracket.totalSlots : 0;
                let atComplete = atFilled >= atTotal && atTotal > 0;
                let atPartial = atFilled > 0 && !atComplete;
                let atClass = atComplete
                  ? "is-bracket-complete"
                  : atPartial
                    ? "is-bracket-partial"
                    : "is-bracket-empty";
                let atPercent = atTotal
                  ? Math.round((atFilled / atTotal) * 100)
                  : 0;
                let atTooltip =
                  atBracket && atTotal > 0
                    ? `${ui("All-time")}: ${atFilled}/${atTotal} ${ui("slots filled")}` +
                      (atComplete ? ` (${ui("fully filled")})` : "")
                    : ui("All-time");
                return `<th class="period-alltime-cell completion-matrix-alltime-cell" scope="rowgroup"><a class="completion-matrix-cell completion-matrix-cell--alltime ${atClass}" href="${escape(`${window.periodPageUrl("alltime", "alltime")}&view=awards`)}" title="${escape(atTooltip)}" aria-label="${escape(atTooltip)}"><span class="completion-matrix-alltime-label">${escape(ui("All-time"))}</span>${atTotal > 0 ? `<span class="completion-matrix-bracket-count">${atFilled}/${atTotal}</span><span class="completion-matrix-meter" aria-hidden="true"><i style="width:${atPercent}%"></i></span>` : ""}</a></th>`;
              })()
            : '<td class="period-alltime-gap" aria-hidden="true"></td>';

        let centuryCell;
        if (century !== previousCentury) {
          let cBracket = bracketMap.get(century);
          let cFilled = cBracket ? cBracket.filledSlots : 0;
          let cTotal = cBracket ? cBracket.totalSlots : 0;
          let cComplete = cFilled >= cTotal && cTotal > 0;
          let cPartial = cFilled > 0 && !cComplete;
          let cClass = cComplete
            ? "is-bracket-complete"
            : cPartial
              ? "is-bracket-partial"
              : "is-bracket-empty";
          let cPercent = cTotal ? Math.round((cFilled / cTotal) * 100) : 0;
          let cTooltip =
            cBracket && cTotal > 0
              ? `${century}: ${cFilled}/${cTotal} ${ui("slots filled")}` +
                (cComplete ? ` (${ui("fully filled")})` : "")
              : `${century}: ${ui("No award bracket data imported yet.")}`;
          centuryCell = `<th class="period-century-cell completion-matrix-century-cell" scope="rowgroup"><a class="completion-matrix-cell completion-matrix-cell--century ${cClass}" href="${escape(`${window.periodPageUrl("century", century)}&view=awards`)}" title="${escape(cTooltip)}" aria-label="${escape(cTooltip)}"><span class="completion-matrix-century-label">${escape(century)}</span>${cTotal > 0 ? `<span class="completion-matrix-bracket-count">${cFilled}/${cTotal}</span><span class="completion-matrix-meter" aria-hidden="true"><i style="width:${cPercent}%"></i></span>` : ""}</a></th>`;
        } else {
          centuryCell =
            '<td class="period-century-gap" aria-hidden="true"></td>';
        }
        previousCentury = century;

        let dBracket = bracketMap.get(decade);
        let dFilled = dBracket ? dBracket.filledSlots : 0;
        let dTotal = dBracket ? dBracket.totalSlots : 0;
        let dComplete = dFilled >= dTotal && dTotal > 0;
        let dPartial = dFilled > 0 && !dComplete;
        let dClass = dComplete
          ? "is-bracket-complete"
          : dPartial
            ? "is-bracket-partial"
            : "is-bracket-empty";
        let dPercent = dTotal ? Math.round((dFilled / dTotal) * 100) : 0;
        let dTooltip =
          dBracket && dTotal > 0
            ? `${decade}: ${dFilled}/${dTotal} ${ui("slots filled")}` +
              (dComplete ? ` (${ui("fully filled")})` : "")
            : `${decade}: ${ui("No award bracket data imported yet.")}`;
        let decadeCell = `<th scope="row" class="completion-matrix-decade-cell"><a class="completion-matrix-cell completion-matrix-cell--decade ${dClass}" href="${escape(`${window.periodPageUrl("decade", decade)}&view=awards`)}" title="${escape(dTooltip)}" aria-label="${escape(dTooltip)}"><span class="completion-matrix-decade-label">${escape(decade)}</span>${dTotal > 0 ? `<span class="completion-matrix-bracket-count">${dFilled}/${dTotal}</span><span class="completion-matrix-meter" aria-hidden="true"><i style="width:${dPercent}%"></i></span>` : ""}</a></th>`;

        let yearCells = Array.from({ length: 10 }, (_, digit) => {
          let year = String(start + digit);
          let bracket = bracketMap.get(year);
          let filledSlots = bracket ? bracket.filledSlots : 0;
          let totalSlots = bracket ? bracket.totalSlots : 0;
          let isComplete = filledSlots >= totalSlots && totalSlots > 0;
          let isPartial = filledSlots > 0 && !isComplete;
          let percent = totalSlots
            ? Math.round((filledSlots / totalSlots) * 100)
            : 0;
          let yClass = isComplete
            ? "is-bracket-complete"
            : isPartial
              ? "is-bracket-partial"
              : "is-bracket-empty";
          let yTooltip =
            bracket && totalSlots > 0
              ? `${year}: ${filledSlots}/${totalSlots} ${ui("slots filled")} · ${bracket.completeCategories}/${bracket.categoryCount} ${ui("categories complete")}` +
                (isComplete ? ` (${ui("fully filled")})` : "")
              : `${year}: ${ui("No award bracket data imported yet.")}`;
          return `<td class="completion-matrix-year-cell"><a class="completion-matrix-cell ${yClass}" href="${escape(`${window.periodPageUrl("year", year)}&view=awards`)}" title="${escape(yTooltip)}" aria-label="${escape(yTooltip)}"><span class="completion-matrix-digit">${digit}</span>${totalSlots > 0 ? `<span class="completion-matrix-bracket-count">${filledSlots}/${totalSlots}</span><span class="completion-matrix-meter" aria-hidden="true"><i style="width:${percent}%"></i></span>` : ""}</a></td>`;
        }).join("");

        return `<tr>${allTimeCell}${centuryCell}${decadeCell}${yearCells}</tr>`;
      })
      .join("");

    let legendHtml = `<div class="completion-matrix-legend" aria-label="${escape(ui("Award brackets legend"))}">
      <span class="completion-matrix-legend-item"><i class="completion-matrix-legend-chip is-bracket-complete"></i> ${escape(ui("Fully filled"))}</span>
      <span class="completion-matrix-legend-item"><i class="completion-matrix-legend-chip is-bracket-partial"></i> ${escape(ui("Partially filled"))}</span>
      <span class="completion-matrix-legend-item"><i class="completion-matrix-legend-chip is-bracket-empty"></i> ${escape(ui("Empty"))}</span>
    </div>`;

    return `<div class="completion-period-matrix-wrap" data-completion-matrix="brackets">${legendHtml}<table class="completion-period-matrix"><caption class="sr-only">${escape(ui("Award brackets period matrix"))}</caption><thead><tr><th scope="col">${escape(ui("All-time"))}</th><th scope="col">${escape(ui("Century"))}</th><th scope="col">${escape(ui("Decade"))}</th>${digitHeaders}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function officialGroupProgress(group) {
    return `<div class="oscar-completion-progress"><b>${group.watchedCount} / ${group.total}</b>${meterHtml(group.percent)}</div>`;
  }

  function officialProjectAction(sourceId, group, label) {
    let action = minimalSourceProjectAction("official-results", group.sourceId);
    return `<div class="oscar-project-action"><span>${escape(label)}</span><div>${action}${officialWatchlistButton(sourceId, group)}</div></div>`;
  }

  function officialProjectButton(group, options = {}) {
    return minimalSourceProjectAction(
      "official-results",
      group.sourceId,
      options,
    );
  }

  function officialWatchlistButton(sourceId, group, options = {}) {
    if (!canEdit) return "";
    let plan = window.officialCollectionWatchlistPlan?.(
      group.sourceId,
      officialCompletions.get(sourceId),
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
          tier: officialWatchlistTiers.get(sourceId),
        });
    return `<button type="button" class="sort-order-button completion-watchlist-action" data-add-oscar-watchlist="${escape(group.sourceId)}" title="${escape(title)}">${escape(label)}</button>`;
  }

  function officialWatchlistActionPair(sourceId, group, options = {}) {
    return `${officialProjectButton(group, options)}${officialWatchlistButton(
      sourceId,
      group,
      {
        shortLabel: true,
      },
    )}`;
  }

  function officialSummaryCard(sourceId, eyebrow, title, subtitle, group) {
    return `<article class="oscar-completion-card"><header><div><span class="eyebrow">${escape(eyebrow)}</span><h3>${escape(title)}</h3><p>${escape(subtitle)}</p></div>${officialGroupProgress(group)}</header>${officialProjectAction(sourceId, group, ui("Collection project"))}</article>`;
  }

  function officialCategoryMetric(sourceId, group, label) {
    return `<div class="oscar-category-metric"><div class="oscar-category-metric-header"><span><b>${escape(label)}</b><strong>${group.watchedCount} / ${group.total}</strong></span><div class="oscar-category-actions">${officialWatchlistActionPair(sourceId, group)}</div></div>${meterHtml(group.percent)}</div>`;
  }

  function officialPeriodRowValue(row, key) {
    if (key === "period") return row.period || "";
    if (key === "winnerPercent") return row.winners.percent || 0;
    return row.nominees.percent || 0;
  }

  function officialPeriodCompletion(sourceId, periods) {
    let sortSection = officialPeriodsSortSection(sourceId);
    let incomplete = periods.filter(
      (period) => period.nominees.watchedCount < period.nominees.total,
    );
    let completeCount = periods.length - incomplete.length;
    let sorted = sortRows(incomplete, sortSection, officialPeriodRowValue);
    let page = paginateRows(sorted, sortSection, ui("periods"));
    let rows = page.rows
      .map((period) => {
        let projectAction = officialWatchlistActionPair(
          sourceId,
          period.nominees,
          projectColumnActionOptions(),
        );
        return `<tr>
    <td><a class="period-link" href="${escape(period.href)}"><strong>${escape(period.period)}</strong></a></td>
    <td class="completion-cell">${officialGroupProgress(period.winners)}</td>
    <td class="completion-cell">${officialGroupProgress(period.nominees)}</td>
    <td>${projectAction}</td>
  </tr>`;
      })
      .join("");
    let completeNote = completeCount
      ? `<p class="completion-note">${escape(ui("{count} more official periods already fully watched.", { count: completeCount }))}</p>`
      : "";
    let content = page.rows.length
      ? layout === "grid"
        ? `${periodGridControls(sortSection, [
            { value: "period", label: ui("Period") },
            { value: "winnerPercent", label: ui("Winners") },
            { value: "nomineePercent", label: ui("Nominees") },
          ])}${periodGrid(
            page.rows
              .map(
                (period) =>
                  `<article class="completion-period-card completion-oscar-period-card"><header><h4><a href="${escape(period.href)}">${escape(period.period)}</a></h4><div class="oscar-category-actions">${officialWatchlistActionPair(sourceId, period.nominees)}</div></header><div class="completion-oscar-period-metrics"><div><span>${escape(ui("Winners"))}</span>${officialGroupProgress(period.winners)}</div><div><span>${escape(ui("Nominees"))}</span>${officialGroupProgress(period.nominees)}</div></div></article>`,
              )
              .join(""),
            "completion-oscar-period-grid",
            page.rows.length,
          )}`
        : window.renderLeaderboardTable({
            headers: [
              sortHeader(sortSection, "period", ui("Period")),
              sortHeader(sortSection, "winnerPercent", ui("Winners watched")),
              sortHeader(sortSection, "nomineePercent", ui("Nominees watched")),
              escape(ui("Actions")),
            ],
            rows,
            classes: "completion-table",
          })
      : `<p class="completion-empty">${escape(ui("Every official period is fully watched."))}</p>`;
    return `${content}${page.controls}${completeNote}`;
  }

  function officialCategoryGrid(sourceId, categories) {
    if (!categories.length)
      return `<p class="completion-empty">${escape(ui("No official data imported yet for this source."))}</p>`;
    return fixedCategoryGrid(
      categories,
      (
        row,
      ) => `<article class="browse-index-card category-index-card completion-category-card completion-oscar-category-card${row.category === "Best Picture" ? " full-width" : ""}">
    <h2><a href="${escape(window.categoryPageUrl(row.category))}&view=official">${escape(window.localizedCategoryName?.(row.category) || row.category)}</a></h2>
    <div class="completion-category-progress">${officialCategoryMetric(sourceId, row.winners, ui("Winners"))}${officialCategoryMetric(sourceId, row.nominees, ui("Nominees"))}</div>
  </article>`,
      "completion-oscar-category-grid",
    );
  }

  function officialCompletionHtml(sourceId, completion) {
    if (!completion.source || !completion.periodKeys.length)
      return `<p class="completion-empty">${escape(ui("No official data imported yet for this source."))}</p>`;
    let displayName = window.officialSourceDisplayName(sourceId, completion);
    let firstPeriod = completion.periodKeys[0];
    let lastPeriod = completion.periodKeys[completion.periodKeys.length - 1];
    let overallPlan = window.officialCollectionWatchlistPlan?.(
      completion.nominees.sourceId,
      completion,
    );
    let tier = officialWatchlistTiers.get(sourceId);
    let status = officialWatchlistStatuses.get(sourceId) || "";
    let lastAddition = lastOfficialWatchlistAdditions.get(sourceId) || null;
    let tierOptions = window
      .watchlistExactTiers()
      .map(
        (option) =>
          `<option value="${option}"${option === tier ? " selected" : ""}>${option}</option>`,
      )
      .join("");
    let watchlistTools = canEdit
      ? `<div class="oscar-watchlist-tools"><label><span>${escape(ui("Add unseen to interest tier"))}</span><select data-oscar-watchlist-tier="${escape(sourceId)}">${tierOptions}</select></label><span>${escape(ui("Unambiguous scopes add immediately."))}</span></div>${status ? `<p class="data-panel-status oscar-watchlist-status" role="status" data-oscar-watchlist-status="${escape(sourceId)}">${escape(status)}${lastAddition?.length ? ` <button type="button" class="link-button" data-undo-oscar-watchlist="${escape(sourceId)}">${escape(ui("Undo"))}</button>` : ""}</p>` : ""}`
      : "";
    let reviewQueue = overallPlan?.needsReview.length
      ? `<details class="oscar-watchlist-review"><summary>${escape(ui("{count} films need year review", { count: overallPlan.needsReview.length }))}</summary><p>${escape(ui("Multi-year ceremonies stay out of the watchlist until their release year is known."))}</p><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Film"))}</th><th>${escape(ui("Ceremony"))}</th><th>${escape(ui("Possible years"))}</th></tr></thead><tbody>${overallPlan.needsReview
          .map(
            (candidate) =>
              `<tr><td><strong>${escape(candidate.title)}</strong></td><td><a class="period-link" href="${escape(candidate.href)}">${escape(candidate.periodKey)}</a></td><td>${escape(candidate.possibleYears.join(" / "))}</td></tr>`,
          )
          .join("")}</tbody></table></div></details>`
      : "";
    return `${watchlistTools}<p class="completion-note oscar-completion-scope">${escape(
      ui("Based on {count} imported {source} periods, {first}–{last}.", {
        count: completion.periodKeys.length,
        source: displayName,
        first: firstPeriod,
        last: lastPeriod,
      }),
    )}</p>${reviewQueue}<div class="oscar-completion-highlights">${officialSummaryCard(
      sourceId,
      ui("{source} completion", { source: displayName }),
      ui("{source}-winning films watched", { source: displayName }),
      ui("Distinct films that won at least one imported category."),
      completion.winners,
    )}${officialSummaryCard(
      sourceId,
      ui("{source} completion", { source: displayName }),
      ui("{source}-nominated films watched", { source: displayName }),
      ui("Distinct nominated films, including winners."),
      completion.nominees,
    )}</div><div class="completion-subsection"><h3>${escape(ui("Years"))}</h3>${officialPeriodCompletion(sourceId, completion.periods)}</div><div class="completion-subsection"><h3>${escape(ui("By category"))}</h3>${officialCategoryGrid(sourceId, completion.categories)}</div>`;
  }

  function officialWatchlistDialog() {
    let plan = pendingOfficialWatchlistPlan;
    if (!plan) return "";
    let tier = officialWatchlistTiers.get(plan.sourceId);
    let reviewRows = plan.needsReview
      .slice(0, 20)
      .map(
        (candidate) =>
          `<li><strong>${escape(candidate.title)}</strong> · ${escape(candidate.periodKey)} (${escape(candidate.possibleYears.join(" / "))})</li>`,
      )
      .join("");
    return `<dialog id="oscarWatchlistDialog-${escape(plan.sourceId)}" class="oscar-watchlist-dialog" data-official-watchlist-dialog="${escape(plan.sourceId)}"><form method="dialog"><h2>${escape(ui("Add unseen films?"))}</h2><p>${escape(
      ui(
        "{ready} films are ready for tier {tier}. {review} need year review and will be skipped.",
        {
          ready: plan.ready.length,
          tier,
          review: plan.needsReview.length,
        },
      ),
    )}</p>${reviewRows ? `<details open><summary>${escape(ui("Needs review"))}</summary><ul>${reviewRows}</ul></details>` : ""}<div class="dialog-actions"><button type="button" data-cancel-oscar-watchlist>${escape(ui("Cancel"))}</button>${plan.ready.length ? `<button type="button" data-confirm-oscar-watchlist>${escape(ui("Add {count} films", { count: plan.ready.length }))}</button>` : ""}</div></form></dialog>`;
  }

  function updateOfficialWatchlistStatus(sourceId, message) {
    officialWatchlistStatuses.set(sourceId, message);
    let status = container.querySelector(
      `[data-oscar-watchlist-status="${sourceId}"]`,
    );
    if (status) status.firstChild.textContent = message;
  }

  async function refreshCompletionAfterWrite() {
    await window.ensureOskarsData({ forceRefresh: true });
    refreshCanonicalLists();
    for (let sourceId of officialSourceIds)
      officialCompletions.set(
        sourceId,
        window.officialCollectionCompletion(sourceId),
      );
  }

  function assertCompletionWriteOwner(ownerId) {
    if (ownerId !== window.getSupabaseCurrentUser?.()?.id)
      throw Object.assign(
        new Error("Account changed while performing operation."),
        { code: "OSKARS_ACCOUNT_CHANGED" },
      );
  }

  async function persistCompletionAdditions(items, remember) {
    let ownerId = window.getSupabaseCurrentUser?.()?.id;
    let added = [];
    try {
      for (let item of items) {
        assertCompletionWriteOwner(ownerId);
        let row = await window.addSupabaseWatchlistRecord(item);
        assertCompletionWriteOwner(ownerId);
        item.id = row.id;
        item.supabaseFilmId = row.film_id;
        added.push(item);
        remember(added.map((entry) => entry.id));
      }
    } finally {
      await refreshCompletionAfterWrite();
    }
    return added;
  }

  async function persistCompletionRemovals(items) {
    let ownerId = window.getSupabaseCurrentUser?.()?.id;
    try {
      for (let item of items) {
        assertCompletionWriteOwner(ownerId);
        await window.removeFromSupabaseWatchlist(item.id);
      }
    } finally {
      await refreshCompletionAfterWrite();
    }
  }

  async function enrichOfficialWatchlistItems(sourceId, items) {
    if (!items.length || typeof window.fetch !== "function") return;
    let posterIds = new Set(
      items.filter((item) => !item.poster).map((item) => item.id),
    );
    let metadata = await window.fetchSupabaseWatchlistMetadata(items, {
      concurrency: 3,
      onProgress(done, total) {
        updateOfficialWatchlistStatus(
          sourceId,
          ui("Fetching metadata: {done}/{total}", { done, total }),
        );
      },
    });
    await refreshCompletionAfterWrite();
    let posters = (window.state.watchlist || []).filter(
      (item) => posterIds.has(item.id) && item.poster,
    ).length;
    officialWatchlistStatuses.set(
      sourceId,
      ui(
        "Added {count} films. Found metadata for {metadata} and posters for {posters}.",
        {
          count: items.length,
          metadata: metadata.found,
          posters,
        },
      ),
    );
    render();
  }

  async function addOfficialWatchlistSource(scopeId) {
    // Defense in depth: also reachable directly from the "needs review"
    // confirm dialog, not just the button branch above that already awaits
    // this.
    await ensureCompletionFullyHydrated().catch(() => {});
    let plan = window.officialCollectionWatchlistPlan?.(scopeId);
    if (!plan) return;
    let sourceId = plan.sourceId;
    officialWatchlistStatuses.set(
      sourceId,
      ui("Adding {count} films…", { count: plan.ready.length }),
    );
    pendingOfficialWatchlistPlan = null;
    render();
    let result = window.applyOfficialCollectionWatchlistPlan?.(
      scopeId,
      officialWatchlistTiers.get(sourceId),
      { save: false },
    );
    if (!result?.ok) {
      officialWatchlistStatuses.set(
        sourceId,
        result?.reason || ui("Films could not be added."),
      );
      render();
      return;
    }
    try {
      result.added = await persistCompletionAdditions(result.added, (ids) =>
        lastOfficialWatchlistAdditions.set(sourceId, ids),
      );
    } catch (err) {
      officialWatchlistStatuses.set(sourceId, err.message || String(err));
      render();
      return;
    }
    officialCompletions.set(
      sourceId,
      window.officialCollectionCompletion(sourceId),
    );
    officialWatchlistStatuses.set(
      sourceId,
      result.added.length
        ? ui("Added {count} films to tier {tier}.", {
            count: result.added.length,
            tier: result.tier,
          })
        : ui("No new films to add."),
    );
    render();
    if (result.added.length)
      await enrichOfficialWatchlistItems(sourceId, result.added);
  }

  function canonicalListRowValue(row, key) {
    if (key === "name") return row.name || "";
    if (key === "watchedCount") return row.watchedCount || 0;
    if (key === "total") return row.total || 0;
    return row.percent || 0;
  }

  function canonicalListWatchlistButton(list, options = {}) {
    if (!canEdit) return "";
    let plan = window.canonicalListWatchlistPlan?.(list.id, list);
    if (!plan || !plan.ready.length) return "";
    let label = options.shortLabel
      ? ui("Add unseen")
      : ui("Add {count} unseen", { count: plan.ready.length });
    let tier = canonicalListTiers.get(list.id) || "C";
    let title = ui("Add unseen films to tier {tier}", { tier });
    return `<button type="button" class="sort-order-button completion-watchlist-action" data-add-canonical-watchlist="${escape(list.id)}" title="${escape(title)}">${escape(label)}</button>`;
  }

  function canonicalListTable(list) {
    let currentFilter = canonicalListFilters.get(list.id) || "all";
    let items = list.items || [];
    if (currentFilter === "unseen") items = list.unseen;
    else if (currentFilter === "watched") items = list.watched;

    let filterTabs = `<div class="canonical-filter-tabs">
      <button type="button" class="canonical-filter-tab" data-canonical-filter="${escape(list.id)}" data-filter-value="all" aria-pressed="${currentFilter === "all" ? "true" : "false"}">${escape(ui("All"))} (${list.total})</button>
      <button type="button" class="canonical-filter-tab" data-canonical-filter="${escape(list.id)}" data-filter-value="unseen" aria-pressed="${currentFilter === "unseen" ? "true" : "false"}">${escape(ui("Unseen"))} (${list.unseenCount})</button>
      <button type="button" class="canonical-filter-tab" data-canonical-filter="${escape(list.id)}" data-filter-value="watched" aria-pressed="${currentFilter === "watched" ? "true" : "false"}">${escape(ui("Watched"))} (${list.watchedCount})</button>
    </div>`;

    let rows = items
      .map((item) => {
        let titleHtml = item.href
          ? `<a href="${escape(item.href)}"><strong>${escape(item.title)}</strong></a>`
          : `<strong>${escape(item.title)}</strong>`;
        let statusBadge = item.watched
          ? `<span class="canonical-status-badge canonical-status-badge--watched">${escape(ui("Watched"))}</span>`
          : item.watchlistItem
            ? `<span class="canonical-status-badge canonical-status-badge--watchlist">${escape(ui("Watchlist"))} (${escape(item.watchlistItem.tier || "C")})</span>`
            : `<span class="canonical-status-badge canonical-status-badge--unseen">${escape(ui("Unseen"))}</span>`;
        return `<tr>
          <td>#${item.rank}</td>
          <td>${titleHtml} <span class="film-table-year">(${escape(item.year)})</span></td>
          <td>${escape(item.director || "—")}</td>
          <td>${statusBadge}</td>
        </tr>`;
      })
      .join("");

    return `${filterTabs}
    <div class="canonical-table-wrap">
      <table class="canonical-film-table">
        <thead>
          <tr>
            <th>#</th>
            <th>${escape(ui("Film"))}</th>
            <th>${escape(ui("Director"))}</th>
            <th>${escape(ui("Status"))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="4" class="completion-empty">${escape(ui("No films match this filter."))}</td></tr>`}
        </tbody>
      </table>
    </div>`;
  }

  function canonicalListCard(list) {
    let projectAction = minimalSourceProjectAction("canonical-list", list.id);
    let watchlistAction = canonicalListWatchlistButton(list);
    let tier = canonicalListTiers.get(list.id) || "C";
    let tierOptions = window
      .watchlistExactTiers()
      .map(
        (option) =>
          `<option value="${option}"${option === tier ? " selected" : ""}>${option}</option>`,
      )
      .join("");
    let status = canonicalListStatuses.get(list.id) || "";
    let lastAddition = lastCanonicalListAdditions.get(list.id) || null;
    let isExpanded = canonicalExpandedLists.has(list.id);

    return `<article class="canonical-list-card" id="completion-canonical-list-${escape(list.id)}">
      <header>
        <h3><a href="${escape(list.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(list.name)}</a></h3>
        <p>${escape(list.description)}</p>
      </header>
      <div class="canonical-list-stats">
        <span><b>${list.watchedCount} / ${list.total}</b> ${escape(ui("Watched"))} (${list.percent}%)</span>
        <span><b>${list.watchlistCount}</b> ${escape(ui("To watch"))}</span>
      </div>
      ${meterHtml(list.percent)}
      <div class="canonical-list-actions">
        ${projectAction}
        ${canEdit && watchlistAction ? `<div class="canonical-list-tools"><select data-canonical-watchlist-tier="${escape(list.id)}">${tierOptions}</select>${watchlistAction}</div>` : ""}
      </div>
      ${status ? `<p class="data-panel-status oscar-watchlist-status" role="status">${escape(status)}${lastAddition?.length ? ` <button type="button" class="link-button" data-undo-canonical-watchlist="${escape(list.id)}">${escape(ui("Undo"))}</button>` : ""}</p>` : ""}
      <details class="canonical-list-details"${isExpanded ? " open" : ""} data-canonical-details="${escape(list.id)}">
        <summary>${escape(ui("Browse films"))} (${list.total})</summary>
        <div class="canonical-list-browser">
          ${canonicalListTable(list)}
        </div>
      </details>
    </article>`;
  }

  function canonicalListsSectionHtml() {
    if (!canonicalLists.length) {
      return `<p class="completion-empty" role="status">${escape(completionCompactActive && !compactCompletionSource ? ui("Loading…") : ui("No canonical lists available."))}</p>`;
    }
    let sorted = sortRows(
      canonicalLists,
      "canonicalLists",
      canonicalListRowValue,
    );
    let cards = sorted.map(canonicalListCard).join("");
    return `<div class="canonical-lists-grid">${cards}</div>`;
  }

  async function addCanonicalWatchlistSource(listId) {
    await ensureCompletionFullyHydrated().catch(() => {});
    let tier = canonicalListTiers.get(listId) || "C";
    let plan = window.canonicalListWatchlistPlan?.(listId);
    if (!plan || !plan.ready.length) return;
    canonicalListStatuses.set(
      listId,
      ui("Adding {count} films…", { count: plan.ready.length }),
    );
    render();
    let result = window.applyCanonicalListWatchlistPlan?.(listId, tier, {
      save: false,
    });
    if (!result?.ok) {
      canonicalListStatuses.set(
        listId,
        result?.reason || ui("Films could not be added."),
      );
      render();
      return;
    }
    try {
      result.added = await persistCompletionAdditions(result.added, (ids) =>
        lastCanonicalListAdditions.set(listId, ids),
      );
    } catch (err) {
      canonicalListStatuses.set(listId, err.message || String(err));
      render();
      return;
    }
    refreshCanonicalLists();
    canonicalListStatuses.set(
      listId,
      result.added.length
        ? ui("Added {count} films to tier {tier}.", {
            count: result.added.length,
            tier: result.tier,
          })
        : ui("No new films to add."),
    );
    render();
  }

  function completionSection(id, title, subtitle, bodyHtml) {
    return `<section class="completion-section" id="completion-${escape(id)}" data-collapsible-section><header class="completion-section-header" data-collapsible-heading><div><h2>${escape(title)}</h2><p>${escape(subtitle)}</p></div></header><div class="completion-section-body" data-collapsible-body>${bodyHtml}</div></section>`;
  }

  function officialSummaryStatItems() {
    return officialSourceIds
      .map((sourceId) => {
        let completion = officialCompletions.get(sourceId);
        let displayName = window.officialSourceDisplayName(
          sourceId,
          completion,
        );
        return `
  <span><b>${completion.winners.watchedCount}/${completion.winners.total}</b> ${escape(ui("{source}-winning films watched", { source: displayName }))}</span>
  <span><b>${completion.nominees.watchedCount}/${completion.nominees.total}</b> ${escape(ui("{source}-nominated films watched", { source: displayName }))}</span>`;
      })
      .join("");
  }

  function officialCompletionSections() {
    return officialSourceIds
      .map((sourceId) => {
        let completion = officialCompletions.get(sourceId);
        let displayName = window.officialSourceDisplayName(
          sourceId,
          completion,
        );
        return completionSection(
          sourceId,
          ui("{source} film completion", { source: displayName }),
          ui(
            "Films watched from the imported official {source} winners and nominees — overall, by year, and by category.",
            { source: displayName },
          ),
          officialCompletionHtml(sourceId, completion),
        );
      })
      .join("");
  }

  function anyOfficialNomineesTotal() {
    return officialSourceIds.some(
      (sourceId) => officialCompletions.get(sourceId).nominees.total,
    );
  }

  let stopArchiveWatch = () => {};
  function render() {
    renderContent();
    stopArchiveWatch();
    stopArchiveWatch = () => {};
    // Until the compact projection renders, its sections are one-line
    // placeholders, so a complete-archive section can sit on screen only
    // until that data pushes it down; it is not "seen" yet.
    if (
      completionCompactActive &&
      !compactCompletionSource &&
      !compactCompletionError
    )
      return;
    stopArchiveWatch = window.whenCompleteArchiveNeeded(container, () =>
      ensureCompletionFullyHydrated().catch(() => {}),
    );
  }

  function renderContent() {
    let finishRenderTimer =
      window.startOskarsPerformance?.("completion:render");
    // Recomputed on every render, not once at module load (issue #597):
    // hub/bracketCompletion/watchGoal* are all reassigned once the compact
    // fetch and/or the eager background hydration resolve, so anything
    // derived from them must be too, or these summary figures would stay
    // frozen at their initial (empty, in compact mode) values forever.
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
    let canonicalSummary = canonicalLists.reduce(
      (acc, list) => ({
        watched: acc.watched + list.watchedCount,
        total: acc.total + list.total,
        complete:
          acc.complete +
          (list.watchedCount >= list.total && list.total > 0 ? 1 : 0),
      }),
      { watched: 0, total: 0, complete: 0 },
    );
    let categoryTabs = [
      { id: "trophies", label: ui("Trophies") },
      { id: "watch-goals", label: ui("Watch goals") },
      { id: "canonical-lists", label: ui("Canonical lists") },
      { id: "directors", label: ui("Directors") },
      { id: "franchises", label: ui("Franchises") },
      { id: "projects", label: ui("Projects") },
      { id: "official", label: ui("Official awards") },
      { id: "brackets", label: ui("Award brackets") },
    ];
    let requestedTab = window.pageQueryParam("tab");
    let activeTab = categoryTabs.some((tab) => tab.id === requestedTab)
      ? requestedTab
      : "trophies";
    let categoryTabsHtml = `<div class="completion-category-tabs period-view-controls" role="tablist" aria-label="${escape(ui("Completion categories"))}">${categoryTabs
      .map(
        (tab) =>
          `<button type="button" class="period-view-pill${activeTab === tab.id ? " is-active" : ""}" data-completion-tab="${escape(tab.id)}" role="tab" aria-selected="${activeTab === tab.id ? "true" : "false"}">${escape(tab.label)}</button>`,
      )
      .join("")}</div>`;

    function isTabMatch(tab, sectionId) {
      return tab === sectionId;
    }

    let allCollectionTrophies = window.collectionTrophiesData
      ? window.collectionTrophiesData()
      : [];
    let totalTrophiesCount = 0;
    let earnedTrophiesCount = 0;
    allCollectionTrophies.forEach((col) => {
      col.tierList.forEach((tier) => {
        totalTrophiesCount += 1;
        if (tier.earned) earnedTrophiesCount += 1;
      });
    });
    let earnedPersonaTitles = window.getEarnedPersonaTitles
      ? window.getEarnedPersonaTitles()
      : [];

    let summaryHtml = window.renderDetailStats({
      classes: "completion-summary",
      itemsHtml: `${officialSummaryStatItems()}
  <span><b>${canonicalSummary.watched}/${canonicalSummary.total}</b> ${escape(ui("Canonical list films watched"))}</span>
  <span><b>${hub.directors.length}</b> ${escape(ui("Directors in progress"))}</span>
  <span><b>${hub.franchises.length}</b> ${escape(ui("Franchises in progress"))}</span>
  <span><b>${hub.projects.length}</b> ${escape(ui("Projects in progress"))}</span>
  <span><b>${hub.completeDirectors + hub.completeFranchises + hub.completeProjects}</b> ${escape(ui("Complete"))}</span>
  <span><b>${bracketSummary.filled}/${bracketSummary.total}</b> ${escape(ui("Bracket slots filled"))}</span>
  <span><b>${reachedWatchGoals}/${watchGoals.length}</b> ${escape(ui("Watch goals reached"))}</span>
  <span><b>${earnedTrophiesCount}/${totalTrophiesCount}</b> ${escape(ui("Trophies earned"))}</span>
  ${earnedPersonaTitles.length ? `<span><b>${earnedPersonaTitles.length}</b> ${escape(ui("Persona titles unlocked"))}</span>` : ""}
`,
    });

    container.innerHTML = `<header class="completion-hero">
  <h1>${escape(ui("Completion"))}</h1>
  <p>${escape(ui("Official completion covers every imported official nominee, per source. Director, franchise, and project completion covers known films in the archive and watchlist."))}</p>
  ${summaryHtml}
</header>
${
  compactCompletionError
    ? `<p class="detail-empty" role="status">${escape(ui("Could not load completion data."))} <button type="button" class="link-button" data-completion-compact-retry>${escape(ui("Try again"))}</button></p>`
    : ""
}
<div class="completion-control-panel">
  ${categoryTabsHtml}
  <div class="completion-view-toolbar"><span>${escape(ui("Completion display"))}</span>${window.renderFilmViewToggle(
    {
      view: layout,
      listUrl: completionViewUrl("list"),
      gridUrl: completionViewUrl("grid"),
      escape,
      ariaLabel: ui("Completion display"),
    },
  )}</div>
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "trophies") ? " is-hidden" : ""}">
${window.renderTrophyCabinet()}
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "watch-goals") ? " is-hidden" : ""}">
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
  watchGoalsPeriodMatrixHtml(),
)}
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "canonical-lists") ? " is-hidden" : ""}">
${completionSection(
  "canonical-lists",
  ui("Canonical lists"),
  ui(
    "Curated historical and critical film lists — IMDb Top 250, Letterboxd Top 250, Sight & Sound, and NYT 100.",
  ),
  canonicalListsSectionHtml(),
)}
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "directors") ? " is-hidden" : ""}">
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
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "franchises") ? " is-hidden" : ""}">
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
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "projects") ? " is-hidden" : ""}">
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
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "official") ? " is-hidden" : ""}">
${officialCompletionSections()}
</div>
<div class="completion-section-wrap${!isTabMatch(activeTab, "brackets") ? " is-hidden" : ""}">
${completionSection(
  "brackets",
  ui("Award brackets"),
  ui(
    "How much of each imported award period's category slots are filled in — data entry, not watch progress.",
  ),
  `${awardBracketsPeriodMatrixHtml()}<div class="completion-subsection completion-bracket-categories"><h3>${escape(ui("By category"))}</h3><p>${escape(ui("Annual award slots across years with at least one watched film."))}</p>${bracketCategoryCompletionGrid(bracketCategoryCompletion)}</div>`,
)}
</div>
${completionCompactActive || inProgressTotal || anyOfficialNomineesTotal() ? "" : `<div class="detail-empty"><h2>${escape(ui("Nothing in progress."))}</h2><p>${escape(ui("Import a watchlist or start a project to track completion."))}</p></div>`}
${officialWatchlistDialog()}`;

    container
      .querySelectorAll(".completion-section .leaderboard-wrap")
      .forEach((wrapper) => wrapper.setAttribute("data-collapsible-skip", ""));
    window.enhanceCollapsibles?.(container);
    finishRenderTimer?.(
      `${inProgressTotal} in progress, ${hub.completeDirectors + hub.completeFranchises + hub.completeProjects} complete, ${officialSourceIds.map((sourceId) => `${officialCompletions.get(sourceId).nominees.watchedCount}/${officialCompletions.get(sourceId).nominees.total}`).join(", ")} official films watched by source, ${bracketCompletion.length} bracket period(s)`,
    );
  }

  render();
  function fetchOfficialResults() {
    if (
      completionCompactActive &&
      window.loadSupabaseCompletionOfficialProjection
    ) {
      return window
        .loadSupabaseCompletionOfficialProjection()
        .then((officialResults) => {
          window.state.officialResults = Object.assign(
            window.state.officialResults || {},
            officialResults,
          );
          return true;
        })
        .catch(() => window.hydrateOfficialResultsFromSupabase?.());
    }
    return window.hydrateOfficialResultsFromSupabase?.();
  }

  fetchOfficialResults()?.then(() => {
    officialResultsHydrated = true;
    if (completionCompactActive) applyCompactOfficialModel();
    else refreshOfficialCompletions();
    ensureOfficialSortState();
    // Backfill only - never overwrite an existing entry, since a user's
    // in-session tier change (line ~1071 below) must survive this refresh.
    officialSourceIds.forEach((sourceId) => {
      if (!officialWatchlistTiers.has(sourceId))
        officialWatchlistTiers.set(
          sourceId,
          preferredOfficialWatchlistTier(sourceId),
        );
    });
    render();
  });

  async function handleCompletionClick(event) {
    let tabButton = event.target.closest("[data-completion-tab]");
    if (tabButton) {
      let tab = tabButton.dataset.completionTab;
      let url = new URL(window.location.href);
      if (tab === "trophies") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tab);
      window.history?.replaceState?.(null, "", url.toString());
      render();
      return;
    }
    if (event.target.closest("[data-completion-compact-retry]")) {
      compactCompletionError = null;
      ensureCompactCompletionFresh();
      render();
      return;
    }
    let addWatchlistButton = event.target.closest("[data-add-oscar-watchlist]");
    if (addWatchlistButton) {
      let scopeId = addWatchlistButton.dataset.addOscarWatchlist;
      // officialCollectionWatchlistPlan() itself reads window.state
      // directly (unlike officialCollectionCompletion(), it has no
      // options.state override) - wait for full hydration before
      // computing a plan at all, not just before applying it.
      await ensureCompletionFullyHydrated().catch(() => {});
      let plan = window.officialCollectionWatchlistPlan?.(scopeId);
      if (!plan) return;
      if (plan.needsReview.length) {
        pendingOfficialWatchlistPlan = plan;
        render();
        let dialog = container.querySelector(
          `[data-official-watchlist-dialog="${plan.sourceId}"]`,
        );
        if (dialog?.showModal) dialog.showModal();
        else dialog?.setAttribute("open", "");
      } else await addOfficialWatchlistSource(scopeId);
      return;
    }
    if (event.target.closest("[data-confirm-oscar-watchlist]")) {
      let scopeId = pendingOfficialWatchlistPlan?.scopeId;
      if (scopeId) await addOfficialWatchlistSource(scopeId);
      return;
    }
    if (event.target.closest("[data-cancel-oscar-watchlist]")) {
      pendingOfficialWatchlistPlan = null;
      render();
      return;
    }
    let undoButton = event.target.closest("[data-undo-oscar-watchlist]");
    if (undoButton) {
      let sourceId = undoButton.dataset.undoOscarWatchlist;
      let result = window.undoOfficialCollectionWatchlistAdd?.(
        sourceId,
        lastOfficialWatchlistAdditions.get(sourceId) || [],
        { save: false },
      );
      try {
        if (result?.ok) await persistCompletionRemovals(result.removed);
      } catch (err) {
        officialWatchlistStatuses.set(sourceId, err.message || String(err));
        render();
        return;
      }
      lastOfficialWatchlistAdditions.delete(sourceId);
      officialCompletions.set(
        sourceId,
        window.officialCollectionCompletion(sourceId),
      );
      officialWatchlistStatuses.set(
        sourceId,
        result?.ok
          ? ui("Removed {count} recently added films.", {
              count: result.removed.length,
            })
          : result?.reason || ui("Undo failed."),
      );
      render();
      return;
    }
    let addCanonicalButton = event.target.closest(
      "[data-add-canonical-watchlist]",
    );
    if (addCanonicalButton) {
      let listId = addCanonicalButton.dataset.addCanonicalWatchlist;
      await addCanonicalWatchlistSource(listId);
      return;
    }
    let undoCanonicalButton = event.target.closest(
      "[data-undo-canonical-watchlist]",
    );
    if (undoCanonicalButton) {
      let listId = undoCanonicalButton.dataset.undoCanonicalWatchlist;
      let result = window.undoCanonicalListWatchlistAdd?.(
        listId,
        lastCanonicalListAdditions.get(listId) || [],
        { save: false },
      );
      try {
        if (result?.ok) await persistCompletionRemovals(result.removed);
      } catch (err) {
        canonicalListStatuses.set(listId, err.message || String(err));
        render();
        return;
      }
      lastCanonicalListAdditions.delete(listId);
      refreshCanonicalLists();
      canonicalListStatuses.set(
        listId,
        result?.ok
          ? ui("Removed {count} recently added films.", {
              count: result.removed.length,
            })
          : result?.reason || ui("Undo failed."),
      );
      render();
      return;
    }
    let filterTab = event.target.closest("[data-canonical-filter]");
    if (filterTab) {
      let listId = filterTab.dataset.canonicalFilter;
      let filterValue = filterTab.dataset.filterValue;
      canonicalListFilters.set(listId, filterValue);
      canonicalExpandedLists.add(listId);
      render();
      return;
    }
    let projectButton = event.target.closest("[data-start-project-source]");
    if (projectButton) {
      projectButton.disabled = true;
      // watchGoalProjectSource()/window.startProjectFromSourceAndOpen
      // read window.state directly - wait for full hydration first
      // (reachable from the watch-goals section, which stays live in
      // compact mode; director/franchise/project source buttons only
      // exist once hub is populated post-hydration anyway).
      await ensureCompletionFullyHydrated().catch(() => {});
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
  }

  let completionWriteBusy = false;
  container.addEventListener("click", async (event) => {
    let mutating = [
      "[data-add-oscar-watchlist]",
      "[data-confirm-oscar-watchlist]",
      "[data-undo-oscar-watchlist]",
      "[data-add-canonical-watchlist]",
      "[data-undo-canonical-watchlist]",
    ].some((selector) => event.target.closest(selector));
    if (mutating && completionWriteBusy) return;
    if (mutating) completionWriteBusy = true;
    try {
      await handleCompletionClick(event);
    } catch (err) {
      window.alert?.(err.message || String(err));
    } finally {
      if (mutating) completionWriteBusy = false;
    }
  });

  container.addEventListener(
    "toggle",
    (event) => {
      let details = event.target.closest("[data-canonical-details]");
      if (details) {
        let listId = details.dataset.canonicalDetails;
        if (details.open) canonicalExpandedLists.add(listId);
        else canonicalExpandedLists.delete(listId);
      }
    },
    true,
  );

  container.addEventListener("change", (event) => {
    let tierInput = event.target.closest("[data-oscar-watchlist-tier]");
    if (tierInput) {
      let sourceId = tierInput.dataset.oscarWatchlistTier;
      let tier = window.watchlistTierKey(tierInput.value);
      if (tier) {
        officialWatchlistTiers.set(sourceId, tier);
        try {
          localStorage.setItem(officialWatchlistTierKey(sourceId), tier);
        } catch (err) {}
      }
      return;
    }
    let canonicalTierInput = event.target.closest(
      "[data-canonical-watchlist-tier]",
    );
    if (canonicalTierInput) {
      let listId = canonicalTierInput.dataset.canonicalWatchlistTier;
      let tier = window.watchlistTierKey(canonicalTierInput.value);
      if (tier) {
        canonicalListTiers.set(listId, tier);
        try {
          localStorage.setItem(canonicalListTierKey(listId), tier);
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

  window.addEventListener?.("popstate", () => {
    render();
  });
})();
