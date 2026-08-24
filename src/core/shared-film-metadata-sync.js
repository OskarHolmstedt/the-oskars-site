/**
 * @file Populates the shared, cross-user film-metadata archive
 * (docs/shared-film-metadata-decision.md) at `/sharedFilmMetadata/<tmdbId>`:
 * objective TMDB fields plus a director/award-derived people-credit list,
 * stripped of every subjective award fact (category/placement/period/
 * winner status never leaves this device). Two write paths:
 * (1) insert-if-missing right after a successful TMDB metadata fetch for
 * the user's own watched/watchlist film (posters.js/watchlists.js call
 * pushSharedFilmMetadata after applying), and (2) a periodic reconciliation
 * pass, following the same trigger set firestore-sync.js's per-user engine
 * uses, that merges any newly-revealed people (e.g. a crew member first
 * named by a later award nomination) into an already-shared film's doc.
 * Unlike shared-archive-sync.js's read-only official-results pull, this
 * collection *is* written from the browser, so every write is additionally
 * bounded by a global size cap and a per-user daily write cap, both
 * enforced in firestore.rules via transactionally-maintained counter
 * documents - never just trusted client behavior.
 */

(function () {
  const SHARED_FILM_METADATA_SCHEMA_VERSION = 1;
  const SHARED_FILM_METADATA_MAX_TOTAL = 50000;
  const SHARED_FILM_METADATA_DAILY_QUOTA = 500;
  const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const RECONCILE_DEBOUNCE_MS = 5000;
  let reconcileDebounceTimer = null;
  let reconcileInFlight = null;

  function currentFirebaseUser() {
    return window.getFirebaseCurrentUser?.() || null;
  }

  function todayDateKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function metadataSyncState() {
    return (
      window.state?.draftMetadata?.remoteSync?.sharedFilmMetadata || {
        pushedPeopleByTmdbId: {},
        lastCheckedAt: "",
      }
    );
  }

  function recordMetadataSyncState(patch) {
    let remoteSync = window.cloneRecord(
      window.state.draftMetadata?.remoteSync || {},
    );
    remoteSync.sharedFilmMetadata = { ...metadataSyncState(), ...patch };
    window.state.draftMetadata = {
      ...(window.state.draftMetadata || {}),
      remoteSync,
    };
  }

  /**
   * Builds the objective, award-stripped people-credit map for one film:
   * director(s) always, plus whatever `PERSON_AWARD_PROFESSIONS`-mapped
   * award recipient the film's own awards reveal. Never includes category,
   * placement, period, or winner status - only name/profession/role-detail.
   * Pure function of the film record alone (aside from the shared
   * normalizePersonName/PERSON_AWARD_PROFESSIONS lookups every credit path
   * in this app already uses), so it's directly unit-testable.
   * @param {FilmRecord|WatchlistItem|WatchedOtherEntry} film Source record.
   * @returns {Record<string, {name: string, professions: string[], details: string[]}>}
   */
  window.buildSharedFilmPeopleCredits = function (film) {
    let people = {};
    function addPerson(name, profession, detail) {
      let personId = window.normalizePersonName?.(name);
      if (!personId) return;
      let entry = (people[personId] ||= {
        name: String(name).trim(),
        professions: [],
        details: [],
      });
      if (profession && !entry.professions.includes(profession))
        entry.professions.push(profession);
      if (detail && !entry.details.includes(detail))
        entry.details.push(detail);
    }
    let directors = film?.directors?.length
      ? film.directors
      : window.parsePersonCredit?.(film?.director).names || [];
    directors.forEach((name) => addPerson(name, "Director", ""));
    (film?.awards || []).forEach((award) => {
      let profession = window.PERSON_AWARD_PROFESSIONS?.[award.category];
      if (!profession) return;
      (award.recipients || []).forEach((recipient) => {
        addPerson(recipient?.name, profession, award.detail || "");
      });
    });
    return people;
  };

  function sharedFilmMetadataPayload(film, metadata, people) {
    return {
      tmdbId: String(metadata?.tmdbId || film?.tmdbId || ""),
      title: String(film?.title || ""),
      year: String(film?.year || ""),
      poster: metadata?.poster || film?.poster || null,
      country: String(metadata?.country ?? film?.country ?? ""),
      primaryCountry: String(
        metadata?.primaryCountry ?? film?.primaryCountry ?? "",
      ),
      runtimeMinutes:
        Number(metadata?.runtimeMinutes ?? film?.runtimeMinutes) || 0,
      swedishTitle: String(metadata?.swedishTitle ?? film?.swedishTitle ?? ""),
      people,
      schemaVersion: SHARED_FILM_METADATA_SCHEMA_VERSION,
    };
  }

  async function performPushSharedFilmMetadata(film, metadata) {
    if (!window.oskarsPersistenceAllowed?.())
      return { ok: true, reason: "not-allowed" };
    let user = currentFirebaseUser();
    if (!user) return { ok: true, reason: "signed-out" };
    if (!window.getWorkspaceSyncAccountAccess?.().allowed)
      return { ok: true, reason: "unlinked" };
    let tmdbId = String(metadata?.tmdbId || film?.tmdbId || "");
    if (!tmdbId) return { ok: true, reason: "no-tmdb-id" };

    let ready = await window.ensureFirestoreDb?.();
    if (!ready) return { ok: false, reason: "unconfigured" };
    let { firestoreModule, db } = ready;

    let filmRef = firestoreModule.doc(db, "sharedFilmMetadata", tmdbId);
    let statsRef = firestoreModule.doc(db, "sharedFilmMetadataStats", "global");
    let quotaRef = firestoreModule.doc(db, "sharedFilmMetadataQuota", user.uid);
    let today = todayDateKey();
    let people = window.buildSharedFilmPeopleCredits(film);
    let payload = sharedFilmMetadataPayload(film, metadata, people);

    try {
      let created = false;
      await firestoreModule.runTransaction(db, async (tx) => {
        let [filmSnap, statsSnap, quotaSnap] = await Promise.all([
          tx.get(filmRef),
          tx.get(statsRef),
          tx.get(quotaRef),
        ]);
        if (filmSnap.exists()) return;
        let count = Number(statsSnap.data()?.count) || 0;
        if (count >= SHARED_FILM_METADATA_MAX_TOTAL) {
          let error = new Error("Shared film metadata archive is at capacity");
          error.code = "OSKARS_SHARED_METADATA_CAP";
          throw error;
        }
        let quota = quotaSnap.data();
        let quotaCount = quota?.date === today ? Number(quota.count) || 0 : 0;
        if (quotaCount >= SHARED_FILM_METADATA_DAILY_QUOTA) {
          let error = new Error("Daily shared film metadata quota reached");
          error.code = "OSKARS_SHARED_METADATA_QUOTA";
          throw error;
        }
        tx.set(filmRef, {
          ...payload,
          createdAt: firestoreModule.serverTimestamp(),
          updatedAt: firestoreModule.serverTimestamp(),
        });
        tx.set(statsRef, { count: count + 1 });
        tx.set(quotaRef, { date: today, count: quotaCount + 1 });
        created = true;
      });
      return { ok: true, reason: created ? "created" : "already-shared" };
    } catch (err) {
      if (
        err?.code === "OSKARS_SHARED_METADATA_CAP" ||
        err?.code === "OSKARS_SHARED_METADATA_QUOTA"
      )
        return { ok: true, reason: err.code };
      if (window.isUnauthorizedFirestoreError?.(err))
        return { ok: true, reason: "unauthorized" };
      return { ok: false, reason: "error", error: err };
    }
  }

  /**
   * Inserts a shared metadata slot for `film` if one doesn't already exist
   * for its TMDB id. Best-effort and fire-and-forget: never throws into the
   * caller, and a no-op whenever signed out, unlinked, unconfigured, over
   * either rate cap, or the film has no resolvable TMDB id.
   * @param {FilmRecord|WatchlistItem|WatchedOtherEntry} film Source record, already updated with `metadata`.
   * @param {Object} metadata The TMDB lookup result just applied to `film`.
   * @returns {Promise<{ok: boolean, reason?: string, error?: Error}>}
   */
  window.pushSharedFilmMetadata = function (film, metadata) {
    return performPushSharedFilmMetadata(film, metadata).catch((err) => {
      console.error("Shared film metadata push failed", err);
      return { ok: false, reason: "error", error: err };
    });
  };

  async function performReconcileSharedFilmMetadataPeople() {
    if (!window.oskarsPersistenceAllowed?.())
      return { ok: true, reason: "not-allowed" };
    let user = currentFirebaseUser();
    if (!user) return { ok: true, reason: "signed-out" };
    if (!window.getWorkspaceSyncAccountAccess?.().allowed)
      return { ok: true, reason: "unlinked" };
    let ready = await window.ensureFirestoreDb?.();
    if (!ready) return { ok: false, reason: "unconfigured" };
    let { firestoreModule, db } = ready;

    let pushedPeople = metadataSyncState().pushedPeopleByTmdbId || {};
    let nextPushedPeople = { ...pushedPeople };
    let films = Object.values(window.state?.filmsById || {}).filter(
      (film) => film?.tmdbId,
    );
    let touchedCount = 0;
    let stopped = false;

    for (let film of films) {
      if (stopped) break;
      let tmdbId = String(film.tmdbId);
      let people = window.buildSharedFilmPeopleCredits(film);
      let knownIds = new Set(pushedPeople[tmdbId] || []);
      let newIds = Object.keys(people).filter((id) => !knownIds.has(id));
      if (!newIds.length) continue;
      let filmRef = firestoreModule.doc(db, "sharedFilmMetadata", tmdbId);
      let quotaRef = firestoreModule.doc(
        db,
        "sharedFilmMetadataQuota",
        user.uid,
      );
      let today = todayDateKey();
      try {
        let merged = false;
        await firestoreModule.runTransaction(db, async (tx) => {
          let [filmSnap, quotaSnap] = await Promise.all([
            tx.get(filmRef),
            tx.get(quotaRef),
          ]);
          // Nothing to merge into yet - the insert path owns first creation;
          // the next fetch/push for this film will create it with today's
          // full people set anyway.
          if (!filmSnap.exists()) return;
          let quota = quotaSnap.data();
          let quotaCount =
            quota?.date === today ? Number(quota.count) || 0 : 0;
          if (quotaCount >= SHARED_FILM_METADATA_DAILY_QUOTA) {
            let error = new Error("Daily shared film metadata quota reached");
            error.code = "OSKARS_SHARED_METADATA_QUOTA";
            throw error;
          }
          let existingPeople = filmSnap.data()?.people || {};
          let mergedPeople = { ...existingPeople };
          newIds.forEach((id) => {
            mergedPeople[id] = people[id];
          });
          tx.set(
            filmRef,
            { people: mergedPeople, updatedAt: firestoreModule.serverTimestamp() },
            { merge: true },
          );
          tx.set(quotaRef, { date: today, count: quotaCount + 1 });
          merged = true;
        });
        if (merged) {
          nextPushedPeople[tmdbId] = Object.keys(people);
          touchedCount += 1;
        }
      } catch (err) {
        if (err?.code === "OSKARS_SHARED_METADATA_QUOTA") {
          stopped = true;
          break;
        }
        if (window.isUnauthorizedFirestoreError?.(err))
          return { ok: true, reason: "unauthorized" };
        if (!window.isRetryableFirestoreError?.(err))
          console.warn(
            `Shared film metadata reconcile failed for TMDB id ${tmdbId}`,
            err,
          );
      }
    }
    recordMetadataSyncState({
      pushedPeopleByTmdbId: nextPushedPeople,
      lastCheckedAt: new Date().toISOString(),
    });
    return { ok: true, touchedCount };
  }

  /**
   * Runs one reconciliation pass, coalescing overlapping calls the same way
   * runWorkspaceSync/pullSharedOfficialResultsArchive do.
   * @returns {Promise<Object>} Reconcile outcome.
   */
  window.reconcileSharedFilmMetadataPeople = function () {
    if (!reconcileInFlight)
      reconcileInFlight = performReconcileSharedFilmMetadataPeople()
        .catch((err) => {
          console.error("Shared film metadata reconcile failed", err);
          return { ok: false, reason: "error", error: err };
        })
        .finally(() => {
          reconcileInFlight = null;
        });
    return reconcileInFlight;
  };

  /**
   * Schedules a debounced reconciliation pass after a local save, mirroring
   * firestore-sync.js's scheduleWorkspaceSync - so a burst of award edits
   * produces one reconcile pass, not one per edit.
   */
  window.scheduleSharedFilmMetadataSync = function () {
    if (window.OSKARS_DATA_READY !== true || !currentFirebaseUser()) return;
    if (reconcileDebounceTimer) clearTimeout(reconcileDebounceTimer);
    reconcileDebounceTimer = setTimeout(() => {
      reconcileDebounceTimer = null;
      window.reconcileSharedFilmMetadataPeople();
    }, RECONCILE_DEBOUNCE_MS);
  };

  /**
   * Starts the first reconciliation pass once local data is fully hydrated,
   * mirroring noteOskarsDataReadyForSync's own guard shape.
   */
  window.noteOskarsDataReadyForSharedFilmMetadataSync = function () {
    if (currentFirebaseUser()) window.reconcileSharedFilmMetadataPeople();
  };

  function reconcileIfStale() {
    if (!currentFirebaseUser() || window.OSKARS_DATA_READY !== true) return;
    let lastCheckedAt = metadataSyncState().lastCheckedAt;
    let elapsed = lastCheckedAt
      ? Date.now() - new Date(lastCheckedAt).getTime()
      : Infinity;
    if (!(elapsed >= RECHECK_INTERVAL_MS)) return;
    window.reconcileSharedFilmMetadataPeople();
  }

  window.onFirebaseAuthChange?.((user) => {
    if (user && window.OSKARS_DATA_READY === true)
      window.reconcileSharedFilmMetadataPeople();
  });
  window.addEventListener?.("online", reconcileIfStale);
  document.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") reconcileIfStale();
  });
})();
