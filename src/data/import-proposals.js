/** @file Owns the common session-only import proposal, validation, stale guard, recovery, and apply-to-draft boundary. */

function sheetsFoundationHistoryEntry(source) {
  return (source?.editLog || []).find(
    (entry) =>
      entry.type === "import" &&
      entry.context?.sourceKind === "google-sheets" &&
      entry.context?.mode === "foundation" &&
      entry.context?.sourceRevision,
  );
}

/**
 * Builds a validated import proposal without persisting it.
 * @param {Object} input Proposal inputs.
 * @param {'google-sheets'|'json'|'delimited'|'official-results'|'letterboxd'} input.sourceKind Source family.
 * @param {'merge'|'replace'|'foundation'|'refresh'} input.mode Proposal mode.
 * @param {OskarsState} input.baseState State at preview time.
 * @param {OskarsState} input.candidateState Temporary imported state.
 * @param {ImportReport} input.report Itemized preview report.
 * @param {string} input.sourceRevision Deterministic source identity.
 * @param {Object} [input.sourceConfig] Non-secret source configuration.
 * @param {boolean} [input.recordHistory] Whether to append canonical import history.
 * @param {Array<{path: string, message: string}>} [input.validationErrors] Additional blocking findings.
 * @returns {ImportProposal} Session-only proposal.
 */
window.createImportProposal = function (input) {
  let candidateState = window.cloneRecord(input.candidateState);
  let foundationHistory = sheetsFoundationHistoryEntry(input.baseState);
  if (
    input.mode !== "foundation" &&
    foundationHistory &&
    !(candidateState.editLog || []).some(
      (entry) => entry.id === foundationHistory.id,
    )
  ) {
    candidateState.editLog ||= [];
    candidateState.editLog = candidateState.editLog.slice(0, 498);
    candidateState.editLog.push(window.cloneRecord(foundationHistory));
  }
  let baseCanonical = window.getCanonicalData(input.baseState, { clone: false });
  let importedCanonical = window.getCanonicalData(candidateState, {
    clone: false,
  });
  let baseCandidateRevision = window.canonicalDataRevision(baseCanonical);
  let importChanged =
    window.canonicalDataRevision(importedCanonical) !== baseCandidateRevision;
  let historyReport = window.cloneRecord(input.report || {});
  historyReport.preview = false;
  if (input.recordHistory !== false) {
    let liveState = window.state;
    try {
      window.state = candidateState;
      window.recordImportHistory?.(historyReport, {
        sourceKind: input.sourceKind,
        source: historyReport.source || input.sourceKind,
        mode: input.mode,
        summary: `Applied ${input.sourceKind} ${input.mode} proposal`,
        sourceRevision: input.sourceRevision,
        sourceConfig: input.sourceConfig,
      });
    } finally {
      window.state = liveState;
    }
  }
  let candidateCanonical = window.getCanonicalData(candidateState, {
    clone: false,
  });
  let validation = window.validateCanonicalData(candidateCanonical);
  let candidateRevision = window.canonicalDataRevision(candidateCanonical);
  let errors = validation.errors.slice();
  errors.push(...(input.validationErrors || []));
  if (!importChanged)
    errors.push({
      path: "$proposal",
      message: "the import changes no canonical data",
    });
  let report = window.cloneRecord(input.report || {});
  report.preview = true;
  if (errors.length) {
    report.warnings ||= [];
    errors.forEach((entry) =>
      report.warnings.push(`${entry.path}: ${entry.message}`),
    );
  }
  let changes = window.canonicalSectionChanges(
    baseCanonical,
    candidateCanonical,
  );
  report.proposalChanges = changes;
  return {
    schemaVersion: 1,
    status: "preview",
    sourceKind: input.sourceKind,
    mode: input.mode,
    sourceRevision: String(input.sourceRevision || ""),
    sourceConfig: window.cloneRecord(input.sourceConfig || {}),
    baseCandidateRevision,
    basePublishedRevision: String(
      input.baseState.draftMetadata?.baseRevision || "",
    ),
    candidateRevision,
    candidateState,
    changes,
    validation: { valid: validation.valid, errors },
    report,
    allowed: validation.valid && !errors.length && importChanged,
    createdAt: new Date().toISOString(),
  };
};

/**
 * Returns the local or canonical one-time Sheets foundation record.
 * @param {OskarsState} [source] State to inspect.
 * @returns {Object|null} Foundation identity and configuration.
 */
window.getSheetsImportFoundation = function (source = window.state) {
  if (source.importFoundation) return source.importFoundation;
  let entry = sheetsFoundationHistoryEntry(source);
  return entry
    ? {
        schemaVersion: 1,
        sourceKind: "google-sheets",
        sourceRevision: entry.context.sourceRevision,
        sourceConfig: window.cloneRecord(entry.context.sourceConfig || {}),
        establishedAt: entry.context.completedAt || entry.timestamp || "",
        status: "published-foundation-history",
      }
    : null;
};

/**
 * Reports whether canonical or local audit state records the one-time Sheets foundation.
 * @param {OskarsState} [source] State to inspect.
 * @returns {boolean} Whether cutover was already established.
 */
window.hasSheetsImportFoundation = function (source = window.state) {
  return Boolean(window.getSheetsImportFoundation(source));
};

/**
 * Runs a TSV/CSV/text importer against temporary state and returns a proposal.
 * @param {string} raw Raw delimited source text.
 * @param {string} importType Supported importer format identifier.
 * @param {Object} [options] Proposal and parser options.
 * @param {'merge'|'replace'} [options.mode] Candidate behavior.
 * @param {string} [options.sourceName] User-facing source name.
 * @param {Object} [options.importOptions] Low-level parser options.
 * @returns {ImportProposal} Session-only delimited proposal.
 */
