/** @file Shared page primitives: escaping, query params, watch-queue reason text, copy-view-link, list/grid view mode, and the watchlist bulk-tier control. */

/** Escapes a value for HTML text or attribute output. @param {*} value Value to escape. @returns {string} */
window.pageEscape = function (value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
};

/** Reads and decodes one query parameter. @param {string} name Parameter name. @returns {string} */
window.pageQueryParam = function (name) {
  let decode = (value) =>
    decodeURIComponent(String(value || "").replace(/\+/g, " "));
  let match = String(window.location?.search || "")
    .replace(/^\?/, "")
    .split("&")
    .map((part) => part.split("="))
    .find((parts) => decode(parts[0] || "") === name);
  return match ? decode(match.slice(1).join("=") || "") : "";
};

// Turns a watch-queue reason (src/domain/watch-queue.js, issue #160) into
// one full, independently localizable sentence per reason type, rather than
// gluing a translated lead-in to a translated fragment (composed sentences
// don't reliably hold together across languages). Shared by Discover's
// "Surprise me" picker (issue #161) and the watchlist view's queue panel
// (issue #163) so the two surfaces describe a pick identically.
/** Formats a watch-queue pick reason for display. @param {import('../domain/watch-queue.js').WatchQueueReason} reason Reason to format. @returns {string} */
window.watchQueueReasonText = function (reason) {
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
  if (
    reason?.type === "director-completion" ||
    reason?.type === "franchise-completion"
  )
    return ui("Picked because it is closest to finishing {name}.", {
      name: reason.params.name,
    });
  if (reason?.type === "tag-match")
    return ui('Picked because it is tagged "{tag}".', {
      tag: reason.params.tag,
    });
  if (reason?.type === "highest-tier")
    return reason.params.tier
      ? ui("Picked because it is top tier ({tier}).", {
          tier: reason.params.tier,
        })
      : ui("Picked because it is next in watchlist order.");
  if (reason?.type === "random")
    return reason.params.tier
      ? ui(
          "Picked because it is tied with others at tier {tier}, so it was picked at random.",
          { tier: reason.params.tier },
        )
      : ui(
          "Picked because it is tied with others for last place, so it was picked at random.",
        );
  return "";
};

/** Renders the copy-view-link button. @param {Object} [options] Escaping options. @returns {string} */
window.renderCopyViewLinkButton = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  return `<button type="button" class="sort-order-button copy-view-link" data-copy-view-link>${escape(ui("Copy view link"))}</button>`;
};

/** Copies a view URL through the Clipboard API or a document fallback. @param {string} [href] URL to copy. @returns {Promise<boolean>} */
window.copyViewLink = async function (href = window.location?.href) {
  let value = String(href || "");
  if (!value) return false;
  if (window.navigator?.clipboard?.writeText) {
    try {
      await window.navigator.clipboard.writeText(value);
      return true;
    } catch (err) {}
  }
  if (!window.document?.createElement || !window.document?.execCommand)
    return false;
  let textarea = window.document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  window.document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = window.document.execCommand("copy");
  } catch (err) {}
  textarea.remove();
  return copied;
};

/** Renders an award placement as a medal or escaped number. @param {*} placement Placement value. @returns {string} */
window.pagePlacement = function (placement) {
  return placementEmoji[placement] || `<b>${window.pageEscape(placement)}</b>`;
};

/** Reads the validated list-or-grid view mode. @param {'list'|'grid'} [defaultMode] Fallback mode. @returns {'list'|'grid'} */
window.filmViewMode = function (defaultMode = "grid") {
  let view = window.pageQueryParam("view");
  return view === "list" || view === "grid"
    ? view
    : String(defaultMode || "grid");
};

// Split-vs-combined mode for pages that render separate watched and
// watchlist blocks (issue #52): 'split' keeps the two sections, 'combined'
// merges them into one list/grid sorted by the page's shared comparator.
/** Returns the current split-or-combined sections mode. @returns {'split'|'combined'} */
window.sectionsViewMode = function () {
  return window.pageQueryParam("sections") === "combined"
    ? "combined"
    : "split";
};

