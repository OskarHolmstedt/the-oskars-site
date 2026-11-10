/** @file Renders curated 3-tier collection trophies, persona progression, and entity banner widgets. */

/**
 * Renders an inline badge tag for a collection curation tier.
 * @param {string} tierKey Tier identifier ('essentialist', 'completionist', 'sycophant').
 * @returns {string} HTML badge element, or an empty string if uncurated.
 */
window.renderCollectionTierBadge = function (tierKey) {
  const escape = window.pageEscape || ((s) => String(s ?? ""));
  const ui = window.uiText || ((text) => text);
  if (tierKey === "essentialist") {
    return `<span class="collection-tier-badge tier-essentialist" title="${escape(ui("The Essentials · Curated artistic landmark"))}"><span class="tier-badge-icon" aria-hidden="true">🥉</span><span class="tier-badge-label">${escape(ui("Essential"))}</span></span>`;
  }
  if (tierKey === "completionist") {
    return `<span class="collection-tier-badge tier-completionist" title="${escape(ui("Theatrical Canon · Official feature film"))}"><span class="tier-badge-icon" aria-hidden="true">🥈</span><span class="tier-badge-label">${escape(ui("Canon"))}</span></span>`;
  }
  if (tierKey === "sycophant") {
    return `<span class="collection-tier-badge tier-sycophant" title="${escape(ui("Expanded Works · Shorts, TV, and bonus entries"))}"><span class="tier-badge-icon" aria-hidden="true">🥇</span><span class="tier-badge-label">${escape(ui("Expanded"))}</span></span>`;
  }
  return "";
};

/**
 * Renders a compact vertical trophy progress widget for the person detail header (right actions column).
 * @param {CollectionTrophyProgress} trophy Curated collection trophy progress.
 * @returns {string} HTML widget markup.
 */
window.renderPersonTrophyWidget = function (trophy) {
  if (!trophy || !trophy.tierList) return "";
  const escape = window.pageEscape || ((s) => String(s ?? ""));
  const ui = window.uiText || ((text) => text);

  const active = trophy.activeTier;
  const next = trophy.nextTier;
  const statusText = active
    ? `${active.badge} ${active.personaTitle}`
    : ui("Trophy in progress");

  const captionText = active
    ? next
      ? ui("Next: {nextTier} ({watched}/{total})", {
          nextTier: next.title,
          watched: next.watchedCount,
          total: next.total,
        })
      : ui("All collection trophies unlocked!")
    : next
      ? ui("Aiming for {targetTier} ({watched}/{total})", {
          targetTier: next.personaTitle,
          watched: next.watchedCount,
          total: next.total,
        })
      : "";

  return `<div class="person-trophy-widget" aria-label="${escape(ui("Collection trophy progress"))}">
    <div class="person-trophy-widget-header">
      <div class="person-trophy-widget-emblem" aria-hidden="true">${escape(trophy.emblem)}</div>
      <div class="person-trophy-widget-titles">
        <span class="person-trophy-widget-eyebrow">${escape(ui("Trophies"))}</span>
        <strong class="person-trophy-widget-status">${escape(statusText)}</strong>
        ${captionText ? `<span class="person-trophy-widget-caption">${escape(captionText)}</span>` : ""}
      </div>
    </div>
    <div class="person-trophy-widget-steps" role="list">
      ${trophy.tierList
        .map((tier) => {
          const progressLabel = ui("{watched} of {total} watched", {
            watched: tier.watchedCount,
            total: tier.total,
          });
          const tierShortName =
            tier.tier === "essentialist"
              ? ui("Essential")
              : tier.tier === "completionist"
                ? ui("Canon")
                : ui("Expanded");
          return `<div class="person-trophy-widget-step${tier.earned ? " is-earned" : ""}" role="listitem">
            <div class="person-trophy-step-meta">
              <span class="person-trophy-step-name"><span class="person-trophy-step-badge" aria-hidden="true">${tier.badge}</span> ${escape(tierShortName)}</span>
              <span class="person-trophy-step-ratio">${tier.watchedCount}/${tier.total}</span>
            </div>
            <progress class="person-trophy-step-bar" value="${tier.watchedCount}" max="${tier.total}" aria-label="${escape(ui(tier.title))} · ${escape(progressLabel)}">${escape(progressLabel)}</progress>
          </div>`;
        })
        .join("")}
    </div>
  </div>`;
};

