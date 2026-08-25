/**
 * @file Runs bounded metadata, poster, and portrait fetch batches with session retry tracking.
 */

let filmMetadataLookupAttempts = new Set();
let posterLookupAttempts = new Set();
let portraitLookupAttempts = new Set();

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

/** Returns failures for a session queue. @param {string} type Queue type. @returns {Object[]} Failures. */
window.metadataSessionFailureList = function (type) {
  return [...(window.metadataSessionFailures[type]?.values() || [])];
};

/** Returns attempted items for a session queue. @param {string} type Queue type. @returns {number} Attempt count. */
window.metadataSessionAttemptCount = function (type) {
  if (type === "film-metadata") return filmMetadataLookupAttempts.size;
  if (type === "film-posters") return posterLookupAttempts.size;
  if (type === "person-portraits") return portraitLookupAttempts.size;
  return window.watchlistSessionAttemptCount?.(type) || 0;
};

/** Tests whether a film lacks fetchable TMDB metadata. @param {FilmRecord} film Film. @returns {boolean} Whether lookup is needed. */
window.filmNeedsMetadataLookup = function (film) {
  return (
    Boolean(film?.id && film.title) &&
    (!film.tmdbId ||
      !film.director ||
      !film.country ||
      !film.runtimeMinutes)
  );
};

function lookupItemLabel(item) {
  return String(item?.title || item?.name || item?.id || "Unknown item");
}

function lookupFailureRecord(item, reason) {
  return {
    title: lookupItemLabel(item),
    year: item?.year || "",
    id: item?.id || "",
    reason: String(reason || "No match found."),
  };
}

/**
 * Runs a bounded-concurrency batch of provider lookups against a candidate
 * item list: session-attempt dedup (skippable per item, "already attempted
 * this session"), a cursor-based worker pool, and consistent result/
 * failure-record bookkeeping through the shared session-failure registry.
 * Every fetchX batch function (film metadata/posters, person portraits,
 * watchlist posters/metadata) is built on this — they differ only in which
 * eligibility test, lookup, and apply functions get plugged in.
 * @param {Object[]} rawItems Candidate items, unfiltered.
 * @param {Object} config Batch shape.
 * @param {(item:Object) => string} config.idOf Resolves an item's dedup/session-attempt key.
 * @param {(item:Object) => boolean} config.eligible Whether an item currently needs a lookup.
 * @param {Set<string>} config.attempts Session attempt-tracking set, mutated in place.
 * @param {string} config.failureType Session-failure-registry queue key.
 * @param {(item:Object, reason:string) => Object} config.failureRecord Builds a failure record for an item.
 * @param {(item:Object, context:{fetchFn:Function}) => Promise<*>} config.lookup Runs the network lookup for one item.
 * @param {(item:Object, value:*) => boolean} config.apply Persists a successful lookup value; returns whether it was applied.
 * @param {string} config.notFoundReason Failure reason when a lookup resolves but finds or applies nothing.
 * @param {(item:Object) => string} config.warnMessage Console warning text for a caught lookup error.
 * @param {'poster'|'portrait'} [config.imageFailureType] When set, `result.failed` is also recorded against window.recordImageImportFailure on this type.
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
        if (value && config.apply(item, value)) {
          result.found += 1;
          window.clearMetadataSessionFailure(config.failureType, id);
          unsavedFinds += 1;
          if (unsavedFinds >= SAVE_CHECKPOINT_EVERY) {
            unsavedFinds = 0;
            window.save({ immediate: true });
          }
        } else {
          result.failed += 1;
          result.failures.push(config.failureRecord(item, config.notFoundReason));
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
      options.onProgress?.(result.found + result.failed, candidates.length, item);
    }
  }

  // Reconciled to one shared default (issue #310): every batch used 3
  // already except film metadata's 2, an unexplained outlier next to its
  // near-identical watchlist-metadata counterpart, which already ran at 3.
  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (config.imageFailureType && result.failed)
    window.recordImageImportFailure(config.imageFailureType, result.failed);
  // Failure-only batches store nothing durable; skipping the save keeps
  // read-only page loads write-free. Failure counters live in in-memory
  // state and persist with the next genuine save. Immediate, not the
  // debounced default, so the batch's tail (whatever hasn't hit a
  // checkpoint above) is guaranteed durable before this function returns.
  if (result.found) window.save({ immediate: true });
  return result;
};

/** Fetches bounded film metadata concurrently. @param {FilmRecord[]} films Films. @param {Object} [options] Batch controls. @returns {Promise<MetadataBatchResult>} Batch result. */
window.fetchFilmMetadata = async function (films, options = {}) {
  return window.runBoundedLookupBatch(
    films,
    {
      idOf: (film) => film.id,
      eligible: (film) => window.filmNeedsMetadataLookup(film),
      attempts: filmMetadataLookupAttempts,
      failureType: "film-metadata",
      failureRecord: lookupFailureRecord,
      lookup: (film, context) => window.lookupTmdbMovieMetadata(film, context),
      apply: (film, metadata) =>
        window.setFilmTmdbMetadata(film.id, metadata, { save: false }),
      notFoundReason: "No TMDB match found.",
      warnMessage: (film) => `Film metadata lookup failed for ${film.title}`,
    },
    options,
  );
};

