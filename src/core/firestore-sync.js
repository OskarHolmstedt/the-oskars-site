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
 * the full design and its rationale, and
 * docs/cloud-sync-eligibility-decision.md (issue #336) for the separate
 * `permission-denied` classification this file surfaces when
 * `firestore.rules`' eligibility allowlist denies an authenticated-but-
 * ineligible or revoked account.
 */

let firestoreModulePromise = null;
let firestoreDbInstance = null;
let workspaceSyncInFlight = null;
let workspaceSyncQueued = false;
let pushDebounceTimer = null;
const MAX_CONSISTENT_READ_ATTEMPTS = 3;

const RETRYABLE_FIRESTORE_ERROR_CODES = new Set([
  "unavailable",
  "deadline-exceeded",
  "aborted",
  "internal",
  "cancelled",
]);

// Conservative target for a single push transaction's total shard-value
// payload, well under Firestore's real whole-request size limit (observed
// directly: an 11+ MB commit was rejected outright - a first sync pushing
// an entire multi-megabyte section in one go is the case this protects
// against; see partitionShardPushBatches in workspace-sync-plan.js). Sized
// off raw JSON length, which understates Firestore's own proto-encoded
// wire size (every value wraps in a {"stringValue"/"mapValue"/...} tag),
// so the real margin below the actual limit is larger than the number
// alone suggests - deliberate, not an oversight.
const MAX_PUSH_BATCH_BYTES = 2 * 1024 * 1024;

function estimateShardByteSize(value) {
  try {
    return JSON.stringify(value)?.length || 0;
  } catch (err) {
    return 0;
  }
}

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

async function fetchShardRecords(firestoreModule, db, uid, sectionKey, shardKeys) {
  let entries = await Promise.all(
    shardKeys.map(async (shardKey) => {
      let snapshot = await firestoreModule.getDoc(
        sectionShardRef(firestoreModule, db, uid, sectionKey, shardKey),
      );
      let data = snapshot.exists() ? snapshot.data() || {} : {};
      return [
        shardKey,
        {
          exists: snapshot.exists(),
          value: snapshot.exists() ? data.value : undefined,
          revision: snapshot.exists() ? String(data.revision || "") : "",
        },
      ];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Fetches requested shards and accepts them only when their stored revisions
 * and a post-read manifest still match the manifest used to start the read.
 */
async function fetchShardValuesMatchingManifest(
  firestoreModule,
  db,
  uid,
  sectionKey,
  manifest,
  shardKeys,
) {
  let records = await fetchShardRecords(
    firestoreModule,
    db,
    uid,
    sectionKey,
    shardKeys,
  );
  let afterManifest = await readSectionManifest(
    firestoreModule,
    db,
    uid,
    sectionKey,
  );
  if (
    !window.workspaceSyncSectionReadIsConsistent({
      beforeManifest: manifest,
      afterManifest,
      shardRecords: records,
      shardKeys,
    })
  ) {
    let error = new Error(
      `Cloud section changed while reading ${sectionKey}; no shard values were applied`,
    );
    error.code = "OSKARS_SYNC_READ_RACE";
    error.sectionKey = sectionKey;
    throw error;
  }
  let values = {};
  Object.entries(records).forEach(([shardKey, record]) => {
    if (record.exists) values[shardKey] = record.value;
  });
  return values;
}

/**
 * Repeats a complete manifest-shards-manifest read after a detected race,
 * bounded so a continuously changing section cannot hold the caller open.
 */
async function readSectionSnapshotWithRetry(
  firestoreModule,
  db,
  uid,
  sectionKey,
  requestedShardKeys,
) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_CONSISTENT_READ_ATTEMPTS; attempt += 1) {
    let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey);
    let shardKeys = requestedShardKeys || manifest.shardKeys;
    try {
      let values = await fetchShardValuesMatchingManifest(
        firestoreModule,
        db,
        uid,
        sectionKey,
        manifest,
        shardKeys,
      );
      return { manifest, values, attempts: attempt };
    } catch (err) {
      if (err?.code !== "OSKARS_SYNC_READ_RACE") throw err;
      lastError = err;
    }
  }
  throw lastError;
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

// Distinguishes a firestore.rules denial (issue #336's eligibility
// allowlist, or the underlying tenant-isolation rule) from every other
// failure - never retryable, and not a transient/offline condition, so it
// deserves its own explanation rather than folding into the generic
// hadError "will retry" message below.
function isUnauthorizedFirestoreError(err) {
  return String(err?.code || "").replace(/^firestore\//, "") === "permission-denied";
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
 * @returns {Promise<{ok: boolean, conflict?: boolean, verifiedAfterError?: boolean, unauthorized?: boolean, error?: Error}>}
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
      // A denied write's own manifest re-read below is denied identically,
      // so there's nothing to verify - the write cannot have landed.
      if (isUnauthorizedFirestoreError(err)) {
        console.error(`Cloud sync push denied for section ${sectionKey}`, err);
        return { ok: false, unauthorized: true, error: err };
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

function currentWorkspaceSyncAccountAccess(user = currentFirebaseUser()) {
  return window.planOskarsWorkspaceAccount?.({
    currentUid: user?.uid,
    browserUid: window.getOskarsBrowserAccountUid?.(),
    syncUid: remoteSyncState().uid,
  }) || { allowed: false, status: "unlinked" };
}

/** Returns the account-lineage guard used by every Firestore operation. @returns {Object} */
window.getWorkspaceSyncAccountAccess = function () {
  return currentWorkspaceSyncAccountAccess();
};

async function processSectionSync(
  firestoreModule,
  db,
  uid,
  sectionKey,
  canonical,
  consistentReadAttempt = 1,
) {
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
    unauthorized: false,
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
      let pulledValues = await fetchShardValuesMatchingManifest(
        firestoreModule,
        db,
        uid,
        sectionKey,
        manifest,
        plan.pullKeys,
      );
      let mergedShardValues = { ...localShards };
      plan.pullKeys.forEach((shardKey) => {
        if (shardKey in pulledValues) mergedShardValues[shardKey] = pulledValues[shardKey];
        else delete mergedShardValues[shardKey]; // remote no longer has this shard
        lastSyncedShardRevisions[shardKey] = manifest.shardRevisions[shardKey] || "";
      });
      result.pulledValue = window.reassembleWorkspaceSection(sectionKey, mergedShardValues);
      result.pulledCount = plan.pullKeys.length;
    } catch (err) {
      if (
        err?.code === "OSKARS_SYNC_READ_RACE" &&
        consistentReadAttempt < MAX_CONSISTENT_READ_ATTEMPTS
      )
        return processSectionSync(
          firestoreModule,
          db,
          uid,
          sectionKey,
          canonical,
          consistentReadAttempt + 1,
        );
      if (isUnauthorizedFirestoreError(err)) {
        console.error(`Cloud sync pull denied for section ${sectionKey}`, err);
        result.unauthorized = true;
      } else {
        console.error(`Cloud sync pull failed for section ${sectionKey}`, err);
      }
      result.hadError = true;
    }
  }

  if (plan.pushKeys.length || plan.deleteKeys.length) {
    let newRevisions = {};
    let byteSizes = {};
    plan.pushKeys.forEach((shardKey) => {
      newRevisions[shardKey] = localShardRevisions[shardKey];
      byteSizes[shardKey] = estimateShardByteSize(localShards[shardKey]);
    });
    let expectedRevisions = {};
    [...plan.pushKeys, ...plan.deleteKeys].forEach((shardKey) => {
      expectedRevisions[shardKey] = manifest.shardRevisions[shardKey] || "";
    });
    // Every dirty shard in a section can exceed Firestore's whole-request
    // size limit even though each individual shard document stays under
    // the much smaller per-document cap - most commonly on a first sync,
    // when the entire section is dirty at once. Split into size-bounded
    // batches, each its own transaction; a batch that fails or conflicts
    // leaves only its own shards dirty for the next pass; it doesn't
    // undo an already-succeeded batch (partial progress across a
    // section's push is expected and safe, not a partial-application bug -
    // each shard's own revision tracking is what makes that safe).
    let batches = window.partitionShardPushBatches({
      pushKeys: plan.pushKeys,
      deleteKeys: plan.deleteKeys,
      byteSizes,
      maxBatchBytes: MAX_PUSH_BATCH_BYTES,
    });
    for (let batch of batches) {
      let batchPushShards = {};
      let batchNewRevisions = {};
      let batchExpectedRevisions = {};
      batch.pushKeys.forEach((shardKey) => {
        batchPushShards[shardKey] = localShards[shardKey];
        batchNewRevisions[shardKey] = newRevisions[shardKey];
        batchExpectedRevisions[shardKey] = expectedRevisions[shardKey];
      });
      batch.deleteKeys.forEach((shardKey) => {
        batchExpectedRevisions[shardKey] = expectedRevisions[shardKey];
      });
      let pushed = await pushSectionWithRetryAndVerification(firestoreModule, db, uid, sectionKey, {
        pushShards: batchPushShards,
        deleteShardKeys: batch.deleteKeys,
        expectedRevisions: batchExpectedRevisions,
        newRevisions: batchNewRevisions,
      });
      if (pushed.ok) {
        batch.pushKeys.forEach((shardKey) => {
          lastSyncedShardRevisions[shardKey] = newRevisions[shardKey];
        });
        batch.deleteKeys.forEach((shardKey) => {
          delete lastSyncedShardRevisions[shardKey];
        });
        result.pushedCount += batch.pushKeys.length + batch.deleteKeys.length;
      } else if (pushed.conflict) {
        [...batch.pushKeys, ...batch.deleteKeys].forEach((shardKey) =>
          result.conflicts.push({
            sectionKey,
            shardKey,
            localRevision: localShardRevisions[shardKey] || "",
            remoteRevision: "",
          }),
        );
      } else {
        result.hadError = true;
        if (pushed.unauthorized) result.unauthorized = true;
      }
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
  if (window.OSKARS_DATA_READY !== true) return { ok: true, reason: "not-ready" };
  let user = currentFirebaseUser();
  if (!user) return { ok: true, reason: "signed-out" };
  let syncReason = String(options.reason || "");
  let previousRemoteSync = remoteSyncState();
  let accountAccess = currentWorkspaceSyncAccountAccess(user);
  if (!accountAccess.allowed)
    return { ok: false, reason: accountAccess.status };
  let claimedAccount = Boolean(accountAccess.claim);
  let retryRemainingMs = window.workspaceSyncBackoffRemainingMs?.(
    previousRemoteSync.retry,
  );
  if (
    syncReason !== "manual" &&
    syncReason !== "conflict-resolution" &&
    retryRemainingMs > 0
  ) {
    return {
      ok: false,
      reason: "backoff",
      retryAfter: previousRemoteSync.retry.retryAfter,
      retryRemainingMs,
    };
  }
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
        return { sectionKey, pushedCount: 0, pulledCount: 0, conflicts: [], hadError: true, unauthorized: false, lastSyncedShardRevisions: remoteSyncState().shards?.[sectionKey] || {} };
      }),
    ),
  );

  let nextShards = {};
  let pulledSectionValues = {};
  let conflicts = [];
  let pushedCount = 0;
  let pulledCount = 0;
  let hadError = false;
  let unauthorized = false;
  sectionResults.forEach((result) => {
    nextShards[result.sectionKey] = result.lastSyncedShardRevisions;
    if (result.pulledValue !== undefined) pulledSectionValues[result.sectionKey] = result.pulledValue;
    conflicts.push(...result.conflicts);
    pushedCount += result.pushedCount;
    pulledCount += result.pulledCount;
    hadError = hadError || result.hadError;
    unauthorized = unauthorized || Boolean(result.unauthorized);
  });

  applyPulledSectionValues(pulledSectionValues);

  let retry =
    hadError && !unauthorized
      ? window.nextWorkspaceSyncBackoff?.({
          previousFailures: previousRemoteSync.retry?.consecutiveFailures,
        })
      : null;

  window.state.draftMetadata = {
    ...(window.state.draftMetadata || {}),
    remoteSync: {
      uid: user.uid,
      shards: nextShards,
      lastSyncAt: new Date().toISOString(),
      lastSyncReason: syncReason,
      lastPushCount: pushedCount,
      lastPullCount: pulledCount,
      conflicts,
      hadError,
      unauthorized,
      ...(retry ? { retry } : {}),
    },
  };

  let stateChanged = Object.keys(pulledSectionValues).length > 0;
  let clearedPriorFailure = Boolean(
    previousRemoteSync.hadError ||
      previousRemoteSync.unauthorized ||
      previousRemoteSync.retry,
  );
  if (
    stateChanged ||
    pushedCount ||
    conflicts.length ||
    hadError ||
    clearedPriorFailure ||
    claimedAccount
  ) {
    let saving = window.save({
      immediate: true,
      rebuild: false,
      scheduleSync: false,
    });
    if (saving?.then) await saving;
  }

  window.reportWorkspaceSyncStatus?.({ pushedCount, pulledCount, conflicts, hadError, unauthorized, stateChanged });
  return {
    ok: !hadError,
    pushedCount,
    pulledCount,
    conflicts,
    hadError,
    unauthorized,
    ...(retry ? { retry } : {}),
  };
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
  if (window.OSKARS_DATA_READY !== true || !currentFirebaseUser()) return;
  if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
  pushDebounceTimer = setTimeout(() => {
    pushDebounceTimer = null;
    window.runWorkspaceSync({ reason: "after-save" });
  }, 2000);
};

/**
 * Marks private state as fully hydrated and starts the first cloud sync only
 * after IndexedDB loading, migration, repair, and any required local save have
 * completed. This prevents an early auth callback from syncing the empty
 * initial state over a pre-account browser archive.
 */
window.noteOskarsDataReadyForSync = function () {
  if (window.OSKARS_DATA_READY === true) return;
  window.OSKARS_DATA_READY = true;
  if (currentFirebaseUser()) window.runWorkspaceSync({ reason: "data-ready" });
};

/**
 * Returns the conflicts recorded by the most recent sync pass - shards
 * where local and remote both changed since they last agreed, requiring
 * an explicit choice (never auto-resolved).
 * @returns {Array<{sectionKey: string, shardKey: string, localRevision: string, remoteRevision: string}>}
 */
window.getWorkspaceSyncConflicts = function () {
  if (!currentWorkspaceSyncAccountAccess().allowed) return [];
  return remoteSyncState().conflicts || [];
};

function recordShardSynced(sectionKey, shardKey, revision) {
  let remoteSync = window.cloneRecord(remoteSyncState());
  remoteSync.uid = currentFirebaseUser()?.uid || remoteSync.uid || "";
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
  let accountAccess = currentWorkspaceSyncAccountAccess(user);
  if (!accountAccess.allowed)
    return { ok: false, reason: accountAccess.status };
  let ready = user ? await ensureFirestoreDb() : null;
  if (!ready || !user) return { ok: false, reason: "unavailable" };
  let { firestoreModule, db } = ready;
  let uid = user.uid;

  if (resolution === "keep-remote") {
    let remoteRead;
    try {
      remoteRead = await readSectionSnapshotWithRetry(
        firestoreModule,
        db,
        uid,
        sectionKey,
        [shardKey],
      );
    } catch (err) {
      if (err?.code === "OSKARS_SYNC_READ_RACE")
        return { ok: false, reason: "changed-again" };
      throw err;
    }
    let remoteRevision = remoteRead.manifest.shardRevisions[shardKey] || "";
    let pulledValues = remoteRead.values;
    let canonical = window.getCanonicalData(window.state, { clone: false });
    let { shards: localShards } = window.chunkWorkspaceSection(sectionKey, canonical[sectionKey]);
    let mergedShardValues = { ...localShards };
    if (shardKey in pulledValues) mergedShardValues[shardKey] = pulledValues[shardKey];
    else delete mergedShardValues[shardKey];
    applyPulledSectionValues({
      [sectionKey]: window.reassembleWorkspaceSection(sectionKey, mergedShardValues),
    });
    recordShardSynced(sectionKey, shardKey, remoteRevision);
    let saving = window.save({
      immediate: true,
      rebuild: false,
      scheduleSync: false,
    });
    if (saving?.then) await saving;
    window.runWorkspaceSync({ reason: "conflict-resolution" });
    return { ok: true };
  }

  let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey);
  let remoteRevision = manifest.shardRevisions[shardKey] || "";
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
  let saving = window.save({
    immediate: true,
    rebuild: false,
    scheduleSync: false,
  });
  if (saving?.then) await saving;
  window.runWorkspaceSync({ reason: "conflict-resolution" });
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
 * nothing, leaving the prior "Saved locally" status visible. A denied
 * request (issue #336: this account isn't on the deployment's cloud-sync
 * eligibility allowlist, or was just revoked from it) reports a distinct,
 * non-retrying message rather than the generic transient-failure one -
 * changes stay saved locally either way, just unsynced.
 * @param {{pushedCount: number, pulledCount: number, conflicts: Array, hadError: boolean, unauthorized?: boolean}} outcome
 */
window.reportWorkspaceSyncStatus = function ({ pushedCount, pulledCount, conflicts, hadError, unauthorized }) {
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
  if (unauthorized) {
    window.showStorageStatus?.(
      "Cloud sync unavailable for this account — changes are saved locally on this device only",
      "warning",
    );
    return;
  }
  if (hadError) {
    window.showStorageStatus?.("Cloud sync paused — will retry", "warning");
    return;
  }
  if (pushedCount || pulledCount) window.showStorageStatus?.("Synced to cloud", "saved");
};

/**
 * Deletes one document with the same bounded-retry posture as
 * pushSectionWithRetryAndVerification, adapted for deletes: there's no
 * revision precondition to violate, so any failure past retry is verified
 * by re-reading the document rather than trusting the error - a delete
 * must never be reported as failed when it actually landed, nor reported
 * as succeeded when the document is still there (issue #254).
 * @returns {Promise<{ok: boolean, verifiedAfterError?: boolean}>}
 */
async function deleteDocWithRetryAndVerification(firestoreModule, ref) {
  let attempt = 0;
  let maxAttempts = 3;
  while (true) {
    attempt += 1;
    try {
      await firestoreModule.deleteDoc(ref);
      return { ok: true };
    } catch (err) {
      if (isRetryableFirestoreError(err) && attempt < maxAttempts) {
        await delay(300 * 2 ** attempt);
        continue;
      }
      let stillExists = await firestoreModule
        .getDoc(ref)
        .then((snap) => snap.exists())
        .catch(() => true);
      if (!stillExists) return { ok: true, verifiedAfterError: true };
      console.error("Cloud account deletion failed for a document", ref.path, err);
      return { ok: false, error: err };
    }
  }
}

/**
 * Deletes every shard plus the manifest for one section, using the
 * manifest's own shardKeys as the authoritative enumeration - the same
 * list performWorkspaceSync/fetchCanonicalDataFromCloud already trust,
 * so nothing needs guessing.
 * @returns {Promise<{sectionKey: string, ok: boolean, shardCount: number, failedCount: number}>}
 */
async function deleteSectionRemoteData(firestoreModule, db, uid, sectionKey) {
  let manifest = await readSectionManifest(firestoreModule, db, uid, sectionKey);
  let refs = manifest.shardKeys.map((shardKey) =>
    sectionShardRef(firestoreModule, db, uid, sectionKey, shardKey),
  );
  refs.push(sectionManifestRef(firestoreModule, db, uid, sectionKey));
  let results = await Promise.all(
    refs.map((ref) => deleteDocWithRetryAndVerification(firestoreModule, ref)),
  );
  return {
    sectionKey,
    ok: results.every((r) => r.ok),
    shardCount: manifest.shardKeys.length,
    failedCount: results.filter((r) => !r.ok).length,
  };
}

/**
 * Permanently deletes every Firestore document this account owns (every
 * section's manifest and shards) and verifies removal, satisfying issue
 * #254's "deletion enumerates and verifies removal of owned remote data."
 * Data-only: never calls Firebase Auth's account-deletion API (see
 * docs/account-deletion-decision.md) - the signed-in identity is left
 * intact but empty, so signing back in later just bootstraps fresh.
 *
 * On full success, this device's remoteSync shard bookkeeping is reset to
 * empty while retaining the owning UID, rather than left stale - critical,
 * not cosmetic: a stale
 * lastSyncedShardRevisions after the remote is wiped would make
 * planWorkspaceShardSync see every untouched shard as remote-changed
 * (remote revision now "" vs. the old synced hash) with local unchanged,
 * which resolves to a *pull* - and a pull of a shard the remote no longer
 * has deletes it from local state too (processSectionSync's pull branch).
 * Left unfixed, the very next sign-in/reconnect/focus sync after a
 * deletion would silently wipe local data - exactly what this issue exists
 * to prevent. Resetting to empty instead lands every shard on the
 * never-synced bootstrap path, which re-pushes local content as the new
 * baseline.
 * @returns {Promise<{ok: boolean, sections: Array<{sectionKey: string, ok: boolean, shardCount: number, failedCount: number}>}>}
 */
window.deleteCloudAccountData = async function () {
  if (!window.oskarsPersistenceAllowed?.()) return { ok: false, reason: "not-allowed", sections: [] };
  let user = currentFirebaseUser();
  if (!user) return { ok: false, reason: "signed-out", sections: [] };
  let accountAccess = currentWorkspaceSyncAccountAccess(user);
  if (!accountAccess.allowed)
    return { ok: false, reason: accountAccess.status, sections: [] };
  let ready = await ensureFirestoreDb();
  if (!ready) return { ok: false, reason: "unconfigured", sections: [] };
  let { firestoreModule, db } = ready;
  let uid = user.uid;

  // Close the window where an unrelated debounced/in-flight sync could
  // race a delete against the data this is about to wipe.
  if (pushDebounceTimer) {
    clearTimeout(pushDebounceTimer);
    pushDebounceTimer = null;
  }
  if (workspaceSyncInFlight) await workspaceSyncInFlight.catch(() => {});

  let sectionKeys = window.OSKARS_CANONICAL_SECTION_KEYS || [];
  let sections = await Promise.all(
    sectionKeys.map((sectionKey) =>
      deleteSectionRemoteData(firestoreModule, db, uid, sectionKey).catch((err) => {
        console.error(`Cloud account deletion failed for section ${sectionKey}`, err);
        return { sectionKey, ok: false, shardCount: 0, failedCount: 1, error: err };
      }),
    ),
  );
  let ok = sections.every((s) => s.ok);

  if (ok) {
    window.state.draftMetadata = {
      ...(window.state.draftMetadata || {}),
      remoteSync: { uid, shards: {}, conflicts: [] },
    };
    let saving = window.save({
      immediate: true,
      rebuild: false,
      scheduleSync: false,
    });
    if (saving?.then) await saving;
  }

  return { ok, sections };
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
  let accountAccess = currentWorkspaceSyncAccountAccess(user);
  if (!accountAccess.allowed)
    return { ok: false, error: accountAccess.status };
  let ready = await ensureFirestoreDb();
  if (!ready) return { ok: false, error: "unconfigured" };
  let { firestoreModule, db } = ready;
  let uid = user.uid;
  try {
    let sectionKeys = window.OSKARS_CANONICAL_SECTION_KEYS || [];
    let sections = await Promise.all(
      sectionKeys.map(async (sectionKey) => {
        let remoteRead = await readSectionSnapshotWithRetry(
          firestoreModule,
          db,
          uid,
          sectionKey,
        );
        return [
          sectionKey,
          window.reassembleWorkspaceSection(sectionKey, remoteRead.values),
        ];
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
window.onFirebaseAuthChange?.((user, meta) => {
  if (user && window.OSKARS_DATA_READY === true)
    window.runWorkspaceSync({ reason: "sign-in" });
  else if (meta && meta.deliberate === false)
    window.showStorageStatus?.(
      "Session ended — your local work is safe. Sign in again anytime.",
      "warning",
    );
});
window.addEventListener?.("online", () => {
  if (currentFirebaseUser() && window.OSKARS_DATA_READY === true)
    window.runWorkspaceSync({ reason: "reconnect" });
});
document.addEventListener?.("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    currentFirebaseUser() &&
    window.OSKARS_DATA_READY === true
  )
    window.runWorkspaceSync({ reason: "focus" });
});
