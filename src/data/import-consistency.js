/**
 * @file Independently checks imported Google Sheet rows against resulting
 * application state to expose parser regressions and source-schema drift.
 */

// Import consistency checks (issue #41): after a Google import, re-read each
// range's raw sheet rows with deliberately simple, independent logic and
// verify that every field a source row carries actually landed on the
// imported record. This redundancy is the point - it catches parser bugs and
// schema drift (a renamed or shifted column, a lane rule change) that the
// real parsers cannot notice about themselves. Checks compare presence, not
// equality: a differing value that was deliberately preserved locally is a
// preserved-field/conflict story, not a lost field.

function importConsistencyCell(value) {
  let text = String(value ?? "").trim();
  return text === "-" ? "" : text;
}

function importConsistencyHeaderIndex(row, names) {
  return (row || []).findIndex((cell) => {
    let text = importConsistencyCell(cell).toLowerCase();
    return names.some((name) => text === name || text.startsWith(`${name} `));
  });
}

function importConsistencyCheck(field, label) {
  return { field, label, sourceCount: 0, missingCount: 0, samples: [] };
}

function importConsistencyRecord(check, present, sample) {
  check.sourceCount += 1;
  if (present) return;
  check.missingCount += 1;
  if (check.samples.length < 6) check.samples.push(sample);
}

/**
 * Checks ranked-list source fields for presence on imported archive films.
 * @param {Array<Array<*>>} rows Raw Google Sheet rows.
 * @returns {ImportConsistencyCheck[]} Checks for source fields that were present.
 */
window.collectRankedListConsistency = function (rows) {
  let headerIndex = (rows || []).findIndex(
    (row) =>
      importConsistencyHeaderIndex(row, ["title"]) >= 0 &&
      importConsistencyHeaderIndex(row, ["year"]) >= 0,
  );
  if (headerIndex < 0) return [];
  let header = rows[headerIndex];
  let columns = {
    year: importConsistencyHeaderIndex(header, ["year"]),
    title: importConsistencyHeaderIndex(header, ["title"]),
    director: importConsistencyHeaderIndex(header, ["director", "directors"]),
    rating: importConsistencyHeaderIndex(header, ["rating"]),
    type: importConsistencyHeaderIndex(header, ["type"]),
    medium: importConsistencyHeaderIndex(header, ["medium"]),
    screenplay: importConsistencyHeaderIndex(header, ["screenplay"]),
    country: importConsistencyHeaderIndex(header, ["country", "countries"]),
    runtime: importConsistencyHeaderIndex(header, ["runtime"]),
    tmdbId: importConsistencyHeaderIndex(header, ["tmdbid", "tmdb id"]),
    letterboxd: importConsistencyHeaderIndex(header, ["letterboxd"]),
  };
  let checks = {
    film: importConsistencyCheck("film", "Film row"),
    director: importConsistencyCheck("director", "Director"),
    rating: importConsistencyCheck("rating", "Rating"),
    type: importConsistencyCheck("type", "Type"),
    medium: importConsistencyCheck("medium", "Medium"),
    screenplay: importConsistencyCheck("screenplay", "Screenplay type"),
    country: importConsistencyCheck("country", "Country"),
    runtime: importConsistencyCheck("runtime", "Runtime"),
    tmdbId: importConsistencyCheck("tmdbId", "TMDB ID"),
    letterboxd: importConsistencyCheck("letterboxd", "Letterboxd link"),
  };
  let presence = {
    director: (film) => Boolean(film.director || film.directors?.length),
    rating: (film) => Boolean(film.rating),
    type: (film) => Boolean(film.type),
    medium: (film) => Boolean(film.medium && film.medium !== "unknown"),
    screenplay: (film) =>
      Boolean(film.screenplayType && film.screenplayType !== "unknown"),
    country: (film) => Boolean(film.country),
    runtime: (film) => Boolean(film.runtimeMinutes),
    tmdbId: (film) => Boolean(film.tmdbId),
    letterboxd: (film) =>
      Boolean(
        film.letterboxdUrl || /letterboxd\.com/i.test(String(film.url || "")),
      ),
  };
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    let year = importConsistencyCell(row[columns.year]);
    let title = importConsistencyCell(row[columns.title]);
    // Multi-line cells legitimately split one row into several film records;
    // this simple checker does not reproduce that rule, so it skips them.
    if (!/^\d{4}$/.test(year) || !title || title.includes("\n")) return;
    let rowNumber = headerIndex + offset + 2;
    let film = window.findFilmByTitleYear({ title, year });
    let sample = { rowNumber, title, year };
    importConsistencyRecord(checks.film, Boolean(film), sample);
    if (!film) return;
    Object.keys(presence).forEach((field) => {
      if (columns[field] < 0) return;
      let value = importConsistencyCell(row[columns[field]]);
      if (!value || value.includes("\n")) return;
      importConsistencyRecord(
        checks[field],
        presence[field](film),
        Object.assign({ value }, sample),
      );
    });
  });
  return Object.values(checks).filter((check) => check.sourceCount > 0);
};

