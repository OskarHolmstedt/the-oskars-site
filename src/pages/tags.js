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
  const INITIAL_BATCH_SIZE = 12;
  let lastTagsCount = 0;
  let visibleTagRecords = [];
  let renderedCount = 0;
  let batchObserver = null;

  function tagsViewHref(next = {}) {
    let nextPage = next.page || page;
    let params = [];
    if (shuffleActive) {
      params.push("sort=shuffle");
      if (shuffleSeed) params.push(`seed=${encodeURIComponent(shuffleSeed)}`);
    } else {
      let nextSort = next.sort || sort;
      let nextOrder = next.order || order;
      if (nextSort !== "title")
        params.push(`sort=${encodeURIComponent(nextSort)}`);
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

  function sortedTags(list = tags) {
    if (shuffleActive) {
      return [...list].sort(
        (left, right) =>
          window.compareBySeededShuffle(left.name, right.name, shuffleSeed) ||
          left.name.localeCompare(right.name),
      );
    }
    return [...list].sort((left, right) => {
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

  // Shared catalog tags (issue #797) load lazily after the first paint; null
  // until the read resolves or when it fails.
  let catalogTagIndex = null;

  function renderTagCard(tag, index = 0) {
    let isCatalog = tag.kind !== undefined;
    let isHero = index < 4;
    let deckFilms = window.rankByAllTimeRank(tag.films).slice(0, 5);
    let deck = deckFilms.length
      ? window.renderPosterDeck(deckFilms, {
          priority: isHero ? "high" : undefined,
        })
      : "";
    let ratingLine = `<b>${escape(window.formatAverageRating(tag.ratingStatistics.mean))}</b> ${escape(ui("average rating"))} · <span class="tag-card-rated-count"><b>${escape(tag.ratingStatistics.ratedCount)}</b> ${escape(ui("rated"))}</span>`;
    return `<article class="tag-card tag-card--poster">${deck ? `<div class="tag-card-poster">${deck}</div>` : ""}<div class="tag-card-body"><h2><a href="${escape(isCatalog ? window.catalogTagPageUrl(tag.name) : window.tagPageUrl(tag.name))}">${escape(tag.name)}</a></h2><div><b>${tag.films.length}</b> ${escape(ui(tag.films.length === 1 ? "film" : "films"))}${(isCatalog ? tag.watchlistCount : tag.watchlist?.length) ? ` · <b>${isCatalog ? tag.watchlistCount : tag.watchlist.length}</b> watchlist` : ""}</div><div>${ratingLine}</div>${isCatalog ? "" : window.renderSourceProjectAction("tag", tag.name, { escape, compact: true })}</div></article>`;
  }

  function disconnectBatchObserver() {
    if (batchObserver) {
      batchObserver.disconnect();
      batchObserver = null;
    }
  }

  function wireProjectButtons(root) {
    root
      ?.querySelectorAll?.("[data-start-project-source]")
      .forEach((button) => {
        if (button._wired) return;
        button._wired = true;
        button.addEventListener("click", async () => {
          if (button.disabled) return;
          button.disabled = true;
          try {
            await window.startProjectFromSourceAndOpen(
              button.dataset.startProjectSource,
              button.dataset.projectSourceId,
            );
          } finally {
            button.disabled = false;
          }
        });
      });
  }

  function appendNextBatch() {
    if (renderedCount >= visibleTagRecords.length) {
      disconnectBatchObserver();
      container.querySelector("[data-tags-load-more-container]")?.remove();
      return;
    }
    let nextChunk = visibleTagRecords.slice(
      renderedCount,
      renderedCount + INITIAL_BATCH_SIZE,
    );
    let grid = container.querySelector(".tags-section--personal .tag-grid");
    if (grid) {
      grid.insertAdjacentHTML(
        "beforeend",
        nextChunk
          .map((tag, index) => renderTagCard(tag, renderedCount + index))
          .join(""),
      );
      wireProjectButtons(grid);
    }
    renderedCount += nextChunk.length;
    if (renderedCount >= visibleTagRecords.length) {
      disconnectBatchObserver();
      container.querySelector("[data-tags-load-more-container]")?.remove();
    }
  }

  function setupBatchObserver() {
    disconnectBatchObserver();
    if (renderedCount >= visibleTagRecords.length) return;
    let sentinel = container.querySelector("[data-tags-load-more-container]");
    if (!sentinel) return;
    if (typeof IntersectionObserver !== "function") return;
    batchObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          appendNextBatch();
        }
      },
      { rootMargin: "300px" },
    );
    batchObserver.observe(sentinel);
  }

  function render() {
    disconnectBatchObserver();
    let finishRenderTimer = window.startOskarsPerformance?.("tags:render");
    let orderedTags = sortedTags();
    lastTagsCount = orderedTags.length;
    let paginationState = window.paginationState(
      orderedTags.length,
      page,
      PAGE_SIZE,
    );
    page = paginationState.page;
    visibleTagRecords = orderedTags.slice(
      paginationState.sliceStart,
      paginationState.sliceEnd,
    );
    renderedCount = Math.min(INITIAL_BATCH_SIZE, visibleTagRecords.length);
    let initialVisible = visibleTagRecords.slice(0, renderedCount);
    let paginationControls = window.renderPaginationControls({
      total: orderedTags.length,
      page,
      pageSize: PAGE_SIZE,
      dataAttribute: "data-tags-page",
      itemLabel: ui("tags"),
      ariaLabel: ui("Tag pages"),
    });
    let cards = initialVisible.map(renderTagCard).join("");
    let loadMoreHtml =
      renderedCount < visibleTagRecords.length
        ? `<div class="tags-load-more" data-tags-load-more-container><button type="button" class="button-secondary" data-tags-load-more>${escape(ui("Load more"))}</button></div>`
        : "";
    document.title = `${ui("Tags")} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Tags"))}</h1><p>${escape(ui("Personal collections and themes across the film library."))}</p>`,
    });
    let personalHtml = orderedTags.length
      ? `<form class="tags-controls" id="tagsControls"><div class="tags-sort-controls"><label class="tags-sort-control"><span>${escape(ui("Sort"))}</span><select data-tags-sort><option value="title"${sort === "title" ? " selected" : ""}>${escape(ui("Title"))}</option><option value="count"${sort === "count" ? " selected" : ""}>${escape(ui("Watched film count"))}</option><option value="rating"${sort === "rating" ? " selected" : ""}>${escape(ui("Average rating"))}</option></select></label>${window.renderChronologyControl({ iconOnly: true, escape, title: orderToggleLabel() })}${window.renderShuffleControl({ escape, label: ui("Shuffle") })}</div></form>${paginationControls}<div class="tag-grid">${cards}</div>${loadMoreHtml}${paginationControls}`
      : `<div class="detail-empty">${escape(ui("No film tags yet. Add them from a film’s Edit mode."))}</div>`;
    let catalogCards = catalogTagIndex?.length
      ? sortedTags(catalogTagIndex).map(renderTagCard).join("")
      : "";
    let catalogHtml = catalogCards
      ? `<section class="tags-section tags-section--catalog" data-catalog-tags><h2>${escape(ui("Catalog tags"))}</h2><p>${escape(ui("Genres and groupings shared across the catalog, for the films in your library."))}</p><div class="tag-grid">${catalogCards}</div></section>`
      : "";
    container.innerHTML = `${header}${catalogHtml}<section class="tags-section tags-section--personal"><h2>${escape(ui("Your tags"))}</h2>${personalHtml}</section>`;
    wireProjectButtons(container);
    setupBatchObserver();
    finishRenderTimer?.(`${tags.length} tags, ${renderedCount} shown`);
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
    let loadMoreButton = event.target.closest("[data-tags-load-more]");
    if (loadMoreButton) {
      appendNextBatch();
      return;
    }
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
  window
    .loadSupabaseOwnCatalogTagMemberships?.()
    .then((memberships) => {
      catalogTagIndex = window.buildCatalogTagIndex(memberships);
      if (catalogTagIndex.length) render();
    })
    .catch(() => {});
})();
