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
    if (record.status === "watchlist") {
      let item = record.item;
      let film = window.watchlistFilmLike(item);
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
        beforeTitleHtml: item.tier
          ? `<span class="watchlist-tier tier-${escape(item.tier.toLowerCase())}">${escape(item.tier)}</span>`
          : "",
        titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(item.supabaseFilmId))}">${escape(window.localizedFilmTitle?.(film) || item.title)}</a>`,
        bodyHtml: `<div class="watchlist-card-actions"><span>${escape(ui("Watchlist"))}</span></div>`,
      });
    }
    let film = record.film;
    let missingEditable = editable && record.status === "missing";
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
      bodyHtml:
        record.status === "missing"
          ? `<div class="leaderboard-meta">${escape(ui("Not in your collection yet"))}</div>`
          : "",
    });
  }

  function itemRow(record, index = 0, editable = false) {
    if (record.status === "watchlist") {
      let item = record.item;
      let film = window.watchlistFilmLike(item);
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
      return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", item.year))}">${escape(item.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape, href: window.filmPageUrl(item.supabaseFilmId) })}${window.renderRatingTierCell({ item }, { escape })}</tr>`;
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
    return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", film.year))}">${escape(film.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape })}${record.status === "missing" ? `<td>${escape(ui("Not in your collection yet"))}</td>` : window.renderRatingTierCell({ film }, { escape })}</tr>`;
  }

  function render() {
    if (!collection) {
      document.title = `${ui("Collection not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Collection not found"))}</h1><a href="collections.html">${escape(ui("Browse collections"))}</a></div>`;
      return;
    }
    document.title = `${collection.name} · The Oskars`;
    let finishRenderTimer = window.startOskarsPerformance?.("collection:render");
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

    container.innerHTML = `${window.renderBreadcrumbs([{ label: ui("Collections"), href: "collections.html" }, { label: collection.name }], { escape })}${window.renderDetailHeader(
      {
        mainHtml: `<h1>${escape(collection.name)}</h1><p>${collection.source_label ? escape(collection.source_label) : escape(ui("Custom collection"))}</p>`,
        actionsHtml: `<button type="button" class="sort-order-button" data-promote-collection${busy ? " disabled" : ""}>${escape(ui("Promote to project"))}</button>`,
      },
    )}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${watched.length}</b> ${escape(ui("Watched"))}</span><span><b>${queue.length}</b> ${escape(ui("Queue"))}</span><span><b>${total}</b> ${escape(ui("Total"))}</span><span><b>${percent}%</b> ${escape(ui("Complete"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape, ui })}` })}
    ${window.renderSupabaseEntityNote({ entityKind: "collection", entityKey: collection.id, note: noteState.note, editing: noteState.editing, busy: noteState.busy, label: ui("Collection note"), escape })}
    <div class="project-progress-meter project-progress-meter--detail" aria-label="${escape(ui("{percent} percent complete", { percent }))}"><span style="width:${escape(percent)}%"></span></div>
    <h2>${escape(ui("Queue"))}</h2>${toolbarHtml}${queueControls}${
      filmView === "grid"
        ? `<div class="film-grid project-film-grid">${queueCards || `<p>${escape(ui("No films"))}</p>`}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))} / ${escape(ui("Tier"))}</th></tr></thead><tbody>${queueRows || `<tr><td colspan="4">${escape(ui("No films"))}</td></tr>`}</tbody></table></div>`
    }
    ${watched.length ? `<h2>${escape(ui("Watched"))}</h2>${filmView === "grid" ? `<div class="film-grid project-film-grid">${watchedCards}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))}</th></tr></thead><tbody>${watchedRows}</tbody></table></div>`}` : ""}
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
    container
      .querySelector("[data-delete-collection-confirm]")
      ?.addEventListener("click", async () => {
        try {
          await window.deleteSupabaseCollection(collection.id);
          window.location.href = "collections.html";
        } catch (err) {
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
