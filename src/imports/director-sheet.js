/**
 * @file Parses the director-interest spreadsheet's repeated three-column
 * lanes into normalized watchlist candidates and row-level diagnostics.
 */

(function () {
  [
    "cleanSheetCell",
    "sheetTier",
    "parseTabbedSheetRows",
    "isFourDigitYearCell",
    "isUrlOrDashCell",
  ].forEach((name) => {
    if (typeof window[name] !== "function") {
      throw new Error(`Missing dependency: ${name} (sheet-import-utils.js)`);
    }
  });
})();

function directorSheetClean(value) {
  return window.cleanSheetCell(value);
}

function directorSheetTier(value) {
  return window.sheetTier(value);
}

/**
 * Parses director spreadsheet lanes into importable film entries.
 * @param {string} raw Raw tab-delimited sheet text.
 * @param {Object} [options] Optional preparsed rows and source-row offset.
 * @returns {Object} Parsed items and row diagnostics.
 */
window.parseDirectorWatchlistSheet = function (raw, options = {}) {
  let rows = Array.isArray(options.rows)
    ? options.rows
    : window.parseTabbedSheetRows(raw);

  let sheetStartRow = Math.max(1, Number(options.sheetStartRow) || 1);

  let diagnostics = {
    skippedRows: 0,
    skippedDetails: [],
    lanes: 0,
    headers: 0,
    itemsWithYear: 0,
    itemsWithoutYear: 0,
    ratedItems: 0,
    tieredItems: 0,
    untieredItems: 0,
  };

  let items = [];
  let laneCount = Math.max(0, ...rows.map((row) => row.length));

  function skip(rowIndex, reason, values) {
    diagnostics.skippedRows += 1;
    diagnostics.skippedDetails.push({
      rowNumber: sheetStartRow + rowIndex,
      reason,
      values: (values || [])
        .map(directorSheetClean)
        .filter(Boolean)
        .slice(0, 8),
    });
  }

  for (let col = 0; col < laneCount; col += 3) {
    diagnostics.lanes += 1;

    let currentDirector = "";
    let currentSourceUrl = "";

    rows.forEach((row, rowIndex) => {
      let year = directorSheetClean(row[col]);
      let title = directorSheetClean(row[col + 1]);
      let interest = directorSheetClean(row[col + 2]);

      if (!year && !title && !interest) return;

      // Header row: Year | Director Name | URL or -
      if (year.toLowerCase() === "year" && title) {
        currentDirector = title;
        currentSourceUrl = window.isUrlOrDashCell(interest)
          ? interest.replace(/^-$/, "")
          : "";
        diagnostics.headers += 1;
        return;
      }

      // Ignore stray URL-only / empty-ish rows.
      if (!title) return;

      if (!currentDirector) {
        skip(rowIndex, "Director film row appeared before a director header.", [
          year,
          title,
          interest,
        ]);
        return;
      }

      let hasYear = window.isFourDigitYearCell(year);
      let parsedRating = window.parseFilmRating?.(interest) || { value: 0 };
      let tier = parsedRating.value ? "" : directorSheetTier(interest);

      if (hasYear) diagnostics.itemsWithYear += 1;
      else diagnostics.itemsWithoutYear += 1;

      if (parsedRating.value) diagnostics.ratedItems += 1;
      else if (tier) diagnostics.tieredItems += 1;
      else diagnostics.untieredItems += 1;

      items.push({
        year: hasYear ? year : "",
        title,
        tier,
        rating: interest,
        ratingValue: parsedRating.value || 0,
        rawInterest: interest,
        director: currentDirector,
        sourceUrl: currentSourceUrl,
        rowNumber: sheetStartRow + rowIndex,
        lane: col,
      });
    });
  }

  return { items, diagnostics };
};