/**
 * Checks watchlist source fields for presence on imported or absorbed films.
 * @param {Array<Array<*>>} rows Raw Google Sheet rows.
 * @returns {ImportConsistencyCheck[]} Checks for source fields that were present.
 */
window.collectWatchlistConsistency = function (rows) {
  let headerIndex = (rows || []).findIndex(
    (row) =>
      importConsistencyHeaderIndex(row, ["name"]) >= 0 &&
      importConsistencyHeaderIndex(row, ["year"]) >= 0,
  );
  if (headerIndex < 0) return [];
  let header = rows[headerIndex];
  let columns = {
    title: importConsistencyHeaderIndex(header, ["name"]),
    year: importConsistencyHeaderIndex(header, ["year"]),
    letterboxd: importConsistencyHeaderIndex(header, [
      "letterboxd uri",
      "letterboxd url",
    ]),
    tier: importConsistencyHeaderIndex(header, ["tier", "rank"]),
    director: importConsistencyHeaderIndex(header, ["director"]),
    tmdbId: importConsistencyHeaderIndex(header, ["tmdb id", "tmdbid"]),
  };
  let checks = {
    item: importConsistencyCheck("item", "Watchlist row"),
    letterboxd: importConsistencyCheck("letterboxd", "Letterboxd link"),
    tier: importConsistencyCheck("tier", "Tier"),
    director: importConsistencyCheck("director", "Director"),
    tmdbId: importConsistencyCheck("tmdbId", "TMDB ID"),
  };
  let itemsByIdentity = new Map();
  (state.watchlist || []).forEach((item) => {
    itemsByIdentity.set(
      `${item.year || ""}::${normalizeTitle(item.title)}`,
      item,
    );
  });
  rows.slice(headerIndex + 1).forEach((row, offset) => {
    let title = importConsistencyCell(row[columns.title]);
    let year = importConsistencyCell(row[columns.year]);
    if (!title) return;
    let rowNumber = headerIndex + offset + 2;
    let sample = { rowNumber, title, year };
    let item = itemsByIdentity.get(`${year}::${normalizeTitle(title)}`);
    if (!item) {
      // A watchlist row that matches an archive film gets removed as a
      // duplicate by later franchise/director imports - that is deliberate,
      // not a lost row.
      let absorbed = Boolean(window.findFilmByTitleYear({ title, year }));
      importConsistencyRecord(checks.item, absorbed, sample);
      return;
    }
    importConsistencyRecord(checks.item, true, sample);
    if (
      columns.letterboxd >= 0 &&
      importConsistencyCell(row[columns.letterboxd])
    ) {
      importConsistencyRecord(
        checks.letterboxd,
        Boolean(item.letterboxdUrl),
        sample,
      );
    }
    if (columns.tier >= 0) {
      let tier =
        window.normalizeWatchlistTier?.(
          importConsistencyCell(row[columns.tier]),
        ) || "";
      if (tier)
        importConsistencyRecord(checks.tier, Boolean(item.tier), sample);
    }
    if (columns.director >= 0 && importConsistencyCell(row[columns.director])) {
      importConsistencyRecord(checks.director, Boolean(item.director), sample);
    }
    if (columns.tmdbId >= 0 && importConsistencyCell(row[columns.tmdbId])) {
      importConsistencyRecord(checks.tmdbId, Boolean(item.tmdbId), sample);
    }
  });
  return Object.values(checks).filter((check) => check.sourceCount > 0);
};

// Franchise and Directors sheets share the repeated three-column lane layout
// ("Year | Title | URL" headers). A rated row must end up as an archive film
// rating or a watched-other entry; a tiered row must end up archived (row
// absorbed) or as a watchlist item with a tier; a Directors lane row must
// carry its lane's director onto the watchlist item.
/**
 * Checks repeated franchise or director lanes against imported film state.
 * @param {Array<Array<*>>} rows Raw Google Sheet rows.
 * @param {'franchises'|'directors'} kind Lane-sheet kind.
 * @returns {ImportConsistencyCheck[]} Rating, tier, and optional director checks.
 */
