/** @file Renders linked award recipients and category-specific credit context. */

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
