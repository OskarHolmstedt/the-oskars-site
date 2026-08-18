/** @file Person/credit link rendering: linked award recipients, compact name lists, and linked directors. */

/**
 * Renders sorted award recipients as person links with optional overflow.
 * @param {AwardRecord} award Award record.
 * @param {Object} [options] Display limit and expanded-state options.
 * @returns {string}
 */
window.pageLinkedRecipients = function (award, options = {}) {
  let profession = window.PERSON_AWARD_PROFESSIONS[award.category];
  let recipients = [...window.awardRecipients(award)].sort((left, right) => {
    let leftName = state.peopleAliases?.[left.personId] || left.name;
    let rightName = state.peopleAliases?.[right.personId] || right.name;
    return window.comparePersonNamesBySurname(leftName, rightName);
  });
  if (!profession) return window.pageEscape(window.awardRecipientText(award));
  let links = recipients.map((recipient) => {
    let canonicalName =
      state.peopleAliases?.[recipient.personId] || recipient.name;
    let personId = window.normalizePersonName(canonicalName);
    return `<a class="table-film-link" href="${window.pageEscape(window.personPageUrl(personId))}">${window.pageEscape(canonicalName)}</a>`;
  });
  let limit = Math.max(1, Number(options.limit) || 2);
  if (links.length <= limit || options.expanded) return links.join(", ");
  let visible = links.slice(0, limit).join(", ");
  let hidden = links.slice(limit).join(", ");
  return `<span class="recipient-credit">${visible}<details class="recipient-overflow"><summary>+${links.length - limit} more</summary><span class="recipient-overflow-list">${hidden}</span></details></span>`;
};

function displayPersonName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return (
      value.name || value.displayName || value.personName || value.title || ""
    );
  }
  return value || "";
}

/**
 * Normalizes, sorts, and truncates a person-name list for compact display.
 * @param {*} value Person name input.
 * @param {Object} [options] Sort and display-limit options.
 * @returns {Object} Full, visible, hidden, and display name representations.
 */
window.compactNameList = function (value, options = {}) {
  let names = Array.isArray(value)
    ? value.map(displayPersonName)
    : typeof value === "object" && value
      ? [displayPersonName(value)]
      : window.parsePersonCredit?.(value)?.names ||
        window.splitRecipientNames?.(value) ||
        String(value || "").split(/\s*(?:,|&|\band\b)\s*/i);
  names = names.map((name) => String(name || "").trim()).filter(Boolean);
  if (options.sort !== false) names.sort(window.comparePersonNamesBySurname);
  let limit = Math.max(1, Number(options.limit) || 2);
  let visible = names.slice(0, limit);
  let hidden = names.slice(limit);
  let fullText = names.join(", ");
  let visibleText = visible.join(", ");
  return {
    names,
    visible,
    hidden,
    fullText,
    visibleText,
    overflowCount: hidden.length,
    displayText: hidden.length
      ? `${visibleText} +${hidden.length}`
      : visibleText,
  };
};

/**
 * Renders a compact escaped name list with its full value as a tooltip.
 * @param {*} value Person name input.
 * @param {Object} [options] Compaction and escaping options.
 * @returns {string}
 */
window.renderCompactNameListText = function (value, options = {}) {
  let escape = options.escape || window.pageEscape;
  let compact = window.compactNameList(value, options);
  if (!compact.fullText) return "";
  if (!compact.overflowCount) return escape(compact.fullText);
  return `<span class="compact-name-list" title="${escape(compact.fullText)}">${escape(compact.displayText)}</span>`;
};

/**
 * Renders canonical person links with optional compact overflow. Passing
 * `assumeIndexed: true` links straight to the person page without consulting
 * the people index - correct for watched-film credits, whose people are
 * always indexed, and it keeps light list renders from forcing an index
 * rebuild just to resolve link targets.
 * @param {*} value Person name input.
 * @param {Object} [options] Compaction, fallback, expansion, and escaping options.
 * @returns {string}
 */