window.collectLaneSheetConsistency = function (rows, kind) {
  let laneColumns = new Set();
  (rows || []).forEach((row) => {
    (row || []).forEach((cell, column) => {
      if (
        importConsistencyCell(cell) === "Year" &&
        importConsistencyCell(row[column + 1])
      )
        laneColumns.add(column);
    });
  });
  if (!laneColumns.size) return [];
  let checks = {
    rating: importConsistencyCheck("rating", "Rating"),
    tier: importConsistencyCheck("tier", "Tier"),
  };
  if (kind === "directors")
    checks.director = importConsistencyCheck("director", "Director");
  let itemsByIdentity = new Map();
  (state.watchlist || []).forEach((item) => {
    itemsByIdentity.set(
      `${item.year || ""}::${normalizeTitle(item.title)}`,
      item,
    );
  });
  let laneOwner = {};
  laneColumns.forEach((column) => {
    laneOwner[column] = "";
  });
  (rows || []).forEach((row, rowIndex) => {
    laneColumns.forEach((column) => {
      let first = importConsistencyCell(row[column]);
      let title = importConsistencyCell(row[column + 1]);
      let value = importConsistencyCell(row[column + 2]);
      if (first === "Year" && title) {
        laneOwner[column] = title;
        return;
      }
      if (!/^\d{4}$/.test(first) || !title) return;
      let year = first;
      let rowNumber = rowIndex + 1;
      let sample = { rowNumber, title, year };
      let archiveFilm = window.findFilmByTitleYear({ title, year });
      let item = itemsByIdentity.get(`${year}::${normalizeTitle(title)}`);
      let rated = Boolean(window.parseFilmRating?.(value).value);
      let tier = window.sheetTier?.(value) || "";
      if (rated) {
        let landed =
          Boolean(archiveFilm?.rating) ||
          (state.watchedOther || []).some(
            (entry) =>
              entry.id === `${year}::${normalizeTitle(title)}` && entry.rating,
          );
        importConsistencyRecord(
          checks.rating,
          landed,
          Object.assign({ value }, sample),
        );
      } else if (tier) {
        importConsistencyRecord(
          checks.tier,
          Boolean(archiveFilm || item?.tier),
          Object.assign({ value }, sample),
        );
      }
      // Rated rows land in watchedOther, not the watchlist, so the director
      // presence check only applies to rows the watchlist should carry.
      if (kind === "directors" && laneOwner[column] && !rated) {
        importConsistencyRecord(
          checks.director,
          Boolean(archiveFilm || item?.director),
          sample,
        );
      }
    });
  });
  return Object.values(checks).filter((check) => check.sourceCount > 0);
};

/**
 * Dispatches independent consistency checks for a configured import range.
 * @param {GoogleSheetRangeSpec} spec Range import specification.
 * @param {Array<Array<*>>} rows Raw Google Sheet rows.
 * @returns {ImportConsistencyCheck[]} Applicable field-presence checks.
 */
window.collectImportConsistency = function (spec, rows) {
  if (!rows?.length) return [];
  if (spec.importType === "list")
    return window.collectRankedListConsistency(rows);
  if (spec.importType === "watchlist")
    return window.collectWatchlistConsistency(rows);
  if (spec.importType === "franchises")
    return window.collectLaneSheetConsistency(rows, "franchises");
  if (spec.importType === "directors")
    return window.collectLaneSheetConsistency(rows, "directors");
  if (spec.importType === "collection-awards") {
    let bracketCheck = importConsistencyCheck(
      "collectionBracket",
      "Collection award bracket",
    );
    let nominationCheck = importConsistencyCheck(
      "collectionNomination",
      "Collection award nomination",
    );
    window
      .splitCollectionAwardSheetBlocks(rows)
      .forEach((block) => {
        let parsed = window.parseCollectionAwardsTable("", {
          rows: block.rows,
        });
        if (!parsed?.collectionType || !parsed.collectionId) return;
        let stored = window.collectionAwardBracket?.(
          parsed.collectionType,
          parsed.collectionId,
        );
        let sample = {
          rowNumber: block.rowNumber || "",
          collection: parsed.collectionName,
        };
        importConsistencyRecord(bracketCheck, Boolean(stored), sample);
        (parsed.nominations || []).forEach((nomination) => {
          let present = (stored?.nominations || []).some(
            (candidate) =>
              candidate.category === nomination.category &&
              Number(candidate.placement) === Number(nomination.placement) &&
              normalizeTitle(candidate.sourceTitle) ===
                normalizeTitle(nomination.sourceTitle),
          );
          importConsistencyRecord(
            nominationCheck,
            present,
            Object.assign(
              {
                title: nomination.sourceTitle,
                category: nomination.category,
                placement: nomination.placement,
              },
              sample,
            ),
          );
        });
      });
    return [bracketCheck, nominationCheck].filter(
      (check) => check.sourceCount > 0,
    );
  }
  return [];
};
