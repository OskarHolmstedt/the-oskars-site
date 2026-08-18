/**
 * @file Firestore I/O for the revisioned workspace sync engine (issue
 * #248): reads/writes manifest and shard documents under
 * `/users/<uid>/sections/<sectionKey>[/shards/<shardKey>]`, wraps every
 * write in bounded retry with uncertain-outcome verification, and drives
 * the sign-in/reconnect/focus/after-save triggers. Chunking
 * (workspace-sections.js) and three-way planning (workspace-sync-plan.js)
 * stay pure and side-effect-free; this is the only file that touches the
 * network, mirroring how firebase-client.js is the only file that touches
 * the Firebase Auth SDK. See docs/firestore-workspace-sync-decision.md for
 * the full design and its rationale.
 */

let firestoreModulePromise = null;
let firestoreDbInstance = null;
let workspaceSyncInFlight = null;
let workspaceSyncQueued = false;
let pushDebounceTimer = null;

const RETRYABLE_FIRESTORE_ERROR_CODES = new Set([
  "unavailable",
  "deadline-exceeded",
  "aborted",
  "internal",
  "cancelled",
]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firestoreSdkUrl() {
  return `https://www.gstatic.com/firebasejs/${window.OSKARS_FIREBASE_SDK_VERSION || "12.17.1"}/firebase-firestore.js`;
}

/**
 * Loads the Firestore SDK and attaches it to the shared signed-in Firebase
 * app (firebase-client.js's ensureFirebaseApp()). Never initializes a
 * second app instance.
 * @returns {Promise<{firestoreModule: Object, db: Object}|null>} Null when unconfigured or Firebase couldn't be reached.
 */
async function ensureFirestoreDb() {
  if (!window.oskarsFirebaseConfigured?.()) return null;
  if (!firestoreModulePromise) firestoreModulePromise = import(firestoreSdkUrl());
  let [firestoreModule, appReady] = await Promise.all([
    firestoreModulePromise,
    window.ensureFirebaseApp?.(),
  ]);
  if (!appReady) return null;
  if (!firestoreDbInstance) firestoreDbInstance = firestoreModule.getFirestore(appReady.app);
  return { firestoreModule, db: firestoreDbInstance };
}

function currentFirebaseUser() {
  return window.getFirebaseCurrentUser?.() || null;
}

function sectionManifestRef(firestoreModule, db, uid, sectionKey) {
  return firestoreModule.doc(db, "users", uid, "sections", sectionKey);
}

function sectionShardRef(firestoreModule, db, uid, sectionKey, shardKey) {
  return firestoreModule.doc(db, "users", uid, "sections", sectionKey, "shards", shardKey);
}

async function readSectionManifest(firestoreModule, db, uid, sectionKey) {
  let snapshot = await firestoreModule.getDoc(
    sectionManifestRef(firestoreModule, db, uid, sectionKey),
  );
  if (!snapshot.exists()) return { shardKeys: [], shardRevisions: {} };
  let data = snapshot.data() || {};
  return {
    shardKeys: Array.isArray(data.shardKeys) ? data.shardKeys : [],
    shardRevisions: data.shardRevisions && typeof data.shardRevisions === "object"
      ? data.shardRevisions
      : {},
  };
}

async function fetchShardValues(firestoreModule, db, uid, sectionKey, shardKeys) {
  let entries = await Promise.all(
    shardKeys.map(async (shardKey) => {
      let snapshot = await firestoreModule.getDoc(
        sectionShardRef(firestoreModule, db, uid, sectionKey, shardKey),
      );
      return [shardKey, snapshot.exists() ? snapshot.data()?.value : undefined];
    }),
  );
  let values = {};
  entries.forEach(([shardKey, value]) => {
    if (value !== undefined) values[shardKey] = value;
  });
  return values;
}

/**
 * One section's manifest+shard writes in a single transaction: reads the
 * manifest once, checks every touched shard's remote revision against its
 * expected base, writes/deletes shard documents, and updates the manifest
 * - atomically, so a precondition mismatch aborts the whole batch rather
 * than partially applying (the "expected base revision" conflict check the
 * issue calls for, via Firestore's own transaction primitive).
 * @throws {Error} `OSKARS_SYNC_CONFLICT` (with `.shardKeys`) when any touched shard's remote revision no longer matches its expected base.
 */
async function pushSectionTransaction(firestoreModule, db, uid, sectionKey, batch) {
  let { pushShards, deleteShardKeys, expectedRevisions, newRevisions } = batch;
  let manifestRef = sectionManifestRef(firestoreModule, db, uid, sectionKey);
  await firestoreModule.runTransaction(db, async (tx) => {
    let manifestSnap = await tx.get(manifestRef);
    let manifest = manifestSnap.exists()
      ? manifestSnap.data()
      : { shardKeys: [], shardRevisions: {} };
    let currentRevisions = manifest.shardRevisions || {};
    let touchedKeys = [...Object.keys(pushShards), ...deleteShardKeys];
    let conflicted = touchedKeys.filter(
      (shardKey) => (currentRevisions[shardKey] || "") !== (expectedRevisions[shardKey] || ""),
    );
    if (conflicted.length) {
      let error = new Error(`Cloud sync conflict in ${sectionKey}: ${conflicted.join(", ")}`);
      error.code = "OSKARS_SYNC_CONFLICT";
      error.sectionKey = sectionKey;
      error.shardKeys = conflicted;
      throw error;
    }
    let nextShardRevisions = { ...currentRevisions };
    let nextShardKeys = new Set(manifest.shardKeys || []);
    Object.entries(pushShards).forEach(([shardKey, value]) => {
      tx.set(sectionShardRef(firestoreModule, db, uid, sectionKey, shardKey), {
        value,
        revision: newRevisions[shardKey],
        updatedAt: firestoreModule.serverTimestamp(),
      });
      nextShardRevisions[shardKey] = newRevisions[shardKey];
      nextShardKeys.add(shardKey);
    });
    deleteShardKeys.forEach((shardKey) => {
      tx.delete(sectionShardRef(firestoreModule, db, uid, sectionKey, shardKey));
      delete nextShardRevisions[shardKey];
      nextShardKeys.delete(shardKey);
    });
    tx.set(manifestRef, {
      shardKeys: [...nextShardKeys].sort(),
      shardRevisions: nextShardRevisions,
      updatedAt: firestoreModule.serverTimestamp(),
    });
  });
}

function isRetryableFirestoreError(err) {
  return RETRYABLE_FIRESTORE_ERROR_CODES.has(String(err?.code || "").replace(/^firestore\//, ""));
}

/**
 * Pushes one section's dirty shards with bounded exponential-backoff retry
 * on transient failures. After the final attempt fails (including a
 * non-retryable error), re-reads the manifest before reporting failure:
 * a network error can lose the acknowledgement of a write that actually
 * committed server-side, and this must never be reported as failed (which
 * would leave the shard dirty and cause a spurious future conflict) nor
 * silently assumed successful without checking - see
 * docs/canonical-publication-decision.md's identical "uncertain until
 * verified" posture for Sheets write-back, applied here to Firestore.
 * @returns {Promise<{ok: boolean, conflict?: boolean, verifiedAfterError?: boolean, error?: Error}>}
 */
async function pushSectionWithRetryAndVerification(firestoreModule, db, uid, sectionKey, batch) {
  let attempt = 0;
  let maxAttempts = 3;
  while (true) {
    attempt += 1;
    try {
      await pushSectionTransaction(firestoreModule, db, uid, sectionKey, batch);
      return { ok: true };
    } catch (err) {
      if (err?.code === "OSKARS_SYNC_CONFLICT") return { ok: false, conflict: true, error: err };
      if (isRetryableFirestoreError(err) && attempt < maxAttempts) {
        await delay(300 * 2 ** attempt);
        continue;
      }
      let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey).catch(
        () => null,
      );
      let applied =
        manifest &&
        Object.entries(batch.newRevisions).every(
          ([shardKey, revision]) => (manifest.shardRevisions || {})[shardKey] === revision,
        ) &&
        batch.deleteShardKeys.every((shardKey) => !manifest.shardKeys.includes(shardKey));
      if (applied) return { ok: true, verifiedAfterError: true };
      console.error(`Cloud sync push failed for section ${sectionKey}`, err);
      return { ok: false, error: err };
    }
  }
}

let emptyCanonicalSections = null;

function getEmptyCanonicalSections() {
  if (!emptyCanonicalSections)
    emptyCanonicalSections = window.getCanonicalData(window.createEmptyState(), {
      clone: false,
    });
  return emptyCanonicalSections;
}

function shardRevisionsOf(sectionKey, sectionValue) {
  let { shards } = window.chunkWorkspaceSection(sectionKey, sectionValue);
  let revisions = {};
  Object.keys(shards).forEach((shardKey) => {
    revisions[shardKey] = window.workspaceShardRevision(shards[shardKey]);
  });
  return { shards, revisions };
}

/**
 * Merges one or more newly pulled section values into the live runtime
 * state: rebuilds a complete canonical document from current state plus
 * the pulled overrides, validates it, converts it back to runtime shape,
 * and rebuilds derived aggregates. Shared by the main sync pass and
 * explicit conflict resolution's "keep remote" choice.
 * @param {Record<string, *>} pulledSectionValues Section key -> new value.
 */
function applyPulledSectionValues(pulledSectionValues) {
  if (!Object.keys(pulledSectionValues).length) return;
  let canonical = window.getCanonicalData(window.state, { clone: false });
  let merged = {
    ...canonical,
    ...pulledSectionValues,
    canonicalSchemaVersion: window.OSKARS_CANONICAL_SCHEMA_VERSION,
  };
  let validated = window.assertCanonicalData(window.migrateCanonicalData(merged));
  let runtimeSource = window.canonicalDataToRuntimeState(validated);
  Object.assign(window.state, runtimeSource);
  if (window.rebuildAggregates) window.rebuildAggregates();
}

function remoteSyncState() {
  return window.state.draftMetadata?.remoteSync || { shards: {}, conflicts: [] };
}

async function processSectionSync(firestoreModule, db, uid, sectionKey, canonical) {
  let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey);
  let { shards: localShards, revisions: localShardRevisions } = shardRevisionsOf(
    sectionKey,
    canonical[sectionKey],
  );
  let { revisions: emptyDefaultShardRevisions } = shardRevisionsOf(
    sectionKey,
    getEmptyCanonicalSections()[sectionKey],
  );
  let lastSyncedShardRevisions = { ...(remoteSyncState().shards?.[sectionKey] || {}) };
  let plan = window.planWorkspaceSectionSync({
    localShardRevisions,
    emptyDefaultShardRevisions,
    remoteShardRevisions: manifest.shardRevisions,
    lastSyncedShardRevisions,
  });

  let result = {
    sectionKey,
    pushedCount: 0,
    pulledCount: 0,
    conflicts: [],
    pulledValue: undefined,
    hadError: false,
    lastSyncedShardRevisions,
  };

  plan.conflictKeys.forEach((shardKey) => {
    result.conflicts.push({
      sectionKey,
      shardKey,
      localRevision: localShardRevisions[shardKey] || "",
      remoteRevision: manifest.shardRevisions[shardKey] || "",
    });
  });

  if (plan.pullKeys.length) {
    try {
      let pulledValues = await fetchShardValues(firestoreModule, db, uid, sectionKey, plan.pullKeys);
      let mergedShardValues = { ...localShards };
      plan.pullKeys.forEach((shardKey) => {
        if (shardKey in pulledValues) mergedShardValues[shardKey] = pulledValues[shardKey];
        else delete mergedShardValues[shardKey]; // remote no longer has this shard
        lastSyncedShardRevisions[shardKey] = manifest.shardRevisions[shardKey] || "";
      });
      result.pulledValue = window.reassembleWorkspaceSection(sectionKey, mergedShardValues);
      result.pulledCount = plan.pullKeys.length;
    } catch (err) {
      console.error(`Cloud sync pull failed for section ${sectionKey}`, err);
      result.hadError = true;
    }
  }

  if (plan.pushKeys.length || plan.deleteKeys.length) {
    let pushShards = {};
    let newRevisions = {};
    plan.pushKeys.forEach((shardKey) => {
      pushShards[shardKey] = localShards[shardKey];
      newRevisions[shardKey] = localShardRevisions[shardKey];
    });
    let expectedRevisions = {};
    [...plan.pushKeys, ...plan.deleteKeys].forEach((shardKey) => {
      expectedRevisions[shardKey] = manifest.shardRevisions[shardKey] || "";
    });
    let pushed = await pushSectionWithRetryAndVerification(firestoreModule, db, uid, sectionKey, {
      pushShards,
      deleteShardKeys: plan.deleteKeys,
      expectedRevisions,
      newRevisions,
    });
    if (pushed.ok) {
      plan.pushKeys.forEach((shardKey) => {
        lastSyncedShardRevisions[shardKey] = newRevisions[shardKey];
      });
      plan.deleteKeys.forEach((shardKey) => {
        delete lastSyncedShardRevisions[shardKey];
      });
      result.pushedCount = plan.pushKeys.length + plan.deleteKeys.length;
    } else if (pushed.conflict) {
      [...plan.pushKeys, ...plan.deleteKeys].forEach((shardKey) =>
        result.conflicts.push({
          sectionKey,
          shardKey,
          localRevision: localShardRevisions[shardKey] || "",
          remoteRevision: "",
        }),
      );
    } else {
      result.hadError = true;
    }
  }

  // A shard that already matched (noop) still deserves a recorded
  // baseline on first contact, so a later real change has something to
  // compare against instead of re-running bootstrap logic indefinitely.
  plan.shardKeys.forEach((shardKey) => {
    if (
      plan.plans[shardKey].action === "noop" &&
      !(shardKey in lastSyncedShardRevisions)
    ) {
      let revision = localShardRevisions[shardKey] || manifest.shardRevisions[shardKey] || "";
      if (revision) lastSyncedShardRevisions[shardKey] = revision;
    }
  });

  result.lastSyncedShardRevisions = lastSyncedShardRevisions;
  return result;
}

async function performWorkspaceSync(options = {}) {
  if (!window.oskarsPersistenceAllowed?.()) return { ok: true, reason: "not-allowed" };
  let user = currentFirebaseUser();
  if (!user) return { ok: true, reason: "signed-out" };
  let ready = await ensureFirestoreDb();
  if (!ready) return { ok: false, reason: "unconfigured" };
  let { firestoreModule, db } = ready;
  let uid = user.uid;

  let canonical = window.getCanonicalData(window.state, { clone: false });
  let sectionKeys = window.OSKARS_CANONICAL_SECTION_KEYS || [];
  let sectionResults = await Promise.all(
    sectionKeys.map((sectionKey) =>
      processSectionSync(firestoreModule, db, uid, sectionKey, canonical).catch((err) => {
        console.error(`Cloud sync failed for section ${sectionKey}`, err);
        return { sectionKey, pushedCount: 0, pulledCount: 0, conflicts: [], hadError: true, lastSyncedShardRevisions: remoteSyncState().shards?.[sectionKey] || {} };
      }),
    ),
  );

  let nextShards = {};
  let pulledSectionValues = {};
  let conflicts = [];
  let pushedCount = 0;
  let pulledCount = 0;
  let hadError = false;
  sectionResults.forEach((result) => {
    nextShards[result.sectionKey] = result.lastSyncedShardRevisions;
    if (result.pulledValue !== undefined) pulledSectionValues[result.sectionKey] = result.pulledValue;
    conflicts.push(...result.conflicts);
    pushedCount += result.pushedCount;
    pulledCount += result.pulledCount;
    hadError = hadError || result.hadError;
  });

  applyPulledSectionValues(pulledSectionValues);

  window.state.draftMetadata = {
    ...(window.state.draftMetadata || {}),
    remoteSync: {
      shards: nextShards,
      lastSyncAt: new Date().toISOString(),
      lastSyncReason: String(options.reason || ""),
      lastPushCount: pushedCount,
      lastPullCount: pulledCount,
      conflicts,
      hadError,
    },
  };

  let stateChanged = Object.keys(pulledSectionValues).length > 0;
  if (stateChanged || pushedCount || conflicts.length || hadError) {
    let saving = window.save({ immediate: true, rebuild: false });
    if (saving?.then) await saving;
  }

  window.reportWorkspaceSyncStatus?.({ pushedCount, pulledCount, conflicts, hadError, stateChanged });
  return { ok: !hadError, pushedCount, pulledCount, conflicts, hadError };
}

/**
 * Runs a full cloud sync pass across every workspace section: pulls
 * remote-only changes, pushes local-only changes, and records (without
 * auto-resolving) any genuine concurrent conflict. Coalesces overlapping
 * calls - a pass already running queues at most one more, rather than
 * running N passes for N near-simultaneous triggers. A safe no-op when
 * signed out, unconfigured, or persistence itself is disallowed (viewer
 * mode / public-profile view).
 * @param {{reason?: string}} [options] Diagnostic trigger label.
 * @returns {Promise<{ok: boolean, reason?: string, pushedCount?: number, pulledCount?: number, conflicts?: Array, hadError?: boolean}>}
 */
window.runWorkspaceSync = function (options = {}) {
  if (workspaceSyncInFlight) {
    workspaceSyncQueued = true;
    return workspaceSyncInFlight;
  }
  workspaceSyncInFlight = performWorkspaceSync(options)
    .catch((err) => {
      console.error("Cloud sync pass failed", err);
      return { ok: false, error: err };
    })
    .finally(() => {
      workspaceSyncInFlight = null;
      if (workspaceSyncQueued) {
        workspaceSyncQueued = false;
        window.runWorkspaceSync({ reason: "queued" });
      }
    });
  return workspaceSyncInFlight;
};

/**
 * Schedules a debounced background sync pass (issue #248) - called after
 * every successful local save, so a burst of edits produces one sync pass
 * rather than one per keystroke. A no-op when signed out or unconfigured.
 */
window.scheduleWorkspaceSync = function () {
  if (!currentFirebaseUser()) return;
  if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    window.runWorkspaceSync({ reason: "after-save" });
  }, 2000);
};

