/** @file Previews and stages validated canonical publication candidates without treating transfer as publication. */

let preparedCanonicalPublication = null;

function publicationEscape(value) {
  return window.pageEscape?.(String(value ?? "")) || String(value ?? "");
}

function publicationRecordCount(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value).length;
  return value === undefined || value === null ? 0 : 1;
}

function publicationRecords(value) {
  if (Array.isArray(value))
    return value.map((record, index) => [
      String(record?.id || `${record?.title || "record"}:${record?.year || index}`),
      record,
    ]);
  if (value && typeof value === "object") return Object.entries(value);
  return [["$value", value]];
}

function publicationChangedRecordCount(before, after) {
  let beforeRecords = new Map(publicationRecords(before));
  let afterRecords = new Map(publicationRecords(after));
  let identities = new Set([...beforeRecords.keys(), ...afterRecords.keys()]);
  return [...identities].filter(
    (identity) =>
      !beforeRecords.has(identity) ||
      !afterRecords.has(identity) ||
      window.canonicalDataRevision(beforeRecords.get(identity)) !==
        window.canonicalDataRevision(afterRecords.get(identity)),
  ).length;
}

/**
 * Summarizes changed canonical sections and their immediate record counts.
 * @param {Object|null} published Published canonical document.
 * @param {Object} candidate Candidate canonical document.
 * @returns {Object[]} Section change summaries.
 */
window.canonicalPublicationChanges = function (published, candidate) {
  let keys = new Set([
    ...Object.keys(published || {}),
    ...Object.keys(candidate || {}),
  ]);
  keys.delete("canonicalSchemaVersion");
  return [...keys]
    .sort()
    .map((section) => {
      let before = published?.[section];
      let after = candidate?.[section];
      return {
        section,
        before: publicationRecordCount(before),
        after: publicationRecordCount(after),
        changedRecords: publicationChangedRecordCount(before, after),
        changed:
          window.canonicalDataRevision(before) !==
          window.canonicalDataRevision(after),
      };
    })
    .filter((entry) => entry.changed);
};

/**
 * Builds a deterministic, validated canonical publication preview.
 * @param {Object} [input] Optional pure inputs for tests and callers.
 * @param {Object} [input.candidate] Candidate canonical document.
 * @param {Object|null} [input.published] Observed published document.
 * @param {Object|null} [input.metadata] Draft metadata.
 * @returns {Object} Publication preview and guard results.
 */
window.planCanonicalPublication = function (input = {}) {
  let candidate =
    input.candidate || window.getCanonicalData(window.state, { clone: false });
  let published =
    input.published === undefined
      ? window.getObservedPublishedCanonical?.() || null
      : input.published;
  let metadata = input.metadata || window.state?.draftMetadata || {};
  let validation = window.validateCanonicalData(candidate);
  let candidateRevision = window.canonicalDataRevision(candidate);
  let publishedRevision = published
    ? window.canonicalDataRevision(published)
    : "";
  let baseRevision = String(metadata.baseRevision || "");
  let stale = Boolean(publishedRevision && baseRevision !== publishedRevision);
  let alreadyPublished =
    Boolean(publishedRevision) && candidateRevision === publishedRevision;
  let errors = validation.errors.slice();
  if (!published)
    errors.push({
      path: "$publication",
      message: "published canonical data was not observed during startup",
    });
  if (stale)
    errors.push({
      path: "$publication.baseRevision",
      message: "the draft base is stale; reconcile before publishing",
    });
  if (alreadyPublished)
    errors.push({
      path: "$publication",
      message: "the candidate already matches the published revision",
    });
  let allowed = validation.valid && Boolean(published) && !stale && !alreadyPublished;
  return {
    allowed,
    valid: validation.valid,
    stale,
    alreadyPublished,
    candidateRevision,
    publishedRevision,
    baseRevision,
    changes: window.canonicalPublicationChanges(published, candidate),
    errors,
    bytes: validation.valid ? window.serializeCanonicalData(candidate) : "",
  };
};

/**
 * Records a non-authoritative transfer result while keeping the draft dirty.
 * @param {Object|null} existing Existing draft metadata.
 * @param {Object} preview Publication preview.
 * @param {'download'|'selected-file'} method Transfer method.
 * @param {'candidate-downloaded'|'candidate-written'|'cancelled'|'failed'} status Transfer result.
 * @param {string} [error] Failure detail.
 * @param {string} [attemptedAt] Attempt time.
 * @returns {Object} Updated draft metadata.
 */
window.publicationAttemptMetadata = function (
  existing,
  preview,
  method,
  status,
  error = "",
  attemptedAt = new Date().toISOString(),
) {
  return {
    ...(existing || {}),
    dirty: true,
    reconciliationStatus: "unpublished",
    publication: {
      attemptedAt,
      method,
      status,
      candidateRevision: preview.candidateRevision,
      observedRevision: preview.publishedRevision,
      ...(error ? { error } : {}),
    },
  };
};

async function recordPublicationResult(preview, method, status, error = "") {
  window.state.draftMetadata = window.publicationAttemptMetadata(
    window.state.draftMetadata,
    preview,
    method,
    status,
    error,
  );
  let saving = window.save?.({ immediate: true, rebuild: false });
  if (saving?.then) await saving;
}

