/** @file Renders breadcrumbs, reusable view-order, shuffle, section, and sort controls, and manages navigation link prefetching and pre-warming. */

/**
 * Renders a breadcrumb navigation trail.
 * @param {Object[]} items Breadcrumb labels and optional links.
 * @param {Object} [options] Escaping and accessible-label options.
 * @returns {string}
 */
window.renderBreadcrumbs = function (items, options = {}) {
  let escape = options.escape || window.pageEscape;
  let links = (items || [])
    .filter(Boolean)
    .map((item) =>
      item.href
        ? `<a href="${escape(item.href)}">${escape(item.label)}</a>`
        : `<span aria-current="page">${escape(item.label)}</span>`,
    )
    .join('<span aria-hidden="true">›</span>');
  return links
    ? `<nav class="detail-breadcrumbs" aria-label="${escape(options.label || "Breadcrumb")}">${links}</nav>`
    : "";
};

// Reusable reverse-order control, standard across every multi-film/entity
// view (issue #51). `href` renders a plain navigation link, preserving the
// original icon+text pill for pages that still want it (e.g. category.js).
// `iconOnly` (matching the shuffle control below and the grid/list view
// toggle, so all three sit as one same-shaped square-button row) drops the
// pill down to a bare square icon, for either a reload page (`href`) or a
// live-rerender page that wires its own click listener via `attribute`.
/**
 * Renders the shared chronological-order control.
 * @param {Object} [options] Current order, target, labeling, and presentation options.
 * @returns {string}
 */
window.renderChronologyControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let order = options.order === "desc" ? "desc" : "asc";
  let nextDirection =
    order === "asc"
      ? options.descDirection || "newest"
      : options.ascDirection || "oldest";
  let text =
    order === "asc"
      ? options.descLabel || "Newest first"
      : options.ascLabel || "Oldest first";
  let title = escape(options.title || `Show ${nextDirection} first`);
  let attribute = options.attribute
    ? ` ${options.attribute}`
    : options.iconOnly
      ? " data-reverse-order-button"
      : "";
  if (options.iconOnly) {
    return options.href
      ? `<a class="sort-order-button sort-order-button--icon" href="${escape(options.href)}" title="${title}" aria-label="${title}"${attribute}>⇅</a>`
      : `<button type="button" class="sort-order-button sort-order-button--icon" title="${title}" aria-label="${title}"${attribute}>⇅</button>`;
  }
  return `<div class="chronology-order-control"><a class="sort-order-button" href="${escape(options.href)}" title="${title}"${attribute}>⇅ ${escape(text)}</a></div>`;
};

// Reusable shuffle control, standard alongside the reverse-order control
// above - same square icon shape. Always the same look/label - clicking it
// (a fresh href seed for reload pages, or a click listener on `attribute`
// for live-rerender pages) just reshuffles again, with no separate
// "shuffle again" state to track.
/**
 * Renders the shared shuffle link or button.
 * @param {Object} [options] Target, labeling, attributes, and escaping options.
 * @returns {string}
 */
window.renderShuffleControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let title = escape(options.label || ui("Shuffle"));
  let attribute = options.attribute
    ? ` ${options.attribute}`
    : " data-shuffle-button";
  return options.href
    ? `<a class="sort-order-button sort-order-button--icon" href="${escape(options.href)}" title="${title}" aria-label="${title}"${attribute}>⇄</a>`
    : `<button type="button" class="sort-order-button sort-order-button--icon" title="${title}" aria-label="${title}"${attribute}>⇄</button>`;
};

// Reusable split/combined toggle for pages that render separate watched
// and watchlist blocks (issue #52) - same square-icon shape as the reverse
// and shuffle controls above. A pressed-state link: `href` is the page URL
// with the opposite sections mode, `combined` marks the current state.
/**
 * Renders the shared split-versus-combined sections toggle.
 * @param {Object} [options] Current mode, target, and escaping options.
 * @returns {string}
 */
window.renderCombinedSectionsControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let combined = options.combined === true || options.combined === "combined";
  let title = escape(
    combined
      ? ui("Show watched and watchlist separately")
      : ui("Combine watched and watchlist into one list"),
  );
  return `<a class="sort-order-button sort-order-button--icon${combined ? " is-active" : ""}" href="${escape(options.href)}" title="${title}" aria-label="${title}" aria-pressed="${combined ? "true" : "false"}" data-combined-sections-button>∪</a>`;
};

// Reusable sort-axis dropdown, standard across every multi-item view
// (issue #53) - a shared vocabulary (Title/Order/Year/Rating/Wins/Noms/
// Score) and one <select> widget, but each page still owns its own small
// value-getter for the axes it exposes (there is no single "universal
// comparator" here - a watched film's Rating isn't the same field as a
// watchlist item's Tier, a person's Score isn't a film's Score, etc). This
// just renders a consistent control; `axes` is the page-supplied ordered
// list of `{ value, label }` currently relevant to that page/section.
/**
 * Renders a shared sort-axis selector from page-supplied axes.
 * @param {Object} [options] Axis definitions, selection, attributes, and labeling options.
 * @returns {string}
 */
