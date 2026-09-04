/** @file Renders the period page's Watchlist view mode: tier filters, sub-period
 * cascade, add-to-watchlist form, filter controls, disposable queue, and the
 * grid/list card renderers, plus the wiring dispatcher for its interactive
 * controls (tier toggles, sub-period selects, bulk-tier apply, order-edit
 * drag/drop). Filter/edit-mode state stays owned by period.js; this module
 * takes it as explicit parameters and reports interactions back through a
 * caller-supplied handlers object. */

/**
 * @typedef {Object} WatchlistFilters
 * @property {string} type Period type ("year"|"decade"|"century"|"alltime").
 * @property {string} key Period key.
 * @property {string} search Search-box text filter.
 * @property {string} director Director filter.
 * @property {number} minRuntime Minimum-runtime filter, in minutes.
 * @property {number} maxRuntime Maximum-runtime filter, in minutes.
 * @property {string[]|null} tierFilter Selected tiers ("" for unset), or null for all tiers.
 * @property {string} subCentury Selected sub-century, or "all".
 * @property {string} subDecade Selected sub-decade, or "all".
 * @property {string} subYear Selected sub-year, or "all".
 * @property {string} order Sort axis ("rank", "shuffle", or a `compareFilmAxisRecords` axis).
 * @property {string} direction Sort direction ("asc"|"desc").
 * @property {string} shuffleSeed Seed used when `order` is "shuffle".
 */

// Disposable-queue size (issue #163): matches period.js's own small,
// deliberately un-configurable pick count for "Start project" alternative.
const WATCHLIST_QUEUE_SIZE = 5;

function watchlistBelongsToPeriod(item, archiveFilm, filters) {
  return window.filmMatchesFilters(
    {
      year: String(item.year || archiveFilm?.year || "").trim(),
      allTimeRank: archiveFilm?.allTimeRank,
    },
    { period: `${filters.type}:${filters.key}` },
    { period: { alltimeMatchesAll: true } },
  );
}

  // Period + director/search only (not tier, not sub-period) - the stable
  // base both the tier-toggle counts and the sub-period select counts are
  // computed from, each further filtered by the OTHER axis so neither
  // control's counts shift when you use itself to narrow the view.
/**
 * Returns watchlist entries matching the period and director/search
 * filters, before tier or sub-period narrowing - the stable base both the
 * tier-toggle counts and the sub-period select counts are computed from.
 * @param {WatchlistFilters} filters Watchlist filter/sort state.
 * @returns {Object[]} `{item, index, archiveFilm}` entries.
 */
window.periodWatchlistBaseEntries = function (filters) {
    return (state.watchlist || [])
      .map((item, index) => {
        let archiveFilm = window.findWatchlistArchiveFilm(item);
        return { item, index, archiveFilm };
      })
      .filter((entry) =>
        watchlistBelongsToPeriod(entry.item, entry.archiveFilm, filters),
      )
      .filter((entry) => matchesWatchlistDirectorAndSearch(entry, filters))
      .filter((entry) => matchesWatchlistRuntime(entry, filters));
};

function matchesWatchlistRuntime(entry, filters) {
    return window.filmMatchesFilters(entry.item, {
      minimumRuntime: filters.minRuntime,
      maximumRuntime: filters.maxRuntime,
    });
  }

function watchlistFilterRecord(entry) {
    return {
      year: String(entry.item.year || entry.archiveFilm?.year || "").trim(),
      allTimeRank: entry.archiveFilm?.allTimeRank,
    };
  }

  // Most specific selected sub-period wins - picking a year implies its
  // decade/century, so those never need to be checked separately.
function watchlistSubPeriodValue(filters) {
    if (filters.subYear !== "all") return `year:${filters.subYear}`;
    if (filters.subDecade !== "all") return `decade:${filters.subDecade}`;
    if (filters.subCentury !== "all") return `century:${filters.subCentury}`;
    return "";
  }

function matchesWatchlistSubPeriod(entry, filters) {
    let value = watchlistSubPeriodValue(filters);
    if (!value) return true;
    return window.filmMatchesFilters(watchlistFilterRecord(entry), {
      period: value,
    });
  }

