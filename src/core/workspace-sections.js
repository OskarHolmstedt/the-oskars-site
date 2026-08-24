/**
 * @file Splits each canonical top-level section into bounded, independently
 * revisioned shards for Firestore sync (issue #248), and reassembles shards
 * back into the exact original section value. Pure data transforms only -
 * no Firestore, no window.state access beyond the values passed in. See
 * docs/firestore-workspace-sync-decision.md for why sections must be
 * chunked (four of them already exceed Firestore's 1 MiB document cap at
 * this app's real archive scale) and why shards are contiguous
 * position/sorted-key slices rather than stable-id hashing.
 */

// Tuned against data/oskars-data.json's real sizes - see the decision doc's
// shard-sizing table. SINGLE_SHARD sections are far under 1 MiB today; using
// the same chunker with an effectively unbounded chunk size (rather than a
// separate "small section" code path) keeps exactly one representation for
// every section, chunked or not.
const SINGLE_SHARD = Number.MAX_SAFE_INTEGER;
const YEARS_FILMS_PER_SHARD = 150;
const WATCHLIST_ITEMS_PER_SHARD = 800;
const OFFICIAL_RESULTS_PERIODS_PER_SHARD = 20;
const PERSON_PORTRAITS_PER_SHARD = 800;
const EDIT_LOG_ENTRIES_PER_SHARD = 50;

const WORKSPACE_SECTION_SPECS = {
  years: { kind: "years" },
  officialResults: { kind: "official-results" },
  collectionAwards: { kind: "opaque" },
  watchlist: { kind: "array", chunkSize: WATCHLIST_ITEMS_PER_SHARD },
  watchedFilms: { kind: "array", chunkSize: SINGLE_SHARD },
  intakeWorkflows: { kind: "array", chunkSize: SINGLE_SHARD },
  rejectedPersonAliases: { kind: "array", chunkSize: SINGLE_SHARD },
  declinedOfficialWatchlistAdds: { kind: "array", chunkSize: SINGLE_SHARD },
  projects: { kind: "array", chunkSize: SINGLE_SHARD },
  editLog: { kind: "array", chunkSize: EDIT_LOG_ENTRIES_PER_SHARD },
  personPortraits: { kind: "map", chunkSize: PERSON_PORTRAITS_PER_SHARD },
  peopleAliases: { kind: "map", chunkSize: SINGLE_SHARD },
  franchiseLinks: { kind: "map", chunkSize: SINGLE_SHARD },
  directorLinks: { kind: "map", chunkSize: SINGLE_SHARD },
  watchlistProjectSources: { kind: "map", chunkSize: SINGLE_SHARD },
  entityNotes: { kind: "opaque" },
  localRanks: { kind: "opaque" },
  rankingReviews: { kind: "opaque" },
  awardReviews: { kind: "opaque" },
  opinionRebuildSession: { kind: "opinion-rebuild" },
};

// A future canonical section added to CANONICAL_TOP_LEVEL_KEYS without a
// matching entry here would otherwise silently fall through to nothing -
// this throws immediately at load time (not just in tests), the same
// "unsafe outcome is structurally impossible" posture
// canonical-data.js's own disclosure-classification self-checks use.
(function assertWorkspaceSectionSpecsComplete() {
  let keys = window.OSKARS_CANONICAL_SECTION_KEYS || [];
  let missing = keys.filter((key) => !WORKSPACE_SECTION_SPECS[key]);
  if (missing.length)
    throw new Error(
      `Every canonical section must have a workspace-sync chunking spec ` +
        `(issue #248). Missing: ${missing.join(", ")}.`,
    );
})();

function workspaceIsRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Splits an array into contiguous slices, always returning at least one
 * (possibly empty) chunk so an empty section still produces shard "0".
 * @param {Array} items Source array.
 * @param {number} chunkSize Maximum items per chunk.
 * @returns {Array[]} Ordered chunks.
 */
function chunkArrayContiguous(items, chunkSize) {
  let list = Array.isArray(items) ? items : [];
  if (!list.length) return [[]];
  let chunks = [];
  for (let index = 0; index < list.length; index += chunkSize)
    chunks.push(list.slice(index, index + chunkSize));
  return chunks;
}

/**
 * Splits a plain object into contiguous sorted-key slices, always
 * returning at least one (possibly empty) chunk.
 * @param {Object} map Source object.
 * @param {number} chunkSize Maximum keys per chunk.
 * @returns {Object[]} Ordered chunks.
 */
