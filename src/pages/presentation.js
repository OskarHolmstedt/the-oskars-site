/** @file Renders the read-only archive showcase — the whole archive by default, or a generated pack scoped to a project, franchise, person, tag, category, period, or a watched-year recap — its guided navigation, ceremony mode, and print presentation. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let finishRenderTimer = window.startOskarsPerformance?.(
    "presentation:render",
  );
  let container = document.getElementById("presentationPage");

  // Presentation packs (issue #59, phase 3 of #19): an explicit `?scope=` +
  // `?id=` pair narrows the showcase to one project/franchise/person/tag/
  // category/period, or a watched-year "cinematic year" recap, generated
  // through the exact same sections/nav/ceremony/PDF-export machinery as the
  // whole-archive view below rather than a second, unrelated presentation
  // system. Reading these once at the top - never mutated in-page - keeps
  // scope selection a plain navigation (a real link), not authoring state.
  let packViewState = window.createPageViewState({
    path: "presentation.html",
    schema: {
      scope: { default: "" },
      id: { default: "" },
      sections: { default: "" },
      limit: { default: 0, parse: (raw) => Math.max(0, Number(raw) || 0) },
    },
  });
  let packParams = packViewState.read();
  let pack = packParams.scope
    ? window.resolvePresentationPackScope(packParams.scope, packParams.id)
    : {
        valid: true,
        films: Object.values(state.filmsById || {}),
        watchlist: state.watchlist || [],
      };
  // A deleted project/franchise/person or a malformed period/year still
  // resolves deterministically - `scopeInvalid` distinguishes "reference no
  // longer exists" from "exists but nothing watched yet" (pack.valid with
  // empty arrays), which get distinct empty-state messages below.
  let scopeInvalid = Boolean(packParams.scope) && !pack.valid;
  let isScoped = Boolean(packParams.scope) && !scopeInvalid;
  let films = scopeInvalid ? [] : pack.films || [];
  let watchlist = scopeInvalid ? [] : pack.watchlist || [];
  // Archive-wide-only sections (franchise shelf, people wall) need the full
  // people index; any explicit scope skips them rather than showing
  // unrelated global "most awarded" rankings once a slice has been chosen.
  let people = isScoped
    ? []
    : Object.values(window.ensurePeopleIndex?.() || state.peopleById || {});

  let sectionsFilter = packParams.sections
    ? new Set(packParams.sections.split(",").filter(Boolean))
    : null;
  function sliceLimit(defaultValue) {
    return packParams.limit > 0 ? packParams.limit : defaultValue;
  }

  // Period scopes carry a raw type/key rather than a display name (that's
  // page copywriting, not domain data); year-recap carries its own year.
  function periodDisplayLabel() {
    if (pack.periodType === "alltime") return ui("All-time");
    return pack.periodKey;
  }
  let scopeName = pack.isYearRecap
    ? pack.recapYear
    : packParams.scope === "period"
      ? periodDisplayLabel()
      : pack.name;

  document.title = `${isScoped && scopeName ? `${scopeName} · ` : ""}${ui("Showcase")} · The Oskars`;

  // Read-only showcase (issue #57, phase 1 of #19): curated highlights over
  // exhaustive tables, no editing affordances, and every section skips itself
  // when the archive has nothing presentable for it (sparse-data guard from
  // the #19 review: franchise cards need a representative poster, people-wall
  // cards need a portrait).

  function presentationSection(id, title, subtitle, bodyHtml) {
    if (!bodyHtml) return "";
    if (sectionsFilter && !sectionsFilter.has(id)) return "";
    return `<section class="presentation-section" id="presentation-${escape(id)}" data-presentation-slide="${escape(id)}"><header><h2>${escape(title)}</h2>${subtitle ? `<p>${escape(subtitle)}</p>` : ""}</header>${bodyHtml}</section>`;
  }

  // Opening snapshot - archive-wide stats stay exactly as before; a scoped
  // pack (including the year recap) shows a smaller, scope-relevant set
  // instead of global archive/people counts that wouldn't mean anything once
  // a slice has been chosen.
  function formatSnapshotStats(pairs) {
    return pairs
      .filter(([value]) => value || value === 0)
      .map(
        ([value, label]) =>
          `<span><b>${escape(value)}</b> ${escape(label)}</span>`,
      )
      .join("");
  }
  let filmYears = films
    .map((film) => Number(film.year))
    .filter(Number.isFinite);
  let snapshotHtml;
  if (pack.isYearRecap) {
    let recapStats = window.viewingStatistics(films);
    let recapWinnerCount = films.filter((film) =>
      (film.awards || []).some((award) => Number(award.placement) === 1),
    ).length;
    snapshotHtml = formatSnapshotStats([
      [recapStats.filmCount, ui("Films watched")],
      [
        recapStats.ratedCount
          ? window.formatAverageRating(recapStats.averageRating)
          : "",
        ui("Average rating"),
      ],
      [recapStats.decadeRows.length, ui("Decades explored")],
      [recapWinnerCount, ui("Award winners")],
    ]);
  } else if (isScoped) {
    snapshotHtml = formatSnapshotStats([
      [films.length, ui("Films")],
      [
        filmYears.length
          ? `${Math.min(...filmYears)}–${Math.max(...filmYears)}`
          : "",
        ui("Years"),
      ],
      [
        films.filter((film) => Number(film.allTimeRank) > 0).length,
        ui("All-time ranked"),
      ],
      ...(watchlist.length ? [[watchlist.length, "Watchlist"]] : []),
    ]);
  } else {
    let annualNominations = 0;
    films.forEach((film) =>
      (film.awards || []).forEach((award) => {
        if (/^\d{4}$/.test(String(award.year || ""))) annualNominations += 1;
      }),
    );
    let allTimeCount = (state.years?.alltime?.films || []).length;
    snapshotHtml = formatSnapshotStats([
      [films.length, ui("Films")],
      [
        filmYears.length
          ? `${Math.min(...filmYears)}–${Math.max(...filmYears)}`
          : "",
        ui("Years"),
      ],
      [annualNominations, ui("Annual nominations")],
      [allTimeCount, ui("All-time ranked")],
      [people.length, ui("People")],
      [watchlist.length, "Watchlist"],
    ]);
  }

  // All-time top shelf - deliberately smaller and quieter than home.js's
  // sortable top-25 table: ten films (or `limit`), rank order, no controls.
  // A scoped pack simply filters this same ranking to its own films; a
  // scope whose members never reached the all-time bracket skips the
  // section, matching the sparse-data philosophy everywhere else here.
  let topShelfTitle = pack.isYearRecap
    ? ui("Top ranked this year")
    : ui("All-time top shelf");
  let topShelf = films
    .filter((film) => Number(film.allTimeRank) > 0)
    .sort((left, right) => Number(left.allTimeRank) - Number(right.allTimeRank))
    .slice(0, sliceLimit(10));
  let topShelfHtml = topShelf.length
    ? `<div class="film-grid presentation-top-grid">${topShelf
        .map((film) =>
          window.renderSharedFilmCard(film, {
            classes: ["presentation-film-card"],
            openFilm: false,
            rankLabel: `${film.allTimeRank}.`,
            showYear: true,
            director: film.director || (film.directors || []).join(", "),
            escape,
          }),
        )
        .join("")}</div>`
    : "";

  // Award winners watched this year (year recap only) - a "which of what I
  // watched actually won something" retrospective, not the release-year
  // ceremony (a film watched in 2025 may have been awarded in any year).
  let recapWinnersTitle = ui("Award winners you watched");
  let recapWinners = pack.isYearRecap
    ? films
        .filter((film) =>
          (film.awards || []).some((award) => Number(award.placement) === 1),
        )
        .sort(
          (left, right) =>
            (Number(left.allTimeRank) > 0
              ? Number(left.allTimeRank)
              : 999999) -
              (Number(right.allTimeRank) > 0
                ? Number(right.allTimeRank)
                : 999999) || window.compareEnglishTitles(left.title, right.title),
        )
    : [];
  let recapWinnersHtml = recapWinners.length
    ? `<div class="film-grid presentation-top-grid">${recapWinners
        .slice(0, sliceLimit(10))
        .map((film) =>
          window.renderSharedFilmCard(film, {
            classes: ["presentation-film-card"],
            openFilm: false,
            showYear: true,
            director: film.director || (film.directors || []).join(", "),
            escape,
          }),
        )
        .join("")}</div>`
    : "";

  // Awards ceremony (issue #58, phase 2 of #19): the most recent annual
  // awards period among the in-scope films - or, for a period scope, that
  // exact year/decade/century/all-time bracket. Never rendered for the
  // year recap (its "awards" story is the retrospective section above, not
  // one release-year's category slate). The board below is always fully
  // revealed, matching ordinary showcase browsing; "Run ceremony" is an
  // optional, presenter-local staged reveal layered on top (see
  // setupPresentationInteractivity) that never changes what's persisted or
  // shareable about the page.
  let ceremonyTitle = ui("Awards ceremony");
  function buildCeremonyData() {
    let forcedPeriodType = {
      year: "years",
      decade: "decades",
      century: "centuries",
      alltime: "allTime",
    }[pack.periodType];
    let forcedPeriodKey = pack.periodKey || "";
    let entriesByPeriod = new Map();
    films.forEach((film) => {
      (film.awards || []).forEach((award) => {
        let periodKey = String(award.year || "");
        if (forcedPeriodType) {
          if (
            periodKey !== forcedPeriodKey ||
            window.getAwardPeriodType(award) !== forcedPeriodType
          )
            return;
        } else {
          if (!/^\d{4}$/.test(periodKey)) return;
          if (window.getAwardPeriodType(award) !== "years") return;
        }
        if (!entriesByPeriod.has(periodKey)) entriesByPeriod.set(periodKey, []);
        entriesByPeriod.get(periodKey).push({ film, award });
      });
    });
    if (!entriesByPeriod.size) return null;
    let periodKey = forcedPeriodType
      ? forcedPeriodKey
      : [...entriesByPeriod.keys()].sort(
          (left, right) => Number(right) - Number(left),
        )[0];
    let entriesByCategory = new Map();
    entriesByPeriod.get(periodKey).forEach((entry) => {
      let category = entry.award.category;
      if (!entriesByCategory.has(category)) entriesByCategory.set(category, []);
      entriesByCategory.get(category).push(entry);
    });
    let categories = window
      .getOrderedCategories()
      .filter((category) => entriesByCategory.has(category))
      .reverse()
      .map((category) => {
        let categoryEntries = entriesByCategory.get(category);
        let winner =
          categoryEntries.find(
            (entry) => Number(entry.award.placement) === 1,
          ) || null;
        // Alphabetical, not placement order: the stage reveal must not leak
        // the ranking through card position before "Reveal ranking" is used.
        let nominees = [...categoryEntries].sort((left, right) =>
          window.compareEnglishTitles(left.film.title, right.film.title),
        );
        return { category, winner, nominees };
    });
    return categories.length
      ? { key: periodKey, periodType: forcedPeriodType || "years", categories }
      : null;
  }
  let ceremony = pack.isYearRecap ? null : buildCeremonyData();

  function renderCeremonyCredit(entry, category) {
    return window.renderAwardCreditHtml({
      film: entry.film,
      award: entry.award,
      category,
      escape,
      detailStyle: "divider",
      wrapperClass: "nominee-recipient-credit",
    }).html;
  }

  function renderCeremonyBoardCard({ category, winner, nominees }) {
    let byPlacement = [...nominees].sort(
      (left, right) => Number(left.award.placement) - Number(right.award.placement),
    );
    let winnerHtml = winner
      ? `<a class="ceremony-winner" href="${escape(window.filmPageUrl(winner.film.id))}">${window.renderFilmPoster(winner.film, "thumb")}<span class="ceremony-winner-body"><b>🏆 ${escape(window.localizedFilmTitle?.(winner.film) || winner.film.title)}</b>${renderCeremonyCredit(winner, category)}</span></a>`
      : `<p class="ceremony-no-winner">${escape(ui("No winner recorded"))}</p>`;
    let othersHtml = byPlacement
      .filter((entry) => entry !== winner)
      .map(
        (entry) =>
          `<li>${escape(window.placementEmoji?.[entry.award.placement] || `#${entry.award.placement}`)} <a href="${escape(window.filmPageUrl(entry.film.id))}">${escape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</a>${renderCeremonyCredit(entry, category)}</li>`,
      )
      .join("");
    return `<div class="ceremony-category-card"><a class="category-link" href="${escape(window.categoryPageUrl(category))}"><b>${escape(window.localizedCategoryName?.(category) || category)}</b></a>${winnerHtml}${othersHtml ? `<ul class="ceremony-nominee-list">${othersHtml}</ul>` : ""}</div>`;
  }

  function renderCeremonyStageSlide({ category, winner, nominees }, index, total) {
    let nomineeItems = nominees
      .map((entry) => {
        let isWinner = entry === winner;
        let placement = Number(entry.award.placement);
        let placementLabel = window.placementEmoji?.[placement] || `#${placement}`;
        return `<li class="ceremony-stage-nominee${isWinner ? " ceremony-stage-nominee--winner" : ""}" style="--ceremony-placement:${placement}">${window.renderFilmPoster(entry.film, "thumb")}<span class="ceremony-stage-nominee-body"><i class="ceremony-placement" aria-label="${escape(ui("Placement {placement}", { placement }))}">${escape(placementLabel)}</i><b>${escape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</b>${renderCeremonyCredit(entry, category)}</span></li>`;
      })
      .join("");
    let hasRanking = nominees.some(
      (entry) => Number(entry.award.placement) > 0,
    );
    return `<div class="ceremony-stage-slide" data-ceremony-slide="${index}" data-has-ranking="${hasRanking}"${index === 0 ? "" : " hidden"}>
      <div class="ceremony-stage-progress">${escape(ui("Category {current} of {total}", { current: index + 1, total }))}</div>
      <h3 class="ceremony-stage-category">${escape(window.localizedCategoryName?.(category) || category)}</h3>
      <ul class="ceremony-stage-nominees">${nomineeItems}</ul>
      ${winner ? "" : `<p class="ceremony-stage-empty">${escape(ui("No winner recorded"))}</p>`}
    </div>`;
  }

  let ceremonyHtml = ceremony
    ? `<div class="ceremony-toolbar"><span class="ceremony-year-badge">${escape(ceremony.key)}</span><button type="button" class="button-link" data-ceremony-start>${escape(ui("Run ceremony"))}</button></div>
    <div class="ceremony-board" data-ceremony-board>${ceremony.categories.map(renderCeremonyBoardCard).join("")}</div>
    <div class="ceremony-stage" data-ceremony-stage hidden>
      ${ceremony.categories.map((entry, index) => renderCeremonyStageSlide(entry, index, ceremony.categories.length)).join("")}
      <div class="ceremony-stage-controls">
        <button type="button" data-ceremony-prev>${escape(ui("Previous category"))}</button>
        <button type="button" data-ceremony-reveal>${escape(ui("Reveal ranking"))}</button>
        <button type="button" data-ceremony-next>${escape(ui("Next category"))}</button>
        <button type="button" data-ceremony-exit>${escape(ui("Exit ceremony"))}</button>
      </div>
    </div>`
    : "";

  // Decade journey - one defining film per decade (best all-time rank, then
  // best rating), linked to the decade's period page. Scoping down to a
  // pack's own films turns this into that pack's own chronological spread -
  // for the year recap specifically, "which release decades did this year's
  // viewing span" rather than a chronology of when films were watched.
  let decadesTitle = pack.isYearRecap
    ? ui("Decades explored")
    : ui("Through the decades");
  let decadeMap = new Map();
  films.forEach((film) => {
    if (!/^\d{4}$/.test(String(film.year || ""))) return;
    let decade = window.getDecadeKey(film.year);
    if (!decadeMap.has(decade)) decadeMap.set(decade, []);
    decadeMap.get(decade).push(film);
  });
  let decadeCards = [...decadeMap.entries()]
    .sort(
      (left, right) =>
        Number(left[0].replace(/\D/g, "")) -
        Number(right[0].replace(/\D/g, "")),
    )
    .map(([decade, decadeFilms]) => {
      let defining = [...decadeFilms].sort((left, right) => {
        let leftRank =
          Number(left.allTimeRank) > 0 ? Number(left.allTimeRank) : 999999;
        let rightRank =
          Number(right.allTimeRank) > 0 ? Number(right.allTimeRank) : 999999;
        return (
          leftRank - rightRank ||
          (window.filmRatingSortValue(right.rating) || 0) -
            (window.filmRatingSortValue(left.rating) || 0) ||
          window.compareEnglishTitles(left.title, right.title)
        );
      })[0];
      return `<a class="presentation-decade-card" href="${escape(window.periodPageUrl("decade", decade))}">${window.renderFilmPoster(defining, "thumb")}<span class="presentation-decade-body"><strong>${escape(decade)}</strong><small>${escape(window.uiCount?.(decadeFilms.length, "film", "films") || `${decadeFilms.length} films`)}</small><span class="presentation-decade-film">${escape(window.localizedFilmTitle?.(defining) || defining.title)}</span></span></a>`;
    });
  let decadeHtml = decadeCards.length
    ? `<div class="presentation-decade-rail">${decadeCards.join("")}</div>`
    : "";

  // Franchise shelf and people wall - archive-wide-only sections. Once a
  // pack has already been scoped to one project/franchise/person/tag/
  // category/period, a global "strongest franchises"/"most awarded people"
  // ranking is off-topic rather than informative, so both are skipped for
  // any explicit scope (including the year recap) instead of recomputing a
  // scoped variant that would need its own, differently-shaped ranking.
  let franchisesTitle = ui("Franchise shelf");
  let franchiseIndex = isScoped
    ? {}
    : window.ensureFranchiseIndex?.() || state.franchisesById || {};
  let franchiseShelf = isScoped
    ? []
    : Object.values(franchiseIndex)
        .filter(
          (franchise) => !(franchise.parentIds?.length || franchise.parentId),
        )
        .map((franchise) => ({
          franchise,
          completion: window.franchiseCompletion(franchise),
          representative: window.franchiseRepresentativeFilm(franchise),
        }))
        .filter(
          (entry) =>
            (entry.franchise.films || []).length >= 2 &&
            entry.representative &&
            window.renderFilmPoster(entry.representative, "card"),
        )
        .sort(
          (left, right) =>
            (right.franchise.films || []).length -
              (left.franchise.films || []).length ||
            right.completion.percent - left.completion.percent,
        )
        .slice(0, sliceLimit(6));
  let franchiseHtml = franchiseShelf.length
    ? `<div class="presentation-franchise-grid">${franchiseShelf
        .map(
          ({ franchise, completion, representative }) =>
            `<a class="presentation-franchise-card" href="${escape(window.franchisePageUrl(franchise.id))}">${window.renderFilmPoster(representative, "card")}<span class="presentation-franchise-body"><strong>${escape(franchise.name)}</strong><small>${escape(completion.watchedCount)}/${escape(completion.total)} ${escape(ui("Watched").toLocaleLowerCase())} · ${escape(completion.percent)}%</small></span></a>`,
        )
        .join("")}</div>`
    : "";

  let peopleTitle = ui("Most awarded people");
  let peopleWall = isScoped
    ? []
    : people
        .map((person) => ({
          person,
          portraitHtml: window.renderPersonPortrait(person, "thumb"),
        }))
        .filter(
          (entry) =>
            entry.portraitHtml &&
            (entry.person.stats?.wins || 0) +
              (entry.person.stats?.nominations || 0) >
              0,
        )
        .sort(
          (left, right) =>
            (right.person.stats?.wins || 0) - (left.person.stats?.wins || 0) ||
            (right.person.stats?.nominations || 0) -
              (left.person.stats?.nominations || 0),
        )
        .slice(0, sliceLimit(8));
  let peopleHtml = peopleWall.length
    ? `<div class="presentation-people-grid">${peopleWall
        .map(
          ({ person, portraitHtml }) =>
            `<a class="presentation-person-card" href="${escape(window.personPageUrl(person.id))}">${portraitHtml}<span class="presentation-person-body"><strong>${escape(person.name)}</strong><small>${escape(person.stats?.wins || 0)} ${escape(ui("Wins").toLocaleLowerCase())} · ${escape(person.stats?.nominations || 0)} ${escape(ui("Nominations").toLocaleLowerCase())}</small></span></a>`,
        )
        .join("")}</div>`
    : "";

  // Watchlist teaser - S/A-tier highlights only, the "coming attractions".
  // Retrospective by nature, the year recap has no forward-looking teaser.
  let watchlistTitle = ui("Next up from the watchlist");
  let watchlistTeaser = pack.isYearRecap
    ? []
    : watchlist
        .filter((item) =>
          ["S", "A"].includes(String(item.tier || "").toUpperCase()),
        )
        .sort(
          (left, right) =>
            (window.watchlistTierRank?.(left.tier) ?? 9) -
              (window.watchlistTierRank?.(right.tier) ?? 9) ||
            window.compareEnglishTitles(left.title, right.title),
        )
        .slice(0, sliceLimit(6));
  let watchlistHtml = watchlistTeaser.length
    ? `<div class="film-grid presentation-top-grid">${watchlistTeaser
        .map((item) => {
          let film = window.watchlistFilmLike(item);
          return window.renderSharedFilmCard(film, {
            classes: ["presentation-film-card", "watchlist-card"],
            openFilm: false,
            showYear: true,
            escape,
            beforeTitleHtml: item.tier
              ? `<span class="watchlist-tier tier-${escape(item.tier.toLowerCase())}">${escape(item.tier)}</span>`
              : "",
            titleHtml: `<a class="table-film-link" href="${escape(window.watchlistFilmPageUrl(item.id))}">${escape(window.localizedFilmTitle?.(film) || item.title)}</a>`,
            director: film.director || (film.directors || []).join(", "),
          });
        })
        .join("")}</div>`
    : "";

  // Section registry: only sections with presentable content are navigable,
  // matching the sparse-data skip already applied to each one.
  let sections = [
    {
      id: "alltime",
      label: topShelfTitle,
      html: presentationSection(
        "alltime",
        topShelfTitle,
        pack.isYearRecap
          ? ui("The highest all-time-ranked films you watched this year.")
          : ui("The ten highest-ranked films in the archive."),
        topShelfHtml,
      ),
    },
    {
      id: "recap-winners",
      label: recapWinnersTitle,
      html: presentationSection(
        "recap-winners",
        recapWinnersTitle,
        ui("Films you watched that went on to win an award."),
        recapWinnersHtml,
      ),
    },
    {
      id: "ceremony",
      label: ceremonyTitle,
      html: presentationSection(
        "ceremony",
        ceremonyTitle,
        ceremony
          ? ui(
              "Step through {year}'s categories, revealing the full ranking category by category.",
              { year: ceremony.key },
            )
          : "",
        ceremonyHtml,
      ),
    },
    {
      id: "decades",
      label: decadesTitle,
      html: presentationSection(
        "decades",
        decadesTitle,
        pack.isYearRecap
          ? ui("The release decades your viewing touched this year.")
          : ui("One defining film for every decade watched."),
        decadeHtml,
      ),
    },
    {
      id: "franchises",
      label: franchisesTitle,
      html: presentationSection(
        "franchises",
        franchisesTitle,
        ui("The collections with the deepest footprint."),
        franchiseHtml,
      ),
    },
    {
      id: "people",
      label: peopleTitle,
      html: presentationSection(
        "people",
        peopleTitle,
        ui("The names that keep coming back."),
        peopleHtml,
      ),
    },
    {
      id: "watchlist",
      label: watchlistTitle,
      html: presentationSection(
        "watchlist",
        watchlistTitle,
        ui("Top-tier films still waiting to be watched."),
        watchlistHtml,
      ),
    },
  ].filter((section) => section.html);

  let enterModeLabel = ui("Enter presentation mode");
  let exitModeLabel = ui("Exit presentation mode");
  let navHtml = `<nav class="presentation-nav" aria-label="${escape(ui("Section navigation"))}" data-presentation-nav>
    <div class="presentation-nav-jumps" data-presentation-jumps>
      <a href="#presentation-overview" data-presentation-jump="overview">${escape(ui("Overview"))}</a>
      ${sections.map((section) => `<a href="#presentation-${escape(section.id)}" data-presentation-jump="${escape(section.id)}">${escape(section.label)}</a>`).join("")}
    </div>
    <div class="presentation-nav-controls">
      <button type="button" class="presentation-nav-arrow" data-presentation-prev aria-label="${escape(ui("Previous section"))}">‹</button>
      <button type="button" class="presentation-nav-arrow" data-presentation-next aria-label="${escape(ui("Next section"))}">›</button>
      <button type="button" class="button-link" data-presentation-mode>${escape(enterModeLabel)}</button>
    </div>
  </nav>`;

  // Scope picker (issue #59): reuses the site's own cross-entity search
  // index/matcher rather than a bespoke lookup per scope type, and links
  // straight to the scoped URL instead of the entity's own page. Only shown
  // on the unscoped, whole-archive view - a scoped pack instead offers a
  // plain link back to it.
  let recapYears = window.watchedRecapYears?.() || [];
  let heroBackLinkHtml = isScoped
    ? `<a class="presentation-back-link" href="presentation.html">${escape(ui("‹ Whole archive"))}</a>`
    : "";
  let scopePickerHtml =
    !isScoped && films.length
      ? `<div class="presentation-scope-picker" data-presentation-scope-picker>
      <label for="presentationScopeInput">${escape(ui("Focus this showcase on…"))}</label>
      <input type="search" id="presentationScopeInput" autocomplete="off" placeholder="${escape(ui("Project, franchise, person, tag, category, or period"))}" data-presentation-scope-input>
      <div class="presentation-scope-results" data-presentation-scope-results hidden></div>
      ${recapYears.length ? `<div class="presentation-scope-recap"><span>${escape(ui("Or relive a year:"))}</span>${recapYears.map((year) => `<a href="presentation.html?scope=year-recap&amp;id=${escape(year)}">${escape(year)}</a>`).join("")}</div>` : ""}
    </div>`
      : "";

  let heroTitle = pack.isYearRecap
    ? ui("Your {year} in film", { year: pack.recapYear })
    : isScoped
      ? ui("{name}, on display", { name: scopeName })
      : ui("The archive, on display");
  let heroSubtitle = pack.isYearRecap
    ? ui("A recap of what you watched in {year}.", { year: pack.recapYear })
    : isScoped
      ? ui("A curated look at {name}.", { name: scopeName })
      : ui("A curated look at the films, people, and eras of this collection.");

  let scopeEmptyMessage = pack.isYearRecap
    ? ui("Nothing was watched in {year} yet.", { year: pack.recapYear })
    : ui("Nothing here has been watched yet.");

  container.innerHTML = scopeInvalid
    ? `<div class="detail-empty"><h1>${escape(ui("Showcase not found"))}</h1><p>${escape(ui("This project, franchise, person, tag, category, period, or year could not be found."))}</p><a href="presentation.html">${escape(ui("Return to the whole-archive showcase"))}</a></div>`
    : films.length
      ? `${navHtml}<header class="presentation-hero" id="presentation-overview" data-presentation-slide="overview">
    ${heroBackLinkHtml}
    <span class="eyebrow">The Oskars</span>
    <h1>${escape(heroTitle)}</h1>
    <p>${escape(heroSubtitle)}</p>
    ${window.renderDetailStats({ classes: "presentation-stats", itemsHtml: snapshotHtml })}
    <div class="presentation-print-row"><button type="button" class="button-link" data-presentation-print>${escape(ui("Export PDF slides"))}</button>${window.renderCopyViewLinkButton({ escape })}</div>
    ${scopePickerHtml}
  </header>
  ${sections.map((section) => section.html).join("")}`
      : isScoped
        ? `<div class="detail-empty"><h1>${escape(ui("Nothing to show yet"))}</h1><p>${escape(scopeEmptyMessage)}</p><a href="presentation.html">${escape(ui("Return to the whole-archive showcase"))}</a></div>`
        : `<div class="detail-empty"><h1>${escape(ui("Nothing to show yet"))}</h1><p>${escape(ui("Import some films first, then come back for the tour."))}</p><a href="index.html">${escape(ui("Return home"))}</a></div>`;

  // PDF slide export (issue #60): the print stylesheet turns each section
  // into an A4-landscape slide; the browser's Save-as-PDF produces the deck.
  // Lazy poster images must go eager before printing or off-screen slides
  // can render without their artwork.
  function preparePresentationForPrint() {
    container.querySelectorAll?.("img").forEach((image) => {
      image.loading = "eager";
    });
  }
  container
    .querySelector?.("[data-presentation-print]")
    ?.addEventListener("click", () => {
      preparePresentationForPrint();
      window.print();
    });
  window.addEventListener?.("beforeprint", preparePresentationForPrint);

  // Copy-view-link (issue #59) and scope picker: delegated at the container
  // like discover.js's own copy-link handling, since the picker's result
  // list is regenerated on every keystroke rather than bound once.
  container.addEventListener?.("click", (event) => {
    let copyButton = event.target.closest?.("[data-copy-view-link]");
    if (!copyButton) return;
    window.copyViewLink().then((copied) => {
      copyButton.textContent = ui(copied ? "Copied" : "Copy failed");
    });
  });

  function setupScopePicker() {
    let input = container.querySelector?.("[data-presentation-scope-input]");
    let results = container.querySelector?.(
      "[data-presentation-scope-results]",
    );
    if (!input || !results) return;
    let supportedTargetTypes = new Set([
      "project",
      "franchise",
      "person",
      "tag",
      "category",
      "period",
    ]);
    let candidates = null;
    function getCandidates() {
      if (!candidates)
        candidates = (window.buildSearchEntries?.() || []).filter((entry) =>
          supportedTargetTypes.has(entry.target?.type),
        );
      return candidates;
    }
    input.addEventListener("input", () => {
      let query = input.value.trim();
      if (!query) {
        results.innerHTML = "";
        results.hidden = true;
        return;
      }
      let matches = window.searchMatches(getCandidates(), query, {
        limit: 8,
      });
      results.innerHTML = matches.length
        ? matches
            .map(
              (entry) =>
                `<a href="presentation.html?scope=${escape(entry.target.type)}&amp;id=${escape(encodeURIComponent(entry.target.id))}"><strong>${escape(entry.name)}</strong><span>${escape(entry.type)}${entry.meta ? ` · ${escape(entry.meta)}` : ""}</span></a>`,
            )
            .join("")
        : `<p class="presentation-scope-empty">${escape(ui("No matches"))}</p>`;
      results.hidden = false;
    });
  }
  setupScopePicker();

  // Guided navigation and ceremony mode (issue #58, phase 2 of #19): jump
  // nav, prev/next, and the compact/full toggle drive one shared "active
  // slide" index kept in sync with a `?section=`/`?mode=` deep link; keyboard
  // arrows do the same when the ceremony stage isn't the one capturing them.
  // Ceremony run state itself is deliberately never written to the URL - the
  // acceptance criteria keep it presenter-local, reset on every exit/restart
  // so ordinary showcase browsing always comes back fully revealed.
  function setupPresentationInteractivity() {
    let nav = container.querySelector?.("[data-presentation-nav]");
    if (!nav) return;
    // Spread to real arrays: a real browser's querySelectorAll returns a
    // NodeList, which has no .findIndex (the JXA test stub happens to return
    // a plain Array, so this only surfaces against a real browser).
    let slides = [...container.querySelectorAll("[data-presentation-slide]")];
    let jumps = [...nav.querySelectorAll("[data-presentation-jump]")];
    let prevButton = nav.querySelector("[data-presentation-prev]");
    let nextButton = nav.querySelector("[data-presentation-next]");
    let modeButton = nav.querySelector("[data-presentation-mode]");
    let viewState = window.createPageViewState({
      path: "presentation.html",
      // preserveUnknown: this schema only owns section/mode, but the page
      // also carries scope/id/sections/limit (a separate schema read once
      // above) - without preserving unknown params, every nav interaction's
      // replaceState would silently drop the active pack from the URL.
      preserveUnknown: true,
      schema: {
        section: { default: "" },
        mode: {
          default: "compact",
          validate: (value) => value === "compact" || value === "full",
        },
      },
    });
    let current = viewState.read();
    let mode = current.mode;
    let activeIndex = Math.max(
      0,
      slides.findIndex(
        (slide) => slide.dataset.presentationSlide === current.section,
      ),
    );

    function persist() {
      let sectionId = slides[activeIndex]?.dataset.presentationSlide || "";
      current = viewState.read();
      viewState.replace(current, {
        section: sectionId === "overview" ? "" : sectionId,
        mode,
      });
    }

    function applyActive() {
      slides.forEach((slide, index) =>
        slide.classList.toggle("presentation-slide--active", index === activeIndex),
      );
      jumps.forEach((jump, index) =>
        jump.classList.toggle("presentation-jump--active", index === activeIndex),
      );
      if (prevButton) prevButton.disabled = activeIndex === 0;
      if (nextButton) nextButton.disabled = activeIndex === slides.length - 1;
    }

    function applyMode() {
      document.body.classList.toggle("presentation-mode-full", mode === "full");
      if (modeButton)
        modeButton.textContent = mode === "full" ? exitModeLabel : enterModeLabel;
    }

    function goTo(index, { scroll = true } = {}) {
      activeIndex = Math.max(0, Math.min(index, slides.length - 1));
      applyActive();
      persist();
      if (scroll)
        slides[activeIndex]?.scrollIntoView({
          behavior: mode === "full" ? "auto" : "smooth",
          block: "start",
        });
    }

    jumps.forEach((jump, index) =>
      jump.addEventListener("click", (event) => {
        event.preventDefault?.();
        goTo(index);
      }),
    );
    prevButton?.addEventListener("click", () => goTo(activeIndex - 1));
    nextButton?.addEventListener("click", () => goTo(activeIndex + 1));
    modeButton?.addEventListener("click", () => {
      mode = mode === "full" ? "compact" : "full";
      applyMode();
      persist();
      goTo(activeIndex);
    });

    applyMode();
    applyActive();
    if (mode === "full" || current.section)
      slides[activeIndex]?.scrollIntoView({ block: "start" });

    // Ceremony run mode - lives inside the ceremony slide but is wired here
    // so its Escape/Arrow handling can take priority over section nav.
    let board = container.querySelector?.("[data-ceremony-board]");
    let stage = container.querySelector?.("[data-ceremony-stage]");
    let startButton = container.querySelector?.("[data-ceremony-start]");
    let ceremonySlides = stage
      ? [...stage.querySelectorAll("[data-ceremony-slide]")]
      : [];
    let revealButton = stage?.querySelector("[data-ceremony-reveal]");
    let ceremonyNextButton = stage?.querySelector("[data-ceremony-next]");
    let ceremonyPrevButton = stage?.querySelector("[data-ceremony-prev]");
    let exitButton = stage?.querySelector("[data-ceremony-exit]");
    let ceremonyIndex = 0;

    function ceremonyShow(index) {
      ceremonyIndex = Math.max(0, Math.min(index, ceremonySlides.length - 1));
      ceremonySlides.forEach((slide, slideIndex) => {
        slide.hidden = slideIndex !== ceremonyIndex;
      });
      let slide = ceremonySlides[ceremonyIndex];
      let revealed = slide?.classList.contains("ceremony-revealed");
      let hasRanking = slide?.dataset.hasRanking === "true";
      if (revealButton) revealButton.disabled = !hasRanking || Boolean(revealed);
      if (ceremonyPrevButton) ceremonyPrevButton.disabled = ceremonyIndex === 0;
      if (ceremonyNextButton)
        ceremonyNextButton.disabled = ceremonyIndex === ceremonySlides.length - 1;
    }

    function ceremonyReveal() {
      let slide = ceremonySlides[ceremonyIndex];
      if (!slide || slide.dataset.hasRanking !== "true") return;
      slide.classList.add("ceremony-revealed");
      if (revealButton) revealButton.disabled = true;
    }

    function ceremonyReset() {
      ceremonySlides.forEach((slide) => slide.classList.remove("ceremony-revealed"));
      ceremonyShow(0);
    }

    function ceremonyEnter() {
      if (board) board.hidden = true;
      if (stage) stage.hidden = false;
      ceremonyReset();
    }

    function ceremonyExit() {
      if (stage) stage.hidden = true;
      if (board) board.hidden = false;
      ceremonyReset();
    }

    startButton?.addEventListener("click", ceremonyEnter);
    exitButton?.addEventListener("click", ceremonyExit);
    revealButton?.addEventListener("click", ceremonyReveal);
    ceremonyNextButton?.addEventListener("click", () => ceremonyShow(ceremonyIndex + 1));
    ceremonyPrevButton?.addEventListener("click", () => ceremonyShow(ceremonyIndex - 1));

    function handleKeydown(event) {
      let ceremonyActive = stage && !stage.hidden;
      if (ceremonyActive) {
        if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") {
          event.preventDefault?.();
          let slide = ceremonySlides[ceremonyIndex];
          if (slide?.dataset.hasRanking === "true" && !slide.classList.contains("ceremony-revealed"))
            ceremonyReveal();
          else ceremonyShow(ceremonyIndex + 1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault?.();
          ceremonyShow(ceremonyIndex - 1);
        } else if (event.key === "Escape") {
          event.preventDefault?.();
          ceremonyExit();
        }
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault?.();
        goTo(activeIndex + 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault?.();
        goTo(activeIndex - 1);
      }
    }
    window.addEventListener?.("keydown", handleKeydown);
  }
  setupPresentationInteractivity();

  finishRenderTimer?.(
    `${films.length} films, ${peopleWall.length} people, ${franchiseShelf.length} franchises, ceremony ${ceremony ? ceremony.key : "none"}, scope ${packParams.scope || "archive"}`,
  );
})();
