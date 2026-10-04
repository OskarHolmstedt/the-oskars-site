/**
 * @file Unified merge hub across Watchlist, Watched Periods, and
 * Collections (issue #649). Unifies the hierarchical candidate-block
 * merge-sort workflow across interest tiers and watched period scopes
 * with a strict rating guard rail for watched films (shelf-by-shelf
 * comparisons, auto-passing non-overlapping shelves), and integrates
 * local-rank collection merges into a single multi-mode interface.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("mergePage");

  let mode = "watchlist"; // "watchlist" | "watched" | "collections"
  let step = "setup"; // "setup" | "compare" | "preview" | "done"
  let session = null;
  let isMutating = false;
  let applyResult = null;

  // Watchlist state
  let watchlistPicker = {
    tier: "",
    blockAId: "",
    blockBId: "",
  };

  // Watched state
  let watchedPicker = {
    scopeType: "allTime", // "allTime" | "decades" | "centuries"
    scopeKey: "alltime",
    blockAId: "",
    blockBId: "",
  };
  let watchedRankingLoaded = null; // { rankingId, entries }

  // Collections state
  let collectionState = {
    collection: null, // { kind: "director"|"tag", id, name }
    searchResults: [],
    searchStatus: "",
    tagOptions: [],
    orderedFilmIds: [],
  };

  function initModeFromUrl() {
    let urlMode = window.pageQueryParam("mode");
    let tierParam = window.pageQueryParam("tier");
    if (tierParam) {
      watchlistPicker.tier = tierParam;
    }
    if (["watchlist", "watched", "collections"].includes(urlMode)) {
      mode = urlMode;
      return;
    }
    let typeParam = window.pageQueryParam("type");
    let keyParam = window.pageQueryParam("key");
    if (typeParam || keyParam) {
      mode = "watched";
      let norm = window.normalizeSupabaseRankingReviewScopeType
        ? window.normalizeSupabaseRankingReviewScopeType(typeParam)
        : typeParam === "decades" || typeParam === "decade"
          ? "decades"
          : typeParam === "centuries" || typeParam === "century"
            ? "centuries"
            : "allTime";
      watchedPicker.scopeType = norm;
      watchedPicker.scopeKey = norm === "allTime" ? "alltime" : keyParam || "";
    } else {
      mode = "watchlist";
    }
  }

  async function ensureDataLoadedForMode(targetMode) {
    if (targetMode === "watchlist") {
      await window.loadSupabaseWorkspace({ parts: ["watchlist"] });
      ensureWatchlistPickerDefaults();
    } else if (targetMode === "watched") {
      await window.loadSupabaseWorkspace({ parts: ["watched"] });
      ensureWatchedPickerDefaults();
      await ensureWatchedRankingLoaded();
    } else if (targetMode === "collections") {
      if (!collectionState.tagOptions.length) {
        try {
          let tags = await window.listSupabaseTags();
          collectionState.tagOptions = (tags || [])
            .slice()
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        } catch (err) {
          collectionState.tagOptions = [];
        }
      }
    }
  }

  async function setMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;
    step = "setup";
    session = null;
    applyResult = null;
    let url = new URL(window.location.href);
    url.searchParams.set("mode", newMode);
    if (newMode !== "watched") {
      url.searchParams.delete("type");
      url.searchParams.delete("key");
    }
    if (newMode !== "watchlist") {
      url.searchParams.delete("tier");
    }
    window.history.replaceState({}, "", url.toString());
    try {
      await ensureDataLoadedForMode(newMode);
      render();
    } catch (err) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load merge mode</h2><p>${escape(err.message || String(err))}</p></section>`;
    }
  }

  // --- Watchlist helpers ---

  function ensureWatchlistPickerDefaults() {
    let available = window.supabaseWatchlistTiersWithItems();
    if (!available.length) {
      watchlistPicker.tier = "";
      return;
    }
    if (!watchlistPicker.tier || !available.includes(watchlistPicker.tier)) {
      watchlistPicker.tier = available[0];
    }
    let blocks = window.loadWatchlistMergeBlocks(watchlistPicker.tier);
    if (!blocks.length) {
      watchlistPicker.blockAId = "";
      watchlistPicker.blockBId = "";
      return;
    }
    let hasA = blocks.some((b) => b.id === watchlistPicker.blockAId);
    let hasB = blocks.some((b) => b.id === watchlistPicker.blockBId);
    if (!hasA) watchlistPicker.blockAId = blocks[0].id;
    if (!hasB || watchlistPicker.blockBId === watchlistPicker.blockAId) {
      watchlistPicker.blockBId =
        blocks.find((b) => b.id !== watchlistPicker.blockAId)?.id || "";
    }
  }

  function effectiveWatchlistScopeItems() {
    let tier = watchlistPicker.tier;
    let blocks = window.loadWatchlistMergeBlocks(tier);
    let blockA = blocks.find((b) => b.id === watchlistPicker.blockAId);
    let blockB = blocks.find((b) => b.id === watchlistPicker.blockBId);
    let listA = blockA
      ? window.supabaseWatchlistBlockScopeItems(tier, blockA.years)
      : [];
    let listB = blockB
      ? window.supabaseWatchlistBlockScopeItems(tier, blockB.years)
      : [];
    return { listA, listB, blockA, blockB };
  }

  // --- Watched helpers ---

  async function ensureWatchedRankingLoaded() {
    let { scopeType, scopeKey } = watchedPicker;
    let workspace = window.getSupabaseWorkspace();
    let watched = workspace?.watched || [];
    try {
      if (window.prepareSupabasePeriodRanking) {
        watchedRankingLoaded = await window.prepareSupabasePeriodRanking(
          scopeKey,
          scopeType,
          watched,
        );
      } else {
        watchedRankingLoaded = await window.loadSupabaseRanking(
          scopeKey,
          scopeType,
        );
      }
    } catch (err) {
      watchedRankingLoaded = { rankingId: null, entries: [] };
    }
  }

  function ensureWatchedPickerDefaults() {
    let scopes = window.supabaseWatchedScopes();
    if (!scopes.length) return;

    let matching = scopes.find(
      (s) =>
        s.type === watchedPicker.scopeType && s.key === watchedPicker.scopeKey,
    );
    if (!matching) {
      watchedPicker.scopeType = scopes[0].type;
      watchedPicker.scopeKey = scopes[0].key;
    }

    let blocks = window.loadWatchedMergeBlocks(
      watchedPicker.scopeType,
      watchedPicker.scopeKey,
    );
    if (!blocks.length) {
      watchedPicker.blockAId = "";
      watchedPicker.blockBId = "";
      return;
    }
    let hasA = blocks.some((b) => b.id === watchedPicker.blockAId);
    let hasB = blocks.some((b) => b.id === watchedPicker.blockBId);
    if (!hasA) watchedPicker.blockAId = blocks[0].id;
    if (!hasB || watchedPicker.blockBId === watchedPicker.blockAId) {
      watchedPicker.blockBId =
        blocks.find((b) => b.id !== watchedPicker.blockAId)?.id || "";
    }
  }

  function effectiveWatchedScopeItems() {
    let { scopeType, scopeKey, blockAId, blockBId } = watchedPicker;
    let blocks = window.loadWatchedMergeBlocks(scopeType, scopeKey);
    let blockA = blocks.find((b) => b.id === blockAId);
    let blockB = blocks.find((b) => b.id === blockBId);
    let rankingEntries = watchedRankingLoaded?.entries || [];

    let listA = blockA
      ? window.supabaseWatchedBlockItems(
          scopeType,
          scopeKey,
          blockA.years,
          rankingEntries,
        )
      : [];
    let listB = blockB
      ? window.supabaseWatchedBlockItems(
          scopeType,
          scopeKey,
          blockB.years,
          rankingEntries,
        )
      : [];
    return { listA, listB, blockA, blockB };
  }

  // --- Rendering UI ---

  function renderModeTabs() {
    return `<nav class="merge-mode-tabs" role="tablist" aria-label="Merge mode">
      <button type="button" role="tab" class="merge-tab ${mode === "watchlist" ? "is-active" : ""}" data-merge-mode="watchlist">Watchlist</button>
      <button type="button" role="tab" class="merge-tab ${mode === "watched" ? "is-active" : ""}" data-merge-mode="watched">Watched Periods</button>
      <button type="button" role="tab" class="merge-tab ${mode === "collections" ? "is-active" : ""}" data-merge-mode="collections">Collections</button>
    </nav>`;
  }

  function renderWatchlistSetup() {
    let availableTiers = window.supabaseWatchlistTiersWithItems();
    if (!availableTiers.length) {
      return `<div class="detail-empty">
        <h2>Nothing to merge yet</h2>
        <p>You need at least two items in the same interest tier to merge rankings.</p>
        <a href="period.html?view=watchlist" class="sort-order-button">Back to watchlist</a>
      </div>`;
    }

    let tierOptions = availableTiers
      .map((t) => {
        let count = window.supabaseWatchlistTierItemsInOrder(t).length;
        let selected = t === watchlistPicker.tier ? " selected" : "";
        return `<option value="${escape(t)}"${selected}>Tier ${escape(t)} (${count} films)</option>`;
      })
      .join("");

    let blocks = window.loadWatchlistMergeBlocks(watchlistPicker.tier);
    let hasMultiYear = blocks.some((b) => !b.isSingle);

    let chipsHtml = blocks
      .map((b) => {
        let role =
          b.id === watchlistPicker.blockAId
            ? "Group A"
            : b.id === watchlistPicker.blockBId
              ? "Group B"
              : "";
        let roleBadge = role
          ? `<span class="watchlist-merge-chip-role">${escape(role)}</span>`
          : "";
        let activeClass =
          b.id === watchlistPicker.blockAId
            ? " watchlist-merge-block-chip--group-a"
            : b.id === watchlistPicker.blockBId
              ? " watchlist-merge-block-chip--group-b"
              : "";
        let splitBtn = !b.isSingle
          ? `<button type="button" class="watchlist-merge-block-split" data-merge-split-block="${escape(b.id)}" title="Split into single years" aria-label="Split ${escape(b.label)} into single years">×</button>`
          : "";
        return `<span class="watchlist-merge-block-chip${activeClass}">${roleBadge}<strong class="watchlist-merge-block-label">${escape(b.label)}</strong> <span class="watchlist-merge-block-count">(${b.count})</span>${splitBtn}</span>`;
      })
      .join("");

    let blockOptionsA = blocks
      .map((b) => {
        let selected = b.id === watchlistPicker.blockAId ? " selected" : "";
        return `<option value="${escape(b.id)}"${selected}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let blockOptionsB = blocks
      .map((b) => {
        let selected = b.id === watchlistPicker.blockBId ? " selected" : "";
        let disabled = b.id === watchlistPicker.blockAId ? " disabled" : "";
        return `<option value="${escape(b.id)}"${selected}${disabled}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let { listA, listB } = effectiveWatchlistScopeItems();
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    let validPair =
      watchlistPicker.blockAId &&
      watchlistPicker.blockBId &&
      watchlistPicker.blockAId !== watchlistPicker.blockBId &&
      listA.length > 0 &&
      listB.length > 0;

    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <div class="watchlist-merge-scopes">
        <label>Interest tier
          <select data-merge-watchlist-tier>${tierOptions}</select>
        </label>
      </div>

      <div class="watchlist-merge-blocks-overview">
        <div class="watchlist-merge-blocks-header">
          <span class="watchlist-merge-blocks-title">Candidate blocks (merge sort)</span>
          <div class="watchlist-merge-blocks-actions">
            <button type="button" class="watchlist-merge-text-action" data-merge-group-decade>Group by decade</button>
            ${hasMultiYear ? `<button type="button" class="watchlist-merge-text-action" data-merge-reset-blocks>Reset to single years</button>` : ""}
          </div>
        </div>
        <div class="watchlist-merge-blocks-chips">${chipsHtml}</div>
      </div>

      <div class="watchlist-merge-scopes">
        <label>Group A
          <select data-merge-block="a">${blockOptionsA}</select>
        </label>
        <label>Group B
          <select data-merge-block="b">${blockOptionsB}</select>
        </label>
      </div>

      <p class="watchlist-merge-scope-count">Group A: ${listA.length} films · Group B: ${listB.length} films</p>
      <p class="watchlist-merge-rule-note">Interest tier guard rail active: comparisons only occur between films with the same exact tier refinement (e.g. S+, S, S-). Shelves with only one group auto-pass.</p>
      <button type="button" class="sort-order-button" data-merge-start${validPair && canEdit ? "" : " disabled"}>Start merge</button>
    </section>`;
  }

  function renderWatchedSetup() {
    let scopes = window.supabaseWatchedScopes();
    if (!scopes.length) {
      return `<div class="detail-empty">
        <h2>Nothing to merge yet</h2>
        <p>You need rated watched films to merge period rankings.</p>
        <a href="films.html" class="sort-order-button">Browse films</a>
      </div>`;
    }

    let scopeOptions = scopes
      .map((s) => {
        let value = `${s.type}::${s.key}`;
        let selected =
          s.type === watchedPicker.scopeType && s.key === watchedPicker.scopeKey
            ? " selected"
            : "";
        return `<option value="${escape(value)}"${selected}>${escape(s.label)} (${s.count} rated films)</option>`;
      })
      .join("");

    let blocks = window.loadWatchedMergeBlocks(
      watchedPicker.scopeType,
      watchedPicker.scopeKey,
    );
    let hasMultiYear = blocks.some((b) => !b.isSingle);

    let chipsHtml = blocks.length
      ? blocks
          .map((b) => {
            let role =
              b.id === watchedPicker.blockAId
                ? "Group A"
                : b.id === watchedPicker.blockBId
                  ? "Group B"
                  : "";
            let roleBadge = role
              ? `<span class="watchlist-merge-chip-role">${escape(role)}</span>`
              : "";
            let activeClass =
              b.id === watchedPicker.blockAId
                ? " watchlist-merge-block-chip--group-a"
                : b.id === watchedPicker.blockBId
                  ? " watchlist-merge-block-chip--group-b"
                  : "";
            let splitBtn = !b.isSingle
              ? `<button type="button" class="watchlist-merge-block-split" data-merge-split-block="${escape(b.id)}" title="Split into single years" aria-label="Split ${escape(b.label)} into single years">×</button>`
              : "";
            return `<span class="watchlist-merge-block-chip${activeClass}">${roleBadge}<strong class="watchlist-merge-block-label">${escape(b.label)}</strong> <span class="watchlist-merge-block-count">(${b.count})</span>${splitBtn}</span>`;
          })
          .join("")
      : "<p>No candidate years in this scope.</p>";

    let blockOptionsA = blocks
      .map((b) => {
        let selected = b.id === watchedPicker.blockAId ? " selected" : "";
        return `<option value="${escape(b.id)}"${selected}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let blockOptionsB = blocks
      .map((b) => {
        let selected = b.id === watchedPicker.blockBId ? " selected" : "";
        let disabled = b.id === watchedPicker.blockAId ? " disabled" : "";
        return `<option value="${escape(b.id)}"${selected}${disabled}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let { listA, listB } = effectiveWatchedScopeItems();
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    let validPair =
      watchedPicker.blockAId &&
      watchedPicker.blockBId &&
      watchedPicker.blockAId !== watchedPicker.blockBId &&
      listA.length > 0 &&
      listB.length > 0;

    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <div class="watchlist-merge-scopes">
        <label>Period scope
          <select data-merge-watched-scope>${scopeOptions}</select>
        </label>
      </div>

      <div class="watchlist-merge-blocks-overview">
        <div class="watchlist-merge-blocks-header">
          <span class="watchlist-merge-blocks-title">Candidate blocks (${escape(watchedPicker.scopeKey)})</span>
          <div class="watchlist-merge-blocks-actions">
            <button type="button" class="watchlist-merge-text-action" data-merge-group-decade>Group by decade</button>
            ${hasMultiYear ? `<button type="button" class="watchlist-merge-text-action" data-merge-reset-blocks>Reset to single years</button>` : ""}
          </div>
        </div>
        <div class="watchlist-merge-blocks-chips">${chipsHtml}</div>
      </div>

      <div class="watchlist-merge-scopes">
        <label>Group A
          <select data-merge-block="a">${blockOptionsA}</select>
        </label>
        <label>Group B
          <select data-merge-block="b">${blockOptionsB}</select>
        </label>
      </div>

      <p class="watchlist-merge-scope-count">Group A: ${listA.length} films · Group B: ${listB.length} films</p>
      <p class="watchlist-merge-rule-note">Rating guard rail active: comparisons only occur between films with the same exact rating. Shelves with only one group auto-pass.</p>
      <button type="button" class="sort-order-button" data-merge-start${validPair && canEdit ? "" : " disabled"}>Start merge</button>
    </section>`;
  }

  function renderCollectionsSetup() {
    let col = collectionState.collection;
    if (!col) {
      let tagList = collectionState.tagOptions.length
        ? `<ul class="watchlist-search-results">${collectionState.tagOptions
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
        ${collectionState.searchStatus ? `<p>${escape(collectionState.searchStatus)}</p>` : ""}
        ${
          collectionState.searchResults.length
            ? `<ul class="watchlist-search-results">${collectionState.searchResults
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

    let films = collectionState.orderedFilmIds;
    if (films.length < 2) {
      return `<div class="detail-empty">
        <h2>Nothing to merge yet</h2>
        <p>This collection needs at least two films to merge.</p>
        <button type="button" class="sort-order-button" data-merge-back-collection>Back to collections</button>
      </div>`;
    }

    let mid = Math.ceil(films.length / 2);
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <p>Splits <strong>${escape(col.name)}</strong>'s current order into two halves, then interleaves them pairwise.</p>
      <p class="watchlist-merge-scope-count">Group A: ${mid} films · Group B: ${films.length - mid} films</p>
      <div class="dialog-actions">
        <button type="button" class="sort-order-button" data-merge-start${canEdit ? "" : " disabled"}>Start merge</button>
        <button type="button" class="sort-order-button" data-merge-back-collection>Change collection</button>
      </div>
    </section>`;
  }

  function renderCompareCard(row, side, meta = {}) {
    let film = row.films || row.film || row;
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

    let ratingHtml = "";
    if (mode === "watched" && row.rating) {
      let renderedStars = window.renderFilmRating?.(row) || `${row.rating}★`;
      ratingHtml = `<span class="watched-merge-card-rating">${escape(renderedStars)}</span>`;
    } else if (mode === "watchlist" && row.tier) {
      ratingHtml = window.renderWatchlistTierBadge
        ? window.renderWatchlistTierBadge(row.tier, {
            escape,
            modifier: row.tier_modifier,
          })
        : "";
    }

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
          ${ratingHtml}
        </div>
      </div>
      <div class="watchlist-merge-card-footer">
        <span class="watchlist-merge-pick-cue"><kbd>${keyHint}</kbd> Choose</span>
      </div>
    </article>`;
  }

  function renderCompareStep() {
    let shelfHeader = "";
    if ((mode === "watched" || mode === "watchlist") && session?.shelfLabel) {
      let currentIdx = (session.currentShelfIndex || 0) + 1;
      let totalShelves = (session.shelves || []).length;
      let hintText =
        mode === "watched"
          ? "Only comparing films with this exact rating"
          : "Only comparing films with this exact interest tier";
      shelfHeader = `<div class="merge-shelf-indicator">
        <span class="merge-shelf-badge">Shelf ${currentIdx} of ${totalShelves}: ${escape(session.shelfLabel)}</span>
        <span class="merge-shelf-hint">${escape(hintText)}</span>
      </div>`;
    }
    return `${shelfHeader}${window.renderMergeCompareStep(session, renderCompareCard, { escape })}`;
  }

  function renderPreview() {
    let itemsHtml = session.merged
      .map((row) => {
        let film = row.films || row.film || row;
        let ratingSuffix = "";
        if (mode === "watched" && row.rating) {
          let stars = window.renderFilmRating?.(row) || `${row.rating}★`;
          ratingSuffix = ` · <strong>${escape(stars)}</strong>`;
        }
        return `<li>${escape(film.title || "Unknown film")} <small>(${escape(film.year || "—")})</small>${ratingSuffix}</li>`;
      })
      .join("");

    return `<section class="watchlist-merge-preview" data-watchlist-merge-preview>
      <h2>Merged order</h2>
      <p>This becomes the new relative order for these films; every other film keeps its existing position.</p>
      <ol class="watchlist-merge-preview-list">${itemsHtml}</ol>
      <div class="watchlist-merge-preview-actions">
        <button type="button" class="sort-order-button" data-merge-apply>Use this order</button>
        <button type="button" class="sort-order-button" data-merge-restart>Start over</button>
      </div>
    </section>`;
  }

  function renderDone() {
    let unitedNote = session?.unitedBlockLabel
      ? `<p class="watchlist-merge-united-note">United into candidate group <strong>${escape(session.unitedBlockLabel)}</strong>.</p>`
      : "";

    let backLink =
      mode === "watchlist"
        ? `<a href="period.html?view=watchlist" class="sort-order-button">Back to watchlist</a>`
        : mode === "watched"
          ? `<a href="period.html?type=${escape(watchedPicker.scopeType)}&key=${escape(watchedPicker.scopeKey)}" class="sort-order-button">Back to ${escape(watchedPicker.scopeKey)}</a>`
          : `<button type="button" class="sort-order-button" data-merge-back-collection>Back to collections</button>`;

    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>Merged order applied</h2>
      <p>${escape(applyResult?.changed || session?.merged?.length || 0)} films reordered.</p>
      ${unitedNote}
      <div class="watchlist-merge-done-actions">
        <button type="button" class="sort-order-button" data-merge-again>Merge next group</button>
        ${backLink}
      </div>
    </section>`;
  }

  function render() {
    let header = window.renderDetailHeader({
      mainHtml: "<h1>Merge rankings</h1>",
    });
    let tabs = renderModeTabs();
    let body;

    if (step === "compare") {
      body = renderCompareStep();
    } else if (step === "preview") {
      body = renderPreview();
    } else if (step === "done") {
      body = renderDone();
    } else {
      if (mode === "watchlist") {
        body = renderWatchlistSetup();
      } else if (mode === "watched") {
        body = renderWatchedSetup();
      } else {
        body = renderCollectionsSetup();
      }
    }

    container.innerHTML = `${header}${tabs}${body}`;
  }

  // --- Interaction dispatches ---

  async function startMerge() {
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    if (!canEdit) return;

    if (mode === "watchlist") {
      let { listA, listB } = effectiveWatchlistScopeItems();
      if (!listA.length || !listB.length) return;
      session = window.createWatchlistShelfMergeSession
        ? window.createWatchlistShelfMergeSession(listA, listB)
        : window.createMergeSession(listA, listB);
      session.tier = watchlistPicker.tier;
      session.blockAId = watchlistPicker.blockAId;
      session.blockBId = watchlistPicker.blockBId;
      session.mergedYearSet = new Set([
        ...listA.map((r) => Number(r.films?.year)).filter(Number.isInteger),
        ...listB.map((r) => Number(r.films?.year)).filter(Number.isInteger),
      ]);
    } else if (mode === "watched") {
      let { listA, listB } = effectiveWatchedScopeItems();
      if (!listA.length || !listB.length) return;
      session = window.createWatchedShelfMergeSession(listA, listB);
      session.scopeType = watchedPicker.scopeType;
      session.scopeKey = watchedPicker.scopeKey;
      session.blockAId = watchedPicker.blockAId;
      session.blockBId = watchedPicker.blockBId;
      session.mergedYearSet = new Set([
        ...listA.map((r) => Number(r.films?.year)).filter(Number.isInteger),
        ...listB.map((r) => Number(r.films?.year)).filter(Number.isInteger),
      ]);
    } else {
      // Collections
      let films = collectionState.orderedFilmIds;
      let mid = Math.ceil(films.length / 2);
      let listA = films.slice(0, mid);
      let listB = films.slice(mid);
      session = window.createMergeSession(listA, listB);
    }

    step = session.done ? "preview" : "compare";
    render();
  }

  function pick(side) {
    if (!session) return;
    if (mode === "watched") {
      window.pickWatchedMergeSide(session, side);
    } else if (mode === "watchlist") {
      if (window.pickWatchlistMergeSide) {
        window.pickWatchlistMergeSide(session, side);
      } else {
        window.pickMergeSide(session, side);
      }
    } else {
      window.pickMergeSide(session, side);
    }
    if (session.done) step = "preview";
    render();
  }

  function undoLastPick() {
    if (!session || !session.history?.length) return;
    if (mode === "watched") {
      window.undoWatchedMergeChoice(session);
    } else if (mode === "watchlist") {
      if (window.undoWatchlistMergeChoice) {
        window.undoWatchlistMergeChoice(session);
      } else {
        window.undoMergeChoice(session);
      }
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
    let applyButton = container.querySelector("[data-merge-apply]");
    if (applyButton) applyButton.disabled = true;

    try {
      if (mode === "watchlist") {
        let ids = session.merged.map((r) => r.film_id);
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
          watchlistPicker.blockAId = unitedBlock.id;
          watchlistPicker.blockBId =
            updatedBlocks.find((b) => b.id !== unitedBlock.id)?.id || "";
        }
      } else if (mode === "watched") {
        let ids = session.merged.map((r) => r.film_id);
        let result = await window.applySupabaseWatchedPeriodMergeOrder(
          session.scopeKey,
          session.scopeType,
          ids,
        );
        if (!result.ok) {
          alert(result.reason);
          if (applyButton) applyButton.disabled = false;
          return;
        }
        applyResult = result;
        let updatedBlocks = window.uniteWatchedMergeBlocks(
          session.scopeType,
          session.scopeKey,
          session.blockAId,
          session.blockBId,
        );
        let unitedBlock = updatedBlocks.find((b) =>
          b.years.some((y) => session.mergedYearSet.has(y)),
        );
        if (unitedBlock) {
          session.unitedBlockLabel = unitedBlock.label;
          watchedPicker.blockAId = unitedBlock.id;
          watchedPicker.blockBId =
            updatedBlocks.find((b) => b.id !== unitedBlock.id)?.id || "";
        }
        await ensureWatchedRankingLoaded();
      } else {
        // Collections
        let ids = session.merged.map((r) => r.film_id || r.id);
        let col = collectionState.collection;
        let result =
          col.kind === "director"
            ? await window.applySupabasePersonLocalRankOrder(col.id, ids)
            : await window.applySupabaseTagLocalRankOrder(col.id, ids);
        if (!result.ok) {
          alert(result.reason);
          if (applyButton) applyButton.disabled = false;
          return;
        }
        applyResult = result;
      }

      step = "done";
      render();
    } catch (err) {
      alert(err.message || String(err));
      if (applyButton) applyButton.disabled = false;
    } finally {
      isMutating = false;
    }
  }

  // --- Event delegation ---

  container.addEventListener("click", async (event) => {
    // Mode tabs
    let tab = event.target.closest("[data-merge-mode]");
    if (tab) {
      await setMode(tab.dataset.mergeMode);
      return;
    }

    // Compare picks
    let pickCard = event.target.closest("[data-watchlist-merge-pick]");
    if (pickCard && step === "compare") {
      pick(pickCard.dataset.watchlistMergePick);
      return;
    }

    // Compare actions
    if (event.target.closest("[data-merge-undo]")) {
      undoLastPick();
      return;
    }
    if (event.target.closest("[data-merge-cancel]")) {
      step = "setup";
      session = null;
      render();
      return;
    }

    // Preview actions
    if (event.target.closest("[data-merge-apply]")) {
      applyMerge();
      return;
    }
    if (event.target.closest("[data-merge-restart]")) {
      startMerge();
      return;
    }

    // Done actions
    if (event.target.closest("[data-merge-again]")) {
      step = "setup";
      session = null;
      applyResult = null;
      if (mode === "watchlist") ensureWatchlistPickerDefaults();
      else if (mode === "watched") ensureWatchedPickerDefaults();
      render();
      return;
    }

    // Setup actions
    if (event.target.closest("[data-merge-start]")) {
      startMerge();
      return;
    }

    // Block candidate management
    let splitBtn = event.target.closest("[data-merge-split-block]");
    if (splitBtn) {
      let blockId = splitBtn.dataset.mergeSplitBlock;
      if (mode === "watchlist") {
        window.splitWatchlistMergeBlock(watchlistPicker.tier, blockId);
        ensureWatchlistPickerDefaults();
      } else if (mode === "watched") {
        window.splitWatchedMergeBlock(
          watchedPicker.scopeType,
          watchedPicker.scopeKey,
          blockId,
        );
        ensureWatchedPickerDefaults();
      }
      render();
      return;
    }
    if (event.target.closest("[data-merge-group-decade]")) {
      if (mode === "watchlist") {
        window.groupWatchlistMergeBlocksByDecade(watchlistPicker.tier);
        ensureWatchlistPickerDefaults();
      } else if (mode === "watched") {
        window.groupWatchedMergeBlocksByDecade(
          watchedPicker.scopeType,
          watchedPicker.scopeKey,
        );
        ensureWatchedPickerDefaults();
      }
      render();
      return;
    }
    if (event.target.closest("[data-merge-reset-blocks]")) {
      if (mode === "watchlist") {
        window.resetWatchlistMergeBlocks(watchlistPicker.tier);
        ensureWatchlistPickerDefaults();
      } else if (mode === "watched") {
        window.resetWatchedMergeBlocks(
          watchedPicker.scopeType,
          watchedPicker.scopeKey,
        );
        ensureWatchedPickerDefaults();
      }
      render();
      return;
    }

    // Collections director search / tag picker
    let pickDirector = event.target.closest("[data-pick-director]");
    if (pickDirector) {
      let id = pickDirector.dataset.pickDirector;
      let person = collectionState.searchResults.find((p) => p.id === id);
      if (person) {
        collectionState.collection = {
          kind: "director",
          id: person.id,
          name: person.name,
        };
        collectionState.orderedFilmIds =
          window.supabasePersonFilmsInLocalRankOrder(person.id);
        render();
      }
      return;
    }
    let pickTag = event.target.closest("[data-pick-tag]");
    if (pickTag) {
      let id = pickTag.dataset.pickTag;
      let tag = collectionState.tagOptions.find((t) => t.id === id);
      if (tag) {
        collectionState.collection = {
          kind: "tag",
          id: tag.id,
          name: tag.name,
        };
        collectionState.orderedFilmIds =
          window.supabaseTagFilmsInLocalRankOrder(tag.id);
        render();
      }
      return;
    }
    if (event.target.closest("[data-merge-back-collection]")) {
      collectionState.collection = null;
      collectionState.orderedFilmIds = [];
      step = "setup";
      session = null;
      render();
      return;
    }
  });

  container.addEventListener("change", async (event) => {
    // Watchlist tier select
    let wlTier = event.target.closest("[data-merge-watchlist-tier]");
    if (wlTier) {
      watchlistPicker.tier = wlTier.value;
      watchlistPicker.blockAId = "";
      watchlistPicker.blockBId = "";
      ensureWatchlistPickerDefaults();
      let url = new URL(window.location.href);
      if (watchlistPicker.tier) {
        url.searchParams.set("tier", watchlistPicker.tier);
      } else {
        url.searchParams.delete("tier");
      }
      window.history.replaceState({}, "", url.toString());
      render();
      return;
    }

    // Watched scope select
    let wtScope = event.target.closest("[data-merge-watched-scope]");
    if (wtScope) {
      let [st, sk] = wtScope.value.split("::");
      watchedPicker.scopeType = st;
      watchedPicker.scopeKey = sk;
      watchedPicker.blockAId = "";
      watchedPicker.blockBId = "";
      await ensureWatchedRankingLoaded();
      ensureWatchedPickerDefaults();
      render();
      return;
    }

    // Block select A or B
    let blockSelect = event.target.closest("[data-merge-block]");
    if (blockSelect) {
      let side = blockSelect.dataset.mergeBlock;
      let chosen = blockSelect.value;
      let activePicker = mode === "watchlist" ? watchlistPicker : watchedPicker;
      if (side === "a") {
        activePicker.blockAId = chosen;
        if (activePicker.blockBId === chosen) {
          let blocks =
            mode === "watchlist"
              ? window.loadWatchlistMergeBlocks(activePicker.tier)
              : window.loadWatchedMergeBlocks(
                  activePicker.scopeType,
                  activePicker.scopeKey,
                );
          activePicker.blockBId = blocks.find((b) => b.id !== chosen)?.id || "";
        }
      } else {
        activePicker.blockBId = chosen;
      }
      render();
      return;
    }
  });

  container.addEventListener("submit", async (event) => {
    let form = event.target.closest("[data-director-search]");
    if (!form) return;
    event.preventDefault();
    let query = form.query?.value?.trim();
    if (!query) return;
    collectionState.searchStatus = "Searching...";
    render();
    try {
      let results = await window.searchSupabaseDirectors(query);
      collectionState.searchResults = results;
      collectionState.searchStatus = results.length
        ? ""
        : `No directors found for "${query}".`;
    } catch (err) {
      collectionState.searchStatus = err.message || String(err);
    }
    render();
  });

  window.addEventListener("keydown", (event) => {
    if (step !== "compare") return;
    if (
      event.target.tagName === "INPUT" ||
      event.target.tagName === "SELECT" ||
      event.target.tagName === "TEXTAREA"
    ) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      pick("a");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      pick("b");
    } else if (event.key === "z" || event.key === "Z") {
      event.preventDefault();
      undoLastPick();
    }
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate?.();
    if (access && !access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }

    try {
      initModeFromUrl();
      await ensureDataLoadedForMode(mode);
      render();
    } catch (err) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load merge tool</h2><p>${escape(err.message || String(err))}</p></section>`;
    }
  }

  boot();
})();