/**
 * Renders an interactive header progress banner widget for a curated collection entity.
 * @param {CollectionTrophyProgress} trophy Curated collection trophy progress.
 * @returns {string} Collection trophy progress banner markup.
 */
window.renderCollectionTrophyBanner = function (trophy) {
  if (!trophy || !trophy.tierList) return "";
  const escape = window.pageEscape || ((s) => String(s ?? ""));
  const ui = window.uiText || ((text) => text);

  const active = trophy.activeTier;
  const next = trophy.nextTier;
  const bannerId = `${trophy.domId}Banner`;
  const headingId = `${bannerId}Heading`;

  const statusText = active
    ? `${active.badge} ${active.personaTitle}`
    : ui("Trophy in progress");

  const captionText = active
    ? next
      ? ui("Next milestone: {nextTier} ({watched} of {total} watched)", {
          nextTier: next.title,
          watched: next.watchedCount,
          total: next.total,
        })
      : ui("All collection trophies unlocked!")
    : next
      ? ui("Aiming for {targetTier} ({watched} of {total} watched)", {
          targetTier: next.personaTitle,
          watched: next.watchedCount,
          total: next.total,
        })
      : "";

  return `<section id="${escape(bannerId)}" class="collection-trophy-banner" aria-labelledby="${escape(headingId)}">
    <div class="trophy-banner-header">
      <div class="trophy-banner-emblem" aria-hidden="true">${escape(trophy.emblem)}</div>
      <div class="trophy-banner-titles">
        <span class="trophy-banner-eyebrow">${escape(ui("Collection Trophies"))}</span>
        <h3 id="${escape(headingId)}" class="trophy-banner-title">${escape(statusText)}</h3>
        <p class="trophy-banner-caption">${escape(captionText)}</p>
      </div>
    </div>
    <div class="trophy-tier-steps" role="list" aria-label="${escape(ui("Collection trophy progress"))}">
      ${trophy.tierList
        .map((tier) => {
          const stepId = `${bannerId}_${tier.tier}`;
          const progressLabel = ui("{watched} of {total} watched", {
            watched: tier.watchedCount,
            total: tier.total,
          });
          return `<div id="${escape(stepId)}" class="trophy-tier-step${tier.earned ? " is-earned" : ""}" role="listitem">
            <div class="tier-step-meta">
              <span class="tier-step-badge" aria-hidden="true">${tier.badge}</span>
              <strong class="tier-step-name">${escape(ui(tier.title))}</strong>
              <span class="tier-step-ratio">${tier.watchedCount}/${tier.total}</span>
            </div>
            <progress class="tier-step-progress" value="${tier.watchedCount}" max="${tier.total}" aria-label="${escape(ui(tier.title))} · ${escape(progressLabel)}">${escape(progressLabel)}</progress>
          </div>`;
        })
        .join("")}
    </div>
  </section>`;
};

/**
 * Renders the curated 3-tier collection trophy cabinet on completion.html.
 * @returns {string} Trophy cabinet markup for the active archive.
 */
/**
 * Renders the curated 3-tier collection trophy cabinet and compact in-progress milestones on completion.html.
 * @returns {string} Trophy cabinet markup for the active archive.
 */
