/**
 * @file Renders the Data page health dashboard, its cached report, and
 * drill-down queues grouped by watched films, watchlist films, and images.
 */

function dataHealthEscape(value) {
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

function dataHealthText(value, values) {
  return window.uiText ? window.uiText(value, values) : String(value || "");
}

let lastDataHealthReport = null;

function currentDataHealthReport(refresh) {
  if (!refresh && lastDataHealthReport)
    return { report: lastDataHealthReport, collected: false };
  let finishCollectTimer =
    window.startOskarsPerformance?.("dataHealth:collect");
  lastDataHealthReport = collectDataHealth();
  finishCollectTimer?.(
    `${lastDataHealthReport.errors} error(s), ${lastDataHealthReport.warnings} warning(s), ${(lastDataHealthReport.queues || []).length} queue(s)`,
  );
  return { report: lastDataHealthReport, collected: true };
}

/** Clears the cached data-health report so the next render recollects it. */
window.clearDataHealthReport = function () {
  lastDataHealthReport = null;
};

/**
 * Renders the full data-health workspace from a cached or refreshed report.
 * @param {HTMLElement|null} [container] Dashboard container.
 * @param {Object} [options] Render controls.
 * @param {boolean} [options.refresh] Whether to recollect the health report.
 */
window.renderDataHealth = function (
  container = document.getElementById("dataHealthView") ||
    document.getElementById("view"),
  options = {},
) {
  if (!container) return;
  let finishRenderTimer = window.startOskarsPerformance?.("dataHealth:render");
  let { report, collected } = currentDataHealthReport(Boolean(options.refresh));
  if (!collected)
    window.startOskarsPerformance?.("dataHealth:reuse")?.(
      `${report.findings.length} finding(s)`,
    );

  function queueExplanation(queue) {
    let details = {
      filmTmdb:
        "TMDB IDs unlock metadata/poster refreshes. Usually fetchable from TMDB.",
      filmDirectors:
        "Directors power person pages, project sources, and credits. Fetch from TMDB or correct the sheet.",
      filmCountries:
        "Countries are used for International eligibility and country filters. Fetch from TMDB or correct the sheet.",
      filmRuntime:
        "Runtime is sheet-owned ranked-list metadata. Fill it in Google Sheets when useful.",
      filmMedium:
        "Medium drives Animated eligibility. Correct the ranked-list Medium column in Google Sheets.",
      filmScreenplay:
        "Screenplay type drives screenplay eligibility. Correct the ranked-list Screenplay column in Google Sheets.",
      watchlistDirectors:
        "Directors let unwatched films appear correctly on person, franchise, and project pages.",
      eligibilityAnimated:
        "Best Animated Picture requires animation. Correct the ranked-list Medium column in Google Sheets.",
      eligibilityInternational:
        "Best International Picture requires a non-US/UK primary country. Correct the Country column or fetch from TMDB.",
      eligibilityScreenplay:
        "Screenplay eligibility needs an original/adapted status. Correct the ranked-list Screenplay column in Google Sheets.",
      eligibilityDirector:
        "Best Director needs both film director metadata and an award recipient.",
      filmLetterboxd:
        "Letterboxd links come from the ranked-list Letterboxd column in Google Sheets.",
      watchlistLetterboxd:
        "Watchlist Letterboxd links come from the Letterboxd URI column in the watchlist sheet.",
      watchlistTmdb:
        "TMDB IDs unlock watchlist metadata and poster fetches.",
      filmNonFilmType:
        "Review ranked-list rows whose Type is not Film.",
      filmPosters: "Posters improve watched-film card and grid views.",
      watchlistPosters: "Posters keep large watchlist grids scannable.",
      personPortraits: "Portraits improve person pages and comparisons.",
    };
    return details[queue.id] || "";
  }

  function sampleLinks(samples) {
    return (
      samples
        .map((sample) => {
          let link = sample.href
            ? `<a href="${dataHealthEscape(sample.href)}">${dataHealthEscape(sample.title)}</a>`
            : dataHealthEscape(sample.title);
          return sample.note
            ? `${link} <small>(${dataHealthEscape(sample.note)})</small>`
            : link;
        })
        .join(", ") || dataHealthText("None")
    );
  }

  function queueRow(queue, rowOptions = {}) {
    let explanation = queueExplanation(queue);
    return `<tr>
      <td><strong>${dataHealthEscape(dataHealthText(queue.label))}</strong>${explanation ? `<small>${dataHealthEscape(dataHealthText(explanation))}</small>` : ""}</td>
      <td><span class="health-source ${dataHealthEscape(queue.source || "fetchable")}">${dataHealthEscape(queue.source === "sheet" ? dataHealthText("Sheet") : dataHealthText("Fetch"))}</span></td>
      <td>${queue.count}</td>
      <td>${sampleLinks(queue.samples)}</td>
      <td><button type="button" data-data-health-open-queue="${dataHealthEscape(queue.id)}" data-data-health-queue-detail="${dataHealthEscape(rowOptions.detailId || "dataHealthQueueList")}">${dataHealthEscape(dataHealthText("View all"))}</button></td>
      ${rowOptions.batchColumn === false ? "" : `<td>${queue.batchType ? `<button type="button" data-metadata-batch-preset="${dataHealthEscape(queue.batchType)}">${dataHealthEscape(dataHealthText("Set batch"))}</button>` : `<span class="data-panel-status">${dataHealthEscape(dataHealthText("Sheet"))}</span>`}</td>`}
    </tr>`;
  }

  function queueTable(queues, tableOptions = {}) {
    let batchColumn = tableOptions.batchColumn !== false;
    let rows = queues
      .filter((queue) => queue.count > 0)
      .map((queue) =>
        queueRow(queue, {
          batchColumn,
          detailId: tableOptions.detailId,
        }),
      )
      .join("");
    if (!rows)
      rows = `<tr><td colspan="${batchColumn ? 6 : 5}">${dataHealthEscape(dataHealthText("Nothing outstanding"))}</td></tr>`;
    return `<div class="leaderboard-wrap"><table class="leaderboard data-health-queues"><colgroup><col style="width:260px"><col style="width:110px"><col style="width:70px"><col><col style="width:90px">${batchColumn ? '<col style="width:110px">' : ""}</colgroup><thead><tr><th>${dataHealthEscape(dataHealthText("Queue"))}</th><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText(tableOptions.countLabel || "Missing"))}</th><th>${dataHealthEscape(dataHealthText("Samples"))}</th><th>${dataHealthEscape(dataHealthText("Open"))}</th>${batchColumn ? `<th>${dataHealthEscape(dataHealthText("Batch"))}</th>` : ""}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function metricCards(metrics) {
    return `<div class="sheet-health-grid">${metrics
      .map(
        (metric) => `<article>
          <h4>${dataHealthEscape(dataHealthText(metric.label))}</h4>
          <strong>${dataHealthEscape(metric.present)} / ${dataHealthEscape(metric.target)}</strong>
          <span>${dataHealthEscape(dataHealthText("{percent}% present · {missing} missing", { percent: metric.percent, missing: metric.missing }))}</span>
          <progress value="${dataHealthEscape(metric.present)}" max="${Math.max(1, Number(metric.target) || 1)}"></progress>
          ${metric.note ? `<small>${dataHealthEscape(dataHealthText(metric.note))}</small>` : ""}
        </article>`,
      )
      .join("")}</div>`;
  }

  function topic(title, body, className = "") {
    return `<section class="data-health-topic ${className}"><h4>${dataHealthEscape(dataHealthText(title))}</h4><div>${body}</div></section>`;
  }

  function group(title, body, id) {
    return `<section data-collapsible-section class="health-subsection data-health-group" data-data-health-group="${id}"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText(title))}</h3><div data-collapsible-body>${body}</div></section>`;
  }

  let external = report.externalIds || {
    metrics: [],
    queues: [],
    inferableLetterboxd: 0,
  };
  let watchedQueues = [
    ...(report.queues || []).filter((queue) => queue.id !== "watchlistDirectors"),
    ...(external.queues || []).filter((queue) =>
      ["filmLetterboxd", "filmNonFilmType"].includes(queue.id),
    ),
  ];
  let watchlistQueues = [
    ...(report.queues || []).filter(
      (queue) => queue.id === "watchlistDirectors",
    ),
    ...(external.queues || []).filter((queue) =>
      ["watchlistTmdb", "watchlistLetterboxd"].includes(queue.id),
    ),
  ];
  let watchlistMetrics = (external.metrics || []).filter((metric) =>
    ["tmdbWatchlist", "letterboxdWatchlist"].includes(metric.id),
  );

  let inferableBlock = external.inferableLetterboxd
    ? `<p class="data-panel-status">${dataHealthEscape(dataHealthText("{count} Letterboxd link(s) can be inferred from existing film URLs.", { count: external.inferableLetterboxd }))} <button type="button" data-apply-inferable-letterboxd>${dataHealthEscape(dataHealthText("Apply inferred Letterboxd links"))}</button></p>`
    : "";
  let mediaSession = window.tmdbMediaTypeSession || { checked: 0, issues: [] };
  let mediaIssueRows = (mediaSession.issues || [])
    .map(
      (issue) => `<tr><td>${issue.href ? `<a href="${dataHealthEscape(issue.href)}">${dataHealthEscape(issue.title)}</a>` : dataHealthEscape(issue.title)}</td><td>${dataHealthEscape(issue.localType || "")}</td><td>${dataHealthEscape(issue.tmdbId)}</td><td>${dataHealthEscape(issue.detail || issue.status)}</td></tr>`,
    )
    .join("");
  let mediaResultBlock = mediaSession.checked
    ? mediaIssueRows
      ? `<div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${dataHealthEscape(dataHealthText("Film"))}</th><th>${dataHealthEscape(dataHealthText("Local type"))}</th><th>${dataHealthEscape(dataHealthText("TMDB ID"))}</th><th>${dataHealthEscape(dataHealthText("Result"))}</th></tr></thead><tbody>${mediaIssueRows}</tbody></table></div>`
      : `<p class="data-panel-status">${dataHealthEscape(dataHealthText("No TMDB link issues found in {count} checked film(s) this session.", { count: mediaSession.checked }))}</p>`
    : "";
  let mediaBody = `${inferableBlock}<div class="data-actions"><button type="button" data-check-tmdb-media-types>${dataHealthEscape(dataHealthText("Check TMDB links"))}</button><span id="tmdbMediaTypeStatus" class="data-panel-status">${dataHealthEscape(dataHealthText("Checks watched-film TMDB IDs in explicit batches; lists every title, release year, runtime, media type, or missing-record difference."))}</span></div>${mediaResultBlock}`;

  let conflictRows = (report.sourceConflicts || [])
    .map(
      (conflict) => `<tr><td>${dataHealthEscape(conflict.source || "")}</td><td>${dataHealthEscape(conflict.title || "")}${conflict.year ? ` (${dataHealthEscape(conflict.year)})` : ""}</td><td>${dataHealthEscape(dataHealthText(conflict.field === "tier" ? "tier" : "rating"))}</td><td>${dataHealthEscape(conflict.existing ?? "")}</td><td>${dataHealthEscape(conflict.incoming ?? "")}</td><td>${dataHealthEscape(conflict.kept === "incoming" ? dataHealthText("Incoming") : dataHealthText("Existing"))}</td><td>${dataHealthEscape(conflict.rowNumber || "")}</td></tr>`,
    )
    .join("") ||
    `<tr><td colspan="7">${dataHealthEscape(dataHealthText("No cross-source conflicts recorded by the last import."))}</td></tr>`;
  let conflictTable = `<h5>${dataHealthEscape(dataHealthText("Cross-source conflicts"))}</h5><div class="leaderboard-wrap"><table class="leaderboard data-health-conflicts"><thead><tr><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText("Film"))}</th><th>${dataHealthEscape(dataHealthText("Field"))}</th><th>${dataHealthEscape(dataHealthText("Existing"))}</th><th>${dataHealthEscape(dataHealthText("Incoming"))}</th><th>${dataHealthEscape(dataHealthText("Kept"))}</th><th>${dataHealthEscape(dataHealthText("Row"))}</th></tr></thead><tbody>${conflictRows}</tbody></table></div>`;

  let importConsistency = window.state?.importConsistency;
  let consistencyIssueRows = (importConsistency?.ranges || [])
    .flatMap((range) =>
      (range.checks || [])
        .filter((check) => check.missingCount > 0)
        .map((check) => {
          let samples = (check.samples || [])
            .map(
              (sample) =>
                `${sample.title}${sample.year ? ` (${sample.year})` : ""} · ${dataHealthText("row")} ${sample.rowNumber}`,
            )
            .join(", ");
          return `<tr><td>${dataHealthEscape(range.key)}</td><td>${dataHealthEscape(dataHealthText(check.label || check.field || ""))}</td><td>${check.sourceCount || 0}</td><td>${check.missingCount || 0}</td><td>${dataHealthEscape(samples)}</td></tr>`;
        }),
    )
    .join("");
  let consistencyCheckedAt = String(importConsistency?.checkedAt || "")
    .slice(0, 16)
    .replace("T", " ");
  let consistencyBody = !importConsistency
    ? `<p class="data-panel-status">${dataHealthEscape(dataHealthText("Run a Google import to populate import consistency checks."))}</p>`
    : consistencyIssueRows
      ? `<div class="leaderboard-wrap"><table class="leaderboard data-health-consistency"><thead><tr><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText("Field"))}</th><th>${dataHealthEscape(dataHealthText("In sheet"))}</th><th>${dataHealthEscape(dataHealthText("Missing after import"))}</th><th>${dataHealthEscape(dataHealthText("Sample rows"))}</th></tr></thead><tbody>${consistencyIssueRows}</tbody></table></div>`
      : `<p class="data-panel-status">${dataHealthEscape(dataHealthText("No missing source fields detected by the last import ({time}).", { time: consistencyCheckedAt }))}</p>`;
  let importBody = `${conflictTable}<h5>${dataHealthEscape(dataHealthText("Import consistency"))}</h5>${consistencyBody}`;

  function retryRowsForTypes(types) {
    return types
      .map((type) => {
        let attempted = window.metadataSessionAttemptCount?.(type) || 0;
        let failures = window.metadataSessionFailureList?.(type) || [];
        if (!attempted && !failures.length) return "";
        let samples = failures
          .slice(0, 6)
          .map(
            (failure) =>
              `${dataHealthEscape(failure.title)}${failure.year ? ` (${dataHealthEscape(failure.year)})` : ""} — ${dataHealthEscape(dataHealthText(failure.reason))}`,
          )
          .join(", ");
        return `<tr><td><strong>${dataHealthEscape(window.metadataBatchLabel?.(type) || type)}</strong></td><td>${attempted}</td><td>${failures.length}</td><td>${samples || dataHealthEscape(dataHealthText("None"))}</td><td>${failures.length ? `<button type="button" data-retry-session-queue="${dataHealthEscape(type)}">${dataHealthEscape(dataHealthText("Retry {count} failed", { count: failures.length }))}</button>` : ""}</td></tr>`;
      })
      .join("");
  }

  function retryBodyForTypes(types, emptyMessage) {
    let rows = retryRowsForTypes(types);
    return rows
      ? `<div class="leaderboard-wrap"><table class="leaderboard data-health-retries"><thead><tr><th>${dataHealthEscape(dataHealthText("Queue"))}</th><th>${dataHealthEscape(dataHealthText("Attempted"))}</th><th>${dataHealthEscape(dataHealthText("Failed"))}</th><th>${dataHealthEscape(dataHealthText("Failures"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="data-panel-status">${dataHealthEscape(dataHealthText(emptyMessage))}</p>`;
  }

  let findingRows = (report.findings || [])
    .map((finding) => {
      let candidate = finding.aliasCandidate;
      let actions = candidate
        ? `<div class="alias-actions"><button type="button" data-alias-canonical="${dataHealthEscape(candidate.leftId)}" data-alias-variant="${dataHealthEscape(candidate.rightId)}">${dataHealthEscape(dataHealthText("Use {name}", { name: candidate.leftName }))}</button><button type="button" data-alias-canonical="${dataHealthEscape(candidate.rightId)}" data-alias-variant="${dataHealthEscape(candidate.leftId)}">${dataHealthEscape(dataHealthText("Use {name}", { name: candidate.rightName }))}</button><button type="button" data-alias-reject-left="${dataHealthEscape(candidate.leftId)}" data-alias-reject-right="${dataHealthEscape(candidate.rightId)}">${dataHealthEscape(dataHealthText("Not same"))}</button></div>`
        : "";
      return `<tr><td><span class="health-severity ${dataHealthEscape(finding.severity)}">${dataHealthEscape(dataHealthText(finding.severity))}</span></td><td>${dataHealthEscape(finding.period)}</td><td>${dataHealthEscape(dataHealthText(finding.issue))}</td><td>${dataHealthEscape(finding.detail)}</td><td>${actions}</td></tr>`;
    })
    .join("") ||
    `<tr><td colspan="5">${dataHealthEscape(dataHealthText("No actionable findings"))}</td></tr>`;
  let findingsTable = `<div class="leaderboard-wrap"><table class="leaderboard data-health-findings"><thead><tr><th>${dataHealthEscape(dataHealthText("Severity"))}</th><th>${dataHealthEscape(dataHealthText("Period"))}</th><th>${dataHealthEscape(dataHealthText("Issue"))}</th><th>${dataHealthEscape(dataHealthText("Detail"))}</th><th>${dataHealthEscape(dataHealthText("Review"))}</th></tr></thead><tbody>${findingRows}</tbody></table></div>`;

  let aliasRows = (report.confirmedAliases || [])
    .map(
      (alias) => `<tr><td>${dataHealthEscape(alias.variantName)}</td><td>${dataHealthEscape(alias.canonicalName)}</td><td><button type="button" data-alias-remove="${dataHealthEscape(alias.variantId)}">${dataHealthEscape(dataHealthText("Remove"))}</button></td></tr>`,
    )
    .join("") ||
    `<tr><td colspan="3">${dataHealthEscape(dataHealthText("No confirmed aliases"))}</td></tr>`;
  let aliasesBody = `${report.rejectedAliasCount ? `<p><button type="button" data-alias-reset-rejected>${dataHealthEscape(dataHealthText("Reset {count} dismissed", { count: report.rejectedAliasCount }))}</button></p>` : ""}<div class="leaderboard-wrap"><table class="leaderboard alias-table"><thead><tr><th>${dataHealthEscape(dataHealthText("Variant"))}</th><th>${dataHealthEscape(dataHealthText("Canonical name"))}</th><th></th></tr></thead><tbody>${aliasRows}</tbody></table></div>`;

  let imageMetrics = [
    {
      label: "Watched posters",
      present: report.images.watchedPosters,
      target: report.images.watchedPosterTarget,
    },
    {
      label: "Watchlist posters",
      present: report.images.watchlistPosters,
      target: report.images.watchlistPosterTarget,
    },
    {
      label: "Portraits",
      present: report.images.portraits,
      target: report.images.portraitTarget,
    },
  ].map((metric) => ({
    ...metric,
    missing: Math.max(0, metric.target - metric.present),
    percent: metric.target
      ? Math.round((metric.present / metric.target) * 100)
      : 0,
  }));

  let watchedBody = [
    topic("Metadata coverage", metricCards(report.sheetMetadata || [])),
    topic(
      "Missing metadata",
      `${queueTable(watchedQueues, { detailId: "dataHealthQueueList" })}<div id="dataHealthQueueList" class="data-health-queue-detail" aria-live="polite"></div>`,
    ),
    topic(
      "Eligibility",
      queueTable(report.eligibilityQueues || [], {
        batchColumn: false,
        countLabel: "Nominees",
        detailId: "dataHealthEligibilityQueueList",
      }) +
        '<div id="dataHealthEligibilityQueueList" class="data-health-queue-detail" aria-live="polite"></div>',
    ),
    topic("TMDB link verification", mediaBody),
    topic("Import diagnostics", importBody),
    topic(
      "Metadata retries",
      retryBodyForTypes(
        ["film-metadata"],
        "No watched-film metadata lookups have run this session.",
      ),
    ),
    topic("Findings", findingsTable),
    topic("Confirmed person aliases", aliasesBody),
  ].join("");
  let watchlistBody = [
    topic("Metadata coverage", metricCards(watchlistMetrics)),
    topic(
      "Missing metadata",
      `${queueTable(watchlistQueues, { detailId: "dataHealthWatchlistQueueList" })}<div id="dataHealthWatchlistQueueList" class="data-health-queue-detail" aria-live="polite"></div>`,
    ),
    topic(
      "Metadata retries",
      retryBodyForTypes(
        ["watchlist-metadata"],
        "No watchlist metadata lookups have run this session.",
      ),
    ),
  ].join("");
  let imagesBody = [
    topic("Coverage", metricCards(imageMetrics)),
    topic(
      "Missing images",
      `${queueTable(report.imageQueues || [], { detailId: "dataHealthImageQueueList" })}<div id="dataHealthImageQueueList" class="data-health-queue-detail" aria-live="polite"></div>`,
    ),
    topic(
      "Image retry queues",
      retryBodyForTypes(
        ["film-posters", "watchlist-posters", "person-portraits"],
        "No image lookups have run this session.",
      ),
    ),
  ].join("");

  container.innerHTML = `<div data-collapsible-section class="data-health-shell"><h2 data-collapsible-heading>${dataHealthEscape(dataHealthText("Data health"))}</h2><div data-collapsible-body class="data-health-body"><div class="health-summary"><span><b>${report.errors}</b> ${dataHealthEscape(dataHealthText("Errors"))}</span><span><b>${report.warnings}</b> ${dataHealthEscape(dataHealthText("Warnings"))}</span></div>${group("Watched", watchedBody, "watched")}${group("Watchlist", watchlistBody, "watchlist")}${group("Images", imagesBody, "images")}</div></div>`;
  window.enhanceCollapsibles?.(container);
  finishRenderTimer?.(`${report.findings.length} finding(s)`);
};

/**
 * Renders every entry in one data-health queue and scrolls it into view.
 * @param {string} queueId Queue identifier from the current health report.
 * @param {HTMLElement|null} [target] Dashboard containing the queue detail panel.
 * @param {string} [detailId] Queue detail element id.
 */
window.openDataHealthQueue = function (
  queueId,
  target = document.getElementById("dataHealthView"),
  detailId = "dataHealthQueueList",
) {
  if (!target) return;
  let finishQueueTimer = window.startOskarsPerformance?.(
    "dataHealth:openQueue",
  );
  let { report } = currentDataHealthReport(false);
  let id = String(queueId || "");
  let queue = [
    ...(report.queues || []),
    ...(report.imageQueues || []),
    ...(report.eligibilityQueues || []),
    ...(report.externalIds?.queues || []),
  ].find((item) => item.id === id);
  let entries = queue?.entries || [];

  let container = target.querySelector(`#${detailId}`);
  if (!container) {
    container = document.createElement?.("div");
    if (!container) return;
    container.id = detailId;
    container.className = "data-health-queue-detail";
    (target.querySelector(".data-health-body") || target).appendChild(
      container,
    );
  }
  if (!entries.length) {
    container.innerHTML = `<p class="data-panel-status">${dataHealthEscape(dataHealthText("No items in this queue."))}</p>`;
    container.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    finishQueueTimer?.(`${id}, 0 item(s)`);
    return;
  }
  let rows = entries
    .map(
      (entry) =>
        `<li>${entry.href ? `<a href="${window.pageEscape(entry.href)}">${window.pageEscape(entry.title)}</a>` : window.pageEscape(entry.title)}${entry.note ? ` <small>(${window.pageEscape(entry.note)})</small>` : ""}</li>`,
    )
    .join("");
  container.innerHTML = `<h4>${window.pageEscape(dataHealthText(queue?.label || queueId))}</h4><p class="data-panel-status">${window.pageEscape(dataHealthText("{count} item(s) in queue.", { count: entries.length }))}</p><ul class="data-health-queue-items">${rows}</ul>`;
  container.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  finishQueueTimer?.(`${id}, ${entries.length} item(s)`);
};
