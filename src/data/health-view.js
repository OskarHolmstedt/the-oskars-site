/**
 * @file Renders the Data page health dashboard, its cached report, and
 * drill-down queues for missing metadata and actionable findings.
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

/**
 * Clears the cached data-health report so the next render recollects it.
 */
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
      filmPosters:
        "Posters improve card/grid views. Fetchable from TMDB/Wikimedia.",
      watchlistMetadata:
        "Watchlist metadata helps director/franchise/project pages include unwatched films correctly.",
      watchlistPosters:
        "Watchlist posters keep large watchlist grids scannable. Fetchable from TMDB/Wikimedia.",
      personPortraits:
        "Portraits improve person pages and comparison views. Fetchable from TMDB.",
      eligibilityAnimated:
        "Best Animated Picture requires animation. Correct the ranked-list Medium column in Google Sheets.",
      eligibilityInternational:
        "Best International Picture requires a non-US/UK primary country. Correct the Country column or fetch from TMDB.",
      eligibilityScreenplay:
        "Screenplay eligibility needs an original/adapted status. Correct the ranked-list Screenplay column in Google Sheets.",
      filmLetterboxd:
        "Letterboxd links come from the ranked-list letterboxd column in Google Sheets.",
      watchlistLetterboxd:
        "Watchlist Letterboxd links come from the Letterboxd URI column in the watchlist sheet.",
      watchlistTmdb:
        "TMDB IDs unlock watchlist metadata/poster fetches. Fetchable from TMDB.",
      filmNonFilmType:
        "Rows whose ranked-list Type is not Film (TV films, miniseries). Review whether they belong in the archive.",
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
  function queueRow(queue, options = {}) {
    return `<tr>
    <td><strong>${dataHealthEscape(dataHealthText(queue.label))}</strong>${queueExplanation(queue) ? `<small>${dataHealthEscape(dataHealthText(queueExplanation(queue)))}</small>` : ""}</td>
    <td><span class="health-source ${dataHealthEscape(queue.source || "fetchable")}">${dataHealthEscape(queue.source === "sheet" ? dataHealthText("Sheet") : dataHealthText("Fetch"))}</span></td>
    <td>${queue.count}</td>
    <td>${sampleLinks(queue.samples)}</td>
    <td><button type="button" data-data-health-open-queue="${dataHealthEscape(queue.id)}">${dataHealthEscape(dataHealthText("View all"))}</button></td>
    ${options.batchColumn === false ? "" : `<td>${queue.batchType ? `<button type="button" data-metadata-batch-preset="${dataHealthEscape(queue.batchType)}">${dataHealthEscape(dataHealthText("Set batch"))}</button>` : `<span class="data-panel-status">${dataHealthEscape(dataHealthText("Sheet"))}</span>`}</td>`}
  </tr>`;
  }
  let queueRows =
    report.queues
      .filter((queue) => queue.count > 0)
      .map((queue) => queueRow(queue))
      .join("") ||
    `<tr><td colspan="6">${dataHealthEscape(dataHealthText("Nothing outstanding"))}</td></tr>`;
  let eligibilityQueueRows =
    (report.eligibilityQueues || [])
      .filter((queue) => queue.count > 0)
      .map((queue) => queueRow(queue, { batchColumn: false }))
      .join("") ||
    `<tr><td colspan="5">${dataHealthEscape(dataHealthText("Nothing outstanding"))}</td></tr>`;
  let external = report.externalIds || {
    metrics: [],
    queues: [],
    inferableLetterboxd: 0,
  };
  let externalMetricCards = external.metrics
    .map(
      (metric) => `<article>
    <h4>${dataHealthEscape(dataHealthText(metric.label))}</h4>
    <strong>${dataHealthEscape(metric.present)} / ${dataHealthEscape(metric.target)}</strong>
    <span>${dataHealthEscape(dataHealthText("{percent}% present · {missing} missing", { percent: metric.percent, missing: metric.missing }))}</span>
    <progress value="${dataHealthEscape(metric.present)}" max="${Math.max(1, Number(metric.target) || 1)}"></progress>
  </article>`,
    )
    .join("");
  let externalQueueRows =
    external.queues
      .filter((queue) => queue.count > 0)
      .map((queue) => queueRow(queue))
      .join("") ||
    `<tr><td colspan="6">${dataHealthEscape(dataHealthText("Nothing outstanding"))}</td></tr>`;
  let inferableBlock = external.inferableLetterboxd
    ? `<p class="data-panel-status">${dataHealthEscape(dataHealthText("{count} Letterboxd link(s) can be inferred from existing film URLs.", { count: external.inferableLetterboxd }))} <button type="button" data-apply-inferable-letterboxd>${dataHealthEscape(dataHealthText("Apply inferred Letterboxd links"))}</button></p>`
    : "";
  let mediaSession = window.tmdbMediaTypeSession || { checked: 0, issues: [] };
  let mediaIssueRows = (mediaSession.issues || [])
    .map(
      (issue) => `<tr>
    <td>${issue.href ? `<a href="${dataHealthEscape(issue.href)}">${dataHealthEscape(issue.title)}</a>` : dataHealthEscape(issue.title)}</td>
    <td>${dataHealthEscape(issue.localType || "")}</td>
    <td>${dataHealthEscape(issue.tmdbId)}</td>
    <td>${dataHealthEscape(issue.detail || issue.status)}</td>
  </tr>`,
    )
    .join("");
  let mediaResultBlock = mediaSession.checked
    ? mediaIssueRows
      ? `<h4>${dataHealthEscape(dataHealthText("TMDB media type issues (this session)"))}</h4><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr><th>${dataHealthEscape(dataHealthText("Film"))}</th><th>${dataHealthEscape(dataHealthText("Local type"))}</th><th>${dataHealthEscape(dataHealthText("TMDB ID"))}</th><th>${dataHealthEscape(dataHealthText("Result"))}</th></tr></thead><tbody>${mediaIssueRows}</tbody></table></div>`
      : `<p class="data-panel-status">${dataHealthEscape(dataHealthText("No media type mismatches found in {count} checked film(s) this session.", { count: mediaSession.checked }))}</p>`
    : "";
  let sheetRows = (report.sheetMetadata || [])
    .map(
      (metric) => `<article>
    <h4>${dataHealthEscape(dataHealthText(metric.label))}</h4>
    <strong>${dataHealthEscape(metric.present)} / ${dataHealthEscape(metric.target)}</strong>
    <span>${dataHealthEscape(dataHealthText("{percent}% present · {missing} missing", { percent: metric.percent, missing: metric.missing }))}</span>
    <progress value="${dataHealthEscape(metric.present)}" max="${Math.max(1, Number(metric.target) || 1)}"></progress>
    ${metric.note ? `<small>${dataHealthEscape(dataHealthText(metric.note))}</small>` : ""}
  </article>`,
    )
    .join("");
  let eligibilityRows =
    report.eligibilityGaps
      .map(
        (gap) => `<tr>
    <td>${gap.count}</td>
    <td>${dataHealthEscape(gap.category)}</td>
    <td>${dataHealthEscape(dataHealthText(gap.message))}</td>
    <td>${dataHealthEscape((gap.films || []).join(", ") || dataHealthText("None"))}</td>
    <td>${dataHealthEscape((gap.periods || []).join(", ") || dataHealthText("None"))}</td>
  </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5">${dataHealthEscape(dataHealthText("No eligibility metadata gaps"))}</td></tr>`;
  let findingRows =
    report.findings
      .map((finding) => {
        let candidate = finding.aliasCandidate;
        let actions = candidate
          ? `<div class="alias-actions"><button type="button" data-alias-canonical="${dataHealthEscape(candidate.leftId)}" data-alias-variant="${dataHealthEscape(candidate.rightId)}">${dataHealthEscape(dataHealthText("Use {name}", { name: candidate.leftName }))}</button><button type="button" data-alias-canonical="${dataHealthEscape(candidate.rightId)}" data-alias-variant="${dataHealthEscape(candidate.leftId)}">${dataHealthEscape(dataHealthText("Use {name}", { name: candidate.rightName }))}</button><button type="button" data-alias-reject-left="${dataHealthEscape(candidate.leftId)}" data-alias-reject-right="${dataHealthEscape(candidate.rightId)}">${dataHealthEscape(dataHealthText("Not same"))}</button></div>`
          : "";
        return `<tr><td><span class="health-severity ${dataHealthEscape(finding.severity)}">${dataHealthEscape(dataHealthText(finding.severity))}</span></td><td>${dataHealthEscape(finding.period)}</td><td>${dataHealthEscape(dataHealthText(finding.issue))}</td><td>${dataHealthEscape(finding.detail)}</td><td>${actions}</td></tr>`;
      })
      .join("") ||
    `<tr><td colspan="5">${dataHealthEscape(dataHealthText("No actionable findings"))}</td></tr>`;
  let aliasRows =
    report.confirmedAliases
      .map(
        (alias) =>
          `<tr><td>${dataHealthEscape(alias.variantName)}</td><td>${dataHealthEscape(alias.canonicalName)}</td><td><button type="button" data-alias-remove="${dataHealthEscape(alias.variantId)}">${dataHealthEscape(dataHealthText("Remove"))}</button></td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="3">${dataHealthEscape(dataHealthText("No confirmed aliases"))}</td></tr>`;
  let conflictRows =
    (report.sourceConflicts || [])
      .map(
        (conflict) => `<tr>
    <td>${dataHealthEscape(conflict.source || "")}</td>
    <td>${dataHealthEscape(conflict.title || "")}${conflict.year ? ` (${dataHealthEscape(conflict.year)})` : ""}</td>
    <td>${dataHealthEscape(dataHealthText(conflict.field === "tier" ? "tier" : "rating"))}</td>
    <td>${dataHealthEscape(conflict.existing ?? "")}</td>
    <td>${dataHealthEscape(conflict.incoming ?? "")}</td>
    <td>${dataHealthEscape(conflict.kept === "incoming" ? dataHealthText("Incoming") : dataHealthText("Existing"))}</td>
    <td>${dataHealthEscape(conflict.rowNumber || "")}</td>
  </tr>`,
      )
      .join("") ||
    `<tr><td colspan="7">${dataHealthEscape(dataHealthText("No cross-source conflicts recorded by the last import."))}</td></tr>`;
  let importConsistency = window.state?.importConsistency;
  let consistencySampleText = (check) =>
    (check.samples || [])
      .map(
        (sample) =>
          `${sample.title}${sample.year ? ` (${sample.year})` : ""} · ${dataHealthText("row")} ${sample.rowNumber}`,
      )
      .join(", ");
  let consistencyIssueRows = (importConsistency?.ranges || [])
    .flatMap((range) =>
      (range.checks || [])
        .filter((check) => check.missingCount > 0)
        .map(
          (check) => `<tr>
      <td>${dataHealthEscape(range.key)}</td>
      <td>${dataHealthEscape(dataHealthText(check.label || check.field || ""))}</td>
      <td>${check.sourceCount || 0}</td>
      <td>${check.missingCount || 0}</td>
      <td>${dataHealthEscape(consistencySampleText(check))}</td>
    </tr>`,
        ),
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
  // Session retry queues (issue #44): failed metadata/poster/portrait
  // lookups from this browser session stay visible here with an explicit
  // per-queue retry, instead of only surfacing in the last batch's report.
  let retryTypes = [
    "film-metadata",
    "watchlist-metadata",
    "film-posters",
    "watchlist-posters",
    "person-portraits",
  ];
  let retryRows = retryTypes
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
      return `<tr>
      <td><strong>${dataHealthEscape(window.metadataBatchLabel?.(type) || type)}</strong></td>
      <td>${attempted}</td>
      <td>${failures.length}</td>
      <td>${samples || dataHealthEscape(dataHealthText("None"))}</td>
      <td>${failures.length ? `<button type="button" data-retry-session-queue="${dataHealthEscape(type)}">${dataHealthEscape(dataHealthText("Retry {count} failed", { count: failures.length }))}</button>` : ""}</td>
    </tr>`;
    })
    .join("");
  let retryBody = retryRows
    ? `<div class="leaderboard-wrap"><table class="leaderboard data-health-retries"><thead><tr><th>${dataHealthEscape(dataHealthText("Queue"))}</th><th>${dataHealthEscape(dataHealthText("Attempted"))}</th><th>${dataHealthEscape(dataHealthText("Failed"))}</th><th>${dataHealthEscape(dataHealthText("Failures"))}</th><th></th></tr></thead><tbody>${retryRows}</tbody></table></div>`
    : `<p class="data-panel-status">${dataHealthEscape(dataHealthText("No metadata lookups have run this session."))}</p>`;
  container.innerHTML = `<div data-collapsible-section class="data-health-shell"><h2 data-collapsible-heading>${dataHealthEscape(dataHealthText("Data health"))}</h2><div data-collapsible-body class="data-health-body"><div class="health-summary"><span><b>${report.errors}</b> ${dataHealthEscape(dataHealthText("Errors"))}</span><span><b>${report.warnings}</b> ${dataHealthEscape(dataHealthText("Warnings"))}</span></div><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Sheet metadata coverage"))}</h3><div data-collapsible-body class="sheet-health-grid">${sheetRows}</div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Work queues"))}</h3><div data-collapsible-body><div class="leaderboard-wrap"><table class="leaderboard data-health-queues"><colgroup><col style="width:260px"><col style="width:110px"><col style="width:70px"><col><col style="width:90px"><col style="width:110px"></colgroup><thead><tr><th>${dataHealthEscape(dataHealthText("Queue"))}</th><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText("Missing"))}</th><th>${dataHealthEscape(dataHealthText("Samples"))}</th><th>${dataHealthEscape(dataHealthText("Open"))}</th><th>${dataHealthEscape(dataHealthText("Batch"))}</th></tr></thead><tbody>${queueRows}</tbody></table></div><div id="dataHealthQueueList" class="data-health-queue-detail" aria-live="polite"></div></div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("External IDs and media types"))}</h3><div data-collapsible-body><div class="sheet-health-grid">${externalMetricCards}</div><div class="leaderboard-wrap"><table class="leaderboard data-health-queues"><colgroup><col style="width:260px"><col style="width:110px"><col style="width:70px"><col><col style="width:90px"><col style="width:110px"></colgroup><thead><tr><th>${dataHealthEscape(dataHealthText("Queue"))}</th><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText("Missing"))}</th><th>${dataHealthEscape(dataHealthText("Samples"))}</th><th>${dataHealthEscape(dataHealthText("Open"))}</th><th>${dataHealthEscape(dataHealthText("Batch"))}</th></tr></thead><tbody>${externalQueueRows}</tbody></table></div>${inferableBlock}<div class="data-actions"><button type="button" data-check-tmdb-media-types>${dataHealthEscape(dataHealthText("Check TMDB media types"))}</button><span id="tmdbMediaTypeStatus" class="data-panel-status">${dataHealthEscape(dataHealthText("Probes stored TMDB IDs in explicit batches; flags IDs that resolve as TV or are missing."))}</span></div>${mediaResultBlock}</div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Eligibility review queues"))}</h3><div data-collapsible-body><div class="leaderboard-wrap"><table class="leaderboard data-health-queues"><colgroup><col style="width:260px"><col style="width:110px"><col style="width:70px"><col><col style="width:90px"></colgroup><thead><tr><th>${dataHealthEscape(dataHealthText("Queue"))}</th><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText("Nominees"))}</th><th>${dataHealthEscape(dataHealthText("Samples"))}</th><th>${dataHealthEscape(dataHealthText("Open"))}</th></tr></thead><tbody>${eligibilityQueueRows}</tbody></table></div></div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Eligibility metadata"))}</h3><div data-collapsible-body class="leaderboard-wrap"><table class="leaderboard data-health-eligibility"><colgroup><col style="width:70px"><col style="width:200px"><col style="width:320px"><col><col style="width:160px"></colgroup><thead><tr><th>${dataHealthEscape(dataHealthText("Count"))}</th><th>${dataHealthEscape(dataHealthText("Category"))}</th><th>${dataHealthEscape(dataHealthText("Issue"))}</th><th>${dataHealthEscape(dataHealthText("Sample films"))}</th><th>${dataHealthEscape(dataHealthText("Sample periods"))}</th></tr></thead><tbody>${eligibilityRows}</tbody></table></div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Cross-source conflicts"))}</h3><div data-collapsible-body class="leaderboard-wrap"><table class="leaderboard data-health-conflicts"><thead><tr><th>${dataHealthEscape(dataHealthText("Source"))}</th><th>${dataHealthEscape(dataHealthText("Film"))}</th><th>${dataHealthEscape(dataHealthText("Field"))}</th><th>${dataHealthEscape(dataHealthText("Existing"))}</th><th>${dataHealthEscape(dataHealthText("Incoming"))}</th><th>${dataHealthEscape(dataHealthText("Kept"))}</th><th>${dataHealthEscape(dataHealthText("Row"))}</th></tr></thead><tbody>${conflictRows}</tbody></table></div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Import consistency"))}</h3><div data-collapsible-body>${consistencyBody}</div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Session retry queues"))}</h3><div data-collapsible-body>${retryBody}</div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Images"))}</h3><div data-collapsible-body class="image-health-grid"><article><h4>${dataHealthEscape(dataHealthText("Posters"))}</h4><strong>${report.images.posters} / ${report.images.posterTarget}</strong><span>${dataHealthEscape(dataHealthText("Imported posters out of films"))}</span><progress value="${report.images.posters}" max="${Math.max(1, report.images.posterTarget)}"></progress><small>${dataHealthEscape(dataHealthText("{count} failed import attempt(s)", { count: report.images.posterFailures }))}</small></article><article><h4>${dataHealthEscape(dataHealthText("Portraits"))}</h4><strong>${report.images.portraits} / ${report.images.portraitTarget}</strong><span>${dataHealthEscape(dataHealthText("Imported portraits out of people"))}</span><progress value="${report.images.portraits}" max="${Math.max(1, report.images.portraitTarget)}"></progress><small>${dataHealthEscape(dataHealthText("{count} failed import attempt(s)", { count: report.images.portraitFailures }))}</small></article></div></section><section data-collapsible-section class="health-subsection"><h3 data-collapsible-heading>${dataHealthEscape(dataHealthText("Findings"))}</h3><div data-collapsible-body class="leaderboard-wrap"><table class="leaderboard data-health-findings"><colgroup><col style="width:90px"><col style="width:90px"><col style="width:160px"><col><col style="width:240px"></colgroup><thead><tr><th>${dataHealthEscape(dataHealthText("Severity"))}</th><th>${dataHealthEscape(dataHealthText("Period"))}</th><th>${dataHealthEscape(dataHealthText("Issue"))}</th><th>${dataHealthEscape(dataHealthText("Detail"))}</th><th>${dataHealthEscape(dataHealthText("Review"))}</th></tr></thead><tbody>${findingRows}</tbody></table></div></section><section data-collapsible-section class="health-subsection"><div data-collapsible-heading class="health-section-heading"><h3>${dataHealthEscape(dataHealthText("Confirmed person aliases"))}</h3>${report.rejectedAliasCount ? `<button type="button" data-alias-reset-rejected>${dataHealthEscape(dataHealthText("Reset {count} dismissed", { count: report.rejectedAliasCount }))}</button>` : ""}</div><div data-collapsible-body class="leaderboard-wrap"><table class="leaderboard alias-table"><thead><tr><th>${dataHealthEscape(dataHealthText("Variant"))}</th><th>${dataHealthEscape(dataHealthText("Canonical name"))}</th><th></th></tr></thead><tbody>${aliasRows}</tbody></table></div></section></div></div>`;
  window.enhanceCollapsibles?.(container);
  finishRenderTimer?.(`${report.findings.length} finding(s)`);
};