/**
 * Returns period-, tier-, sub-period-, and director/search-filtered
 * watchlist entries in the current sort order.
 * @param {WatchlistFilters} filters Watchlist filter/sort state.
 * @returns {Object[]} Sorted `{item, index, archiveFilm}` entries.
 */
window.periodWatchlistEntries = function (filters) {
    return window.periodWatchlistBaseEntries(filters)
      .filter((entry) => matchesWatchlistTier(entry, filters))
      .filter((entry) => matchesWatchlistSubPeriod(entry, filters))
      .sort((left, right) =>
        filters.order === "shuffle"
          ? window.compareBySeededShuffle(
              left.item.id || window.watchlistItemId(left.item),
              right.item.id || window.watchlistItemId(right.item),
              filters.shuffleSeed,
            ) || left.index - right.index
          : filters.order === "rank"
            ? window.compareWatchlistItems(left.item, right.item) ||
              left.index - right.index
            : window.compareFilmAxisRecords(
                { item: left.item },
                { item: right.item },
                { axis: filters.order, order: filters.direction },
              ) || left.index - right.index,
      );
};

  // Groups base entries (period + tier/search/director, before sub-period
  // narrowing) into century/decade/year option counts for the sub-period
  // selects below - entries without a real year never contribute.
function watchlistSubPeriodGroupCounts(entries, levelType) {
    let counts = new Map();
    entries.forEach((entry) => {
      let year = watchlistFilterRecord(entry).year;
      if (!/^\d{4}$/.test(year)) return;
      let optionKey =
        levelType === "year"
          ? year
          : levelType === "decade"
            ? window.getDecadeKey(year)
            : window.getCenturyKey(year);
      counts.set(optionKey, (counts.get(optionKey) || 0) + 1);
    });
    return [...counts.entries()].sort(
      (left, right) =>
        Number(left[0].replace(/s$/, "")) - Number(right[0].replace(/s$/, "")),
    );
  }

function renderWatchlistSubPeriodSelect(
  { attribute, value, allLabel, options },
  escape,
  ui,
) {
    if (!options.length) return "";
    let optionsHtml = options
      .map(
        ([optionKey, count]) =>
          `<option value="${escape(optionKey)}" ${value === optionKey ? "selected" : ""}>${escape(`${optionKey} (${count})`)}</option>`,
      )
      .join("");
    let label =
      attribute === "century"
        ? ui("Century")
        : attribute === "decade"
          ? ui("Decade")
          : ui("Year");
    return `<label>${escape(label)} <select data-period-watchlist-subperiod="${attribute}"><option value="all" ${value === "all" ? "selected" : ""}>${escape(allLabel)}</option>${optionsHtml}</select></label>`;
  }

  // Cascading century -> decade -> year narrowing within the current period
  // (issue #154): each finer select's options are scoped by any coarser
  // selection already made, but not vice versa.
/**
 * Renders the cascading century -> decade -> year sub-period narrowing
 * controls (issue #154) for the current period type; each finer select's
 * options are scoped by any coarser selection already made.
 * @param {WatchlistFilters} filters Watchlist filter/sort state.
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {Function} [options.ui] Localized-text function.
 * @returns {string}
 */
