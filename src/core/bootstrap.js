/**
 * @file Coordinates startup loading, bundled-data imports, structural
 * migrations, and narrow repairs before the active page renders.
 */

window.OSKARS_BUNDLED_DATA_VERSION = 6;

// Bootstrap handles two different startup chores:
// - structural migrations: generic state-shape changes tracked by version flags.
// - personal archive repairs: narrow, idempotent cleanups for known bad rows.
// Keep archive repairs named as repair... helpers so future schema migrations do
// not get buried among one-off data fixes.

/**
 * Creates empty local state marked with every currently completed migration.
 * @returns {OskarsState} Cleared state ready to persist without restoring bundled data.
 */
window.createClearedLocalState = function () {
  let cleared = window.createEmptyState();
  cleared.dataVersion = window.OSKARS_BUNDLED_DATA_VERSION;
  cleared.centuryRangeVersion = 1;
  cleared.adaptationSourceVersion = 1;
  cleared.watchlistOrderVersion = 1;
  cleared.groupedRankProjectionVersion = 1;
  cleared.watchedDateVersion = 1;
  cleared.viewingFactsVersion = 1;
  return cleared;
};

// Structural migration: dateWatched used to store raw sheet cells, including
// literal '-' placeholders and compact YYMMDD strings. Saved states convert
// once to ISO (dropping placeholders); imports now normalize on entry.
/**
 * Migrates stored watch dates to canonical values once.
 * @returns {boolean} Whether the migration changed or versioned the state.
 */
window.repairWatchedDates = function () {
  if ((window.state.watchedDateVersion || 0) >= 1) return false;
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      if (film.dateWatched === undefined) return;
      let normalized =
        window.normalizeWatchedDate?.(film.dateWatched) ?? film.dateWatched;
      if (normalized) film.dateWatched = normalized;
      else delete film.dateWatched;
    });
  });
  window.state.watchedDateVersion = 1;
  return true;
};

// Structural migration: ranked-list viewing and classification cells once
// retained literal dash placeholders. A small batch of old saved watch dates
// also contains row-like one/two-digit values; those cannot be real dates,
// while other unrecognized text remains intentionally untouched.
/**
 * Removes legacy placeholders and invalid short watch dates once.
 * @returns {boolean} Whether the migration changed or versioned the state.
 */
window.repairViewingFacts = function () {
  if ((window.state.viewingFactsVersion || 0) >= 1) return false;
  let placeholder = (value) =>
    /^(?:-|–|—|n\/?a|none)$/i.test(String(value || "").trim());
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      ["platform", "type", "country"].forEach((field) => {
        if (placeholder(film[field])) delete film[field];
      });
      if (film.tags !== undefined) {
        let tags = Array.isArray(film.tags)
          ? film.tags
          : String(film.tags || "").split(/[,;\n]+/);
        film.tags = tags.filter(
          (tag) => !placeholder(tag) && String(tag || "").trim(),
        );
        if (!film.tags.length) delete film.tags;
      }
      if (/^\d{1,2}$/.test(String(film.dateWatched || "").trim()))
        delete film.dateWatched;
    });
  });
  window.state.viewingFactsVersion = 1;
  return true;
};

// Personal archive repair: fixes a misspelling that existed in saved/bundled
// data. This is not a generic title normalization migration.
/**
 * Corrects the known misspelled film title in source periods.
 * @returns {boolean} Whether a title was corrected.
 */
window.repairKnownFilmTitles = function () {
  let changed = false;
  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      if (window.normalizeTitle(film.title) !== "dead poets soicety") return;
      film.title = "Dead Poets Society";
      film.normalizedTitle = "dead poets society";
      film.id = window.makeFilmId(film.year, film.title);
      changed = true;
    });
  });
  return changed;
};

// Personal archive repair: auto-generated project names used to carry a
// " watch project" suffix; the hub is context enough, so saved projects drop it once here.
/**
 * Removes the obsolete generated suffix from saved project names.
 * @returns {boolean} Whether a project name was changed.
 */
