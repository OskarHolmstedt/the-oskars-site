/**
 * @file Parses the combined "Directors and Franchises" sheet (issue #468)
 * - one flat row per film, with a director name and a Franchise cell
 * that can hold multiple independent chains. Was previously duplicated
 * privately inside both scripts/import-owner-sheets-to-supabase.mjs and
 * src/data/google-sheets-supabase-import.js (issue #472).
 */

window.assertSheetImportUtilsReady?.();

/**
 * Splits a Franchise cell into independent chains. Verified against the
 * real file: 123 rows use ">" for hierarchy, exactly 1 uses "," for a
 * multi-franchise crossover, 0 rows use both together. Rule: split on ","
 * first (each segment is one independent chain), then each segment on ">"
 * for hierarchy (root-first).
 *
 * A cell holding only the sheet's own placeholder for "no franchise" (a
 * bare dash, matching the same convention this sheet already uses for an
 * unreleased film's Year cell) must parse to no chains at all - not to a
 * literal one-film franchise named "-". Every film without a real
 * franchise uses this placeholder, so treating it as a real chain
 * silently created a shared garbage franchise every such film got linked
 * to, and made every one of those (typically most of the catalog) pay the
 * same franchise-resolution and membership-write cost as a real franchise
 * membership - the actual reason this stage felt disproportionately slow
 * against a large catalog, independent of any per-row Supabase cost.
 * @param {string} raw Raw Franchise cell text.
 * @returns {{parentChain: string[], name: string}[]} Independent franchise chains, root-first.
 */
window.splitDirectorsFranchisesCell = function (raw) {
  return String(raw || "")
    .split(",")
    .map((segment) =>
      segment
        .split(">")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .filter((chain) => chain.length)
    .map((chain) => ({
      parentChain: chain.slice(0, -1),
      name: chain[chain.length - 1],
    }))
    .filter((entry) => !window.isPlaceholderValue(entry.name));
};

/**
 * Parses the combined Directors and Franchises sheet into one item per film.
 * @param {string|string[][]} input Raw tab-delimited text, or already-split rows (e.g. from the Sheets API).
 * @returns {Object[]} Parsed items with title, year, director, franchises, and tier.
 */
window.parseDirectorsFranchisesSheet = function (input) {
  let rows = Array.isArray(input) ? input : window.parseTabbedSheetRows(input);
  if (!rows.length) return [];
  let header = (rows[0] || []).map((cell) =>
    String(cell || "")
      .trim()
      .toLowerCase(),
  );
  let yearIdx = header.indexOf("year");
  let titleIdx = header.indexOf("title");
  let directorIdx = header.indexOf("director");
  let franchiseIdx = header.indexOf("franchise");
  let tierIdx = header.indexOf("tier");
  let items = [];
  for (let index = 1; index < rows.length; index += 1) {
    let row = rows[index];
    if (!row || !row.some((cell) => String(cell || "").trim())) continue;
    let title = window.cleanSheetCell(row[titleIdx]);
    if (!title) continue;
    items.push({
      rowNumber: index + 1,
      year: window.cleanSheetCell(row[yearIdx]),
      title,
      director: window.cleanSheetCell(row[directorIdx]),
      franchises: window.splitDirectorsFranchisesCell(row[franchiseIdx]),
      tier: window.sheetTier(row[tierIdx]),
    });
  }
  return items;
};
