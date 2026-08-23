/** @file Controls project detail, progress, notes, next-film guidance, sorting, pagination, and queue ordering. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  window.load();
  let container = document.getElementById("projectPage");
  let projectSortValues = new Set([
    "project",
    "title",
    "year",
    "rank",
    "rating",
    "tier",
    "wins",
    "nominations",
    "score",
    "shuffle",
  ]);
  let projectUrlState = window.createPageViewState({
    path: "project.html",
    schema: {
      id: { default: "", omit: () => false },
      sort: {
        default: "project",
        validate: (value) => projectSortValues.has(value),
      },
      order: {
        default: (state) => window.defaultOrderForProjectSort(state.sort),
        validate: (value) => value === "asc" || value === "desc",
        omit: (value, state) =>
          state.sort === "shuffle" ||
          value === window.defaultOrderForProjectSort(state.sort),
      },
      seed: {
        default: "",
        omit: (value, state) => state.sort !== "shuffle" || !value,
      },
      view: {
        default: "grid",
        validate: (value) => value === "grid" || value === "list",
      },
      tier: {
        default: "",
        parse: (value) => window.normalizeWatchlistTier?.(value) || "",
      },
      queuePage: {
        default: 1,
        parse: (value) => Math.max(1, Number(value) || 1),
      },
      watchedPage: {
        default: 1,
        parse: (value) => Math.max(1, Number(value) || 1),
      },
      edit: {
        default: "",
        validate: (value) => value === "" || value === "queue-order",
        omit: (value, state) =>
          state.sort !== "project" || value !== "queue-order",
      },
      manage: {
        default: "",
        validate: (value) => value === "" || value === "films",
      },
    },
  });
  let initialViewState = projectUrlState.read();
  let project = (state.projects || []).find(
    (item) => item.id === initialViewState.id,
  );
  let sort = initialViewState.sort;
  let order = initialViewState.order;
  let shuffleSeed =
    sort === "shuffle" ? initialViewState.seed || String(Date.now()) : "";
  let view = initialViewState.view;
  let queuePage = initialViewState.queuePage;
  let watchedPage = initialViewState.watchedPage;
  let pageSize = 50;
  let queueOrderEditMode =
    sort === "project" && initialViewState.edit === "queue-order";
  let manageFilms = initialViewState.manage === "films";
  let tierFilter = initialViewState.tier;

  try {
    function projectUrl(next = {}) {
      return projectUrlState.build(
        {
          id: project.id,
          sort,
          order,
          seed: shuffleSeed,
          view,
          tier: tierFilter,
          queuePage,
          watchedPage,
          edit: queueOrderEditMode ? "queue-order" : "",
          manage: manageFilms ? "films" : "",
        },
        next,
      );
    }

    function projectBadge(label, type) {
      return `<span class="project-status-badge project-status-badge--${escape(type)}">${escape(label)}</span>`;
    }

    function projectBadges(status, isActive) {
      return `<div class="project-status-badges project-status-badges--detail">${[
        project.pinned ? projectBadge(ui("Pinned"), "pinned") : "",
        projectBadge(
          isActive
            ? ui("Active")
            : status === "active"
              ? ui("Open")
              : ui(status === "complete" ? "Complete" : "Archived"),
          isActive ? "active" : status === "active" ? "open" : status,
        ),
      ]
        .filter(Boolean)
        .join("")}</div>`;
    }

    function projectFilmCard(record, options = {}) {
      let film = record.film;
      let isQueue = record.status === "watchlist" || record.rewatch;
      let title = window.localizedFilmTitle?.(film) || film.title;
      let directorHtml = window.renderLinkedDirectors(film, { escape });
      let queueTier = record.item?.tier ?? film.rewatchTier;
      let queueLabel = record.rewatch
        ? ui("Rewatch")
        : record.official
          ? ui("Oscar collection")
          : isQueue
            ? ui("Watchlist")
            : ui("Watched");
      return window.renderSharedFilmCard(film, {
        classes: [
          "project-film-card",
          isQueue ? "watchlist-card" : "",
          options.reorder ? "watchlist-order-card" : "",
        ],
        attributes: window.orderEditItemAttributes({
          enabled: options.reorder,
          scope: "project-queue",
          id: record.ref.id,
          type: record.ref.type,
          index: options.index || 0,
        }),
        openFilm: false,
        showYear: true,
        escape,
        titleHtml: `<a class="table-film-link" href="${escape(record.href)}">${escape(title)}</a>`,
        beforeTitleHtml:
          isQueue && queueTier
            ? window.renderWatchlistTierBadge(queueTier, { escape })
            : "",
        bodyHtml: `<div class="leaderboard-meta">${queueLabel}${directorHtml ? ` · ${directorHtml}` : ""}${film.allTimeRank ? ` · ${ui("all-time #{rank}", { rank: escape(film.allTimeRank) })}` : ""}</div>`,
        actionsHtml: options.manage
          ? window.renderCardRemoveButton({
              escape,
              title: ui("Remove {title}", { title }),
              attributes: {
                "data-remove-project-ref": record.ref.type,
                "data-remove-project-ref-id": record.ref.id,
              },
            })
          : "",
      });
    }

    function projectSection(
      title,
      records,
      pageState,
      pageAttribute,
      emptyText,
      options = {},
    ) {
      let visible = records.slice(pageState.sliceStart, pageState.sliceEnd);
      let reorder = Boolean(options.reorder);
      let orderControls = canEdit && options.canReorder
        ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-project-queue-order-edit-toggle>${escape(ui(queueOrderEditMode ? "Finish order" : "Reorder"))}</button>${queueOrderEditMode ? `<span>${escape(ui("Edits this project queue only."))}</span>` : ""}</div>`
        : "";
      let countText = escape(
        window.uiCount?.(records.length, "film", "films") ||
          `${records.length} ${records.length === 1 ? "film" : "films"}`,
      );
      let sectionBody = "";
      if (view === "list") {
        // Standard collection rows (issue #136): the queue section is
        // Order | Film | Tier and the watched section is Rank | Film |
        // Rating - Position keeps the section's own meaning (project order
        // vs all-time rank) and the director stays in Film metadata.
        let rows = visible
          .map((record, index) => {
            let film = record.film;
            let isQueue = record.status === "watchlist" || record.rewatch;
            let directorHtml = window.renderLinkedDirectors(film, { escape });
            let attributes = window.renderOrderEditItemAttributes(
              {
                enabled: reorder,
                scope: "project-queue",
                id: record.ref.id,
                type: record.ref.type,
                index,
              },
              escape,
            );
            let manageCell = manageFilms
              ? `<td class="project-manage-cell">${window.renderCardRemoveButton({
                  escape,
                  title: ui("Remove {title}", {
                    title: window.localizedFilmTitle?.(film) || film.title,
                  }),
                  attributes: {
                    "data-remove-project-ref": record.ref.type,
                    "data-remove-project-ref-id": record.ref.id,
                  },
                })}</td>`
              : "";
            return `<tr${attributes}><td class="leaderboard-position">${escape(isQueue ? record.ref?.projectOrder || "—" : film.allTimeRank || "—")}</td>${window.renderFilmIdentityCell(
              film,
              {
                escape,
                href: record.href,
                year: true,
                metaFragments: directorHtml ? [directorHtml] : [],
              },
            )}${window.renderRatingTierCell(
              isQueue ? { item: record.item } : { film },
              {
                escape,
                editHtml:
                  isQueue && !record.item
                    ? window.renderWatchlistTierBadge(film.rewatchTier, {
                        escape,
                      })
                    : "",
              },
            )}${manageCell}</tr>`;
          })
          .join("");
        sectionBody = `${orderControls}${window.renderPaginationControls({ total: records.length, page: pageState.page, pageSize, dataAttribute: pageAttribute, itemLabel: ui("films"), variant: "extended" })}<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(options.positionHeader || ui("Rank"))}</th><th>${escape(ui("Film"))}</th><th>${escape(options.valueHeader || ui("Rating"))}</th>${manageFilms ? `<th>${escape(ui("Manage"))}</th>` : ""}</tr></thead><tbody>${rows || `<tr><td colspan="${manageFilms ? 4 : 3}">${escape(emptyText)}</td></tr>`}</tbody></table></div>${window.renderPaginationControls({ total: records.length, page: pageState.page, pageSize, dataAttribute: pageAttribute, itemLabel: ui("films"), variant: "extended" })}`;
      } else {
        sectionBody = `${orderControls}${window.renderPaginationControls({ total: records.length, page: pageState.page, pageSize, dataAttribute: pageAttribute, itemLabel: ui("films"), variant: "extended" })}<div class="film-grid person-film-grid project-film-grid">${visible.map((record, index) => projectFilmCard(record, { reorder, index, manage: manageFilms })).join("") || `<p>${escape(emptyText)}</p>`}</div>${window.renderPaginationControls({ total: records.length, page: pageState.page, pageSize, dataAttribute: pageAttribute, itemLabel: ui("films"), variant: "extended" })}`;
      }
      if (options.collapsible) {
        return `<details class="project-film-section project-film-section--history" open><summary class="project-section-heading"><span class="project-section-title" role="heading" aria-level="2">${escape(title)}</span><span>${countText}</span></summary>${sectionBody}</details>`;
      }
      return `<section class="project-film-section"><div class="project-section-heading"><h2>${escape(title)}</h2><span>${countText}</span></div>${sectionBody}</section>`;
    }

    function missingRefSection(refs) {
      if (!refs?.length) return "";
      let rows = refs
        .map(
          (ref) =>
            `<tr><td>${escape(ref.type || "")}</td><td>${escape(ref.id || "")}</td><td><button type="button" data-remove-project-ref="${escape(ref.type || "")}" data-remove-project-ref-id="${escape(ref.id || "")}">${escape(ui("Remove"))}</button></td></tr>`,
        )
        .join("");
      return `<section class="project-missing-section"><div class="project-section-heading"><h2>${escape(ui("Missing references"))}</h2><span>${escape(refs.length)} ${escape(ui("unresolved"))}</span></div><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${escape(ui("Type"))}</th><th>${escape(ui("Reference"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }

    async function saveProjectActionAndReload(options = {}) {
      let saving = window.save?.(Object.assign({ immediate: true }, options));
      if (saving?.then) await saving;
      window.location.reload();
    }

    async function saveProjectAction(options = {}) {
      let saving = window.save?.(Object.assign({ immediate: true }, options));
      if (saving?.then) await saving;
    }

    function projectNextHtml(next) {
      if (!next) return "";
      let film = next.film;
      let title = window.localizedFilmTitle?.(film) || film.title;
      let directorHtml = window.renderLinkedDirectors(film, { escape });
      let tier = next.item?.tier ?? film.rewatchTier;
      let context = [
        film.year ? escape(film.year) : "",
        directorHtml,
        tier ? `${escape(ui("Tier"))} ${escape(tier)}` : "",
        next.rewatch ? escape(ui("Rewatch")) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<section class="project-next project-next--featured"><div class="project-next-poster">${window.renderFilmPoster(film, "card")}</div><div class="project-next-body"><p class="project-next-kicker">${escape(ui("Up next"))}</p><h2>${escape(title)}</h2>${context ? `<p>${context}</p>` : ""}<a class="button-link" href="${escape(next.href)}">${escape(ui("Open film"))}</a></div></section>`;
    }

    function deleteProjectDialogHtml() {
      return `<dialog id="deleteProjectDialog" class="project-delete-dialog"><form method="dialog"><h2>${escape(ui("Delete project?"))}</h2><p>${escape(ui('Delete "{name}" permanently?', { name: project.name }))}</p><p>${escape(ui("The project, its note, local order, and dismissed-film history will be removed. Films, ratings, awards, and watchlist entries will not be changed."))}</p><div class="dialog-actions"><button type="button" data-delete-project-cancel>${escape(ui("Cancel"))}</button><button type="button" class="danger-button" data-delete-project-confirm>${escape(ui("Delete project"))}</button></div></form></dialog>`;
    }

    function bindProjectControls() {
      container
        .querySelector("[data-project-sort]")
        ?.addEventListener("change", (event) => {
          queueOrderEditMode = false;
          window.location.href = window.prepareOskarsAccountNavigation(
            projectUrl({
              sort: event.target.value,
              order: window.defaultOrderForProjectSort(event.target.value),
              queuePage: 1,
              watchedPage: 1,
            }),
          );
        });
      container
        .querySelector("[data-project-queue-order-edit-toggle]")
        ?.addEventListener("click", () => {
          queueOrderEditMode = !queueOrderEditMode;
          window.location.href = window.prepareOskarsAccountNavigation(
            projectUrl({ sort: "project", queuePage: 1 }),
          );
        });
      container
        .querySelector("[data-project-manage-films]")
        ?.addEventListener("click", () => {
          manageFilms = !manageFilms;
          window.location.href = window.prepareOskarsAccountNavigation(
            projectUrl({ manage: manageFilms ? "films" : "" }),
          );
        });

      container
        .querySelectorAll("[data-project-queue-page]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            window.location.href = window.prepareOskarsAccountNavigation(
              projectUrl({
                queuePage: Number(button.dataset.projectQueuePage) || 1,
              }),
            );
          });
        });

      container
        .querySelectorAll("[data-project-watched-page]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            window.location.href = window.prepareOskarsAccountNavigation(
              projectUrl({
                watchedPage: Number(button.dataset.projectWatchedPage) || 1,
              }),
            );
          });
        });

      container
        .querySelector("[data-active-project]")
        ?.addEventListener("click", async (event) => {
          window.setActiveProject?.(event.currentTarget.dataset.activeProject, {
            save: false,
          });
          await saveProjectActionAndReload({ rebuild: false });
        });
      container
        .querySelector("[data-refresh-project]")
        ?.addEventListener("click", async (event) => {
          window.refreshProjectFromSource?.(
            event.currentTarget.dataset.refreshProject,
            { save: false },
          );
          await saveProjectActionAndReload();
        });
      container
        .querySelector("[data-project-tier-filter]")
        ?.addEventListener("change", (event) => {
          window.location.href = window.prepareOskarsAccountNavigation(
            projectUrl({ tier: event.target.value, queuePage: 1 }),
          );
        });
      container
        .querySelector("[data-restore-project-dismissed]")
        ?.addEventListener("click", async () => {
          window.clearProjectDismissedRefs?.(project.id, { save: false });
          window.refreshProjectFromSource?.(project.id, { save: false });
          await saveProjectActionAndReload();
        });
      container
        .querySelector("[data-pin-project]")
        ?.addEventListener("click", async (event) => {
          window.setProjectPinned?.(
            event.currentTarget.dataset.pinProject,
            !project.pinned,
            { save: false },
          );
          await saveProjectActionAndReload({ rebuild: false });
        });
      container.querySelectorAll("[data-project-status]").forEach((button) => {
        button.addEventListener("click", async () => {
          window.setProjectStatus?.(project.id, button.dataset.projectStatus, {
            save: false,
          });
          await saveProjectActionAndReload({ rebuild: false });
        });
      });
      container
        .querySelectorAll("[data-remove-project-ref]")
        .forEach((button) => {
          button.addEventListener("click", async () => {
            window.removeProjectFilmRef?.(
              project.id,
              button.dataset.removeProjectRef,
              button.dataset.removeProjectRefId,
              { save: false },
            );
            await saveProjectAction({ rebuild: false });
            renderProjectPage();
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
          if (!window.deleteProject?.(project.id, { save: false })) return;
          await saveProjectAction({ rebuild: false });
          window.location.href = window.prepareOskarsAccountNavigation(
            "projects.html",
          );
        });
    }

    function renderProjectPage() {
      let finishRenderTimer = window.startOskarsPerformance?.("project:render");

      if (!project) {
        document.title = `${ui("Project not found")} · The Oskars`;
        container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Project not found"))}</h1><a href="projects.html">${escape(ui("Browse projects"))}</a></div>`;
        finishRenderTimer?.("not found");
        return;
      }

      let progress = window.projectProgress(project);
      let records = window.sortProjectRecords(
        progress.records,
        sort,
        shuffleSeed,
        order,
      );
      // The queue also includes already-watched films marked for rewatch
      // (issue #180), alongside genuinely unwatched refs.
      let allQueueRecords = records.filter(
        (record) => record.status === "watchlist" || record.rewatch,
      );
      function queueRecordTier(record) {
        return window.normalizeWatchlistTier?.(
          record.item?.tier ?? record.film?.rewatchTier,
        );
      }
      // Queue tier filter (issue #11): narrow the unwatched queue to one interest
      // tier; the watched section is unaffected.
      let queueTiers = [
        ...new Set(allQueueRecords.map(queueRecordTier).filter(Boolean)),
      ].sort(
        (left, right) =>
          window.watchlistTierRank(left) - window.watchlistTierRank(right),
      );
      let queueRecords = tierFilter
        ? allQueueRecords.filter(
            (record) => queueRecordTier(record) === tierFilter,
          )
        : allQueueRecords;
      let watchedRecords = records.filter(
        (record) => record.status === "watched",
      );
      let queuePagination = window.paginationState(
        queueRecords.length,
        queuePage,
        pageSize,
      );
      let watchedPagination = window.paginationState(
        watchedRecords.length,
        watchedPage,
        pageSize,
      );
      queuePage = queuePagination.page;
      watchedPage = watchedPagination.page;
      let sourceHref = window.projectSourceHref(project);
      let isActiveProject = project.id === state.activeProjectId;
      let status = ["archived", "complete"].includes(project.status)
        ? project.status
        : "active";
      let next = status === "active" ? progress.next : null;
      let nextNotice =
        status === "complete"
          ? `<section class="project-next project-next--notice"><h2>${escape(ui("Closed"))}</h2><p>${escape(ui("This project is marked complete. Reopen it to put it back in the open queue."))}</p></section>`
          : status === "archived"
            ? `<section class="project-next project-next--notice"><h2>${escape(ui("Archived"))}</h2><p>${escape(ui("This project is paused and hidden from the default project hub."))}</p></section>`
            : "";
      let representativeFilm = window.projectRepresentativeFilm?.(progress);
      let representativePoster = representativeFilm
        ? window.renderFilmPoster(representativeFilm, "detail")
        : "";
      let dismissedCount = project.dismissedRefs?.length || 0;
      let dismissedNotice = dismissedCount
        ? `<p class="project-dismissed-note">${escape(ui("{count} removed film(s) stay out when refreshing from source.", { count: dismissedCount }))} <button type="button" class="button-link" data-restore-project-dismissed>${escape(ui("Restore removed films"))}</button></p>`
        : "";
      let tierFilterControl =
        queueTiers.length > 1 || tierFilter
          ? `<label class="project-tier-filter">${escape(ui("Queue tier"))} <select data-project-tier-filter><option value="">${escape(ui("All tiers"))}</option>${queueTiers.map((tier) => `<option value="${escape(tier)}"${tier === tierFilter ? " selected" : ""}>${escape(tier)}</option>`).join("")}${tierFilter && !queueTiers.includes(tierFilter) ? `<option value="${escape(tierFilter)}" selected>${escape(tierFilter)}</option>` : ""}</select></label>`
          : "";
      let statusActionHtml = [
        project.sourceType && project.sourceId
          ? `<button type="button" class="button-link" data-refresh-project="${escape(project.id)}">${escape(ui("Refresh from source"))}</button>`
          : "",
        `<button type="button" class="button-link" data-pin-project="${escape(project.id)}">${escape(project.pinned ? ui("Unpin") : ui("Pin"))}</button>`,
        status === "archived"
          ? `<button type="button" class="button-link" data-project-status="active">${escape(ui("Unarchive"))}</button>`
          : `<button type="button" class="button-link" data-project-status="archived">${escape(ui("Archive"))}</button>`,
        status === "complete"
          ? `<button type="button" class="button-link" data-project-status="active">${escape(ui("Reopen"))}</button>`
          : `<button type="button" class="button-link" data-project-status="complete">${escape(ui("Close as complete"))}</button>`,
      ]
        .filter(Boolean)
        .join("");
      let progressSummary = `<div class="project-journey-progress"><div class="project-journey-progress-copy"><strong>${escape(progress.percent)}%</strong><span>${escape(progress.watchedCount)}/${escape(progress.total)} ${escape(ui("watched"))} · ${escape(progress.watchlistCount)} ${escape(ui("queued"))}</span></div><div class="project-progress-meter project-progress-meter--detail" aria-label="${escape(ui("{percent} percent complete", { percent: progress.percent }))}"><span style="width:${escape(progress.percent)}%"></span></div></div>`;
      let manageModeNotice = manageFilms
        ? `<div class="project-manage-mode"><span>${escape(ui("Film management is on. Remove controls are visible."))}</span><button type="button" class="button-link" data-project-manage-films>${escape(ui("Finish managing"))}</button></div>`
        : "";
      let projectManagementHtml = canEdit
        ? `<details class="project-management"${manageFilms ? " open" : ""}><summary><span class="project-section-title" role="heading" aria-level="2">${escape(ui("Project management"))}</span><span>${escape(ui("Refresh, lifecycle, films, and deletion"))}</span></summary><div class="project-management-body"><div class="project-management-actions">${statusActionHtml}<button type="button" class="button-link" data-project-manage-films>${escape(ui(manageFilms ? "Finish managing films" : "Manage films"))}</button><button type="button" class="danger-button" data-delete-project>${escape(ui("Delete project"))}</button></div>${dismissedNotice}${missingRefSection(progress.missingRefs)}</div></details>`
        : "";
      document.title = `${project.name} · The Oskars`;
      container.innerHTML = `${window.renderBreadcrumbs(
        [
          { label: ui("Projects"), href: "projects.html" },
          { label: project.name },
        ],
        { escape },
      )}
  ${window.renderDetailHeader({ classes: "project-detail-header", leadingHtml: representativePoster ? `<div class="project-detail-poster">${representativePoster}</div>` : "", mainHtml: `<h1>${escape(project.name)}</h1><p>${sourceHref ? `<a href="${escape(sourceHref)}">${escape(project.sourceLabel || project.sourceId)}</a>` : escape(project.sourceLabel || "")}</p>${projectBadges(status, isActiveProject)}${progressSummary}`, actionsHtml: isActiveProject ? "" : `<button type="button" class="button-link" data-active-project="${escape(project.id)}">${escape(ui("Make active"))}</button>` })}
  ${window.renderDetailStats({ classes: "project-stats project-rating-stats", itemsHtml: window.renderRatingStatisticsItems(progress.ratingStatistics, { escape, ui }) })}
  ${window.renderEntityNote("projects", project.id, ui("Project note"))}
  ${projectNextHtml(next)}
  ${nextNotice}
  ${manageModeNotice}
  <div class="detail-toolbar"><div class="detail-toolbar-controls">${window.renderSortAxisControl(
    {
      escape,
      value: sort === "shuffle" ? "" : sort,
      attribute: "data-project-sort",
      axes: [
        { value: "project", label: "Project order" },
        { value: "title", label: "Title" },
        { value: "tier", label: "Watchlist tier" },
        { value: "year", label: "Release year" },
        { value: "rank", label: "All-time rank" },
        { value: "rating", label: "Rating" },
        { value: "wins", label: "Wins" },
        { value: "nominations", label: "Nominations" },
        { value: "score", label: "Score" },
      ],
    },
  )}${window.renderChronologyControl({ order, href: projectUrl({ sort: sort === "shuffle" ? "project" : sort, order: order === "asc" ? "desc" : "asc", queuePage: 1, watchedPage: 1 }), escape, iconOnly: true, title: ui("Reverse current order") })}${window.renderShuffleControl({ href: projectUrl({ sort: "shuffle", seed: window.freshShuffleSeed(), queuePage: 1, watchedPage: 1 }), escape, label: ui("Shuffle") })}${tierFilterControl}</div>${window.renderFilmViewToggle(
    {
      view,
      listUrl: projectUrl({ view: "list", queuePage: 1, watchedPage: 1 }),
      gridUrl: projectUrl({ view: "grid", queuePage: 1, watchedPage: 1 }),
      escape,
      classes: "project-film-view-toggle",
      ariaLabel: ui("Project film display"),
    },
  )}</div>
  ${projectSection(ui("Queue"), queueRecords, queuePagination, "data-project-queue-page", tierFilter ? ui("No queued films in this tier.") : ui("No unwatched or rewatch-marked films in this project."), { canReorder: sort === "project" && !tierFilter && queueRecords.length > 1, reorder: queueOrderEditMode, positionHeader: ui("Order"), valueHeader: ui("Tier") })}
  ${projectSection(ui("Watched"), watchedRecords, watchedPagination, "data-project-watched-page", ui("No watched films in this project yet."), { positionHeader: ui("Rank"), valueHeader: ui("Rating"), collapsible: true })}
  ${projectManagementHtml}
  ${deleteProjectDialogHtml()}`;

      bindProjectControls();
      finishRenderTimer?.(
        `${queueRecords.length} queue, ${watchedRecords.length} watched`,
      );
    }

    window.createOrderEditController({
      container,
      scope: "project-queue",
      enabled: () => queueOrderEditMode,
      commit: (from, target, position) =>
        window.moveProjectQueueRef?.(
          project.id,
          from.type,
          from.id,
          target.type,
          target.id,
          position,
          { save: false },
        ),
      rerender: async () => {
        await saveProjectAction({ rebuild: false });
        renderProjectPage();
      },
    });
    renderProjectPage();
    window.bindEntityNoteEditor(container);
  } catch (err) {
    let finishErrorRenderTimer =
      window.startOskarsPerformance?.("project:render");
    console.error("Failed to render project page", err);
    document.title = `${ui("Project error")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Could not load project"))}</h1><p>${escape(err?.message || String(err))}</p><a href="projects.html">${escape(ui("Browse projects"))}</a></div>`;
    finishErrorRenderTimer?.("error");
  }
})();