window.proposeDelimitedImport = function (raw, importType, options = {}) {
  let mode = options.mode === "replace" ? "replace" : "merge";
  let baseState = window.cloneRecord(window.state);
  try {
    window.state =
      mode === "replace"
        ? window.createClearedLocalState()
        : window.cloneRecord(baseState);
    window.rebuildAggregates?.();
    let report = window.importData(raw, importType, {
      ...(options.importOptions || {}),
      render: false,
      silentReport: true,
    });
    if (!report) throw new Error("Delimited import could not build a proposal");
    report.source = String(
      options.sourceName || report.source || "Delimited file",
    );
    return window.createImportProposal({
      sourceKind: "delimited",
      mode,
      baseState,
      candidateState: window.state,
      report,
      sourceRevision: window.canonicalDataRevision({ importType, raw }),
      sourceConfig: {
        importType: String(importType || ""),
        sourceName: String(options.sourceName || ""),
      },
    });
  } finally {
    window.state = baseState;
    window.rebuildAggregates?.();
  }
};

/**
 * Plans whether an exact reviewed proposal can still be applied.
 * @param {ImportProposal} proposal Session proposal.
 * @param {OskarsState} [currentState] Current state.
 * @returns {{ok: boolean, errors: string[], currentRevision: string}} Apply guard.
 */
window.planImportProposalApplication = function (
  proposal,
  currentState = window.state,
) {
  let currentRevision = window.canonicalDataRevision(
    window.getCanonicalData(currentState, { clone: false }),
  );
  let errors = [];
  if (!proposal || proposal.schemaVersion !== 1)
    errors.push("Import proposal is missing or unsupported.");
  else {
    if (proposal.status !== "preview")
      errors.push("Import proposal is no longer pending.");
    if (!proposal.allowed || !proposal.validation?.valid)
      errors.push("Import proposal did not pass canonical validation.");
    if (proposal.baseCandidateRevision !== currentRevision)
      errors.push(
        "The local draft changed after preview; create a new proposal.",
      );
    if (
      proposal.mode === "foundation" &&
      window.hasSheetsImportFoundation(currentState)
    )
      errors.push("The one-time Sheets foundation was already established.");
    let candidateValidation = window.validateCanonicalData(
      window.getCanonicalData(proposal.candidateState || {}, { clone: false }),
    );
    if (!candidateValidation.valid)
      errors.push(
        "The proposal candidate no longer passes canonical validation.",
      );
  }
  return { ok: errors.length === 0, errors, currentRevision };
};

/**
 * Marks an applied import candidate as locally changed on its compatibility base.
 * @param {Object|null} existing Existing draft metadata.
 * @param {ImportProposal} proposal Applied proposal.
 * @param {string} [changedAt] Apply time.
 * @returns {Object} Updated draft metadata.
 */
window.importProposalDraftMetadata = function (
  existing,
  proposal,
  changedAt = new Date().toISOString(),
) {
  return {
    ...(existing || {}),
    baseRevision: String(
      proposal.basePublishedRevision || existing?.baseRevision || "",
    ),
    dirty: true,
    changedAt,
    reason: `import-proposal:${proposal.sourceKind}:${proposal.mode}`,
    reconciliationStatus: "unpublished",
  };
};

/**
 * Applies the exact reviewed proposal after recovery, revalidation, and a stale check.
 * @param {ImportProposal} proposal Session proposal.
 * @returns {Promise<{ok: boolean, errors?: string[], report?: ImportReport}>} Apply result.
 */
window.applyImportProposal = async function (proposal) {
  let plan = window.planImportProposalApplication(proposal);
  if (!plan.ok) return { ok: false, errors: plan.errors };
  let beforeState = window.cloneRecord(window.state);
  let retained = await window.saveRecoveryWorkspace(
    window.getBrowserPersistenceState(),
    { reason: `before-import-proposal:${proposal.sourceKind}:${proposal.mode}` },
  );
  if (!retained)
    return {
      ok: false,
      errors: ["Could not retain the current recovery workspace."],
    };

  let appliedAt = new Date().toISOString();
  window.state = Object.assign(
    window.createEmptyState(),
    window.cloneRecord(proposal.candidateState),
  );
  window.state.draftMetadata = window.importProposalDraftMetadata(
    window.state.draftMetadata,
    proposal,
    appliedAt,
  );
  let report = window.cloneRecord(proposal.report || {});
  report.preview = false;
  report.generatedAt = appliedAt;
  report.mode = proposal.mode;
  window.state.lastImportReport =
    window.compactImportReport?.(report, { generatedAt: appliedAt }) || report;
  if (proposal.mode === "foundation") {
    window.state.importFoundation = {
      schemaVersion: 1,
      sourceKind: proposal.sourceKind,
      sourceRevision: proposal.sourceRevision,
      sourceConfig: window.cloneRecord(proposal.sourceConfig),
      baseRevision: proposal.basePublishedRevision,
      candidateRevision: proposal.candidateRevision,
      establishedAt: appliedAt,
      status: "applied-unpublished",
    };
  }
  window.rebuildAggregates?.();
  let saving = window.save?.({ immediate: true });
  let saved = saving?.then ? await saving : saving !== false;
  if (!saved) {
    window.state = beforeState;
    window.rebuildAggregates?.();
    return {
      ok: false,
      errors: [
        "The proposal could not be saved; the previous local draft was restored.",
      ],
    };
  }
  proposal.status = "applied";
  return { ok: true, report: window.state.lastImportReport };
};
