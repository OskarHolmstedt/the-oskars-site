/** @file Converts an original Letterboxd export into a reviewed local import proposal. */

(function () {
  let exportFiles = Object.freeze([
    "watched.csv",
    "ratings.csv",
    "diary.csv",
    "watchlist.csv",
  ]);

  function parseCsv(raw, filename) {
    let text = String(raw || "").replace(/^\uFEFF/, "");
    let rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      let character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"' && !cell) quoted = true;
      else if (character === ",") {
        row.push(cell);
        cell = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(cell);
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        cell = "";
      } else cell += character;
    }
    if (quoted)
      throw new Error(`${filename} contains an unterminated quoted cell.`);
    row.push(cell);
    if (row.some((value) => value !== "")) rows.push(row);
    if (!rows.length) throw new Error(`${filename} is empty.`);
    let headers = rows.shift().map((value) => String(value).trim());
    let headerKeys = headers.map((value) => value.toLocaleLowerCase());
    let required =
      filename === "ratings.csv"
        ? ["name", "year", "rating"]
        : ["name", "year"];
    let missing = required.filter((name) => !headerKeys.includes(name));
    if (missing.length)
      throw new Error(
        `${filename} is missing required column(s): ${missing.join(", ")}.`,
      );
    return rows.map((values, rowIndex) => {
      let result = { _rowNumber: rowIndex + 2 };
      headers.forEach((header, index) => {
        result[header.toLocaleLowerCase()] = String(values[index] || "").trim();
      });
      return result;
    });
  }

  function normalizedUri(value) {
    return String(value || "")
      .trim()
      .replace(/\/+$/, "")
      .toLocaleLowerCase();
  }

  function fallbackKey(value) {
    return `${String(value?.year || "").trim()}::${window.normalizeTitle(value?.name || value?.title || "")}`;
  }

  function keysFor(value) {
    let uri = normalizedUri(value?.["letterboxd uri"] || value?.letterboxdUrl);
    return [uri ? `uri:${uri}` : "", `film:${fallbackKey(value)}`].filter(
      Boolean,
    );
  }

  function validFilmRow(row) {
    return Boolean(
      row.name &&
      (/^\d{4}$/.test(row.year) || normalizedUri(row["letterboxd uri"])),
    );
  }

  function buildLookup(records) {
    let lookup = new Map();
    records.forEach((record) => {
      keysFor(record).forEach((key) => {
        if (!lookup.has(key)) lookup.set(key, record);
      });
    });
    return lookup;
  }

  function findRecord(lookup, row) {
    for (let key of keysFor(row)) {
      if (lookup.has(key)) return lookup.get(key);
    }
    return null;
  }

  function mergeTags(left, right) {
    return window.parseFilmTags?.([...(left || []), ...(right || [])]) || [];
  }

  function ratingFor(row) {
    let value = Number(String(row?.rating || "").replace(",", "."));
    if (!Number.isFinite(value) || value < 0.5 || value > 5 || (value * 2) % 1)
      return null;
    // Letterboxd only has plain half-star ratings, no minus/plus concept
    // of its own - imported as unmodified (no "dot"; that value was
    // removed as a distinct modifier, always redundant with "").
    return {
      rating: window.renderFilmRating({
        ratingValue: value,
        ratingModifier: "",
      }),
      ratingValue: value,
      ratingModifier: "",
    };
  }

  function applyViewingFacts(record, row, facts) {
    let uri = String(row["letterboxd uri"] || "").trim();
    if (!record.letterboxdUrl && uri) record.letterboxdUrl = uri;
    if (facts.rating) Object.assign(record, facts.rating);
    record.tags = mergeTags(record.tags, facts.tags);
    record.dateWatched = window.latestImportDate(
      record.dateWatched,
      facts.dateWatched,
    );
    record.views = Math.max(Number(record.views) || 0, facts.views || 1);
  }

  function viewingFacts(rows, ratings, diary) {
    let ratingLookup = buildLookup(ratings);
    let diaryGroups = new Map();
    diary.forEach((entry) => {
      if (!validFilmRow(entry)) return;
      let key = keysFor(entry)[0];
      let group = diaryGroups.get(key) || {
        views: 0,
        rewatch: false,
        dateWatched: "",
        tags: [],
      };
      group.views += 1;
      group.rewatch ||= /^yes$/i.test(entry.rewatch);
      group.dateWatched = window.latestImportDate(
        group.dateWatched,
        entry["watched date"] || entry.date,
      );
      group.tags = mergeTags(
        group.tags,
        window.parseFilmTags?.(entry.tags) || [],
      );
      diaryGroups.set(key, group);
      keysFor(entry).forEach((identity) => diaryGroups.set(identity, group));
    });
    let result = new Map();
    rows.forEach((row) => {
      let ratingRow = findRecord(ratingLookup, row);
      let diaryGroup = keysFor(row)
        .map((key) => diaryGroups.get(key))
        .find(Boolean);
      result.set(row, {
        rating: ratingFor(ratingRow),
        views: Math.max(diaryGroup?.views || 1, diaryGroup?.rewatch ? 2 : 1),
        dateWatched: diaryGroup?.dateWatched || "",
        tags: diaryGroup?.tags || [],
      });
    });
    return result;
  }

  function parsedRows(files, warnings) {
    if (!Object.prototype.hasOwnProperty.call(files, "watched.csv"))
      throw new Error("The Letterboxd export does not contain watched.csv.");
    let parsed = {};
    exportFiles.forEach((filename) => {
      if (Object.prototype.hasOwnProperty.call(files, filename))
        parsed[filename] = parseCsv(files[filename], filename);
      else {
        parsed[filename] = [];
        if (filename !== "watched.csv")
          warnings.push(
            `${filename} was not present; that optional data was skipped.`,
          );
      }
    });
    return parsed;
  }

  function freshWatchedRecordFields(row, validYear) {
    return {
      id: window.makeFilmId(row.year, row.name),
      title: row.name,
      year: validYear ? row.year : "",
      normalizedTitle: window.normalizeTitle(row.name),
      type: "Film",
      rating: "",
      director: "",
      franchises: [],
      tags: [],
      views: 1,
    };
  }

  function importWatched(rows, ratings, diary, report) {
    let archiveRecords = window.importArchiveSourceRecords();
    let archiveLookup = buildLookup(archiveRecords);
    let otherLookup = buildLookup(window.state.watchedOther || []);
    let factsByRow = viewingFacts(rows, ratings, diary);
    let importedKeys = new Set();
    rows.forEach((row) => {
      if (!validFilmRow(row)) {
        report.skipped += 1;
        report.skippedDetails.push({
          source: "watched.csv",
          rowNumber: row._rowNumber,
          reason:
            "A title plus a Letterboxd URI or four-digit release year is required.",
          values: [row.name, row.year],
        });
        return;
      }
      let rowKeys = keysFor(row);
      if (rowKeys.some((key) => importedKeys.has(key))) return;
      rowKeys.forEach((key) => importedKeys.add(key));
      let facts = factsByRow.get(row);
      let archive = findRecord(archiveLookup, row);
      let existingOther = findRecord(otherLookup, row);
      let validYear = /^\d{4}$/.test(row.year);
      if (archive) {
        let targetKeys = new Set(keysFor(archive));
        archiveRecords
          .filter((record) =>
            keysFor(record).some((key) => targetKeys.has(key)),
          )
          .forEach((record) => {
            applyViewingFacts(record, row, facts);
            window.enrichPersonalRecordFromSharedArchive?.(record, "film");
          });
        report.watchedArchiveMerged += 1;
      } else if (existingOther) {
        applyViewingFacts(existingOther, row, facts);
        window.enrichPersonalRecordFromSharedArchive?.(existingOther, "film");
        report.watchedOtherMerged += 1;
      } else if (validYear) {
        // A usable release year places a fresh record in the archive;
        // hydration later routes non-feature catalog types to watchedOther.
        let entry = freshWatchedRecordFields(row, validYear);
        applyViewingFacts(entry, row, facts);
        window.enrichPersonalRecordFromSharedArchive?.(entry, "film");
        window.state.years ||= {};
        window.state.years[row.year] ||= { periodType: "years", films: [] };
        window.state.years[row.year].films.push(entry);
        archiveRecords.push(entry);
        keysFor(entry).forEach((key) => archiveLookup.set(key, entry));
        report.archiveAdded += 1;
        report.freshArchiveFilms.push({
          id: entry.id,
          title: entry.title,
          year: entry.year,
        });
      } else {
        let entry = {
          ...freshWatchedRecordFields(row, validYear),
          rowNumber: row._rowNumber,
        };
        applyViewingFacts(entry, row, facts);
        window.enrichPersonalRecordFromSharedArchive?.(entry, "film");
        window.state.watchedOther ||= [];
        window.state.watchedOther.push(entry);
        keysFor(entry).forEach((key) => otherLookup.set(key, entry));
        report.watchedOtherAdded += 1;
      }
      report.filmsParsed += 1;
    });
    return importedKeys;
  }

  function importWatchlist(rows, importedWatchedKeys, report) {
    let current = window.state.watchlist || [];
    let lookup = buildLookup(current);
    rows.forEach((row) => {
      if (!validFilmRow(row)) {
        report.skipped += 1;
        return;
      }
      if (keysFor(row).some((key) => importedWatchedKeys.has(key))) return;
      let existing = findRecord(lookup, row);
      if (existing) {
        if (!existing.letterboxdUrl)
          existing.letterboxdUrl = row["letterboxd uri"] || "";
        if (!existing.added && /^\d{4}-\d{2}-\d{2}$/.test(row.date))
          existing.added = row.date;
        window.enrichPersonalRecordFromSharedArchive?.(existing, "watchlist");
        report.watchlistMerged += 1;
        return;
      }
      let item = window.normalizeWatchlistItem({
        title: row.name,
        year: row.year,
        letterboxdUrl: row["letterboxd uri"],
      });
      if (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) item.added = row.date;
      window.enrichPersonalRecordFromSharedArchive?.(item, "watchlist");
      current.push(item);
      keysFor(item).forEach((key) => lookup.set(key, item));
      report.watchlistAdded += 1;
    });
    window.state.watchlist = current.filter((item) => {
      let remove = keysFor(item).some((key) => importedWatchedKeys.has(key));
      if (remove) report.watchlistRemoved += 1;
      return !remove;
    });
  }

  /**
   * Builds a reviewed Letterboxd merge proposal from decoded export CSV files.
   * @param {Record<string, string>} files CSV text keyed by lowercase basename.
   * @param {Object} [options] Source metadata.
   * @param {string} [options.fileName] Original ZIP filename.
   * @returns {ImportProposal} Session-only proposal.
   */
  window.proposeLetterboxdImport = function (files, options = {}) {
    let normalizedFiles = {};
    Object.entries(files || {}).forEach(([name, value]) => {
      normalizedFiles[String(name).toLocaleLowerCase()] = String(value || "");
    });
    let warnings = [];
    let parsed = parsedRows(normalizedFiles, warnings);
    let baseState = window.cloneRecord(window.state);
    let report = {
      source: options.fileName || "Letterboxd export ZIP",
      filmsParsed: 0,
      filmsAdded: 0,
      filmsMerged: 0,
      awardsAdded: 0,
      awardsRejected: 0,
      skipped: 0,
      periods: [],
      warnings,
      ruleViolations: [],
      titleVariants: [],
      skippedDetails: [],
      watchedArchiveMerged: 0,
      archiveAdded: 0,
      // Identifying info (not object references - createImportProposal
      // deep-clones candidateState/report, orphaning any reference held
      // here) for enrichLetterboxdProposalMetadata() to find and fill in
      // afterward.
      freshArchiveFilms: [],
      watchedOtherAdded: 0,
      watchedOtherMerged: 0,
      watchlistAdded: 0,
      watchlistMerged: 0,
      watchlistRemoved: 0,
    };
    try {
      window.state = window.cloneRecord(baseState);
      window.rebuildAggregates?.();
      let importedWatchedKeys = importWatched(
        parsed["watched.csv"],
        parsed["ratings.csv"],
        parsed["diary.csv"],
        report,
      );
      importWatchlist(parsed["watchlist.csv"], importedWatchedKeys, report);
      report.filmsAdded =
        report.archiveAdded + report.watchedOtherAdded + report.watchlistAdded;
      report.filmsMerged =
        report.watchedArchiveMerged +
        report.watchedOtherMerged +
        report.watchlistMerged;
      window.rebuildAggregates?.();
      return window.createImportProposal({
        sourceKind: "letterboxd",
        mode: "merge",
        baseState,
        candidateState: window.state,
        report,
        sourceRevision: window.canonicalDataRevision(
          exportFiles.map((name) => [name, normalizedFiles[name] || ""]),
        ),
        sourceConfig: {
          fileName: String(options.fileName || ""),
          files: exportFiles.filter((name) => name in normalizedFiles),
        },
      });
    } finally {
      window.state = baseState;
      window.rebuildAggregates?.();
    }
  };

  /**
   * Extracts an original Letterboxd ZIP and builds a reviewed merge proposal.
   * @param {File|Blob|ArrayBuffer|Uint8Array} input Original export archive.
   * @param {Object} [options] Source metadata.
   * @returns {Promise<ImportProposal>} Session-only proposal.
   */
  window.proposeLetterboxdZipImport = async function (input, options = {}) {
    let extracted = await window.extractZipFiles(input, {
      selectedNames: exportFiles,
    });
    let decoder = new TextDecoder("utf-8", { fatal: true });
    let files = {};
    Object.entries(extracted).forEach(([name, entry]) => {
      try {
        files[name] = decoder.decode(entry.bytes).replace(/^\uFEFF/, "");
      } catch (err) {
        throw new Error(`${entry.path} is not valid UTF-8 text.`, {
          cause: err,
        });
      }
    });
    return window.proposeLetterboxdImport(files, options);
  };

  /**
   * Looks up TMDB metadata for freshly created archive films on a Letterboxd proposal
   * (see enrichImportProposalFreshFilms() in src/imports/import-proposals.js).
   * @param {ImportProposal} proposal The Letterboxd proposal, already built.
   * @param {Object} [options] Batch controls passed through.
   * @returns {Promise<void>} Completion after every lookup settles.
   */
  window.enrichLetterboxdProposalMetadata = function (proposal, options = {}) {
    return window.enrichImportProposalFreshFilms(proposal, options);
  };
})();
