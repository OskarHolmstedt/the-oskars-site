/**
 * @file Owns the watchlist model: tiers and modifiers, item identity and
 * lookup, ordering, view-model edits, and poster and TMDB metadata batches.
 * Parsing watchlist exports lives in src/imports/watchlist-export.js.
 */

window.WATCHLIST_TIERS = ["S", "A", "B", "C", "D", "E", "F"];

/**
 * Parses a raw watchlist tier value, extracting the base tier and any plus/minus modifier suffix.
 * @param {*} value Candidate tier string or object.
 * @returns {{tier: string, modifier: 'plus'|'minus'|''}}
 */
window.parseWatchlistTier = function (value) {
  let rawText = String(value || "").trim();
  let normalizedText = rawText.normalize("NFKC");
  let match = normalizedText.match(/^([sabcdefSABCDEF])\s*([+＋\-–—−])?$/);
  if (!match) return { tier: "", modifier: "" };
  let tier = match[1].toUpperCase();
  if (!window.WATCHLIST_TIERS.includes(tier)) return { tier: "", modifier: "" };
  let modSymbol = match[2] || "";
  /** @type {'plus'|'minus'|''} */
  let modifier = "";
  if (/[+＋]/.test(modSymbol)) {
    modifier = "plus";
  } else if (/[-–—−]/.test(modSymbol)) {
    modifier = "minus";
  }
  return {
    tier,
    modifier,
  };
};

/**
 * Converts a value to a supported uppercase watchlist tier.
 * @param {*} value Candidate tier.
 * @returns {string}
 */
