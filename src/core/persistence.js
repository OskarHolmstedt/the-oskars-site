/**
 * @file Persists the layered browser-workspace envelope in IndexedDB with a
 * localStorage fallback, legacy migration, debounced writes, and stale-tab
 * protection. save()/replaceStoredState()/saveRecoveryWorkspace() are the
 * only paths that ever write private state here (issue #256) — every
 * mutation across the app funnels through one of them, so gating these
 * three functions on the active runtime mode's canPersistPrivateState
 * capability is the single enforcement point that keeps a viewer-mode
 * session from persisting anything, however it was reached.
 */

window.OSKARS_DATABASE_NAME = "oskars";
window.OSKARS_DATABASE_VERSION = 1;
window.OSKARS_STATE_STORE = "state";
window.OSKARS_STATE_KEY = "current";
window.OSKARS_RECOVERY_STATE_KEY = "recovery";
window.OSKARS_FALLBACK_RECOVERY_KEY = "oskars-recovery";

let databasePromise = null;
let loadPromise = null;
let saveTimer = null;
let saveWaiters = [];
let saveNeedsWorkspaceSync = false;
let persistenceTabId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let lastSeenWriteCounter = 0;
let staleWriteDetected = false;
let persistenceChannel = null;
let persistenceLoadInfo = { found: false, source: "none" };
const PERSISTENCE_META_KEY = "_oskarsPersistence";

function persistenceStamp(snapshot) {
  return Number(snapshot?.[PERSISTENCE_META_KEY]?.writeCounter) || 0;
}

function markPersistenceFresh(snapshot) {
  lastSeenWriteCounter = persistenceStamp(snapshot);
  staleWriteDetected = false;
}

function staleWriteError() {
  let error = new Error("Changed in another tab — reload before editing");
  error.code = "OSKARS_STALE_STATE";
  return error;
}

// Defaults to allowed when runtime-mode.js hasn't been loaded at all (some
// standalone test suites load persistence.js on its own), matching that
// module's own "absent configuration means owner" default. Only an
// explicitly resolved viewer mode ever returns false here. A hydrated
// public-profile view (issue #253) is blocked regardless of the baked
// mode — viewing another owner's profile must never persist, even on a
// deployment whose baked mode would otherwise allow it.
function persistenceAllowed() {
  if (window.oskarsAccountAccessBlocked?.()) return false;
  if (window.state?.isPublicProfileView) return false;
  return window.oskarsCapabilities ? window.oskarsCapabilities().canPersistPrivateState : true;
}

/**
 * Whether the current session may persist private state - the exact same
 * check save()/replaceStoredState()/saveRecoveryWorkspace() gate on.
 * Exposed so firestore-sync.js (issue #248) never runs a remote sync pass
 * anywhere local persistence itself is refused (viewer mode, or hydrated
 * public-profile state, issue #256).
 * @returns {boolean}
 */
window.oskarsPersistenceAllowed = persistenceAllowed;

function readOnlyViewerStatus() {
  storageStatus("Read-only — changes aren't saved", "viewer");
}

function markPersistenceStale(message) {
  staleWriteDetected = true;
  storageStatus(
    message || "Changed in another tab — reload before editing",
    "stale",
  );
}

function stampSnapshotForWrite(snapshot, writeCounter) {
  snapshot[PERSISTENCE_META_KEY] = {
    writeCounter,
    tabId: persistenceTabId,
    savedAt: new Date().toISOString(),
  };
  return snapshot;
}

function announcePersistenceWrite(writeCounter) {
  try {
    persistenceChannel?.postMessage({
      type: "saved",
      tabId: persistenceTabId,
      writeCounter,
    });
  } catch (err) {}
}

function setupPersistenceChannel() {
  if (typeof BroadcastChannel !== "function") return;
  try {
    persistenceChannel = new BroadcastChannel("oskars-state");
    persistenceChannel.onmessage = (event) => {
      let data = event?.data || {};
      if (data.type !== "saved" || data.tabId === persistenceTabId) return;
      let writeCounter = Number(data.writeCounter) || 0;
      if (writeCounter && writeCounter !== lastSeenWriteCounter)
        markPersistenceStale();
    };
  } catch (err) {
    persistenceChannel = null;
  }
}

