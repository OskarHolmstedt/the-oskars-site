/**
 * @file Owns the cell-level presentation primitives for standard film
 * collection tables (person, franchise, tag, period, project, watchlist
 * lists). The shared column contract is Position | Film | page-specific
 * context | Rating/Tier: Position is the page-owned leftmost column named for
 * its meaning, the Film identity cell owns poster, localized linked title,
 * and ordered secondary metadata, context columns stay page-owned, and the
 * final cell shows a watched row's rating or a watchlist row's tier. Pages
 * compose these `<td>` renderers into their own rows; there is no generic
 * whole-row or whole-table schema.
 */

/**
 * Renders a film's all-time rank exactly once: the Top 250 marker when the
 * rank qualifies, otherwise a localized "all-time #N" label. This is the only
 * all-time rank presentation a Film identity cell may contain, so a marker
 * and a text label can never both describe the same rank.
 * @param {FilmRecord} film Film record.
 * @param {Object} [options] Escaping options.
 * @returns {string} Rank HTML, or "" when the film has no positive rank.
 */
window.renderFilmAllTimeRank = function (film, options = {}) {
  let escape = options.escape || window.pageEscape;
  let marker = window.renderTop250Marker(film);
  if (marker) return marker;
  let rank = Number(film?.allTimeRank);
  if (!Number.isInteger(rank) || rank < 1) return "";
  return escape(
    window.uiText?.("all-time #{rank}", { rank }) || `all-time #${rank}`,
  );
};

/**
 * Renders the standard watchlist interest tier badge, with its optional
 * minus/plus refinement suffix (options.modifier - default unmodified).
 * @param {string} tier Raw tier value.
 * @param {Object} [options] Escaping options.
 * @param {'minus'|'plus'|''} [options.modifier] Fine-grained tier refinement.
 * @returns {string} Badge HTML, or "" for an unset or unknown tier.
 */
window.renderWatchlistTierBadge = function (tier, options = {}) {
  let escape = options.escape || window.pageEscape;
  let normalized = window.normalizeWatchlistTier?.(tier) || "";
  if (!normalized) return "";
  let label = window.renderTierWithModifier?.(tier, options.modifier) || normalized;
  return `<span class="watchlist-tier tier-${escape(normalized.toLowerCase())}">${escape(label)}</span>`;
};

/**
 * Renders a minus/plus toggle for a tier's fine-grained refinement -
 * default null/unmodified, matching the rating widget's minus/plus
 * modifier toggle exactly (reuses its .rating-input-mod/.is-active CSS,
 * there being no "dot"/third state here either). The current value
 * lives in a hidden `<input name="{name}">`, so a plain FormData read
 * of the surrounding form already picks it up with no extra wiring -
 * call window.enhanceTierModifierToggles() on the containing element
 * after inserting this markup to make the buttons interactive.
 * @param {string} name Hidden input name (e.g. "tierModifier", "rewatchTierModifier").
 * @param {*} modifier Current modifier value.
 * @param {Object} [options] Rendering options.
 * @param {Function} [options.escape] HTML-escaping function.
 * @param {Function} [options.ui] Localized-text function.
 * @returns {string} Toggle widget HTML.
 */
window.renderTierModifierToggle = function (name, modifier, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let normalized = window.normalizeTierModifierValue?.(modifier) || "";
  let buttons = [
    ["minus", "−", ui("Slightly lower priority")],
    ["plus", "＋", ui("Slightly higher priority")],
  ]
    .map(
      ([mod, glyph, label]) =>
        `<button type="button" class="rating-input-mod${normalized === mod ? " is-active" : ""}" data-tier-modifier-toggle="${mod}" aria-pressed="${normalized === mod ? "true" : "false"}" aria-label="${escape(label)}" tabindex="-1">${glyph}</button>`,
    )
    .join("");
  return `<span class="rating-input-mods tier-modifier-toggle" data-tier-modifier-input><input type="hidden" name="${escape(name)}" value="${escape(normalized)}">${buttons}</span>`;
};

/**
 * Wires up every tier-modifier toggle within a container so clicking
 * minus/plus updates the paired hidden input (toggling it off, back to
 * "", on a second click of the same button) and dispatches a `change`
 * event on it. Idempotent (safe to call again after a re-render).
 * @param {Element} container Root element containing rendered toggle widgets.
 */
