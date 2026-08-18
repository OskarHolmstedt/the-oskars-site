/**
 * @file Parses Diary sheet rows into archive references and standalone
 * watched-work metadata without creating ranked period appearances.
 */

function diaryEntryKind(value) {
  let type = String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (type === "film" || type === "tv film") return "archive";
  return "standalone";
}
/**
 * Classifies a Diary Type cell.
 * @param {*} value Type value.
 * @returns {'archive'|'standalone'} Diary routing kind.
 */
window.diaryEntryKind = diaryEntryKind;

/**
 * Parses a Diary export using the ranked-list metadata columns after the two
 * rank columns have been removed.
 * @param {string} raw Raw Diary CSV or TSV text.
 * @returns {{entries: Object[], diagnostics: Object}|null} Diary records and
 *   diagnostics.
 */
window.parseDiary = function (raw) {
  let parsed = parseRankedList(raw, { includeRowNumbers: true });
  if (!parsed) return null;
  let rankFields = [
    "rank",
    "allTimeRank",
    "yearRank",
    "decadeRank",
    "centuryRank",
    "rankConfirmed",
    "rankingGroupId",
    "rankingGroupTitle",
    "suppressAllTimeRank",
    "canonicalComposite",
    "compositeParts",
  ];
  let entries = parsed.films.map((film) => {
    let entry = window.cloneRecord ? window.cloneRecord(film) : { ...film };
    rankFields.forEach((field) => delete entry[field]);
    return entry;
  });
  return {
    entries,
    diagnostics: parsed.diagnostics || { skippedRows: 0, skippedDetails: [] },
  };
};
