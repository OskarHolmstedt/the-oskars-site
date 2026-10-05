/** @file Renders the curated trophy cabinet using semantic HTML and typographic ornament. */

/**
 * Renders fixed collection trophies and their expandable watched checklists.
 * @returns {string} Trophy cabinet markup for the active archive.
 */
window.renderTrophyCabinet = function () {
  const trophies = window.trophyCabinetData();
  const escape = window.pageEscape;
  const ui = window.uiText || ((text) => text);
  const profile = window.resolveActiveProfileSlug?.();
  const earned = trophies.filter((trophy) => trophy.earned).length;
  return `<section id="trophies" class="trophy-cabinet" aria-labelledby="trophyCabinetHeading">
    <header><h2 id="trophyCabinetHeading">${escape(ui("Trophy cabinet"))}</h2>
    <p>${escape(ui("{earned} of {total} trophies earned", { earned, total: trophies.length }))} · ${escape(ui("Fixed collections from your viewing history."))}</p></header>
    <div class="trophy-grid">${trophies
      .map((trophy) => {
        const progress = ui("{watched} of {total} watched", {
          watched: trophy.watchedCount,
          total: trophy.total,
        });
        const headingId = `${trophy.domId}Heading`;
        const progressId = `${trophy.domId}Progress`;
        const scopeId = `${trophy.domId}Scope`;
        return `<article id="${escape(trophy.id)}" class="collection-trophy${trophy.earned ? " is-earned" : ""}" aria-labelledby="${headingId} ${scopeId}">
        <div class="trophy-emblem" aria-hidden="true"><span>${escape(trophy.emblem)}</span><small>${escape(trophy.edition)}</small></div>
        <div class="trophy-content">
          <p class="trophy-status">${escape(ui(trophy.earned ? "Trophy earned" : "In progress"))}</p>
          <h3 id="${headingId}">${escape(trophy.title)}</h3>
          <p id="${scopeId}" class="trophy-scope">${escape(ui(trophy.scope))}</p>
          <p class="trophy-caption">${escape(ui(trophy.earned ? trophy.celebration : trophy.invitation))}</p>
          <label class="trophy-progress-label" for="${progressId}">${escape(progress)}</label>
          <progress id="${progressId}" value="${trophy.watchedCount}" max="${trophy.total}" aria-describedby="${headingId} ${scopeId}">${escape(progress)}</progress>
        </div>
        <details class="trophy-films"><summary aria-label="${escape(ui("View collection"))} · ${escape(trophy.title)} · ${escape(ui(trophy.scope))}">${escape(ui("View collection"))}</summary>
          <p>${escape(ui(trophy.criteria))}</p>
          <ul>${trophy.films
            .map((film) => {
              let href = window.filmPageUrl(film.id);
              if (profile) href += `&profile=${encodeURIComponent(profile)}`;
              return `<li><span class="trophy-film-state">${escape(ui(film.watched ? "Watched" : "Not watched"))}</span><span><a href="${escape(href)}">${escape(film.title)}</a>${film.kind ? `<small class="trophy-film-kind">${escape(ui(film.kind))}</small>` : ""}</span><span class="trophy-film-year">${film.year}</span></li>`;
            })
            .join("")}</ul>
        </details>
      </article>`;
      })
      .join("")}</div>
  </section>`;
};
