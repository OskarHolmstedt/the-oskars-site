/** @file Controls the paginated auteur-oriented directors index in deck or table form. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("directorsPage");
  let sortValues = new Set([
    "total",
    "name",
    "watched",
    "watchlisted",
    "completion",
    "rating",
  ]);

  function defaultOrderForSort(value) {
    return value === "name" ? "asc" : "desc";
  }

  let requestedSort = window.pageQueryParam("sort");
  let requestedOrder = window.pageQueryParam("order");
  let shuffleActive = requestedSort === "shuffle";
  let shuffleSeed = shuffleActive
    ? window.pageQueryParam("seed") || String(Date.now())
    : "";
  let sort = sortValues.has(requestedSort) ? requestedSort : "total";
  let order =
    requestedOrder === "asc" || requestedOrder === "desc"
      ? requestedOrder
      : defaultOrderForSort(sort);
  let filterIncomplete = window.pageQueryParam("filter") === "incomplete";
  let view = window.filmViewMode("grid");
  let page = Math.max(1, Number(window.pageQueryParam("page")) || 1);
  const PAGE_SIZE = 25;

  function directorViewHref(next = {}) {
    let nextView = next.view || view;
    let nextPage = next.page || page;
    let params = [];
    let addParam = (key, value) =>
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    if (shuffleActive) {
      addParam("sort", "shuffle");
      if (shuffleSeed) addParam("seed", shuffleSeed);
    } else {
      let nextSort = next.sort || sort;
      let nextOrder = next.order || order;
      if (nextSort !== "total") addParam("sort", nextSort);
      if (nextOrder !== defaultOrderForSort(nextSort))
        addParam("order", nextOrder);
    }
    if (filterIncomplete) addParam("filter", "incomplete");
    if (nextPage > 1) addParam("page", nextPage);
    if (nextView === "list") addParam("view", "list");
    return `directors.html${params.length ? `?${params.join("&")}` : ""}`;
  }

  function updateViewUrl() {
    if (!window.history?.replaceState || !window.location?.href) return;
    window.history.replaceState(null, "", directorViewHref());
  }

  function directorFilms(person, watchedOtherById) {
    let films = [];
    let ids = new Set();
    (person.credits || []).forEach((credit) => {
      if (credit.source !== "film" || credit.profession !== "Director") return;
      let film = state.filmsById?.[credit.filmId];
      if (!film || ids.has(film.id)) return;
      ids.add(film.id);
      films.push(film);
    });
    (person.watchedOtherIds || []).forEach((filmId) => {
      let film = watchedOtherById.get(filmId);
      if (!film || ids.has(film.id)) return;
      ids.add(film.id);
      films.push(film);
    });
    return films;
  }

  function knownYearRange(record) {
    let years = record.films
      .map((film) => film.year)
      .concat(record.watchlist.map((item) => item.year))
      .map(Number)
      .filter((year) => Number.isInteger(year) && year > 0);
    if (!years.length) return "—";
    let first = Math.min(...years);
    let last = Math.max(...years);
    return first === last ? String(first) : `${first}–${last}`;
  }

  function directorRecords() {
    let watchedOtherById = new Map(
      (state.watchedOther || []).map((film) => [film.id, film]),
    );
    let watchlistById = new Map(
      (state.watchlist || []).map((item) => [
        item.id || window.watchlistItemId?.(item),
        item,
      ]),
    );
    return Object.values(
      window.ensurePeopleIndex?.() || state.peopleById || {},
    )
      .filter((person) => person.professions?.includes("Director"))
      .map((person) => {
        let films = directorFilms(person, watchedOtherById);
        let watchlist = (person.watchlistIds || [])
          .map((id) => watchlistById.get(id))
          .filter(Boolean);
        return {
          person,
          films,
          watchlist,
          completion: window.directorCompletion(person),
          ratings: window.collectionRatingStatistics(films),
          project: window.projectForSource("person", person.id),
        };
      });
  }

  function sortedRecords(records) {
    let filtered = filterIncomplete
      ? records.filter((record) => record.completion.watchlistCount > 0)
      : records;
    if (shuffleActive) {
      return [...filtered].sort(
        (left, right) =>
          window.compareBySeededShuffle(
            left.person.id,
            right.person.id,
            shuffleSeed,
          ) || left.person.name.localeCompare(right.person.name),
      );
    }
    return [...filtered].sort((left, right) => {
      if (sort === "rating") {
        return (
          window.compareByRatingStatistics(left.ratings, right.ratings, order) ||
          left.person.name.localeCompare(right.person.name)
        );
      }
      let result;
      if (sort === "name")
        result = left.person.name.localeCompare(right.person.name);
      else if (sort === "watched")
        result = left.completion.watchedCount - right.completion.watchedCount;
      else if (sort === "watchlisted")
        result =
          left.completion.watchlistCount - right.completion.watchlistCount;
      else if (sort === "completion")
        result =
          left.completion.percent - right.completion.percent ||
          left.completion.total - right.completion.total;
      else result = left.completion.total - right.completion.total;
      if (order === "desc") result = -result;
      return result || left.person.name.localeCompare(right.person.name);
    });
  }

  function orderToggleLabel() {
    return order === "asc" ? ui("Sort descending") : ui("Sort ascending");
  }

  function directorProjectMarker(project) {
    if (!project) return "";
    let status = ["complete", "archived"].includes(project.status)
      ? project.status
      : "active";
    let label = escape(ui("View project"));
    return `<a class="project-status-badge project-status-badge--${status} director-card-project-marker" href="${escape(window.projectPageUrl(project.id))}" title="${label}" aria-label="${label}">${escape(ui("Project"))}</a>`;
  }

  function renderCard(record) {
    let deckFilms = record.films.length
      ? window.rankByAllTimeRank(record.films).slice(0, 5)
      : record.watchlist.slice(0, 5);
    let deck = deckFilms.length ? window.renderPosterDeck(deckFilms) : "";
    let completion = record.completion;
    let ratings = record.ratings;
    return `<article class="director-card director-card--poster${record.project ? " director-card--project" : ""}">${deck ? `<div class="director-card-poster">${deck}</div>` : ""}<div class="director-card-body"><div class="director-card-heading"><h2><a href="${escape(window.personPageUrl(record.person.id))}">${escape(record.person.name)}</a></h2>${directorProjectMarker(record.project)}</div><div class="director-card-rating"><b>${escape(window.formatAverageRating(ratings.mean))}</b> ${escape(ui("average rating"))} · <b>${escape(ratings.ratedCount)}</b> ${escape(ui("rated"))}</div><div class="director-card-stats"><span><b>${completion.watchedCount}</b> ${escape(ui("Watched"))}</span><span class="director-card-stats-separator" aria-hidden="true">·</span><span><b>${completion.watchlistCount}</b> ${escape(ui("Watchlist"))}</span></div><div class="director-completion"><span><b>${escape(completion.percent)}%</b> ${escape(ui("known completion"))}</span><div class="project-progress-meter" aria-label="${escape(ui("{percent} percent complete", { percent: completion.percent }))}"><span style="width:${escape(completion.percent)}%"></span></div></div></div></article>`;
  }

  function renderRow(record) {
    let person = record.person;
    let completion = record.completion;
    return `<tr><td class="film-table-cell">${window.renderPersonPortrait(person, "thumb")}<span><a class="table-film-link" href="${escape(window.personPageUrl(person.id))}"><strong>${escape(person.name)}</strong></a></span></td><td>${escape(window.formatAverageRating(record.ratings.mean))}</td><td>${escape(record.ratings.ratedCount)}</td><td>${completion.watchedCount}</td><td>${completion.watchlistCount}</td><td>${completion.watchedCount}/${completion.total} · ${completion.percent}%</td><td>${escape(knownYearRange(record))}</td></tr>`;
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("directors:render");
    let allRecords = directorRecords();
    let records = sortedRecords(allRecords);
    let inProgressCount = allRecords.filter(
      (record) => record.completion.watchlistCount > 0,
    ).length;
    let pagination = window.paginationState(records.length, page, PAGE_SIZE);
    page = pagination.page;
    let visible = records.slice(pagination.sliceStart, pagination.sliceEnd);
    let paginationControls = window.renderPaginationControls({
      total: records.length,
      page,
      pageSize: PAGE_SIZE,
      dataAttribute: "data-directors-page",
      itemLabel: ui("directors"),
      ariaLabel: ui("Director pages"),
      variant: "extended",
    });
    let listTable = window.renderLeaderboardTable({
      headers: [
        ui("Director"),
        ui("Avg"),
        ui("Rated"),
        ui("Watched"),
        ui("Watchlist"),
        ui("Known completion"),
        ui("Years"),
      ].map(escape),
      rows: visible.map(renderRow).join(""),
      classes: "directors-table",
      wrapClasses: "directors-list",
    });
    document.title = `${ui("Directors")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Directors"))}</h1><p>${escape(ui("Auteurs through their known films."))}</p>`,
      actionsHtml: `<a class="button-link" href="people.html">${escape(ui("All people"))}</a>`,
    })}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${allRecords.length}</b> ${escape(ui("Directors"))}</span><span><b>${inProgressCount}</b> ${escape(ui("In progress"))}</span>` })}
    ${allRecords.length ? `<form class="franchises-controls directors-controls" id="directorsControls"><div class="franchises-sort-controls"><label class="franchises-sort-control"><span>${escape(ui("Sort"))}</span><select name="sort"><option value="total"${sort === "total" ? " selected" : ""}>${escape(ui("Known films"))}</option><option value="name"${sort === "name" ? " selected" : ""}>${escape(ui("Name"))}</option><option value="watched"${sort === "watched" ? " selected" : ""}>${escape(ui("Watched"))}</option><option value="watchlisted"${sort === "watchlisted" ? " selected" : ""}>${escape(ui("Watchlist"))}</option><option value="completion"${sort === "completion" ? " selected" : ""}>${escape(ui("Known completion"))}</option><option value="rating"${sort === "rating" ? " selected" : ""}>${escape(ui("Average rating"))}</option></select></label>${window.renderChronologyControl({ iconOnly: true, escape, title: orderToggleLabel() })}</div><div class="franchises-toolbar-actions"><button type="button" class="sort-order-button sort-order-button--icon${filterIncomplete ? " is-active" : ""}" title="${escape(ui("In progress only"))}" aria-label="${escape(ui("In progress only"))}" aria-pressed="${filterIncomplete ? "true" : "false"}" data-directors-progress-filter>◐</button>${window.renderShuffleControl({ escape, label: ui("Shuffle") })}${window.renderFilmViewToggle({ view, listUrl: directorViewHref({ view: "list" }), gridUrl: directorViewHref({ view: "grid" }), escape, classes: "franchises-view-toggle directors-view-toggle", ariaLabel: ui("Director display"), live: true })}</div></form>${records.length ? `${paginationControls}${view === "grid" ? `<div class="director-grid">${visible.map(renderCard).join("")}</div>` : listTable}${paginationControls}` : `<div class="detail-empty">${escape(ui("No directors match this filter."))}</div>`}` : `<div class="detail-empty"><h2>${escape(ui("No directors yet"))}</h2><p>${escape(ui("Directors appear when films or watchlist entries name them."))}</p></div>`}`;
    finishRenderTimer?.(`${records.length} directors, ${visible.length} shown`);
  }

  container.addEventListener("change", (event) => {
    let input = event.target.closest("#directorsControls [name]");
    if (!input || input.name !== "sort") return;
    sort = sortValues.has(input.value) ? input.value : "total";
    order = defaultOrderForSort(sort);
    shuffleActive = false;
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
    if (event.target.closest("[data-directors-progress-filter]")) {
      filterIncomplete = !filterIncomplete;
      page = 1;
      updateViewUrl();
      render();
      return;
    }
    if (event.target.closest("[data-reverse-order-button]")) {
      order = order === "asc" ? "desc" : "asc";
      shuffleActive = false;
      updateViewUrl();
      render();
      return;
    }
    if (event.target.closest("[data-shuffle-button]")) {
      shuffleActive = true;
      shuffleSeed = window.freshShuffleSeed();
      page = 1;
      updateViewUrl();
      render();
      return;
    }
    let pageButton = event.target.closest("[data-directors-page]");
    if (!pageButton || pageButton.disabled) return;
    page = Math.max(1, Number(pageButton.dataset.directorsPage) || 1);
    updateViewUrl();
    render();
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
