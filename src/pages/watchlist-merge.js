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

  let SCOPE_TYPES = ["year", "decade", "century", "all"];
  let picker = { tier: "", aType: "year", aKey: "", bType: "year", bKey: "" };
  let step = "setup";
  let session = null;
  let applyResult = null;

  function scopeTypeLabel(type) {
    if (type === "year") return "Year";
    if (type === "decade") return "Decade";
    if (type === "century") return "Century";
    return "Whole tier";
  }

  function scopeKeyOptions(tier, type) {
    if (type === "all" || !tier) return [];
    return window.supabaseWatchlistPeriodKeys(tier, type);
  }

  function ensurePickerDefaults() {
    let tiers = window.supabaseWatchlistTiersWithItems();
    if (!picker.tier || !tiers.includes(picker.tier)) picker.tier = tiers[0] || "";
    if (
      picker.aType !== "all" &&
      !scopeKeyOptions(picker.tier, picker.aType).includes(picker.aKey)
    )
      picker.aKey = scopeKeyOptions(picker.tier, picker.aType)[0] || "";
    if (
      picker.bType !== "all" &&
      !scopeKeyOptions(picker.tier, picker.bType).includes(picker.bKey)
    ) {
      let bOptions = scopeKeyOptions(picker.tier, picker.bType);
      let distinctFromA = bOptions.find(
        (key) => !(picker.bType === picker.aType && key === picker.aKey),
      );
      picker.bKey = distinctFromA ?? bOptions[0] ?? "";
    }
  }

  function scopeItems(side) {
    let type = picker[`${side}Type`];
    let key = picker[`${side}Key`];
    if (!picker.tier) return [];
    if (type !== "all" && !key) return [];
    return window.supabaseWatchlistTierPeriodScopeItems(picker.tier, type, key);
  }

  function effectiveScopeItems() {
    let listA = scopeItems("a");
    let aIds = new Set(listA.map((row) => row.film_id));
    let listB = scopeItems("b").filter((row) => !aIds.has(row.film_id));
    return { listA, listB };
  }

  function pickerValidation() {
    if (!picker.tier)
      return "No interest tier has at least two watchlist films to merge.";
    let { listA, listB } = effectiveScopeItems();
    if (!listA.length || !listB.length)
      return "Both groups need at least one film, and can't be the same scope.";
    return "";
  }

  function renderScopeFieldset(side, label) {
    let type = picker[`${side}Type`];
    let key = picker[`${side}Key`];
    let count = scopeItems(side).length;
    let typeOptions = SCOPE_TYPES.map(
      (value) =>
        `<option value="${escape(value)}"${type === value ? " selected" : ""}>${escape(scopeTypeLabel(value))}</option>`,
    ).join("");
    let keyOptions = scopeKeyOptions(picker.tier, type)
      .map(
        (value) =>
          `<option value="${escape(value)}"${key === value ? " selected" : ""}>${escape(value)}</option>`,
      )
      .join("");
    return `<fieldset class="watchlist-merge-scope">
      <legend>${escape(label)}</legend>
      <select data-merge-scope-type="${side}">${typeOptions}</select>
      ${type === "all" ? "" : `<select data-merge-scope-key="${side}">${keyOptions}</select>`}
      <span class="watchlist-merge-scope-count">${escape(count)} films</span>
    </fieldset>`;
  }

  function renderSetup() {
    ensurePickerDefaults();
    let tiers = window.supabaseWatchlistTiersWithItems();
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
    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <p>Pick an interest tier and two groups within it, then decide film by film which one ranks higher. Everything outside the two groups keeps its exact position.</p>
      <label class="watchlist-merge-tier-picker">Interest tier <select data-merge-tier>${tierOptions}</select></label>
      <div class="watchlist-merge-scopes">
        ${renderScopeFieldset("a", "Group A")}
        ${renderScopeFieldset("b", "Group B")}
      </div>
      ${validation ? `<p class="watchlist-merge-validation">${escape(validation)}</p>` : ""}
      <button type="button" class="sort-order-button" data-merge-start${validation ? " disabled" : ""}>Start merge</button>
    </section>`;
  }

  function renderCompareCard(row, side) {
    let film = row.films || {};
    return `<article class="film-card watchlist-card watchlist-merge-choice-card" data-watchlist-merge-pick="${side}" tabindex="0" role="button">
      <h3>${escape(film.title || "Unknown film")}</h3>
      <span class="film-year">(${escape(film.year || "—")})</span>
      ${window.renderWatchlistTierBadge(row.tier, { escape })}
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
    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>Merged order applied</h2>
      <p>${escape(applyResult?.changed || 0)} reordered in tier ${escape(tier)}.</p>
      <button type="button" class="sort-order-button" data-merge-again>Merge again</button>
    </section>`;
  }

  function render() {
    let header = window.renderDetailHeader({
      mainHtml: "<h1>Merge watchlist order</h1>",
    });
    let body =
      step === "compare"
        ? window.renderMergeCompareStep(session, renderCompareCard, { escape })
        : step === "preview"
          ? renderPreview()
          : step === "done"
            ? renderDone()
            : renderSetup();
    container.innerHTML = `${header}${body}`;
  }

  function startMerge() {
    if (pickerValidation()) return;
    let { listA, listB } = effectiveScopeItems();
    session = window.createMergeSession(listA, listB);
    session.tier = picker.tier;
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

  async function applyMerge() {
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
      step = "done";
      render();
    } catch (error) {
      alert(error.message || String(error));
      if (applyButton) applyButton.disabled = false;
    }
  }

  container.addEventListener("change", (event) => {
    let tierSelect = event.target.closest("[data-merge-tier]");
    if (tierSelect) {
      picker.tier = tierSelect.value;
      picker.aKey = "";
      picker.bKey = "";
      render();
      return;
    }
    let scopeType = event.target.closest("[data-merge-scope-type]");
    if (scopeType) {
      let side = scopeType.dataset.mergeScopeType;
      picker[`${side}Type`] = scopeType.value;
      picker[`${side}Key`] = "";
      render();
      return;
    }
    let scopeKey = event.target.closest("[data-merge-scope-key]");
    if (scopeKey) {
      let side = scopeKey.dataset.mergeScopeKey;
      picker[`${side}Key`] = scopeKey.value;
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
      await window.loadSupabaseWorkspace();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your watchlist</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
