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
 * Renders the standard watchlist interest tier badge.
 * @param {string} tier Raw tier value.
 * @param {Object} [options] Escaping options.
 * @returns {string} Badge HTML, or "" for an unset or unknown tier.
 */
window.renderWatchlistTierBadge = function (tier, options = {}) {
  let escape = options.escape || window.pageEscape;
  let normalized = window.normalizeWatchlistTier?.(tier) || "";
  if (!normalized) return "";
  return `<span class="watchlist-tier tier-${escape(normalized.toLowerCase())}">${escape(normalized)}</span>`;
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
    content = window.renderWatchlistTierBadge(record.item.tier, { escape });
  return `<td class="rating-tier-cell">${content || "—"}</td>`;
};
