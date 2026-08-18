/**
 * @file Shared cell, row, year, URL, and tier normalization helpers for the
 * director and franchise spreadsheet importers.
 */

window.OSKARS_SHEET_IMPORT_UTIL_NAMES = [
  "cleanSheetCell",
  "sheetTier",
  "parseTabbedSheetRows",
  "isFourDigitYearCell",
  "isUrlOrDashCell",
];

/**
 * Asserts this file's helpers are already loaded, so director-sheet.js and
 * franchise-sheet.js fail loudly at load time if entry-loader.js's
 * dependency order is ever changed, instead of failing later with a
 * confusing "not a function" deep inside a parse.
 */
window.assertSheetImportUtilsReady = function () {
  window.OSKARS_SHEET_IMPORT_UTIL_NAMES.forEach((name) => {
    if (typeof window[name] !== "function") {
      throw new Error(`Missing dependency: ${name} (sheet-import-utils.js)`);
    }
  });
};

/**
 * Parses tab-delimited spreadsheet text into rows while normalizing newlines.
 * @param {string} raw Raw spreadsheet text.
 * @returns {string[][]}
 */
window.parseTabbedSheetRows = function (raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.split("\t"));
};

/**
 * Normalizes a spreadsheet cell to trimmed text.
 * @param {*} value Cell value.
 * @returns {string}
 */
window.cleanSheetCell = function (value) {
  let text = String(value || "").trim();

  let markdownLink = text.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (markdownLink) return markdownLink[1].trim();

  let stripped = text;
  let trailingLinkRe = /\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;

  while (stripped.match(trailingLinkRe)) {
    let m = stripped.match(trailingLinkRe);
    if (m[0].trim() === stripped.trim()) return m[1].trim();
    stripped = stripped.slice(0, stripped.length - m[0].length).trim();
  }

  return stripped;
};

/**
 * Reports whether a spreadsheet cell is exactly a four-digit year.
 * @param {*} value Cell value.
 * @returns {boolean}
 */
window.isFourDigitYearCell = function (value) {
  return /^\d{4}$/.test(window.cleanSheetCell(value));
};

/**
 * Reports whether a cell is an HTTP URL or the sheet's dash placeholder.
 * @param {*} value Cell value.
 * @returns {boolean}
 */
window.isUrlOrDashCell = function (value) {
  let text = window.cleanSheetCell(value);
  return /^https?:\/\//i.test(text) || text === "-";
};

/**
 * Converts a spreadsheet cell to a canonical watchlist tier.
 * @param {*} value Cell value.
 * @returns {string}
 */
window.sheetTier = function (value) {
  return window.normalizeWatchlistTier?.(window.cleanSheetCell(value)) || "";
};
