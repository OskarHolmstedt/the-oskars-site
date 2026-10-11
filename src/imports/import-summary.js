/**
 * @file Compacts persisted import reports and groups Google Sheets import
 * problems for the report UI.
 */

// Keep the last completed import useful across page loads without copying
// thousands of raw row diagnostics into every browser-state save or backup.
// The totals retain accurate overflow counts for the capped detail arrays.
/**
 * Clones and bounds report detail collections for persistence and backups.
 * @param {ImportReport} report Full import report.
 * @param {Object} [options] Snapshot metadata.
 * @param {string} [options.generatedAt] ISO timestamp override.
 * @param {boolean} [options.preview] Whether the report represents a dry run.
 * @returns {ImportReport} Compact report snapshot.
 */
window.compactImportReport = function (report, options = {}) {
  let snapshot = window.cloneRecord
    ? window.cloneRecord(report || {})
    : JSON.parse(JSON.stringify(report || {}));
  delete snapshot.persisted;
  let limits = {
    warnings: 50,
    ruleViolations: 50,
    titleVariants: 50,
    rangeSummaries: 30,
    skippedDetails: 100,
    eligibilitySummaries: 100,
    missingAllTimeFilms: 100,
    newFilmDetails: 100,
    rankChanges: 100,
    awardChanges: 100,
    preservedFieldDetails: 100,
    sourceConflicts: 100,
    consistencyChecks: 100,
    franchiseSummaries: 30,
    directorSummaries: 30,
    proposalChanges: 30,
    officialResultIssues: 100,
  };
  snapshot.detailTotals = Object.assign({}, snapshot.detailTotals);
  Object.keys(limits).forEach((key) => {
    if (!Array.isArray(snapshot[key])) return;
    snapshot.detailTotals[key] = snapshot[key].length;
    snapshot[key] = snapshot[key].slice(0, limits[key]);
  });
  (snapshot.rangeSummaries || []).forEach((range) => {
    // These are already represented by the report-wide detail collections.
    delete range.ruleWarningDetails;
    delete range.skippedDetails;
    delete range.missingAllTimeFilms;
    delete range.newFilmDetails;
    delete range.rankChanges;
    delete range.awardChanges;
    delete range.preservedFieldDetails;
    delete range.franchiseSummary;
    delete range.directorSummary;
  });
  ["franchiseSummaries", "directorSummaries"].forEach((key) => {
    (snapshot[key] || []).forEach((summary) => {
      ["untieredRows", "unmatchedRated", "ambiguousWatchlist"].forEach(
        (detailKey) => {
          if (Array.isArray(summary[detailKey]))
            summary[detailKey] = summary[detailKey].slice(0, 100);
        },
      );
    });
  });
  (snapshot.consistencyChecks || []).forEach((check) => {
    if (Array.isArray(check.samples))
      check.samples = check.samples.slice(0, 10);
  });
  snapshot.generatedAt =
    options.generatedAt || snapshot.generatedAt || new Date().toISOString();
  snapshot.preview = Boolean(options.preview);
  return snapshot;
};

/**
 * Formats individual import problems as readable, plain-text groups.
 * @param {ImportReport} report Import report.
 * @returns {{label: string, lines: string[]}[]} Problem groups.
 */
window.googleSheetsImportProblemGroups = function (report) {
  let context = (detail) =>
    [detail.film || detail.title, detail.year || detail.period, detail.category]
      .filter(Boolean)
      .join(" · ");
  return [
    {
      label: "Values kept from your archive",
      lines: (report.preservedFieldDetails || []).map(
        (detail) =>
          `${context(detail)} — ${String(detail.field || "Value").replace(/([a-z])([A-Z])/g, "$1 $2")}: kept “${detail.local}”; sheet has “${detail.incoming}”.`,
      ),
    },
    {
      label: "Award nominations rejected",
      lines: (report.ruleViolations || []).map(
        (detail) => `${context(detail)} — ${detail.message}`,
      ),
    },
    {
      label: "Eligibility needs metadata",
      lines: (report.ruleWarningDetails || []).map(
        (detail) => `${context(detail)} — ${detail.message}`,
      ),
    },
    {
      label: "Rows that could not be imported",
      lines: (report.skippedDetails || []).map(
        (detail) =>
          `${detail.source || "Sheet"}${detail.rowNumber ? ` row ${detail.rowNumber}` : ""} — ${detail.reason}${detail.values?.length ? ` (${detail.values.join(" · ")})` : ""}`,
      ),
    },
  ].filter((group) => group.lines.length);
};
