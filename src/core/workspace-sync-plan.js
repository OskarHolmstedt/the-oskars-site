/**
 * @file Pure three-way per-shard sync planning for Firestore workspace sync
 * (issue #248): compares this device's current local shard content against
 * the last value it and the remote account agreed on, and against the
 * remote's current content, deciding push/pull/conflict/noop per shard.
 * Never merges conflicting content and never resolves a genuine concurrent
 * change silently - see docs/firestore-workspace-sync-decision.md. No
 * Firestore access; every input here is a plain revision string, so this
 * file is fully unit-testable without a network or emulator.
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