window.repairProjectNames = function () {
  let changed = false;
  (window.state.projects || []).forEach((project) => {
    let trimmed = String(project.name || "").replace(/\s+watch project$/i, "");
    if (trimmed && trimmed !== project.name) {
      project.name = trimmed;
      changed = true;
    }
  });
  return changed;
};

/**
 * Computes the persisted global watchlist order once when its helper is available.
 * @returns {boolean} Whether the migration ran.
 */
window.repairWatchlistGlobalOrder = function () {
  if ((window.state.watchlistOrderVersion || 0) >= 1) return false;
  if (!window.recomputeWatchlistOrder) return false;
  window.recomputeWatchlistOrder?.();
  window.state.watchlistOrderVersion = 1;
  return true;
};

/**
 * Projects grouped all-time ranks into each ranked period once.
 * @returns {boolean} Whether the migration ran.
 */
window.repairGroupedRankProjections = function () {
  if ((window.state.groupedRankProjectionVersion || 0) >= 1) return false;
  let allTimeFilms = (window.state.years?.alltime?.films || []).filter(
    (film) =>
      film?.title &&
      !film.suppressAllTimeRank &&
      /^\d{4}$/.test(
        String(window.filmConcreteYear?.(film.year) || film.year || ""),
      ),
  );
  if (!allTimeFilms.length) {
    window.state.groupedRankProjectionVersion = 1;
    return true;
  }

  function identity(film) {
    return (
      window.filmIdentityKey?.(film, { includePeriodKey: true }) ||
      `${window.filmConcreteYear?.(film.year) || film.year || ""}\n${window.normalizeTitle(film.title)}`
    );
  }

  function assignRank(films, field) {
    let nextRank = 1;
    let groupRanks = new Map();
    films.forEach((film) => {
      let rank =
        film.rankingGroupId && groupRanks.has(film.rankingGroupId)
          ? groupRanks.get(film.rankingGroupId)
          : nextRank;
      if (film.rankingGroupId && !groupRanks.has(film.rankingGroupId)) {
        groupRanks.set(film.rankingGroupId, rank);
      }
      if (!film.rankingGroupId || rank === nextRank) nextRank += 1;
      film[field] = rank;
      if (field === "allTimeRank") film.rank = rank;
    });
  }

  let orderedAllTimeFilms = [...allTimeFilms].sort(
    (left, right) =>
      Number(left.allTimeRank || left.rank || 999999) -
        Number(right.allTimeRank || right.rank || 999999) ||
      window.compareEnglishTitles(left.title, right.title),
  );
  assignRank(orderedAllTimeFilms, "allTimeRank");

  let identityRanks = new Map();
  let yearGroups = new Map();
  let decadeGroups = new Map();
  let centuryGroups = new Map();
  orderedAllTimeFilms.forEach((film) => {
    let year = window.filmConcreteYear?.(film.year) || String(film.year || "");
    identityRanks.set(identity(film), {
      allTimeRank: film.allTimeRank,
      yearRank: null,
      decadeRank: null,
      centuryRank: null,
    });
    if (!/^\d{4}$/.test(year)) return;
    let yearKey = String(year);
    let decadeKey = window.getDecadeKey(year);
    let centuryKey = window.getCenturyKey(year);
    if (!yearGroups.has(yearKey)) yearGroups.set(yearKey, []);
    if (!decadeGroups.has(decadeKey)) decadeGroups.set(decadeKey, []);
    if (!centuryGroups.has(centuryKey)) centuryGroups.set(centuryKey, []);
    yearGroups.get(yearKey).push(film);
    decadeGroups.get(decadeKey).push(film);
    centuryGroups.get(centuryKey).push(film);
  });

  function assignPeriodRanks(groups, field) {
    groups.forEach((films) => {
      assignRank(films, field);
      films.forEach((film) => {
        let ranks = identityRanks.get(identity(film));
        if (ranks) ranks[field] = film[field];
      });
    });
  }
  assignPeriodRanks(yearGroups, "yearRank");
  assignPeriodRanks(decadeGroups, "decadeRank");
  assignPeriodRanks(centuryGroups, "centuryRank");

  Object.values(window.state.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      let ranks = identityRanks.get(identity(film));
      if (!ranks) return;
      film.allTimeRank = ranks.allTimeRank;
      film.yearRank = ranks.yearRank;
      film.decadeRank = ranks.decadeRank;
      film.centuryRank = ranks.centuryRank;
      if (period.periodType === "years") film.rank = ranks.yearRank;
      else if (period.periodType === "decades") film.rank = ranks.decadeRank;
      else if (period.periodType === "centuries") film.rank = ranks.centuryRank;
      else if (period.periodType === "allTime") film.rank = ranks.allTimeRank;
    });
  });

  window.state.groupedRankProjectionVersion = 1;
  return true;
};

