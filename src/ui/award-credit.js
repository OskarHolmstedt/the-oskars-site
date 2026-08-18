/** @file Renders linked award recipients and category-specific credit context. */

/**
 * Renders the role/song detail-value input for a category's credit form, or
 * "" for categories with no meaningful second identifying field (issue
 * #192) - shared by every award-editing form (awards-year.js, intake.js) so
 * the role/song field set stays in exactly one place.
 * @param {string} category Award category.
 * @param {string} value Current detail value.
 * @param {Object} [options] Rendering options.
 * @param {Function} [options.escape] HTML-escaping function.
 * @param {Function} [options.ui] Localized-text function.
 * @param {string} [options.labelClass] Optional class attribute for the wrapping label.
 * @returns {string} Detail-field HTML, or "" when the category has none.
 */
window.creditDetailFieldHtml = function (category, value, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let labelClass = options.labelClass ? ` class="${options.labelClass}"` : "";
  let subjectType = window.creditSubjectType(
    category,
    window.PERSON_AWARD_PROFESSIONS[category],
  );
  if (subjectType === "role")
    return `<label${labelClass}>${escape(ui("Role"))}<input name="detail" value="${escape(value || "")}"></label>`;
  if (subjectType === "song")
    return `<label${labelClass}>${escape(ui("Song title"))}<input name="detail" value="${escape(value || "")}"></label>`;
  return "";
};

/**
 * Renders an award credit and reports whether it contains linked recipients.
 * @param {Object} options Film, award, category, escaping, and presentation options.
 * @returns {Object} Rendered HTML and recipient-presence flag.
 */
window.renderAwardCreditHtml = function (options) {
  let film = options.film;
  let award = options.award;
  let category = options.category || award?.category || "";
  let escape = options.escape || window.pageEscape;
  let detail = window.awardDetail(award);
  let subjectType = window.creditSubjectType(
    category,
    window.PERSON_AWARD_PROFESSIONS[category],
  );
  let detailHtml =
    detail && subjectType
      ? `<a class="detail-subject-link" href="${escape(window.subjectPageUrl(window.makeCreditSubjectId(subjectType, film.id, detail)))}">${escape(detail)}</a>`
      : escape(detail);
  let recipients = window.pageLinkedRecipients(award);
  let content = "";

  if (detail && (subjectType === "role" || subjectType === "song")) {
    content = `${recipients}${recipients ? " " : ""}<span class="credit-context">(${detailHtml})</span>`;
  } else if (options.detailStyle === "divider") {
    content = [recipients, detailHtml]
      .filter(Boolean)
      .join('<span class="credit-divider"> · </span>');
  } else {
    content = `${recipients}${detail ? `<span class="leaderboard-meta">${detailHtml}</span>` : ""}`;
  }
  if (
    category === "Best International Picture" &&
    (film?.primaryCountry || film?.country)
  ) {
    let primaryCountry = window.primaryCountryValue?.(film) || film.country;
    let country =
      window.renderCountryWithFlags?.(primaryCountry, escape) ||
      escape(primaryCountry);
    content = `${content}${content ? " " : ""}<span class="leaderboard-meta international-country">${country}</span>`;
  }

  return {
    html:
      content && options.wrapperClass
        ? `<span class="${escape(options.wrapperClass)}">${content}</span>`
        : content,
    hasRecipient: Boolean(recipients),
  };
};

/** Renders a read-only collection-specific Oskars bracket. @param {Object|null} model Resolved collection award view model. @param {Object} [options] Escaping and localization options. @returns {string} Collection bracket HTML. */
window.renderCollectionAwardsView = function (model, options = {}) {
  let escape = options.escape || window.pageEscape;
  let ui = options.ui || window.uiText || ((text) => text);
  let cards = (model?.categories || [])
    .map((group) => {
      let rows = group.nominations
        .map((entry) => {
          let film = entry.href
            ? `<a class="table-film-link" href="${escape(entry.href)}"><strong>${escape(entry.sourceTitle)}</strong></a>`
            : `<strong>${escape(entry.sourceTitle)}</strong><span class="leaderboard-meta">${escape(ui(entry.ambiguous ? "Ambiguous collection match" : "Not matched to collection"))}</span>`;
          let credit = [entry.recipient, entry.detail]
            .filter(Boolean)
            .map(escape)
            .join(' <span aria-hidden="true">·</span> ');
          return `<tr class="${entry.placement === 1 ? "is-winner" : ""}"><td class="detail-place">${entry.placement === 1 ? '<span aria-hidden="true">🏆</span> ' : ""}${escape(entry.placement)}</td><td>${film}</td><td>${credit || "—"}</td></tr>`;
        })
        .join("");
      return `<section class="collection-award-card${group.category === "Best Picture" ? " full-width" : ""}"><h2>${escape(window.localizedCategoryName?.(group.category) || group.category)}</h2>${window.renderLeaderboardTable({ headers: [ui("Place"), ui("Film"), ui("Credit")].map(escape), rows, classes: "collection-award-table" })}</section>`;
    })
    .join("");
  let source = model?.bracket.sourceUrl
    ? `<a class="period-link" href="${escape(model.bracket.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escape(ui("Source"))}</a>`
    : "";
  let unresolved = model?.unresolved.length
    ? `<p class="completion-note">${escape(ui("{count} nomination films are not uniquely matched to this collection.", { count: model.unresolved.length }))}</p>`
    : "";
  let content = model
    ? `${unresolved}<div class="collection-award-grid">${cards}</div>`
    : `<div class="detail-empty collection-awards-empty"><p>${escape(ui("No collection awards have been imported yet."))}</p><p>${escape(ui("This collection is open for a future Oskars bracket."))}</p></div>`;
  return `<section class="collection-awards-view" aria-labelledby="collection-awards-heading"><header><div><span class="eyebrow">${escape(ui("The Oskars"))}</span><h2 id="collection-awards-heading">${escape(ui("Collection awards"))}</h2></div>${source}</header>${content}</section>`;
};
