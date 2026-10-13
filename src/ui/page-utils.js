/** @file Shared page primitives: escaping, query params, action feedback, technical details, watch-queue reason text, copy-view-link, list/grid view mode, class-list building. */

/** Builds a deduplicated HTML class attribute value from a base class plus extras. @param {string} base Always-included base class. @param {string|string[]} [extras] Extra class(es), space-separated if a string. @returns {string} Space-joined class list. */
window.pageClassList = function (base, extras) {
  let values = Array.isArray(extras)
    ? extras
    : String(extras || "").split(/\s+/);
  return [...new Set([base, ...values].filter(Boolean))].join(" ");
};

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

/** Escapes a value for HTML text or attribute output. Shared alias for window.pageEscape. @param {*} value Value to escape. @returns {string} */
window.escapeHtml = window.pageEscape;

/** Reads and decodes one query parameter. @param {string} name Parameter name. @returns {string} */
window.pageQueryParam = function (name) {
  let decode = (value) => {
    let raw = String(value || "").replace(/\+/g, " ");
    try {
      return decodeURIComponent(raw);
    } catch (err) {
      // A malformed percent-escape (e.g. a mistyped/truncated share link)
      // - fall back to the raw, un-decoded value rather than throwing:
      // for a key this just fails to match `name` (harmlessly excluded),
      // for a value it degrades instead of blanking the whole page. This
      // function is called from ~70 sites across src/pages/src/ui,
      // several during initial page render.
      return raw;
    }
  };
  let match = String(window.location?.search || "")
    .replace(/^\?/, "")
    .split("&")
    .map((part) => part.split("="))
    .find((parts) => decode(parts[0] || "") === name);
  return match ? decode(match.slice(1).join("=") || "") : "";
};

/**
 * Renders persistent, politely announced action feedback with an optional
 * caller-owned follow-up action such as Undo.
 * @param {Object} [options] Feedback content and action options.
 * @param {string} [options.message] Plain-text result message.
 * @param {string} [options.actionLabel] Plain-text action label.
 * @param {string} [options.actionAttribute] Safe `data-*` attribute for delegated handling.
 * @param {string} [options.actionValue] Optional action attribute value.
 * @param {(value:*)=>string} [options.escape] HTML escaping function.
 * @returns {string} Feedback HTML, or an empty string without a message.
 */
window.renderActionFeedback = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let message = String(options.message || "").trim();
  if (!message) return "";
  let actionLabel = String(options.actionLabel || "").trim();
  let actionAttribute = String(options.actionAttribute || "").trim();
  let validActionAttribute = /^data-[a-z0-9-]+$/.test(actionAttribute);
  let actionHtml =
    actionLabel && validActionAttribute
      ? ` <button type="button" class="link-button" ${actionAttribute}${options.actionValue === undefined ? "" : `="${escape(String(options.actionValue))}"`}>${escape(actionLabel)}</button>`
      : "";
  return `<p class="data-panel-status action-feedback" role="status" aria-live="polite" aria-atomic="true"><span>${escape(message)}</span>${actionHtml}</p>`;
};

// Turns a watch-queue reason (src/domain/watch-queue.js, issue #160) into
// one full, independently localizable sentence per reason type, rather than
// gluing a translated lead-in to a translated fragment (composed sentences
// don't reliably hold together across languages). Shared by Discover's
// "Surprise me" picker (issue #161) and the watchlist view's queue panel
// (issue #163) so the two surfaces describe a pick identically.
/** Formats a watch-queue pick reason for display. @param {WatchQueueReason} reason Reason to format. @returns {string} */
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
    : /** @type {'list'|'grid'} */ (String(defaultMode || "grid"));
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

/** Renders an all-time Top 250 marker when eligible. @param {FilmRecord} film Film record. @returns {string} */
window.renderTop250Marker = function (film) {
  if (window.isFilmRankConfirmed?.(film, "allTime") === false) return "";
  let rank = Number(film?.allTimeRank);
  if (!Number.isInteger(rank) || rank < 1 || rank > 250) return "";
  return `<span class="top-250-marker" title="Top 250 · All-time rank ${rank}" aria-label="Top 250, all-time rank ${rank}"><span aria-hidden="true">#</span><small>${rank}</small></span>`;
};

/** Extracts the numeric component of a period key. @param {*} value Period value. @returns {number} */
window.pagePeriodNumber = function (value) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
};

/**
 * Derives up to two uppercase initials from a person or entity name.
 * @param {string} [name] Name string.
 * @returns {string} 1-2 uppercase characters, or empty string.
 */
window.initialsFor = function (name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] || "")
    .join("")
    .toLocaleUpperCase();
};

/**
 * Formats a numeric star rating with a star symbol (e.g. 4★, 4.5★).
 * @param {number|string} value Star rating value.
 * @returns {string} Formatted star rating string.
 */
window.formatStarRating = function (value) {
  if (value == null || value === "") return "";
  let num = Number(value);
  if (!Number.isFinite(num)) return "";
  return `${num % 1 ? num : num.toFixed(0)}★`;
};

/**
 * Calls back once any of a container's `[data-needs-complete-archive]`
 * placeholders scrolls into view (issue #636): compact pages load the
 * complete archive only when a section that needs it is actually seen, not
 * right after their first paint. A placeholder inside a collapsed section
 * never intersects, so expanding it is what triggers the load.
 * @param {Element} container Rendered page content.
 * @param {() => void} callback Starts the complete-archive load.
 * @returns {() => void} Stops watching; call before the next render.
 */
window.whenCompleteArchiveNeeded = function (container, callback) {
  let targets = container?.querySelectorAll?.("[data-needs-complete-archive]");
  if (!targets?.length) return () => {};
  if (typeof IntersectionObserver !== "function") {
    callback();
    return () => {};
  }
  let observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    callback();
  });
  targets.forEach((target) => observer.observe(target));
  return () => observer.disconnect();
};