window.watchlistSubPeriodControls = function (filters, options = {}) {
    let escape = options.escape || window.pageEscape;
    let ui = options.ui || window.uiText || ((text) => text);
    if (filters.type === "year") return "";
    let baseEntries = window.periodWatchlistBaseEntries(filters).filter((entry) =>
      matchesWatchlistTier(entry, filters),
    );
    let selects = [];
    if (filters.type === "alltime") {
      selects.push(
        renderWatchlistSubPeriodSelect(
          {
            attribute: "century",
            value: filters.subCentury,
            allLabel: ui("All centuries"),
            options: watchlistSubPeriodGroupCounts(baseEntries, "century"),
          },
          escape,
          ui,
        ),
      );
    }
    if (filters.type === "century" || filters.type === "alltime") {
      let decadeScope =
        filters.type === "alltime" && filters.subCentury !== "all"
          ? baseEntries.filter(
              (entry) =>
                window.getCenturyKey(watchlistFilterRecord(entry).year) ===
                filters.subCentury,
            )
          : baseEntries;
      selects.push(
        renderWatchlistSubPeriodSelect(
          {
            attribute: "decade",
            value: filters.subDecade,
            allLabel: ui("All decades"),
            options: watchlistSubPeriodGroupCounts(decadeScope, "decade"),
          },
          escape,
          ui,
        ),
      );
    }
    let yearScope =
      filters.subDecade !== "all"
        ? baseEntries.filter(
            (entry) =>
              window.getDecadeKey(watchlistFilterRecord(entry).year) ===
              filters.subDecade,
          )
        : filters.type === "alltime" && filters.subCentury !== "all"
          ? baseEntries.filter(
              (entry) =>
                window.getCenturyKey(watchlistFilterRecord(entry).year) ===
                filters.subCentury,
            )
          : baseEntries;
    selects.push(
      renderWatchlistSubPeriodSelect(
        {
          attribute: "year",
          value: filters.subYear,
          allLabel: ui("All years"),
          options: watchlistSubPeriodGroupCounts(yearScope, "year"),
        },
        escape,
        ui,
      ),
    );
    if (!selects.some(Boolean)) return "";
    return `<fieldset class="period-filter-controls period-subperiod-filter-controls"><legend>${escape(ui("Narrow period"))}</legend>${selects.join("")}</fieldset>`;
};

function matchesWatchlistTier(entry, filters) {
    return window.filmMatchesFilters(entry.item, {
      watchlistTier: filters.tierFilter,
    });
  }

function matchesWatchlistDirectorAndSearch(entry, filters) {
    if (filters.director) {
      let directorId =
        window.normalizePersonName?.(filters.director) ||
        window.normalizeTitle(filters.director);
      let itemDirectors = String(entry.item.director || "")
        .split(/\s*(?:,|;|\/|\s+&\s+|\s+and\s+)\s*/i)
        .map(
          (name) =>
            window.normalizePersonName?.(name) || window.normalizeTitle(name),
        );
      if (!itemDirectors.includes(directorId)) return false;
    }
    if (!filters.search) return true;
    return window.searchTextMatches(
      filters.search,
      entry.item.title,
      entry.item.year,
      entry.item.director || "",
    );
  }

function selectedTierSet(filters) {
    return new Set(
      filters.tierFilter === null
        ? window.watchlistTierFilterValues()
        : filters.tierFilter,
    );
  }

function tierFilterKey(filters) {
    if (filters.tierFilter === null) return "all";
    return filters.tierFilter.length
      ? filters.tierFilter.map((tier) => tier || "unset").join("-")
      : "none";
  }

function tierFilterLabel(filters, ui) {
    if (filters.tierFilter === null) return ui("All tiers");
    if (!filters.tierFilter.length) return ui("No tiers");
    return filters.tierFilter.map((tier) => tier || ui("Unset")).join(", ");
  }

  // Tier-toggle counts are scoped by sub-period/director/search but not by
  // the tier filter itself, so picking a tier never makes the others read 0.
function watchlistTierFilterEntries(filters) {
    return window.periodWatchlistBaseEntries(filters).filter((entry) =>
      matchesWatchlistSubPeriod(entry, filters),
    );
  }

/**
 * Renders the single-film "Add to watchlist" form (issue #183).
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {Function} [options.ui] Localized-text function.
 * @returns {string}
 */
window.renderAddWatchlistForm = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
    let tierOptions = [
      `<option value="">${escape(ui("Unset"))}</option>`,
    ]
      .concat(
        window.WATCHLIST_TIERS.map(
          (tier) =>
            `<option value="${escape(tier)}">${escape(tier)}</option>`,
        ),
      )
      .join("");
    return `<fieldset class="period-filter-controls"><legend>${escape(ui("Add film"))}</legend><form data-add-watchlist-form><label>${escape(ui("Title"))} <input type="text" name="title" required></label><label>${escape(ui("Year"))} <input type="number" name="year" min="1888" max="2100"></label><label>${escape(ui("Director"))} <input type="text" name="director"></label><label>${escape(ui("Interest"))} <select name="tier">${tierOptions}</select></label>${window.renderCollectionActionButton({ kind: "watchlist", label: ui("Add to watchlist"), escape, attributes: { type: "submit" } })}</form></fieldset>`;
};

