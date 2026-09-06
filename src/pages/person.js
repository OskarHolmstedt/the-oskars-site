/**
 * @file Controls the Supabase-backed person detail (issue #439): filmography,
 * awards, watchlist films, sorting, and order editing. Reads hydrate through
 * the same buildLegacyStateFromSupabaseHydration + rebuildAggregates()/
 * ensurePeopleIndex() pipeline #438 built for the 15 read-only pages and
 * franchise.js (issue #439) already reuses - people/index.js's own domain
 * logic (rebuildPeopleIndex, directorCompletion, watchlistItemsByDirector,
 * officialPersonOscarRecord, ...) is already pure over window.state, so it
 * works unmodified once fed Supabase-sourced state. Only entity notes and
 * the watchlist tier/order/local-rank write paths route to Supabase
 * directly, via the shared UI helpers tag.js/franchise.js already built
 * (supabase-entity-note.js, supabase-watchlist-bulk-tier.js).
 *
 * Real, flagged scope reductions (matching every other #439 cutover):
 * "Start project" is dropped (Supabase's projects schema isn't built yet).
 * Portrait finding/refreshing is dropped entirely, not half-ported - people
 * is a create-only shared catalog table by RLS design (no UPDATE policy),
 * same architecture decision already made for watchlist-film.html's shared
 * film metadata, so there's no Supabase-side place a found portrait could
 * be written back to.
 *
 * The Firestore-era shared-archive integration itself has a Supabase-
 * native replacement (issue #453): rebuildPeopleIndex() reads
 * OSKARS_SHARED_FILM_ARCHIVE (buildSharedFilmArchiveFromSupabase() below,
 * applied via applySharedFilmArchive() before rebuildAggregates()) to
 * populate each person's catalogIds - catalog films they're credited on
 * that the viewer hasn't watched, other-watched, or watchlisted, shown in
 * this page's own "Unseen" section. Issue #467 generalized this from a
 * director-only enrichment of an already-existing person into the thing
 * that creates the peopleById entry in the first place, for every
 * profession - previously a person with zero personal films/watchlist/
 * watchedOther presence (credited only on catalog films) had no entry at
 * all and always hit "Person not found," regardless of any Unseen data
 * that existed for them.
 */