window.renderTrophyCabinet = function () {
  const allTrophies = window.allTrophiesData
    ? window.allTrophiesData()
    : window.collectionTrophiesData
      ? window.collectionTrophiesData()
      : window.trophyCabinetData();
  const escape = window.pageEscape || ((s) => String(s ?? ""));
  const ui = window.uiText || ((text) => text);

  let earnedTrophyCount = 0;
  let totalTrophyCount = 0;
  allTrophies.forEach((col) => {
    col.tierList.forEach((tier) => {
      totalTrophyCount += 1;
      if (tier.earned) earnedTrophyCount += 1;
    });
  });

  const acquired = allTrophies.filter((col) => Boolean(col.activeTier));
  const inProgress = allTrophies.filter((col) => !col.earned);

  const filmographyCount = inProgress.filter(
    (c) => c.kind === "filmography",
  ).length;
  const franchiseCount = inProgress.filter(
    (c) => c.kind === "franchise",
  ).length;
  const otherCount = inProgress.filter(
    (c) => c.kind === "other-collection",
  ).length;
  const progressCount = inProgress.filter((c) => c.kind === "progress").length;

  function renderAcquiredTrophyCard(col) {
    const colHeadingId = `acquired_${col.domId}Heading`;
    const entityUrl =
      col.entityType === "person"
        ? window.personPageUrl
          ? window.personPageUrl(col.entityId)
          : `person.html?id=${encodeURIComponent(col.entityId)}`
        : col.entityType === "franchise"
          ? window.franchisePageUrl
            ? window.franchisePageUrl(col.entityId)
            : `franchise.html?id=${encodeURIComponent(col.entityId)}`
          : "";
    const titleHtml = entityUrl
      ? `<a class="trophy-entity-link" href="${escape(entityUrl)}">${escape(col.title)}</a>`
      : escape(col.title);
    const active = col.activeTier;
    const badge = active ? active.badge : "🏆";
    const personaTitle = active ? active.personaTitle : col.title;
    const celebration = col.celebration
      ? active?.celebration && active.celebration !== col.celebration
        ? `${col.celebration} ${active.celebration}`
        : col.celebration
      : active?.celebration || "";

    return `<article id="acquired_${escape(col.id)}" class="acquired-trophy-card tier-${active?.tier || "sycophant"} is-earned" aria-labelledby="${colHeadingId}">
      <div class="acquired-trophy-header">
        <div class="acquired-trophy-emblem" aria-hidden="true">
          <span>${escape(col.emblem)}</span>
          <small>${escape(col.edition || "")}</small>
        </div>
        <div class="acquired-trophy-meta">
          <span class="acquired-badge" aria-hidden="true">${badge}</span>
          <h3 id="${colHeadingId}" class="acquired-title">${titleHtml}</h3>
          <strong class="acquired-persona">${escape(personaTitle)}</strong>
        </div>
      </div>
      ${celebration ? `<p class="acquired-celebration">${escape(ui(celebration))}</p>` : ""}
      <div class="acquired-trophy-tiers">
        ${col.tierList
          .map(
            (
              tier,
            ) => `<span class="acquired-tier-pill tier-${tier.tier}${tier.earned ? " is-earned" : ""}" title="${escape(ui("Trophy earned"))}">
            ${tier.badge} ${escape(ui(tier.title))}: ${tier.watchedCount} of ${tier.total} watched
          </span>`,
          )
          .join("")}
      </div>
    </article>`;
  }

  function renderCompactTrophyCard(col) {
    const colHeadingId = `${col.domId}Heading`;
    const entityUrl =
      col.entityType === "person"
        ? window.personPageUrl
          ? window.personPageUrl(col.entityId)
          : `person.html?id=${encodeURIComponent(col.entityId)}`
        : col.entityType === "franchise"
          ? window.franchisePageUrl
            ? window.franchisePageUrl(col.entityId)
            : `franchise.html?id=${encodeURIComponent(col.entityId)}`
          : "";
    const titleHtml = entityUrl
      ? `<a class="trophy-entity-link" href="${escape(entityUrl)}">${escape(col.title)}</a>`
      : escape(col.title);

    let statusText = "";
    if (col.activeTier && col.nextTier) {
      statusText = `<span class="compact-trophy-status">${escape(col.activeTier.badge)} ${escape(col.activeTier.personaTitle)}</span> <span class="compact-trophy-next">· ${escape(ui("Next: {nextTier} ({watched}/{total})", { nextTier: col.nextTier.title, watched: col.nextTier.watchedCount, total: col.nextTier.total }))}</span>`;
    } else if (col.activeTier) {
      statusText = `<span class="compact-trophy-status">${escape(col.activeTier.badge)} ${escape(col.activeTier.personaTitle)}</span> <span class="compact-trophy-next">· ${escape(ui("Complete"))}</span>`;
    } else if (col.nextTier) {
      statusText = `<span class="compact-trophy-next">${escape(ui("Next: {nextTier} ({watched}/{total})", { nextTier: col.nextTier.title, watched: col.nextTier.watchedCount, total: col.nextTier.total }))}</span>`;
    }

    const kindLabel =
      col.kind === "filmography"
        ? ui("Filmography")
        : col.kind === "franchise"
          ? ui("Franchises")
          : col.kind === "progress"
            ? ui("Progress")
            : ui("Collections");

    const tierStepsHtml = col.tierList
      .map((tier) => {
        const tierHeadingId = `${col.domId}_${tier.tier}Heading`;
        const progressId = `${col.domId}_${tier.tier}Progress`;
        const progressText = ui("{watched} of {total} watched", {
          watched: tier.watchedCount,
          total: tier.total,
        });
        const tierName =
          tier.tier === "essentialist"
            ? ui("Essential")
            : tier.tier === "completionist"
              ? ui("Canon")
              : ui("Expanded");
        const stepClasses =
          col.kind === "progress"
            ? `compact-tier-step tier-${tier.tier}${tier.earned ? " is-earned" : ""}`
            : `trophy-tier-card compact-tier-step tier-${tier.tier}${tier.earned ? " is-earned" : ""}`;
        return `<div class="${stepClasses}">
          <div class="compact-tier-meta">
            <span class="tier-step-badge" aria-hidden="true">${tier.badge}</span>
            <strong id="${tierHeadingId}" class="tier-step-name">${escape(tierName)}</strong>
            <span class="tier-step-ratio">${tier.watchedCount}/${tier.total}</span>
          </div>
          <progress id="${progressId}" class="compact-tier-progress-bar" value="${tier.watchedCount}" max="${tier.total}" aria-describedby="${tierHeadingId}" aria-label="${escape(ui(tier.title))} · ${escape(progressText)}">${escape(progressText)}</progress>
          <span class="compact-tier-scope">${escape(ui(tier.scope))}</span>
          <small class="compact-tier-caption">${escape(ui(tier.earned ? tier.celebration : tier.invitation))}</small>
        </div>`;
      })
      .join("");

    let detailsHtml = "";
    if (col.kind !== "progress") {
      const seenFilmKeys = new Set();
      const exclusiveSections = col.tierList
        .map((tier) => {
          const list =
            tier.tierOnlyFilms && tier.tierOnlyFilms.length
              ? tier.tierOnlyFilms
              : tier.tier === "essentialist"
                ? tier.films
                : [];
          const validList = (list || []).filter((film) => {
            if (!film || !film.title || film.title.startsWith("Film ")) {
              return false;
            }
            const normKey = `${String(film.title)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "")}::${film.year || 0}`;
            if (
              seenFilmKeys.has(normKey) ||
              (film.id && seenFilmKeys.has(film.id))
            ) {
              return false;
            }
            seenFilmKeys.add(normKey);
            if (film.id) seenFilmKeys.add(film.id);
            return true;
          });
          if (!validList.length) return "";
          const tierName =
            tier.tier === "essentialist"
              ? ui("Essential")
              : tier.tier === "completionist"
                ? ui("Canon")
                : ui("Expanded");
          return `<div class="exclusive-tier-group">
            <h5 class="exclusive-tier-title"><span aria-hidden="true">${tier.badge}</span> ${escape(tierName)} (${validList.length})</h5>
            <ul class="exclusive-tier-list">
              ${validList
                .map((film) => {
                  const href = window.filmPageUrl
                    ? window.filmPageUrl(film.id)
                    : `film.html?id=${encodeURIComponent(film.id)}`;
                  return `<li>
                    <span class="trophy-film-state">${escape(ui(film.watched ? "Watched" : "Not watched"))}</span>
                    <span><a href="${escape(href)}">${escape(film.title)}</a>${film.kind ? `<small class="trophy-film-kind">${escape(ui(film.kind))}</small>` : ""}</span>
                    <span class="trophy-film-year">${film.year || ""}</span>
                  </li>`;
                })
                .join("")}
            </ul>
          </div>`;
        })
        .filter(Boolean)
        .join("");

      if (exclusiveSections) {
        detailsHtml = `<details class="trophy-films">
          <summary aria-label="${escape(ui("View collection"))} · ${escape(col.title)}">${escape(ui("View collection"))}</summary>
          <p>${escape(ui(col.criteria))}</p>
          ${exclusiveSections}
        </details>`;
      }
    }

    const cardClass =
      col.kind === "progress"
        ? `progress-trophy compact-trophy-card${col.earned ? " is-earned" : ""}`
        : `collection-trophy compact-trophy-card${col.earned ? " is-earned" : ""}`;

    return `<article id="${escape(col.id)}" class="${cardClass}" data-trophy-kind="${escape(col.kind)}" aria-labelledby="${colHeadingId}">
      <div class="compact-trophy-header">
        <div class="compact-trophy-emblem" aria-hidden="true">
          <span>${escape(col.emblem)}</span>
          <small>${escape(col.edition || "")}</small>
        </div>
        <div class="compact-trophy-info">
          <div class="compact-trophy-title-row">
            <h3 id="${colHeadingId}" class="compact-trophy-title">${titleHtml}</h3>
            <span class="compact-trophy-kind-pill">${escape(kindLabel)}</span>
          </div>
          <div class="compact-trophy-status-row">
            ${statusText}
          </div>
          ${col.kind === "progress" ? `<p class="compact-trophy-scope">${escape(ui(col.scope))}</p>` : ""}
          <p class="compact-trophy-invitation">${escape(ui(col.invitation))}</p>
        </div>
      </div>

      <div class="compact-trophy-meter-wrap">
        <div class="compact-trophy-steps" role="list">
          ${tierStepsHtml}
        </div>
      </div>

      ${detailsHtml}
    </article>`;
  }

  const acquiredGridHtml = acquired.length
    ? `<div class="acquired-trophy-grid">${acquired.map(renderAcquiredTrophyCard).join("")}</div>`
    : `<div class="trophy-cabinet-empty">
        <div class="trophy-empty-emblem" aria-hidden="true">🏆</div>
        <h3>${escape(ui("Your trophy cabinet is empty"))}</h3>
        <p>${escape(ui("Acquire trophies by watching curated milestones across director filmographies, franchises, and viewing progress."))}</p>
      </div>`;

  return `<section id="trophies" class="trophy-cabinet" aria-labelledby="trophyCabinetHeading">
    <header class="trophy-cabinet-header">
      <div class="trophy-cabinet-title-row">
        <h2 id="trophyCabinetHeading">${escape(ui("Trophy cabinet"))}</h2>
        <span class="trophy-cabinet-counter">${escape(ui("{earned} of {total} trophies earned", { earned: earnedTrophyCount, total: totalTrophyCount }))}</span>
      </div>
      <p>${escape(ui("Three-tier cinephile milestones: Essentialist, Completionist, and Sycophant."))}</p>
    </header>
    ${acquiredGridHtml}
  </section>

  <section id="trophyProgress" class="trophy-progress-section" aria-labelledby="trophyProgressHeading">
    <header class="trophy-progress-header">
      <div class="trophy-progress-title-row">
        <h2 id="trophyProgressHeading">${escape(ui("Trophy progress"))}</h2>
        <span class="trophy-progress-counter">${escape(ui("{count} in progress", { count: inProgress.length }))}</span>
      </div>
      <p>${escape(ui("Track upcoming milestones across director filmographies, franchises, and viewing progress."))}</p>
    </header>

    <div class="trophy-kind-filters period-view-controls" role="group" aria-label="${escape(ui("Filter trophies by kind"))}">
      <button type="button" class="period-view-pill is-active" data-trophy-kind-filter="all">${escape(ui("All"))} <span class="filter-count">(${inProgress.length})</span></button>
      <button type="button" class="period-view-pill" data-trophy-kind-filter="filmography">${escape(ui("Filmography"))} <span class="filter-count">(${filmographyCount})</span></button>
      ${franchiseCount > 0 ? `<button type="button" class="period-view-pill" data-trophy-kind-filter="franchise">${escape(ui("Franchises"))} <span class="filter-count">(${franchiseCount})</span></button>` : ""}
      ${otherCount > 0 ? `<button type="button" class="period-view-pill" data-trophy-kind-filter="other-collection">${escape(ui("Collections"))} <span class="filter-count">(${otherCount})</span></button>` : ""}
      ${progressCount > 0 ? `<button type="button" class="period-view-pill" data-trophy-kind-filter="progress">${escape(ui("Progress"))} <span class="filter-count">(${progressCount})</span></button>` : ""}
    </div>

    <div class="compact-trophy-grid">
      ${inProgress.map(renderCompactTrophyCard).join("")}
    </div>
  </section>`;
};