/**
 * Renders the multi-tier toggle-button filter, with per-tier counts scoped
 * by every other active filter so picking a tier never zeroes the others.
 * @param {WatchlistFilters} filters Watchlist filter/sort state.
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {Function} [options.ui] Localized-text function.
 * @returns {string}
 */
window.renderWatchlistTierFilter = function (filters, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
    let entries = watchlistTierFilterEntries(filters);
    let counts = new Map(
      window.watchlistTierFilterValues().map((tier) => [tier, 0]),
    );
    entries.forEach((entry) => {
      let tier = window.normalizeWatchlistTier(entry.item.tier);
      counts.set(tier, (counts.get(tier) || 0) + 1);
    });
    let selected = selectedTierSet(filters);
    let buttons = window.watchlistTierFilterValues()
      .map((tier) => {
        let label = tier || ui("Unset");
        let active = selected.has(tier);
        let cls = tier ? ` tier-${tier.toLowerCase()}` : "";
        return `<button type="button" class="watchlist-tier-filter-button${active ? " is-active" : ""}${cls}" data-period-watchlist-tier-toggle="${escape(tier || "unset")}" aria-pressed="${active ? "true" : "false"}"><span>${escape(label)}</span><small>${escape(counts.get(tier) || 0)}</small></button>`;
      })
      .join("");
    return `<fieldset class="watchlist-filter-card watchlist-tier-filter"><legend>${escape(ui("Interest"))}</legend><div>${buttons}</div></fieldset>`;
};

function watchlistFilterSourceId(filters) {
    return window.normalizeProjectId(
      [
        filters.type,
        filters.key,
        filters.search || "all",
        filters.director || "all",
        filters.minRuntime || "all",
        filters.maxRuntime || "all",
        tierFilterKey(filters),
        filters.subCentury || "all",
        filters.subDecade || "all",
        filters.subYear || "all",
        filters.order || "rank",
        filters.direction || "asc",
      ].join("-"),
    );
  }

function watchlistFilterLabel(filters, filteredCount, ui) {
    let parts = [];
    if (filters.subYear !== "all") parts.push(filters.subYear);
    else if (filters.subDecade !== "all") parts.push(filters.subDecade);
    else if (filters.subCentury !== "all") parts.push(filters.subCentury);
    if (filters.search) parts.push(`${ui("search")} "${filters.search}"`);
    if (filters.director)
      parts.push(`${ui("Director")} ${filters.director}`);
    if (filters.minRuntime)
      parts.push(ui("over {minutes} min", { minutes: filters.minRuntime }));
    if (filters.maxRuntime)
      parts.push(ui("under {minutes} min", { minutes: filters.maxRuntime }));
    if (filters.tierFilter !== null)
      parts.push(`${ui("Interest")} ${tierFilterLabel(filters, ui)}`);
    return `${parts.length ? parts.join(", ") : ui("all watchlist")} · ${window.uiCount?.(filteredCount, "film", "films") || `${filteredCount} films`}`;
  }

/**
 * Registers the current filtered watchlist set as a startable project
 * source, so "Start project" and the disposable queue build from exactly
 * what's on screen without duplicating rows.
 * @param {WatchlistFilters} filters Watchlist filter/sort state.
 * @param {Object[]} filtered Currently filtered `{item, index, archiveFilm}` entries.
 * @param {string} href The current watchlist view's own URL.
 * @returns {string} The registered project source id.
 */
window.registerWatchlistFilterProjectSource = function (
  filters,
  filtered,
  href,
) {
  let ui = window.uiText || ((text) => text);
    state.watchlistProjectSources ||= {};
    let sourceId = watchlistFilterSourceId(filters);
    state.watchlistProjectSources[sourceId] = {
      name: `Watchlist: ${filters.key} · ${watchlistFilterLabel(filters, filtered.length, ui)}`,
      label: watchlistFilterLabel(filters, filtered.length, ui),
      href,
      itemIds: filtered.map(
        (entry) => entry.item.id || window.watchlistItemId(entry.item),
      ),
    };
    return sourceId;
};