window.renderSortAxisControl = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let axes = options.axes || [];
  let value = options.value || (axes[0] && axes[0].value) || "";
  let attribute = options.attribute
    ? ` ${options.attribute}`
    : " data-sort-axis";
  let optionsHtml = axes
    .map(
      (axis) =>
        `<option value="${escape(axis.value)}"${axis.value === value ? " selected" : ""}>${escape(ui(axis.label))}</option>`,
    )
    .join("");
  return `<label class="sort-axis-control">${escape(ui(options.label || "Sort"))} <select${attribute}>${optionsHtml}</select></label>`;
};

/**
 * Renders the shared Overview/Awards controller for collection detail pages.
 * @param {Object} [options] Active view, destinations, and escaping options.
 * @returns {string}
 */
window.renderCollectionViewController = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let view = options.view === "awards" ? "awards" : "films";
  let overview =
    view === "films"
      ? `<strong aria-current="page">${escape(ui("Overview"))}</strong>`
      : `<a href="${escape(options.overviewUrl || "#")}">${escape(ui("Overview"))}</a>`;
  let awards =
    view === "awards"
      ? `<strong aria-current="page">${escape(ui("Awards"))}</strong>`
      : `<a href="${escape(options.awardsUrl || "#")}">${escape(ui("Awards"))}</a>`;
  return `<nav class="collection-page-view-controls" aria-label="${escape(ui("Collection view"))}">${overview}${awards}</nav>`;
};

window.OSKARS_PREFETCHED_URLS = window.OSKARS_PREFETCHED_URLS || new Set();

/**
 * Clears the session set of prefetched navigation URLs.
 */
window.clearNavigationPrefetchCache = function () {
  window.OSKARS_PREFETCHED_URLS.clear();
};

/**
 * Prefetches a navigation URL by injecting a link rel="prefetch" tag into document.head.
 * Skips duplicate URLs, non-HTTP URLs, and users with Save-Data or slow connections.
 * @param {string} url Target URL to prefetch.
 * @param {Object} [options] Prefetch configuration options.
 * @param {boolean} [options.force=false] Force prefetch even if already prefetched.
 * @returns {boolean} Whether a prefetch link was newly injected.
 */
window.prefetchNavigationUrl = function (url, options = {}) {
  let targetUrl = String(url || "").trim();
  if (
    !targetUrl ||
    targetUrl.startsWith("#") ||
    targetUrl.startsWith("javascript:") ||
    targetUrl.startsWith("mailto:") ||
    targetUrl.startsWith("tel:")
  ) {
    return false;
  }
  if (!options.force && window.OSKARS_PREFETCHED_URLS.has(targetUrl)) {
    return false;
  }
  if (typeof navigator !== "undefined") {
    if (navigator.connection?.saveData) return false;
    let effectiveType = navigator.connection?.effectiveType;
    if (effectiveType === "2g" || effectiveType === "slow-2g") return false;
  }
  window.OSKARS_PREFETCHED_URLS.add(targetUrl);
  if (
    typeof document !== "undefined" &&
    document.head &&
    typeof document.createElement === "function"
  ) {
    let link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = targetUrl;
    document.head.appendChild(link);
    return true;
  }
  return false;
};

/**
 * Resolves an element, anchor, or card into a structured navigation target.
 * @param {EventTarget|HTMLElement|null} element DOM element or event target to inspect.
 * @returns {NavigationTarget|null} Resolved navigation target, or null if not a recognized navigation link.
 */
