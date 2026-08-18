/** @file Owns persisted watched-film intake creation, guided decisions, completion, and reopening. */

(function () {
  const RANKING_LEVELS = ["year", "decade", "century", "allTime"];
  const AWARD_LEVELS = ["year", "decade", "century", "allTime"];
  const AWARD_PERIOD_TYPES = {
    year: "years",
    decade: "decades",
    century: "centuries",
    allTime: "allTime",
  };

  function clone(value) {
    return window.watchedFilmClone(value);
  }

  function now(options = {}) {
    return String(options.now || new Date().toISOString());
  }

  function baseRevision() {
    return window.watchedFilmBaseRevision();
  }

  function identity(film) {
    return (
      window.filmIdentityKey?.(film, { includePeriodKey: true }) ||
      `${String(film?.year || "")}\n${window.normalizeTitle(film?.title || "")}`
    );
  }

  function ratingKey(film) {
    let parsed = window.parseFilmRating?.(film) || { value: 0, modifier: "" };
    return parsed.value ? `${parsed.value}|${parsed.modifier || ""}` : "";
  }

  function workflowIndex(id) {
    return (window.state.intakeWorkflows || []).findIndex(
      (workflow) => workflow.id === String(id || ""),
    );
  }

  /** Finds a persisted watched-film intake. @param {string} id Workflow id. @returns {WatchedFilmIntake|null} Workflow or null. */
  window.findWatchedIntakeWorkflow = function (id) {
    return (window.state.intakeWorkflows || [])[workflowIndex(id)] || null;
  };

  /** Resolves the authoritative film record for a workflow. @param {WatchedFilmIntake|string} value Workflow or id. @returns {FilmRecord|WatchedOtherEntry|null} Film or null. */
  window.watchedIntakeFilm = function (value) {
    let workflow =
      typeof value === "string" ? window.findWatchedIntakeWorkflow(value) : value;
    if (!workflow) return null;
    return (
      window.findFilmById?.(workflow.filmId) ||
      window.findWatchedFilmById?.(workflow.filmId) ||
      null
    );
  };

  /** Creates the canonical version-1 workflow used by every watched entry path. @param {Object} values Identity, source, and optional rating facts. @returns {WatchedFilmIntake} Workflow. */
  window.createWatchedIntakeWorkflow = function (values = {}) {
    let createdAt = now(values);
    let ratingComplete = Boolean(values.ratingComplete);
    return {
      schemaVersion: 1,
      id:
        values.id ||
        `intake-${values.source || "fresh"}-${values.filmId}-${createdAt}`,
      filmId: String(values.filmId || ""),
      source: values.source === "watchlist-transition" ? values.source : "fresh",
      sourceRecordId: String(values.sourceRecordId || ""),
      createdAt,
      baseRevision: String(values.baseRevision || baseRevision()),
      steps: {
        rating: {
          status: ratingComplete ? "complete" : "pending",
          ...(ratingComplete
            ? { completedAt: createdAt, resultRef: `film:${values.filmId}` }
            : {}),
        },
        ranking: { status: "pending", decisionRef: "" },
        awards: Object.fromEntries(
          AWARD_LEVELS.map((level) => [level, { status: "pending" }]),
        ),
      },
    };
  };

  /** Returns incomplete workflows newest first. @returns {WatchedFilmIntake[]} Open workflows. */
  window.openWatchedIntakeWorkflows = function () {
    return [...(window.state.intakeWorkflows || [])]
      .filter((workflow) => !workflow.completedAt)
      .sort((left, right) =>
        String(right.reopenedAt || right.createdAt || "").localeCompare(
          String(left.reopenedAt || left.createdAt || ""),
        ),
      );
  };

  function exactMatches(values) {
    let tmdbId = String(values.tmdbId || "").trim();
    let key = identity(values);
    let archive = Object.values(window.state.filmsById || {}).filter(
      (film, index, films) =>
        films.findIndex((entry) => entry.id === film.id) === index &&
        ((tmdbId && String(film.tmdbId || "") === tmdbId) || identity(film) === key),
    );
    let watched = (window.state.watchedOther || []).filter(
      (film) =>
        (tmdbId && String(film.tmdbId || "") === tmdbId) || identity(film) === key,
    );
    return { archive, watched };
  }

  function freshSourceSignature(record) {
    let matches = exactMatches(record);
    return JSON.stringify({
      archive: matches.archive.map((film) => clone(film)),
      watched: matches.watched.map((film) => clone(film)),
      workflows: (window.state.intakeWorkflows || []).filter(
        (workflow) => workflow.filmId === record.id || !workflow.completedAt,
      ),
    });
  }

  /** Plans fresh watched-film creation or an exact-identity merge without mutation. @param {Object} values Film and optional viewing facts. @returns {Object} Plan. */
  window.planFreshWatchedFilm = function (values = {}) {
    let title = String(values.title || "").trim();
    let year = String(values.year || "").trim();
    let parsed = window.parseFilmRating?.(values.rating || "");
    let errors = [];
    if (!title) errors.push("Title is required.");
    if (!/^\d{4}$/.test(year)) errors.push("A four-digit release year is required.");
    if (values.rating && !parsed?.value) errors.push("Rating is invalid.");
    let record = {
      id: String(values.id || `${year}::${window.normalizeTitle(title)}`),
      title,
      normalizedTitle: window.normalizeTitle(title),
      year,
      type: String(values.type || "Film"),
      ...(String(values.tmdbId || "").trim()
        ? { tmdbId: String(values.tmdbId).trim() }
        : {}),
      ...(String(values.director || "").trim()
        ? { director: String(values.director).trim() }
        : {}),
      ...(values.rating
        ? {
            rating: String(values.rating).trim(),
            ratingValue: parsed.value,
            ...(parsed.modifier ? { ratingModifier: parsed.modifier } : {}),
          }
        : {}),
      ...(String(values.dateWatched || "").trim()
        ? { dateWatched: String(values.dateWatched).trim() }
        : {}),
      ...(String(values.platform || "").trim()
        ? { platform: String(values.platform).trim() }
        : {}),
      ...(Number(values.views) > 0 ? { views: Number(values.views) } : {}),
    };
    let matches = title && /^\d{4}$/.test(year) ? exactMatches(record) : { archive: [], watched: [] };
    if (matches.archive.length + matches.watched.length > 1)
      errors.push("More than one watched or archive identity matches this film.");
    let target = matches.archive[0]
      ? { type: "archive", id: matches.archive[0].id, before: clone(matches.archive[0]) }
      : matches.watched[0]
        ? { type: "watched", id: matches.watched[0].id, before: clone(matches.watched[0]) }
        : { type: "watched", id: record.id, before: null };
    return {
      ok: errors.length === 0,
      errors,
      record,
      target,
      createdAt: now(values),
      sourceSignature: freshSourceSignature(record),
      actions: [
        target.before ? `Merge into ${target.before.title}` : `Create watched film ${title}`,
        "Create the shared rating, ranking, and awards intake",
        "Mark the browser draft unpublished",
      ],
    };
  };

  function updateArchiveCopies(filmId, updater) {
    Object.values(window.state.years || {}).forEach((period) => {
      (period.films || []).forEach((film) => {
        if (film.id === filmId || identity(film) === identity(window.findFilmById?.(filmId)))
          updater(film);
      });
    });
  }

  function markDraft(reason, changedAt) {
    window.state.draftMetadata = Object.assign({}, window.state.draftMetadata || {}, {
      baseRevision: baseRevision(),
      dirty: true,
      changedAt,
      reason,
    });
  }

  /** Applies a valid fresh-watched plan and creates the shared workflow atomically. @param {Object} plan Fresh plan. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.applyFreshWatchedFilm = function (plan, options = {}) {
    if (!plan?.ok || plan.applied) return { ok: false, reason: "invalid-plan" };
    if (freshSourceSignature(plan.record) !== plan.sourceSignature)
      return { ok: false, reason: "stale" };
    let existingOpen = (window.state.intakeWorkflows || []).some(
      (workflow) => workflow.filmId === plan.target.id && !workflow.completedAt,
    );
    if (existingOpen) return { ok: false, reason: "open-intake" };
    let target;
    if (plan.target.type === "archive") {
      updateArchiveCopies(plan.target.id, (film) => {
        Object.entries(plan.record).forEach(([key, value]) => {
          if (film[key] == null || film[key] === "") film[key] = clone(value);
        });
      });
      target = window.findFilmById(plan.target.id);
    } else if (plan.target.before) {
      target = window.findWatchedFilmById(plan.target.id);
      Object.entries(plan.record).forEach(([key, value]) => {
        if (target[key] == null || target[key] === "") target[key] = clone(value);
      });
    } else {
      target = clone(plan.record);
      window.state.watchedOther.push(target);
    }
    let workflow = window.createWatchedIntakeWorkflow({
      source: "fresh",
      filmId: plan.target.id,
      ratingComplete: Boolean(target.rating),
      now: plan.createdAt,
    });
    window.state.intakeWorkflows.push(workflow);
    markDraft("watched-intake-created", plan.createdAt);
    window.markAggregatesDirty?.("fresh watched film created");
    window.ensureAggregatesFresh?.();
    let audit = window.recordEdit({
      type: "watched intake created",
      summary: `${target.title} watched intake started`,
      target: { type: "other", id: target.id, label: target.title },
      changes: [
        { field: "Watched identity", before: plan.target.before ? "Existing" : "None", after: plan.target.type },
        { field: "Intake", before: "None", after: "Open" },
      ],
      context: { filmId: target.id, workflowId: workflow.id, source: "fresh" },
    });
    workflow.auditEntryId = audit.id;
    plan.applied = true;
    plan.workflow = workflow;
    plan.film = target;
    if (options.save !== false) plan.persisted = window.save({ immediate: true, rebuild: false });
    return plan;
  };

  /** Updates rating and viewing facts, completing rating only after a valid rating. @param {string} workflowId Workflow id. @param {Object} values Facts. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.completeWatchedIntakeRating = function (workflowId, values = {}, options = {}) {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    let film = window.watchedIntakeFilm(workflow);
    if (!workflow || !film || workflow.completedAt) return { ok: false, reason: "missing" };
    let parsed = window.parseFilmRating?.(values.rating || film.rating || "");
    if (!parsed?.value) return { ok: false, reason: "rating-required" };
    let facts = {
      rating: String(values.rating || film.rating).trim(),
      ratingValue: parsed.value,
      ratingModifier: parsed.modifier || "",
      ...(String(values.dateWatched || film.dateWatched || "").trim()
        ? { dateWatched: String(values.dateWatched || film.dateWatched).trim() }
        : {}),
      ...(String(values.platform || film.platform || "").trim()
        ? { platform: String(values.platform || film.platform).trim() }
        : {}),
      ...(Number(values.views || film.views) > 0
        ? { views: Number(values.views || film.views) }
        : {}),
    };
    if (window.findWatchedFilmById(workflow.filmId)) Object.assign(film, facts);
    else updateArchiveCopies(workflow.filmId, (copy) => Object.assign(copy, facts));
    let completedAt = now(values);
    workflow.steps.rating = {
      status: "complete",
      completedAt,
      resultRef: `film:${workflow.filmId}`,
    };
    markDraft("watched-intake-rating", completedAt);
    window.markAggregatesDirty?.("watched intake rating completed");
    window.ensureAggregatesFresh?.();
    let audit = window.recordEdit({
      type: "watched intake rating",
      summary: `${film.title} rating confirmed`,
      target: { type: "other", id: film.id, label: film.title },
      changes: [{ field: "Rating", before: "Pending", after: facts.rating }],
      context: { filmId: workflow.filmId, workflowId: workflow.id },
    });
    if (options.save !== false) window.save({ immediate: true, rebuild: false });
    return { ok: true, workflow, film, auditEntry: audit };
  };

  function rankedCandidates() {
    let archive = [...(window.state.years?.alltime?.films || [])].filter(
      (film) => film?.title && !film.suppressAllTimeRank,
    );
    let seen = new Set();
    return [...archive, ...(window.state.watchedOther || []).filter((film) => film.allTimeRank)]
      .filter((film) => {
        let key = identity(film);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) =>
        window.compareByAllTimeRank(
          left,
          right,
          (item) => ({ allTimeRank: item.allTimeRank || item.rank, title: item.title }),
          { yearFallback: false },
        ),
      );
  }

  function rankingDecisions(step) {
    return String(step?.decisionRef || "")
      .split("|")
      .filter(Boolean)
      .map((value) => value.split(":"));
  }

  /** Returns the next ranking cohort and exact-rating comparison candidates. @param {string} workflowId Workflow id. @returns {Object} Ranking guide. */
  window.watchedIntakeRankingGuide = function (workflowId) {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    let film = window.watchedIntakeFilm(workflow);
    if (!workflow || !film) return { ok: false, reason: "missing" };
    if (workflow.steps.rating.status !== "complete")
      return { ok: false, reason: "rating-required", workflow, film };
    let decisions = rankingDecisions(workflow.steps.ranking);
    let level = RANKING_LEVELS[decisions.length] || "allTime";
    let filmYear = Number(window.filmConcreteYear?.(film.year) || film.year);
    let candidates = rankedCandidates().filter((candidate) => {
      if (identity(candidate) === identity(film) || ratingKey(candidate) !== ratingKey(film)) return false;
      let year = Number(window.filmConcreteYear?.(candidate.year) || candidate.year);
      if (level === "year") return year === filmYear;
      if (level === "decade") return window.getDecadeKey(year) === window.getDecadeKey(filmYear);
      if (level === "century") return window.getCenturyKey(year) === window.getCenturyKey(filmYear);
      return true;
    });
    return { ok: true, workflow, film, level, decisions, candidates };
  };

  function visualRankingScope(guide) {
    let year = Number(window.filmConcreteYear?.(guide.film.year) || guide.film.year);
    if (guide.level === "year")
      return {
        key: String(year),
        matches: (candidate) =>
          Number(window.filmConcreteYear?.(candidate.year) || candidate.year) ===
          year,
      };
    if (guide.level === "allTime")
      return {
        key: "alltime",
        matches: () => true,
      };
    let periodKey =
      guide.level === "decade"
        ? window.getDecadeKey(year)
        : window.getCenturyKey(year);
    return {
      key: periodKey,
      matches: (candidate) =>
        (guide.level === "decade" ? window.getDecadeKey : window.getCenturyKey)(
          Number(window.filmConcreteYear?.(candidate.year) || candidate.year),
        ) === periodKey,
    };
  }

  function broaderRankingConstraint(guide) {
    let sourceLevel =
      guide.level === "decade"
        ? "year"
        : guide.level === "century"
          ? "decade"
          : "century";
    let decision = guide.decisions.find((parts) => parts[0] === sourceLevel);
    if (decision?.[1] === "not-applicable")
      return {
        ok: true,
        status: "unconstrained",
        sourceLevel,
        minimumInsertionIndex: 0,
        maximumInsertionIndex: guide.candidates.length,
      };
    if (!decision)
      return {
        ok: false,
        status: "stale-anchor",
        sourceLevel,
        anchorId: "",
      };
    let position = decision[1];
    let anchorId = decision.slice(2).join(":");
    let anchorIndex = guide.candidates.findIndex(
      (candidate) => candidate.id === anchorId,
    );
    if (!anchorId || anchorIndex < 0 || !["before", "after"].includes(position))
      return {
        ok: false,
        status: "stale-anchor",
        sourceLevel,
        anchorId,
      };
    return {
      ok: true,
      status: "constrained",
      sourceLevel,
      position,
      anchor: guide.candidates[anchorIndex],
      anchorIndex,
      minimumInsertionIndex: position === "after" ? anchorIndex + 1 : 0,
      maximumInsertionIndex:
        position === "before" ? anchorIndex : guide.candidates.length,
    };
  }

  /** Builds the visual year, decade, century, or all-time placement board, constraint, and neighboring-rating guideposts. @param {string} workflowId Workflow id. @returns {Object} Ranking board or an invalid-level result. */
  window.watchedIntakeRankingBoard = function (workflowId) {
    let guide = window.watchedIntakeRankingGuide(workflowId);
    if (
      !guide.ok ||
      !["year", "decade", "century", "allTime"].includes(guide.level)
    )
      return Object.assign({}, guide, {
        ok: false,
        reason: "not-visual-ranking-step",
      });
    let scope = visualRankingScope(guide);
    let targetRating = window.filmRatingSortValue(guide.film);
    let neighboring = rankedCandidates().filter((candidate) => {
      if (identity(candidate) === identity(guide.film)) return false;
      return (
        scope.matches(candidate) &&
        ratingKey(candidate) !== ratingKey(guide.film)
      );
    });
    let higherRatings = neighboring
      .map((film) => window.filmRatingSortValue(film))
      .filter((rating) => rating > targetRating);
    let lowerRatings = neighboring
      .map((film) => window.filmRatingSortValue(film))
      .filter((rating) => rating < targetRating);
    let higherRating = higherRatings.length ? Math.min(...higherRatings) : 0;
    let lowerRating = lowerRatings.length ? Math.max(...lowerRatings) : 0;
    let ratingEdge = (rating, edge) => {
      let matches = neighboring.filter(
        (film) => window.filmRatingSortValue(film) === rating,
      );
      return edge === "last"
        ? matches[matches.length - 1] || null
        : matches[0] || null;
    };
    let constraint =
      guide.level === "year"
        ? {
            ok: true,
            status: "unconstrained",
            minimumInsertionIndex: 0,
            maximumInsertionIndex: guide.candidates.length,
          }
        : broaderRankingConstraint(guide);
    return Object.assign({}, guide, {
      ok: constraint.ok,
      reason: constraint.ok ? "" : "stale-anchor",
      scopeKey: scope.key,
      constraint,
      bookends: {
        higher: ratingEdge(higherRating, "last"),
        lower: ratingEdge(lowerRating, "first"),
      },
    });
  };

  function addArchiveToAllTimeIfNeeded(film) {
    window.state.years.alltime ||= { periodType: "allTime", films: [] };
    let exists = (window.state.years.alltime.films || []).some(
      (candidate) => identity(candidate) === identity(film),
    );
    if (!exists) {
      let copy = clone(film);
      copy.awards = (copy.awards || []).filter((award) => String(award.year) === "alltime");
      window.state.years.alltime.films.push(copy);
    }
  }

  function applyGlobalPlacement(film, target, position) {
    if (!window.findWatchedFilmById?.(film.id)) addArchiveToAllTimeIfNeeded(film);
    let all = rankedCandidates().filter((candidate) => identity(candidate) !== identity(film));
    let targetIndex = all.findIndex((candidate) => identity(candidate) === identity(target));
    if (targetIndex < 0) return false;
    let placement = Number(target.allTimeRank || target.rank || targetIndex + 1);
    film.allTimeRank = placement + (position === "after" ? 0.25 : -0.25);
    if (!window.findWatchedFilmById?.(film.id))
      updateArchiveCopies(film.id, (copy) => {
        copy.allTimeRank = film.allTimeRank;
      });
    window.recomputeAllTimeRankProjections?.();
    return true;
  }

  /** Records one progressive ranking comparison and applies the final guarded global insertion. @param {string} workflowId Workflow id. @param {Object} decision Cohort decision. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.recordWatchedIntakeRankingDecision = function (
    workflowId,
    decision = {},
    options = {},
  ) {
    let guide = window.watchedIntakeRankingGuide(workflowId);
    if (!guide.ok || guide.workflow.steps.ranking.status === "complete") return guide;
    let position = decision.position === "after" ? "after" : "before";
    let target = guide.candidates.find((candidate) => candidate.id === decision.targetFilmId);
    if (!target && guide.candidates.length) return { ok: false, reason: "invalid-target", guide };
    if (["decade", "century", "allTime"].includes(guide.level)) {
      let board = window.watchedIntakeRankingBoard(workflowId);
      if (!board.ok) return board;
      let targetIndex = target
        ? guide.candidates.findIndex((candidate) => candidate.id === target.id)
        : -1;
      let insertionIndex = target
        ? targetIndex + (position === "after" ? 1 : 0)
        : 0;
      if (
        insertionIndex < board.constraint.minimumInsertionIndex ||
        insertionIndex > board.constraint.maximumInsertionIndex
      )
        return { ok: false, reason: "constraint-violation", board };
    }
    let reference = target
      ? `${guide.level}:${position}:${target.id}`
      : `${guide.level}:not-applicable:`;
    let decisions = [...guide.decisions.map((parts) => parts.join(":")), reference];
    let completedAt = now(decision);
    if (guide.level === "allTime") {
      if (!target) {
        guide.workflow.steps.ranking = {
          status: "not-applicable",
          completedAt,
          decisionRef: decisions.join("|"),
          resultRef: "no-exact-rating-comparators",
        };
      } else {
        if (!applyGlobalPlacement(guide.film, target, position))
          return { ok: false, reason: "stale" };
        guide.workflow.steps.ranking = {
          status: "complete",
          completedAt,
          decisionRef: decisions.join("|"),
          resultRef: `all-time-rank:${guide.film.allTimeRank}`,
        };
      }
    } else {
      guide.workflow.steps.ranking.decisionRef = decisions.join("|");
    }
    markDraft("watched-intake-ranking", completedAt);
    window.markAggregatesDirty?.("watched intake ranking advanced");
    window.ensureAggregatesFresh?.();
    let audit = window.recordEdit({
      type: "watched intake ranking",
      summary: `${guide.film.title} ${guide.level} ranking reviewed`,
      target: { type: "other", id: guide.film.id, label: guide.film.title },
      changes: [{ field: guide.level, before: "Pending", after: target ? `${position} ${target.title}` : "Not applicable" }],
      context: { filmId: guide.workflow.filmId, workflowId, rankingLevel: guide.level },
    });
    if (options.save !== false) window.save({ immediate: true, rebuild: false });
    return { ok: true, workflow: guide.workflow, film: guide.film, auditEntry: audit };
  };

  function awardPeriodKey(film, level) {
    let year = window.filmConcreteYear?.(film.year) || String(film.year || "");
    if (level === "year") return year;
    if (level === "decade") return window.getDecadeKey(year);
    if (level === "century") return window.getCenturyKey(year);
    return "alltime";
  }

  const ANNUAL_DECISIONS_PREFIX = "annual-categories:";

  function parseAnnualAwardDecisions(step) {
    let reference = String(step?.decisionRef || "");
    if (!reference.startsWith(ANNUAL_DECISIONS_PREFIX)) return [];
    try {
      let decisions = JSON.parse(
        decodeURIComponent(reference.slice(ANNUAL_DECISIONS_PREFIX.length)),
      );
      return Array.isArray(decisions)
        ? decisions.filter(
            (decision) =>
              decision &&
              typeof decision.category === "string" &&
              ["nominate", "skip"].includes(decision.action),
          )
        : [];
    } catch (_error) {
      return [];
    }
  }

  function annualAwardDecisionRef(decisions) {
    return `${ANNUAL_DECISIONS_PREFIX}${encodeURIComponent(JSON.stringify(decisions))}`;
  }

  function awardsForFilmAtLevel(film, periodKey, periodType) {
    return (film.awards || []).filter(
      (award) =>
        String(award.year || "") === String(periodKey) &&
        window.getAwardPeriodType(award) === periodType,
    );
  }

  function categoriesPlacedAtLevel(film, level) {
    if (!level) return null;
    let periodType = AWARD_PERIOD_TYPES[level];
    let periodKey = awardPeriodKey(film, level);
    return new Set(
      awardsForFilmAtLevel(film, periodKey, periodType).map(
        (award) => award.category,
      ),
    );
  }

  // Year eligibility is any canonical category the film's own metadata
  // supports; decade/century/all-time narrow that down to categories the
  // film already placed in at the immediately preceding level, since those
  // brackets exist to promote standout year/decade/century nominees, not to
  // re-review every film from scratch.
  function levelAwardEligibility(film, periodKey, periodType, categoryFilter) {
    let normalized = clone(film);
    window.normalizeFilmMetadata?.(normalized);
    let directorRecipient = (normalized.directors || []).join(", ");
    let categories = categoryFilter
      ? window
          .getOrderedCategories()
          .filter((category) => categoryFilter.has(category))
      : window.getOrderedCategories();
    return categories.reduce((eligible, category) => {
      let award = window.setAwardRecipients(
        {
          category,
          placement: 1,
          year: periodKey,
          periodType,
        },
        category === "Best Director" ? directorRecipient : "",
      );
      let validation = window.validateAward(normalized, award, {
        periodType,
        filmMetadataNormalized: true,
      });
      if (validation.valid)
        eligible.push({ category, warnings: validation.warnings });
      return eligible;
    }, []);
  }

  /** Builds the resumable category-by-category awards queue for one level. @param {string} workflowId Workflow id. @param {string} [level] Award level ("year", "decade", "century", "allTime"). @returns {Object} Award review guide. */
  window.watchedIntakeAnnualAwardsGuide = function (workflowId, level = "year") {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    let film = window.watchedIntakeFilm(workflow);
    if (!workflow || !film) return { ok: false, reason: "missing" };
    if (workflow.steps.ranking.status === "pending")
      return { ok: false, reason: "ranking-required", workflow, film };
    if (workflow.steps.awards[level]?.status !== "pending")
      return { ok: false, reason: "not-annual-step", workflow, film };
    let levelIndex = AWARD_LEVELS.indexOf(level);
    let priorLevel = levelIndex > 0 ? AWARD_LEVELS[levelIndex - 1] : "";
    if (
      priorLevel &&
      AWARD_LEVELS.slice(0, levelIndex).some(
        (name) => workflow.steps.awards[name].status === "pending",
      )
    )
      return { ok: false, reason: "previous-level-required", workflow, film };
    let periodType = AWARD_PERIOD_TYPES[level];
    let periodKey = awardPeriodKey(film, level);
    if (level === "year" && !/^\d{4}$/.test(periodKey))
      return { ok: false, reason: "invalid-year", workflow, film };
    let eligible = levelAwardEligibility(
      film,
      periodKey,
      periodType,
      priorLevel ? categoriesPlacedAtLevel(film, priorLevel) : null,
    );
    let decisions = parseAnnualAwardDecisions(workflow.steps.awards[level]);
    // Acting categories and Best Song allow more than one nominee from the
    // same film, so a "nominate" decision there doesn't close the category
    // out the way it does everywhere else - only an explicit "skip" (issue
    // #192) does, letting the queue keep offering it back until the reviewer
    // is done adding nominees.
    let decidedCategories = new Set(
      decisions
        .filter(
          (decision) =>
            decision.action === "skip" ||
            !window.isMultiNomineeCategory?.(decision.category),
        )
        .map((decision) => decision.category),
    );
    awardsForFilmAtLevel(film, periodKey, periodType).forEach((award) => {
      if (!window.isMultiNomineeCategory?.(award.category))
        decidedCategories.add(award.category);
    });
    let current = eligible.find(
      (entry) => !decidedCategories.has(entry.category),
    );
    let entries = current
      ? (window.state.years?.[periodKey]?.films || [])
          .flatMap((candidate) =>
            (candidate.awards || [])
              .filter(
                (award) =>
                  award.category === current.category &&
                  String(award.year || "") === String(periodKey) &&
                  window.getAwardPeriodType(award) === periodType,
              )
              .map((award) => ({ film: candidate, award })),
          )
          .sort(
            (left, right) =>
              Number(left.award.placement) - Number(right.award.placement) ||
              left.film.title.localeCompare(right.film.title),
          )
      : [];
    let priorPlacement = null;
    let sourceAward = null;
    if (priorLevel && current) {
      let priorPeriodType = AWARD_PERIOD_TYPES[priorLevel];
      let priorPeriodKey = awardPeriodKey(film, priorLevel);
      let priorAward = awardsForFilmAtLevel(
        film,
        priorPeriodKey,
        priorPeriodType,
      ).find((award) => award.category === current.category);
      if (priorAward) {
        sourceAward = priorAward;
        priorPlacement = {
          level: priorLevel,
          periodKey: priorPeriodKey,
          placement: Number(priorAward.placement),
          capacity:
            current.category === "Best Picture"
              ? window.bracketCapacities(priorPeriodType).picture
              : window.bracketCapacities(priorPeriodType).category,
        };
      }
    }
    return {
      ok: true,
      workflow,
      film,
      level,
      priorLevel,
      year: periodKey,
      eligible,
      decisions,
      reviewed: eligible.filter((entry) =>
        decidedCategories.has(entry.category),
      ).length,
      current: current || null,
      category: current?.category || "",
      multiNominee: current
        ? Boolean(window.isMultiNomineeCategory?.(current.category))
        : false,
      warnings: current?.warnings || [],
      priorPlacement,
      sourceAward,
      entries,
      capacity: current
        ? current.category === "Best Picture"
          ? window.bracketCapacities(periodType).picture
          : window.bracketCapacities(periodType).category
        : 0,
    };
  };

  /** Plans an intake nomination through the shared insertion planner. @param {string} workflowId Workflow id. @param {Object} values Nomination fields. @param {string} [level] Award level. @returns {NominationPlacementPlan|Object} Placement plan or invalid guide. */
  window.planWatchedIntakeAnnualNomination = function (
    workflowId,
    values = {},
    level = "year",
  ) {
    let guide = window.watchedIntakeAnnualAwardsGuide(workflowId, level);
    if (!guide.ok || !guide.current) return guide;
    if (values.category && values.category !== guide.category)
      return { ok: false, reason: "invalid-category", guide };
    let plan = window.planNominationInsertion({
      periodType: AWARD_PERIOD_TYPES[level],
      periodKey: guide.year,
      category: guide.category,
      filmId: guide.film.id,
      placement: values.placement,
      recipient: values.recipient,
      detail: values.detail,
      tie: false,
    });
    plan.context = Object.assign({}, plan.context, {
      workflowId,
      intakeAwardLevel: level,
    });
    return plan;
  };

  /** Persists one category decision and advances or completes the queue. @param {string} workflowId Workflow id. @param {{category: string, action: 'nominate'|'skip', now?: string}} decision Category decision. @param {Object} [options] Save controls, plus level ("year" default). @returns {Object} Result. */
  window.recordWatchedIntakeAnnualAwardDecision = function (
    workflowId,
    decision = {},
    options = {},
  ) {
    let level = options.level || "year";
    let periodType = AWARD_PERIOD_TYPES[level];
    let guide = window.watchedIntakeAnnualAwardsGuide(workflowId, level);
    let category = String(decision.category || "");
    let action = decision.action === "nominate" ? "nominate" : "skip";
    if (!guide.ok) return guide;
    let eligible = guide.eligible.some((entry) => entry.category === category);
    // Acting categories and Best Song allow adding another nominee after an
    // earlier one was already recorded for the same category, and allow the
    // final explicit skip (done adding nominees) even after those earlier
    // nominate decisions - only a category already closed by its own skip is
    // truly done (issue #192).
    let existingDecision = guide.decisions.find(
      (entry) => entry.category === category,
    );
    let alreadyPersisted =
      Boolean(existingDecision) &&
      (existingDecision.action === "skip" ||
        !window.isMultiNomineeCategory?.(category));
    if (
      !eligible ||
      alreadyPersisted ||
      (action === "skip" && category !== guide.category)
    )
      return { ok: false, reason: "invalid-category", guide };
    if (
      action === "nominate" &&
      !awardsForFilmAtLevel(
        window.watchedIntakeFilm(guide.workflow),
        guide.year,
        periodType,
      ).some((award) => award.category === category)
    )
      return { ok: false, reason: "nomination-required", guide };
    let decisions = [
      ...guide.decisions.filter((entry) => entry.category !== category),
      {
        category,
        action,
        ...(action === "nominate" && decision.auditEntryId
          ? { auditEntryId: String(decision.auditEntryId) }
          : {}),
      },
    ];
    guide.workflow.steps.awards[level].decisionRef =
      annualAwardDecisionRef(decisions);
    let changedAt = now(decision);
    markDraft("watched-intake-annual-awards", changedAt);
    let audit = null;
    if (action === "skip")
      audit = window.recordEdit({
        type: "watched intake annual category",
        summary: `${guide.film.title} ${category} reviewed`,
        target: { type: "other", id: guide.film.id, label: guide.film.title },
        changes: [{ field: category, before: "Pending", after: "Skipped" }],
        context: {
          filmId: guide.workflow.filmId,
          workflowId,
          awardsLevel: level,
          periodKey: guide.year,
          category,
        },
      });
    let nextGuide = window.watchedIntakeAnnualAwardsGuide(workflowId, level);
    let completion = null;
    if (nextGuide.ok && !nextGuide.current) {
      let hasAwards = awardsForFilmAtLevel(
        window.watchedIntakeFilm(guide.workflow),
        guide.year,
        periodType,
      ).length > 0;
      completion = window.completeWatchedIntakeAwardsLevel(
        workflowId,
        level,
        hasAwards ? "complete" : "none",
        { save: false, now: changedAt },
      );
      if (!completion.ok) return completion;
    }
    if (options.save !== false)
      window.save({ immediate: true, rebuild: false });
    return {
      ok: true,
      workflow: guide.workflow,
      film: window.watchedIntakeFilm(guide.workflow),
      nextGuide: completion ? null : nextGuide,
      completion,
      auditEntry: audit,
    };
  };

  /** Completes an already exhausted category queue without changing nominations. @param {string} workflowId Workflow id. @param {Object} [options] Save controls, plus level ("year" default). @returns {Object} Result. */
  window.finishWatchedIntakeAnnualAwards = function (
    workflowId,
    options = {},
  ) {
    let level = options.level || "year";
    let guide = window.watchedIntakeAnnualAwardsGuide(workflowId, level);
    if (!guide.ok) return guide;
    if (guide.current)
      return { ok: false, reason: "categories-required", guide };
    let hasAwards =
      awardsForFilmAtLevel(guide.film, guide.year, AWARD_PERIOD_TYPES[level])
        .length > 0;
    return window.completeWatchedIntakeAwardsLevel(
      workflowId,
      level,
      hasAwards ? "complete" : "none",
      options,
    );
  };

  /** Un-decides the immediately-preceding category decision for a level, reverting any applied nomination through the shared edit-undo system. @param {string} workflowId Workflow id. @param {string} [level] Award level. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.previousWatchedIntakeAnnualCategory = function (
    workflowId,
    level = "year",
    options = {},
  ) {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    if (!workflow) return { ok: false, reason: "missing" };
    let step = workflow.steps.awards[level];
    if (!step || step.status !== "pending")
      return { ok: false, reason: "not-annual-step" };
    let decisions = parseAnnualAwardDecisions(step);
    if (!decisions.length) return { ok: false, reason: "nothing-to-undo" };
    let last = decisions[decisions.length - 1];
    if (last.action === "nominate") {
      if (!last.auditEntryId) return { ok: false, reason: "unsupported" };
      let undone = window.applyEditUndo(last.auditEntryId);
      if (!undone.ok)
        return { ok: false, reason: undone.reason || "undo-failed" };
    }
    step.decisionRef = annualAwardDecisionRef(decisions.slice(0, -1));
    let changedAt = now(options);
    markDraft("watched-intake-annual-awards-previous", changedAt);
    if (options.save !== false)
      window.save({ immediate: true, rebuild: false });
    return { ok: true, workflow, category: last.category };
  };

  /** Records an explicit awards review outcome after prior levels finish. @param {string} workflowId Workflow id. @param {string} level Period level. @param {'complete'|'none'|'not-applicable'} status Outcome. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.completeWatchedIntakeAwardsLevel = function (
    workflowId,
    level,
    status,
    options = {},
  ) {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    let film = window.watchedIntakeFilm(workflow);
    let index = AWARD_LEVELS.indexOf(level);
    if (!workflow || !film || index < 0 || !["complete", "none", "not-applicable"].includes(status))
      return { ok: false, reason: "invalid" };
    if (workflow.steps.ranking.status === "pending") return { ok: false, reason: "ranking-required" };
    if (AWARD_LEVELS.slice(0, index).some((name) => workflow.steps.awards[name].status === "pending"))
      return { ok: false, reason: "previous-level-required" };
    let periodKey = awardPeriodKey(film, level);
    let matchingAwards = (film.awards || []).filter(
      (award) => String(award.year || "") === String(periodKey),
    );
    if (status === "complete" && !matchingAwards.length)
      return { ok: false, reason: "no-awards-recorded" };
    let completedAt = now(options);
    workflow.steps.awards[level] = {
      status,
      completedAt,
      decisionRef: `${periodKey}:${status}`,
      resultRef: matchingAwards.length
        ? `awards:${periodKey}:${matchingAwards.length}`
        : `awards:${periodKey}:none`,
    };
    markDraft("watched-intake-awards", completedAt);
    let audit = window.recordEdit({
      type: "watched intake awards",
      summary: `${film.title} ${level} awards reviewed`,
      target: { type: "other", id: film.id, label: film.title },
      changes: [{ field: `${level} awards`, before: "Pending", after: status }],
      context: { filmId: workflow.filmId, workflowId, awardsLevel: level, periodKey },
    });
    if (options.save !== false) window.save({ immediate: true, rebuild: false });
    return { ok: true, workflow, film, auditEntry: audit };
  };

  /** Returns whether an intake can close and its domain-derived summary. @param {string} workflowId Workflow id. @returns {Object} Completion plan. */
  window.planWatchedIntakeCompletion = function (workflowId) {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    let film = window.watchedIntakeFilm(workflow);
    if (!workflow || !film) return { ok: false, reason: "missing" };
    let pending = [];
    if (workflow.steps.rating.status !== "complete") pending.push("rating");
    if (workflow.steps.ranking.status === "pending") pending.push("ranking");
    AWARD_LEVELS.forEach((level) => {
      if (workflow.steps.awards[level].status === "pending") pending.push(`${level} awards`);
    });
    let summary = `${film.title}: ${film.rating || "unrated"}; ${film.allTimeRank ? `all-time #${film.allTimeRank}` : "global rank not applicable"}; awards ${AWARD_LEVELS.map((level) => `${level}=${workflow.steps.awards[level].status}`).join(", ")}`;
    return { ok: pending.length === 0, reason: pending.length ? "pending" : "", workflow, film, pending, summary: summary.slice(0, 1000) };
  };

  /** Explicitly completes a fully reviewed intake. @param {string} workflowId Workflow id. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.completeWatchedIntake = function (workflowId, options = {}) {
    let plan = window.planWatchedIntakeCompletion(workflowId);
    if (!plan.ok) return plan;
    let completedAt = now(options);
    plan.workflow.completedAt = completedAt;
    plan.workflow.summary = plan.summary;
    let audit = window.recordEdit({
      type: "watched intake completed",
      summary: `${plan.film.title} intake completed`,
      target: { type: "other", id: plan.film.id, label: plan.film.title },
      changes: [{ field: "Intake", before: "Open", after: "Complete" }],
      context: { filmId: plan.workflow.filmId, workflowId },
    });
    plan.workflow.auditEntryId = audit.id;
    markDraft("watched-intake-completed", completedAt);
    if (options.save !== false) window.save({ immediate: true, rebuild: false });
    return Object.assign(plan, { auditEntry: audit });
  };

  /** Deliberately reopens a completed intake without changing domain decisions. @param {string} workflowId Workflow id. @param {Object} [options] Save controls. @returns {Object} Result. */
  window.reopenWatchedIntake = function (workflowId, options = {}) {
    let workflow = window.findWatchedIntakeWorkflow(workflowId);
    let film = window.watchedIntakeFilm(workflow);
    if (!workflow || !film || !workflow.completedAt) return { ok: false, reason: "not-complete" };
    let reopenedAt = now(options);
    workflow.reopenedAt = reopenedAt;
    delete workflow.completedAt;
    delete workflow.summary;
    let level = [...AWARD_LEVELS].reverse().find((name) => workflow.steps.awards[name].status !== "pending");
    if (level) workflow.steps.awards[level] = { status: "pending" };
    markDraft("watched-intake-reopened", reopenedAt);
    let audit = window.recordEdit({
      type: "watched intake reopened",
      summary: `${film.title} intake reopened`,
      target: { type: "other", id: film.id, label: film.title },
      changes: [{ field: "Intake", before: "Complete", after: "Open" }],
      context: { filmId: workflow.filmId, workflowId },
    });
    workflow.auditEntryId = audit.id;
    if (options.save !== false) window.save({ immediate: true, rebuild: false });
    return { ok: true, workflow, film, auditEntry: audit };
  };
})();