/**
 * Returns the conflicts recorded by the most recent sync pass - shards
 * where local and remote both changed since they last agreed, requiring
 * an explicit choice (never auto-resolved).
 * @returns {Array<{sectionKey: string, shardKey: string, localRevision: string, remoteRevision: string}>}
 */
window.getWorkspaceSyncConflicts = function () {
  return remoteSyncState().conflicts || [];
};

function recordShardSynced(sectionKey, shardKey, revision) {
  let remoteSync = window.cloneRecord(remoteSyncState());
  remoteSync.shards = remoteSync.shards || {};
  remoteSync.shards[sectionKey] = remoteSync.shards[sectionKey] || {};
  if (revision) remoteSync.shards[sectionKey][shardKey] = revision;
  else delete remoteSync.shards[sectionKey][shardKey];
  remoteSync.conflicts = (remoteSync.conflicts || []).filter(
    (conflict) => !(conflict.sectionKey === sectionKey && conflict.shardKey === shardKey),
  );
  window.state.draftMetadata = { ...(window.state.draftMetadata || {}), remoteSync };
}

/**
 * Resolves one recorded conflict by an explicit owner choice - never
 * automatic. "keep-remote" adopts the cloud value for this shard,
 * discarding this device's conflicting local content. "keep-local"
 * force-pushes this device's current content, re-checking the remote
 * revision at write time (not from the stale conflict snapshot), so a
 * third concurrent change is caught fresh instead of blindly overwritten.
 * @param {string} sectionKey Section the conflicted shard belongs to.
 * @param {string} shardKey Conflicted shard key.
 * @param {'keep-local'|'keep-remote'} resolution Owner's explicit choice.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
window.resolveWorkspaceSyncConflict = async function (sectionKey, shardKey, resolution) {
  let user = currentFirebaseUser();
  let ready = user ? await ensureFirestoreDb() : null;
  if (!ready || !user) return { ok: false, reason: "unavailable" };
  let { firestoreModule, db } = ready;
  let uid = user.uid;
  let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey);
  let remoteRevision = manifest.shardRevisions[shardKey] || "";

  if (resolution === "keep-remote") {
    let pulledValues = await fetchShardValues(firestoreModule, db, uid, sectionKey, [shardKey]);
    let canonical = window.getCanonicalData(window.state, { clone: false });
    let { shards: localShards } = window.chunkWorkspaceSection(sectionKey, canonical[sectionKey]);
    let mergedShardValues = { ...localShards };
    if (shardKey in pulledValues) mergedShardValues[shardKey] = pulledValues[shardKey];
    else delete mergedShardValues[shardKey];
    applyPulledSectionValues({
      [sectionKey]: window.reassembleWorkspaceSection(sectionKey, mergedShardValues),
    });
    recordShardSynced(sectionKey, shardKey, remoteRevision);
    let saving = window.save({ immediate: true, rebuild: false });
    if (saving?.then) await saving;
    return { ok: true };
  }

  let canonical = window.getCanonicalData(window.state, { clone: false });
  let { shards: localShards } = window.chunkWorkspaceSection(sectionKey, canonical[sectionKey]);
  let localExists = shardKey in localShards;
  let newRevision = localExists ? window.workspaceShardRevision(localShards[shardKey]) : "";
  let pushed = await pushSectionWithRetryAndVerification(firestoreModule, db, uid, sectionKey, {
    pushShards: localExists ? { [shardKey]: localShards[shardKey] } : {},
    deleteShardKeys: localExists ? [] : [shardKey],
    expectedRevisions: { [shardKey]: remoteRevision },
    newRevisions: { [shardKey]: newRevision },
  });
  if (!pushed.ok) return { ok: false, reason: pushed.conflict ? "changed-again" : "error" };
  recordShardSynced(sectionKey, shardKey, newRevision);
  let saving = window.save({ immediate: true, rebuild: false });
  if (saving?.then) await saving;
  return { ok: true };
};

/**
 * Renders the outcome of a sync pass through the same corner status badge
 * (src/core/persistence.js's showStorageStatus) bootstrap.js's canonical
 * reconciliation and persistence.js's stale-tab detection already use, so
 * cloud sync doesn't introduce a second status UI paradigm. A conflict
 * shows the first pending shard's section with an explicit choice - never
 * auto-resolved; resolving it triggers the next sync pass, which surfaces
 * the next conflict if more than one is pending (deliberately one at a
 * time rather than a dedicated multi-conflict review page, proportionate
 * to a personal archive where concurrent edits to the same shard are rare).
 * A quiet, uneventful pass (nothing pushed, pulled, or conflicted) reports
 * nothing, leaving the prior "Saved locally" status visible.
 * @param {{pushedCount: number, pulledCount: number, conflicts: Array, hadError: boolean}} outcome
 */
