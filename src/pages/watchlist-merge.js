/**
 * @file Guided pairwise merge tool (issue #73): combines two already-ordered
 * watchlist scopes within one interest tier - two years, a year and its
 * decade, a decade and the rest of the tier, and so on - into one
 * interleaved order via repeated "which ranks higher" choices, then applies
 * the result through the existing tier/order model. No second order model:
 * every other item in the tier keeps its exact existing position.
 */
(function () {
  let escape = window.pageEscape;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
  window.load();

  let container = document.getElementById("watchlistMergePage");
  document.title = `${ui("Merge watchlist order")} · The Oskars`;

  let SCOPE_TYPES = ["year", "decade", "century", "all"];
  let picker = { tier: "", aType: "year", aKey: "", bType: "year", bKey: "" };
  let step = "setup";
  let session = null;
  let applyResult = null;

  function wid(item) {
    return item.id || window.watchlistItemId(item);
  }

  function tiersWithItems() {
    return window.WATCHLIST_TIERS.filter(
      (tier) => window.watchlistTierItemsInOrder(tier).length >= 2,
    );
  }

  function scopeTypeLabel(type) {
    if (type === "year") return ui("Year");
    if (type === "decade") return ui("Decade");
    if (type === "century") return ui("Century");
    return ui("Whole tier");
  }

  function scopeKeyOptions(tier, type) {
    if (type === "all" || !tier) return [];
    return window.watchlistPeriodKeys(type, tier);
  }

  function ensurePickerDefaults() {
    let tiers = tiersWithItems();
    if (!picker.tier || !tiers.includes(picker.tier))
      picker.tier = tiers[0] || "";
    if (
      picker.aType !== "all" &&
      !scopeKeyOptions(picker.tier, picker.aType).includes(picker.aKey)
    )
      picker.aKey = scopeKeyOptions(picker.tier, picker.aType)[0] || "";
    if (
      picker.bType !== "all" &&
      !scopeKeyOptions(picker.tier, picker.bType).includes(picker.bKey)
    ) {
      // Default Group B to a different key than Group A when both start on
      // the same scope type, so the two groups aren't identical (and thus
      // trivially empty to merge) the moment the tool loads.
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
    return window.watchlistTierPeriodScopeItems(picker.tier, type, key);
  }

  function effectiveScopeItems() {
    let listA = scopeItems("a");
    let aIds = new Set(listA.map(wid));
    let listB = scopeItems("b").filter((item) => !aIds.has(wid(item)));
    return { listA, listB };
  }

  function pickerValidation() {
    if (!picker.tier)
      return ui("No interest tier has at least two watchlist films to merge.");
    let { listA, listB } = effectiveScopeItems();
    if (!listA.length || !listB.length)
      return ui(
        "Both groups need at least one film, and can't be the same scope.",
      );
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
      <span class="watchlist-merge-scope-count">${escape(window.uiCount?.(count, "film", "films") || `${count} films`)}</span>
    </fieldset>`;
  }

  function renderSetup() {
    ensurePickerDefaults();
    let tiers = tiersWithItems();
    let validation = pickerValidation();
    if (!tiers.length)
      return `<div class="detail-empty">
        <h2>${escape(ui("Nothing to merge yet"))}</h2>
        <p>${escape(ui("No interest tier has at least two watchlist films. Assign tiers on the watchlist page first."))}</p>
        <a href="${escape(window.periodPageUrl("alltime", "alltime"))}&view=watchlist">${escape(ui("Return to watchlist"))}</a>
      </div>`;
    let tierOptions = tiers
      .map(
        (tier) =>
          `<option value="${escape(tier)}"${picker.tier === tier ? " selected" : ""}>${escape(tier)}</option>`,
      )
      .join("");
    return `<section class="watchlist-merge-setup" data-watchlist-merge-setup>
      <p>${escape(ui("Pick an interest tier and two groups within it - two years, a year and its decade, a decade and the rest of the tier - then decide film by film which one ranks higher. Everything outside the two groups keeps its exact position."))}</p>
      <label class="watchlist-merge-tier-picker">${escape(ui("Interest tier"))} <select data-merge-tier>${tierOptions}</select></label>
      <div class="watchlist-merge-scopes">
        ${renderScopeFieldset("a", ui("Group A"))}
        ${renderScopeFieldset("b", ui("Group B"))}
      </div>
      ${validation ? `<p class="watchlist-merge-validation">${escape(validation)}</p>` : ""}
      <button type="button" class="sort-order-button" data-merge-start${validation ? " disabled" : ""}>${escape(ui("Start merge"))}</button>
    </section>`;
  }

  function renderCompareCard(item, side) {
    let film = window.watchlistFilmLike(item, null);
    let directorHtml = window.renderLinkedDirectors(film, { escape });
    return window.renderSharedFilmCard(film, {
      classes: ["watchlist-card", "watchlist-merge-choice-card"],
      openFilm: false,
      attributes: { "data-watchlist-merge-pick": side, tabindex: "0", role: "button" },
      showYear: true,
      directorHtml: directorHtml
        ? `<div class="film-director">${escape(ui("by"))} ${directorHtml}</div>`
        : "",
      escape,
      bodyHtml: window.renderWatchlistTierBadge(item.tier, { escape }),
    });
  }

  function renderPreview() {
    let itemsHtml = session.merged
      .map(
        (item) =>
          `<li>${escape(window.localizedFilmTitle?.(window.watchlistFilmLike(item, null)) || item.title)} <small>(${escape(item.year || "—")})</small></li>`,
      )
      .join("");
    return `<section class="watchlist-merge-preview" data-watchlist-merge-preview>
      <h2>${escape(ui("Merged order"))}</h2>
      <p>${escape(ui("This becomes the new relative order for these films within the tier; every other film keeps its exact position."))}</p>
      <ol class="watchlist-merge-preview-list">${itemsHtml}</ol>
      <div class="watchlist-merge-preview-actions">
        <button type="button" class="sort-order-button" data-merge-apply>${escape(ui("Use this order"))}</button>
        <button type="button" class="sort-order-button" data-merge-restart>${escape(ui("Start over"))}</button>
      </div>
    </section>`;
  }

  function renderDone() {
    let tier = session?.tier || picker.tier;
    let watchlistHref = `${window.periodPageUrl("alltime", "alltime")}&view=watchlist&tiers=${encodeURIComponent(tier)}`;
    let summaryText = ui("{count} reordered in tier {tier}.", {
      count:
        window.uiCount?.(applyResult?.changed || 0, "film", "films") ||
        `${applyResult?.changed || 0} films`,
      tier,
    });
    return `<section class="watchlist-merge-done" data-watchlist-merge-done>
      <h2>${escape(ui("Merged order applied"))}</h2>
      <p>${escape(summaryText)}</p>
      <a class="sort-order-button" href="${escape(watchlistHref)}">${escape(ui("Review on the watchlist"))}</a>
      <button type="button" class="sort-order-button" data-merge-again>${escape(ui("Merge again"))}</button>
    </section>`;
  }

  function render() {
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Merge watchlist order"))}</h1><p><a href="${escape(window.periodPageUrl("alltime", "alltime"))}&view=watchlist">${escape(ui("Back to watchlist"))}</a></p>`,
    });
    let body =
      step === "compare"
        ? window.renderMergeCompareStep(session, renderCompareCard, {
            escape,
            ui,
          })
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

  function applyMerge() {
    let ids = session.merged.map(wid);
    let result = window.applyWatchlistTierMergeOrder(session.tier, ids);
    if (!result.ok) {
      window.alert?.(result.reason);
      return;
    }
    applyResult = result;
    window.save?.({ immediate: true, rebuild: false });
    step = "done";
    render();
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

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