(function () {
  let personPageEscape = window.pageEscape;
  let personPagePlacement = window.pagePlacement;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("personPage");

  function personPagePeriodOrder(period) {
    if (period === "alltime") return 100000;
    return Number(String(period || "").replace(/[^0-9]/g, "")) || 0;
  }

  let personId = window.pageQueryParam("id");
  let person = null;
  let peopleById = {};
  let noteState = { note: "", editing: false, busy: false };
  let localRankMap = new Map();
  let busy = false;

  let filmographyView =
    window.pageQueryParam("view") === "grid" ||
    window.pageQueryParam("filmography") === "cards"
      ? "grid"
      : "list";
  let personAwardsView =
    window.pageQueryParam("awards") === "progression"
      ? "progression"
      : "periods";
  let collectionPageView =
    window.pageQueryParam("collection-view") === "awards" ? "awards" : "films";
  let chronologyOrder =
    window.pageQueryParam("order") === "desc" ? "desc" : "asc";
  let sections = window.sectionsViewMode();
  let watchlistOrderEditMode =
    sections !== "combined" &&
    window.pageQueryParam("edit") === "watchlist-order";

  function metadataRow(label, value, href) {
    if (!value) return "";
    let isExternal = /^https?:\/\//i.test(String(href || ""));
    return `<div><dt>${personPageEscape(label)}</dt><dd>${
      href
        ? `<a class="period-link" href="${personPageEscape(href)}"${isExternal ? ' target="_blank" rel="noopener noreferrer"' : ""}>${personPageEscape(value)}</a>`
        : personPageEscape(value)
    }</dd></div>`;
  }

  function personViewUrl(
    order = chronologyOrder,
    sort = filmographySort,
    viewMode = filmographyView,
    seed = filmographySeed,
    sectionsMode = sections,
  ) {
    let parts = [];
    if (viewMode === "grid") parts.push("view=grid");
    if (collectionPageView === "awards") parts.push("collection-view=awards");
    if (personAwardsView === "progression") parts.push("awards=progression");
    if (sort === "director-rank") parts.push("sort=director-rank");
    else if (sort === "local-rank") parts.push("sort=local-rank");
    else if (sort === "shuffle") {
      parts.push("sort=shuffle");
      if (seed) parts.push(`seed=${encodeURIComponent(seed)}`);
    }
    if (order === "desc") parts.push("order=desc");
    if (sectionsMode === "combined") parts.push("sections=combined");
    if (watchlistOrderEditMode && sectionsMode !== "combined")
      parts.push("edit=watchlist-order");
    if (
      localRankEditMode &&
      sort === "local-rank" &&
      sectionsMode !== "combined"
    )
      parts.push("edit=local-rank");
    return `${window.personPageUrl(person.id)}${parts.length ? `&${parts.join("&")}` : ""}`;
  }

  function updatePersonViewUrl() {
    if (window.history?.replaceState)
      window.history.replaceState(null, "", personViewUrl());
  }

  function reload() {
    window.location.href = personViewUrl();
  }

  // Module-level so event handlers reachable outside render() (order-edit
  // commit callbacks, the sort/awards-view change handler) can read the
  // latest computed values without threading them through separately -
  // matches franchise.js's own shape.
  let isDirector = false;
  let filmographySort = "chronological";
  let filmographySeed = "";
  let localRankEditMode = false;
  let combinedView = false;
  let films = [];
  let localRankFilms = [];
  let watchlistItems = [];
  let directorPosition = new Map();

  function render() {
    if (!person) {
      document.title = `${ui("Person not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${personPageEscape(ui("Person not found"))}</h1><a href="index.html">${personPageEscape(ui("Return home"))}</a></div>`;
      return;
    }
    let finishRenderTimer = window.startOskarsPerformance?.("person:render");
    document.title = `${person.name} · The Oskars`;
    isDirector = person.professions.includes("Director");
    let collectionAwardModel = isDirector
      ? window.collectionAwardViewModel?.("director", person.id)
      : null;
    if (!isDirector) collectionPageView = "films";
    let requestedFilmographySort = window.pageQueryParam("sort");
    filmographySort =
      requestedFilmographySort === "shuffle"
        ? "shuffle"
        : isDirector && requestedFilmographySort === "director-rank"
          ? "director-rank"
          : isDirector &&
              requestedFilmographySort === "local-rank" &&
              sections !== "combined"
            ? "local-rank"
            : "chronological";
    filmographySeed =
      filmographySort === "shuffle"
        ? window.pageQueryParam("seed") || String(Date.now())
        : "";
    let chronologyFactor = chronologyOrder === "desc" ? -1 : 1;
    let unsortedFilms = person.filmIds
      .map((id) => state.filmsById[id])
      .filter(Boolean);
    let otherWatched = (person.watchedOtherIds || [])
      .map((id) => (state.watchedOther || []).find((film) => film.id === id))
      .filter(Boolean)
      .sort(
        (left, right) =>
          chronologyFactor *
            (Number(left.year || 0) - Number(right.year || 0)) ||
          window.compareEnglishTitles(left.title, right.title),
      );
    let unseenFilms = (person.catalogIds || [])
      .map((id) => window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID?.[id])
      .filter(Boolean)
      .sort(
        (left, right) =>
          chronologyFactor *
            (Number(left.year || 0) - Number(right.year || 0)) ||
          window.compareEnglishTitles(left.title, right.title),
      );
    let ratingStatistics =
      person.ratingStatistics ||
      window.collectionRatingStatistics(unsortedFilms);
    let directorRankedFilms = window.rankByAllTimeRank(unsortedFilms);
    directorPosition = new Map(
      directorRankedFilms.map((film, index) => [film.id, index + 1]),
    );
    localRankFilms = directorRankedFilms.concat(
      [...otherWatched].sort(
        (left, right) =>
          Number(left.year || 0) - Number(right.year || 0) ||
          window.compareEnglishTitles(left.title, right.title),
      ),
    );
    localRankEditMode =
      isDirector &&
      sections !== "combined" &&
      filmographySort === "local-rank" &&
      window.pageQueryParam("edit") === "local-rank";
    films =
      filmographySort === "shuffle"
        ? [...unsortedFilms].sort((left, right) =>
            window.compareBySeededShuffle(left.id, right.id, filmographySeed),
          )
        : filmographySort === "director-rank"
          ? [...directorRankedFilms].sort(
              (left, right) =>
                chronologyFactor *
                (directorPosition.get(left.id) -
                  directorPosition.get(right.id)),
            )
          : filmographySort === "local-rank"
            ? [...localRankFilms].sort(
                (left, right) =>
                  chronologyFactor *
                  ((localRankMap.get(left.supabaseFilmId) ?? Infinity) -
                    (localRankMap.get(right.supabaseFilmId) ?? Infinity)),
              )
            : [...unsortedFilms].sort(
                (left, right) =>
                  chronologyFactor *
                    (Number(left.year || 0) - Number(right.year || 0)) ||
                  window.compareEnglishTitles(left.title, right.title),
              );

    function filmCredit(film) {
      if ((person.watchedOtherIds || []).includes(film.id))
        return {
          professions: [ui("Director")],
          detailHtml: personPageEscape(film.type || ui("Other")),
        };
      let credits = person.credits.filter(
        (credit) => credit.filmId === film.id,
      );
      let professions = [
        ...new Set(credits.map((credit) => credit.profession).filter(Boolean)),
      ];
      let details = [
        ...new Map(
          credits
            .filter((credit) => credit.detail)
            .map((credit) => [credit.detail, credit]),
        ).values(),
      ];
      let detailHtml = details
        .map((credit) =>
          credit.subjectId
            ? `<a class="detail-subject-link" href="${personPageEscape(window.subjectPageUrl(credit.subjectId))}">${personPageEscape(credit.detail)}</a>`
            : personPageEscape(credit.detail),
        )
        .join(" · ");
      return { professions, detailHtml };
    }

    function personFilmPosition(film) {
      return filmographySort === "director-rank"
        ? directorPosition.get(film.id)
        : localRankMap.get(film.supabaseFilmId) || "—";
    }

    function personFilmRow(film, index = 0) {
      let credit = filmCredit(film);
      let attributes = window.renderOrderEditItemAttributes(
        {
          enabled: localRankEditMode,
          scope: "local-rank",
          id: film.supabaseFilmId,
          index,
          group: person.id,
        },
        personPageEscape,
      );
      return `<tr${attributes}>
      ${filmographySort === "director-rank" ? `<td class="leaderboard-position">${personPageEscape(directorPosition.get(film.id))}</td>` : ""}
      ${filmographySort === "local-rank" ? `<td class="leaderboard-position">${personPageEscape(localRankMap.get(film.supabaseFilmId) || "—")}</td>` : ""}
      <td><a class="period-link" href="${personPageEscape(window.periodPageUrl("year", film.year))}">${personPageEscape(film.year || "")}</a></td>
      ${window.renderFilmIdentityCell(film, {
        escape: personPageEscape,
        allTimeRank: true,
      })}
      <td class="film-people-cell">${personPageEscape(credit.professions.join(", "))}${credit.detailHtml ? `<span class="leaderboard-meta">${credit.detailHtml}</span>` : ""}</td>
      ${window.renderRatingTierCell({ film }, { escape: personPageEscape })}
    </tr>`;
    }

    function personFilmCard(film, index = 0) {
      let credit = filmCredit(film);
      return window.renderSharedFilmCard(film, {
        classes: [
          "person-film-card",
          localRankEditMode ? "watchlist-order-card" : "",
        ],
        attributes: window.orderEditItemAttributes({
          enabled: localRankEditMode,
          scope: "local-rank",
          id: film.supabaseFilmId,
          index,
          group: person.id,
        }),
        rankLabel:
          filmographySort === "director-rank"
            ? `${directorPosition.get(film.id)}.`
            : filmographySort === "local-rank"
              ? `${localRankMap.get(film.supabaseFilmId) || "—"}.`
              : null,
        showYear: true,
        escape: personPageEscape,
        bodyHtml: `<div class="person-film-credit">${personPageEscape(credit.professions.join(", "))}${credit.detailHtml ? `<span>${credit.detailHtml}</span>` : ""}</div>`,
      });
    }

    function personOtherWatchedRow(film) {
      return `<tr>
      <td><a class="period-link" href="${personPageEscape(`${window.periodPageUrl("year", film.year)}&view=other`)}">${personPageEscape(film.year || "")}</a></td>
      ${window.renderFilmIdentityCell(film, { escape: personPageEscape })}
      <td class="film-people-cell">${personPageEscape(film.type || ui("Other"))}</td>
      ${window.renderRatingTierCell({ film }, { escape: personPageEscape })}
    </tr>`;
    }

    function personOtherWatchedCard(film) {
      return window.renderSharedFilmCard(film, {
        classes: ["person-film-card", "other-watched-card"],
        showYear: true,
        escape: personPageEscape,
        bodyHtml: `<div class="person-film-credit">${personPageEscape(film.type || ui("Other"))}</div>`,
      });
    }

    // Unseen (issue #453): a catalog film credited to this director that
    // the viewer hasn't watched, other-watched, or watchlisted - no
    // rating/type cell, since there's no personal record to show one from.
    function personUnseenRow(film) {
      return `<tr>
      <td><a class="period-link" href="${personPageEscape(`${window.periodPageUrl("year", film.year)}&view=shared`)}">${personPageEscape(film.year || "")}</a></td>
      ${window.renderFilmIdentityCell(film, { escape: personPageEscape })}
    </tr>`;
    }

    function personUnseenCard(film) {
      return window.renderSharedFilmCard(film, {
        classes: ["person-film-card", "unseen-card"],
        showYear: true,
        rating: false,
        escape: personPageEscape,
      });
    }

    function personWatchlistCard(item, index = 0) {
      let film = window.watchlistFilmLike(item);
      return window.renderSharedFilmCard(film, {
        classes: [
          "person-film-card",
          "watchlist-card",
          watchlistOrderEditMode ? "watchlist-order-card" : "",
        ],
        attributes: window.orderEditItemAttributes({
          enabled: watchlistOrderEditMode,
          scope: "watchlist",
          id: item.id,
          index,
          group: window.normalizeWatchlistTier(item.tier),
        }),
        openFilm: false,
        showYear: true,
        escape: personPageEscape,
        beforeTitleHtml: item.tier
          ? `<span class="watchlist-tier tier-${personPageEscape(item.tier.toLowerCase())}">${personPageEscape(item.tier)}</span>`
          : "",
        titleHtml: `<a class="table-film-link" href="${personPageEscape(window.filmPageUrl(item.supabaseFilmId))}">${personPageEscape(item.title)}</a>`,
        bodyHtml:
          '<div class="watchlist-card-actions"><span>Watchlist</span></div>',
      });
    }

    function personWatchlistRow(item, index = 0) {
      let film = window.watchlistFilmLike(item);
      let attributes = window.renderOrderEditItemAttributes(
        {
          enabled: watchlistOrderEditMode,
          scope: "watchlist",
          id: item.id,
          index,
          group: window.normalizeWatchlistTier(item.tier),
        },
        personPageEscape,
      );
      return `<tr${attributes}>
      ${filmographySort === "director-rank" ? '<td class="leaderboard-position">—</td>' : ""}
      <td><a class="period-link" href="${personPageEscape(window.periodPageUrl("year", item.year))}">${personPageEscape(item.year || "")}</a></td>
      ${window.renderFilmIdentityCell(film, {
        escape: personPageEscape,
        href: window.filmPageUrl(item.supabaseFilmId),
      })}
      <td class="film-people-cell">${personPageEscape(ui("Watchlist"))}</td>
      ${window.renderRatingTierCell({ item }, { escape: personPageEscape })}
    </tr>`;
    }

    function refreshPersonWatchlistItems() {
      watchlistItems = isDirector
        ? window.watchlistItemsByDirector(person.name)
        : [];
      if (watchlistOrderEditMode)
        watchlistItems = [...watchlistItems].sort(window.compareWatchlistItems);
    }
    refreshPersonWatchlistItems();
    combinedView = sections === "combined";

    function personCombinedCompare(left, right) {
      if (filmographySort === "shuffle")
        return window.compareBySeededShuffle(
          (left.film || left.item).id,
          (right.film || right.item).id,
          filmographySeed,
        );
      if (filmographySort === "director-rank") {
        if (left.film && right.film)
          return (
            chronologyFactor *
            (directorPosition.get(left.film.id) -
              directorPosition.get(right.film.id))
          );
        if (left.film) return -1;
        if (right.film) return 1;
        return (
          (window.watchlistTierRank?.(left.item.tier) ?? 999) -
            (window.watchlistTierRank?.(right.item.tier) ?? 999) ||
          chronologyFactor *
            (Number(left.item.year || 0) - Number(right.item.year || 0)) ||
          window.compareEnglishTitles(left.item.title, right.item.title)
        );
      }
      let leftRecord = left.film || left.item;
      let rightRecord = right.film || right.item;
      return (
        chronologyFactor *
          (Number(leftRecord.year || 0) - Number(rightRecord.year || 0)) ||
        window.compareEnglishTitles(leftRecord.title, rightRecord.title)
      );
    }

    let combinedRecords = combinedView
      ? [
          ...films.map((film) => ({ film })),
          ...watchlistItems.map((item) => ({ item })),
        ].sort(personCombinedCompare)
      : [];
    let combinedRows = combinedRecords
      .map((record) =>
        record.film
          ? personFilmRow(record.film)
          : personWatchlistRow(record.item),
      )
      .join("");
    let combinedCards = combinedRecords
      .map((record) =>
        record.film
          ? personFilmCard(record.film)
          : personWatchlistCard(record.item),
      )
      .join("");

    let awards = person.credits
      .filter((credit) => credit.source === "award")
      .sort(
        (left, right) =>
          chronologyFactor *
            String(left.period || "").localeCompare(
              String(right.period || ""),
              undefined,
              { numeric: true },
            ) || window.compareEnglishTitles(left.filmTitle, right.filmTitle),
      );
    let officialOscarRecord = window.officialPersonOscarRecord(person);

    function personalCreditForOfficial(officialCredit) {
      if (!officialCredit.filmId) return null;
      return (
        awards.find(
          (credit) =>
            credit.filmId === officialCredit.filmId &&
            credit.category === officialCredit.category &&
            String(credit.period || "") === officialCredit.periodKey,
        ) || null
      );
    }

    function renderOfficialOscarRows() {
      return [...officialOscarRecord.credits]
        .sort(
          (left, right) =>
            chronologyFactor *
              left.periodKey.localeCompare(right.periodKey, undefined, {
                numeric: true,
              }) ||
            categorySortIndex(left.category) -
              categorySortIndex(right.category) ||
            Number(right.winner) - Number(left.winner) ||
            window.compareEnglishTitles(left.filmTitle, right.filmTitle),
        )
        .map((credit) => {
          let personalCredit = personalCreditForOfficial(credit);
          let result = credit.winner ? ui("Winner") : ui("Nominee");
          let filmHtml = credit.filmId
            ? `<a class="table-film-link" href="${personPageEscape(window.filmPageUrl(credit.filmId))}"><strong>${personPageEscape(credit.filmTitle)}</strong></a>`
            : `<strong>${personPageEscape(credit.filmTitle)}</strong>`;
          let creditContext = [credit.recipient, credit.detail]
            .filter(Boolean)
            .map(personPageEscape)
            .join(' <span aria-hidden="true">·</span> ');
          let overlapHtml = personalCredit
            ? `<span class="person-official-overlap is-${Number(personalCredit.placement) === 1 ? "winner" : "nominee"}">${personPageEscape(ui(Number(personalCredit.placement) === 1 ? "Your Oskars winner" : "Your Oskars nominee"))}</span>`
            : "—";
          return `<tr>
      <td><span class="person-official-result${credit.winner ? " is-winner" : ""}">${credit.winner ? '<span aria-hidden="true">🏆</span> ' : ""}${personPageEscape(result)}</span></td>
      <td><a class="period-link" href="${personPageEscape(`${window.periodPageUrl("year", credit.periodKey)}&view=official`)}">${personPageEscape(credit.periodKey)}</a></td>
      <td><a class="category-link" href="${personPageEscape(window.categoryPageUrl(credit.category))}">${personPageEscape(credit.category)}</a></td>
      <td>${filmHtml}</td>
      <td class="person-official-credit">${creditContext || "—"}</td>
      <td>${overlapHtml}</td>
    </tr>`;
        })
        .join("");
    }

    function renderOfficialOscarSection() {
      if (!officialOscarRecord.nominations) return "";
      let table = window.renderLeaderboardTable({
        headers: [
          ui("Result"),
          ui("Year"),
          ui("Category"),
          ui("Film"),
          ui("Credit"),
          "Oskars",
        ].map(personPageEscape),
        rows: renderOfficialOscarRows(),
        classes: "person-official-table",
        wrapClasses: "person-official-table-wrap",
      });
      return `<section class="person-official-awards" aria-labelledby="person-real-oscars"><div class="person-official-heading"><h2 id="person-real-oscars">${personPageEscape(ui("Real Oscars"))}</h2><span>${personPageEscape(ui("Matched from imported Academy Awards results."))}</span></div>${window.renderDetailStats({ itemsHtml: `<span><b>${officialOscarRecord.wins}</b> ${personPageEscape(ui(officialOscarRecord.wins === 1 ? "Win" : "Wins"))}</span><span><b>${officialOscarRecord.nominations}</b> ${personPageEscape(ui(officialOscarRecord.nominations === 1 ? "Nomination" : "Nominations"))}</span>` })}${table}</section>`;
    }

    function renderPersonAwardRows(periodAwards) {
      return periodAwards
        .map(
          (credit) => `<tr>
      <td class="detail-place">${personPagePlacement(credit.placement)}</td>
      <td><a class="category-link" href="${personPageEscape(window.categoryPageUrl(credit.category))}">${personPageEscape(credit.category)}</a>${credit.detail ? `<span class="leaderboard-meta">${credit.subjectId ? `<a class="detail-subject-link" href="${personPageEscape(window.subjectPageUrl(credit.subjectId))}">${personPageEscape(credit.detail)}</a>` : personPageEscape(credit.detail)}</span>` : ""}</td>
      <td><a class="table-film-link" href="${personPageEscape(window.filmPageUrl(credit.filmId))}"><strong>${personPageEscape(credit.filmTitle)}</strong></a><span class="leaderboard-meta">${personPageEscape(credit.filmYear || "")}</span></td>
    </tr>`,
        )
        .join("");
    }

    function renderPersonAwardGroups() {
      let typeOrder = { years: 0, decades: 1, centuries: 2, allTime: 3 };
      let groups = new Map();
      awards.forEach((credit) => {
        let period = String(credit.period || "");
        if (!groups.has(period)) groups.set(period, []);
        groups.get(period).push(credit);
      });
      return [...groups.entries()]
        .sort((left, right) => {
          let leftType = window.getAwardPeriodType({ year: left[0] });
          let rightType = window.getAwardPeriodType({ year: right[0] });
          return (
            (typeOrder[leftType] ?? 9) - (typeOrder[rightType] ?? 9) ||
            chronologyFactor *
              (personPagePeriodOrder(left[0]) - personPagePeriodOrder(right[0]))
          );
        })
        .map(([period, periodAwards]) => {
          let type = window.getAwardPeriodType({ year: period });
          let label =
            type === "allTime" || period === "alltime"
              ? ui("All-time")
              : period;
          periodAwards.sort(
            (left, right) =>
              categorySortIndex(left.category) -
                categorySortIndex(right.category) ||
              Number(left.placement) - Number(right.placement) ||
              window.compareEnglishTitles(left.filmTitle, right.filmTitle),
          );
          let table = window.renderLeaderboardTable({
            headers: [ui("Place"), ui("Category"), ui("Film")].map(
              personPageEscape,
            ),
            rows: renderPersonAwardRows(periodAwards),
            classes: "detail-awards",
          });
          return `<section class="film-award-period person-award-period"><h3><a class="period-link" href="${personPageEscape(window.periodPageUrl(type, period))}">${personPageEscape(label)}</a></h3>${table}</section>`;
        })
        .join("");
    }

    function renderPersonProgression() {
      let typeColumns = ["years", "decades", "centuries", "allTime"];
      let chains = new Map();
      awards.forEach((credit) => {
        let key = `${credit.filmId}\n${credit.category}`;
        if (!chains.has(key)) chains.set(key, new Map());
        let type = window.getAwardPeriodType({ year: credit.period });
        if (!chains.get(key).has(type)) chains.get(key).set(type, credit);
      });
      let annualCredits = awards
        .filter((credit) => /^\d{4}$/.test(String(credit.period || "")))
        .filter(
          (credit, index, list) =>
            list.findIndex(
              (candidate) =>
                candidate.filmId === credit.filmId &&
                candidate.category === credit.category,
            ) === index,
        )
        .sort((left, right) => {
          let leftYear = Number(left.period);
          let rightYear = Number(right.period);
          return (
            chronologyFactor *
              (Number(window.getCenturyKey(leftYear).replace(/\D/g, "")) -
                Number(window.getCenturyKey(rightYear).replace(/\D/g, ""))) ||
            chronologyFactor *
              (Number(window.getDecadeKey(leftYear).replace(/\D/g, "")) -
                Number(window.getDecadeKey(rightYear).replace(/\D/g, ""))) ||
            chronologyFactor * (leftYear - rightYear) ||
            window.compareEnglishTitles(left.filmTitle, right.filmTitle) ||
            categorySortIndex(left.category) - categorySortIndex(right.category)
          );
        });
      let hierarchy = annualCredits.map((credit) => {
        let year = String(credit.period);
        return {
          year,
          decade: window.getDecadeKey(year),
          century: window.getCenturyKey(year),
          filmId: credit.filmId,
        };
      });
      function spanFrom(index, key) {
        let value = key(hierarchy[index]);
        let span = 1;
        while (
          index + span < hierarchy.length &&
          key(hierarchy[index + span]) === value
        )
          span += 1;
        return span;
      }
      function periodCell(index, level, type, key) {
        let identity =
          level === "century"
            ? key.century
            : level === "decade"
              ? `${key.century}\n${key.decade}`
              : `${key.century}\n${key.decade}\n${key.year}`;
        let previous = index
          ? level === "century"
            ? hierarchy[index - 1].century
            : level === "decade"
              ? `${hierarchy[index - 1].century}\n${hierarchy[index - 1].decade}`
              : `${hierarchy[index - 1].century}\n${hierarchy[index - 1].decade}\n${hierarchy[index - 1].year}`
          : "";
        if (identity === previous) return "";
        let label = key[level];
        let span = spanFrom(index, (item) =>
          level === "century"
            ? item.century
            : level === "decade"
              ? `${item.century}\n${item.decade}`
              : `${item.century}\n${item.decade}\n${item.year}`,
        );
        return `<td class="person-progression-period ${level}" rowspan="${span}"><a class="period-link" href="${personPageEscape(window.periodPageUrl(type, label))}">${personPageEscape(label)}</a></td>`;
      }
      function filmCell(index, credit) {
        let key = hierarchy[index];
        let identity = `${key.century}\n${key.decade}\n${key.year}\n${key.filmId}`;
        let previous = index
          ? `${hierarchy[index - 1].century}\n${hierarchy[index - 1].decade}\n${hierarchy[index - 1].year}\n${hierarchy[index - 1].filmId}`
          : "";
        if (identity === previous) return "";
        let span = spanFrom(
          index,
          (item) =>
            `${item.century}\n${item.decade}\n${item.year}\n${item.filmId}`,
        );
        return `<th class="person-progression-film" rowspan="${span}"><a class="table-film-link" href="${personPageEscape(window.filmPageUrl(credit.filmId))}">${personPageEscape(credit.filmTitle)}</a></th>`;
      }
      let rows = "";
      annualCredits.forEach((credit, index) => {
        let periodCells =
          periodCell(index, "century", "century", hierarchy[index]) +
          periodCell(index, "decade", "decade", hierarchy[index]) +
          periodCell(index, "year", "year", hierarchy[index]);
        let groupedFilm = filmCell(index, credit);
        let chain =
          chains.get(`${credit.filmId}\n${credit.category}`) || new Map();
        let detail = credit.detail
          ? credit.subjectId
            ? `<a class="detail-subject-link" href="${personPageEscape(window.subjectPageUrl(credit.subjectId))}">${personPageEscape(credit.detail)}</a>`
            : personPageEscape(credit.detail)
          : "";
        let placements = typeColumns
          .map((type) => {
            let placementCredit = chain.get(type);
            return window.renderProgressionPlacementCell(placementCredit, {
              type,
              period: placementCredit?.period,
              placement: personPagePlacement,
              escape: personPageEscape,
            });
          })
          .join("");
        rows += `<tr class="person-progression-credit">${periodCells}${groupedFilm}<td class="person-progression-credit-cell"><a class="category-link" href="${personPageEscape(window.categoryPageUrl(credit.category))}">${personPageEscape(credit.category)}</a>${detail ? ` <span class="credit-context">(${detail})</span>` : ""}</td>${placements}</tr>`;
      });
      return window.renderProgressionTable({
        headers: [
          ui("Century"),
          ui("Decade"),
          ui("Year"),
          ui("Film"),
          ui("Credit"),
          ui("Year"),
          ui("Decade"),
          ui("Century"),
          ui("All-time"),
        ],
        bandHeaders: [
          { label: ui("Nomination"), span: 5 },
          { label: ui("Placement"), span: 4 },
        ],
        bandClass: "person-progression-bands",
        classes: ["person-award-progression"],
        wrapClass: "person-progression-wrap",
        rows,
        emptyText: ui("No annual nominations to trace."),
      });
    }

    let aliases = person.aliases.filter((alias) => alias !== person.name);
    let directorProgress =
      isDirector && watchlistItems.length
        ? window.directorCompletion?.(person)
        : null;
    let stats = person.stats || {};
    let awardScores =
      person.awardScores ||
      window.calculateAwardsScores(
        person.credits.filter((credit) => credit.source === "award"),
      );
    let professionText = person.professions
      .map((profession) => ui(profession))
      .join(" · ");
    let personMetadataHtml = [
      metadataRow(ui("Professions"), professionText),
      metadataRow(
        ui("Filmography"),
        `${person.filmIds.length + otherWatched.length} ${ui("works")}`,
        "#person-filmography",
      ),
      watchlistItems.length
        ? metadataRow(
            ui("Watchlist"),
            `${watchlistItems.length} ${ui("to watch")}`,
            combinedView ? "#person-filmography" : "#person-watchlist",
          )
        : "",
      directorProgress
        ? metadataRow(
            ui("Completion"),
            `${directorProgress.percent}% · ${directorProgress.watchedCount}/${directorProgress.total} ${ui("known films")}`,
            combinedView ? "#person-filmography" : "#person-watchlist",
          )
        : "",
      metadataRow(ui("Wins"), stats.wins || 0, "#person-awards"),
      metadataRow(ui("Nominations"), stats.nominations || 0, "#person-awards"),
    ].join("");
    let personStatsHtml = `<div class="detail-stat-grid"><div class="detail-stat-head"><b></b><span>${personPageEscape(ui("All-time"))}</span><span>${personPageEscape(ui("Century"))}</span><span>${personPageEscape(ui("Decade"))}</span><span>${personPageEscape(ui("Year"))}</span></div><div class="detail-stat-row"><b>${personPageEscape(ui("Score"))}</b><span><b>${awardScores.allTime}</b></span><span><b>${awardScores.century}</b></span><span><b>${awardScores.decade}</b></span><span><b>${awardScores.year}</b></span></div></div><div class="detail-stat-summary"><span><b>${person.filmIds.length}</b> ${personPageEscape(ui("Films"))}</span>${otherWatched.length ? `<span><b>${otherWatched.length}</b> ${personPageEscape(ui("Other watched"))}</span>` : ""}<span><b>${stats.wins || 0}</b> ${personPageEscape(ui("Wins"))}</span><span><b>${stats.nominations || 0}</b> ${personPageEscape(ui("Nominations"))}</span>${window.renderRatingStatisticsItems(ratingStatistics, { escape: personPageEscape, ui })}</div>${officialOscarRecord.nominations ? `<div class="detail-stat-summary person-official-summary"><span><b>${personPageEscape(ui("Real Oscars"))}</b></span><span><b>${officialOscarRecord.wins}</b> ${personPageEscape(ui(officialOscarRecord.wins === 1 ? "Win" : "Wins"))}</span><span><b>${officialOscarRecord.nominations}</b> ${personPageEscape(ui(officialOscarRecord.nominations === 1 ? "Nomination" : "Nominations"))}</span></div>` : ""}`;
    let reverseLabel =
      filmographySort === "director-rank"
        ? chronologyOrder === "asc"
          ? ui("Last ranked first")
          : ui("First ranked first")
        : chronologyOrder === "asc"
          ? ui("Newest first")
          : ui("Oldest first");
    let personReverseTargetSort =
      filmographySort === "shuffle" ? "chronological" : filmographySort;
    let personSortAxisControl = isDirector
      ? window.renderSortAxisControl({
          escape: personPageEscape,
          value: filmographySort === "shuffle" ? "" : filmographySort,
          attribute: "data-person-filmography-sort",
          axes: [
            { value: "chronological", label: "Chronological" },
            { value: "director-rank", label: "Director ranking" },
            ...(combinedView
              ? []
              : [{ value: "local-rank", label: "Local rank" }]),
          ],
        })
      : "";
    let personSortNote = isDirector
      ? `<small class="person-filmography-sort-note">${personPageEscape(ui("Derived from each film’s all-time rank."))}</small>`
      : "";

    function personFilmographyFilmsHtml() {
      let filmRows = films
        .map((film, index) => personFilmRow(film, index))
        .join("");
      let filmCards = films
        .map((film, index) => personFilmCard(film, index))
        .join("");
      let localRankControls =
        filmographySort === "local-rank" && films.length > 1
          ? `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-person-local-rank-edit-toggle${busy ? " disabled" : ""}>${personPageEscape(ui(localRankEditMode ? "Finish order" : "Reorder"))}</button>${localRankEditMode ? `<span>${personPageEscape(ui("Drag to set this collection's independent local order."))}</span>` : `<a class="sort-order-button" href="${personPageEscape(window.localRankMergePageUrl("people", person.id, personViewUrl()))}">${personPageEscape(ui("Merge-sort tool"))}</a>`}</div>`
          : "";
      return `${localRankControls}<div data-person-filmography="list" ${filmographyView === "list" ? "" : "hidden"}><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr>${filmographySort === "director-rank" ? `<th>${personPageEscape(ui("Rank"))}</th>` : ""}${filmographySort === "local-rank" ? `<th>${personPageEscape(ui("Rank"))}</th>` : ""}<th>${personPageEscape(ui("Year"))}</th><th>${personPageEscape(ui("Film"))}</th><th>${personPageEscape(ui("Credit"))}</th><th>${combinedView ? `${personPageEscape(ui("Rating"))} / ${personPageEscape(ui("Tier"))}` : personPageEscape(ui("Rating"))}</th></tr></thead><tbody>${combinedView ? combinedRows : filmRows}</tbody></table></div></div><div data-person-filmography="grid" ${filmographyView === "grid" ? "" : "hidden"}><div class="film-grid person-film-grid">${(combinedView ? combinedCards : filmCards) || `<p>${personPageEscape(ui("No films"))}</p>`}</div></div>`;
    }
    function renderPersonFilmographyFilms() {
      let section = container.querySelector("[data-person-filmography-films]");
      if (!section) return false;
      section.innerHTML = personFilmographyFilmsHtml();
      return true;
    }
    function personWatchlistContentHtml() {
      let finishWatchlistRender =
        window.startOskarsPerformance?.("person:watchlist");
      refreshPersonWatchlistItems();
      let rows = watchlistItems
        .map((item, index) => personWatchlistRow(item, index))
        .join("");
      let cards = watchlistItems
        .map((item, index) => personWatchlistCard(item, index))
        .join("");
      let orderControls = `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-person-watchlist-order-edit-toggle${busy ? " disabled" : ""}>${personPageEscape(ui(watchlistOrderEditMode ? "Finish order" : "Reorder"))}</button>${watchlistOrderEditMode ? `<span>${personPageEscape(ui("Edits global watchlist order inside the same interest tier only."))}</span>` : ""}</div>`;
      let bulkTierControls = `<div class="period-edit-controls">${window.renderSupabaseWatchlistBulkTierControl({ count: watchlistItems.length, busy, escape: personPageEscape })}</div>`;
      let html = `<h3 id="person-watchlist" class="person-filmography-subheading">${personPageEscape(ui("Watchlist"))}</h3>${window.renderDetailStats({ itemsHtml: `<span><b>${watchlistItems.length}</b> ${personPageEscape(ui("Unwatched"))}</span>${directorProgress ? `<span><b>${directorProgress.percent}%</b> ${personPageEscape(ui("Complete (known films)"))}</span>` : ""}` })}${directorProgress ? `<div class="project-progress-meter project-progress-meter--detail" aria-label="${personPageEscape(ui("{percent} percent complete", { percent: directorProgress.percent }))}"><span style="width:${personPageEscape(directorProgress.percent)}%"></span></div>` : ""}${bulkTierControls}${orderControls}<div data-person-watchlist="list" ${filmographyView === "list" ? "" : "hidden"}><div class="leaderboard-wrap"><table class="leaderboard"><thead><tr>${filmographySort === "director-rank" ? `<th>${personPageEscape(ui("Rank"))}</th>` : ""}<th>${personPageEscape(ui("Year"))}</th><th>${personPageEscape(ui("Film"))}</th><th>${personPageEscape(ui("Credit"))}</th><th>${personPageEscape(ui("Tier"))}</th></tr></thead><tbody>${rows}</tbody></table></div></div><div data-person-watchlist="grid" ${filmographyView === "grid" ? "" : "hidden"}><div class="film-grid person-film-grid">${cards}</div></div>`;
      finishWatchlistRender?.(
        `${watchlistItems.length} items, ${filmographyView}, ${watchlistOrderEditMode ? "editing" : "read-only"}`,
      );
      return html;
    }

    function renderPersonWatchlistSection() {
      let section = container.querySelector("[data-person-watchlist-section]");
      if (!section) return false;
      section.innerHTML = personWatchlistContentHtml();
      return true;
    }

    container.innerHTML = `${window.renderDetailHeader({
      mainClasses: "detail-header-main person-detail-main",
      mainHtml: `<h1>${personPageEscape(person.name)}</h1><p>${personPageEscape(professionText)}</p>${aliases.length ? `<span class="leaderboard-meta">${personPageEscape(aliases.join(", "))}</span>` : ""}
      ${personMetadataHtml ? `<dl class="film-metadata">${personMetadataHtml}</dl>` : ""}
      ${personStatsHtml}
      ${window.renderSupabaseEntityNote({ entityKind: "person", entityKey: person.id, note: noteState.note, editing: noteState.editing, busy: noteState.busy, label: ui("Person note"), escape: personPageEscape })}`,
    })}
  ${isDirector ? window.renderCollectionViewController({ view: collectionPageView, overviewUrl: window.personPageUrl(person.id), awardsUrl: `${window.personPageUrl(person.id)}&collection-view=awards`, escape: personPageEscape, ui }) : ""}
  <div data-collection-page-view="films" ${collectionPageView === "films" ? "" : "hidden"}>
  <h2 id="person-filmography">${personPageEscape(ui("Filmography"))}</h2>
  <div class="person-filmography-toolbar collection-film-toolbar detail-toolbar"><div class="detail-toolbar-controls">${personSortAxisControl}${window.renderChronologyControl({ order: chronologyOrder, href: personViewUrl(chronologyOrder === "asc" ? "desc" : "asc", personReverseTargetSort), ascLabel: reverseLabel, descLabel: reverseLabel, title: ui("Reverse current order"), escape: personPageEscape, iconOnly: true })}${window.renderShuffleControl({ href: personViewUrl(chronologyOrder, "shuffle", filmographyView, window.freshShuffleSeed()), escape: personPageEscape, label: ui("Shuffle") })}${watchlistItems.length ? window.renderCombinedSectionsControl({ combined: combinedView, href: personViewUrl(chronologyOrder, filmographySort, filmographyView, filmographySeed, combinedView ? "split" : "combined"), escape: personPageEscape }) : ""}${personSortNote}</div>${window.renderFilmViewToggle(
    {
      view: filmographyView,
      listUrl: personViewUrl(chronologyOrder, filmographySort, "list"),
      gridUrl: personViewUrl(chronologyOrder, filmographySort, "grid"),
      escape: personPageEscape,
      classes: "person-filmography-view-toggle",
      ariaLabel: ui("Filmography display"),
    },
  )}</div>
  ${!combinedView ? `<h3 id="person-watched" class="person-filmography-subheading">${personPageEscape(ui("Watched"))}</h3>` : ""}
  <section data-person-filmography-films>${personFilmographyFilmsHtml()}</section>
  ${otherWatched.length && filmographySort !== "local-rank" ? `<section class="person-other-watched"><h3 class="person-filmography-subheading">${personPageEscape(ui("Other watched"))}</h3><div data-person-other-watched="list" ${filmographyView === "list" ? "" : "hidden"}>${window.renderLeaderboardTable({ headers: [ui("Year"), ui("Title"), ui("Type"), ui("Rating")].map(personPageEscape), rows: otherWatched.map(personOtherWatchedRow).join("") })}</div><div data-person-other-watched="grid" ${filmographyView === "grid" ? "" : "hidden"}><div class="film-grid person-film-grid">${otherWatched.map(personOtherWatchedCard).join("")}</div></div></section>` : ""}
  ${unseenFilms.length ? `<section class="person-unseen"><h3 class="person-filmography-subheading">${personPageEscape(ui("Unseen"))}</h3><div data-person-unseen="list" ${filmographyView === "list" ? "" : "hidden"}>${window.renderLeaderboardTable({ headers: [ui("Year"), ui("Title")].map(personPageEscape), rows: unseenFilms.map(personUnseenRow).join("") })}</div><div data-person-unseen="grid" ${filmographyView === "grid" ? "" : "hidden"}><div class="film-grid person-film-grid">${unseenFilms.map(personUnseenCard).join("")}</div></div></section>` : ""}
  ${!combinedView && watchlistItems.length ? `<section data-person-watchlist-section>${personWatchlistContentHtml()}</section>` : ""}
  <h2 id="person-awards">${personPageEscape(ui("Awards"))}</h2>
  <fieldset class="person-awards-view-controls"><legend>${personPageEscape(ui("Display"))}</legend><label><input type="radio" name="personAwardsView" value="periods" ${personAwardsView === "periods" ? "checked" : ""}> ${personPageEscape(ui("Period tables"))}</label><label><input type="radio" name="personAwardsView" value="progression" ${personAwardsView === "progression" ? "checked" : ""}> ${personPageEscape(ui("Progression table"))}</label></fieldset>
  <div data-person-awards="periods" ${personAwardsView === "periods" ? "" : "hidden"}><div class="film-award-period-grid person-award-period-grid">${renderPersonAwardGroups() || `<div class="detail-empty">${personPageEscape(ui("No nominations"))}</div>`}</div></div>
  <div data-person-awards="progression" ${personAwardsView === "progression" ? "" : "hidden"}>${renderPersonProgression()}</div>
  ${renderOfficialOscarSection()}</div>
  ${isDirector ? `<div data-collection-page-view="awards" ${collectionPageView === "awards" ? "" : "hidden"}>${window.renderCollectionAwardsView(collectionAwardModel, { escape: personPageEscape, ui })}</div>` : ""}`;
    window.enhanceCollapsibles?.(container);

    container
      .querySelector("[data-person-filmography-sort]")
      ?.addEventListener("change", (event) => {
        window.location.href = personViewUrl(
          chronologyOrder,
          event.target.value,
        );
      });
    container
      .querySelectorAll('input[name="personAwardsView"]')
      .forEach((input) => {
        input.addEventListener("change", () => {
          personAwardsView = input.value;
          container.querySelectorAll("[data-person-awards]").forEach((view) => {
            view.hidden = view.dataset.personAwards !== personAwardsView;
          });
          updatePersonViewUrl();
        });
      });
    container
      .querySelector("[data-person-watchlist-order-edit-toggle]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        watchlistOrderEditMode = !watchlistOrderEditMode;
        renderPersonWatchlistSection();
        updatePersonViewUrl();
      });
    container
      .querySelector("[data-person-local-rank-edit-toggle]")
      ?.addEventListener("click", (event) => {
        event.preventDefault();
        localRankEditMode = !localRankEditMode;
        renderPersonFilmographyFilms();
        updatePersonViewUrl();
      });
    window.createOrderEditController({
      container,
      scope: "watchlist",
      enabled: () => watchlistOrderEditMode,
      rejectedMessage: ui(
        "Watchlist ordering moves are limited to the same interest tier.",
      ),
      commit: async (from, target, position) => {
        let fromItem = watchlistItems.find((item) => item.id === from.id);
        let toItem = watchlistItems.find((item) => item.id === target.id);
        if (!fromItem || !toItem)
          return {
            ok: false,
            reason: "Both films must exist in the watchlist.",
          };
        let fromTier = window.normalizeWatchlistTier(fromItem.tier);
        let toTier = window.normalizeWatchlistTier(toItem.tier);
        if (fromTier !== toTier)
          return {
            ok: false,
            reason:
              "Watchlist ordering moves are limited to the same interest tier.",
          };
        let tierItems = watchlistItems
          .filter(
            (item) => window.normalizeWatchlistTier(item.tier) === fromTier,
          )
          .sort(
            (a, b) => Number(a.order || 999999) - Number(b.order || 999999),
          );
        let toIndex = tierItems.findIndex((item) => item.id === target.id);
        let beforeId =
          position === "after" ? target.id : tierItems[toIndex - 1]?.id || null;
        let afterId =
          position === "after" ? tierItems[toIndex + 1]?.id || null : target.id;
        await window.moveSupabaseWatchlistItemWithinTier(
          from.id,
          window.getSupabaseWorkspace()?.watchlist || [],
          beforeId,
          afterId,
        );
        return { ok: true };
      },
      rerender: reload,
    });
    window.createOrderEditController({
      container,
      scope: "local-rank",
      enabled: () => localRankEditMode,
      commit: async (from, target, position) => {
        let ok = await window.moveSupabaseLocalRankFilm(
          "person",
          person.id,
          localRankFilms.map((film) => film.supabaseFilmId),
          from.id,
          target.id,
          position,
        );
        return ok ? { ok: true } : { ok: false };
      },
      rerender: reload,
    });

    container.addEventListener("click", (event) => {
      let card = event.target.closest("[data-open-film-id]");
      if (card && !event.target.closest("a,button,input,label"))
        window.location.href = window.filmPageUrl(card.dataset.openFilmId);
    });
    container.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      let card = event.target.closest("[data-open-film-id]");
      if (!card || event.target.closest("a,button,input,label")) return;
      event.preventDefault();
      window.location.href = window.filmPageUrl(card.dataset.openFilmId);
    });

    finishRenderTimer?.(
      `${person.id}, ${films.length} film(s), ${watchlistItems.length} watchlist item(s), ${awards.length} award credit(s)`,
    );
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    window.bindSupabaseEntityNoteEditor({
      container,
      entityKind: "person",
      entityKey: personId,
      state: noteState,
      rerender: render,
    });
    window.bindSupabaseWatchlistBulkTierControl({
      container,
      entries: () => watchlistItems,
      onStart: () => {
        busy = true;
        render();
      },
      onError: (err) => {
        alert(err.message || String(err));
        busy = false;
        render();
      },
      rerender: reload,
    });
    try {
      let source = await window.loadSupabaseLegacyHydrationSource();
      Object.assign(
        window.state,
        window.buildLegacyStateFromSupabaseHydration(source),
      );
      // ensureOskarsData() normally does this (bootstrap.js) - needed here
      // too since person.html hydrates itself directly rather than going
      // through that shared path, and rebuildPeopleIndex()'s Unseen bucket
      // (issue #453, generalized in #467) reads OSKARS_SHARED_FILM_ARCHIVE,
      // built from this call.
      window.applySharedFilmArchive?.(
        window.buildSharedFilmArchiveFromSupabase(source.catalogFilms),
      );
      window.rebuildAggregates();
      await window.hydrateOfficialResultsFromSupabase();
      await window.loadSupabaseWorkspace();
      peopleById = window.ensurePeopleIndex();
      person = peopleById[personId] || null;
      if (person) {
        let requestedFilmographySort = window.pageQueryParam("sort");
        if (
          person.professions.includes("Director") &&
          requestedFilmographySort === "local-rank" &&
          sections !== "combined"
        ) {
          let directorRankedFilms = window.rankByAllTimeRank(
            person.filmIds.map((id) => state.filmsById[id]).filter(Boolean),
          );
          let otherOrdered = (person.watchedOtherIds || [])
            .map((id) =>
              (state.watchedOther || []).find((film) => film.id === id),
            )
            .filter(Boolean)
            .sort(
              (left, right) =>
                Number(left.year || 0) - Number(right.year || 0) ||
                window.compareEnglishTitles(left.title, right.title),
            );
          let implicitFilmIds = directorRankedFilms
            .concat(otherOrdered)
            .map((film) => film.supabaseFilmId);
          let stored = await window.loadSupabaseLocalRankOrder(
            "person",
            person.id,
          );
          let order = window.mergeSupabaseLocalRankOrder(
            stored,
            implicitFilmIds,
          );
          localRankMap = new Map(
            order.map((filmId, index) => [filmId, index + 1]),
          );
        }
        noteState.note = await window.loadSupabaseEntityNote(
          "person",
          person.id,
        );
      }
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${personPageEscape(ui("Could not load this person"))}</h2><p>${personPageEscape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
