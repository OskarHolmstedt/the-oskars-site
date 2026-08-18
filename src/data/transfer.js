/**
 * @file Owns JSON backup downloads and uploads, including full replacement
 * and archive-focused merge behavior above the browser persistence layer.
 */

function transferUi(text, values) {
  return window.uiText?.(text, values) ?? text;
}

function assertOskarsBackupShape(imported) {
  if (
    !imported ||
    typeof imported !== "object" ||
    Array.isArray(imported) ||
    !imported.years ||
    typeof imported.years !== "object"
  ) {
    throw new Error("Unsupported data file for The Oskars");
  }
}

// The data sections a backup can carry beyond years/films. Merge mode leaves
// all of them untouched (reported as ignored); replace mode restores them.
function transferSectionCounts(source) {
  let countOf = (value) =>
    Array.isArray(value)
      ? value.length
      : value && typeof value === "object"
        ? Object.keys(value).length
        : value
          ? 1
          : 0;
  let noteCount =
    source?.entityNotes && typeof source.entityNotes === "object"
      ? Object.values(source.entityNotes).reduce(
          (total, group) => total + countOf(group),
          0,
        )
      : 0;
  let localRankCount =
    source?.localRanks && typeof source.localRanks === "object"
      ? Object.values(source.localRanks).reduce(
          (total, group) => total + countOf(group),
          0,
        )
      : 0;
  return [
    {
      key: "watchlist",
      label: "Watchlist films",
      count: countOf(source?.watchlist),
    },
    {
      key: "watchedOther",
      label: "Watched (other) entries",
      count: countOf(source?.watchedOther),
    },
    {
      key: "projects",
      label: "Watch projects",
      count: countOf(source?.projects),
    },
    {
      key: "watchlistProjectSources",
      label: "Project source links",
      count: countOf(source?.watchlistProjectSources),
    },
    {
      key: "peopleAliases",
      label: "People aliases",
      count: countOf(source?.peopleAliases),
    },
    {
      key: "rejectedPersonAliases",
      label: "Rejected alias pairs",
      count: countOf(source?.rejectedPersonAliases),
    },
    { key: "entityNotes", label: "Entity notes", count: noteCount },
    { key: "localRanks", label: "Local rank orders", count: localRankCount },
    {
      key: "editLog",
      label: "Edit log entries",
      count: countOf(source?.editLog),
    },
    {
      key: "sourceConflicts",
      label: "Source conflicts",
      count: countOf(source?.sourceConflicts),
    },
    {
      key: "importConsistency",
      label: "Import consistency snapshot",
      count: source?.importConsistency ? 1 : 0,
    },
    {
      key: "lastImportReport",
      label: "Last import report",
      count: source?.lastImportReport ? 1 : 0,
    },
  ];
}

/**
 * Downloads current serializable state as a formatted JSON file.
 * @param {string} filename Download filename.
 */
window.downloadDataSnapshot = function (filename) {
  let dataStr = JSON.stringify(window.getSerializableState(), null, 2);
  let blob = new Blob([dataStr], { type: "application/json" });
  let url = URL.createObjectURL(blob);
  let link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  window.noteBackupTaken?.();
};

/**
 * Downloads current serializable state using the standard backup filename.
 */
window.downloadData = function () {
  window.downloadDataSnapshot("oskars-browser-backup.json");
};

/**
 * Builds a session-only merge or replacement proposal from selected JSON.
 * @param {Event} event File-input change event.
 * @param {Object} [options] Upload behavior.
 * @param {'merge'|'replace'} [options.mode] Restore mode; defaults to merge.
 * @param {boolean} [options.render] Whether to rerender after import.
 * @param {boolean} [options.silentReport] Whether to suppress the report dialog.
 * @param {function(ImportProposal): (void|Promise<void>)} [options.onPreview] Preview callback.
 */
