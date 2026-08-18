/** @file Star-rating parsing, rendering, and the keyboard/pointer-editable rating input widget. */

/** Parses stored or rendered film rating fields. @param {*} value Rating value or film-like record. @returns {Object} Numeric value and modifier. */
window.parseFilmRating = function (value) {
  if (value && typeof value === "object") {
    let storedValue = Number(value.ratingValue);
    if (storedValue >= 0.5 && storedValue <= 5) {
      return {
        value: storedValue,
        modifier: ["plus", "dot", "minus"].includes(value.ratingModifier)
          ? value.ratingModifier
          : "",
      };
    }
    value = value.rating;
  }
  let rawText = String(value || "").trim();
  let normalizedText = rawText.normalize("NFKC");
  let starCount = (rawText.match(/★/g) || []).length;
  let rating =
    starCount + (/[½]|1\s*[\u2044/]\s*2/.test(rawText) ? 0.5 : 0);
  if (!starCount) {
    // Typed shorthand ("4.5-", "4+", "3."): a plain decimal number,
    // optionally followed by a modifier glyph, instead of literal stars.
    let shorthand = normalizedText.match(
      /^(\d+(?:[.,]\d+)?)\s*[+＋\-–—•·.]?$/,
    );
    let numeric = shorthand ? Number(shorthand[1].replace(",", ".")) : NaN;
    if (Number.isFinite(numeric) && numeric > 0)
      rating = Math.round(numeric * 2) / 2;
  }
  let modifier = /[+＋]\s*$/.test(normalizedText)
    ? "plus"
    : /[•·.]\s*$/.test(rawText)
      ? "dot"
      : /[-–—]\s*$/.test(rawText)
        ? "minus"
        : "";
  return {
    value: rating >= 0.5 && rating <= 5 ? rating : 0,
    modifier,
  };
};

/** Renders a normalized star rating. @param {*} value Rating value or film-like record. @returns {string} */
window.renderFilmRating = function (value) {
  let parsed = window.parseFilmRating(value);
  if (!parsed.value) return "";
  let fullStars = Math.floor(parsed.value);
  let halfStar = parsed.value % 1 ? "½" : "";
  let modifier =
    parsed.modifier === "plus"
      ? "＋"
      : parsed.modifier === "dot"
        ? "•"
        : parsed.modifier === "minus"
          ? "—"
          : "";
  return `${"★".repeat(fullStars)}${halfStar}${modifier}`;
};

/**
 * Renders a star-rating input: a plain, fully keyboard-editable text field
 * (accepting literal star glyphs or typed shorthand like "4.5-") paired with
 * a clickable/sweepable star bar and a minus/dot/plus modifier toggle. Call
 * window.enhanceRatingInputs() on the containing element after inserting
 * this markup to wire up the pointer controls.
 * @param {Object} [options] Field controls.
 * @param {string} [options.name] Input name attribute.
 * @param {string} [options.value] Initial rating text.
 * @param {string} [options.id] Explicit element id (auto-generated otherwise).
 * @param {boolean} [options.required] Whether the text input is required.
 * @returns {string} Rating input widget markup.
 */
window.renderRatingInput = function (options = {}) {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let name = options.name || "rating";
  let id = options.id || `rating-input-${Math.random().toString(36).slice(2, 9)}`;
  let stars = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `<button type="button" class="rating-input-star" data-rating-star="${n}" tabindex="-1" aria-hidden="true"><span class="rating-input-star-fill" aria-hidden="true">★</span><span class="rating-input-star-mask" aria-hidden="true" style="width:0%">★</span></button>`,
    )
    .join("");
  let modifiers = [
    ["minus", "−", ui("Rate slightly lower")],
    ["dot", "•", ui("Rate exactly")],
    ["plus", "＋", ui("Rate slightly higher")],
  ]
    .map(
      ([mod, glyph, label]) =>
        `<button type="button" class="rating-input-mod" data-rating-mod="${mod}" tabindex="-1" aria-hidden="true" aria-label="${escape(label)}">${glyph}</button>`,
    )
    .join("");
  return `<div class="rating-input" data-rating-input>
    <input type="text" name="${escape(name)}" id="${escape(id)}" class="rating-input-text" value="${escape(options.value || "")}" placeholder="★★★★ / 4.5-" autocomplete="off"${options.required ? " required" : ""}>
    <div class="rating-input-controls">
      <div class="rating-input-stars" role="presentation">${stars}</div>
      <div class="rating-input-mods" role="presentation">${modifiers}</div>
    </div>
  </div>`;
};

/**
 * Wires up rating-input widgets within a container so the star bar and
 * modifier toggle stay in sync with their underlying text field. Idempotent
 * (safe to call again after a re-render).
 * @param {Element} container Root element containing rendered rating-input widgets.
 */
