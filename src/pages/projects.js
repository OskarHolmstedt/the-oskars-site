/**
 * @file Controls the Supabase-backed projects hub (issue #439): lists the
 * signed-in user's own projects and offers a Create dialog. Core v1
 * scope only - a project is a generic named film collection ("created in
 * any which way": search and add any film, regardless of watched/
 * watchlist status), not tied to a live-refreshable source the way the
 * previous model's per-source-type derivation was. The create flow
 * reflects that directly: one film search box feeding one generic
 * createSupabaseProject(name, filmIds) call, rather than a source-type
 * picker per collection kind.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("projectsPage");

  let projects = [];
  let pickedFilms = [];

  function projectCard(project) {
    let statusLabel =
      project.status === "complete"
        ? ui("Complete")
        : project.status === "archived"
          ? ui("Archived")
          : ui("Active");
    return `<a class="film-card project-card" href="${escape(window.projectPageUrl(project.id))}">
      <div class="project-card-title">${project.pinned ? '<span aria-hidden="true">📌</span> ' : ""}${escape(project.name)}</div>
      <div class="leaderboard-meta">${project.source_label ? escape(project.source_label) : escape(ui("Custom project"))}</div>
      <div class="leaderboard-meta"><span class="project-status-badge">${escape(statusLabel)}</span> · <b>${escape(project.itemCount)}</b> ${escape(ui(project.itemCount === 1 ? "film" : "films"))}</div>
    </a>`;
  }

  function createDialogHtml() {
    return `<dialog id="createProjectDialog">
      <form id="createProjectForm" method="dialog">
        <h2>${escape(ui("Create project"))}</h2>
        <label class="wide">${escape(ui("Project name"))}
          <input name="name" required maxlength="120" autocomplete="off">
        </label>
        <label class="wide">${escape(ui("Add film"))}
          <input name="filmSearch" autocomplete="off" placeholder="${escape(ui("Start typing…"))}">
        </label>
        <ul class="project-manage-list" data-create-project-picked></ul>
        <p class="data-panel-status" data-create-project-status></p>
        <div class="dialog-actions"><button type="button" data-create-project-cancel>${escape(ui("Cancel"))}</button><button type="submit">${escape(ui("Create project"))}</button></div>
      </form>
    </dialog>`;
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("projects:render");
    document.title = `${ui("Projects")} · The Oskars`;
    let cards = projects.map(projectCard).join("");
    container.innerHTML = `${window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Projects"))}</h1><p>${escape(ui("Focused watch queues built from any films you pick."))} <a href="collections.html">${escape(ui("Browse your collections"))}</a></p>`,
      actionsHtml: `<button type="button" class="button-link" data-create-project>${escape(ui("Create project"))}</button>`,
    })}
    <div class="film-grid project-film-grid">${cards || `<p class="detail-empty">${escape(ui("No projects yet."))}</p>`}</div>
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
        createForm.reset();
        renderPicked();
        statusEl.textContent = "";
        createDialog?.showModal();
      });
    container
      .querySelector("[data-create-project-cancel]")
      ?.addEventListener("click", () => createDialog?.close());

    let searchTimer = null;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      let query = searchInput.value;
      searchTimer = setTimeout(async () => {
        if (!query.trim()) return;
        try {
          let results = await window.searchSupabaseFilmsByTitle(query);
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
          statusEl.textContent = err.message || String(err);
        }
      }, 250);
    });
    statusEl.addEventListener("click", (event) => {
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
      let name = String(new FormData(createForm).get("name") || "").trim();
      if (!name) return;
      statusEl.textContent = ui("Creating…");
      try {
        let created = await window.createSupabaseProject(
          name,
          pickedFilms.map((film) => film.id),
        );
        window.location.href = window.projectPageUrl(created.id);
      } catch (err) {
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
