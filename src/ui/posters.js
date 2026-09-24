/** @file Renders normalized film posters, person portraits, award images, attribution, and poster-picker UI. */

/**
 * Returns the user-facing provider label for a poster.
 * @param {PosterRecord|null} poster Poster record.
 * @returns {string}
 */
window.posterSourceLabel = function (poster) {
  return poster?.source === "tmdb" ? "TMDB" : "";
};

// Mirrors window.pageEscape's own body - a defensive fallback for the rare
// case this file's functions run before page-utils.js has defined it.
function defaultPosterEscape(value) {
  return (window.escapeHtml || window.pageEscape || String)(value ?? "");
}

// Only the single-focus 'detail' variant (a page's own hero poster/portrait,
// never repeated in a list/grid) links out to its stored provider source -
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
  let escape = window.pageEscape || defaultPosterEscape;
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

// A dozen hand-drawn character sketches (src/assets/portrait-placeholders/)
// standing in for a person with no TMDB portrait. Picked per-person via a
// stable hash of their id (mirrors src/ui/backdrop.js's stablePagePoster),
// not Math.random, so the same person shows the same sketch on every render
// instead of flickering between page loads.
const PORTRAIT_PLACEHOLDER_SKETCHES = [
  "src/assets/portrait-placeholders/amphibian-creature.png",
  "src/assets/portrait-placeholders/cyborg-broken-face.png",
  "src/assets/portrait-placeholders/elephant-musician.png",
  "src/assets/portrait-placeholders/eye-over-dark-towers.png",
  "src/assets/portrait-placeholders/ghostly-mask-lineart.png",
  "src/assets/portrait-placeholders/hal-9000-panel.png",
  "src/assets/portrait-placeholders/hand-drawn-godzilla.png",
  "src/assets/portrait-placeholders/ice-suit-dome.png",
  "src/assets/portrait-placeholders/muzzled-figure.png",
  "src/assets/portrait-placeholders/serious-man-mohawk.png",
  "src/assets/portrait-placeholders/tars-robot.png",
  "src/assets/portrait-placeholders/wrinkled-parasite-torso.png",
];

function stablePortraitPlaceholder(personId) {
  let hash = [...String(personId ?? "")].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return PORTRAIT_PLACEHOLDER_SKETCHES[
    hash % PORTRAIT_PLACEHOLDER_SKETCHES.length
  ];
}

/**
 * Renders a person portrait from the record or portrait store, falling back
 * to a stable placeholder sketch when the person has none.
 * @param {PersonRecord} person Person to render.
 * @param {string} [variant] Presentation variant.
 * @returns {string}
 */
window.renderPersonPortrait = function (person, variant = "detail") {
  let escape = window.pageEscape || defaultPosterEscape;
  let portrait =
    window.normalizePosterRecord?.(person?.portrait) ||
    window.normalizePosterRecord?.(state.personPortraits?.[person?.id]);
  if (!portrait) {
    if (!person) return "";
    let sketch = stablePortraitPlaceholder(person.id);
    let image = `<img src="${escape(sketch)}" alt="" loading="lazy" decoding="async">`;
    let figureClass = `person-portrait person-portrait--${escape(variant)} person-portrait--placeholder-sketch`;
    if (variant !== "detail")
      return `<figure class="${figureClass}">${image}</figure>`;
    let personLink = window.personPageUrl?.(person.id) || "";
    return `<figure class="${figureClass}">${personLink ? `<a href="${escape(personLink)}">${image}</a>` : image}</figure>`;
  }
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
  let people = window.awardRecipientPeople(award);
  let withPortraits = people.filter(
    (person) =>
      window.normalizePosterRecord?.(person.portrait) ||
      window.normalizePosterRecord?.(state.personPortraits?.[person.id]),
  );
  let filmPoster = window.renderFilmPoster(film, variant);
  if (!withPortraits.length && filmPoster) return filmPoster;
  let portraits = (withPortraits.length ? withPortraits : people)
    .map((person) => window.renderPersonPortrait(person, variant))
    .filter(Boolean)
    .slice(0, 6);
  return portraits.length
    ? `<div class="recipient-portraits recipient-portraits--${variant}${portraits.length === 1 ? " single" : ` multi count-${portraits.length}`}" data-portrait-count="${portraits.length}">${portraits.join("")}</div>`
    : window.renderFilmPoster(film, variant);
};

/**
 * Renders recipient portraits for a WINNING official-results nomination,
 * falling back to the film poster - the same shape as renderAwardWinnerImage
 * above, but sourced from the official-results film/people metadata
 * (docs/official-results-file-split-decision.md) instead of the viewer's
 * own archive, so a winner renders an image even for a film/person the
 * viewer never personally added. Nominees stay text-only, matching the
 * personal award board's own winner-only convention - callers only ever
 * invoke this for `nomination.winner === true`.
 * @param {OfficialNomination} nomination Winning nomination.
 * @param {string} [variant] Presentation variant.
 * @returns {string}
 */
window.renderOfficialWinnerImage = function (nomination, variant = "winner") {
  let peopleMetadata = window.OSKARS_BUNDLED_OFFICIAL_PEOPLE_METADATA || {};
  let portraits = window
    .splitRecipientNames(nomination?.recipient)
    .map((name) => peopleMetadata[window.normalizePersonName(name)])
    .filter((entry) => entry?.portrait)
    .map((entry) =>
      window.renderPersonPortrait(
        { name: entry.name, portrait: entry.portrait },
        variant,
      ),
    )
    .filter(Boolean)
    .slice(0, 6);
  if (portraits.length)
    return `<div class="recipient-portraits recipient-portraits--${variant}${portraits.length === 1 ? " single" : ` multi count-${portraits.length}`}" data-portrait-count="${portraits.length}">${portraits.join("")}</div>`;
  let filmMetadata = window.OSKARS_BUNDLED_OFFICIAL_FILM_METADATA || {};
  let film = filmMetadata[nomination?.tmdbId];
  if (!film?.poster) return "";
  return window.renderFilmPoster(
    {
      poster: film.poster,
      title: nomination?.originalTitle || nomination?.sourceTitle,
    },
    variant,
  );
};

/**
 * Fills the shared site footer's attribution slot once. Was previously its
 * own separate <footer class="data-attribution"> appended to <body> -
 * merged into the one site-wide footer entry-loader.js's
 * renderStaticSiteFooter() creates, so pages don't stack two <footer>
 * elements (issue #587 follow-up).
 */
window.renderPosterAttribution = function () {
  let slot = document.querySelector("[data-footer-attribution]");
  if (!slot || slot.dataset.attributionReady) return;
  slot.dataset.attributionReady = "true";
  slot.innerHTML =
    'Image source: <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.';
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
  if (/network|fetch|load failed|failed to fetch/i.test(message))
    return ui(
      "TMDB could not be reached. Check your connection and try again.",
    );
  return message;
};