window.normalizeWatchlistTier = function (value) {
  return window.parseWatchlistTier(value).tier;
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
 * Normalizes a tier's fine-grained refinement to "minus"/"plus"/"" only -
 * default unmodified (""), same minus/null/plus shape as the rating
 * modifier (src/ui/film-rating.js), minus its "dot" mistake: there was
 * never a third "exact" value here to remove in the first place.
 * @param {*} value Candidate modifier.
 * @returns {'minus'|'plus'|''}
 */
window.normalizeTierModifierValue = function (value) {
  return value === "minus" || value === "plus" ? value : "";
};

/**
 * Renders a tier with its minus/plus refinement suffix (e.g. "A−", "A",
 * "A＋"), or "" for an unset tier. Shared by every tier badge/label.
 * @param {*} tier Candidate tier.
 * @param {*} modifier Candidate modifier.
 * @returns {string}
 */
window.renderTierWithModifier = function (tier, modifier) {
  let normalized = window.normalizeWatchlistTier(tier);
  if (!normalized) return "";
  let mod = window.normalizeTierModifierValue(modifier);
  return `${normalized}${mod === "minus" ? "−" : mod === "plus" ? "＋" : ""}`;
};

/**
 * Returns a tier's fine-grained sort grade: tier rank expanded threefold
 * with a minus/unmodified/plus offset, placing an unset tier last of
 * all. Additive - existing watchlistTierRank() callers are untouched;
 * this is for call sites that want the modifier to actually break ties.
 * @param {*} tier Candidate tier.
 * @param {*} modifier Candidate modifier.
 * @returns {number}
 */
window.watchlistTierGrade = function (tier, modifier) {
  let rank = window.watchlistTierRank(tier);
  if (rank >= window.WATCHLIST_TIERS.length) return rank * 3;
  let mod = window.normalizeTierModifierValue(modifier);
  let offset = mod === "plus" ? 0 : mod === "minus" ? 2 : 1;
  return rank * 3 + offset;
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
    tierModifier: window.normalizeTierModifierValue(item?.tierModifier),
    director: String(item?.director || "").trim(),
    tags: window.parseFilmTags?.(item?.tags) || [],
    franchises: window.normalizeFranchiseMemberships?.(item?.franchises) || [],
    poster: window.normalizePosterRecord?.(item?.poster) || null,
    order: Number.isFinite(order) && order > 0 ? order : null,
    supabaseFilmId:
      item?.supabaseFilmId || (window.isUuid?.(item?.id) ? item.id : "") || "",
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

function watchlistArchiveLookup(stateRef) {
  let version = Number(stateRef.aggregateVersion) || 0;
  let cache = stateRef._watchlistArchiveLookup;
  if (cache?.version === version) return cache;
  let byTmdb = new Map();
  let byYearTitle = new Map();
  Object.values(stateRef.filmsById || {}).forEach((film) => {
    let tmdbId = String(film.tmdbId || "").trim();
    if (tmdbId) setUniqueLookupValue(byTmdb, tmdbId, film);
    let title = window.normalizeTitle(film.title);
    let year = String(film.year || "").trim();
    if (title && year)
      setUniqueLookupValue(byYearTitle, `${year}\n${title}`, film);
  });
  cache = { version, byTmdb, byYearTitle };
  stateRef._watchlistArchiveLookup = cache;
  return cache;
}

/**
 * Finds the unique archive film matching a watchlist item by TMDB id or title/year.
 * @param {WatchlistItem} item Watchlist item.
 * @param {Object} [stateRef] Explicit state to read instead of window.state
 *   (issue #597's compact-read cutover) - every existing call site omits
 *   this and is unaffected.
 * @returns {FilmRecord|null}
 */
window.findWatchlistArchiveFilm = function (item, stateRef = state) {
  let title = window.normalizeTitle(item?.title);
  let year =
    window.filmConcreteYear?.(item?.year) ||
    (/^\d{4}$/.test(String(item?.year || "")) ? String(item.year) : "");
  let tmdbId = String(item?.tmdbId || "").trim();
  let lookup = watchlistArchiveLookup(stateRef);
  if (tmdbId) {
    let match = uniqueLookupValue(lookup.byTmdb, tmdbId);
    if (match) return match;
  }
  if (!title || !year) return null;
  return uniqueLookupValue(lookup.byYearTitle, `${year}\n${title}`);
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
    // '' when unknown, unlike a stored FilmRecord.
    runtimeMinutes: /** @type {number} */ (
      item.runtimeMinutes || archiveFilm?.runtimeMinutes || ""
    ),
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
  let normalizedTier =
    tier === undefined ? null : window.normalizeWatchlistTier(tier);
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
  tierModifier: "interest tier refinement",
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
window.WATCHLIST_UNDO_FIELD_LABELS = WATCHLIST_UNDO_FIELD_LABELS;

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
      tierModifier: item.tierModifier,
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
  if (Object.prototype.hasOwnProperty.call(values, "tierModifier"))
    item.tierModifier = window.normalizeTierModifierValue(values.tierModifier);
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
    item.medium = ["live-action", "animation"].includes(values.medium)
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
      { key: "tierModifier", label: "interest tier refinement" },
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
    window.watchlistTierGrade(
      left?.tier,
      left?.tier_modifier || left?.tierModifier,
    ) -
    window.watchlistTierGrade(
      right?.tier,
      right?.tier_modifier || right?.tierModifier,
    );
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
  let rankedOrder = 1;
  watchlistItemsInCanonicalOrder().forEach((item) => {
    let orderNum = Number(item.order);
    if (Number.isFinite(orderNum) && orderNum > 0) {
      item.order = rankedOrder++;
    } else {
      item.order = null;
    }
  });
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
        String(item.director || "").split(/\s*(?:,|;|\/|\s+&\s+|\s+and\s+)\s*/i)
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
 * @param {WatchlistItem & {tier_modifier?: string}} left Left item or Supabase watchlist row.
 * @param {WatchlistItem & {tier_modifier?: string}} right Right item or Supabase watchlist row.
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
    window.watchlistTierGrade(
      left?.tier,
      left?.tier_modifier || left?.tierModifier,
    ) -
    window.watchlistTierGrade(
      right?.tier,
      right?.tier_modifier || right?.tierModifier,
    );
  if (tierComparison) return tierComparison;
  let result;
  if (sort === "title") {
    result =
      window.compareEnglishTitles(left?.title, right?.title) ||
      Number(left?.year || 9999) - Number(right?.year || 9999);
    return order === "desc" ? -result : result;
  }
  if (sort === "year") {
    result =
      Number(left?.year || 9999) - Number(right?.year || 9999) ||
      window.compareEnglishTitles(left?.title, right?.title);
    return order === "desc" ? -result : result;
  }
  let leftOrder = Number(left?.order);
  let rightOrder = Number(right?.order);
  let leftRanked = Number.isFinite(leftOrder) && leftOrder > 0;
  let rightRanked = Number.isFinite(rightOrder) && rightOrder > 0;
  if (leftRanked && rightRanked) {
    result = leftOrder - rightOrder;
    return order === "desc" ? -result : result;
  }
  if (leftRanked && !rightRanked) return -1;
  if (!leftRanked && rightRanked) return 1;
  result =
    Number(left?.year || 9999) - Number(right?.year || 9999) ||
    window.compareEnglishTitles(left?.title, right?.title);
  return order === "desc" ? -result : result;
};