/** Increments persisted image failure counters. @param {'poster'|'portrait'} type Image type. @param {number} [count] Increment. @returns {number} Updated count. */
window.recordImageImportFailure = function (type, count = 1) {
  window.state.imageImportStats ||= { posterFailures: 0, portraitFailures: 0 };
  let field = type === "portrait" ? "portraitFailures" : "posterFailures";
  window.state.imageImportStats[field] =
    Math.max(0, Number(window.state.imageImportStats[field]) || 0) +
    Math.max(0, Number(count) || 0);
  return window.state.imageImportStats[field];
};

/** Tests whether a film needs a poster or TMDB upgrade. @param {FilmRecord} film Film. @returns {boolean} Whether lookup is needed. */
window.filmNeedsPosterLookup = function (film) {
  return (
    Boolean(film?.id) &&
    (!film.poster || film.poster.source === "wikimedia")
  );
};

/** Fetches bounded film posters concurrently. @param {FilmRecord[]} films Films. @param {Object} [options] Batch controls. @returns {Promise<MetadataBatchResult>} Batch result. */
window.fetchFilmPosters = async function (films, options = {}) {
  return window.runBoundedLookupBatch(
    films,
    {
      idOf: (film) => film.id,
      eligible: (film) => window.filmNeedsPosterLookup(film),
      attempts: posterLookupAttempts,
      failureType: "film-posters",
      failureRecord: lookupFailureRecord,
      lookup: (film, context) => window.lookupFilmPoster(film, context),
      apply: (film, poster) =>
        window.setFilmPoster(film.id, poster, { save: false }),
      notFoundReason: "No poster found.",
      warnMessage: (film) => `Poster lookup failed for ${film.title}`,
      imageFailureType: "poster",
    },
    options,
  );
};

/** Fetches bounded person portraits concurrently. @param {PersonRecord[]} people People. @param {Object} [options] Batch controls. @returns {Promise<MetadataBatchResult>} Batch result. */
window.fetchPersonPortraits = async function (people, options = {}) {
  return window.runBoundedLookupBatch(
    people,
    {
      idOf: (person) => person.id,
      eligible: (person) => Boolean(person?.id && !person.portrait),
      attempts: portraitLookupAttempts,
      failureType: "person-portraits",
      failureRecord: lookupFailureRecord,
      lookup: (person, context) => window.lookupPersonPortrait(person, context),
      apply: (person, portrait) =>
        window.setPersonPortrait(person.id, portrait, { save: false }),
      notFoundReason: "No portrait found.",
      warnMessage: (person) => `Portrait lookup failed for ${person.name}`,
      imageFailureType: "portrait",
    },
    options,
  );
};
