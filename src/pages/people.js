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
    return `<tr><td class="film-table-cell">${window.renderPersonPortrait(person, "thumb")}<span><a class="table-film-link" href="${escape(window.personPageUrl(person.id))}"><strong>${escape(person.name)}</strong></a><span class="leaderboard-meta">${escape(person.professions.join(" · "))}</span></span></td><td>${escape(person.filmIds.length)}</td><td>${escape(window.formatAverageRating(ratings.mean))}</td><td>${escape(ratings.ratedCount)}</td><td>${escape(person.stats?.wins || 0)}</td><td>${escape(person.stats?.nominations || 0)}</td><td>${escape(scores.year || 0)}</td></tr>`;
  }

  function orderToggleLabel() {
    return order === "asc" ? ui("Sort descending") : ui("Sort ascending");
  }

  function personSortValue(person) {
    if (sort === "wins") return person.stats?.wins || 0;
    if (sort === "nominations") return person.stats?.nominations || 0;
    if (sort === "score") return person.awardScores?.year || 0;
    if (sort === "films") return person.filmIds.length;
    return 0;
  }

  function personRatingStatistics(person) {
    return (
      person.ratingStatistics ||
      window.collectionRatingStatistics(
        (person.filmIds || [])
          .map((filmId) => state.filmsById?.[filmId])
          .filter(Boolean),
      )
    );
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
    let filtered = people();
    let pagination = window.paginationState(filtered.length, page, PAGE_SIZE);
    page = pagination.page;
    let visible = filtered.slice(pagination.sliceStart, pagination.sliceEnd);
    let cards = visible
      .map((person) => {
        let portrait = window.renderPersonPortrait(person, "hub");
        let scores = person.awardScores || {};
        let ratings = personRatingStatistics(person);
        return `<article class="people-hub-card">${portrait || `<div class="person-portrait-placeholder" aria-hidden="true">${escape(initials(person.name))}</div>`}<div><h2><a href="${escape(window.personPageUrl(person.id))}">${escape(person.name)}</a></h2><p>${escape(person.professions.join(" · "))}</p><div class="people-hub-stats"><span><b>${person.filmIds.length}</b> ${escape(ui("films watched"))}</span><span><b>${escape(window.formatAverageRating(ratings.mean))}</b> ${escape(ui("average rating"))}<small>${escape(ratings.ratedCount)} ${escape(ui("rated"))}</small></span><span><b>${person.stats?.wins || 0}</b> ${escape(ui("wins"))}</span><span><b>${person.stats?.nominations || 0}</b> ${escape(ui("nominations"))}</span><span title="${escape(ui("Annual award score"))}"><b>${scores.year || 0}</b> ${escape(ui("score"))}</span></div></div></article>`;
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