window.enhanceTierModifierToggles = function (container) {
  (container?.querySelectorAll?.("[data-tier-modifier-input]") || []).forEach(
    (widget) => {
      if (widget.dataset.tierModifierReady) return;
      widget.dataset.tierModifierReady = "1";
      let input = widget.querySelector("input[type=hidden]");
      let buttons = Array.from(
        widget.querySelectorAll("[data-tier-modifier-toggle]"),
      );
      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          let mod = button.dataset.tierModifierToggle;
          let next = input.value === mod ? "" : mod;
          input.value = next;
          buttons.forEach((candidate) => {
            let active = candidate.dataset.tierModifierToggle === next;
            candidate.classList.toggle("is-active", active);
            candidate.setAttribute("aria-pressed", active ? "true" : "false");
          });
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
    },
  );
};

/**
 * Renders the standard Film identity cell: poster thumbnail, localized
 * linked title, and one ordered secondary metadata line. Metadata renders in
 * a fixed order - year, all-time rank, then caller-owned fragments (credit
 * detail, `via` context, ...) - so every collection table lists the same
 * datum in the same place. Year and rank are opt-in because pages that
 * already show them in their Position column must not repeat them here.
 * Works for watched films and for watchlist film-likes
 * (`watchlistFilmLike`), which route `href` to the watchlist film page.
 * @param {FilmRecord} film Film or watchlist film-like record.
 * @param {Object} [options] Cell content options.
 * @param {Function} [options.escape] HTML escaper (defaults to `pageEscape`).
 * @param {string} [options.href] Title link target (defaults to the film page).
 * @param {boolean} [options.year] Include the film's year in metadata.
 * @param {boolean} [options.allTimeRank] Include `renderFilmAllTimeRank` output.
 * @param {string[]} [options.metaFragments] Already-safe caller metadata HTML fragments, appended in order.
 * @param {string} [options.extraHtml] Already-safe block HTML after the metadata line.
 * @param {string} [options.posterSize] Poster variant (defaults to "thumb").
 * @param {boolean} [options.poster] Set false to omit the poster.
 * @returns {string} `<td class="film-table-cell">` HTML.
 */
window.renderFilmIdentityCell = function (film, options = {}) {
  let escape = options.escape || window.pageEscape;
  let href = options.href || window.filmPageUrl(film.id);
  let title = window.localizedFilmTitle?.(film) || film.title || "";
  let fragments = [
    options.year ? escape(film.year || "") : "",
    options.allTimeRank ? window.renderFilmAllTimeRank(film, { escape }) : "",
    ...(options.metaFragments || []),
  ].filter(Boolean);
  let meta = fragments.length
    ? `<span class="leaderboard-meta">${fragments.join(" · ")}</span>`
    : "";
  let poster =
    options.poster === false
      ? ""
      : window.renderFilmPoster(film, options.posterSize || "thumb");
  return `<td class="film-table-cell">${poster}<span><a class="table-film-link" href="${escape(href)}"><strong>${escape(title)}</strong></a>${meta}${options.extraHtml || ""}</span></td>`;
};

/**
 * Renders the final Rating/Tier cell of a standard collection row: a watched
 * row's rating text, a watchlist row's tier badge, or the explicit "—" empty
 * state. The cell never repeats the all-time rank or Top 250 marker - those
 * belong to the Film identity cell. An `editHtml` override carries edit-mode
 * controls (for example the watchlist tier editor) in the same cell.
 * @param {{film: FilmRecord}|{item: WatchlistItem}} record Watched or watchlist row wrapper.
 * @param {Object} [options] Escaping and edit-control options.
 * @param {Function} [options.escape] HTML escaper (defaults to `pageEscape`).
 * @param {string} [options.editHtml] Already-safe edit-mode control HTML replacing the value.
 * @returns {string} `<td class="rating-tier-cell">` HTML.
 */
window.renderRatingTierCell = function (record = {}, options = {}) {
  let escape = options.escape || window.pageEscape;
  let content = options.editHtml || "";
  if (!content && record.film) content = escape(record.film.rating || "");
  if (!content && record.item)
    content = window.renderWatchlistTierBadge(record.item.tier, {
      escape,
      modifier: record.item.tierModifier,
    });
  return `<td class="rating-tier-cell">${content || "—"}</td>`;
};
