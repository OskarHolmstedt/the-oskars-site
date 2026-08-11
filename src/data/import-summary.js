/**
 * @file Combines per-range Google Sheets import reports, groups eligibility
 * warnings, and compacts persisted report details to bounded snapshots.
 */

// The eligibility count comes straight from each report's own `ruleWarnings`
// number rather than being re-parsed out of the human-readable warning text
// importer.js generates for it (fragile: the two would silently drift apart
// if that wording ever changed). The regex below only identifies that same
// line so it isn't *also* shown verbatim per report alongside the combined
// total; if the wording ever changes, the worst case is a harmless duplicate
// line, not a wrong count.
/**
 * Deduplicates range warnings and combines eligibility warning counts.
 * @param {ImportReport[]} reports Per-range Google Sheets reports.
 * @returns {string[]} Compact user-facing warnings.
 */
window.compactGoogleSheetsWarnings = function (reports) {
  let warnings = [];
  let eligibilityTotal = 0;
  let eligibilitySources = [];
  let seen = new Set();
  let eligibilityLinePattern =
    /^\d+ eligibility check\(s\) could not be completed because metadata is unknown\.$/;

  reports.forEach((report) => {
    let source = String(report.source || "Google Sheets").replace(
      /^Google Sheets\s*·\s*/,
      "",
    );
    let ruleWarnings = Number(report.ruleWarnings) || 0;
    if (ruleWarnings) {
      eligibilityTotal += ruleWarnings;
      eligibilitySources.push(`${source}: ${ruleWarnings}`);
    }

    (report.warnings || []).forEach((warning) => {
      if (eligibilityLinePattern.test(String(warning))) return;

      let text = /^Google Sheets\b/.test(warning)
        ? warning
        : `${source}: ${warning}`;
      if (!seen.has(text)) {
        seen.add(text);
        warnings.push(text);
      }
    });
  });

  if (eligibilityTotal) {
    warnings.unshift(
      `${eligibilityTotal} eligibility check(s) could not be completed because metadata is unknown (${eligibilitySources.join(", ")}).`,
    );
  }
  return warnings;
};

/**
 * Projects per-range reports onto the detail shape used by the combined report.
 * @param {ImportReport[]} reports Per-range Google Sheets reports.
 * @returns {Object[]} Range summaries excluding the synthetic merge report.
 */
window.googleSheetsRangeSummaries = function (reports) {
  return reports
    .filter((report) => report.rangeKey !== "merge")
    .map((report) => ({
      key:
        report.rangeKey ||
        String(report.source || "").replace(/^Google Sheets\s*·\s*/, "") ||
        "Range",
      range: report.sheetRange || "",
      rows: report.sheetRows || 0,
      filmsParsed: report.filmsParsed || 0,
      filmsAdded: report.filmsAdded || 0,
      filmsMerged: report.filmsMerged || 0,
      awardsAdded: report.awardsAdded || 0,
      awardsRejected: report.awardsRejected || 0,
      skipped: report.skipped || 0,
      periods: report.periods || [],
      warnings: report.warnings || [],
      ruleWarningDetails: report.ruleWarningDetails || [],
      skippedDetails: report.skippedDetails || [],
      missingAllTimeFilms: report.missingAllTimeFilms || [],
      newFilmDetails: report.newFilmDetails || [],
      rankChanges: report.rankChanges || [],
      awardChanges: report.awardChanges || [],
      preservedFieldDetails: report.preservedFieldDetails || [],
      franchiseSummary: report.franchiseSummary || null,
      directorSummary: report.directorSummary || null,
    }));
};

/**
 * Groups eligibility warnings by source, category, and message.
 * @param {Object[]} details Individual eligibility warning details.
 * @returns {Object[]} Counted warning groups with bounded film and period samples.
 */
