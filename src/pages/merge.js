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
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("mergePage");

  let mode = "watchlist"; // "watchlist" | "rewatchlist" | "watched" | "collections"
  let step = "setup"; // "setup" | "compare" | "preview" | "done"
  let session = null;
  let pairQueue = null;
  let isMutating = false;
  let applyResult = null;
  let filmDirectors = new Map();
  let pendingDirectorFetches = new Set();
  let autoApply =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("oskars-merge-auto-apply") === "true";

  // Watchlist state
  let watchlistPicker = {
    tier: "",
    decade: "",
    blockAId: "",
    blockBId: "",
  };

  // Stash state
  let stashPicker = {
    tier: "",
    stashItems: [],
    activeItems: [],
    rawStash: [],
    isStashing: false,
    isUnstashing: false,
  };

  // Rewatchlist state
  let rewatchlistPicker = {
    tier: "",
    decade: "",
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
    let decadeParam = window.pageQueryParam("decade");
    if (tierParam) {
      watchlistPicker.tier = tierParam;
      rewatchlistPicker.tier = tierParam;
      stashPicker.tier = tierParam;
    }
    if (decadeParam) {
      watchlistPicker.decade = decadeParam;
      rewatchlistPicker.decade = decadeParam;
    }
    if (
      ["watchlist", "rewatchlist", "watched", "collections", "stash"].includes(
        urlMode,
      )
    ) {
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
      await window.loadWatchlistOrdering();
      ensureWatchlistPickerDefaults();
    } else if (targetMode === "stash") {
      await window.loadSupabaseWorkspace({ parts: ["watchlist"] });
      await window.loadWatchlistOrdering();
      await ensureStashPickerDefaults();
    } else if (targetMode === "rewatchlist") {
      await window.loadSupabaseWorkspace({ parts: ["watched"] });
      await window.loadRewatchOrdering();
      ensureRewatchlistPickerDefaults();
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
    pairQueue = null;
    applyResult = null;
    let url = new URL(window.location.href);
    url.searchParams.set("mode", newMode);
    if (newMode !== "watched") {
      url.searchParams.delete("type");
      url.searchParams.delete("key");
    }
    if (
      newMode !== "watchlist" &&
      newMode !== "rewatchlist" &&
      newMode !== "stash"
    ) {
      url.searchParams.delete("tier");
      url.searchParams.delete("decade");
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
    let blocks = window.watchlistOrderingBlocks(watchlistPicker.tier);
    let pool = blocks;
    if (watchlistPicker.decade) {
      let filtered = blocks.filter((b) =>
        b.years.some(
          (y) =>
            (window.getDecadeKey
              ? window.getDecadeKey(y)
              : `${Math.floor(y / 10) * 10}s`) === watchlistPicker.decade,
        ),
      );
      if (filtered.length) {
        pool = filtered;
      } else {
        watchlistPicker.decade = "";
      }
    }
    if (!pool.length) {
      watchlistPicker.blockAId = "";
      watchlistPicker.blockBId = "";
      return;
    }
    let hasA = pool.some((b) => b.id === watchlistPicker.blockAId);
    let hasB = pool.some((b) => b.id === watchlistPicker.blockBId);
    if (!hasA) watchlistPicker.blockAId = pool[0].id;
    if (!hasB || watchlistPicker.blockBId === watchlistPicker.blockAId) {
      watchlistPicker.blockBId =
        pool.find((b) => b.id !== watchlistPicker.blockAId)?.id || "";
    }
  }

  function effectiveWatchlistScopeItems() {
    let tier = watchlistPicker.tier;
    let blocks = window.watchlistOrderingBlocks(tier);
    let blockA = blocks.find((b) => b.id === watchlistPicker.blockAId);
    let blockB = blocks.find((b) => b.id === watchlistPicker.blockBId);
    let listA = blockA
      ? window
          .supabaseWatchlistTierItemsInOrder(tier)
          .filter((row) =>
            blockA.years.includes(window.watchlistOrderYear(row)),
          )
      : [];
    let listB = blockB
      ? window
          .supabaseWatchlistTierItemsInOrder(tier)
          .filter((row) =>
            blockB.years.includes(window.watchlistOrderYear(row)),
          )
      : [];
    return { listA, listB, blockA, blockB };
  }

  // --- Rewatchlist helpers ---

  function ensureRewatchlistPickerDefaults() {
    let tiers = window.supabaseRewatchTiersWithItems();
    if (!tiers.length) {
      rewatchlistPicker.tier = "";
      rewatchlistPicker.decade = "";
      rewatchlistPicker.blockAId = "";
      rewatchlistPicker.blockBId = "";
      return;
    }
    if (!tiers.includes(rewatchlistPicker.tier)) {
      rewatchlistPicker.tier = tiers[0];
      rewatchlistPicker.decade = "";
    }
    let blocks = window.rewatchOrderingBlocks(rewatchlistPicker.tier);
    let pool = blocks;
    if (rewatchlistPicker.decade) {
      let filtered = blocks.filter((b) =>
        b.decades.includes(rewatchlistPicker.decade),
      );
      if (filtered.length) {
        pool = filtered;
      } else {
        rewatchlistPicker.decade = "";
      }
    }
    if (!pool.length) {
      rewatchlistPicker.blockAId = "";
      rewatchlistPicker.blockBId = "";
      return;
    }
    let hasA = pool.some((b) => b.id === rewatchlistPicker.blockAId);
    let hasB = pool.some((b) => b.id === rewatchlistPicker.blockBId);
    if (!hasA) rewatchlistPicker.blockAId = pool[0].id;
    if (!hasB || rewatchlistPicker.blockBId === rewatchlistPicker.blockAId) {
      rewatchlistPicker.blockBId =
        pool.find((b) => b.id !== rewatchlistPicker.blockAId)?.id || "";
    }
  }

  function effectiveRewatchlistScopeItems() {
    let tier = rewatchlistPicker.tier;
    let blocks = window.rewatchOrderingBlocks(tier);
    let blockA = blocks.find((b) => b.id === rewatchlistPicker.blockAId);
    let blockB = blocks.find((b) => b.id === rewatchlistPicker.blockBId);
    let listA = blockA
      ? window
          .supabaseRewatchTierItemsInOrder(tier)
          .filter((row) => blockA.years.includes(window.rewatchOrderYear(row)))
      : [];
    let listB = blockB
      ? window
          .supabaseRewatchTierItemsInOrder(tier)
          .filter((row) => blockB.years.includes(window.rewatchOrderYear(row)))
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

  // --- Stash helpers ---

  async function ensureStashPickerDefaults() {
    let raw = await window.loadSupabaseWatchlistStash();
    stashPicker.rawStash = raw || [];
    let availableTiers = (
      window.watchlistExactTiers ? window.watchlistExactTiers() : []
    ).filter((t) => {
      let stashedCount = (stashPicker.rawStash || []).filter(
        (r) => r.tier === t,
      ).length;
      let activeCount = window
        .supabaseWatchlistTierItemsInOrder(t)
        .filter((r) => r.position).length;
      return stashedCount > 0 || activeCount > 0;
    });
    if (availableTiers.length) {
      if (!stashPicker.tier || !availableTiers.includes(stashPicker.tier)) {
        stashPicker.tier = availableTiers[0];
      }
    } else {
      let activeTiers = window.supabaseWatchlistTiersWithItems();
      stashPicker.tier = activeTiers[0] || "";
    }
    updateStashPickerItems();
  }

  function updateStashPickerItems() {
    let tier = stashPicker.tier;
    stashPicker.stashItems = (stashPicker.rawStash || []).filter(
      (r) => r.tier === tier,
    );
    stashPicker.activeItems = window
      .supabaseWatchlistTierItemsInOrder(tier)
      .filter((r) => r.position);
  }

  // --- Rendering UI ---

  function renderModeTabs() {
    return `<nav class="merge-mode-tabs" role="tablist" aria-label="Merge mode">
      <button type="button" role="tab" class="merge-tab ${mode === "watchlist" ? "is-active" : ""}" data-merge-mode="watchlist">Watchlist</button>
      <button type="button" role="tab" class="merge-tab ${mode === "stash" ? "is-active" : ""}" data-merge-mode="stash">Watchlist Stash</button>
      <button type="button" role="tab" class="merge-tab ${mode === "rewatchlist" ? "is-active" : ""}" data-merge-mode="rewatchlist">Rewatchlist</button>
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

    let blocks = window.watchlistOrderingBlocks(watchlistPicker.tier);
    let pendingShelves = window
      .watchlistOrderingShelves(watchlistPicker.tier)
      .filter((shelf) => !shelf.confirmed);

    let availableDecades = [
      ...new Set(
        blocks.flatMap((b) =>
          b.years
            .filter((y) => y > 0)
            .map((y) =>
              window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`,
            ),
        ),
      ),
    ].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (
      watchlistPicker.decade &&
      !availableDecades.includes(watchlistPicker.decade)
    ) {
      watchlistPicker.decade = "";
    }

    let decadeOptions =
      `<option value="">All decades (${blocks.length} groups)</option>` +
      availableDecades
        .map((dec) => {
          let decBlocks = blocks.filter((b) =>
            b.years.some(
              (y) =>
                (window.getDecadeKey
                  ? window.getDecadeKey(y)
                  : `${Math.floor(y / 10) * 10}s`) === dec,
            ),
          );
          let selected = dec === watchlistPicker.decade ? " selected" : "";
          let isComplete =
            decBlocks.length === 1 && decBlocks[0].isDecadeComplete;
          let statusText = isComplete
            ? " · Complete"
            : ` · ${decBlocks.length} groups`;
          return `<option value="${escape(dec)}"${selected}>${escape(dec)}${statusText}</option>`;
        })
        .join("");

    let focusedBlocks = watchlistPicker.decade
      ? blocks.filter((b) =>
          b.years.some(
            (y) =>
              (window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`) === watchlistPicker.decade,
          ),
        )
      : blocks;

    let chipsHtml = focusedBlocks
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
        let decadeBadge = b.isDecadeComplete
          ? `<span class="watchlist-merge-decade-badge" title="Covers all films in ${escape(b.completeDecades.join(", "))} for this tier">${escape(b.completeDecades.join(", "))} complete</span>`
          : "";
        let splitBtn = !b.isSingle
          ? `<button type="button" class="watchlist-merge-block-split" data-merge-split-block="${escape(b.id)}" aria-label="Split ${escape(b.label)} into single years">×</button>`
          : "";
        return `<span class="watchlist-merge-block-chip${activeClass}">${roleBadge}<strong class="watchlist-merge-block-label">${escape(b.label)}</strong> <span class="watchlist-merge-block-count">(${b.count})</span>${decadeBadge}${splitBtn}</span>`;
      })
      .join("");

    if (!focusedBlocks.length) {
      chipsHtml = `<p class="setup-year-section-empty">No ${escape(watchlistPicker.tier)} films in ${escape(watchlistPicker.decade)}.</p>`;
    }

    let blockOptionsA = focusedBlocks
      .map((b) => {
        let selected = b.id === watchlistPicker.blockAId ? " selected" : "";
        return `<option value="${escape(b.id)}"${selected}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let blockOptionsB = focusedBlocks
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

    let { pairs, remainder } = window.suggestShelfMergePairs(focusedBlocks);

    let suggestedHtml = "";
    if (pairs.length > 0) {
      let pairsListHtml = pairs
        .map((p, idx) => {
          return `<li class="watchlist-merge-suggested-item">
            <div class="watchlist-merge-suggested-item-info">
              <span class="watchlist-merge-pair-number">${idx + 1}</span>
              <strong class="watchlist-merge-block-label">${escape(p.blockA.label)}</strong>
              <span class="watchlist-merge-block-count">(${p.blockA.count})</span>
              <span class="watchlist-merge-pair-sep">&amp;</span>
              <strong class="watchlist-merge-block-label">${escape(p.blockB.label)}</strong>
              <span class="watchlist-merge-block-count">(${p.blockB.count})</span>
            </div>
            <button type="button" class="watchlist-merge-text-action" data-merge-pair-index="${idx}"${canEdit ? "" : " disabled"}>Merge this pair</button>
          </li>`;
        })
        .join("");

      let remainderHtml = remainder
        ? `<p class="watchlist-merge-suggested-remainder">Lone group: <strong>${escape(remainder.label)}</strong> (${remainder.count} films) · awaits next pass</p>`
        : "";

      let pairingTitle = watchlistPicker.decade
        ? `Suggested pairings (${escape(watchlistPicker.decade)})`
        : "Suggested pairings";

      suggestedHtml = `<div class="watchlist-merge-suggested-card">
        <div class="watchlist-merge-suggested-header">
          <div>
            <span class="watchlist-merge-blocks-title">${pairingTitle}</span>
            <p class="watchlist-merge-suggested-meta">${pairs.length === 1 ? "1 pair ready to merge" : `${pairs.length} pairs ready to merge`}</p>
          </div>
          <button type="button" class="sort-order-button" data-merge-start-queue${canEdit ? "" : " disabled"}>Merge suggested pairs (${pairs.length})</button>
        </div>
        <ol class="watchlist-merge-suggested-list">${pairsListHtml}</ol>
        ${remainderHtml}
      </div>`;
    } else if (focusedBlocks.length === 1 && watchlistPicker.decade) {
      let singleB = focusedBlocks[0];
      let completeMsg = singleB.isDecadeComplete
        ? `<strong>${escape(watchlistPicker.decade)} complete</strong> · 1 ordered group includes all films in this decade (<strong>${escape(singleB.label)}</strong>).`
        : `1 ordered group for ${escape(watchlistPicker.decade)} (<strong>${escape(singleB.label)}</strong>).`;
      suggestedHtml = `<div class="watchlist-merge-suggested-card watchlist-merge-suggested-card--complete">
        <p class="watchlist-merge-complete-note">${completeMsg}</p>
      </div>`;
    } else if (blocks.length === 1) {
      suggestedHtml = `<div class="watchlist-merge-suggested-card watchlist-merge-suggested-card--complete">
        <p class="watchlist-merge-complete-note">1 ordered group · All candidate groups for this tier are united into a single order.</p>
      </div>`;
    }

    let customPairHtml =
      focusedBlocks.length >= 2
        ? `<details class="watchlist-merge-custom-details">
        <summary class="watchlist-merge-custom-summary">Or choose custom pair</summary>
        <div class="watchlist-merge-scopes">
          <label>Group A
            <select data-merge-block="a">${blockOptionsA}</select>
          </label>
          <label>Group B
            <select data-merge-block="b">${blockOptionsB}</select>
          </label>
        </div>
        <p class="watchlist-merge-scope-count">Group A: ${listA.length} films · Group B: ${listB.length} films</p>
        <button type="button" class="sort-order-button" data-merge-start${validPair && canEdit ? "" : " disabled"}>Start custom merge</button>
      </details>`
        : "";

    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <div class="watchlist-merge-scopes">
        <label>Interest tier
          <select data-merge-watchlist-tier>${tierOptions}</select>
        </label>
        ${
          availableDecades.length
            ? `<label>Decade focus
          <select data-merge-watchlist-decade>${decadeOptions}</select>
        </label>`
            : ""
        }
      </div>

      <div class="watchlist-merge-blocks-overview">
        <div class="watchlist-merge-blocks-header">
          <span class="watchlist-merge-blocks-title">Candidate blocks${watchlistPicker.decade ? ` (${escape(watchlistPicker.decade)})` : " (merge sort)"}</span>
          ${watchlistPicker.decade ? '<button type="button" class="watchlist-merge-text-action" data-merge-clear-decade>Show all decades</button>' : ""}
          <a class="sort-order-button" href="rankings.html?category=watchlist">Order year shelves</a>
          ${focusedBlocks.some((block) => !block.isSingle) ? '<button type="button" class="watchlist-merge-text-action" data-merge-reset-blocks>Reset to single years</button>' : ""}
        </div>
        <div class="watchlist-merge-blocks-chips">${chipsHtml}</div>
      </div>

      <p>${pendingShelves.reduce((sum, shelf) => sum + shelf.items.length, 0)} tiered films awaiting year ordering · ${blocks.length} ordered groups</p>
      ${pendingShelves.length ? `<p>Order these shelves before merging: ${pendingShelves.map((shelf) => `<a href="${escape(window.watchlistYearOrderUrl(shelf.year, watchlistPicker.tier))}">${escape(shelf.year || "Unknown year")} (${shelf.items.length})</a>`).join(" · ")}</p>` : ""}
      ${blocks.length < 2 && !blocks.length ? "<p>Confirm more year shelves to merge two groups. A single completed group needs no further merge.</p>" : ""}
      ${suggestedHtml}
      <p class="watchlist-merge-rule-note">Interest tier guard rail active: comparisons only occur between films with the same exact tier refinement (e.g. S+, S, S-). Shelves with only one group auto-pass.</p>
      ${customPairHtml}
    </section>`;
  }

  function renderStashSetup() {
    let availableTiers = (
      window.watchlistExactTiers ? window.watchlistExactTiers() : []
    ).filter((t) => {
      let stashedCount = (stashPicker.rawStash || []).filter(
        (r) => r.tier === t,
      ).length;
      let activeCount = window
        .supabaseWatchlistTierItemsInOrder(t)
        .filter((r) => r.position).length;
      return stashedCount > 0 || activeCount > 0;
    });
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    let stashedCountTotal = (stashPicker.rawStash || []).length;
    let activeRankedCountTotal = (
      window.getSupabaseWorkspace()?.watchlist || []
    ).filter((r) => !r.is_stashed && r.position && r.tier).length;

    if (!availableTiers.length) {
      return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
        <div class="watchlist-merge-suggested-card">
          <h2>No stashed rankings yet</h2>
          <p>When you finish ranking a batch of filmographies, you can <strong>stash</strong> your current rankings to freeze them and start clean on your next batch.</p>
          <p>You have no active ranked films to stash yet. Rank some films in <a href="rankings.html?category=watchlist">Watchlist Rankings</a> first.</p>
        </div>
      </section>`;
    }

    if (!stashPicker.tier || !availableTiers.includes(stashPicker.tier)) {
      stashPicker.tier = availableTiers[0];
    }

    let tierOptions = availableTiers
      .map((t) => {
        let stashedCount = (stashPicker.rawStash || []).filter(
          (r) => r.tier === t,
        ).length;
        let activeCount = window
          .supabaseWatchlistTierItemsInOrder(t)
          .filter((r) => r.position).length;
        let selected = t === stashPicker.tier ? " selected" : "";
        return `<option value="${escape(t)}"${selected}>Tier ${escape(t)} (${stashedCount} stashed · ${activeCount} new ranked)</option>`;
      })
      .join("");

    updateStashPickerItems();
    let { stashItems, activeItems, tier } = stashPicker;
    let pendingUnranked = window
      .supabaseWatchlistTierItemsInOrder(tier)
      .filter((r) => !r.position).length;
    let validPair =
      stashItems.length > 0 &&
      (activeItems.length > 0 || pendingUnranked === 0);

    let actionButtonHtml = "";
    if (stashItems.length > 0 && activeItems.length > 0) {
      actionButtonHtml = `<button type="button" class="sort-order-button" data-merge-start${validPair && canEdit ? "" : " disabled"}>Start pop merge</button>`;
    } else if (activeItems.length > 0) {
      actionButtonHtml = `<button type="button" class="sort-order-button" data-merge-stash-tier-btn${canEdit && !stashPicker.isStashing ? "" : " disabled"}>${stashPicker.isStashing ? "Stashing..." : `Stash Tier ${escape(tier)} (${activeItems.length} films)`}</button>`;
    }

    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <div class="watchlist-merge-scopes">
        <label>Tier grade to merge / stash
          <select data-merge-stash-tier>${tierOptions}</select>
        </label>
      </div>

      <div class="watchlist-merge-suggested-card">
        <div class="watchlist-merge-suggested-header">
          <div>
            <span class="watchlist-merge-blocks-title">Tier ${escape(tier)}</span>
            <p class="watchlist-merge-suggested-meta">
              <strong>${stashItems.length} stashed films</strong> (Batch 1) &amp;
              <strong>${activeItems.length} new ranked films</strong> (Batch 2)
            </p>
          </div>
          ${actionButtonHtml}
        </div>

        ${
          pendingUnranked > 0
            ? `
          <p class="watchlist-merge-rule-note" style="color: var(--color-warning, #d97706);">
            Notice: ${pendingUnranked} new films in Tier ${escape(tier)} are unranked.
            <a href="rankings.html?category=watchlist&tier=${escape(tier)}">Rank them first</a> before merging, or proceed to merge existing ranked films.
          </p>
        `
            : ""
        }

        <p class="watchlist-merge-rule-note">
          Two-pointer pop merge: compares the head of the stashed list against the head of the new batch.
          When one list runs out, remaining films auto-drain with zero extra clicks.
        </p>
      </div>

      <div class="dialog-actions" style="margin-top: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.75rem;">
        ${
          activeItems.length > 0 && stashItems.length > 0
            ? `<button type="button" class="watchlist-merge-text-action" data-merge-stash-tier-btn${canEdit && !stashPicker.isStashing ? "" : " disabled"}>Stash Tier ${escape(tier)} (${activeItems.length})</button>`
            : ""
        }
        ${
          activeRankedCountTotal > 0
            ? `<button type="button" class="watchlist-merge-text-action" data-merge-stash-all${canEdit && !stashPicker.isStashing ? "" : " disabled"}>${stashPicker.isStashing ? "Stashing all..." : `Stash all current rankings (${activeRankedCountTotal})`}</button>`
            : ""
        }
        ${
          stashItems.length > 0
            ? `<button type="button" class="watchlist-merge-text-action" data-merge-unstash-tier${canEdit && !stashPicker.isUnstashing ? "" : " disabled"}>Unstash this tier</button>`
            : ""
        }
        ${
          stashedCountTotal > 0
            ? `<button type="button" class="watchlist-merge-text-action" data-merge-unstash-all${canEdit && !stashPicker.isUnstashing ? "" : " disabled"}>Unstash all</button>`
            : ""
        }
      </div>
    </section>`;
  }

  function renderRewatchlistSetup() {
    let availableTiers = window.supabaseRewatchTiersWithItems();
    if (!availableTiers.length) {
      return `<div class="detail-empty">
        <h2>Nothing to merge yet</h2>
        <p>You need at least two items in the same interest tier to merge rankings.</p>
        <a href="period.html?view=rewatch" class="sort-order-button">Back to rewatchlist</a>
      </div>`;
    }

    let tierOptions = availableTiers
      .map((t) => {
        let count = window.supabaseRewatchTierItemsInOrder(t).length;
        let selected = t === rewatchlistPicker.tier ? " selected" : "";
        return `<option value="${escape(t)}"${selected}>Tier ${escape(t)} (${count} films)</option>`;
      })
      .join("");

    let blocks = window.rewatchOrderingBlocks(rewatchlistPicker.tier);
    let pendingShelves = window
      .rewatchOrderingShelves(rewatchlistPicker.tier)
      .filter((shelf) => !shelf.confirmed);

    let availableDecades = [
      ...new Set(
        blocks.flatMap((b) =>
          b.years
            .filter((y) => y > 0)
            .map((y) =>
              window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`,
            ),
        ),
      ),
    ].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (
      rewatchlistPicker.decade &&
      !availableDecades.includes(rewatchlistPicker.decade)
    ) {
      rewatchlistPicker.decade = "";
    }

    let decadeOptions =
      `<option value="">All decades (${blocks.length} groups)</option>` +
      availableDecades
        .map((dec) => {
          let decBlocks = blocks.filter((b) =>
            b.years.some(
              (y) =>
                (window.getDecadeKey
                  ? window.getDecadeKey(y)
                  : `${Math.floor(y / 10) * 10}s`) === dec,
            ),
          );
          let selected = dec === rewatchlistPicker.decade ? " selected" : "";
          let isComplete =
            decBlocks.length === 1 && decBlocks[0].isDecadeComplete;
          let statusText = isComplete
            ? " · Complete"
            : ` · ${decBlocks.length} groups`;
          return `<option value="${escape(dec)}"${selected}>${escape(dec)}${statusText}</option>`;
        })
        .join("");

    let focusedBlocks = rewatchlistPicker.decade
      ? blocks.filter((b) =>
          b.years.some(
            (y) =>
              (window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`) === rewatchlistPicker.decade,
          ),
        )
      : blocks;

    let chipsHtml = focusedBlocks
      .map((b) => {
        let role =
          b.id === rewatchlistPicker.blockAId
            ? "Group A"
            : b.id === rewatchlistPicker.blockBId
              ? "Group B"
              : "";
        let roleBadge = role
          ? `<span class="watchlist-merge-chip-role">${escape(role)}</span>`
          : "";
        let activeClass =
          b.id === rewatchlistPicker.blockAId
            ? " watchlist-merge-block-chip--group-a"
            : b.id === rewatchlistPicker.blockBId
              ? " watchlist-merge-block-chip--group-b"
              : "";
        let decadeBadge = b.isDecadeComplete
          ? `<span class="watchlist-merge-decade-badge" title="Covers all films in ${escape(b.completeDecades.join(", "))} for this tier">${escape(b.completeDecades.join(", "))} complete</span>`
          : "";
        let splitBtn = !b.isSingle
          ? `<button type="button" class="watchlist-merge-block-split" data-merge-split-block="${escape(b.id)}" aria-label="Split ${escape(b.label)} into single years">×</button>`
          : "";
        return `<span class="watchlist-merge-block-chip${activeClass}">${roleBadge}<strong class="watchlist-merge-block-label">${escape(b.label)}</strong> <span class="watchlist-merge-block-count">(${b.count})</span>${decadeBadge}${splitBtn}</span>`;
      })
      .join("");

    if (!focusedBlocks.length) {
      chipsHtml = `<p class="setup-year-section-empty">No ${escape(rewatchlistPicker.tier)} films in ${escape(rewatchlistPicker.decade)}.</p>`;
    }

    let blockOptionsA = focusedBlocks
      .map((b) => {
        let selected = b.id === rewatchlistPicker.blockAId ? " selected" : "";
        return `<option value="${escape(b.id)}"${selected}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let blockOptionsB = focusedBlocks
      .map((b) => {
        let selected = b.id === rewatchlistPicker.blockBId ? " selected" : "";
        let disabled = b.id === rewatchlistPicker.blockAId ? " disabled" : "";
        return `<option value="${escape(b.id)}"${selected}${disabled}>${escape(b.label)} (${b.count} films)</option>`;
      })
      .join("");

    let { listA, listB } = effectiveRewatchlistScopeItems();
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    let validPair =
      rewatchlistPicker.blockAId &&
      rewatchlistPicker.blockBId &&
      rewatchlistPicker.blockAId !== rewatchlistPicker.blockBId &&
      listA.length > 0 &&
      listB.length > 0;

    let { pairs, remainder } = window.suggestShelfMergePairs(focusedBlocks);
    let suggestedHtml = "";
    if (pairs.length > 0) {
      let pairsListHtml = pairs
        .map((p, idx) => {
          return `<li class="watchlist-merge-suggested-item">
            <div class="watchlist-merge-suggested-item-info">
              <span class="watchlist-merge-pair-number">${idx + 1}</span>
              <strong class="watchlist-merge-block-label">${escape(p.blockA.label)}</strong>
              <span class="watchlist-merge-block-count">(${p.blockA.count})</span>
              <span class="watchlist-merge-pair-sep">&amp;</span>
              <strong class="watchlist-merge-block-label">${escape(p.blockB.label)}</strong>
              <span class="watchlist-merge-block-count">(${p.blockB.count})</span>
            </div>
            <button type="button" class="watchlist-merge-text-action" data-merge-pair-index="${idx}"${canEdit ? "" : " disabled"}>Merge this pair</button>
          </li>`;
        })
        .join("");

      let remainderHtml = remainder
        ? `<p class="watchlist-merge-suggested-remainder">Lone group: <strong>${escape(remainder.label)}</strong> (${remainder.count} films) · awaits next pass</p>`
        : "";

      let pairingTitle = rewatchlistPicker.decade
        ? `Suggested pairings (${escape(rewatchlistPicker.decade)})`
        : "Suggested pairings";

      suggestedHtml = `<div class="watchlist-merge-suggested-card">
        <div class="watchlist-merge-suggested-header">
          <div>
            <span class="watchlist-merge-blocks-title">${pairingTitle}</span>
            <p class="watchlist-merge-suggested-meta">${pairs.length === 1 ? "1 pair ready to merge" : `${pairs.length} pairs ready to merge`}</p>
          </div>
          <button type="button" class="sort-order-button" data-merge-start-queue${canEdit ? "" : " disabled"}>Merge suggested pairs (${pairs.length})</button>
        </div>
        <ol class="watchlist-merge-suggested-list">${pairsListHtml}</ol>
        ${remainderHtml}
      </div>`;
    } else if (focusedBlocks.length === 1 && rewatchlistPicker.decade) {
      let singleB = focusedBlocks[0];
      let completeMsg = singleB.isDecadeComplete
        ? `<strong>${escape(rewatchlistPicker.decade)} complete</strong> · 1 ordered group includes all films in this decade (<strong>${escape(singleB.label)}</strong>).`
        : `1 ordered group for ${escape(rewatchlistPicker.decade)} (<strong>${escape(singleB.label)}</strong>).`;
      suggestedHtml = `<div class="watchlist-merge-suggested-card watchlist-merge-suggested-card--complete">
        <p class="watchlist-merge-complete-note">${completeMsg}</p>
      </div>`;
    } else if (blocks.length === 1) {
      suggestedHtml = `<div class="watchlist-merge-suggested-card watchlist-merge-suggested-card--complete">
        <p class="watchlist-merge-complete-note">1 ordered group · All candidate groups for this tier are united into a single order.</p>
      </div>`;
    }

    let customPairHtml =
      focusedBlocks.length >= 2
        ? `<details class="watchlist-merge-custom-details">
        <summary class="watchlist-merge-custom-summary">Or choose custom pair</summary>
        <div class="watchlist-merge-scopes">
          <label>Group A
            <select data-merge-block="a">${blockOptionsA}</select>
          </label>
          <label>Group B
            <select data-merge-block="b">${blockOptionsB}</select>
          </label>
        </div>
        <p class="watchlist-merge-scope-count">Group A: ${listA.length} films · Group B: ${listB.length} films</p>
        <button type="button" class="sort-order-button" data-merge-start${validPair && canEdit ? "" : " disabled"}>Start custom merge</button>
      </details>`
        : "";

    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <div class="watchlist-merge-scopes">
        <label>Interest tier
          <select data-merge-rewatchlist-tier>${tierOptions}</select>
        </label>
        ${
          availableDecades.length
            ? `<label>Decade focus
          <select data-merge-rewatchlist-decade>${decadeOptions}</select>
        </label>`
            : ""
        }
      </div>

      <div class="watchlist-merge-blocks-overview">
        <div class="watchlist-merge-blocks-header">
          <span class="watchlist-merge-blocks-title">Candidate blocks${rewatchlistPicker.decade ? ` (${escape(rewatchlistPicker.decade)})` : " (merge sort)"}</span>
          ${rewatchlistPicker.decade ? '<button type="button" class="watchlist-merge-text-action" data-merge-clear-decade>Show all decades</button>' : ""}
          <a class="sort-order-button" href="rankings.html?category=rewatchlist">Order year shelves</a>
          ${focusedBlocks.some((block) => !block.isSingle) ? '<button type="button" class="watchlist-merge-text-action" data-merge-reset-blocks>Reset to single years</button>' : ""}
        </div>
        <div class="watchlist-merge-blocks-chips">${chipsHtml}</div>
      </div>

      <p>${pendingShelves.reduce((sum, shelf) => sum + shelf.items.length, 0)} tiered films awaiting year ordering · ${blocks.length} ordered groups</p>
      ${pendingShelves.length ? `<p>Order these shelves before merging: ${pendingShelves.map((shelf) => `<a href="${escape(window.periodRankingPageUrl("year", shelf.year, "rewatchlist", rewatchlistPicker.tier))}">${escape(shelf.year || "Unknown year")} (${shelf.items.length})</a>`).join(" · ")}</p>` : ""}
      ${blocks.length < 2 && !blocks.length ? "<p>Confirm more year shelves to merge two groups. A single completed group needs no further merge.</p>" : ""}
      ${suggestedHtml}
      <p class="watchlist-merge-rule-note">Interest tier guard rail active: comparisons only occur between films with the same exact tier refinement (e.g. S+, S, S-). Shelves with only one group auto-pass.</p>
      ${customPairHtml}
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

    let { pairs, remainder } = window.suggestShelfMergePairs(blocks);

    let suggestedHtml = "";
    if (pairs.length > 0) {
      let pairsListHtml = pairs
        .map((p, idx) => {
          return `<li class="watchlist-merge-suggested-item">
            <div class="watchlist-merge-suggested-item-info">
              <span class="watchlist-merge-pair-number">${idx + 1}</span>
              <strong class="watchlist-merge-block-label">${escape(p.blockA.label)}</strong>
              <span class="watchlist-merge-block-count">(${p.blockA.count})</span>
              <span class="watchlist-merge-pair-sep">&amp;</span>
              <strong class="watchlist-merge-block-label">${escape(p.blockB.label)}</strong>
              <span class="watchlist-merge-block-count">(${p.blockB.count})</span>
            </div>
            <button type="button" class="watchlist-merge-text-action" data-merge-pair-index="${idx}"${canEdit ? "" : " disabled"}>Merge this pair</button>
          </li>`;
        })
        .join("");

      let remainderHtml = remainder
        ? `<p class="watchlist-merge-suggested-remainder">Lone group: <strong>${escape(remainder.label)}</strong> (${remainder.count} films) · awaits next pass</p>`
        : "";

      suggestedHtml = `<div class="watchlist-merge-suggested-card">
        <div class="watchlist-merge-suggested-header">
          <div>
            <span class="watchlist-merge-blocks-title">Suggested pairings</span>
            <p class="watchlist-merge-suggested-meta">${pairs.length === 1 ? "1 pair ready to merge" : `${pairs.length} pairs ready to merge`}</p>
          </div>
          <button type="button" class="sort-order-button" data-merge-start-queue${canEdit ? "" : " disabled"}>Merge suggested pairs (${pairs.length})</button>
        </div>
        <ol class="watchlist-merge-suggested-list">${pairsListHtml}</ol>
        ${remainderHtml}
      </div>`;
    } else if (blocks.length === 1) {
      suggestedHtml = `<div class="watchlist-merge-suggested-card watchlist-merge-suggested-card--complete">
        <p class="watchlist-merge-complete-note">1 ordered group · All candidate groups in this scope are united into a single order.</p>
      </div>`;
    }

    let customPairHtml =
      blocks.length >= 2
        ? `<details class="watchlist-merge-custom-details">
        <summary class="watchlist-merge-custom-summary">Or choose custom pair</summary>
        <div class="watchlist-merge-scopes">
          <label>Group A
            <select data-merge-block="a">${blockOptionsA}</select>
          </label>
          <label>Group B
            <select data-merge-block="b">${blockOptionsB}</select>
          </label>
        </div>
        <p class="watchlist-merge-scope-count">Group A: ${listA.length} films · Group B: ${listB.length} films</p>
        <button type="button" class="sort-order-button" data-merge-start${validPair && canEdit ? "" : " disabled"}>Start custom merge</button>
      </details>`
        : "";

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

      ${suggestedHtml}
      <p class="watchlist-merge-rule-note">Rating guard rail active: comparisons only occur between films with the same exact rating. Shelves with only one group auto-pass.</p>
      ${customPairHtml}
    </section>`;
  }

  async function chooseCollection(kind, id) {
    try {
      let rankKind = kind === "director" ? "person" : "tag";
      let loaded = await window.loadSupabaseLocalRankCollectionFilms(
        rankKind,
        id,
      );
      if (!loaded) throw new Error("Collection not found.");
      let films = [...loaded.films].sort((left, right) =>
        String(left.title).localeCompare(String(right.title)),
      );
      if (kind === "director") {
        films.forEach((film) => {
          if (film) film.director = loaded.name;
        });
      }
      let storedOrder = await window.loadSupabaseLocalRankOrder(rankKind, id);
      let filmById = new Map(films.map((film) => [film.id, film]));
      collectionState.orderedFilmIds = window
        .mergeSupabaseLocalRankOrder(
          storedOrder,
          films.map((film) => film.id),
        )
        .map((filmId) => filmById.get(filmId));
      collectionState.collection = { kind, id, name: loaded.name };
      step = "setup";
      session = null;
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
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

  function resolveFilmDirector(film, row = {}) {
    let f = film || row.films || row.film || row;
    if (!f) return "";
    if (typeof f.director === "string" && f.director.trim()) {
      return f.director.trim();
    }
    if (Array.isArray(f.directors) && f.directors.length) {
      return f.directors.filter(Boolean).join(", ");
    }
    if (Array.isArray(f.credits)) {
      let directorCredits = f.credits.filter((c) => c.role === "director");
      let names = directorCredits
        .map((c) => c.people?.name || c.name)
        .filter(Boolean);
      if (names.length) return names.join(", ");
    }
    let filmId = f.id || f.supabaseFilmId || row.film_id;
    if (filmId && filmDirectors.has(filmId)) {
      return filmDirectors.get(filmId);
    }
    let stateFilm = filmId && window.state?.filmsById?.[filmId];
    if (stateFilm) {
      if (typeof stateFilm.director === "string" && stateFilm.director.trim()) {
        return stateFilm.director.trim();
      }
      if (Array.isArray(stateFilm.directors) && stateFilm.directors.length) {
        return stateFilm.directors.filter(Boolean).join(", ");
      }
    }
    if (
      collectionState.collection?.kind === "director" &&
      collectionState.collection.name
    ) {
      return collectionState.collection.name;
    }
    return "";
  }

  async function ensureFilmDirectors(filmIds) {
    let missingIds = [...new Set(filmIds)].filter(
      (id) => id && !filmDirectors.has(id),
    );
    if (!missingIds.length) return;
    try {
      if (window.loadSupabaseFilmDirectors) {
        let loaded = await window.loadSupabaseFilmDirectors(missingIds);
        if (loaded instanceof Map) {
          for (let [id, names] of loaded.entries()) {
            filmDirectors.set(
              id,
              Array.isArray(names) ? names.join(", ") : names,
            );
          }
          // Films the query returned no credits for must still be marked
          // resolved, or every render re-triggers the same fetch forever.
          for (let id of missingIds) {
            if (!filmDirectors.has(id)) filmDirectors.set(id, "");
          }
        }
      }
    } catch (err) {
      // Non-fatal fallback
    }
  }

  function triggerDirectorFetch(filmId) {
    if (
      !filmId ||
      filmDirectors.has(filmId) ||
      pendingDirectorFetches.has(filmId)
    )
      return;
    pendingDirectorFetches.add(filmId);
    ensureFilmDirectors([filmId])
      .then(() => {
        pendingDirectorFetches.delete(filmId);
        if (step === "compare") render();
      })
      .catch(() => {
        pendingDirectorFetches.delete(filmId);
      });
  }

  function renderCompareCard(row, side, meta = {}) {
    let film = row.films || row.film || row;
    let posterUrl = film.poster_url || film.poster?.url;
    let posterHtml = posterUrl
      ? `<figure class="film-poster film-poster--card"><img src="${escape(posterUrl)}" alt="Poster for ${escape(film.title || "film")}" loading="lazy" decoding="async"></figure>`
      : `<figure class="film-poster film-poster--card film-poster--fallback"><div class="film-poster-placeholder-art" aria-hidden="true">🎬</div></figure>`;
    let remaining = meta.remaining;
    let upcoming = meta.upcoming || [];
    let groupLabel =
      mode === "stash"
        ? side === "a"
          ? "Stashed Ranking"
          : "New Batch"
        : side === "a"
          ? "Group A"
          : "Group B";
    let keyHint = side === "a" ? "←" : "→";
    let stackClass = remaining > 1 ? "watchlist-merge-deck-stack" : "";
    let countLabel = Number.isInteger(remaining)
      ? window.uiCount?.(remaining, "film", "films") || `${remaining} films`
      : "";

    let ratingHtml = "";
    if (mode === "watched" && row.rating) {
      let renderedStars = window.renderFilmRating?.(row) || `${row.rating}★`;
      ratingHtml = `<span class="watched-merge-card-rating">${escape(renderedStars)}</span>`;
    } else if ((mode === "watchlist" || mode === "stash") && row.tier) {
      ratingHtml = window.renderWatchlistTierBadge
        ? window.renderWatchlistTierBadge(row.tier, {
            escape,
            modifier: row.tier_modifier,
          })
        : "";
    } else if (mode === "rewatchlist" && row.rewatch_tier) {
      ratingHtml = window.renderWatchlistTierBadge
        ? window.renderWatchlistTierBadge(row.rewatch_tier, {
            escape,
            modifier: row.rewatch_tier_modifier,
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

    let director = resolveFilmDirector(film, row);
    let filmId = film.id || film.supabaseFilmId || row.film_id;
    if (!director && filmId) triggerDirectorFetch(filmId);
    let directorHtml = director
      ? `<div class="watchlist-merge-card-director" title="${escape(director)}">${escape(ui("by"))} ${escape(director)}</div>`
      : "";

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
        ${directorHtml}
      </div>
      <div class="watchlist-merge-card-footer">
        <span class="watchlist-merge-pick-cue"><kbd>${keyHint}</kbd> Choose</span>
      </div>
    </article>`;
  }

  function renderCompareStep() {
    let queueIndicator = "";
    if (pairQueue && pairQueue.pairs?.length > 1) {
      let currentNum = pairQueue.currentIndex + 1;
      let totalNum = pairQueue.pairs.length;
      let currentPair = pairQueue.pairs[pairQueue.currentIndex];
      queueIndicator = `<div class="merge-queue-indicator">
        <span class="merge-queue-badge">Pair ${currentNum} of ${totalNum}</span>
        <span class="merge-queue-names">${escape(currentPair?.labelA || "")} &amp; ${escape(currentPair?.labelB || "")}</span>
      </div>`;
    }
    let shelfHeader = "";
    if (mode === "stash") {
      let progress =
        session.maxComparisons > 0
          ? `Comparison ${session.comparisonCount + 1} of max ${session.maxComparisons}`
          : "Final comparison";
      shelfHeader = `<div class="merge-shelf-indicator">
        <span class="merge-shelf-badge">Tier ${escape(session.tier)} Pop Merge · ${escape(progress)}</span>
        <span class="merge-shelf-hint">Auto-drains remaining tail when either queue empties</span>
      </div>`;
    } else if (
      (mode === "watched" || mode === "watchlist" || mode === "rewatchlist") &&
      session?.shelfLabel
    ) {
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
    return `${queueIndicator}${shelfHeader}${window.renderMergeCompareStep(session, renderCompareCard, { escape })}`;
  }

  function renderPreview() {
    let queueIndicator = "";
    if (pairQueue && pairQueue.pairs?.length > 1) {
      let currentNum = pairQueue.currentIndex + 1;
      let totalNum = pairQueue.pairs.length;
      let currentPair = pairQueue.pairs[pairQueue.currentIndex];
      queueIndicator = `<div class="merge-queue-indicator">
        <span class="merge-queue-badge">Pair ${currentNum} of ${totalNum}</span>
        <span class="merge-queue-names">${escape(currentPair?.labelA || "")} &amp; ${escape(currentPair?.labelB || "")}</span>
      </div>`;
    }

    let autopassNote =
      session?.history?.length === 0
        ? `<p class="watchlist-merge-autopass-note">All shelves auto-passed (non-overlapping tier or rating refinements).</p>`
        : "";

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
      ${queueIndicator}
      <h2>Merged order</h2>
      ${autopassNote}
      <p>This becomes the new relative order for these films; every other film keeps its existing position.</p>
      <ol class="watchlist-merge-preview-list">${itemsHtml}</ol>
      <div class="watchlist-merge-preview-actions">
        <button type="button" class="sort-order-button" data-merge-apply autofocus>Use this order</button>
        <button type="button" class="sort-order-button" data-merge-restart>Start over</button>
        <label class="watchlist-merge-auto-apply-label" title="Skip this confirmation screen for future merges">
          <input type="checkbox" data-merge-auto-apply ${autoApply ? "checked" : ""}> Auto-apply in future
        </label>
      </div>
    </section>`;
  }

  function renderDone() {
    let unitedNote = session?.unitedBlockLabel
      ? `<p class="watchlist-merge-united-note">United into candidate group <strong>${escape(session.unitedBlockLabel)}</strong>.</p>`
      : "";

    let backLink =
      mode === "watchlist" || mode === "stash"
        ? `<a href="period.html?view=watchlist" class="sort-order-button">Back to watchlist</a>`
        : mode === "rewatchlist"
          ? `<a href="period.html?view=rewatch" class="sort-order-button">Back to rewatchlist</a>`
          : mode === "watched"
            ? `<a href="period.html?type=${escape(watchedPicker.scopeType)}&key=${escape(watchedPicker.scopeKey)}" class="sort-order-button">Back to ${escape(watchedPicker.scopeKey)}</a>`
            : `<button type="button" class="sort-order-button" data-merge-back-collection>Back to collections</button>`;

    let actionsHtml;
    let statusNote = "";

    if (pairQueue && pairQueue.currentIndex + 1 < pairQueue.pairs.length) {
      let nextPair = pairQueue.pairs[pairQueue.currentIndex + 1];
      let nextIndex = pairQueue.currentIndex + 2;
      let totalCount = pairQueue.pairs.length;
      actionsHtml = `<button type="button" class="sort-order-button" data-merge-next-pair autofocus>Merge next pair: ${escape(nextPair.labelA)} &amp; ${escape(nextPair.labelB)} (${nextIndex} of ${totalCount}) →</button>
        <button type="button" class="sort-order-button" data-merge-again>Back to merge setup</button>
        ${backLink}`;
    } else if (pairQueue) {
      let remainingBlocks =
        mode === "watchlist"
          ? window.watchlistOrderingBlocks(watchlistPicker.tier)
          : mode === "rewatchlist"
            ? window.rewatchOrderingBlocks(rewatchlistPicker.tier)
            : mode === "watched"
              ? window.loadWatchedMergeBlocks(
                  watchedPicker.scopeType,
                  watchedPicker.scopeKey,
                )
              : [];
      let nextSuggested = window.suggestShelfMergePairs(remainingBlocks);
      if (nextSuggested.pairs.length > 0) {
        statusNote = `<p class="watchlist-merge-pass-complete">All suggested pairs in this pass merged. <strong>${remainingBlocks.length} groups remaining</strong>.</p>`;
        actionsHtml = `<button type="button" class="sort-order-button" data-merge-continue-next-pass autofocus>Continue with next suggested pairs (${nextSuggested.pairs.length} pairs) →</button>
          <button type="button" class="sort-order-button" data-merge-again>Back to merge setup</button>
          ${backLink}`;
      } else {
        statusNote = `<p class="watchlist-merge-all-complete">All candidate groups united! Tier ordering is complete.</p>`;
        actionsHtml = `${backLink}
          <button type="button" class="sort-order-button" data-merge-again>Back to merge setup</button>`;
      }
    } else {
      actionsHtml = `<button type="button" class="sort-order-button" data-merge-again>Merge next group</button>
        ${backLink}`;
    }

    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>Merged order applied</h2>
      <p>${escape(applyResult?.changed || session?.merged?.length || 0)} films reordered.</p>
      ${unitedNote}
      ${statusNote}
      <div class="watchlist-merge-done-actions">
        ${actionsHtml}
      </div>
    </section>`;
  }

  function render() {
    let finishRender = window.startOskarsPerformance?.("merge:render");
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
      } else if (mode === "stash") {
        body = renderStashSetup();
      } else if (mode === "rewatchlist") {
        body = renderRewatchlistSetup();
      } else if (mode === "watched") {
        body = renderWatchedSetup();
      } else {
        body = renderCollectionsSetup();
      }
    }

    container.innerHTML = `${header}${tabs}${body}`;
    finishRender?.();
  }

  // --- Interaction dispatches ---

  async function startMerge() {
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    if (!canEdit) return;

    if (mode === "stash") {
      updateStashPickerItems();
      let { stashItems, activeItems, tier } = stashPicker;
      if (!stashItems.length && !activeItems.length) return;
      let allItems = [...stashItems, ...activeItems];
      let filmIds = allItems
        .map((r) => (r.films || r.film || r)?.id || r.film_id)
        .filter(Boolean);
      await ensureFilmDirectors(filmIds);
      session = window.createWatchlistPopMergeSession(
        tier,
        stashItems,
        activeItems,
      );
      step = session.done ? "preview" : "compare";
      render();
      return;
    }

    if (mode === "watchlist") {
      let { listA, listB } = effectiveWatchlistScopeItems();
      if (!listA.length || !listB.length) return;
      let blocks = window.watchlistOrderingBlocks(watchlistPicker.tier);
      let blockA = blocks.find((b) => b.id === watchlistPicker.blockAId);
      let blockB = blocks.find((b) => b.id === watchlistPicker.blockBId);
      if (!blockA || !blockB) return;
      let filmIds = [...listA, ...listB]
        .map((r) => (r.films || r.film || r)?.id || r.film_id)
        .filter(Boolean);
      await ensureFilmDirectors(filmIds);
      session = window.createWatchlistShelfMergeSession
        ? window.createWatchlistShelfMergeSession(listA, listB)
        : window.createMergeSession(listA, listB);
      session.tier = watchlistPicker.tier;
      session.inputYears = [blockA.years, blockB.years];
      session.blockAId = watchlistPicker.blockAId;
      session.blockBId = watchlistPicker.blockBId;
      session.mergedYearSet = new Set([
        ...listA.map(window.watchlistOrderYear),
        ...listB.map(window.watchlistOrderYear),
      ]);
    } else if (mode === "rewatchlist") {
      let { listA, listB } = effectiveRewatchlistScopeItems();
      if (!listA.length || !listB.length) return;
      let blocks = window.rewatchOrderingBlocks(rewatchlistPicker.tier);
      let blockA = blocks.find((b) => b.id === rewatchlistPicker.blockAId);
      let blockB = blocks.find((b) => b.id === rewatchlistPicker.blockBId);
      if (!blockA || !blockB) return;
      let filmIds = [...listA, ...listB]
        .map((r) => (r.films || r.film || r)?.id || r.film_id)
        .filter(Boolean);
      await ensureFilmDirectors(filmIds);
      session = window.createRewatchShelfMergeSession
        ? window.createRewatchShelfMergeSession(listA, listB)
        : window.createMergeSession(listA, listB);
      session.tier = rewatchlistPicker.tier;
      session.inputYears = [blockA.years, blockB.years];
      session.blockAId = rewatchlistPicker.blockAId;
      session.blockBId = rewatchlistPicker.blockBId;
      session.mergedYearSet = new Set([
        ...listA.map(window.rewatchOrderYear),
        ...listB.map(window.rewatchOrderYear),
      ]);
    } else if (mode === "watched") {
      let { listA, listB } = effectiveWatchedScopeItems();
      if (!listA.length || !listB.length) return;
      let blocks = window.loadWatchedMergeBlocks(
        watchedPicker.scopeType,
        watchedPicker.scopeKey,
      );
      let blockA = blocks.find((b) => b.id === watchedPicker.blockAId);
      let blockB = blocks.find((b) => b.id === watchedPicker.blockBId);
      if (!blockA || !blockB) return;
      let filmIds = [...listA, ...listB]
        .map((r) => (r.films || r.film || r)?.id || r.film_id)
        .filter(Boolean);
      await ensureFilmDirectors(filmIds);
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
      let filmIds = films.map((f) => f.id).filter(Boolean);
      await ensureFilmDirectors(filmIds);
      session = window.createMergeSession(listA, listB);
    }

    step = session.done ? "preview" : "compare";
    render();
  }

  async function pick(side) {
    if (!session) return;
    if (mode === "stash") {
      window.pickStashMergeSide(session, side);
      if (session.done) {
        if (autoApply) {
          await applyMerge();
          return;
        }
        step = "preview";
      }
      render();
      return;
    }
    if (mode === "watched") {
      window.pickWatchedMergeSide(session, side);
    } else if (mode === "watchlist" || mode === "rewatchlist") {
      if (window.pickWatchlistMergeSide) {
        window.pickWatchlistMergeSide(session, side);
      } else {
        window.pickMergeSide(session, side);
      }
    } else {
      window.pickMergeSide(session, side);
    }
    if (session.done) {
      if (autoApply) {
        await applyMerge();
        return;
      }
      step = "preview";
    }
    render();
  }

  function undoLastPick() {
    if (!session || !session.history?.length) return;
    if (mode === "stash") {
      window.undoStashMergeChoice(session);
      step = "compare";
      render();
      return;
    }
    if (mode === "watched") {
      window.undoWatchedMergeChoice(session);
    } else if (mode === "watchlist" || mode === "rewatchlist") {
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
        await window.saveWatchlistOrdering(
          session.tier,
          [...session.mergedYearSet].sort((a, b) => a - b),
          session.merged,
          session.inputYears,
        );
        applyResult = { ok: true, changed: session.merged.length };
        let updatedBlocks = window.watchlistOrderingBlocks(session.tier);
        let unitedBlock = updatedBlocks.find((b) =>
          b.years.some((y) => session.mergedYearSet.has(y)),
        );
        if (unitedBlock) {
          session.unitedBlockLabel = unitedBlock.label;
          watchlistPicker.blockAId = unitedBlock.id;
          watchlistPicker.blockBId =
            updatedBlocks.find((b) => b.id !== unitedBlock.id)?.id || "";
        }
      } else if (mode === "stash") {
        let entries = window.allocateMergedPositions(session.mergedList);
        await window.saveSupabaseStashedWatchlistMerge(session.tier, entries);
        applyResult = { ok: true, changed: entries.length };
        await ensureStashPickerDefaults();
      } else if (mode === "rewatchlist") {
        await window.saveRewatchOrdering(
          session.tier,
          [...session.mergedYearSet].sort((a, b) => a - b),
          session.merged,
          session.inputYears,
        );
        applyResult = { ok: true, changed: session.merged.length };
        let updatedBlocks = window.rewatchOrderingBlocks(session.tier);
        let unitedBlock = updatedBlocks.find((b) =>
          b.years.some((y) => session.mergedYearSet.has(y)),
        );
        if (unitedBlock) {
          session.unitedBlockLabel = unitedBlock.label;
          rewatchlistPicker.blockAId = unitedBlock.id;
          rewatchlistPicker.blockBId =
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
        await window.setSupabaseLocalRankOrder(
          col.kind === "director" ? "person" : "tag",
          col.id,
          ids,
        );
        applyResult = { changed: ids.length };
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

  async function splitWatchlistGroups(blockId) {
    if (isMutating || !(window.oskarsCapabilities?.().canEdit ?? true)) return;
    isMutating = true;
    try {
      await window.splitWatchlistOrderingGroups(watchlistPicker.tier, blockId);
      ensureWatchlistPickerDefaults();
      render();
    } catch (error) {
      alert(error.message || String(error));
    } finally {
      isMutating = false;
    }
  }

  async function splitRewatchlistGroups(blockId) {
    if (isMutating || !(window.oskarsCapabilities?.().canEdit ?? true)) return;
    isMutating = true;
    try {
      await window.splitRewatchOrderingGroups(rewatchlistPicker.tier, blockId);
      ensureRewatchlistPickerDefaults();
      render();
    } catch (error) {
      alert(error.message || String(error));
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
      pairQueue = null;
      render();
      return;
    }

    // Auto-apply toggle
    let autoApplyCheckbox = event.target.closest("[data-merge-auto-apply]");
    if (autoApplyCheckbox) {
      autoApply = Boolean(autoApplyCheckbox.checked);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("oskars-merge-auto-apply", String(autoApply));
      }
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
      pairQueue = null;
      applyResult = null;
      if (mode === "watchlist") ensureWatchlistPickerDefaults();
      else if (mode === "stash") await ensureStashPickerDefaults();
      else if (mode === "rewatchlist") ensureRewatchlistPickerDefaults();
      else if (mode === "watched") ensureWatchedPickerDefaults();
      render();
      return;
    }

    // Queue progression actions
    if (event.target.closest("[data-merge-next-pair]")) {
      if (!pairQueue) return;
      pairQueue.currentIndex += 1;
      let nextPair = pairQueue.pairs[pairQueue.currentIndex];
      if (!nextPair) return;
      if (mode === "watchlist") {
        watchlistPicker.blockAId = nextPair.blockAId;
        watchlistPicker.blockBId = nextPair.blockBId;
      } else if (mode === "rewatchlist") {
        rewatchlistPicker.blockAId = nextPair.blockAId;
        rewatchlistPicker.blockBId = nextPair.blockBId;
      } else {
        watchedPicker.blockAId = nextPair.blockAId;
        watchedPicker.blockBId = nextPair.blockBId;
      }
      await startMerge();
      return;
    }

    if (event.target.closest("[data-merge-continue-next-pass]")) {
      let remainingBlocks =
        mode === "watchlist"
          ? window.watchlistOrderingBlocks(watchlistPicker.tier)
          : mode === "rewatchlist"
            ? window.rewatchOrderingBlocks(rewatchlistPicker.tier)
            : window.loadWatchedMergeBlocks(
                watchedPicker.scopeType,
                watchedPicker.scopeKey,
              );
      let { pairs } = window.suggestShelfMergePairs(remainingBlocks);
      if (!pairs.length) {
        step = "setup";
        pairQueue = null;
        render();
        return;
      }
      pairQueue = {
        pairs: pairs.map((p) => ({
          blockAId: p.blockA.id,
          blockBId: p.blockB.id,
          labelA: p.blockA.label,
          labelB: p.blockB.label,
        })),
        currentIndex: 0,
      };
      let first = pairQueue.pairs[0];
      if (mode === "watchlist") {
        watchlistPicker.blockAId = first.blockAId;
        watchlistPicker.blockBId = first.blockBId;
      } else if (mode === "rewatchlist") {
        rewatchlistPicker.blockAId = first.blockAId;
        rewatchlistPicker.blockBId = first.blockBId;
      } else {
        watchedPicker.blockAId = first.blockAId;
        watchedPicker.blockBId = first.blockBId;
      }
      await startMerge();
      return;
    }

    // Suggested pairings actions
    if (event.target.closest("[data-merge-start-queue]")) {
      let blocks =
        mode === "watchlist"
          ? window.watchlistOrderingBlocks(watchlistPicker.tier)
          : mode === "rewatchlist"
            ? window.rewatchOrderingBlocks(rewatchlistPicker.tier)
            : window.loadWatchedMergeBlocks(
                watchedPicker.scopeType,
                watchedPicker.scopeKey,
              );
      if (mode === "watchlist" && watchlistPicker.decade) {
        blocks = blocks.filter((b) =>
          b.years.some(
            (y) =>
              (window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`) === watchlistPicker.decade,
          ),
        );
      } else if (mode === "rewatchlist" && rewatchlistPicker.decade) {
        blocks = blocks.filter((b) =>
          b.years.some(
            (y) =>
              (window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`) === rewatchlistPicker.decade,
          ),
        );
      }
      let { pairs } = window.suggestShelfMergePairs(blocks);
      if (!pairs.length) return;
      pairQueue = {
        pairs: pairs.map((p) => ({
          blockAId: p.blockA.id,
          blockBId: p.blockB.id,
          labelA: p.blockA.label,
          labelB: p.blockB.label,
        })),
        currentIndex: 0,
      };
      let first = pairQueue.pairs[0];
      if (mode === "watchlist") {
        watchlistPicker.blockAId = first.blockAId;
        watchlistPicker.blockBId = first.blockBId;
      } else if (mode === "rewatchlist") {
        rewatchlistPicker.blockAId = first.blockAId;
        rewatchlistPicker.blockBId = first.blockBId;
      } else {
        watchedPicker.blockAId = first.blockAId;
        watchedPicker.blockBId = first.blockBId;
      }
      await startMerge();
      return;
    }

    let pairPickBtn = event.target.closest("[data-merge-pair-index]");
    if (pairPickBtn) {
      let idx = Number(pairPickBtn.dataset.mergePairIndex);
      let blocks =
        mode === "watchlist"
          ? window.watchlistOrderingBlocks(watchlistPicker.tier)
          : mode === "rewatchlist"
            ? window.rewatchOrderingBlocks(rewatchlistPicker.tier)
            : window.loadWatchedMergeBlocks(
                watchedPicker.scopeType,
                watchedPicker.scopeKey,
              );
      if (mode === "watchlist" && watchlistPicker.decade) {
        blocks = blocks.filter((b) =>
          b.years.some(
            (y) =>
              (window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`) === watchlistPicker.decade,
          ),
        );
      } else if (mode === "rewatchlist" && rewatchlistPicker.decade) {
        blocks = blocks.filter((b) =>
          b.years.some(
            (y) =>
              (window.getDecadeKey
                ? window.getDecadeKey(y)
                : `${Math.floor(y / 10) * 10}s`) === rewatchlistPicker.decade,
          ),
        );
      }
      let { pairs } = window.suggestShelfMergePairs(blocks);
      if (!pairs[idx]) return;
      pairQueue = {
        pairs: pairs.map((p) => ({
          blockAId: p.blockA.id,
          blockBId: p.blockB.id,
          labelA: p.blockA.label,
          labelB: p.blockB.label,
        })),
        currentIndex: idx,
      };
      let chosen = pairQueue.pairs[idx];
      if (mode === "watchlist") {
        watchlistPicker.blockAId = chosen.blockAId;
        watchlistPicker.blockBId = chosen.blockBId;
      } else if (mode === "rewatchlist") {
        rewatchlistPicker.blockAId = chosen.blockAId;
        rewatchlistPicker.blockBId = chosen.blockBId;
      } else {
        watchedPicker.blockAId = chosen.blockAId;
        watchedPicker.blockBId = chosen.blockBId;
      }
      await startMerge();
      return;
    }

    // Stash actions
    if (event.target.closest("[data-merge-stash-tier-btn]")) {
      if (stashPicker.isStashing || !stashPicker.tier) return;
      stashPicker.isStashing = true;
      render();
      try {
        let count = await window.stashSupabaseWatchlistRanking(
          stashPicker.tier,
        );
        await ensureStashPickerDefaults();
        alert(
          `Successfully stashed ${count} ranked films for Tier ${stashPicker.tier}. You can now rank your next batch!`,
        );
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        stashPicker.isStashing = false;
        render();
      }
      return;
    }

    if (event.target.closest("[data-merge-stash-all]")) {
      if (stashPicker.isStashing) return;
      stashPicker.isStashing = true;
      render();
      try {
        let count = await window.stashSupabaseWatchlistRanking();
        await ensureStashPickerDefaults();
        alert(
          `Successfully stashed ${count} ranked films. You can now rank your next batch!`,
        );
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        stashPicker.isStashing = false;
        render();
      }
      return;
    }

    if (event.target.closest("[data-merge-unstash-tier]")) {
      if (stashPicker.isUnstashing || !stashPicker.tier) return;
      if (
        !confirm(
          `Unstash all films for Tier ${stashPicker.tier}? Their stashed positions will be restored to active watchlist.`,
        )
      )
        return;
      stashPicker.isUnstashing = true;
      render();
      try {
        await window.unstashSupabaseWatchlistRanking(stashPicker.tier);
        await ensureStashPickerDefaults();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        stashPicker.isUnstashing = false;
        render();
      }
      return;
    }

    if (event.target.closest("[data-merge-unstash-all]")) {
      if (stashPicker.isUnstashing) return;
      if (
        !confirm(
          "Unstash all tiers? All stashed positions will be restored to active watchlist.",
        )
      )
        return;
      stashPicker.isUnstashing = true;
      render();
      try {
        await window.unstashSupabaseWatchlistRanking(null);
        await ensureStashPickerDefaults();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        stashPicker.isUnstashing = false;
        render();
      }
      return;
    }

    // Setup actions
    if (event.target.closest("[data-merge-start]")) {
      pairQueue = null;
      startMerge();
      return;
    }

    // Block candidate management
    let splitBtn = event.target.closest("[data-merge-split-block]");
    if (splitBtn) {
      pairQueue = null;
      let blockId = splitBtn.dataset.mergeSplitBlock;
      if (mode === "watchlist") {
        await splitWatchlistGroups(blockId);
      } else if (mode === "rewatchlist") {
        await splitRewatchlistGroups(blockId);
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
      pairQueue = null;
      if (mode === "watched") {
        window.groupWatchedMergeBlocksByDecade(
          watchedPicker.scopeType,
          watchedPicker.scopeKey,
        );
        ensureWatchedPickerDefaults();
      }
      render();
      return;
    }
    if (event.target.closest("[data-merge-clear-decade]")) {
      pairQueue = null;
      if (mode === "rewatchlist") {
        rewatchlistPicker.decade = "";
        let url = new URL(window.location.href);
        url.searchParams.delete("decade");
        window.history.replaceState({}, "", url.toString());
        ensureRewatchlistPickerDefaults();
      } else {
        watchlistPicker.decade = "";
        let url = new URL(window.location.href);
        url.searchParams.delete("decade");
        window.history.replaceState({}, "", url.toString());
        ensureWatchlistPickerDefaults();
      }
      render();
      return;
    }
    if (event.target.closest("[data-merge-reset-blocks]")) {
      pairQueue = null;
      if (mode === "watchlist") {
        await splitWatchlistGroups();
      } else if (mode === "rewatchlist") {
        await splitRewatchlistGroups();
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
        await chooseCollection("director", person.id);
      }
      return;
    }
    let pickTag = event.target.closest("[data-pick-tag]");
    if (pickTag) {
      let id = pickTag.dataset.pickTag;
      let tag = collectionState.tagOptions.find((t) => t.id === id);
      if (tag) {
        await chooseCollection("tag", tag.id);
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
    // Stash tier select
    let stashTier = event.target.closest("[data-merge-stash-tier]");
    if (stashTier) {
      pairQueue = null;
      stashPicker.tier = stashTier.value;
      updateStashPickerItems();
      let url = new URL(window.location.href);
      if (stashPicker.tier) {
        url.searchParams.set("tier", stashPicker.tier);
      } else {
        url.searchParams.delete("tier");
      }
      window.history.replaceState({}, "", url.toString());
      render();
      return;
    }

    // Watchlist tier select
    let wlTier = event.target.closest("[data-merge-watchlist-tier]");
    if (wlTier) {
      pairQueue = null;
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

    // Rewatchlist tier select
    let rwlTier = event.target.closest("[data-merge-rewatchlist-tier]");
    if (rwlTier) {
      pairQueue = null;
      rewatchlistPicker.tier = rwlTier.value;
      rewatchlistPicker.blockAId = "";
      rewatchlistPicker.blockBId = "";
      ensureRewatchlistPickerDefaults();
      let url = new URL(window.location.href);
      if (rewatchlistPicker.tier) {
        url.searchParams.set("tier", rewatchlistPicker.tier);
      } else {
        url.searchParams.delete("tier");
      }
      window.history.replaceState({}, "", url.toString());
      render();
      return;
    }

    // Watchlist decade select
    let wlDecade = event.target.closest("[data-merge-watchlist-decade]");
    if (wlDecade) {
      pairQueue = null;
      watchlistPicker.decade = wlDecade.value;
      watchlistPicker.blockAId = "";
      watchlistPicker.blockBId = "";
      ensureWatchlistPickerDefaults();
      let url = new URL(window.location.href);
      if (watchlistPicker.decade) {
        url.searchParams.set("decade", watchlistPicker.decade);
      } else {
        url.searchParams.delete("decade");
      }
      window.history.replaceState({}, "", url.toString());
      render();
      return;
    }

    // Rewatchlist decade select
    let rwlDecade = event.target.closest("[data-merge-rewatchlist-decade]");
    if (rwlDecade) {
      pairQueue = null;
      rewatchlistPicker.decade = rwlDecade.value;
      rewatchlistPicker.blockAId = "";
      rewatchlistPicker.blockBId = "";
      ensureRewatchlistPickerDefaults();
      let url = new URL(window.location.href);
      if (rewatchlistPicker.decade) {
        url.searchParams.set("decade", rewatchlistPicker.decade);
      } else {
        url.searchParams.delete("decade");
      }
      window.history.replaceState({}, "", url.toString());
      render();
      return;
    }

    // Watched scope select
    let wtScope = event.target.closest("[data-merge-watched-scope]");
    if (wtScope) {
      pairQueue = null;
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
      pairQueue = null;
      let side = blockSelect.dataset.mergeBlock;
      let chosen = blockSelect.value;
      let activePicker =
        mode === "watchlist"
          ? watchlistPicker
          : mode === "rewatchlist"
            ? rewatchlistPicker
            : watchedPicker;
      if (side === "a") {
        activePicker.blockAId = chosen;
        if (activePicker.blockBId === chosen) {
          let blocks =
            mode === "watchlist"
              ? window.watchlistOrderingBlocks(activePicker.tier)
              : mode === "rewatchlist"
                ? window.rewatchOrderingBlocks(activePicker.tier)
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
    let form = /** @type {HTMLFormElement} */ (
      event.target.closest("[data-director-search]")
    );
    if (!form) return;
    event.preventDefault();
    let query = form.query?.value?.trim();
    if (!query) return;
    collectionState.searchStatus = "Searching...";
    render();
    try {
      let results = await window.searchSupabaseDirectorsByName(query);
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
    if (
      event.target.tagName === "INPUT" ||
      event.target.tagName === "SELECT" ||
      event.target.tagName === "TEXTAREA"
    ) {
      return;
    }
    if (step === "preview") {
      if (
        event.key === "Enter" ||
        event.key === " " ||
        event.key === "ArrowRight" ||
        event.key === "1" ||
        event.key === "2"
      ) {
        event.preventDefault();
        applyMerge();
        return;
      }
      if (
        event.key === "z" ||
        event.key === "Z" ||
        event.key === "u" ||
        event.key === "U"
      ) {
        event.preventDefault();
        undoLastPick();
        return;
      }
      return;
    }
    if (step === "done") {
      if (event.key === "Enter" || event.key === " ") {
        let nextButton = container.querySelector(
          "[data-merge-next-pair], [data-merge-continue-next-pass]",
        );
        if (nextButton) {
          event.preventDefault();
          nextButton.click();
          return;
        }
      }
      return;
    }
    if (step !== "compare") return;
    if (event.key === "ArrowLeft" || event.key === "1") {
      event.preventDefault();
      pick("a");
    } else if (event.key === "ArrowRight" || event.key === "2") {
      event.preventDefault();
      pick("b");
    } else if (
      event.key === "z" ||
      event.key === "Z" ||
      event.key === "u" ||
      event.key === "U"
    ) {
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
