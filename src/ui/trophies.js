/** @file Renders the fixed-collection trophy cabinet using semantic HTML and typographic ornament. */

/**
 * Renders the Mission: Impossible trophy and its expandable film checklist.
 * @returns {string} Trophy cabinet markup for the active archive.
 */
window.renderTrophyCabinet = function () {
  const trophy = window.missionImpossibleTrophy();
  const escape = window.pageEscape;
  const ui = window.uiText || ((text) => text);
  const profile = window.resolveActiveProfileSlug?.();
  const progress = ui("{watched} of {total} watched", {
    watched: trophy.watchedCount,
    total: trophy.total,
  });
  return `<section id="trophies" class="trophy-cabinet" aria-labelledby="trophyCabinetHeading">
    <header><h2 id="trophyCabinetHeading">${escape(ui("Trophy cabinet"))}</h2>
    <p>${escape(ui("Fixed collections. Every film counts."))}</p></header>
    <article class="collection-trophy${trophy.earned ? " is-earned" : ""}" aria-labelledby="missionTrophyHeading">
      <div class="trophy-emblem" aria-hidden="true"><span>M:I</span><small>VIII</small></div>
      <div class="trophy-content">
        <p class="trophy-status">${escape(ui(trophy.earned ? "Trophy earned" : "In progress"))}</p>
        <h3 id="missionTrophyHeading">${escape(trophy.title)}</h3>
        <p class="trophy-caption">${escape(ui(trophy.earned ? "You did the impossible." : "Your mission: watch all eight films."))}</p>
        <label class="trophy-progress-label" for="missionTrophyProgress">${escape(progress)}</label>
        <progress id="missionTrophyProgress" value="${trophy.watchedCount}" max="${trophy.total}">${escape(progress)}</progress>
        <details class="trophy-films"><summary>${escape(ui("View the eight films"))}</summary>
          <p>${escape(ui("This collection is fixed at eight films. Existing watches count; future releases do not change it."))}</p>
          <ul>${trophy.films
            .map((film) => {
              let href = window.filmPageUrl(film.id);
              if (profile) href += `&profile=${encodeURIComponent(profile)}`;
              return `<li><span class="trophy-film-state">${escape(ui(film.watched ? "Watched" : "Not watched"))}</span><a href="${escape(href)}">${escape(film.title)}</a><span class="trophy-film-year">${film.year}</span></li>`;
            })
            .join("")}</ul>
        </details>
      </div>
    </article>
  </section>`;
};
