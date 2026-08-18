/** @file Renders period award boards, credits, dominance summaries, and winner-poster sizing. */

/**
 * Renders one period award entry's linked credit context.
 * @param {Object} entry Film and award entry.
 * @param {string} category Award category.
 * @param {(value:*) => string} [escape] HTML escaper.
 * @returns {string}
 */
window.renderPeriodAwardCredit = function (
  entry,
  category,
  escape = window.pageEscape,
) {
  return window.renderAwardCreditHtml({
    film: entry.film,
    award: entry.award,
    category,
    escape,
    detailStyle: "divider",
    wrapperClass: "nominee-recipient-credit",
  }).html;
};

// The full-width Best Picture board splits its nominee list into two
// side-by-side columns once it passes this many nominees (currently Century's
// 40 and All-time's 50), since it has no other category board beside it to
// share the row with. Other categories already sit two-per-row in the
// category-order-grid, so their own nominee lists never split — that grid
// is the "two columns" for them. Splitting is display-only; edit mode labels
// both placement ranges and supplies exact-placement controls across the break.
const BOARD_SPLIT_THRESHOLD = 20;
const AWARD_DOMINANCE_SLICE_LIMIT = 8;
const AWARD_DOMINANCE_COLORS = [
  "#b88735",
  "#527caf",
  "#8c5f9f",
  "#4d8b74",
  "#c45f4f",
  "#6f7f3f",
  "#b56f9f",
  "#7a705f",
  "#bdb4a4",
];

/**
 * Aggregates period nominations and wins by film for dominance rendering.
 * @param {Object[]} awards Film-and-award entries.
 * @returns {Object[]} Sorted per-film nomination and win totals.
 */
window.periodAwardDominanceEntries = function (awards) {
  let entriesByFilm = new Map();
  (awards || []).forEach((entry) => {
    if (!entry?.film?.id) return;
    let bucket = entriesByFilm.get(entry.film.id) || {
      film: entry.film,
      nominations: 0,
      wins: 0,
    };
    bucket.nominations += 1;
    if (Number(entry.award?.placement) === 1) bucket.wins += 1;
    entriesByFilm.set(entry.film.id, bucket);
  });
  return [...entriesByFilm.values()].sort(
    (left, right) =>
      right.nominations - left.nominations ||
      right.wins - left.wins ||
      Number(left.film.allTimeRank || 999999) -
        Number(right.film.allTimeRank || 999999) ||
      window.compareEnglishTitles(left.film.title, right.film.title),
  );
};

/**
 * Renders the period's film nomination-share chart and legend.
 * @param {PeriodAwardEntry[]} awards Film-and-award entries.
 * @param {(value:*) => string} [escape] HTML escaper.
 * @returns {string} Evidence-linked story cards, or an empty string.
 */
