/** @file Controls the data workspace for imports, backups, health, metadata batches, and edit history. */

let ui = window.uiText || ((text) => text);
let pendingJsonImportProposal = null;
let pendingLetterboxdImportProposal = null;
let opinionRebuildComparisonRevealed = false;

function renderDataWorkspace() {
  let finishRenderTimer = window.startOskarsPerformance?.(
    "data:renderWorkspace",
  );
  renderEditLogView(document.getElementById("editLogView"));
  window.renderCanonicalPublication?.(
    document.getElementById("canonicalPublicationView"),
  );
  window.renderPublicProfilePublication?.(
    document.getElementById("publicProfilePublicationView"),
  );
  renderOpinionRebuildView(document.getElementById("opinionRebuildView"));
  window.renderOwnerDataToolsLink?.();
  window.refreshMetadataBatchActionLabels?.();
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

function showDataTechnicalError(status, summary, error) {
  status.innerHTML = `${editLogEscape(ui(summary))}${window.renderTechnicalDetails?.({ text: error?.message || String(error), escape: editLogEscape }) || ""}`;
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

function opinionRebuildRowsHtml(rows, emptyText, rowHtml) {
  if (!rows.length) return `<p class="data-panel-status">${editLogEscape(emptyText)}</p>`;
  return `<ul class="opinion-rebuild-differences">${rows
    .slice(0, 20)
    .map(rowHtml)
    .join("")}</ul>`;
}

function renderOpinionRebuildComparison(comparison) {
  let ratingChanges = comparison.ratingRows.filter((row) => row.delta !== 0);
  let rankChanges = comparison.rankRows.filter((row) => row.delta !== 0);
  return `<div class="opinion-rebuild-comparison">
    <section><h3>${editLogEscape(ui("Biggest rating changes"))}</h3>${opinionRebuildRowsHtml(
      ratingChanges,
      ui("No rebuilt rating changes to compare yet."),
      (row) => `<li><strong>${editLogEscape(row.title)}</strong><span>${row.before.toFixed(1)} → ${row.after.toFixed(1)} ★</span></li>`,
    )}</section>
    <section><h3>${editLogEscape(ui("Biggest ranking moves"))}</h3>${opinionRebuildRowsHtml(
      rankChanges,
      ui("No confirmed rebuilt ranks to compare yet."),
      (row) => `<li><strong>${editLogEscape(row.title)}</strong><span>${editLogEscape(row.scope)} #${row.before} → #${row.after}</span></li>`,
    )}</section>
    <section><h3>${editLogEscape(ui("Award placement changes"))}</h3>${opinionRebuildRowsHtml(
      comparison.awardRows,
      ui("No award placement changes to compare yet."),
      (row) => {
        let record = row.after || row.before;
        return `<li><strong>${editLogEscape(record.title)}</strong><span>${editLogEscape(record.year)} · ${editLogEscape(record.category)} · ${row.before ? editLogEscape(ui("removed")) : editLogEscape(ui("added"))} #${record.placement}</span></li>`;
      },
    )}</section>
  </div>`;
}

function renderOpinionRebuildView(container) {
  if (!container) return;
  let comparison = window.compareOpinionRebuild?.();
  if (!comparison) {
    container.classList.remove("opinion-rebuild-active");
    container.innerHTML = `<div>
      <h2>${editLogEscape(ui("Blind opinion rebuild"))}</h2>
      <p>${editLogEscape(ui("Hide your current ratings, rankings, personal awards, and other opinions while you rebuild them from scratch. The originals stay private and can be restored or deliberately compared at any time."))}</p>
    </div><div class="data-actions"><button id="startOpinionRebuildBtn" type="button">${editLogEscape(ui("Start blind rebuild"))}</button></div>`;
    return;
  }
  container.classList.add("opinion-rebuild-active");
  let complete = comparison.status === "complete";
  let comparisonVisible = complete || opinionRebuildComparisonRevealed;
  let started = editLogTimeLabel(comparison.startedAt);
  container.innerHTML = `<div class="opinion-rebuild-heading">
    <div><p class="eyebrow">${editLogEscape(ui(complete ? "Blind rebuild complete" : "Blind rebuild active"))}</p><h2>${editLogEscape(ui(complete ? "Compare your original and rebuilt opinions" : "Your original opinions are hidden"))}</h2><p>${editLogEscape(ui(complete ? "The rebuilt opinions are now active. Your private baseline remains available here until you close this comparison." : "Started {date}. Ordinary pages use only the opinions you add during this rebuild.", { date: started }))}</p></div>
    ${complete ? "" : `<a class="button-link" href="build.html">${editLogEscape(ui("Continue rebuilding"))}</a>`}
  </div>
  <div class="opinion-rebuild-progress">
    <div><b>${comparison.currentRated}</b><span>${editLogEscape(ui("ratings rebuilt"))}</span></div>
    <div><b>${comparison.comparedRanks}</b><span>${editLogEscape(ui("ranks comparable"))}</span></div>
    <div><b>${comparison.currentAwardCount}</b><span>${editLogEscape(ui("award placements rebuilt"))}</span></div>
  </div>
  <p class="data-panel-status">${editLogEscape(ui("The baseline contains {ratings} ratings and {awards} award placements.", { ratings: comparison.baselineRated, awards: comparison.baselineAwardCount }))}</p>
  <div class="data-actions">
    ${complete ? "" : `<button id="toggleOpinionRebuildComparisonBtn" type="button">${editLogEscape(ui(opinionRebuildComparisonRevealed ? "Hide comparison" : "Compare progress"))}</button>`}
    <button id="restoreOpinionRebuildBtn" type="button" class="button-secondary">${editLogEscape(ui("Restore original opinions"))}</button>
    ${complete ? `<button id="closeOpinionRebuildBtn" type="button">${editLogEscape(ui("Close comparison"))}</button>` : `<button id="finishOpinionRebuildBtn" type="button">${editLogEscape(ui("Finish and compare"))}</button>`}
  </div>
  ${comparisonVisible ? renderOpinionRebuildComparison(comparison) : ""}`;
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
  window.enhanceHorizontalScroll?.(container);
}

async function persistDataWorkspace() {
  let saving = window.save({ immediate: true });
  if (saving?.then) await saving;
  renderDataWorkspace();
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
  button.textContent = ui("Changes added");
  // Not awaited: see applyLetterboxdImportProposal's identical call. A
  // "replace" restore of the owner's own already-enriched backup is a
  // cheap no-op here; a "merge" restore or a foreign/partial backup is
  // exactly the case this actually helps.
  window.runPostImportMetadataFetch?.();
}

async function previewLetterboxdZip(event) {
  let input = event.currentTarget;
  let file = input.files?.[0];
  let button = document.getElementById("letterboxdImportApplyBtn");
  let status = document.getElementById("letterboxdImportStatus");
  let finishTimer = window.startOskarsPerformance?.("letterboxd:preview");
  pendingLetterboxdImportProposal = null;
  button.disabled = true;
  if (!file) {
    finishTimer?.("no file selected");
    return;
  }
  if (!/\.zip$/i.test(file.name)) {
    status.textContent = ui("Choose the original .zip file exported by Letterboxd.");
    input.value = "";
    finishTimer?.("rejected filename");
    return;
  }
  status.textContent = ui("Reading and validating the Letterboxd export locally...");
  try {
    let proposal = await window.proposeLetterboxdZipImport(file, {
      fileName: file.name,
    });
    pendingLetterboxdImportProposal = proposal;
    window.showImportReport?.(
      window.compactImportReport?.(proposal.report, { preview: true }) ||
        proposal.report,
    );
    button.disabled = !proposal.allowed;
    status.textContent = proposal.allowed
      ? ui(
          "Your Letterboxd review is ready. Nothing has changed yet; check the report, then use the reviewed changes.",
        )
      : ui("This Letterboxd import cannot be used yet. Review the problems below and try again with a corrected export.");
    finishTimer?.(`${proposal.report.filmsParsed || 0} watched film(s)`);
  } catch (err) {
    console.error("Letterboxd ZIP preview failed", err);
    showDataTechnicalError(
      status,
      "The Letterboxd review could not be prepared. Choose the original export ZIP and try again.",
      err,
    );
    finishTimer?.("preview failed");
  } finally {
    input.value = "";
  }
}

async function applyLetterboxdImportProposal() {
  let button = document.getElementById("letterboxdImportApplyBtn");
  let status = document.getElementById("letterboxdImportStatus");
  if (!pendingLetterboxdImportProposal) return;
  button.disabled = true;
  button.textContent = ui("Applying...");
  let result = await window.applyImportProposal(
    pendingLetterboxdImportProposal,
  );
  if (!result.ok) {
    status.textContent = result.errors.join(" ");
    button.textContent = ui("Apply failed");
    return;
  }
  pendingLetterboxdImportProposal = null;
  status.textContent = ui(
    "The reviewed Letterboxd changes are now in this browser. Awards and rankings were left unchanged.",
  );
  renderDataWorkspace();
  button = document.getElementById("letterboxdImportApplyBtn");
  button.disabled = true;
  button.textContent = ui("Changes added");
  // Not awaited: this is a long-running, visible next step (scrolls to and
  // drives the Fetch metadata panel below), not something the apply button
  // itself should block on.
  window.runPostImportMetadataFetch?.();
}

function handleAliasAction(event) {
  let openQueue = event.target.closest("[data-data-health-open-queue]");
  if (openQueue) {
    try {
      window.openDataHealthQueue(
        openQueue.dataset.dataHealthOpenQueue,
        undefined,
        openQueue.dataset.dataHealthQueueDetail,
      );
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

// Explicit, bounded watched-film TMDB link check (issues #42/#280). Each click
// probes the next batch of stored TMDB IDs; session-level attempt tracking in
// checkTmdbMediaTypes keeps repeat clicks moving through the archive.
async function runTmdbMediaTypeCheck(button) {
  let statusText = (message) => {
    let status = document.getElementById("tmdbMediaTypeStatus");
    if (status) status.textContent = message;
  };
  button.disabled = true;
  button.textContent = ui("Checking...");
  try {
    let result = await window.checkTmdbMediaTypes({
      limit: 250,
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
    console.error("TMDB link check failed", err);
    statusText(err.message || String(err));
    button.disabled = false;
    button.textContent = ui("Check TMDB links");
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
  if (
    !confirm(
      ui(
        "Clear the local edit history? This cannot be undone, but it does not change any films, ratings, rankings, awards, or watch history.",
      ),
    )
  )
    return;
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

// Shared owner of the Data page's destructive "danger zone" actions (clear
// opinions, reset ranking, remove awards): every one of them downloads a
// backup before mutating, so a future 4th destructive action reuses this
// safeguard by construction instead of needing to remember to copy it.
// Confirmation happens in the caller, before this runs.
/**
 * Runs one danger-zone destructive action: downloads a stamped backup,
 * disables/relabels the button, applies the mutation, saves, re-renders the
 * page, updates a status line, then restores the button label after a
 * pause. The button is re-selected from the DOM both before and after
 * `renderDataWorkspace()`, since that re-render replaces the button node.
 * @param {Object} options Action definition.
 * @param {Function} options.reselectButton Re-finds the current button element.
 * @param {string} options.busyText Button label while running.
 * @param {string} options.doneText Button label immediately after completion.
 * @param {string} options.restingText Button label restored after the pause.
 * @param {string} options.backupFilenamePrefix Backup filename prefix before the timestamp.
 * @param {Function} options.perform Applies the mutation; returns a result for statusText.
 * @param {string} options.statusElementId Status element id to update.
 * @param {Function} options.statusText Formats the result into status text.
 */
async function runDangerZoneAction({
  reselectButton,
  busyText,
  doneText,
  restingText,
  backupFilenamePrefix,
  perform,
  statusElementId,
  statusText,
  statusAction,
}) {
  let button = reselectButton();
  button.disabled = true;
  button.textContent = busyText;
  let stamp = new Date().toISOString().replace(/[:.]/g, "-");
  window.downloadDataSnapshot?.(`${backupFilenamePrefix}-${stamp}.json`);
  let result = perform();
  let saving = window.save({ immediate: true, rebuild: false });
  if (saving?.then) await saving;
  renderDataWorkspace();
  let status = document.getElementById(statusElementId);
  if (status) {
    status.textContent = statusText(result);
    if (statusAction) {
      let action = statusAction(result);
      status.insertAdjacentHTML(
        "beforeend",
        ` <a class="button-link data-journey-action" href="${editLogEscape(action.href)}">${editLogEscape(action.label)} →</a>`,
      );
    }
  }
  button = reselectButton();
  button.disabled = false;
  button.textContent = doneText;
  setTimeout(() => {
    button.textContent = restingText;
  }, 1400);
}

async function persistOpinionRebuildChange() {
  let saving = window.save({ immediate: true, rebuild: false });
  if (saving?.then) await saving;
  renderDataWorkspace();
}

async function handleOpinionRebuildAction(event) {
  if (event.target.closest("#toggleOpinionRebuildComparisonBtn")) {
    opinionRebuildComparisonRevealed = !opinionRebuildComparisonRevealed;
    renderOpinionRebuildView(document.getElementById("opinionRebuildView"));
    return;
  }
  if (event.target.closest("#startOpinionRebuildBtn")) {
    if (
      !confirm(
        ui(
          "Start a blind opinion rebuild? Your current opinions will be stored privately and hidden from ordinary pages while you rebuild. A backup downloads first.",
        ),
      )
    )
      return;
    window.downloadDataSnapshot?.(
      `oskars-data-backup-before-blind-rebuild-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    window.startOpinionRebuild();
    opinionRebuildComparisonRevealed = false;
    await persistOpinionRebuildChange();
    return;
  }
  if (event.target.closest("#restoreOpinionRebuildBtn")) {
    if (
      !confirm(
        ui(
          "Restore the original opinions? Opinions added during this rebuild will be discarded, while factual archive changes stay. A backup of the current rebuild downloads first.",
        ),
      )
    )
      return;
    window.downloadDataSnapshot?.(
      `oskars-data-backup-before-opinion-restore-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    window.restoreOpinionRebuildBaseline();
    opinionRebuildComparisonRevealed = false;
    await persistOpinionRebuildChange();
    return;
  }
  if (event.target.closest("#finishOpinionRebuildBtn")) {
    if (
      !confirm(
        ui(
          "Finish the blind rebuild and compare with the originals? Rebuilt opinions become final, while the private baseline stays available until you close the comparison. A backup downloads first.",
        ),
      )
    )
      return;
    window.downloadDataSnapshot?.(
      `oskars-data-backup-before-opinion-rebuild-finish-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    window.finishOpinionRebuild();
    opinionRebuildComparisonRevealed = true;
    await persistOpinionRebuildChange();
    return;
  }
  if (event.target.closest("#closeOpinionRebuildBtn")) {
    if (
      !confirm(
        ui(
          "Close this comparison? The rebuilt opinions stay, but the original baseline will be removed after a backup downloads.",
        ),
      )
    )
      return;
    window.downloadDataSnapshot?.(
      `oskars-data-backup-before-opinion-comparison-close-${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.json`,
    );
    window.discardOpinionRebuildBaseline();
    opinionRebuildComparisonRevealed = false;
    await persistOpinionRebuildChange();
  }
}

