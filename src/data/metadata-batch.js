/**
 * @file Coordinates Data-page metadata, poster, and portrait batches,
 * including progress UI, combined results, and explicit session retries.
 */

function metadataBatchUi(text, values) {
  return window.uiText?.(text, values) ?? text;
}

function metadataBatchWatchedFilms() {
  let films = new Map();
  Object.values(window.state.filmsById || {}).forEach((film) =>
    films.set(film.id, film),
  );
  (window.state.watchedOther || []).forEach((film) =>
    films.set(film.id, film),
  );
  return [...films.values()];
}

/**
 * Returns the localized label for a metadata batch type.
 * @param {string} type Batch type identifier.
 * @returns {string} User-facing batch label.
 */
window.metadataBatchLabel = function (type) {
  return metadataBatchUi(
    {
      "film-metadata": "watched film metadata",
      "watchlist-metadata": "watchlist metadata",
      "film-posters": "watched film posters",
      "watchlist-posters": "watchlist posters",
      "non-archive-metadata": "not-watched film metadata",
      "non-archive-posters": "not-watched film posters",
      "person-portraits": "person portraits",
    }[type] || "metadata",
  );
};

/**
 * Counts items currently eligible for a metadata batch.
 * @param {string} type Batch type identifier.
 * @param {Object} settings Saved metadata and image-provider settings.
 * @returns {number} Number of eligible items.
 */
window.metadataBatchPreviewCount = function (type, settings) {
  if (type === "film-metadata")
    return metadataBatchWatchedFilms().filter(window.filmNeedsMetadataLookup)
      .length;
  if (type === "watchlist-metadata")
    return (window.state.watchlist || []).filter(
      window.watchlistNeedsMetadataLookup,
    ).length;
  if (type === "film-posters")
    return metadataBatchWatchedFilms().filter((film) =>
      window.filmNeedsPosterLookup(film, settings),
    ).length;
  if (type === "watchlist-posters")
    return (window.state.watchlist || []).filter((item) =>
      window.watchlistNeedsPosterLookup(item, settings),
    ).length;
  if (type === "non-archive-metadata")
    return (window.state.watchlist || []).filter(
      (item) =>
        !window.findWatchlistArchiveFilm?.(item) &&
        window.watchlistNeedsMetadataLookup(item),
    ).length;
  if (type === "non-archive-posters")
    return (window.state.watchlist || []).filter(
      (item) =>
        !window.findWatchlistArchiveFilm?.(item) &&
        window.watchlistNeedsPosterLookup(item, settings),
    ).length;
  if (type === "person-portraits")
    return Object.values(
      window.ensurePeopleIndex?.() || window.state.peopleById || {},
    ).filter(
      (person) =>
        person?.id &&
        !person.portrait &&
        !window.state.personPortraits?.[person.id],
    ).length;
  return 0;
};

let lastMetadataBatch = null;
window.lastMetadataBatch = null;
let metadataBatchTypes = [
  "film-metadata",
  "watchlist-metadata",
  "film-posters",
  "watchlist-posters",
  "person-portraits",
];
let nonArchiveMetadataBatchTypes = [
  "non-archive-metadata",
  "non-archive-posters",
];