window.renderPeriodAwardDominanceChart = function (
  awards,
  escape = window.pageEscape,
) {
  let entries = window.periodAwardDominanceEntries(awards);
  let total = entries.reduce((sum, entry) => sum + entry.nominations, 0);
  if (entries.length < 2 || !total) return "";

  let visible = entries.slice(0, AWARD_DOMINANCE_SLICE_LIMIT);
  let otherTotal = entries
    .slice(AWARD_DOMINANCE_SLICE_LIMIT)
    .reduce((sum, entry) => sum + entry.nominations, 0);
  let slices = visible.map((entry, index) => ({
    film: entry.film,
    label: entry.film.title,
    href: window.filmPageUrl(entry.film.id),
    count: entry.nominations,
    color: AWARD_DOMINANCE_COLORS[index % AWARD_DOMINANCE_COLORS.length],
  }));
  if (otherTotal) {
    slices.push({
      label: window.uiText?.("Other films") || "Other films",
      href: "",
      count: otherTotal,
      color: AWARD_DOMINANCE_COLORS[AWARD_DOMINANCE_COLORS.length - 1],
    });
  }

  let cursor = 0;
  let gradient = slices
    .map((slice) => {
      let start = cursor;
      cursor += (slice.count / total) * 360;
      return `${slice.color} ${start.toFixed(3)}deg ${cursor.toFixed(3)}deg`;
    })
    .join(", ");
  let legend = slices
    .map((slice) => {
      let percent = Math.round((slice.count / total) * 100);
      let label = slice.href
        ? `<a href="${escape(slice.href)}">${escape(window.localizedFilmTitle?.(slice.film) || slice.label)}</a>`
        : `<span>${escape(slice.label)}</span>`;
      return `<li style="--slice-color:${escape(slice.color)}"><i aria-hidden="true"></i><b>${label}</b><small>${escape(window.uiText?.("{count} bracket nomination(s)", { count: slice.count }) || `${slice.count} nominations`)} · ${percent}%</small></li>`;
    })
    .join("");

  return `<section class="award-dominance-chart" aria-labelledby="awardDominanceHeading">
    <div>
      <h2 id="awardDominanceHeading">${escape(window.uiText?.("Bracket dominance") || "Bracket dominance")}</h2>
      <p>${escape(window.uiText?.("Share of all nominations in this period bracket.") || "Share of all nominations in this period bracket.")}</p>
    </div>
    <div class="award-dominance-body">
      <div class="award-dominance-pie" role="img" aria-label="${escape(window.uiText?.("Bracket dominance") || "Bracket dominance")}" style="background:conic-gradient(${gradient})"><span>${escape(total)}</span><small>${escape(window.uiText?.("Nominations") || "Nominations")}</small></div>
      <ol class="award-dominance-legend">${legend}</ol>
    </div>
  </section>`;
};

/**
 * Renders significant period award stories with links to every supporting record.
 * @param {Object[]} awards Film-and-award entries.
 * @param {(value:*) => string} [escape] HTML escaper.
 * @returns {string}
 */
window.renderPeriodAwardStories = function (
  awards,
  escape = window.pageEscape,
) {
  let stories = window.periodAwardStories(awards);
  if (!stories.length) return "";
  let ui = window.uiText || ((key) => key);
  let storyTitles = {
    sweep: ui("Sweep"),
    "near-sweep": ui("Near sweep"),
    "most-wins": ui("Most wins"),
    shutout: ui("Shutout"),
    rivalry: ui("Recurring rivalry"),
  };
  let storyCounts = (story) => {
    let first = story.films[0];
    if (story.type === "rivalry") {
      return ui("{count} shared categories · {firstWins}–{secondWins} wins", {
        count: story.sharedCount,
        firstWins: story.wins[0],
        secondWins: story.wins[1],
      });
    }
    if (story.type === "shutout") {
      return ui("{nominations} nominations · no wins", {
        nominations: first.nominations,
      });
    }
    if (story.type === "sweep") {
      return ui("Won all {wins} nominations", { wins: first.wins });
    }
    if (story.type === "near-sweep") {
      return ui("{wins} wins from {nominations} nominations · one short", {
        wins: first.wins,
        nominations: first.nominations,
      });
    }
    return ui("{wins} wins from {nominations} nominations", {
      wins: first.wins,
      nominations: first.nominations,
    });
  };
  let cards = stories
    .map((story) => {
      let films = story.films
        .map(
          (film) =>
            `<a href="${escape(window.filmPageUrl(film.film.id))}">${escape(window.localizedFilmTitle?.(film.film) || film.film.title)}</a>`,
        )
        .join(` <span aria-hidden="true">&amp;</span> `);
      let categories = story.categories
        .map(
          (category) =>
            `<a href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a>`,
        )
        .join(", ");
      return `<article class="award-story" data-award-story="${escape(story.type)}"><h3>${escape(storyTitles[story.type])}</h3><div class="award-story-films">${films}</div><p>${escape(storyCounts(story))}</p><p class="award-story-evidence"><span>${escape(ui("Categories"))}:</span> ${categories}</p></article>`;
    })
    .join("");
  return `<section class="award-stories" aria-labelledby="awardStoriesHeading"><div class="award-stories-heading"><h2 id="awardStoriesHeading">${escape(ui("Award stories"))}</h2><p>${escape(ui("The strongest patterns supported by this bracket."))}</p></div><div class="award-story-list">${cards}</div></section>`;
};