async function initializeDataWorkspace() {
  await window.ensureOskarsData();
  if (window.oskarsAccountAccessBlocked?.()) return;
  document
    .getElementById("opinionRebuildView")
    ?.addEventListener("click", handleOpinionRebuildAction);
  renderDataWorkspace();
  document
    .getElementById("downloadBtn")
    .addEventListener("click", window.downloadData);
  document
    .getElementById("letterboxdZipInput")
    .addEventListener("change", previewLetterboxdZip);
  document
    .getElementById("letterboxdImportApplyBtn")
    .addEventListener("click", applyLetterboxdImportProposal);
  document
    .getElementById("canonicalPublicationView")
    .addEventListener("click", window.handleCanonicalPublicationAction);
  document
    .getElementById("publicProfilePublicationView")
    .addEventListener("click", window.handlePublicProfilePublicationAction);
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
      await runDangerZoneAction({
        reselectButton: () => document.getElementById("clearOpinionsBtn"),
        busyText: ui("Deleting..."),
        doneText: ui("Deleted"),
        restingText: ui("Delete opinions"),
        backupFilenamePrefix: "oskars-data-backup-before-opinion-clear",
        perform: () => {
          let report = window.clearOpinionData();
          report.watchedRemaining = window.watchedFilmsForRating().length;
          return report;
        },
        statusElementId: "clearOpinionsStatus",
        statusText: (report) =>
          ui(
            "Removed {awards} award placements, {ratings} ratings, {scores} scores, {reviews} reviews, {rewatches} rewatch marks, {tiers} interest tiers, and {notes} notes, and reset {ranks} film rank(s) to the default order. {watched} watched work(s) remain ready to rebuild.",
            {
              awards: report.awards,
              ratings: report.ratings,
              ranks: report.ranks,
              scores: report.scores,
              reviews: report.reviews,
              rewatches: report.rewatchIntents,
              tiers: report.tiers,
              notes: report.notes,
              watched: report.watchedRemaining,
            },
          ),
        statusAction: () => ({ href: "build.html", label: ui("Start rebuilding") }),
      });
    });
  document
    .getElementById("clearDataBtn")
    .addEventListener("click", async () => {
      if (
        !confirm(
          ui(
            "Delete all The Oskars data stored in this browser? This cannot be undone here. Download a backup first if you may want to restore it. Published and cloud copies are not deleted.",
          ),
        )
      )
        return;
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
      await runDangerZoneAction({
        reselectButton: () =>
          document.getElementById("resetRankingForm").querySelector("button"),
        busyText: ui("Resetting..."),
        doneText: ui("Reset"),
        restingText: ui("Reset rankings"),
        backupFilenamePrefix: "oskars-data-backup-before-ranking-reset",
        perform: () => window.resetRankingToDefaultOrder({ fromYear, toYear }),
        statusElementId: "resetRankingStatus",
        statusText: (result) =>
          ui("Reset {count} film rank(s).", { count: result.changed }),
      });
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
      await runDangerZoneAction({
        reselectButton: () =>
          document.getElementById("clearAwardsForm").querySelector("button"),
        busyText: ui("Removing..."),
        doneText: ui("Removed"),
        restingText: ui("Remove awards"),
        backupFilenamePrefix: "oskars-data-backup-before-award-clear",
        perform: () =>
          window.clearAwardsInScope({ periodTypes, fromYear, toYear }),
        statusElementId: "clearAwardsStatus",
        statusText: (result) =>
          ui("Removed {count} nomination(s).", { count: result.removed }),
      });
    });
}

let legacyIntakeId = window.pageQueryParam?.("intake") || "";
if (legacyIntakeId) {
  window.location.replace(
    window.prepareOskarsAccountNavigation(
      window.intakePageUrl(legacyIntakeId),
    ),
  );
} else {
  initializeDataWorkspace().catch((err) => {
    console.error("Failed to initialize The Oskars Data", err);
    document.getElementById("dataHealthView").innerHTML =
      `<div class="detail-empty"><h2>${window.pageEscape(ui("Could not load data tools"))}</h2><p>${window.pageEscape(err.message)}</p></div>`;
  });
}
