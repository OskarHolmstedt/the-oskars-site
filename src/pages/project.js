/**
 * @file Controls the Supabase-backed project detail (issue #439): a
 * generic named film collection, "created in any which way" rather than
 * tied to a live-refreshable source the way the previous model's
 * person/franchise/tag/watchlist-filter/watch-goal/official-results
 * source types were - source_label is purely descriptive text captured
 * once at creation, never re-derived. Core v1 scope only: view, sort,
 * queue drag-and-drop reorder, status/pin, remove an item, and permanent
 * delete. Deliberately deferred, not silently dropped: refresh-from-
 * source (there is no live source link to refresh from in this model),
 * dismissed-ref tracking (follows from the same), tier filtering, and
 * pagination - all real, flagged reductions from the original's fuller
 * management UI, matching every other #439 cutover's precedent.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("projectPage");

  let projectId = window.pageQueryParam("id");
  let project = null;
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

  function projectViewUrl(next = {}) {
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
    return `${window.projectPageUrl(projectId)}${parts.length ? `&${parts.join("&")}` : ""}`;
  }

  function reload() {
    window.location.href = projectViewUrl();
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
    if (!project) {
      document.title = `${ui("Project not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Project not found"))}</h1><a href="projects.html">${escape(ui("Browse projects"))}</a></div>`;
      return;
    }
    document.title = `${project.name} · The Oskars`;
    let finishRenderTimer = window.startOskarsPerformance?.("project:render");
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
      attribute: "data-project-sort",
      axes: [
        { value: "year", label: "Release year" },
        { value: "title", label: "Title" },
        { value: "rating", label: "Rating" },
      ],
    });
    let reverseTargetSort = sort === "shuffle" ? "year" : sort;
    let toolbarHtml = `<div class="project-toolbar collection-film-toolbar detail-toolbar"><div class="detail-toolbar-controls">${sortAxisControl}${window.renderChronologyControl({ order, href: projectViewUrl({ sort: reverseTargetSort, order: order === "asc" ? "desc" : "asc" }), escape, iconOnly: true })}${window.renderShuffleControl({ href: projectViewUrl({ sort: "shuffle", seed: window.freshShuffleSeed() }), escape, label: ui("Shuffle") })}</div>${window.renderFilmViewToggle({ view: filmView, listUrl: projectViewUrl({ view: "list" }), gridUrl: projectViewUrl({ view: "grid" }), escape, ariaLabel: ui("Project display") })}</div>`;

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
        ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-project-queue-edit-toggle${busy ? " disabled" : ""}>${escape(ui(queueEditMode ? "Finish order" : "Reorder"))}</button>${queueEditMode ? `<span>${escape(ui("Drag to set this project's queue order."))}</span>` : ""}</div>`
        : "";
    let statusLabel =
      project.status === "complete"
        ? ui("Complete")
        : project.status === "archived"
          ? ui("Archived")
          : ui("Active");
    let statusButtons = ["active", "complete", "archived"]
      .map(
        (value) =>
          `<button type="button" class="sort-order-button${project.status === value ? " is-active" : ""}" data-project-status="${escape(value)}"${busy ? " disabled" : ""}>${escape(ui(value === "active" ? "Active" : value === "complete" ? "Complete" : "Archived"))}</button>`,
      )
      .join("");

    container.innerHTML = `${window.renderBreadcrumbs([{ label: ui("Projects"), href: "projects.html" }, { label: project.name }], { escape })}${window.renderDetailHeader(
      {
        mainHtml: `<h1>${escape(project.name)}</h1><p>${project.source_label ? escape(project.source_label) : escape(ui("Custom project"))} · <span class="project-status-badge">${escape(statusLabel)}</span></p>`,
        actionsHtml: `<button type="button" class="sort-order-button" data-pin-project${busy ? " disabled" : ""}>${escape(ui(project.pinned ? "Unpin" : "Pin"))}</button>`,
      },
    )}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${watched.length}</b> ${escape(ui("Watched"))}</span><span><b>${queue.length}</b> ${escape(ui("Queue"))}</span><span><b>${total}</b> ${escape(ui("Total"))}</span><span><b>${percent}%</b> ${escape(ui("Complete"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape, ui })}` })}
    ${window.renderSupabaseEntityNote({ entityKind: "project", entityKey: project.id, note: noteState.note, editing: noteState.editing, busy: noteState.busy, label: ui("Project note"), escape })}
    <div class="project-progress-meter project-progress-meter--detail" aria-label="${escape(ui("{percent} percent complete", { percent }))}"><span style="width:${escape(percent)}%"></span></div>
    <div class="period-edit-controls">${statusButtons}</div>
    <h2>${escape(ui("Queue"))}</h2>${toolbarHtml}${queueControls}${
      filmView === "grid"
        ? `<div class="film-grid project-film-grid">${queueCards || `<p>${escape(ui("No films"))}</p>`}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))} / ${escape(ui("Tier"))}</th></tr></thead><tbody>${queueRows || `<tr><td colspan="4">${escape(ui("No films"))}</td></tr>`}</tbody></table></div>`
    }
    ${watched.length ? `<h2>${escape(ui("Watched"))}</h2>${filmView === "grid" ? `<div class="film-grid project-film-grid">${watchedCards}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))}</th></tr></thead><tbody>${watchedRows}</tbody></table></div>`}` : ""}
    <section class="project-manage" data-project-manage>
      <h2>${escape(ui("Manage"))}</h2>
      <ul class="project-manage-list">${items
        .map(
          (record) =>
            `<li>${escape((record.film || record.item).title)} <button type="button" class="sort-order-button" data-remove-project-item="${escape((record.film || record.item).supabaseFilmId)}"${busy ? " disabled" : ""}>${escape(ui("Remove"))}</button></li>`,
        )
        .join("")}</ul>
      <button type="button" class="sort-order-button" data-delete-project${busy ? " disabled" : ""}>${escape(ui("Delete project"))}</button>
      <dialog id="deleteProjectDialog">
        <form method="dialog">
          <h2>${escape(ui("Delete this project?"))}</h2>
          <p>${escape(ui("This permanently removes the project. Films stay in your collection."))}</p>
          <div class="dialog-actions"><button type="button" data-delete-project-cancel>${escape(ui("Cancel"))}</button><button type="button" data-delete-project-confirm>${escape(ui("Delete"))}</button></div>
        </form>
      </dialog>
    </section>`;

    container
      .querySelector("[data-project-sort]")
      ?.addEventListener("change", (event) => {
        window.location.href = projectViewUrl({
          sort: event.target.value,
          order: window.defaultOrderForFilmAxis(event.target.value),
        });
      });
    container
      .querySelector("[data-project-queue-edit-toggle]")
      ?.addEventListener("click", () => {
        queueEditMode = !queueEditMode;
        window.location.href = projectViewUrl();
      });
    container
      .querySelector("[data-pin-project]")
      ?.addEventListener("click", async () => {
        busy = true;
        render();
        try {
          await window.setSupabaseProjectPinned(project.id, !project.pinned);
          project.pinned = !project.pinned;
        } catch (err) {
          alert(err.message || String(err));
        } finally {
          busy = false;
          render();
        }
      });
    container.querySelectorAll("[data-project-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        let status = button.dataset.projectStatus;
        busy = true;
        render();
        try {
          await window.setSupabaseProjectStatus(project.id, status);
          project.status = status;
        } catch (err) {
          alert(err.message || String(err));
        } finally {
          busy = false;
          render();
        }
      });
    });
    container
      .querySelectorAll("[data-remove-project-item]")
      .forEach((button) => {
        button.addEventListener("click", async () => {
          let filmId = button.dataset.removeProjectItem;
          busy = true;
          render();
          try {
            await window.removeSupabaseCollectionItem(project.id, filmId);
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
    let deleteDialog = container.querySelector("#deleteProjectDialog");
    container
      .querySelector("[data-delete-project]")
      ?.addEventListener("click", () => deleteDialog?.showModal());
    container
      .querySelector("[data-delete-project-cancel]")
      ?.addEventListener("click", () => deleteDialog?.close());
    container
      .querySelector("[data-delete-project-confirm]")
      ?.addEventListener("click", async () => {
        try {
          await window.deleteSupabaseCollection(project.id);
          window.location.href = "projects.html";
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
          project.id,
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
      `${project.id}, ${watched.length} watched, ${queue.length} queue`,
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
      entityKind: "project",
      entityKey: projectId,
      state: noteState,
      rerender: render,
    });
    try {
      let result = await window.loadSupabaseProject(projectId);
      if (!result) {
        render();
        return;
      }
      project = result.project;
      items = result.items;
      rawItems = result.rawItems;
      noteState.note = await window.loadSupabaseEntityNote(
        "project",
        project.id,
      );
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load this project"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
