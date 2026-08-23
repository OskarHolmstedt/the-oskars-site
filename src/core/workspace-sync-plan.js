/**
 * @file Pure three-way per-shard sync planning for Firestore workspace sync
 * (issues #248 and #333): compares this device's current local shard content
 * against the last value it and the remote account agreed on, validates that
 * manifest-driven shard reads form one coherent revision set, and computes
 * bounded retry backoff diagnostics. Never merges conflicting content or
 * resolves a genuine concurrent change silently - see
 * docs/firestore-workspace-sync-decision.md. No Firestore access; every input
 * is plain data, so this file is fully unit-testable without a network or
 * emulator.
 */

/**
 * Plans one shard's sync action from local/remote/last-synced revisions.
 * @param {Object} input
 * @param {string} input.localRevision Current local shard content revision, or "" if this shard doesn't currently exist locally.
 * @param {string} input.remoteRevision Remote shard's current content revision, or "" if it doesn't exist remotely.
 * @param {string} [input.lastSyncedRevision] This device's last agreed revision for this shard; undefined if never synced.
 * @param {boolean} [input.localIsEmptyDefault] Whether the local value matches this shard's pristine, never-touched default. Only consulted when never synced, to distinguish "a fresh device has nothing here yet" (safe to pull) from "an established local archive independently populated this" (needs a decision).
 * @returns {{action: 'noop'|'push'|'pull'|'conflict', reason: string}}
 */
window.planWorkspaceShardSync = function (input) {
  let localRevision = String(input.localRevision || "");
  let remoteRevision = String(input.remoteRevision || "");
  let neverSynced = input.lastSyncedRevision === undefined;
  let lastSyncedRevision = neverSynced ? "" : String(input.lastSyncedRevision || "");

  if (neverSynced) {
    if (!remoteRevision) {
      return input.localIsEmptyDefault
        ? { action: "noop", reason: "bootstrap-both-empty" }
        : { action: "push", reason: "bootstrap-local-only" };
    }
    if (input.localIsEmptyDefault)
      return { action: "pull", reason: "bootstrap-remote-only" };
    return localRevision === remoteRevision
      ? { action: "noop", reason: "bootstrap-already-matching" }
      : { action: "conflict", reason: "bootstrap-both-populated" };
  }

  let localChanged = localRevision !== lastSyncedRevision;
  let remoteChanged = remoteRevision !== lastSyncedRevision;
  if (!localChanged && !remoteChanged) return { action: "noop", reason: "unchanged" };
  if (localChanged && !remoteChanged) return { action: "push", reason: "local-only-change" };
  if (!localChanged && remoteChanged) return { action: "pull", reason: "remote-only-change" };
  return localRevision === remoteRevision
    ? { action: "noop", reason: "converged" }
    : { action: "conflict", reason: "concurrent-change" };
};

/**
 * Plans every shard's sync action for one section, over the union of
 * local/remote/last-synced shard keys - so a shard removed on either side
 * (a section that shrank below a shard boundary) is still planned, not
 * silently ignored.
 * @param {Object} input
 * @param {Record<string, string>} input.localShardRevisions Shard key -> current local content revision, for every shard the current local value chunks into.
 * @param {Record<string, string>} [input.emptyDefaultShardRevisions] Shard key -> revision that shard would have in a pristine, never-touched local workspace; used only for never-synced bootstrap decisions.
 * @param {Record<string, string>} input.remoteShardRevisions Shard key -> current remote content revision, from the section's manifest document.
 * @param {Record<string, string>} input.lastSyncedShardRevisions Shard key -> this device's last agreed revision; a key absent here means that shard was never synced by this device.
 * @returns {{shardKeys: string[], plans: Record<string, {action: string, reason: string}>, pushKeys: string[], deleteKeys: string[], pullKeys: string[], conflictKeys: string[]}}
 *   pushKeys are shards present locally that need writing; deleteKeys are
 *   shards absent locally (but previously present) that need removing
 *   remotely - both come from a "push" plan, split by local presence.
 */
