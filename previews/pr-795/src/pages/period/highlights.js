/** @file Renders decade and century highlights plus film-rating distributions. */

/**
 * Renders decade or century highlights for films, people, metadata, and awards.
 * @param {Object} options Period identity, films, rank resolver, and escaper.
 * @returns {string}
 */
window.renderPeriodHighlights = function (options) {
  let { type, key, films, rankForFilm, escape } = options;
  if (type !== "decade" && type !== "century") return "";
  let annualAwards = films.flatMap((film) =>
    (film.awards || [])
      .filter(
        (award) =>
          /^\d{4}$/.test(String(award.year || "")) &&
          (type === "decade"
            ? window.getDecadeKey(award.year) === key
            : window.getCenturyKey(award.year) === key),
      )
      .map((award) => ({ film, award })),
  );
  let awardsByFilm = new Map();
  annualAwards.forEach(({ film, award }) => {
    let list = awardsByFilm.get(film.id) || [];
    list.push(award);
    awardsByFilm.set(film.id, list);
  });
  let topFilms = films
    .map((film) => ({
      film,
      stats: calculateAwardStats(awardsByFilm.get(film.id) || []),
    }))
    .sort(
      (left, right) =>
        right.stats.awardScore - left.stats.awardScore ||
        right.stats.wins - left.stats.wins ||
        right.stats.nominations - left.stats.nominations ||
        Number(rankForFilm(left.film) || left.film.allTimeRank || 999999) -
          Number(rankForFilm(right.film) || right.film.allTimeRank || 999999),
    )
    .slice(0, 5);
  let filmLinks = topFilms
    .map(
      (entry) =>
        `<li><a href="${escape(window.filmPageUrl(entry.film.id))}">${escape(entry.film.title)}</a><span>${entry.stats.nominations ? `${entry.stats.awardScore} ${window.uiText?.("year score") || "year score"} · ${window.formatNormalizedAwardScore(entry.stats.normalizedAwardScore)} ${window.uiText?.("normalized") || "normalized"} · ${entry.stats.wins} ${window.uiText?.("wins") || "wins"} · ${entry.stats.nominations} ${window.uiText?.("noms") || "noms"}` : `#${escape(rankForFilm(entry.film) || entry.film.allTimeRank || "NR")}`}</span></li>`,
    )
    .join("");

  let directors = new Map();
  films.forEach((film) =>
    (film.directors?.length
      ? film.directors
      : window.splitRecipientNames(film.director)
    ).forEach((name) => {
      let id = window.normalizePersonName(name);
      let record = directors.get(id) || { id, name, films: 0, wins: 0 };
      record.films += 1;
      directors.set(id, record);
    }),
  );
  annualAwards
    .filter(
      (entry) =>
        entry.award.category === "Best Director" &&
        Number(entry.award.placement) === 1,
    )
    .forEach((entry) =>
      window.awardRecipientPeople(entry.award).forEach((person) => {
        let record = directors.get(person.id) || {
          id: person.id,
          name: person.name,
          films: 0,
          wins: 0,
        };
        record.wins += 1;
        directors.set(person.id, record);
      }),
    );
  let topDirector = [...directors.values()].sort(
    (left, right) =>
      right.wins - left.wins ||
      right.films - left.films ||
      left.name.localeCompare(right.name),
  )[0];

  let performers = new Map();
  annualAwards
    .filter(
      (entry) =>
        window.PERSON_AWARD_PROFESSIONS[entry.award.category] === "Actor",
    )
    .forEach((entry) =>
      window.awardRecipientPeople(entry.award).forEach((person) => {
        let record = performers.get(person.id) || {
          id: person.id,
          name: person.name,
          wins: 0,
          nominations: 0,
        };
        record.nominations += 1;
        if (Number(entry.award.placement) === 1) record.wins += 1;
        performers.set(person.id, record);
      }),
    );
  let topPerformer = [...performers.values()].sort(
    (left, right) =>
      right.wins - left.wins ||
      right.nominations - left.nominations ||
      left.name.localeCompare(right.name),
  )[0];
  let personSummary =
    [
      topDirector
        ? `<div><b>${escape(window.uiText?.("Director") || "Director")}</b><a href="${escape(window.personPageUrl(topDirector.id))}">${escape(topDirector.name)}</a><span>${topDirector.wins} ${window.uiText?.("wins") || "wins"} · ${topDirector.films} ${window.uiText?.("films") || "films"}</span></div>`
        : "",
      topPerformer
        ? `<div><b>${escape(window.uiText?.("Performer") || "Performer")}</b><a href="${escape(window.personPageUrl(topPerformer.id))}">${escape(topPerformer.name)}</a><span>${topPerformer.wins} ${window.uiText?.("wins") || "wins"} · ${topPerformer.nominations} ${window.uiText?.("noms") || "noms"}</span></div>`
        : "",
    ]
      .filter(Boolean)
      .join("") ||
    `<p>${escape(window.uiText?.("No annual people data") || "No annual people data")}</p>`;

  let mediumCounts = { "live-action": 0, animation: 0 };
  let screenplayCounts = { original: 0, adapted: 0 };
  films.forEach((film) => {
    if (mediumCounts[film.medium] !== undefined) mediumCounts[film.medium] += 1;
    if (screenplayCounts[film.screenplayType] !== undefined)
      screenplayCounts[film.screenplayType] += 1;
  });
  let knownMedium = Object.values(mediumCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  let animationShare = knownMedium
    ? Math.round((mediumCounts.animation / knownMedium) * 100)
    : 0;
  let categories = new Map();
  annualAwards.forEach((entry) =>
    categories.set(
      entry.award.category,
      (categories.get(entry.award.category) || 0) + 1,
    ),
  );
  let topCategory = [...categories.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0];
  let awardSummary = annualAwards.length
    ? `<strong>${annualAwards.length}</strong><span>${window.uiText?.("annual nominations") || "annual nominations"}</span>${topCategory ? `<a href="${escape(window.categoryPageUrl(topCategory[0]))}">${escape(window.localizedCategoryName?.(topCategory[0]) || topCategory[0])}</a><span>${topCategory[1]} ${window.uiText?.("nominations") || "nominations"}</span>` : ""}`
    : `<span>${window.uiText?.("No annual award data") || "No annual award data"}</span>`;

  return `<section class="period-highlights"><h2>${escape(window.uiText?.("Highlights") || "Highlights")}</h2><div class="period-highlight-grid">
    <article class="period-highlight-card"><h3>${escape(window.uiText?.("Top films") || "Top films")}</h3><ol>${filmLinks || `<li>${escape(window.uiText?.("No ranked films") || "No ranked films")}</li>`}</ol></article>
    <article class="period-highlight-card"><h3>${escape(window.uiText?.("People") || "People")}</h3><div class="highlight-people">${personSummary}</div></article>
    <article class="period-highlight-card"><h3>${escape(window.uiText?.("Medium & screenplay") || "Medium & screenplay")}</h3><h4>${escape(window.uiText?.("Medium") || "Medium")}</h4><strong>${animationShare}%</strong><span>${window.uiText?.("animation among known films") || "animation among known films"}</span><dl><div><dt>${escape(window.uiText?.("Live action") || "Live action")}</dt><dd>${mediumCounts["live-action"]}</dd></div><div><dt>${escape(window.uiText?.("Animation") || "Animation")}</dt><dd>${mediumCounts.animation}</dd></div></dl><h4>${escape(window.uiText?.("Screenplay") || "Screenplay")}</h4><dl><div><dt>${escape(window.uiText?.("Original") || "Original")}</dt><dd>${screenplayCounts.original}</dd></div><div><dt>${escape(window.uiText?.("Adapted") || "Adapted")}</dt><dd>${screenplayCounts.adapted}</dd></div></dl></article>
    <article class="period-highlight-card"><h3>${escape(window.uiText?.("Awards") || "Awards")}</h3><div class="highlight-awards">${awardSummary}</div></article>
  </div></section>`;
};

/**
 * Renders a half-star-bucket rating histogram for films.
 * @param {FilmRecord[]} films Films to summarize.
 * @returns {string}
 */
window.renderRatingHistogram = function (films) {
  let counts = new Map(
    Array.from({ length: 10 }, (_, index) => [(index + 1) / 2, 0]),
  );
  films.forEach((film) => {
    let rating = window.filmRatingValue(film);
    if (rating) counts.set(rating, counts.get(rating) + 1);
  });
  let rated = [...counts.values()].reduce((sum, count) => sum + count, 0);
  if (!rated) return "";
  let maximum = Math.max(...counts.values(), 1);
  let bars = [...counts.entries()]
    .map(
      ([rating, count]) =>
        `<div class="rating-histogram-row"><span>${rating % 1 ? rating : rating.toFixed(0)}★</span><div><i style="width:${Math.round((count / maximum) * 100)}%"></i></div><b>${count}</b></div>`,
    )
    .join("");
  return `<details class="rating-histogram"><summary>${window.uiText?.("Ratings histogram") || "Ratings histogram"} <span>${window.uiText?.("{count} rated films", { count: rated }) || `${rated} rated films`}</span></summary><div>${bars}</div></details>`;
};
