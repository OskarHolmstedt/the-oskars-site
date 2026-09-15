/**
 * @file Renders the full film catalog (issue #495) - every watched,
 * watchlisted, and unseen film in one filterable, sortable, paginated
 * browse, backed by `window.buildFullFilmCatalog()`
 * (src/domain/film-catalog.js) merging the already-hydrated
 * `OSKARS_SHARED_FILM_ARCHIVE`/`state.filmsById`/`state.watchlist` - no
 * new fetch, the whole catalog is already loaded and cached by
 * `ensureOskarsData()` for Unseen/global-search/franchise-membership
 * elsewhere. This is the primary nav's own "Films" destination
 * (previously `period.html?type=alltime&view=films`, personal-watched-only).
 */
(function () {
  let escape = window.pageEscape;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
  let container = document.getElementById("filmsPage");

  let filterNames = [
    "period",
    "medium",
    "screenplay",
    "adaptationSource",
    "country",
    "minimumRating",
    "maximumRating",
    "minimumRuntime",
    "maximumRuntime",
    // Shared vocabulary reuse (film-filters.js) - no new predicate code.
    "watchlistTier",
    "category",
  ];
  // Not part of the shared film-filters.js vocabulary - each is a small
  // local predicate below (matchesTags/matchesFranchise/matchesPersonalAward/
  // matchesOfficialResult), same treatment as the free-text search and the
  // catalog-only `status` field.
  let localFilterNames = ["tags", "franchise", "personalAward", "officialResult"];
  let sortAxes = [
    { value: "title", label: "Title" },
    { value: "year", label: "Year" },
    { value: "rating", label: "Rating" },
    { value: "runtime", label: "Runtime" },
    { value: "tier", label: "Watchlist tier" },
    { value: "awards", label: "Personal award wins" },
  ];
  let viewState = window.createPageViewState({
    path: "films.html",
    schema: {
      status: {
        default: "",
        validate: (value) =>
          window.filmFilterDefinition("status")?.validate(value),
      },
      ...Object.fromEntries(
        filterNames.map((name) => [
          name,
          {
            default: "",
            validate: (value) =>
              window.filmFilterDefinition(name)?.validate(value),
          },
        ]),
      ),
      ...Object.fromEntries(
        localFilterNames.map((name) => [
          name,
          {
            default: "",
            validate: (value) =>
              !value ||
              (["personalAward", "officialResult"].includes(name)
                ? ["won", "nominated"].includes(value)
                : true),
          },
        ]),
      ),
      q: { default: "" },
      sort: {
        default: "title",
        validate: (value) => sortAxes.some((axis) => axis.value === value),
      },
      order: {
        default: "asc",
        validate: (value) => ["asc", "desc"].includes(value),
      },
      view: {
        default: "grid",
        validate: (value) => ["grid", "list"].includes(value),
      },
      page: {
        default: 1,
        parse: (value) => Math.max(1, Number(value) || 1),
        validate: (value) => Number.isInteger(value) && value >= 1,
      },
    },
  });
  let currentState = viewState.read();
  let catalog = null;
  let officialIndex = null;
  // Standard catalog-scale page size (matches people.js).
  let pageSize = 100;

  function fullCatalog() {
    if (!catalog) {
      // A Letterboxd (or Directors/Franchise sheet) row that doesn't match
      // the ranked archive lands in state.watchedOther instead (see
      // src/imports/letterboxd.js) - it never enters ranked lists or award
      // brackets, but it was still watched, so it belongs in this browse's
      // "Watched" status too (issue: imported films going missing from the
      // one global Watched destination). statusBadgeHtml() below tags these
      // "Other watched" rather than letting them read as fully ranked.
      let watchedFilms = [
        ...Object.values(state.filmsById || {}),
        ...(state.watchedOther || []),
      ];
      catalog = window.buildFullFilmCatalog(
        window.OSKARS_SHARED_FILM_ARCHIVE || {},
        watchedFilms,
        state.watchlist || [],
      );
    }
    return catalog;
  }

  function viewUrl(overrides) {
    return viewState.build(currentState, overrides);
  }

  function option(value, label, name) {
    return `<option value="${escape(value)}"${currentState[name] === String(value) ? " selected" : ""}>${escape(label)}</option>`;
  }

  function ratingOptions(kind) {
    return Array.from({ length: 10 }, (_, index) => {
      let value = (index + 1) / 2;
      let label = `${value % 1 ? value : value.toFixed(0)}★`;
      return option(
        value,
        kind === "minimum"
          ? ui("At least {rating}", { rating: label })
          : ui("At most {rating}", { rating: label }),
        kind === "minimum" ? "minimumRating" : "maximumRating",
      );
    }).join("");
  }

  function runtimeOptions(kind) {
    return [60, 90, 120, 150, 180, 210].map((value) =>
      option(
        value,
        kind === "minimum"
          ? ui("At least {minutes} min", { minutes: value })
          : ui("At most {minutes} min", { minutes: value }),
        kind === "minimum" ? "minimumRuntime" : "maximumRuntime",
      ),
    ).join("");
  }

  function periodOptionsHtml(films) {
    let years = [
      ...new Set(
        films
          .map((film) => String(film.year || ""))
          .filter((year) => /^\d{4}$/.test(year)),
      ),
    ].sort((left, right) => Number(right) - Number(left));
    let decades = [...new Set(years.map((year) => window.getDecadeKey(year)))].sort(
      (left, right) => right.localeCompare(left),
    );
    let centuries = [
      ...new Set(years.map((year) => window.getCenturyKey(year))),
    ].sort((left, right) => right.localeCompare(left));
    return `${option("", ui("Any period"), "period")}<optgroup label="${escape(ui("Centuries"))}">${centuries.map((key) => option(`century:${key}`, key, "period")).join("")}</optgroup><optgroup label="${escape(ui("Decades"))}">${decades.map((key) => option(`decade:${key}`, key, "period")).join("")}</optgroup><optgroup label="${escape(ui("Years"))}">${years.map((key) => option(`year:${key}`, key, "period")).join("")}</optgroup>`;
  }

  function countryOptionsHtml(films) {
    let countries = [
      ...new Set(
        films.flatMap((film) => window.countryListValues?.(film.country) || []),
      ),
    ].sort((left, right) => left.localeCompare(right));
    return countries
      .map((value) => option(value, value, "country"))
      .join("");
  }

  function tierOptionsHtml() {
    return (window.WATCHLIST_TIERS || [])
      .map((tier) => option(tier, tier, "watchlistTier"))
      .join("");
  }

  function categoryOptionsHtml() {
    return (window.getOrderedCategories?.() || [])
      .map((value) =>
        option(
          value,
          window.localizedCategoryName?.(value) || value,
          "category",
        ),
      )
      .join("");
  }

  function tagOptionsHtml() {
    return (window.getFilmTagIndex?.() || [])
      .map((entry) => option(entry.name, entry.name, "tags"))
      .join("");
  }

  function franchiseOptionsHtml() {
    return Object.values(window.ensureFranchiseIndex?.() || {})
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((franchise) => option(franchise.id, franchise.name, "franchise"))
      .join("");
  }

  // Wins-then-nominations - not part of the shared film-filters.js
  // vocabulary (that already covers a specific `category`), used by both
  // the "Personal award" filter and the "Personal award wins" sort axis.
  function personalAwardWins(film) {
    return (film.awards || []).filter((award) => Number(award.placement) === 1)
      .length;
  }
  function personalAwardNominations(film) {
    return (film.awards || []).length;
  }
  function matchesPersonalAward(film, value) {
    if (!value) return true;
    return value === "won"
      ? personalAwardWins(film) > 0
      : personalAwardNominations(film) > 0;
  }

  function matchesTags(film, value) {
    if (!value) return true;
    let needle = window.normalizeFilmTag(value).toLocaleLowerCase();
    return window
      .parseFilmTags(film.tags)
      .some((tag) => tag.toLocaleLowerCase() === needle);
  }

  // franchise.films/.watchlistFilms already roll up every descendant
  // sub-franchise's members (rollUpToAncestors() in franchises.js), so an
  // "era"/parent grouping matches its whole family, not just films tagged
  // with that exact id directly - matching film.franchises alone would
  // silently return nothing for any non-leaf franchise node.
  function franchiseMemberIds(value) {
    let franchise = window.ensureFranchiseIndex?.()[value];
    if (!franchise) return null;
    let ids = new Set(
      (franchise.films || []).map((entry) => entry.filmId),
    );
    (franchise.watchlistFilms || []).forEach((entry) => ids.add(entry.itemId));
    return ids;
  }

  // Built once per session from every official source/period's nominations
  // (issue #495) - a tmdbId-based reverse index (the same primary key
  // buildFullFilmCatalog() merges catalog records by), cheaper than
  // re-running officialResultsFilmMatch()'s per-period title/year matching
  // across the whole merged catalog. Reset after the live Supabase
  // hydration below replaces the bundled default, so a stale index never
  // outlives the data it was built from.
  function officialResultsIndex() {
    if (officialIndex) return officialIndex;
    let nominated = new Set();
    let won = new Set();
    Object.values(window.state?.officialResults || {}).forEach((source) => {
      Object.values(source.periods || {}).forEach((period) => {
        (period.nominations || []).forEach((nomination) => {
          let tmdbId = String(nomination.tmdbId || "").trim();
          if (!tmdbId) return;
          nominated.add(tmdbId);
          if (nomination.winner) won.add(tmdbId);
        });
      });
    });
    officialIndex = { nominated, won };
    return officialIndex;
  }
  function matchesOfficialResult(film, value) {
    if (!value) return true;
    let tmdbId = String(film.tmdbId || "").trim();
    if (!tmdbId) return false;
    let index = officialResultsIndex();
    return value === "won"
      ? index.won.has(tmdbId)
      : index.nominated.has(tmdbId);
  }

  // Free-text search over title and director, not part of the shared
  // film-filter vocabulary (it composes multiple fields, unlike every
  // other filter's single-field match).
  function matchesSearch(film, query) {
    if (!query) return true;
    let needle = query.trim().toLowerCase();
    if (!needle) return true;
    let director = String(
      film.director || Object.values(film.people || {}).find((p) => p.professions?.includes("Director"))?.name || "",
    ).toLowerCase();
    return (
      String(film.title || "").toLowerCase().includes(needle) ||
      director.includes(needle)
    );
  }

  function statusLabel(status) {
    return (
      { watched: ui("Watched"), watchlist: ui("Watchlist"), unseen: ui("Unseen") }[
        status
      ] || status
    );
  }

  let watchedOtherIndex = null;
  function isOtherWatchedFilm(film) {
    if (!watchedOtherIndex)
      watchedOtherIndex = new Set(
        (state.watchedOther || []).map((entry) => entry.id),
      );
    return watchedOtherIndex.has(film.id);
  }

  function statusBadgeHtml(film) {
    if (film.catalogStatus === "watched") {
      if (isOtherWatchedFilm(film))
        return `<span class="films-status films-status--watched films-status--other">${escape(ui("Other watched"))}</span>`;
      return film.rating
        ? `<span class="films-status films-status--watched">${escape(film.rating)}</span>`
        : `<span class="films-status films-status--watched">${escape(ui("Watched"))}</span>`;
    }
    if (film.catalogStatus === "watchlist")
      // A tier already implies watchlist membership - no tier means the
      // item hasn't been tiered yet, so "Watchlist" is the only fact left
      // to state.
      return `<span class="films-status films-status--watchlist">${film.tier ? escape(film.tier) : escape(ui("Watchlist"))}</span>`;
    return `<span class="films-status films-status--unseen">${escape(ui("Unseen"))}</span>`;
  }

  function filmCardHtml(film) {
    let title = window.localizedFilmTitle?.(film) || film.title;
    return window.renderSharedFilmCard(film, {
      classes: ["films-card"],
      openFilm: false,
      rating: false,
      escape,
      titleHtml: `<a class="table-film-link" href="${escape(film.href)}">${escape(title)}</a>`,
      showYear: true,
      bodyHtml: statusBadgeHtml(film),
    });
  }

  function filmRowHtml(film) {
    let title = window.localizedFilmTitle?.(film) || film.title;
    return `<tr>
      <td class="film-table-cell">${window.renderFilmPoster?.(film, "thumb") || ""}<span><a class="table-film-link" href="${escape(film.href)}">${escape(title)}</a></span></td>
      <td>${escape(film.year || "")}</td>
      <td>${escape(film.director || "")}</td>
      <td>${statusBadgeHtml(film)}</td>
    </tr>`;
  }

  function sortValue(film, sort) {
    if (sort === "year") return Number(film.year) || -Infinity;
    if (sort === "rating") return window.filmRatingSortValue?.(film) || 0;
    if (sort === "runtime") return Number(film.runtimeMinutes) || -Infinity;
    // Ascending places S (rank 0) first - unset/non-watchlist films rank
    // last, since only a watchlist item ever carries a tier.
    if (sort === "tier") return window.watchlistTierRank(film.tier);
    if (sort === "awards") return personalAwardWins(film);
    return String(film.title || "").toLowerCase();
  }

  function render() {
    let finish = window.startOskarsPerformance?.("films:render");
    let films = fullCatalog();
    let filmFilters = Object.fromEntries(
      filterNames.map((name) => [name, currentState[name]]),
    );
    let franchiseMembers = currentState.franchise
      ? franchiseMemberIds(currentState.franchise)
      : null;
    let filtered = films.filter(
      (film) =>
        window.filmMatchesFilters(film, filmFilters, {
          period: { alltimeMatchesAll: true },
        }) &&
        (!currentState.status || film.catalogStatus === currentState.status) &&
        matchesSearch(film, currentState.q) &&
        matchesTags(film, currentState.tags) &&
        (!franchiseMembers || franchiseMembers.has(film.id)) &&
        matchesPersonalAward(film, currentState.personalAward) &&
        matchesOfficialResult(film, currentState.officialResult),
    );
    let factor = currentState.order === "desc" ? -1 : 1;
    let sorted = [...filtered].sort(
      (left, right) =>
        factor *
          (sortValue(left, currentState.sort) <
          sortValue(right, currentState.sort)
            ? -1
            : sortValue(left, currentState.sort) >
                sortValue(right, currentState.sort)
              ? 1
              : 0) || window.compareEnglishTitles(left.title, right.title),
    );
    let pagination = window.paginationState(
      sorted.length,
      currentState.page,
      pageSize,
    );
    let pageItems = sorted.slice(pagination.sliceStart, pagination.sliceEnd);
    let statusCounts = films.reduce((counts, film) => {
      counts[film.catalogStatus] = (counts[film.catalogStatus] || 0) + 1;
      return counts;
    }, {});

    let statusPills = ["", "watched", "watchlist", "unseen"]
      .map((status) => {
        let label = status
          ? `${statusLabel(status)} (${statusCounts[status] || 0})`
          : `${ui("All")} (${films.length})`;
        return `<a class="films-status-pill${currentState.status === status ? " is-active" : ""}" href="${escape(viewUrl({ status, page: 1 }))}">${escape(label)}</a>`;
      })
      .join("");

    let paginationHtml = window.renderPaginationControls({
      total: sorted.length,
      page: pagination.page,
      pageSize,
      dataAttribute: "data-films-page",
      itemLabel: ui("films"),
      ariaLabel: ui("Film pages"),
      variant: "extended",
    });

    let sortControl = window.renderSortAxisControl({
      escape,
      value: currentState.sort,
      attribute: 'name="sort"',
      axes: sortAxes,
    });
    let toolbarControlsHtml = `<div class="detail-toolbar-controls">${window.renderChronologyControl({ iconOnly: true, escape, title: currentState.order === "desc" ? ui("Show ascending") : ui("Show descending") })}${window.renderFilmViewToggle({ view: currentState.view, listUrl: viewUrl({ view: "list" }), gridUrl: viewUrl({ view: "grid" }), escape, classes: "films-view-toggle", ariaLabel: ui("Film display") })}${window.renderCopyViewLinkButton({ escape })}</div>`;

    container.innerHTML = `${window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Films"))}</h1><p>${escape(ui("Every film in the catalog — watched, watchlisted, or not yet seen."))}</p>`,
    })}
    <nav class="films-status-pills" aria-label="${escape(ui("Filter by status"))}">${statusPills}</nav>
    <form class="films-toolbar detail-toolbar" id="filmsToolbar">
      <label class="films-search">${escape(ui("Search"))}<input type="search" name="q" placeholder="${escape(ui("Title or director"))}" value="${escape(currentState.q)}"></label>
      ${sortControl}
      ${toolbarControlsHtml}
      <details class="films-advanced-filters">
        <summary>${escape(ui("Advanced filters"))}</summary>
        <div class="films-advanced-filters-grid">
          <label>${escape(ui("Period"))}<select name="period">${periodOptionsHtml(films)}</select></label>
          <label>${escape(ui("Medium"))}<select name="medium">${option("", ui("Any medium"), "medium")}${option("live-action", ui("Live action"), "medium")}${option("animation", ui("Animation"), "medium")}${option("hybrid", ui("Hybrid"), "medium")}</select></label>
          <label>${escape(ui("Screenplay"))}<select name="screenplay">${option("", ui("Any screenplay"), "screenplay")}${option("original", ui("Original"), "screenplay")}${option("adapted", ui("Adapted"), "screenplay")}</select></label>
          <label>${escape(ui("Adapted from"))}<select name="adaptationSource">${option("", ui("Any source"), "adaptationSource")}${(window.getAdaptationSources?.() || []).map((value) => option(value, ui(value), "adaptationSource")).join("")}</select></label>
          <label>${escape(ui("Country"))}<select name="country">${option("", ui("Any country"), "country")}${countryOptionsHtml(films)}</select></label>
          <label>${escape(ui("Minimum rating"))}<select name="minimumRating">${option("", ui("No minimum"), "minimumRating")}${ratingOptions("minimum")}</select></label>
          <label>${escape(ui("Maximum rating"))}<select name="maximumRating">${option("", ui("No maximum"), "maximumRating")}${ratingOptions("maximum")}</select></label>
          <label>${escape(ui("Minimum runtime"))}<select name="minimumRuntime">${option("", ui("No minimum"), "minimumRuntime")}${runtimeOptions("minimum")}</select></label>
          <label>${escape(ui("Maximum runtime"))}<select name="maximumRuntime">${option("", ui("No maximum"), "maximumRuntime")}${runtimeOptions("maximum")}</select></label>
          <label>${escape(ui("Watchlist tier"))}<select name="watchlistTier">${option("", ui("Any tier"), "watchlistTier")}${tierOptionsHtml()}</select></label>
          <label>${escape(ui("Personal award category"))}<select name="category">${option("", ui("Any category"), "category")}${categoryOptionsHtml()}</select></label>
          <label>${escape(ui("Personal award"))}<select name="personalAward">${option("", ui("Any"), "personalAward")}${option("won", ui("Won"), "personalAward")}${option("nominated", ui("Nominated"), "personalAward")}</select></label>
          <label>${escape(ui("Official result"))}<select name="officialResult">${option("", ui("Any"), "officialResult")}${option("won", ui("Won"), "officialResult")}${option("nominated", ui("Nominated"), "officialResult")}</select></label>
          <label>${escape(ui("Tag"))}<select name="tags">${option("", ui("Any tag"), "tags")}${tagOptionsHtml()}</select></label>
          <label>${escape(ui("Franchise"))}<select name="franchise">${option("", ui("Any franchise"), "franchise")}${franchiseOptionsHtml()}</select></label>
        </div>
      </details>
    </form>
    ${paginationHtml}
    ${
      pageItems.length
        ? currentState.view === "grid"
          ? `<div class="film-grid films-grid">${pageItems.map(filmCardHtml).join("")}</div>`
          : window.renderLeaderboardTable({
              headers: [
                ui("Film"),
                ui("Year"),
                ui("Director"),
                ui("Status"),
              ].map(escape),
              rows: pageItems.map(filmRowHtml).join(""),
            })
        : `<div class="detail-empty"><h2>${escape(ui("No matches"))}</h2><p>${escape(ui("Try relaxing one or two filters."))}</p></div>`
    }
    ${paginationHtml}`;

    container
      .querySelectorAll("[data-films-page]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          currentState = Object.assign({}, currentState, {
            page: Number(button.dataset.filmsPage),
          });
          viewState.replace(currentState);
          render();
          container.scrollIntoView({ block: "start" });
        }),
      );
    container
      .querySelector("[data-reverse-order-button]")
      ?.addEventListener("click", () => {
        currentState = Object.assign({}, currentState, {
          order: currentState.order === "desc" ? "asc" : "desc",
        });
        viewState.replace(currentState);
        render();
      });
    container
      .querySelector("[data-copy-view-link]")
      ?.addEventListener("click", (event) => {
        window.copyViewLink?.().then((copied) => {
          event.target.textContent = ui(copied ? "Copied" : "Copy failed");
        });
      });
    let toolbar = document.getElementById("filmsToolbar");
    let searchDebounce = null;
    toolbar?.addEventListener("input", (event) => {
      if (event.target.name !== "q") return;
      currentState = Object.assign({}, currentState, {
        q: event.target.value,
        page: 1,
      });
      viewState.replace(currentState);
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        let focused = document.activeElement;
        let caret = focused?.selectionStart;
        render();
        let restored = document.getElementById("filmsToolbar")?.querySelector('[name="q"]');
        if (restored) {
          restored.focus();
          if (caret != null) restored.setSelectionRange(caret, caret);
        }
      }, 200);
    });
    toolbar?.addEventListener("change", (event) => {
      if (!event.target.name || event.target.name === "q") return;
      currentState = Object.assign(
        {},
        currentState,
        Object.fromEntries(new FormData(toolbar).entries()),
        { page: 1 },
      );
      viewState.replace(currentState);
      render();
    });

    finish?.(`${films.length} catalog, ${sorted.length} matched, page ${pagination.page}/${pagination.pageCount}`);
  }

  render();
  window.addEventListener?.("oskars:localechange", render);
  // Fire-and-forget after first paint, matching every other official-
  // results-aware page (category/completion/film/person/period/stats) -
  // the bundled snapshot already renders correctly, this just swaps in
  // live data and re-renders once it resolves.
  window.hydrateOfficialResultsFromSupabase?.().then((changed) => {
    if (!changed) return;
    officialIndex = null;
    render();
  });
})();
