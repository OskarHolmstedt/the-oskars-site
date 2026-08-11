/** @file Renders shared film cards, removal controls, and project membership sections. */

function filmCardAttributes(attributes, escape) {
  return Object.entries(attributes || {})
    .filter(([, value]) => value !== false && value != null)
    .map(([name, value]) =>
      value === true ? ` ${name}` : ` ${name}="${escape(value)}"`,
    )
    .join("");
}

/**
 * Renders the standard card removal button.
 * @param {Object} [options] Escaping, title, and HTML attribute options.
 * @returns {string}
 */
window.renderCardRemoveButton = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let attributes = Object.assign(
    { type: "button", class: "card-remove-button" },
    options.attributes,
  );
  let title = String(
    options.title || window.uiText?.("Remove") || "Remove",
  ).trim();
  if (title) attributes.title = title;
  return `<button${filmCardAttributes(attributes, escape)}>×</button>`;
};

/**
 * Renders project memberships and their status and progress summaries.
 * @param {ProjectRecord[]} projects Projects containing the current film.
 * @param {Object} [options] Escaping and heading options.
 * @returns {string}
 */
window.renderProjectMembershipSection = function (projects, options = {}) {
  if (!projects?.length) return "";
  let escape = options.escape || window.pageEscape;
  let title = options.title || "Projects";
  let rows = projects
    .map((project) => {
      let progress = window.projectProgress?.(project);
      let status =
        project.id === state.activeProjectId
          ? window.uiText?.("Active") || "Active"
          : project.pinned
            ? window.uiText?.("Pinned") || "Pinned"
            : window.uiText?.("Open") || "Open";
      let type =
        project.id === state.activeProjectId
          ? "active"
          : project.pinned
            ? "pinned"
            : "open";
      return `<a class="project-membership-card" href="${escape(window.projectPageUrl(project.id))}">
      <span><strong>${escape(project.name)}</strong><small>${escape(project.sourceLabel || project.sourceId || "")}</small></span>
      <span class="project-status-badge project-status-badge--${escape(type)}">${escape(status)}</span>
      ${progress ? `<span class="project-membership-progress">${escape(progress.watchedCount)}/${escape(progress.total)} ${escape(window.uiText?.("watched") || "watched")}</span>` : ""}
    </a>`;
    })
    .join("");
  return `<section class="project-membership-section"><h2>${escape(window.uiText?.(title) || title)}</h2><div class="project-membership-list">${rows}</div></section>`;
};

/**
 * Renders a configurable shared film card.
 * @param {FilmRecord} film Film to render.
 * @param {Object} [options] Card content, attributes, actions, and presentation options.
 * @returns {string}
 */
window.renderSharedFilmCard = function (film, options = {}) {
  let escape = options.escape || window.pageEscape;
  let tag = options.tag || "article";
  let classes = ["film-card", ...(options.classes || [])]
    .filter(Boolean)
    .join(" ");
  let top250 = options.top250 === false ? "" : window.renderTop250Marker(film);
  let rating = options.rating === false ? "" : String(film.rating || "");
  let displayTitle = window.localizedFilmTitle?.(film) || film.title;
  let title =
    options.titleHtml ??
    `<a class="table-film-link" href="${escape(window.filmPageUrl(film.id))}">${escape(displayTitle)}</a>`;
  let rank =
    options.rankLabel != null
      ? `<span class="film-rank">${escape(options.rankLabel)}</span>`
      : "";
  let year = options.showYear
    ? `<span class="film-year">(${escape(film.year || "")})</span>`
    : "";
  let ratingHtml =
    options.rating === false
      ? ""
      : rating || top250
        ? `<span class="rating">${escape(rating)}${top250}</span>`
        : "";
  let director = String(options.director || "").trim();
  let compactDirector = director
    ? window.compactNameList?.(director, { limit: options.directorLimit })
    : null;
  let directorTitle =
    options.directorTitle || compactDirector?.fullText || director;
  let directorDisplay = compactDirector?.overflowCount
    ? compactDirector.displayText
    : director;
  let directorHtml =
    options.directorHtml ||
    (director
      ? `<div class="film-director" title="${escape(directorTitle)}">${options.directorPrefix || ""}${escape(directorDisplay)}</div>`
      : "");
  let canCompare =
    options.compare === true &&
    film.id &&
    state.filmsById?.[film.id] &&
    window.comparePageUrl;
  let compareHtml = canCompare
    ? `<div class="film-card-actions"><a href="${escape(window.comparePageUrl([film.id]))}">${escape(window.uiText?.("Compare") || "Compare")}</a></div>`
    : "";
  let attributes = Object.assign({}, options.attributes);
  if (options.openFilm !== false && film.id) {
    attributes["data-open-film-id"] ??= film.id;
    attributes.tabindex ??= "0";
  }
  return `<${tag} class="${escape(classes)}"${filmCardAttributes(attributes, escape)}>
    ${options.poster === false ? "" : window.renderFilmPoster(film, options.posterSize || "card")}
    ${options.beforeTitleHtml || ""}
    <div class="film-title">${rank}${title}${options.afterTitleHtml || ""}${year}${ratingHtml}</div>
    ${directorHtml}${options.bodyHtml || ""}${options.actionsHtml || compareHtml}
  </${tag}>`;
};
