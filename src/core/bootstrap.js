/**
 * @file Coordinates startup loading, bundled-data imports, structural
 * migrations, and narrow repairs before the active page renders.
 */

window.OSKARS_BUNDLED_DATA_VERSION = 6;

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
 * Builds a public profile's stable, shareable entry URL from the current
 * page location — always `index.html?profile=<slug>`, regardless of which
 * page the viewer is currently on, so "Copy profile link" always shares the
 * canonical entry point rather than an incidental internal-navigation URL.
 * @param {string} slug Profile slug.
 * @returns {string} Absolute share URL.
 */
function publicProfileShareUrl(slug) {
  let base = String(window.location?.href || "").replace(/[^/]*$/, "");
  return `${base}index.html?${window.OSKARS_PROFILE_SLUG_QUERY_PARAM}=${encodeURIComponent(slug)}`;
}

const PUBLIC_PROFILE_ERROR_MESSAGES = {
  "not-found": "Profile not found",
  invalid: "This profile's data could not be loaded",
  unavailable: "This profile is temporarily unavailable",
};

/**
 * Attempts to load and hydrate the active public profile for the current
 * tab (issue #253) — reachable regardless of the deployment's baked runtime
 * mode; see the file-level comment in public-profile.js. Reports a status
 * message either way — a shareable "Viewing X's public profile" badge on
 * success, or a plain-language reason on a recoverable failure — but only
 * ever returns whether hydration succeeded; callers decide what startup
 * path runs next.
 * @param {string} slug Profile slug to load.
 * @returns {Promise<boolean>} Whether the profile was hydrated.
 */
async function ensurePublicProfileData(slug) {
  let result = await window.loadPublicProfile?.(slug);
  if (!result) return false;
  if (result.ok) {
    let canReturnToOwnArchive = window
      .runtimeModeCapabilities?.(window.getRuntimeMode?.())
      ?.canPersistPrivateState;
    window.showStorageStatus?.(
      `Viewing ${result.meta.ownerName}'s public profile · revision ${result.meta.revision}`,
      "viewer",
      [
        {
          label: "Copy profile link",
          run: () => window.copyViewLink?.(publicProfileShareUrl(slug)),
        },
        {
          label: canReturnToOwnArchive
            ? "Return to my local archive"
            : "Stop viewing",
          run: () => window.stopViewingPublicProfile?.(),
        },
      ],
    );
    return true;
  }
  let message = PUBLIC_PROFILE_ERROR_MESSAGES[result.error];
  if (message) window.showStorageStatus?.(message, "error");
  return false;
}

/**
 * Loads persisted state, applies required bundled data and repairs, and rebuilds stale aggregates.
 * @returns {Promise<OskarsState>} The ready global application state.
 */
window.ensureOskarsData = async function () {
  let doneEnsure = window.startOskarsPerformance?.("ensureOskarsData");
  let runtimeMode = window.getRuntimeMode();
  let capabilities = window.runtimeModeCapabilities(runtimeMode);
  let profileLoadAttempted = false;
  let profileSlug = window.resolveActiveProfileSlug?.();
  if (profileSlug) {
    profileLoadAttempted = true;
    if (await ensurePublicProfileData(profileSlug)) {
      window.refreshOskarsBackdrop?.();
      doneEnsure?.();
      return window.state;
    }
  }
  // An account-gated deployment permits anonymous public-profile loading,
  // but a missing/invalid profile must not fall through into the browser's
  // private local workspace while signed out. Resolve the ordinary editable
  // boundary only after the public fetch failed and before window.load()
  // touches IndexedDB (issue #332).
  if (profileLoadAttempted) {
    let access = await window.resolveOskarsAccountAccess?.();
    if (access && !access.allowed) {
      window.renderOskarsAccountGate?.(access);
      doneEnsure?.();
      return window.state;
    }
    window.OSKARS_ACCOUNT_ACCESS_BLOCKED = false;
    window.monitorRequiredAccountSession?.();
  }
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
  window.refreshOskarsBackdrop?.();
  // A failed/absent profile load already reported its own specific reason
  // (ensurePublicProfileData); the generic local-mode reconciliation status
  // below would otherwise silently overwrite it with something misleading
  // like "Local mode · Empty archive".
  if (!profileLoadAttempted) await showReconciliationStatus(reconciliationPlan);
  window.noteOskarsDataReadyForSync?.();
  window.noteOskarsDataReadyForSharedArchivePull?.();
  window.noteOskarsDataReadyForSharedFilmMetadataSync?.();
  doneEnsure?.();
  return state;
};
