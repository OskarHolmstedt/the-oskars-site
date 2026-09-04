/**
 * @file Owns watch-project identity, source derivation, mutation, queue ordering, progress, sorting, and completion models.
 */

/** Normalizes a value for project ids. @param {*} value Id value. @returns {string} Normalized id. */
window.normalizeProjectId = function (value) {
  return window
    .normalizeTitle(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
};

/** Builds a deterministic project id for a source. @param {string} sourceType Source type. @param {string} sourceId Source id. @returns {string} Project id. */
window.projectIdForSource = function (sourceType, sourceId) {
  return `${String(sourceType || "").trim()}-${window.normalizeProjectId(sourceId)}`;
};

/** Builds the detail URL for a project's source entity. @param {ProjectRecord} project Project. @returns {string} Source URL or empty string. */
window.projectSourceHref = function (project) {
  if (project?.sourceType === "person")
    return window.personPageUrl(project.sourceId);
  if (project?.sourceType === "franchise")
    return window.franchisePageUrl(project.sourceId);
  if (project?.sourceType === "tag")
    return window.tagPageUrl(project.sourceLabel || project.sourceId);
  if (project?.sourceType === "watchlist-filter")
    return project.sourceHref || `${window.periodPageUrl("alltime", "alltime")}&view=watchlist`;
  if (project?.sourceType === "watch-goal")
    return project.sourceHref || "completion.html#completion-watch-goals";
  if (project?.sourceType === "official-results")
    return project.sourceHref || "completion.html#completion-oscars";
  return "";
};

function projectUniqueRefs(refs) {
  let seen = new Set();
  return (refs || []).filter((ref) => {
    let key = `${ref.type}\n${ref.id}`;
    return ref.id && !seen.has(key) && seen.add(key);
  });
}

/** Creates a normalized project film reference. @param {'archive'|'watchlist'|'watched'|'official'} type Store type. @param {string} id Film id. @param {Object} [meta] Reference metadata. @returns {ProjectFilmRef} Reference. */
window.projectFilmRef = function (type, id, meta = {}) {
  return Object.assign({ type, id }, meta);
};

/** Derives project references for a person. @param {string} personId Person id. @returns {ProjectFilmRef[]} References. */
window.projectRefsForPerson = function (personId) {
  let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[
    personId
  ];
  if (!person) return [];
  let refs = (person.filmIds || []).map((id) =>
    window.projectFilmRef("archive", id),
  );
  if ((person.professions || []).includes("Director")) {
    window.watchlistItemsByDirector?.(person.name).forEach((item) => {
      if (window.findWatchlistArchiveFilm?.(item)) return;
      refs.push(
        window.projectFilmRef(
          "watchlist",
          item.id || window.watchlistItemId(item),
        ),
      );
    });
  }
  refs.push(...(window.watchedFilmRefsForPerson?.(personId) || []));
  return projectUniqueRefs(refs);
};

/** Derives project references for a franchise. @param {string} franchiseId Franchise id. @returns {ProjectFilmRef[]} References. */
window.projectRefsForFranchise = function (franchiseId) {
  let franchise = (window.ensureFranchiseIndex?.() ||
    state.franchisesById ||
    {})[franchiseId];
  if (!franchise) return [];
  let watchlistRefs = (franchise.watchlistFilms || []).filter((entry) => {
    let item = window.findWatchlistItemById?.(entry.itemId);
    return item && !window.findWatchlistArchiveFilm?.(item);
  });
  return projectUniqueRefs([
    ...(franchise.films || []).map((entry) =>
      window.projectFilmRef("archive", entry.filmId, {
        rank: entry.rank || null,
      }),
    ),
    ...watchlistRefs.map((entry) =>
      window.projectFilmRef("watchlist", entry.itemId, {
        rank: entry.rank || null,
      }),
    ),
    ...(window.watchedFilmRefsForFranchise?.(franchiseId) || []),
  ]);
};

/** Derives project references for a tag. @param {string} tag Tag. @returns {ProjectFilmRef[]} References. */
window.projectRefsForTag = function (tag) {
  let record = window.tagRecord?.(tag);
  if (!record) return [];
  let archiveRefs = (record.films || []).map((film) =>
    window.projectFilmRef("archive", film.id),
  );
  let watchlistRefs = (record.watchlist || [])
    .filter((item) => item && !window.findWatchlistArchiveFilm?.(item))
    .map((item) =>
      window.projectFilmRef(
        "watchlist",
        item.id || window.watchlistItemId(item),
      ),
    );
  return projectUniqueRefs([
    ...archiveRefs,
    ...watchlistRefs,
    ...(window.watchedFilmRefsForTag?.(tag) || []),
  ]);
};

/** Builds ordered project references from watchlist items. @param {WatchlistItem[]} items Items. @returns {ProjectFilmRef[]} References. */
window.projectRefsForWatchlistItems = function (items) {
  return projectUniqueRefs(
    (items || [])
      .filter((item) => item && !window.findWatchlistArchiveFilm?.(item))
      .map((item) =>
        window.projectFilmRef(
          "watchlist",
          item.id || window.watchlistItemId(item),
        ),
      ),
  );
};

/** Builds project references from watchlist ids. @param {string[]} itemIds Item ids. @returns {ProjectFilmRef[]} References. */
window.projectRefsForWatchlistItemIds = function (itemIds) {
  return window.projectRefsForWatchlistItems(
    (itemIds || [])
      .map((id) => window.findWatchlistItemById?.(id))
      .filter(Boolean),
  );
};

/** Resolves a supported source into label, references, and URL. @param {string} sourceType Source type. @param {string} sourceId Source id. @returns {Object|null} Source record. */
window.projectSourceRecord = function (sourceType, sourceId) {
  if (sourceType === "person") {
    let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[
      sourceId
    ];
    if (!person) return null;
    return {
      name: person.name,
      sourceLabel: person.name,
      filmRefs: window.projectRefsForPerson(sourceId),
    };
  }
  if (sourceType === "franchise") {
    let franchise = (window.ensureFranchiseIndex?.() ||
      state.franchisesById ||
      {})[sourceId];
    if (!franchise) return null;
    return {
      name: franchise.name,
      sourceLabel: franchise.name,
      filmRefs: window.projectRefsForFranchise(sourceId),
    };
  }
  if (sourceType === "tag") {
    let tag = window.tagRecord?.(sourceId);
    if (!tag) return null;
    return {
      name: tag.name,
      sourceLabel: tag.name,
      filmRefs: window.projectRefsForTag(tag.name),
    };
  }
  if (sourceType === "watchlist-filter") {
    let filter = state.watchlistProjectSources?.[sourceId];
    if (!filter) return null;
    let filmRefs = filter.itemIds
      ? window.projectRefsForWatchlistItemIds(filter.itemIds)
      : window.projectRefsForWatchlistItems(filter.items || []);
    return {
      name: filter.name || "Watchlist filter project",
      sourceLabel: filter.label || "Watchlist filter",
      sourceHref: filter.href || `${window.periodPageUrl("alltime", "alltime")}&view=watchlist`,
      filmRefs,
    };
  }
  if (sourceType === "official-results")
    return window.officialCollectionProjectSource?.(sourceId) || null;
  if (sourceType === "watch-goal")
    return window.watchGoalProjectSource?.(sourceId) || null;
  return null;
};

// Resolves one filmRef (as computed by projectSourceRecord() above) down to
// the real Supabase films.id start_project_from_source() needs (issue
// #455). "archive"/"watched" refs already carry the real film id directly
// in ref.id (since #454, filmsById/findWatchedFilmById are keyed by the
// real Supabase id whenever a film is Supabase-backed); "watchlist" refs
// carry the watchlist row's own id instead, resolved through its
// supabaseFilmId; "official" refs may resolve to either, or to neither
// (a nomination never watched or watchlisted) - resolveProjectFilmRef
// already does exactly this three-way resolution.
function projectRefFilmId(ref) {
  if (ref?.type === "archive" || ref?.type === "watched") return ref.id;
  if (ref?.type === "watchlist")
    return window.findWatchlistItemById?.(ref.id)?.supabaseFilmId || null;
  if (ref?.type === "official") {
    let resolved = window.resolveProjectFilmRef(ref);
    if (!resolved) return null;
    return resolved.status === "watched"
      ? resolved.film?.id || null
      : resolved.item?.supabaseFilmId || null;
  }
  return null;
}

// Shared click-through for every "Start project" source button (issue
// #455). Writes straight to Supabase via start_project_from_source() -
// a second call for the same sourceType/sourceId refreshes the existing
// project's source_label and item list rather than creating a duplicate,
// matching the old (broken) upsertProjectFromSource()'s intent, just
// actually persisted this time.
/** Creates or refreshes a source-backed Supabase project and opens its page. @param {string} sourceType Source type. @param {string} sourceId Source id. @returns {Promise<Object|null>} Project row, or null if there was nothing real to add or the source doesn't resolve. */
window.startProjectFromSourceAndOpen = async function (sourceType, sourceId) {
  let ui = window.uiText || ((text) => text);
  let source = window.projectSourceRecord(sourceType, sourceId);
  if (!source) return null;
  let filmIds = [
    ...new Set(
      (source.filmRefs || []).map(projectRefFilmId).filter(Boolean),
    ),
  ];
  if (!filmIds.length) {
    alert(ui("None of these films are in the catalog yet."));
    return null;
  }
  try {
    let project = await window.createSupabaseProjectFromSource(
      sourceType,
      sourceId,
      source.name,
      filmIds,
      source.sourceLabel,
    );
    window.location.href = window.projectPageUrl(project.id);
    return project;
  } catch (err) {
    alert(err.message || String(err));
    return null;
  }
};

// Resolves one collection_items row's film_id to a ProjectFilmRef
// (issue #458): "archive" if it's a watched film already in the ranked
// archive, "watchlist" (keyed by the watchlist row's own id, not the
// film id) if it's watchlisted instead, or omitted entirely if the
// viewer has neither - matching the same accepted-gap pattern an
// unresolvable official-results nominee ref already has.
function projectSourceIndexRef(filmId) {
  if (state.filmsById?.[filmId]) return window.projectFilmRef("archive", filmId);
  let watchlistItem = (state.watchlist || []).find(
    (entry) => entry.supabaseFilmId === filmId,
  );
  if (watchlistItem) return window.projectFilmRef("watchlist", watchlistItem.id);
  return null;
}

/**
 * Reshapes every project the signed-in user owns (issue #458) into the
 * same ProjectRecord shape upsertProjectFromSource() used to build, so
 * the existing pure functions that already know how to read one
 * (projectProgress, resolveProjectFilmRef, renderSourceProjectAction,
 * projectFilmSets in compare-targets.js, resolveProjectPackScope in
 * presentation-packs.js) keep working completely unchanged, fed by real
 * Supabase data instead of the never-hydrated state.projects.
 * @param {Object[]} rows Raw rows from loadSupabaseLegacyHydrationSource()'s `ownProjects`.
 * @returns {ProjectRecord[]}
 */
window.buildProjectSourceIndexFromSupabase = function (rows) {
  return (rows || []).map((row) => {
    let project = row.projects || {};
    return {
      id: row.id,
      name: row.name,
      sourceType: row.source_type || "",
      sourceId: row.source_id || "",
      sourceLabel: row.source_label || "",
      status: project.status,
      pinned: project.pinned,
      updatedAt: project.updated_at,
      createdAt: row.created_at,
      filmRefs: (row.collection_items || [])
        .map((item) => projectSourceIndexRef(item.film_id))
        .filter(Boolean),
    };
  });
};

window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID = {};
window.OSKARS_PROJECT_SOURCE_INDEX_BY_SOURCE = {};

/**
 * Applies a freshly-hydrated project-source index (issue #458), indexing
 * it both by the project's own id and by its source identity.
 * @param {Object[]} rows Raw rows from loadSupabaseLegacyHydrationSource()'s `ownProjects`.
 */
window.applyProjectSourceIndex = function (rows) {
  let projects = window.buildProjectSourceIndexFromSupabase(rows);
  let byId = {};
  let bySource = {};
  projects.forEach((project) => {
    byId[project.id] = project;
    if (project.sourceType && project.sourceId)
      bySource[`${project.sourceType}::${project.sourceId}`] = project;
  });
  window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID = byId;
  window.OSKARS_PROJECT_SOURCE_INDEX_BY_SOURCE = bySource;
};

/** Finds a project by id. @param {string} projectId Project id. @returns {ProjectRecord|null} Project. */
window.findProjectById = function (projectId) {
  return window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID?.[projectId] || null;
};

/** Finds a project by source identity. @param {string} sourceType Source type. @param {string} sourceId Source id. @returns {ProjectRecord|null} Project. */
window.projectForSource = function (sourceType, sourceId) {
  return (
    window.OSKARS_PROJECT_SOURCE_INDEX_BY_SOURCE?.[
      `${sourceType}::${sourceId}`
    ] || null
  );
};

/** Renders the create/open action for a source-backed project. @param {string} sourceType Source type. @param {string} sourceId Source id. @param {Object} [options] Rendering controls. @returns {string} HTML. */
window.renderSourceProjectAction = function (
  sourceType,
  sourceId,
  options = {},
) {
  let escape = options.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let project = window.projectForSource(sourceType, sourceId);
  if (!project) {
    return `<button type="button" class="${escape(options.buttonClass || "")}" data-start-project-source="${escape(sourceType)}" data-project-source-id="${escape(sourceId)}">${escape(ui(options.startLabel || "Start project"))}</button>`;
  }
  let actionClasses = `source-project-action${options.compact ? " source-project-action--compact" : ""}`;
  let actionLink = `<a class="${escape(options.linkClass || "button-link")}" href="${escape(window.projectPageUrl(project.id))}">${escape(options.viewText || ui("View project"))}</a>`;
  if (options.linkOnlyWhenExisting) return actionLink;
  let progress = window.projectProgress?.(project);
  let status = ["archived", "complete"].includes(project.status)
    ? project.status
    : "active";
  let statusLabel =
    status === "active"
      ? ui("Open")
      : status === "complete"
        ? ui("Complete")
        : ui("Archived");
  let progressText = progress
    ? `${progress.watchedCount}/${progress.total} ${ui("watched")} · ${progress.percent}%`
    : statusLabel;
  return `<div class="${actionClasses}">${actionLink}<span>${escape(progressText)} · ${escape(statusLabel)}</span></div>`;
};

/** Tests whether a project is active and incomplete. @param {ProjectRecord} project Project. @returns {boolean} Whether open. */
window.projectIsOpen = function (project) {
  return !["archived", "complete"].includes(project?.status);
};

// A project's official-type filmRefs always come from one
// upsertProjectFromSource("official-results", scopeId) call, so they
// always share one source in practice - but this builds a completion
// model per distinct sourceId actually present (issue #343), computed
// once each, rather than assuming a single global one. A ref missing
// sourceId (pre-#343 data) falls back to Academy Awards, matching every
// filmRef.type === "official" ever created before this.
function officialCompletionsForRefs(filmRefs) {
  let bySourceId = new Map();
  (filmRefs || []).forEach((ref) => {
    if (ref.type !== "official") return;
    let sourceId = ref.sourceId || "academy-awards";
    if (!bySourceId.has(sourceId))
      bySourceId.set(sourceId, window.officialCollectionCompletion?.(sourceId));
  });
  return bySourceId;
}

/** Tests whether a project contains a film identity. @param {ProjectRecord} project Project. @param {Object} [identity] Film ids. @returns {boolean} Whether contained. */
window.projectMatchesFilm = function (
  project,
  { archiveId = "", watchlistId = "", watchedId = "" } = {},
) {
  let officialCompletions = officialCompletionsForRefs(project?.filmRefs);
  return (project?.filmRefs || []).some((ref) => {
    if (archiveId && ref.type === "archive" && ref.id === archiveId)
      return true;
    if (watchlistId && ref.type === "watchlist" && ref.id === watchlistId)
      return true;
    if (watchedId && ref.type === "watched" && ref.id === watchedId)
      return true;
    if (archiveId && ref.type === "watchlist") {
      let item = window.findWatchlistItemById?.(ref.id);
      return window.findWatchlistArchiveFilm?.(item)?.id === archiveId;
    }
    if (ref.type === "official") {
      let officialCompletion = officialCompletions.get(
        ref.sourceId || "academy-awards",
      );
      let record = window.resolveProjectFilmRef(ref, { officialCompletion });
      if (archiveId && record?.film?.id === archiveId) return true;
      if (watchedId && record?.film?.id === watchedId) return true;
      if (watchlistId && record?.item?.id === watchlistId) return true;
    }
    return false;
  });
};

/** Returns open projects containing a film identity. @param {Object} [identity] Film ids. @returns {ProjectRecord[]} Projects. */
window.activeProjectsForFilm = function ({
  archiveId = "",
  watchlistId = "",
  watchedId = "",
} = {}) {
  return Object.values(window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID || {})
    .filter(
      (project) =>
        window.projectIsOpen(project) &&
        window.projectMatchesFilm(project, {
          archiveId,
          watchlistId,
          watchedId,
        }),
    )
    .sort(
      (left, right) =>
        Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
        String(right.updatedAt || right.createdAt || "").localeCompare(
          String(left.updatedAt || left.createdAt || ""),
        ) ||
        String(left.name || "").localeCompare(String(right.name || "")),
    );
};

/** Resolves a project reference to its current film-like record. @param {ProjectFilmRef} ref Reference. @param {Object} [options] Shared official-results context. @returns {Object|null} Resolved record. */
window.resolveProjectFilmRef = function (ref, options = {}) {
  if (ref?.type === "archive") {
    let film = state.filmsById?.[ref.id];
    return film
      ? {
          ref,
          film,
          status: "watched",
          href: window.filmPageUrl(film.id),
          rewatch: Boolean(film.wantToRewatch),
        }
      : null;
  }
  if (ref?.type === "watchlist") {
    let item = window.findWatchlistItemById?.(ref.id);
    if (!item) return null;
    let archiveFilm = window.findWatchlistArchiveFilm?.(item);
    let film = window.watchlistFilmLike?.(item, archiveFilm) || item;
    return {
      ref,
      item,
      archiveFilm,
      film,
      status: archiveFilm ? "watched" : "watchlist",
      href: archiveFilm
        ? window.filmPageUrl(archiveFilm.id)
        : window.filmPageUrl(item.supabaseFilmId),
      rewatch: Boolean(archiveFilm?.wantToRewatch),
    };
  }
  if (ref?.type === "watched") {
    let film = window.findWatchedFilmById?.(ref.id);
    return film
      ? {
          ref,
          film,
          status: "watched",
          href: window.filmPageUrl(film.id),
          rewatch: Boolean(film.wantToRewatch),
        }
      : null;
  }
  if (ref?.type === "official") {
    let completion =
      options.officialCompletion ||
      window.officialCollectionCompletion?.(ref.sourceId || "academy-awards");
    let official = completion?.filmsById?.get(ref.id);
    if (!official) return null;
    if (official.watchedFilm) {
      let film = official.watchedFilm;
      return {
        ref,
        film,
        official,
        status: "watched",
        href: window.filmPageUrl(film.id),
        rewatch: Boolean(film.wantToRewatch),
      };
    }
    if (official.watchlistItem) {
      let item = official.watchlistItem;
      let film = window.watchlistFilmLike?.(item, null) || item;
      return {
        ref,
        item,
        film,
        official,
        status: "watchlist",
        href: window.filmPageUrl(item.supabaseFilmId),
        rewatch: false,
      };
    }
    return {
      ref,
      film: {
        id: `official::${official.id}`,
        title: official.title,
        year: official.year,
        director: "",
        awards: [],
        poster: null,
      },
      official,
      status: "watchlist",
      href: official.href,
      rewatch: false,
    };
  }
  return null;
};

// Every axis returns a "natural ascending" tuple (primary key first, then
// tie-breakers) - callers apply direction via `order` in sortProjectRecords
// below, rather than baking a fixed best-first orientation into the value
// itself, so the shared reverse-order button (issue #53) works uniformly
// across every axis instead of only some.
function projectSortValue(record, sort) {
  let film = record.film || {};
  let titleKey =
    window.englishTitleSortKey?.(film.title) || String(film.title || "");
  if (sort === "title") return [titleKey];
  if (sort === "year") return [Number(film.year || 9999), titleKey];
  if (sort === "rank")
    return [
      Number(film.allTimeRank || record.ref?.rank || 999999),
      Number(film.year || 9999),
      titleKey,
    ];
  if (sort === "rating")
    return [window.filmRatingSortValue?.(film.rating) || 0, titleKey];
  if (sort === "tier")
    return [
      window.watchlistTierRank?.(
        record.item?.tier ?? record.film?.rewatchTier,
      ) ?? 999,
      Number(film.year || 9999),
      titleKey,
    ];
  if (sort === "wins")
    return [
      (window.calculateAwardStats?.(film.awards || []) || {}).wins || 0,
      titleKey,
    ];
  if (sort === "nominations")
    return [
      (window.calculateAwardStats?.(film.awards || []) || {}).nominations || 0,
      titleKey,
    ];
  if (sort === "score")
    return [
      (window.calculateAwardStats?.(film.awards || []) || {}).awardScore || 0,
      titleKey,
    ];
  return [Number(record.ref?.projectOrder || record.index + 1 || 0), titleKey];
}

// Axes where "ascending" already means best-first (lower rank/tier number
// wins, oldest year first, A-Z, manual order) default to 'asc'; count/score
// axes where higher is better default to 'desc' so the initial view still
// shows best-first without the user having to hit reverse immediately.
/** Returns the default direction for a project sort axis. @param {string} sort Sort axis. @returns {'asc'|'desc'} Direction. */
window.defaultOrderForProjectSort = function (sort) {
  return sort === "rating" ||
    sort === "wins" ||
    sort === "nominations" ||
    sort === "score"
    ? "desc"
    : "asc";
};

/** Sorts project listing records by a selected axis. @param {Object[]} records Records. @param {string} sort Sort axis. @param {string|number} seed Shuffle seed. @param {'asc'|'desc'} order Direction. @returns {Object[]} Sorted records. */
window.sortProjectRecords = function (records, sort, seed, order) {
  if (sort === "shuffle") {
    return [...(records || [])].sort((left, right) =>
      window.compareBySeededShuffle(
        `${left.ref?.type || ""}:${left.ref?.id || ""}`,
        `${right.ref?.type || ""}:${right.ref?.id || ""}`,
        seed || "",
      ),
    );
  }
  let factor = order === "desc" ? -1 : 1;
  return [...(records || [])].sort((left, right) => {
    let leftValues = projectSortValue(left, sort);
    let rightValues = projectSortValue(right, sort);
    for (
      let index = 0;
      index < Math.max(leftValues.length, rightValues.length);
      index += 1
    ) {
      let leftValue = leftValues[index];
      let rightValue = rightValues[index];
      let comparison =
        typeof leftValue === "string" || typeof rightValue === "string"
          ? String(leftValue || "").localeCompare(String(rightValue || ""))
          : Number(leftValue || 0) - Number(rightValue || 0);
      if (comparison) return comparison * factor;
    }
    return 0;
  });
};

// Representative film for a project's poster: best-tiered unwatched film
// first, then best-ranked watched film, preferring records with a poster.
/** Selects a representative film from project progress. @param {Object} progress Progress model. @returns {FilmRecord|null} Representative. */
window.projectRepresentativeFilm = function (progress) {
  let rankedRecords = [
    ...window.sortProjectRecords(progress?.watchlist || [], "tier"),
    ...window.sortProjectRecords(progress?.watched || [], "rank"),
  ];
  return (
    rankedRecords
      .map((record) => record.film)
      .find(
        (film) => film?.id && window.normalizePosterRecord?.(film.poster),
      ) ||
    rankedRecords[0]?.film ||
    null
  );
};

/** Selects unique project-deck films with the ordered queue first and watched work filling remaining slots. @param {Object} progress Progress model. @param {number} [limit] Maximum films. @returns {FilmRecord[]} Films for a poster deck. */
window.projectPosterDeckFilms = function (progress, limit = 5) {
  let seen = new Set();
  return [
    ...window.sortProjectRecords(progress?.watchlist || [], "project"),
    ...window.sortProjectRecords(progress?.watched || [], "project"),
  ]
    .filter((record) => {
      let key =
        record.film?.id ||
        `${record.ref?.type || ""}:${record.ref?.id || ""}`;
      if (!record.film || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(limit) || 5))
    .map((record) => record.film);
};

/** Calculates resolved records, counts, and next items for a project. @param {ProjectRecord} project Project. @returns {Object} Progress model. */
window.projectProgress = function (project) {
  let missingRefs = [];
  let officialCompletions = officialCompletionsForRefs(project?.filmRefs);
  let records = (project?.filmRefs || [])
    .map((ref, index) => {
      let officialCompletion =
        ref.type === "official"
          ? officialCompletions.get(ref.sourceId || "academy-awards")
          : null;
      let record = window.resolveProjectFilmRef(ref, { officialCompletion });
      if (!record) missingRefs.push(Object.assign({ index }, ref));
      return record ? Object.assign(record, { index }) : null;
    })
    .filter(Boolean);
  let watched = records.filter((record) => record.status === "watched");
  // The queue also picks up already-watched films marked for rewatch
  // (issue #180) - status stays "watched" for completion accounting above,
  // so a rewatch film counts toward both watched and the queue.
  let watchlist = records.filter(
    (record) => record.status === "watchlist" || record.rewatch,
  );
  let missing = Math.max(0, (project?.filmRefs || []).length - records.length);
  let total = records.length + missing;
  let ratingStatistics = window.collectionRatingStatistics(
    watched.map((record) => record.film),
  );
  return {
    records,
    watched,
    watchlist,
    missingRefs,
    missing,
    total,
    ratingStatistics,
    watchedCount: watched.length,
    watchlistCount: watchlist.length,
    percent: total ? Math.round((watched.length / total) * 100) : 0,
    next: window.sortProjectRecords(watchlist, "project")[0] || null,
  };
};

/* ===========================
   COMPLETION (issue #17)
=========================== */

// Completion is always "of known works": the archive, standalone watched
// entries, and the watchlist.
// The sheet may not list a source's full canon, so a 100% figure means
// "everything the watchlist knows about", not "the director's whole career".

/** Calculates known-film completion for a director. @param {PersonRecord} person Person. @returns {Object} Completion model. */
window.directorCompletion = function (person) {
  let directedIds = new Set(
    (person?.credits || [])
      .filter(
        (credit) =>
          credit.source === "film" && credit.profession === "Director",
      )
      .map((credit) => credit.filmId),
  );
  let watchlistItems = window.watchlistItemsByDirector?.(person?.name) || [];
  let watchedCount =
    directedIds.size + new Set(person?.watchedOtherIds || []).size;
  let watchlistCount = watchlistItems.length;
  let total = watchedCount + watchlistCount;
  return {
    watchedCount,
    watchlistCount,
    total,
    percent: total ? Math.round((watchedCount / total) * 100) : 0,
    // watchlistItemsByDirector already sorts by tier + global order.
    nextItem: watchlistItems[0] || null,
  };
};

function completionRankOrder(left, right) {
  return (
    right.percent - left.percent ||
    right.total - left.total ||
    window.compareEnglishTitles(left.name, right.name)
  );
}

function completionNextFromWatchlistItem(item) {
  if (!item) return null;
  return {
    title: item.title || "",
    year: item.year || "",
    tier: item.tier || "",
    href: window.filmPageUrl?.(item.supabaseFilmId) || "",
  };
}

// Ranked in-progress completion rows for the hub page, each with a uniform
// { title, year, tier, href } next-unwatched pick. Sources with nothing left
// on the watchlist are not actionable, so they are only counted.
/** Builds ranked director, franchise, and project completion sections. @param {Object} [options] Section limits. @returns {Object} Completion hub model. */
window.completionHubData = function (options = {}) {
  let minDirectorKnown = Number(options.minDirectorKnown) || 3;
  let directors = [];
  let completeDirectors = 0;
  Object.values(window.ensurePeopleIndex?.() || state.peopleById || {}).forEach(
    (person) => {
      if (!person.professions?.includes("Director")) return;
      let completion = window.directorCompletion(person);
      if (completion.total < minDirectorKnown) return;
      if (!completion.watchlistCount) {
        completeDirectors += 1;
        return;
      }
      directors.push({
        type: "director",
        id: person.id,
        name: person.name,
        href: window.personPageUrl?.(person.id) || "",
        watchedCount: completion.watchedCount,
        watchlistCount: completion.watchlistCount,
        total: completion.total,
        percent: completion.percent,
        next: completionNextFromWatchlistItem(completion.nextItem),
      });
    },
  );

  let franchises = [];
  let completeFranchises = 0;
  Object.values(
    window.ensureFranchiseIndex?.() || state.franchisesById || {},
  ).forEach((franchise) => {
    if ((franchise.parentIds || []).length || franchise.parentId) return;
    let completion = window.franchiseCompletion(franchise);
    if (completion.total < 2) return;
    if (!completion.watchlistCount) {
      completeFranchises += 1;
      return;
    }
    franchises.push({
      type: "franchise",
      id: franchise.id,
      name: franchise.name,
      href: window.franchisePageUrl?.(franchise.id) || "",
      watchedCount: completion.watchedCount,
      watchlistCount: completion.watchlistCount,
      total: completion.total,
      percent: completion.percent,
      next: completionNextFromWatchlistItem(completion.nextItem),
    });
  });

  let projects = [];
  let completeProjects = 0;
  Object.values(window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID || {}).forEach((project) => {
    if (project.status === "archived") return;
    let progress = window.projectProgress(project);
    if (!progress.total) return;
    if (!progress.watchlistCount) {
      completeProjects += 1;
      return;
    }
    let nextRecord = progress.next;
    projects.push({
      type: "project",
      id: project.id,
      name: project.name,
      href: window.projectPageUrl?.(project.id) || "",
      watchedCount: progress.watchedCount,
      watchlistCount: progress.watchlistCount,
      total: progress.total,
      percent: progress.percent,
      next: nextRecord
        ? {
            title: nextRecord.film?.title || nextRecord.item?.title || "",
            year: nextRecord.film?.year || nextRecord.item?.year || "",
            tier: nextRecord.item?.tier || "",
            href: nextRecord.href || "",
          }
        : null,
    });
  });

  return {
    directors: directors.sort(completionRankOrder),
    franchises: franchises.sort(completionRankOrder),
    projects: projects.sort(completionRankOrder),
    completeDirectors,
    completeFranchises,
    completeProjects,
  };
};