function metadataReportEscape(value) {
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

function renderMetadataBatchReport(result, context) {
  let finishRenderTimer = window.startOskarsPerformance?.(
    "metadataBatch:renderReport",
  );
  let report = document.getElementById("metadataBatchReport");
  if (!report) return;
  let failures = (result.failures || []).slice(0, 12);
  let skipped = (result.skippedItems || []).slice(0, 8);
  let failureRows = failures
    .map(
      (item) =>
        `<tr><td>${metadataReportEscape(item.title)}</td><td>${metadataReportEscape(item.year)}</td><td>${metadataReportEscape(item.reason)}</td></tr>`,
    )
    .join("");
  let skippedRows = skipped
    .map(
      (item) =>
        `<tr><td>${metadataReportEscape(item.title)}</td><td>${metadataReportEscape(item.year)}</td><td>${metadataReportEscape(item.reason)}</td></tr>`,
    )
    .join("");
  let reportHeaders = [
    metadataBatchUi("Item"),
    metadataBatchUi("Year"),
    metadataBatchUi("Reason"),
  ].map(metadataReportEscape);
  let hasDetails = failureRows || skippedRows;
  report.hidden = !hasDetails;
  report.innerHTML = hasDetails
    ? `
    ${failureRows ? `<h3>${metadataReportEscape(metadataBatchUi("Failed lookups"))}</h3>${window.renderLeaderboardTable({ headers: reportHeaders, rows: failureRows, classes: "metadata-batch-table" })}${(result.failures || []).length > failures.length ? `<p class="data-panel-status">${metadataReportEscape(metadataBatchUi("Showing {shown} of {total} failures.", { shown: failures.length, total: result.failures.length }))}</p>` : ""}` : ""}
    ${skippedRows ? `<h3>${metadataReportEscape(metadataBatchUi("Skipped this session"))}</h3>${window.renderLeaderboardTable({ headers: reportHeaders, rows: skippedRows, classes: "metadata-batch-table" })}${(result.skippedItems || []).length > skipped.length ? `<p class="data-panel-status">${metadataReportEscape(metadataBatchUi("Showing {shown} of {total} skipped items.", { shown: skipped.length, total: result.skippedItems.length }))}</p>` : ""}` : ""}
    ${result.failed || result.skipped ? `<div class="data-actions"><button type="button" data-retry-metadata-batch>${metadataReportEscape(metadataBatchUi("Retry this batch with previous attempts included"))}</button></div>` : ""}
  `
    : "";
  lastMetadataBatch = context;
  window.lastMetadataBatch = Object.assign({}, context, {
    attempted: Number(result.attempted) || 0,
    found: Number(result.found) || 0,
    failed: Number(result.failed) || 0,
    skipped: Number(result.skipped) || 0,
  });
  finishRenderTimer?.(
    `${failures.length} failure row(s), ${skipped.length} skipped row(s)`,
  );
}
/**
 * Renders bounded failure and skipped-item details for a completed batch.
 * @param {MetadataBatchResult} result Batch result.
 * @param {Object} context Retry context retained for the report action.
 */
window.renderMetadataBatchReport = renderMetadataBatchReport;

function metadataBatchElements() {
  return {
    button: document.getElementById("metadataBatchBtn"),
    everythingButton: document.getElementById("metadataEverythingBtn"),
    nonArchiveButton: document.getElementById("metadataNonArchiveBtn"),
    progress: document.getElementById("metadataBatchProgress"),
    status: document.getElementById("metadataBatchStatus"),
    report: document.getElementById("metadataBatchReport"),
    typeInput: document.getElementById("metadataBatchType"),
    limitInput: document.getElementById("metadataBatchLimit"),
  };
}

function metadataBatchSettings() {
  return window.savePosterSettings({
    tmdbCredential: document.getElementById("tmdbCredentialInput").value,
    wikimediaFallback: document.getElementById("wikimediaFallbackInput")
      .checked,
  });
}

function emptyMetadataBatchResult() {
  return {
    attempted: 0,
    found: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    skippedItems: [],
  };
}

function combineMetadataBatchResults(results) {
  return results.reduce((total, result) => {
    total.attempted += Number(result?.attempted) || 0;
    total.found += Number(result?.found) || 0;
    total.failed += Number(result?.failed) || 0;
    total.skipped += Number(result?.skipped) || 0;
    total.failures.push(...(result?.failures || []));
    total.skippedItems.push(...(result?.skippedItems || []));
    return total;
  }, emptyMetadataBatchResult());
}

async function runMetadataBatchType(type, options) {
  let source =
    type === "film-metadata" || type === "film-posters"
      ? metadataBatchWatchedFilms()
      : type === "watchlist-metadata" ||
          type === "watchlist-posters" ||
          type === "non-archive-metadata" ||
          type === "non-archive-posters"
        ? window.state.watchlist || []
        : Object.values(
            window.ensurePeopleIndex?.() || window.state.peopleById || {},
          );
  if (type === "non-archive-metadata" || type === "non-archive-posters") {
    source = source.filter((item) => !window.findWatchlistArchiveFilm?.(item));
  }
  if (options.filterIds) {
    source = source.filter((item) =>
      options.filterIds.has(
        String(item.id || window.watchlistItemId?.(item) || ""),
      ),
    );
  }
  let batchOptions = Object.assign({}, options, {
    concurrency: type.includes("metadata") ? 2 : 3,
  });
  if (type === "film-metadata")
    return window.fetchFilmMetadata(source, batchOptions);
  if (type === "watchlist-metadata")
    return window.fetchWatchlistMetadata(source, batchOptions);
  if (type === "non-archive-metadata")
    return window.fetchWatchlistMetadata(source, batchOptions);
  if (type === "film-posters")
    return window.fetchFilmPosters(source, batchOptions);
  if (type === "watchlist-posters")
    return window.fetchWatchlistPosters(source, batchOptions);
  if (type === "non-archive-posters")
    return window.fetchWatchlistPosters(source, batchOptions);
  if (type === "person-portraits")
    return window.fetchPersonPortraits(source, batchOptions);
  throw new Error(metadataBatchUi("Unknown metadata batch type."));
}

function metadataBatchRequiresTmdb(type) {
  return type.includes("metadata") || type === "person-portraits";
}

// Explicit retry of this session's failed lookups for one queue type
// (issue #44). Reuses the shared batch progress/status elements; force
// bypasses the per-session attempt guard for exactly the failed items.
/**
 * Retries the failed items recorded for one session batch type.
 * @param {string} type Batch type identifier.
 * @returns {Promise<void>} Completion after the retry UI is restored.
 */
window.retrySessionFailedLookups = async function (type) {
  let elements = metadataBatchElements();
  let { progress, status } = elements;
  let label = window.metadataBatchLabel(type);
  let failures = window.metadataSessionFailureList?.(type) || [];
  if (!failures.length) {
    if (status)
      status.textContent = metadataBatchUi(
        "No failed {label} lookups this session.",
        { label },
      );
    return;
  }
  let settings = metadataBatchSettings();
  if (!settings.tmdbCredential && metadataBatchRequiresTmdb(type)) {
    if (status)
      status.textContent = metadataBatchUi(
        "Save a TMDB credential before fetching this batch.",
      );
    return;
  }
  let filterIds = new Set(failures.map((failure) => String(failure.id)));
  setMetadataBatchDisabled(elements, true);
  prepareMetadataBatchUi(elements);
  if (progress) progress.max = filterIds.size;
  if (status)
    status.textContent = metadataBatchUi(
      "Retrying {count} failed {label} lookup(s).",
      { count: filterIds.size, label },
    );
  try {
    let result = await runMetadataBatchType(type, {
      limit: filterIds.size,
      filterIds,
      settings,
      force: true,
      onProgress(done, total, item) {
        if (progress) {
          progress.max = Math.max(1, total);
          progress.value = done;
        }
        let name = item?.title || item?.name || "";
        if (status)
          status.textContent = `${done} / ${total} ${label}${name ? ` · ${name}` : ""}`;
      },
    });
    if (status)
      status.textContent = metadataBatchUi(
        "Done: {attempted} attempted, {found} updated, {failed} failed{skippedNote}.",
        {
          attempted: result.attempted,
          found: result.found,
          failed: result.failed,
          skippedNote: result.skipped
            ? metadataBatchUi(", {count} skipped", { count: result.skipped })
            : "",
        },
      );
    renderMetadataBatchReport(result, {
      type,
      limit: filterIds.size,
      force: true,
    });
    window.renderDataWorkspace?.();
  } catch (err) {
    console.error("Session retry batch failed", err);
    if (status) status.textContent = err.message || String(err);
  } finally {
    setMetadataBatchDisabled(elements, false);
  }
};

function prepareMetadataBatchUi(elements) {
  if (elements.report) {
    elements.report.hidden = true;
    elements.report.innerHTML = "";
  }
  if (elements.progress) {
    elements.progress.value = 0;
    elements.progress.max = 1;
  }
}

function setMetadataBatchDisabled(elements, disabled) {
  if (elements.button) elements.button.disabled = disabled;
  if (elements.everythingButton) elements.everythingButton.disabled = disabled;
  if (elements.nonArchiveButton) elements.nonArchiveButton.disabled = disabled;
}

/**
 * Runs the metadata batch selected by the Data-page controls.
 * @param {Object} [runOptions] Batch controls.
 * @param {boolean} [runOptions.force] Whether to retry previously attempted items.
 * @returns {Promise<void>} Completion after the batch UI is restored.
 */
window.runMetadataBatch = async function (runOptions = {}) {
  let elements = metadataBatchElements();
  let { button, progress, status } = elements;
  let type = elements.typeInput.value;
  let limit = Math.min(
    10000,
    Math.max(1, Number(elements.limitInput.value) || 25),
  );
  let settings = metadataBatchSettings();
  let label = window.metadataBatchLabel(type);
  let remaining = window.metadataBatchPreviewCount(type, settings);
  if (!settings.tmdbCredential && metadataBatchRequiresTmdb(type)) {
    status.textContent = metadataBatchUi(
      "Save a TMDB credential before fetching this batch.",
    );
    return;
  }
  setMetadataBatchDisabled(elements, true);
  button.textContent = metadataBatchUi("Running...");
  prepareMetadataBatchUi(elements);
  progress.max = Math.max(1, Math.min(limit, remaining));
  status.textContent = remaining
    ? metadataBatchUi("Starting {count} {label}.", {
        count:
          window.uiCount?.(Math.min(limit, remaining), "item", "items") ??
          `${Math.min(limit, remaining)} items`,
        label,
      })
    : metadataBatchUi("No {label} items need fetching.", { label });

  try {
    let result = await runMetadataBatchType(type, {
      limit,
      settings,
      force: Boolean(runOptions.force),
      onProgress(done, total, item) {
        progress.max = Math.max(1, total);
        progress.value = done;
        let name = item?.title || item?.name || "";
        status.textContent = `${done} / ${total} ${label}${name ? ` · ${name}` : ""}`;
      },
    });
    progress.value = result.attempted || progress.value;
    progress.max = Math.max(1, result.attempted || progress.max);
    status.textContent = metadataBatchUi(
      "Done: {attempted} attempted, {found} updated, {failed} failed{skippedNote}.",
      {
        attempted: result.attempted,
        found: result.found,
        failed: result.failed,
        skippedNote: result.skipped
          ? metadataBatchUi(", {count} skipped", { count: result.skipped })
          : "",
      },
    );
    renderMetadataBatchReport(result, {
      type,
      limit,
      force: Boolean(runOptions.force),
    });
    window.renderDataWorkspace?.();
  } catch (err) {
    console.error("Metadata batch failed", err);
    status.textContent = err.message || String(err);
  } finally {
    setMetadataBatchDisabled(elements, false);
    button.textContent = metadataBatchUi("Start batch");
  }
};

/**
 * Runs every non-empty archive, watchlist, and portrait metadata queue.
 * @param {Object} [runOptions] Batch controls.
 * @param {boolean} [runOptions.force] Whether to retry previously attempted items.
 * @param {boolean} [runOptions.confirm] Whether to request confirmation.
 * @returns {Promise<void>} Completion after all selected queues finish.
 */
window.runAllMetadataBatches = async function (runOptions = {}) {
  let elements = metadataBatchElements();
  let { everythingButton, progress, status } = elements;
  let settings = metadataBatchSettings();
  if (!settings.tmdbCredential) {
    status.textContent = metadataBatchUi(
      "Save a TMDB credential before fetching every missing metadata queue.",
    );
    return;
  }
  let queue = metadataBatchTypes
    .map((type) => ({
      type,
      label: window.metadataBatchLabel(type),
      remaining: window.metadataBatchPreviewCount(type, settings),
    }))
    .filter((item) => item.remaining > 0);
  let total = queue.reduce((sum, item) => sum + item.remaining, 0);
  if (!total) {
    status.textContent = metadataBatchUi("No metadata queues need fetching.");
    return;
  }
  if (
    runOptions.confirm !== false &&
    !confirm(
      metadataBatchUi(
        "Fetch {items} across {queues}? This can take several minutes.",
        {
          items: window.uiCount?.(total, "item", "items") ?? `${total} items`,
          queues:
            window.uiCount?.(queue.length, "queue", "queues") ??
            `${queue.length} queues`,
        },
      ),
    )
  )
    return;

  setMetadataBatchDisabled(elements, true);
  prepareMetadataBatchUi(elements);
  everythingButton.textContent = metadataBatchUi("Fetching...");
  progress.max = total;
  status.textContent = metadataBatchUi("Starting {items}.", {
    items: window.uiCount?.(total, "item", "items") ?? `${total} items`,
  });

  let completed = 0;
  let results = [];
  try {
    for (let index = 0; index < queue.length; index++) {
      let item = queue[index];
      status.textContent = metadataBatchUi(
        "Queue {index} / {total}: {label} ({remaining})",
        {
          index: index + 1,
          total: queue.length,
          label: item.label,
          remaining: item.remaining,
        },
      );
      let result = await runMetadataBatchType(item.type, {
        limit: item.remaining,
        settings,
        force: Boolean(runOptions.force),
        onProgress(done, totalInQueue, currentItem) {
          progress.value = Math.min(total, completed + done);
          let name = currentItem?.title || currentItem?.name || "";
          status.textContent = `${metadataBatchUi("Queue {index} / {total}:", { index: index + 1, total: queue.length })} ${done} / ${totalInQueue} ${item.label}${name ? ` · ${name}` : ""}`;
        },
      });
      results.push(result);
      completed += result.attempted || item.remaining;
      progress.value = Math.min(total, completed);
    }
    let combined = combineMetadataBatchResults(results);
    status.textContent = metadataBatchUi(
      "Done: {attempted} attempted, {found} updated, {failed} failed{skippedNote}.",
      {
        attempted: combined.attempted,
        found: combined.found,
        failed: combined.failed,
        skippedNote: combined.skipped
          ? metadataBatchUi(", {count} skipped", { count: combined.skipped })
          : "",
      },
    );
    renderMetadataBatchReport(combined, {
      type: "all",
      limit: total,
      force: Boolean(runOptions.force),
    });
    window.renderDataWorkspace?.();
  } catch (err) {
    console.error("Full metadata batch failed", err);
    status.textContent = err.message || String(err);
  } finally {
    setMetadataBatchDisabled(elements, false);
    everythingButton.textContent = metadataBatchUi("Fetch all missing");
  }
};

/**
 * Runs metadata and poster queues for watchlist films outside the archive.
 * @param {Object} [runOptions] Batch controls.
 * @param {boolean} [runOptions.force] Whether to retry previously attempted items.
 * @param {boolean} [runOptions.confirm] Whether to request confirmation.
 * @returns {Promise<void>} Completion after both selected queues finish.
 */
window.runNonArchiveMetadataBatches = async function (runOptions = {}) {
  let elements = metadataBatchElements();
  let { nonArchiveButton, progress, status } = elements;
  let settings = metadataBatchSettings();
  if (!settings.tmdbCredential) {
    status.textContent = metadataBatchUi(
      "Save a TMDB credential before fetching not-watched films.",
    );
    return;
  }
  let queue = nonArchiveMetadataBatchTypes
    .map((type) => ({
      type,
      label: window.metadataBatchLabel(type),
      remaining: window.metadataBatchPreviewCount(type, settings),
    }))
    .filter((item) => item.remaining > 0);
  let total = queue.reduce((sum, item) => sum + item.remaining, 0);
  if (!total) {
    status.textContent = metadataBatchUi(
      "No not-watched watchlist films need fetching.",
    );
    return;
  }
  if (
    runOptions.confirm !== false &&
    !confirm(
      metadataBatchUi("Fetch {items}? This can take several minutes.", {
        items:
          window.uiCount?.(
            total,
            "not-watched metadata item",
            "not-watched metadata items",
          ) ?? `${total} not-watched metadata items`,
      }),
    )
  )
    return;

  setMetadataBatchDisabled(elements, true);
  prepareMetadataBatchUi(elements);
  nonArchiveButton.textContent = metadataBatchUi("Fetching...");
  progress.max = total;
  status.textContent = metadataBatchUi("Starting {items}.", {
    items:
      window.uiCount?.(
        total,
        "not-watched metadata item",
        "not-watched metadata items",
      ) ?? `${total} not-watched metadata items`,
  });

  let completed = 0;
  let results = [];
  try {
    for (let index = 0; index < queue.length; index++) {
      let item = queue[index];
      status.textContent = metadataBatchUi(
        "Queue {index} / {total}: {label} ({remaining})",
        {
          index: index + 1,
          total: queue.length,
          label: item.label,
          remaining: item.remaining,
        },
      );
      let result = await runMetadataBatchType(item.type, {
        limit: item.remaining,
        settings,
        force: Boolean(runOptions.force),
        onProgress(done, totalInQueue, currentItem) {
          progress.value = Math.min(total, completed + done);
          let name = currentItem?.title || currentItem?.name || "";
          status.textContent = `${metadataBatchUi("Queue {index} / {total}:", { index: index + 1, total: queue.length })} ${done} / ${totalInQueue} ${item.label}${name ? ` · ${name}` : ""}`;
        },
      });
      results.push(result);
      completed += result.attempted || item.remaining;
      progress.value = Math.min(total, completed);
    }
    let combined = combineMetadataBatchResults(results);
    status.textContent = metadataBatchUi(
      "Done: {attempted} attempted, {found} updated, {failed} failed{skippedNote}.",
      {
        attempted: combined.attempted,
        found: combined.found,
        failed: combined.failed,
        skippedNote: combined.skipped
          ? metadataBatchUi(", {count} skipped", { count: combined.skipped })
          : "",
      },
    );
    renderMetadataBatchReport(combined, {
      type: "not-watched",
      limit: total,
      force: Boolean(runOptions.force),
    });
    window.renderDataWorkspace?.();
  } catch (err) {
    console.error("Not-watched metadata batch failed", err);
    status.textContent = err.message || String(err);
  } finally {
    setMetadataBatchDisabled(elements, false);
    nonArchiveButton.textContent = metadataBatchUi("Fetch not-watched missing");
  }
};

/**
 * Replays the last batch when its report retry action is clicked.
 * @param {Event} event Report click event.
 */
window.handleMetadataBatchReportAction = function (event) {
  if (
    !event.target.closest("[data-retry-metadata-batch]") ||
    !lastMetadataBatch
  )
    return;
  let batchType = document.getElementById("metadataBatchType");
  let batchLimit = document.getElementById("metadataBatchLimit");
  if (lastMetadataBatch.type === "all") {
    window.runAllMetadataBatches({ force: true });
    return;
  }
  if (lastMetadataBatch.type === "not-watched") {
    window.runNonArchiveMetadataBatches({ force: true });
    return;
  }
  if (batchType) batchType.value = lastMetadataBatch.type;
  if (batchLimit) batchLimit.value = lastMetadataBatch.limit;
  window.runMetadataBatch({ force: true });
};
