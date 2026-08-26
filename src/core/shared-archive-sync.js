/**
 * @file Pulls the shared, read-only official-results archive
 * (docs/shared-official-results-archive-decision.md) from
 * `/sharedArchive/officialResults[/shards/<key>]` and merges it into
 * `state.officialResults`, then automatically tops up the watchlist with
 * any newly-unwatched official nominee. Also pulls the sibling
 * `/sharedArchive/officialFilmMetadata` and
 * `/sharedArchive/officialPeopleMetadata` flat-map sections
 * (docs/official-results-file-split-decision.md) into the
 * `OSKARS_BUNDLED_OFFICIAL_FILM_METADATA`/`..._PEOPLE_METADATA` globals,
 * overwriting the bundled-JS defaults - the same "bundled default, live
 * pull overwrites" pattern officialResults itself uses. Also pulls the
 * sibling `/sharedArchive/sharedFilmMetadata` flat-map section
 * (docs/shared-film-discovery-decision.md) into
 * `OSKARS_SHARED_FILM_ARCHIVE`/`..._BY_DIRECTOR`
 * (src/domain/shared-film-archive.js) - unlike the two above, this data has
 * no bundled-JS default at all (it starts empty). Deliberately
 * simpler than firestore-sync.js's per-user engine: there is exactly one
 * writer (the owner's local publish script,
 * scripts/publish-shared-official-results-archive.mjs, which writes every
 * shard before the manifest), so a plain manifest-revision comparison is
 * always safe - no three-way diff, no push, no conflicts, and no
 * read-race verification is needed the way the per-user engine's
 * concurrent-writer scenario requires.
 */