function watchlistTierEditor(item, escape, ui) {
    let normalized = window.normalizeWatchlistTier(item.tier);
    let options = [
      `<option value=""${normalized ? "" : " selected"}>${escape(ui("Unset"))}</option>`,
    ]
      .concat(
        window.WATCHLIST_TIERS.map(
          (tier) =>
            `<option value="${escape(tier)}"${normalized === tier ? " selected" : ""}>${escape(tier)}</option>`,
        ),
      )
      .join("");
    return `<label class="watchlist-tier-editor">${escape(ui("Interest"))} <select data-period-watchlist-tier-editor="${escape(item.id || window.watchlistItemId(item))}">${options}</select></label>`;
  }

/**
 * Renders one watchlist entry as a grid card, with tier badge/editor and
 * order-edit drag attributes according to the current edit mode.
 * @param {Object} entry `{item, index, archiveFilm}` watchlist entry.
 * @param {number} [visibleIndex] Entry's index within the currently visible page, for order-edit drag attributes.
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {Function} [options.ui] Localized-text function.
 * @param {boolean} [options.tierEditMode] Whether the per-item tier editor is shown.
 * @param {boolean} [options.watchlistOrderEditMode] Whether drag-to-reorder attributes are attached.
 * @param {string} [options.periodOrder] Current sort axis, to decide whether to show the order rank label.
 * @returns {string}
 */
window.renderWatchlistCard = function (entry, visibleIndex = 0, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let tierEditMode = Boolean(options.tierEditMode);
  let watchlistOrderEditMode = Boolean(options.watchlistOrderEditMode);
  let periodOrder = options.periodOrder;
    let item = entry.item;
    item.id ||= window.watchlistItemId(item);
    let film = window.watchlistFilmLike(item, entry.archiveFilm);
    let order = Number(item.order);
    let orderRankLabel =
      Number.isInteger(order) && order > 0 && periodOrder === "rank"
        ? `${order}.`
        : null;
    let directorHtml = window.renderLinkedDirectors(film, {
      escape: escape,
    });
    return window.renderSharedFilmCard(film, {
      classes: [
        "watchlist-card",
        tierEditMode ? "watchlist-card--editing" : "",
        watchlistOrderEditMode ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: watchlistOrderEditMode,
        scope: "watchlist",
        id: item.id,
        index: visibleIndex,
        group: window.normalizeWatchlistTier(item.tier),
      }),
      openFilm: false,
      rankLabel: orderRankLabel,
      showYear: true,
      directorHtml: directorHtml
        ? `<div class="film-director">${escape(ui("by"))} ${directorHtml}</div>`
        : "",
      escape: escape,
      titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(item.supabaseFilmId))}">${escape(window.localizedFilmTitle?.(film) || item.title)}</a>`,
      bodyHtml: tierEditMode
        ? watchlistTierEditor(item, escape, ui)
        : window.renderWatchlistTierBadge(item.tier, {
            escape: escape,
          }),
    });
};

  // Standard collection row (issue #136): Interest/order | Film | Director |
  // Tier.
/**
 * Renders one watchlist entry as a leaderboard row: Interest/order | Film |
 * Director | Tier (issue #136).
 * @param {Object} entry `{item, index, archiveFilm}` watchlist entry.
 * @param {number} [visibleIndex] Entry's index within the currently visible page, for order-edit drag attributes.
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {boolean} [options.tierEditMode] Whether the per-item tier editor is shown.
 * @param {boolean} [options.watchlistOrderEditMode] Whether drag-to-reorder attributes are attached.
 * @returns {string}
 */