window.planWorkspaceSectionSync = function (input) {
  let localShardRevisions = input.localShardRevisions || {};
  let remoteShardRevisions = input.remoteShardRevisions || {};
  let lastSyncedShardRevisions = input.lastSyncedShardRevisions || {};
  let emptyDefaultShardRevisions = input.emptyDefaultShardRevisions || {};
  let shardKeys = [
    ...new Set([
      ...Object.keys(localShardRevisions),
      ...Object.keys(remoteShardRevisions),
      ...Object.keys(lastSyncedShardRevisions),
    ]),
  ].sort();
  let plans = {};
  let pushKeys = [];
  let deleteKeys = [];
  let pullKeys = [];
  let conflictKeys = [];
  shardKeys.forEach((shardKey) => {
    let hasLastSynced = Object.prototype.hasOwnProperty.call(
      lastSyncedShardRevisions,
      shardKey,
    );
    let hasLocal = Object.prototype.hasOwnProperty.call(localShardRevisions, shardKey);
    let plan = window.planWorkspaceShardSync({
      localRevision: localShardRevisions[shardKey] || "",
      remoteRevision: remoteShardRevisions[shardKey] || "",
      lastSyncedRevision: hasLastSynced ? lastSyncedShardRevisions[shardKey] : undefined,
      localIsEmptyDefault:
        (localShardRevisions[shardKey] || "") ===
        (emptyDefaultShardRevisions[shardKey] || ""),
    });
    plans[shardKey] = plan;
    if (plan.action === "push") (hasLocal ? pushKeys : deleteKeys).push(shardKey);
    else if (plan.action === "pull") pullKeys.push(shardKey);
    else if (plan.action === "conflict") conflictKeys.push(shardKey);
  });
  return { shardKeys, plans, pushKeys, deleteKeys, pullKeys, conflictKeys };
};

/**
 * Checks that shard documents fetched from one manifest still belong to that
 * same manifest after the reads complete. Both the complete manifest and each
 * requested shard's stored revision must agree; a listed-but-missing shard or
 * an unlisted-but-present shard is inconsistent too.
 * @param {Object} input
 * @param {{shardKeys?: string[], shardRevisions?: Record<string, string>}} input.beforeManifest Manifest used to plan the read.
 * @param {{shardKeys?: string[], shardRevisions?: Record<string, string>}} input.afterManifest Manifest reread after the shard documents.
 * @param {Record<string, {exists: boolean, revision?: string}>} input.shardRecords Requested shard existence/revision observations.
 * @param {string[]} input.shardKeys Shard documents requested for this read.
 * @returns {boolean} Whether the observations form one coherent revision set.
 */
window.workspaceSyncSectionReadIsConsistent = function (input) {
  let before = input.beforeManifest || {};
  let after = input.afterManifest || {};
  let beforeKeys = [...new Set(before.shardKeys || [])].sort();
  let afterKeys = [...new Set(after.shardKeys || [])].sort();
  if (beforeKeys.join("\u0000") !== afterKeys.join("\u0000")) return false;

  let beforeRevisions = before.shardRevisions || {};
  let afterRevisions = after.shardRevisions || {};
  let revisionKeys = [
    ...new Set([...Object.keys(beforeRevisions), ...Object.keys(afterRevisions)]),
  ];
  if (
    revisionKeys.some(
      (key) => String(beforeRevisions[key] || "") !== String(afterRevisions[key] || ""),
    )
  )
    return false;

  let listedKeys = new Set(beforeKeys);
  let records = input.shardRecords || {};
  return (input.shardKeys || []).every((shardKey) => {
    let record = records[shardKey] || { exists: false };
    if (!listedKeys.has(shardKey)) return record.exists !== true;
    let expectedRevision = String(beforeRevisions[shardKey] || "");
    return (
      Boolean(expectedRevision) &&
      record.exists === true &&
      String(record.revision || "") === expectedRevision
    );
  });
};

