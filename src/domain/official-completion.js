/** @file Derives watched-film completion and project collections from imported Academy Awards results. */

(function () {
  const SOURCE_ID = "academy-awards";

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

  function officialSourceId(category, scope) {
    return category ? `category:${category}:${scope}` : `all:${scope}`;
  }

  /** Builds the current overall and per-category Academy Awards film-completion model. @returns {OfficialOscarCompletion} Completion model. */
  window.officialOscarCompletion = function () {
    let source = window.state?.officialResults?.[SOURCE_ID];
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
            };
            filmsById.set(id, film);
          }
          film.winner ||= Boolean(nomination.winner);
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
        film.href = window.watchlistFilmPageUrl(watchlist.id);
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
          officialSourceId(category, "winners"),
        ),
        nominees: completionGroup(
          categoryFilms,
          officialSourceId(category, "nominees"),
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
          `period:${period}:winners`,
        ),
        nominees: completionGroup(
          periodFilms,
          `period:${period}:nominees`,
        ),
      };
    });
    let winners = completionGroup(
      films.filter((film) => film.winner),
      officialSourceId("", "winners"),
    );
    let nominees = completionGroup(
      films,
      officialSourceId("", "nominees"),
    );
    return {
      source: source || null,
      periodKeys: orderedPeriodKeys,
      films,
      filmsById,
      winners,
      nominees,
      periods,
      categories,
      bestPicture:
        categories.find((entry) => entry.category === "Best Picture") || null,
    };
  };

  /** Resolves one official collection source into its project label and films. @param {string} sourceId Official source id. @param {OfficialOscarCompletion} [completion] Existing completion model. @returns {Object|null} Project source. */
  window.officialOscarProjectSource = function (sourceId, completion) {
    let model = completion || window.officialOscarCompletion();
    let scope = String(sourceId || "").endsWith(":winners")
      ? "winners"
      : String(sourceId || "").endsWith(":nominees")
        ? "nominees"
        : "";
    if (!scope) return null;
    let category = "";
    let period = "";
    if (String(sourceId).startsWith("category:"))
      category = String(sourceId).slice(
        "category:".length,
        -(`:${scope}`.length),
      );
    if (String(sourceId).startsWith("period:"))
      period = String(sourceId).slice(
        "period:".length,
        -(`:${scope}`.length),
      );
    let periodGroup = period
      ? model.periods.find((entry) => entry.period === period)
      : null;
    let group = category
      ? model.categories.find((entry) => entry.category === category)?.[scope]
      : periodGroup
        ? periodGroup[scope]
        : model[scope];
    if (!group) return null;
    let label = category
      ? `${category} ${scope}`
      : period
        ? `${period} Oscar ${scope}`
      : scope === "winners"
        ? "Oscar winners"
        : "Oscar-nominated films";
    return {
      name: label,
      sourceLabel: label,
      sourceHref:
        periodGroup?.href || "completion.html#completion-oscars",
      films: group.films,
      filmRefs: group.films.map((film) => ({
        type: "official",
        id: film.id,
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
    };
  }

  /** Plans one official-results collection's unseen watchlist additions without mutating state. @param {string} sourceId Official collection source id. @param {OfficialOscarCompletion} [completion] Existing completion model. @returns {OfficialOscarWatchlistPlan|null} Bulk-add plan. */
  window.officialOscarWatchlistPlan = function (sourceId, completion) {
    let model = completion || window.officialOscarCompletion();
    let source = window.officialOscarProjectSource(sourceId, model);
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
      sourceId,
      sourceLabel: source.sourceLabel,
      sourceHref: source.sourceHref,
      ready: [...ready.values()],
      needsReview: [...needsReview.values()],
      alreadyWatched: [...alreadyWatched.values()],
      alreadyWatchlisted: [...alreadyWatchlisted.values()],
    };
  };

  /** Adds every currently unambiguous unseen film in an official-results collection to the watchlist. @param {string} sourceId Official collection source id. @param {string} tier Destination interest tier. @param {Object} [options] Persistence controls. @returns {Object} Bulk-add result. */
  window.applyOfficialOscarWatchlistPlan = function (
    sourceId,
    tier,
    options = {},
  ) {
    if (window.oskarsCapabilities && !window.oskarsCapabilities().canEdit)
      return { ok: false, reason: "Watchlist editing is unavailable." };
    let normalizedTier = window.normalizeWatchlistTier?.(tier);
    if (!normalizedTier)
      return { ok: false, reason: "Choose an interest tier." };
    let plan = window.officialOscarWatchlistPlan(sourceId);
    if (!plan) return { ok: false, reason: "Oscar collection not found." };
    let added = [];
    window.state.watchlist ||= [];
    plan.ready.forEach((candidate) => {
      let item = window.normalizeWatchlistItem?.({
        title: candidate.title,
        year: candidate.year,
        tier: normalizedTier,
        tags: ["Oscars"],
      });
      if (!item || window.findWatchlistItemById?.(item.id)) return;
      window.state.watchlist.push(item);
      added.push(item);
    });
    if (!added.length)
      return { ok: true, added, plan, tier: normalizedTier, persisted: null };
    window.recomputeWatchlistOrder?.();
    window.markAggregatesDirty?.("official Oscar films added to watchlist");
    window.recordEdit?.({
      type: "official Oscar watchlist added",
      summary: `Added ${added.length} film(s) from ${plan.sourceLabel} to tier ${normalizedTier}`,
      sheetHint: "Watchlist",
      changes: [
        { field: "films added", before: "0", after: String(added.length) },
        { field: "tier", before: "", after: normalizedTier },
      ],
      context: {
        sourceId,
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

  /** Removes a just-added official Oscar watchlist batch. @param {string[]} ids Watchlist ids returned by the bulk add. @param {Object} [options] Persistence controls. @returns {Object} Undo result. */
  window.undoOfficialOscarWatchlistAdd = function (ids, options = {}) {
    if (window.oskarsCapabilities && !window.oskarsCapabilities().canEdit)
      return { ok: false, reason: "Watchlist editing is unavailable." };
    let targets = new Set((ids || []).map(String));
    let removed = [];
    window.state.watchlist = (window.state.watchlist || []).filter((item) => {
      let id = item.id || window.watchlistItemId?.(item);
      let isOscarAddition = (item.tags || []).some(
        (tag) => window.normalizeTitle(tag) === "oscars",
      );
      if (!targets.has(id) || !isOscarAddition) return true;
      removed.push(item);
      return false;
    });
    if (!removed.length)
      return { ok: true, removed, persisted: null };
    window.recomputeWatchlistOrder?.();
    window.markAggregatesDirty?.("official Oscar watchlist addition undone");
    window.recordEdit?.({
      type: "official Oscar watchlist add undone",
      summary: `Removed ${removed.length} recently added Oscar film(s) from the watchlist`,
      sheetHint: "Watchlist",
      changes: [
        { field: "films removed", before: String(removed.length), after: "0" },
      ],
      context: { watchlistIds: removed.map((item) => item.id) },
    });
    let persisted =
      options.save === false
        ? null
        : window.save?.({ immediate: true, rebuild: true });
    return { ok: true, removed, persisted };
  };
})();
