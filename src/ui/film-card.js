/** @file Renders shared film cards, removal controls, and project membership sections. */

function filmCardAttributes(attributes, escape) {
  return Object.entries(attributes || {})
    .filter(([, value]) => value !== false && value != null)
    .map(([name, value]) =>
      value === true ? ` ${name}` : ` ${name}="${escape(value)}"`,
    )
    .join("");
}

function collectionActionIcon(kind) {
  if (kind === "watched")
    return `<svg class="collection-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path></svg>`;
  return `<svg class="collection-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.5 3.5h11v17l-5.5-3.5-5.5 3.5z"></path><path d="M12 7v6M9 10h6"></path></svg>`;
}

/**
 * Renders an accessible icon-only action for adding one film to a
 * collection, or (with `active`) a pressed toggle representing "already in
 * this collection, click to remove."
 * @param {Object} options Action kind, label, attributes, and escaping.
 * @param {'watchlist'|'watched'} options.kind Destination collection.
 * @param {string} options.label Localized accessible action name.
 * @param {boolean} [options.active] Renders a filled/pressed toggle state
 *   (`is-active` class, `aria-pressed="true"`) for a removal action, instead
 *   of the default "add" appearance.
 * @param {Record<string, string|boolean>} [options.attributes] Button attributes.
 * @param {string|string[]} [options.classes] Additional button classes.
 * @param {(value: *) => string} [options.escape] HTML escaping function.
 * @returns {string} Icon-button HTML.
 */
window.renderCollectionActionButton = function (options = {}) {
  let escape = options.escape || window.pageEscape;
  let kind = options.kind === "watched" ? "watched" : "watchlist";
  let label = String(options.label || "").trim();
  let active = Boolean(options.active);
  let extraClasses = Array.isArray(options.classes)
    ? options.classes
    : String(options.classes || "").split(/\s+/);
  let attributes = Object.assign(
    {
      type: "button",
      class: [
        "collection-action-button",
        `collection-action-button--${kind}`,
        active ? "is-active" : "",
        ...extraClasses,
      ]
        .filter(Boolean)
        .join(" "),
      title: label,
      "aria-label": label,
      "data-tooltip": label,
      "data-collection-action": kind,
    },
    active ? { "aria-pressed": "true" } : null,
    options.attributes,
  );
  return `<button${filmCardAttributes(attributes, escape)}>${collectionActionIcon(kind)}</button>`;
};

/**
 * Updates an existing collection action's accessible busy or ready state.
 * @param {HTMLElement|null} button Collection action button.
 * @param {Object} options State and localized label.
 * @param {string} options.label Localized accessible action name.
 * @param {boolean} [options.busy=false] Whether the action is in progress.
 */
window.setCollectionActionButtonState = function (button, options = {}) {
  if (!button) return;
  let label = String(options.label || "").trim();
  let busy = Boolean(options.busy);
  button.disabled = busy;
  button.setAttribute("aria-label", label);
  button.setAttribute("title", label);
  button.setAttribute("data-tooltip", label);
  button.setAttribute("aria-busy", busy ? "true" : "false");
  button.classList.toggle("is-busy", busy);
};

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
      let status = project.pinned
        ? window.uiText?.("Pinned") || "Pinned"
        : window.uiText?.("Open") || "Open";
      let type = project.pinned ? "pinned" : "open";
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