window.resolveNavigationTarget = function (element) {
  if (!element || typeof element.closest !== "function") return null;

  let filmCard = element.closest("[data-open-film-id]");
  if (filmCard) {
    let filmId =
      filmCard.dataset?.openFilmId ||
      filmCard.getAttribute("data-open-film-id") ||
      "";
    if (filmId) {
      let url = window.filmPageUrl
        ? window.filmPageUrl(filmId)
        : `film.html?id=${encodeURIComponent(filmId)}`;
      return { kind: "film", filmId, url };
    }
  }

  let anchor = element.closest("a[href]");
  if (anchor) {
    let rawHref = anchor.getAttribute("href") || "";
    if (
      !rawHref ||
      rawHref.startsWith("#") ||
      rawHref.startsWith("javascript:") ||
      rawHref.startsWith("mailto:") ||
      rawHref.startsWith("tel:")
    ) {
      return null;
    }
    if (/^[a-z]+:\/\//i.test(rawHref)) {
      try {
        let parsed = new URL(
          rawHref,
          window.location?.href || "http://localhost",
        );
        if (window.location && parsed.origin !== window.location.origin)
          return null;
      } catch (err) {
        return null;
      }
    }
    let filmMatch = rawHref.match(/(?:^|\/)film\.html\?(?:.*&)?id=([^&#]+)/);
    if (filmMatch) {
      let filmId = decodeURIComponent(filmMatch[1]);
      return { kind: "film", filmId, url: rawHref };
    }
    let periodMatch = rawHref.match(/(?:^|\/)period\.html(?:\?(.*))?/);
    if (periodMatch) {
      let query = periodMatch[1] || "";
      let params = new URLSearchParams(query);
      let periodType = params.get("type") || "year";
      let periodKey = params.get("id") || params.get("key") || "";
      return { kind: "period", periodType, periodKey, url: rawHref };
    }
    if (/\.html(?:[?#]|$)/.test(rawHref) || !rawHref.includes(".")) {
      return { kind: "page", url: rawHref };
    }
  }

  return null;
};

/**
 * Pre-warms cache and prefetches resources for a navigation target or element.
 * @param {NavigationTarget|HTMLElement|string} target Navigation target object, DOM element, or URL string.
 * @param {Object} [options] Pre-warming options.
 * @param {boolean} [options.prewarmData=true] Whether to pre-warm in-memory or session data caches.
 * @returns {NavigationTarget|null} The resolved target.
 */
window.prewarmNavigationTarget = function (target, options = {}) {
  let resolved =
    typeof target === "string"
      ? { kind: "page", url: target }
      : target && typeof target === "object" && "url" in target
        ? target
        : window.resolveNavigationTarget(target);

  if (!resolved || !resolved.url) return null;

  window.prefetchNavigationUrl(resolved.url, options);

  if (
    options.prewarmData !== false &&
    resolved.kind === "film" &&
    resolved.filmId
  ) {
    if (typeof window.loadSupabaseFilmDetail === "function") {
      window.loadSupabaseFilmDetail(resolved.filmId).catch(() => {});
    }
    if (
      window.isUuid?.(resolved.filmId) &&
      typeof window.loadSupabaseActiveProjectsForFilm === "function"
    ) {
      window.loadSupabaseActiveProjectsForFilm(resolved.filmId).catch(() => {});
    }
  }

  return resolved;
};

/**
 * Initializes global event delegation for prefetching and pre-warming navigation links on hover/focus.
 * @param {HTMLElement|Document} [rootElement] Root element to bind event delegation to (defaults to document).
 * @param {Object} [options] Initialization options.
 * @param {number} [options.debounceMs=65] Hover debounce delay in milliseconds.
 * @returns {{ destroy: () => void }} Controller object with cleanup method.
 */
window.initNavigationPrefetch = function (rootElement, options = {}) {
  let root = rootElement || (typeof document !== "undefined" ? document : null);
  if (!root || typeof root.addEventListener !== "function") {
    return { destroy: () => {} };
  }

  let setTimer =
    typeof setTimeout === "function"
      ? setTimeout
      : typeof window !== "undefined" && typeof window.setTimeout === "function"
        ? window.setTimeout
        : (fn) => (fn(), null);
  let clearTimer =
    typeof clearTimeout === "function"
      ? clearTimeout
      : typeof window !== "undefined" &&
          typeof window.clearTimeout === "function"
        ? window.clearTimeout
        : () => {};

  let debounceMs = Number.isFinite(options.debounceMs)
    ? options.debounceMs
    : 65;
  let hoverTimer = null;
  let activeTarget = null;

  function onPointerEnter(event) {
    let target = window.resolveNavigationTarget(event.target);
    if (!target) return;
    activeTarget = target;
    clearTimer(hoverTimer);
    if (debounceMs <= 0) {
      window.prewarmNavigationTarget(target, options);
    } else {
      hoverTimer = setTimer(() => {
        if (activeTarget === target) {
          window.prewarmNavigationTarget(target, options);
        }
      }, debounceMs);
    }
  }

  function onPointerLeave() {
    clearTimer(hoverTimer);
    activeTarget = null;
  }

  function onImmediate(event) {
    let target = window.resolveNavigationTarget(event.target);
    if (!target) return;
    clearTimer(hoverTimer);
    window.prewarmNavigationTarget(target, options);
  }

  let pointerEnterEvent =
    typeof window !== "undefined" && "PointerEvent" in window
      ? "pointerover"
      : "mouseover";
  let pointerLeaveEvent =
    typeof window !== "undefined" && "PointerEvent" in window
      ? "pointerout"
      : "mouseout";

  root.addEventListener(pointerEnterEvent, onPointerEnter, { passive: true });
  root.addEventListener(pointerLeaveEvent, onPointerLeave, { passive: true });
  root.addEventListener("focusin", onImmediate, { passive: true });
  root.addEventListener("touchstart", onImmediate, { passive: true });

  return {
    destroy() {
      clearTimer(hoverTimer);
      root.removeEventListener(pointerEnterEvent, onPointerEnter);
      root.removeEventListener(pointerLeaveEvent, onPointerLeave);
      root.removeEventListener("focusin", onImmediate);
      root.removeEventListener("touchstart", onImmediate);
    },
  };
};