// Personal archive repair: early Google Sheets imports could assign a whole
// year bracket to an adjacent year. If the all-time list proves the bracket's
// canonical year, move the block once.
/**
 * Moves confidently misassigned year brackets to the year proven by all-time data.
 * @returns {boolean} Whether any source period was moved.
 */
window.repairMisassignedYearBracketPeriods = function () {
  let allTimeFilms = window.state.years?.alltime?.films || [];
  if (!allTimeFilms.length) return false;
  let changed = false;
  let allTimeByTitle = new Map();
  allTimeFilms.forEach((film) => {
    let title = window.normalizeTitle(film.title);
    let year = String(film.year || "");
    if (title && /^\d{4}$/.test(year) && !allTimeByTitle.has(title))
      allTimeByTitle.set(title, year);
  });

  Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
    if (!/^\d{4}$/.test(periodKey) || period?.periodType !== "years") return;
    let films = period.films || [];
    if (!films.length) return;
    let counts = new Map();
    let matched = 0;
    films.forEach((film) => {
      let year = allTimeByTitle.get(window.normalizeTitle(film.title));
      if (!year) return;
      matched += 1;
      counts.set(year, (counts.get(year) || 0) + 1);
    });
    if (!matched || counts.size !== 1) return;
    let [[canonicalYear, count]] = [...counts.entries()];
    if (canonicalYear === periodKey) return;
    let required = Math.max(2, Math.ceil(films.length * 0.6));
    if (count < required) return;

    window.state.years[canonicalYear] ||= { films: [], periodType: "years" };
    let target = window.state.years[canonicalYear];
    target.periodType = "years";
    films.forEach((film) => {
      let copy = window.cloneRecord(film);
      if (String(copy.year || "") === periodKey) copy.year = canonicalYear;
      copy.id = window.makeFilmId(copy.year || canonicalYear, copy.title);
      (copy.awards || []).forEach((award) => {
        if (String(award.year || "") === periodKey) award.year = canonicalYear;
      });
      let existing = target.films.find((candidate) =>
        window.sameFilmIdentity(candidate, copy),
      );
      if (existing) {
        (copy.awards || []).forEach((award) => {
          if (
            !existing.awards?.some((candidate) =>
              window.sameAward(candidate, award),
            )
          ) {
            existing.awards ||= [];
            existing.awards.push(award);
          }
        });
      } else {
        target.films.push(copy);
      }
    });
    delete window.state.years[periodKey];
    changed = true;
  });
  return changed;
};

/**
 * Fetches and validates the first available published canonical dataset.
 * @returns {Promise<{ok: boolean, data?: Object, revision?: string, path?: string, error?: string, detail?: string}>}
 *   Published result.
 */
window.fetchPublishedCanonical = async function () {
  let candidates = ["./oskars-data.json", "./data/oskars-data.json"];
  for (let path of candidates) {
    let response;
    try {
      let doneFetch = window.startOskarsPerformance?.(`snapshot:fetch ${path}`);
      response = await fetch(path, { cache: "no-store" });
      doneFetch?.();
    } catch (err) {
      continue;
    }
    if (!response.ok) continue;
    try {
      let doneJson = window.startOskarsPerformance?.(`snapshot:parse ${path}`);
      let canonical;
      if (typeof response.text === "function")
        canonical = window.parseCanonicalData(await response.text());
      else
        canonical = window.assertCanonicalData(
          window.migrateCanonicalData(await response.json()),
        );
      doneJson?.();
      return {
        ok: true,
        data: canonical,
        revision: window.canonicalDataRevision(canonical),
        path,
      };
    } catch (err) {
      return {
        ok: false,
        error: "invalid",
        path,
        detail: String(err?.message || err),
      };
    }
  }
  return {
    ok: false,
    error: window.navigator?.onLine === false ? "offline" : "unavailable",
  };
};

