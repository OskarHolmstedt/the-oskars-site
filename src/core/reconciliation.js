/**
 * @file Defines canonical-first startup reconciliation decisions and adapts a
 * published canonical document into a browser workspace without mixing layers.
 */

/**
 * Plans startup behavior from published and local workspace identities.
 * @param {Object} input Reconciliation inputs.
 * @param {boolean} input.hasLocal Whether browser persistence contained a workspace.
 * @param {Object|null} input.localCanonical Current local canonical candidate.
 * @param {Object|null} input.draftMetadata Current local draft metadata.
 * @param {Object|null} input.publishedCanonical Valid published canonical data.
 * @param {string} [input.publishedRevision] Precomputed published revision.
 * @param {'offline'|'invalid'|'unavailable'|''} [input.publishedError] Fetch/validation failure.
 * @returns {Object} Pure reconciliation plan.
 */
window.planStartupReconciliation = function (input) {
  let hasLocal = Boolean(input?.hasLocal);
  let localCanonical = input?.localCanonical || null;
  let metadata = input?.draftMetadata || {};
  let publishedCanonical = input?.publishedCanonical || null;
  let publishedError = String(input?.publishedError || "");
  let localRevision = localCanonical
    ? window.canonicalDataRevision(localCanonical)
    : "";
  let baseRevision = String(metadata.baseRevision || localRevision || "");
  let dirty = Boolean(metadata.dirty);
  if (hasLocal && localCanonical)
    dirty =
      dirty ||
      window.canonicalDraftDiffersFromBase(localCanonical, baseRevision);

  if (!publishedCanonical) {
    let status =
      publishedError === "invalid"
        ? "invalid"
        : publishedError === "offline"
          ? "offline"
          : "unavailable";
    return {
      status,
      action: hasLocal ? "retain-local" : "unavailable",
      baseRevision,
      localRevision,
      publishedRevision: "",
      dirty,
      stale: false,
      requiredAction: publishedError === "invalid" ? "retry-canonical" : "",
    };
  }

  let publishedRevision = String(
    input?.publishedRevision || window.canonicalDataRevision(publishedCanonical),
  );
  if (!hasLocal) {
    return {
      status: "clean",
      action: "adopt-published",
      baseRevision: publishedRevision,
      localRevision: "",
      publishedRevision,
      dirty: false,
      stale: false,
      requiredAction: "",
    };
  }

  if (localRevision === publishedRevision) {
    let publicationRevision = String(
      metadata.publication?.candidateRevision || "",
    );
    return {
      status: "clean",
      action: "retain-local",
      baseRevision: publishedRevision,
      localRevision,
      publishedRevision,
      dirty: false,
      stale: false,
      requiredAction: "",
      verifiedPublication: publicationRevision === publishedRevision,
    };
  }

  let stale = baseRevision !== publishedRevision;
  if (!dirty) {
    return {
      status: "clean",
      action: stale ? "adopt-published" : "retain-local",
      baseRevision,
      localRevision,
      publishedRevision,
      dirty: false,
      stale,
      requiredAction: "",
    };
  }
  return {
    status: stale ? "stale" : "unpublished",
    action: stale ? "await-reconciliation" : "retain-local",
    baseRevision,
    localRevision,
    publishedRevision,
    dirty: true,
    stale,
    requiredAction: stale ? "reconcile-stale-draft" : "",
  };
};

/**
 * Plans startup for local/viewer runtime modes (issue #245), which never
 * fetch or adopt a published owner snapshot. The local workspace, if any,
 * is always retained as-is; there is nothing to reconcile it against.
 * @param {Object} input Local-mode startup inputs.
 * @param {boolean} input.hasLocal Whether browser persistence contained a workspace.
 * @param {Object|null} input.localCanonical Current local canonical candidate.
 * @param {Object|null} input.draftMetadata Current local draft metadata.
 * @returns {Object} Pure reconciliation plan with status "local".
 */
window.planLocalModeStartup = function (input) {
  let hasLocal = Boolean(input?.hasLocal);
  let localCanonical = input?.localCanonical || null;
  let metadata = input?.draftMetadata || {};
  let localRevision = localCanonical
    ? window.canonicalDataRevision(localCanonical)
    : "";
  return {
    status: "local",
    action: "retain-local",
    baseRevision: String(metadata.baseRevision || localRevision || ""),
    localRevision,
    publishedRevision: "",
    dirty: false,
    stale: false,
    requiredAction: "",
    hasLocal,
  };
};

/**
 * Applies a reconciliation plan to persisted draft metadata.
 * @param {Object|null} existing Existing metadata.
 * @param {Object} plan Reconciliation plan.
 * @returns {Object} Updated metadata.
 */
window.reconciliationDraftMetadata = function (existing, plan) {
  let metadata = {
    ...(existing || {}),
    baseRevision: String(plan.baseRevision || plan.publishedRevision || ""),
    dirty: Boolean(plan.dirty),
    reconciliationStatus: plan.status,
    publishedRevision: String(plan.publishedRevision || ""),
    lastCanonicalCheckAt: new Date().toISOString(),
  };
  if (plan.verifiedPublication && metadata.publication) {
    metadata.lastPublishedRevision = String(plan.publishedRevision || "");
    metadata.publication = {
      ...metadata.publication,
      status: "verified",
      observedRevision: String(plan.publishedRevision || ""),
      verifiedAt: metadata.lastCanonicalCheckAt,
    };
  }
  if (plan.requiredAction) metadata.requiredAction = plan.requiredAction;
  else delete metadata.requiredAction;
  return metadata;
};

/**
 * Builds a layered browser workspace from published data and current local-only state.
 * @param {Object} canonical Valid published canonical data.
 * @param {OskarsState} localState Current runtime state supplying local-only fields.
 * @param {string} revision Published revision.
 * @returns {Object} Browser workspace envelope.
 */
window.publishedCanonicalWorkspace = function (canonical, localState, revision) {
  let checkedAt = new Date().toISOString();
  let local = window.getLocalWorkspaceState(localState);
  return {
    workspaceSchemaVersion: window.OSKARS_WORKSPACE_SCHEMA_VERSION,
    draft: {
      data: canonical,
      metadata: {
        baseRevision: revision,
        dirty: false,
        reconciliationStatus: "clean",
        publishedRevision: revision,
        lastCanonicalCheckAt: checkedAt,
        lastLocalSaveAt: checkedAt,
      },
    },
    preferences: window.getDevicePreferences(localState),
    local: { diagnostics: local.diagnostics },
  };
};

/**
 * Formats a concise user-visible canonical/workspace status.
 * @param {Object} plan Reconciliation plan.
 * @returns {string} Status message.
 */
window.reconciliationStatusMessage = function (plan) {
  if (plan.status === "local")
    return plan.hasLocal
      ? "Local mode · No published archive"
      : "Local mode · Empty archive";
  if (plan.status === "clean") return "This browser matches the published archive.";
  if (plan.status === "unpublished")
    return "This browser has changes that have not been published.";
  if (plan.status === "stale")
    return "A newer published archive is available. You can use it here; this browser's current archive will be kept for recovery.";
  if (plan.status === "invalid")
    return "The published archive could not be used. This browser's archive is still safe.";
  if (plan.status === "unavailable")
    return plan.action === "retain-local"
      ? "The published archive is unavailable. Using this browser's saved archive."
      : "The published archive is unavailable and this browser has no saved archive.";
  return plan.action === "retain-local"
    ? "You appear to be offline. Using this browser's saved archive."
    : "You appear to be offline, and no saved archive is available.";
};
