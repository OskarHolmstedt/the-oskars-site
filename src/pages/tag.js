/** @file Controls the Supabase-backed tag detail: notes, watched/watchlist sections, sorting, pagination, tiers, and order editing. */

(function () {
  const PAGE_SIZE = 20;
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("tagPage");

  let requestedTag = window.pageQueryParam("name");
  let canonicalTag = window.normalizeFilmTag(requestedTag);
  let sortValues = new Set([
    "title",
    "year",
    "local",
    "rating",
    "wins",
    "nominations",
    "score",
    "shuffle",
  ]);
  let requestedSort = window.pageQueryParam("sort");
  let sort = sortValues.has(requestedSort) ? requestedSort : "year";
  let requestedOrder = window.pageQueryParam("order");
  let order =
    requestedOrder === "asc" || requestedOrder === "desc"
      ? requestedOrder
      : window.defaultOrderForFilmAxis(sort);
  let filmView = window.filmViewMode("grid");
  let sections = window.sectionsViewMode();
  let combinedPage = Math.max(1, Number(window.pageQueryParam("page")) || 1);
  let watchedPage = Math.max(
    1,
    Number(window.pageQueryParam("watchedPage")) || 1,
  );
  let watchlistPage = Math.max(
    1,
    Number(window.pageQueryParam("watchlistPage")) || 1,
  );
  let watchlistOrderEditMode =
    sections !== "combined" &&
    window.pageQueryParam("edit") === "watchlist-order";
  let localRankEditMode =
    sections !== "combined" &&
    sort === "local" &&
    window.pageQueryParam("edit") === "local-rank";
  let shuffleSeed =
    sort === "shuffle"
      ? window.pageQueryParam("seed") || String(Date.now())
      : "";
  let combinedView = sections === "combined";

  let tagId = null;
  let noteState = { note: "", editing: false, busy: false };
  let tagFilms = [];
  let watchlistItems = [];
  let localRankMap = new Map();
  let implicitTagFilmIds = [];
  let busy = false;

  function tagRecordCompare(left, right) {
    return window.compareFilmAxisRecords(left, right, {
      axis: sort,
      order,
      seed: shuffleSeed,
    });
  }
  function tagCompare(isWatchlistItem) {
    return (left, right) =>
      tagRecordCompare(
        isWatchlistItem ? { item: left } : { film: left },
        isWatchlistItem ? { item: right } : { film: right },
      );
  }

  function tagViewUrl(next = {}) {
    let nextSort = next.sort || sort;
    let nextOrder = next.order || order;
    let view = next.view || filmView;
    let seed = next.seed || shuffleSeed;
    let nextSections = next.sections || sections;
    let resetPages = next.resetPages === true;
    let nextCombinedPage = resetPages
      ? 1
      : Object.prototype.hasOwnProperty.call(next, "page")
        ? Math.max(1, Number(next.page) || 1)
        : combinedPage;
    let nextWatchedPage = resetPages
      ? 1
      : Object.prototype.hasOwnProperty.call(next, "watchedPage")
        ? Math.max(1, Number(next.watchedPage) || 1)
        : watchedPage;
    let nextWatchlistPage = resetPages
      ? 1
      : Object.prototype.hasOwnProperty.call(next, "watchlistPage")
        ? Math.max(1, Number(next.watchlistPage) || 1)
        : watchlistPage;
    let parts = [];
    if (nextSort !== "year") parts.push(`sort=${encodeURIComponent(nextSort)}`);
    if (nextSort === "shuffle") {
      if (seed) parts.push(`seed=${encodeURIComponent(seed)}`);
    } else if (nextOrder !== window.defaultOrderForFilmAxis(nextSort)) {
      parts.push(`order=${nextOrder}`);
    }
    if (view === "list") parts.push("view=list");
    if (nextSections === "combined") parts.push("sections=combined");
    if (nextSections === "combined" && nextCombinedPage > 1)
      parts.push(`page=${nextCombinedPage}`);
    if (nextSections !== "combined" && nextWatchedPage > 1)
      parts.push(`watchedPage=${nextWatchedPage}`);
    if (nextSections !== "combined" && nextWatchlistPage > 1)
      parts.push(`watchlistPage=${nextWatchlistPage}`);
    if (watchlistOrderEditMode && nextSections !== "combined")
      parts.push("edit=watchlist-order");
    if (
      localRankEditMode &&
      nextSort === "local" &&
      nextSections !== "combined"
    )
      parts.push("edit=local-rank");
    return `${window.tagPageUrl(canonicalTag)}${parts.length ? `&${parts.join("&")}` : ""}`;
  }

  function reload() {
    window.location.href = tagViewUrl();
  }

  function tagFilmCard(film, index = 0) {
    return window.renderSharedFilmCard(film, {
      classes: [
        "tag-film-card",
        localRankEditMode ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: localRankEditMode,
        scope: "local-rank",
        id: film.id,
        index,
        group: canonicalTag,
      }),
      rankLabel:
        sort === "local" ? `${localRankMap.get(film.id) || "—"}.` : null,
      showYear: true,
      director: film.director,
      escape,
      bodyHtml: film.review
        ? `<p class="tag-film-review">${escape(film.review)}</p>`
        : "",
    });
  }
  function tagWatchedCells(film) {
    return `<td><a class="period-link" href="${escape(window.periodPageUrl("year", film.year))}">${escape(film.year || "")}</a></td>${window.renderFilmIdentityCell(
      film,
      { escape, allTimeRank: true },
    )}<td class="film-people-cell">${window.renderLinkedDirectors(film, { escape, assumeIndexed: true })}</td>`;
  }
  function tagWatchlistCard(item, index = 0) {
    let film = window.watchlistFilmLike(item);
    let directorHtml = window.renderLinkedDirectors(film, { escape });
    return window.renderSharedFilmCard(film, {
      classes: [
        "tag-film-card",
        "watchlist-card",
        watchlistOrderEditMode ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: watchlistOrderEditMode,
        scope: "watchlist",
        id: item.id,
        index,
        group: window.normalizeWatchlistTier(item.tier),
      }),
      openFilm: false,
      showYear: true,
      directorHtml: directorHtml
        ? `<div class="film-director">${escape(ui("by"))} ${directorHtml}</div>`
        : "",
      escape,
      beforeTitleHtml: item.tier
        ? `<span class="watchlist-tier tier-${escape(item.tier.toLowerCase())}">${escape(item.tier)}</span>`
        : "",
      titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(item.supabaseFilmId))}">${escape(window.localizedFilmTitle?.(film) || item.title)}</a>`,
      bodyHtml:
        '<div class="watchlist-card-actions"><span>Watchlist</span></div>',
    });
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("tag:render");
    if (!canonicalTag) {
      document.title = `${ui("Tag not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Tag not found"))}</h1><a href="tags.html">${escape(ui("Browse tags"))}</a></div>`;
      finishRenderTimer?.("not found");
      return;
    }
    let films =
      sort === "local"
        ? [...tagFilms].sort((left, right) => {
            let leftPos = localRankMap.get(left.id) ?? Infinity;
            let rightPos = localRankMap.get(right.id) ?? Infinity;
            return order === "desc" ? rightPos - leftPos : leftPos - rightPos;
          })
        : [...tagFilms].sort(tagCompare(false));
    let sortedWatchlistItems = [...watchlistItems].sort(tagCompare(true));
    if (watchlistOrderEditMode)
      sortedWatchlistItems = [...sortedWatchlistItems].sort(
        window.compareWatchlistItems,
      );
    let combinedRecords = combinedView
      ? [
          ...films.map((film) => ({ film })),
          ...sortedWatchlistItems.map((item) => ({ item })),
        ].sort(tagRecordCompare)
      : [];
    let watchedPagination = window.paginationState(
      films.length,
      watchedPage,
      PAGE_SIZE,
    );
    let watchlistPagination = window.paginationState(
      sortedWatchlistItems.length,
      watchlistPage,
      PAGE_SIZE,
    );
    let combinedPagination = window.paginationState(
      combinedRecords.length,
      combinedPage,
      PAGE_SIZE,
    );
    let visibleFilms = films.slice(
      watchedPagination.sliceStart,
      watchedPagination.sliceEnd,
    );
    let visibleWatchlistItems = sortedWatchlistItems.slice(
      watchlistPagination.sliceStart,
      watchlistPagination.sliceEnd,
    );
    let visibleCombinedRecords = combinedRecords.slice(
      combinedPagination.sliceStart,
      combinedPagination.sliceEnd,
    );
    let cards = visibleFilms
      .map((film, index) =>
        tagFilmCard(film, watchedPagination.sliceStart + index),
      )
      .join("");
    let rows = visibleFilms
      .map((film, index) => {
        let attributes = window.renderOrderEditItemAttributes(
          {
            enabled: localRankEditMode,
            scope: "local-rank",
            id: film.id,
            index: watchedPagination.sliceStart + index,
            group: canonicalTag,
          },
          escape,
        );
        let positionCell =
          sort === "local"
            ? `<td class="leaderboard-position">${escape(localRankMap.get(film.id) || "—")}</td>`
            : "";
        return `<tr${attributes}>${positionCell}${tagWatchedCells(film)}${window.renderRatingTierCell({ film }, { escape })}</tr>`;
      })
      .join("");
    let watchlistCards = visibleWatchlistItems
      .map((item, index) =>
        tagWatchlistCard(item, watchlistPagination.sliceStart + index),
      )
      .join("");
    let watchlistRows = visibleWatchlistItems
      .map((item, index) => {
        let film = window.watchlistFilmLike(item);
        let directorHtml = window.renderLinkedDirectors(film, { escape });
        let attributes = window.renderOrderEditItemAttributes(
          {
            enabled: watchlistOrderEditMode,
            scope: "watchlist",
            id: item.id,
            index: watchlistPagination.sliceStart + index,
            group: window.normalizeWatchlistTier(item.tier),
          },
          escape,
        );
        return `<tr${attributes}><td class="leaderboard-position">${escape(item.order ?? "—")}</td>${window.renderFilmIdentityCell(
          film,
          { escape, href: window.filmPageUrl(item.supabaseFilmId), year: true },
        )}<td class="film-people-cell">${directorHtml}</td>${window.renderRatingTierCell({ item }, { escape })}</tr>`;
      })
      .join("");
    let combinedCards = visibleCombinedRecords
      .map((record) =>
        record.film ? tagFilmCard(record.film) : tagWatchlistCard(record.item),
      )
      .join("");
    let combinedRows = visibleCombinedRecords
      .map((record) => {
        if (record.film)
          return `<tr>${tagWatchedCells(record.film)}${window.renderRatingTierCell({ film: record.film }, { escape })}</tr>`;
        let item = record.item;
        let film = window.watchlistFilmLike(item);
        let directorHtml = window.renderLinkedDirectors(film, { escape });
        return `<tr><td><a class="period-link" href="${escape(window.periodPageUrl("year", item.year))}">${escape(item.year || "")}</a></td>${window.renderFilmIdentityCell(
          film,
          { escape, href: window.filmPageUrl(item.supabaseFilmId) },
        )}<td class="film-people-cell">${directorHtml}</td>${window.renderRatingTierCell({ item }, { escape })}</tr>`;
      })
      .join("");
    let tagReverseTargetSort = sort === "shuffle" ? "year" : sort;
    let sortAxisControl = window.renderSortAxisControl({
      escape,
      value: sort === "shuffle" ? "" : sort,
      attribute: "data-tag-sort",
      axes: [
        { value: "year", label: "Release year" },
        ...(combinedView ? [] : [{ value: "local", label: "Local rank" }]),
        { value: "title", label: "Title" },
        { value: "rating", label: "Rating" },
        { value: "wins", label: "Wins" },
        { value: "nominations", label: "Nominations" },
        { value: "score", label: "Score" },
      ],
    });
    let toolbarControlsHtml = `<div class="detail-toolbar-controls">${sortAxisControl}${window.renderChronologyControl({ order, href: tagViewUrl({ sort: tagReverseTargetSort, order: order === "asc" ? "desc" : "asc", resetPages: true }), escape, iconOnly: true })}${window.renderShuffleControl({ href: tagViewUrl({ sort: "shuffle", seed: window.freshShuffleSeed(), resetPages: true }), escape, label: ui("Shuffle") })}${sortedWatchlistItems.length ? window.renderCombinedSectionsControl({ combined: combinedView, href: tagViewUrl({ sections: combinedView ? "split" : "combined", resetPages: true }), escape }) : ""}</div>`;
    let toolbarHtml = `<div class="tag-view-toolbar collection-film-toolbar detail-toolbar">${toolbarControlsHtml}${window.renderFilmViewToggle({ view: filmView, listUrl: tagViewUrl({ view: "list" }), gridUrl: tagViewUrl({ view: "grid" }), escape, classes: "tag-film-view-toggle", ariaLabel: ui("Tag film display") })}</div>`;
    function paginationControls(total, page, dataAttribute) {
      return window.renderPaginationControls({
        total,
        page,
        pageSize: PAGE_SIZE,
        dataAttribute,
        itemLabel: ui("films"),
        classes: ["tag-pagination"],
      });
    }
    function sectionHeading(title, count) {
      let countLabel =
        window.uiCount?.(count, "film", "films") ||
        `${count} ${count === 1 ? ui("Film") : ui("Films")}`;
      return `<div class="tag-section-heading"><h2>${escape(ui(title))}</h2><span>${escape(countLabel)}</span></div>`;
    }
    let localRankControls =
      !combinedView && sort === "local" && films.length > 1
        ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-tag-local-rank-edit-toggle${busy ? " disabled" : ""}>${escape(ui(localRankEditMode ? "Finish order" : "Reorder"))}</button>${localRankEditMode ? `<span>${escape(ui("Drag to set this collection's independent local order."))}</span>` : `<a class="sort-order-button" href="${escape(window.localRankMergePageUrl("tags", tagId, tagViewUrl()))}">${escape(ui("Merge-sort tool"))}</a>`}</div>`
        : "";
    let watchlistOrderControls =
      sortedWatchlistItems.length && !combinedView
        ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-tag-watchlist-order-edit-toggle${busy ? " disabled" : ""}>${escape(ui(watchlistOrderEditMode ? "Finish order" : "Reorder"))}</button>${watchlistOrderEditMode ? `<span>${escape(ui("Edits global watchlist order inside the same interest tier only."))}</span>` : ""}</div>`
        : "";
    let watchlistBulkTierControls =
      sortedWatchlistItems.length && !combinedView
        ? `<div class="period-edit-controls">${window.renderSupabaseWatchlistBulkTierControl({ count: sortedWatchlistItems.length, busy, escape })}</div>`
        : "";
    let watchedPaginationHtml = paginationControls(
      films.length,
      watchedPagination.page,
      "data-tag-watched-page",
    );
    let watchlistPaginationHtml = paginationControls(
      sortedWatchlistItems.length,
      watchlistPagination.page,
      "data-tag-watchlist-page",
    );
    let combinedPaginationHtml = paginationControls(
      combinedRecords.length,
      combinedPagination.page,
      "data-tag-combined-page",
    );
    let watchedContentHtml =
      filmView === "grid"
        ? cards
          ? `<div class="film-grid tag-film-grid">${cards}</div>`
          : `<div class="detail-empty">${escape(ui("No watched films use this tag."))}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr>${sort === "local" ? `<th>${escape(ui("Rank"))}</th>` : ""}<th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="${sort === "local" ? "5" : "4"}">${escape(ui("No watched films use this tag."))}</td></tr>`}</tbody></table></div>`;
    let watchlistContentHtml = sortedWatchlistItems.length
      ? `<section class="tag-film-section tag-watchlist-section">${sectionHeading("Watchlist", sortedWatchlistItems.length)}${watchlistBulkTierControls}${watchlistOrderControls}${watchlistPaginationHtml}${filmView === "grid" ? `<div class="film-grid tag-film-grid">${watchlistCards}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Interest"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Tier"))}</th></tr></thead><tbody>${watchlistRows}</tbody></table></div>`}${watchlistPaginationHtml}</section>`
      : "";
    let splitContentHtml = `<section class="tag-film-section tag-watched-section">${sectionHeading("Watched", films.length)}${localRankControls}${watchedPaginationHtml}${watchedContentHtml}${watchedPaginationHtml}</section>${watchlistContentHtml}`;
    let combinedContentHtml = `${combinedPaginationHtml}${
      filmView === "grid"
        ? combinedCards
          ? `<div class="film-grid tag-film-grid">${combinedCards}</div>`
          : `<div class="detail-empty">${escape(ui("No watched films use this tag."))}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))} / ${escape(ui("Tier"))}</th></tr></thead><tbody>${combinedRows || `<tr><td colspan="4">${escape(ui("No watched films use this tag."))}</td></tr>`}</tbody></table></div>`
    }${combinedPaginationHtml}`;
    let ratingStatistics = window.collectionRatingStatistics(tagFilms);

    document.title = `${canonicalTag} · ${ui("Tags")} · The Oskars`;
    container.innerHTML = `${window.renderBreadcrumbs([{ label: ui("Tags"), href: "tags.html" }, { label: canonicalTag }], { escape })}${window.renderDetailHeader({ mainHtml: `<h1>${escape(canonicalTag)}</h1>` })}${window.renderDetailStats({ itemsHtml: `<span><b>${films.length}</b> ${escape(ui(films.length === 1 ? "Film" : "Films"))}</span>${sortedWatchlistItems.length ? `<span><b>${sortedWatchlistItems.length}</b> ${escape(ui("Watchlist"))}</span>` : ""}${window.renderRatingStatisticsItems(ratingStatistics, { escape, ui })}` })}${window.renderSupabaseEntityNote({ entityKind: "tag", entityKey: canonicalTag, note: noteState.note, editing: noteState.editing, busy: noteState.busy, label: ui("Tag note"), escape })}${toolbarHtml}${combinedView ? combinedContentHtml : splitContentHtml}`;

    container
      .querySelector?.("[data-tag-sort]")
      ?.addEventListener("change", (event) => {
        window.location.href = tagViewUrl({
          sort: event.target.value,
          order: window.defaultOrderForFilmAxis(event.target.value),
          resetPages: true,
        });
      });
    container.addEventListener("click", (event) => {
      let watchedButton = event.target.closest?.("[data-tag-watched-page]");
      let watchlistButton = event.target.closest?.("[data-tag-watchlist-page]");
      let combinedButton = event.target.closest?.("[data-tag-combined-page]");
      let button = watchedButton || watchlistButton || combinedButton;
      if (!button) return;
      event.preventDefault();
      window.location.href = tagViewUrl(
        watchedButton
          ? { watchedPage: button.dataset.tagWatchedPage }
          : watchlistButton
            ? { watchlistPage: button.dataset.tagWatchlistPage }
            : { page: button.dataset.tagCombinedPage },
      );
    });
    container
      .querySelector?.("[data-tag-watchlist-order-edit-toggle]")
      ?.addEventListener("click", () => {
        watchlistOrderEditMode = !watchlistOrderEditMode;
        window.location.href = tagViewUrl();
      });
    container
      .querySelector?.("[data-tag-local-rank-edit-toggle]")
      ?.addEventListener("click", () => {
        localRankEditMode = !localRankEditMode;
        window.location.href = tagViewUrl();
      });
    window.createOrderEditController({
      container,
      scope: "watchlist",
      enabled: () => watchlistOrderEditMode,
      rejectedMessage: ui(
        "Watchlist ordering moves are limited to the same interest tier.",
      ),
      commit: async (from, target, position) => {
        let fromItem = sortedWatchlistItems.find((item) => item.id === from.id);
        let toItem = sortedWatchlistItems.find((item) => item.id === target.id);
        if (!fromItem || !toItem)
          return {
            ok: false,
            reason: "Both films must exist in the watchlist.",
          };
        let fromTier = window.normalizeWatchlistTier(fromItem.tier);
        let toTier = window.normalizeWatchlistTier(toItem.tier);
        if (fromTier !== toTier)
          return {
            ok: false,
            reason:
              "Watchlist ordering moves are limited to the same interest tier.",
          };
        let tierItems = sortedWatchlistItems
          .filter(
            (item) => window.normalizeWatchlistTier(item.tier) === fromTier,
          )
          .sort(
            (a, b) => Number(a.order || 999999) - Number(b.order || 999999),
          );
        let toIndex = tierItems.findIndex((item) => item.id === target.id);
        let beforeId =
          position === "after" ? target.id : tierItems[toIndex - 1]?.id || null;
        let afterId =
          position === "after" ? tierItems[toIndex + 1]?.id || null : target.id;
        await window.moveSupabaseWatchlistItemWithinTier(
          from.id,
          window.getSupabaseWorkspace()?.watchlist || [],
          beforeId,
          afterId,
        );
        return { ok: true };
      },
      rerender: reload,
    });
    window.createOrderEditController({
      container,
      scope: "local-rank",
      enabled: () => localRankEditMode,
      commit: async (from, target, position) => {
        let ok = await window.moveSupabaseLocalRankFilm(
          "tag",
          tagId,
          implicitTagFilmIds,
          from.id,
          target.id,
          position,
        );
        return ok ? { ok: true } : { ok: false };
      },
      rerender: reload,
    });
    finishRenderTimer?.(
      `${films.length} films, ${sortedWatchlistItems.length} watchlist`,
    );
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    if (!canonicalTag) {
      render();
      return;
    }
    // Bound once (not inside render()) since both delegate to `container`
    // itself, which survives every innerHTML rebuild - rebinding per
    // render would stack duplicate listeners and double-fire the write.
    window.bindSupabaseEntityNoteEditor({
      container,
      entityKind: "tag",
      entityKey: canonicalTag,
      state: noteState,
      rerender: render,
    });
    window.bindSupabaseWatchlistBulkTierControl({
      container,
      entries: () => watchlistItems,
      onStart: () => {
        busy = true;
        render();
      },
      onError: (err) => {
        alert(err.message || String(err));
        busy = false;
        render();
      },
      rerender: reload,
    });
    try {
      let [collection, franchiseCatalog] = await Promise.all([
        window.loadSupabaseTagCollection(canonicalTag),
        window.loadSupabaseFranchiseCatalog(),
        window.loadSupabaseWorkspace(),
      ]);
      if (!collection) {
        canonicalTag = "";
        render();
        return;
      }
      tagId = collection.tagId;
      let chains = window.buildSupabaseFranchiseChains(franchiseCatalog);
      tagFilms = collection.watched
        .map((row) =>
          window.supabaseLegacyHydrationFilmFromWatched(row, chains),
        )
        .filter(Boolean);
      watchlistItems = collection.watchlist
        .map((row, index) =>
          window.supabaseLegacyHydrationWatchlistItem(row, index, chains),
        )
        .filter(Boolean);
      implicitTagFilmIds = [...tagFilms]
        .sort(
          (left, right) =>
            (window.filmRatingSortValue(right) || 0) -
            (window.filmRatingSortValue(left) || 0),
        )
        .map((film) => film.id);
      if (sort === "local") {
        let stored = await window.loadSupabaseLocalRankOrder("tag", tagId);
        let order = window.mergeSupabaseLocalRankOrder(
          stored,
          implicitTagFilmIds,
        );
        localRankMap = new Map(
          order.map((filmId, index) => [filmId, index + 1]),
        );
      }
      noteState.note = await window.loadSupabaseEntityNote("tag", canonicalTag);
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load this tag"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