window.renderWatchlistRow = function (entry, visibleIndex = 0, options = {}) {
  let escape = options.escape || window.pageEscape;
  let tierEditMode = Boolean(options.tierEditMode);
  let watchlistOrderEditMode = Boolean(options.watchlistOrderEditMode);
    let item = entry.item;
    item.id ||= window.watchlistItemId(item);
    let film = window.watchlistFilmLike(item, entry.archiveFilm);
    let directorHtml = window.renderLinkedDirectors(film, {
      escape: escape,
    });
    let attributes = window.renderOrderEditItemAttributes(
      {
        enabled: watchlistOrderEditMode,
        scope: "watchlist",
        id: item.id,
        index: visibleIndex,
        group: window.normalizeWatchlistTier(item.tier),
      },
      escape,
    );
    return `<tr${attributes}><td class="leaderboard-position">${escape(item.order || "—")}</td>${window.renderFilmIdentityCell(
      film,
      {
        escape: escape,
        href: window.filmPageUrl(item.supabaseFilmId),
        year: true,
      },
    )}<td class="film-people-cell">${directorHtml}</td>${window.renderRatingTierCell({ item }, { escape: escape, editHtml: tierEditMode ? watchlistTierEditor(item, escape, window.uiText || ((text) => text)) : "" })}</tr>`;
};

/**
 * Renders the Watchlist filters fieldset: active director-filter chip,
 * search box, min/max runtime inputs, the shared bulk-tier control, the
 * disposable-queue toggle, and the "Start project" button.
 * @param {WatchlistFilters} filters Watchlist filter/sort state.
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {Function} [options.ui] Localized-text function.
 * @param {number} [options.filteredCount] Count of entries the current filters match.
 * @param {string} [options.projectSourceId] Registered project source id for "Start project".
 * @param {string} [options.bulkTierValue] Currently selected bulk-tier value.
 * @param {boolean} [options.queueVisible] Whether the disposable queue panel is open.
 * @returns {string}
 */
window.watchlistFilterControls = function (filters, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let filteredCount = options.filteredCount || 0;
  let projectSourceId = options.projectSourceId || "";
  let bulkTierValue = options.bulkTierValue;
  let queueVisible = Boolean(options.queueVisible);
    return `<fieldset class="period-filter-controls"><legend>${escape(ui("Watchlist filters"))}</legend>${filters.director ? `<div class="active-filter-chip">${escape(ui("Director"))}: <strong>${escape(filters.director)}</strong> <button type="button" data-clear-period-watchlist-director aria-label="${escape(ui("Clear director filter"))}">×</button></div>` : ""}<label>${escape(ui("Search"))} <input type="search" data-period-watchlist-search value="${escape(filters.search)}"></label><label>${escape(ui("Minimum runtime (minutes)"))} <input type="number" min="1" max="2000" data-period-watchlist-min-runtime value="${filters.minRuntime ? escape(String(filters.minRuntime)) : ""}"></label><label>${escape(ui("Maximum runtime (minutes)"))} <input type="number" min="1" max="2000" data-period-watchlist-max-runtime value="${filters.maxRuntime ? escape(String(filters.maxRuntime)) : ""}"></label>${window.renderWatchlistBulkTierControl({ escape, count: filteredCount, value: bulkTierValue })}<button type="button" class="sort-order-button" data-period-watchlist-queue-toggle ${filteredCount ? "" : "disabled"}>${escape(ui(queueVisible ? "Hide queue" : "Show queue"))}</button><button type="button" class="sort-order-button" data-start-project-source="watchlist-filter" data-project-source-id="${escape(projectSourceId)}" ${filteredCount ? "" : "disabled"}>${escape(ui("Start project"))}</button></fieldset>`;
};

  // A disposable queue: recomputed from the current filtered entries every
  // render, never saved to state.projects/watchlistProjectSources. Reuses
  // the same pick/reason operation as Discover's watchlist picker (issue
  // #161) instead of a separate mechanism.
/**
 * Renders a disposable pick queue (issue #163) recomputed from the current
 * filtered entries every render - a lighter, never-persisted sibling to
 * "Start project" that reuses Discover's watchlist picker.
 * @param {Object[]} entries Currently filtered `{item, index, archiveFilm}` entries.
 * @param {Object} [options] Rendering options.
 * @param {(value:*) => string} [options.escape] HTML escaper.
 * @param {Function} [options.ui] Localized-text function.
 * @returns {string}
 */
