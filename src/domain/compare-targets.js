/**
 * @file Compare-target adapter layer: resolves typed compare targets (film,
 * person, franchise, tag, project, period, category, and credit subject) onto the shared CompareTarget
 * capability shape, and derives per-target data (films, watchlist items,
 * award entries, facets, collaborators, period identity) that
 * src/pages/compare.js renders. Pure data; no HTML.
 */
(function () {
  function label(text) {
    return (window.uiText || ((value) => value))(text);
  }

  function trimmedUniqueValues(values) {
    let seen = new Set();
    return (values || [])
      .map((value) => String(value || "").trim())
      .filter((value) => value && !seen.has(value) && seen.add(value));
  }

  function normalizeNameList(values) {
    return (
      Array.isArray(values)
        ? values
        : String(values || "").split(/\s*(?:,|&|\band\b)\s*/i)
    )
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function projectFilmSets(project) {
    let progress = window.projectProgress?.(project);
    let records = progress?.records || [];
    return {
      filmIds: records
        .filter((record) => record.status === "watched" && record.film?.id)
        .map((record) => record.film.id),
      watchlistIds: records
        .filter((record) => record.status === "watchlist" && record.item?.id)
        .map((record) => record.item.id),
    };
  }

  function projectTargetMetrics(project) {
    let progress = window.projectProgress?.(project);
    return {
      films: progress?.total || (project.filmRefs || []).length,
      watched: progress?.watchedCount || 0,
      watchlist: progress?.watchlistCount || 0,
      completion: progress ? `${progress.percent}%` : "",
    };
  }

  // Period entries are canonically `{ id }` (PeriodFilmEntry, written by
  // `addToPeriod`); `filmId` is accepted for persisted snapshots that predate
  // that shape. This is the one place the fallback lives.
  function periodEntryFilm(entry) {
    return state.filmsById?.[entry.filmId || entry.id];
  }

  function withRatingStatistics(target) {
    if (!target) return null;
    target.ratingStatistics = window.collectionRatingStatistics(
      (target.filmIds || []).map((id) => state.filmsById?.[id]).filter(Boolean),
    );
    return target;
  }

  function resolvePeriodTarget(id) {
    let parts = String(id || "").split(":");
    let type = parts[0] || "alltime";
    let key = parts.slice(1).join(":") || "alltime";
    let pageType = window.periodPageType(type);
    let periods = state.periods || {};
    let period =
      pageType === "year"
        ? periods.years?.[key]
        : pageType === "decade"
          ? periods.decades?.[key]
          : pageType === "century"
            ? periods.centuries?.[key]
            : pageType === "alltime"
              ? periods.allTime
              : null;
    if (!period) return null;
    let films = (period.films || []).map(periodEntryFilm).filter(Boolean);
    let stats = window.calculateAwardStats(
      films.flatMap((film) => film.awards || []),
    );
    return withRatingStatistics({
      type: "period",
      id: `${pageType}:${pageType === "alltime" ? "alltime" : key}`,
      displayName: pageType === "alltime" ? label("All-time") : key,
      url: window.periodPageUrl(pageType, key),
      record: period,
      filmIds: trimmedUniqueValues(films.map((film) => film.id)),
      watchlistIds: [],
      metrics: {
        films: films.length,
        wins: stats.wins,
        nominations: stats.nominations,
        score: stats.awardScore,
      },
    });
  }

  /**
   * Resolves a typed target reference onto the shared CompareTarget shape,
   * normalizing every type's capabilities: `filmIds`/`watchlistIds` are
   * deduplicated non-empty ids, `metrics` are display key/value pairs, and
   * `record` is the underlying canonical record.
   * @param {{type: string, id: string}} target Typed reference to resolve.
   * @returns {CompareTarget|null} Resolved target, or null when unknown.
   */
  window.resolveCompareTarget = function (target) {
    let type = String(target?.type || "").trim();
    let id = String(target?.id || "").trim();
    if (!type || !id) return null;
    if (type === "film") {
      let film = window.findFilmById(id);
      if (!film) return null;
      let stats = window.calculateAwardStats(film.awards || []);
      return withRatingStatistics({
        type,
        id: film.id,
        displayName: window.localizedFilmTitle?.(film) || film.title,
        url: window.filmPageUrl(film.id),
        record: film,
        filmIds: [film.id],
        watchlistIds: [],
        metrics: {
          year: film.year || "",
          rating: film.rating || "",
          allTimeRank: film.allTimeRank || "",
          wins: stats.wins,
          nominations: stats.nominations,
          score: stats.awardScore,
        },
      });
    }
    if (type === "person") {
      let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[id];
      if (!person) return null;
      return withRatingStatistics({
        type,
        id: person.id,
        displayName: person.name,
        url: window.personPageUrl(person.id),
        record: person,
        filmIds: trimmedUniqueValues(person.filmIds || []),
        watchlistIds: (person.professions || []).includes("Director")
          ? trimmedUniqueValues(
              (window.watchlistItemsByDirector?.(person.name) || []).map(
                (item) => item.id || window.watchlistItemId?.(item),
              ),
            )
          : [],
        metrics: {
          films: person.filmIds?.length || 0,
          wins: person.stats?.wins || 0,
          nominations: person.stats?.nominations || 0,
          score: person.awardScores?.year || 0,
          professions: (person.professions || [])
            .map((profession) => label(profession))
            .join(", "),
        },
      });
    }
    if (type === "franchise") {
      let franchise = (window.ensureFranchiseIndex?.() ||
        state.franchisesById ||
        {})[id];
      if (!franchise) return null;
      let completion = window.franchiseCompletion?.(franchise);
      return withRatingStatistics({
        type,
        id: franchise.id,
        displayName: franchise.name,
        url: window.franchisePageUrl(franchise.id),
        record: franchise,
        filmIds: trimmedUniqueValues(
          (franchise.films || []).map((entry) => entry.filmId),
        ),
        watchlistIds: trimmedUniqueValues(
          (franchise.watchlistFilms || []).map((entry) => entry.itemId),
        ),
        metrics: {
          films:
            completion?.total ||
            (franchise.films || []).length +
              (franchise.watchlistFilms || []).length,
          watched: completion?.watchedCount || (franchise.films || []).length,
          watchlist:
            completion?.watchlistCount ||
            (franchise.watchlistFilms || []).length,
          completion: completion ? `${completion.percent}%` : "",
          children: franchise.childIds?.length || 0,
        },
      });
    }
    if (type === "tag") {
      let tag = window.tagRecord?.(id);
      if (!tag) return null;
      return withRatingStatistics({
        type,
        id: tag.name,
        displayName: tag.name,
        url: window.tagPageUrl(tag.name),
        record: tag,
        filmIds: trimmedUniqueValues((tag.films || []).map((film) => film.id)),
        watchlistIds: trimmedUniqueValues(
          (tag.watchlist || []).map(
            (item) => item.id || window.watchlistItemId?.(item),
          ),
        ),
        metrics: {
          films: (tag.films || []).length + (tag.watchlist || []).length,
          watched: (tag.films || []).length,
          watchlist: (tag.watchlist || []).length,
        },
      });
    }
    if (type === "project") {
      let project = window.findProjectById?.(id);
      if (!project) return null;
      let sets = projectFilmSets(project);
      return withRatingStatistics({
        type,
        id: project.id,
        displayName: project.name,
        url: window.projectPageUrl(project.id),
        record: project,
        filmIds: trimmedUniqueValues(sets.filmIds),
        watchlistIds: trimmedUniqueValues(sets.watchlistIds),
        metrics: projectTargetMetrics(project),
      });
    }
    if (type === "period") return resolvePeriodTarget(id);
    if (type === "category") {
      let categories = window.getOrderedCategories?.() || [];
      if (!categories.includes(id)) return null;
      let films = window.filmsForAwardCategory(id);
      let entries = window.awardCategoryEntries(id);
      let stats = window.calculateAwardStats(entries.map((entry) => entry.award));
      return withRatingStatistics({
        type,
        id,
        displayName: window.localizedCategoryName?.(id) || id,
        url: window.categoryPageUrl(id),
        record: { name: id, entries },
        filmIds: trimmedUniqueValues(films.map((film) => film.id)),
        watchlistIds: [],
        metrics: {
          films: films.length,
          wins: stats.wins,
          nominations: stats.nominations,
          score: stats.awardScore,
        },
      });
    }
    if (type === "song" || type === "role") {
      let subject = (window.ensureCreditSubjects?.() ||
        state.creditSubjectsById || {})[id];
      if (!subject || subject.type !== type) return null;
      return withRatingStatistics({
        type,
        id: subject.id,
        displayName: subject.title,
        url: window.subjectPageUrl(subject.id),
        record: subject,
        filmIds: trimmedUniqueValues(
          (subject.films || []).map((film) => film.id),
        ),
        watchlistIds: [],
        metrics: {
          films: subject.films?.length || 0,
          people: subject.people?.length || 0,
          wins: subject.stats?.wins || 0,
          nominations: subject.stats?.nominations || 0,
        },
      });
    }
    return null;
  };

  /**
   * Resolves a list of typed target references, dropping unknown targets and
   * duplicates (by compare-target key) and capping the result.
   * @param {{type: string, id: string}[]} targets Typed references.
   * @param {number} [limit] Maximum targets to keep.
   * @returns {CompareTarget[]} Resolved, deduplicated targets.
   */
  window.normalizeCompareTargets = function (targets, limit = 4) {
    let seen = new Set();
    return (targets || [])
      .map(window.resolveCompareTarget)
      .filter((target) => {
        let key =
          window.compareTargetKey?.(target) ||
          (target ? `${target.type}:${target.id}` : "");
        return key && !seen.has(key) && seen.add(key);
      })
      .slice(0, limit);
  };

  /**
   * Watched film records represented by a target.
   * @param {CompareTarget} target Resolved target.
   * @returns {FilmRecord[]} Films found in the archive.
   */
  window.compareTargetFilms = function (target) {
    return (target?.filmIds || [])
      .map((id) => state.filmsById?.[id])
      .filter(Boolean);
  };

  /**
   * Watchlist items represented by a target.
   * @param {CompareTarget} target Resolved target.
   * @returns {WatchlistItem[]} Matching watchlist items.
   */
  window.compareTargetWatchlistItems = function (target) {
    let ids = new Set(target?.watchlistIds || []);
    return (state.watchlist || []).filter((item) =>
      ids.has(item.id || window.watchlistItemId?.(item)),
    );
  };

  /**
   * Splits the represented films and watchlist items of two targets into
   * shared and side-specific ids while preserving each target's order.
   * @param {CompareTarget} left Left compare target.
   * @param {CompareTarget} right Right compare target.
   * @returns {CompareTargetOverlap} Pairwise represented-item overlap.
   */
  window.compareTargetOverlap = function (left, right) {
    let leftFilmIds = left?.filmIds || [];
    let rightFilmIds = right?.filmIds || [];
    let leftWatchlistIds = left?.watchlistIds || [];
    let rightWatchlistIds = right?.watchlistIds || [];
    let leftFilms = new Set(leftFilmIds);
    let rightFilms = new Set(rightFilmIds);
    let leftWatchlist = new Set(leftWatchlistIds);
    let rightWatchlist = new Set(rightWatchlistIds);
    return {
      sharedFilmIds: leftFilmIds.filter((id) => rightFilms.has(id)),
      leftOnlyFilmIds: leftFilmIds.filter((id) => !rightFilms.has(id)),
      rightOnlyFilmIds: rightFilmIds.filter((id) => !leftFilms.has(id)),
      sharedWatchlistIds: leftWatchlistIds.filter((id) =>
        rightWatchlist.has(id),
      ),
      leftOnlyWatchlistIds: leftWatchlistIds.filter(
        (id) => !rightWatchlist.has(id),
      ),
      rightOnlyWatchlistIds: rightWatchlistIds.filter(
        (id) => !leftWatchlist.has(id),
      ),
    };
  };

  /**
   * Every award on a target's represented films, paired with its film.
   * @param {CompareTarget} target Resolved target.
   * @returns {{film: FilmRecord, award: AwardRecord}[]} Award entries.
   */
  window.compareTargetAwardEntries = function (target) {
    return window
      .compareTargetFilms(target)
      .flatMap((film) => (film.awards || []).map((award) => ({ film, award })));
  };

  /**
   * Splits a period target's id into its period identity.
   * @param {CompareTarget} target Resolved period target.
   * @returns {{type: string, key: string}} Period page type and key.
   */
  window.comparePeriodIdentity = function (target) {
    let [type, ...rest] = String(target?.id || "").split(":");
    return { type: type || "alltime", key: rest.join(":") || "alltime" };
  };

  /**
   * The single period page type shared by every target, or '' when they mix.
   * @param {CompareTarget[]} targets Resolved period targets.
   * @returns {string} Shared period type, or ''.
   */
  window.compareSamePeriodType = function (targets) {
    let types = new Set(
      targets.map((target) => window.comparePeriodIdentity(target).type),
    );
    return types.size === 1 ? [...types][0] : "";
  };

  function awardBelongsToPeriodTarget(award, target) {
    let { type, key } = window.comparePeriodIdentity(target);
    let awardYear = String(award.year || "");
    if (type === "alltime") return true;
    if (type === "year") return awardYear === key;
    if (type === "decade")
      return (
        awardYear === key ||
        (/^\d{4}$/.test(awardYear) && window.getDecadeKey(awardYear) === key)
      );
    if (type === "century")
      return (
        awardYear === key ||
        (/^\d{4}$/.test(awardYear) && window.getCenturyKey(awardYear) === key)
      );
    return false;
  }

  /**
   * Award entries on a period target's films, restricted to awards that
   * belong to that period (a decade target keeps its years' awards).
   * @param {CompareTarget} target Resolved period target.
   * @returns {{film: FilmRecord, award: AwardRecord}[]} Period-scoped entries.
   */
  window.comparePeriodAwardEntries = function (target) {
    return window
      .compareTargetFilms(target)
      .flatMap((film) =>
        (film.awards || [])
          .filter((award) => awardBelongsToPeriodTarget(award, target))
          .map((award) => ({ film, award })),
      );
  };

  function filmPeople(film) {
    let people = new Map();
    normalizeNameList(
      film.directors?.length ? film.directors : film.director,
    ).forEach((name) => {
      let id =
        window.normalizePersonName?.(name) || window.normalizeTitle(name);
      if (id) people.set(id, { id, name });
    });
    Object.values(film.peopleByProfession || {})
      .flat()
      .forEach((person) => {
        if (person?.id && person.name)
          people.set(person.id, { id: person.id, name: person.name });
      });
    return [...people.values()];
  }

  /**
   * Everyone credited on a person target's films except the person, A-Z.
   * @param {CompareTarget} target Resolved person target.
   * @returns {{id: string, name: string}[]} Collaborators.
   */
  window.comparePersonCollaborators = function (target) {
    let comparedId = target.id;
    let collaborators = new Map();
    window.compareTargetFilms(target).forEach((film) => {
      filmPeople(film).forEach((person) => {
        if (person.id && person.id !== comparedId)
          collaborators.set(person.id, person);
      });
    });
    return [...collaborators.values()].sort((left, right) =>
      window.compareEnglishTitles(left.name, right.name),
    );
  };

  /**
   * Collaborators shared by every person target.
   * @param {CompareTarget[]} targets Resolved person targets.
   * @returns {{id: string, name: string}[]} People collaborating with all of them.
   */
  window.compareSharedCollaborators = function (targets) {
    let collaboratorSets = targets.map(window.comparePersonCollaborators);
    if (!collaboratorSets.length) return [];
    return collaboratorSets[0].filter((person) =>
      collaboratorSets.every((collaborators) =>
        collaborators.some((candidate) => candidate.id === person.id),
      ),
    );
  };

  function facetEntry(key, label, href = "") {
    return {
      key: String(key || "").trim(),
      label: String(label || "").trim(),
      href,
    };
  }

  function uniqueFacetEntries(entries) {
    let seen = new Set();
    return (entries || [])
      .filter((entry) => {
        if (!entry?.key || !entry.label || seen.has(entry.key)) return false;
        seen.add(entry.key);
        return true;
      })
      .sort((left, right) =>
        window.compareEnglishTitles(left.label, right.label),
      );
  }

  function addFilmFacetEntries(facets, film) {
    (window.countryListValues?.(film.country) || []).forEach((country) => {
      facets.countries.push(
        facetEntry(
          window.normalizeTitle(country),
          country,
          window.countryFilterUrl?.(country) || "",
        ),
      );
    });
    if (/^\d{4}$/.test(String(film.year || ""))) {
      facets.years.push(
        facetEntry(
          film.year,
          film.year,
          window.periodPageUrl("year", film.year),
        ),
      );
    }
    (window.parseFilmTags?.(film.tags) || []).forEach((tag) => {
      facets.tags.push(
        facetEntry(window.normalizeTitle(tag), tag, window.tagPageUrl(tag)),
      );
    });
    (window.normalizeFranchiseMemberships?.(film.franchises) || []).forEach(
      (membership) => {
        let name = membership.name || membership.id;
        facets.franchises.push(
          facetEntry(
            membership.id || window.normalizeTitle(name),
            name,
            membership.id ? window.franchisePageUrl(membership.id) : "",
          ),
        );
      },
    );
    normalizeNameList(
      film.directors?.length ? film.directors : film.director,
    ).forEach((name) => {
      let id =
        window.normalizePersonName?.(name) || window.normalizeTitle(name);
      facets.people.push(facetEntry(id, name, window.personPageUrl(id)));
    });
    Object.values(film.peopleByProfession || {})
      .flat()
      .forEach((person) => {
        let id =
          person.id ||
          window.normalizePersonName?.(person.name) ||
          window.normalizeTitle(person.name);
        facets.people.push(
          facetEntry(id, person.name, window.personPageUrl(id)),
        );
      });
    if (film.medium && film.medium !== "unknown")
      facets.media.push(
        facetEntry(window.normalizeTitle(film.medium), label(film.medium), ""),
      );
    if (film.screenplayType && film.screenplayType !== "unknown")
      facets.screenplays.push(
        facetEntry(
          window.normalizeTitle(film.screenplayType),
          label(film.screenplayType),
          "",
        ),
      );
  }

  function addWatchlistFacetEntries(facets, item) {
    (window.countryListValues?.(item.country) || []).forEach((country) => {
      facets.countries.push(
        facetEntry(
          window.normalizeTitle(country),
          country,
          window.countryFilterUrl?.(country) || "",
        ),
      );
    });
    if (/^\d{4}$/.test(String(item.year || ""))) {
      facets.years.push(
        facetEntry(
          item.year,
          item.year,
          window.periodPageUrl("year", item.year),
        ),
      );
    }
    (window.parseFilmTags?.(item.tags) || []).forEach((tag) => {
      facets.tags.push(
        facetEntry(window.normalizeTitle(tag), tag, window.tagPageUrl(tag)),
      );
    });
    (window.normalizeFranchiseMemberships?.(item.franchises) || []).forEach(
      (membership) => {
        let name = membership.name || membership.id;
        facets.franchises.push(
          facetEntry(
            membership.id || window.normalizeTitle(name),
            name,
            membership.id ? window.franchisePageUrl(membership.id) : "",
          ),
        );
      },
    );
    normalizeNameList(
      item.directors?.length ? item.directors : item.director,
    ).forEach((name) => {
      let id =
        window.normalizePersonName?.(name) || window.normalizeTitle(name);
      facets.people.push(facetEntry(id, name, window.personPageUrl(id)));
    });
    if (item.medium && item.medium !== "unknown")
      facets.media.push(
        facetEntry(window.normalizeTitle(item.medium), label(item.medium), ""),
      );
    if (item.screenplayType && item.screenplayType !== "unknown")
      facets.screenplays.push(
        facetEntry(
          window.normalizeTitle(item.screenplayType),
          label(item.screenplayType),
          "",
        ),
      );
  }

  /**
   * Linkable metadata facets across a target's films and watchlist items,
   * each list deduplicated by key and sorted by label.
   * @param {CompareTarget} target Resolved target.
   * @returns {Record<'countries'|'years'|'tags'|'franchises'|'people'|'media'|'screenplays', CompareFacetEntry[]>} Facet lists.
   */
  window.compareTargetFacets = function (target) {
    let facets = {
      countries: [],
      years: [],
      tags: [],
      franchises: [],
      people: [],
      media: [],
      screenplays: [],
    };
    window
      .compareTargetFilms(target)
      .forEach((film) => addFilmFacetEntries(facets, film));
    window
      .compareTargetWatchlistItems(target)
      .forEach((item) => addWatchlistFacetEntries(facets, item));
    Object.keys(facets).forEach(
      (key) => (facets[key] = uniqueFacetEntries(facets[key])),
    );
    return facets;
  };

  /**
   * Facet entries present in every target's facet list for one facet key.
   * @param {Record<string, CompareFacetEntry[]>[]} facetsList Per-target facets from `compareTargetFacets`.
   * @param {string} key Facet key, e.g. 'countries'.
   * @returns {CompareFacetEntry[]} Entries shared by all targets.
   */
  window.compareSharedFacetEntries = function (facetsList, key) {
    if (!facetsList.length) return [];
    let first = facetsList[0][key] || [];
    return first.filter((entry) =>
      facetsList.every((facets) =>
        (facets[key] || []).some((candidate) => candidate.key === entry.key),
      ),
    );
  };
})();