function hasIndexedDB() {
  try {
    return Boolean(window.indexedDB);
  } catch (err) {
    return false;
  }
}

let storageStatusDismissTimer = null;

function storageStatus(message, status, actions = []) {
  if (!document?.querySelector || !document?.createElement || !document.body)
    return;
  let indicator = document.querySelector("#storageStatus");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "storageStatus";
    indicator.className = "storage-status";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    document.body.appendChild(indicator);
  }
  if (storageStatusDismissTimer) {
    clearTimeout(storageStatusDismissTimer);
    storageStatusDismissTimer = null;
  }
  indicator.hidden = false;
  indicator.className = `storage-status ${status || ""}`.trim();
  indicator.textContent = message;
  actions.forEach((action) => {
    let button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    indicator.appendChild(button);
  });
  if (status === "stale" && typeof window.location?.reload === "function") {
    let button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reload";
    button.addEventListener("click", () => window.location.reload());
    indicator.appendChild(button);
  }
  if (status === "saved" && !actions.length) {
    storageStatusDismissTimer = setTimeout(() => {
      indicator.hidden = true;
      storageStatusDismissTimer = null;
    }, 2800);
  }
}

window.showStorageStatus = storageStatus;

/**
 * Returns how the current startup load resolved browser persistence.
 * @returns {{found: boolean, source: string}} Load information.
 */
window.getPersistenceLoadInfo = function () {
  return { ...persistenceLoadInfo };
};

// Periodic backup reminder (issue #247): a local-mode browser's IndexedDB
// workspace is the *only* copy of the archive — unlike owner mode, where the
// published-repository/git workflow is the durable backup, so this never
// fires there. Reused across page loads via a flat oskars-prefixed
// localStorage key, following entry-loader.js's existing preferredTheme()
// convention.
window.OSKARS_BACKUP_REMINDER_INTERVAL_DAYS = 14;
const BACKUP_REMINDER_KEY = "oskars-backup-reminder-at";

function readBackupReminderStamp() {
  try {
    return localStorage.getItem(BACKUP_REMINDER_KEY);
  } catch (err) {
    return null;
  }
}

/**
 * Stamps that a backup was just taken or the reminder was just shown,
 * resetting the reminder interval. Called after a real backup download
 * (src/data/transfer.js) and whenever the reminder itself displays.
 */
window.noteBackupTaken = function () {
  try {
    localStorage.setItem(BACKUP_REMINDER_KEY, new Date().toISOString());
  } catch (err) {}
};

/**
 * Pure: whether enough time has passed since the last reminder/backup stamp
 * to show another one. Split out from isBackupReminderDue() so the interval
 * math is testable without touching persisted load state.
 * @param {string|null} lastStampIso ISO stamp of the last reminder/backup, or null/absent.
 * @param {number} nowMs Current time in epoch milliseconds.
 * @returns {boolean}
 */
window.backupReminderIntervalElapsed = function (lastStampIso, nowMs) {
  if (!lastStampIso) return true;
  let last = new Date(lastStampIso);
  if (Number.isNaN(last.getTime())) return true;
  let elapsedDays = (nowMs - last.getTime()) / 86400000;
  return elapsedDays >= window.OSKARS_BACKUP_REMINDER_INTERVAL_DAYS;
};

/**
 * Whether a periodic backup reminder is due. Only ever true in local mode,
 * for a session with an established archive (not a first-run/empty one —
 * see issue #252's onboarding, which already covers that moment).
 * @returns {boolean}
 */
window.isBackupReminderDue = function () {
  if (window.getRuntimeMode?.() !== "local") return false;
  if (!persistenceLoadInfo.found) return false;
  return window.backupReminderIntervalElapsed(
    readBackupReminderStamp(),
    Date.now(),
  );
};

function openStateDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve) => {
    let factory;
    try {
      factory = window.indexedDB;
    } catch (err) {
      factory = null;
    }
    if (!factory) {
      resolve(null);
      return;
    }
    let request;
    try {
      request = factory.open(
        window.OSKARS_DATABASE_NAME,
        window.OSKARS_DATABASE_VERSION,
      );
    } catch (err) {
      console.warn(
        "IndexedDB is unavailable; using localStorage fallback.",
        err,
      );
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      let database = request.result;
      if (!database.objectStoreNames.contains(window.OSKARS_STATE_STORE)) {
        database.createObjectStore(window.OSKARS_STATE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn(
        "Could not open IndexedDB; using localStorage fallback.",
        request.error,
      );
      resolve(null);
    };
    request.onblocked = () =>
      console.warn("IndexedDB upgrade is blocked by another Oskars tab.");
  });
  return databasePromise;
}

function readDatabaseState(database) {
  return new Promise((resolve, reject) => {
    let request = database
      .transaction(window.OSKARS_STATE_STORE, "readonly")
      .objectStore(window.OSKARS_STATE_STORE)
      .get(window.OSKARS_STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () =>
      reject(request.error || new Error("Could not read browser database."));
  });
}

function writeRecoveryDatabase(database, snapshot, options = {}) {
  return new Promise((resolve, reject) => {
    let transaction = database.transaction(
      window.OSKARS_STATE_STORE,
      "readwrite",
    );
    transaction
      .objectStore(window.OSKARS_STATE_STORE)
      .put(
        {
          workspace: snapshot,
          reason: String(options.reason || "workspace-replacement"),
          savedAt: new Date().toISOString(),
          ...(options.accountUid
            ? { accountUid: String(options.accountUid) }
            : {}),
        },
        window.OSKARS_RECOVERY_STATE_KEY,
      );
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () =>
      reject(transaction.error || new Error("Could not save recovery workspace."));
    transaction.onabort = transaction.onerror;
  });
}

function recoveryAccountUid(options = {}) {
  return String(
    options.accountUid ||
      window.state?.draftMetadata?.remoteSync?.uid ||
      window.getOskarsBrowserAccountUid?.() ||
      "",
  );
}

function recoveryVisibleToCurrentAccount(recovery) {
  if (!recovery || !window.oskarsAccountCanAccessRecovery) return true;
  return window.oskarsAccountCanAccessRecovery({
    currentUid: window.getFirebaseCurrentUser?.()?.uid,
    browserUid: window.getOskarsBrowserAccountUid?.(),
    recoveryUid: recovery.accountUid,
  });
}

function readRecoveryDatabase(database) {
  return new Promise((resolve, reject) => {
    let request = database
      .transaction(window.OSKARS_STATE_STORE, "readonly")
      .objectStore(window.OSKARS_STATE_STORE)
      .get(window.OSKARS_RECOVERY_STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () =>
      reject(request.error || new Error("Could not read recovery workspace."));
  });
}

function writeDatabaseState(database, snapshotSource, options = {}) {
  return new Promise((resolve, reject) => {
    let transaction = database.transaction(
      window.OSKARS_STATE_STORE,
      "readwrite",
    );
    let store = transaction.objectStore(window.OSKARS_STATE_STORE);
    let nextWriteCounter = 0;
    let writtenSnapshot = null;
    let request = store.get(window.OSKARS_STATE_KEY);
    request.onsuccess = () => {
      let current = request.result || null;
      let currentCounter = persistenceStamp(current);
      if (!options.allowOverwrite && currentCounter !== lastSeenWriteCounter) {
        transaction.abort();
        reject(staleWriteError());
        return;
      }
      nextWriteCounter = currentCounter + 1;
      // Assemble the snapshot only after the stale-tab check, then hand it
      // straight to IndexedDB. objectStore.put() synchronously takes its own
      // structured clone, so a preceding JSON stringify/parse clone only
      // doubled full-state work without improving snapshot consistency.
      try {
        writtenSnapshot =
          typeof snapshotSource === "function"
            ? snapshotSource()
            : snapshotSource;
        store.put(
          stampSnapshotForWrite(writtenSnapshot, nextWriteCounter),
          window.OSKARS_STATE_KEY,
        );
      } catch (err) {
        transaction.abort();
        reject(err);
      }
    };
    request.onerror = () =>
      reject(
        request.error ||
          new Error("Could not read browser database before save."),
      );
    transaction.oncomplete = () => {
      markPersistenceFresh(writtenSnapshot);
      announcePersistenceWrite(nextWriteCounter);
      resolve(true);
    };
    transaction.onerror = () =>
      reject(
        transaction.error || new Error("Could not save browser database."),
      );
    transaction.onabort = () => {
      if (transaction.error) reject(transaction.error);
    };
  });
}

function readLegacyState() {
  try {
    let data = localStorage.getItem("oskars");
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error("Failed to read legacy The Oskars data", err);
    return null;
  }
}

function writeFallbackState(snapshot, options = {}) {
  let current = readLegacyState();
  let currentCounter = persistenceStamp(current);
  if (!options.allowOverwrite && currentCounter !== lastSeenWriteCounter)
    throw staleWriteError();
  let nextWriteCounter = currentCounter + 1;
  stampSnapshotForWrite(snapshot, nextWriteCounter);
  localStorage.setItem("oskars", JSON.stringify(snapshot));
  markPersistenceFresh(snapshot);
  announcePersistenceWrite(nextWriteCounter);
  return true;
}

/**
 * Stores a recoverable workspace before canonical replacement. A no-op that
 * resolves false in viewer mode (issue #256) — nothing is ever written.
 * @param {Object} snapshot Browser workspace envelope.
 * @param {Object} [options] Recovery metadata.
 * @param {string} [options.reason] Replacement reason.
 * @param {string} [options.accountUid] Account that owns this recovery.
 * @returns {Promise<boolean>} Whether recovery was retained.
 */
window.saveRecoveryWorkspace = async function (snapshot, options = {}) {
  if (!persistenceAllowed()) return false;
  try {
    let accountUid = recoveryAccountUid(options);
    let database = await openStateDatabase();
    if (database)
      return await writeRecoveryDatabase(database, snapshot, {
        reason: options.reason,
        accountUid,
      });
    localStorage.setItem(
      window.OSKARS_FALLBACK_RECOVERY_KEY,
      JSON.stringify({
        workspace: snapshot,
        reason: String(options.reason || "workspace-replacement"),
        savedAt: new Date().toISOString(),
        ...(accountUid ? { accountUid } : {}),
      }),
    );
    return true;
  } catch (err) {
    console.error("Could not retain recovery workspace", err);
    storageStatus("Update paused — could not retain local recovery", "error");
    return false;
  }
};

/**
 * Reads the latest recoverable workspace.
 * @returns {Promise<Object|null>} Recovery record.
 */
window.readRecoveryWorkspace = async function () {
  try {
    let database = await openStateDatabase();
    if (database) {
      let recovery = await readRecoveryDatabase(database);
      return recoveryVisibleToCurrentAccount(recovery) ? recovery : null;
    }
    let stored = localStorage.getItem(window.OSKARS_FALLBACK_RECOVERY_KEY);
    let recovery = stored ? JSON.parse(stored) : null;
    return recoveryVisibleToCurrentAccount(recovery) ? recovery : null;
  } catch (err) {
    console.error("Could not read recovery workspace", err);
    return null;
  }
};

/**
 * Restores the latest recoverable workspace as current browser state.
 * @returns {Promise<boolean>} Whether recovery was restored.
 */
window.restoreRecoveryWorkspace = async function () {
  let recovery = await window.readRecoveryWorkspace();
  if (!recovery?.workspace) return false;
  let runtime = window.browserPersistenceToRuntimeState(recovery.workspace);
  return window.replaceStoredState(runtime, {
    message: "Recovery workspace restored",
    fallbackMessage: "Recovery workspace restored using fallback storage",
  });
};

async function flushScheduledSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!saveWaiters.length) return true;
  let waiters = saveWaiters.splice(0);
  let shouldScheduleWorkspaceSync = saveNeedsWorkspaceSync;
  saveNeedsWorkspaceSync = false;
  let saved = false;
  try {
    let database = await openStateDatabase();
    let doneWrite = window.startOskarsPerformance?.("save:write");
    if (database)
      await writeDatabaseState(database, () => {
        let doneSnapshot = window.startOskarsPerformance?.("save:snapshot");
        let snapshot = window.getBrowserPersistenceState();
        doneSnapshot?.();
        return snapshot;
      });
    else writeFallbackState(window.getBrowserPersistenceState());
    doneWrite?.(database ? "IndexedDB" : "localStorage");
    saved = true;
    if (window.isBackupReminderDue?.()) {
      window.noteBackupTaken();
      storageStatus("Saved locally · Back up your archive", "saved", [
        {
          label: "Back up now",
          run: () => {
            window.location.href = window.prepareOskarsAccountNavigation(
              "data.html",
            );
          },
        },
      ]);
    } else {
      storageStatus("Saved locally", "saved");
    }
  } catch (err) {
    if (err?.code === "OSKARS_STALE_STATE") {
      markPersistenceStale();
      waiters.forEach((resolve) => resolve(false));
      return false;
    }
    console.error("Failed to save The Oskars data", err);
    try {
      writeFallbackState(window.getBrowserPersistenceState());
      saved = true;
      storageStatus("Saved using fallback storage", "warning");
    } catch (fallbackError) {
      if (fallbackError?.code === "OSKARS_STALE_STATE") {
        markPersistenceStale();
        waiters.forEach((resolve) => resolve(false));
        return false;
      }
      console.error("Fallback save also failed", fallbackError);
      storageStatus("Save failed — download a backup", "error");
    }
  }
  // A successful local save is the trigger for a background cloud push
  // (issue #248) - debounced independently inside firestore-sync.js, so a
  // burst of edits produces one sync pass rather than one per save. A
  // no-op (never defined) when Firestore sync hasn't loaded or the user
  // isn't signed in - scheduleWorkspaceSync itself checks both.
  if (saved && shouldScheduleWorkspaceSync) {
    window.scheduleWorkspaceSync?.();
    window.scheduleSharedFilmMetadataSync?.();
    window.refreshPendingSyncBadge?.();
  }
  waiters.forEach((resolve) => resolve(saved));
  return saved;
}