(function () {
  const SHARED_ARCHIVE_SECTION_KEY = "officialResults";
  const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  let pullInFlight = null;

  function currentFirebaseUser() {
    return window.getFirebaseCurrentUser?.() || null;
  }

  function sharedArchiveState() {
    return (
      window.state?.draftMetadata?.remoteSync?.sharedArchive || {
        shardRevisions: {},
        filmMetadataShardRevisions: {},
        peopleMetadataShardRevisions: {},
        sharedFilmArchiveShardRevisions: {},
        lastCheckedAt: "",
      }
    );
  }

  function recordSharedArchiveState(patch) {
    let remoteSync = window.cloneRecord(window.state.draftMetadata?.remoteSync || {});
    remoteSync.sharedArchive = { ...sharedArchiveState(), ...patch };
    window.state.draftMetadata = { ...(window.state.draftMetadata || {}), remoteSync };
  }

  function shardSourceId(shardKey) {
    let separatorIndex = shardKey.lastIndexOf("::");
    return separatorIndex === -1 ? shardKey : shardKey.slice(0, separatorIndex);
  }

  /**
   * Attaches a per-viewer filmRef to every nomination in the given
   * (canon-only, filmRef-stripped) periods map, mutating in place - the
   * exact matching logic proposeOfficialResultsImport() already uses for a
   * manual import, applied here to the shared archive's pulled content
   * instead. @param {Record<string, OfficialResultsPeriod>} periods Reassembled periods for one source.
   */
  function attachLocalFilmRefs(periods) {
    let candidates = window.officialResultsFilmCandidates(window.state);
    Object.entries(periods).forEach(([periodKey, period]) => {
      (period?.nominations || []).forEach((nomination) => {
        let match = window.officialResultsFilmMatch(candidates, nomination, periodKey);
        if (match.film) {
          nomination.filmRef = {
            id: match.film.id,
            title: match.film.title,
            year: String(match.film.year || ""),
          };
        } else {
          delete nomination.filmRef;
        }
      });
    });
    return periods;
  }

  async function fetchSharedArchiveShards(
    firestoreModule,
    db,
    shardKeys,
    sectionKey = SHARED_ARCHIVE_SECTION_KEY,
  ) {
    let entries = await Promise.all(
      shardKeys.map(async (shardKey) => {
        let snapshot = await firestoreModule.getDoc(
          firestoreModule.doc(db, "sharedArchive", sectionKey, "shards", shardKey),
        );
        return [shardKey, snapshot.exists() ? snapshot.data()?.value : undefined];
      }),
    );
    return Object.fromEntries(entries.filter(([, value]) => value !== undefined));
  }

  /**
   * Pulls one flat-map shared-archive section (officialFilmMetadata,
   * officialPeopleMetadata) - simpler than the officialResults pull above
   * since there's no per-source period structure, just a manifest of
   * shard revisions and shards each holding a slice of the map. Any
   * changed shard triggers a wholesale refetch-and-replace of the whole
   * map (same "not worth a more precise incremental scheme" posture
   * officialResults itself uses), so this can't silently keep stale
   * entries around.
   * @param {Object} firestoreModule Firestore SDK module.
   * @param {Object} db Firestore instance.
   * @param {string} sectionKey e.g. "officialFilmMetadata".
   * @param {Record<string,string>} lastKnownRevisions Previously seen shard revisions.
   * @returns {Promise<{ok:boolean, merged?:Object, shardRevisions?:Object, changed?:boolean, reason?:string}>}
   */
  async function pullFlatMapArchiveSection(firestoreModule, db, sectionKey, lastKnownRevisions) {
    let manifestSnapshot;
    try {
      manifestSnapshot = await firestoreModule.getDoc(
        firestoreModule.doc(db, "sharedArchive", sectionKey),
      );
    } catch (err) {
      if (window.isUnauthorizedFirestoreError?.(err)) return { ok: true, reason: "unauthorized" };
      return { ok: false, reason: "error", error: err };
    }
    if (!manifestSnapshot.exists()) return { ok: true, reason: "empty" };
    let manifest = manifestSnapshot.data() || {};
    let remoteShardKeys = Array.isArray(manifest.shardKeys) ? manifest.shardKeys : [];
    let remoteShardRevisions =
      manifest.shardRevisions && typeof manifest.shardRevisions === "object"
        ? manifest.shardRevisions
        : {};
    let changed = remoteShardKeys.some(
      (shardKey) => lastKnownRevisions[shardKey] !== remoteShardRevisions[shardKey],
    );
    if (!changed) changed = Object.keys(lastKnownRevisions).some((shardKey) => !(shardKey in remoteShardRevisions));
    if (!changed) return { ok: true, reason: "up-to-date", shardRevisions: remoteShardRevisions };

    let fetchedShardValues;
    try {
      fetchedShardValues = await fetchSharedArchiveShards(firestoreModule, db, remoteShardKeys, sectionKey);
    } catch (err) {
      if (window.isUnauthorizedFirestoreError?.(err)) return { ok: true, reason: "unauthorized" };
      return { ok: false, reason: "error", error: err };
    }
    let merged = {};
    remoteShardKeys.forEach((shardKey) => Object.assign(merged, fetchedShardValues[shardKey] || {}));
    return { ok: true, changed: true, merged, shardRevisions: remoteShardRevisions };
  }

  async function performSharedArchivePull() {
    if (!window.oskarsPersistenceAllowed?.()) {
      window.setSharedFilmArchiveStatus?.("unavailable");
      return { ok: true, reason: "not-allowed" };
    }
    if (!currentFirebaseUser()) {
      window.setSharedFilmArchiveStatus?.("unavailable");
      return { ok: true, reason: "signed-out" };
    }
    // This tree is shared, objective, read-only data. Private workspace
    // lineage guards apply only to /users/<uid>/... sync; eligibility for
    // /sharedArchive/... is enforced independently by Firestore rules.
    window.setSharedFilmArchiveStatus?.("loading");

    let ready = await window.ensureFirestoreDb?.();
    if (!ready) {
      window.setSharedFilmArchiveStatus?.("unavailable");
      return { ok: false, reason: "unconfigured" };
    }
    let { firestoreModule, db } = ready;

    // Independent of officialResults' own change status below (a
    // ceremony's nominations can be unchanged while a later assemble pass
    // still adds new film/people metadata, or vice versa) - pulled first
    // so neither section's early returns skip the other.
    let priorState = sharedArchiveState();
    let [filmPull, peoplePull, sharedFilmArchivePull] = await Promise.all([
      pullFlatMapArchiveSection(
        firestoreModule,
        db,
        "officialFilmMetadata",
        priorState.filmMetadataShardRevisions || {},
      ),
      pullFlatMapArchiveSection(
        firestoreModule,
        db,
        "officialPeopleMetadata",
        priorState.peopleMetadataShardRevisions || {},
      ),
      pullFlatMapArchiveSection(
        firestoreModule,
        db,
        "sharedFilmMetadata",
        Object.keys(window.OSKARS_SHARED_FILM_ARCHIVE || {}).length
          ? priorState.sharedFilmArchiveShardRevisions || {}
          : {},
      ),
    ]);
    if (filmPull.changed || peoplePull.changed)
      window.applyOfficialMetadataGlobals({
        films: filmPull.changed ? filmPull.merged : undefined,
        people: peoplePull.changed ? peoplePull.merged : undefined,
      });
    if (sharedFilmArchivePull.changed)
      window.applySharedFilmArchive(sharedFilmArchivePull.merged);
    else if (sharedFilmArchivePull.reason === "empty")
      window.applySharedFilmArchive({});
    else if (sharedFilmArchivePull.reason === "up-to-date")
      window.setSharedFilmArchiveStatus?.("ready");
    else window.setSharedFilmArchiveStatus?.("unavailable");
    if (filmPull.shardRevisions || peoplePull.shardRevisions || sharedFilmArchivePull.shardRevisions)
      recordSharedArchiveState({
        ...(filmPull.shardRevisions && {
          filmMetadataShardRevisions: filmPull.shardRevisions,
        }),
        ...(peoplePull.shardRevisions && {
          peopleMetadataShardRevisions: peoplePull.shardRevisions,
        }),
        ...(sharedFilmArchivePull.shardRevisions && {
          sharedFilmArchiveShardRevisions: sharedFilmArchivePull.shardRevisions,
        }),
      });

    let manifestSnapshot;
    try {
      manifestSnapshot = await firestoreModule.getDoc(
        firestoreModule.doc(db, "sharedArchive", SHARED_ARCHIVE_SECTION_KEY),
      );
    } catch (err) {
      // Fails closed silently, same posture as an ineligible account's
      // per-user sync denial (docs/cloud-sync-eligibility-decision.md) -
      // this is read-only top-up data, never worth surfacing an error UI
      // for.
      if (window.isUnauthorizedFirestoreError?.(err)) return { ok: true, reason: "unauthorized" };
      return { ok: false, reason: "error", error: err };
    }
    recordSharedArchiveState({ lastCheckedAt: new Date().toISOString() });
    if (!manifestSnapshot.exists()) return { ok: true, reason: "empty" };

    let manifest = manifestSnapshot.data() || {};
    let remoteShardKeys = Array.isArray(manifest.shardKeys) ? manifest.shardKeys : [];
    let remoteShardRevisions =
      manifest.shardRevisions && typeof manifest.shardRevisions === "object"
        ? manifest.shardRevisions
        : {};
    let lastKnown = sharedArchiveState().shardRevisions || {};

    // A source is "changed" if any of its current shard keys have a new
    // revision, a shard was added, or a previously-known shard for it is
    // gone (removed, or shard boundaries shifted after a reshuffle -
    // either way, that source's complete current shard set is refetched
    // and its local periods replaced wholesale, which stays correct
    // regardless of how shard boundaries moved between publishes).
    let changedSourceIds = new Set();
    remoteShardKeys.forEach((shardKey) => {
      if (lastKnown[shardKey] !== remoteShardRevisions[shardKey])
        changedSourceIds.add(shardSourceId(shardKey));
    });
    Object.keys(lastKnown).forEach((shardKey) => {
      if (!(shardKey in remoteShardRevisions)) changedSourceIds.add(shardSourceId(shardKey));
    });

    let removedSourceIds = new Set(
      [...new Set(Object.keys(lastKnown).map(shardSourceId))].filter(
        (sourceId) => !remoteShardKeys.some((shardKey) => shardSourceId(shardKey) === sourceId),
      ),
    );

    if (!changedSourceIds.size && !removedSourceIds.size) {
      recordSharedArchiveState({ shardRevisions: remoteShardRevisions });
      return { ok: true, reason: "up-to-date" };
    }

    let shardKeysToFetch = remoteShardKeys.filter((shardKey) =>
      changedSourceIds.has(shardSourceId(shardKey)),
    );
    let fetchedShardValues;
    try {
      fetchedShardValues = await fetchSharedArchiveShards(firestoreModule, db, shardKeysToFetch);
    } catch (err) {
      if (window.isUnauthorizedFirestoreError?.(err)) return { ok: true, reason: "unauthorized" };
      return { ok: false, reason: "error", error: err };
    }

    let reassembled = window.reassembleWorkspaceSection(
      SHARED_ARCHIVE_SECTION_KEY,
      fetchedShardValues,
    );
    window.state.officialResults ||= {};
    changedSourceIds.forEach((sourceId) => {
      let source = reassembled[sourceId];
      if (!source) return;
      let periods = attachLocalFilmRefs(source.periods || {});
      window.state.officialResults[sourceId] = {
        id: source.id || sourceId,
        name: source.name || sourceId,
        sourceRevision: window.canonicalDataRevision(periods),
        periods,
      };
    });
    removedSourceIds.forEach((sourceId) => {
      delete window.state.officialResults[sourceId];
    });

    window.rebuildAggregates?.();
    let autoAddResult = window.autoAddUnseenOfficialResultsToWatchlist?.({ save: false });
    recordSharedArchiveState({ shardRevisions: remoteShardRevisions });
    window.markAggregatesDirty?.("shared official-results archive pulled");
    let saving = window.save?.({ immediate: true, rebuild: false });
    if (saving?.then) await saving;

    return {
      ok: true,
      changedSourceIds: [...changedSourceIds],
      removedSourceIds: [...removedSourceIds],
      addedTotal: autoAddResult?.addedTotal || 0,
    };
  }

  /**
   * Runs one shared-archive pull-and-reconcile pass, coalescing overlapping
   * calls the same way runWorkspaceSync does.
   * @returns {Promise<Object>} Pull outcome.
   */
  window.pullSharedOfficialResultsArchive = function () {
    if (!pullInFlight)
      pullInFlight = performSharedArchivePull()
        .catch((err) => {
          console.error("Shared official-results archive pull failed", err);
          window.setSharedFilmArchiveStatus?.("unavailable");
          return { ok: false, reason: "error", error: err };
        })
        .finally(() => {
          pullInFlight = null;
        });
    return pullInFlight;
  };

  /**
   * Starts the first shared-archive pull once local data is fully
   * hydrated, mirroring noteOskarsDataReadyForSync's own guard shape so an
   * early auth callback can't race the initial IndexedDB load.
   */
  window.noteOskarsDataReadyForSharedArchivePull = function () {
    if (currentFirebaseUser()) window.pullSharedOfficialResultsArchive();
  };

  function pullIfStale() {
    if (!currentFirebaseUser() || window.OSKARS_DATA_READY !== true) return;
    let lastCheckedAt = sharedArchiveState().lastCheckedAt;
    let elapsed = lastCheckedAt ? Date.now() - new Date(lastCheckedAt).getTime() : Infinity;
    if (!(elapsed >= RECHECK_INTERVAL_MS)) return;
    window.pullSharedOfficialResultsArchive();
  }

  // Lighter trigger set than firestore-sync.js's four (sign-in, reconnect,
  // focus, after-save): this is read-only top-up data with no urgency, so
  // reconnect/focus are gated to at most once per RECHECK_INTERVAL_MS
  // rather than hitting Firestore on every tab focus.
  window.onFirebaseAuthChange?.((user) => {
    if (user && window.OSKARS_DATA_READY === true) window.pullSharedOfficialResultsArchive();
  });
  window.addEventListener?.("online", pullIfStale);
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") pullIfStale();
  });
})();
