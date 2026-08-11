/** @file Controls the data workspace for imports, backups, health, metadata batches, and edit history. */

let ui = window.uiText || ((text) => text);
let pendingGoogleImportProposal = null;
let pendingJsonImportProposal = null;
let pendingOfficialResultsProposal = null;

function updateGoogleFoundationControls() {
  let option = document.querySelector(
    '#googleSheetsImportMode option[value="foundation"]',
  );
  if (!option) return;
  option.disabled = Boolean(window.hasSheetsImportFoundation?.());
  let select = document.getElementById("googleSheetsImportMode");
  if (option.disabled && select.value === "foundation") select.value = "merge";
}

function renderDataWorkspace() {
  let finishRenderTimer = window.startOskarsPerformance?.(
    "data:renderWorkspace",
  );
  renderEditLogView(document.getElementById("editLogView"));
  window.renderCanonicalPublication?.(
    document.getElementById("canonicalPublicationView"),
  );
  updateGoogleFoundationControls();
  window.renderDataHealth(document.getElementById("dataHealthView"), {
    refresh: true,
  });
  if (window.state.lastImportReport)
    window.showImportReport?.(window.state.lastImportReport);
  else window.hideImportReport?.();
  window.renderSiteHeader?.();
  finishRenderTimer?.(
    `${(window.state.editLog || []).length} edit log entry(s)`,
  );
}
window.renderDataWorkspace = renderDataWorkspace;

