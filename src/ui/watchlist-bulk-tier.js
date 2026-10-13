/** @file Archive-backed watchlist bulk-tier UI: selection, delegated controls, caller-supplied persistence, and URL-scoped session undo for Period/Watchlist pages. Depends on page-utils.js feedback and escaping plus the watchlist domain/state helpers. */
/** Renders the shared bulk watchlist-tier selector and apply button. @param {Object} [options] Tier, count, and escaping options. @returns {string} */
window.renderWatchlistBulkTierControl = function (options = {}) {
  // Shared across every page that embeds it (issue #253) - gating here once
  // covers all of them instead of requiring each page to remember to check.
  if (!(window.oskarsCapabilities?.().canEdit ?? true)) return "";
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let value = window.normalizeWatchlistTier?.(options.value) || "";
  let count = Number(options.count) || 0;
  let optionsHtml = [
    `<option value=""${value ? "" : " selected"}>${escape(ui("Unset"))}</option>`,
  ]
    .concat(
      (window.WATCHLIST_TIERS || []).map(
        (tier) =>
          `<option value="${escape(tier)}"${value === tier ? " selected" : ""}>${escape(tier)}</option>`,
      ),
    )
    .join("");
  let feedback = watchlistBulkTierFeedbackForCurrentView();
  let feedbackHtml = window.renderActionFeedback({
    message: feedback?.message || "",
    actionLabel: feedback?.snapshot ? ui("Undo") : "",
    actionAttribute: "data-watchlist-bulk-tier-undo",
    escape,
  });
  return `<span class="watchlist-bulk-tier-control"><label>${escape(ui("Set filtered interest"))} <select data-watchlist-bulk-tier>${optionsHtml}</select></label><button type="button" class="sort-order-button" data-watchlist-bulk-tier-apply ${count ? "" : "disabled"}>${escape(ui("Update interest"))}</button></span>${feedbackHtml}`;
};

function watchlistBulkEntryItem(entry) {
  return entry?.item || entry;
}

let watchlistBulkTierFeedback = null;

function watchlistBulkTierViewKey() {
  return String(window.location?.href || window.location?.search || "");
}

function watchlistBulkTierFeedbackForCurrentView() {
  return watchlistBulkTierFeedback?.viewKey === watchlistBulkTierViewKey()
    ? watchlistBulkTierFeedback
    : null;
}

/**
 * Returns entries changed by a bulk watchlist-tier action.
 * @param {Object[]} entries Watchlist items or wrapper entries.
 * @param {string} nextTier Normalized target tier.
 * @returns {Object[]} Changed entries.
 */
window.watchlistBulkTierChanges = function (entries, nextTier) {
  return (entries || []).filter((entry) => {
    let item = watchlistBulkEntryItem(entry);
    return item && window.normalizeWatchlistTier?.(item.tier) !== nextTier;
  });
};

/**
 * Applies a bulk watchlist-tier change and keeps a session undo snapshot.
 * @param {Object[]} entries Watchlist items or wrapper entries.
 * @param {string} nextTier Target tier.
 * @param {Object} [options] Persistence options.
 * @returns {Object} Bulk update result.
 */
window.applyWatchlistBulkTierChange = function (
  entries,
  nextTier,
  options = {},
) {
  let ui = window.uiText || ((text) => text);
  let tier = window.normalizeWatchlistTier?.(nextTier) || "";
  let changedEntries = window.watchlistBulkTierChanges(entries, tier);
  if (!changedEntries.length) {
    window.alert?.(ui("No filtered films need that interest change."));
    return { ok: false, changed: 0, cancelled: true };
  }
  let changedIds = new Set(
    changedEntries.map((entry) => watchlistBulkEntryItem(entry)?.id),
  );
  let snapshot = (window.state?.watchlist || []).map((item) => ({
    id: item.id || window.watchlistItemId?.(item),
    tier: item.tier || "",
    order: item.order || "",
    changedTier: changedIds.has(item.id),
  }));
  let ids = changedEntries
    .map((entry) => {
      let item = watchlistBulkEntryItem(entry);
      return item?.id || window.watchlistItemId?.(item);
    })
    .filter(Boolean);
  let result = window.setWatchlistTierForItems?.(ids, tier, { save: false });
  if (!result?.ok) {
    if (result?.reason) window.alert?.(result.reason);
    return result || { ok: false };
  }
  if (options.save !== false)
    window.save?.({ immediate: true, rebuild: false });
  watchlistBulkTierFeedback = {
    viewKey: watchlistBulkTierViewKey(),
    message: ui("Updated interest for {count} film(s).", {
      count: result.changed,
    }),
    snapshot,
  };
  return result;
};