window.uploadData = function (event, options = {}) {
  let file = event.target.files[0];
  if (!file) return;
  let reader = new FileReader();
  reader.onload = async function (loadEvent) {
    try {
      let imported = JSON.parse(loadEvent.target.result);
      let proposal = window.proposeJsonImport(imported, {
        mode: options.mode === "replace" ? "replace" : "merge",
        sourceName: file.name,
      });
      await options.onPreview?.(proposal);
    } catch (err) {
      alert(err.message || "Invalid JSON file");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
};

/**
 * Runs JSON merge/replace logic against temporary state and returns a proposal.
 * @param {OskarsState|Object} imported Parsed backup.
 * @param {Object} [options] Proposal options.
 * @param {'merge'|'replace'} [options.mode] Candidate behavior.
 * @param {string} [options.sourceName] Selected filename.
 * @returns {ImportProposal} Session-only JSON proposal.
 */
window.proposeJsonImport = function (imported, options = {}) {
  assertOskarsBackupShape(imported);
  let mode = options.mode === "replace" ? "replace" : "merge";
  let baseState = window.cloneRecord(window.state);
  let source = window.cloneRecord(imported);
  try {
    window.state = window.cloneRecord(baseState);
    let report =
      mode === "replace"
        ? window.replaceDataFromBackup(source, {
            render: false,
            silentReport: true,
            recordHistory: false,
            persist: false,
            sourceName: options.sourceName,
          })
        : window.mergeData(source, {
            render: false,
            silentReport: true,
            recordHistory: false,
            sourceName: options.sourceName,
          });
    report.source = options.sourceName
      ? `JSON file · ${String(options.sourceName).slice(0, 200)}`
      : "JSON file";
    return window.createImportProposal({
      sourceKind: "json",
      mode,
      baseState,
      candidateState: window.state,
      report,
      sourceRevision: window.canonicalDataRevision(source),
      sourceConfig: { filename: String(options.sourceName || "") },
    });
  } finally {
    window.state = baseState;
    window.rebuildAggregates?.();
  }
};

// Full-fidelity restore: replaces every stored section with the backup's
// contents (the merge path below only reads films/awards and image links).
// Persistence is fire-and-forget so the report stays synchronous; callers
// that must wait for the storage write can await report.persisted.
/**
 * Hydrates and persists every state section from a validated backup.
 * @param {OskarsState|Object} imported Parsed backup state.
 * @param {Object} [options] Restore presentation controls.
 * @param {boolean} [options.render] Whether to rerender after replacement.
 * @param {boolean} [options.silentReport] Whether to suppress the report dialog.
 * @param {boolean} [options.recordHistory] Whether to record this user-triggered restore.
 * @param {boolean} [options.persist] Whether to overwrite browser persistence.
 * @param {string} [options.sourceName] Selected backup filename.
 * @returns {ImportReport} Synchronous report carrying its persistence promise.
 */
window.replaceDataFromBackup = function (imported, options = {}) {
  assertOskarsBackupShape(imported);
  let localBefore = transferSectionCounts(window.getSerializableState());
  window.hydrateState(imported);
  let restored = transferSectionCounts(window.getSerializableState());
  let filmsRestored = 0;
  let awardsRestored = 0;
  Object.values(window.state.years).forEach((year) => {
    (year.films || []).forEach((film) => {
      filmsRestored += 1;
      awardsRestored += (film.awards || []).length;
    });
  });
  let report = {
    source: "JSON file",
    mode: "replace",
    filmsParsed: filmsRestored,
    filmsAdded: filmsRestored,
    filmsMerged: 0,
    awardsAdded: awardsRestored,
    awardsRejected: 0,
    ruleWarnings: 0,
    skipped: 0,
    periods: Object.keys(window.state.years),
    warnings: [],
    titleVariants: [],
    ruleViolations: [],
    restoredSections: restored.map((section, index) => ({
      key: section.key,
      label: section.label,
      count: section.count,
      localBefore: localBefore[index].count,
    })),
  };
  if (options.recordHistory) {
    let source = options.sourceName
      ? `JSON file · ${String(options.sourceName).slice(0, 200)}`
      : report.source;
    window.recordImportHistory?.(report, {
      sourceKind: "json",
      source,
      mode: "replace",
      summary: "Restored JSON backup (replace)",
    });
  }
  if (options.persist !== false)
    report.persisted = window.replaceStoredState(window.getSerializableState(), {
      message: transferUi("Backup restored"),
      fallbackMessage: transferUi("Backup restored using fallback storage"),
    });
  window.lastImportReport = report;
  if (options.render !== false) window.render?.();
  if (!options.silentReport) window.showImportReport?.(report);
  return report;
};

/**
 * Merges backup films, awards, images, and source links into current state.
 * @param {OskarsState|Object} imported Parsed backup state.
 * @param {Object} [options] Merge presentation controls.
 * @param {boolean} [options.render] Whether to rerender after merging.
 * @param {boolean} [options.silentReport] Whether to suppress the report dialog.
 * @param {boolean} [options.recordHistory] Whether to record this user-triggered restore.
 * @param {string} [options.sourceName] Selected backup filename.
 * @returns {ImportReport} Merge result and ignored-section summary.
 */
window.mergeData = function (imported, options = {}) {
  assertOskarsBackupShape(imported);
  window.migrateCreditSchema(imported);
  state.personPortraits ||= {};
  Object.entries(imported.personPortraits || {}).forEach(
    ([personId, portrait]) => {
      let normalized = window.normalizePosterRecord?.(portrait);
      if (normalized && !state.personPortraits[personId])
        state.personPortraits[personId] = normalized;
    },
  );
  state.franchiseLinks ||= {};
  Object.entries(imported.franchiseLinks || {}).forEach(
    ([franchiseId, url]) => {
      if (url && !state.franchiseLinks[franchiseId])
        state.franchiseLinks[franchiseId] = url;
    },
  );
  state.directorLinks ||= {};
  Object.entries(imported.directorLinks || {}).forEach(([personId, url]) => {
    if (url && !state.directorLinks[personId])
      state.directorLinks[personId] = url;
  });
  state.collectionAwards ||= { director: {}, franchise: {} };
  ["director", "franchise"].forEach((type) => {
    state.collectionAwards[type] ||= {};
    Object.entries(imported.collectionAwards?.[type] || {}).forEach(
      ([collectionId, bracket]) => {
        if (!state.collectionAwards[type][collectionId])
          state.collectionAwards[type][collectionId] = window.cloneRecord(bracket);
      },
    );
  });
  state.imageImportStats ||= { posterFailures: 0, portraitFailures: 0 };
  state.imageImportStats.posterFailures = Math.max(
    Number(state.imageImportStats.posterFailures) || 0,
    Number(imported.imageImportStats?.posterFailures) || 0,
  );
  state.imageImportStats.portraitFailures = Math.max(
    Number(state.imageImportStats.portraitFailures) || 0,
    Number(imported.imageImportStats?.portraitFailures) || 0,
  );

  let report = {
    source: "JSON file",
    mode: "merge",
    filmsParsed: 0,
    filmsAdded: 0,
    filmsMerged: 0,
    awardsAdded: 0,
    awardsRejected: 0,
    ruleWarnings: 0,
    skipped: 0,
    periods: [],
    warnings: [],
    titleVariants: [],
    ruleViolations: [],
    ignoredSections: transferSectionCounts(imported).filter(
      (section) => section.count > 0,
    ),
  };

  function mergeAwards(
    existingAwards,
    newAwards,
    film,
    periodType,
    placementOwners,
  ) {
    let added = 0;
    newAwards.forEach((award) => {
      let validation = window.validateAward(film, award, {
        periodType,
        placementOwners,
      });
      report.ruleWarnings += validation.warnings.length;
      if (!validation.valid) {
        report.awardsRejected += 1;
        validation.errors.forEach((message) =>
          report.ruleViolations.push({
            film: film.title,
            category: award.category,
            message,
          }),
        );
        return;
      }
      if (
        !existingAwards.some((existing) => window.sameAward(existing, award))
      ) {
        existingAwards.push(award);
        added += 1;
      }
    });
    return added;
  }

  Object.keys(imported.years).forEach((year) => {
    report.periods.push(year);
    state.years[year] ||= { films: [] };
    if (imported.years[year]?.periodType)
      state.years[year].periodType = imported.years[year].periodType;
    if (imported.years[year]?.sourceUrl)
      state.years[year].sourceUrl = imported.years[year].sourceUrl;
    let periodType =
      imported.years[year]?.periodType || window.getAwardPeriodType({ year });
    let placementOwners = new Map();
    (state.years[year].films || []).forEach((film) => {
      (film.awards || [])
        .filter((award) => String(award.year || "") === String(year))
        .forEach((award) => {
          let key = `${periodType}\n${award.category}\n${award.year || ""}\n${Number(award.placement)}`;
          let owners = placementOwners.get(key) || new Set();
          owners.add(film.title);
          placementOwners.set(key, owners);
        });
    });

    (imported.years[year]?.films || []).forEach((importedFilm) => {
      report.filmsParsed += 1;
      let existing = state.years[year].films.find(
        (film) =>
          normalizeTitle(film.title) === normalizeTitle(importedFilm.title),
      );
      if (existing) {
        report.filmsMerged += 1;
        window.normalizeFilmMetadata(existing);
        if (!existing.poster && importedFilm.poster) {
          let importedPoster = window.normalizePosterRecord?.(
            importedFilm.poster,
          );
          if (importedPoster) existing.poster = importedPoster;
        }
        existing.tags =
          window.parseFilmTags?.([
            ...(existing.tags || []),
            ...(importedFilm.tags || []),
          ]) ||
          existing.tags ||
          importedFilm.tags ||
          [];
        existing.franchises =
          window.normalizeFranchiseMemberships?.([
            ...(existing.franchises || []),
            ...(importedFilm.franchises || []),
          ]) ||
          existing.franchises ||
          importedFilm.franchises ||
          [];
        existing.review =
          existing.review || String(importedFilm.review || "").trim();
        existing.adaptationSource =
          existing.adaptationSource ||
          window.normalizeAdaptationSource(importedFilm.adaptationSource);
        report.awardsAdded += mergeAwards(
          (existing.awards ||= []),
          importedFilm.awards || [],
          existing,
          periodType,
          placementOwners,
        );
        if (existing.title !== importedFilm.title) {
          report.titleVariants.push({
            imported: importedFilm.title,
            matched: existing.title,
          });
        }
      } else {
        report.filmsAdded += 1;
        let copy = window.cloneRecord(importedFilm);
        window.normalizeFilmMetadata(copy);
        let incomingAwards = copy.awards || [];
        copy.awards = [];
        report.awardsAdded += mergeAwards(
          copy.awards,
          incomingAwards,
          copy,
          periodType,
          placementOwners,
        );
        state.years[year].films.push(copy);
        window.addFilmToStore?.(year, copy);
      }
    });
  });

  window.rebuildAggregates?.();
  if (report.awardsRejected)
    report.warnings.push(
      `${report.awardsRejected} award nomination(s) were rejected by data rules.`,
    );
  if (report.ruleWarnings)
    report.warnings.push(
      `${report.ruleWarnings} eligibility check(s) could not be completed because metadata is unknown.`,
    );
  if (options.recordHistory) {
    let source = options.sourceName
      ? `JSON file · ${String(options.sourceName).slice(0, 200)}`
      : report.source;
    window.recordImportHistory?.(report, {
      sourceKind: "json",
      source,
      mode: "merge",
      summary: "Restored JSON backup (merge)",
    });
  }
  window.lastImportReport = report;
  if (options.render !== false) window.render?.();
  if (!options.silentReport) window.showImportReport?.(report);
  return report;
};