function editLogEscape(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function editLogTimeLabel(value) {
  if (!value) return "";
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function editLogTargetLink(entry) {
  let target = window.normalizeEditLogTarget?.(entry) || {
    type: "other",
    id: "",
  };
  let context = entry.context || {};
  if (
    (context.filmId || (target.type === "film" && target.id)) &&
    window.filmPageUrl
  ) {
    return `<a href="${editLogEscape(window.filmPageUrl(target.id || context.filmId))}">${editLogEscape(ui("Open"))}</a>`;
  }
  if (
    (context.watchlistId || (target.type === "watchlist" && target.id)) &&
    window.watchlistFilmPageUrl
  ) {
    return `<a href="${editLogEscape(window.watchlistFilmPageUrl(target.id || context.watchlistId))}">${editLogEscape(ui("Open"))}</a>`;
  }
  return "";
}

let editLogFilters = { status: "open", target: "all", type: "all" };
let editLogUndoPreviewId = "";

function editLogTargetLabel(type) {
  return ui(
    {
      film: "Film metadata",
      watchlist: "Watchlist metadata",
      nomination: "Nominations",
      project: "Projects",
      alias: "Aliases",
      note: "Notes",
      import: "Imports",
      other: "Other",
    }[type] || "Other",
  );
}

function filteredEditLogEntries(entries) {
  return entries.filter(
    (entry) =>
      (editLogFilters.status === "all" ||
        (editLogFilters.status === "applied"
          ? entry.appliedAt
          : !entry.appliedAt)) &&
      (editLogFilters.type === "all" || entry.type === editLogFilters.type) &&
      (editLogFilters.target === "all" ||
        window.normalizeEditLogTarget?.(entry)?.type === editLogFilters.target),
  );
}

function editLogContextText(entry) {
  let context = entry.context || {};
  return Object.keys(context).length
    ? JSON.stringify(context, null, 2)
    : ui("No context recorded.");
}

function editLogUndoStatusText(entry) {
  let status = window.editUndoState?.(entry)?.status || "unsupported";
  if (status === "undone")
    return `${ui("Undone")} ${editLogTimeLabel(entry.undoneAt)}`;
  if (status === "ready") return ui("Undoable");
  return ui("Not undoable");
}

// Ranking-movement detail (issue #139): only entries carrying the new
// bounded `context.movedRanks` payload get this section - legacy "all-time
// ranking reorder" entries recorded before this change fall back to the
// generic changes/context rendering below, exactly as before.
function editLogRankingMovementFieldChanges(film) {
  let labels = {
    allTimeRank: ui("all-time"),
    yearRank: ui("year"),
    decadeRank: ui("decade"),
    centuryRank: ui("century"),
  };
  return Object.keys(labels)
    .filter((key) => film.before?.[key] !== film.after?.[key])
    .map(
      (key) =>
        `${labels[key]}: ${film.before?.[key] ?? "—"} → ${film.after?.[key] ?? "—"}`,
    )
    .join(", ");
}

function editLogRankingMovementSection(entry) {
  let context = entry.context || {};
  let movedRanks = Array.isArray(context.movedRanks) ? context.movedRanks : null;
  if (!movedRanks) return "";
  let primary =
    movedRanks.find((film) => film.id === context.fromFilmId) ||
    movedRanks[0];
  let direction =
    primary?.before?.allTimeRank != null &&
    primary?.after?.allTimeRank != null &&
    primary.before.allTimeRank !== primary.after.allTimeRank
      ? ui("All-time rank moved from {before} to {after}.", {
          before: primary.before.allTimeRank,
          after: primary.after.allTimeRank,
        })
      : ui("All-time rank unchanged; only period ranks shifted.");
  let otherFilms = movedRanks.filter((film) => film.id !== primary?.id);
  let otherRows = otherFilms
    .map(
      (film) =>
        `<li>${film.id && window.filmPageUrl ? `<a href="${editLogEscape(window.filmPageUrl(film.id))}">${editLogEscape(film.title)}</a>` : editLogEscape(film.title)} <span>${editLogEscape(editLogRankingMovementFieldChanges(film))}</span></li>`,
    )
    .join("");
  let truncatedNote = context.movedRanksTruncated
    ? `<p>${editLogEscape(
        ui("+{count} more affected film(s) not shown.", {
          count: (context.movedRanksTotal || movedRanks.length) - movedRanks.length,
        }),
      )}</p>`
    : "";
  return `<section class="edit-log-ranking-movement"><h3>${editLogEscape(ui("Ranking movement"))}</h3><p>${editLogEscape(direction)}</p>${otherRows ? `<ul class="edit-log-ranking-movement-list">${otherRows}</ul>` : ""}${truncatedNote}<p><a href="period.html?type=alltime&key=alltime">${editLogEscape(ui("View all-time ranking"))}</a></p></section>`;
}

function editLogDetails(entry) {
  let target = window.normalizeEditLogTarget?.(entry) || {
    type: "other",
    id: "",
    label: entry.summary || "",
  };
  let changes = (entry.changes || [])
    .map(
      (change) =>
        `<li><strong>${editLogEscape(change.field)}</strong><span>${editLogEscape(change.before || ui("(blank)"))}</span><b>→</b><span>${editLogEscape(change.after || ui("(blank)"))}</span></li>`,
    )
    .join("");
  return `<details class="edit-log-details"><summary>${editLogEscape(ui("Inspect"))}</summary><div class="edit-log-detail-grid"><dl><div><dt>${editLogEscape(ui("Target"))}</dt><dd>${editLogEscape(editLogTargetLabel(target.type))}</dd></div><div><dt>${editLogEscape(ui("Item"))}</dt><dd>${editLogEscape(target.label || entry.summary || ui("(blank)"))}</dd></div>${target.id ? `<div><dt>${editLogEscape(ui("Target id"))}</dt><dd><code>${editLogEscape(target.id)}</code></dd></div>` : ""}<div><dt>${editLogEscape(ui("Status"))}</dt><dd>${editLogEscape(entry.appliedAt ? ui("Applied") : ui("Open"))}</dd></div><div><dt>${editLogEscape(ui("Undo"))}</dt><dd>${editLogEscape(editLogUndoStatusText(entry))}${entry.undoEntryId ? ` <code>${editLogEscape(entry.undoEntryId)}</code>` : ""}</dd></div>${entry.context?.undoOf ? `<div><dt>${editLogEscape(ui("Undo of"))}</dt><dd><code>${editLogEscape(entry.context.undoOf)}</code></dd></div>` : ""}<div><dt>${editLogEscape(ui("Time"))}</dt><dd>${editLogEscape(entry.timestamp || "")}</dd></div>${entry.appliedAt ? `<div><dt>${editLogEscape(ui("Applied time"))}</dt><dd>${editLogEscape(entry.appliedAt)}</dd></div>` : ""}<div><dt>${editLogEscape(ui("Sheet hint"))}</dt><dd>${editLogEscape(entry.sheetHint || ui("(blank)"))}</dd></div><div><dt>${editLogEscape(ui("Entry id"))}</dt><dd><code>${editLogEscape(entry.id || "")}</code></dd></div></dl><section><h3>${editLogEscape(ui("Changes"))}</h3>${changes ? `<ul class="edit-log-change-list">${changes}</ul>` : `<p>${editLogEscape(ui("No recorded changes."))}</p>`}</section><section><h3>${editLogEscape(ui("Context"))}</h3><pre>${editLogEscape(editLogContextText(entry))}</pre></section>${editLogRankingMovementSection(entry)}</div></details>`;
}

function editLogUndoPreview(entry) {
  let plan = window.planEditUndo?.(entry.id) || {
    ok: false,
    reason: "unsupported",
  };
  let actionRows = (plan.actions || [])
    .map(
      (action) =>
        `<li class="${action.stale ? "is-stale" : ""}"><strong>${editLogEscape(action.label)}</strong><span>${editLogEscape(action.current || ui("(blank)"))}</span><b>→</b><span>${editLogEscape(action.restore || ui("(blank)"))}</span></li>`,
    )
    .join("");
  let message = plan.ok
    ? ui("Restores {count} field(s). Nothing changes until you confirm.", {
        count: (plan.actions || []).length,
      })
    : plan.reason === "stale"
      ? ui("Blocked: the target changed after this edit.")
      : plan.reason === "missing-target"
        ? ui("Blocked: the edited item no longer exists.")
        : plan.reason === "already-undone"
          ? ui("This edit was already undone.")
          : ui("This edit has no reversible payload.");
  return `<div class="edit-log-undo-preview"><h3>${editLogEscape(ui("Undo preview"))}</h3><p>${editLogEscape(message)}</p>${actionRows ? `<ul class="edit-log-change-list">${actionRows}</ul>` : ""}<div class="data-actions">${plan.ok ? `<button type="button" data-edit-log-undo-confirm="${editLogEscape(entry.id)}">${editLogEscape(ui("Confirm undo"))}</button>` : ""}<button type="button" data-edit-log-undo-cancel>${editLogEscape(ui("Cancel"))}</button></div></div>`;
}

function renderEditLogView(container) {
  if (!container) return;
  let entries = window.state.editLog || [];
  let filtered = filteredEditLogEntries(entries);
  let openCount = entries.filter((entry) => !entry.appliedAt).length;
  let appliedCount = entries.length - openCount;
  let typeOptions = [
    "all",
    ...new Set(
      entries
        .map((entry) => entry.type)
        .filter(Boolean)
        .sort(),
    ),
  ]
    .map(
      (type) =>
        `<option value="${editLogEscape(type)}" ${editLogFilters.type === type ? "selected" : ""}>${type === "all" ? editLogEscape(ui("All types")) : editLogEscape(type)}</option>`,
    )
    .join("");
  let presentTargets = new Set(
    entries.map((entry) => window.normalizeEditLogTarget?.(entry)?.type),
  );
  let targetOptions = [
    "all",
    "film",
    "watchlist",
    "nomination",
    "project",
    "alias",
    "note",
    "import",
    "other",
  ]
    .filter((target) => target === "all" || presentTargets.has(target))
    .map(
      (target) =>
        `<option value="${editLogEscape(target)}" ${editLogFilters.target === target ? "selected" : ""}>${editLogEscape(target === "all" ? ui("All targets") : editLogTargetLabel(target))}</option>`,
    )
    .join("");
  let rows = filtered
    .slice(0, 80)
    .map((entry) => {
      let target = window.normalizeEditLogTarget?.(entry) || {
        type: "other",
      };
      let changeCount = (entry.changes || []).length;
      return `<tr class="${entry.appliedAt ? "is-applied" : ""}">
      <td><input type="checkbox" data-edit-log-select="${editLogEscape(entry.id)}" aria-label="Select edit"></td>
      <td>${entry.appliedAt ? `<span class="edit-log-status applied">${editLogEscape(ui("Applied"))}</span>` : `<span class="edit-log-status open">${editLogEscape(ui("Open"))}</span>`}</td>
      <td>${editLogEscape(editLogTimeLabel(entry.timestamp))}</td>
      <td>${editLogEscape(editLogTargetLabel(target.type))}</td>
      <td>${editLogEscape(entry.type)}</td>
      <td>${editLogEscape(entry.summary)}</td>
      <td>${editLogEscape(entry.sheetHint)}</td>
      <td>${editLogEscape(changeCount === 1 ? ui("1 change") : ui("{count} changes", { count: changeCount }))}</td>
      <td>${editLogTargetLink(entry)}${entry.appliedAt ? `<button type="button" data-edit-log-reopen="${editLogEscape(entry.id)}">${editLogEscape(ui("Reopen"))}</button>` : `<button type="button" data-edit-log-applied="${editLogEscape(entry.id)}">${editLogEscape(ui("Applied"))}</button>`}${entry.undoneAt ? `<span class="edit-log-status undone">${editLogEscape(ui("Undone"))}</span>` : window.editUndoState?.(entry)?.status === "ready" ? `<button type="button" data-edit-log-undo="${editLogEscape(entry.id)}">${editLogEscape(ui("Undo"))}</button>` : ""}</td>
    </tr><tr class="edit-log-detail-row ${entry.appliedAt ? "is-applied" : ""}"><td colspan="9">${editLogDetails(entry)}</td></tr>${editLogUndoPreviewId === entry.id ? `<tr class="edit-log-undo-preview-row"><td colspan="9">${editLogUndoPreview(entry)}</td></tr>` : ""}`;
    })
    .join("");
  container.innerHTML = `<div class="edit-log-heading">
    <div><h2>${editLogEscape(ui("Sheet edit log"))}</h2><p>${entries.length ? editLogEscape(ui("{open} open · {applied} applied · {total} total.", { open: openCount, applied: appliedCount, total: entries.length })) : editLogEscape(ui("No local edits tracked yet."))}</p></div>
    <div class="data-actions"><button type="button" data-copy-edit-log ${filtered.length ? "" : "disabled"}>${editLogEscape(ui("Copy grouped TSV"))}</button><button type="button" data-download-edit-log ${filtered.length ? "" : "disabled"}>${editLogEscape(ui("Download grouped TSV"))}</button><button type="button" data-edit-log-mark-shown ${filtered.some((entry) => !entry.appliedAt) ? "" : "disabled"}>${editLogEscape(ui("Mark shown applied"))}</button><button type="button" data-clear-data-log ${entries.length ? "" : "disabled"}>${editLogEscape(ui("Clear log"))}</button></div>
  </div>
  ${entries.length ? `<div class="edit-log-controls"><label>${editLogEscape(ui("Status"))}<select data-edit-log-status><option value="open" ${editLogFilters.status === "open" ? "selected" : ""}>${editLogEscape(ui("Open"))}</option><option value="applied" ${editLogFilters.status === "applied" ? "selected" : ""}>${editLogEscape(ui("Applied"))}</option><option value="all" ${editLogFilters.status === "all" ? "selected" : ""}>${editLogEscape(ui("All"))}</option></select></label><label>${editLogEscape(ui("Target"))}<select data-edit-log-target>${targetOptions}</select></label><label>${editLogEscape(ui("Type"))}<select data-edit-log-type>${typeOptions}</select></label><button type="button" data-edit-log-mark-selected>${editLogEscape(ui("Mark selected applied"))}</button></div>` : ""}
  ${filtered.length ? `<div class="leaderboard-wrap edit-log-wrap"><table class="leaderboard edit-log-table"><thead><tr><th></th><th>${editLogEscape(ui("Status"))}</th><th>${editLogEscape(ui("Time"))}</th><th>${editLogEscape(ui("Target"))}</th><th>${editLogEscape(ui("Type"))}</th><th>${editLogEscape(ui("Item"))}</th><th>${editLogEscape(ui("Sheet hint"))}</th><th>${editLogEscape(ui("Changes"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${filtered.length > 80 ? `<p class="data-panel-status">${editLogEscape(ui("Showing 80 newest edits. Export includes all {count} matching edits.", { count: filtered.length }))}</p>` : ""}` : entries.length ? `<p class="data-panel-status">${editLogEscape(ui("No edits match the current filters."))}</p>` : ""}`;
}

async function persistDataWorkspace() {
  let saving = window.save({ immediate: true });
  if (saving?.then) await saving;
  renderDataWorkspace();
}

async function runGoogleSheetsImport() {
  let importButton = document.getElementById("googleSheetsImportBtn");
  let previewButton = document.getElementById("googleSheetsPreviewBtn");
  let status = document.getElementById("googleSheetsStatus");
  importButton.disabled = true;
  previewButton.disabled = true;
  previewButton.textContent = ui("Previewing...");
  if (status) status.textContent = ui("Waiting for Google sign-in.");
  try {
    let selected = document.getElementById("googleSheetsImportMode")?.value;
    let mode = ["foundation", "replace"].includes(selected)
      ? selected
      : "merge";
    let proposal = await window.importFromGoogleSheets({
      replace: mode !== "merge",
      merge: mode === "merge",
      foundation: mode === "foundation",
    });
    let presentedReport =
      window.compactImportReport?.(proposal.report, { preview: true }) ||
      proposal.report;
    pendingGoogleImportProposal = proposal;
    window.showImportReport?.(presentedReport);
    if (status) {
      status.textContent = proposal.allowed
        ? `${ui("Proposal ready.")} ${proposal.changes.length} canonical section(s) changed. ${ui("No local data changed.")}`
        : `${ui("Proposal blocked.")} ${proposal.validation.errors.map((entry) => entry.message).join(" ")}`;
    }
    importButton.disabled = !proposal.allowed;
    previewButton.textContent = ui("Previewed");
  } catch (err) {
    console.error("Google Sheets import failed", err);
    if (status) status.textContent = err.message || String(err);
    pendingGoogleImportProposal = null;
    previewButton.textContent = ui("Preview failed");
    setTimeout(() => {
      previewButton.textContent = ui("Preview import");
    }, 1600);
  } finally {
    previewButton.disabled = false;
  }
}

async function applyGoogleSheetsProposal() {
  let button = document.getElementById("googleSheetsImportBtn");
  let status = document.getElementById("googleSheetsStatus");
  if (!pendingGoogleImportProposal) return;
  button.disabled = true;
  button.textContent = ui("Applying...");
  let result = await window.applyImportProposal(pendingGoogleImportProposal);
  if (!result.ok) {
    if (status) status.textContent = result.errors.join(" ");
    button.textContent = ui("Apply failed");
    return;
  }
  pendingGoogleImportProposal = null;
  if (status)
    status.textContent = ui(
      "Proposal applied to the local draft. Publish canonical JSON separately.",
    );
  renderDataWorkspace();
  button = document.getElementById("googleSheetsImportBtn");
  button.disabled = true;
  button.textContent = ui("Applied to draft");
}

async function applyJsonImportProposal() {
  let button = document.getElementById("jsonImportApplyBtn");
  if (!pendingJsonImportProposal) return;
  button.disabled = true;
  button.textContent = ui("Applying...");
  let result = await window.applyImportProposal(pendingJsonImportProposal);
  if (!result.ok) {
    button.textContent = ui("Apply failed");
    alert(result.errors.join("\n"));
    return;
  }
  pendingJsonImportProposal = null;
  renderDataWorkspace();
  button = document.getElementById("jsonImportApplyBtn");
  button.disabled = true;
  button.textContent = ui("Applied to draft");
}

async function previewOfficialResultsFile(event) {
  let input = event.currentTarget;
  let file = input.files?.[0];
  let button = document.getElementById("officialResultsApplyBtn");
  let status = document.getElementById("officialResultsStatus");
  pendingOfficialResultsProposal = null;
  button.disabled = true;
  if (!file) return;
  if (status) status.textContent = ui("Reading and validating official results...");
  try {
    let proposal = window.proposeOfficialResultsImport(await file.text(), {
      fileName: file.name,
    });
    pendingOfficialResultsProposal = proposal;
    window.showImportReport?.(
      window.compactImportReport?.(proposal.report, { preview: true }) ||
        proposal.report,
    );
    button.disabled = !proposal.allowed;
    if (status)
      status.textContent = proposal.allowed
        ? ui(
            "Official-results refresh is ready. No local data changed; review the report before applying.",
          )
        : `${ui("Proposal blocked.")} ${proposal.validation.errors.map((entry) => entry.message).join(" ")}`;
  } catch (err) {
    console.error("Official results preview failed", err);
    if (status) status.textContent = err.message || String(err);
  } finally {
    input.value = "";
  }
}

async function applyOfficialResultsProposal() {
  let button = document.getElementById("officialResultsApplyBtn");
  let status = document.getElementById("officialResultsStatus");
  if (!pendingOfficialResultsProposal) return;
  button.disabled = true;
  button.textContent = ui("Applying...");
  let result = await window.applyImportProposal(
    pendingOfficialResultsProposal,
  );
  if (!result.ok) {
    if (status) status.textContent = result.errors.join(" ");
    button.textContent = ui("Apply failed");
    return;
  }
  pendingOfficialResultsProposal = null;
  if (status)
    status.textContent = ui(
      "Official results refreshed in the local draft. Publish canonical JSON separately.",
    );
  renderDataWorkspace();
  button = document.getElementById("officialResultsApplyBtn");
  button.disabled = true;
  button.textContent = ui("Applied to draft");
}

function handleAliasAction(event) {
  let openQueue = event.target.closest("[data-data-health-open-queue]");
  if (openQueue) {
    try {
      window.openDataHealthQueue(openQueue.dataset.dataHealthOpenQueue);
    } catch (e) {
      console.error(e);
    }
    return;
  }
  let batchPreset = event.target.closest("[data-metadata-batch-preset]");
  if (batchPreset) {
    let batchType = document.getElementById("metadataBatchType");
    let status = document.getElementById("metadataBatchStatus");
    if (batchType) batchType.value = batchPreset.dataset.metadataBatchPreset;
    if (status)
      status.textContent = ui("Batch set to {label}.", {
        label: window.metadataBatchLabel(
          batchPreset.dataset.metadataBatchPreset,
        ),
      });
    document.getElementById("metadataBatchBtn")?.focus();
    return;
  }
  let applyInferable = event.target.closest(
    "[data-apply-inferable-letterboxd]",
  );
  if (applyInferable) {
    applyInferable.disabled = true;
    window.applyInferableLetterboxdLinks?.();
    persistDataWorkspace();
    return;
  }
  let mediaCheck = event.target.closest("[data-check-tmdb-media-types]");
  if (mediaCheck) {
    runTmdbMediaTypeCheck(mediaCheck);
    return;
  }
  let retryQueue = event.target.closest("[data-retry-session-queue]");
  if (retryQueue) {
    window.retrySessionFailedLookups?.(retryQueue.dataset.retrySessionQueue);
    return;
  }

  let changed = false;
  let confirmAlias = event.target.closest("[data-alias-canonical]");
  let rejectAlias = event.target.closest("[data-alias-reject-left]");
  let removeAlias = event.target.closest("[data-alias-remove]");
  if (confirmAlias) {
    changed = window.confirmPersonAlias(
      confirmAlias.dataset.aliasCanonical,
      confirmAlias.dataset.aliasVariant,
    );
  } else if (rejectAlias) {
    changed = window.rejectPersonAlias(
      rejectAlias.dataset.aliasRejectLeft,
      rejectAlias.dataset.aliasRejectRight,
    );
  } else if (removeAlias) {
    changed = window.removePersonAlias(removeAlias.dataset.aliasRemove);
  } else if (event.target.closest("[data-alias-reset-rejected]")) {
    window.resetRejectedPersonAliases();
    changed = true;
  }
  if (changed) persistDataWorkspace();
}

// Explicit, bounded TMDB media type check (issue #42). Each click probes the
// next batch of stored TMDB IDs; session-level attempt tracking in
// checkTmdbMediaTypes keeps repeat clicks moving through the archive.
async function runTmdbMediaTypeCheck(button) {
  let statusText = (message) => {
    let status = document.getElementById("tmdbMediaTypeStatus");
    if (status) status.textContent = message;
  };
  let settings = window.getPosterSettings();
  if (!settings.tmdbCredential) {
    statusText(ui("Save a TMDB credential before checking media types."));
    return;
  }
  button.disabled = true;
  button.textContent = ui("Checking...");
  try {
    let result = await window.checkTmdbMediaTypes({
      limit: 250,
      settings,
      onProgress(done, total) {
        statusText(`${done} / ${total}`);
      },
    });
    renderDataWorkspace();
    statusText(
      ui(
        "Checked {attempted}: {ok} OK, {issues} issue(s), {failed} failed. {remaining} film(s) unchecked.",
        {
          attempted: result.attempted,
          ok: result.ok,
          issues: result.issues,
          failed: result.failed,
          remaining: result.remaining,
        },
      ),
    );
  } catch (err) {
    console.error("TMDB media type check failed", err);
    statusText(err.message || String(err));
    button.disabled = false;
    button.textContent = ui("Check TMDB media types");
  }
}

function editLogExportText() {
  let entries = filteredEditLogEntries(window.state.editLog || []);
  return window.formatGroupedEditLogForSheet?.(entries) || "";
}

async function copyEditLog() {
  let text = editLogExportText();
  if (!text.trim()) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  let textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function downloadEditLog() {
  let text = editLogExportText();
  if (!text.trim()) return false;
  let blob = new Blob([text], {
    type: "text/tab-separated-values;charset=utf-8",
  });
  let url = URL.createObjectURL(blob);
  let link = document.createElement("a");
  link.href = url;
  link.download =
    `oskars-edit-history-${new Date().toISOString().replace(/[:.]/g, "-")}.tsv`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

async function handleEditLogAction(event) {
  let undoConfirmButton = event.target.closest("[data-edit-log-undo-confirm]");
  if (undoConfirmButton) {
    let result = window.applyEditUndo?.(
      undoConfirmButton.dataset.editLogUndoConfirm,
    );
    editLogUndoPreviewId = result?.ok
      ? ""
      : undoConfirmButton.dataset.editLogUndoConfirm;
    if (result?.ok) await persistDataWorkspace();
    else renderDataWorkspace();
    return;
  }
  if (event.target.closest("[data-edit-log-undo-cancel]")) {
    editLogUndoPreviewId = "";
    renderDataWorkspace();
    return;
  }
  let undoButton = event.target.closest("[data-edit-log-undo]");
  if (undoButton) {
    editLogUndoPreviewId = undoButton.dataset.editLogUndo;
    renderDataWorkspace();
    return;
  }
  let appliedButton = event.target.closest("[data-edit-log-applied]");
  let reopenButton = event.target.closest("[data-edit-log-reopen]");
  if (appliedButton || reopenButton) {
    let id =
      appliedButton?.dataset.editLogApplied ||
      reopenButton?.dataset.editLogReopen;
    window.setEditLogApplied?.(id, Boolean(appliedButton));
    await persistDataWorkspace();
    return;
  }

  if (event.target.closest("[data-edit-log-mark-shown]")) {
    let ids = filteredEditLogEntries(window.state.editLog || [])
      .filter((entry) => !entry.appliedAt)
      .map((entry) => entry.id);
    window.setEditLogApplied?.(ids, true);
    await persistDataWorkspace();
    return;
  }

  if (event.target.closest("[data-edit-log-mark-selected]")) {
    let ids = [
      ...document.querySelectorAll("[data-edit-log-select]:checked"),
    ].map((input) => input.dataset.editLogSelect);
    window.setEditLogApplied?.(ids, true);
    await persistDataWorkspace();
    return;
  }

  let copyButton = event.target.closest("[data-copy-edit-log]");
  if (copyButton) {
    copyButton.disabled = true;
    try {
      let copied = await copyEditLog();
      copyButton.textContent = copied ? ui("Copied") : ui("Copy failed");
    } catch (err) {
      console.error("Could not copy edit log", err);
      copyButton.textContent = ui("Copy failed");
    }
    setTimeout(renderDataWorkspace, 1000);
    return;
  }
  let downloadButton = event.target.closest("[data-download-edit-log]");
  if (downloadButton) {
    downloadButton.disabled = true;
    try {
      downloadButton.textContent = downloadEditLog()
        ? ui("Downloaded")
        : ui("Download failed");
    } catch (err) {
      console.error("Could not download edit log", err);
      downloadButton.textContent = ui("Download failed");
    }
    setTimeout(renderDataWorkspace, 1000);
    return;
  }
  let clearButton = event.target.closest("[data-clear-data-log]");
  if (!clearButton) return;
  if (!confirm(ui("Clear the local sheet edit log?"))) return;
  window.clearEditLog?.();
  await persistDataWorkspace();
}

function handleEditLogFilterChange(event) {
  let statusFilter = event.target.closest("[data-edit-log-status]");
  let targetFilter = event.target.closest("[data-edit-log-target]");
  let typeFilter = event.target.closest("[data-edit-log-type]");
  if (!statusFilter && !targetFilter && !typeFilter) return;
  editLogFilters.status = statusFilter
    ? statusFilter.value
    : editLogFilters.status;
  editLogFilters.type = typeFilter ? typeFilter.value : editLogFilters.type;
  editLogFilters.target = targetFilter
    ? targetFilter.value
    : editLogFilters.target;
  renderDataWorkspace();
}

async function initializeDataWorkspace() {
  await window.ensureOskarsData();
  let settings = window.getPosterSettings();
  document.getElementById("tmdbCredentialInput").value =
    settings.tmdbCredential;
  document.getElementById("wikimediaFallbackInput").checked =
    settings.wikimediaFallback;
  let googleSheetsStatus = document.getElementById("googleSheetsStatus");
  if (googleSheetsStatus && !window.googleSheetsImportConfigured()) {
    googleSheetsStatus.textContent = ui(
      "Add googleClientId, googleSheets.spreadsheetId, and googleSheets.ranges in config.local.js.",
    );
  }
  let sheetsFoundation = window.getSheetsImportFoundation?.();
  if (googleSheetsStatus && sheetsFoundation) {
    googleSheetsStatus.textContent = ui(
      "Sheets foundation recorded from {revision}. Further runs create explicit follow-up proposals.",
      { revision: sheetsFoundation.sourceRevision },
    );
  }
  renderDataWorkspace();
  let resumedGoogleOptions = window.OSKARS_RESUMED_GOOGLE_PROPOSAL_OPTIONS;
  if (resumedGoogleOptions) {
    delete window.OSKARS_RESUMED_GOOGLE_PROPOSAL_OPTIONS;
    let resumedMode = resumedGoogleOptions.foundation
      ? "foundation"
      : resumedGoogleOptions.replace
        ? "replace"
        : "merge";
    let modeSelect = document.getElementById("googleSheetsImportMode");
    if (
      resumedMode !== "foundation" ||
      !window.hasSheetsImportFoundation?.()
    )
      modeSelect.value = resumedMode;
    await runGoogleSheetsImport();
  }

  document
    .getElementById("googleSheetsPreviewBtn")
    .addEventListener("click", runGoogleSheetsImport);
  document
    .getElementById("googleSheetsImportBtn")
    .addEventListener("click", applyGoogleSheetsProposal);
  document
    .getElementById("googleSheetsImportMode")
    .addEventListener("change", () => {
      pendingGoogleImportProposal = null;
      document.getElementById("googleSheetsImportBtn").disabled = true;
    });
  document
    .getElementById("downloadBtn")
    .addEventListener("click", window.downloadData);
  document
    .getElementById("canonicalPublicationView")
    .addEventListener("click", window.handleCanonicalPublicationAction);
  document.getElementById("uploadInput").addEventListener("change", (event) => {
    window.uploadData(event, {
      render: false,
      mode:
        document.getElementById("restoreModeSelect")?.value === "replace"
          ? "replace"
          : "merge",
      onPreview: async (proposal) => {
        pendingJsonImportProposal = proposal;
        window.showImportReport?.(
          window.compactImportReport?.(proposal.report, { preview: true }) ||
            proposal.report,
        );
        document.getElementById("jsonImportApplyBtn").disabled =
          !proposal.allowed;
      },
    });
  });
  document
    .getElementById("jsonImportApplyBtn")
    .addEventListener("click", applyJsonImportProposal);
  document
    .getElementById("officialResultsInput")
    .addEventListener("change", previewOfficialResultsFile);
  document
    .getElementById("officialResultsApplyBtn")
    .addEventListener("click", applyOfficialResultsProposal);
  document
    .getElementById("dismissImportReport")
    .addEventListener("click", window.hideImportReport);
  document
    .getElementById("dataHealthView")
    .addEventListener("click", handleAliasAction);
  document
    .getElementById("editLogView")
    .addEventListener("click", handleEditLogAction);
  document
    .getElementById("editLogView")
    .addEventListener("change", handleEditLogFilterChange);
  document
    .getElementById("metadataBatchReport")
    .addEventListener("click", window.handleMetadataBatchReportAction);
  document
    .getElementById("imageSettingsForm")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      window.savePosterSettings({
        tmdbCredential: document.getElementById("tmdbCredentialInput").value,
        wikimediaFallback: document.getElementById("wikimediaFallbackInput")
          .checked,
      });
      event.currentTarget.querySelector("button").textContent = ui("Saved");
      setTimeout(() => {
        event.currentTarget.querySelector("button").textContent = ui(
          "Save image settings",
        );
      }, 1200);
    });
  document
    .getElementById("metadataBatchBtn")
    .addEventListener("click", window.runMetadataBatch);
  document
    .getElementById("metadataEverythingBtn")
    .addEventListener("click", window.runAllMetadataBatches);
  document
    .getElementById("metadataNonArchiveBtn")
    .addEventListener("click", window.runNonArchiveMetadataBatches);
  document
    .getElementById("clearOpinionsBtn")
    .addEventListener("click", async () => {
      if (
        !confirm(
          ui(
            "Delete all personal opinion data? This removes every award placement, rating, personal score, review, interest tier, and note, and resets the all-time order to the rating/release-year/title default. Films, watch history, and metadata stay. A backup downloads first.",
          ),
        )
      )
        return;
      let button = document.getElementById("clearOpinionsBtn");
      button.disabled = true;
      button.textContent = ui("Deleting...");
      let stamp = new Date().toISOString().replace(/[:.]/g, "-");
      window.downloadDataSnapshot?.(
        `oskars-data-backup-before-opinion-clear-${stamp}.json`,
      );
      let report = window.clearOpinionData();
      let saving = window.save({ immediate: true, rebuild: false });
      if (saving?.then) await saving;
      renderDataWorkspace();
      let status = document.getElementById("clearOpinionsStatus");
      if (status)
        status.textContent = ui(
          "Removed {awards} award placements, {ratings} ratings, {scores} scores, {reviews} reviews, {rewatches} rewatch marks, {tiers} interest tiers, and {notes} notes, and reset {ranks} film rank(s) to the default order.",
          {
            awards: report.awards,
            ratings: report.ratings,
            ranks: report.ranks,
            scores: report.scores,
            reviews: report.reviews,
            rewatches: report.rewatchIntents,
            tiers: report.tiers,
            notes: report.notes,
          },
        );
      button = document.getElementById("clearOpinionsBtn");
      button.disabled = false;
      button.textContent = ui("Deleted");
      setTimeout(() => {
        button.textContent = ui("Delete opinions");
      }, 1400);
    });
  document
    .getElementById("clearDataBtn")
    .addEventListener("click", async () => {
      if (!confirm(ui("Clear all locally stored The Oskars data?"))) return;
      let button = document.getElementById("clearDataBtn");
      button.disabled = true;
      button.textContent = ui("Clearing...");
      let cleared = await window.clearStoredOskarsData();
      renderDataWorkspace();
      button = document.getElementById("clearDataBtn");
      button.disabled = false;
      button.textContent = cleared ? ui("Cleared") : ui("Clear failed");
      setTimeout(() => {
        button.textContent = ui("Clear all data");
      }, 1400);
    });
  function dangerZoneYearBound(input) {
    let value = Number(input.value);
    return input.value && Number.isFinite(value) ? value : undefined;
  }
  function dangerZoneYearScopeText(fromYear, toYear) {
    if (fromYear == null && toYear == null) return ui("every film");
    if (fromYear != null && toYear != null)
      return ui("{from}–{to}", { from: fromYear, to: toYear });
    if (fromYear != null) return ui("{from} onward", { from: fromYear });
    return ui("through {to}", { to: toYear });
  }
  document
    .getElementById("resetRankingForm")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      let form = event.currentTarget;
      let fromYear = dangerZoneYearBound(
        document.getElementById("resetRankingFromYear"),
      );
      let toYear = dangerZoneYearBound(
        document.getElementById("resetRankingToYear"),
      );
      if (
        !confirm(
          ui(
            "Reset the all-time order for {scope} to the rating / release-year / title default? Ratings and awards are untouched. A backup downloads first.",
            { scope: dangerZoneYearScopeText(fromYear, toYear) },
          ),
        )
      )
        return;
      let button = form.querySelector("button");
      button.disabled = true;
      button.textContent = ui("Resetting...");
      let stamp = new Date().toISOString().replace(/[:.]/g, "-");
      window.downloadDataSnapshot?.(
        `oskars-data-backup-before-ranking-reset-${stamp}.json`,
      );
      let result = window.resetRankingToDefaultOrder({ fromYear, toYear });
      let saving = window.save({ immediate: true, rebuild: false });
      if (saving?.then) await saving;
      renderDataWorkspace();
      let status = document.getElementById("resetRankingStatus");
      if (status)
        status.textContent = ui("Reset {count} film rank(s).", {
          count: result.changed,
        });
      button = document
        .getElementById("resetRankingForm")
        .querySelector("button");
      button.disabled = false;
      button.textContent = ui("Reset");
      setTimeout(() => {
        button.textContent = ui("Reset rankings");
      }, 1400);
    });
  document
    .getElementById("clearAwardsForm")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      let form = event.currentTarget;
      let periodTypes = [
        ...form.querySelectorAll('input[name="periodType"]:checked'),
      ].map((input) => input.value);
      let fromYear = dangerZoneYearBound(
        document.getElementById("clearAwardsFromYear"),
      );
      let toYear = dangerZoneYearBound(
        document.getElementById("clearAwardsToYear"),
      );
      if (!periodTypes.length) {
        window.alert?.(ui("Choose at least one period type."));
        return;
      }
      if (
        !confirm(
          ui(
            "Remove awards for {scope}? Ratings, ranks, and everything else are untouched. A backup downloads first.",
            { scope: dangerZoneYearScopeText(fromYear, toYear) },
          ),
        )
      )
        return;
      let button = form.querySelector("button");
      button.disabled = true;
      button.textContent = ui("Removing...");
      let stamp = new Date().toISOString().replace(/[:.]/g, "-");
      window.downloadDataSnapshot?.(
        `oskars-data-backup-before-award-clear-${stamp}.json`,
      );
      let result = window.clearAwardsInScope({ periodTypes, fromYear, toYear });
      let saving = window.save({ immediate: true, rebuild: false });
      if (saving?.then) await saving;
      renderDataWorkspace();
      let status = document.getElementById("clearAwardsStatus");
      if (status)
        status.textContent = ui("Removed {count} nomination(s).", {
          count: result.removed,
        });
      button = document
        .getElementById("clearAwardsForm")
        .querySelector("button");
      button.disabled = false;
      button.textContent = ui("Removed");
      setTimeout(() => {
        button.textContent = ui("Remove awards");
      }, 1400);
    });
}

let legacyIntakeId = window.pageQueryParam?.("intake") || "";
if (legacyIntakeId) {
  window.location.replace(window.intakePageUrl(legacyIntakeId));
} else {
  initializeDataWorkspace().catch((err) => {
    console.error("Failed to initialize The Oskars Data", err);
    document.getElementById("dataHealthView").innerHTML =
      `<div class="detail-empty"><h2>${window.pageEscape(ui("Could not load data tools"))}</h2><p>${window.pageEscape(err.message)}</p></div>`;
  });
}