function currentPreparedPublication() {
  if (!preparedCanonicalPublication?.allowed)
    throw new Error("Preview a publishable candidate first");
  let current = window.planCanonicalPublication();
  if (
    !current.allowed ||
    current.candidateRevision !== preparedCanonicalPublication.candidateRevision ||
    current.publishedRevision !== preparedCanonicalPublication.publishedRevision
  )
    throw new Error("The draft or published base changed; preview again");
  return current;
}

/** Downloads exact deterministic canonical candidate bytes without claiming publication. */
window.downloadCanonicalPublicationCandidate = async function () {
  let preview;
  try {
    preview = currentPreparedPublication();
    let blob = new Blob([preview.bytes], { type: "application/json" });
    let url = URL.createObjectURL(blob);
    let link = document.createElement("a");
    link.href = url;
    link.download = "oskars-canonical-publication-candidate.json";
    link.click();
    URL.revokeObjectURL(url);
    await recordPublicationResult(preview, "download", "candidate-downloaded");
  } catch (err) {
    if (preview)
      await recordPublicationResult(
        preview,
        "download",
        "failed",
        String(err?.message || err),
      );
    throw err;
  }
};

/**
 * Writes exact canonical candidate bytes to a user-selected file where supported.
 * @returns {Promise<void>}
 */
window.writeCanonicalPublicationCandidate = async function () {
  let preview = currentPreparedPublication();
  try {
    let handle = await window.showSaveFilePicker({
      suggestedName: "oskars-data.json",
      types: [
        {
          description: "Canonical JSON",
          accept: { "application/json": [".json"] },
        },
      ],
    });
    let writable = await handle.createWritable();
    await writable.write(preview.bytes);
    await writable.close();
    await recordPublicationResult(preview, "selected-file", "candidate-written");
  } catch (err) {
    let cancelled = err?.name === "AbortError";
    await recordPublicationResult(
      preview,
      "selected-file",
      cancelled ? "cancelled" : "failed",
      cancelled ? "" : String(err?.message || err),
    );
    if (!cancelled) throw err;
  }
};

/** Renders canonical publication status, preview, guards, and staging actions. */
window.renderCanonicalPublication = function (container) {
  if (!container) return;
  let publication = window.state.draftMetadata?.publication || null;
  let result = preparedCanonicalPublication;
  let previewHtml = "";
  if (result) {
    let findings = result.errors
      .map(
        (entry) =>
          `<li><code>${publicationEscape(entry.path)}</code> ${publicationEscape(entry.message)}</li>`,
      )
      .join("");
    let changes = result.changes
      .map(
        (entry) =>
          `<li><strong>${publicationEscape(entry.section)}</strong>: ${entry.changedRecords} changed; ${entry.before} → ${entry.after} total records</li>`,
      )
      .join("");
    previewHtml = `<div class="publication-preview">
      <p><strong>Candidate:</strong> <code>${publicationEscape(result.candidateRevision)}</code><br><strong>Observed publication:</strong> <code>${publicationEscape(result.publishedRevision || "unavailable")}</code></p>
      ${changes ? `<h3>Changed sections</h3><ul>${changes}</ul>` : "<p>No canonical sections changed.</p>"}
      ${findings ? `<h3>Findings</h3><ul>${findings}</ul>` : "<p>Validation and stale-base checks passed.</p>"}
      ${result.allowed ? `<div class="data-actions"><button type="button" data-publication-download>Download canonical candidate</button>${typeof window.showSaveFilePicker === "function" ? '<button type="button" data-publication-write>Write selected file</button>' : ""}</div><ol><li>Replace <code>data/oskars-data.json</code> with these exact bytes.</li><li>Review and commit the repository change.</li><li>Reload the served app; only that later matching startup verifies publication.</li></ol>` : ""}
    </div>`;
  }
  let lastResult = publication
    ? `<p class="data-panel-status">Last attempt: ${publicationEscape(publication.status)} via ${publicationEscape(publication.method)} · ${publicationEscape(publication.candidateRevision)}</p>`
    : '<p class="data-panel-status">No publication candidate has been staged.</p>';
  container.innerHTML = `<h2>Publish canonical JSON</h2>
    <p>Create a validated repository candidate. This is separate from a browser backup: downloading or writing a file does not publish it.</p>
    <div class="data-actions"><button type="button" data-publication-preview>Preview publication</button></div>
    ${lastResult}${previewHtml}`;
};

/** Handles publication controls in the Data workspace. */
window.handleCanonicalPublicationAction = async function (event) {
  let container = event.currentTarget;
  try {
    if (event.target.closest("[data-publication-preview]"))
      preparedCanonicalPublication = window.planCanonicalPublication();
    else if (event.target.closest("[data-publication-download]"))
      await window.downloadCanonicalPublicationCandidate();
    else if (event.target.closest("[data-publication-write]"))
      await window.writeCanonicalPublicationCandidate();
    else return;
  } catch (err) {
    preparedCanonicalPublication = {
      ...(preparedCanonicalPublication || {}),
      allowed: false,
      errors: [
        ...(preparedCanonicalPublication?.errors || []),
        { path: "$publication", message: String(err?.message || err) },
      ],
    };
  }
  window.renderCanonicalPublication(container);
};