/** Restores the last bulk interest change made in the current view. @param {Object} [options] Persistence controls. @returns {Object} Undo result. */
window.undoWatchlistBulkTierChange = function (options = {}) {
  let feedback = watchlistBulkTierFeedbackForCurrentView();
  if (!feedback?.snapshot) return { ok: false, reason: "Nothing to undo." };
  let restored = 0;
  feedback.snapshot.forEach((before) => {
    let item = window.findWatchlistItemById?.(before.id);
    if (!item) return;
    if (before.changedTier) item.tier = before.tier;
    item.order = before.order;
    restored += 1;
  });
  window.state._watchlistDirectorLookup = null;
  window.markAggregatesDirty?.("watchlist bulk tier undone");
  window.recordEdit?.({
    type: "watchlist bulk tier undo",
    summary: `Restored interest for ${restored} watchlist film(s)`,
    sheetHint: "Watchlist",
    changes: [
      { field: "tier", before: "bulk change", after: "previous values" },
    ],
  });
  if (options.save !== false)
    window.save?.({ immediate: true, rebuild: false });
  let ui = window.uiText || ((text) => text);
  watchlistBulkTierFeedback = {
    viewKey: watchlistBulkTierViewKey(),
    message: ui("Interest changes undone."),
    snapshot: null,
  };
  return { ok: true, restored };
};

/**
 * Binds the standardized bulk-tier select and apply button within a page container.
 * @param {{container?:Element, entries?:() => Object[], rerender?:(outcome:{tier:string, result:Object, undone?:boolean}) => *, persist?:(before:Object[], after:Object[]) => Promise<void>}} [options] Page-specific entry and rerender hooks.
 * @returns {{apply:(nextTier?:string) => (Object|Promise<Object>), value:() => string, destroy:() => void}} Controller methods for direct use and cleanup.
 */
window.bindWatchlistBulkTierControl = function (options = {}) {
  let container = options.container;
  let selectedTier = "";

  let busy = false;
  function finish(result, before, undone = false) {
    let renderResult = () => {
      if (result?.ok)
        options.rerender?.({ tier: selectedTier, result, undone });
      if (
        watchlistBulkTierFeedback &&
        watchlistBulkTierFeedback.viewKey !== watchlistBulkTierViewKey()
      ) {
        watchlistBulkTierFeedback.viewKey = watchlistBulkTierViewKey();
        // A filter-changing action renders under its new URL; show Undo there too.
        options.rerender?.({ tier: selectedTier, result, undone });
      }
      return result || { ok: false };
    };
    if (!options.persist || !result?.ok) return renderResult();
    busy = true;
    return options
      .persist(before, window.cloneRecord(window.state.watchlist || []))
      .then(renderResult)
      .catch((err) => {
        watchlistBulkTierFeedback = null;
        window.alert?.(err.message || String(err));
        let failure = { ok: false, reason: err.message || String(err) };
        options.rerender?.({ tier: selectedTier, result: failure, undone });
        return failure;
      })
      .finally(() => {
        busy = false;
      });
  }
  function apply(nextTier = selectedTier) {
    if (busy || !(window.oskarsCapabilities?.().canEdit ?? true))
      return { ok: false };
    let before = options.persist
      ? window.cloneRecord(window.state.watchlist || [])
      : [];
    selectedTier = window.normalizeWatchlistTier?.(nextTier) || "";
    let result = window.applyWatchlistBulkTierChange?.(
      options.entries?.() || [],
      selectedTier,
      { save: !options.persist },
    );
    return finish(result, before);
  }

  function onChange(event) {
    let select = event.target?.closest?.("[data-watchlist-bulk-tier]");
    if (select)
      selectedTier = window.normalizeWatchlistTier?.(select.value) || "";
  }

  function onClick(event) {
    if (event.target?.closest?.("[data-watchlist-bulk-tier-undo]")) {
      if (busy) return;
      let before = options.persist
        ? window.cloneRecord(window.state.watchlist || [])
        : [];
      let result = window.undoWatchlistBulkTierChange?.({
        save: !options.persist,
      }) || { ok: false };
      finish(result, before, true);
      return;
    }
    let button = event.target?.closest?.("[data-watchlist-bulk-tier-apply]");
    if (button && !button.disabled) apply();
  }

  container?.addEventListener("change", onChange);
  container?.addEventListener("click", onClick);
  return {
    apply,
    value: () => selectedTier,
    destroy() {
      container?.removeEventListener?.("change", onChange);
      container?.removeEventListener?.("click", onClick);
    },
  };
};