/**
 * Persists current state immediately or through the shared debounce queue.
 * A synchronous no-op that reports a read-only status and returns false in
 * viewer mode (issue #256) — the single choke point every mutation in the
 * app funnels through, so this is the one place that needs to refuse.
 * @param {Object} [options] Save controls.
 * @param {boolean} [options.rebuild] Whether to force, skip, or conditionally perform an aggregate rebuild.
 * @param {boolean} [options.immediate] Whether to flush the IndexedDB queue immediately.
 * @param {boolean} [options.scheduleSync=true] Whether this local write represents a change that should schedule cloud synchronization. Sync-internal bookkeeping passes false to avoid save/sync trigger loops.
 * @returns {boolean|Promise<boolean>} Save result or queued save result.
 */
window.save = function (options = {}) {
  if (!persistenceAllowed()) {
    readOnlyViewerStatus();
    return false;
  }
  if (options.rebuild === true && window.rebuildAggregates)
    window.rebuildAggregates();
  else if (options.rebuild !== false) window.ensureAggregatesFresh?.();
  if (!hasIndexedDB()) {
    try {
      let doneSnapshot = window.startOskarsPerformance?.(
        "save:fallbackSnapshot",
      );
      writeFallbackState(window.getBrowserPersistenceState());
      doneSnapshot?.();
      storageStatus("Saved using fallback storage", "warning");
      if (options.scheduleSync !== false) {
        window.scheduleWorkspaceSync?.();
        window.scheduleSharedFilmMetadataSync?.();
        window.refreshPendingSyncBadge?.();
      }
      return true;
    } catch (err) {
      if (err?.code === "OSKARS_STALE_STATE") {
        markPersistenceStale();
        return false;
      }
      console.error("Failed to save The Oskars data", err);
      storageStatus("Save failed — download a backup", "error");
      return false;
    }
  }
  storageStatus("Saving…", "saving");
  if (options.scheduleSync !== false) saveNeedsWorkspaceSync = true;
  let promise = new Promise((resolve) => saveWaiters.push(resolve));
  if (options.immediate) flushScheduledSave();
  else {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushScheduledSave, 180);
  }
  return promise;
};

