/** @file Controls franchise hierarchy, completion, film sections, projects, notes, sorting, and order editing. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  window.load();
  let franchiseIndex =
    window.ensureFranchiseIndex?.() || state.franchisesById || {};
  let franchise = franchiseIndex?.[window.pageQueryParam("id")];
  let container = document.getElementById("franchisePage");
  if (!franchise) {
    document.title = `${ui("Franchise not found")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Franchise not found"))}</h1><a href="franchises.html">${escape(ui("Browse franchises"))}</a></div>`;
    return;
  }
  let collectionPageView =
    window.pageQueryParam("collection-view") === "awards" ? "awards" : "films";
  let collectionAwardModel = window.collectionAwardViewModel?.(
    "franchise",
    franchise.id,
  );
  let finishRenderTimer = window.startOskarsPerformance?.("franchise:render");
  let parents = (
    franchise.parentIds?.length
      ? franchise.parentIds
      : franchise.parentId
        ? [franchise.parentId]
        : []
  )
    .map((id) => franchiseIndex[id])
    .filter(Boolean);
  let parent = parents[0] || null;
  // Full ancestor trail for the breadcrumb (outermost first), following the
  // same single lineage as `parent` — crossover siblings still show via
  // `parentLinks` below, the breadcrumb just needs one path back to a root.
  let ancestors = [];
  let seenAncestors = new Set([franchise.id]);
  let ancestorWalk = parent;
  while (ancestorWalk && !seenAncestors.has(ancestorWalk.id)) {
    seenAncestors.add(ancestorWalk.id);
    ancestors.unshift(ancestorWalk);
    ancestorWalk = ancestorWalk.parentId
      ? franchiseIndex[ancestorWalk.parentId]
      : null;
  }
  let children = franchise.childIds
    .map((id) => franchiseIndex[id])
    .filter(Boolean);
  let entries = franchise.films
    .map((entry) => ({ entry, film: state.filmsById[entry.filmId] }))
    .filter((item) => item.film);
  let otherEntries = (franchise.otherFilms || [])
    .map((entry) => ({
      entry,
      film: (state.watchedOther || []).find(
        (film) => film.id === entry.filmId,
      ),
    }))
    .filter((item) => item.film);
  let ratingStatistics =
    franchise.ratingStatistics ||
    window.collectionRatingStatistics(entries.map((entry) => entry.film));
  let filmSortValues = new Set([
    "rank",
    "local",
    "title",
    "year",
    "rating",
    "wins",
    "nominations",
    "score",
    "shuffle",
  ]);
  let requestedFilmSort = window.pageQueryParam("sort");
  let filmSort = filmSortValues.has(requestedFilmSort)
    ? requestedFilmSort
    : "rank";
  let requestedFilmOrder = window.pageQueryParam("order");
  let filmOrder =
    requestedFilmOrder === "asc" || requestedFilmOrder === "desc"
      ? requestedFilmOrder
      : window.defaultOrderForFilmAxis(filmSort);
  let filmShuffleSeed =
    filmSort === "shuffle"
      ? window.pageQueryParam("seed") || String(Date.now())
      : "";
  let filmView = window.filmViewMode("list");
  let sections = window.sectionsViewMode();
  let combinedView = sections === "combined";
  let watchlistOrderEditMode =
    !combinedView && window.pageQueryParam("edit") === "watchlist-order";
  let watchlistEntries = (franchise.watchlistFilms || [])
    .map((entry) => ({
      entry,
      item: window.findWatchlistItemById?.(entry.itemId),
    }))
    .filter((record) => record.item);
  let completion = window.franchiseCompletion(franchise);
  let representative = window.franchiseRepresentativeFilm(franchise);
  let representativePoster = representative
    ? window.renderFilmPoster(representative, "detail")
    : "";
  let years = entries
    .concat(otherEntries)
    .map((item) => Number(item.film.year))
    .filter(Number.isFinite);
  function allTimeOrder(left, right) {
    return window.compareByAllTimeRank(left, right, (item) => item.film);
  }
  function franchiseViewUrl(next = {}) {
    let sort = next.sort || filmSort;
    let view = next.view || filmView;
    let seed = next.seed || filmShuffleSeed;
    let order = next.order || filmOrder;
    let nextSections = next.sections || sections;
    let parts = [];
    if (sort !== "rank") parts.push(`&sort=${encodeURIComponent(sort)}`);
    if (sort === "shuffle") {
      if (seed) parts.push(`&seed=${encodeURIComponent(seed)}`);
    } else if (order !== window.defaultOrderForFilmAxis(sort)) {
      parts.push(`&order=${order}`);
    }
    if (view === "grid") parts.push("&view=grid");
    if (collectionPageView === "awards")
      parts.push("&collection-view=awards");
    if (nextSections === "combined") parts.push("&sections=combined");
    if (watchlistOrderEditMode && nextSections !== "combined")
      parts.push("&edit=watchlist-order");
    if (localRankEditMode && sort === "local" && nextSections !== "combined")
      parts.push("&edit=local-rank");
    return `${window.franchisePageUrl(franchise.id)}${parts.join("")}`;
  }
  // Comparator over watched ({entry,film}) and watchlist ({entry,item})
  // entries via the shared axis resolver (issue #53), so one sort control
  // drives both sections and the combined view.
  function franchiseCompare(left, right) {
    return window.compareFilmAxisRecords(left, right, {
      axis: filmSort,
      order: filmOrder,
      seed: filmShuffleSeed,
    });
  }
  let allTimeOrderedEntries = [...entries].sort(allTimeOrder);
  let localRankEntries = allTimeOrderedEntries.concat(
    [...otherEntries].sort(allTimeOrder),
  );
  let franchiseRank = new Map(
    allTimeOrderedEntries.map((item, index) => [item.film.id, index + 1]),
  );
  // Local rank (issue #165): an explicit within-franchise order that doesn't
  // have to agree with the implicit rank above, alongside it as a second
  // sort axis rather than replacing it. Only offered in split-sections view,
  // matching watchlistOrderEditMode's existing constraint.
  let implicitFilmIds = localRankEntries.map((item) => item.film.id);
  // Only computed when actually displayed/edited - avoids the extra
  // stored-order lookup and merge on every render of a page that isn't
  // using this sort axis.
  let localRankMap =
    filmSort === "local"
      ? window.localRankPositions("franchises", franchise.id, implicitFilmIds)
      : new Map();
  let localRankEditMode =
    !combinedView &&
    filmSort === "local" &&
    window.pageQueryParam("edit") === "local-rank";
  let filmEntries =
    filmSort === "local"
      ? [...localRankEntries].sort((left, right) => {
          let leftPos = localRankMap.get(left.film.id) ?? Infinity;
          let rightPos = localRankMap.get(right.film.id) ?? Infinity;
          return filmOrder === "desc"
            ? rightPos - leftPos
            : leftPos - rightPos;
        })
      : [...entries].sort(franchiseCompare);
  let otherFilmEntries = (filmSort === "local" ? [] : [...otherEntries]).sort((left, right) => {
    if (filmSort === "rank")
      return (
        Number(left.entry.rank || 999999) -
          Number(right.entry.rank || 999999) ||
        Number(left.film.year || 0) - Number(right.film.year || 0) ||
        window.compareEnglishTitles(left.film.title, right.film.title)
      );
    return franchiseCompare(left, right);
  });
  watchlistEntries = [...watchlistEntries].sort(franchiseCompare);
  if (watchlistOrderEditMode)
    watchlistEntries = [...watchlistEntries].sort((left, right) =>
      window.compareWatchlistItems(left.item, right.item),
    );
  // Combined sections view (issue #52): franchiseCompare already resolves
  // every axis across both record shapes, so merging is just one re-sort.
  let combinedEntries = combinedView
    ? [...filmEntries, ...watchlistEntries].sort(franchiseCompare)
    : [];
  let franchiseReverseTargetSort = filmSort === "shuffle" ? "rank" : filmSort;
  let sortAxisControl = window.renderSortAxisControl({
    escape,
    value: filmSort === "shuffle" ? "" : filmSort,
    attribute: "data-franchise-sort",
    axes: [
      { value: "rank", label: "Franchise rank" },
      ...(combinedView ? [] : [{ value: "local", label: "Local rank" }]),
      { value: "title", label: "Title" },
      { value: "year", label: "Release year" },
      { value: "rating", label: "Rating" },
      { value: "wins", label: "Wins" },
      { value: "nominations", label: "Nominations" },
      { value: "score", label: "Score" },
    ],
  });
  let sortControls = `<div class="franchise-film-toolbar"><div class="detail-toolbar-controls">${sortAxisControl}${window.renderChronologyControl({ order: filmOrder, href: franchiseViewUrl({ sort: franchiseReverseTargetSort, order: filmOrder === "asc" ? "desc" : "asc" }), iconOnly: true, escape, title: ui("Reverse current order") })}${window.renderShuffleControl({ href: franchiseViewUrl({ sort: "shuffle", seed: window.freshShuffleSeed() }), escape, label: ui("Shuffle") })}${watchlistEntries.length ? window.renderCombinedSectionsControl({ combined: combinedView, href: franchiseViewUrl({ sections: combinedView ? "split" : "combined" }), escape }) : ""}</div>${window.renderFilmViewToggle(
    {
      view: filmView,
      listUrl: franchiseViewUrl({ view: "list" }),
      gridUrl: franchiseViewUrl({ view: "grid" }),
      escape,
      ariaLabel: ui("Franchise film display"),
    },
  )}</div>`;
  function franchiseFilmPosition(filmId) {
    return (filmSort === "local" ? localRankMap : franchiseRank).get(filmId) || "—";
  }
  function franchiseFilmRow({ entry, film }, index = 0) {
    let childMemberships = (film.franchises || []).filter(
      (membership) =>
        membership.parentId === franchise.id ||
        (membership.parentIds || []).includes(franchise.id),
    );
    let context = entry.direct
      ? ""
      : childMemberships
          .map(
            (membership) =>
              `<a href="${escape(window.franchisePageUrl(membership.id))}">${escape(membership.name)}</a>`,
          )
          .join(", ");
    let attributes = window.renderOrderEditItemAttributes(
      {
        enabled: localRankEditMode,
        scope: "local-rank",
        id: film.id,
        index,
        group: franchise.id,
      },
      escape,
    );
    // Standard collection row (issue #135): Franchise rank | Film | Director
    // | Rating, with year, the single all-time rank presentation, and `via`
    // context in Film metadata.
    return `<tr${attributes}><td class="leaderboard-position">${franchiseFilmPosition(film.id)}</td>${window.renderFilmIdentityCell(
      film,
      {
        escape,
        year: true,
        allTimeRank: true,
        metaFragments: context ? [`${escape(ui("via"))} ${context}`] : [],
      },
    )}<td class="film-people-cell">${window.renderLinkedDirectors(film, { escape, assumeIndexed: true })}</td>${window.renderRatingTierCell({ film }, { escape })}</tr>`;
  }

  function franchiseOtherRow({ film }) {
    return `<tr><td><a class="period-link" href="${escape(`${window.periodPageUrl("year", film.year)}&view=other`)}">${escape(film.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape })}<td class="film-people-cell">${window.renderLinkedDirectors(film, { escape })}</td><td>${escape(film.type || ui("Other"))}</td>${window.renderRatingTierCell({ film }, { escape })}</tr>`;
  }

  function franchiseOtherCard({ film }) {
    return window.renderSharedFilmCard(film, {
      classes: ["franchise-film-card", "other-watched-card"],
      showYear: true,
      directorHtml: window.renderLinkedDirectors(film, { escape }),
      escape,
      bodyHtml: `<div class="leaderboard-meta">${escape(film.type || ui("Other"))}</div>`,
    });
  }
  let rows = filmEntries
    .map((entryRecord, index) => franchiseFilmRow(entryRecord, index))
    .join("");
  function filmCard(entryRecord, index = 0) {
    let { entry, film } = entryRecord;
    let childMemberships = (film.franchises || []).filter(
      (membership) =>
        membership.parentId === franchise.id ||
        (membership.parentIds || []).includes(franchise.id),
    );
    let context = entry.direct
      ? ""
      : childMemberships.map((membership) => membership.name).join(", ");
    return window.renderSharedFilmCard(film, {
      classes: [
        "franchise-film-card",
        localRankEditMode ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: localRankEditMode,
        scope: "local-rank",
        id: film.id,
        index,
        group: franchise.id,
      }),
      openFilm: false,
      compare: false,
      showYear: true,
      rankLabel: `${franchiseFilmPosition(film.id)}.`,
      escape,
      titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(film.id))}">${escape(window.localizedFilmTitle?.(film) || film.title)}</a>`,
      director: film.director || (film.directors || []).join(", "),
      bodyHtml: context
        ? `<div class="leaderboard-meta">${escape(ui("via"))} ${escape(context)}</div>`
        : "",
    });
  }
  let filmGrid = filmEntries
    .map((entryRecord, index) => filmCard(entryRecord, index))
    .join("");
  let childLinks = children
    .map(
      (child) =>
        `<a href="${escape(window.franchisePageUrl(child.id))}">${escape(child.name)} <span>${child.films.length} ${escape(ui("films"))}</span></a>`,
    )
    .join("");
  // Standard collection row (issue #136): Interest/order | Film | Director |
  // Tier, in both the split watchlist table and the combined view - the
  // final cell's tier badge distinguishes a watchlist row from a watched
  // row's rating, so the combined table needs no separate status column.
  function franchiseWatchlistRow(
    { entry, item },
    { statusCell, index = 0 } = {},
  ) {
    let film = window.watchlistFilmLike(item);
    let directorHtml = window.renderLinkedDirectors(film, { escape });
    let childMemberships = window
      .normalizeFranchiseMemberships(item.franchises)
      .filter(
        (membership) =>
          membership.parentId === franchise.id ||
          (membership.parentIds || []).includes(franchise.id),
      );
    let context = entry.direct
      ? ""
      : childMemberships
          .map((membership) =>
            franchiseIndex?.[membership.id]
              ? `<a href="${escape(window.franchisePageUrl(membership.id))}">${escape(membership.name)}</a>`
              : escape(membership.name),
          )
          .join(", ");
    let attributes = window.renderOrderEditItemAttributes(
      {
        enabled: watchlistOrderEditMode && !statusCell,
        scope: "watchlist",
        id: item.id,
        index,
        group: window.normalizeWatchlistTier(item.tier),
      },
      escape,
    );
    return `<tr${attributes}><td class="leaderboard-position">${escape(item.order || entry.rank || "—")}</td>${window.renderFilmIdentityCell(
      film,
      {
        escape,
        href: window.watchlistFilmPageUrl(item.id),
        year: true,
        metaFragments: context ? [`${escape(ui("via"))} ${context}`] : [],
      },
    )}<td class="film-people-cell">${directorHtml}</td>${window.renderRatingTierCell({ item }, { escape })}</tr>`;
  }
  function franchiseWatchlistCard(
    { entry, item },
    { statusBody, index = 0 } = {},
  ) {
    let film = window.watchlistFilmLike(item);
    let directorHtml = window.renderLinkedDirectors(film, { escape });
    let childMemberships = window
      .normalizeFranchiseMemberships(item.franchises)
      .filter(
        (membership) =>
          membership.parentId === franchise.id ||
          (membership.parentIds || []).includes(franchise.id),
      );
    let context = entry.direct
      ? ""
      : childMemberships.map((membership) => membership.name).join(", ");
    let bodyMeta = [
      statusBody ? escape(ui("Watchlist")) : "",
      context ? `${escape(ui("via"))} ${escape(context)}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return window.renderSharedFilmCard(film, {
      classes: [
        "franchise-film-card",
        "watchlist-card",
        watchlistOrderEditMode && !statusBody ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: watchlistOrderEditMode && !statusBody,
        scope: "watchlist",
        id: item.id,
        index,
        group: window.normalizeWatchlistTier(item.tier),
      }),
      openFilm: false,
      compare: false,
      showYear: true,
      rankLabel: `${item.order || entry.rank || item.tier || "—"}.`,
      escape,
      titleHtml: `<a class="table-film-link" href="${escape(window.watchlistFilmPageUrl(item.id))}">${escape(window.localizedFilmTitle?.(film) || item.title)}</a>`,
      directorHtml: directorHtml
        ? `<div class="film-director">${escape(ui("by"))} ${directorHtml}</div>`
        : "",
      beforeTitleHtml: item.tier
        ? `<span class="watchlist-tier tier-${escape(item.tier.toLowerCase())}">${escape(item.tier)}</span>`
        : "",
      bodyHtml: bodyMeta
        ? `<div class="leaderboard-meta">${bodyMeta}</div>`
        : "",
    });
  }
  let watchlistRows = watchlistEntries
    .map((record, index) => franchiseWatchlistRow(record, { index }))
    .join("");
  let otherRows = otherFilmEntries.map(franchiseOtherRow).join("");
  let otherGrid = otherFilmEntries.map(franchiseOtherCard).join("");
  let watchlistGrid = watchlistEntries
    .map((record, index) => franchiseWatchlistCard(record, { index }))
    .join("");
  // Combined sections view (issue #52): one interleaved table/grid.
  let combinedRows = combinedEntries
    .map((record) =>
      record.film
        ? franchiseFilmRow(record)
        : franchiseWatchlistRow(record, { statusCell: true }),
    )
    .join("");
  let combinedGrid = combinedEntries
    .map((record) =>
      record.film
        ? filmCard(record)
        : franchiseWatchlistCard(record, { statusBody: true }),
    )
    .join("");
  // Up next (issue #17): a short queue in franchise order instead of a single
  // pick, so the section shows where the watch-through is heading.
  let upNextItems =
    window.franchiseUpNext?.(franchise, 3) ||
    (completion.nextItem ? [completion.nextItem] : []);
  let nextWatchlist = upNextItems.length
    ? `<section class="franchise-next-watch"><h2>${escape(ui(upNextItems.length > 1 ? "Up next" : "Next unwatched"))}</h2><div class="franchise-next-watch-list">${upNextItems.map((item) => `<div class="film-table-cell">${window.renderFilmPoster(window.watchlistFilmLike(item), "thumb")}<span><a class="table-film-link" href="${escape(window.watchlistFilmPageUrl(item.id))}"><strong>${escape(window.localizedFilmTitle?.(window.watchlistFilmLike(item)) || item.title)}</strong></a><span class="leaderboard-meta">${escape(item.year || "")}${item.tier ? ` · ${escape(ui("Tier"))} ${escape(item.tier)}` : ""}</span></span></div>`).join("")}</div></section>`
    : "";
  // When nothing is left on the watchlist, 100% only means "every film the
  // archive + watchlist know about" — say so instead of implying the franchise
  // is exhaustively covered.
  let completionCaveat = !completion.watchlistCount
    ? `<p class="franchise-completion-caveat">${escape(ui("All known films watched. Completion counts known films only — add missing entries to the watchlist to track true coverage."))}</p>`
    : "";
  let watchlistOrderControls =
    canEdit && watchlistEntries.length && !combinedView
      ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-franchise-watchlist-order-edit-toggle>${escape(ui(watchlistOrderEditMode ? "Finish order" : "Reorder"))}</button>${watchlistOrderEditMode ? `<span>${escape(ui("Edits global watchlist order inside the same interest tier only."))}</span>` : ""}</div>`
      : "";
  let localRankControls =
    canEdit && !combinedView && filmSort === "local" && localRankEntries.length > 1
      ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-franchise-local-rank-edit-toggle>${escape(ui(localRankEditMode ? "Finish order" : "Reorder"))}</button>${localRankEditMode ? `<span>${escape(ui("Drag to set this collection's independent local order."))}</span>` : `<a class="sort-order-button" href="${escape(window.localRankMergePageUrl("franchises", franchise.id, franchiseViewUrl()))}">${escape(ui("Merge-sort tool"))}</a>`}</div>`
      : "";
  let watchlistBulkTierControls =
    watchlistEntries.length && !combinedView
      ? `<div class="period-edit-controls">${window.renderWatchlistBulkTierControl({ escape, count: watchlistEntries.length })}</div>`
      : "";
  document.title = `${franchise.name} · The Oskars`;
  let parentLinks = parents
    .map(
      (parent) =>
        `<a href="${escape(window.franchisePageUrl(parent.id))}">${escape(parent.name)}</a>`,
    )
    .join(", ");
  let sourceLinkHtml = franchise.sourceUrl
    ? ` · <a class="period-link" href="${escape(franchise.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(ui("Source"))}</a>`
    : "";
  container.innerHTML = `${window.renderBreadcrumbs(
    [
      { label: ui("Franchises"), href: "franchises.html" },
      ...ancestors.map((ancestor) => ({
        label: ancestor.name,
        href: window.franchisePageUrl(ancestor.id),
      })),
      { label: franchise.name },
    ],
    { escape },
  )}
  ${window.renderDetailHeader({ classes: "franchise-detail-header", leadingHtml: representativePoster ? `<div class="franchise-detail-poster">${representativePoster}</div>` : "", mainHtml: `<h1>${escape(franchise.name)}</h1><p>${parentLinks ? `${escape(ui("Part of"))} ${parentLinks}` : escape(ui("Franchise"))}${sourceLinkHtml}</p>`, actionsHtml: window.renderSourceProjectAction("franchise", franchise.id, { escape }) })}
  ${window.renderCollectionViewController({ view: collectionPageView, overviewUrl: window.franchisePageUrl(franchise.id), awardsUrl: `${window.franchisePageUrl(franchise.id)}&collection-view=awards`, escape, ui })}
  <div data-collection-page-view="films" ${collectionPageView === "films" ? "" : "hidden"}>
  ${window.renderDetailStats({ itemsHtml: `<span><b>${completion.watchedCount}</b> ${escape(ui("Watched"))}</span>${completion.watchlistCount ? `<span><b>${completion.watchlistCount}</b> Watchlist</span>` : ""}<span><b>${completion.total}</b> ${escape(ui("Known"))}</span><span><b>${completion.percent}%</b> ${escape(ui("Complete"))}</span>${years.length ? `<span><b>${Math.min(...years)}–${Math.max(...years)}</b> ${escape(ui("Years"))}</span>` : ""}<span><b>${children.length}</b> ${escape(ui("Child franchises"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape, ui })}` })}
  ${window.renderEntityNote("franchises", franchise.id, ui("Franchise note"))}
  <div class="project-progress-meter project-progress-meter--detail" aria-label="${escape(ui("{percent} percent complete", { percent: completion.percent }))}"><span style="width:${escape(completion.percent)}%"></span></div>
  ${completionCaveat}
  ${nextWatchlist}
  ${children.length ? `<section class="franchise-child-section"><h2>${escape(ui("Subfranchises"))}</h2><div class="franchise-child-links">${childLinks}</div></section>` : ""}
  <h2>${escape(ui("Films"))}</h2>${sortControls}${localRankControls}${
    combinedView
      ? filmView === "grid"
        ? `<div class="film-grid franchise-film-grid">${combinedGrid || `<p>${escape(ui("No films"))}</p>`}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Rank"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))} / ${escape(ui("Tier"))}</th></tr></thead><tbody>${combinedRows || `<tr><td colspan="4">${escape(ui("No films"))}</td></tr>`}</tbody></table></div>`
      : `${filmView === "grid" ? `<div class="film-grid franchise-film-grid">${filmGrid || `<p>${escape(ui("No films"))}</p>`}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Rank"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))}</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${escape(ui("No films"))}</td></tr>`}</tbody></table></div>`}
  ${watchlistRows ? `<h2>Watchlist</h2>${watchlistBulkTierControls}${watchlistOrderControls}${filmView === "grid" ? `<div class="film-grid franchise-film-grid">${watchlistGrid}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Interest"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Tier"))}</th></tr></thead><tbody>${watchlistRows}</tbody></table></div>`}` : ""}`
  }
  ${otherRows ? `<section class="franchise-other-watched"><h2>${escape(ui("Other watched"))}</h2>${filmView === "grid" ? `<div class="film-grid franchise-film-grid">${otherGrid}</div>` : window.renderLeaderboardTable({ headers: [ui("Year"), ui("Title"), ui("Director"), ui("Type"), ui("Rating")].map(escape), rows: otherRows })}</section>` : ""}</div>
  <div data-collection-page-view="awards" ${collectionPageView === "awards" ? "" : "hidden"}>${window.renderCollectionAwardsView(collectionAwardModel, { escape, ui })}</div>`;
  container
    .querySelector("[data-franchise-sort]")
    ?.addEventListener("change", (event) => {
      window.location.href = window.prepareOskarsAccountNavigation(
        franchiseViewUrl({
          sort: event.target.value,
          order: window.defaultOrderForFilmAxis(event.target.value),
        }),
      );
    });
  container
    .querySelector("[data-start-project-source]")
    ?.addEventListener("click", (event) => {
      let button = event.currentTarget;
      window.startProjectFromSourceAndOpen(
        button.dataset.startProjectSource,
        button.dataset.projectSourceId,
      );
    });
  container
    .querySelector("[data-franchise-watchlist-order-edit-toggle]")
    ?.addEventListener("click", () => {
      watchlistOrderEditMode = !watchlistOrderEditMode;
      window.location.href = window.prepareOskarsAccountNavigation(
        franchiseViewUrl(),
      );
    });
  container
    .querySelector("[data-franchise-local-rank-edit-toggle]")
    ?.addEventListener("click", () => {
      localRankEditMode = !localRankEditMode;
      window.location.href = window.prepareOskarsAccountNavigation(
        franchiseViewUrl(),
      );
    });
  window.bindWatchlistBulkTierControl({
    container,
    entries: () => watchlistEntries,
    rerender: () => {
      window.location.href = window.prepareOskarsAccountNavigation(
        franchiseViewUrl(),
      );
    },
  });
  window.createOrderEditController({
    container,
    scope: "watchlist",
    enabled: () => watchlistOrderEditMode,
    rejectedMessage: ui(
      "Watchlist ordering moves are limited to the same interest tier.",
    ),
    commit: (from, target, position) =>
      window.moveWatchlistItemWithinTier?.(from.id, target.id, position),
    rerender: () => {
      window.save?.({ immediate: true, rebuild: false });
      window.location.href = window.prepareOskarsAccountNavigation(
        franchiseViewUrl(),
      );
    },
  });
  window.createOrderEditController({
    container,
    scope: "local-rank",
    enabled: () => localRankEditMode,
    commit: (from, target, position) =>
      window.moveLocalRankFilm?.(
        "franchises",
        franchise.id,
        implicitFilmIds,
        from.id,
        target.id,
        position,
        { save: false },
      )
        ? { ok: true }
        : { ok: false },
    rerender: () => {
      window.save?.({ immediate: true, rebuild: false });
      window.location.href = window.prepareOskarsAccountNavigation(
        franchiseViewUrl(),
      );
    },
  });
  window.enhanceCollapsibles?.(container);
  window.bindEntityNoteEditor(container);
  finishRenderTimer?.(
    `${franchise.id}, ${entries.length} film(s), ${watchlistEntries.length} watchlist item(s)`,
  );
})();