/**
 * Advances persisted automatic-sync backoff through a short bounded ladder.
 * Event triggers consult retryAfter; no timer repeatedly wakes a failing tab.
 * @param {Object} input
 * @param {number} [input.previousFailures] Prior consecutive failure count.
 * @param {number} [input.nowMs] Clock value for deterministic testing.
 * @returns {{consecutiveFailures: number, delayMs: number, retryAfter: string}} Observable retry state.
 */
window.nextWorkspaceSyncBackoff = function (input = {}) {
  let delays = [2000, 10000, 60000];
  let previousFailures = Math.max(0, Number(input.previousFailures) || 0);
  let consecutiveFailures = Math.min(previousFailures + 1, delays.length);
  let delayMs = delays[consecutiveFailures - 1];
  let nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  return {
    consecutiveFailures,
    delayMs,
    retryAfter: new Date(nowMs + delayMs).toISOString(),
  };
};

/**
 * Returns the remaining delay recorded by nextWorkspaceSyncBackoff().
 * @param {{retryAfter?: string}|null} retry Persisted retry state.
 * @param {number} [nowMs] Clock value for deterministic testing.
 * @returns {number} Remaining delay in milliseconds, never negative.
 */
window.workspaceSyncBackoffRemainingMs = function (retry, nowMs = Date.now()) {
  let retryAt = Date.parse(retry?.retryAfter || "");
  if (!Number.isFinite(retryAt)) return 0;
  return Math.max(0, retryAt - nowMs);
};

/**
 * Splits a section's dirty push/delete shard keys into ordered batches that
 * each stay under a target byte budget, so a section with many dirty
 * shards - most commonly the very first sync, when nothing has been
 * pushed yet and every shard in the section is dirty at once - doesn't
 * bundle more data into one Firestore commit than Firestore allows.
 * Discovered the hard way: a first sync pushing an entire ~8 MB `years`
 * section in one transaction hit Firestore's whole-request size limit
 * (observed failure: an 11+ MB commit rejected outright) even though
 * every individual shard document stayed comfortably under the
 * separate, much smaller per-document 1 MiB cap chunking already
 * respects (docs/firestore-workspace-sync-decision.md) - these are two
 * different limits, and only the per-document one was accounted for
 * originally. Pure: takes pre-computed byte-size estimates in, returns
 * key groupings out; no I/O, no actual shard values, so this is fully
 * unit-testable without a network or emulator.
 * @param {Object} input
 * @param {string[]} input.pushKeys Shard keys with content to write.
 * @param {string[]} input.deleteKeys Shard keys to remove (cheap - no value payload).
 * @param {Record<string, number>} input.byteSizes Shard key -> estimated byte size.
 * @param {number} input.maxBatchBytes Target maximum total size per batch.
 * @returns {Array<{pushKeys: string[], deleteKeys: string[]}>} Ordered
 *   batches, each safe to push as one Firestore transaction. Empty when
 *   there's nothing to push or delete. A single shard whose own size
 *   already exceeds maxBatchBytes still gets its own one-shard batch
 *   rather than being dropped or stalling the partition.
 */
window.partitionShardPushBatches = function ({ pushKeys, deleteKeys, byteSizes, maxBatchBytes }) {
  let sizes = byteSizes || {};
  let budget = maxBatchBytes > 0 ? maxBatchBytes : Infinity;
  let batches = [];
  let current = { pushKeys: [], deleteKeys: [] };
  let currentBytes = 0;
  function flush() {
    if (current.pushKeys.length || current.deleteKeys.length) batches.push(current);
    current = { pushKeys: [], deleteKeys: [] };
    currentBytes = 0;
  }
  // Pushes carry the real payload weight and are batched first; deletes
  // (no value payload, negligible size) fill in wherever there's room.
  (pushKeys || []).forEach((shardKey) => {
    let size = sizes[shardKey] || 0;
    if (currentBytes > 0 && currentBytes + size > budget) flush();
    current.pushKeys.push(shardKey);
    currentBytes += size;
  });
  (deleteKeys || []).forEach((shardKey) => {
    if (currentBytes > 0 && currentBytes + 1 > budget) flush();
    current.deleteKeys.push(shardKey);
    currentBytes += 1;
  });
  flush();
  return batches;
};