window.summarizeEligibilityWarnings = function (details) {
  let grouped = new Map();
  details.forEach((detail) => {
    let key = [
      detail.source || "Import",
      detail.category || "Eligibility",
      detail.message || "Unknown eligibility",
    ].join("\n");
    let group = grouped.get(key);
    if (!group) {
      group = {
        source: detail.source || "Import",
        category: detail.category || "Eligibility",
        message: detail.message || "Unknown eligibility",
        count: 0,
        films: new Set(),
        periods: new Set(),
      };
      grouped.set(key, group);
    }
    group.count += 1;
    if (detail.film) group.films.add(detail.film);
    if (detail.period) group.periods.add(detail.period);
  });
  return [...grouped.values()]
    .map((group) => ({
      source: group.source,
      category: group.category,
      message: group.message,
      count: group.count,
      films: [...group.films].slice(0, 8),
      periods: [...group.periods].slice(0, 8),
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.category.localeCompare(right.category),
    );
};

/**
 * Combines per-range Google Sheets reports into one import report.
 * @param {ImportReport[]} reports Per-range reports to combine.
 * @param {string} source User-facing source label.
 * @returns {ImportReport} Combined report with range and eligibility summaries.
 */
window.summarizeGoogleSheetsReports = function (reports, source) {
  let summary = reports.reduce(
    (total, report) => {
      total.filmsParsed += report.filmsParsed || 0;
      total.filmsAdded += report.filmsAdded || 0;
      total.filmsMerged += report.filmsMerged || 0;
      total.awardsAdded += report.awardsAdded || 0;
      total.awardsRejected += report.awardsRejected || 0;
      total.skipped += report.skipped || 0;
      total.ruleViolations.push(...(report.ruleViolations || []));
      total.missingAllTimeFilms.push(
        ...(report.missingAllTimeFilms || []).map((detail) =>
          Object.assign(
            {
              source:
                report.rangeKey ||
                String(report.source || "").replace(
                  /^Google Sheets\s*·\s*/,
                  "",
                ) ||
                "Google Sheets",
              range: report.sheetRange || "",
            },
            detail,
          ),
        ),
      );
      total.ruleWarningDetails.push(
        ...(report.ruleWarningDetails || []).map((detail) =>
          Object.assign(
            {
              source:
                report.rangeKey ||
                String(report.source || "").replace(
                  /^Google Sheets\s*·\s*/,
                  "",
                ) ||
                "Google Sheets",
              range: report.sheetRange || "",
            },
            detail,
          ),
        ),
      );
      total.skippedDetails.push(
        ...(report.skippedDetails || []).map((detail) =>
          Object.assign(
            {
              source:
                report.rangeKey ||
                String(report.source || "").replace(
                  /^Google Sheets\s*·\s*/,
                  "",
                ) ||
                "Google Sheets",
              range: report.sheetRange || "",
            },
            detail,
          ),
        ),
      );
      let rangeTag = () => ({
        source:
          report.rangeKey ||
          String(report.source || "").replace(/^Google Sheets\s*·\s*/, "") ||
          "Google Sheets",
        range: report.sheetRange || "",
      });
      total.newFilmDetails.push(
        ...(report.newFilmDetails || []).map((detail) =>
          Object.assign(rangeTag(), detail),
        ),
      );
      total.rankChanges.push(
        ...(report.rankChanges || []).map((detail) =>
          Object.assign(rangeTag(), detail),
        ),
      );
      total.awardChanges.push(
        ...(report.awardChanges || []).map((detail) =>
          Object.assign(rangeTag(), detail),
        ),
      );
      total.preservedFieldDetails.push(
        ...(report.preservedFieldDetails || []).map((detail) =>
          Object.assign(rangeTag(), detail),
        ),
      );
      total.sourceConflicts.push(
        ...(report.sourceConflicts || []).map((detail) =>
          Object.assign(rangeTag(), detail),
        ),
      );
      total.consistencyChecks.push(
        ...(report.consistency || []).map((detail) =>
          Object.assign(rangeTag(), detail),
        ),
      );
      if (report.franchiseSummary) {
        total.franchiseSummaries.push(
          Object.assign(
            {
              source:
                report.rangeKey ||
                String(report.source || "").replace(
                  /^Google Sheets\s*·\s*/,
                  "",
                ) ||
                "Google Sheets",
              range: report.sheetRange || "",
            },
            report.franchiseSummary,
          ),
        );
      }
      if (report.directorSummary) {
        total.directorSummaries.push(
          Object.assign(
            {
              source:
                report.rangeKey ||
                String(report.source || "").replace(
                  /^Google Sheets\s*·\s*/,
                  "",
                ) ||
                "Google Sheets",
              range: report.sheetRange || "",
            },
            report.directorSummary,
          ),
        );
      }
      total.periods.push(...(report.periods || []));
      return total;
    },
    {
      source,
      filmsParsed: 0,
      filmsAdded: 0,
      filmsMerged: 0,
      awardsAdded: 0,
      awardsRejected: 0,
      skipped: 0,
      warnings: [],
      ruleViolations: [],
      titleVariants: [],
      periods: [],
      rangeSummaries: [],
      ruleWarningDetails: [],
      eligibilitySummaries: [],
      skippedDetails: [],
      missingAllTimeFilms: [],
      franchiseSummaries: [],
      directorSummaries: [],
      newFilmDetails: [],
      rankChanges: [],
      awardChanges: [],
      preservedFieldDetails: [],
      sourceConflicts: [],
      consistencyChecks: [],
    },
  );
  summary.periods = [...new Set(summary.periods)];
  summary.warnings = window.compactGoogleSheetsWarnings(reports);
  summary.rangeSummaries = window.googleSheetsRangeSummaries(reports);
  summary.eligibilitySummaries = window.summarizeEligibilityWarnings(
    summary.ruleWarningDetails,
  );
  return summary;
};

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
