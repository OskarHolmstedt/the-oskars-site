/** @file Converts IMDb CSV exports (ratings.csv, watchlist.csv) into a reviewed local import proposal. */

(function () {
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
    return rows.map((values, rowIndex) => {
      let result = { _rowNumber: rowIndex + 2 };
      headers.forEach((header, index) => {
        result[header.toLocaleLowerCase()] = String(values[index] || "").trim();
      });
      return result;
    });
  }

  function detectFileKind(rows, filename) {
    if (!rows.length) return "unknown";
    let first = rows[0];
    let keys = Object.keys(first);
    if (keys.includes("your rating") || keys.includes("you rated")) {
      return "ratings";
    }
    if (
      keys.includes("created") ||
      keys.includes("position") ||
      keys.includes("description") ||
      /watchlist/i.test(filename || "")
    ) {
      return "watchlist";
    }
    if (keys.includes("const") && keys.includes("title")) {
      return "watchlist";
    }
    return "unknown";
  }

  function normalizedConst(value) {
    let match = String(value || "")
      .trim()
      .match(/tt\d+/i);
    return match ? match[0].toLocaleLowerCase() : "";
  }

  function fallbackKey(value) {
    return `${String(value?.year || "").trim()}::${window.normalizeTitle(value?.name || value?.title || "")}`;
  }

  function keysFor(value) {
    let imdb = normalizedConst(
      value?.const || value?.url || value?.letterboxdUrl,
    );
    let titleKey = fallbackKey(value);
    return [
      imdb ? `imdb:${imdb}` : "",
      titleKey ? `film:${titleKey}` : "",
    ].filter(Boolean);
  }

  function validFilmRow(row) {
    let title = row.title || row.name || row["original title"];
    let year = row.year || String(row["release date"] || "").slice(0, 4);
    return Boolean(
      title && (/^\d{4}$/.test(year) || normalizedConst(row.const)),
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

  function ratingFor(row) {
    let raw = String(row?.["your rating"] || row?.["you rated"] || "")
      .replace(",", ".")
      .trim();
    let value = Number(raw);
    if (!Number.isFinite(value) || value < 1 || value > 10) return null;
    let starValue = Number((value / 2).toFixed(1));
    return {
      rating: window.renderFilmRating({
        ratingValue: starValue,
        ratingModifier: "",
      }),
      ratingValue: starValue,
      ratingModifier: "",
    };
  }

  function latestDate(left, right) {
    let valid = (value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : "";
    return [valid(left), valid(right)].sort().pop() || "";
  }

  function classifyImdbType(titleType) {
    let normalized = String(titleType || "")
      .trim()
      .toLocaleLowerCase();
    if (["movie", "tvmovie", "tv_movie", "video"].includes(normalized))
      return "Film";
    if (normalized === "short") return "Short";
    if (normalized === "documentary") return "Documentary";
    if (
      [
        "tvseries",
        "tv_series",
        "tvminiseries",
        "tv_mini_series",
        "tvepisode",
        "tvspecial",
      ].includes(normalized)
    )
      return "TV";
    return "Film";
  }

  function archiveSourceRecords() {
    let records = [];
    let seen = new Set();
    Object.values(window.state.years || {}).forEach((period) =>
      (period.films || []).forEach((film) => {
        if (film && !seen.has(film)) {
          seen.add(film);
          records.push(film);
        }
      }),
    );
    Object.values(window.state.filmsById || {}).forEach((film) => {
      if (film && !seen.has(film)) {
        seen.add(film);
        records.push(film);
      }
    });
    return records;
  }

  function freshWatchedRecordFields(row, validYear) {
    let title = String(
      row.title || row.name || row["original title"] || "",
    ).trim();
    let year = validYear
      ? row.year || String(row["release date"] || "").slice(0, 4)
      : "";
    let constId = normalizedConst(row.const);
    let imdbUrl =
      row.url || (constId ? `https://www.imdb.com/title/${constId}/` : "");
    let runtime = Number(row["runtime (mins)"]);
    return {
      id: window.makeFilmId(year, title),
      title,
      year,
      normalizedTitle: window.normalizeTitle(title),
      type: classifyImdbType(row["title type"]),
      rating: "",
      ratingValue: null,
      ratingModifier: "",
      director: String(row.directors || row.director || "").trim(),
      runtimeMinutes: Number.isFinite(runtime) && runtime > 0 ? runtime : null,
      url: imdbUrl,
      franchises: [],
      tags: [],
      views: 1,
    };
  }

  function applyViewingFacts(record, row) {
    let constId = normalizedConst(row.const);
    let url =
      row.url || (constId ? `https://www.imdb.com/title/${constId}/` : "");
    if (!record.url && url) record.url = url;
    let rating = ratingFor(row);
    if (rating) Object.assign(record, rating);
    let date = row["date rated"];
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      record.dateWatched = latestDate(record.dateWatched, date);
    }
    let runtime = Number(row["runtime (mins)"]);
    if (!record.runtimeMinutes && Number.isFinite(runtime) && runtime > 0) {
      record.runtimeMinutes = runtime;
    }
    let director = String(row.directors || row.director || "").trim();
    if (!record.director && director) {
      record.director = director;
    }
    record.views = Math.max(Number(record.views) || 0, 1);
  }

  function importRatings(rows, report) {
    let archiveRecords = archiveSourceRecords();
    let archiveLookup = buildLookup(archiveRecords);
    let otherLookup = buildLookup(window.state.watchedOther || []);
    let importedKeys = new Set();

    rows.forEach((row) => {
      if (!validFilmRow(row)) {
        report.skipped += 1;
        report.skippedDetails.push({
          source: "ratings.csv",
          rowNumber: row._rowNumber,
          reason:
            "A title plus an IMDb ID or four-digit release year is required.",
          values: [row.title || row.name, row.year, row.const],
        });
        return;
      }
      let rowKeys = keysFor(row);
      if (rowKeys.some((key) => importedKeys.has(key))) return;
      rowKeys.forEach((key) => importedKeys.add(key));

      let archive = findRecord(archiveLookup, row);
      let existingOther = findRecord(otherLookup, row);
      let year = row.year || String(row["release date"] || "").slice(0, 4);
      let validYear = /^\d{4}$/.test(year);

      if (archive) {
        let targetKeys = new Set(keysFor(archive));
        archiveRecords
          .filter((record) =>
            keysFor(record).some((key) => targetKeys.has(key)),
          )
          .forEach((record) => {
            applyViewingFacts(record, row);
            window.enrichPersonalRecordFromSharedArchive?.(record, "film");
          });
        report.watchedArchiveMerged += 1;
      } else if (existingOther) {
        applyViewingFacts(existingOther, row);
        window.enrichPersonalRecordFromSharedArchive?.(existingOther, "film");
        report.watchedOtherMerged += 1;
      } else if (validYear) {
        let entry = freshWatchedRecordFields(row, validYear);
        applyViewingFacts(entry, row);
        window.enrichPersonalRecordFromSharedArchive?.(entry, "film");
        window.state.years ||= {};
        window.state.years[year] ||= { periodType: "years", films: [] };
        window.state.years[year].films.push(entry);
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
        applyViewingFacts(entry, row);
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
      let constId = normalizedConst(row.const);
      let url =
        row.url || (constId ? `https://www.imdb.com/title/${constId}/` : "");
      let year = row.year || String(row["release date"] || "").slice(0, 4);
      let title = String(
        row.title || row.name || row["original title"] || "",
      ).trim();

      if (existing) {
        if (!existing.url && url) existing.url = url;
        if (!existing.added && /^\d{4}-\d{2}-\d{2}$/.test(row.created))
          existing.added = row.created;
        window.enrichPersonalRecordFromSharedArchive?.(existing, "watchlist");
        report.watchlistMerged += 1;
        return;
      }

      let item = window.normalizeWatchlistItem({
        title,
        year: /^\d{4}$/.test(year) ? year : "",
        director: String(row.directors || row.director || "").trim(),
        runtimeMinutes: Number(row["runtime (mins)"]) || null,
        url,
      });
      if (/^\d{4}-\d{2}-\d{2}$/.test(row.created)) item.added = row.created;
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
   * Builds a reviewed IMDb merge proposal from decoded export CSV text files.
   * @param {Record<string, string>|string} input Decoded CSV text or map of filenames to text.
   * @param {Object} [options] Source metadata.
   * @param {string} [options.fileName] Original filename or label.
   * @returns {ImportProposal} Session-only proposal.
   */
  window.proposeImdbImport = function (input, options = {}) {
    let files = {};
    if (typeof input === "string") {
      let singleName = options.fileName || "ratings.csv";
      files[singleName] = input;
    } else if (input && typeof input === "object") {
      Object.entries(input).forEach(([name, value]) => {
        files[String(name).toLocaleLowerCase()] = String(value || "");
      });
    }

    let parsedRatings = [];
    let parsedWatchlist = [];
    let warnings = [];

    Object.entries(files).forEach(([name, raw]) => {
      if (!String(raw).trim()) return;
      let rows = parseCsv(raw, name);
      let kind = detectFileKind(rows, name);
      if (kind === "ratings") {
        parsedRatings.push(...rows);
      } else if (kind === "watchlist") {
        parsedWatchlist.push(...rows);
      } else {
        warnings.push(
          `${name} could not be recognized as IMDb ratings or watchlist.`,
        );
      }
    });

    if (!parsedRatings.length && !parsedWatchlist.length) {
      throw new Error(
        "No recognizable IMDb ratings.csv or watchlist.csv found.",
      );
    }

    let baseState = window.cloneRecord(window.state);
    let report = {
      source: options.fileName || "IMDb export",
      sourceKind: "imdb",
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

      let importedWatchedKeys = importRatings(parsedRatings, report);
      importWatchlist(parsedWatchlist, importedWatchedKeys, report);

      report.filmsAdded =
        report.archiveAdded + report.watchedOtherAdded + report.watchlistAdded;
      report.filmsMerged =
        report.watchedArchiveMerged +
        report.watchedOtherMerged +
        report.watchlistMerged;

      window.rebuildAggregates?.();

      return window.createImportProposal({
        sourceKind: "imdb",
        mode: "merge",
        baseState,
        candidateState: window.state,
        report,
        sourceRevision: window.canonicalDataRevision(
          Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
        ),
        sourceConfig: {
          fileName: String(options.fileName || ""),
          files: Object.keys(files),
        },
      });
    } finally {
      window.state = baseState;
      window.rebuildAggregates?.();
    }
  };

  function applyTmdbMatchToFilm(film, match) {
    if (match.tmdbId) film.tmdbId = String(match.tmdbId);
    if (match.director) film.director = String(match.director).trim();
    if (match.country) film.country = String(match.country).trim();
    if (match.primaryCountry)
      film.primaryCountry = String(match.primaryCountry).trim();
    if (match.swedishTitle)
      film.swedishTitle = String(match.swedishTitle).trim();
    if (match.runtimeMinutes) film.runtimeMinutes = match.runtimeMinutes;
    if (match.poster) film.poster = match.poster;
    if (match.type) film.type = match.type;
    window.normalizeFilmMetadata?.(film);
  }

  /**
   * Looks up TMDB metadata for freshly created archive films on an IMDb proposal.
   * @param {ImportProposal} proposal An IMDb proposal, already built.
   * @param {Object} [options] Batch controls.
   * @param {number} [options.concurrency] Parallel lookups, default 4.
   * @param {(done: number, total: number) => void} [options.onProgress] Called as (done, total).
   * @returns {Promise<void>} Completion after every lookup settles.
   */
  window.enrichImdbProposalMetadata = async function (proposal, options = {}) {
    let targets = proposal?.report?.freshArchiveFilms || [];
    if (!targets.length || !window.lookupTmdbMovieMetadata) return;
    let concurrency = Math.max(
      1,
      Math.min(targets.length, Number(options.concurrency) || 4),
    );
    let cursor = 0;
    let done = 0;
    async function worker() {
      while (cursor < targets.length) {
        let target = targets[cursor++];
        let yearFilms = proposal.candidateState?.years?.[target.year]?.films;
        let filmIndex = (yearFilms || []).findIndex(
          (candidate) => candidate.id === target.id,
        );
        let film = filmIndex >= 0 ? yearFilms[filmIndex] : null;
        if (film && !film.tmdbId) {
          try {
            let match = await window.lookupTmdbMovieMetadata({
              title: film.title,
              year: film.year,
            });
            if (match) {
              applyTmdbMatchToFilm(film, match);
              if (match.type && match.type !== "Film") {
                yearFilms.splice(filmIndex, 1);
                proposal.candidateState.watchedOther ||= [];
                proposal.candidateState.watchedOther.push(film);
                if (proposal.report) {
                  proposal.report.archiveAdded = Math.max(
                    0,
                    (proposal.report.archiveAdded || 0) - 1,
                  );
                  proposal.report.watchedOtherAdded =
                    (proposal.report.watchedOtherAdded || 0) + 1;
                }
              }
            }
          } catch (err) {
            console.warn(`TMDB lookup failed for ${target.title}`, err);
          }
        }
        done += 1;
        options.onProgress?.(done, targets.length);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
  };
})();
