/**
 * @file Records bounded, sheet-oriented descriptions of user edits and
 * formats them for review and copy-back from the Data page.
 */

function editLogValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value))
    return value.map(editLogValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.url) return String(value.url);
    return JSON.stringify(value);
  }
  return String(value).trim();
}

let EDIT_LOG_TARGET_TYPES = new Set([
  "film",
  "watchlist",
  "nomination",
  "project",
  "alias",
  "note",
  "import",
  "other",
]);

function inferredEditLogTargetType(entry) {
  let type = String(entry?.type || "").toLowerCase();
  let context = entry?.context || {};
  if (type.includes("import")) return "import";
  if (
    type.includes("nomination") ||
    type.includes("award") ||
    type.includes("decade category merge")
  )
    return "nomination";
  if (type.includes("watchlist") || context.watchlistId) return "watchlist";
  if (type.includes("project") || context.projectId) return "project";
  if (type.includes("alias") || context.aliasId) return "alias";
  if (type.includes("note") || context.noteKey) return "note";
  if (type.includes("film") || type.includes("poster") || context.filmId)
    return "film";
  return "other";
}

/**
 * Resolves a stable display target for a saved or newly recorded edit.
 * @param {Object} entry Edit-log-like record.
 * @returns {EditLogTarget} Normalized target.
 */
window.normalizeEditLogTarget = function (entry = {}) {
  let explicit =
    typeof entry.target === "string"
      ? { type: entry.target }
      : entry.target && typeof entry.target === "object"
        ? entry.target
        : {};
  let type = String(explicit.type || "").trim();
  if (!EDIT_LOG_TARGET_TYPES.has(type)) type = inferredEditLogTargetType(entry);
  let context = entry.context || {};
  let contextIdKeyByType = {
    film: "filmId",
    watchlist: "watchlistId",
    project: "projectId",
    alias: "aliasId",
    note: "noteKey",
  };
  let id = String(
    explicit.id || context[contextIdKeyByType[type]] || "",
  ).trim();
  return {
    type: /** @type {EditLogTarget['type']} */ (type),
    id,
    label: String(explicit.label || entry.summary || "").trim(),
  };
};

/**
 * Describes changed fields between two records using normalized display values.
 * @param {Object|null} before Record before editing.
 * @param {Object|null} after Record after editing.
 * @param {Array<string|{key: string, label: string}>} fields Fields to compare.
 * @returns {EditLogChange[]} Changed fields only.
 */
window.editLogChanges = function (before, after, fields) {
  return fields
    .map((field) => {
      let key = typeof field === "string" ? field : field.key;
      let label = typeof field === "string" ? field : field.label || field.key;
      let oldValue = editLogValue(before?.[key]);
      let newValue = editLogValue(after?.[key]);
      return oldValue === newValue
        ? null
        : { field: label, before: oldValue, after: newValue };
    })
    .filter(Boolean);
};

/**
 * Prepends a normalized edit record and enforces the bounded log size.
 * @param {Object} [entry] EditLogEntry fields supplied by the caller.
 * @returns {EditLogEntry} Stored edit record.
 */
window.recordEdit = function (entry = {}) {
  window.state.editLog ||= [];
  let timestamp = new Date().toISOString();
  let record = {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    type: String(entry.type || "edit"),
    summary: String(entry.summary || "").trim(),
    sheetHint: String(entry.sheetHint || "").trim(),
    changes: Array.isArray(entry.changes) ? entry.changes : [],
    appliedAt: "",
    undo: window.normalizeEditLogUndo?.(entry.undo) || null,
    undoneAt: "",
    undoEntryId: "",
    context: entry.context || {},
  };
  record.target = window.normalizeEditLogTarget(
    Object.assign({}, record, { target: entry.target }),
  );
  window.state.editLog.unshift(record);
  if (window.state.editLog.length > 500) window.state.editLog.length = 500;
  return record;
};

function importHistoryText(value, limit = 500) {
  return String(value ?? "")
    .trim()
    .slice(0, limit);
}

function importHistoryCount(value) {
  let count = Number(value) || 0;
  return Math.max(0, Math.trunc(count));
}

/**
 * Records one bounded, informational audit entry for a committed import.
 * @param {Partial<ImportReport>} [report] Completed top-level import report.
 * @param {Object} [options] Source metadata and preview state.
 * @param {'json'|'google-sheets'|'delimited'|'other'} [options.sourceKind] Stable source kind.
 * @param {string} [options.source] Source label override.
 * @param {'merge'|'replace'|'foundation'} [options.mode] Import mode override.
 * @param {string} [options.summary] History summary override.
 * @param {string} [options.sourceRevision] Deterministic imported source identity.
 * @param {Object} [options.sourceConfig] Non-secret source configuration.
 * @param {boolean} [options.preview] Whether this is a non-committing preview.
 * @returns {EditLogEntry|null} Stored audit entry, or null for a preview.
 */
