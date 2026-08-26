/**
 * @file Plans, previews, applies, and safely reverses atomic watchlist-to-watched lifecycle transitions.
 */

(function () {
  const TRANSITION_UNDO_MAX_BYTES = 1024 * 1024;
  const TRANSFER_FIELDS = [
    "tmdbId",
    "letterboxdUrl",
    "swedishTitle",
    "director",
    "directors",
    "tags",
    "franchises",
    "poster",
    "runtimeMinutes",
    "medium",
    "screenplayType",
    "adaptationSource",
    "country",
    "primaryCountry",
    "platform",
    "url",
  ];

  function clone(value) {
    return value === undefined ? undefined : window.cloneRecord(value);
  }
  window.watchedFilmClone = clone;

  function stableJson(value) {
    if (value === null || typeof value !== "object")
      return JSON.stringify(value);
    if (Array.isArray(value))
      return `[${value.map(stableJson).join(",")}]`;
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  function signature(value) {
    let json = stableJson(value === undefined ? null : value);
    let first = 2166136261;
    let second = 2654435769;
    for (let index = 0; index < json.length; index += 1) {
      let code = json.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 2246822519);
    }
    return `${json.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
  }

  function recordsEqual(left, right) {
    return stableJson(left ?? null) === stableJson(right ?? null);
  }

  function plainJson(value) {
    if (value === null) return true;
    if (["string", "number", "boolean"].includes(typeof value))
      return Number.isFinite(value) || typeof value !== "number";
    if (Array.isArray(value)) return value.every(plainJson);
    if (!value || typeof value !== "object") return false;
    let prototype = Object.getPrototypeOf(value);
    return (
      (prototype === Object.prototype || prototype === null) &&
      Object.values(value).every(plainJson)
    );
  }

  function normalizeViewingFacts(values = {}) {
    let facts = {};
    let rating = String(values.rating || "").trim();
    if (rating) facts.rating = rating;
    let ratingValue = Number(values.ratingValue);
    let parsedRating = rating ? window.parseFilmRating?.(rating) : null;
    if (!ratingValue && parsedRating)
      ratingValue = Number(parsedRating.value) || 0;
    if (ratingValue > 0) facts.ratingValue = ratingValue;
    if (parsedRating?.modifier) facts.ratingModifier = parsedRating.modifier;
    let dateWatched = String(values.dateWatched || "").trim();
    if (dateWatched) {
      facts.dateWatched =
        window.normalizeWatchedDate?.(dateWatched) || dateWatched;
    }
    let platform = String(values.platform || "").trim();
    if (platform) facts.platform = platform;
    let views = Number(values.views);
    if (Number.isInteger(views) && views > 0) facts.views = views;
    return facts;
  }

  function valuePresent(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== undefined && value !== null && String(value).trim() !== "";
  }

  function mergeWatchlistMetadata(target, item, facts) {
    let merged = clone(target || {});
    TRANSFER_FIELDS.forEach((field) => {
      if (!valuePresent(merged[field]) && valuePresent(item[field]))
        merged[field] = clone(item[field]);
    });
    Object.entries(facts || {}).forEach(([field, value]) => {
      merged[field] = clone(value);
    });
    merged.id ||= item.id || window.watchlistItemId(item);
    merged.title ||= item.title;
    merged.year = String(merged.year || item.year || "");
    merged.normalizedTitle ||= window.normalizeTitle(merged.title);
    merged.type ||= "Film";
    return merged;
  }

  function watchedMatches(item) {
    let tmdbId = String(item.tmdbId || "").trim();
    let id = String(item.id || window.watchlistItemId(item));
    let identity = window.filmIdentityKey(item, { includePeriodKey: true });
    return (window.state.watchedOther || []).filter((film) => {
      if (tmdbId && String(film.tmdbId || "").trim() === tmdbId) return true;
      if (film.id && film.id === id) return true;
      return (
        identity &&
        window.filmIdentityKey(film, { includePeriodKey: true }) === identity
      );
    });
  }

  function archiveSourceSnapshots(archiveId, item, facts) {
    let snapshots = [];
    Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
      (period.films || []).forEach((film, index) => {
        if (
          film.id !== archiveId &&
          !window.filmMatchesId?.(film, archiveId, {
            periodType: period.periodType,
            periodKey,
          })
        )
          return;
        let before = clone(film);
        let after = mergeWatchlistMetadata(before, item, facts);
        after.id = film.id || archiveId;
        snapshots.push({ periodKey, index, before, after });
      });
    });
    return snapshots;
  }

  function retargetReferenceList(refs, watchlistId, target) {
    let changed = false;
    let mapped = (refs || []).map((ref) => {
      if (ref.type !== "watchlist" || ref.id !== watchlistId) return clone(ref);
      changed = true;
      return Object.assign({}, clone(ref), {
        type: target.type,
        id: target.id,
      });
    });
    let byIdentity = new Map();
    mapped.forEach((ref) => {
      let key = `${ref.type}\n${ref.id}`;
      let existing = byIdentity.get(key);
      if (!existing) {
        byIdentity.set(key, ref);
        return;
      }
      changed = true;
      let existingOrder = Number(existing.projectOrder) || 999999;
      let nextOrder = Number(ref.projectOrder) || 999999;
      if (nextOrder < existingOrder) existing.projectOrder = ref.projectOrder;
    });
    let result = [...byIdentity.values()];
    if (result.some((ref) => Number(ref.projectOrder) > 0)) {
      result.sort(
        (left, right) =>
          Number(left.projectOrder || 999999) -
          Number(right.projectOrder || 999999),
      );
      result.forEach((ref, index) => {
        ref.projectOrder = index + 1;
      });
    }
    return { changed, refs: result };
  }

  function projectChanges(watchlistId, target, now) {
    let changes = [];
    (window.state.projects || []).forEach((project, index) => {
      let filmRefs = retargetReferenceList(
        project.filmRefs,
        watchlistId,
        target,
      );
      let dismissedRefs = retargetReferenceList(
        project.dismissedRefs,
        watchlistId,
        target,
      );
      if (!filmRefs.changed && !dismissedRefs.changed) return;
      let after = clone(project);
      after.filmRefs = filmRefs.refs;
      if (project.dismissedRefs || dismissedRefs.refs.length)
        after.dismissedRefs = dismissedRefs.refs;
      after.updatedAt = now;
      changes.push({ index, id: project.id, before: clone(project), after });
    });
    return changes;
  }

  function sourceChanges(watchlistId) {
    let changes = [];
    Object.entries(window.state.watchlistProjectSources || {}).forEach(
      ([key, source]) => {
        if (!(source.itemIds || []).includes(watchlistId)) return;
        let after = clone(source);
        after.itemIds = (after.itemIds || []).filter((id) => id !== watchlistId);
        changes.push({ key, before: clone(source), after });
      },
    );
    return changes;
  }

  function baseRevision() {
    return String(
      window.state.draftMetadata?.baseRevision ||
        window.state.canonicalRevision ||
        "legacy-unversioned",
    );
  }
  window.watchedFilmBaseRevision = baseRevision;

  function transitionStateSignature(watchlistId, target) {
    let item = window.findWatchlistItemById?.(watchlistId);
    let archive =
      target?.type === "archive"
        ? archiveSourceSnapshots(target.id, item || {}, {}).map((entry) => ({
            periodKey: entry.periodKey,
            index: entry.index,
            record: entry.before,
          }))
        : [];
    return signature({
      item,
      watchedOther: window.state.watchedOther || [],
      archive,
      projects: window.state.projects || [],
      watchlistProjectSources: window.state.watchlistProjectSources || {},
      intakeWorkflows: window.state.intakeWorkflows || [],
      draftMetadata: window.state.draftMetadata || null,
      watchlistOrder: (window.state.watchlist || []).map((entry) => ({
        id: entry.id || window.watchlistItemId(entry),
        order: entry.order ?? null,
        tier: entry.tier || "",
      })),
    });
  }

  function orderedWatchlistWithout(watchlistId) {
    let items = (window.state.watchlist || [])
      .filter(
        (item) => (item.id || window.watchlistItemId(item)) !== watchlistId,
      )
      .map(clone);
    items.sort(
      (left, right) =>
        window.watchlistTierRank(left.tier) -
          window.watchlistTierRank(right.tier) ||
        Number(left.order || 999999) - Number(right.order || 999999) ||
        Number(left.year || 9999) - Number(right.year || 9999) ||
        window.compareEnglishTitles(left.title, right.title),
    );
    items.forEach((item, index) => {
      item.order = index + 1;
    });
    return items;
  }

  function workflowForTransition(item, target, facts, now) {
    let ratingComplete = Boolean(window.parseFilmRating?.(facts.rating)?.value);
    return window.createWatchedIntakeWorkflow({
      source: "watchlist-transition",
      sourceRecordId: item.id,
      filmId: target.id,
      ratingComplete,
      now,
      baseRevision: baseRevision(),
    });
  }

  /**
   * Finds a first-class non-archive watched film by id.
   * @param {string} id Watched-film id.
   * @returns {WatchedOtherEntry|null} Watched film or null.
   */
  window.findWatchedFilmById = function (id) {
    return (
      (window.state.watchedOther || []).find(
        (film) => film.id === String(id || ""),
      ) || null
    );
  };

  /**
   * Moves a film between the ranked archive (`years[film.year].films`) and
   * `watchedOther`, in place. Looks up the real array-resident object by
   * `film.id` rather than trusting `film`'s own reference - `film` may be
   * `state.filmsById`'s canonical clone (built by `addFilmToStore`, a
   * genuinely different object from whatever sits in `years[year].films`),
   * not the object physically in either array. Moving that clone instead of
   * the real object would silently no-op (or worse, leave a duplicate
   * behind). The real object moves untouched, so every other field already
   * on it (tags, franchises, notes-by-id, dateWatched, views, ...) carries
   * over as-is. Also fixes up any project `filmRefs` pointing at this id,
   * since resolveProjectFilmRef is strictly type-gated ("archive" only
   * resolves via state.filmsById, "watched" only via findWatchedFilmById) -
   * a stale ref after a move would silently stop resolving and the film
   * would vanish from any project it's in.
   * @param {FilmRecord|WatchedOtherEntry} film Film currently in either bucket (by id).
   * @param {"archive"|"watchedOther"} targetBucket Destination bucket.
   * @returns {boolean} Whether a move actually happened.
   */
  window.moveFilmBetweenArchiveAndWatchedOther = function (film, targetBucket) {
    if (!film?.id) return false;
    let hasYear = /^\d{4}$/.test(String(film.year || ""));
    let archiveFilms = hasYear
      ? window.state.years?.[film.year]?.films || []
      : [];
    let archiveMatch = archiveFilms.find((entry) => entry.id === film.id);
    let watchedOtherMatch = (window.state.watchedOther || []).find(
      (entry) => entry.id === film.id,
    );
    let source = archiveMatch || watchedOtherMatch;
    if (!source) return false;
    if (targetBucket === "archive" && archiveMatch) return false;
    if (targetBucket === "watchedOther" && watchedOtherMatch) return false;
    if (targetBucket === "archive" && !hasYear) return false;
    let refType;
    if (archiveMatch) {
      let films = window.state.years[film.year].films;
      films.splice(films.indexOf(source), 1);
    } else {
      let others = window.state.watchedOther;
      others.splice(others.indexOf(source), 1);
    }
    if (targetBucket === "archive") {
      window.state.years[film.year] ||= { periodType: "years", films: [] };
      window.state.years[film.year].films.push(source);
      refType = "archive";
    } else {
      window.state.watchedOther ||= [];
      window.state.watchedOther.push(source);
      refType = "watched";
    }
    (window.state.projects || []).forEach((project) => {
      (project.filmRefs || []).forEach((ref) => {
        if (
          ref.id === film.id &&
          (ref.type === "archive" || ref.type === "watched")
        )
          ref.type = refType;
      });
    });
    window.markAggregatesDirty?.("film bucket reclassified");
    return true;
  };

  function watchedDirectorIds(film) {
    return (
      window.splitRecipientNames?.(
        film.director || (film.directors || []).join(", "),
      ) || []
    ).map(
      (name) =>
        window.normalizePersonName?.(
          window.state.peopleAliases?.[window.normalizePersonName(name)] ||
            name,
        ) || window.normalizeTitle(name),
    );
  }

  /** Returns watched-film project refs for a person source. @param {string} personId Person id. @returns {ProjectFilmRef[]} References. */
  window.watchedFilmRefsForPerson = function (personId) {
    return (window.state.watchedOther || [])
      .filter((film) => watchedDirectorIds(film).includes(personId))
      .map((film) => window.projectFilmRef("watched", film.id));
  };

  /** Returns watched-film project refs for a franchise source. @param {string} franchiseId Franchise id. @returns {ProjectFilmRef[]} References. */
  window.watchedFilmRefsForFranchise = function (franchiseId) {
    return (window.state.watchedOther || [])
      .filter((film) =>
        (film.franchises || []).some((membership) =>
          [
            membership.id,
            membership.parentId,
            ...(membership.parentIds || []),
            ...(membership.parentChainIds || []),
          ].includes(franchiseId),
        ),
      )
      .map((film) => window.projectFilmRef("watched", film.id));
  };

  /** Returns watched-film project refs for a tag source. @param {string} tag Tag label. @returns {ProjectFilmRef[]} References. */
  window.watchedFilmRefsForTag = function (tag) {
    let normalized = window.normalizeTag?.(tag) || window.normalizeTitle(tag);
    return (window.state.watchedOther || [])
      .filter((film) =>
        (film.tags || []).some(
          (value) =>
            (window.normalizeTag?.(value) || window.normalizeTitle(value)) ===
            normalized,
        ),
      )
      .map((film) => window.projectFilmRef("watched", film.id));
  };

  /**
   * Plans a watchlist lifecycle transition without mutating state.
   * @param {string} watchlistId Watchlist record id.
   * @param {Object} [values] Optional viewing facts and deterministic clock.
   * @returns {Object} Previewable transition plan.
   */
  window.planMarkWatchlistFilmWatched = function (
    watchlistId,
    values = {},
  ) {
    let item = window.findWatchlistItemById?.(watchlistId);
    if (!item)
      return { ok: false, errors: ["Watchlist film not found."], warnings: [] };
    item.id ||= window.watchlistItemId(item);
    let errors = [];
    let warnings = [];
    let archiveFilm = window.findWatchlistArchiveFilm?.(item);
    let watched = watchedMatches(item);
    if (watched.length > 1)
      errors.push("More than one watched film matches this identity.");
    if (archiveFilm && watched.length)
      errors.push("This identity exists in both the archive and watched films.");
    if (
      (window.state.intakeWorkflows || []).some(
        (workflow) =>
          workflow.source === "watchlist-transition" &&
          workflow.sourceRecordId === item.id &&
          !workflow.completedAt,
      )
    )
      errors.push("An open intake already exists for this watchlist film.");
    let target = archiveFilm
      ? { type: "archive", id: archiveFilm.id, title: archiveFilm.title }
      : watched[0]
        ? { type: "watched", id: watched[0].id, title: watched[0].title }
        : { type: "watched", id: item.id, title: item.title };
    let facts = normalizeViewingFacts(values);
    if (values.rating && !window.parseFilmRating?.(values.rating)?.value)
      errors.push("Rating must be a valid half-to-five-star value.");
    let now = String(values.now || new Date().toISOString());
    let archiveFilms = archiveFilm
      ? archiveSourceSnapshots(archiveFilm.id, item, facts)
      : [];
    if (archiveFilm && !archiveFilms.length)
      errors.push("The matching archive film has no authoritative source record.");
    let watchedIndex = watched[0]
      ? (window.state.watchedOther || []).indexOf(watched[0])
      : -1;
    let watchedBefore = watched[0] ? clone(watched[0]) : null;
    let watchedAfter =
      target.type === "watched"
        ? mergeWatchlistMetadata(watchedBefore || {}, item, facts)
        : null;
    if (watchedAfter) watchedAfter.id = target.id;
    let projects = projectChanges(item.id, target, now);
    let sources = sourceChanges(item.id);
    let workflow = workflowForTransition(item, target, facts, now);
    let draftBefore = clone(window.state.draftMetadata || null);
    let draftAfter = Object.assign({}, draftBefore || {}, {
      baseRevision: workflow.baseRevision,
      dirty: true,
      changedAt: now,
      reason: "watchlist-transition",
    });
    let transferred = TRANSFER_FIELDS.filter(
      (field) => valuePresent(item[field]),
    );
    let enteredFacts = Object.keys(facts);
    let actions = [
      `Remove ${item.title} from the watchlist (interest ${item.tier || "unset"}, order ${item.order || "unset"})`,
      target.type === "archive"
        ? `Merge missing metadata into archive film ${target.title}`
        : watchedBefore
          ? `Merge into watched film ${target.title}`
          : `Create watched film ${target.title}`,
      `Preserve ${transferred.length} transferable metadata field${transferred.length === 1 ? "" : "s"}`,
      enteredFacts.length
        ? `Apply entered viewing facts: ${enteredFacts.join(", ")}`
        : "No viewing facts entered yet",
      `Rewrite ${projects.length} project reference${projects.length === 1 ? "" : "s"}`,
      "Create an open rating, ranking, and awards intake",
      "Mark the browser draft unpublished",
    ];
    if (!facts.rating)
      warnings.push("Rating remains the first required intake action.");
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      actions,
      watchlistId: item.id,
      watchlistIndex: (window.state.watchlist || []).indexOf(item),
      item: clone(item),
      target,
      facts,
      createdAt: now,
      archiveFilms,
      watchedIndex,
      watchedBefore,
      watchedAfter,
      projects,
      sources,
      workflow,
      draftBefore,
      draftAfter,
      watchlistBeforeSignature: signature(window.state.watchlist || []),
      sourceSignature: transitionStateSignature(item.id, target),
      applied: false,
    };
  };

  function transitionUndoPayload(plan, afterWorkflow, afterWatchlist) {
    return {
      version: 1,
      kind: "watchlist-transition",
      watchlist: {
        id: plan.watchlistId,
        index: plan.watchlistIndex,
        record: clone(plan.item),
        beforeSignature: plan.watchlistBeforeSignature,
        afterSignature: signature(afterWatchlist),
      },
      target: clone(plan.target),
      watched: {
        index: plan.watchedIndex,
        before: clone(plan.watchedBefore),
        after: clone(plan.watchedAfter),
      },
      archiveFilms: clone(plan.archiveFilms),
      projects: clone(plan.projects),
      sources: clone(plan.sources),
      workflow: { before: null, after: clone(afterWorkflow) },
      draftMetadata: {
        before: clone(plan.draftBefore),
        after: clone(plan.draftAfter),
      },
      actions: clone(plan.actions),
    };
  }

  /**
   * Applies a still-current transition plan as one in-memory mutation and one save.
   * @param {Object} plan Plan from `planMarkWatchlistFilmWatched`.
   * @param {Object} [options] Persistence controls.
   * @returns {Object} Applied plan or a rejected result.
   */
  window.applyMarkWatchlistFilmWatched = function (plan, options = {}) {
    if (!plan?.ok || plan.applied)
      return { ok: false, reason: plan?.applied ? "already-applied" : "invalid-plan" };
    if (
      transitionStateSignature(plan.watchlistId, plan.target) !==
      plan.sourceSignature
    )
      return { ok: false, reason: "stale", plan };
    let nextWatchlist = orderedWatchlistWithout(plan.watchlistId);
    let nextWatched = clone(window.state.watchedOther || []);
    if (plan.target.type === "watched") {
      if (plan.watchedBefore) nextWatched[plan.watchedIndex] = clone(plan.watchedAfter);
      else nextWatched.push(clone(plan.watchedAfter));
    }
    let nextYears = Object.assign({}, window.state.years || {});
    let periodCopies = new Map();
    plan.archiveFilms.forEach((snapshot) => {
      let period = periodCopies.get(snapshot.periodKey);
      if (!period) {
        period = clone(nextYears[snapshot.periodKey]);
        periodCopies.set(snapshot.periodKey, period);
      }
      period.films[snapshot.index] = clone(snapshot.after);
    });
    periodCopies.forEach((period, key) => {
      nextYears[key] = period;
    });
    let nextProjects = clone(window.state.projects || []);
    plan.projects.forEach((change) => {
      nextProjects[change.index] = clone(change.after);
    });
    let nextSources = clone(window.state.watchlistProjectSources || {});
    plan.sources.forEach((change) => {
      nextSources[change.key] = clone(change.after);
    });
    let nextWorkflows = clone(window.state.intakeWorkflows || []);
    nextWorkflows.push(clone(plan.workflow));
    let previous = {
      watchlist: window.state.watchlist,
      watchedOther: window.state.watchedOther,
      years: window.state.years,
      projects: window.state.projects,
      watchlistProjectSources: window.state.watchlistProjectSources,
      intakeWorkflows: window.state.intakeWorkflows,
      draftMetadata: window.state.draftMetadata,
      editLog: window.state.editLog,
    };
    try {
      window.state.watchlist = nextWatchlist;
      window.state.watchedOther = nextWatched;
      window.state.years = nextYears;
      window.state.projects = nextProjects;
      window.state.watchlistProjectSources = nextSources;
      window.state.intakeWorkflows = nextWorkflows;
      window.state.draftMetadata = clone(plan.draftAfter);
      window.markAggregatesDirty?.("watchlist film marked watched");
      window.ensureAggregatesFresh?.();
      let entry = window.recordEdit({
        type: "watchlist transition",
        summary: `${plan.item.title} marked watched`,
        sheetHint: "Watchlist",
        changes: [
          { field: "Lifecycle", before: "Watchlist", after: "Watched" },
          {
            field: "Identity",
            before: plan.watchlistId,
            after: `${plan.target.type}:${plan.target.id}`,
          },
          {
            field: "Projects",
            before: String(plan.projects.length),
            after: "References rewritten",
          },
          {
            field: "Watchlist interest",
            before: plan.item.tier || "Unranked",
            after: "Removed with transition history",
          },
          {
            field: "Watchlist order",
            before: String(plan.item.order || ""),
            after: "Removed with transition history",
          },
          { field: "Intake", before: "None", after: "Open" },
        ],
        target:
          plan.target.type === "archive"
            ? { type: "film", id: plan.target.id, label: plan.target.title }
            : { type: "other", id: plan.target.id, label: plan.target.title },
        context: {
          watchlistId: plan.watchlistId,
          watchedType: plan.target.type,
          watchedId: plan.target.id,
          workflowId: plan.workflow.id,
        },
      });
      let workflow = window.state.intakeWorkflows.find(
        (candidate) => candidate.id === plan.workflow.id,
      );
      workflow.auditEntryId = entry.id;
      plan.workflow = clone(workflow);
      plan.draftAfter = clone(window.state.draftMetadata);
      entry.undo = window.normalizeEditLogUndo(
        transitionUndoPayload(plan, workflow, nextWatchlist),
      );
      if (!entry.undo) throw new Error("Transition undo payload exceeded its safety bounds");
      plan.auditEntry = entry;
      plan.applied = true;
      if (options.save !== false)
        plan.persisted = window.save({ immediate: true, rebuild: false });
      return plan;
    } catch (error) {
      Object.assign(window.state, previous);
      window.markAggregatesDirty?.("watchlist transition rolled back");
      window.ensureAggregatesFresh?.();
      throw error;
    }
  };

  /**
   * Validates and bounds a declarative watchlist-transition undo payload.
   * @param {Object} payload Candidate payload.
   * @returns {Object|null} Normalized payload or null.
   */
  window.normalizeWatchlistTransitionUndo = function (payload) {
    if (
      payload?.kind !== "watchlist-transition" ||
      Number(payload.version) !== 1 ||
      !plainJson(payload) ||
      !payload.watchlist?.id ||
      !payload.watchlist?.record ||
      !payload.target?.id ||
      !["archive", "watched"].includes(payload.target.type) ||
      !payload.workflow?.after?.id
    )
      return null;
    let normalized = clone(payload);
    return JSON.stringify(normalized).length <= TRANSITION_UNDO_MAX_BYTES
      ? normalized
      : null;
  };

  function currentArchiveSnapshot(snapshot) {
    return window.state.years?.[snapshot.periodKey]?.films?.[snapshot.index];
  }

  /**
   * Plans a stale-safe structural reversal for a transition payload.
   * @param {EditLogEntry} entry Transition audit entry.
   * @returns {Object} Undo plan.
   */
  window.planWatchlistTransitionUndo = function (entry) {
    let undo = entry.undo;
    let stale = [];
    if (signature(window.state.watchlist || []) !== undo.watchlist.afterSignature)
      stale.push("Watchlist order or membership changed");
    if (undo.target.type === "watched") {
      let current = window.findWatchedFilmById(undo.target.id);
      if (!recordsEqual(current, undo.watched.after))
        stale.push("Watched film changed");
    }
    undo.archiveFilms.forEach((snapshot) => {
      if (!recordsEqual(currentArchiveSnapshot(snapshot), snapshot.after))
        stale.push(`${snapshot.periodKey} archive source changed`);
    });
    undo.projects.forEach((change) => {
      let current = (window.state.projects || [])[change.index];
      if (!recordsEqual(current, change.after))
        stale.push(`Project ${change.id} changed`);
    });
    undo.sources.forEach((change) => {
      if (
        !recordsEqual(
          window.state.watchlistProjectSources?.[change.key],
          change.after,
        )
      )
        stale.push(`Watchlist project source ${change.key} changed`);
    });
    let workflow = (window.state.intakeWorkflows || []).find(
      (candidate) => candidate.id === undo.workflow.after.id,
    );
    if (!recordsEqual(workflow, undo.workflow.after))
      stale.push("Watched-film intake changed");
    if (!recordsEqual(window.state.draftMetadata || null, undo.draftMetadata.after))
      stale.push("Draft metadata changed");
    return {
      ok: stale.length === 0,
      reason: stale.length ? "stale" : "",
      entry,
      actions: [
        {
          key: "watchlist",
          label: undo.watchlist.record.title,
          current: "Watched",
          restore: "Watchlist",
          stale: stale.length > 0,
        },
        ...stale.map((message, index) => ({
          key: `stale-${index}`,
          label: message,
          current: "Changed after transition",
          restore: "Recorded previous state",
          stale: true,
        })),
      ],
    };
  };

  function restoreWatchlist(items, undo) {
    let next = clone(items || []);
    next.splice(undo.watchlist.index, 0, clone(undo.watchlist.record));
    next.sort(
      (left, right) =>
        Number(left.order || 999999) - Number(right.order || 999999),
    );
    next.forEach((item, index) => {
      item.order = index + 1;
    });
    return next;
  }

  /**
   * Applies a previously validated watchlist-transition structural undo.
   * @param {Object} payload Normalized transition undo payload.
   * @returns {boolean} Whether restoration succeeded.
   */
  window.applyWatchlistTransitionUndo = function (payload) {
    let fakeEntry = { undo: payload };
    if (!window.planWatchlistTransitionUndo(fakeEntry).ok) return false;
    let nextWatchlist = restoreWatchlist(window.state.watchlist, payload);
    if (signature(nextWatchlist) !== payload.watchlist.beforeSignature)
      return false;
    let nextWatched = clone(window.state.watchedOther || []);
    if (payload.target.type === "watched") {
      let index = nextWatched.findIndex((film) => film.id === payload.target.id);
      if (index < 0) return false;
      if (payload.watched.before) nextWatched[index] = clone(payload.watched.before);
      else nextWatched.splice(index, 1);
    }
    let nextYears = Object.assign({}, window.state.years || {});
    let periodCopies = new Map();
    payload.archiveFilms.forEach((snapshot) => {
      let period = periodCopies.get(snapshot.periodKey);
      if (!period) {
        period = clone(nextYears[snapshot.periodKey]);
        periodCopies.set(snapshot.periodKey, period);
      }
      period.films[snapshot.index] = clone(snapshot.before);
    });
    periodCopies.forEach((period, key) => {
      nextYears[key] = period;
    });
    let nextProjects = clone(window.state.projects || []);
    payload.projects.forEach((change) => {
      nextProjects[change.index] = clone(change.before);
    });
    let nextSources = clone(window.state.watchlistProjectSources || {});
    payload.sources.forEach((change) => {
      nextSources[change.key] = clone(change.before);
    });
    let nextWorkflows = (window.state.intakeWorkflows || [])
      .filter((workflow) => workflow.id !== payload.workflow.after.id)
      .map(clone);
    window.state.watchlist = nextWatchlist;
    window.state.watchedOther = nextWatched;
    window.state.years = nextYears;
    window.state.projects = nextProjects;
    window.state.watchlistProjectSources = nextSources;
    window.state.intakeWorkflows = nextWorkflows;
    window.state.draftMetadata = clone(payload.draftMetadata.before);
    window.markAggregatesDirty?.("watchlist transition undo applied");
    window.ensureAggregatesFresh?.();
    return true;
  };
})();
