/** @file Controls the paginated and sortable franchise index in card or table form. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("franchisesPage");
  let franchiseIndex =
    window.ensureFranchiseIndex?.() || state.franchisesById || {};

  let sortValues = new Set([
    "total",
    "title",
    "watched",
    "watchlisted",
    "completion",
    "rating",
    "subfranchises",
  ]);
  function defaultOrderForSort(sort) {
    return sort === "title" ? "asc" : "desc";
  }
  let requestedSort = window.pageQueryParam("sort");
  let requestedOrder = window.pageQueryParam("order");
  let shuffleActive = requestedSort === "shuffle";
  let shuffleSeed = shuffleActive
    ? window.pageQueryParam("seed") || String(Date.now())
    : "";
  let controls = {
    sort: sortValues.has(requestedSort) ? requestedSort : "total",
  };
  controls.order =
    requestedOrder === "asc" || requestedOrder === "desc"
      ? requestedOrder
      : defaultOrderForSort(controls.sort);
  // filter=incomplete keeps only franchises with unwatched entries (issue #17).
  let filterIncomplete = window.pageQueryParam("filter") === "incomplete";
  let filterSubfranchises = window.pageQueryParam("subs") === "with";
  let view = window.filmViewMode("grid");
  let page = Math.max(1, Number(window.pageQueryParam("page")) || 1);
  const PAGE_SIZE = 25;
  let lastRootsCount = 0;

  function franchiseKnownCount(franchise) {
    return (
      (franchise?.films?.length || 0) +
      (franchise?.otherFilms?.length || 0) +
      (franchise?.watchlistFilms?.length || 0)
    );
  }

  function allRoots() {
    return Object.values(franchiseIndex || {}).filter(
      (franchise) =>
        !(franchise.parentIds || []).length &&
        !franchise.parentId &&
        franchiseKnownCount(franchise) > 1,
    );
  }

  function filteredRoots(roots) {
    return roots.filter(
      (franchise) =>
        (!filterIncomplete || (franchise.watchlistFilms || []).length > 0) &&
        (!filterSubfranchises || (franchise.childIds || []).length > 0),
    );
  }

  function franchiseRatingStatistics(franchise) {
    return (
      franchise.ratingStatistics ||
      window.collectionRatingStatistics(
        (franchise.films || [])
          .map((entry) => state.filmsById?.[entry.filmId])
          .filter(Boolean),
      )
    );
  }

  function sortRoots(roots) {
    if (shuffleActive) {
      return [...roots].sort(
        (left, right) =>
          window.compareBySeededShuffle(left.id, right.id, shuffleSeed) ||
          left.name.localeCompare(right.name),
      );
    }
    return [...roots].sort((left, right) => {
      if (controls.sort === "rating") {
        return (
          window.compareByRatingStatistics(
            franchiseRatingStatistics(left),
            franchiseRatingStatistics(right),
            controls.order,
          ) || left.name.localeCompare(right.name)
        );
      }
      let leftCompletion = window.franchiseCompletion(left);
      let rightCompletion = window.franchiseCompletion(right);
      let result;
      if (controls.sort === "title")
        result = left.name.localeCompare(right.name);
      else if (controls.sort === "watched")
        result = leftCompletion.watchedCount - rightCompletion.watchedCount;
      else if (controls.sort === "watchlisted")
        result = leftCompletion.watchlistCount - rightCompletion.watchlistCount;
      else if (controls.sort === "completion")
        result =
          leftCompletion.percent - rightCompletion.percent ||
          leftCompletion.total - rightCompletion.total;
      else if (controls.sort === "subfranchises")
        result =
          (left.childIds || []).length - (right.childIds || []).length;
      else result = leftCompletion.total - rightCompletion.total;
      if (controls.order === "desc") result = -result;
      return result || left.name.localeCompare(right.name);
    });
  }

  function currentViewHref(next = {}) {
    let nextView = next.view || view;
    let nextOrder = next.order || controls.order;
    let nextPage = next.page || page;
    let params = [];
    let addParam = (key, value) =>
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    if (shuffleActive) {
      addParam("sort", "shuffle");
      if (shuffleSeed) addParam("seed", shuffleSeed);
    } else {
      let nextSort = next.sort || controls.sort;
      if (nextSort !== "total") addParam("sort", nextSort);
      if (nextOrder !== defaultOrderForSort(nextSort))
        addParam("order", nextOrder);
    }
    if (filterIncomplete) addParam("filter", "incomplete");
    if (filterSubfranchises) addParam("subs", "with");
    if (nextPage > 1) addParam("page", nextPage);
    if (nextView === "list") addParam("view", "list");
    return `franchises.html${params.length ? `?${params.join("&")}` : ""}`;
  }

  function updateViewUrl() {
    if (!window.history?.replaceState || !window.location?.href) return;
    window.history.replaceState(null, "", currentViewHref());
  }

  function orderToggleLabel() {
    return controls.order === "asc"
      ? ui("Sort descending")
      : ui("Sort ascending");
  }

  function franchiseRatingHtml(ratings) {
    return `<div class="franchise-card-rating"><b>${escape(window.formatAverageRating(ratings.mean))}</b> ${escape(ui("average rating"))}</div>`;
  }

  function franchiseStatsHtml(completion, childCount) {
    let items = [
      `<span><b>${completion.watchedCount}</b> ${escape(ui("Watched"))}</span>`,
      `<span><b>${completion.watchlistCount}</b> ${escape(ui("Watchlist"))}</span>`,
    ];
    if (childCount) {
      items.push(`<span><b>${childCount}</b> ${escape(ui("Sub"))}</span>`);
    }
    return `<div class="franchise-card-stats">${items.join('<span class="franchise-card-stats-separator" aria-hidden="true">·</span>')}</div>`;
  }

  function franchiseYearRange(franchise) {
    let years = (franchise.films || [])
      .map((entry) => state.filmsById?.[entry.filmId]?.year)
      .concat(
        (franchise.otherFilms || []).map(
          (entry) =>
            (state.watchedOther || []).find(
              (film) => film.id === entry.filmId,
            )?.year,
        ),
      )
      .concat(
        (franchise.watchlistFilms || []).map(
          (entry) => window.findWatchlistItemById?.(entry.itemId)?.year,
        ),
      )
      .map(Number)
      .filter((year) => Number.isInteger(year) && year > 0);
    if (!years.length) return "—";
    let first = Math.min(...years);
    let last = Math.max(...years);
    return first === last ? String(first) : `${first}–${last}`;
  }

  function franchiseProjectMarker(project) {
    if (!project) return "";
    let status = ["complete", "archived"].includes(project.status)
      ? project.status
      : "active";
    let label = escape(ui("View project"));
    return `<a class="project-status-badge project-status-badge--${status} franchise-card-project-marker" href="${escape(window.projectPageUrl(project.id))}" title="${label}" aria-label="${label}">${escape(ui("Project"))}</a>`;
  }

  function renderCard(franchise) {
    let completion = window.franchiseCompletion(franchise);
    let ratings = franchiseRatingStatistics(franchise);
    let deckFilms = window
      .rankByAllTimeRank([
        ...window.franchiseArchiveFilms(franchise),
        ...window.franchiseOtherFilms(franchise),
      ])
      .slice(0, 5);
    let deck = deckFilms.length ? window.renderPosterDeck(deckFilms) : "";
    let project = window.projectForSource("franchise", franchise.id);
    return `<article class="franchise-card franchise-card--poster${project ? " franchise-card--project" : ""}">${deck ? `<div class="franchise-card-poster">${deck}</div>` : ""}<div class="franchise-card-body"><div class="franchise-card-heading"><h2><a href="${escape(window.franchisePageUrl(franchise.id))}">${escape(franchise.name)}</a></h2>${franchiseProjectMarker(project)}</div>${franchiseRatingHtml(ratings)}${franchiseStatsHtml(completion, franchise.childIds.length)}<div class="franchise-completion"><span><b>${escape(completion.percent)}%</b> ${escape(ui("complete"))}</span><div class="project-progress-meter" aria-label="${escape(ui("{percent} percent complete", { percent: completion.percent }))}"><span style="width:${escape(completion.percent)}%"></span></div></div></div></article>`;
  }

  function renderRow(franchise) {
    let completion = window.franchiseCompletion(franchise);
    let ratings = franchiseRatingStatistics(franchise);
    let representative = window.franchiseRepresentativeFilm(franchise);
    let thumb = representative
      ? window.renderFilmPoster(representative, "thumb")
      : "";
    let childCount = franchise.childIds.length;
    return `<tr><td class="film-table-cell">${thumb}<span><a class="table-film-link" href="${escape(window.franchisePageUrl(franchise.id))}"><strong>${escape(franchise.name)}</strong></a>${childCount ? `<span class="leaderboard-meta">${childCount} ${escape(ui("Subfranchises"))}</span>` : ""}</span></td><td>${escape(window.formatAverageRating(ratings.mean))}</td><td>${completion.watchedCount}</td><td>${completion.watchlistCount}</td><td>${completion.percent}%</td><td>${escape(franchiseYearRange(franchise))}</td></tr>`;
  }

  function render() {
    let finishRenderTimer =
      window.startOskarsPerformance?.("franchises:render");
    franchiseIndex =
      window.ensureFranchiseIndex?.() || state.franchisesById || {};
    let allFranchises = Object.values(franchiseIndex || {});
    let browseableRoots = allRoots();
    let roots = sortRoots(filteredRoots(browseableRoots));
    lastRootsCount = roots.length;
    let paginationState = window.paginationState(roots.length, page, PAGE_SIZE);
    page = paginationState.page;
    let visibleRoots = roots.slice(
      paginationState.sliceStart,
      paginationState.sliceEnd,
    );
    let paginationControls = window.renderPaginationControls({
      total: roots.length,
      page,
      pageSize: PAGE_SIZE,
      dataAttribute: "data-franchises-page",
      itemLabel: ui("franchises"),
      ariaLabel: ui("Franchise pages"),
      variant: "extended",
    });
    let cardHtml = visibleRoots.map(renderCard).join("");
    let rowHtml = visibleRoots.map(renderRow).join("");
    let listTable = window.renderLeaderboardTable({
      headers: [
        ui("Franchise"),
        ui("Avg"),
        ui("Watched"),
        ui("Watchlist"),
        ui("Completion"),
        ui("Years"),
      ].map(escape),
      rows: rowHtml,
      classes: "franchises-table",
      wrapClasses: "franchises-list",
    });
    document.title = `${ui("Franchises")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ mainHtml: `<h1>${escape(ui("Franchises"))}</h1><p>${escape(ui("Film series, universes, and overlapping collections"))}</p>` })}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${allFranchises.length}</b> ${escape(ui("Metadata entries"))}</span><span><b>${browseableRoots.length}</b> ${escape(ui("Browseable franchises"))}</span>` })}
    ${
      browseableRoots.length
        ? `<form class="franchises-controls" id="franchisesControls">
        <div class="franchises-sort-controls"><label class="franchises-sort-control"><span>${escape(ui("Sort"))}</span><select name="sort">
          <option value="total"${controls.sort === "total" ? " selected" : ""}>${escape(ui("Total"))}</option>
          <option value="title"${controls.sort === "title" ? " selected" : ""}>${escape(ui("Title"))}</option>
          <option value="watched"${controls.sort === "watched" ? " selected" : ""}>${escape(ui("Watched"))}</option>
          <option value="watchlisted"${controls.sort === "watchlisted" ? " selected" : ""}>${escape(ui("Watchlist"))}</option>
          <option value="completion"${controls.sort === "completion" ? " selected" : ""}>${escape(ui("Completion"))}</option>
          <option value="rating"${controls.sort === "rating" ? " selected" : ""}>${escape(ui("Average rating"))}</option>
          <option value="subfranchises"${controls.sort === "subfranchises" ? " selected" : ""}>${escape(ui("Subfranchises"))}</option>
        </select></label>
        ${window.renderChronologyControl({ iconOnly: true, escape, title: orderToggleLabel() })}</div>
        <div class="franchises-toolbar-actions">
        <button type="button" class="sort-order-button sort-order-button--icon${filterIncomplete ? " is-active" : ""}" title="${escape(ui("In progress only"))}" aria-label="${escape(ui("In progress only"))}" aria-pressed="${filterIncomplete ? "true" : "false"}" data-franchises-progress-filter>◐</button>
        <button type="button" class="sort-order-button sort-order-button--icon franchises-sub-filter${filterSubfranchises ? " is-active" : ""}" title="${escape(ui("With subfranchises only"))}" aria-label="${escape(ui("With subfranchises only"))}" aria-pressed="${filterSubfranchises ? "true" : "false"}" data-franchises-sub-filter>${escape(ui("Sub"))}</button>
        ${window.renderShuffleControl({ escape, label: ui("Shuffle") })}
        ${window.renderFilmViewToggle({
          view,
          listUrl: currentViewHref({ view: "list" }),
          gridUrl: currentViewHref({ view: "grid" }),
          escape,
          classes: "franchises-view-toggle",
          ariaLabel: ui("Franchise display"),
          live: true,
        })}
      </div></form>
      ${roots.length ? `${paginationControls}${view === "grid" ? `<div class="franchise-grid">${cardHtml}</div>` : listTable}${paginationControls}` : `<div class="detail-empty">${escape(ui("No franchises match these filters."))}</div>`}`
        : `<div class="detail-empty"><h2>${escape(ui("No franchise metadata yet"))}</h2><p>${escape(ui("Add memberships from a film page’s Edit mode."))}</p></div>`
    }`;
    finishRenderTimer?.();
  }

  container.addEventListener("change", (event) => {
    let input = event.target.closest("#franchisesControls [name]");
    if (!input) return;
    if (input.name === "sort") {
      controls.sort = sortValues.has(input.value) ? input.value : "total";
      controls.order = defaultOrderForSort(controls.sort);
      shuffleActive = false;
    }
    page = 1;
    updateViewUrl();
    render();
  });

  container.addEventListener("click", (event) => {
    let viewLink = event.target.closest("[data-film-view-mode]");
    if (viewLink) {
      event.preventDefault();
      let nextView = viewLink.dataset.filmViewMode;
      if (nextView === "grid" || nextView === "list") view = nextView;
      updateViewUrl();
      render();
      return;
    }
    let progressFilterButton = event.target.closest(
      "[data-franchises-progress-filter]",
    );
    if (progressFilterButton) {
      filterIncomplete = !filterIncomplete;
      page = 1;
      updateViewUrl();
      render();
      return;
    }
    let subFilterButton = event.target.closest("[data-franchises-sub-filter]");
    if (subFilterButton) {
      filterSubfranchises = !filterSubfranchises;
      page = 1;
      updateViewUrl();
      render();
      return;
    }
    let orderButton = event.target.closest("[data-reverse-order-button]");
    if (orderButton) {
      controls.order = controls.order === "asc" ? "desc" : "asc";
      shuffleActive = false;
      updateViewUrl();
      render();
      return;
    }
    let shuffleButton = event.target.closest("[data-shuffle-button]");
    if (shuffleButton) {
      shuffleActive = true;
      shuffleSeed = window.freshShuffleSeed();
      updateViewUrl();
      render();
      return;
    }
    let pageButton = event.target.closest("[data-franchises-page]");
    if (!pageButton || pageButton.disabled) return;
    page = Math.max(
      1,
      Math.min(
        Number(pageButton.dataset.franchisesPage) || 1,
        Math.ceil(lastRootsCount / PAGE_SIZE) || 1,
      ),
    );
    updateViewUrl();
    render();
    container
      .querySelector("#franchisesControls")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