window.reportWorkspaceSyncStatus = function ({ pushedCount, pulledCount, conflicts, hadError }) {
  if (conflicts && conflicts.length) {
    let first = conflicts[0];
    let label =
      conflicts.length > 1
        ? `Cloud sync conflict in ${first.sectionKey} (${conflicts.length} items need a decision)`
        : `Cloud sync conflict in ${first.sectionKey} — changed on this device and elsewhere`;
    window.showStorageStatus?.(label, "warning", [
      {
        label: "Keep this device's version",
        run: () =>
          window.resolveWorkspaceSyncConflict(first.sectionKey, first.shardKey, "keep-local"),
      },
      {
        label: "Use the other device's version",
        run: () =>
          window.resolveWorkspaceSyncConflict(first.sectionKey, first.shardKey, "keep-remote"),
      },
    ]);
    return;
  }
  if (hadError) {
    window.showStorageStatus?.("Cloud sync paused — will retry", "warning");
    return;
  }
  if (pushedCount || pulledCount) window.showStorageStatus?.("Synced to cloud", "saved");
};

/**
 * Reconstructs a complete, independently valid canonical document straight
 * from Firestore, without consulting local state at all - satisfies the
 * "reconstruct the complete archive from Firestore alone" requirement
 * (issue #248) through the owner's existing sign-in, no separate
 * admin-credential tool needed. Callers feed the result through the
 * existing import pipeline (window.parseCanonicalData-shaped validation
 * already applies via assertCanonicalData below).
 * @returns {Promise<{ok: boolean, canonical?: Object, error?: string}>}
 */
