/** @file Derives watched-film completion and project collections from any imported official-results source (issue #343) - Academy Awards by default, but every exported function accepts an explicit source id so a second source (e.g. Cannes, issue #342) never shares scope ids, watchlist tags, or project filmRefs with another. */

(function () {
  const DEFAULT_SOURCE_ID = "academy-awards";

  /** Expands an official annual or historical span key into represented release years. @param {string} periodKey Official period key. @returns {string[]} Four-digit years. */
  window.officialResultPeriodYears = function (periodKey) {
    let match = String(periodKey || "").match(/^(\d{4})(?:\/(\d{2}|\d{4}))?$/);
    if (!match) return [];
    let years = [match[1]];
    if (!match[2]) return years;
    let end = match[2];
    if (end.length === 2) {
      let century = Number(match[1].slice(0, 2));
      let startSuffix = Number(match[1].slice(2));
      let endSuffix = Number(end);
      if (endSuffix < startSuffix) century += 1;
      end = `${century}${String(endSuffix).padStart(2, "0")}`;
    }
    if (end !== match[1]) years.push(end);
    return years;
  };

  // Moved from src/data/official-results.js (issue: shared official-results
  // archive) so the shared-archive pull can re-attach a per-viewer filmRef
  // to canon-only (filmRef-stripped) shared nominations without loading
  // official-results.js's much heavier import-parsing code on every page -
  // this file already loads unconditionally on every entry, that one only
  // loads on the data entry. Behavior is unchanged from the original;
  // official-results.js's own proposeOfficialResultsImport() now calls
  // these same two functions via window instead of a local copy.

  /** Collects every distinct canonical film in this source's archive/watched/watchlist for title+year matching. @param {Object} source Runtime or canonical state. @returns {Object[]} Candidate films. */
  window.officialResultsFilmCandidates = function (source) {
    let byId = new Map();
    Object.values(source.years || {}).forEach((period) => {
      (period.films || []).forEach((film) => {
        if (film?.id && !byId.has(film.id)) byId.set(film.id, film);
      });
    });
    (source.watchedFilms || source.watchedOther || []).forEach((film) => {
      if (film?.id && !byId.has(film.id)) byId.set(film.id, film);
    });
    return [...byId.values()];
  };

  /** Resolves one official nomination to at most one unambiguous canonical film for the given period. A resolved tmdbId (a canon fact, language/year-invariant) is checked first and wins outright when it matches exactly one candidate; otherwise falls back to the existing normalized-title + represented-year matching unchanged. @param {Object[]} candidates Result of officialResultsFilmCandidates(). @param {{sourceTitle: string, tmdbId?: string}} nomination Official nomination (or nomination-shaped object) carrying at least sourceTitle. @param {string} periodKey Official period key. @returns {{film: Object|null, ambiguous: boolean}} Match result. */
  window.officialResultsFilmMatch = function (candidates, nomination, periodKey) {
    let tmdbId = String(nomination?.tmdbId || "").trim();
    if (tmdbId) {
      let tmdbMatches = candidates.filter((film) => String(film.tmdbId || "") === tmdbId);
      if (tmdbMatches.length === 1) return { film: tmdbMatches[0], ambiguous: false };
      if (tmdbMatches.length > 1) return { film: null, ambiguous: true };
    }
    let normalized = window.normalizeTitle(nomination?.sourceTitle || "");
    let representedYears = new Set(window.officialResultPeriodYears(periodKey));
    let matches = candidates.filter(
      (film) =>
        window.normalizeTitle(film.normalizedTitle || film.title) === normalized &&
        representedYears.has(String(film.year || "")),
    );
    return matches.length === 1
      ? { film: matches[0], ambiguous: false }
      : { film: null, ambiguous: matches.length > 1 };
  };

  function officialResultFilmTitles(sourceTitle) {
    return String(sourceTitle || "")
      .split("|")
      .map((title) => title.trim())
      .filter(Boolean);
  }

  function recordsByTitle(records) {
    let result = new Map();
    (records || []).forEach((record) => {
      let key = window.normalizeTitle(record?.title || "");
      if (!key) return;
      let entries = result.get(key) || [];
      if (!entries.some((entry) => entry.id === record.id)) entries.push(record);
      result.set(key, entries);
    });
    return result;
  }

  function watchedRecords() {
    let records = Object.values(window.state?.filmsById || {});
    (window.state?.watchedFilms || window.state?.watchedOther || []).forEach(
      (film) => {
        if (film?.id && !records.some((record) => record.id === film.id))
          records.push(film);
      },
    );
    return records;
  }

  function matchingRecord(entries, years) {
    let allowedYears = new Set(years);
    let matches = (entries || []).filter((entry) =>
      allowedYears.has(String(entry?.year || "")),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function candidateHref(periodKey) {
    return `${window.periodPageUrl("year", periodKey)}&view=official`;
  }

  function completionGroup(films, sourceId) {
    let watchedCount = films.filter((film) => film.watched).length;
    return {
      sourceId,
      films,
      unseen: films.filter((film) => !film.watched),
      watchedCount,
      total: films.length,
      percent: films.length ? Math.round((watchedCount / films.length) * 100) : 0,
    };
  }

  // Every derived scope id is prefixed with the source id (issue #343) so a
  // second populated official-results source's "all:winners"-shaped ids
  // never collide with another source's - officialCollectionProjectSource()
  // parses this same prefix back off to know which source's completion
  // model a given scope id belongs to.
  function officialSourceId(sourceId, category, scope) {
    return category
      ? `${sourceId}:category:${category}:${scope}`
      : `${sourceId}:all:${scope}`;
  }

  function officialPeriodSourceId(sourceId, period, scope) {
    return `${sourceId}:period:${period}:${scope}`;
  }

  /** Builds the current overall and per-category film-completion model for one official-results source. @param {string} [sourceId] Official source id, defaults to Academy Awards. @returns {OfficialCollectionCompletion} Completion model. */
  window.officialCollectionCompletion = function (sourceId = DEFAULT_SOURCE_ID) {
    let source = window.state?.officialResults?.[sourceId];
    let watchedByTitle = recordsByTitle(watchedRecords());
    let watchlistByTitle = recordsByTitle(window.state?.watchlist || []);
    let filmsById = new Map();
    let periodKeys = [];

    Object.entries(source?.periods || {}).forEach(([periodKey, period]) => {
      if (!period?.nominations?.length) return;
      periodKeys.push(periodKey);
      let years = window.officialResultPeriodYears(periodKey);
      period.nominations.forEach((nomination) => {
        officialResultFilmTitles(nomination.sourceTitle).forEach((title) => {
          let titleKey = window.normalizeTitle(title);
          if (!titleKey) return;
          let id = `${periodKey}::${titleKey}`;
          let film = filmsById.get(id);
          if (!film) {
            film = {
              id,
              title,
              year: years[0] || "",
              periodKey,
              winner: false,
              categories: [],
              winnerCategories: [],
              watched: false,
              watchedFilm: null,
              watchedType: "",
              watchlistItem: null,
              href: candidateHref(periodKey),
              tmdbId: "",
            };
            filmsById.set(id, film);
          }
          film.winner ||= Boolean(nomination.winner);
          film.tmdbId ||= String(nomination.tmdbId || "");
          if (
            nomination.category &&
            !film.categories.includes(nomination.category)
          )
            film.categories.push(nomination.category);
          if (
            nomination.winner &&
            nomination.category &&
            !film.winnerCategories.includes(nomination.category)
          )
            film.winnerCategories.push(nomination.category);
        });
      });
    });

    let films = [...filmsById.values()];
    films.forEach((film) => {
      let years = window.officialResultPeriodYears(film.periodKey);
      let watched = matchingRecord(
        watchedByTitle.get(window.normalizeTitle(film.title)),
        years,
      );
      let watchlist = matchingRecord(
        watchlistByTitle.get(window.normalizeTitle(film.title)),
        years,
      );
      if (watched) {
        film.watched = true;
        film.watchedFilm = watched;
        film.watchedType = window.state?.filmsById?.[watched.id]
          ? "archive"
          : "watched";
        film.year = String(watched.year || film.year);
        film.href = window.filmPageUrl(watched.id);
      } else if (watchlist) {
        film.watchlistItem = watchlist;
        film.year = String(watchlist.year || film.year);
        film.href = window.filmPageUrl(watchlist.supabaseFilmId);
      }
      film.categories.sort(
        (left, right) =>
          window.categorySortIndex(left) - window.categorySortIndex(right) ||
          left.localeCompare(right),
      );
      film.winnerCategories.sort(
        (left, right) =>
          window.categorySortIndex(left) - window.categorySortIndex(right) ||
          left.localeCompare(right),
      );
    });
    films.sort(
      (left, right) =>
        left.periodKey.localeCompare(right.periodKey, undefined, {
          numeric: true,
        }) || left.title.localeCompare(right.title),
    );

    let categoryNames = [
      ...new Set(films.flatMap((film) => film.categories)),
    ].sort(
      (left, right) =>
        window.categorySortIndex(left) - window.categorySortIndex(right) ||
        left.localeCompare(right),
    );
    let categories = categoryNames.map((category) => {
      let categoryFilms = films.filter((film) =>
        film.categories.includes(category),
      );
      return {
        category,
        winners: completionGroup(
          categoryFilms.filter((film) =>
            film.winnerCategories.includes(category),
          ),
          officialSourceId(sourceId, category, "winners"),
        ),
        nominees: completionGroup(
          categoryFilms,
          officialSourceId(sourceId, category, "nominees"),
        ),
      };
    });
    let orderedPeriodKeys = [...new Set(periodKeys)].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    let periods = orderedPeriodKeys.map((period) => {
      let periodFilms = films.filter((film) => film.periodKey === period);
      return {
        period,
        href: candidateHref(period),
        winners: completionGroup(
          periodFilms.filter((film) => film.winner),
          officialPeriodSourceId(sourceId, period, "winners"),
        ),
        nominees: completionGroup(
          periodFilms,
          officialPeriodSourceId(sourceId, period, "nominees"),
        ),
      };
    });
    let winners = completionGroup(
      films.filter((film) => film.winner),
      officialSourceId(sourceId, "", "winners"),
    );
    let nominees = completionGroup(
      films,
      officialSourceId(sourceId, "", "nominees"),
    );
    return {
      sourceId,
      source: source || null,
      periodKeys: orderedPeriodKeys,
      films,
      filmsById,
      winners,
      nominees,
      periods,
      categories,
    };
  };

  // "Oscar(s)" is this app's established short name for the Academy Awards
  // source (used throughout src/ui/i18n.js's existing copy) - preserved
  // literally here rather than falling back to the source's own stored
  // .name ("Academy Awards") to avoid a silent copy change for the one
  // source every existing user and test already knows. Any other source
  // uses its stored display name. Exposed on window so completion.js
  // (issue #344) can reuse this exact rule for its own source-aware
  // headings rather than re-deriving it.
  window.officialSourceDisplayName = function (sourceId, model) {
    return sourceId === DEFAULT_SOURCE_ID
      ? "Oscar"
      : model.source?.name || sourceId;
  };

  // Must match completion.js's own completionSection(sourceId, ...) id
  // exactly (issue #344), or a "start project"/watchlist link back to the
  // section would silently 404 its anchor.
  function officialCompletionAnchorId(sourceId) {
    return `completion-${sourceId}`;
  }

  /** Resolves one completion scope id into its project label and films. @param {string} scopeId Scope id returned by officialCollectionCompletion() (source-prefixed: "sourceId:all:winners", "sourceId:category:X:winners", or "sourceId:period:Y:winners"). @param {OfficialCollectionCompletion} [completion] Existing completion model for that same source; resolved automatically from the scope id's source prefix when omitted. @returns {Object|null} Project source. */
  window.officialCollectionProjectSource = function (scopeId, completion) {
    let raw = String(scopeId || "");
    let separator = raw.indexOf(":");
    if (separator < 0) return null;
    let sourceId = raw.slice(0, separator);
    let rest = raw.slice(separator + 1);
    let model = completion || window.officialCollectionCompletion(sourceId);
    let scope = rest.endsWith(":winners")
      ? "winners"
      : rest.endsWith(":nominees")
        ? "nominees"
        : "";
    if (!scope) return null;
    let category = "";
    let period = "";
    if (rest.startsWith("category:"))
      category = rest.slice("category:".length, -(`:${scope}`.length));
    if (rest.startsWith("period:"))
      period = rest.slice("period:".length, -(`:${scope}`.length));
    let periodGroup = period
      ? model.periods.find((entry) => entry.period === period)
      : null;
    let group = category
      ? model.categories.find((entry) => entry.category === category)?.[scope]
      : periodGroup
        ? periodGroup[scope]
        : model[scope];
    if (!group) return null;
    let displayName = officialSourceDisplayName(sourceId, model);
    let label = category
      ? `${category} ${scope}`
      : period
        ? `${period} ${displayName} ${scope}`
      : scope === "winners"
        ? `${displayName} winners`
        : `${displayName}-nominated films`;
    return {
      name: label,
      sourceLabel: label,
      sourceHref:
        periodGroup?.href ||
        `completion.html#${officialCompletionAnchorId(sourceId)}`,
      films: group.films,
      filmRefs: group.films.map((film) => ({
        type: "official",
        id: film.id,
        sourceId,
      })),
    };
  };

  function officialWatchlistCandidate(film, year) {
    return {
      officialId: film.id,
      title: film.title,
      year: String(year || ""),
      periodKey: film.periodKey,
      href: film.href,
      winner: Boolean(film.winner),
      categories: [...(film.categories || [])],
      tmdbId: String(film.tmdbId || ""),
    };
  }

  /** Plans one official-results collection's unseen watchlist additions without mutating state. @param {string} scopeId Scope id (source-prefixed, see officialCollectionProjectSource()). @param {OfficialCollectionCompletion} [completion] Existing completion model for that same source. @returns {OfficialCollectionWatchlistPlan|null} Bulk-add plan. */
  window.officialCollectionWatchlistPlan = function (scopeId, completion) {
    let sourceId = String(scopeId || "").split(":")[0];
    let model = completion || window.officialCollectionCompletion(sourceId);
    let source = window.officialCollectionProjectSource(scopeId, model);
    if (!source) return null;
    let evidenceByTitle = new Map();
    model.films.forEach((film) => {
      let year = String(
        film.watchedFilm?.year || film.watchlistItem?.year || "",
      );
      let periodYears = window.officialResultPeriodYears(film.periodKey);
      if (!year && periodYears.length === 1) year = periodYears[0];
      if (!/^\d{4}$/.test(year)) return;
      let key = window.normalizeTitle(film.title);
      let years = evidenceByTitle.get(key) || new Set();
      years.add(year);
      evidenceByTitle.set(key, years);
    });
    let ready = new Map();
    let needsReview = new Map();
    let alreadyWatched = new Map();
    let alreadyWatchlisted = new Map();
    source.films.forEach((film) => {
      if (film.watched) {
        alreadyWatched.set(
          film.watchedFilm?.id || film.id,
          officialWatchlistCandidate(film, film.watchedFilm?.year || film.year),
        );
        return;
      }
      if (film.watchlistItem) {
        alreadyWatchlisted.set(
          film.watchlistItem.id || film.id,
          officialWatchlistCandidate(
            film,
            film.watchlistItem.year || film.year,
          ),
        );
        return;
      }
      let periodYears = window.officialResultPeriodYears(film.periodKey);
      let year = periodYears.length === 1 ? periodYears[0] : "";
      if (!year && periodYears.length > 1) {
        let evidence = [
          ...(evidenceByTitle.get(window.normalizeTitle(film.title)) || []),
        ].filter((value) => periodYears.includes(value));
        if (evidence.length === 1) year = evidence[0];
      }
      if (!year) {
        needsReview.set(film.id, {
          ...officialWatchlistCandidate(film, ""),
          possibleYears: periodYears,
        });
        return;
      }
      let candidate = officialWatchlistCandidate(film, year);
      let itemId = `${year}::${window.normalizeTitle(film.title)}`;
      if (window.findWatchlistItemById?.(itemId)) {
        alreadyWatchlisted.set(itemId, candidate);
        return;
      }
      if (!ready.has(itemId)) ready.set(itemId, candidate);
    });
    return {
      scopeId,
      sourceId,
      sourceLabel: source.sourceLabel,
      sourceHref: source.sourceHref,
      ready: [...ready.values()],
      needsReview: [...needsReview.values()],
      alreadyWatched: [...alreadyWatched.values()],
      alreadyWatchlisted: [...alreadyWatchlisted.values()],
    };
  };

  // "Oscars" is this app's established watchlist tag for the Academy
  // Awards source, already present on real user watchlist data - preserved
  // literally (as is the "oscars"-normalized undo match below) rather than
  // deriving it from the source's stored .name, which would silently stop
  // matching existing tagged items. Any other source is tagged with its
  // stored display name.
  function officialWatchlistTag(sourceId, model) {
    return sourceId === DEFAULT_SOURCE_ID
      ? "Oscars"
      : model.source?.name || sourceId;
  }

  /** Adds every currently unambiguous unseen film in an official-results collection to the watchlist. @param {string} scopeId Scope id (source-prefixed, see officialCollectionProjectSource()). @param {string} tier Destination interest tier. @param {Object} [options] Persistence controls. @param {Set<string>|string[]} [options.excludeItemIds] Watchlist-item ids to skip even though the plan considers them ready - used by the shared official-results archive's automatic reconciliation to honor a user's earlier explicit removal; never set by the manual Completion-page button, so a manual re-add is never blocked by a prior decline. @returns {Object} Bulk-add result. */
  window.applyOfficialCollectionWatchlistPlan = function (
    scopeId,
    tier,
    options = {},
  ) {
    if (window.oskarsCapabilities && !window.oskarsCapabilities().canEdit)
      return { ok: false, reason: "Watchlist editing is unavailable." };
    let normalizedTier = window.normalizeWatchlistTier?.(tier);
    if (!normalizedTier)
      return { ok: false, reason: "Choose an interest tier." };
    let plan = window.officialCollectionWatchlistPlan(scopeId);
    if (!plan) return { ok: false, reason: "Official collection not found." };
    let tag = officialWatchlistTag(
      plan.sourceId,
      window.officialCollectionCompletion(plan.sourceId),
    );
    let excludeItemIds = new Set(options.excludeItemIds || []);
    let added = [];
    window.state.watchlist ||= [];
    plan.ready.forEach((candidate) => {
      let item = window.normalizeWatchlistItem?.({
        title: candidate.title,
        year: candidate.year,
        tier: normalizedTier,
        tags: [tag],
        ...(candidate.tmdbId ? { tmdbId: candidate.tmdbId } : {}),
      });
      if (!item || excludeItemIds.has(item.id)) return;
      if (window.findWatchlistItemById?.(item.id)) return;
      window.state.watchlist.push(item);
      added.push(item);
    });
    if (!added.length)
      return { ok: true, added, plan, tier: normalizedTier, persisted: null };
    window.recomputeWatchlistOrder?.();
    window.markAggregatesDirty?.(`official ${tag} films added to watchlist`);
    window.recordEdit?.({
      type: "official watchlist added",
      summary: `Added ${added.length} film(s) from ${plan.sourceLabel} to tier ${normalizedTier}`,
      sheetHint: "Watchlist",
      changes: [
        { field: "films added", before: "0", after: String(added.length) },
        { field: "tier", before: "", after: normalizedTier },
      ],
      context: {
        scopeId,
        sourceId: plan.sourceId,
        tier: normalizedTier,
        watchlistIds: added.map((item) => item.id),
      },
    });
    let persisted =
      options.save === false
        ? null
        : window.save?.({ immediate: true, rebuild: true });
    return { ok: true, added, plan, tier: normalizedTier, persisted };
  };

  /** Removes a just-added official watchlist batch for one source. @param {string} sourceId Official collection source id (decides which watchlist tag to match). @param {string[]} ids Watchlist ids returned by the bulk add. @param {Object} [options] Persistence controls. @returns {Object} Undo result. */
  window.undoOfficialCollectionWatchlistAdd = function (
    sourceId,
    ids,
    options = {},
  ) {
    if (window.oskarsCapabilities && !window.oskarsCapabilities().canEdit)
      return { ok: false, reason: "Watchlist editing is unavailable." };
    let tag = window.normalizeTitle(
      officialWatchlistTag(sourceId, window.officialCollectionCompletion(sourceId)),
    );
    let targets = new Set((ids || []).map(String));
    let removed = [];
    window.state.watchlist = (window.state.watchlist || []).filter((item) => {
      let id = item.id || window.watchlistItemId?.(item);
      let isMatchingAddition = (item.tags || []).some(
        (itemTag) => window.normalizeTitle(itemTag) === tag,
      );
      if (!targets.has(id) || !isMatchingAddition) return true;
      removed.push(item);
      return false;
    });
    if (!removed.length)
      return { ok: true, removed, persisted: null };
    window.recomputeWatchlistOrder?.();
    window.markAggregatesDirty?.("official watchlist addition undone");
    window.recordEdit?.({
      type: "official watchlist add undone",
      summary: `Removed ${removed.length} recently added film(s) from the watchlist`,
      sheetHint: "Watchlist",
      changes: [
        { field: "films removed", before: String(removed.length), after: "0" },
      ],
      context: { sourceId, watchlistIds: removed.map((item) => item.id) },
    });
    let persisted =
      options.save === false
        ? null
        : window.save?.({ immediate: true, rebuild: true });
    return { ok: true, removed, persisted };
  };
})();
