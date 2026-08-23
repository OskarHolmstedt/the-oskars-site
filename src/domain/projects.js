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

function projectRefKey(ref) {
  return `${ref?.type || ""}\n${ref?.id || ""}`;
}

function withProjectOrder(refs, existingRefs = []) {
  let hasExistingRefs = (existingRefs || []).length > 0;
  let existingOrder = new Map(
    (existingRefs || []).map((ref, index) => [
      projectRefKey(ref),
      Number(ref.projectOrder) || index + 1,
    ]),
  );
  let maxOrder = Array.from(existingOrder.values()).reduce(
    (max, order) => Math.max(max, Number(order) || 0),
    0,
  );
  let next = projectUniqueRefs(refs || []).map((ref) => Object.assign({}, ref));
  next.forEach((ref, index) => {
    let order =
      existingOrder.get(projectRefKey(ref)) || Number(ref.projectOrder) || 0;
    if (order > 0) {
      ref.projectOrder = order;
      maxOrder = Math.max(maxOrder, order);
    } else {
      ref.projectOrder = hasExistingRefs ? ++maxOrder : index + 1;
    }
  });
  next.sort(
    (left, right) =>
      Number(left.projectOrder || 999999) -
      Number(right.projectOrder || 999999),
  );
  next.forEach((ref, index) => {
    ref.projectOrder = index + 1;
  });
  return next;
}

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

// Films the user explicitly removed from a source-backed project stay out
// when the project is rebuilt from its source (issue #11) — without this,
// every refresh silently resurrected them.
function withoutDismissedRefs(filmRefs, project) {
  let dismissed = project?.dismissedRefs?.length
    ? new Set(project.dismissedRefs.map((ref) => `${ref.type}\n${ref.id}`))
    : null;
  if (!dismissed) return filmRefs;
  return (filmRefs || []).filter(
    (ref) => !dismissed.has(`${ref.type}\n${ref.id}`),
  );
}

/** Creates or refreshes a source-backed project. @param {string} sourceType Source type. @param {string} sourceId Source id. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Project. */
window.upsertProjectFromSource = function (sourceType, sourceId, options = {}) {
  state.projects ||= [];
  let source = window.projectSourceRecord(sourceType, sourceId);
  if (!source) return null;
  let id = window.projectIdForSource(sourceType, sourceId);
  let now = new Date().toISOString();
  let existing = state.projects.find((project) => project.id === id);
  if (existing) {
    existing.name = existing.name || source.name;
    existing.sourceLabel = source.sourceLabel;
    existing.sourceHref = source.sourceHref || existing.sourceHref || "";
    existing.filmRefs = withProjectOrder(
      withoutDismissedRefs(source.filmRefs, existing),
      existing.filmRefs,
    );
    existing.updatedAt = now;
    existing.status = existing.status || "active";
    if (options.save !== false) window.save();
    return existing;
  }
  let project = {
    id,
    name: source.name,
    sourceType,
    sourceId,
    sourceLabel: source.sourceLabel,
    sourceHref: source.sourceHref || "",
    filmRefs: withProjectOrder(source.filmRefs),
    createdAt: now,
    updatedAt: now,
    status: "active",
  };
  state.projects.push(project);
  if (options.save !== false) window.save();
  return project;
};

// A custom project starts from a hand-picked film set instead of a source
// entity, so it has no sourceId and can never be refreshed from source.
/** Creates a custom project from selected film references. @param {string} name Name. @param {ProjectFilmRef[]} filmRefs References. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Project. */
window.createCustomProject = function (name, filmRefs, options = {}) {
  let trimmedName = String(name || "").trim();
  if (!trimmedName) return null;
  state.projects ||= [];
  let base = window.normalizeProjectId(trimmedName) || "project";
  let id = `custom-${base}`;
  let suffix = 2;
  while (state.projects.some((project) => project.id === id))
    id = `custom-${base}-${suffix++}`;
  let now = new Date().toISOString();
  let project = {
    id,
    name: trimmedName,
    sourceType: "custom",
    sourceId: "",
    sourceLabel: trimmedName,
    sourceHref: "",
    filmRefs: withProjectOrder(filmRefs || []),
    createdAt: now,
    updatedAt: now,
    status: "active",
  };
  state.projects.push(project);
  if (options.save !== false) window.save();
  return project;
};