window.renderWatchlistQueue = function (entries, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
    let picks = window.pickWatchQueueItems(
      entries.map((entry) => entry.item),
      { count: WATCHLIST_QUEUE_SIZE },
    );
    if (!picks.length)
      return `<div class="watchlist-queue-panel"><p>${escape(ui("No watchlist films match these filters."))}</p></div>`;
    let rows = picks
      .map((pick, index) => {
        let item = pick.item;
        let title = window.localizedFilmTitle?.(item) || item.title;
        return `<li><span class="watchlist-queue-position">${index + 1}</span><div><a href="${escape(window.filmPageUrl(item.supabaseFilmId))}">${escape(title)}</a>${window.renderWatchlistTierBadge(item.tier, { escape })}<p class="discovery-reason">${escape(window.watchQueueReasonText(pick.reason))}</p></div></li>`;
      })
      .join("");
    return `<div class="watchlist-queue-panel"><p>${escape(ui("A disposable queue recomputed from the current filters every time - nothing here is saved."))}</p><ol class="watchlist-queue-list">${rows}</ol></div>`;
};

/**
 * Wires every interactive Watchlist-view control (tier toggles, sub-period
 * selects, per-item tier editor, order/tier edit-mode toggles, disposable
 * queue toggle, director-filter clear, start-project button, add-film form,
 * bulk-tier apply, and tier-safe drag reordering) to a container, dispatching
 * each to a named handler. Mirrors `window.wireMergeCompareControls`: this
 * module owns "which control fired -> call the right handler," while all
 * state mutation (including domain persistence) stays in the supplied
 * handlers, which period.js owns.
 * @param {HTMLElement} container Page container element.
 * @param {Object} handlers Page-specific state and action callbacks.
 * @param {(value:number) => void} handlers.setMinRuntime Applies a raw minimum-runtime input value.
 * @param {(value:number) => void} handlers.setMaxRuntime Applies a raw maximum-runtime input value.
 * @param {(value:string) => void} handlers.setSearch Applies the search box's current value.
 * @param {() => void} handlers.commit Persists the debounced filter change to the URL and re-renders.
 * @param {(id:string, tier:string) => void} handlers.setItemTier Applies a per-item tier-editor change.
 * @param {(level:'century'|'decade'|'year', value:string) => void} handlers.setSubPeriod Applies a sub-period cascade selection.
 * @param {() => void} handlers.toggleOrderEdit Toggles watchlist order-edit mode.
 * @param {() => void} handlers.toggleTierEdit Toggles watchlist tier-edit mode.
 * @param {() => void} handlers.toggleQueue Toggles the disposable queue panel.
 * @param {(rawTier:string) => void} handlers.toggleTierFilter Toggles one tier in the tier filter.
 * @param {() => void} handlers.clearDirector Clears the director filter.
 * @param {(values:Object) => void} handlers.addItem Submits the add-to-watchlist form's values.
 * @param {() => Object[]} handlers.filteredEntries Returns the current filtered watchlist entries.
 * @param {(outcome:{tier:string, result:Object}) => void} handlers.applyBulkTier Applies a bulk-tier change outcome.
 * @param {() => boolean} handlers.orderEditEnabled Reports whether order-edit mode is active.
 * @param {string} [handlers.orderRejectedMessage] Message shown when a cross-tier move is rejected.
 * @param {(from:Object, target:Object, position:'before'|'after') => Object} handlers.moveItem Commits a tier-safe reorder move.
 * @param {() => void} handlers.afterMove Called after a reorder move commits.
 * @returns {{bulkTierControl: Object}} The bound bulk-tier control, for the page to read `.value()` from at render time.
 */