window.enhanceRatingInputs = function (container) {
  (container?.querySelectorAll?.("[data-rating-input]") || []).forEach(
    (widget) => {
      if (widget.dataset.ratingInputReady) return;
      widget.dataset.ratingInputReady = "1";
      let input = widget.querySelector(".rating-input-text");
      let starsRow = widget.querySelector(".rating-input-stars");
      let starButtons = Array.from(widget.querySelectorAll("[data-rating-star]"));
      let modButtons = Array.from(widget.querySelectorAll("[data-rating-mod]"));

      function currentParsed() {
        return window.parseFilmRating(input.value);
      }

      function rowValueFromEvent(event) {
        let rect = starsRow.getBoundingClientRect();
        if (!rect.width) return currentParsed().value;
        let ratio = Math.min(
          1,
          Math.max(0, (event.clientX - rect.left) / rect.width),
        );
        return Math.min(5, Math.max(0.5, Math.round(ratio * 5 * 2) / 2));
      }

      function paint(previewValue) {
        let parsed = currentParsed();
        let displayValue = previewValue === undefined ? parsed.value : previewValue;
        starButtons.forEach((button) => {
          let n = Number(button.dataset.ratingStar);
          let fill = Math.min(1, Math.max(0, displayValue - (n - 1)));
          let mask = button.querySelector(".rating-input-star-mask");
          if (mask) mask.style.width = `${fill * 100}%`;
          button.classList.toggle("is-preview", previewValue !== undefined);
        });
        modButtons.forEach((button) => {
          let active =
            previewValue === undefined &&
            parsed.value > 0 &&
            button.dataset.ratingMod === parsed.modifier;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
      }

      function applyValue(nextValue, modifier) {
        let parsed = currentParsed();
        let nextModifier = modifier !== undefined ? modifier : parsed.modifier;
        input.value = nextValue
          ? window.renderFilmRating({
              ratingValue: nextValue,
              ratingModifier: nextModifier,
            })
          : "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }

      starsRow.addEventListener("mousemove", (event) => {
        paint(rowValueFromEvent(event));
      });
      starsRow.addEventListener("mouseleave", () => paint());
      starsRow.addEventListener("click", (event) => {
        let picked = rowValueFromEvent(event);
        let parsed = currentParsed();
        applyValue(picked === parsed.value ? 0 : picked);
      });

      modButtons.forEach((button) => {
        button.addEventListener("click", () => {
          let parsed = currentParsed();
          if (!parsed.value) return;
          let mod = button.dataset.ratingMod;
          applyValue(parsed.value, parsed.modifier === mod ? "" : mod);
        });
      });

      input.addEventListener("input", () => paint());
      paint();
    },
  );
};

/** Normalizes a film's rating text, value, and modifier in place. @param {FilmRecord|null|undefined} film Film record. @returns {FilmRecord|null|undefined} */
window.normalizeFilmRatingFields = function (film) {
  if (!film) return film;
  let parsed = window.parseFilmRating(film);
  if (parsed.value) {
    film.ratingValue = parsed.value;
    film.ratingModifier = parsed.modifier || "";
    film.rating = window.renderFilmRating(film);
  } else {
    delete film.ratingValue;
    delete film.ratingModifier;
    film.rating = String(film.rating || "").trim();
  }
  return film;
};

/** Returns the numeric star value of a rating. @param {*} value Rating value. @returns {number} */
window.filmRatingValue = function (value) {
  return window.parseFilmRating(value).value;
};

/** Returns the exact ordinal grade from 1 through 30 for a rated value, or zero when unrated. @param {*} value Rating value. @returns {number} */
window.filmRatingGrade = function (value) {
  let parsed = window.parseFilmRating(value);
  if (!parsed.value) return 0;
  let modifierGrade =
    parsed.modifier === "minus" ? 1 : parsed.modifier === "plus" ? 3 : 2;
  return (Math.round(parsed.value * 2) - 1) * 3 + modifierGrade;
};

/** Converts an exact grade from 1 through 30 back to a star value and modifier. @param {*} grade Rating grade. @returns {Object|null} Film-like rating fields, or null for an invalid grade. */
window.filmRatingFromGrade = function (grade) {
  let numericGrade = Number(grade);
  if (!Number.isInteger(numericGrade) || numericGrade < 1 || numericGrade > 30)
    return null;
  let index = numericGrade - 1;
  return {
    ratingValue: (Math.floor(index / 3) + 1) / 2,
    ratingModifier: ["minus", "dot", "plus"][index % 3],
  };
};

/** Returns the bounded five-point score derived from the exact 1–30 grade. @param {*} value Rating value. @returns {number} */
window.filmRatingScore = function (value) {
  return window.filmRatingGrade(value) / 6;
};

/** Returns the exact integer grade used to sort ratings. @param {*} value Rating value. @returns {number} */
window.filmRatingSortValue = function (value) {
  return window.filmRatingGrade(value);
};
