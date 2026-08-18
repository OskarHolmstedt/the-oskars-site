/** @file Renders, groups, localizes, shows, and hides detailed import outcome reports. */

function importReportEscape(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function importReportUi(text, values) {
  return window.uiText?.(text, values) ?? text;
}

function collapsePeriodRuns(values, step, suffix) {
  let sorted = [...new Set(values)].sort((a, b) => a - b);
  let ranges = [];
  let start = null,
    end = null;
  sorted.forEach((value) => {
    if (start === null) {
      start = value;
      end = value;
      return;
    }
    if (value === end + step) {
      end = value;
      return;
    }
    ranges.push([start, end]);
    start = value;
    end = value;
  });
  if (start !== null) ranges.push([start, end]);
  return ranges.map(([from, to]) =>
    from === to ? `${from}${suffix}` : `${from}${suffix}–${to}${suffix}`,
  );
}

function formatPeriodSummary(periods) {
  let other = [];
  let years = [];
  let decades = [];
  (periods || []).filter(Boolean).forEach((period) => {
    let text = String(period);
    if (/^\d{4}$/.test(text)) years.push(Number(text));
    else if (/^\d{4}s$/.test(text)) decades.push(Number(text.slice(0, 4)));
    else other.push(text);
  });
  let parts = [
    ...other,
    ...collapsePeriodRuns(years, 1, ""),
    ...collapsePeriodRuns(decades, 10, "s"),
  ];
  return parts.join(", ") || importReportUi("None");
}

/** Wraps an already-translated "Showing N of M ..." message, or "" when nothing was truncated. @param {number} shown Rendered count. @param {number} total Full count. @param {string} translatedText Pre-translated overflow message. @returns {string} */
function overflowNote(shown, total, translatedText) {
  return total > shown
    ? `<p class="import-report-note">${importReportEscape(translatedText)}</p>`
    : "";
}

function organizeImportReport(body) {
  let summaryNodes = [...body.children].slice(0, 2);
  let detailNodes = [...body.children].slice(2);
  let attentionNodes = detailNodes.filter((node) =>
    node.classList.contains("import-report-attention-item"),
  );
  let activityNodes = detailNodes.filter(
    (node) => !node.classList.contains("import-report-attention-item"),
  );
  detailNodes.forEach((node) => node.remove());

  let makeGroup = (label, nodes, collapsed, emptyText) => {
    let section = document.createElement("section");
    section.className = "import-report-group";
    section.dataset.collapsibleSection = "";
    section.innerHTML = `<h3 data-collapsible-heading>${importReportEscape(label)}</h3><div data-collapsible-body class="import-report-group-body${collapsed ? " is-collapsed" : ""}"></div>`;
    let container = section.querySelector("[data-collapsible-body]");
    nodes.forEach((node) => container.appendChild(node));
    if (!nodes.length && emptyText)
      container.innerHTML = `<p class="import-report-clear">${importReportEscape(emptyText)}</p>`;
    body.appendChild(section);
  };

  // Counts and source stay visible; actionable diagnostics lead, while the
  // verbose record of routine changes starts folded away.
  summaryNodes.forEach((node) => body.appendChild(node));
  makeGroup(
    importReportUi("Needs attention"),
    attentionNodes,
    false,
    importReportUi("No import issues were reported."),
  );
  if (activityNodes.length)
    makeGroup(importReportUi("Import activity"), activityNodes, true, "");
  window.enhanceCollapsibles?.(body);
}

/**
 * Renders and reveals a detailed import report.
 * @param {ImportReport} report Import outcome and diagnostic details.
 */
window.showImportReport = function (report) {
  let finishRenderTimer = window.startOskarsPerformance?.(
    "importReport:render",
  );
  let panel = document.getElementById("importReport");
  let body = document.getElementById("importReportBody");
  if (!panel || !body) return;
  let ui = importReportUi;
  let title = document.getElementById("importReportTitle");
  if (title)
    title.textContent = ui(report.preview ? "Import preview" : "Last import");
  let detailTotal = (key) =>
    Number(report.detailTotals?.[key] ?? report[key]?.length ?? 0);
  let generatedDate = report.generatedAt ? new Date(report.generatedAt) : null;
  let generatedLabel =
    generatedDate && !Number.isNaN(generatedDate.getTime())
      ? generatedDate.toLocaleString()
      : "";
  let proposalChangeRows = (report.proposalChanges || [])
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.section)}</td>
    <td>${entry.changedRecords || 0}</td>
    <td>${entry.before || 0}</td>
    <td>${entry.after || 0}</td>
  </tr>`,
    )
    .join("");

  let informationalWarningPattern =
    /^Merge mode replaced imported Google Sheets periods and preserved local metadata/;
  let warnings = (report.warnings || [])
    .filter((warning) => !informationalWarningPattern.test(String(warning)))
    .map((warning) => `<li>${importReportEscape(warning)}</li>`)
    .join("");
  let informationalWarnings = (report.warnings || [])
    .filter((warning) => informationalWarningPattern.test(String(warning)))
    .map((warning) => `<li>${importReportEscape(warning)}</li>`)
    .join("");
  let restoredSectionRows = (report.restoredSections || [])
    .filter((section) => section.count || section.localBefore)
    .map(
      (section) => `<tr>
    <td>${importReportEscape(ui(section.label))}</td>
    <td>${section.count || 0}</td>
    <td>${section.localBefore || 0}</td>
  </tr>`,
    )
    .join("");
  let ignoredSections = report.ignoredSections || [];
  let ignoredSectionsNote = ignoredSections.length
    ? `<p class="import-report-note">${importReportEscape(
        ui(
          "This file also contains sections merge mode does not restore: {sections}. Local versions were kept; choose the Replace restore mode to bring them back from a backup.",
          {
            sections: ignoredSections
              .map((section) => `${ui(section.label)} (${section.count})`)
              .join(" · "),
          },
        ),
      )}</p>`
    : "";
  let skippedDetails = (report.skippedDetails || []).slice(0, 25);
  let eligibilitySummaries = (report.eligibilitySummaries || []).slice(0, 25);
  let missingAllTimeFilms = (report.missingAllTimeFilms || []).slice(0, 40);
  let newFilmDetails = (report.newFilmDetails || []).slice(0, 40);
  let rankChanges = (report.rankChanges || []).slice(0, 40);
  let awardChanges = (report.awardChanges || []).slice(0, 40);
  let preservedFieldDetails = (report.preservedFieldDetails || []).slice(0, 25);
  let sourceConflicts = (report.sourceConflicts || []).slice(0, 25);
  let officialResultIssues = (report.officialResultIssues || []).slice(0, 100);
  let letterboxdSummary =
    report.sourceKind === "letterboxd" ||
    report.watchedArchiveMerged !== undefined
      ? report
      : null;
  let franchiseSummaries =
    report.franchiseSummaries ||
    (report.franchiseSummary ? [report.franchiseSummary] : []);
  let directorSummaries =
    report.directorSummaries ||
    (report.directorSummary ? [report.directorSummary] : []);
  let rangeRows = (report.rangeSummaries || [])
    .map((row) => {
      let periods = formatPeriodSummary(row.periods);
      let stats = ui("{parsed} parsed, {added} added, {merged} merged", {
        parsed: row.filmsParsed || 0,
        added: row.filmsAdded || 0,
        merged: row.filmsMerged || 0,
      });
      let awardStats = ui("{added} added, {rejected} rejected", {
        added: row.awardsAdded || 0,
        rejected: row.awardsRejected || 0,
      });
      return `<tr>
      <td><strong>${importReportEscape(row.key || ui("Range"))}</strong>${row.range ? `<span class="leaderboard-meta">${importReportEscape(row.range)}</span>` : ""}</td>
      <td>${row.rows || 0}</td>
      <td>${importReportEscape(stats)}</td>
      <td>${importReportEscape(awardStats)}</td>
      <td>${row.skipped || 0}</td>
      <td>${importReportEscape(periods)}</td>
    </tr>`;
    })
    .join("");
  let skippedRows = skippedDetails
    .map((detail) => {
      let source = detail.source || detail.range || "";
      let values = (detail.values || []).join(" | ") || ui("No visible values");
      return `<tr>
      <td>${importReportEscape(source || ui("Import"))}</td>
      <td>${importReportEscape(detail.rowNumber || "")}</td>
      <td>${importReportEscape(detail.reason || ui("Skipped"))}</td>
      <td>${importReportEscape(values)}</td>
    </tr>`;
    })
    .join("");
  let skippedOverflow = overflowNote(
    skippedDetails.length,
    detailTotal("skippedDetails"),
    ui("Showing {shown} of {total} skipped row details.", {
      shown: skippedDetails.length,
      total: detailTotal("skippedDetails"),
    }),
  );
  let eligibilityRows = eligibilitySummaries
    .map((summary) => {
      let films = (summary.films || []).join(", ") || ui("None");
      let periods = (summary.periods || []).join(", ") || ui("None");
      return `<tr>
      <td>${summary.count || 0}</td>
      <td>${importReportEscape(summary.source || ui("Import"))}</td>
      <td>${importReportEscape(summary.category || "")}</td>
      <td>${importReportEscape(summary.message || "")}</td>
      <td>${importReportEscape(films)}</td>
      <td>${importReportEscape(periods)}</td>
    </tr>`;
    })
    .join("");
  let eligibilityOverflow = overflowNote(
    eligibilitySummaries.length,
    detailTotal("eligibilitySummaries"),
    ui("Showing {shown} of {total} eligibility groups.", {
      shown: eligibilitySummaries.length,
      total: detailTotal("eligibilitySummaries"),
    }),
  );
  let missingAllTimeRows = missingAllTimeFilms
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Import"))}</td>
    <td>${importReportEscape(entry.period || "")}</td>
    <td>${importReportEscape(entry.rank || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
  </tr>`,
    )
    .join("");
  let missingAllTimeOverflow = overflowNote(
    missingAllTimeFilms.length,
    detailTotal("missingAllTimeFilms"),
    ui("Showing {shown} of {total} bracket films missing from the all-time ranked list.", {
      shown: missingAllTimeFilms.length,
      total: detailTotal("missingAllTimeFilms"),
    }),
  );
  let newFilmRows = newFilmDetails
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Import"))}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.rank || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
  </tr>`,
    )
    .join("");
  let newFilmOverflow = overflowNote(
    newFilmDetails.length,
    detailTotal("newFilmDetails"),
    ui("Showing {shown} of {total} new films.", {
      shown: newFilmDetails.length,
      total: detailTotal("newFilmDetails"),
    }),
  );
  let rankChangeRows = rankChanges
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Import"))}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.before ?? "")} → ${importReportEscape(entry.after ?? "")}</td>
  </tr>`,
    )
    .join("");
  let rankChangeOverflow = overflowNote(
    rankChanges.length,
    detailTotal("rankChanges"),
    ui("Showing {shown} of {total} rank changes.", {
      shown: rankChanges.length,
      total: detailTotal("rankChanges"),
    }),
  );
  let awardChangeRows = awardChanges
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Import"))}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.category || "")}</td>
    <td>${importReportEscape(entry.placement || "")}</td>
  </tr>`,
    )
    .join("");
  let awardChangeOverflow = overflowNote(
    awardChanges.length,
    detailTotal("awardChanges"),
    ui("Showing {shown} of {total} awards added to existing films.", {
      shown: awardChanges.length,
      total: detailTotal("awardChanges"),
    }),
  );
  let preservedFieldRows = preservedFieldDetails
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Import"))}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.field || "")}</td>
    <td>${importReportEscape(entry.local || "")}</td>
    <td>${importReportEscape(entry.incoming || "")}</td>
  </tr>`,
    )
    .join("");
  let preservedFieldOverflow = overflowNote(
    preservedFieldDetails.length,
    detailTotal("preservedFieldDetails"),
    ui("Showing {shown} of {total} preserved local values.", {
      shown: preservedFieldDetails.length,
      total: detailTotal("preservedFieldDetails"),
    }),
  );
  let sourceConflictRows = sourceConflicts
    .map(
      (conflict) => `<tr>
    <td>${importReportEscape(conflict.source || ui("Import"))}</td>
    <td>${importReportEscape(conflict.rowNumber || "")}</td>
    <td>${importReportEscape(conflict.title || "")}</td>
    <td>${importReportEscape(conflict.year || "")}</td>
    <td>${importReportEscape(conflict.field || "")}</td>
    <td>${importReportEscape(conflict.existing ?? "")}</td>
    <td>${importReportEscape(conflict.incoming ?? "")}</td>
    <td>${importReportEscape(conflict.kept === "incoming" ? ui("Incoming") : ui("Existing"))}</td>
  </tr>`,
    )
    .join("");
  let sourceConflictOverflow = overflowNote(
    sourceConflicts.length,
    detailTotal("sourceConflicts"),
    ui("Showing {shown} of {total} cross-source conflicts.", {
      shown: sourceConflicts.length,
      total: detailTotal("sourceConflicts"),
    }),
  );
  let officialResultIssueRows = officialResultIssues
    .map(
      (issue) => `<tr>
    <td>${importReportEscape(issue.period || "")}</td>
    <td>${importReportEscape(issue.category || "")}</td>
    <td>${importReportEscape(issue.title || "")}</td>
    <td>${importReportEscape(issue.message || "")}</td>
  </tr>`,
    )
    .join("");
  let officialSummary = report.officialResultsSummary;
  let consistencyChecks = report.consistencyChecks || report.consistency || [];
  let consistencyMissing = consistencyChecks
    .filter((check) => check.missingCount > 0)
    .slice(0, 25);
  let consistencyRows = consistencyMissing
    .map(
      (check) => `<tr>
    <td>${importReportEscape(check.source || ui("Import"))}</td>
    <td>${importReportEscape(ui(check.label || check.field || ""))}</td>
    <td>${check.sourceCount || 0}</td>
    <td>${check.missingCount || 0}</td>
    <td>${importReportEscape((check.samples || []).map((sample) => `${sample.title}${sample.year ? ` (${sample.year})` : ""} · ${ui("row")} ${sample.rowNumber}`).join(", "))}</td>
  </tr>`,
    )
    .join("");
  let consistencyNote =
    consistencyChecks.length && !consistencyMissing.length
      ? `<p class="import-report-note">${importReportEscape(ui("All checked source-row fields are present after import."))}</p>`
      : "";
  let franchiseRows = franchiseSummaries
    .map(
      (summary) => `<tr>
    <td><strong>${importReportEscape(summary.source || ui("Franchises"))}</strong>${summary.range ? `<span class="leaderboard-meta">${importReportEscape(summary.range)}</span>` : ""}</td>
    <td>${summary.lanes || 0}</td>
    <td>${summary.headers || 0}</td>
    <td>${summary.withYear || 0} / ${summary.withoutYear || 0}</td>
    <td>${summary.rated || 0} / ${summary.tiered || 0} / ${summary.untiered || 0}</td>
    <td>${summary.archiveMatched || 0}</td>
    <td>${summary.archiveUpdated || 0}</td>
    <td>${summary.watchlistMerged || 0}</td>
    <td>${summary.watchlistAdded || 0}</td>
    <td>${summary.duplicateWatchlistRemoved || 0}</td>
    <td>${summary.watchedOtherAdded || 0} / ${summary.watchedOtherMerged || 0}</td>
  </tr>`,
    )
    .join("");
  let franchiseUnmatchedRows = franchiseSummaries
    .flatMap((summary) =>
      (summary.unmatchedRated || []).map((entry) =>
        Object.assign({ source: summary.source || ui("Franchises") }, entry),
      ),
    )
    .slice(0, 25)
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Franchises"))}</td>
    <td>${importReportEscape(entry.rowNumber || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.franchise || "")}</td>
  </tr>`,
    )
    .join("");
  let franchiseUntieredRows = franchiseSummaries
    .flatMap((summary) =>
      (summary.untieredRows || []).map((entry) =>
        Object.assign({ source: summary.source || ui("Franchises") }, entry),
      ),
    )
    .slice(0, 25)
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Franchises"))}</td>
    <td>${importReportEscape(entry.rowNumber || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.franchise || "")}</td>
  </tr>`,
    )
    .join("");
  let franchiseAmbiguousRows = franchiseSummaries
    .flatMap((summary) =>
      (summary.ambiguousWatchlist || []).map((entry) =>
        Object.assign({ source: summary.source || ui("Franchises") }, entry),
      ),
    )
    .slice(0, 25)
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Franchises"))}</td>
    <td>${importReportEscape(entry.rowNumber || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.franchise || "")}</td>
  </tr>`,
    )
    .join("");
  let directorRows = directorSummaries
    .map(
      (summary) => `<tr>
    <td><strong>${importReportEscape(summary.source || ui("Directors"))}</strong>${summary.range ? `<span class="leaderboard-meta">${importReportEscape(summary.range)}</span>` : ""}</td>
    <td>${summary.lanes || 0}</td>
    <td>${summary.headers || 0}</td>
    <td>${summary.withYear || 0} / ${summary.withoutYear || 0}</td>
    <td>${summary.rated || 0} / ${summary.tiered || 0} / ${summary.untiered || 0}</td>
    <td>${summary.archiveMatched || 0}</td>
    <td>${summary.watchlistMerged || 0}</td>
    <td>${summary.watchlistAdded || 0}</td>
    <td>${summary.duplicateWatchlistRemoved || 0}</td>
    <td>${summary.watchedOtherAdded || 0} / ${summary.watchedOtherMerged || 0}</td>
  </tr>`,
    )
    .join("");
  let directorUntieredRows = directorSummaries
    .flatMap((summary) =>
      (summary.untieredRows || []).map((entry) =>
        Object.assign({ source: summary.source || ui("Directors") }, entry),
      ),
    )
    .slice(0, 25)
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Directors"))}</td>
    <td>${importReportEscape(entry.rowNumber || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.director || "")}</td>
  </tr>`,
    )
    .join("");
  let directorUnmatchedRows = directorSummaries
    .flatMap((summary) =>
      (summary.unmatchedRated || []).map((entry) =>
        Object.assign({ source: summary.source || ui("Directors") }, entry),
      ),
    )
    .slice(0, 25)
    .map(
      (entry) => `<tr>
    <td>${importReportEscape(entry.source || ui("Directors"))}</td>
    <td>${importReportEscape(entry.rowNumber || "")}</td>
    <td>${importReportEscape(entry.title || "")}</td>
    <td>${importReportEscape(entry.year || "")}</td>
    <td>${importReportEscape(entry.director || "")}</td>
  </tr>`,
    )
    .join("");
  let variants = (report.titleVariants || [])
    .slice(0, 10)
    .map(
      (variant) =>
        `<li>${importReportEscape(variant.imported)} → ${importReportEscape(variant.matched)}</li>`,
    )
    .join("");

  body.innerHTML = `
    <div class="import-report-stats">
      <span><b>${report.filmsParsed || 0}</b> ${importReportEscape(ui("parsed"))}</span>
      <span><b>${report.filmsAdded || 0}</b> ${importReportEscape(ui("added"))}</span>
      <span><b>${report.filmsMerged || 0}</b> ${importReportEscape(ui("merged"))}</span>
      <span><b>${report.awardsAdded || 0}</b> ${importReportEscape(ui("awards added"))}</span>
      <span><b>${report.awardsRejected || 0}</b> ${importReportEscape(ui("awards rejected"))}</span>
      <span><b>${report.skipped || 0}</b> ${importReportEscape(ui("skipped"))}</span>
    </div>
    <div class="import-report-meta"><b>${importReportEscape(ui("Source:"))}</b> ${importReportEscape(report.source || ui("Import"))} · <b>${importReportEscape(ui("Periods:"))}</b> ${importReportEscape(formatPeriodSummary(report.periods))}${generatedLabel ? ` · <b>${importReportEscape(ui("Run:"))}</b> ${importReportEscape(generatedLabel)}` : ""}</div>
    ${proposalChangeRows ? `<div class="import-report-proposal-changes"><b>${importReportEscape(ui("Canonical proposal changes"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-proposal-change-summary"><thead><tr><th>${importReportEscape(ui("Section"))}</th><th>${importReportEscape(ui("Changed records"))}</th><th>${importReportEscape(ui("Before"))}</th><th>${importReportEscape(ui("After"))}</th></tr></thead><tbody>${proposalChangeRows}</tbody></table></div></div>` : ""}
    ${letterboxdSummary ? `<div class="import-report-letterboxd-summary"><b>${importReportEscape(ui("Letterboxd jumpstart"))}</b><p>${letterboxdSummary.watchedArchiveMerged || 0} archive film(s) matched · ${letterboxdSummary.watchedOtherAdded || 0} standalone watched film(s) added · ${letterboxdSummary.watchedOtherMerged || 0} standalone watched film(s) merged · ${letterboxdSummary.watchlistAdded || 0} watchlist item(s) added · ${letterboxdSummary.watchlistMerged || 0} watchlist item(s) merged · ${letterboxdSummary.watchlistRemoved || 0} watched watchlist item(s) removed</p><p class="import-report-note">${importReportEscape(ui("Awards and rankings are not part of this import."))}</p></div>` : ""}
    ${officialSummary ? `<div class="import-report-official-summary"><b>${importReportEscape(ui("Official results"))}</b><p>${officialSummary.refreshedPeriods || 0} period(s) · ${officialSummary.nominations || 0} nomination(s) · ${officialSummary.winners || 0} winner(s) · ${officialSummary.matched || 0} canonical match(es) · ${officialSummary.unmatched || 0} unmatched${officialSummary.skippedRows ? ` · ${officialSummary.skippedRows} out-of-scope or unusable row(s) skipped` : ""}</p>${officialSummary.skippedCategories?.length ? `<p class="import-report-note">${importReportEscape(ui("Skipped source categories"))}: ${importReportEscape(officialSummary.skippedCategories.map((entry) => `${entry.category} (${entry.count})`).join(" · "))}</p>` : ""}</div>` : ""}
    ${rangeRows ? `<div class="import-report-ranges"><b>${importReportEscape(ui("Ranges"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-range-summary"><thead><tr><th>${importReportEscape(ui("Range"))}</th><th>${importReportEscape(ui("Rows"))}</th><th>${importReportEscape(ui("Films"))}</th><th>${importReportEscape(ui("Awards"))}</th><th>${importReportEscape(ui("Skipped"))}</th><th>${importReportEscape(ui("Periods"))}</th></tr></thead><tbody>${rangeRows}</tbody></table></div></div>` : ""}
    ${warnings ? `<div class="import-report-warnings import-report-attention-item"><b>${importReportEscape(ui("Warnings"))}</b><ul>${warnings}</ul></div>` : ""}
    ${informationalWarnings ? `<div class="import-report-information"><b>${importReportEscape(ui("Import notes"))}</b><ul>${informationalWarnings}</ul></div>` : ""}
    ${restoredSectionRows ? `<div class="import-report-restored"><b>${importReportEscape(ui("Restored from backup"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-restored-summary"><thead><tr><th>${importReportEscape(ui("Section"))}</th><th>${importReportEscape(ui("In backup"))}</th><th>${importReportEscape(ui("Local before"))}</th></tr></thead><tbody>${restoredSectionRows}</tbody></table></div></div>` : ""}
    ${ignoredSectionsNote ? `<div class="import-report-ignored import-report-attention-item"><b>${importReportEscape(ui("Kept local data"))}</b>${ignoredSectionsNote}</div>` : ""}
    ${newFilmRows ? `<div class="import-report-new-films"><b>${importReportEscape(ui("New films"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-new-films-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Rank"))}</th><th>${importReportEscape(ui("Film"))}</th></tr></thead><tbody>${newFilmRows}</tbody></table></div>${newFilmOverflow}</div>` : ""}
    ${rankChangeRows ? `<div class="import-report-rank-changes"><b>${importReportEscape(ui("Rank changes"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-rank-changes-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Rank"))}</th></tr></thead><tbody>${rankChangeRows}</tbody></table></div>${rankChangeOverflow}</div>` : ""}
    ${awardChangeRows ? `<div class="import-report-award-changes"><b>${importReportEscape(ui("Awards added to existing films"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-award-changes-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Category"))}</th><th>${importReportEscape(ui("Placement"))}</th></tr></thead><tbody>${awardChangeRows}</tbody></table></div>${awardChangeOverflow}</div>` : ""}
    ${preservedFieldRows ? `<div class="import-report-preserved-fields import-report-attention-item"><b>${importReportEscape(ui("Local values kept over a differing import value"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-preserved-fields-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Field"))}</th><th>${importReportEscape(ui("Kept (local)"))}</th><th>${importReportEscape(ui("Ignored (incoming)"))}</th></tr></thead><tbody>${preservedFieldRows}</tbody></table></div>${preservedFieldOverflow}</div>` : ""}
    ${sourceConflictRows ? `<div class="import-report-source-conflicts import-report-attention-item"><b>${importReportEscape(ui("Cross-source rating and interest conflicts"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-source-conflicts-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Field"))}</th><th>${importReportEscape(ui("Existing"))}</th><th>${importReportEscape(ui("Incoming"))}</th><th>${importReportEscape(ui("Kept"))}</th></tr></thead><tbody>${sourceConflictRows}</tbody></table></div>${sourceConflictOverflow}</div>` : ""}
    ${officialResultIssueRows ? `<div class="import-report-official-issues import-report-attention-item"><b>${importReportEscape(ui("Official-results findings"))}</b><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${importReportEscape(ui("Period"))}</th><th>${importReportEscape(ui("Category"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Finding"))}</th></tr></thead><tbody>${officialResultIssueRows}</tbody></table></div></div>` : ""}
    ${consistencyChecks.length ? `<div class="import-report-consistency${consistencyRows ? " import-report-attention-item" : ""}"><b>${importReportEscape(ui("Import consistency"))}</b>${consistencyRows ? `<div class="leaderboard-wrap"><table class="leaderboard import-consistency-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Field"))}</th><th>${importReportEscape(ui("In sheet"))}</th><th>${importReportEscape(ui("Missing after import"))}</th><th>${importReportEscape(ui("Sample rows"))}</th></tr></thead><tbody>${consistencyRows}</tbody></table></div>` : ""}${consistencyNote}</div>` : ""}
    ${franchiseRows ? `<div class="import-report-franchises"><b>${importReportEscape(ui("Franchise sheet"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-franchise-summary"><thead><tr><th>${importReportEscape(ui("Range"))}</th><th>${importReportEscape(ui("Lanes"))}</th><th>${importReportEscape(ui("Headers"))}</th><th>${importReportEscape(ui("With / without year"))}</th><th>${importReportEscape(ui("Rated / tiered / untiered"))}</th><th>${importReportEscape(ui("Archive matches"))}</th><th>${importReportEscape(ui("Archive updates"))}</th><th>${importReportEscape(ui("Watchlist merges"))}</th><th>${importReportEscape(ui("Watchlist adds"))}</th><th>${importReportEscape(ui("Duplicates removed"))}</th><th>${importReportEscape(ui("Watched (other) added / merged"))}</th></tr></thead><tbody>${franchiseRows}</tbody></table></div></div>` : ""}
    ${franchiseUntieredRows ? `<div class="import-report-franchise-untiered import-report-attention-item"><b>${importReportEscape(ui("Franchise rows without recognized rating or tier"))}</b><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Franchise"))}</th></tr></thead><tbody>${franchiseUntieredRows}</tbody></table></div></div>` : ""}
    ${franchiseUnmatchedRows ? `<div class="import-report-franchise-unmatched import-report-attention-item"><b>${importReportEscape(ui("Rated franchise rows stored as watched (unmatched in archive)"))}</b><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Franchise"))}</th></tr></thead><tbody>${franchiseUnmatchedRows}</tbody></table></div></div>` : ""}
    ${franchiseAmbiguousRows ? `<div class="import-report-franchise-ambiguous import-report-attention-item"><b>${importReportEscape(ui("Ambiguous no-year franchise rows"))}</b><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Franchise"))}</th></tr></thead><tbody>${franchiseAmbiguousRows}</tbody></table></div></div>` : ""}
    ${directorRows ? `<div class="import-report-directors"><b>${importReportEscape(ui("Directors sheet"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-director-summary"><thead><tr><th>${importReportEscape(ui("Range"))}</th><th>${importReportEscape(ui("Lanes"))}</th><th>${importReportEscape(ui("Headers"))}</th><th>${importReportEscape(ui("With / without year"))}</th><th>${importReportEscape(ui("Rated / tiered / untiered"))}</th><th>${importReportEscape(ui("Already watched"))}</th><th>${importReportEscape(ui("Watchlist merges"))}</th><th>${importReportEscape(ui("Watchlist adds"))}</th><th>${importReportEscape(ui("Duplicates removed"))}</th><th>${importReportEscape(ui("Watched (other) added / merged"))}</th></tr></thead><tbody>${directorRows}</tbody></table></div></div>` : ""}
    ${directorUntieredRows ? `<div class="import-report-director-untiered import-report-attention-item"><b>${importReportEscape(ui("Directors rows without recognized tier"))}</b><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Director"))}</th></tr></thead><tbody>${directorUntieredRows}</tbody></table></div></div>` : ""}
    ${directorUnmatchedRows ? `<div class="import-report-director-unmatched import-report-attention-item"><b>${importReportEscape(ui("Rated director rows stored as watched (unmatched in archive)"))}</b><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Film"))}</th><th>${importReportEscape(ui("Year"))}</th><th>${importReportEscape(ui("Director"))}</th></tr></thead><tbody>${directorUnmatchedRows}</tbody></table></div></div>` : ""}
    ${missingAllTimeRows ? `<div class="import-report-missing-alltime import-report-attention-item"><b>${importReportEscape(ui("Bracket films missing from all-time ranked list"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-missing-alltime-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Period"))}</th><th>${importReportEscape(ui("Rank"))}</th><th>${importReportEscape(ui("Film"))}</th></tr></thead><tbody>${missingAllTimeRows}</tbody></table></div>${missingAllTimeOverflow}</div>` : ""}
    ${eligibilityRows ? `<div class="import-report-eligibility import-report-attention-item"><b>${importReportEscape(ui("Eligibility checks"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-eligibility-summary"><thead><tr><th>${importReportEscape(ui("Count"))}</th><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Category"))}</th><th>${importReportEscape(ui("Issue"))}</th><th>${importReportEscape(ui("Sample films"))}</th><th>${importReportEscape(ui("Sample periods"))}</th></tr></thead><tbody>${eligibilityRows}</tbody></table></div>${eligibilityOverflow}</div>` : ""}
    ${skippedRows ? `<div class="import-report-skipped import-report-attention-item"><b>${importReportEscape(ui("Skipped rows"))}</b><div class="leaderboard-wrap"><table class="leaderboard import-skipped-summary"><thead><tr><th>${importReportEscape(ui("Source"))}</th><th>${importReportEscape(ui("Row"))}</th><th>${importReportEscape(ui("Reason"))}</th><th>${importReportEscape(ui("Values"))}</th></tr></thead><tbody>${skippedRows}</tbody></table></div>${skippedOverflow}</div>` : ""}
    ${
      (report.ruleViolations || []).length
        ? `<div class="import-report-rule-violations import-report-attention-item"><b>${importReportEscape(ui("Rule violations"))}</b><ul>${report.ruleViolations
            .slice(0, 10)
            .map(
              (violation) =>
                `<li>${importReportEscape(violation.film)} · ${importReportEscape(violation.category)}: ${importReportEscape(violation.message)}</li>`,
            )
            .join("")}</ul></div>`
        : ""
    }
    ${variants ? `<div class="import-report-title-variants"><b>${importReportEscape(ui("Title variants resolved"))}</b><ul>${variants}</ul></div>` : ""}`;
  organizeImportReport(body);
  let unratedCount = report.preview
    ? 0
    : [...(window.unratedWatchedFilmsByYear?.().values() || [])].reduce(
        (sum, films) => sum + films.length,
        0,
      );
  if (unratedCount)
    body.insertAdjacentHTML(
      "beforeend",
      `<section class="import-journey-handoff"><div><span class="eyebrow">${importReportEscape(ui("Your creative journey"))}</span><h3>${importReportEscape(ui("Your archive is ready to make yours"))}</h3><p>${importReportEscape(ui("{count} watched work(s) need your personal rating. Import diagnostics can wait while you start with the films.", { count: unratedCount }))}</p></div><a class="button-link" href="build.html">${importReportEscape(ui("Start building your Oskars"))} →</a></section>`,
    );
  panel.hidden = false;
  finishRenderTimer?.(
    `${report.filmsParsed || 0} parsed, ${body.querySelectorAll("table").length} table(s)`,
  );
};

/** Hides the import report panel when present. */
window.hideImportReport = function () {
  let panel = document.getElementById("importReport");
  if (panel) panel.hidden = true;
};
