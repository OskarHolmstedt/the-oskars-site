/**
 * @file Splits the combined bracket spreadsheet into period-specific row
 * blocks and translates each block's metadata cells into canonical period keys.
 */

/**
 * Converts bracket-sheet metadata into a canonical period type and key.
 * @param {string} type Sheet metadata label such as Year or Decade.
 * @param {string} value Sheet metadata value.
 * @returns {Object} Canonical period type and key.
 */
window.bracketPeriodFromMeta = function (type, value) {
  type = String(type || "").trim();
  value = String(value || "").trim();

  let periodType = /^decade$/i.test(type)
    ? "decades"
    : /^century$/i.test(type)
      ? "centuries"
      : /^all-time$/i.test(type)
        ? "allTime"
        : "years";

  let year =
    periodType === "allTime"
      ? "alltime"
      : periodType === "years"
        ? value
        : `${value.replace(/s$/, "")}s`;

  return { periodType, year };
};

/**
 * Splits rows from the combined bracket sheet into independently importable blocks.
 * @param {string[][]} rows Parsed spreadsheet rows.
 * @param {Object} [options] Block layout and source-row options.
 * @returns {Object[]} Period blocks with metadata, rows, and source positions.
 */
window.splitBracketSheetBlocks = function (rows, options = {}) {
  function clean(value) {
    return String(value || "").trim();
  }

  function rowsToRaw(rows) {
    return (rows || []).map((row) => (row || []).join("\t")).join("\n");
  }

  function isGlobalHeader(row) {
    let cells = (row || []).map(clean);
    return (
      cells.includes("Position") &&
      cells.includes("Period") &&
      cells.includes("Picture (1st half)") &&
      cells.includes("Picture (2nd half)") &&
      cells.includes("Director (Recipient)") &&
      cells.includes("Director (Film)")
    );
  }

  function metaColumn(headerRow) {
    let periodCol = (headerRow || []).findIndex(
      (cell) => clean(cell) === "Period",
    );
    if (periodCol >= 0) return periodCol;

    return (headerRow || []).findIndex((cell) => clean(cell) === "Year");
  }

  function isMetaStart(row, col) {
    return /^(Year|Decade|Century|All-time)$/i.test(clean(row?.[col]));
  }

  rows = (rows || []).map((row) => row || []);

  let headerIndex = rows.findIndex(isGlobalHeader);
  if (headerIndex < 0) {
    return [
      {
        rows,
        raw: rowsToRaw(rows),
        rowNumber: options.sheetStartRow || 1,
      },
    ];
  }

  let header = rows[headerIndex];
  let metaCol = metaColumn(header);

  let blocks = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    if (!isMetaStart(rows[i], metaCol)) continue;

    let metaType = clean(rows[i]?.[metaCol]);
    let metaValue = clean(rows[i + 1]?.[metaCol]);

    let { periodType, year } = window.bracketPeriodFromMeta(
      metaType,
      metaValue,
    );

    let blockLength = Math.ceil(window.bracketPictureCapacity(periodType) / 2);
    let blockRows = [header, ...rows.slice(i, i + blockLength)];

    blocks.push({
      rows: blockRows,
      raw: rowsToRaw(blockRows),
      rowNumber: (options.sheetStartRow || 1) + i,
      label: `bracket block near "${metaType} ${year}"`,
    });

    i += blockLength - 1;
  }

  return blocks;
};

/** Splits a combined collection-awards range into five-row director/franchise brackets. @param {string[][]} rows Parsed spreadsheet rows. @param {Object} [options] Source-row options. @returns {Object[]} Collection bracket blocks. */
window.splitCollectionAwardSheetBlocks = function (rows, options = {}) {
  function clean(value) {
    return String(value || "").trim();
  }
  function rowsToRaw(sourceRows) {
    return (sourceRows || []).map((row) => (row || []).join("\t")).join("\n");
  }
  rows = (rows || []).map((row) => row || []);
  let headerIndex = rows.findIndex((row) => {
    let cells = row.map(clean);
    return (
      cells.includes("Position") &&
      cells.includes("Period") &&
      cells.includes("Picture (1st half)") &&
      cells.includes("Picture (2nd half)")
    );
  });
  if (headerIndex < 0)
    return [
      {
        rows,
        raw: rowsToRaw(rows),
        rowNumber: options.sheetStartRow || 1,
      },
    ];
  let header = rows[headerIndex];
  let metaCol = header.findIndex((cell) => clean(cell) === "Period");
  let blocks = [];
  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    let marker = clean(rows[index]?.[metaCol]);
    if (!/^(?:Director|Franchise)$/i.test(marker)) continue;
    let blockRows = [header, ...rows.slice(index, index + 5)];
    let collectionName = clean(rows[index + 1]?.[metaCol]);
    blocks.push({
      rows: blockRows,
      raw: rowsToRaw(blockRows),
      rowNumber: (options.sheetStartRow || 1) + index,
      label: `collection awards near "${marker} ${collectionName}"`,
    });
    index += 4;
  }
  return blocks.length
    ? blocks
    : [
        {
          rows,
          raw: rowsToRaw(rows),
          rowNumber: options.sheetStartRow || 1,
          label: "collection awards",
        },
      ];
};
