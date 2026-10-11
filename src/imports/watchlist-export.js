/**
 * @file Parses Letterboxd-compatible CSV or TSV watchlist exports into
 * normalized watchlist items for the importer (src/imports/importer.js).
 */

function parseWatchlistDelimitedRows(raw) {
  let rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  let delimiter = text.includes("\t") ? "\t" : ",";

  for (let index = 0; index < text.length; index++) {
    let character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value);
      if (row.some((cell) => String(cell).trim())) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }

  row.push(value);
  if (row.some((cell) => String(cell).trim())) rows.push(row);
  return rows;
}

/**
 * Parses a Letterboxd-compatible CSV or TSV watchlist and records skipped rows.
 * @param {string} raw Raw delimited text.
 * @returns {Object} Parsed watchlist items and skipped-row diagnostics.
 */
window.parseWatchlist = function (raw) {
  let rows = parseWatchlistDelimitedRows(raw);
  if (!rows.length)
    return { items: [], diagnostics: { skippedRows: 0, skippedDetails: [] } };
  let header = rows[0].map((value) =>
    String(value || "")
      .trim()
      .toLowerCase(),
  );
  let hasHeader = header.some((value) =>
    [
      "date",
      "name",
      "title",
      "year",
      "director",
      "tier",
      "rank",
      "letterboxd uri",
      "letterboxd url",
    ].includes(value),
  );
  let dataRows = hasHeader ? rows.slice(1) : rows;
  let indexes = hasHeader
    ? {
        title:
          header.indexOf("name") >= 0
            ? header.indexOf("name")
            : header.indexOf("title"),
        year: header.indexOf("year"),
        letterboxdUrl: Math.max(
          header.indexOf("letterboxd uri"),
          header.indexOf("letterboxd url"),
        ),
        tier: Math.max(header.indexOf("tier"), header.indexOf("rank")),
        director: header.indexOf("director"),
        tags:
          header.indexOf("tags") >= 0
            ? header.indexOf("tags")
            : header.indexOf("tag"),
        franchises: header.indexOf("franchises"),
        tmdbId: Math.max(header.indexOf("tmdb id"), header.indexOf("tmdbid")),
        order: Math.max(
          header.indexOf("order"),
          header.indexOf("watchlist order"),
          header.indexOf("interest order"),
          header.indexOf("global order"),
        ),
      }
    : { title: 1, year: 2, letterboxdUrl: 3 };
  let skippedRows = 0;
  let skippedDetails = [];
  let seen = new Set();
  let items = [];

  function cleanCell(value) {
    return String(value || "").trim();
  }

  function recordSkipped(rowIndex, reason, values) {
    skippedRows += 1;
    skippedDetails.push({
      rowNumber: rowIndex + (hasHeader ? 2 : 1),
      reason,
      values: (values || [])
        .map((value) => cleanCell(value))
        .filter(Boolean)
        .slice(0, 8),
    });
  }

  dataRows.forEach((row, rowIndex) => {
    let item = window.normalizeWatchlistItem({
      title: indexes.title >= 0 ? row[indexes.title] : "",
      year: indexes.year >= 0 ? row[indexes.year] : "",
      letterboxdUrl:
        indexes.letterboxdUrl >= 0 ? row[indexes.letterboxdUrl] : "",
      tier: indexes.tier >= 0 ? row[indexes.tier] : "",
      director: indexes.director >= 0 ? row[indexes.director] : "",
      tags: indexes.tags >= 0 ? row[indexes.tags] : "",
      franchises:
        indexes.franchises >= 0
          ? window.parseFranchiseMemberships(row[indexes.franchises])
          : [],
      tmdbId: indexes.tmdbId >= 0 ? row[indexes.tmdbId] : "",
      order: indexes.order >= 0 ? row[indexes.order] : "",
    });
    if (!item) {
      recordSkipped(rowIndex, "No usable film title found.", row);
      return;
    }
    let key = `${window.normalizeTitle(item.title)}\n${item.year}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  });

  return { items, diagnostics: { skippedRows, skippedDetails } };
};