window.wirePeriodWatchlistControls = function (container, handlers) {
  let searchRenderTimer = null;
  let minRuntimeRenderTimer = null;
  let maxRuntimeRenderTimer = null;

  container.addEventListener("input", (event) => {
    let minRuntimeInput = event.target.closest(
      "[data-period-watchlist-min-runtime]",
    );
    if (minRuntimeInput) {
      handlers.setMinRuntime(Number(minRuntimeInput.value) || 0);
      if (minRuntimeRenderTimer) clearTimeout(minRuntimeRenderTimer);
      minRuntimeRenderTimer = setTimeout(() => {
        minRuntimeRenderTimer = null;
        handlers.commit();
        container.querySelector("[data-period-watchlist-min-runtime]")?.focus();
      }, 160);
      return;
    }
    let maxRuntimeInput = event.target.closest(
      "[data-period-watchlist-max-runtime]",
    );
    if (maxRuntimeInput) {
      handlers.setMaxRuntime(Number(maxRuntimeInput.value) || 0);
      if (maxRuntimeRenderTimer) clearTimeout(maxRuntimeRenderTimer);
      maxRuntimeRenderTimer = setTimeout(() => {
        maxRuntimeRenderTimer = null;
        handlers.commit();
        container.querySelector("[data-period-watchlist-max-runtime]")?.focus();
      }, 160);
      return;
    }
    let searchInput = event.target.closest("[data-period-watchlist-search]");
    if (!searchInput) return;
    handlers.setSearch(searchInput.value);
    if (searchRenderTimer) clearTimeout(searchRenderTimer);
    searchRenderTimer = setTimeout(() => {
      searchRenderTimer = null;
      handlers.commit();
      let refreshedInput = container.querySelector(
        "[data-period-watchlist-search]",
      );
      refreshedInput?.focus();
      let length = refreshedInput?.value?.length || 0;
      try {
        refreshedInput?.setSelectionRange?.(length, length);
      } catch (err) {}
    }, 160);
  });

  container.addEventListener("change", (event) => {
    let tierEditorInput = event.target.closest(
      "[data-period-watchlist-tier-editor]",
    );
    if (tierEditorInput) {
      handlers.setItemTier(
        tierEditorInput.dataset.periodWatchlistTierEditor,
        tierEditorInput.value,
      );
      return;
    }
    let subPeriodSelect = event.target.closest(
      "[data-period-watchlist-subperiod]",
    );
    if (subPeriodSelect) {
      handlers.setSubPeriod(
        subPeriodSelect.dataset.periodWatchlistSubperiod,
        subPeriodSelect.value,
      );
      return;
    }
  });

  container.addEventListener("click", (event) => {
    let orderEditToggle = event.target.closest(
      "[data-period-watchlist-order-edit-toggle]",
    );
    if (orderEditToggle && !orderEditToggle.disabled) {
      handlers.toggleOrderEdit();
      return;
    }
    if (event.target.closest("[data-period-watchlist-tier-edit-toggle]")) {
      handlers.toggleTierEdit();
      return;
    }
    let queueToggle = event.target.closest(
      "[data-period-watchlist-queue-toggle]",
    );
    if (queueToggle && !queueToggle.disabled) {
      handlers.toggleQueue();
      return;
    }
    let tierToggle = event.target.closest(
      "[data-period-watchlist-tier-toggle]",
    );
    if (tierToggle) {
      handlers.toggleTierFilter(tierToggle.dataset.periodWatchlistTierToggle);
      return;
    }
    if (event.target.closest("[data-clear-period-watchlist-director]")) {
      handlers.clearDirector();
      return;
    }
    let projectButton = event.target.closest(
      '[data-start-project-source="watchlist-filter"]',
    );
    if (projectButton && !projectButton.disabled) {
      window.startProjectFromSourceAndOpen(
        projectButton.dataset.startProjectSource,
        projectButton.dataset.projectSourceId,
      );
      return;
    }
  });

  container.addEventListener("submit", (event) => {
    let addForm = event.target.closest("[data-add-watchlist-form]");
    if (!addForm) return;
    event.preventDefault();
    handlers.addItem(Object.fromEntries(new FormData(addForm).entries()));
  });

  let bulkTierControl = window.bindWatchlistBulkTierControl({
    container,
    entries: handlers.filteredEntries,
    rerender: handlers.applyBulkTier,
  });

  window.createOrderEditController({
    container,
    scope: "watchlist",
    enabled: handlers.orderEditEnabled,
    rejectedMessage: handlers.orderRejectedMessage,
    commit: handlers.moveItem,
    rerender: handlers.afterMove,
  });

  return { bulkTierControl };
};