window.renderLinkedPeopleNames = function (value, options = {}) {
  let escape = options.escape || window.pageEscape;
  let compact = window.compactNameList(value, options);
  let links = compact.names.map((name) => {
    let personId = window.normalizePersonName?.(name) || name.toLowerCase();
    let canonicalName = state.peopleAliases?.[personId] || name;
    let canonicalId = window.normalizePersonName?.(canonicalName) || personId;
    let href =
      options.assumeIndexed ||
      (window.ensurePeopleIndex?.() || state.peopleById || {})[canonicalId]
        ? window.personPageUrl(canonicalId)
        : options.watchlistDirectorFallback &&
            window.watchlistItemsByDirector?.(canonicalName).length
          ? window.watchlistDirectorPageUrl(canonicalName)
          : window.personPageUrl(canonicalId);
    return `<a class="table-film-link" href="${escape(href)}">${escape(canonicalName)}</a>`;
  });
  if (!links.length) return "";
  if (links.length <= compact.visible.length || options.expanded)
    return links.join(", ");
  let visible = links.slice(0, compact.visible.length).join(", ");
  let hidden = links.slice(compact.visible.length).join(", ");
  return `<span class="recipient-credit" title="${escape(compact.fullText)}">${visible}<details class="recipient-overflow compact-name-overflow"><summary>+${links.length - compact.visible.length} more</summary><span class="recipient-overflow-list">${hidden}</span></details></span>`;
};

/** Builds an all-time watchlist URL filtered to a director. @param {string} name Director name. @returns {string} */
window.watchlistDirectorPageUrl = function (name) {
  return `${window.periodPageUrl("alltime", "alltime")}&view=watchlist&director=${encodeURIComponent(String(name || "").trim())}`;
};

// One chip per *leaf* membership (see leafFranchiseMemberships), showing
// the full ancestor chain (e.g. "Marvel > MCU > Phase One") with every
// level individually linked, not just the direct parent — a franchise page
// can be nested arbitrarily deep. Each level also shows a derived "#N"
// (this film's position within that franchise's own films list), since the
// sheet only ever authors a rank at the one level a row was listed under,
// never for its ancestors. Pass filmId for an archive film or itemId for a
// watchlist-only one.
/**
 * Renders linked leaf franchise chains with derived positions at each level.
 * @param {FranchiseMembership[]} franchises Franchise memberships.
 * @param {Object} [options] Film or watchlist identity and escaping options.
 * @returns {string}
 */
window.renderFranchiseMembershipLinks = function (franchises, options = {}) {
  let escape = options.escape || window.pageEscape;
  let filmId = options.filmId || "";
  let itemId = options.itemId || "";
  let franchiseIndex =
    window.ensureFranchiseIndex?.() || window.state?.franchisesById || {};
  return window
    .leafFranchiseMemberships(franchises)
    .map((membership) => {
      let levelIds = [...(membership.parentChainIds || []), membership.id];
      let levelNames = [
        ...(membership.parentChainNames || []),
        membership.name,
      ];
      let crumbs = levelIds
        .map((id, index) => {
          let isLeaf = index === levelIds.length - 1;
          let franchise = franchiseIndex?.[id];
          let name = franchise?.name || levelNames[index] || id;
          let position = window.franchiseFilmPosition?.(franchise, {
            filmId,
            itemId,
          });
          let nameHtml = isLeaf
            ? `<strong>${escape(name)}</strong>`
            : escape(name);
          let link = `<a href="${escape(window.franchisePageUrl(id))}">${nameHtml}</a>${position ? `<span>#${position}</span>` : ""}`;
          return isLeaf ? link : `${link}<span aria-hidden="true"> › </span>`;
        })
        .join("");
      return `<div>${crumbs}</div>`;
    })
    .join("");
};

/**
 * Renders linked directors from a film or name collection. This is the
 * standard Director cell renderer for film collection tables: canonical
 * person links with compact `+X` overflow (default limit 2) and the full
 * name list as the tooltip - never a raw unlimited join. Directors without
 * a person page fall back to a director-filtered watchlist link.
 * @param {FilmRecord|string|string[]} filmOrNames Film or director names.
 * @param {Object} [options] Link and compaction options.
 * @returns {string}
 */
window.renderLinkedDirectors = function (filmOrNames, options = {}) {
  // A film-like record without director credits renders as empty, never as
  // the record itself masquerading as a name.
  let names = Array.isArray(filmOrNames)
    ? filmOrNames
    : filmOrNames?.directors?.length
      ? filmOrNames.directors
      : typeof filmOrNames === "object" && filmOrNames
        ? filmOrNames.director || ""
        : filmOrNames;
  return window.renderLinkedPeopleNames(
    names,
    Object.assign({ watchlistDirectorFallback: true }, options),
  );
};