/**
 * Flushes all callers waiting on the debounced persistence queue.
 * @returns {Promise<boolean>} Whether state was saved successfully.
 */
window.flushOskarsSave = flushScheduledSave;

/**
 * Replaces global state and overwrites persisted state regardless of
 * stale-tab counters. A no-op that reports a read-only status and returns
 * false in viewer mode (issue #256) — neither the in-memory replacement nor
 * any write happens, so import/clear/recovery-restore callers all refuse
 * safely through this one function.
 * @param {OskarsState|Object} nextState Replacement source state.
 * @param {Object} [options] User-facing status messages.
 * @param {string} [options.message] IndexedDB success message.
 * @param {string} [options.fallbackMessage] localStorage success message.
 * @param {boolean} [options.scheduleSync=true] Whether replacement should schedule cloud reconciliation.
 * @returns {Promise<boolean>} Whether replacement state was persisted.
 */
window.replaceStoredState = async function (nextState, options = {}) {
  if (!persistenceAllowed()) {
    readOnlyViewerStatus();
    return false;
  }
  window.state = Object.assign(window.createEmptyState(), nextState || {});
  if (window.rebuildAggregates) window.rebuildAggregates();
  let saved = false;
  try {
    let database = await openStateDatabase();
    if (database) {
      await writeDatabaseState(database, () => window.getBrowserPersistenceState(), {
        allowOverwrite: true,
      });
      try {
        localStorage.removeItem("oskars");
      } catch (err) {}
    } else {
      writeFallbackState(window.getBrowserPersistenceState(), {
        allowOverwrite: true,
      });
    }
    saved = true;
    storageStatus(options.message || "Saved locally", "saved");
  } catch (err) {
    console.error("Failed to replace The Oskars data", err);
    try {
      writeFallbackState(window.getBrowserPersistenceState(), {
        allowOverwrite: true,
      });
      saved = true;
      storageStatus(
        options.fallbackMessage || "Saved using fallback storage",
        "warning",
      );
    } catch (fallbackError) {
      console.error("Fallback save also failed", fallbackError);
      storageStatus("Save failed — download a backup", "error");
    }
  }
  // Same trigger as flushScheduledSave() (issue #248): replaceStoredState()
  // is the write path for local replacement, recovery restore, and canonical
  // adoption, none of which go through window.save(). Callers that are
  // deliberately detaching this browser suppress the trigger so the retained
  // cloud copy cannot immediately refill the newly emptied local archive.
  if (saved && options.scheduleSync !== false) {
    window.scheduleWorkspaceSync?.();
    window.scheduleSharedFilmMetadataSync?.();
    window.refreshPendingSyncBadge?.();
  }
  loadPromise = window.state;
  return saved;
};

