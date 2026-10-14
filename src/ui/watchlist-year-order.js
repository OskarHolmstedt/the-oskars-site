/** @file Owns the watchlist year shelf editor and ranking backlog on the Rankings page. */

(function () {
  let escape = window.pageEscape;

  function yearLabel(year) {
    return year ? String(year) : "Unknown year";
  }

  /**
   * Builds a link to the watchlist year editor, optionally opening an exact tier.
   * @param {number} year
   * @param {string} [tier]
   * @returns {string}
   */
  window.watchlistYearOrderUrl = function (year, tier = "") {
    return `rankings.html?watchlistYear=${encodeURIComponent(year)}${tier ? `&tier=${encodeURIComponent(tier)}` : ""}`;
  };

  /**
   * Renders tiered films awaiting year ordering and confirmed groups ready for merging.
   * @returns {string}
   */
  window.renderWatchlistOrderingProgress = function () {
    let tiers = window.watchlistExactTiers();
    let pendingCount = 0;
    let readyCount = 0;
    let years = new Map();
    for (let tier of tiers) {
      for (let shelf of window.watchlistOrderingShelves(tier)) {
        if (!shelf.confirmed) pendingCount += shelf.items.length;
        if (!years.has(shelf.year))
          years.set(shelf.year, { pending: 0, count: 0 });
        let year = years.get(shelf.year);
        year.count += shelf.items.length;
        if (!shelf.confirmed) year.pending += shelf.items.length;
      }
      readyCount += window.watchlistOrderingBlocks(tier).length;
    }
    let untiered = (window.getSupabaseWorkspace()?.watchlist || []).filter(
      (row) => !window.normalizeWatchlistTier(row.tier),
    ).length;
    return `<section class="rankings-section" id="watchlist-ordering">
      <h2>Build watchlist order</h2>
      <p>${pendingCount} tiered films awaiting year ordering · ${untiered} untiered · ${readyCount} ordered groups</p>
      <p>Sort each year's exact-tier shelves, then merge any two ordered groups. All collection views inherit the resulting global order. Single-film shelves are ready automatically.</p>
      <div class="rankings-card-actions"><a class="sort-order-button" href="tier-watchlist.html">Set tiers</a><a class="sort-order-button" href="merge.html?mode=watchlist">Merge ordered groups</a></div>
      <div class="rankings-grid">${[...years.entries()]
        .sort(([a], [b]) => b - a)
        .map(
          ([year, progress]) =>
            `<div class="rankings-card"><h3>${escape(yearLabel(year))}</h3><p>${progress.count} tiered · ${progress.pending} awaiting year ordering</p><a class="sort-order-button" href="${escape(window.watchlistYearOrderUrl(year))}">${progress.pending ? "Order year" : "Review year"}</a></div>`,
        )
        .join("")}</div>
    </section>`;
  };

  /**
   * Mounts the selected year's drag-sort editor with keyboard and touch ordering controls.
   * @param {HTMLElement} container
   * @returns {boolean} Whether the URL selects the watchlist year editor.
   */
  window.mountWatchlistYearOrder = function (container) {
    let rawYear = window.pageQueryParam("watchlistYear");
    if (rawYear === null || rawYear === "" || rawYear === undefined)
      return false;
    if (!/^\d{1,4}$/.test(rawYear)) {
      container.innerHTML =
        '<p>Invalid release year.</p><a href="rankings.html">Back to Rankings</a>';
      return true;
    }
    let year = Number(rawYear);
    let tierFilter = window.pageQueryParam("tier");
    let drafts = new Map();
    let drag = null;
    let busy = false;
    let status = "";
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    function shelves() {
      return window.watchlistExactTiers().flatMap((tier) => {
        if (tierFilter && tierFilter !== tier) return [];
        let shelf = window
          .watchlistOrderingShelves(tier)
          .find((item) => item.year === year);
        return shelf ? [{ ...shelf, tier }] : [];
      });
    }
    function render() {
      let finishRender = window.startOskarsPerformance?.(
        "watchlistYear:render",
      );
      document.title = `Order ${yearLabel(year)} watchlist · The Oskars`;
      container.innerHTML = `<section class="rankings-section">
        <h1>Order ${escape(yearLabel(year))} watchlist</h1>
        <p>Drag films within the same exact tier, or use Move up and Move down. Confirm each shelf before merging it with other years. Saving changes the global order; affected merged groups may need merging again.</p>
        <div class="rankings-card-actions"><a class="sort-order-button" href="rankings.html#watchlist-ordering">All years</a><a class="sort-order-button" href="merge.html?mode=watchlist${tierFilter ? `&tier=${encodeURIComponent(tierFilter)}` : ""}">Merge ordered groups</a></div>
        <p role="status">${escape(status)}</p>
        ${
          shelves()
            .map((shelf) => {
              let rows = drafts.get(shelf.tier) || shelf.items;
              return `<section class="rankings-card watchlist-year-shelf" data-watchlist-year-tier="${escape(shelf.tier)}">
            <h2>Tier ${escape(shelf.tier)} · ${rows.length} films</h2>
            <p>${drafts.has(shelf.tier) ? "Unsaved order" : shelf.confirmed ? "Year order ready" : "Awaiting year ordering"}</p>
            <ol class="film-grid setup-year-pool-grid watchlist-year-order-list">${rows
              .map(
                (
                  row,
                  index,
                ) => `<li class="film-card ranking-edit-card" data-watchlist-year-film="${escape(row.film_id)}"${canEdit && !busy ? ' draggable="true"' : ""}>
              ${row.films?.poster_url ? `<img src="${escape(row.films.poster_url)}" alt="" width="40" loading="lazy" />` : ""}
              <span class="film-rank">${index + 1}</span>
              <a class="table-film-link" href="${escape(window.filmPageUrl(row.film_id))}">${escape(row.films?.title || "Unknown film")}</a>
              ${canEdit ? `<div class="watchlist-year-order-actions"><button type="button" class="sort-order-button" data-watchlist-year-move="-1" aria-label="Move ${escape(row.films?.title || "film")} up"${busy || index === 0 ? " disabled" : ""}>↑</button><button type="button" class="sort-order-button" data-watchlist-year-move="1" aria-label="Move ${escape(row.films?.title || "film")} down"${busy || index === rows.length - 1 ? " disabled" : ""}>↓</button></div>` : ""}
            </li>`,
              )
              .join("")}</ol>
            ${canEdit ? `<button type="button" class="sort-order-button" data-watchlist-year-confirm${busy ? " disabled" : ""}>${busy ? "Saving…" : "Confirm year order"}</button>` : ""}
          </section>`;
            })
            .join("") || "<p>No tiered watchlist films in this year.</p>"
        }
      </section>`;
      finishRender?.();
    }
    function move(tier, filmId, targetIndex) {
      let shelf = shelves().find((item) => item.tier === tier);
      let rows = [...(drafts.get(tier) || shelf.items)];
      let index = rows.findIndex((row) => row.film_id === filmId);
      if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
      rows.splice(targetIndex, 0, rows.splice(index, 1)[0]);
      drafts.set(tier, rows);
      status = "Order changed. Confirm this shelf to save it.";
      render();
    }
    container.addEventListener("dragstart", (event) => {
      if (!canEdit || busy) return;
      let card = event.target.closest("[data-watchlist-year-film]");
      if (!card) return;
      drag = {
        tier: card.closest("[data-watchlist-year-tier]").dataset
          .watchlistYearTier,
        id: card.dataset.watchlistYearFilm,
      };
      event.dataTransfer.setData("text/plain", drag.id);
    });
    container.addEventListener("dragover", (event) => {
      let target = event.target.closest("[data-watchlist-year-tier]");
      if (drag && target?.dataset.watchlistYearTier === drag.tier)
        event.preventDefault();
    });
    container.addEventListener("drop", (event) => {
      event.preventDefault();
      let card = event.target.closest("[data-watchlist-year-film]");
      if (
        !canEdit ||
        busy ||
        !drag ||
        !card ||
        card.closest("[data-watchlist-year-tier]").dataset.watchlistYearTier !==
          drag.tier
      )
        return;
      let cards = [...card.parentElement.children];
      move(drag.tier, drag.id, cards.indexOf(card));
      drag = null;
    });
    container.addEventListener("dragend", () => {
      drag = null;
    });
    container.addEventListener("click", async (event) => {
      if (!canEdit || busy) return;
      let section = event.target.closest("[data-watchlist-year-tier]");
      if (!section) return;
      let tier = section.dataset.watchlistYearTier;
      let button = event.target.closest("[data-watchlist-year-move]");
      if (button) {
        let card = button.closest("[data-watchlist-year-film]");
        let index = [...card.parentElement.children].indexOf(card);
        move(
          tier,
          card.dataset.watchlistYearFilm,
          index + Number(button.dataset.watchlistYearMove),
        );
        container
          .querySelector(
            `[data-watchlist-year-film="${card.dataset.watchlistYearFilm}"] button:not(:disabled)`,
          )
          ?.focus();
      } else if (event.target.closest("[data-watchlist-year-confirm]")) {
        let shelf = shelves().find((item) => item.tier === tier);
        let rows = drafts.get(tier) || shelf.items;
        busy = true;
        status = "Saving year order…";
        render();
        try {
          await window.saveWatchlistOrdering(tier, [year], rows);
          drafts.delete(tier);
          status = `Tier ${tier} year order saved. Ready to merge.`;
        } catch (error) {
          status = `Could not save: ${error.message || error}. Your draft is preserved; reload if the watchlist changed elsewhere.`;
        } finally {
          busy = false;
          render();
        }
      }
    });
    render();
    return true;
  };
})();
