/** @file Controls the project hub, status views, progress cards, and project creation dialog. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let finishRenderTimer = window.startOskarsPerformance?.("projects:render");
  let container = document.getElementById("projectsPage");
  let allProjects = [...(state.projects || [])];
  let validViews = ["open", "pinned", "active", "complete", "archived", "all"];
  let view = validViews.includes(window.pageQueryParam("view"))
    ? window.pageQueryParam("view")
    : "open";
  let projects = allProjects
    .filter((project) => {
      let status = ["archived", "complete"].includes(project.status)
        ? project.status
        : "active";
      if (view === "all") return true;
      if (view === "open") return status === "active";
      if (view === "pinned") return Boolean(project.pinned);
      if (view === "active") return project.id === state.activeProjectId;
      return status === view;
    })
    .sort(
      (left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
        Number(right.id === state.activeProjectId) -
          Number(left.id === state.activeProjectId) ||
        String(right.updatedAt || right.createdAt || "").localeCompare(
          String(left.updatedAt || left.createdAt || ""),
        ) ||
        String(left.name || "").localeCompare(String(right.name || "")),
    );
  document.title = `${ui("Projects")} · The Oskars`;

  function projectViewUrl(nextView) {
    return nextView === "open"
      ? "projects.html"
      : `projects.html?view=${encodeURIComponent(nextView)}`;
  }

  function projectStatus(project) {
    return ["archived", "complete"].includes(project.status)
      ? project.status
      : "active";
  }

  function projectCounts() {
    return {
      open: allProjects.filter((project) => projectStatus(project) === "active")
        .length,
      pinned: allProjects.filter((project) => project.pinned).length,
      active: allProjects.filter(
        (project) => project.id === state.activeProjectId,
      ).length,
      complete: allProjects.filter(
        (project) => projectStatus(project) === "complete",
      ).length,
      archived: allProjects.filter(
        (project) => projectStatus(project) === "archived",
      ).length,
      all: allProjects.length,
    };
  }

  function viewLink(value, label, count) {
    let text = `${ui(label)} ${count}`;
    return value === view
      ? `<strong>${escape(text)}</strong>`
      : `<a href="${escape(projectViewUrl(value))}">${escape(text)}</a>`;
  }

  function projectBadge(label, type) {
    return `<span class="project-status-badge project-status-badge--${escape(type)}">${escape(label)}</span>`;
  }

  function projectBadges(project, status, isActive) {
    return `<div class="project-status-badges">${[
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

  function projectCardDeck(progress) {
    let films = window.projectPosterDeckFilms(progress);
    return films.length
      ? `<div class="project-card-visual">${window.renderPosterDeck(films, { classes: "project-card-poster-deck" })}</div>`
      : "";
  }

  function projectCard(project) {
    let progress = window.projectProgress(project);
    let status = projectStatus(project);
    let next = status === "active" ? progress.next : null;
    let sourceHref = window.projectSourceHref(project);
    let isActive = project.id === state.activeProjectId;
    let nextTitle = next
      ? window.localizedFilmTitle?.(next.film) || next.film.title
      : "";
    let nextHtml = next
      ? `<p class="leaderboard-meta">${escape(ui("Next"))}: <a href="${escape(next.href)}">${escape(nextTitle)}</a>${next.film.year ? ` (${escape(next.film.year)})` : ""}${next.item?.tier ? ` · ${escape(ui("Tier"))} ${escape(next.item.tier)}` : ""}</p>`
      : status === "complete"
        ? `<p class="leaderboard-meta">${escape(ui("Closed as complete."))}</p>`
        : status === "archived"
          ? `<p class="leaderboard-meta">${escape(ui("Archived."))}</p>`
          : `<p class="leaderboard-meta">${escape(ui("No unwatched films left."))}</p>`;
    return `<article class="project-card project-card--deck">
    ${projectCardDeck(progress)}
    <div class="project-card-body">
    <header><h2><a href="${escape(window.projectPageUrl(project.id))}">${escape(project.name)}</a></h2>${projectBadges(project, status, isActive)}</header>
    <div class="project-progress-meter" aria-label="${escape(ui("{percent} percent complete", { percent: progress.percent }))}"><span style="width:${escape(progress.percent)}%"></span></div>
    <dl class="project-card-stats"><div><dt>${escape(ui("Watched"))}</dt><dd>${escape(progress.watchedCount)}/${escape(progress.total)}</dd></div><div><dt>Watchlist</dt><dd>${escape(progress.watchlistCount)}</dd></div><div><dt>${escape(ui("Complete"))}</dt><dd>${escape(progress.percent)}%</dd></div><div><dt>${escape(ui("Average rating"))}</dt><dd>${escape(window.formatAverageRating(progress.ratingStatistics.mean))}</dd></div><div><dt>${escape(ui("Rated"))}</dt><dd>${escape(progress.ratingStatistics.ratedCount)}</dd></div></dl>
    <p>${sourceHref ? `<a href="${escape(sourceHref)}">${escape(project.sourceLabel || project.sourceId)}</a>` : escape(project.sourceLabel || "")}</p>
    ${nextHtml}
    <div class="project-card-actions">${isActive ? "" : `<button type="button" class="button-link" data-active-project="${escape(project.id)}">${escape(ui("Make active"))}</button>`}<button type="button" class="button-link" data-pin-project="${escape(project.id)}">${escape(project.pinned ? ui("Unpin") : ui("Pin"))}</button></div>
    </div>
  </article>`;
  }

  async function saveProjectHubActionAndReload() {
    let saving = window.save?.({ immediate: true, rebuild: false });
    if (saving?.then) await saving;
    window.location.reload();
  }

  let counts = projectCounts();
  let emptyCopy = allProjects.length
    ? `<div class="detail-empty"><h2>${escape(ui("No {view} projects", { view: ui(view === "open" ? "Open" : view === "all" ? "All" : view === "active" ? "Active" : view === "complete" ? "Complete" : view === "archived" ? "Archived" : "Pinned").toLowerCase() }))}</h2><p>${escape(ui("Try another project filter."))}</p></div>`
    : `<div class="detail-empty"><h2>${escape(ui("No projects yet"))}</h2><p>${escape(ui("Start one from a director or franchise page."))}</p></div>`;

  function createProjectDialogHtml() {
    return `<dialog id="createProjectDialog">
    <form id="createProjectForm" method="dialog">
      <h2>${escape(ui("Create project"))}</h2>
      <div class="form-grid">
        <label>${escape(ui("Source"))}
          <select name="sourceType" data-create-project-type>
            <option value="franchise">${escape(ui("Franchise"))}</option>
            <option value="person">${escape(ui("Person"))}</option>
            <option value="tag">${escape(ui("Tag"))}</option>
            <option value="custom">${escape(ui("Custom films"))}</option>
          </select>
        </label>
        <label data-create-project-source-row>${escape(ui("Name"))}
          <input name="sourceName" list="createProjectSourceOptions" autocomplete="off" placeholder="${escape(ui("Start typing…"))}">
          <datalist id="createProjectSourceOptions"></datalist>
        </label>
        <label class="wide" data-create-project-name-row hidden>${escape(ui("Project name"))}
          <input name="projectName" autocomplete="off">
        </label>
        <label class="wide" data-create-project-film-row hidden>${escape(ui("Add film"))}
          <input name="filmName" list="createProjectFilmOptions" autocomplete="off" placeholder="${escape(ui("Start typing…"))}">
          <datalist id="createProjectFilmOptions"></datalist>
        </label>
        <div class="wide" data-create-project-film-list hidden></div>
      </div>
      <p class="data-panel-status" data-create-project-status></p>
      <div class="dialog-actions"><button type="button" data-create-project-cancel>${escape(ui("Cancel"))}</button><button type="submit">${escape(ui("Create project"))}</button></div>
    </form>
  </dialog>`;
  }

  container.innerHTML = `${window.renderBreadcrumbs([{ label: ui("Projects") }], { escape })}
  ${window.renderDetailHeader({ mainHtml: `<h1>${escape(ui("Projects"))}</h1><p>${escape(ui("Focused watch queues from directors, franchises, and watchlist filters."))}</p>`, actionsHtml: `<button type="button" class="button-link" data-create-project>${escape(ui("Create project"))}</button>` })}
  <nav class="person-filmography-sort-controls project-view-controls" aria-label="${escape(ui("Project view"))}"><span>${escape(ui("View"))}</span>${viewLink("open", "Open", counts.open)}${viewLink("pinned", "Pinned", counts.pinned)}${viewLink("active", "Active", counts.active)}${viewLink("complete", "Complete", counts.complete)}${viewLink("archived", "Archived", counts.archived)}${viewLink("all", "All", counts.all)}</nav>
  ${projects.length ? `<div class="project-grid">${projects.map(projectCard).join("")}</div>` : emptyCopy}
  ${createProjectDialogHtml()}`;

  container.querySelectorAll("[data-active-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      window.setActiveProject?.(button.dataset.activeProject, { save: false });
      await saveProjectHubActionAndReload();
    });
  });
  container.querySelectorAll("[data-pin-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      let project = window.findProjectById?.(button.dataset.pinProject);
      window.setProjectPinned?.(button.dataset.pinProject, !project?.pinned, {
        save: false,
      });
      await saveProjectHubActionAndReload();
    });
  });

  // --- Create project dialog ---
  let createDialog = container.querySelector("#createProjectDialog");
  let createForm = container.querySelector("#createProjectForm");
  let pickedFilms = [];

  function createProjectSources(type) {
    if (type === "franchise") {
      return Object.values(
        window.ensureFranchiseIndex?.() || state.franchisesById || {},
      ).map((franchise) => ({ label: franchise.name, id: franchise.id }));
    }
    if (type === "person") {
      return Object.values(
        window.ensurePeopleIndex?.() || state.peopleById || {},
      ).map((person) => ({ label: person.name, id: person.id }));
    }
    if (type === "tag") {
      return (window.getFilmTagIndex?.() || []).map((tag) => ({
        label: tag.name,
        id: tag.name,
      }));
    }
    return [];
  }

  function createProjectFilmOptions() {
    return window
      .buildSearchEntries({ cacheKeySuffix: "project-film-picker" })
      .filter(
        (entry) =>
          entry.target?.type === "film" || entry.target?.type === "watchlist",
      )
      .map((entry) => ({
        label: `${entry.name} (${entry.year || "?"})${entry.target.type === "watchlist" ? " · Watchlist" : ""}`,
        ref: window.projectFilmRef(
          entry.target.type === "film" ? "archive" : "watchlist",
          entry.target.id,
        ),
      }));
  }

  let sourceLookup = new Map();
  let filmLookup = new Map();

  function fillCreateProjectOptions() {
    let type = createForm.querySelector("[data-create-project-type]").value;
    let sourceList = createForm.querySelector("#createProjectSourceOptions");
    sourceLookup = new Map();
    sourceList.innerHTML = createProjectSources(type)
      .map((entry) => {
        sourceLookup.set(window.normalizeSearchText(entry.label), entry.id);
        return `<option value="${escape(entry.label)}"></option>`;
      })
      .join("");
    let filmList = createForm.querySelector("#createProjectFilmOptions");
    if (type === "custom" && !filmLookup.size) {
      filmLookup = new Map();
      filmList.innerHTML = createProjectFilmOptions()
        .map((entry) => {
          filmLookup.set(window.normalizeSearchText(entry.label), entry.ref);
          return `<option value="${escape(entry.label)}"></option>`;
        })
        .join("");
    }
  }

  function renderPickedFilms() {
    let list = createForm.querySelector("[data-create-project-film-list]");
    list.innerHTML = pickedFilms.length
      ? pickedFilms
          .map(
            (entry, index) =>
              `<div class="create-project-picked"><span>${escape(entry.label)}</span><button type="button" data-remove-picked-film="${index}" aria-label="${escape(ui("Remove"))}">×</button></div>`,
          )
          .join("")
      : `<p class="leaderboard-meta">${escape(ui("No films added yet."))}</p>`;
  }

  function updateCreateProjectMode() {
    let type = createForm.querySelector("[data-create-project-type]").value;
    let custom = type === "custom";
    createForm.querySelector("[data-create-project-source-row]").hidden =
      custom;
    createForm.querySelector("[data-create-project-name-row]").hidden = !custom;
    createForm.querySelector("[data-create-project-film-row]").hidden = !custom;
    createForm.querySelector("[data-create-project-film-list]").hidden =
      !custom;
    createForm.querySelector("[data-create-project-status]").textContent = "";
    fillCreateProjectOptions();
    if (custom) renderPickedFilms();
  }

  function setCreateProjectStatus(message) {
    createForm.querySelector("[data-create-project-status]").textContent =
      message;
  }

  function addPickedFilm() {
    let input = createForm.querySelector('[name="filmName"]');
    let ref = filmLookup.get(window.normalizeSearchText(input.value));
    if (!ref) {
      setCreateProjectStatus(ui("Pick a film from the suggestions."));
      return;
    }
    if (
      !pickedFilms.some(
        (entry) => entry.ref.type === ref.type && entry.ref.id === ref.id,
      )
    ) {
      pickedFilms.push({ label: input.value.trim(), ref });
    }
    input.value = "";
    setCreateProjectStatus("");
    renderPickedFilms();
  }

  container
    .querySelector("[data-create-project]")
    ?.addEventListener("click", () => {
      pickedFilms = [];
      createForm.reset();
      updateCreateProjectMode();
      if (createDialog.showModal) createDialog.showModal();
      else createDialog.setAttribute("open", "");
    });
  container
    .querySelector("[data-create-project-cancel]")
    ?.addEventListener("click", () => {
      if (createDialog.close) createDialog.close();
      else createDialog.removeAttribute("open");
    });
  createForm
    ?.querySelector("[data-create-project-type]")
    ?.addEventListener("change", updateCreateProjectMode);
  createForm
    ?.querySelector('[name="filmName"]')
    ?.addEventListener("change", addPickedFilm);
  createForm?.addEventListener("click", (event) => {
    let removeButton = event.target.closest("[data-remove-picked-film]");
    if (!removeButton) return;
    pickedFilms.splice(Number(removeButton.dataset.removePickedFilm), 1);
    renderPickedFilms();
  });
  createForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    let type = createForm.querySelector("[data-create-project-type]").value;
    if (type === "custom") {
      let name = createForm.querySelector('[name="projectName"]').value;
      if (!String(name || "").trim()) {
        setCreateProjectStatus(ui("Project name is required."));
        return;
      }
      if (!pickedFilms.length) {
        setCreateProjectStatus(ui("Add at least one film."));
        return;
      }
      let project = window.createCustomProject(
        name,
        pickedFilms.map((entry) => entry.ref),
        { save: false },
      );
      if (!project) {
        setCreateProjectStatus(ui("Could not create the project."));
        return;
      }
      let saving = window.save?.({ immediate: true, rebuild: false });
      if (saving?.then) await saving;
      window.location.href = window.projectPageUrl(project.id);
      return;
    }
    let sourceId = sourceLookup.get(
      window.normalizeSearchText(
        createForm.querySelector('[name="sourceName"]').value,
      ),
    );
    if (!sourceId) {
      setCreateProjectStatus(ui("Pick a source from the suggestions."));
      return;
    }
    await window.startProjectFromSourceAndOpen(type, sourceId);
  });
  finishRenderTimer?.(`${projects.length} project(s)`);
})();