// Shared click-through for every "Start project" source button. The save must
// finish before navigating: window.save() debounces its IndexedDB write, so
// navigating right after upsert unloads the page before the write lands and
// project.html then loads a state snapshot without the new project.
/** Creates or refreshes a source project, saves it, and opens its page. @param {string} sourceType Source type. @param {string} sourceId Source id. @returns {Promise<ProjectRecord|null>} Project. */
window.startProjectFromSourceAndOpen = async function (sourceType, sourceId) {
  let project = window.upsertProjectFromSource(sourceType, sourceId, {
    save: false,
  });
  if (!project) return null;
  let saving = window.save?.({ immediate: true, rebuild: false });
  if (saving?.then) await saving;
  window.location.href = window.prepareOskarsAccountNavigation(
    window.projectPageUrl(project.id),
  );
  return project;
};

/** Finds a project by id. @param {string} projectId Project id. @returns {ProjectRecord|null} Project. */
window.findProjectById = function (projectId) {
  return (
    (state.projects || []).find((project) => project.id === projectId) || null
  );
};

/** Finds a project by source identity. @param {string} sourceType Source type. @param {string} sourceId Source id. @returns {ProjectRecord|null} Project. */
window.projectForSource = function (sourceType, sourceId) {
  let expectedId = window.projectIdForSource(sourceType, sourceId);
  return (
    (state.projects || []).find((project) => project.id === expectedId) || null
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

/** Returns the active project. @returns {ProjectRecord|null} Project. */
window.activeProject = function () {
  let project = window.findProjectById?.(state.activeProjectId);
  if (project) return project;
  if (state.activeProjectId) state.activeProjectId = "";
  return null;
};

/** Sets or clears the active project. @param {string} projectId Project id. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Active project. */
window.setActiveProject = function (projectId, options = {}) {
  let project = window.findProjectById?.(projectId);
  if (!project) return null;
  state.activeProjectId = project.id;
  if (["archived", "complete"].includes(project.status))
    project.status = "active";
  project.updatedAt = new Date().toISOString();
  if (options.save !== false) window.save({ rebuild: false });
  return project;
};

/** Refreshes a source-backed project's references. @param {string} projectId Project id. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Project. */
window.refreshProjectFromSource = function (projectId, options = {}) {
  let project = window.findProjectById?.(projectId);
  if (!project?.sourceType || !project.sourceId) return null;
  let source = window.projectSourceRecord(project.sourceType, project.sourceId);
  if (!source) return null;
  project.name = project.name || source.name;
  project.sourceLabel = source.sourceLabel;
  project.sourceHref = source.sourceHref || project.sourceHref || "";
  project.filmRefs = withProjectOrder(
    withoutDismissedRefs(source.filmRefs, project),
    project.filmRefs,
  );
  project.updatedAt = new Date().toISOString();
  if (project.status === "complete") {
    let progress = window.projectProgress(project);
    if (progress.watchlistCount) project.status = "active";
  }
  if (options.save !== false) window.save();
  return project;
};

/** Sets a project status. @param {string} projectId Project id. @param {'active'|'complete'|'archived'} status Status. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Project. */
window.setProjectStatus = function (projectId, status, options = {}) {
  let project = window.findProjectById?.(projectId);
  if (!project) return null;
  let nextStatus = ["active", "archived", "complete"].includes(status)
    ? status
    : "active";
  project.status = nextStatus;
  project.updatedAt = new Date().toISOString();
  if (
    state.activeProjectId === project.id &&
    ["archived", "complete"].includes(nextStatus)
  )
    state.activeProjectId = "";
  if (options.save !== false) window.save({ rebuild: false });
  return project;
};

/** Sets whether a project is pinned. @param {string} projectId Project id. @param {boolean} pinned Pinned state. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Project. */
window.setProjectPinned = function (projectId, pinned, options = {}) {
  let project = window.findProjectById?.(projectId);
  if (!project) return null;
  project.pinned = Boolean(pinned);
  project.updatedAt = new Date().toISOString();
  if (options.save !== false) window.save({ rebuild: false });
  return project;
};

/** Permanently removes a project and its project-owned note without changing any referenced film data. @param {string} projectId Project id. @param {Object} [options] Save controls. @returns {boolean} Whether a project was removed. */
window.deleteProject = function (projectId, options = {}) {
  state.projects ||= [];
  let index = state.projects.findIndex((project) => project.id === projectId);
  if (index < 0) return false;
  state.projects.splice(index, 1);
  if (state.activeProjectId === projectId) state.activeProjectId = "";
  if (state.entityNotes?.projects) delete state.entityNotes.projects[projectId];
  if (options.save !== false) window.save({ rebuild: false });
  return true;
};

/** Dismisses a film reference from a project. @param {string} projectId Project id. @param {string} type Store type. @param {string} id Film id. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Updated project. */
window.removeProjectFilmRef = function (projectId, type, id, options = {}) {
  let project = window.findProjectById?.(projectId);
  if (!project) return null;
  let before = project.filmRefs?.length || 0;
  project.filmRefs = (project.filmRefs || []).filter(
    (ref) => !(ref.type === type && ref.id === id),
  );
  if (project.filmRefs.length === before) return project;
  // Source-backed projects remember the removal so a source refresh cannot
  // bring the film back; custom projects have no refresh path to guard.
  if (project.sourceType && project.sourceType !== "custom") {
    project.dismissedRefs ||= [];
    if (
      !project.dismissedRefs.some((ref) => ref.type === type && ref.id === id)
    ) {
      project.dismissedRefs.push({ type, id });
    }
  }
  project.updatedAt = new Date().toISOString();
  if (options.save !== false) window.save();
  return project;
};

/** Restores dismissed references to a project. @param {string} projectId Project id. @param {Object} [options] Save controls. @returns {ProjectRecord|null} Updated project. */
window.clearProjectDismissedRefs = function (projectId, options = {}) {
  let project = window.findProjectById?.(projectId);
  if (!project?.dismissedRefs?.length) return project;
  project.dismissedRefs = [];
  project.updatedAt = new Date().toISOString();
  if (options.save !== false) window.save();
  return project;
};

/** Reorders one project queue reference around another. @param {string} projectId Project id. @param {string} fromType Moved store type. @param {string} fromId Moved id. @param {string} toType Target store type. @param {string} toId Target id. @param {'before'|'after'} [position] Position. @param {Object} [options] Save controls. @returns {{ok: boolean, reason: string}|{ok: boolean}} Move result. */
window.moveProjectQueueRef = function (
  projectId,
  fromType,
  fromId,
  toType,
  toId,
  position = "before",
  options = {},
) {
  let project = window.findProjectById?.(projectId);
  if (!project) return { ok: false, reason: "Project not found." };
  let refs = withProjectOrder(project.filmRefs || []);
  let fromRef = refs.find((ref) => ref.type === fromType && ref.id === fromId);
  let toRef = refs.find((ref) => ref.type === toType && ref.id === toId);
  if (!fromRef || !toRef)
    return { ok: false, reason: "Both films must exist in the project." };
  let fromRecord = window.resolveProjectFilmRef(fromRef);
  let toRecord = window.resolveProjectFilmRef(toRef);
  let inQueue = (record) =>
    record?.status === "watchlist" || Boolean(record?.rewatch);
  if (!inQueue(fromRecord) || !inQueue(toRecord)) {
    return {
      ok: false,
      reason:
        "Project queue ordering is limited to unwatched or rewatch-marked films.",
    };
  }
  let fromIndex = refs.indexOf(fromRef);
  let toIndex = refs.indexOf(toRef);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex)
    return { ok: false, reason: "No project move needed." };
  refs.splice(fromIndex, 1);
  toIndex = refs.indexOf(toRef);
  refs.splice(position === "after" ? toIndex + 1 : toIndex, 0, fromRef);
  refs.forEach((ref, index) => {
    ref.projectOrder = index + 1;
  });
  project.filmRefs = refs;
  project.updatedAt = new Date().toISOString();
  if (options.save !== false) window.save({ rebuild: false });
  return { ok: true };
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
  return [...(state.projects || [])]
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
        Number(right.id === state.activeProjectId) -
          Number(left.id === state.activeProjectId) ||
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
        : window.watchlistFilmPageUrl(ref.id),
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
        href: window.watchlistFilmPageUrl(item.id),
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
    href: window.watchlistFilmPageUrl?.(item.id) || "",
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
  (state.projects || []).forEach((project) => {
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
