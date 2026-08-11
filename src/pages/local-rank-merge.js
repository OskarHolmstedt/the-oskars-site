/**
 * @file Guided pairwise merge tool for local-rank collections (issue #165):
 * generalizes watchlist-merge.html's two-pointer merge (src/domain/merge-order.js)
 * to a franchise/director/tag's own films instead of two watchlist scopes
 * within one tier. Splits the collection's current local order into two
 * halves and lets the same "which one ranks higher" choices reorder the
 * whole collection in O(n) comparisons rather than dragging every film.
 */
(function () {
  let escape = window.pageEscape;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
  window.load();

  let container = document.getElementById("localRankMergePage");
  document.title = `${ui("Merge local rank")} · The Oskars`;

  let type = window.pageQueryParam("type");
  let id = window.pageQueryParam("id");
  let returnUrl = window.pageQueryParam("returnUrl");
  let collection = window.localRankCollectionFilms?.(type, id);

  function typeLabel() {
    if (type === "franchises") return ui("franchise");
    if (type === "people") return ui("director");
    if (type === "tags") return ui("tag");
    return ui("collection");
  }
  function backHref() {
    return returnUrl || "index.html";
  }
  function currentOrderedFilms() {
    if (!collection) return [];
    let currentIds = collection.films.map((film) => film.id);
    let order = window.mergeLocalRankOrder(
      window.localRankOrder(type, id),
      currentIds,
    );
    let byId = new Map(collection.films.map((film) => [film.id, film]));
    return order.map((filmId) => byId.get(filmId)).filter(Boolean);
  }

  let step = "setup";
  let session = null;
  let applyResult = null;

  function renderSetup() {
    if (!collection)
      return `<div class="detail-empty"><h2>${escape(ui("Collection not found"))}</h2><a href="${escape(backHref())}">${escape(ui("Back"))}</a></div>`;
    let films = currentOrderedFilms();
    if (films.length < 2)
      return `<div class="detail-empty">
        <h2>${escape(ui("Nothing to merge yet"))}</h2>
        <p>${escape(ui("This collection needs at least two films to merge."))}</p>
        <a href="${escape(backHref())}">${escape(ui("Back"))}</a>
      </div>`;
    let mid = Math.ceil(films.length / 2);
    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <p>${escape(ui("Splits {name}'s current local order into two groups, then decides film by film which one ranks higher until both are interleaved.", { name: collection.name }))}</p>
      <p class="watchlist-merge-scope-count">${escape(ui("Group A: {a} films · Group B: {b} films", { a: mid, b: films.length - mid }))}</p>
      <button type="button" class="sort-order-button" data-merge-start>${escape(ui("Start merge"))}</button>
    </section>`;
  }

  function renderCompareCard(film, side) {
    return window.renderSharedFilmCard(film, {
      classes: ["watchlist-card", "watchlist-merge-choice-card"],
      openFilm: false,
      attributes: {
        "data-watchlist-merge-pick": side,
        tabindex: "0",
        role: "button",
      },
      showYear: true,
      escape,
    });
  }

  function renderCompare() {
    let remainingA = session.listA.length - session.pointerA;
    let remainingB = session.listB.length - session.pointerB;
    let cardA = renderCompareCard(session.listA[session.pointerA], "a");
    let cardB = renderCompareCard(session.listB[session.pointerB], "b");
    let progressText = ui("{a} left in Group A, {b} left in Group B", {
      a: window.uiCount?.(remainingA, "film", "films") || `${remainingA} films`,
      b: window.uiCount?.(remainingB, "film", "films") || `${remainingB} films`,
    });
    return `<section class="watchlist-merge-compare" data-watchlist-merge-compare>
      <p class="watchlist-merge-progress">${escape(ui("Which one ranks higher?"))} · ${escape(progressText)}</p>
      <div class="watchlist-merge-choice">
        ${cardA}
        <span class="watchlist-merge-vs">${escape(ui("or"))}</span>
        ${cardB}
      </div>
      <div class="watchlist-merge-compare-actions">
        <button type="button" class="sort-order-button" data-merge-undo${session.history.length ? "" : " disabled"}>${escape(ui("Undo last choice"))}</button>
        <button type="button" class="sort-order-button" data-merge-cancel>${escape(ui("Cancel merge"))}</button>
      </div>
    </section>`;
  }

  function renderPreview() {
    let itemsHtml = session.merged
      .map(
        (film) =>
          `<li>${escape(window.localizedFilmTitle?.(film) || film.title)} <small>(${escape(film.year || "—")})</small></li>`,
      )
      .join("");
    return `<section class="watchlist-merge-preview" data-watchlist-merge-preview>
      <h2>${escape(ui("Merged order"))}</h2>
      <p>${escape(ui("This becomes {name}'s new local rank order.", { name: collection.name }))}</p>
      <ol class="watchlist-merge-preview-list">${itemsHtml}</ol>
      <div class="watchlist-merge-preview-actions">
        <button type="button" class="sort-order-button" data-merge-apply>${escape(ui("Apply merged order"))}</button>
        <button type="button" class="sort-order-button" data-merge-restart>${escape(ui("Start over"))}</button>
      </div>
    </section>`;
  }

  function renderDone() {
    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>${escape(ui("Merged order applied"))}</h2>
      <p>${escape(ui("{count} films reordered.", { count: applyResult?.length || 0 }))}</p>
      <a class="sort-order-button" href="${escape(backHref())}">${escape(ui("Back to {type}", { type: typeLabel() }))}</a>
      <button type="button" class="sort-order-button" data-merge-again>${escape(ui("Merge again"))}</button>
    </section>`;
  }

  function render() {
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Merge local rank"))}</h1><p><a href="${escape(backHref())}">${escape(ui("Back"))}</a></p>`,
    });
    let body =
      step === "compare"
        ? renderCompare()
        : step === "preview"
          ? renderPreview()
          : step === "done"
            ? renderDone()
            : renderSetup();
    container.innerHTML = `${header}${body}`;
  }

  function startMerge() {
    let films = currentOrderedFilms();
    if (films.length < 2) return;
    let mid = Math.ceil(films.length / 2);
    session = window.createMergeSession(films.slice(0, mid), films.slice(mid));
    step = session.done ? "preview" : "compare";
    render();
  }

  function pick(side) {
    window.pickMergeSide(session, side);
    if (session.done) step = "preview";
    render();
  }

  function undoLastPick() {
    if (!session.history.length) return;
    window.undoMergeChoice(session);
    step = "compare";
    render();
  }

  function applyMerge() {
    let filmIds = session.merged.map((film) => film.id);
    window.setLocalRankOrder(type, id, filmIds, { save: false });
    window.save?.({ immediate: true, rebuild: false });
    applyResult = filmIds;
    step = "done";
    render();
  }

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-merge-start]")) {
      startMerge();
      return;
    }
    let pickTarget = event.target.closest("[data-watchlist-merge-pick]");
    if (pickTarget) {
      pick(pickTarget.dataset.watchlistMergePick);
      return;
    }
    if (event.target.closest("[data-merge-undo]")) {
      undoLastPick();
      return;
    }
    if (event.target.closest("[data-merge-cancel]")) {
      session = null;
      step = "setup";
      render();
      return;
    }
    if (event.target.closest("[data-merge-apply]")) {
      applyMerge();
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

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    let pickTarget = event.target.closest("[data-watchlist-merge-pick]");
    if (!pickTarget) return;
    event.preventDefault();
    pick(pickTarget.dataset.watchlistMergePick);
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