window.recordImportHistory = function (report = {}, options = {}) {
  if (report.preview || options.preview) return null;
  let sourceKind = ["json", "google-sheets", "delimited"].includes(
    options.sourceKind,
  )
    ? options.sourceKind
    : "other";
  let source = importHistoryText(options.source || report.source || "Import");
  let mode = options.mode || report.mode;
  mode = ["replace", "foundation"].includes(mode) ? mode : "merge";
  let sourceRevision = importHistoryText(options.sourceRevision, 200);
  let sourceConfig = {
    ...(options.sourceConfig?.spreadsheetId
      ? {
          spreadsheetId: importHistoryText(
            options.sourceConfig.spreadsheetId,
            200,
          ),
        }
      : {}),
    ...(options.sourceConfig?.filename
      ? { filename: importHistoryText(options.sourceConfig.filename, 200) }
      : {}),
    ...(options.sourceConfig?.importType
      ? { importType: importHistoryText(options.sourceConfig.importType, 100) }
      : {}),
    ranges: (Array.isArray(options.sourceConfig?.ranges)
      ? options.sourceConfig.ranges
      : []
    )
      .slice(0, 30)
      .map((range) => ({
        key: importHistoryText(range.key, 100),
        range: importHistoryText(range.range, 200),
        importType: importHistoryText(range.importType, 100),
        periodTypeHint: importHistoryText(range.periodTypeHint, 100),
      })),
  };
  let completedAt = importHistoryText(
    report.generatedAt || new Date().toISOString(),
    80,
  );
  let counts = {
    filmsParsed: importHistoryCount(report.filmsParsed),
    filmsAdded: importHistoryCount(report.filmsAdded),
    filmsMerged: importHistoryCount(report.filmsMerged),
    awardsAdded: importHistoryCount(report.awardsAdded),
    awardsRejected: importHistoryCount(report.awardsRejected),
    skipped: importHistoryCount(report.skipped),
  };
  let allWarnings = Array.isArray(report.warnings) ? report.warnings : [];
  let warnings = allWarnings
    .slice(0, 20)
    .map((warning) => importHistoryText(warning));
  let warningCount = Math.max(
    allWarnings.length,
    importHistoryCount(report.detailTotals?.warnings),
  );
  let allRanges = Array.isArray(report.rangeSummaries)
    ? report.rangeSummaries
    : [];
  let ranges = allRanges.slice(0, 30).map((range) => ({
    key: importHistoryText(range.key || "Range", 100),
    range: importHistoryText(range.range, 200),
    rows: importHistoryCount(range.rows),
    filmsParsed: importHistoryCount(range.filmsParsed),
    awardsAdded: importHistoryCount(range.awardsAdded),
    skipped: importHistoryCount(range.skipped),
  }));
  let allPeriods = Array.isArray(report.periods) ? report.periods : [];
  let periods = allPeriods
    .slice(0, 50)
    .map((period) => importHistoryText(period, 100));
  let section = (value) => ({
    key: importHistoryText(value.key, 100),
    label: importHistoryText(value.label, 200),
    count: importHistoryCount(value.count),
    localBefore: importHistoryCount(value.localBefore),
  });
  let restoredSections = (
    Array.isArray(report.restoredSections) ? report.restoredSections : []
  )
    .slice(0, 30)
    .map(section);
  let ignoredSections = (
    Array.isArray(report.ignoredSections) ? report.ignoredSections : []
  )
    .slice(0, 30)
    .map(section);
  let outcome =
    counts.awardsRejected || counts.skipped
      ? "partial"
      : warningCount
        ? "completed-with-warnings"
        : "completed";
  let summary = importHistoryText(
    options.summary || `${source} ${mode} import`,
    300,
  );
  let rangeCount = Math.max(
    allRanges.length,
    importHistoryCount(report.detailTotals?.rangeSummaries),
  );
  let periodCount = Math.max(
    allPeriods.length,
    importHistoryCount(report.detailTotals?.periods),
  );
  return window.recordEdit({
    type: "import",
    summary,
    target: { type: "import", label: summary },
    changes: [
      { field: "Source", before: "", after: source },
      { field: "Mode", before: "", after: mode },
      { field: "Outcome", before: "", after: outcome },
      {
        field: "Films parsed",
        before: "",
        after: String(counts.filmsParsed),
      },
      { field: "Films added", before: "", after: String(counts.filmsAdded) },
      {
        field: "Films merged",
        before: "",
        after: String(counts.filmsMerged),
      },
      { field: "Awards added", before: "", after: String(counts.awardsAdded) },
      {
        field: "Awards rejected",
        before: "",
        after: String(counts.awardsRejected),
      },
      { field: "Skipped", before: "", after: String(counts.skipped) },
      { field: "Warnings", before: "", after: String(warningCount) },
      { field: "Ranges", before: "", after: String(rangeCount) },
      { field: "Completed", before: "", after: completedAt },
    ],
    context: {
      sourceKind,
      source,
      mode,
      sourceRevision,
      sourceConfig,
      outcome,
      completedAt,
      counts,
      ranges,
      rangeCount,
      warnings,
      warningCount,
      periods,
      periodCount,
      restoredSections,
      restoredSectionCount: Array.isArray(report.restoredSections)
        ? report.restoredSections.length
        : 0,
      ignoredSections,
      ignoredSectionCount: Array.isArray(report.ignoredSections)
        ? report.ignoredSections.length
        : 0,
    },
  });
};
