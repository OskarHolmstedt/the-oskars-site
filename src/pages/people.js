/** @file Controls the searchable, sortable, paginated people directory and its list/grid URL state. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("peoplePage");
  let peopleSortValues = new Set([
    "name",
    "wins",
    "nominations",
    "score",
    "films",
    "rating",
  ]);
  function defaultOrderForSort(sortValue) {
    return sortValue === "name" ? "asc" : "desc";
  }
  let peopleUrlState = window.createPageViewState({
    path: "people.html",
    schema: {
      query: { param: "q", default: "" },
      profession: {
        default: "all",
        validate: (value) =>
          value === "all" || window.PERSON_PROFESSION_ORDER.includes(value),
      },
      sort: {
        default: "name",
        validate: (value) => peopleSortValues.has(value),
      },
      order: {
        default: (state) => defaultOrderForSort(state.sort),
        validate: (value) => value === "asc" || value === "desc",
      },
      shuffleActive: {
        param: "shuffle",
        default: false,
        parse: (value) => value === "1",
        serialize: (value) => (value ? "1" : ""),
      },
      shuffleSeed: {
        param: "seed",
        default: "",
        omit: (value, state) => !state.shuffleActive || !value,
      },
      page: {
        default: 1,
        parse: (value) => Math.max(1, Number.parseInt(value, 10) || 1),
      },
      view: {
        default: "grid",
        validate: (value) => value === "grid" || value === "list",
      },
    },
  });
  let initialViewState = peopleUrlState.read();
  let query = initialViewState.query;
  let profession = initialViewState.profession;
  let sort = initialViewState.sort;
  let order = initialViewState.order;
  let shuffleActive = initialViewState.shuffleActive;
  let shuffleSeed = shuffleActive
    ? initialViewState.shuffleSeed || String(Date.now())
    : "";
  let view = initialViewState.view;
  let page = initialViewState.page;
  const PAGE_SIZE = 100;
  let watchedOtherSource = null;
  let watchedOtherById = new Map();
  let watchlistSource = null;
  let watchlistById = new Map();

  function initials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function viewUrl(nextView) {
    return peopleUrlState.build(
      {
        query,
        profession,
        sort,
        order,
        shuffleActive,
        shuffleSeed,
        page,
        view,
      },
      { view: nextView },
    );
  }

  function updatePeopleUrl() {
    peopleUrlState.replace({
      query,
      profession,
      sort,
      order,
      shuffleActive,
      shuffleSeed,
      page,
      view,
    });
  }

  function renderRow(person) {
    let scores = person.awardScores || {};
    let ratings = personRatingStatistics(person);
    let valueOrDash = (value) => (Number(value) > 0 ? escape(value) : "—");
    return `<tr><td class="film-table-cell">${window.renderPersonPortrait(person, "thumb")}<span><a class="table-film-link" href="${escape(window.personPageUrl(person.id))}"><strong>${escape(person.name)}</strong></a><span class="leaderboard-meta">${escape(person.professions.join(" · "))}</span></span></td><td>${valueOrDash(personWatchedCount(person))}</td><td>${ratings.ratedCount ? escape(window.formatAverageRating(ratings.mean)) : "—"}</td><td>${valueOrDash(ratings.ratedCount)}</td><td>${valueOrDash(person.stats?.wins)}</td><td>${valueOrDash(person.stats?.nominations)}</td><td>${valueOrDash(scores.year)}</td></tr>`;
  }

  function orderToggleLabel() {
    return order === "asc" ? ui("Sort descending") : ui("Sort ascending");
  }

  function personSortValue(person) {
    if (sort === "wins") return person.stats?.wins || 0;
    if (sort === "nominations") return person.stats?.nominations || 0;
    if (sort === "score") return person.awardScores?.year || 0;
    if (sort === "films") return personWatchedCount(person);
    return 0;
  }

  function personRatingStatistics(person) {
    return (
      person.ratingStatistics ||
      window.collectionRatingStatistics(personWatchedFilms(person))
    );
  }

  function personWatchedFilms(person) {
    if (watchedOtherSource !== state.watchedOther) {
      watchedOtherSource = state.watchedOther;
      watchedOtherById = new Map(
        (state.watchedOther || []).map((film) => [film.id, film]),
      );
    }
    let byId = new Map();
    (person.filmIds || []).forEach((filmId) => {
      let film = state.filmsById?.[filmId];
      if (film) byId.set(film.id, film);
    });
    (person.watchedOtherIds || []).forEach((filmId) => {
      let film = watchedOtherById.get(filmId);
      if (film) byId.set(film.id, film);
    });
    return [...byId.values()];
  }

  function personWatchedCount(person) {
    return (
      (person.filmIds || []).length + (person.watchedOtherIds || []).length
    );
  }

  function personWatchlistFilms(person) {
    if (watchlistSource !== state.watchlist) {
      watchlistSource = state.watchlist;
      watchlistById = new Map(
        (state.watchlist || []).map((film) => [
          film.id || window.watchlistItemId?.(film),
          film,
        ]),
      );
    }
    return (person.watchlistIds || [])
      .map((filmId) => watchlistById.get(filmId))
      .filter(Boolean);
  }

  function discoveryRecords(allPeople) {
    let selected = new Set();
    let records = [];
    let choose = (label, reason, candidate) => {
      if (!candidate) return;
      selected.add(candidate.person.id);
      records.push({ ...candidate, label, reason: reason(candidate) });
    };
    let candidates = allPeople.map((person) => ({
      person,
      watchedCount: personWatchedCount(person),
      watchlistCount: (person.watchlistIds || []).length,
      ratings: personRatingStatistics(person),
    }));
    let bestCandidate = (qualifies, compare) =>
      candidates.reduce(
        (best, entry) =>
          selected.has(entry.person.id) || !qualifies(entry)
            ? best
            : !best || compare(entry, best) < 0
              ? entry
              : best,
        null,
      );
    choose(
      ui("Most watched"),
      (entry) =>
        ui("{count} watched films in your archive", {
          count: entry.watchedCount,
        }),
      bestCandidate(
        (entry) => entry.watchedCount >= 2,
        (left, right) =>
          right.watchedCount - left.watchedCount ||
          left.person.name.localeCompare(right.person.name),
      ),
    );
    choose(
      ui("Highest rated"),
      (entry) => {
        return ui("{rating} average from {count} rated films", {
          rating: window.formatAverageRating(entry.ratings.mean),
          count: entry.ratings.ratedCount,
        });
      },
      bestCandidate(
        (entry) => entry.ratings.ratedCount >= 3,
        (left, right) =>
          right.ratings.mean - left.ratings.mean ||
          right.ratings.ratedCount - left.ratings.ratedCount ||
          left.person.name.localeCompare(right.person.name),
      ),
    );
    choose(
      ui("On your watchlist"),
      (entry) =>
        ui("{count} films waiting on your watchlist", {
          count: entry.watchlistCount,
        }),
      bestCandidate(
        (entry) => entry.watchlistCount > 0,
        (left, right) =>
          right.watchlistCount - left.watchlistCount ||
          right.watchedCount - left.watchedCount ||
          left.person.name.localeCompare(right.person.name),
      ),
    );
    return records;
  }

  function renderDiscovery(allPeople) {
    if (
      query ||
      profession !== "all" ||
      sort !== "name" ||
      order !== "asc" ||
      shuffleActive ||
      page !== 1 ||
      view !== "grid"
    )
      return "";
    let records = discoveryRecords(allPeople);
    if (!records.length) return "";
    let cards = records
      .map(({ person, label, reason }) => {
        let portrait = window.renderPersonPortrait(person, "hub");
        let representativeFilms = window
          .rankByAllTimeRank(personWatchedFilms(person))
          .slice(0, 3);
        if (!representativeFilms.length)
          representativeFilms = personWatchlistFilms(person).slice(0, 3);
        let deck = representativeFilms.length
          ? window.renderPosterDeck(representativeFilms, {
              classes: "people-discovery-poster-deck",
              limit: 3,
            })
          : "";
        return `<a class="people-discovery-card" href="${escape(window.personPageUrl(person.id))}"><div class="people-discovery-visual">${portrait || `<div class="person-portrait-placeholder" aria-hidden="true">${escape(initials(person.name))}</div>`}${deck}</div><div><p class="people-discovery-label">${escape(label)}</p><h3>${escape(person.name)}</h3><p>${escape(reason)}</p><span>${escape(person.professions.join(" · "))}</span></div></a>`;
      })
      .join("");
    return `<section class="people-discovery" aria-labelledby="peopleDiscoveryHeading"><div class="people-section-heading"><div><p class="people-section-kicker">${escape(ui("Personal guide"))}</p><h2 id="peopleDiscoveryHeading">${escape(ui("From your archive"))}</h2></div><p>${escape(ui("Three transparent ways back into the people behind your films."))}</p></div><div class="people-discovery-grid">${cards}</div></section>`;
  }

  function renderPersonStats(person) {
    let ratings = personRatingStatistics(person);
    let watchedCount = personWatchedCount(person);
    let nominations = Number(person.stats?.nominations) || 0;
    let wins = Number(person.stats?.wins) || 0;
    let score = Number(person.awardScores?.year) || 0;
    let items = [];
    if (watchedCount)
      items.push(
        `<span class="people-hub-main-stat"><b>${watchedCount}</b> ${escape(ui("films watched"))}</span>`,
      );
    if (ratings.ratedCount)
      items.push(
        `<span class="people-hub-main-stat"><b>${escape(window.formatAverageRating(ratings.mean))}</b> ${escape(ui("average rating"))}<small>${escape(ratings.ratedCount)} ${escape(ui("rated"))}</small></span>`,
      );
    if (wins)
      items.push(
        `<span class="people-hub-award-stat"><b>${wins}</b> ${escape(ui("wins"))}</span>`,
      );
    if (nominations)
      items.push(
        `<span class="people-hub-award-stat"><b>${nominations}</b> ${escape(ui("nominations"))}</span>`,
      );
    if (score)
      items.push(
        `<span class="people-hub-award-stat" title="${escape(ui("Annual award score"))}"><b>${score}</b> ${escape(ui("score"))}</span>`,
      );
    if (!items.length && person.watchlistIds?.length)
      items.push(
        `<span class="people-hub-main-stat"><b>${person.watchlistIds.length}</b> ${escape(ui("films on your watchlist"))}</span>`,
      );
    if (!items.length && person.catalogIds?.length)
      items.push(
        `<span class="people-hub-sparse-stat">${escape(ui(person.catalogIds.length === 1 ? "Known from 1 unseen film credit" : "Known from {count} unseen film credits", { count: person.catalogIds.length }))}</span>`,
      );
    if (!items.length)
      items.push(
        `<span class="people-hub-sparse-stat">${escape(ui("No personal history yet"))}</span>`,
      );
    return `<div class="people-hub-stats">${items.join("")}</div>`;
  }

  function people() {
    let filtered = Object.values(
      window.ensurePeopleIndex?.() || state.peopleById || {},
    ).filter(
      (person) =>
        (profession === "all" || person.professions.includes(profession)) &&
        window.searchTextMatches(
          query,
          person.name,
          ...(person.aliases || []),
          person.professions.join(" "),
        ),
    );
    if (shuffleActive) {
      return filtered.sort(
        (left, right) =>
          window.compareBySeededShuffle(left.id, right.id, shuffleSeed) ||
          left.name.localeCompare(right.name),
      );
    }
    return filtered.sort((left, right) => {
      if (sort === "rating") {
        return (
          window.compareByRatingStatistics(
            personRatingStatistics(left),
            personRatingStatistics(right),
            order,
          ) || left.name.localeCompare(right.name)
        );
      }
      let result =
        sort === "name"
          ? left.name.localeCompare(right.name)
          : personSortValue(left) - personSortValue(right);
      if (order === "desc") result = -result;
      return result || left.name.localeCompare(right.name);
    });
  }

  /** Renders the current filtered, sorted, paginated people-directory view. */
  window.renderPeopleHub = function () {
    let finishRenderTimer = window.startOskarsPerformance?.("people:render");
    let allPeople = Object.values(
      window.ensurePeopleIndex?.() || state.peopleById || {},
    );
    let filtered = people();
    let pagination = window.paginationState(filtered.length, page, PAGE_SIZE);
    page = pagination.page;
    let visible = filtered.slice(pagination.sliceStart, pagination.sliceEnd);
    let cards = visible
      .map((person) => {
        let portrait = window.renderPersonPortrait(person, "hub");
        return `<article class="people-hub-card">${portrait || `<div class="person-portrait-placeholder" aria-hidden="true">${escape(initials(person.name))}</div>`}<div><h2><a href="${escape(window.personPageUrl(person.id))}">${escape(person.name)}</a></h2><p>${escape(person.professions.join(" · "))}</p>${renderPersonStats(person)}</div></article>`;
      })
      .join("");
    let rows = visible.map(renderRow).join("");
    let professionOptions = window.PERSON_PROFESSION_ORDER.map(
      (value) =>
        `<option value="${escape(value)}" ${profession === value ? "selected" : ""}>${escape(value)}</option>`,
    ).join("");
    let sortControl = window.renderSortAxisControl({
      escape,
      value: sort,
      attribute: "data-people-sort",
      axes: [
        { value: "name", label: "Name" },
        { value: "wins", label: "Annual wins" },
        { value: "nominations", label: "Nominations" },
        { value: "score", label: "Annual score" },
        { value: "films", label: "Watched film count" },
        { value: "rating", label: "Average rating" },
      ],
    });
    let listTable = window.renderLeaderboardTable({
      headers: [
        ui("Person"),
        ui("Watched"),
        ui("Average rating"),
        ui("Rated"),
        ui("Wins"),
        ui("Nominations"),
        ui("Score"),
      ].map(escape),
      rows:
        rows ||
        `<tr><td colspan="7">${escape(ui("No people match these filters."))}</td></tr>`,
    });
    document.title = `${ui("People")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ mainHtml: `<h1>${escape(ui("People"))}</h1><p>${escape(ui("Recipients, filmmakers, performers, and other credited contributors."))}</p>`, actionsHtml: `<a class="button-link" href="directors.html">${escape(ui("Browse directors"))}</a>` })}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${filtered.length}</b> ${escape(ui("People"))}</span>` })}
    ${renderDiscovery(allPeople)}
    <div class="people-directory-heading"><div><p class="people-section-kicker">${escape(ui("Complete directory"))}</p><h2>${escape(ui("All people"))}</h2></div><p>${escape(ui("Search every credited contributor, or use Directors for auteur progress and projects."))}</p></div>
    <div class="people-hub-controls"><label>${escape(ui("Search"))}<input type="search" data-people-query value="${escape(query)}" placeholder="${escape(ui("Name or alias"))}"></label><label>${escape(ui("Profession"))}<select data-people-profession><option value="all">${escape(ui("All professions"))}</option>${professionOptions}</select></label>${sortControl}<div class="detail-toolbar-controls">${window.renderChronologyControl({ iconOnly: true, escape, title: orderToggleLabel() })}${window.renderShuffleControl({ escape, label: ui("Shuffle") })}${window.renderFilmViewToggle({ view, listUrl: viewUrl("list"), gridUrl: viewUrl("grid"), escape, classes: "people-hub-view-toggle", ariaLabel: ui("People display") })}${window.renderCopyViewLinkButton({ escape })}</div></div>
    ${window.renderPaginationControls({ total: filtered.length, page, pageSize: PAGE_SIZE, dataAttribute: "data-people-page", itemLabel: ui("people"), ariaLabel: ui("People pages") })}
    ${
      view === "grid"
        ? `<div class="people-hub-grid">${cards || `<div class="detail-empty">${escape(ui("No people match these filters."))}</div>`}</div>`
        : listTable
    }`;
    finishRenderTimer?.(`${filtered.length} people, ${visible.length} shown`);
  };

  container.addEventListener("input", (event) => {
    if (!event.target.matches("[data-people-query]")) return;
    query = event.target.value;
    page = 1;
    updatePeopleUrl();
    window.renderPeopleHub();
    container.querySelector("[data-people-query]")?.focus();
  });
  container.addEventListener("change", (event) => {
    if (event.target.matches("[data-people-profession]"))
      profession = event.target.value;
    else if (event.target.matches("[data-people-sort]")) {
      sort = event.target.value;
      order = defaultOrderForSort(sort);
      shuffleActive = false;
    } else return;
    page = 1;
    updatePeopleUrl();
    window.renderPeopleHub();
  });
  container.addEventListener("click", (event) => {
    let copyButton = event.target.closest("[data-copy-view-link]");
    if (copyButton) {
      window.copyViewLink().then((copied) => {
        copyButton.textContent = ui(copied ? "Copied" : "Copy failed");
      });
      return;
    }
    let orderButton = event.target.closest("[data-reverse-order-button]");
    if (orderButton) {
      order = order === "asc" ? "desc" : "asc";
      shuffleActive = false;
      updatePeopleUrl();
      window.renderPeopleHub();
      return;
    }
    let shuffleButton = event.target.closest("[data-shuffle-button]");
    if (shuffleButton) {
      shuffleActive = true;
      shuffleSeed = window.freshShuffleSeed();
      page = 1;
      updatePeopleUrl();
      window.renderPeopleHub();
      return;
    }
    let button = event.target.closest("[data-people-page]");
    if (!button || button.disabled) return;
    page = Math.max(1, Number(button.dataset.peoplePage) || 1);
    updatePeopleUrl();
    window.renderPeopleHub();
  });

  window.renderPeopleHub();
  window.addEventListener?.("oskars:localechange", window.renderPeopleHub);
})();
