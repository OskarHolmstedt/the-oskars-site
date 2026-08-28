/**
 * @file Parses, normalizes, indexes, sorts, edits, and enriches watchlist
 * records, including poster and TMDB metadata batch operations.
 */

function parseWatchlistDelimitedRows(raw) {
  let rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  let delimiter = text.includes("\t") ? "\t" : ",";

  for (let index = 0; index < text.length; index++) {
    let character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

window.WATCHLIST_TIERS = ["S", "A", "B", "C", "D", "E", "F"];

/**
 * Converts a value to a supported uppercase watchlist tier.
 * @param {*} value Candidate tier.
 * @returns {string}
 */
window.normalizeWatchlistTier = function (value) {
  let tier = String(value || "")
    .trim()
    .toUpperCase();
  return window.WATCHLIST_TIERS.includes(tier) ? tier : "";
};

/**
 * Returns the sort position of a watchlist tier, placing invalid tiers last.
 * @param {*} value Candidate tier.
 * @returns {number}
 */
window.watchlistTierRank = function (value) {
  let index = window.WATCHLIST_TIERS.indexOf(
    window.normalizeWatchlistTier(value),
  );
  return index >= 0 ? index : window.WATCHLIST_TIERS.length;
};

/**
 * Returns every selectable watchlist/rewatch tier-filter value: the ranked
 * tiers plus the blank `""` "unset" tier. Shared by period.js's Rewatchlist
 * tier filter and period/watchlist-view.js's Watchlist tier filter, which
 * both filter on this same tier vocabulary.
 * @returns {string[]}
 */
window.watchlistTierFilterValues = function () {
  return [...window.WATCHLIST_TIERS, ""];
};

/**
 * Parses a comma-separated multi-tier URL filter value: `null` means every
 * tier (no filter active), `[]` means none (the explicit "none" value), and
 * a populated array lists the selected tiers with `""` standing in for
 * "unset" (blank tier).
 * @param {string} raw Raw `tiers`/`tier` query value.
 * @returns {string[]|null}
 */
window.parseWatchlistTierFilters = function (raw) {
  if (!raw || raw === "all") return null;
  if (raw === "none") return [];
  let tiers = String(raw)
    .split(",")
    .map((value) => {
      let text = String(value || "")
        .trim()
        .toLowerCase();
      if (text === "unset" || text === "unranked" || text === "blank")
        return "";
      return window.normalizeWatchlistTier(value);
    })
    .filter(
      (tier, index, list) =>
        (tier || tier === "") && list.indexOf(tier) === index,
    );
  return tiers.length ? tiers : null;
};

/**
 * Normalizes an imported object into the persisted watchlist shape.
 * @param {Object} item Raw watchlist fields.
 * @returns {WatchlistItem|null}
 */
window.normalizeWatchlistItem = function (item) {
  let title = String(item?.title || item?.name || "").trim();
  let year = String(item?.year || "").trim();
  let letterboxdUrl = String(item?.letterboxdUrl || item?.url || "").trim();
  let tmdbId = String(
    item?.tmdbId || item?.tmdbID || item?.["tmdb id"] || "",
  ).trim();
  let swedishTitle = String(
    item?.swedishTitle || item?.["swedish title"] || "",
  ).trim();
  let order = Number(
    item?.order ||
      item?.watchlistOrder ||
      item?.interestOrder ||
      item?.globalOrder,
  );
  if (!title) return null;
  return {
    id: `${/^\d{4}$/.test(year) ? year : ""}::${window.normalizeTitle(title)}`,
    title,
    year: /^\d{4}$/.test(year) ? year : "",
    letterboxdUrl,
    tmdbId,
    swedishTitle,
    tier: window.normalizeWatchlistTier(item?.tier || item?.rank),
    director: String(item?.director || "").trim(),
    tags: window.parseFilmTags?.(item?.tags) || [],
    franchises: window.normalizeFranchiseMemberships?.(item?.franchises) || [],
    poster: window.normalizePosterRecord?.(item?.poster) || null,
    order: Number.isFinite(order) && order > 0 ? order : null,
  };
};

/**
 * Adds a single new watchlist item, rejecting an exact title+year duplicate
 * rather than creating a second entry with a colliding id.
 * @param {Object} values Raw form values (title, year, director, tier).
 * @param {Object} [options] Save controls.
 * @returns {{ok: boolean, item?: WatchlistItem, reason?: string}}
 */
window.addWatchlistItem = function (values, options = {}) {
  let item = window.normalizeWatchlistItem(values);
  if (!item) return { ok: false, reason: "A film title is required." };
  if (window.findWatchlistItemById(item.id))
    return { ok: false, reason: "This film is already on the watchlist." };
  state.watchlist ||= [];
  state.watchlist.push(item);
  window.recomputeWatchlistOrder?.();
  window.markAggregatesDirty?.("watchlist item added");
  if (window.recordEdit) {
    window.recordEdit({
      type: "watchlist added",
      summary: `${item.title} (${item.year || ""})`,
      sheetHint: "Watchlist",
      changes: [
        { field: "title", before: "", after: item.title },
        { field: "year", before: "", after: item.year || "" },
        { field: "director", before: "", after: item.director || "" },
        { field: "tier", before: "", after: item.tier || "" },
      ],
      context: { itemId: item.id },
    });
  }
  if (options.save !== false) window.save();
  return { ok: true, item };
};

/**
 * Parses a Letterboxd-compatible CSV or TSV watchlist and records skipped rows.
 * @param {string} raw Raw delimited text.
 * @returns {Object} Parsed watchlist items and skipped-row diagnostics.
 */
window.parseWatchlist = function (raw) {
  let rows = parseWatchlistDelimitedRows(raw);
  if (!rows.length)
    return { items: [], diagnostics: { skippedRows: 0, skippedDetails: [] } };
  let header = rows[0].map((value) =>
    String(value || "")
      .trim()
      .toLowerCase(),
  );
  let hasHeader = header.some((value) =>
    ["date", "name", "year", "letterboxd uri", "letterboxd url"].includes(
      value,
    ),
  );
  let dataRows = hasHeader ? rows.slice(1) : rows;
  let indexes = hasHeader
    ? {
        title: header.indexOf("name"),
        year: header.indexOf("year"),
        letterboxdUrl: Math.max(
          header.indexOf("letterboxd uri"),
          header.indexOf("letterboxd url"),
        ),
        tier: Math.max(header.indexOf("tier"), header.indexOf("rank")),
        director: header.indexOf("director"),
        tags: header.indexOf("tags"),
        franchises: header.indexOf("franchises"),
        tmdbId: Math.max(header.indexOf("tmdb id"), header.indexOf("tmdbid")),
        order: Math.max(
          header.indexOf("order"),
          header.indexOf("watchlist order"),
          header.indexOf("interest order"),
          header.indexOf("global order"),
        ),
      }
    : { title: 1, year: 2, letterboxdUrl: 3 };
  let skippedRows = 0;
  let skippedDetails = [];
  let seen = new Set();
  let items = [];

  function cleanCell(value) {
    return String(value || "").trim();
  }

  function recordSkipped(rowIndex, reason, values) {
    skippedRows += 1;
    skippedDetails.push({
      rowNumber: rowIndex + (hasHeader ? 2 : 1),
      reason,
      values: (values || [])
        .map((value) => cleanCell(value))
        .filter(Boolean)
        .slice(0, 8),
    });
  }

  dataRows.forEach((row, rowIndex) => {
    let item = window.normalizeWatchlistItem({
      title: indexes.title >= 0 ? row[indexes.title] : "",
      year: indexes.year >= 0 ? row[indexes.year] : "",
      letterboxdUrl:
        indexes.letterboxdUrl >= 0 ? row[indexes.letterboxdUrl] : "",
      tier: indexes.tier >= 0 ? row[indexes.tier] : "",
      director: indexes.director >= 0 ? row[indexes.director] : "",
      tags: indexes.tags >= 0 ? row[indexes.tags] : "",
      franchises:
        indexes.franchises >= 0
          ? window.parseFranchiseMemberships(row[indexes.franchises])
          : [],
      tmdbId: indexes.tmdbId >= 0 ? row[indexes.tmdbId] : "",
      order: indexes.order >= 0 ? row[indexes.order] : "",
    });
    if (!item) {
      recordSkipped(rowIndex, "No usable film title found.", row);
      return;
    }
    let key = `${window.normalizeTitle(item.title)}\n${item.year}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  });

  return { items, diagnostics: { skippedRows, skippedDetails } };
};

/**
 * Builds a watchlist item's normalized year-and-title identifier.
 * @param {WatchlistItem} item Watchlist item.
 * @returns {string}
 */
window.watchlistItemId = function (item) {
  return `${String(item?.year || "").trim()}::${window.normalizeTitle(item?.title || "")}`;
};

function watchlistItemLookup() {
  let version = Number(state.aggregateVersion) || 0;
  let cache = state._watchlistItemLookup;
  if (cache?.version === version) return cache;
  let byId = new Map();
  (state.watchlist || []).forEach((item) => {
    let id = item.id || window.watchlistItemId(item);
    if (!id) return;
    item.id ||= id;
    byId.set(id, item);
  });
  cache = { version, byId };
  state._watchlistItemLookup = cache;
  return cache;
}

/**
 * Finds a watchlist item by its stable identifier.
 * @param {string} id Watchlist identifier.
 * @returns {WatchlistItem|null}
 */
window.findWatchlistItemById = function (id) {
  let target = String(id || "");
  return watchlistItemLookup().byId.get(target) || null;
};

function uniqueLookupValue(map, key) {
  if (!key) return null;
  let value = map.get(key);
  return value && value.unique ? value.film : null;
}

function setUniqueLookupValue(map, key, film) {
  if (!key) return;
  let existing = map.get(key);
  if (!existing) map.set(key, { unique: true, film });
  else {
    existing.unique = false;
    existing.film = null;
  }
}

function watchlistArchiveLookup() {
  let version = Number(state.aggregateVersion) || 0;
  let cache = state._watchlistArchiveLookup;
  if (cache?.version === version) return cache;
  let byTmdb = new Map();
  let byYearTitle = new Map();
  Object.values(state.filmsById || {}).forEach((film) => {
    let tmdbId = String(film.tmdbId || "").trim();
    if (tmdbId) setUniqueLookupValue(byTmdb, tmdbId, film);
    let title = window.normalizeTitle(film.title);
    let year = String(film.year || "").trim();
    if (title && year)
      setUniqueLookupValue(byYearTitle, `${year}\n${title}`, film);
  });
  cache = { version, byTmdb, byYearTitle };
  state._watchlistArchiveLookup = cache;
  return cache;
}

/**
 * Finds the unique archive film matching a watchlist item by TMDB id or title/year.
 * @param {WatchlistItem} item Watchlist item.
 * @returns {FilmRecord|null}
 */
window.findWatchlistArchiveFilm = function (item) {
  let title = window.normalizeTitle(item?.title);
  let year =
    window.filmConcreteYear?.(item?.year) ||
    (/^\d{4}$/.test(String(item?.year || "")) ? String(item.year) : "");
  let tmdbId = String(item?.tmdbId || "").trim();
  let lookup = watchlistArchiveLookup();
  if (tmdbId) {
    let match = uniqueLookupValue(lookup.byTmdb, tmdbId);
    if (match) return match;
  }
  if (!title || !year) return null;
  return uniqueLookupValue(lookup.byYearTitle, `${year}\n${title}`);
};

/**
 * Lists exact and possible archive matches for a watchlist item.
 * @param {WatchlistItem} item Watchlist item.
 * @param {Object} [options] Candidate limit options.
 * @returns {Object[]} Ranked candidates with film, confidence, and reason fields.
 */
window.watchlistArchiveMatchCandidates = function (item, options = {}) {
  let normalizedTitle = window.normalizeTitle(item?.title || "");
  let year =
    window.filmConcreteYear?.(item?.year) ||
    (/^\d{4}$/.test(String(item?.year || "")) ? String(item.year) : "");
  let tmdbId = String(item?.tmdbId || "").trim();
  let limit = Math.max(1, Number(options.limit) || 5);
  let candidates = [];
  let seen = new Set();
  function confidence(film) {
    let sameTmdb = tmdbId && String(film.tmdbId || "").trim() === tmdbId;
    let sameTitle =
      normalizedTitle && window.normalizeTitle(film.title) === normalizedTitle;
    let sameYear = year && String(film.year || "") === year;
    if (sameTmdb) return { level: "exact", label: "TMDB ID match" };
    if (sameTitle && sameYear)
      return { level: "exact", label: "Title and year match" };
    if (sameTitle)
      return {
        level: "possible",
        label: year ? "Same title, different year" : "Same title, year unknown",
      };
    return null;
  }
  Object.values(state.filmsById || {}).forEach((film) => {
    let result = confidence(film);
    if (!result || seen.has(film.id)) return;
    seen.add(film.id);
    candidates.push({ film, confidence: result.level, reason: result.label });
  });
  return candidates
    .sort((left, right) => {
      let order = { exact: 0, possible: 1 };
      return (
        (order[left.confidence] ?? 9) - (order[right.confidence] ?? 9) ||
        Math.abs(
          Number(left.film.year || 0) - Number(year || left.film.year || 0),
        ) -
          Math.abs(
            Number(right.film.year || 0) - Number(year || right.film.year || 0),
          ) ||
        window.compareEnglishTitles(left.film.title, right.film.title)
      );
    })
    .slice(0, limit);
};

/**
 * Builds the detail-page URL for a watchlist item.
 * @param {string} id Watchlist identifier.
 * @returns {string}
 */
window.watchlistFilmPageUrl = function (id) {
  return `watchlist-film.html?id=${encodeURIComponent(String(id || ""))}`;
};

/**
 * Projects a watchlist item and optional archive match into a film-like record.
 * @param {WatchlistItem} item Watchlist item.
 * @param {FilmRecord|null} [archiveFilm] Matching archive film.
 * @returns {FilmRecord|null}
 */
window.watchlistFilmLike = function (
  item,
  archiveFilm = window.findWatchlistArchiveFilm(item),
) {
  if (!item) return null;
  let id = item.id || window.watchlistItemId(item);
  return Object.assign({}, archiveFilm || {}, {
    id,
    title: item.title,
    year: item.year || archiveFilm?.year || "",
    tmdbId: item.tmdbId || archiveFilm?.tmdbId || "",
    director: item.director || archiveFilm?.director || "",
    directors: item.director
      ? String(item.director)
          .split(/\s*,\s*/)
          .filter(Boolean)
      : archiveFilm?.directors || [],
    swedishTitle: item.swedishTitle || archiveFilm?.swedishTitle || "",
    country: item.country || archiveFilm?.country || "",
    medium: item.medium || archiveFilm?.medium || "unknown",
    screenplayType:
      item.screenplayType || archiveFilm?.screenplayType || "unknown",
    adaptationSource:
      item.adaptationSource || archiveFilm?.adaptationSource || "",
    platform: item.platform || archiveFilm?.platform || "",
    runtimeMinutes: item.runtimeMinutes || archiveFilm?.runtimeMinutes || "",
    tags: window.parseFilmTags([
      ...(archiveFilm?.tags || []),
      ...(item.tags || []),
    ]),
    franchises: window.normalizeFranchiseMemberships([
      ...(archiveFilm?.franchises || []),
      ...(item.franchises || []),
    ]),
    poster:
      window.normalizePosterRecord?.(item.poster) ||
      archiveFilm?.poster ||
      null,
    url: item.letterboxdUrl || archiveFilm?.url || "",
    watchlistItem: item,
    archiveFilm,
  });
};

/**
 * Lists populated watchlist period keys for a period type, optionally
 * restricted to one interest tier.
 * @param {string} periodType Year, decade, or century period type.
 * @param {string} [tier] Interest tier to restrict to; omit for every tier.
 * @returns {string[]}
 */
window.watchlistPeriodKeys = function (periodType, tier) {
  let normalizedTier = tier === undefined ? null : window.normalizeWatchlistTier(tier);
  let keys = new Set();
  (state.watchlist || []).forEach((item) => {
    if (
      normalizedTier !== null &&
      window.normalizeWatchlistTier(item?.tier) !== normalizedTier
    )
      return;
    let archiveFilm = window.findWatchlistArchiveFilm?.(item);
    let year = String(item?.year || archiveFilm?.year || "").trim();
    if (!/^\d{4}$/.test(year)) return;
    if (periodType === "year" || periodType === "years") keys.add(year);
    else if (periodType === "decade" || periodType === "decades")
      keys.add(window.getDecadeKey(year));
    else if (periodType === "century" || periodType === "centuries")
      keys.add(window.getCenturyKey(year));
  });
  return [...keys].sort(
    (left, right) =>
      Number(left.replace(/s$/, "")) - Number(right.replace(/s$/, "")),
  );
};

// Typed, setter-shaped snapshot of the watchlist fields whose edits are
// reversible (issue #132); keys and normalization mirror setWatchlistMetadata.
let WATCHLIST_UNDO_FIELD_LABELS = {
  tier: "tier",
  director: "director",
  tags: "tags",
  franchises: "franchises",
  letterboxdUrl: "Letterboxd URL",
  tmdbId: "TMDB ID",
  country: "country",
  runtimeMinutes: "runtime",
  medium: "medium",
  screenplayType: "screenplay",
  adaptationSource: "adaptation source",
  swedishTitle: "Swedish title",
  platform: "platform",
};

function watchlistUndoSnapshot(source) {
  let snapshot = {};
  Object.keys(WATCHLIST_UNDO_FIELD_LABELS).forEach((key) => {
    snapshot[key] =
      key === "tags"
        ? [...(source.tags || [])]
        : key === "franchises"
          ? window.formatFranchiseMemberships(source.franchises)
          : key === "runtimeMinutes"
            ? (source.runtimeMinutes ?? "")
            : String(source[key] ?? "").trim();
  });
  return snapshot;
}

/**
 * Applies normalized editable metadata to a watchlist item and optionally logs and saves it.
 * @param {string} id Watchlist identifier.
 * @param {Object} values Metadata fields to update.
 * @param {Object} [options] Logging and persistence options.
 * @returns {WatchlistItem|false}
 */
window.setWatchlistMetadata = function (id, values, options = {}) {
  let item = window.findWatchlistItemById(id);
  if (!item) return false;
  item.id ||= window.watchlistItemId(item);
  // Every metadata field the watchlist-film page displays is editable here
  // (issue #16), mirroring the archive film edit form's normalization.
  function watchlistMetadataLogFields() {
    return {
      tier: item.tier,
      director: item.director,
      tags: item.tags,
      franchises: item.franchises,
      letterboxdUrl: item.letterboxdUrl,
      tmdbId: item.tmdbId,
      country: item.country,
      runtimeMinutes: item.runtimeMinutes,
      medium: item.medium,
      screenplayType: item.screenplayType,
      adaptationSource: item.adaptationSource,
      swedishTitle: item.swedishTitle,
      platform: item.platform,
    };
  }
  let beforeLog = watchlistMetadataLogFields();
  if (Object.prototype.hasOwnProperty.call(values, "tier"))
    item.tier = window.normalizeWatchlistTier(values.tier);
  if (Object.prototype.hasOwnProperty.call(values, "director"))
    item.director = String(values.director || "").trim();
  if (Object.prototype.hasOwnProperty.call(values, "tags"))
    item.tags = window.parseFilmTags(values.tags);
  if (Object.prototype.hasOwnProperty.call(values, "franchises"))
    item.franchises = window.parseFranchiseMemberships(values.franchises);
  if (Object.prototype.hasOwnProperty.call(values, "letterboxdUrl"))
    item.letterboxdUrl = String(values.letterboxdUrl || "").trim();
  if (Object.prototype.hasOwnProperty.call(values, "tmdbId"))
    item.tmdbId = String(values.tmdbId || "").trim();
  if (Object.prototype.hasOwnProperty.call(values, "country"))
    item.country = String(values.country || "").trim();
  if (Object.prototype.hasOwnProperty.call(values, "runtimeMinutes")) {
    let runtime = Number(values.runtimeMinutes);
    item.runtimeMinutes =
      Number.isInteger(runtime) && runtime > 0 ? runtime : "";
  }
  if (Object.prototype.hasOwnProperty.call(values, "medium")) {
    item.medium = ["live-action", "animation", "hybrid"].includes(values.medium)
      ? values.medium
      : "unknown";
  }
  if (Object.prototype.hasOwnProperty.call(values, "screenplayType")) {
    item.screenplayType = ["original", "adapted"].includes(
      values.screenplayType,
    )
      ? values.screenplayType
      : "unknown";
  }
  if (Object.prototype.hasOwnProperty.call(values, "adaptationSource")) {
    item.adaptationSource =
      window.normalizeAdaptationSource?.(values.adaptationSource) ??
      String(values.adaptationSource || "").trim();
    if (item.screenplayType === "original") item.adaptationSource = "";
    else if (
      item.adaptationSource &&
      (!item.screenplayType || item.screenplayType === "unknown")
    )
      item.screenplayType = "adapted";
  }
  if (Object.prototype.hasOwnProperty.call(values, "swedishTitle"))
    item.swedishTitle = String(values.swedishTitle || "").trim();
  if (Object.prototype.hasOwnProperty.call(values, "platform"))
    item.platform = String(values.platform || "").trim();
  if (options.log !== false && window.recordEdit) {
    let afterLog = watchlistMetadataLogFields();
    let changes = window.editLogChanges(beforeLog, afterLog, [
      "tier",
      "director",
      "tags",
      "franchises",
      { key: "letterboxdUrl", label: "Letterboxd URL" },
      { key: "tmdbId", label: "TMDB ID" },
      "country",
      { key: "runtimeMinutes", label: "runtime" },
      "medium",
      { key: "screenplayType", label: "screenplay" },
      { key: "adaptationSource", label: "adaptation source" },
      { key: "swedishTitle", label: "Swedish title" },
      "platform",
    ]);
    if (changes.length) {
      // Reversible payload (issue #132): only when every changed field is a
      // supported typed field, so an undo restores the edit completely.
      let undoBefore = watchlistUndoSnapshot(beforeLog);
      let undoAfter = watchlistUndoSnapshot(item);
      let undoFields = Object.keys(WATCHLIST_UNDO_FIELD_LABELS)
        .filter(
          (key) =>
            JSON.stringify(undoBefore[key]) !== JSON.stringify(undoAfter[key]),
        )
        .map((key) => ({
          key,
          label: WATCHLIST_UNDO_FIELD_LABELS[key],
          before: undoBefore[key],
          after: undoAfter[key],
        }));
      window.recordEdit({
        type: "watchlist metadata",
        summary: `${item.title || "Watchlist film"} (${item.year || ""})`,
        sheetHint: "Watchlist",
        changes,
        undo:
          undoFields.length && undoFields.length === changes.length
            ? {
                version: 1,
                kind: "watchlist-metadata",
                target: { watchlistId: item.id },
                fields: undoFields,
              }
            : null,
        context: { watchlistId: item.id },
      });
    }
  }
  window.markAggregatesDirty?.("watchlist metadata updated");
  if (options.save !== false) window.save();
  return item;
};

/**
 * Removes one item from the watchlist entirely (as opposed to marking it
 * watched, which is a transition, not a removal). Always records the id
 * into `state.declinedOfficialWatchlistAdds` (issue: shared official-results
 * archive) so the shared archive's automatic reconciliation never re-adds
 * this exact title+year again - harmless to record for a non-official item,
 * since that reconciliation only ever consults the set for official
 * candidates. This exclusion is scoped to that one automatic path only: a
 * manual re-add (the existing Completion-page "Add unseen" button) or any
 * other import path is never blocked by it.
 * @param {string} id Watchlist identifier.
 * @param {Object} [options] Logging and persistence options.
 * @returns {boolean} Whether an item was removed.
 */
window.removeWatchlistItem = function (id, options = {}) {
  let item = window.findWatchlistItemById(id);
  if (!item) return false;
  item.id ||= window.watchlistItemId(item);
  state.watchlist = (state.watchlist || []).filter(
    (candidate) => candidate !== item,
  );
  state.declinedOfficialWatchlistAdds ||= [];
  if (!state.declinedOfficialWatchlistAdds.includes(item.id))
    state.declinedOfficialWatchlistAdds.push(item.id);
  if (options.log !== false && window.recordEdit)
    window.recordEdit({
      type: "watchlist removed",
      summary: `${item.title || "Watchlist film"} (${item.year || ""})`,
      sheetHint: "Watchlist",
      changes: [{ field: "watchlist", before: item.title || "", after: "" }],
      context: { watchlistId: item.id },
    });
  window.recomputeWatchlistOrder?.();
  window.markAggregatesDirty?.("watchlist item removed");
  if (options.save !== false) window.save();
  return true;
};

/**
 * Assigns a tier to selected watchlist items and restores canonical ordering.
 * @param {string[]} ids Watchlist identifiers.
 * @param {string} tier Target tier.
 * @param {Object} [options] Logging and persistence options.
 * @returns {Object} Bulk-update result and counts.
 */
window.setWatchlistTierForItems = function (ids, tier, options = {}) {
  let normalizedTier = window.normalizeWatchlistTier(tier);
  let idSet = new Set(
    (ids || []).map((id) => String(id || "")).filter(Boolean),
  );
  if (!idSet.size)
    return {
      ok: false,
      changed: 0,
      skipped: 0,
      reason: "No watchlist films selected.",
    };
  let changedItems = [];
  let skipped = 0;
  (state.watchlist || []).forEach((item) => {
    item.id ||= window.watchlistItemId(item);
    if (!idSet.has(item.id)) return;
    let beforeTier = window.normalizeWatchlistTier(item.tier);
    if (beforeTier === normalizedTier) {
      skipped += 1;
      return;
    }
    changedItems.push({ item, beforeTier });
    item.tier = normalizedTier;
  });
  if (!changedItems.length)
    return { ok: true, changed: 0, skipped, tier: normalizedTier };
  window.recomputeWatchlistOrder?.();
  window.markAggregatesDirty?.("watchlist tiers updated");
  if (options.log !== false && window.recordEdit) {
    let sample = changedItems
      .slice(0, 12)
      .map((entry) => entry.item.title)
      .join(", ");
    let extra =
      changedItems.length > 12 ? `, +${changedItems.length - 12}` : "";
    window.recordEdit({
      type: "watchlist bulk tier",
      summary: `Set ${changedItems.length} watchlist film(s) to ${normalizedTier || "unset"}`,
      sheetHint: "Watchlist",
      changes: [
        { field: "tier", before: "mixed", after: normalizedTier || "unset" },
        { field: "films", before: "", after: `${sample}${extra}` },
      ],
      context: {
        watchlistIds: changedItems.map((entry) => entry.item.id),
        tier: normalizedTier,
      },
    });
  }
  if (options.save !== false) window.save();
  return {
    ok: true,
    changed: changedItems.length,
    skipped,
    tier: normalizedTier,
  };
};

function compareWatchlistItemsForCanonicalOrder(leftEntry, rightEntry) {
  let left = leftEntry.item;
  let right = rightEntry.item;
  let tierComparison =
    window.watchlistTierRank(left?.tier) -
    window.watchlistTierRank(right?.tier);
  if (tierComparison) return tierComparison;
  let leftOrder = Number(left?.order);
  let rightOrder = Number(right?.order);
  let leftRanked = Number.isFinite(leftOrder) && leftOrder > 0;
  let rightRanked = Number.isFinite(rightOrder) && rightOrder > 0;
  if (leftRanked && rightRanked && leftOrder !== rightOrder)
    return leftOrder - rightOrder;
  if (leftRanked && !rightRanked) return -1;
  if (!leftRanked && rightRanked) return 1;
  return (
    Number(left?.year || 9999) - Number(right?.year || 9999) ||
    window.compareEnglishTitles(left?.title, right?.title) ||
    leftEntry.index - rightEntry.index
  );
}

function watchlistItemsInCanonicalOrder() {
  return (state.watchlist || [])
    .map((item, index) => ({ item, index }))
    .sort(compareWatchlistItemsForCanonicalOrder)
    .map((entry) => entry.item);
}

/** Recomputes persisted watchlist order and invalidates watchlist lookup caches. */
window.recomputeWatchlistOrder = function () {
  window.state._watchlistArchiveLookup = null;
  window.state._watchlistItemLookup = null;
  window.state._watchlistDirectorLookup = null;
  watchlistItemsInCanonicalOrder().forEach((item, index) => {
    item.order = index + 1;
  });
};

/**
 * Moves one watchlist item relative to another item in the same tier.
 * @param {string} fromId Identifier of the item to move.
 * @param {string} toId Identifier of the reference item.
 * @param {'before'|'after'} [position] Placement relative to the reference item.
 * @returns {Object} Move result with an explanatory reason on failure.
 */
window.moveWatchlistItemWithinTier = function (
  fromId,
  toId,
  position = "before",
) {
  if (!fromId || !toId || fromId === toId)
    return { ok: false, reason: "Choose two different watchlist films." };
  let fromItem = window.findWatchlistItemById(fromId);
  let toItem = window.findWatchlistItemById(toId);
  if (!fromItem || !toItem)
    return { ok: false, reason: "Both films must exist in the watchlist." };
  let fromTier = window.normalizeWatchlistTier(fromItem.tier);
  let toTier = window.normalizeWatchlistTier(toItem.tier);
  if (fromTier !== toTier)
    return {
      ok: false,
      reason: "Watchlist ordering moves are limited to the same interest tier.",
    };

  let orderedItems = watchlistItemsInCanonicalOrder();
  let buckets = new Map();
  orderedItems.forEach((item) => {
    let tier = window.normalizeWatchlistTier(item.tier);
    if (!buckets.has(tier)) buckets.set(tier, []);
    buckets.get(tier).push(item);
  });
  let tierItems = [...(buckets.get(fromTier) || [])];
  let fromIndex = tierItems.indexOf(fromItem);
  let toIndex = tierItems.indexOf(toItem);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex)
    return { ok: false, reason: "No watchlist move needed." };
  let beforeOrder = fromItem.order || "";
  tierItems.splice(fromIndex, 1);
  toIndex = tierItems.indexOf(toItem);
  tierItems.splice(position === "after" ? toIndex + 1 : toIndex, 0, fromItem);
  buckets.set(fromTier, tierItems);
  [...buckets.keys()]
    .sort(
      (left, right) =>
        window.watchlistTierRank(left) - window.watchlistTierRank(right),
    )
    .flatMap((tier) => buckets.get(tier))
    .forEach((item, index) => {
      item.order = index + 1;
    });
  window.state._watchlistDirectorLookup = null;
  window.markAggregatesDirty?.("watchlist order reordered");
  if (window.recordEdit) {
    window.recordEdit({
      type: "watchlist order reorder",
      summary: `${fromItem.title} ${position} ${toItem.title}`,
      sheetHint: "Watchlist",
      changes: [
        {
          field: fromItem.title,
          before: String(beforeOrder),
          after: String(fromItem.order || ""),
        },
        {
          field: "moved",
          before: "",
          after:
            position === "after"
              ? `after ${toItem.title}`
              : `before ${toItem.title}`,
        },
      ],
      context: { fromId, toId, position, tier: fromTier },
    });
  }
  return { ok: true };
};

/**
 * Lists one interest tier's watchlist items in their current canonical order.
 * @param {string} tier Interest tier.
 * @returns {WatchlistItem[]}
 */
window.watchlistTierItemsInOrder = function (tier) {
  let normalizedTier = window.normalizeWatchlistTier(tier);
  return watchlistItemsInCanonicalOrder().filter(
    (item) => window.normalizeWatchlistTier(item.tier) === normalizedTier,
  );
};

/**
 * Filters one interest tier's items to a period scope, or the whole tier,
 * keeping their existing relative order (issue #73's merge tool).
 * @param {string} tier Interest tier.
 * @param {'year'|'decade'|'century'|'all'} periodType Scope granularity.
 * @param {string} [periodKey] Period key; ignored when periodType is "all".
 * @returns {WatchlistItem[]}
 */
window.watchlistTierPeriodScopeItems = function (tier, periodType, periodKey) {
  let items = window.watchlistTierItemsInOrder(tier);
  if (periodType === "all") return items;
  return items.filter((item) => {
    let archiveFilm = window.findWatchlistArchiveFilm(item);
    return window.filmMatchesFilters(
      { year: String(item.year || archiveFilm?.year || "").trim() },
      { period: `${periodType}:${periodKey}` },
    );
  });
};

/**
 * Applies a fully-decided merge order to the tier-bucket slots the given ids
 * already occupy, leaving every other item in the tier at its existing
 * position. A workflow tool for arriving at a tier's order faster by
 * interleaving two already-ordered groups (issue #73) - not a second
 * persisted order model; the result is still just the one global `order`
 * field every other watchlist tool reads and writes.
 * @param {string} tier Interest tier.
 * @param {string[]} orderedIds Watchlist ids in the desired final relative order.
 * @returns {Object} Apply result with an explanatory reason on failure.
 */
window.applyWatchlistTierMergeOrder = function (tier, orderedIds) {
  let normalizedTier = window.normalizeWatchlistTier(tier);
  let ids = (orderedIds || []).map((id) => String(id || "")).filter(Boolean);
  let idSet = new Set(ids);
  if (!normalizedTier || idSet.size < 2 || idSet.size !== ids.length)
    return {
      ok: false,
      reason: "Choose at least two distinct watchlist films to merge.",
    };
  let orderedItems = watchlistItemsInCanonicalOrder();
  let buckets = new Map();
  orderedItems.forEach((item) => {
    item.id ||= window.watchlistItemId(item);
    let itemTier = window.normalizeWatchlistTier(item.tier);
    if (!buckets.has(itemTier)) buckets.set(itemTier, []);
    buckets.get(itemTier).push(item);
  });
  let tierItems = [...(buckets.get(normalizedTier) || [])];
  let byId = new Map(tierItems.map((item) => [item.id, item]));
  let mergedItems = ids.map((id) => byId.get(id)).filter(Boolean);
  let slots = tierItems
    .map((item, index) => ({ id: item.id, index }))
    .filter((entry) => idSet.has(entry.id))
    .map((entry) => entry.index);
  if (mergedItems.length !== ids.length || slots.length !== ids.length)
    return { ok: false, reason: "Some selected films are no longer in this tier." };
  let nextTierItems = [...tierItems];
  slots.forEach((slotIndex, position) => {
    nextTierItems[slotIndex] = mergedItems[position];
  });
  buckets.set(normalizedTier, nextTierItems);
  [...buckets.keys()]
    .sort(
      (left, right) =>
        window.watchlistTierRank(left) - window.watchlistTierRank(right),
    )
    .flatMap((bucketTier) => buckets.get(bucketTier))
    .forEach((item, index) => {
      item.order = index + 1;
    });
  window.state._watchlistArchiveLookup = null;
  window.state._watchlistItemLookup = null;
  window.state._watchlistDirectorLookup = null;
  window.markAggregatesDirty?.("watchlist tier order merged");
  if (window.recordEdit) {
    let sample = mergedItems
      .slice(0, 12)
      .map((item) => item.title)
      .join(", ");
    let extra = mergedItems.length > 12 ? `, +${mergedItems.length - 12}` : "";
    window.recordEdit({
      type: "watchlist order merge",
      summary: `Merged order for ${mergedItems.length} watchlist film(s) in tier ${normalizedTier}`,
      sheetHint: "Watchlist",
      changes: [
        { field: "merged films", before: "", after: `${sample}${extra}` },
      ],
      context: { tier: normalizedTier, ids },
    });
  }
  return { ok: true, changed: mergedItems.length };
};

/**
 * Merges TMDB metadata into a watchlist item.
 * @param {string} id Watchlist identifier.
 * @param {Object} metadata TMDB metadata fields.
 * @param {Object} [options] Overwrite and persistence options.
 * @returns {boolean}
 */
window.setWatchlistTmdbMetadata = function (id, metadata, options = {}) {
  let item = window.findWatchlistItemById(id);
  if (!item || !metadata) return false;
  item.id ||= window.watchlistItemId(item);
  if (metadata.tmdbId) item.tmdbId = String(metadata.tmdbId);
  if (metadata.director && (!item.director || options.overwrite))
    item.director = String(metadata.director).trim();
  if (metadata.swedishTitle && (!item.swedishTitle || options.overwrite))
    item.swedishTitle = String(metadata.swedishTitle).trim();
  // Archive enrichment stores TMDB production countries; watchlist items get
  // the same treatment so their detail pages fill in consistently (issue #16).
  if (metadata.country && (!item.country || options.overwrite))
    item.country = String(metadata.country).trim();
  if (metadata.runtimeMinutes && (!item.runtimeMinutes || options.overwrite))
    item.runtimeMinutes = metadata.runtimeMinutes;
  if (metadata.poster && (!item.poster || options.overwritePoster))
    item.poster = metadata.poster;
  window.markAggregatesDirty?.("watchlist metadata enriched");
  window.pushSharedFilmMetadata?.(item, metadata);
  if (options.save !== false) window.save();
  return true;
};

/**
 * Lists canonically sorted watchlist items credited to a director.
 * @param {string} personName Director name.
 * @returns {WatchlistItem[]}
 */
window.watchlistItemsByDirector = function (personName) {
  function canonicalDirectorId(name) {
    let variantId =
      window.normalizePersonName?.(name) || window.normalizeTitle(name);
    let canonicalName = state.peopleAliases?.[variantId] || name;
    return (
      window.normalizePersonName?.(canonicalName) ||
      window.normalizeTitle(canonicalName)
    );
  }
  let personId = canonicalDirectorId(personName);
  let version = Number(state.aggregateVersion) || 0;
  let cache = state._watchlistDirectorLookup;
  if (cache?.version !== version) {
    let byDirector = new Map();
    (state.watchlist || []).forEach((item) => {
      (
        window.splitRecipientNames?.(item.director) ||
        String(item.director || "").split(
          /\s*(?:,|;|\/|\s+&\s+|\s+and\s+)\s*/i,
        )
      ).forEach((name) => {
        let id = canonicalDirectorId(name);
        if (!id) return;
        let list = byDirector.get(id) || [];
        list.push(item);
        byDirector.set(id, list);
      });
    });
    byDirector.forEach((list) => list.sort(window.compareWatchlistItems));
    cache = { version, byDirector };
    state._watchlistDirectorLookup = cache;
  }
  return cache.byDirector.get(personId) || [];
};

/**
 * Compares watchlist items by canonical tier and persisted order.
 * @param {WatchlistItem} left Left item.
 * @param {WatchlistItem} right Right item.
 * @returns {number}
 */
window.compareWatchlistItems = function (left, right) {
  return window.compareWatchlistItemsBy(left, right, "order");
};

/**
 * Compares watchlist items by tier and a selected secondary field.
 * @param {WatchlistItem} left Left item.
 * @param {WatchlistItem} right Right item.
 * @param {'order'|'title'|'year'} [sort] Secondary sort field.
 * @param {'asc'|'desc'} [order] Secondary sort direction.
 * @returns {number}
 */
window.compareWatchlistItemsBy = function (
  left,
  right,
  sort = "order",
  order = "asc",
) {
  let tierComparison =
    window.watchlistTierRank(left?.tier) -
    window.watchlistTierRank(right?.tier);
  if (tierComparison) return tierComparison;
  let result = 0;
  if (sort === "title") {
    result =
      window.compareEnglishTitles(left?.title, right?.title) ||
      Number(left?.year || 9999) - Number(right?.year || 9999);
  } else if (sort === "year") {
    result =
      Number(left?.year || 9999) - Number(right?.year || 9999) ||
      window.compareEnglishTitles(left?.title, right?.title);
  } else {
    result =
      Number(left?.order || 999999) - Number(right?.order || 999999) ||
      Number(left?.year || 9999) - Number(right?.year || 9999) ||
      window.compareEnglishTitles(left?.title, right?.title);
  }
  return order === "desc" ? -result : result;
};

/**
 * Sets or removes a normalized poster on a watchlist item.
 * @param {string} id Watchlist identifier.
 * @param {PosterRecord|null} poster Poster value, or null to remove it.
 * @param {Object} [options] Persistence options.
 * @returns {boolean}
 */
window.setWatchlistPoster = function (id, poster, options = {}) {
  let item = window.findWatchlistItemById(id);
  if (!item) return false;
  let normalized = poster ? window.normalizePosterRecord(poster) : null;
  if (poster && !normalized)
    throw new Error("Poster URL must use HTTP or HTTPS.");
  item.id ||= window.watchlistItemId(item);
  if (normalized) item.poster = normalized;
  else delete item.poster;
  window.markAggregatesDirty?.("watchlist poster updated");
  if (options.save !== false) window.save();
  return true;
};

let watchlistPosterLookupAttempts = new Set();
let watchlistMetadataLookupAttempts = new Set();

// Session attempt counts for Data Health's retry queues (issue #44); the
// shared failure registry itself lives in image-batches.js, which loads
// before this file on every page.
/**
 * Returns the number of watchlist enrichment attempts made in this session.
 * @param {'watchlist-posters'|'watchlist-metadata'} type Enrichment queue.
 * @returns {number}
 */
window.watchlistSessionAttemptCount = function (type) {
  if (type === "watchlist-posters") return watchlistPosterLookupAttempts.size;
  if (type === "watchlist-metadata")
    return watchlistMetadataLookupAttempts.size;
  return 0;
};

/**
 * Reports whether a watchlist item needs a poster lookup.
 * @param {WatchlistItem} item Watchlist item.
 * @returns {boolean}
 */
window.watchlistNeedsPosterLookup = function (item) {
  let film = window.watchlistFilmLike(item);
  return (
    Boolean(item?.title) &&
    (!film.poster || film.poster.source === "wikimedia")
  );
};

/**
 * Looks up and persists a poster for one watchlist item.
 * @param {string} id Watchlist identifier.
 * @param {Object} [options] Poster lookup options.
 * @returns {Promise<PosterRecord|null>}
 */
window.loadWatchlistPoster = async function (id, options = {}) {
  let item = window.findWatchlistItemById(id);
  if (!item) throw new Error("Watchlist film not found.");
  let film = window.watchlistFilmLike(item);
  try {
    let poster = await window.lookupFilmPoster(film, options);
    if (!poster) {
      window.recordImageImportFailure("poster");
      window.save();
      return null;
    }
    window.setWatchlistPoster(id, poster);
    return poster;
  } catch (err) {
    window.recordImageImportFailure("poster");
    window.save();
    throw err;
  }
};

/**
 * Fetches posters for an eligible, session-deduplicated batch of watchlist items.
 * @param {WatchlistItem[]} items Candidate items.
 * @param {Object} [options] Batch limits, concurrency, fetch, and progress options.
 * @returns {Promise<MetadataBatchResult>} Batch counts and failure details.
 */
function watchlistItemKey(item) {
  return item.id || window.watchlistItemId(item);
}

function watchlistFailureRecord(item, reason, fallbackReason = "No match found.") {
  return {
    title: String(item?.title || "Watchlist film"),
    year: item?.year || "",
    id: watchlistItemKey(item),
    reason: String(reason || fallbackReason),
  };
}

window.fetchWatchlistPosters = async function (items, options = {}) {
  return window.runBoundedLookupBatch(
    items,
    {
      idOf: watchlistItemKey,
      eligible: (item) => window.watchlistNeedsPosterLookup(item),
      attempts: watchlistPosterLookupAttempts,
      failureType: "watchlist-posters",
      failureRecord: (item, reason) => watchlistFailureRecord(item, reason),
      lookup: (item, context) =>
        window.lookupFilmPoster(window.watchlistFilmLike(item), context),
      apply: (item, poster) =>
        window.setWatchlistPoster(watchlistItemKey(item), poster, {
          save: false,
        }),
      notFoundReason: "No poster found.",
      warnMessage: (item) => `Watchlist poster lookup failed for ${item.title}`,
      imageFailureType: "poster",
    },
    options,
  );
};

/**
 * Reports whether a watchlist item lacks TMDB identity, director, or
 * runtime metadata, or a poster (issue #386 - lookupTmdbMovieMetadata's
 * single TMDB call already returns poster_path regardless of which field
 * prompted the lookup, and setWatchlistTmdbMetadata already applies it
 * when missing, so an otherwise-complete item only needs to become
 * *eligible* for this batch to get it for free - watchlistNeedsPosterLookup
 * stays the source of truth for what "needs a poster" means, reused
 * rather than duplicated here).
 * @param {WatchlistItem} item Watchlist item.
 * @returns {boolean}
 */
window.watchlistNeedsMetadataLookup = function (item) {
  return (
    Boolean(item?.title) &&
    (!item.tmdbId ||
      !item.director ||
      !item.runtimeMinutes ||
      window.watchlistNeedsPosterLookup(item))
  );
};

/**
 * Looks up and persists TMDB metadata for one watchlist item.
 * @param {string} id Watchlist identifier.
 * @param {Object} [options] Metadata lookup and persistence options.
 * @returns {Promise<Object|null>}
 */
window.loadWatchlistMetadata = async function (id, options = {}) {
  let item = window.findWatchlistItemById(id);
  if (!item) throw new Error("Watchlist film not found.");
  let metadata = await window.lookupTmdbMovieMetadata(
    window.watchlistFilmLike(item),
    options,
  );
  if (!metadata) return null;
  window.setWatchlistTmdbMetadata(id, metadata, options);
  return metadata;
};

/**
 * Fetches TMDB metadata for an eligible, session-deduplicated watchlist batch.
 * @param {WatchlistItem[]} items Candidate items.
 * @param {Object} [options] Batch limits, concurrency, provider, and progress options.
 * @returns {Promise<MetadataBatchResult>} Batch counts and failure details.
 */
window.fetchWatchlistMetadata = async function (items, options = {}) {
  return window.runBoundedLookupBatch(
    items,
    {
      idOf: watchlistItemKey,
      eligible: (item) => window.watchlistNeedsMetadataLookup(item),
      attempts: watchlistMetadataLookupAttempts,
      failureType: "watchlist-metadata",
      failureRecord: (item, reason) =>
        watchlistFailureRecord(item, reason, "No TMDB match found."),
      lookup: (item, context) =>
        window.lookupTmdbMovieMetadata(window.watchlistFilmLike(item), context),
      apply: (item, metadata) =>
        window.setWatchlistTmdbMetadata(watchlistItemKey(item), metadata, {
          save: false,
        }),
      notFoundReason: "No TMDB match found.",
      warnMessage: (item) => `Watchlist metadata lookup failed for ${item.title}`,
    },
    options,
  );
};

/**
 * Loads the bundled watchlist once when state has no persisted watchlist data.
 * @returns {Promise<WatchlistItem[]>}
 */
window.ensureWatchlistData = async function () {
  if ((state.watchlist || []).length || typeof fetch !== "function")
    return state.watchlist || [];
  try {
    let response = await fetch("data/watchlist.csv", { cache: "no-store" });
    if (!response.ok) return state.watchlist || [];
    let data = window.parseWatchlist(await response.text());
    state.watchlist = data.items;
    window.recomputeWatchlistOrder?.();
    state.watchlistOrderVersion = 1;
    window.save?.();
  } catch (err) {
    // Direct file opening and missing bundled files simply leave the watchlist empty.
  }
  return state.watchlist || [];
};
