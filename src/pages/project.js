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
      let filmId = item.supabaseFilmId || item.id;
      let displayTitle = window.localizedFilmTitle?.(film) || item.title;
      return window.renderSharedFilmCard(film, {
        classes: [
          "project-film-card",
          "watchlist-card",
          editable ? "watchlist-order-card" : "",
        ],
        attributes: window.orderEditItemAttributes({
          enabled: editable,
          scope: "queue",
          id: filmId,
          index,
          group: "queue",
        }),
        openFilm: false,
        showYear: true,
        escape,
        beforeTitleHtml: item.tier
          ? `<span class="watchlist-tier tier-${escape(item.tier.toLowerCase())}">${escape(item.tier)}</span>`
          : "",
        titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(filmId))}">${escape(displayTitle)}</a>`,
        bodyHtml: `<div class="watchlist-card-actions"><span>${escape(ui("Watchlist"))}</span></div>`,
        actionsHtml: window.renderCardRemoveButton({
          escape,
          title: ui("Remove from project"),
          attributes: {
            "data-remove-project-item": filmId,
            "aria-label": ui("Remove {title} from project", {
              title: displayTitle,
            }),
          },
        }),
      });
    }
    let film = record.film;
    let filmId = film.supabaseFilmId || film.id;
    let displayTitle = window.localizedFilmTitle?.(film) || film.title;
    let missingEditable = editable && record.status === "missing";
    let rewatchButtonHtml = "";
    if (record.status === "watched" || record.rewatch) {
      rewatchButtonHtml = window.renderCollectionActionButton({
        kind: "rewatch",
        label: ui(
          record.rewatch ? "Remove from rewatchlist" : "Want to rewatch",
        ),
        escape,
        active: Boolean(record.rewatch),
        attributes: record.rewatch
          ? { "data-project-film-unrewatch": filmId }
          : { "data-project-film-rewatch": filmId },
      });
    }
    let bodyHtml =
      record.status === "missing"
        ? `<div class="leaderboard-meta">${escape(ui("Not in your collection yet"))}</div>`
        : record.rewatch
          ? `<div class="watchlist-card-actions"><span class="watchlist-tier tier-rewatch">${escape(ui("Rewatch"))}</span>${rewatchButtonHtml}</div>`
          : `<div class="watchlist-card-actions">${rewatchButtonHtml}</div>`;
    return window.renderSharedFilmCard(film, {
      classes: [
        "project-film-card",
        missingEditable ? "watchlist-order-card" : "",
      ],
      attributes: window.orderEditItemAttributes({
        enabled: missingEditable,
        scope: "queue",
        id: filmId,
        index,
        group: "queue",
      }),
      showYear: true,
      escape,
      director: film.director,
      bodyHtml,
      actionsHtml: window.renderCardRemoveButton({
        escape,
        title: ui("Remove from project"),
        attributes: {
          "data-remove-project-item": filmId,
          "aria-label": ui("Remove {title} from project", {
            title: displayTitle,
          }),
        },
      }),
    });
  }

  function itemRow(
    record,
    index = 0,
    editable = false,
    showRewatchTier = false,
  ) {
    if (record.status === "watchlist") {
      let item = record.item;
      let film = window.watchlistFilmLike(item);
      let filmId = item.supabaseFilmId || item.id;
      let displayTitle = window.localizedFilmTitle?.(film) || item.title;
      let attributes = window.renderOrderEditItemAttributes(
        {
          enabled: editable,
          scope: "queue",
          id: filmId,
          index,
          group: "queue",
        },
        escape,
      );
      let removeButtonHtml = window.renderCardRemoveButton({
        escape,
        title: ui("Remove from project"),
        attributes: {
          "data-remove-project-item": filmId,
          "aria-label": ui("Remove {title} from project", {
            title: displayTitle,
          }),
        },
      });
      return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", item.year))}">${escape(item.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape, href: window.filmPageUrl(filmId) })}<td class="film-people-cell">${window.renderLinkedDirectors(film, { escape })}</td>${window.renderRatingTierCell({ item }, { escape })}<td class="project-manage-cell">${removeButtonHtml}</td></tr>`;
    }
    let film = record.film;
    let filmId = film.supabaseFilmId || film.id;
    let displayTitle = window.localizedFilmTitle?.(film) || film.title;
    let missingEditable = editable && record.status === "missing";
    let attributes = window.renderOrderEditItemAttributes(
      {
        enabled: missingEditable,
        scope: "queue",
        id: filmId,
        index,
        group: "queue",
      },
      escape,
    );
    let rewatchButtonHtml = "";
    if (record.status === "watched" || record.rewatch) {
      rewatchButtonHtml = window.renderCollectionActionButton({
        kind: "rewatch",
        label: ui(
          record.rewatch ? "Remove from rewatchlist" : "Want to rewatch",
        ),
        escape,
        active: Boolean(record.rewatch),
        attributes: record.rewatch
          ? { "data-project-film-unrewatch": filmId }
          : { "data-project-film-rewatch": filmId },
      });
    }
    let removeButtonHtml = window.renderCardRemoveButton({
      escape,
      title: ui("Remove from project"),
      attributes: {
        "data-remove-project-item": filmId,
        "aria-label": ui("Remove {title} from project", {
          title: displayTitle,
        }),
      },
    });
    let manageCellHtml = `<td class="project-manage-cell">${rewatchButtonHtml}${removeButtonHtml}</td>`;
    return `<tr${attributes}><td><a class="period-link" href="${escape(window.periodPageUrl("year", film.year))}">${escape(film.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape })}<td class="film-people-cell">${window.renderLinkedDirectors(film, { escape })}</td>${record.status === "missing" ? `<td>${escape(ui("Not in your collection yet"))}</td>` : window.renderRatingTierCell({ film }, { escape, showRewatchTier })}${manageCellHtml}</tr>`;
  }

  function render() {
    if (!project) {
      document.title = `${ui("Project not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Project not found"))}</h1><a href="projects.html">${escape(ui("Browse projects"))}</a></div>`;
      return;
    }
    document.title = `${project.name} · The Oskars`;
    let finishRenderTimer = window.startOskarsPerformance?.("project:render");
    let watched = items.filter(
      (record) => record.status === "watched" && !record.rewatch,
    );
    let queue = items
      .filter((record) => record.status !== "watched" || record.rewatch)
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

    let queueCards = queue
      .map((record, index) => itemCard(record, index, queueEditMode))
      .join("");
    let queueRows = queue
      .map((record, index) => itemRow(record, index, queueEditMode, true))
      .join("");
    let watchedCards = sortedWatched.map((record) => itemCard(record)).join("");
    let watchedRows = sortedWatched.map((record) => itemRow(record)).join("");

    let addFilmButton = `<button type="button" class="sort-order-button project-add-film-button" data-add-project-film${busy ? " disabled" : ""}>+ ${escape(ui("Add film"))}</button>`;
    let queueControls =
      queue.length > 1
        ? `<button type="button" class="sort-order-button${queueEditMode ? " is-active" : ""}" data-project-queue-edit-toggle${busy ? " disabled" : ""} title="${escape(ui("Drag to set this project's queue order."))}" aria-pressed="${queueEditMode ? "true" : "false"}">${escape(ui(queueEditMode ? "Finish order" : "Reorder"))}</button>`
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
    let pinButton = `<button type="button" class="sort-order-button${project.pinned ? " is-active" : ""}" data-pin-project${busy ? " disabled" : ""} aria-pressed="${project.pinned ? "true" : "false"}">${escape(ui(project.pinned ? "Unpin" : "Pin"))}</button>`;
    let deleteButton = `<button type="button" class="sort-order-button danger-button project-delete-pill" data-delete-project${busy ? " disabled" : ""}>${escape(ui("Delete project"))}</button>`;

    let controlBannerHtml = `<div class="project-control-banner">
      <div class="project-toolbar collection-film-toolbar detail-toolbar">
        <div class="detail-toolbar-controls">
          ${addFilmButton}
          ${sortAxisControl}
          ${window.renderChronologyControl({ order, href: projectViewUrl({ sort: reverseTargetSort, order: order === "asc" ? "desc" : "asc" }), escape, iconOnly: true })}
          ${window.renderShuffleControl({ href: projectViewUrl({ sort: "shuffle", seed: window.freshShuffleSeed() }), escape, label: ui("Shuffle") })}
          ${queueControls}
        </div>
        <div class="project-settings-bar">
          ${window.renderFilmViewToggle({ view: filmView, listUrl: projectViewUrl({ view: "list" }), gridUrl: projectViewUrl({ view: "grid" }), escape, ariaLabel: ui("Project display") })}
          ${pinButton}
          <div class="period-edit-controls project-status-controls" aria-label="${escape(ui("Project status"))}">${statusButtons}</div>
          ${deleteButton}
        </div>
      </div>
    </div>`;

    let upNextRecord = queue.length ? queue[0] : null;
    let upNextHtml = "";
    if (upNextRecord) {
      let nextFilm =
        upNextRecord.status === "watchlist"
          ? window.watchlistFilmLike(upNextRecord.item)
          : upNextRecord.film;
      let nextTitle = window.localizedFilmTitle?.(nextFilm) || nextFilm.title;
      let nextFilmUrl = window.filmPageUrl(
        nextFilm.supabaseFilmId || nextFilm.id,
      );
      let nextMetaParts = [];
      if (nextFilm.year) nextMetaParts.push(escape(nextFilm.year));
      if (upNextRecord.status === "watchlist" && upNextRecord.item?.tier) {
        nextMetaParts.push(escape(upNextRecord.item.tier));
      } else if (upNextRecord.rewatch) {
        nextMetaParts.push(escape(ui("Rewatch")));
      }
      let nextPosterHtml = window.renderFilmPoster
        ? window.renderFilmPoster(nextFilm, "thumb")
        : "";
      upNextHtml = `<aside class="project-up-next project-header-up-next" aria-label="${escape(ui("Up next"))}">
        <span class="eyebrow">${escape(ui("Up next"))}</span>
        <div class="project-up-next-compact">
          ${nextPosterHtml}
          <div class="project-up-next-compact-body">
            <a class="table-film-link" href="${escape(nextFilmUrl)}"><strong>${escape(nextTitle)}</strong></a>
            <div class="leaderboard-meta">${nextMetaParts.join(" · ")}</div>
          </div>
        </div>
      </aside>`;
    }

    let deckFilms = window.projectPosterDeckFilms
      ? window.projectPosterDeckFilms({
          watchlist: queue,
          watched: sortedWatched,
        })
      : [];
    let posterDeckHtml =
      deckFilms.length && window.renderPosterDeck
        ? `<div class="project-detail-poster">${window.renderPosterDeck(deckFilms)}</div>`
        : "";

    let queueEditNotice = queueEditMode
      ? `<div class="project-manage-mode"><span>${escape(ui("Drag to set this project's queue order."))}</span></div>`
      : "";

    container.innerHTML = `${window.renderBreadcrumbs([{ label: ui("Projects"), href: "projects.html" }, { label: project.name }], { escape })}${window.renderDetailHeader(
      {
        classes: "project-detail-header",
        leadingHtml: posterDeckHtml,
        mainHtml: `<h1>${escape(project.name)}</h1><p>${project.source_label ? escape(project.source_label) : escape(ui("Custom project"))} · <span class="project-status-badge">${escape(statusLabel)}</span></p>`,
        actionsHtml: upNextHtml,
      },
    )}
    ${window.renderDetailStats({ itemsHtml: `<span><b>${watched.length}</b> ${escape(ui("Watched"))}</span><span><b>${queue.length}</b> ${escape(ui("Queue"))}</span><span><b>${total}</b> ${escape(ui("Total"))}</span><span><b>${percent}%</b> ${escape(ui("Complete"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape, ui })}` })}
    ${window.renderSupabaseEntityNote({ entityKind: "project", entityKey: project.id, note: noteState.note, editing: noteState.editing, busy: noteState.busy, draft: noteState.draft, label: ui("Project note"), escape })}
    <div class="project-progress-meter project-progress-meter--detail" aria-label="${escape(ui("{percent} percent complete", { percent }))}"><span style="width:${escape(percent)}%"></span></div>
    ${controlBannerHtml}
    ${queueEditNotice}
    <h2>${escape(ui("Queue"))}</h2>${
      filmView === "grid"
        ? `<div class="film-grid project-film-grid">${queueCards || `<p>${escape(ui("No films"))}</p>`}</div>`
        : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))} / ${escape(ui("Tier"))}</th><th class="project-manage-cell" aria-label="${escape(ui("Manage"))}"></th></tr></thead><tbody>${queueRows || `<tr><td colspan="5">${escape(ui("No films"))}</td></tr>`}</tbody></table></div>`
    }
    ${watched.length ? `<h2>${escape(ui("Watched"))}</h2>${filmView === "grid" ? `<div class="film-grid project-film-grid">${watchedCards}</div>` : `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Year"))}</th><th>${escape(ui("Film"))}</th><th>${escape(ui("Director"))}</th><th>${escape(ui("Rating"))}</th><th class="project-manage-cell" aria-label="${escape(ui("Manage"))}"></th></tr></thead><tbody>${watchedRows}</tbody></table></div>`}` : ""}
    <dialog id="addProjectFilmDialog">
      <form method="dialog" data-add-project-film-form>
        <h2>${escape(ui("Add film"))}</h2>
        <label class="wide">${escape(ui("Search films"))}
          <input name="filmSearch" autocomplete="off" placeholder="${escape(ui("Start typing…"))}">
        </label>
        <p class="data-panel-status" data-add-project-film-status></p>
        <div class="dialog-actions"><button type="button" data-add-project-film-cancel>${escape(ui("Cancel"))}</button></div>
      </form>
    </dialog>
    <dialog id="deleteProjectDialog">
      <form method="dialog">
        <h2>${escape(ui("Delete this project?"))}</h2>
        <p>${escape(ui("This permanently removes the project. Films stay in your collection."))}</p>
        <div class="dialog-actions"><button type="button" data-delete-project-cancel>${escape(ui("Cancel"))}</button><button type="button" data-delete-project-confirm>${escape(ui("Delete"))}</button></div>
      </form>
    </dialog>`;

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
    let addDialog = container.querySelector("#addProjectFilmDialog");
    let addForm = container.querySelector("[data-add-project-film-form]");
    let addStatus = container.querySelector("[data-add-project-film-status]");
    let addSearchInput = addForm?.querySelector('[name="filmSearch"]');
    let projectFilmIds = new Set(
      items.map((record) => (record.film || record.item).supabaseFilmId),
    );
    container
      .querySelector("[data-add-project-film]")
      ?.addEventListener("click", () => {
        addForm?.reset();
        if (addStatus) addStatus.textContent = "";
        addDialog?.showModal();
        addSearchInput?.focus();
      });
    container
      .querySelector("[data-add-project-film-cancel]")
      ?.addEventListener("click", () => addDialog?.close());
    let addSearchTimer = null;
    addSearchInput?.addEventListener("input", () => {
      clearTimeout(addSearchTimer);
      let query = addSearchInput.value;
      addSearchTimer = setTimeout(async () => {
        if (!query.trim()) {
          if (addStatus) addStatus.innerHTML = "";
          return;
        }
        try {
          let results = await window.searchSupabaseFilmsByTitle(query);
          let available = results.filter(
            (film) => !projectFilmIds.has(film.id),
          );
          if (addStatus)
            addStatus.innerHTML = available
              .slice(0, 8)
              .map(
                (film) =>
                  `<button type="button" class="sort-order-button" data-add-project-film-id="${escape(film.id)}">${escape(film.title)} (${escape(film.year || "")})</button>`,
              )
              .join(" ");
        } catch (err) {
          if (addStatus) addStatus.textContent = err.message || String(err);
        }
      }, 250);
    });
    addStatus?.addEventListener("click", async (event) => {
      let button = event.target.closest("[data-add-project-film-id]");
      if (!button) return;
      addStatus.textContent = ui("Adding…");
      try {
        await window.addSupabaseCollectionItem(
          project.id,
          button.dataset.addProjectFilmId,
        );
        reload();
      } catch (err) {
        addStatus.textContent = err.message || String(err);
      }
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
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          let filmId = button.dataset.removeProjectItem;
          let rec = items.find(
            (r) =>
              (r.film || r.item).supabaseFilmId === filmId ||
              (r.film || r.item).id === filmId,
          );
          let title = (rec?.film || rec?.item)?.title;
          let confirmPrompt = title
            ? ui("Remove {title} from project?", { title })
            : ui("Remove film from project?");
          if (!confirm(confirmPrompt)) return;
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
    container
      .querySelectorAll("[data-project-film-rewatch]")
      .forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          let filmId = button.dataset.projectFilmRewatch;
          let rec = items.find(
            (r) =>
              (r.film || r.item).supabaseFilmId === filmId ||
              (r.film || r.item).id === filmId,
          );
          if (!rec) return;
          busy = true;
          rec.rewatch = true;
          if (rec.film) rec.film.wantToRewatch = true;
          render();
          try {
            await window.setSupabaseWatchedRewatch(filmId, true);
          } catch (err) {
            rec.rewatch = false;
            if (rec.film) delete rec.film.wantToRewatch;
            alert(err.message || String(err));
          } finally {
            busy = false;
            render();
          }
        });
      });
    container
      .querySelectorAll("[data-project-film-unrewatch]")
      .forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          let filmId = button.dataset.projectFilmUnrewatch;
          let rec = items.find(
            (r) =>
              (r.film || r.item).supabaseFilmId === filmId ||
              (r.film || r.item).id === filmId,
          );
          if (!rec) return;
          busy = true;
          rec.rewatch = false;
          if (rec.film) delete rec.film.wantToRewatch;
          render();
          try {
            await window.setSupabaseWatchedRewatch(filmId, false);
          } catch (err) {
            rec.rewatch = true;
            if (rec.film) rec.film.wantToRewatch = true;
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
    let deleteConfirmButton = container.querySelector(
      "[data-delete-project-confirm]",
    );
    deleteConfirmButton?.addEventListener("click", async () => {
      if (deleteConfirmButton.disabled) return;
      deleteConfirmButton.disabled = true;
      try {
        await window.deleteSupabaseCollection(project.id);
        window.location.href = "projects.html";
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
