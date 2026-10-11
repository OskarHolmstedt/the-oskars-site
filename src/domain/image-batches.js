/**
 * @file Runs bounded metadata, poster, and portrait fetch batches with session retry tracking.
 */

// Session-level failed-lookup registry (issue #44): every metadata, poster,
// and portrait batch records its failures here - keyed by batch type - so
// Data Health can show visible retry queues for the current session instead
// of only the last batch's report. A later success clears the item's entry.
// Session-only; nothing is persisted. This file loads before watchlists.js
// on every page, so the watchlist fetchers there can rely on these helpers.
window.metadataSessionFailures = {};

/** Records one failed lookup for a session queue. @param {string} type Queue type. @param {Object} record Failure. */
window.recordMetadataSessionFailure = function (type, record) {
  if (!record?.id) return;
  let bucket = (window.metadataSessionFailures[type] ||= new Map());
  bucket.set(String(record.id), record);
};

/** Clears one recorded session failure. @param {string} type Queue type. @param {string} id Item id. */
window.clearMetadataSessionFailure = function (type, id) {
  window.metadataSessionFailures[type]?.delete(String(id));
};

/**
 * Runs a bounded-concurrency batch of provider lookups against a candidate
 * item list: session-attempt dedup (skippable per item, "already attempted
 * this session"), a cursor-based worker pool, and consistent result/
 * failure-record bookkeeping through the shared session-failure registry.
 * @param {Object[]} rawItems Candidate items, unfiltered.
 * @param {Object} config Batch shape.
 * @param {(item:Object) => string} config.idOf Resolves an item's dedup/session-attempt key.
 * @param {(item:Object) => boolean} config.eligible Whether an item currently needs a lookup.
 * @param {Set<string>} config.attempts Session attempt-tracking set, mutated in place.
 * @param {string} config.failureType Session-failure-registry queue key.
 * @param {(item:Object, reason:string) => Object} config.failureRecord Builds a failure record for an item.
 * @param {(item:Object, context:{fetchFn:Function}) => Promise<*>} config.lookup Runs the network lookup for one item.
 * @param {(item:Object, value:*) => (boolean|Promise<boolean>)} config.apply Persists a successful lookup value; returns whether it was applied.
 * @param {string} config.notFoundReason Failure reason when a lookup resolves but finds or applies nothing.
 * @param {(item:Object) => string} config.warnMessage Console warning text for a caught lookup error.
 * @param {'poster'|'portrait'} [config.imageFailureType] When set, `result.failed` is also recorded against window.recordImageImportFailure on this type.
 * @param {boolean} [config.persisted] Whether apply awaits a targeted write, bypassing reconcile checkpoints.
 * @param {Object} [options] Caller options: fetchFn, limit, force, concurrency, onProgress.
 * @returns {Promise<MetadataBatchResult>} Batch result.
 */
window.runBoundedLookupBatch = async function (rawItems, config, options = {}) {
  let seen = new Set();
  let limit = Math.max(1, Number(options.limit) || 25);
  let skippedItems = [];
  let eligible = (rawItems || []).filter((item) => {
    let id = config.idOf(item);
    if (!config.eligible(item) || seen.has(id)) return false;
    seen.add(id);
    if (!options.force && config.attempts.has(id)) {
      skippedItems.push(
        config.failureRecord(item, "Already attempted this session."),
      );
      return false;
    }
    return true;
  });
  let candidates = eligible.slice(0, limit);
  candidates.forEach((item) => config.attempts.add(config.idOf(item)));

  let result = {
    attempted: candidates.length,
    found: 0,
    failed: 0,
    skipped: skippedItems.length,
    failures: [],
    skippedItems,
  };
  // Checkpointed with an immediate save every few finds, not just once at
  // the end - a batch this size (default limit 25) can run long enough
  // that navigating away mid-batch would otherwise silently discard
  // everything already fetched, since apply() below always passes
  // {save: false} and defers to this function's own save call.
  const SAVE_CHECKPOINT_EVERY = 3;
  let unsavedFinds = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let item = candidates[cursor++];
      let id = config.idOf(item);
      try {
        let value = await config.lookup(item, {
          fetchFn: options.fetchFn,
        });
        if (value && (await config.apply(item, value))) {
          result.found += 1;
          window.clearMetadataSessionFailure(config.failureType, id);
          unsavedFinds += config.persisted ? 0 : 1;
          if (unsavedFinds >= SAVE_CHECKPOINT_EVERY) {
            unsavedFinds = 0;
            window.save({ immediate: true });
          }
        } else {
          result.failed += 1;
          result.failures.push(
            config.failureRecord(item, config.notFoundReason),
          );
          window.recordMetadataSessionFailure(
            config.failureType,
            config.failureRecord(item, config.notFoundReason),
          );
        }
      } catch (err) {
        console.warn(config.warnMessage(item), err);
        result.failed += 1;
        result.failures.push(config.failureRecord(item, err.message || err));
        window.recordMetadataSessionFailure(
          config.failureType,
          config.failureRecord(item, err.message || err),
        );
      }
      options.onProgress?.(
        result.found + result.failed,
        candidates.length,
        item,
      );
    }
  }

  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (result.found && !config.persisted) window.save({ immediate: true });
  return result;
};