/**
 * Renders every entry in one data-health queue and scrolls it into view.
 * @param {string} queueId Queue identifier from the current health report.
 * @param {HTMLElement|null} [target] Dashboard containing the queue detail panel.
 */
window.openDataHealthQueue = function (
  queueId,
  target = document.getElementById("dataHealthView"),
) {
  if (!target) return;
  let finishQueueTimer = window.startOskarsPerformance?.(
    "dataHealth:openQueue",
  );
  let { report } = currentDataHealthReport(false);
  let id = String(queueId || "");
  let queue = [
    ...(report.queues || []),
    ...(report.eligibilityQueues || []),
    ...(report.externalIds?.queues || []),
  ].find((item) => item.id === id);
  let entries = queue?.entries || [];

  let container = target.querySelector("#dataHealthQueueList");
  if (!container) {
    container = document.createElement?.("div");
    if (!container) return;
    container.id = "dataHealthQueueList";
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
      (e) =>
        `<li>${e.href ? `<a href="${window.pageEscape(e.href)}">${window.pageEscape(e.title)}</a>` : window.pageEscape(e.title)}${e.note ? ` <small>(${window.pageEscape(e.note)})</small>` : ""}</li>`,
    )
    .join("");
  container.innerHTML = `<h3>${window.pageEscape(dataHealthText(queue?.label || queueId))}</h3><p class="data-panel-status">${window.pageEscape(dataHealthText("{count} item(s) in queue.", { count: entries.length }))}</p><ul class="data-health-queue-items">${rows}</ul>`;
  container.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  finishQueueTimer?.(`${id}, ${entries.length} item(s)`);
};
