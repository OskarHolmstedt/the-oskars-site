/**
 * @file Controls the Supabase-backed collections hub (issue #449): lists
 * the signed-in user's own collections that have not been promoted to a
 * project - a bare, named film list with no workflow state at all.
 * Promoted collections stay exclusively on projects.html's own listing;
 * "Promote to project" (collection.html) is the one-way door from here
 * to there. The create flow mirrors projects.js's exactly (one film
 * search box feeding one generic createSupabaseCollection(name, filmIds)
 * call) since a collection's initial creation looks identical to a
 * project's - only the workflow state promotion adds on top differs.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("collectionsPage");

  let collections = [];
  let pickedFilms = [];

  function collectionCard(collection) {
    return `<a class="film-card project-card" href="${escape(window.collectionPageUrl(collection.id))}">
      <div class="project-card-title">${escape(collection.name)}</div>
      <div class="leaderboard-meta">${collection.source_label ? escape(collection.source_label) : escape(ui("Custom collection"))}</div>
      <div class="leaderboard-meta"><b>${escape(collection.itemCount)}</b> ${escape(ui(collection.itemCount === 1 ? "film" : "films"))}</div>
    </a>`;
  }

  function createDialogHtml() {
    return `<dialog id="createCollectionDialog">
      <form id="createCollectionForm" method="dialog">
        <h2>${escape(ui("Create collection"))}</h2>
        <label class="wide">${escape(ui("Collection name"))}
          <input name="name" required maxlength="120" autocomplete="off">
        </label>
        <label class="wide">${escape(ui("Add film"))}
          <input name="filmSearch" autocomplete="off" placeholder="${escape(ui("Start typing…"))}">
        </label>
        <ul class="project-manage-list" data-create-collection-picked></ul>
        <p class="data-panel-status" data-create-collection-status></p>
        <div class="dialog-actions"><button type="button" data-create-collection-cancel>${escape(ui("Cancel"))}</button><button type="submit">${escape(ui("Create collection"))}</button></div>
      </form>
    </dialog>`;
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("collections:render");
    document.title = `${ui("Collections")} · The Oskars`;
    let cards = collections.map(collectionCard).join("");
    container.innerHTML = `${window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Collections"))}</h1><p>${escape(ui("Named film lists you've saved but haven't turned into a project yet."))} <a href="projects.html">${escape(ui("Browse your projects"))}</a></p>`,
      actionsHtml: `<button type="button" class="button-link" data-create-collection>${escape(ui("Create collection"))}</button>`,
    })}
    <div class="film-grid project-film-grid">${cards || `<p class="detail-empty">${escape(ui("No collections yet."))}</p>`}</div>
    ${createDialogHtml()}`;

    let createDialog = container.querySelector("#createCollectionDialog");
    let createForm = container.querySelector("#createCollectionForm");
    let statusEl = container.querySelector("[data-create-collection-status]");
    let pickedList = container.querySelector("[data-create-collection-picked]");
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
      .querySelector("[data-create-collection]")
      ?.addEventListener("click", () => {
        pickedFilms = [];
        createForm.reset();
        renderPicked();
        statusEl.textContent = "";
        createDialog?.showModal();
      });
    container
      .querySelector("[data-create-collection-cancel]")
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
        let created = await window.createSupabaseCollection(
          name,
          pickedFilms.map((film) => film.id),
        );
        window.location.href = window.collectionPageUrl(created.id);
      } catch (err) {
        statusEl.textContent = err.message || String(err);
      }
    });
    finishRenderTimer?.(`${collections.length} collections`);
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      collections = await window.listSupabaseCollections();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load collections"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
