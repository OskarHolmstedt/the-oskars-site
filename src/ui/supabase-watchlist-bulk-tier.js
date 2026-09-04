/**
 * @file Shared Supabase-backed watchlist bulk-tier control (issue #439),
 * generalized from tag.js's original page-specific control once
 * franchise.js needed the identical capability. Async parallel of
 * page-utils.js's renderWatchlistBulkTierControl()/
 * bindWatchlistBulkTierControl() (which mutate window.state/window.save()
 * through applyWatchlistBulkTierChange(), with an undo mechanism) - this
 * writes straight to Supabase via setSupabaseWatchlistTierForItems()
 * (src/core/supabase-workspace.js) and deliberately has no undo, matching
 * tag.js's original scope reduction.
 */
(function () {
  let ui = window.uiText || ((text) => text);

  /**
   * @param {{count: number, busy?: boolean, escape?: function}} options
   * @returns {string}
   */
  window.renderSupabaseWatchlistBulkTierControl = function (options) {
    let escape = options.escape || window.pageEscape;
    let count = Number(options.count) || 0;
    let busy = Boolean(options.busy);
    let optionsHtml = [`<option value="">${escape(ui("Unset"))}</option>`]
      .concat(
        (window.WATCHLIST_TIERS || []).map(
          (tier) => `<option value="${escape(tier)}">${escape(tier)}</option>`,
        ),
      )
      .join("");
    return `<span class="watchlist-bulk-tier-control"><label>${escape(ui("Set filtered interest"))} <select data-supabase-watchlist-bulk-tier>${optionsHtml}</select></label><button type="button" class="sort-order-button" data-supabase-watchlist-bulk-tier-apply${count ? "" : " disabled"}${busy ? " disabled" : ""}>${escape(ui("Update interest"))}</button></span>`;
  };

  /**
   * Bound once per page load (delegated to `container`, which - unlike the
   * `innerHTML`-rebuilt elements inside it - survives every render(), so
   * binding again per render would stack duplicate listeners). `onStart`/
   * `onError` let the caller manage its own busy flag exactly like the
   * pre-retrofit page-specific versions did; on success this navigates via
   * `rerender` (every caller passes a full-page reload), so there's no
   * matching "on success, clear busy" hook - the page is already leaving.
   * @param {{container: Element, entries: () => Object[], onStart?: function, onError?: (err: Error) => void, rerender: function}} options
   */
  window.bindSupabaseWatchlistBulkTierControl = function (options) {
    let { container, entries, onStart, onError, rerender } = options;
    container.addEventListener("click", async (event) => {
      if (!event.target.closest("[data-supabase-watchlist-bulk-tier-apply]"))
        return;
      let select = container.querySelector(
        "[data-supabase-watchlist-bulk-tier]",
      );
      let tier = select?.value || "";
      let ids = (entries() || []).map((item) => item.id).filter(Boolean);
      if (!ids.length) return;
      onStart?.();
      try {
        await window.setSupabaseWatchlistTierForItems(ids, tier);
        await rerender();
      } catch (err) {
        onError?.(err);
      }
    });
  };
})();
