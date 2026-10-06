/** @file Controls the signed-in projects hub and reviewed catalog-based project creation. */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("projectsPage");

  let projects = [];
  let pickedFilms = [];
  let sourceLabel = "";
  const symbol = () => window.renderCollectionActionIcon("project");

  function projectCard(project) {
    let statusLabel =
      project.status === "complete"
        ? ui("Complete")
        : project.status === "archived"
          ? ui("Archived")
          : ui("Active");
    return `<a class="project-card projects-hub-card" href="${escape(window.projectPageUrl(project.id))}">
      <div class="projects-card-top"><span class="projects-symbol">${symbol()}</span><span class="project-status-badge">${escape(statusLabel)}</span></div>
      <div class="projects-card-deck" aria-hidden="true">${project.posterFilms?.length ? window.renderPosterDeck(project.posterFilms, { classes: "project-card-poster-deck" }) : `<span class="projects-empty-deck">${symbol()}</span>`}</div>
      <h2>${escape(project.name)}</h2>
      <div class="leaderboard-meta">${project.source_label ? escape(project.source_label) : escape(ui("Custom project"))}</div>
      <div class="leaderboard-meta">${project.pinned ? `${escape(ui("Pinned"))} · ` : ""}<b>${escape(project.itemCount)}</b> ${escape(ui(project.itemCount === 1 ? "film" : "films"))}</div>
    </a>`;
  }

  function createDialogHtml() {
    return `<dialog id="createProjectDialog">
      <form id="createProjectForm" method="dialog">
        <h2>${symbol()} ${escape(ui("Create project"))}</h2>
        <label class="wide">${escape(ui("Start with"))}
          <select name="sourceKind"><option value="films">${escape(ui("Individual films"))}</option><option value="person">${escape(ui("Filmography"))}</option><option value="franchise">${escape(ui("Franchise"))}</option></select>
        </label>
        <p class="projects-create-hint">${escape(ui("Choose a source, review its known catalog films, and make the queue your own."))}</p>
        <label class="wide">${escape(ui("Project name"))}
          <input name="name" required maxlength="120" autocomplete="off">
        </label>
        <label class="wide"><span data-search-label>${escape(ui("Add film"))}</span>
          <input name="filmSearch" autocomplete="off" placeholder="${escape(ui("Start typing…"))}">
        </label>
        <ul class="project-manage-list" data-create-project-picked></ul>
        <p class="data-panel-status" aria-live="polite" data-create-project-status></p>
        <div class="dialog-actions"><button type="button" data-create-project-cancel>${escape(ui("Cancel"))}</button><button type="submit">${escape(ui("Create project"))}</button></div>
      </form>
    </dialog>`;
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("projects:render");
    document.title = `${ui("Projects")} · The Oskars`;
    let cards = projects.map(projectCard).join("");
    container.innerHTML = `${window.renderDetailHeader({
      mainHtml: `<div class="projects-heading"><span class="projects-symbol projects-symbol--hero">${symbol()}</span><div><h1>${escape(ui("Projects"))}</h1><p>${escape(ui("Turn a filmography, a franchise, or a handful of films into your next watch journey."))}</p></div></div>`,
      actionsHtml: `<button type="button" class="button-link" data-create-project>${symbol()} ${escape(ui("Create project"))}</button>`,
    })}
    <div class="project-grid projects-hub-grid">${cards || `<p class="detail-empty">${escape(ui("No projects yet."))}</p>`}</div>
    ${createDialogHtml()}`;

    let createDialog = container.querySelector("#createProjectDialog");
    let createForm = container.querySelector("#createProjectForm");
    let statusEl = container.querySelector("[data-create-project-status]");
    let pickedList = container.querySelector("[data-create-project-picked]");
    let searchInput = createForm.querySelector('[name="filmSearch"]');

    function renderPicked() {
      pickedList.innerHTML = pickedFilms
        .map(
          (film) =>
            `<li>${escape(film.title)} (${escape(film.year || "")}) <button type="button" data-remove-picked-film="${escape(film.id)}">${escape(ui("Remove"))}</button></li>`,
        )
        .join("");
    }
    renderPicked();

    container
      .querySelector("[data-create-project]")
      ?.addEventListener("click", () => {
        pickedFilms = [];
        sourceLabel = "";
        searchVersion++;
        createForm.reset();
        container.querySelector("[data-search-label]").textContent =
          ui("Add film");
        renderPicked();
        statusEl.textContent = "";
        createDialog?.showModal();
      });
    container
      .querySelector("[data-create-project-cancel]")
      ?.addEventListener("click", () => createDialog?.close());

    let searchTimer = null;
    let searchVersion = 0;
    let loadingVersion = null;
    createDialog.addEventListener("close", () => {
      searchVersion++;
      clearTimeout(searchTimer);
    });
    let sourceKind = createForm.querySelector('[name="sourceKind"]');
    sourceKind.addEventListener("change", () => {
      clearTimeout(searchTimer);
      searchVersion++;
      searchInput.value = "";
      statusEl.textContent = "";
      container.querySelector("[data-search-label]").textContent = ui(
        sourceKind.value === "films"
          ? "Add film"
          : sourceKind.value === "person"
            ? "Find a person"
            : "Find a franchise",
      );
    });
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      let query = searchInput.value;
      let version = ++searchVersion;
      statusEl.textContent = "";
      searchTimer = setTimeout(async () => {
        if (!query.trim()) return;
        try {
          let kind = sourceKind.value;
          let results =
            kind === "films"
              ? await window.searchSupabaseFilmsByTitle(query)
              : await window.searchSupabaseProjectSources(kind, query);
          if (version !== searchVersion) return;
          if (kind !== "films") {
            statusEl.innerHTML =
              results
                .map(
                  (source) =>
                    `<button type="button" class="sort-order-button" data-pick-source="${escape(source.id)}" data-source-name="${escape(source.name)}">${escape(source.name)}</button>`,
                )
                .join(" ") || escape(ui("No matches"));
            return;
          }
          let existingIds = new Set(pickedFilms.map((film) => film.id));
          let list = results.filter((film) => !existingIds.has(film.id));
          statusEl.innerHTML = list
            .slice(0, 8)
            .map(
              (film) =>
                `<button type="button" class="sort-order-button" data-pick-film="${escape(film.id)}" data-pick-title="${escape(film.title)}" data-pick-year="${escape(film.year || "")}">${escape(film.title)} (${escape(film.year || "")})</button>`,
            )
            .join(" ");
        } catch (err) {
          if (version === searchVersion)
            statusEl.textContent = err.message || String(err);
        }
      }, 250);
    });
    statusEl.addEventListener("click", async (event) => {
      let sourceButton = event.target.closest("[data-pick-source]");
      if (sourceButton) {
        let version = ++searchVersion;
        loadingVersion = version;
        statusEl.textContent = ui("Loading…");
        try {
          let films = await window.loadSupabaseProjectSourceFilms(
            sourceKind.value,
            sourceButton.dataset.pickSource,
          );
          if (version !== searchVersion) return;
          let ids = new Set(pickedFilms.map((film) => film.id));
          pickedFilms.push(...films.filter((film) => !ids.has(film.id)));
          sourceLabel = sourceButton.dataset.sourceName;
          let nameInput = createForm.querySelector('[name="name"]');
          if (!nameInput.value.trim()) nameInput.value = sourceLabel;
          renderPicked();
          statusEl.textContent = films.length
            ? ui("Review the films below before creating your project.")
            : ui("None of these films are in the catalog yet.");
        } catch (err) {
          if (version === searchVersion)
            statusEl.textContent = err.message || String(err);
        } finally {
          if (loadingVersion === version) loadingVersion = null;
        }
        return;
      }
      let button = event.target.closest("[data-pick-film]");
      if (!button) return;
      pickedFilms.push({
        id: button.dataset.pickFilm,
        title: button.dataset.pickTitle,
        year: button.dataset.pickYear,
      });
      searchInput.value = "";
      statusEl.innerHTML = "";
      renderPicked();
    });
    pickedList.addEventListener("click", (event) => {
      let button = event.target.closest("[data-remove-picked-film]");
      if (!button) return;
      pickedFilms = pickedFilms.filter(
        (film) => film.id !== button.dataset.removePickedFilm,
      );
      renderPicked();
    });
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      let submitBtn = createForm.querySelector('button[type="submit"]');
      if (submitBtn?.disabled || loadingVersion === searchVersion) return;
      let name = String(new FormData(createForm).get("name") || "").trim();
      if (!name) return;
      if (submitBtn) submitBtn.disabled = true;
      statusEl.textContent = ui("Creating…");
      try {
        let created = await window.createSupabaseProject(
          name,
          pickedFilms.map((film) => film.id),
          sourceLabel || undefined,
        );
        window.location.href = window.projectPageUrl(created.id);
      } catch (err) {
        if (submitBtn) submitBtn.disabled = false;
        statusEl.textContent = err.message || String(err);
      }
    });
    finishRenderTimer?.(`${projects.length} projects`);
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      projects = await window.listSupabaseProjects();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load projects"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
