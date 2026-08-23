/** @file Owns shared text normalization, ranked matching, and the cached cross-entity search index. */

(function () {
  /** Normalizes user-entered and indexed text for shared search matching.
   * @param {string|number|null|undefined} value Text-like value to normalize.
   * @returns {string} Canonical searchable text.
   */
  window.normalizeSearchText = function (value) {
    return window.normalizeTitle(value);
  };

  /** Builds or reuses the typed application-wide search index.
   * @param {Object} [options] Locale labels and cache-key context.
   * @returns {SearchEntry[]} Cached searchable entity entries.
   */
  window.buildSearchEntries = function (options = {}) {
    let localeKey = String(options.locale || "");
    let cacheKey = [
      window.state?.aggregateVersion || 0,
      window.state?.watchlist?.length || 0,
      window.state?.projects?.length || 0,
      // Project renames/status flips don't bump aggregateVersion, so the latest
      // project update timestamp keeps their search entries fresh.
      (window.state?.projects || []).reduce(
        (latest, project) =>
          String(project.updatedAt || "") > latest
            ? String(project.updatedAt)
            : latest,
        "",
      ),
      Object.keys(window.state?.peopleAliases || {}).length,
      localeKey,
      String(options.cacheKeySuffix || ""),
    ].join("|");
    window._oskarsSearchEntriesCache ||= {};
    if (window._oskarsSearchEntriesCache[cacheKey])
      return window._oskarsSearchEntriesCache[cacheKey];

    let labels = Object.assign(
      {
        tier: "Tier",
        watched: "Watched",
        watchlist: "Watchlist",
        projectWatched: "watched",
        projectOpen: "Open",
        projectComplete: "Complete",
        projectArchived: "Archived",
        films: "films",
        allTime: "All-time",
      },
      options.labels || {},
    );

    let done = window.startOskarsPerformance?.("search:buildEntries");
    let entries = [];

    Object.values(window.state.filmsById || {}).forEach((film) =>
      entries.push({
        type: "Film",
        name: film.title,
        meta: film.year || "",
        searchText: film.swedishTitle || "",
        year: film.year || "",
        target: { type: "film", id: film.id },
        href: window.filmPageUrl(film.id),
      }),
    );

    // Standalone watched works with no archive appearance (issue #67) - they
    // share the ranked archive's own film detail page (issue #290), so the
    // target/href shape matches the "Film" entries above exactly; only the
    // type label and richer searchable text (director, franchise
    // memberships) differ, since these entries have no poster/awards page of
    // their own to surface that context.
    (window.state.watchedOther || []).forEach((film) =>
      entries.push({
        type: "Other watched",
        name: film.title,
        meta: film.year || "",
        searchText: [
          film.director || (film.directors || []).join(", "),
          film.swedishTitle || "",
          window.formatFranchiseMemberships?.(film.franchises) || "",
        ]
          .filter(Boolean)
          .join(" "),
        year: film.year || "",
        target: { type: "watched-other", id: film.id },
        href: window.filmPageUrl(film.id),
      }),
    );

    (window.state.watchlist || []).forEach((item) => {
      let archiveFilm = window.findWatchlistArchiveFilm?.(item);
      let film = window.watchlistFilmLike?.(item, archiveFilm) || item;
      let tier = window.normalizeWatchlistTier?.(item.tier);
      let context = [
        film.year || "",
        film.director || "",
        tier ? `${labels.tier} ${tier}` : "",
        archiveFilm ? labels.watched : labels.watchlist,
      ]
        .filter(Boolean)
        .join(" · ");
      let searchable = [
        context,
        item.tmdbId ? `TMDB ${item.tmdbId}` : "",
        item.swedishTitle || film.swedishTitle || "",
        item.letterboxdUrl || "",
        window.formatFilmTags?.(film.tags) || "",
        window.formatFranchiseMemberships?.(film.franchises) || "",
      ]
        .filter(Boolean)
        .join(" ");
      entries.push({
        type: "Watchlist",
        name: item.title,
        meta: context,
        searchText: searchable,
        year: item.year || "",
        target: {
          type: "watchlist",
          id: item.id || window.watchlistItemId(item),
        },
        href: window.watchlistFilmPageUrl(
          item.id || window.watchlistItemId(item),
        ),
      });
    });

    // Archived projects stay searchable — search is a lookup tool and the
    // status label makes their state obvious in the result meta.
    (window.state.projects || []).forEach((project) => {
      let progress = window.projectProgress?.(project);
      let status = ["archived", "complete"].includes(project.status)
        ? project.status
        : "active";
      let statusLabel =
        status === "active"
          ? labels.projectOpen
          : status === "complete"
            ? labels.projectComplete
            : labels.projectArchived;
      entries.push({
        type: "Project",
        name: project.name,
        meta: [
          statusLabel,
          progress
            ? `${progress.watchedCount}/${progress.total} ${labels.projectWatched}`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        searchText: project.sourceLabel || "",
        target: { type: "project", id: project.id },
        href: window.projectPageUrl(project.id),
      });
    });

    Object.values(
      window.ensurePeopleIndex?.() || window.state.peopleById || {},
    ).forEach((person) =>
      entries.push({
        type: "Person",
        name: person.name,
        meta: person.professions.join(", "),
        aliasNames: person.aliases || [],
        target: { type: "person", id: person.id },
        href: window.personPageUrl(person.id),
      }),
    );

    Object.values(
      window.ensureCreditSubjects?.() || window.state.creditSubjectsById || {},
    ).forEach((subject) =>
      entries.push({
        type: subject.type === "song" ? "Song" : "Role",
        name: subject.title,
        meta: subject.films.map((film) => film.title).join(", "),
        target: {
          type: subject.type === "song" ? "song" : "role",
          id: subject.id,
        },
        href: window.subjectPageUrl(subject.id),
      }),
    );

    Object.values(
      window.ensureFranchiseIndex?.() || window.state.franchisesById || {},
    ).forEach((franchise) =>
      entries.push({
        type:
          (franchise.parentIds || []).length || franchise.parentId
            ? "Subfranchise"
            : "Franchise",
        name: franchise.name,
        meta: `${franchise.films.length} ${labels.films}`,
        target: { type: "franchise", id: franchise.id },
        href: window.franchisePageUrl(franchise.id),
      }),
    );

    window.getOrderedCategories().forEach((category) =>
      entries.push({
        type: "Category",
        name: window.localizedCategoryName?.(category) || category,
        meta: "",
        searchText: category,
        target: { type: "category", id: category },
        href: window.categoryPageUrl(category),
      }),
    );

    window.getFilmTagIndex().forEach((tag) =>
      entries.push({
        type: "Tag",
        name: tag.name,
        meta: `${tag.films.length} ${labels.films}`,
        target: { type: "tag", id: tag.name },
        href: window.tagPageUrl(tag.name),
      }),
    );

    Object.keys(window.state.years || {})
      .filter((key) => /^\d{4}$/.test(key))
      .forEach((year) =>
        entries.push({
          type: "Year",
          name: year,
          meta: "",
          target: { type: "period", id: `year:${year}` },
          href: window.periodPageUrl("year", year),
        }),
      );

    Object.keys(window.state.periods?.decades || {})
      .filter((key) => key !== "unknown")
      .forEach((decade) =>
        entries.push({
          type: "Decade",
          name: decade,
          meta: "",
          target: { type: "period", id: `decade:${decade}` },
          href: window.periodPageUrl("decade", decade),
        }),
      );

    Object.keys(window.state.periods?.centuries || {})
      .filter((key) => key !== "unknown")
      .forEach((century) =>
        entries.push({
          type: "Century",
          name: century,
          meta: "",
          target: { type: "period", id: `century:${century}` },
          href: window.periodPageUrl("century", century),
        }),
      );

    entries.push({
      type: "Period",
      name: labels.allTime,
      meta: "",
      target: { type: "period", id: "alltime:alltime" },
      href: window.periodPageUrl("alltime", "alltime"),
    });
    done?.(`${entries.length} entries`);
    window._oskarsSearchEntriesCache[cacheKey] = entries;
    return entries;
  };

  /** Tests whether combined values contain a normalized query.
   * @param {string} query User-entered query.
   * @param {...(string|number)} values Searchable values.
   * @returns {boolean} Whether the values contain the query.
   */
  window.searchTextMatches = function (query, ...values) {
    let normalized = window.normalizeSearchText(query);
    if (!normalized) return true;
    return window
      .normalizeSearchText(values.filter(Boolean).join(" "))
      .includes(normalized);
  };

  // Match strength for one normalized field against the query: an exact match
  // beats a prefix, which beats matching at the start of some inner word (so
  // "nolan" finds "Christopher Nolan"), which beats matching mid-word anywhere.
  let MATCH_EXACT = 3,
    MATCH_PREFIX = 2,
    MATCH_WORD_START = 1,
    MATCH_SUBSTRING = 0,
    MATCH_NONE = -1;
  function fieldMatchTier(field, query) {
    if (!field || !query) return MATCH_NONE;
    if (field === query) return MATCH_EXACT;
    if (field.startsWith(query)) return MATCH_PREFIX;
    if (field.split(" ").some((word) => word.startsWith(query)))
      return MATCH_WORD_START;
    return field.includes(query) ? MATCH_SUBSTRING : MATCH_NONE;
  }

  // An entry's own name (or, for people, a known alias) is what a search result
  // actually represents, so any match there outranks a match that only turns up
  // inside secondary context (credits list, professions, type label, etc) —
  // otherwise a person with many films can get buried under those films just
  // because "director" or a tag happens to contain the query too.
  let NAME_MATCH_BASE = 10;
  function entryMatchPriority(entry, normalizedQuery) {
    let nameTier = fieldMatchTier(
      window.normalizeSearchText(entry.name),
      normalizedQuery,
    );
    (entry.aliasNames || []).forEach((alias) => {
      nameTier = Math.max(
        nameTier,
        fieldMatchTier(window.normalizeSearchText(alias), normalizedQuery),
      );
    });
    if (nameTier >= 0) return NAME_MATCH_BASE + nameTier;
    let contextTier = Math.max(
      fieldMatchTier(window.normalizeSearchText(entry.meta), normalizedQuery),
      fieldMatchTier(
        window.normalizeSearchText(entry.searchText || ""),
        normalizedQuery,
      ),
      fieldMatchTier(window.normalizeSearchText(entry.type), normalizedQuery),
    );
    return contextTier;
  }

  /** Ranks matching search entries by name, alias, and secondary context.
   * @param {SearchEntry[]} entries Candidate entries.
   * @param {string} query User-entered query.
   * @param {Object} [options] Result limit and domain tie-break callback.
   * @returns {SearchEntry[]} Ranked matching entries.
   */
  window.searchMatches = function (entries, query, options = {}) {
    let normalized = window.normalizeSearchText(query);
    if (!normalized) return [];
    let scored = entries
      .map((entry) => ({
        entry,
        priority: entryMatchPriority(entry, normalized),
      }))
      .filter((scoredEntry) => scoredEntry.priority >= MATCH_SUBSTRING);
    scored.sort(
      (left, right) =>
        right.priority - left.priority ||
        options.tieBreaker?.(left.entry, right.entry) ||
        left.entry.name.localeCompare(right.entry.name),
    );
    let matches = scored.map((scoredEntry) => scoredEntry.entry);
    if (typeof options.limit === "number")
      return matches.slice(0, options.limit);
    return matches;
  };
})();
