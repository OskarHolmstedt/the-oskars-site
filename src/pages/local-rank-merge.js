/**
 * @file Guided pairwise merge tool for local-rank collections, cut over
 * to Supabase for real (issue #422) - generalizes watchlist-merge's
 * two-pointer merge (merge-order.js) to a director/tag's own films
 * instead of two watchlist scopes. Franchises aren't supported - no
 * Supabase schema exists for them at all yet, a real gap tracked
 * separately, not silently dropped.
 *
 * Redesigned with a self-contained director-search/tag-list picker
 * rather than the original's type/id/returnUrl URL params - those
 * assumed navigating in from an existing franchise/person/tag page,
 * none of which exist in Supabase form yet. Every prior cutover page is
 * self-contained the same way.
 *
 * Reuses merge-order.js's generic engine exactly as the original did -
 * that half needed zero changes.
 */
(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("localRankMergePage");

  let collection = null; // {kind, id, name}
  let searchResults = [];
  let searchStatus = "";
  let tagOptions = [];
  let step = "pick";
  let session = null;
  let orderedFilmIds = [];
  let applyResult = null;

  function renderPickStep() {
    let tagList = tagOptions.length
      ? `<ul class="watchlist-search-results">${tagOptions
          .map(
            (tag) =>
              `<li><span>${escape(tag.name)}</span><button type="button" data-pick-tag="${escape(tag.id)}">Choose</button></li>`,
          )
          .join("")}</ul>`
      : "<p>You have no tags yet.</p>";
    return `<section class="card">
      <h2>Merge a director's local rank</h2>
      <form data-director-search>
        <label>Search directors<input type="text" name="query" placeholder="Director name" autocomplete="off"></label>
        <button type="submit">Search</button>
      </form>
      ${searchStatus ? `<p>${escape(searchStatus)}</p>` : ""}
      ${
        searchResults.length
          ? `<ul class="watchlist-search-results">${searchResults
              .map(
                (person) =>
                  `<li><span>${escape(person.name)}</span><button type="button" data-pick-director="${escape(person.id)}">Choose</button></li>`,
              )
              .join("")}</ul>`
          : ""
      }
    </section>
    <section class="card">
      <h2>Or merge a tag's local rank</h2>
      ${tagList}
    </section>`;
  }

  function renderSetup() {
    let films = orderedFilmIds;
    if (films.length < 2)
      return `<div class="detail-empty">
        <h2>Nothing to merge yet</h2>
        <p>This collection needs at least two films to merge.</p>
        <button type="button" class="sort-order-button" data-merge-back>Back</button>
      </div>`;
    let mid = Math.ceil(films.length / 2);
    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <p>Splits ${escape(collection.name)}'s current local order into two groups, then decides film by film which one ranks higher until both are interleaved.</p>
      <p class="watchlist-merge-scope-count">Group A: ${escape(mid)} films · Group B: ${escape(films.length - mid)} films</p>
      <button type="button" class="sort-order-button" data-merge-start>Start merge</button>
    </section>`;
  }

  function renderCompareCard(film, side) {
    return `<article class="film-card watchlist-card watchlist-merge-choice-card" data-watchlist-merge-pick="${side}" tabindex="0" role="button">
      <h3>${escape(film.title)}</h3>
      <span class="film-year">(${escape(film.year || "—")})</span>
    </article>`;
  }

  function renderPreview() {
    let itemsHtml = session.merged
      .map((film) => `<li>${escape(film.title)} <small>(${escape(film.year || "—")})</small></li>`)
      .join("");
    return `<section class="watchlist-merge-preview" data-watchlist-merge-preview>
      <h2>Merged order</h2>
      <p>This becomes ${escape(collection.name)}'s new local rank order.</p>
      <ol class="watchlist-merge-preview-list">${itemsHtml}</ol>
      <div class="watchlist-merge-preview-actions">
        <button type="button" class="sort-order-button" data-merge-apply>Use this order</button>
        <button type="button" class="sort-order-button" data-merge-restart>Start over</button>
      </div>
    </section>`;
  }

  function renderDone() {
    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>Merged order applied</h2>
      <p>${escape(applyResult?.length || 0)} films reordered.</p>
      <button type="button" class="sort-order-button" data-merge-again>Merge again</button>
    </section>`;
  }

  function render() {
    let header = window.renderDetailHeader({
      mainHtml: "<h1>Merge local rank (Supabase)</h1>",
    });
    let body =
      step === "pick"
        ? renderPickStep()
        : step === "compare"
          ? window.renderMergeCompareStep(session, renderCompareCard, { escape })
          : step === "preview"
            ? renderPreview()
            : step === "done"
              ? renderDone()
              : renderSetup();
    container.innerHTML = `${header}${body}`;
  }

  async function chooseCollection(kind, id) {
    try {
      let loaded = await window.loadSupabaseLocalRankCollectionFilms(kind, id);
      if (!loaded) {
        alert("Collection not found.");
        return;
      }
      collection = { kind, id, name: loaded.name };
      let implicitOrder = [...loaded.films].sort((left, right) =>
        String(left.title).localeCompare(String(right.title)),
      );
      let filmById = new Map(implicitOrder.map((film) => [film.id, film]));
      let storedOrder = await window.loadSupabaseLocalRankOrder(kind, id);
      orderedFilmIds = window
        .mergeSupabaseLocalRankOrder(storedOrder, implicitOrder.map((film) => film.id))
        .map((filmId) => filmById.get(filmId))
        .filter(Boolean);
      step = "setup";
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  async function loadTagOptions() {
    try {
      tagOptions = await window.listSupabaseTags();
    } catch (error) {
      tagOptions = [];
    }
    render();
  }

  container.addEventListener("submit", async (event) => {
    let form = event.target.closest("[data-director-search]");
    if (!form) return;
    event.preventDefault();
    let query = new FormData(form).get("query");
    searchStatus = "Searching…";
    render();
    try {
      searchResults = await window.searchSupabaseDirectorsByName(query);
      searchStatus = searchResults.length ? "" : "No matching directors found.";
    } catch (error) {
      searchStatus = error.message || String(error);
    }
    render();
  });

  container.addEventListener("click", async (event) => {
    let pickDirector = event.target.closest("[data-pick-director]");
    let pickTag = event.target.closest("[data-pick-tag]");
    let back = event.target.closest("[data-merge-back]");
    if (pickDirector) {
      await chooseCollection("person", pickDirector.dataset.pickDirector);
      return;
    }
    if (pickTag) {
      await chooseCollection("tag", pickTag.dataset.pickTag);
      return;
    }
    if (back) {
      collection = null;
      step = "pick";
      render();
      return;
    }
    if (event.target.closest("[data-merge-start]")) {
      let films = orderedFilmIds;
      if (films.length < 2) return;
      let mid = Math.ceil(films.length / 2);
      session = window.createMergeSession(films.slice(0, mid), films.slice(mid));
      step = session.done ? "preview" : "compare";
      render();
      return;
    }
    let pick = event.target.closest("[data-watchlist-merge-pick]");
    if (pick) {
      window.pickMergeSide(session, pick.dataset.watchlistMergePick);
      if (session.done) step = "preview";
      render();
      return;
    }
    if (event.target.closest("[data-merge-undo]")) {
      if (session.history.length) {
        window.undoMergeChoice(session);
        step = "compare";
        render();
      }
      return;
    }
    if (event.target.closest("[data-merge-cancel]")) {
      session = null;
      step = "setup";
      render();
      return;
    }
    if (event.target.closest("[data-merge-apply]")) {
      let applyButton = event.target;
      applyButton.disabled = true;
      try {
        let filmIds = session.merged.map((film) => film.id);
        await window.setSupabaseLocalRankOrder(collection.kind, collection.id, filmIds);
        applyResult = filmIds;
        step = "done";
        render();
      } catch (error) {
        applyButton.disabled = false;
        alert(error.message || String(error));
      }
      return;
    }
    if (event.target.closest("[data-merge-restart]")) {
      step = "setup";
      render();
      return;
    }
    if (event.target.closest("[data-merge-again]")) {
      session = null;
      applyResult = null;
      step = "setup";
      render();
    }
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    render();
    loadTagOptions();
  }

  boot();
})();
