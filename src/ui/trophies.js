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
    return `<span class="collection-tier-badge tier-essentialist" title="${escape(ui("The Essentials · Curated artistic peak"))}">${escape(ui("Essential"))}</span>`;
  }
  if (tierKey === "completionist") {
    return `<span class="collection-tier-badge tier-completionist" title="${escape(ui("The Theatrical Canon · Official feature film"))}">${escape(ui("Theatrical Canon"))}</span>`;
  }
  if (tierKey === "sycophant") {
    return `<span class="collection-tier-badge tier-sycophant" title="${escape(ui("Expanded & Bonus Works · Peripheral catalog entry"))}">${escape(ui("Expanded Canon"))}</span>`;
  }
  return "";
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
window.renderTrophyCabinet = function () {
  const trophies = window.collectionTrophiesData
    ? window.collectionTrophiesData()
    : window.trophyCabinetData();
  const escape = window.pageEscape || ((s) => String(s ?? ""));
  const ui = window.uiText || ((text) => text);

  let earnedTrophyCount = 0;
  let totalTrophyCount = 0;
  trophies.forEach((col) => {
    col.tierList.forEach((tier) => {
      totalTrophyCount += 1;
      if (tier.earned) earnedTrophyCount += 1;
    });
  });

  return `<section id="trophies" class="trophy-cabinet" aria-labelledby="trophyCabinetHeading">
    <header>
      <h2 id="trophyCabinetHeading">${escape(ui("Trophy cabinet"))}</h2>
      <p>${escape(ui("{earned} of {total} trophies earned", { earned: earnedTrophyCount, total: totalTrophyCount }))} · ${escape(ui("Three-tier cinephile milestones: Essentialist, Completionist, and Sycophant."))}</p>
    </header>
    <div class="trophy-grid">
      ${trophies
        .map((col) => {
          const colHeadingId = `${col.domId}Heading`;
          const entityUrl =
            col.entityType === "person"
              ? window.personPageUrl
                ? window.personPageUrl(col.entityId)
                : `person.html?id=${encodeURIComponent(col.entityId)}`
              : window.franchisePageUrl
                ? window.franchisePageUrl(col.entityId)
                : `franchise.html?id=${encodeURIComponent(col.entityId)}`;

          const highestTitle = col.activeTier
            ? `${col.activeTier.badge} ${col.activeTier.personaTitle}`
            : ui("Trophy in progress");

          return `<article id="${escape(col.id)}" class="collection-trophy${col.earned ? " is-earned" : ""}" aria-labelledby="${colHeadingId}">
            <div class="trophy-header-row">
              <div class="trophy-emblem" aria-hidden="true">
                <span>${escape(col.emblem)}</span>
                <small>${escape(col.edition || "")}</small>
              </div>
              <div class="trophy-content">
                <span class="trophy-status">${escape(highestTitle)}</span>
                <h3 id="${colHeadingId}"><a class="trophy-entity-link" href="${escape(entityUrl)}">${escape(col.title)}</a></h3>
                <p class="trophy-scope">${escape(ui(col.scope))}</p>
                ${col.earned ? `<p class="trophy-celebration">${escape(ui(col.celebration))}</p>` : ""}
              </div>
            </div>

            <div class="trophy-tier-progression">
              ${col.tierList
                .map((tier) => {
                  const tierHeadingId = `${col.domId}_${tier.tier}Heading`;
                  const progressId = `${col.domId}_${tier.tier}Progress`;
                  const progressText = ui("{watched} of {total} watched", {
                    watched: tier.watchedCount,
                    total: tier.total,
                  });
                  return `<div class="trophy-tier-card tier-${tier.tier}${tier.earned ? " is-earned" : ""}">
                    <div class="tier-card-header">
                      <span class="tier-badge" aria-hidden="true">${tier.badge}</span>
                      <div class="tier-card-title-wrap">
                        <h4 id="${tierHeadingId}">${escape(ui(tier.title))} · <span class="persona-highlight">${escape(tier.personaTitle)}</span></h4>
                        <span class="tier-scope-text">${escape(ui(tier.scope))}</span>
                      </div>
                      <span class="tier-status-pill">${escape(ui(tier.earned ? "Trophy earned" : "In progress"))}</span>
                    </div>
                    <p class="trophy-caption">${escape(ui(tier.earned ? tier.celebration : tier.invitation))}</p>
                    <div class="tier-progress-row">
                      <label class="trophy-progress-label" for="${progressId}">${escape(progressText)}</label>
                      <progress id="${progressId}" value="${tier.watchedCount}" max="${tier.total}" aria-describedby="${tierHeadingId}">${escape(progressText)}</progress>
                    </div>
                    <details class="trophy-films">
                      <summary aria-label="${escape(ui("View collection"))} · ${escape(col.title)} · ${escape(ui(tier.title))}">${escape(ui("View collection"))}</summary>
                      <p>${escape(ui(tier.criteria))}</p>
                      <ul>
                        ${tier.films
                          .map((film) => {
                            const href = window.filmPageUrl
                              ? window.filmPageUrl(film.id)
                              : `film.html?id=${encodeURIComponent(film.id)}`;
                            return `<li>
                              <span class="trophy-film-state">${escape(ui(film.watched ? "Watched" : "Not watched"))}</span>
                              <span><a href="${escape(href)}">${escape(film.title)}</a>${film.kind ? `<small class="trophy-film-kind">${escape(ui(film.kind))}</small>` : ""}</span>
                              <span class="trophy-film-year">${film.year}</span>
                            </li>`;
                          })
                          .join("")}
                      </ul>
                    </details>
                  </div>`;
                })
                .join("")}
            </div>
          </article>`;
        })
        .join("")}
    </div>
  </section>`;
};