/** Renders the shared list/grid view toggle. @param {Object} [options] Mode, URLs, labels, classes, and escaping options. @returns {string} */
window.renderFilmViewToggle = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let view = String(options.view || "grid");
  let listUrl = String(options.listUrl || "#");
  let gridUrl = String(options.gridUrl || "#");
  let classes = ["film-view-toggle", options.classes || ""]
    .filter(Boolean)
    .join(" ");
  let ui = window.uiText || ((text) => text);
  let ariaLabel = String(options.ariaLabel || ui("Film display"));
  let listLabel = ui("List view");
  let gridLabel = ui("Grid view");
  let listMode = options.live ? ' data-film-view-mode="list"' : "";
  let gridMode = options.live ? ' data-film-view-mode="grid"' : "";
  return `<nav class="${escape(classes)}" aria-label="${escape(ariaLabel)}"><a href="${escape(listUrl)}" class="${view === "list" ? "active" : ""}" title="${escape(listLabel)}" aria-label="${escape(listLabel)}"${listMode}>☷</a><a href="${escape(gridUrl)}" class="${view === "grid" ? "active" : ""}" title="${escape(gridLabel)}" aria-label="${escape(gridLabel)}"${gridMode}>▦</a></nav>`;
};

/** Renders the shared bulk watchlist-tier selector and apply button. @param {Object} [options] Tier, count, and escaping options. @returns {string} */
window.renderWatchlistBulkTierControl = function (options = {}) {
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
  return `<span class="watchlist-bulk-tier-control"><label>${escape(ui("Set filtered interest"))} <select data-watchlist-bulk-tier>${optionsHtml}</select></label><button type="button" class="sort-order-button" data-watchlist-bulk-tier-apply ${count ? "" : "disabled"}>${escape(ui("Apply"))}</button></span>`;
};

function watchlistBulkEntryItem(entry) {
  return entry?.item || entry;
}

/**
 * Previews and confirms a bulk watchlist-tier change.
 * @param {Object[]} entries Watchlist items or wrapper entries.
 * @param {string} nextTier Normalized target tier.
 * @returns {Object} Confirmation result and changed entries.
 */
window.confirmWatchlistBulkTierChange = function (entries, nextTier) {
  let ui = window.uiText || ((text) => text);
  let changed = (entries || []).filter((entry) => {
    let item = watchlistBulkEntryItem(entry);
    return item && window.normalizeWatchlistTier?.(item.tier) !== nextTier;
  });
  if (!changed.length) return { ok: false, changed };
  let label = nextTier || ui("Unset");
  let titles = changed.slice(0, 12).map((entry) => {
    let item = watchlistBulkEntryItem(entry);
    return `${item.title}${item.year ? ` (${item.year})` : ""}`;
  });
  let more =
    changed.length > titles.length
      ? `\n+${changed.length - titles.length} ${ui("more")}`
      : "";
  let message = `${ui("Set filtered interest to {tier}?", { tier: label })}\n\n${window.uiCount?.(changed.length, "film", "films") || `${changed.length} films`}\n${titles.join("\n")}${more}`;
  return { ok: window.confirm ? window.confirm(message) : true, changed };
};

/**
 * Confirms and applies a bulk watchlist-tier change.
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
  let preview = window.confirmWatchlistBulkTierChange(entries, tier);
  if (!preview.changed.length) {
    window.alert?.(ui("No filtered films need that interest change."));
    return { ok: false, changed: 0, cancelled: true };
  }
  if (!preview.ok)
    return { ok: false, changed: preview.changed.length, cancelled: true };
  let ids = preview.changed
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
  return result;
};

/**
 * Binds the standardized bulk-tier select and apply button within a page container.
 * @param {{container:Element, entries:() => Object[], rerender:(outcome:{tier:string, result:Object}) => *}} options Page-specific entry and rerender hooks.
 * @returns {{apply:(nextTier?:string) => Object, value:() => string, destroy:() => void}} Controller methods for direct use and cleanup.
 */
window.bindWatchlistBulkTierControl = function (options = {}) {
  let container = options.container;
  let selectedTier = "";

  function apply(nextTier = selectedTier) {
    selectedTier = window.normalizeWatchlistTier?.(nextTier) || "";
    let result = window.applyWatchlistBulkTierChange?.(
      options.entries?.() || [],
      selectedTier,
    );
    if (result?.ok) options.rerender?.({ tier: selectedTier, result });
    return result || { ok: false };
  }

  function onChange(event) {
    let select = event.target?.closest?.("[data-watchlist-bulk-tier]");
    if (select)
      selectedTier = window.normalizeWatchlistTier?.(select.value) || "";
  }

  function onClick(event) {
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

/** Renders an all-time Top 250 marker when eligible. @param {FilmRecord} film Film record. @returns {string} */
window.renderTop250Marker = function (film) {
  let rank = Number(film?.allTimeRank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 250) return "";
  return `<span class="top-250-marker" title="Top 250 · All-time rank ${rank}" aria-label="Top 250, all-time rank ${rank}"><span aria-hidden="true">★</span><small>${rank}</small></span>`;
};

/** Extracts the numeric component of a period key. @param {*} value Period value. @returns {number} */
window.pagePeriodNumber = function (value) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
};