/**
 * Loads and hydrates the first available repository JSON snapshot.
 * @returns {Promise<boolean>} Whether a valid snapshot was loaded.
 */
window.loadRepositorySnapshot = async function () {
  let published = await window.fetchPublishedCanonical();
  if (!published.ok) return false;
  window.hydrateState(published.data);
  return true;
};

let latestPublishedCanonical = null;
let latestReconciliationPlan = null;

/**
 * Returns the validated canonical document observed during this startup.
 * Callers must treat the returned document as read-only.
 * @returns {Object|null} Observed published canonical data.
 */
window.getObservedPublishedCanonical = function () {
  return latestPublishedCanonical;
};

/**
 * Returns the latest startup reconciliation plan.
 * @returns {Object|null} A defensive copy of the reconciliation plan.
 */
window.getStartupReconciliationPlan = function () {
  return latestReconciliationPlan ? { ...latestReconciliationPlan } : null;
};

async function replaceWithPublishedCanonical(canonical, revision, options = {}) {
  if (options.retainRecovery) {
    let retained = await window.saveRecoveryWorkspace(
      window.getBrowserPersistenceState(),
      { reason: options.reason || "canonical-reconciliation" },
    );
    if (!retained) return false;
  }
  let workspace = window.publishedCanonicalWorkspace(
    canonical,
    window.state,
    revision,
  );
  let runtime = window.browserPersistenceToRuntimeState(workspace);
  let doneWrite = window.startOskarsPerformance?.("save:write");
  let replaced = await window.replaceStoredState(runtime, {
    message: "Published data adopted",
    fallbackMessage: "Published data adopted using fallback storage",
  });
  doneWrite?.("canonical reconciliation");
  return replaced;
}

/**
 * Replaces a stale local draft with the last validated published dataset after confirmation.
 * @returns {Promise<boolean>} Whether published data replaced the draft.
 */
window.usePublishedCanonical = async function () {
  if (!latestPublishedCanonical || !latestReconciliationPlan?.publishedRevision)
    return false;
  if (
    typeof window.confirm === "function" &&
    !window.confirm(
      "Use the published dataset? Your current local workspace will be retained for recovery.",
    )
  )
    return false;
  let replaced = await replaceWithPublishedCanonical(
    latestPublishedCanonical,
    latestReconciliationPlan.publishedRevision,
    { retainRecovery: true, reason: "stale-draft-reconciliation" },
  );
  if (replaced && typeof window.location?.reload === "function")
    window.location.reload();
  return replaced;
};

/**
 * Restores the retained pre-reconciliation workspace after confirmation.
 * @returns {Promise<boolean>} Whether recovery was restored.
 */
window.restoreCanonicalRecovery = async function () {
  if (
    typeof window.confirm === "function" &&
    !window.confirm("Restore the local workspace retained before reconciliation?")
  )
    return false;
  let restored = await window.restoreRecoveryWorkspace();
  if (restored && typeof window.location?.reload === "function")
    window.location.reload();
  return restored;
};

async function showReconciliationStatus(plan) {
  let status =
    plan.status === "clean" || plan.status === "local"
      ? "saved"
      : plan.status === "invalid" || plan.status === "stale"
        ? "error"
        : "warning";
  let actions = [];
  if (plan.status === "stale")
    actions.push({ label: "Use published", run: window.usePublishedCanonical });
  else if (plan.status === "clean" && (await window.readRecoveryWorkspace?.()))
    actions.push({
      label: "Restore previous",
      run: window.restoreCanonicalRecovery,
    });
  window.showStorageStatus?.(
    window.reconciliationStatusMessage(plan),
    status,
    actions,
  );
}

