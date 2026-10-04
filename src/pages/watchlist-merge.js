/**
 * @file Guided pairwise merge tool, cut over to Supabase for real (issue
 * #421) - combines two already-ordered watchlist scopes within one
 * interest tier (two years, a year and its decade, a decade and the
 * rest of the tier, and so on) into one interleaved order via repeated
 * "which ranks higher" choices, then applies the result through
 * applySupabaseWatchlistTierMergeOrder(): every other item in the tier
 * keeps its exact existing position.
 *
 * Reuses merge-order.js's generic engine (createMergeSession/
 * pickMergeSide/undoMergeChoice/renderMergeCompareStep/
 * wireMergeCompareControls) exactly as the original did - the state-
 * free half of this page needed zero changes. Compare cards use their
 * own simple markup (title, year, tier badge) rather than
 * renderSharedFilmCard/renderLinkedDirectors - both have real,
 * non-optionally-chained window.state coupling in reachable paths
 * (renderFilmPoster specifically), matching the established pattern of
 * writing simple custom markup over risking reuse of state-coupled UI
 * helpers. No director on the card either - Supabase's watchlist select
 * doesn't join credits, a deliberate scope cut, not an oversight.
 */
(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("watchlistMergePage");

  let picker = { tier: "", blockAId: "", blockBId: "" };
  let step = "setup";
  let session = null;
  let applyResult = null;
  let isMutating = false;

  function ensurePickerDefaults() {
    let tiers = window.supabaseWatchlistTiersWithItems();
    if (!picker.tier) {
      let tierParam = window.pageQueryParam?.("tier");
      if (tierParam && tiers.includes(tierParam)) {
        picker.tier = tierParam;
      }
    }
    if (!picker.tier || !tiers.includes(picker.tier))
      picker.tier = tiers[0] || "";
    if (picker.tier) {
      let blocks = window.loadWatchlistMergeBlocks(picker.tier);
      let blockIds = new Set(blocks.map((b) => b.id));
      if (!picker.blockAId || !blockIds.has(picker.blockAId)) {
        picker.blockAId = blocks[0]?.id || "";
      }
      if (
        !picker.blockBId ||
        !blockIds.has(picker.blockBId) ||
        picker.blockBId === picker.blockAId
      ) {
        let candidateB = blocks.find((b) => b.id !== picker.blockAId);
        picker.blockBId = candidateB?.id || blocks[1]?.id || "";
      }
    }
  }

  function blockItems(side) {
    let blockId = picker[side === "a" ? "blockAId" : "blockBId"];
    if (!picker.tier || !blockId) return [];
    let blocks = window.loadWatchlistMergeBlocks(picker.tier);
    let block = blocks.find((b) => b.id === blockId);
    if (!block) return [];
    return window.supabaseWatchlistBlockScopeItems(picker.tier, block.years);
  }

  function effectiveScopeItems() {
    let listA = blockItems("a");
    let aIds = new Set(listA.map((row) => row.film_id));
    let listB = blockItems("b").filter((row) => !aIds.has(row.film_id));
    return { listA, listB };
  }

  function pickerValidation() {
    if (!picker.tier)
      return "No interest tier has at least two watchlist films to merge.";
    let blocks = window.loadWatchlistMergeBlocks(picker.tier);
    if (blocks.length < 2)
      return "This tier needs at least two candidate groups to merge.";
    if (picker.blockAId === picker.blockBId)
      return "Group A and Group B must be different candidate groups.";
    let { listA, listB } = effectiveScopeItems();
    if (!listA.length || !listB.length)
      return "Both groups need at least one film.";
    return "";
  }

  function renderBlockChips(blocks) {
    if (!blocks.length) return "";
    let chips = blocks
      .map((block) => {
        let isA = block.id === picker.blockAId;
        let isB = block.id === picker.blockBId;
        let activeClass = isA
          ? "watchlist-merge-block-chip--group-a"
          : isB
            ? "watchlist-merge-block-chip--group-b"
            : "";
        let splitButton = !block.isSingle
          ? `<button type="button" class="watchlist-merge-block-split" data-split-block="${escape(block.id)}" title="Split into individual years" aria-label="Split ${escape(block.label)}">✕</button>`
          : "";
        let roleBadge = isA
          ? `<span class="watchlist-merge-chip-role">A</span>`
          : isB
            ? `<span class="watchlist-merge-chip-role">B</span>`
            : "";
        return `<div class="watchlist-merge-block-chip ${activeClass}">
          ${roleBadge}
          <span class="watchlist-merge-block-label">${escape(block.label)}</span>
          <span class="watchlist-merge-block-count">(${escape(block.count)})</span>
          ${splitButton}
        </div>`;
      })
      .join("");
    return `<div class="watchlist-merge-blocks-overview">
      <div class="watchlist-merge-blocks-header">
        <span class="watchlist-merge-blocks-title">Candidate groups (${escape(blocks.length)})</span>
        <div class="watchlist-merge-blocks-actions">
          <button type="button" class="watchlist-merge-text-action" data-group-decades>Group by decade</button>
          <button type="button" class="watchlist-merge-text-action" data-reset-blocks>Reset to single years</button>
        </div>
      </div>
      <div class="watchlist-merge-blocks-chips">${chips}</div>
    </div>`;
  }

  function renderScopeFieldset(side, label, blocks) {
    let currentId = picker[side === "a" ? "blockAId" : "blockBId"];
    let currentBlock = blocks.find((b) => b.id === currentId);
    let count = currentBlock ? currentBlock.count : 0;
    let options = blocks
      .map((block) => {
        let selected = block.id === currentId ? " selected" : "";
        let countText =
          window.uiCount?.(block.count, "film", "films") ||
          `${block.count} films`;
        return `<option value="${escape(block.id)}"${selected}>${escape(block.label)} (${escape(countText)})</option>`;
      })
      .join("");
    return `<fieldset class="watchlist-merge-scope">
      <legend>${escape(label)}</legend>
      <select data-merge-block="${side}">${options}</select>
      <span class="watchlist-merge-scope-count">${escape(count)} films</span>
    </fieldset>`;
  }

  function renderSetup() {
    ensurePickerDefaults();
    let tiers = window.supabaseWatchlistTiersWithItems();
    let blocks = picker.tier
      ? window.loadWatchlistMergeBlocks(picker.tier)
      : [];
    let validation = pickerValidation();
    if (!tiers.length)
      return `<div class="detail-empty">
        <h2>Nothing to merge yet</h2>
        <p>No interest tier has at least two watchlist films. Assign tiers on the watchlist first.</p>
      </div>`;
    let tierOptions = tiers
      .map(
        (tier) =>
          `<option value="${escape(tier)}"${picker.tier === tier ? " selected" : ""}>${escape(tier)}</option>`,
      )
      .join("");
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <p>Pick an interest tier and two candidate groups within it, then decide film by film which one ranks higher. Merged groups unite into composite spans (e.g. 1951–1952) for multi-level merge sort.</p>
      <label class="watchlist-merge-tier-picker">Interest tier <select data-merge-tier>${tierOptions}</select></label>
      ${renderBlockChips(blocks)}
      <div class="watchlist-merge-scopes">
        ${renderScopeFieldset("a", "Group A", blocks)}
        ${renderScopeFieldset("b", "Group B", blocks)}
      </div>
      ${validation ? `<p class="watchlist-merge-validation">${escape(validation)}</p>` : ""}
      <button type="button" class="sort-order-button" data-merge-start${validation || !canEdit ? " disabled" : ""}>Start merge</button>
    </section>`;
  }

  function renderCompareCard(row, side, meta = {}) {
    let film = row.films || {};
    let posterUrl = film.poster_url || film.poster?.url;
    let posterHtml = posterUrl
      ? `<figure class="film-poster film-poster--card"><img src="${escape(posterUrl)}" alt="Poster for ${escape(film.title || "film")}" loading="lazy" decoding="async"></figure>`
      : `<figure class="film-poster film-poster--card film-poster--fallback"><div class="film-poster-placeholder-art" aria-hidden="true">🎬</div></figure>`;
    let remaining = meta.remaining;
    let upcoming = meta.upcoming || [];
    let groupLabel = side === "a" ? "Group A" : "Group B";
    let keyHint = side === "a" ? "←" : "→";
    let stackClass = remaining > 1 ? "watchlist-merge-deck-stack" : "";
    let countLabel = Number.isInteger(remaining)
      ? window.uiCount?.(remaining, "film", "films") || `${remaining} films`
      : "";

    let deckUnderlayHtml = "";
    if (upcoming.length > 0) {
      let cardsHtml = upcoming
        .slice(0, 2)
        .map((upItem, idx) => {
          let upFilm = upItem?.films || upItem?.film || upItem || {};
          let upPosterUrl = upFilm.poster_url || upFilm.poster?.url;
          let upIndex = idx + 1;
          let artHtml = upPosterUrl
            ? `<img src="${escape(upPosterUrl)}" alt="" loading="lazy" decoding="async">`
            : `<div class="film-poster-placeholder-art" aria-hidden="true">🎬</div>`;
          return `<div class="watchlist-merge-deck-underlay-card watchlist-merge-deck-underlay-card--${upIndex} watchlist-merge-deck-underlay-card--${side}" aria-hidden="true">
            <div class="watchlist-merge-deck-underlay-poster">${artHtml}</div>
          </div>`;
        })
        .reverse()
        .join("");
      deckUnderlayHtml = `<div class="watchlist-merge-deck-underlay" aria-hidden="true">${cardsHtml}</div>`;
    }

    return `<article class="film-card watchlist-card watchlist-merge-choice-card ${stackClass}" data-watchlist-merge-pick="${side}" tabindex="0" role="button" aria-label="${escape(film.title || "film")}">
      ${deckUnderlayHtml}
      <div class="watchlist-merge-card-header">
        <span class="watchlist-merge-group-badge">${escape(groupLabel)}</span>
        ${countLabel ? `<span class="watchlist-merge-deck-count">${escape(countLabel)}</span>` : ""}
      </div>
      <div class="watchlist-merge-card-poster">
        ${posterHtml}
      </div>
      <div class="watchlist-merge-card-meta">
        <h3>${escape(film.title || "Unknown film")}</h3>
        <div class="watchlist-merge-card-subline">
          <span class="film-year">(${escape(film.year || "—")})</span>
          ${window.renderWatchlistTierBadge ? window.renderWatchlistTierBadge(row.tier, { escape, modifier: row.tier_modifier }) : ""}
        </div>
      </div>
      <div class="watchlist-merge-card-footer">
        <span class="watchlist-merge-pick-cue"><kbd>${keyHint}</kbd> Choose</span>
      </div>
    </article>`;
  }

  function renderPreview() {
    let itemsHtml = session.merged
      .map(
        (row) =>
          `<li>${escape(row.films?.title || "Unknown film")} <small>(${escape(row.films?.year || "—")})</small></li>`,
      )
      .join("");
    return `<section class="watchlist-merge-preview" data-watchlist-merge-preview>
      <h2>Merged order</h2>
      <p>This becomes the new relative order for these films within the tier; every other film keeps its exact position.</p>
      <ol class="watchlist-merge-preview-list">${itemsHtml}</ol>
      <div class="watchlist-merge-preview-actions">
        <button type="button" class="sort-order-button" data-merge-apply>Use this order</button>
        <button type="button" class="sort-order-button" data-merge-restart>Start over</button>
      </div>
    </section>`;
  }

  function renderDone() {
    let tier = session?.tier || picker.tier;
    let unitedNote = session?.unitedBlockLabel
      ? `<p class="watchlist-merge-united-note">United into candidate group <strong>${escape(session.unitedBlockLabel)}</strong>.</p>`
      : "";
    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>Merged order applied</h2>
      <p>${escape(applyResult?.changed || 0)} films reordered in tier ${escape(tier)}.</p>
      ${unitedNote}
      <div class="watchlist-merge-done-actions">
        <button type="button" class="sort-order-button" data-merge-again>Merge next group</button>
        <a href="period.html?view=watchlist" class="sort-order-button">Back to watchlist</a>
      </div>
    </section>`;
  }

  function render() {
    let header = window.renderDetailHeader({
      mainHtml: "<h1>Merge watchlist order</h1>",
    });
    let shelfHeader = "";
    if (session?.shelfLabel) {
      let currentIdx = (session.currentShelfIndex || 0) + 1;
      let totalShelves = (session.shelves || []).length;
      shelfHeader = `<div class="merge-shelf-indicator">
        <span class="merge-shelf-badge">Shelf ${currentIdx} of ${totalShelves}: ${escape(session.shelfLabel)}</span>
        <span class="merge-shelf-hint">Only comparing films with this exact interest tier</span>
      </div>`;
    }
    let body =
      step === "compare"
        ? `${shelfHeader}${window.renderMergeCompareStep(session, renderCompareCard, { escape })}`
        : step === "preview"
          ? renderPreview()
          : step === "done"
            ? renderDone()
            : renderSetup();
    container.innerHTML = `${header}${body}`;
  }

  function startMerge() {
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    if (!canEdit || pickerValidation()) return;
    let { listA, listB } = effectiveScopeItems();
    session = window.createWatchlistShelfMergeSession
      ? window.createWatchlistShelfMergeSession(listA, listB)
      : window.createMergeSession(listA, listB);
    session.tier = picker.tier;
    session.blockAId = picker.blockAId;
    session.blockBId = picker.blockBId;
    session.mergedYearSet = new Set([
      ...listA.map((r) => Number(r.films?.year)).filter(Number.isInteger),
      ...listB.map((r) => Number(r.films?.year)).filter(Number.isInteger),
    ]);
    step = session.done ? "preview" : "compare";
    render();
  }

  function pick(side) {
    if (window.pickWatchlistMergeSide && session.shelves) {
      window.pickWatchlistMergeSide(session, side);
    } else {
      window.pickMergeSide(session, side);
    }
    if (session.done) step = "preview";
    render();
  }

  function undoLastPick() {
    if (!session.history.length) return;
    if (window.undoWatchlistMergeChoice && session.shelves) {
      window.undoWatchlistMergeChoice(session);
    } else {
      window.undoMergeChoice(session);
    }
    step = "compare";
    render();
  }

  async function applyMerge() {
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    if (!canEdit || isMutating || !session) return;
    isMutating = true;
    let ids = session.merged.map((row) => row.film_id);
    let applyButton = container.querySelector("[data-merge-apply]");
    if (applyButton) applyButton.disabled = true;
    try {
      let result = await window.applySupabaseWatchlistTierMergeOrder(
        session.tier,
        ids,
      );
      if (!result.ok) {
        alert(result.reason);
        if (applyButton) applyButton.disabled = false;
        return;
      }
      applyResult = result;
      let updatedBlocks = window.uniteWatchlistMergeBlocks(
        session.tier,
        session.blockAId,
        session.blockBId,
      );
      let unitedBlock = updatedBlocks.find((b) =>
        b.years.some((y) => session.mergedYearSet.has(y)),
      );
      if (unitedBlock) {
        session.unitedBlockLabel = unitedBlock.label;
        picker.blockAId = unitedBlock.id;
        picker.blockBId =
          updatedBlocks.find((b) => b.id !== unitedBlock.id)?.id || "";
      }
      step = "done";
      render();
    } catch (error) {
      alert(error.message || String(error));
      if (applyButton) applyButton.disabled = false;
    } finally {
      isMutating = false;
    }
  }

  container.addEventListener("change", (event) => {
    let tierSelect = event.target.closest("[data-merge-tier]");
    if (tierSelect) {
      picker.tier = tierSelect.value;
      picker.blockAId = "";
      picker.blockBId = "";
      ensurePickerDefaults();
      render();
      return;
    }
    let blockSelect = event.target.closest("[data-merge-block]");
    if (blockSelect) {
      let side = blockSelect.dataset.mergeBlock;
      let chosenId = blockSelect.value;
      if (side === "a") {
        picker.blockAId = chosenId;
        if (picker.blockBId === chosenId) {
          let blocks = window.loadWatchlistMergeBlocks(picker.tier);
          picker.blockBId = blocks.find((b) => b.id !== chosenId)?.id || "";
        }
      } else {
        picker.blockBId = chosenId;
        if (picker.blockAId === chosenId) {
          let blocks = window.loadWatchlistMergeBlocks(picker.tier);
          picker.blockAId = blocks.find((b) => b.id !== chosenId)?.id || "";
        }
      }
      render();
    }
  });

  container.addEventListener("click", (event) => {
    let splitBtn = event.target.closest("[data-split-block]");
    if (splitBtn) {
      let blockId = splitBtn.dataset.splitBlock;
      window.splitWatchlistMergeBlock(picker.tier, blockId);
      ensurePickerDefaults();
      render();
      return;
    }
    if (event.target.closest("[data-reset-blocks]")) {
      window.resetWatchlistMergeBlocks(picker.tier);
      ensurePickerDefaults();
      render();
      return;
    }
    if (event.target.closest("[data-group-decades]")) {
      window.groupWatchlistMergeBlocksByDecade(picker.tier);
      ensurePickerDefaults();
      render();
    }
  });

  window.wireMergeCompareControls(container, {
    start: startMerge,
    pick,
    undo: undoLastPick,
    cancel: () => {
      session = null;
      step = "setup";
      render();
    },
    apply: applyMerge,
    restart: () => {
      step = "setup";
      render();
    },
    again: () => {
      session = null;
      applyResult = null;
      step = "setup";
      ensurePickerDefaults();
      render();
    },
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      await window.loadSupabaseWorkspace({ parts: ["watchlist"] });
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your watchlist</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
