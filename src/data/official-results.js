/** @file Builds isolated, previewed official-results refresh proposals from bracket-shaped, historical long-form, or categoryless single-winner exports. */

const OFFICIAL_LONG_FORM_CATEGORIES = [
  [/^BEST PICTURE$/, "Best Picture"],
  [/^DIRECTING(?: \(|$)/, "Best Director"],
  [/^CINEMATOGRAPHY(?: \(|$)/, "Best Cinematography"],
  [/^WRITING \(Original Screenplay\)$/, "Best Original Screenplay"],
  [/^WRITING \(Adapted Screenplay\)$/, "Best Adapted Screenplay"],
  [/^ACTOR IN A LEADING ROLE$/, "Best Lead Actor"],
  [/^ACTRESS IN A LEADING ROLE$/, "Best Lead Actress"],
  [/^ACTOR IN A SUPPORTING ROLE$/, "Best Supporting Actor"],
  [/^ACTRESS IN A SUPPORTING ROLE$/, "Best Supporting Actress"],
  [/^INTERNATIONAL FEATURE FILM$/, "Best International Picture"],
  [/^ANIMATED FEATURE FILM$/, "Best Animated Picture"],
  [/^MUSIC \(Original Score\)$/, "Best Score"],
  [/^MUSIC \(Original Song Score or Adaptation Score\)$/, "Best Score"],
  [/^MUSIC \(Original Song\)$/, "Best Song"],
  [/^CASTING$/, "Best Casting"],
  [/^FILM EDITING$/, "Best Editing"],
  [/^VISUAL EFFECTS$/, "Best Visual Effects"],
  [/^ART DIRECTION(?: \(|$)/, "Best Production Design"],
  [/^COSTUME DESIGN(?: \(|$)/, "Best Costume Design"],
];

function officialLongFormCategory(sourceCategory) {
  let match = OFFICIAL_LONG_FORM_CATEGORIES.find(([pattern]) =>
    pattern.test(sourceCategory),
  );
  return match ? match[1] : "";
}

function officialCleanCell(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function officialLongFormInput(rows) {
  let headers = (rows[0] || []).map(officialCleanCell);
  return ["Year", "CanonicalCategory", "Film", "Winner"].every((header) =>
    headers.includes(header),
  );
}

function officialParseLongForm(rows, report, blockError) {
  let headers = (rows[0] || []).map(officialCleanCell);
  let column = Object.fromEntries(headers.map((header, index) => [header, index]));
  let required = ["Ceremony", "Year", "CanonicalCategory", "Film", "Winner"];
  let missing = required.filter((header) => column[header] === undefined);
  if (column.Nominees === undefined && column.Name === undefined)
    missing.push("Nominees or Name");
  if (missing.length) {
    let message = `Long-form header is missing: ${missing.join(", ")}.`;
    officialResultsIssue(report, { message });
    blockError("$officialResults.headers", message);
    return [];
  }

  let periods = new Map();
  let skippedCategories = new Map();
  let duplicateKeys = new Map();
  rows.slice(1).forEach((row, offset) => {
    if (!row.some((cell) => officialCleanCell(cell))) return;
    let rowNumber = offset + 2;
    let value = (header) => officialCleanCell(row[column[header]]);
    let year = value("Year");
    let ceremony = value("Ceremony");
    let sourceCategory = value("CanonicalCategory");
    let category = officialLongFormCategory(sourceCategory);
    let winnerCell = value("Winner").toLowerCase();
    if (!/^\d{4}(?:\/\d{2})?$/.test(year) || !ceremony || !sourceCategory) {
      let message = "Row is missing a valid ceremony, year, or canonical category.";
      report.skipped += 1;
      report.skippedDetails.push({
        source: report.source,
        rowNumber,
        reason: message,
        values: [ceremony, year, sourceCategory],
      });
      blockError(`$officialResults.rows[${rowNumber}]`, message);
      return;
    }
    if (!category) {
      skippedCategories.set(
        sourceCategory,
        (skippedCategories.get(sourceCategory) || 0) + 1,
      );
      report.skipped += 1;
      return;
    }
    if (!["", "true", "false"].includes(winnerCell)) {
      let message = `Winner must be True, False, or blank; received ${value("Winner")}.`;
      report.skipped += 1;
      report.skippedDetails.push({
        source: report.source,
        rowNumber,
        reason: message,
        values: [year, sourceCategory, value("Film")],
      });
      officialResultsIssue(report, { period: year, category, message });
      blockError(`$officialResults.rows[${rowNumber}].Winner`, message);
      return;
    }
    let sourceTitle = value("Film")
      .split("|")
      .map(officialCleanCell)
      .filter(Boolean)
      .join(" | ");
    if (!sourceTitle) {
      report.skipped += 1;
      report.skippedDetails.push({
        source: report.source,
        rowNumber,
        reason: "Mapped award has no film title.",
        values: [year, sourceCategory],
      });
      return;
    }
    let period = periods.get(year);
    if (!period) {
      period = { year, ceremony, periodType: "years", sourceUrl: "", nominations: [] };
      periods.set(year, period);
    } else if (period.ceremony !== ceremony) {
      let message = `Period ${year} has conflicting ceremony values.`;
      officialResultsIssue(report, { period: year, message });
      blockError(`$officialResults.rows[${rowNumber}].Ceremony`, message);
      return;
    }
    let recipient = value("Nominees") || value("Name");
    let detail = value("Detail");
    let nomination = {
      category,
      sourceCategory,
      winner: winnerCell === "true",
      sourceTitle,
      ...(recipient ? { recipient } : {}),
      ...(detail ? { detail } : {}),
    };
    let duplicateKey = [year, category, sourceCategory, sourceTitle, recipient, detail]
      .map((part) => part.toLowerCase())
      .join("\u001f");
    if (duplicateKeys.has(duplicateKey)) {
      let message = `Duplicate nomination (also row ${duplicateKeys.get(duplicateKey)}).`;
      officialResultsIssue(report, { period: year, category, title: sourceTitle, message });
      blockError(`$officialResults.rows[${rowNumber}]`, message);
      return;
    }
    duplicateKeys.set(duplicateKey, rowNumber);
    period.nominations.push(nomination);
  });

  report.officialResultsSummary.skippedRows = report.skipped;
  report.officialResultsSummary.skippedCategories = [...skippedCategories]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
  periods.forEach((period) => {
    let categories = new Set(period.nominations.map((entry) => entry.category));
    categories.forEach((category) => {
      if (!period.nominations.some((entry) => entry.category === category && entry.winner)) {
        let message = "Category has nominees but no official winner.";
        officialResultsIssue(report, { period: period.year, category, message });
        blockError(`$officialResults.periods.${period.year}.winners`, `${category}: ${message}`);
      }
    });
    period.nominations.sort((a, b) =>
      a.category.localeCompare(b.category) ||
      a.sourceCategory.localeCompare(b.sourceCategory) ||
      Number(b.winner) - Number(a.winner) ||
      a.sourceTitle.localeCompare(b.sourceTitle) ||
      String(a.recipient || "").localeCompare(String(b.recipient || "")) ||
      String(a.detail || "").localeCompare(String(b.detail || "")),
    );
  });
  return [...periods.values()].sort((a, b) => a.year.localeCompare(b.year));
}

function officialSingleWinnerInput(rows) {
  let headers = (rows[0] || []).map(officialCleanCell);
  return ["Year", "Film", "SourceCategory"].every((header) =>
    headers.includes(header),
  );
}

// For a categoryless canon (one winner per year, no competing categories -
// Cannes' top prize, for example): every row already *is* the winner, so
// there's no Winner/CanonicalCategory-mapping work the long-form parser
// needs. Every parsed nomination shares one constant `category` (passed in,
// not hardcoded here, so this shape stays reusable for a future canon) so
// unwatched-winner tracking groups them as one collection even when the
// source's own award name changed over time (e.g. Cannes' "Grand Prix"
// years before "Palme d'Or") - that history is retained in `sourceCategory`
// instead, the same field the long-form parser uses for the same purpose.
// A year can hold more than one winner (Cannes 1946 alone had nine), so
// periods accumulate nominations rather than rejecting a repeated year.
function officialParseSingleWinner(rows, report, blockError, category) {
  let headers = (rows[0] || []).map(officialCleanCell);
  let column = Object.fromEntries(headers.map((header, index) => [header, index]));
  let required = ["Year", "Film", "Director", "Country", "SourceCategory"];
  let missing = required.filter((header) => column[header] === undefined);
  if (missing.length) {
    let message = `Single-winner header is missing: ${missing.join(", ")}.`;
    officialResultsIssue(report, { message });
    blockError("$officialResults.headers", message);
    return [];
  }

  let periods = new Map();
  let duplicateKeys = new Map();
  rows.slice(1).forEach((row, offset) => {
    if (!row.some((cell) => officialCleanCell(cell))) return;
    let rowNumber = offset + 2;
    let value = (header) => officialCleanCell(row[column[header]]);
    let year = value("Year");
    let sourceCategory = value("SourceCategory");
    let sourceTitle = value("Film");
    if (!/^\d{4}(?:\/\d{2})?$/.test(year) || !sourceCategory || !sourceTitle) {
      let message = "Row is missing a valid year, film title, or source category.";
      report.skipped += 1;
      report.skippedDetails.push({
        source: report.source,
        rowNumber,
        reason: message,
        values: [year, sourceCategory, sourceTitle],
      });
      blockError(`$officialResults.rows[${rowNumber}]`, message);
      return;
    }
    let recipient = value("Director");
    let country = value("Country");
    let originalTitle = column.OriginalTitle !== undefined ? value("OriginalTitle") : "";
    let nomination = {
      category,
      sourceCategory,
      winner: true,
      sourceTitle,
      ...(recipient ? { recipient } : {}),
      ...(country ? { country } : {}),
      ...(originalTitle ? { originalTitle } : {}),
    };
    let duplicateKey = [year, sourceTitle]
      .map((part) => part.toLowerCase())
      .join("");
    if (duplicateKeys.has(duplicateKey)) {
      let message = `Duplicate nomination (also row ${duplicateKeys.get(duplicateKey)}).`;
      officialResultsIssue(report, { period: year, title: sourceTitle, message });
      blockError(`$officialResults.rows[${rowNumber}]`, message);
      return;
    }
    duplicateKeys.set(duplicateKey, rowNumber);
    let period = periods.get(year);
    if (!period) {
      period = { year, periodType: "years", sourceUrl: "", nominations: [] };
      periods.set(year, period);
    }
    period.nominations.push(nomination);
  });

  periods.forEach((period) => {
    period.nominations.sort(
      (a, b) =>
        a.sourceTitle.localeCompare(b.sourceTitle) ||
        String(a.recipient || "").localeCompare(String(b.recipient || "")),
    );
  });
  return [...periods.values()].sort((a, b) => a.year.localeCompare(b.year));
}

function officialResultsFilmCandidates(source) {
  let byId = new Map();
  Object.values(source.years || {}).forEach((period) => {
    (period.films || []).forEach((film) => {
      if (film?.id && !byId.has(film.id)) byId.set(film.id, film);
    });
  });
  (source.watchedFilms || source.watchedOther || []).forEach((film) => {
    if (film?.id && !byId.has(film.id)) byId.set(film.id, film);
  });
  return [...byId.values()];
}

function officialResultsFilmMatch(candidates, sourceTitle, periodKey) {
  let normalized = window.normalizeTitle(sourceTitle);
  let representedYears = new Set(window.officialResultPeriodYears(periodKey));
  let matches = candidates.filter(
    (film) =>
      window.normalizeTitle(film.normalizedTitle || film.title) === normalized &&
      representedYears.has(String(film.year || "")),
  );
  return matches.length === 1
    ? { film: matches[0], ambiguous: false }
    : { film: null, ambiguous: matches.length > 1 };
}

function officialNominationId(nomination) {
  return `official:${window.canonicalDataRevision({
    category: nomination.category,
    detail: nomination.detail || "",
    recipient: nomination.recipient || "",
    sourceCategory: nomination.sourceCategory || "",
    sourceTitle: window.normalizeTitle(nomination.sourceTitle),
  })}`;
}

function officialResultsIssue(report, finding) {
  if (report.officialResultIssues.length < 100)
    report.officialResultIssues.push(finding);
  if (report.warnings.length < 100)
    report.warnings.push(
      [finding.period, finding.category, finding.title, finding.message]
        .filter(Boolean)
        .join(" · "),
    );
}

/**
 * Builds a non-mutating refresh proposal for one official awards source.
 * @param {string} raw Bracket-shaped, historical long-form, or categoryless single-winner TSV/CSV export.
 * @param {Object} [options] Source identity and display configuration.
 * @param {string} [options.sourceId] Stable source id, defaults to "academy-awards".
 * @param {string} [options.sourceName] Display name, defaults to "Academy Awards".
 * @param {string} [options.singleWinnerCategory] App category name every row shares in single-winner input (defaults to `sourceName`); ignored for the other two input shapes.
 * @returns {ImportProposal} Reviewed canonical refresh proposal.
 */
window.proposeOfficialResultsImport = function (raw, options = {}) {
  let sourceId = String(options.sourceId || "academy-awards").trim();
  let sourceName = String(options.sourceName || "Academy Awards").trim();
  let baseState = window.cloneRecord(window.state);
  let candidateState = window.cloneRecord(baseState);
  let rows = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.split("\t"));
  let candidates = officialResultsFilmCandidates(baseState);
  let report = {
    source: `${sourceName} official results`,
    filmsParsed: 0,
    filmsAdded: 0,
    filmsMerged: 0,
    awardsAdded: 0,
    awardsRejected: 0,
    skipped: 0,
    periods: [],
    warnings: [],
    titleVariants: [],
    ruleViolations: [],
    skippedDetails: [],
    newFilmDetails: [],
    rankChanges: [],
    awardChanges: [],
    preservedFieldDetails: [],
    sourceConflicts: [],
    officialResultIssues: [],
    officialResultsSummary: {
      nominations: 0,
      winners: 0,
      matched: 0,
      unmatched: 0,
      refreshedPeriods: 0,
      skippedRows: 0,
      skippedCategories: [],
    },
  };
  let validationErrors = [];
  let refreshedPeriods = {};

  function blockError(path, message) {
    validationErrors.push({ path, message });
  }

  let parsedPeriods = [];
  if (officialLongFormInput(rows)) {
    parsedPeriods = officialParseLongForm(rows, report, blockError);
  } else if (officialSingleWinnerInput(rows)) {
    let category = String(options.singleWinnerCategory || options.sourceName || "Winner").trim();
    parsedPeriods = officialParseSingleWinner(rows, report, blockError, category);
  } else {
    let blocks = window.splitBracketSheetBlocks(rows, { sheetStartRow: 1 });
    if (!blocks.length) {
      let message = "No official-results period blocks were found.";
      officialResultsIssue(report, { message });
      blockError("$officialResults.blocks", message);
    }
    blocks.forEach((block, blockIndex) => {
      let parsed = window.parseOfficialResultsTable(block.raw || "", {
        rows: block.rows,
      });
      let blockPath = `$officialResults.blocks[${blockIndex}]`;
      if (!parsed || !parsed.year) {
        report.skipped += 1;
        let message = "Bracket block could not be parsed.";
        report.skippedDetails.push({
          source: report.source,
          rowNumber: block.rowNumber || "",
          reason: message,
          values: [block.label || `Block ${blockIndex + 1}`],
        });
        officialResultsIssue(report, { message });
        blockError(blockPath, message);
        return;
      }
      if (refreshedPeriods[parsed.year]) {
        let message = `Period ${parsed.year} appears more than once.`;
        officialResultsIssue(report, { period: parsed.year, message });
        blockError(`${blockPath}.period`, message);
        return;
      }
      let diagnostics = parsed.diagnostics || {};
      (diagnostics.unsupportedHeaders || []).forEach((header) => {
        let message = `Unsupported header: ${header}`;
        officialResultsIssue(report, { period: parsed.year, message });
        blockError(`${blockPath}.headers`, message);
      });
      (diagnostics.malformedRows || []).forEach((finding) => {
        officialResultsIssue(report, {
          period: parsed.year,
          message: finding.reason,
        });
        blockError(`${blockPath}.rows`, finding.reason);
      });
      (diagnostics.missingWinners || []).forEach((finding) => {
        let message = "Category has nominees but no position-1 winner.";
        officialResultsIssue(report, {
          period: parsed.year,
          category: finding.category,
          message,
        });
        blockError(`${blockPath}.winners`, `${finding.category}: ${message}`);
      });
      (diagnostics.multipleWinners || []).forEach((finding) => {
        let message = `Category has multiple position-1 winners: ${finding.titles.join(", ")}.`;
        officialResultsIssue(report, {
          period: parsed.year,
          category: finding.category,
          message,
        });
        blockError(`${blockPath}.winners`, `${finding.category}: ${message}`);
      });
      (diagnostics.duplicateNominations || []).forEach((finding) => {
        let message = "Duplicate nomination.";
        officialResultsIssue(report, {
          period: parsed.year,
          category: finding.category,
          title: finding.title,
          message,
        });
        blockError(`${blockPath}.nominations`, `${finding.category}: ${message}`);
      });

      parsedPeriods.push(parsed);
    });
  }

  parsedPeriods.forEach((parsed) => {
    let nominations = parsed.nominations.map((nomination) => {
      let match = officialResultsFilmMatch(
        candidates,
        nomination.sourceTitle,
        parsed.year,
      );
      let record = {
        id: officialNominationId(nomination),
        category: nomination.category,
        winner: nomination.winner,
        sourceTitle: nomination.sourceTitle,
        ...(nomination.sourceCategory
          ? { sourceCategory: nomination.sourceCategory }
          : {}),
        ...(nomination.recipient ? { recipient: nomination.recipient } : {}),
        ...(nomination.detail ? { detail: nomination.detail } : {}),
        ...(nomination.country ? { country: nomination.country } : {}),
        ...(nomination.originalTitle
          ? { originalTitle: nomination.originalTitle }
          : {}),
      };
      if (match.film) {
        record.filmRef = {
          id: match.film.id,
          title: match.film.title,
          year: String(match.film.year || ""),
        };
        report.filmsMerged += 1;
        report.officialResultsSummary.matched += 1;
      } else {
        report.officialResultsSummary.unmatched += 1;
        officialResultsIssue(report, {
          period: parsed.year,
          category: nomination.category,
          title: nomination.sourceTitle,
          message: match.ambiguous
            ? "Matches multiple canonical films; source title was preserved without a film reference."
            : "No canonical film match; source title was preserved for review.",
        });
      }
      return record;
    });
    refreshedPeriods[parsed.year] = {
      periodType: parsed.periodType,
      sourceUrl: parsed.sourceUrl || "",
      ...(parsed.ceremony ? { ceremony: parsed.ceremony } : {}),
      nominations,
    };
    report.periods.push(parsed.year);
    report.filmsParsed += nominations.length;
    report.awardsAdded += nominations.length;
    report.officialResultsSummary.nominations += nominations.length;
    report.officialResultsSummary.winners += nominations.filter(
      (nomination) => nomination.winner,
    ).length;
    report.officialResultsSummary.refreshedPeriods += 1;
  });

  candidateState.officialResults ||= {};
  let previousSource = candidateState.officialResults[sourceId] || {
    id: sourceId,
    name: sourceName,
    periods: {},
  };
  let periods = {
    ...(previousSource.periods || {}),
    ...refreshedPeriods,
  };
  candidateState.officialResults[sourceId] = {
    id: sourceId,
    name: sourceName,
    sourceRevision: window.canonicalDataRevision(periods),
    periods,
  };

  return window.createImportProposal({
    sourceKind: "official-results",
    mode: "refresh",
    baseState,
    candidateState,
    report,
    sourceRevision: window.canonicalDataRevision(refreshedPeriods),
    sourceConfig: {
      sourceId,
      sourceName,
      sourceNameHint: String(options.fileName || ""),
    },
    recordHistory: false,
    validationErrors,
  });
};