function chunkMapBySortedKeys(map, chunkSize) {
  let record = workspaceIsRecord(map) ? map : {};
  let keys = Object.keys(record).sort();
  if (!keys.length) return [{}];
  let chunks = [];
  for (let index = 0; index < keys.length; index += chunkSize) {
    let chunk = {};
    keys.slice(index, index + chunkSize).forEach((key) => {
      chunk[key] = record[key];
    });
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Splits a `<prefix>::<index>` shard key. A key without the separator is
 * its own whole prefix at index 0 (never produced by this file's own
 * chunkers, which always emit the suffixed form, but tolerated on read for
 * robustness).
 * @param {string} shardKey Shard key.
 * @returns {{prefix: string, index: number}}
 */
function parseShardKey(shardKey) {
  let separatorIndex = String(shardKey || "").lastIndexOf("::");
  if (separatorIndex === -1) return { prefix: String(shardKey || ""), index: 0 };
  return {
    prefix: shardKey.slice(0, separatorIndex),
    index: Number(shardKey.slice(separatorIndex + 2)) || 0,
  };
}

/**
 * Orders shard keys by prefix, then numerically by chunk index - required
 * for reassembly, since lexicographic order would place `::10` before
 * `::2`.
 * @param {string} a Shard key.
 * @param {string} b Shard key.
 * @returns {number}
 */
function compareShardKeys(a, b) {
  let left = parseShardKey(a);
  let right = parseShardKey(b);
  if (left.prefix !== right.prefix) return left.prefix < right.prefix ? -1 : 1;
  return left.index - right.index;
}

function chunkYearsSection(years) {
  let record = workspaceIsRecord(years) ? years : {};
  let shardKeys = [];
  let shards = {};
  Object.keys(record)
    .sort()
    .forEach((periodKey) => {
      let period = record[periodKey] || {};
      chunkArrayContiguous(period.films, YEARS_FILMS_PER_SHARD).forEach(
        (filmsChunk, index) => {
          let shardKey = `${periodKey}::${index}`;
          shardKeys.push(shardKey);
          shards[shardKey] =
            index === 0
              ? {
                  films: filmsChunk,
                  ...(period.periodType !== undefined
                    ? { periodType: period.periodType }
                    : {}),
                  ...(period.sourceUrl !== undefined
                    ? { sourceUrl: period.sourceUrl }
                    : {}),
                }
              : { films: filmsChunk };
        },
      );
    });
  return { shardKeys, shards };
}

function reassembleYearsSection(shardValuesByKey) {
  let periods = {};
  Object.keys(shardValuesByKey)
    .sort(compareShardKeys)
    .forEach((shardKey) => {
      let { prefix: periodKey } = parseShardKey(shardKey);
      let shard = shardValuesByKey[shardKey] || {};
      if (!periods[periodKey]) periods[periodKey] = { films: [] };
      if (shard.periodType !== undefined) periods[periodKey].periodType = shard.periodType;
      if (shard.sourceUrl !== undefined) periods[periodKey].sourceUrl = shard.sourceUrl;
      periods[periodKey].films = periods[periodKey].films.concat(shard.films || []);
    });
  return periods;
}

function chunkOfficialResultsSection(officialResults) {
  let record = workspaceIsRecord(officialResults) ? officialResults : {};
  let shardKeys = [];
  let shards = {};
  Object.keys(record)
    .sort()
    .forEach((sourceId) => {
      let source = record[sourceId] || {};
      chunkMapBySortedKeys(source.periods, OFFICIAL_RESULTS_PERIODS_PER_SHARD).forEach(
        (periodsChunk, index) => {
          let shardKey = `${sourceId}::${index}`;
          shardKeys.push(shardKey);
          shards[shardKey] =
            index === 0
              ? {
                  periods: periodsChunk,
                  ...(source.id !== undefined ? { id: source.id } : {}),
                  ...(source.name !== undefined ? { name: source.name } : {}),
                  ...(source.sourceRevision !== undefined
                    ? { sourceRevision: source.sourceRevision }
                    : {}),
                }
              : { periods: periodsChunk };
        },
      );
    });
  return { shardKeys, shards };
}

function reassembleOfficialResultsSection(shardValuesByKey) {
  let sources = {};
  Object.keys(shardValuesByKey)
    .sort(compareShardKeys)
    .forEach((shardKey) => {
      let { prefix: sourceId } = parseShardKey(shardKey);
      let shard = shardValuesByKey[shardKey] || {};
      if (!sources[sourceId]) sources[sourceId] = { periods: {} };
      if (shard.id !== undefined) sources[sourceId].id = shard.id;
      if (shard.name !== undefined) sources[sourceId].name = shard.name;
      if (shard.sourceRevision !== undefined)
        sources[sourceId].sourceRevision = shard.sourceRevision;
      Object.assign(sources[sourceId].periods, shard.periods || {});
    });
  return sources;
}

function chunkArraySection(items, chunkSize) {
  let shardKeys = [];
  let shards = {};
  chunkArrayContiguous(items, chunkSize).forEach((chunk, index) => {
    let shardKey = String(index);
    shardKeys.push(shardKey);
    shards[shardKey] = chunk;
  });
  return { shardKeys, shards };
}

function reassembleArraySection(shardValuesByKey) {
  return Object.keys(shardValuesByKey)
    .sort((a, b) => Number(a) - Number(b))
    .reduce((all, key) => all.concat(shardValuesByKey[key] || []), []);
}

function chunkMapSection(map, chunkSize) {
  let shardKeys = [];
  let shards = {};
  chunkMapBySortedKeys(map, chunkSize).forEach((chunk, index) => {
    let shardKey = String(index);
    shardKeys.push(shardKey);
    shards[shardKey] = chunk;
  });
  return { shardKeys, shards };
}

function reassembleMapSection(shardValuesByKey) {
  let merged = {};
  Object.keys(shardValuesByKey)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((key) => Object.assign(merged, shardValuesByKey[key] || {}));
  return merged;
}

function chunkOpinionRebuildSection(session) {
  if (!workspaceIsRecord(session))
    return { shardKeys: ["meta"], shards: { meta: null } };
  let shardKeys = ["meta"];
  let shards = {
    meta: Object.fromEntries(
      Object.entries(session).filter(
        ([key]) => !["films", "watchlist", "watchedOther"].includes(key),
      ),
    ),
  };
  [
    ["films", 150],
    ["watchlist", WATCHLIST_ITEMS_PER_SHARD],
    ["watchedOther", WATCHLIST_ITEMS_PER_SHARD],
  ].forEach(([key, chunkSize]) => {
    chunkMapBySortedKeys(session[key], chunkSize).forEach((chunk, index) => {
      let shardKey = `${key}::${index}`;
      shardKeys.push(shardKey);
      shards[shardKey] = chunk;
    });
  });
  return { shardKeys, shards };
}

function reassembleOpinionRebuildSection(shardValuesByKey) {
  if (shardValuesByKey.meta === null) return null;
  let session = { ...(shardValuesByKey.meta || {}) };
  ["films", "watchlist", "watchedOther"].forEach((prefix) => {
    session[prefix] = {};
    Object.keys(shardValuesByKey)
      .filter((key) => key.startsWith(`${prefix}::`))
      .sort(compareShardKeys)
      .forEach((key) => Object.assign(session[prefix], shardValuesByKey[key] || {}));
  });
  return session;
}

function chunkOpaqueSection(value) {
  return { shardKeys: ["0"], shards: { "0": value === undefined ? null : value } };
}

function reassembleOpaqueSection(shardValuesByKey) {
  return shardValuesByKey["0"];
}

/**
 * Splits one canonical section's current value into bounded shards.
 * @param {string} sectionKey One of window.OSKARS_CANONICAL_SECTION_KEYS.
 * @returns {{shardKeys: string[], shards: Record<string, *>}} Ordered shard
 *   keys (matching Object.keys(shards) but establishing intended order) and
 *   each shard's value, keyed by shard key.
 */
window.chunkWorkspaceSection = function (sectionKey, sectionValue) {
  let spec = WORKSPACE_SECTION_SPECS[sectionKey];
  if (!spec) throw new Error(`Unknown workspace section: ${sectionKey}`);
  if (spec.kind === "years") return chunkYearsSection(sectionValue);
  if (spec.kind === "official-results") return chunkOfficialResultsSection(sectionValue);
  if (spec.kind === "opinion-rebuild")
    return chunkOpinionRebuildSection(sectionValue);
  if (spec.kind === "array") return chunkArraySection(sectionValue, spec.chunkSize);
  if (spec.kind === "map") return chunkMapSection(sectionValue, spec.chunkSize);
  return chunkOpaqueSection(sectionValue);
};

/**
 * Reassembles a canonical section's value from its shards. Exact inverse
 * of chunkWorkspaceSection - order-independent in shardValuesByKey's key
 * order (shards may arrive from Firestore in any order).
 * @param {string} sectionKey One of window.OSKARS_CANONICAL_SECTION_KEYS.
 * @param {Record<string, *>} shardValuesByKey Every shard needed to fully represent the section, keyed by shard key.
 * @returns {*} The reassembled section value.
 */
window.reassembleWorkspaceSection = function (sectionKey, shardValuesByKey) {
  let spec = WORKSPACE_SECTION_SPECS[sectionKey];
  if (!spec) throw new Error(`Unknown workspace section: ${sectionKey}`);
  if (spec.kind === "years") return reassembleYearsSection(shardValuesByKey);
  if (spec.kind === "official-results")
    return reassembleOfficialResultsSection(shardValuesByKey);
  if (spec.kind === "opinion-rebuild")
    return reassembleOpinionRebuildSection(shardValuesByKey);
  if (spec.kind === "array") return reassembleArraySection(shardValuesByKey);
  if (spec.kind === "map") return reassembleMapSection(shardValuesByKey);
  return reassembleOpaqueSection(shardValuesByKey);
};

/**
 * Content-hash revision of one shard's value, reusing the same
 * deterministic FNV-1a hash already used for canonical/public-profile
 * revisions app-wide (src/core/state-shape.js's canonicalDataRevision) so
 * conflict detection never depends on wall-clock time or server timestamps.
 * @param {*} shardValue Shard value.
 * @returns {string} Revision.
 */
window.workspaceShardRevision = function (shardValue) {
  return window.canonicalDataRevision(shardValue);
};

// Caps each of added/removed/changed at this many entries in
// workspaceShardRecordDiff's output - "bounded... allow expansion when
// detail is needed" (issue #334), not a raw per-record dump. The true
// count survives separately (addedTotal etc.) so a caller can note
// "+N more" rather than silently truncating.
const SHARD_DIFF_RECORD_CAP = 20;

function workspaceShardDiffableCollection(kind, shardValue) {
  if (kind === "years") return shardValue?.films || [];
  if (kind === "official-results") return shardValue?.periods || {};
  if (kind === "array") return shardValue || [];
  if (kind === "map") return shardValue || {};
  return null;
}

function workspaceShardRecordLabel(identity, record) {
  return String(record?.title || record?.name || identity);
}

function workspaceShardRecordEntries(identities, records, cap) {
  let entries = identities.map((identity) => ({
    identity,
    label: workspaceShardRecordLabel(identity, records.get(identity)),
  }));
  return { entries: entries.slice(0, cap), total: entries.length };
}

/**
 * Summarizes what adopting a shard's remote value would add, remove (i.e.
 * discard from this device), or change relative to its local value -
 * issue #334's informed conflict-resolution preview. Reuses the same
 * per-record identity/change-detection idiom
 * window.canonicalPublicationChanges already uses for the whole-archive
 * publication preview (src/data/publication.js), applied one level down
 * to a single shard's own record collection.
 * @param {string} sectionKey One of window.OSKARS_CANONICAL_SECTION_KEYS.
 * @param {*} localValue This device's shard value (undefined if absent).
 * @param {*} remoteValue The other device's shard value (undefined if absent).
 * @returns {{kind: string, changed: boolean, added?: Array<{identity: string, label: string}>,
 *   addedTotal?: number, removed?: Array<{identity: string, label: string}>,
 *   removedTotal?: number, changedRecords?: Array<{identity: string, label: string}>,
 *   changedTotal?: number}} Bounded diff summary. "opaque" kinds (5 of 18
 *   sections don't decompose into records) return only {kind, changed}.
 */
window.workspaceShardRecordDiff = function (sectionKey, localValue, remoteValue) {
  let kind = WORKSPACE_SECTION_SPECS[sectionKey]?.kind;
  let changed =
    window.canonicalDataRevision(localValue) !==
    window.canonicalDataRevision(remoteValue);
  if (kind === "opaque" || kind === "opinion-rebuild" || !kind)
    return { kind: "opaque", changed };
  let localRecords = new Map(
    window.publicationRecords(workspaceShardDiffableCollection(kind, localValue)),
  );
  let remoteRecords = new Map(
    window.publicationRecords(workspaceShardDiffableCollection(kind, remoteValue)),
  );
  let addedIdentities = [];
  let removedIdentities = [];
  let changedIdentities = [];
  new Set([...localRecords.keys(), ...remoteRecords.keys()]).forEach((identity) => {
    let hasLocal = localRecords.has(identity);
    let hasRemote = remoteRecords.has(identity);
    if (hasRemote && !hasLocal) addedIdentities.push(identity);
    else if (hasLocal && !hasRemote) removedIdentities.push(identity);
    else if (
      window.canonicalDataRevision(localRecords.get(identity)) !==
      window.canonicalDataRevision(remoteRecords.get(identity))
    )
      changedIdentities.push(identity);
  });
  let added = workspaceShardRecordEntries(addedIdentities, remoteRecords, SHARD_DIFF_RECORD_CAP);
  let removed = workspaceShardRecordEntries(removedIdentities, localRecords, SHARD_DIFF_RECORD_CAP);
  let changedEntries = workspaceShardRecordEntries(
    changedIdentities,
    remoteRecords,
    SHARD_DIFF_RECORD_CAP,
  );
  return {
    kind,
    changed,
    added: added.entries,
    addedTotal: added.total,
    removed: removed.entries,
    removedTotal: removed.total,
    changedRecords: changedEntries.entries,
    changedTotal: changedEntries.total,
  };
};