/**
 * Loads persisted state, applies required bundled data and repairs, and rebuilds stale aggregates.
 * @returns {Promise<OskarsState>} The ready global application state.
 */
window.ensureOskarsData = async function () {
  let doneEnsure = window.startOskarsPerformance?.("ensureOskarsData");
  let capabilities = window.runtimeModeCapabilities(window.getRuntimeMode());
  let loading = window.load();
  if (loading?.then) await loading;
  let loadInfo = window.getPersistenceLoadInfo?.() || {
    found: false,
    source: "none",
  };
  let published =
    capabilities.fetchPublishedSnapshot && typeof fetch === "function"
      ? await window.fetchPublishedCanonical()
      : { ok: false, error: "offline" };
  let localCanonical = loadInfo.found
    ? window.getCanonicalData(window.state, { clone: false })
    : null;
  // Local/viewer mode never requests or adopts an owner snapshot (issue
  // #245); the published-canonical reconciliation path only ever runs for
  // owner mode, which preserves its existing contract unchanged.
  let reconciliationPlan = capabilities.fetchPublishedSnapshot
    ? window.planStartupReconciliation({
        hasLocal: loadInfo.found,
        localCanonical,
        draftMetadata: window.state.draftMetadata,
        publishedCanonical: published.ok ? published.data : null,
        publishedRevision: published.revision || "",
        publishedError: published.error || "",
      })
    : window.planLocalModeStartup({
        hasLocal: loadInfo.found,
        localCanonical,
        draftMetadata: window.state.draftMetadata,
      });
  let loadedSnapshot = false;
  if (reconciliationPlan.action === "adopt-published") {
    let replaced = await replaceWithPublishedCanonical(
      published.data,
      reconciliationPlan.publishedRevision,
      {
        retainRecovery: loadInfo.found,
        reason: loadInfo.found ? "newer-published-canonical" : "fresh-canonical",
      },
    );
    if (replaced) {
      loadedSnapshot = true;
      reconciliationPlan = {
        ...reconciliationPlan,
        action: "retain-local",
        baseRevision: reconciliationPlan.publishedRevision,
        localRevision: reconciliationPlan.publishedRevision,
        stale: false,
      };
    } else {
      reconciliationPlan = {
        ...reconciliationPlan,
        status: "stale",
        action: "await-reconciliation",
        requiredAction: "retain-recovery-before-update",
        stale: true,
      };
    }
  } else if (loadInfo.found) {
    window.state.draftMetadata = window.reconciliationDraftMetadata(
      window.state.draftMetadata,
      reconciliationPlan,
    );
    if (
      reconciliationPlan.verifiedPublication &&
      window.state.importFoundation?.candidateRevision ===
        reconciliationPlan.publishedRevision
    ) {
      window.state.importFoundation = {
        ...window.state.importFoundation,
        status: "verified-published",
        publishedRevision: reconciliationPlan.publishedRevision,
        verifiedAt: new Date().toISOString(),
      };
    }
  }
  latestPublishedCanonical = published.ok ? published.data : null;
  latestReconciliationPlan = reconciliationPlan;
  window.OSKARS_STARTUP_RECONCILIATION = { ...reconciliationPlan };

  // A brand-new local/viewer session with nothing persisted yet has no
  // archive content to migrate or repair — every repair below is a no-op on
  // an empty state, but each still unconditionally stamps its migration
  // version flag and reports "changed", which would silently persist a save
  // before the user ever makes a choice (issue #252's onboarding relies on
  // "nothing persisted yet" staying true until a deliberate first action).
  let freshEmptySession = !capabilities.fetchPublishedSnapshot && !loadInfo.found;

  let bundled = window.OSKARS_DEFAULT_DATA;
  let needsBundledData =
    !freshEmptySession &&
    (state.dataVersion || 0) < window.OSKARS_BUNDLED_DATA_VERSION;
  let hasAllTimeBracket = () =>
    (state.years?.alltime?.films || []).some((film) =>
      (film.awards || []).some((award) => award.year === "alltime"),
    );
  let needsAllTimeBracket =
    Boolean(bundled?.allTimeBracket) && !hasAllTimeBracket();
  let rankedListHasSourceColumn = String(bundled?.allTimeRankedList || "")
    .split(/\r?\n/)
    .some((line) => line && line.split("\t").length >= 16);
  let needsAdaptationSources =
    rankedListHasSourceColumn && (state.adaptationSourceVersion || 0) < 1;
  let needsSave = false;
  let needsAggregateRebuild = !Object.keys(state.filmsById || {}).length;
  if (loadedSnapshot) needsAggregateRebuild = false;

  if (
    ((needsBundledData && !loadedSnapshot) || needsAllTimeBracket) &&
    bundled
  ) {
    // Structural migration cleanup: remove empty rows left by early imports before
    // applying current bundles.
    Object.entries(state.years || {}).forEach(([key, period]) => {
      period.films = (period.films || []).filter((film) =>
        normalizeTitle(film.title),
      );
      if (/^\d{4}$/.test(key)) {
        // Personal archive repair: this stray person row was once imported as a film.
        period.films = period.films.filter(
          (film) =>
            (film.awards || []).length > 0 &&
            !(
              key === "1997" && normalizeTitle(film.title) === "michael haneke"
            ),
        );
      }
    });

    window.importData(bundled.yearBrackets, "table", {
      silentReport: true,
      render: false,
    });
    window.importData(bundled.decadeBrackets, "table", {
      silentReport: true,
      render: false,
    });
    window.importData(bundled.centuryBracket, "table", {
      silentReport: true,
      render: false,
    });
    if (bundled.allTimeBracket) {
      window.importData(bundled.allTimeBracket, "table", {
        silentReport: true,
        render: false,
      });
    }
    window.importData(bundled.allTimeRankedList, "list", {
      silentReport: true,
      render: false,
    });
    state.selectedPeriodType = "alltime";
    state.selectedYears = ["alltime"];
    state.dataVersion = window.OSKARS_BUNDLED_DATA_VERSION;
    needsSave = true;
    needsAggregateRebuild = true;
  }

  if (needsAdaptationSources && bundled?.allTimeRankedList) {
    // Structural migration: ranked-list source/adaptation columns were added
    // after some local states had already been saved.
    window.importData(bundled.allTimeRankedList, "list", {
      silentReport: true,
      render: false,
    });
    state.adaptationSourceVersion = 1;
    needsSave = true;
    needsAggregateRebuild = true;
  }

  let repairedTitles = !freshEmptySession && window.repairKnownFilmTitles();
  let repairedPeriods =
    !freshEmptySession && window.repairMisassignedYearBracketPeriods();
  let repairedProjects = !freshEmptySession && window.repairProjectNames();
  let repairedWatchlistOrder =
    !freshEmptySession && window.repairWatchlistGlobalOrder();
  let repairedGroupedRanks =
    !freshEmptySession && window.repairGroupedRankProjections();
  let repairedWatchedDates =
    !freshEmptySession && window.repairWatchedDates();
  let repairedViewingFacts =
    !freshEmptySession && window.repairViewingFacts();
  needsSave =
    repairedTitles ||
    repairedPeriods ||
    repairedProjects ||
    repairedWatchlistOrder ||
    repairedGroupedRanks ||
    repairedWatchedDates ||
    repairedViewingFacts ||
    needsSave;
  needsAggregateRebuild =
    repairedTitles ||
    repairedPeriods ||
    repairedGroupedRanks ||
    repairedWatchedDates ||
    repairedViewingFacts ||
    needsAggregateRebuild;
  if (needsAggregateRebuild) window.rebuildAggregates?.();
  if (needsSave) {
    let saving = window.save({ immediate: true, rebuild: false });
    if (saving?.then) await saving;
  }
  window.renderSiteHeader?.();
  await showReconciliationStatus(reconciliationPlan);
  doneEnsure?.();
  return state;
};
