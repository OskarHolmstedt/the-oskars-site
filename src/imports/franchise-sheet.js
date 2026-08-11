/**
 * @file Parses the franchise spreadsheet's repeated three-column lanes,
 * preserving nested header ancestry, source links, ranks, and diagnostics.
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

function franchiseSheetClean(value) {
  return window.cleanSheetCell(value);
}

function franchiseSheetTier(value) {
  return window.sheetTier(value);
}

/**
 * Parses franchise spreadsheet lanes into importable membership entries.
 * @param {string} raw Raw tab-delimited sheet text.
 * @param {Object} [options] Optional preparsed rows and source-row offset.
 * @returns {Object} Parsed items and row diagnostics.
 */
window.parseFranchiseSheet = function (raw, options = {}) {
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
  let rankCounts = new Map();

  function skip(rowIndex, reason, values) {
    diagnostics.skippedRows += 1;
    diagnostics.skippedDetails.push({
      rowNumber: sheetStartRow + rowIndex,
      reason,
      values: (values || [])
        .map(franchiseSheetClean)
        .filter(Boolean)
        .slice(0, 8),
    });
  }

  function nextRank(chain, franchiseName) {
    let key = `${(chain || []).join(" > ")}\n${franchiseName}`;
    let rank = (rankCounts.get(key) || 0) + 1;
    rankCounts.set(key, rank);
    return rank;
  }

  function franchiseChainKey(name) {
    return franchiseSheetClean(name).toLowerCase();
  }

  for (let col = 0; col < laneCount; col += 3) {
    diagnostics.lanes += 1;

    let rootFranchise = "";
    let currentFranchise = "";
    let currentParent = "";
    let currentChain = [];
    let currentSourceUrl = "";
    // Remembers each header name's own ancestor chain as it's declared, so a
    // later header that names an earlier one as its parent (e.g. "Marvel >
    // MCU" now, "MCU > Phase One" further down, with no film rows directly
    // under MCU itself) still inherits MCU's own ancestry instead of losing
    // it the moment a later header stops referencing it.
    let chainByName = new Map();

    rows.forEach((row, rowIndex) => {
      let year = franchiseSheetClean(row[col]);
      let title = franchiseSheetClean(row[col + 1]);
      let rating = franchiseSheetClean(row[col + 2]);

      // Blank separator resets this lane.
      if (!year && !title && !rating) {
        rootFranchise = "";
        currentFranchise = "";
        currentParent = "";
        currentChain = [];
        currentSourceUrl = "";
        chainByName = new Map();
        return;
      }

      // Header row: Year | Franchise name | URL or -. The title cell can be
      // a single name (today's behavior: first header in a lane is the
      // root, every later header becomes a direct child of that root) or an
      // explicit "A > B > C" chain, which overrides the lane-root fallback
      // for that header however deep it goes.
      if (year.toLowerCase() === "year" && title) {
        currentSourceUrl = window.isUrlOrDashCell(rating)
          ? rating.replace(/^-$/, "")
          : "";
        let segments = title
          .split(/\s*>\s*/)
          .map(franchiseSheetClean)
          .filter(Boolean);
        if (segments.length > 1) {
          let pathSoFar = [];
          segments.forEach((segment) => {
            let key = franchiseChainKey(segment);
            if (chainByName.has(key)) {
              pathSoFar = chainByName.get(key).slice();
            } else {
              chainByName.set(key, pathSoFar.slice());
            }
            pathSoFar = pathSoFar.concat([segment]);
          });
          currentChain = pathSoFar.slice(0, -1);
          currentFranchise = segments[segments.length - 1];
          currentParent = currentChain[currentChain.length - 1] || "";
          if (!rootFranchise) rootFranchise = segments[0];
        } else if (!rootFranchise) {
          rootFranchise = title;
          currentFranchise = title;
          currentParent = "";
          currentChain = [];
          chainByName.set(franchiseChainKey(title), []);
        } else {
          currentParent = rootFranchise;
          currentFranchise = title;
          let rootChain =
            chainByName.get(franchiseChainKey(rootFranchise)) || [];
          currentChain = rootChain.concat([rootFranchise]);
          chainByName.set(franchiseChainKey(title), currentChain);
        }

        diagnostics.headers += 1;
        return;
      }

      // Ignore rows without a film title.
      if (!title) return;

      if (!currentFranchise) {
        skip(
          rowIndex,
          "Franchise film row appeared before a franchise header.",
          [year, title, rating],
        );
        return;
      }

      let parsedRating = window.parseFilmRating?.(rating) || { value: 0 };
      let tier = parsedRating.value ? "" : franchiseSheetTier(rating);
      let hasYear = window.isFourDigitYearCell(year);

      if (hasYear) diagnostics.itemsWithYear += 1;
      else diagnostics.itemsWithoutYear += 1;

      if (parsedRating.value) diagnostics.ratedItems += 1;
      else if (tier) diagnostics.tieredItems += 1;
      else diagnostics.untieredItems += 1;

      items.push({
        year: hasYear ? year : "",
        title,
        rating,
        ratingValue: parsedRating.value || 0,
        tier,
        franchiseName: currentFranchise,
        parentName: currentParent,
        parentChain: currentChain,
        sourceUrl: currentSourceUrl,
        rank: nextRank(currentChain, currentFranchise),
        rowNumber: sheetStartRow + rowIndex,
        lane: col,
      });
    });
  }

  return { items, diagnostics };
};