/**
 * Creates draft metadata that distinguishes an intentional clear from a clean,
 * outdated copy that owner-mode startup may safely replace from publication.
 * @returns {Object} Dirty draft metadata for the cleared local state.
 */
function intentionalClearDraftMetadata() {
  let plan = window.getStartupReconciliationPlan?.() || {};
  let publishedRevision = String(plan.publishedRevision || "");
  let baseRevision = String(
    publishedRevision ||
      window.state?.draftMetadata?.baseRevision ||
      plan.baseRevision ||
      "",
  );
  return {
    baseRevision,
    dirty: true,
    changedAt: new Date().toISOString(),
    reason: "clear-all-data",
    reconciliationStatus: "unpublished",
    ...(publishedRevision ? { publishedRevision } : {}),
  };
}

/**
 * Replaces persisted data with empty, fully migrated local state.
 * @param {Object} [options] Clear behavior.
 * @param {boolean} [options.scheduleSync=true] Whether cloud reconciliation is scheduled afterward.
 * @returns {Promise<boolean>} Whether cleared state was persisted.
 */
window.clearStoredOskarsData = function (options = {}) {
  let cleared = window.createClearedLocalState
    ? window.createClearedLocalState()
    : window.createEmptyState();
  cleared.draftMetadata = intentionalClearDraftMetadata();
  return window.replaceStoredState(cleared, {
    message: "Local data cleared",
    fallbackMessage: "Local data cleared using fallback storage",
    scheduleSync: options.scheduleSync !== false,
  });
};

/**
 * Validates source state, runs credit migration, and rebuilds derived aggregates.
 * @param {OskarsState|Object} imported Parsed application state.
 * @returns {OskarsState} Hydrated global state.
 * @throws {Error} When the value lacks a valid source-period object.
 */