/**
 * Renders all category boards and award summaries for a period.
 * @param {Object} options Awards, period identity, edit mode, and escaping options.
 * @param {PeriodAwardEntry[]} options.awards Personal award entries.
 * @param {OfficialAwardPeriodComparison|null} [options.officialComparison] Annual official comparison.
 * @returns {string}
 */
window.renderPeriodAwardView = function ({
  awards,
  type,
  key = "",
  editMode = false,
  officialComparison = null,
  escape = window.pageEscape,
}) {
  function entriesForCategory(category) {
    return awards
      .filter((entry) => entry.award.category === category)
      .sort(
        (left, right) =>
          Number(left.award.placement) - Number(right.award.placement),
      );
  }
  function renderCards(entries, category) {
    let destinationEntries = [];
    let seenPlacements = new Set();
    entriesForCategory(category).forEach((entry) => {
      let placement = Number(entry.award.placement);
      if (seenPlacements.has(placement)) return;
      seenPlacements.add(placement);
      destinationEntries.push(entry);
    });
    return (
      entries
        .map((entry) => {
          let credit = window.renderPeriodAwardCredit(entry, category, escape);
          let placement = entry.award.placement;
          let reorderFilmId = entry.award.sourceFilmId || entry.film.id;
          let cardClass = editMode ? "card nominee-card" : "card";
          let dragAttrs = editMode
            ? ` draggable="true" data-drag-type="award" data-year="${escape(key)}" data-category="${escape(category)}" data-film-id="${escape(reorderFilmId)}" data-canonical-film-id="${escape(entry.film.id)}" data-placement="${escape(placement)}" data-drop-label="${escape(window.uiText?.("Move to placement #{placement}", { placement }) || `Move to placement #${placement}`)}"`
            : "";
          let title = editMode
            ? `<span class="table-film-link${credit ? " nominee-film-link" : ""}">${escape(entry.film.title)}</span>`
            : `<a class="table-film-link${credit ? " nominee-film-link" : ""}" href="${escape(window.filmPageUrl(entry.film.id))}">${escape(entry.film.title)}</a>`;
          let placementControl = editMode
            ? `<label class="nominee-placement-control"><span>${escape(window.uiText?.("Move to") || "Move to")}</span><select draggable="false" data-nomination-destination aria-label="${escape(window.uiText?.("Move {title} to placement", { title: entry.film.title }) || `Move ${entry.film.title} to placement`)}">${destinationEntries
                .map((target) => {
                  let targetPlacement = target.award.placement;
                  let targetFilmId =
                    target.award.sourceFilmId || target.film.id;
                  let selected =
                    String(targetPlacement) === String(placement)
                      ? " selected"
                      : "";
                  return `<option value="${escape(targetFilmId)}" data-placement="${escape(targetPlacement)}"${selected}>#${escape(targetPlacement)} — ${escape(target.film.title)}</option>`;
                })
                .join("")}</select></label>`
            : "";
          let deleteControl = editMode
            ? `<button type="button" class="nominee-delete-button" draggable="false" data-delete-nomination title="${escape(window.uiText?.("Delete nomination") || "Delete nomination")}" aria-label="${escape(window.uiText?.("Delete {title} nomination", { title: entry.film.title }) || `Delete ${entry.film.title} nomination`)}">×</button>`
            : "";
          return `<div class="${cardClass}"${dragAttrs}><span class="${placementEmoji[placement] ? "rank medal" : "rank numeric"}">${placementEmoji[placement] || escape(placement)}</span>${credit ? `${credit}<span class="separator">—</span>` : ""}${title}${placementControl}${deleteControl}</div>`;
        })
        .join("") ||
      `<div class="card" style="color:#aaa;">${escape(window.uiText?.("No entries") || "No entries")}</div>`
    );
  }
  function comparisonBadge(category) {
    let comparison = officialComparison?.categoriesByName?.get(category);
    if (!comparison || comparison.status === "unresolved") return "";
    let agrees = comparison.status === "agreement";
    let title = agrees
      ? window.uiText?.("Your pick matches the Oscar winner") ||
        "Your pick matches the Oscar winner"
      : window.uiText?.("Your pick differs from the Oscar winner") ||
        "Your pick differs from the Oscar winner";
    let label = agrees
      ? window.uiText?.("Match") || "Match"
      : window.uiText?.("Different") || "Different";
    return `<span class="period-award-comparison is-${comparison.status}" title="${escape(title)}"><span aria-hidden="true">${agrees ? "✓" : "≠"}</span> ${escape(label)}</span>`;
  }
  function renderCategoryBoard(category, fullWidth = false) {
    let entries = entriesForCategory(category);
    let winner = entries.find((entry) => Number(entry.award.placement) === 1);
    let winnerImage = winner
      ? window.renderAwardWinnerImage(winner.film, winner.award, "winner")
      : "";
    let split = fullWidth && entries.length > BOARD_SPLIT_THRESHOLD;
    let splitAt = Math.ceil(entries.length / 2);
    let firstEntries = entries.slice(0, splitAt);
    let secondEntries = entries.slice(splitAt);
    let columnHeading = (columnEntries) => {
      if (!editMode || !columnEntries.length) return "";
      let first = columnEntries[0].award.placement;
      let last = columnEntries[columnEntries.length - 1].award.placement;
      return `<div class="nominee-column-range">${escape(window.uiText?.("Placements #{first}–#{last}", { first, last }) || `Placements #${first}–#${last}`)}</div>`;
    };
    let nomineesHtml = split
      ? `<div class="board-nominee-columns${editMode ? " board-nominee-columns--editing" : ""}"><div class="board-nominees">${columnHeading(firstEntries)}${renderCards(firstEntries, category)}</div><div class="board-nominees">${columnHeading(secondEntries)}${renderCards(secondEntries, category)}</div></div>`
      : `<div class="board-nominees">${renderCards(entries, category)}</div>`;
    return `<div class="board${fullWidth ? " full-width" : ""}" data-category-board="${escape(category)}"><div class="period-award-board-heading"><a class="category-link" href="${escape(window.categoryPageUrl(category))}"><b>${escape(window.localizedCategoryName?.(category) || category)}</b></a>${comparisonBadge(category)}</div><div class="board-content${winnerImage ? " has-winner-poster" : ""}${split ? " board-content--split" : ""}">${winnerImage}${nomineesHtml}</div></div>`;
  }
  let dominance = window.renderPeriodAwardDominanceChart(awards, escape);
  let stories = window.renderPeriodAwardStories(awards, escape);
  let overview = stories
    ? `<div class="period-award-overview">${dominance}${stories}</div>`
    : dominance;
  return `${overview}<div class="year-grid">${renderCategoryBoard("Best Picture", true)}</div><div class="year-grid category-order-grid">${getCategoryPresentationSlots()
    .map((category) =>
      category
        ? renderCategoryBoard(category)
        : '<div class="category-board-spacer" aria-hidden="true"></div>',
    )
    .join("")}</div>`;
};

// The full-width Best Picture board has room to let its winner poster grow
// as tall as the nominee list beside it instead of being capped/cropped to a
// narrow fixed column. A percentage/aspect-ratio-only CSS approach hits a
// known browser quirk (an indefinite percentage height on a replaced element
// falls back to the image's own natural raster size for grid track sizing),
// so the poster's height is measured from its sibling list and set as an
// explicit pixel value instead; width then follows from `aspect-ratio` in CSS.
/**
 * Synchronizes full-width winner posters to their adjacent nominee lists.
 * @param {Element|Document} [container] Root containing period award boards.
 */
window.syncWinnerPosterHeights = function (container) {
  let boards = (container || document).querySelectorAll(
    ".board.full-width .board-content.has-winner-poster",
  );
  // Below this width the board switches to a fixed-percentage poster column
  // (see the max-width:600px rules in app.css); leave that layout alone.
  let isNarrowViewport =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width:600px)").matches;
  boards.forEach((content) => {
    let poster = content.querySelector(".film-poster--winner");
    let nominees =
      content.querySelector(".board-nominee-columns") ||
      content.querySelector(".board-nominees");
    if (!poster || !nominees) return;
    poster.style.height = isNarrowViewport
      ? ""
      : `${Math.max(180, nominees.getBoundingClientRect().height)}px`;
  });
};
