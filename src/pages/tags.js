/** @file Renders the archive and watchlist tag index. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("tagsPage");
  let tags = window.getFilmTagIndex();
  let sortValues = new Set(["title", "count", "rating"]);
  let requestedSort = window.pageQueryParam("sort");
  let requestedOrder = window.pageQueryParam("order");
  let shuffleActive = requestedSort === "shuffle";
  let shuffleSeed = shuffleActive
    ? window.pageQueryParam("seed") || String(Date.now())
    : "";
  let sort = sortValues.has(requestedSort) ? requestedSort : "title";

  function defaultOrderForSort(value) {
    return value === "title" ? "asc" : "desc";
  }

  let order =
    requestedOrder === "asc" || requestedOrder === "desc"
      ? requestedOrder
      : defaultOrderForSort(sort);
  let page = Math.max(1, Number(window.pageQueryParam("page")) || 1);
  const PAGE_SIZE = 25;
  let lastTagsCount = 0;

  function tagsViewHref(next = {}) {
    let nextPage = next.page || page;
    let params = [];
    if (shuffleActive) {
      params.push("sort=shuffle");
      if (shuffleSeed) params.push(`seed=${encodeURIComponent(shuffleSeed)}`);
    } else {
      let nextSort = next.sort || sort;
      let nextOrder = next.order || order;
      if (nextSort !== "title") params.push(`sort=${encodeURIComponent(nextSort)}`);
      if (nextOrder !== defaultOrderForSort(nextSort))
        params.push(`order=${encodeURIComponent(nextOrder)}`);
    }
    if (nextPage > 1) params.push(`page=${nextPage}`);
    return `tags.html${params.length ? `?${params.join("&")}` : ""}`;
  }

  function updateViewUrl() {
    if (!window.history?.replaceState || !window.location?.href) return;
    window.history.replaceState(null, "", tagsViewHref());
  }

  function orderToggleLabel() {
    return order === "asc" ? ui("Sort descending") : ui("Sort ascending");
  }

  function sortedTags() {
    if (shuffleActive) {
      return [...tags].sort(
        (left, right) =>
          window.compareBySeededShuffle(left.name, right.name, shuffleSeed) ||
          left.name.localeCompare(right.name),
      );
    }
    return [...tags].sort((left, right) => {
      if (sort === "rating") {
        return (
          window.compareByRatingStatistics(
            left.ratingStatistics,
            right.ratingStatistics,
            order,
          ) || left.name.localeCompare(right.name)
        );
      }
      let result =
        sort === "count"
          ? left.films.length - right.films.length
          : left.name.localeCompare(right.name);
      if (order === "desc") result = -result;
      return result || left.name.localeCompare(right.name);
    });
  }

  function renderTagCard(tag) {
    let deckFilms = window.rankByAllTimeRank(tag.films).slice(0, 5);
    let deck = deckFilms.length ? window.renderPosterDeck(deckFilms) : "";
    let ratingLine = `<b>${escape(window.formatAverageRating(tag.ratingStatistics.mean))}</b> ${escape(ui("average rating"))} · <span class="tag-card-rated-count"><b>${escape(tag.ratingStatistics.ratedCount)}</b> ${escape(ui("rated"))}</span>`;
    return `<article class="tag-card tag-card--poster">${deck ? `<div class="tag-card-poster">${deck}</div>` : ""}<div class="tag-card-body"><h2><a href="${escape(window.tagPageUrl(tag.name))}">${escape(tag.name)}</a></h2><div><b>${tag.films.length}</b> ${escape(ui(tag.films.length === 1 ? "film" : "films"))}${tag.watchlist?.length ? ` · <b>${tag.watchlist.length}</b> watchlist` : ""}</div><div>${ratingLine}</div>${window.renderSourceProjectAction("tag", tag.name, { escape, compact: true })}</div></article>`;
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("tags:render");
    let orderedTags = sortedTags();
    lastTagsCount = orderedTags.length;
    let paginationState = window.paginationState(
      orderedTags.length,
      page,
      PAGE_SIZE,
    );
    page = paginationState.page;
    let visibleTags = orderedTags.slice(
      paginationState.sliceStart,
      paginationState.sliceEnd,
    );
    let paginationControls = window.renderPaginationControls({
      total: orderedTags.length,
      page,
      pageSize: PAGE_SIZE,
      dataAttribute: "data-tags-page",
      itemLabel: ui("tags"),
      ariaLabel: ui("Tag pages"),
    });
    let cards = visibleTags.map(renderTagCard).join("");
    document.title = `${ui("Tags")} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Tags"))}</h1><p>${escape(ui("Personal collections and themes across the film library."))}</p>`,
    });
    container.innerHTML =
      `${header}${orderedTags.length ? `<form class="tags-controls" id="tagsControls"><div class="tags-sort-controls"><label class="tags-sort-control"><span>${escape(ui("Sort"))}</span><select data-tags-sort><option value="title"${sort === "title" ? " selected" : ""}>${escape(ui("Title"))}</option><option value="count"${sort === "count" ? " selected" : ""}>${escape(ui("Watched film count"))}</option><option value="rating"${sort === "rating" ? " selected" : ""}>${escape(ui("Average rating"))}</option></select></label>${window.renderChronologyControl({ iconOnly: true, escape, title: orderToggleLabel() })}${window.renderShuffleControl({ escape, label: ui("Shuffle") })}</div></form>${paginationControls}<div class="tag-grid">${cards}</div>${paginationControls}` : `<div class="detail-empty">${escape(ui("No film tags yet. Add them from a film’s Edit mode."))}</div>`}`;
    container.querySelectorAll?.("[data-start-project-source]").forEach((button) => {
      button.addEventListener("click", () => {
        window.startProjectFromSourceAndOpen(
          button.dataset.startProjectSource,
          button.dataset.projectSourceId,
        );
      });
    });
    finishRenderTimer?.(`${tags.length} tags`);
  }

  container.addEventListener("change", (event) => {
    let select = event.target.closest("[data-tags-sort]");
    if (!select) return;
    sort = sortValues.has(select.value) ? select.value : "title";
    order = defaultOrderForSort(sort);
    shuffleActive = false;
    page = 1;
    updateViewUrl();
    render();
  });

  container.addEventListener("click", (event) => {
    let orderButton = event.target.closest("[data-reverse-order-button]");
    if (orderButton) {
      order = order === "asc" ? "desc" : "asc";
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
    let pageButton = event.target.closest("[data-tags-page]");
    if (!pageButton || pageButton.disabled) return;
    page = Math.max(
      1,
      Math.min(
        Number(pageButton.dataset.tagsPage) || 1,
        Math.ceil(lastTagsCount / PAGE_SIZE) || 1,
      ),
    );
    updateViewUrl();
    render();
    container
      .querySelector("#tagsControls")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
