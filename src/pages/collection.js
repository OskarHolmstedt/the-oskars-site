/**
 * @file Controls the Supabase-backed bare collection detail (issue
 * #449): a named, ordered film list with no workflow state at all - the
 * base entity a project (project.html) is an optional promotion on top
 * of. Deliberately a close structural mirror of project.js (same sort/
 * shuffle/view toolbar, item cards/rows, watched/queue split, rating
 * stats, drag-reorder, removal, note, permanent delete) rather than a
 * shared abstraction between the two pages - see issue #449's plan for
 * why (avoiding a deep refactor's regression risk on project.html,
 * which already shipped and was verified independently). The one thing
 * this page has that project.html doesn't: "Promote to project," the
 * real point of splitting collections out from projects in the first
 * place. If this collection has already been promoted (a stale
 * bookmark), boot() redirects straight to project.html instead of
 * rendering a confusing duplicate "promote" affordance.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("collectionPage");

  let collectionId = window.pageQueryParam("id");
  let collection = null;
  let items = [];
  let rawItems = [];
  let noteState = { note: "", editing: false, busy: false };
  let busy = false;
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  let boundContainerEvents = false;
  let collectionTrophy = null;

  function collectionAction(kind, id, active) {
    if (!canEdit || !id) return "";
    return window.renderCollectionActionButton({
      kind,
      label: ui(
        kind === "rewatch"
          ? active
            ? "Remove from rewatchlist"
            : "Want to rewatch"
          : active
            ? "Remove from watchlist"
            : "Add to watchlist",
      ),
      active,
      escape,
      attributes: {
        "data-collection-action": kind,
        "data-collection-id": id,
        "data-collection-active": String(Boolean(active)),
        disabled: busy || queueEditMode,
      },
    });
  }

  function updateCollectionActionAvailability() {
    container
      .querySelectorAll("[data-collection-action], [data-edit-tier]")
      .forEach((action) => {
        /** @type {HTMLButtonElement} */ (action).disabled =
          busy || queueEditMode;
      });
  }

  async function handleCollectionAction(event) {
    let target = /** @type {HTMLElement|null} */ (event.target);
    let button = target?.closest?.("[data-collection-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (!canEdit || busy || queueEditMode) return;
    let { collectionAction: kind, collectionId: id } =
      /** @type {HTMLButtonElement} */ (button).dataset;
    let active =
      /** @type {HTMLButtonElement} */ (button).dataset.collectionActive ===
      "true";
    if (!id) return;
    busy = true;
    updateCollectionActionAvailability();
    try {
      if (kind === "rewatch") {
        await window.setSupabaseWatchedRewatch(id, !active);
        let rec = items.find(
          (r) =>
            (r.film || r.item)?.supabaseFilmId === id ||
            (r.film || r.item)?.id === id,
        );
        if (rec?.film) {
          rec.film.wantToRewatch = !active;
          if (active) {
            rec.film.rewatchTier = "";
            rec.film.rewatchTierModifier = "";
          }
        }
      } else if (kind === "watchlist" && active) {
        await window.removeFromSupabaseWatchlist(id);
        window.invalidateCachedSupabaseHydrationSource?.();
        let removedIndex = (window.state?.watchlist || []).findIndex(
          (item) => item.id === id,
        );
        if (removedIndex !== -1) {
          window.state.watchlist.splice(removedIndex, 1);
        }
        let rec = items.find((r) => r.item?.id === id);
        if (rec) {
          rec.status = "missing";
          rec.film = window.watchlistFilmLike(rec.item);
          delete rec.item;
        }
        if (window.state) {
          window.state.aggregateVersion =
            (Number(window.state.aggregateVersion) || 0) + 1;
        }
      } else if (kind === "watchlist" && !active) {
        let created = await window.addToSupabaseWatchlist(id);
        window.invalidateCachedSupabaseHydrationSource?.();
        let rec = items.find(
          (r) =>
            (r.film || r.item)?.supabaseFilmId === id ||
            (r.film || r.item)?.id === id,
        );
        let film = rec?.film;
        let watchlistItem = {
          id: created?.id || id,
          supabaseFilmId: film?.supabaseFilmId || film?.id || id,
          title: film?.title || "",
          year: film?.year || "",
          letterboxdUrl: film?.letterboxdUrl || "",
          added: new Date().toISOString().slice(0, 10),
          tmdbId: film?.tmdbId || "",
          swedishTitle: film?.swedishTitle || "",
          tier: created?.tier || "",
          tierModifier: created?.tier_modifier || created?.tierModifier || "",
          order: (window.state?.watchlist?.length || 0) + 1,
          director: film?.director || "",
          directors: film?.directors || [],
          directorIds: film?.directorIds || [],
        };
        window.state.watchlist ||= [];
        window.state.watchlist.push(watchlistItem);
        if (rec) {
          rec.status = "watchlist";
          rec.item = watchlistItem;
        }
        if (window.state) {
          window.state.aggregateVersion =
            (Number(window.state.aggregateVersion) || 0) + 1;
        }
      }
      render();
    } catch (error) {
      window.alert?.(error.message || String(error));
    } finally {
      busy = false;
      updateCollectionActionAvailability();
    }
  }

  function handleCollectionTierEdit(event) {
    return window.handleInlineTierEditClick(event, {
      container,
      escape,
      ui,
      canEdit: canEdit && !busy && !queueEditMode,
      onSaved: ({ targetId, tier, modifier, type }) => {
        if (type === "watchlist") {
          let rec = items.find((r) => r.item?.id === targetId);
          if (rec?.item) {
            rec.item.tier = tier;
            rec.item.tierModifier = modifier;
            rec.item.tier_modifier = modifier;
          }
        } else if (type === "rewatch") {
          let rec = items.find(
            (r) =>
              r.film &&
              (r.film.supabaseFilmId === targetId || r.film.id === targetId),
          );
          if (rec?.film) {
            rec.film.rewatchTier = tier;
            rec.film.rewatchTierModifier = modifier;
          }
        }
        render();
      },
    });
  }

  let sortValues = new Set(["year", "title", "rating", "shuffle"]);
  let requestedSort = window.pageQueryParam("sort");
  let sort = sortValues.has(requestedSort) ? requestedSort : "year";
  let requestedOrder = window.pageQueryParam("order");
  let order =
    requestedOrder === "asc" || requestedOrder === "desc"
      ? requestedOrder
      : window.defaultOrderForFilmAxis(sort);
  let shuffleSeed =
    sort === "shuffle"
      ? window.pageQueryParam("seed") || String(Date.now())
      : "";
  let filmView = window.filmViewMode("list");
  let queueEditMode = window.pageQueryParam("edit") === "queue-order";

  function collectionViewUrl(next = {}) {
    let nextSort = next.sort || sort;
    let nextOrder = next.order || order;
    let view = next.view || filmView;
    let seed = next.seed || shuffleSeed;
    let parts = [];
    if (nextSort !== "year") parts.push(`sort=${encodeURIComponent(nextSort)}`);
    if (nextSort === "shuffle") {
      if (seed) parts.push(`seed=${encodeURIComponent(seed)}`);
    } else if (nextOrder !== window.defaultOrderForFilmAxis(nextSort)) {
      parts.push(`order=${nextOrder}`);
    }
    if (view === "grid") parts.push("view=grid");
    if (queueEditMode && nextSort !== "shuffle") parts.push("edit=queue-order");
    return `${window.collectionPageUrl(collectionId)}${parts.length ? `&${parts.join("&")}` : ""}`;
  }

  function reload() {
    window.location.href = collectionViewUrl();
  }

  function recordCompare(left, right) {
    return window.compareFilmAxisRecords(left, right, {
      axis: sort,
      order,
      seed: shuffleSeed,
    });
  }

  function itemCard(record, index = 0, editable = false) {
    let filmObj =
      record.status === "watchlist"
        ? window.watchlistFilmLike(record.item)
        : record.film;
    let filmTier = collectionTrophy
      ? window.getCollectionFilmTier(
          collectionTrophy,
          filmObj.supabaseFilmId || filmObj.id,
        )
      : null;
    let tierBadgeHtml = filmTier
      ? window.renderCollectionTierBadge(filmTier)
      : "";

    if (record.status === "watchlist") {
      let item = record.item;
      let film = filmObj;
      let beforeTitle = [
        item.tier
          ? `<span class="watchlist-tier tier-${escape(item.tier.toLowerCase())}">${escape(window.renderTierWithModifier(item.tier, item.tier_modifier || item.tierModifier))}</span>`
          : "",
        tierBadgeHtml,
      ]
        .filter(Boolean)
        .join(" ");
      return window.renderSharedFilmCard(film, {
        classes: [
          "project-film-card",
          "watchlist-card",
          editable ? "watchlist-order-card" : "",
        ],
        attributes: window.orderEditItemAttributes({
          enabled: editable,
          scope: "queue",
          id: item.supabaseFilmId,
          index,
          group: "queue",
        }),
        openFilm: false,
        showYear: true,
        escape,
        beforeTitleHtml: beforeTitle,
        titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(item.supabaseFilmId))}">${escape(window.localizedFilmTitle?.(film) || item.title)}</a>`,
        bodyHtml: `<div class="watchlist-card-actions"><span>${escape(ui("Watchlist"))}</span></div>`,
      });
    }
    let film = record.film;
    let missingEditable = editable && record.status === "missing";
    let cardBody = [
      record.status === "missing"
        ? `<div class="leaderboard-meta">${escape(ui("Not in your collection yet"))}</div>`
        : "",
      tierBadgeHtml ? `<div class="card-tier-meta">${tierBadgeHtml}</div>` : "",
    ]
      .filter(Boolean)
      .join("");
    return window.renderSharedFilmCard(film, {
      classes: [
        "project-film-card",
        missingEditable ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: missingEditable,
        scope: "queue",
        id: film.supabaseFilmId,
        index,
        group: "queue",
      }),
      showYear: true,
      escape,
      director: film.director,
      bodyHtml: cardBody,
    });
  }

  function collectionRewatchTierCell(film) {
    let tierHtml = window.renderInlineTierTrigger({
      type: "rewatch",
      targetId: film.supabaseFilmId || film.id,
      tier: film.rewatchTier,
      modifier: film.rewatchTierModifier,
      editable: canEdit && Boolean(film.wantToRewatch),
      disabled: busy || queueEditMode,
      escape,
      ui,
    });
    let actionHtml = collectionAction(
      "rewatch",
      film.supabaseFilmId || film.id,
      film.wantToRewatch,
    );
    return `<td class="rating-tier-cell">${tierHtml} ${actionHtml}</td>`;
  }

  function itemRow(record, index = 0, editable = false) {
    let filmObj =
      record.status === "watchlist"
        ? window.watchlistFilmLike(record.item)
        : record.film;
    let filmTier = collectionTrophy
      ? window.getCollectionFilmTier(
          collectionTrophy,
          filmObj.supabaseFilmId || filmObj.id,
        )
      : null;
    let tierBadgeHtml = filmTier
      ? window.renderCollectionTierBadge(filmTier)
      : "";
    let metaFragments = tierBadgeHtml ? [tierBadgeHtml] : [];

    if (record.status === "watchlist") {
      let item = record.item;
      let film = filmObj;
      let attributes = window.renderOrderEditItemAttributes(
        {
          enabled: editable,
          scope: "queue",
          id: item.supabaseFilmId,
          index,
          group: "queue",
        },
        escape,
      );
      let tierHtml = window.renderInlineTierTrigger({
        type: "watchlist",
        targetId: item.id,
        tier: item.tier,
        modifier: item.tierModifier || item.tier_modifier,
        editable: canEdit,
        disabled: busy || queueEditMode,
        escape,
        ui,
      });
      let actionHtml = collectionAction("watchlist", item.id, true);
      let ratingTierHtml = window.renderRatingTierCell(
        { item },
        { escape, editHtml: `${tierHtml} ${actionHtml}` },
      );
      return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", item.year))}">${escape(item.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape, href: window.filmPageUrl(item.supabaseFilmId), metaFragments })}<td class="film-people-cell">${window.renderLinkedDirectors(item, { escape })}</td>${ratingTierHtml}</tr>`;
    }
    let film = record.film;
    let missingEditable = editable && record.status === "missing";
    let attributes = window.renderOrderEditItemAttributes(
      {
        enabled: missingEditable,
        scope: "queue",
        id: film.supabaseFilmId,
        index,
        group: "queue",
      },
      escape,
    );
    let directorCell = `<td class="film-people-cell">${window.renderLinkedDirectors(film, { escape })}</td>`;
    if (record.status === "missing") {
      let actionHtml = collectionAction(
        "watchlist",
        film.supabaseFilmId || film.id,
        false,
      );
      return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", film.year))}">${escape(film.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape, metaFragments })}${directorCell}<td class="rating-tier-cell">— ${actionHtml}</td></tr>`;
    }
    return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", film.year))}">${escape(film.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape, metaFragments })}${directorCell}${window.renderRatingTierCell({ film }, { escape })}${collectionRewatchTierCell(film)}</tr>`;
  }

  function render() {
    if (!collection) {
      document.title = `${ui("Collection not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Collection not found"))}</h1><a href="custom-collections.html">${escape(ui("Browse collections"))}</a></div>`;
      return;
    }
    document.title = `${collection.name} · The Oskars`;
    let finishRenderTimer =
      window.startOskarsPerformance?.("collection:render");
    let collectionTrophy = window.getCollectionTrophy
      ? window.getCollectionTrophy("collection", collection.id, state)
      : null;
    let trophyBannerHtml = collectionTrophy
      ? window.renderCollectionTrophyBanner(collectionTrophy)
      : "";
    let watched = items.filter((record) => record.status === "watched");
    let queue = items
      .filter((record) => record.status !== "watched")
      .sort(recordCompare);
    let sortedWatched = [...watched].sort(recordCompare);
    let ratingStatistics = window.collectionRatingStatistics(
      watched.map((record) => record.film),
    );
    let total = items.length;
    let percent = total ? Math.round((watched.length / total) * 100) : 0;

    let sortAxisControl = window.renderSortAxisControl({
      escape,
      value: sort === "shuffle" ? "" : sort,
      attribute: "data-collection-sort",
      axes: [
        { value: "year", label: "Release year" },
        { value: "title", label: "Title" },
        { value: "rating", label: "Rating" },
      ],
    });
    let reverseTargetSort = sort === "shuffle" ? "year" : sort;
    let toolbarHtml = `<div class="project-toolbar collection-film-toolbar detail-toolbar"><div class="detail-toolbar-controls">${sortAxisControl}${window.renderChronologyControl({ order, href: collectionViewUrl({ sort: reverseTargetSort, order: order === "asc" ? "desc" : "asc" }), escape, iconOnly: true })}${window.renderShuffleControl({ href: collectionViewUrl({ sort: "shuffle", seed: window.freshShuffleSeed() }), escape, label: ui("Shuffle") })}</div>${window.renderFilmViewToggle({ view: filmView, listUrl: collectionViewUrl({ view: "list" }), gridUrl: collectionViewUrl({ view: "grid" }), escape, ariaLabel: ui("Collection display") })}</div>`;

    let queueCards = queue
      .map((record, index) => itemCard(record, index, queueEditMode))
      .join("");
    let queueRows = queue
      .map((record, index) => itemRow(record, index, queueEditMode))
      .join("");
    let watchedCards = sortedWatched.map((record) => itemCard(record)).join("");
    let watchedRows = sortedWatched.map((record) => itemRow(record)).join("");
    let queueControls =
      queue.length > 1
        ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-collection-queue-edit-toggle${busy ? " disabled" : ""}>${escape(ui(queueEditMode ? "Finish order" : "Reorder"))}</button>${queueEditMode ? `<span>${escape(ui("Drag to set this collection's queue order."))}</span>` : ""}</div>`
        : "";

    let controlBannerHtml = `<div class="project-control-banner">
      ${toolbarHtml}
      ${queueControls ? `<div class="project-settings-bar">${queueControls}</div>` : ""}
    </div>`;

    let upNextRecord = queue.length ? queue[0] : null;
    let upNextHtml = upNextRecord
      ? `<section class="project-up-next" aria-label="${escape(ui("Up next"))}">
        <div class="project-up-next-header">
          <span class="eyebrow">${escape(ui("Up next"))}</span>
        </div>
        <div class="project-up-next-card">
          ${itemCard(upNextRecord, 0, false)}
        </div>
      </section>`
      : "";

    container.innerHTML = `${window.renderBreadcrumbs([{ label: ui("Collections"), href: "custom-collections.html" }, { label: collection.name }], { escape })}${window.renderDetailHeader(
      {
        mainHtml: `<h1>${escape(collection.name)}</h1><p>${collection.source_label ? escape(collection.source_label) : escape(ui("Custom collection"))}</p>`,
        actionsHtml: `<button type="button" class="sort-order-button" data-promote-collection${busy ? " disabled" : ""}>${escape(ui("Promote to project"))}</button>`,
      },
    )}
    ${trophyBannerHtml}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${watched.length}</b> ${escape(ui("Watched"))}</span><span><b>${queue.length}</b> ${escape(ui("Queue"))}</span><span><b>${total}</b> ${escape(ui("Total"))}</span><span><b>${percent}%</b> ${escape(ui("Complete"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape, ui })}` })}
    ${window.renderSupabaseEntityNote({ entityKind: "collection", entityKey: collection.id, note: noteState.note, editing: noteState.editing, busy: noteState.busy, draft: noteState.draft, label: ui("Collection note"), escape })}
    <div class="project-progress-meter project-progress-meter--detail" aria-label="${escape(ui("{percent} percent complete", { percent }))}"><span style="width:${escape(percent)}%"></span></div>
    ${controlBannerHtml}
    ${upNextHtml}
    <h2>${escape(ui("Queue"))}</h2>${
      filmView === "grid"
        ? `<div class="film-grid project-film-grid">${queueCards || `<p>${escape(ui("No films"))}</p>`}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))} / ${escape(ui("Tier"))}</th></tr></thead><tbody>${queueRows || `<tr><td colspan="4">${escape(ui("No films"))}</td></tr>`}</tbody></table></div>`
    }
    ${watched.length ? `<h2>${escape(ui("Watched"))}</h2>${filmView === "grid" ? `<div class="film-grid project-film-grid">${watchedCards}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))}</th><th>${escape(ui("Rewatch tier"))}</th></tr></thead><tbody>${watchedRows}</tbody></table></div>`}` : ""}
    <section class="project-manage" data-collection-manage>
      <h2>${escape(ui("Manage"))}</h2>
      <ul class="project-manage-list">${items
        .map(
          (record) =>
            `<li>${escape((record.film || record.item).title)} <button type="button" class="sort-order-button" data-remove-collection-item="${escape((record.film || record.item).supabaseFilmId)}"${busy ? " disabled" : ""}>${escape(ui("Remove"))}</button></li>`,
        )
        .join("")}</ul>
      <button type="button" class="sort-order-button" data-delete-collection${busy ? " disabled" : ""}>${escape(ui("Delete collection"))}</button>
      <dialog id="deleteCollectionDialog">
        <form method="dialog">
          <h2>${escape(ui("Delete this collection?"))}</h2>
          <p>${escape(ui("This permanently removes the collection. Films stay in your collection."))}</p>
          <div class="dialog-actions"><button type="button" data-delete-collection-cancel>${escape(ui("Cancel"))}</button><button type="button" data-delete-collection-confirm>${escape(ui("Delete"))}</button></div>
        </form>
      </dialog>
    </section>`;

    if (!boundContainerEvents) {
      container.addEventListener("click", (event) => {
        if (handleCollectionTierEdit(event)) return;
        handleCollectionAction(event);
      });
      boundContainerEvents = true;
    }

    container
      .querySelector("[data-collection-sort]")
      ?.addEventListener("change", (event) => {
        window.location.href = collectionViewUrl({
          sort: event.target.value,
          order: window.defaultOrderForFilmAxis(event.target.value),
        });
      });
    container
      .querySelector("[data-collection-queue-edit-toggle]")
      ?.addEventListener("click", () => {
        queueEditMode = !queueEditMode;
        window.location.href = collectionViewUrl();
      });
    container
      .querySelector("[data-promote-collection]")
      ?.addEventListener("click", async () => {
        busy = true;
        render();
        try {
          await window.promoteSupabaseCollectionToProject(collection.id);
          window.location.href = window.projectPageUrl(collection.id);
        } catch (err) {
          alert(err.message || String(err));
          busy = false;
          render();
        }
      });
    container
      .querySelectorAll("[data-remove-collection-item]")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          let filmId = button.dataset.removeCollectionItem;
          busy = true;
          render();
          try {
            await window.removeSupabaseCollectionItem(collection.id, filmId);
            items = items.filter(
              (record) =>
                (record.film || record.item).supabaseFilmId !== filmId,
            );
            rawItems = rawItems.filter((row) => row.film_id !== filmId);
          } catch (err) {
            alert(err.message || String(err));
          } finally {
            busy = false;
            render();
          }
        });
      });
    let deleteDialog = container.querySelector("#deleteCollectionDialog");
    container
      .querySelector("[data-delete-collection]")
      ?.addEventListener("click", () => deleteDialog?.showModal());
    container
      .querySelector("[data-delete-collection-cancel]")
      ?.addEventListener("click", () => deleteDialog?.close());
    let deleteConfirmButton = container.querySelector(
      "[data-delete-collection-confirm]",
    );
    deleteConfirmButton?.addEventListener("click", async () => {
      if (deleteConfirmButton.disabled) return;
      deleteConfirmButton.disabled = true;
      try {
        await window.deleteSupabaseCollection(collection.id);
        window.location.href = "custom-collections.html";
      } catch (err) {
        deleteConfirmButton.disabled = false;
        alert(err.message || String(err));
      }
    });
    window.createOrderEditController({
      container,
      scope: "queue",
      enabled: () => queueEditMode,
      commit: async (from, target, position) => {
        let ids = queue.map(
          (record) => (record.film || record.item).supabaseFilmId,
        );
        let fromIndex = ids.indexOf(from.id);
        let toIndex = ids.indexOf(target.id);
        if (fromIndex < 0 || toIndex < 0)
          return { ok: false, reason: "Both films must exist in the queue." };
        let beforeId =
          position === "after" ? target.id : ids[toIndex - 1] || null;
        let afterId =
          position === "after" ? ids[toIndex + 1] || null : target.id;
        await window.moveSupabaseCollectionItem(
          collection.id,
          from.id,
          rawItems,
          beforeId,
          afterId,
        );
        return { ok: true };
      },
      rerender: reload,
    });
    finishRenderTimer?.(
      `${collection.id}, ${watched.length} watched, ${queue.length} queue`,
    );
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    window.bindSupabaseEntityNoteEditor({
      container,
      entityKind: "collection",
      entityKey: collectionId,
      state: noteState,
      rerender: render,
    });
    try {
      let result = await window.loadSupabaseCollection(collectionId);
      if (!result) {
        render();
        return;
      }
      if (result.alreadyPromoted) {
        window.location.href = window.projectPageUrl(collectionId);
        return;
      }
      collection = result.collection;
      items = result.items;
      rawItems = result.rawItems;
      noteState.note = await window.loadSupabaseEntityNote(
        "collection",
        collection.id,
      );
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load this collection"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
