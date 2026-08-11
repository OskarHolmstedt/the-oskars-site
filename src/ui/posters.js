/** @file Renders normalized film posters, person portraits, award images, attribution, and poster-picker UI. */

/**
 * Returns the user-facing provider label for a poster.
 * @param {PosterRecord|null} poster Poster record.
 * @returns {string}
 */
window.posterSourceLabel = function (poster) {
  return poster?.source === "tmdb"
    ? "TMDB"
    : poster?.source === "wikimedia"
      ? "Wikimedia"
      : "";
};

// Only the single-focus 'detail' variant (a page's own hero poster/portrait,
// never repeated in a list/grid) links out to its TMDB/Wikimedia source -
// list/grid thumbnails (card/thumb/hub/winner/progression/...) are a plain,
// unlinked image; the row/card's own title text is already the click target,
// so the thumbnail doesn't need to be a link (internal or external) too.
/**
 * Renders a film poster, linking detail variants to their external source.
 * @param {FilmRecord} film Film carrying the poster.
 * @param {string} [variant] Presentation variant.
 * @returns {string}
 */
window.renderFilmPoster = function (film, variant = "card") {
  let poster = window.normalizePosterRecord?.(film?.poster);
  if (!poster) return "";
  let escape =
    window.pageEscape ||
    ((value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[character],
      ));
  let image = `<img src="${escape(poster.url)}" alt="Poster for ${escape(film.title)}" loading="lazy" decoding="async">`;
  if (variant !== "detail")
    return `<figure class="film-poster film-poster--${escape(variant)}">${image}</figure>`;
  let label = window.posterSourceLabel(poster);
  return `<figure class="film-poster film-poster--${escape(variant)}">${
    poster.sourceUrl
      ? `<a href="${escape(poster.sourceUrl)}" target="_blank" rel="noopener noreferrer">${image}</a>`
      : image
  }${
    label
      ? `<figcaption><a href="${escape(poster.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a></figcaption>`
      : ""
  }</figure>`;
};

/**
 * Renders a person portrait from the record or portrait store.
 * @param {PersonRecord} person Person to render.
 * @param {string} [variant] Presentation variant.
 * @returns {string}
 */
window.renderPersonPortrait = function (person, variant = "detail") {
  let portrait = window.normalizePosterRecord?.(
    person?.portrait || state.personPortraits?.[person?.id],
  );
  if (!portrait) return "";
  let escape =
    window.pageEscape ||
    ((value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[character],
      ));
  let image = `<img src="${escape(portrait.url)}" alt="Portrait of ${escape(person.name)}" loading="lazy" decoding="async">`;
  if (variant !== "detail")
    return `<figure class="person-portrait person-portrait--${escape(variant)}">${image}</figure>`;
  let personLink = window.personPageUrl?.(person.id) || "";
  return `<figure class="person-portrait person-portrait--${escape(variant)}">${
    personLink ? `<a href="${escape(personLink)}">${image}</a>` : image
  }${
    portrait.sourceUrl
      ? `<figcaption><a href="${escape(portrait.sourceUrl)}" target="_blank" rel="noopener noreferrer">TMDB</a></figcaption>`
      : ""
  }</figure>`;
};

/**
 * Resolves an award's unique recipients to canonical people.
 * @param {AwardRecord} award Award record.
 * @returns {PersonRecord[]}
 */
window.awardRecipientPeople = function (award) {
  let seen = new Set();
  let peopleById = window.ensurePeopleIndex?.() || state.peopleById || {};
  return window
    .awardRecipients(award)
    .map((recipient) => {
      let canonicalName =
        state.peopleAliases?.[recipient.personId] || recipient.name;
      return peopleById[window.normalizePersonName(canonicalName)];
    })
    .filter((person) => person && !seen.has(person.id) && seen.add(person.id));
};

/**
 * Renders recipient portraits for an award, falling back to the film poster.
 * @param {FilmRecord} film Awarded film.
 * @param {AwardRecord} award Award record.
 * @param {string} [variant] Presentation variant.
 * @returns {string}
 */
window.renderAwardWinnerImage = function (film, award, variant = "winner") {
  let recipients = window.awardRecipients(award);
  if (!recipients.length) return window.renderFilmPoster(film, variant);
  let portraits = window
    .awardRecipientPeople(award)
    .map((person) => window.renderPersonPortrait(person, variant))
    .filter(Boolean)
    .slice(0, 6);
  return portraits.length
    ? `<div class="recipient-portraits recipient-portraits--${variant}${portraits.length === 1 ? " single" : ` multi count-${portraits.length}`}" data-portrait-count="${portraits.length}">${portraits.join("")}</div>`
    : window.renderFilmPoster(film, variant);
};

/** Appends the shared image-provider attribution footer once. */
window.renderPosterAttribution = function () {
  if (document.querySelector(".data-attribution")) return;
  let footer = document.createElement("footer");
  footer.className = "data-attribution";
  footer.innerHTML =
    'Image sources: <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a> and <a href="https://www.wikimedia.org/" target="_blank" rel="noopener noreferrer">Wikimedia</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.';
  document.body.appendChild(footer);
};

// Shared poster picker chrome (issue #25): the detail poster wrapped with
// prev/next arrows, a position count, a clickable thumbnail strip, and an
// inline status line. Pages own the event wiring through the
// data-poster-option-step / data-poster-option-select attributes; the
// wrapper is focusable so Left/Right arrow keys can step without a mouse.
/**
 * Renders poster browsing controls around caller-provided poster content.
 * @param {Object} [config] Options, selection, status, poster HTML, and escaping configuration.
 * @returns {string}
 */
window.renderPosterPicker = function (config = {}) {
  let escape = config.escape || window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let options = config.options || [];
  let count = options.length;
  let status = String(config.status || "");
  if (!count && !status) return config.posterHtml || "";
  let activeIndex = Math.max(
    0,
    Math.min(Number(config.activeIndex) || 0, count - 1),
  );
  let thumbUrl = (url) => String(url || "").replace("/w500/", "/w154/");
  let strip =
    count > 1
      ? `<div class="poster-picker-strip" role="listbox" aria-label="${escape(ui("Poster options"))}">${options
          .map(
            (option, index) =>
              `<button type="button" role="option" id="poster-option-${index}" aria-selected="${index === activeIndex ? "true" : "false"}" class="poster-picker-thumb${index === activeIndex ? " is-active" : ""}" data-poster-option-select="${index}" aria-label="${escape(ui("Use poster {number} of {count}", { number: index + 1, count }))}"><img src="${escape(thumbUrl(option.url))}" alt="" loading="lazy" decoding="async"></button>`,
          )
          .join("")}</div>`
      : "";
  let frame = `<div class="poster-picker-frame">
    ${config.posterHtml || '<div class="film-poster film-poster--detail poster-picker-empty"></div>'}
    ${
      count
        ? `<button type="button" class="poster-picker-arrow poster-picker-prev" data-poster-option-step="-1" aria-label="${escape(ui("Previous poster"))}"${count <= 1 ? " disabled" : ""}>‹</button>
    <button type="button" class="poster-picker-arrow poster-picker-next" data-poster-option-step="1" aria-label="${escape(ui("Next poster"))}"${count <= 1 ? " disabled" : ""}>›</button>
    <span class="poster-picker-count">${escape(activeIndex + 1)} / ${escape(count)}</span>`
        : ""
    }
  </div>`;
  return `<div class="film-poster-picker" data-film-poster-picker tabindex="0" aria-label="${escape(ui("Poster picker. Use the left and right arrow keys to change poster."))}">
    ${frame}
    ${strip}
    ${status ? `<p class="poster-picker-status" role="status">${escape(status)}</p>` : ""}
  </div>`;
};

// Maps raw poster-browsing failures to actionable text for the inline
// status line (issue #25's "clearer error text").
/**
 * Converts poster lookup failures into actionable user-facing text.
 * @param {*} error Lookup error or message.
 * @returns {string}
 */
window.posterPickerErrorText = function (error) {
  let ui = window.uiText || ((text) => text);
  let message = String(error?.message || error || "");
  if (/credential/i.test(message))
    return ui(
      "Save a TMDB credential under Data → Image settings, then try again.",
    );
  if (/network|fetch|load failed|failed to fetch/i.test(message))
    return ui(
      "TMDB could not be reached. Check your connection and try again.",
    );
  return message;
};