window.hydrateState = function (imported) {
  let done = window.startOskarsPerformance?.("hydrateState");
  if (imported?.canonicalSchemaVersion !== undefined) {
    let canonical = imported;
    imported = window.canonicalDataToRuntimeState(canonical);
    imported.draftMetadata = {
      baseRevision: window.canonicalDataRevision(canonical),
      dirty: false,
      lastLocalSaveAt: new Date().toISOString(),
    };
  } else if (imported?.workspaceSchemaVersion !== undefined) {
    imported = window.browserPersistenceToRuntimeState(imported);
  } else {
    imported = window.browserPersistenceToRuntimeState(imported);
  }
  if (
    !imported ||
    typeof imported !== "object" ||
    Array.isArray(imported) ||
    !imported.years ||
    typeof imported.years !== "object"
  ) {
    throw new Error("Invalid The Oskars app state");
  }
  window.migrateCreditSchema(imported);
  window.state = Object.assign(window.createEmptyState(), imported);
  window.state.years = imported.years;
  window.state.selectedYears = Array.isArray(imported.selectedYears)
    ? imported.selectedYears
    : [];
  // JSON contains compact source state; all lookup indexes are reconstructed.
  if (window.rebuildAggregates) window.rebuildAggregates();
  done?.();
  return window.state;
};

/**
 * Loads persisted state once, preferring IndexedDB and migrating legacy localStorage data.
 * @returns {OskarsState|Promise<OskarsState>} Loaded state or the shared in-flight load.
 */
window.load = function () {
  if (loadPromise) return loadPromise;
  if (!hasIndexedDB()) {
    let legacy = readLegacyState();
    if (legacy) {
      try {
        window.hydrateState(legacy);
        persistenceLoadInfo = { found: true, source: "localStorage" };
        markPersistenceFresh(legacy);
        writeFallbackState(window.getBrowserPersistenceState(), {
          allowOverwrite: true,
        });
        storageStatus("Using fallback browser storage", "warning");
      } catch (err) {
        console.error("Failed to load saved The Oskars data", err);
        persistenceLoadInfo = { found: false, source: "invalid-localStorage" };
      }
    } else {
      persistenceLoadInfo = { found: false, source: "none" };
      markPersistenceFresh(null);
    }
    loadPromise = window.state;
    return loadPromise;
  }
  loadPromise = (async () => {
    let done = window.startOskarsPerformance?.("loadStoredState");
    let database = await openStateDatabase();
    try {
      let imported = database ? await readDatabaseState(database) : null;
      if (imported) {
        window.hydrateState(imported);
        persistenceLoadInfo = { found: true, source: "indexedDB" };
        markPersistenceFresh(imported);
        if (imported.workspaceSchemaVersion !== window.OSKARS_WORKSPACE_SCHEMA_VERSION)
          await writeDatabaseState(
            database,
            () => window.getBrowserPersistenceState(),
            { allowOverwrite: true },
          );
        storageStatus("Saved locally", "saved");
        done?.("IndexedDB");
        return window.state;
      }
      let legacy = readLegacyState();
      if (legacy) {
        window.hydrateState(legacy);
        persistenceLoadInfo = { found: true, source: "localStorage" };
        markPersistenceFresh(legacy);
        if (database) {
          await writeDatabaseState(
            database,
            () => window.getBrowserPersistenceState(),
            { allowOverwrite: true },
          );
          try {
            localStorage.removeItem("oskars");
          } catch (err) {}
          storageStatus("Moved data to IndexedDB", "saved");
        } else {
          storageStatus("Using fallback browser storage", "warning");
        }
        done?.(database ? "localStorage migration" : "localStorage");
        return window.state;
      }
      persistenceLoadInfo = { found: false, source: "none" };
    } catch (err) {
      console.error("Failed to load saved The Oskars data", err);
      persistenceLoadInfo = { found: false, source: "invalid-browser-state" };
      storageStatus("Could not load saved data", "error");
    }
    markPersistenceFresh(null);
    done?.();
    return window.state;
  })();
  return loadPromise;
};

setupPersistenceChannel();
window.addEventListener?.("pagehide", () => {
  flushScheduledSave();
});