window.fetchCanonicalDataFromCloud = async function () {
  let user = currentFirebaseUser();
  if (!user) return { ok: false, error: "signed-out" };
  let ready = await ensureFirestoreDb();
  if (!ready) return { ok: false, error: "unconfigured" };
  let { firestoreModule, db } = ready;
  let uid = user.uid;
  try {
    let sectionKeys = window.OSKARS_CANONICAL_SECTION_KEYS || [];
    let sections = await Promise.all(
      sectionKeys.map(async (sectionKey) => {
        let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey);
        let shardValues = await fetchShardValues(
          firestoreModule,
          db,
          uid,
          sectionKey,
          manifest.shardKeys,
        );
        return [sectionKey, window.reassembleWorkspaceSection(sectionKey, shardValues)];
      }),
    );
    let canonical = { canonicalSchemaVersion: window.OSKARS_CANONICAL_SCHEMA_VERSION };
    sections.forEach(([sectionKey, value]) => {
      canonical[sectionKey] = value;
    });
    return { ok: true, canonical: window.assertCanonicalData(window.migrateCanonicalData(canonical)) };
  } catch (err) {
    console.error("Could not reconstruct canonical data from the cloud", err);
    return { ok: false, error: String(err?.message || err) };
  }
};

// Self-wiring triggers (issue #248's "Triggers" section in the decision
// doc) - each is a safe no-op when signed out, unconfigured, or
// persistence itself is disallowed (runWorkspaceSync/scheduleWorkspaceSync
// both check that). Not a live onSnapshot listener anywhere here -
// real-time collaboration is an explicit non-goal (#243).
window.onFirebaseAuthChange?.((user) => {
  if (user) window.runWorkspaceSync({ reason: "sign-in" });
});
window.addEventListener?.("online", () => {
  if (currentFirebaseUser()) window.runWorkspaceSync({ reason: "reconnect" });
});
document.addEventListener?.("visibilitychange", () => {
  if (document.visibilityState === "visible" && currentFirebaseUser())
    window.runWorkspaceSync({ reason: "focus" });
});
