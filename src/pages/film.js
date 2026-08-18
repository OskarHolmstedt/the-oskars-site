/** @file Controls film detail rendering, poster selection, ranks, awards, metadata, and editing. */

(function () {
  let filmPageEscape = window.pageEscape;
  let filmPagePlacement = window.pagePlacement;
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));

  function filmPagePeriodOrder(period) {
    if (period === "alltime") return 100000;
    return Number(String(period || "").replace(/[^0-9]/g, "")) || 0;
  }

  function selected(value, expected) {
    return value === expected ? "selected" : "";
  }

  function rewatchTierOptions(selectedTier) {
    let normalized = window.normalizeWatchlistTier?.(selectedTier) || "";
    return [
      `<option value=""${normalized ? "" : " selected"}>${filmPageEscape(ui("Unset"))}</option>`,
    ]
      .concat(
        (window.WATCHLIST_TIERS || []).map(
          (tier) =>
            `<option value="${filmPageEscape(tier)}"${normalized === tier ? " selected" : ""}>${filmPageEscape(tier)}</option>`,
        ),
      )
      .join("");
  }

  function metadataLabel(value) {
    let text = String(value || "").replace(/-/g, " ");
    return text ? ui(text[0].toUpperCase() + text.slice(1)) : "";
  }

  function formatRuntime(minutes) {
    let runtime = Number(minutes);
    if (!Number.isInteger(runtime) || runtime <= 0) return "";
    let hours = Math.floor(runtime / 60);
    let remainder = runtime % 60;
    return hours
      ? `${hours}h ${remainder ? `${remainder}m` : ""}`.trim()
      : `${runtime}m`;
  }

  function formatNumber(value) {
    let number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : "";
  }

  function formatWatchedDate(value) {
    let iso = window.parseWatchedDate?.(value) || "";
    if (!iso)
      return window.normalizeWatchedDate?.(value) ?? String(value || "").trim();
    let date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
  }

  window.load();
  // Film credits use the derived peopleByProfession groups. Most pages can keep
  // the people index lazy, but the film page explicitly needs it before render.
  window.ensurePeopleIndex?.();

  let filmId = window.pageQueryParam("id");
  let awardsView =
    window.pageQueryParam("awards") === "matrix" ? "matrix" : "periods";
  let container = document.getElementById("filmPage");
  let posterOptions = [];
  let posterOptionIndex = 0;
  let posterPickerStatus = "";

  function filmViewUrl() {
    let url = window.filmPageUrl(filmId);
    return awardsView === "matrix" ? `${url}&awards=matrix` : url;
  }

  function updateFilmViewUrl() {
    if (window.history?.replaceState)
      window.history.replaceState(null, "", filmViewUrl());
  }

  function currentFilm() {
    return window.findFilmById(filmId) || window.findWatchedFilmById?.(filmId);
  }

  function currentPosterOptionIndex(film) {
    let currentUrl = String(film?.poster?.url || "");
    let index = posterOptions.findIndex((poster) => poster.url === currentUrl);
    return index >= 0
      ? index
      : Math.max(0, Math.min(posterOptionIndex, posterOptions.length - 1));
  }

  function renderPosterArea(film) {
    let posterHtml = window.renderFilmPoster(film, "detail");
    if (!posterOptions.length && !posterPickerStatus) return posterHtml;
    posterOptionIndex = currentPosterOptionIndex(film);
    return window.renderPosterPicker({
      posterHtml,
      options: posterOptions,
      activeIndex: posterOptionIndex,
      status: posterPickerStatus,
      escape: filmPageEscape,
    });
  }

  function selectPosterOption(index) {
    if (!posterOptions.length) return;
    let film = currentFilm();
    posterOptionIndex = (index + posterOptions.length) % posterOptions.length;
    window.setFilmPoster(film.id, posterOptions[posterOptionIndex]);
    posterPickerStatus = "";
    render(false);
    container.querySelector("[data-film-poster-picker]")?.focus();
  }

  function sortedAwards(film) {
    return [...(film.awards || [])].sort(
      (left, right) =>
        filmPagePeriodOrder(left.year) - filmPagePeriodOrder(right.year) ||
        categorySortIndex(left.category) - categorySortIndex(right.category) ||
        Number(left.placement) - Number(right.placement),
    );
  }

  function officialPeriodMatchesFilm(periodKey, film) {
    let year = String(film?.year || "");
    return !!year && window.officialResultPeriodYears(periodKey).includes(year);
  }

  function officialFilmContext(film) {
    let source = window.state?.officialResults?.["academy-awards"];
    if (!source || !film?.id) return null;
    let periods = Object.entries(source.periods || {})
      .filter(([periodKey, period]) =>
        period?.nominations?.length
          ? officialPeriodMatchesFilm(periodKey, film)
          : false,
      )
      .map(([periodKey, period]) => ({ periodKey, period }));
    if (!periods.length) return null;
    let nominations = periods.flatMap(({ periodKey, period }) =>
      period.nominations
        .filter((nomination) => nomination.filmRef?.id === film.id)
        .map((nomination) => ({ ...nomination, periodKey })),
    );
    return { source, periods, nominations };
  }

  function awardCreditHtml(film, award) {
    return window.renderAwardCreditHtml({ film, award, escape: filmPageEscape })
      .html;
  }

  function officialCreditText(nominations) {
    return [
      ...new Set(
        nominations
          .flatMap((nomination) => [nomination.recipient, nomination.detail])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ].join(" · ");
  }

  function renderOfficialComparison(award, nominations) {
    let officialWinner = nominations.some((nomination) => nomination.winner);
    let hasOfficialNomination = nominations.length > 0;
    let personalWinner = Number(award?.placement) === 1;
    let agrees =
      !!award &&
      hasOfficialNomination &&
      personalWinner === officialWinner;
    let label = officialWinner
      ? ui("Official winner")
      : hasOfficialNomination
        ? ui("Official nominee")
        : ui("Not nominated");
    let comparisonLabel = agrees
      ? ui("Matches your Oskars result")
      : ui("Differs from your Oskars result");
    let credit = officialCreditText(nominations);
    return `<td class="film-official-comparison ${agrees ? "is-agreement" : "is-disagreement"}" title="${filmPageEscape(comparisonLabel)}"><span class="film-official-status"><span aria-hidden="true">${agrees ? "✓" : "≠"}</span> ${filmPageEscape(label)}</span>${credit ? `<small>${filmPageEscape(credit)}</small>` : ""}</td>`;
  }

  function renderAwardRows(film, awards, officialNominations = null) {
    let nominationsByCategory = new Map();
    (officialNominations || []).forEach((nomination) => {
      let nominations = nominationsByCategory.get(nomination.category) || [];
      nominations.push(nomination);
      nominationsByCategory.set(nomination.category, nominations);
    });
    let rows = awards
      .map(
        (award) => `<tr>
    <td class="detail-place">${filmPagePlacement(award.placement)}</td>
    <td><a class="category-link" href="${filmPageEscape(window.categoryPageUrl(award.category))}"><strong>${filmPageEscape(award.category)}</strong></a></td>
    <td>${awardCreditHtml(film, award)}</td>
    ${officialNominations ? renderOfficialComparison(award, nominationsByCategory.get(award.category) || []) : ""}
  </tr>`,
      )
      .concat(
        officialNominations
          ? [...nominationsByCategory.entries()]
              .filter(
                ([category]) =>
                  !awards.some((award) => award.category === category),
              )
              .sort(
                (left, right) =>
                  categorySortIndex(left[0]) - categorySortIndex(right[0]) ||
                  left[0].localeCompare(right[0]),
              )
              .map(
                ([category, nominations]) => `<tr class="film-official-only">
    <td class="detail-place">—</td>
    <td><a class="category-link" href="${filmPageEscape(window.categoryPageUrl(category))}"><strong>${filmPageEscape(category)}</strong></a></td>
    <td>—</td>
    ${renderOfficialComparison(null, nominations)}
  </tr>`,
              )
          : [],
      )
      .join("");
    return (
      rows ||
      `<tr><td colspan="${officialNominations ? 4 : 3}">${filmPageEscape(ui("No nominations"))}</td></tr>`
    );
  }

  function renderAwardGroups(film, awards, officialContext) {
    let typeOrder = { years: 0, decades: 1, centuries: 2, allTime: 3 };
    let groups = new Map();
    awards.forEach((award) => {
      let period = String(award.year || "");
      if (!groups.has(period)) groups.set(period, []);
      groups.get(period).push(award);
    });
    if (
      officialContext?.nominations.length &&
      ![...groups.values()].some((periodAwards) =>
        periodAwards.some(
          (award) =>
            window.getAwardPeriodType(award) === "years" &&
            officialPeriodMatchesFilm(award.year, film),
        ),
      )
    ) {
      groups.set(officialContext.nominations[0].periodKey, []);
    }
    return [...groups.entries()]
      .sort((left, right) => {
        let leftType = left[1][0]
          ? window.getAwardPeriodType(left[1][0])
          : "years";
        let rightType = right[1][0]
          ? window.getAwardPeriodType(right[1][0])
          : "years";
        return (
          (typeOrder[leftType] ?? 9) - (typeOrder[rightType] ?? 9) ||
          filmPagePeriodOrder(left[0]) - filmPagePeriodOrder(right[0])
        );
      })
      .map(([period, periodAwards]) => {
        let type = periodAwards[0]
          ? window.getAwardPeriodType(periodAwards[0])
          : "years";
        let label =
          type === "allTime" || period === "alltime" ? ui("All-time") : period;
        periodAwards.sort(
          (left, right) =>
            categorySortIndex(left.category) -
              categorySortIndex(right.category) ||
            Number(left.placement) - Number(right.placement),
        );
        let officialNominations =
          type === "years" && officialPeriodMatchesFilm(period, film)
            ? officialContext?.nominations || []
            : null;
        let table = window.renderLeaderboardTable({
          headers: [
            ui("Place"),
            ui("Category"),
            ui("Credit"),
            ...(officialNominations ? [ui("Real Oscars")] : []),
          ].map(filmPageEscape),
          rows: renderAwardRows(film, periodAwards, officialNominations),
          classes: "detail-awards",
        });
        return `<section class="film-award-period"><h3><a class="period-link" href="${filmPageEscape(window.periodPageUrl(type, period))}">${filmPageEscape(label)}</a></h3>${table}</section>`;
      })
      .join("");
  }

  function renderAwardMatrix(film, awards) {
    let columns = [
      { type: "years", label: ui("Year") },
      { type: "decades", label: ui("Decade") },
      { type: "centuries", label: ui("Century") },
      { type: "allTime", label: ui("All-time") },
    ];
    let byCategory = new Map();
    awards.forEach((award) => {
      let category = award.category;
      let type = window.getAwardPeriodType(award);
      if (!byCategory.has(category)) byCategory.set(category, new Map());
      if (!byCategory.get(category).has(type))
        byCategory.get(category).set(type, award);
    });
    let annualCategories = [
      ...new Set(
        awards
          .filter((award) => window.getAwardPeriodType(award) === "years")
          .map((award) => award.category),
      ),
    ];
    let categories = (
      annualCategories.length ? annualCategories : [...byCategory.keys()]
    ).sort((left, right) => categorySortIndex(left) - categorySortIndex(right));
    let headerLabels = columns.map((column) => {
      let periodAward = awards.find(
        (award) => window.getAwardPeriodType(award) === column.type,
      );
      let period = periodAward?.year;
      let periodLabel = column.type === "allTime" ? "" : period;
      return `${column.label}${periodLabel ? `<span>${filmPageEscape(periodLabel)}</span>` : ""}`;
    });
    let rows = categories
      .map((category) => {
        let categoryAwards = byCategory.get(category);
        let creditAward =
          categoryAwards?.get("years") ||
          [...(categoryAwards?.values() || [])][0];
        let credit = creditAward ? awardCreditHtml(film, creditAward) : "";
        let placements = columns
          .map((column) => {
            let award = byCategory.get(category)?.get(column.type);
            return window.renderProgressionPlacementCell(award, {
              type: column.type,
              period: award?.year,
              placement: filmPagePlacement,
              escape: filmPageEscape,
            });
          })
          .join("");
        return `<tr><th><a class="category-link" href="${filmPageEscape(window.categoryPageUrl(category))}">${filmPageEscape(category)}</a></th><td class="award-matrix-credit">${credit}</td>${placements}</tr>`;
      })
      .join("");
    return window.renderProgressionTable({
      headers: [ui("Category"), ui("Credit"), ...headerLabels],
      rows,
      emptyText: ui("No nominations"),
    });
  }

  function relationFilmLink(ref) {
    let related = ref?.id ? window.findFilmById(ref.id) : null;
    let title = related?.title || ref?.title || "";
    if (!title) return "";
    let year = related?.year || ref?.year || "";
    let href =
      related?.id || ref?.id ? window.filmPageUrl(related?.id || ref.id) : "";
    let label = `${title}${year ? ` (${year})` : ""}`;
    return href
      ? `<a class="table-film-link" href="${filmPageEscape(href)}">${filmPageEscape(label)}</a>`
      : filmPageEscape(label);
  }

  function renderFilmRelations(film) {
    let sections = [];
    let parts = (film.compositeParts || [])
      .map(relationFilmLink)
      .filter(Boolean);
    if (parts.length) {
      sections.push(
        `<div><h3>${filmPageEscape(ui("Includes"))}</h3><p>${parts.join(" · ")}</p></div>`,
      );
    }
    let canonical = relationFilmLink(film.canonicalComposite);
    if (canonical) {
      sections.push(
        `<div><h3>${filmPageEscape(ui("Part of"))}</h3><p>${canonical}</p></div>`,
      );
    }
    if (!sections.length) return "";
    return `<section class="film-relations"><h2>${filmPageEscape(ui("Film relations"))}</h2>${sections.join("")}</section>`;
  }

  function renderEditAwardRows(awards) {
    let rows = awards
      .map(
        (
          award,
        ) => `<tr data-award-edit-row data-category="${filmPageEscape(award.category)}" data-placement="${filmPageEscape(award.placement)}" data-period="${filmPageEscape(award.year || "")}">
    <td>${filmPageEscape(award.year || "")}</td>
    <td class="detail-place">${filmPageEscape(award.placement)}</td>
    <td>${filmPageEscape(award.category)}</td>
    <td><input name="recipient" value="${filmPageEscape(window.awardRecipientText(award))}" aria-label="${filmPageEscape(ui("Recipients for {category}", { category: award.category }))}"></td>
    <td><input name="detail" value="${filmPageEscape(window.awardDetail(award))}" aria-label="${filmPageEscape(ui("Detail for {category}", { category: award.category }))}"></td>
  </tr>`,
      )
      .join("");
    return (
      rows ||
      `<tr><td colspan="5">${filmPageEscape(ui("No nominations"))}</td></tr>`
    );
  }

  function awardCreditAchievementHtml(person) {
    let awards = Array.isArray(person.awards) ? person.awards : [];
    let placements = awards
      .map((award) => Number(award.placement))
      .filter(Boolean);
    if (!placements.length) return "";
    let bestPlacement = Math.min(...placements);
    let symbol = placementEmoji[bestPlacement] || "•";
    let label =
      bestPlacement === 1
        ? ui("Winner")
        : bestPlacement === 2
          ? "2nd"
          : bestPlacement === 3
            ? "3rd"
            : ui("Nomination");
    let extra =
      awards.length > 1 ? ` · ${awards.length} ${ui("Nominations")}` : "";
    return `<span class="award-credit-achievement" title="${filmPageEscape(label + extra)}" aria-label="${filmPageEscape(label)}">${filmPageEscape(symbol)}</span>`;
  }

  function renderView(film) {
    let displayTitle = window.localizedFilmTitle(film);
    let localizedTitleMeta = window.hasLocalizedFilmTitle(film)
      ? `<span class="leaderboard-meta localized-title-meta">${filmPageEscape(ui("Original title"))}: ${filmPageEscape(film.title)}</span>`
      : "";
    let awards = sortedAwards(film);
    let officialContext = officialFilmContext(film);
    let officialWins =
      officialContext?.nominations.filter((nomination) => nomination.winner)
        .length || 0;
    let awardScores = window.calculateAwardsScores(awards);
    let periodTypes = ["allTime", "centuries", "decades", "years"];
    let periodStats = periodTypes.map((periodType) =>
      calculateAwardStats(
        awards.filter(
          (award) => window.getAwardPeriodType(award) === periodType,
        ),
      ),
    );
    let rankValues = [
      film.allTimeRank,
      film.centuryRank,
      film.decadeRank,
      film.yearRank,
    ];
    let scoreValues = [
      awardScores.allTime,
      awardScores.century,
      awardScores.decade,
      awardScores.year,
    ];
    let rankCells = rankValues
      .map((rank, index) =>
        index === 0 && Number(rank) > 0 && Number(rank) <= 250
          ? `<span class="top-250-rank" title="Top 250 all-time film"><span class="top-250-star" aria-hidden="true">★</span><b>${filmPageEscape(rank)}</b><small>Top 250</small></span>`
          : `<span>${Number(rank) > 0 ? `<b>${filmPageEscape(rank)}</b>` : "—"}</span>`,
      )
      .join("");
    let scoreCells = scoreValues
      .map((score) => `<span><b>${filmPageEscape(score || 0)}</b></span>`)
      .join("");
    let statRow = (label, key) =>
      `<div class="detail-stat-row"><b>${filmPageEscape(label)}</b>${periodStats.map((entry) => `<span><b>${filmPageEscape(entry[key] || 0)}</b></span>`).join("")}</div>`;
    let officialStatsHtml = officialContext
      ? `<div class="detail-stat-summary film-official-summary"><span><b>${filmPageEscape(ui("Real Oscars"))}</b> ${officialWins} ${filmPageEscape(ui(officialWins === 1 ? "Win" : "Wins"))} · ${officialContext.nominations.length} ${filmPageEscape(ui(officialContext.nominations.length === 1 ? "Nomination" : "Nominations"))}</span></div>`
      : "";
    let statsHtml = `<div class="detail-stat-grid"><div class="detail-stat-head"><b></b><span>${filmPageEscape(ui("All-time"))}</span><span>${filmPageEscape(ui("Century"))}</span><span>${filmPageEscape(ui("Decade"))}</span><span>${filmPageEscape(ui("Year"))}</span></div><div class="detail-stat-row"><b>${filmPageEscape(ui("Rank"))}</b>${rankCells}</div><div class="detail-stat-row"><b>${filmPageEscape(ui("Score"))}</b>${scoreCells}</div>${statRow(ui("Wins"), "wins")}${statRow(ui("2nd"), "second")}${statRow(ui("3rd"), "third")}${statRow(ui("Nominations"), "nominations")}</div>${officialStatsHtml}`;
    let director = film.directors?.length
      ? film.directors
      : String(film.director || "").trim();
    let directorHtml = window.renderLinkedDirectors(director, {
      escape: filmPageEscape,
      expanded: true,
    });
    let letterboxdUrl =
      film.letterboxdUrl ||
      (/letterboxd\.com/i.test(String(film.url || "")) ? film.url : "");
    let otherUrl = film.url && film.url !== letterboxdUrl ? film.url : "";
    let countryValues = window.countryListValues(film.country);
    let primaryCountry = window.primaryCountryValue(film);
    let metadata = [
      [
        ui("Year"),
        film.year,
        film.year ? window.periodPageUrl("year", film.year) : "",
      ],
      [ui("Type"), film.type ? metadataLabel(film.type) : ""],
      [
        "TMDB",
        film.tmdbId ? `#${film.tmdbId}` : "",
        film.tmdbId
          ? `https://www.themoviedb.org/${window.tmdbResourcePath(window.parseTmdbReference(film.tmdbId))}`
          : "",
      ],
      ["Letterboxd", letterboxdUrl ? "Open on Letterboxd" : "", letterboxdUrl],
      [
        ui("Medium"),
        film.medium !== "unknown" ? metadataLabel(film.medium) : "",
      ],
      [
        ui("Screenplay"),
        film.screenplayType !== "unknown"
          ? metadataLabel(film.screenplayType)
          : "",
      ],
      [
        ui("Adapted from"),
        film.adaptationSource,
        film.adaptationSource
          ? `${window.periodPageUrl("alltime", "alltime")}&view=films&scope=all&source=${encodeURIComponent(film.adaptationSource)}`
          : "",
      ],
      [ui("Swedish title"), film.swedishTitle],
      [
        ui("Primary country"),
        primaryCountry,
        "",
        primaryCountry && countryValues.length > 1
          ? window.renderCountryLinks(primaryCountry, filmPageEscape)
          : "",
      ],
      [
        ui("Country"),
        countryValues.join(", "),
        "",
        countryValues.length
          ? window.renderCountryLinks(countryValues.join(", "), filmPageEscape)
          : "",
      ],
      [ui("Runtime"), formatRuntime(film.runtimeMinutes)],
      ["URL", otherUrl, otherUrl],
    ].filter((entry) => entry[1]);
    let metadataHtml = metadata
      .map(
        (entry) =>
          `<div><dt>${filmPageEscape(entry[0])}</dt><dd>${
            entry[3]
              ? entry[3]
              : entry[2]
                ? `<a class="period-link" href="${filmPageEscape(entry[2])}"${["URL", "TMDB", "Letterboxd"].includes(entry[0]) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${filmPageEscape(entry[1])}</a>`
                : filmPageEscape(entry[1])
          }</dd></div>`,
      )
      .join("");
    let viewingFacts = [
      [ui("Watched"), formatWatchedDate(film.dateWatched)],
      [ui("Platform"), film.platform],
      [
        ui("Music score"),
        film.musicScore != null
          ? window.renderFilmRating?.(film.musicScore) ||
            String(film.musicScore)
          : "",
      ],
      [ui("Views"), formatNumber(film.views)],
      [
        ui("Rewatchlist"),
        film.wantToRewatch
          ? film.rewatchTier
            ? ui("Want to rewatch ({tier})", { tier: film.rewatchTier })
            : ui("Want to rewatch")
          : ui("Not marked"),
      ],
    ].filter((entry) => entry[1]);
    let viewingHtml = viewingFacts.length
      ? `<div class="film-viewing-summary">${viewingFacts.map((entry) => `<span><b>${filmPageEscape(entry[0])}</b> ${filmPageEscape(entry[1])}</span>`).join("")}</div>`
      : "";
    let professionHtml = window.PERSON_PROFESSION_ORDER.filter(
      (profession) => film.peopleByProfession?.[profession]?.length,
    )
      .map((profession) => {
        let people = [...film.peopleByProfession[profession]]
          .sort((left, right) =>
            window.comparePersonNamesBySurname(left.name, right.name),
          )
          .map((person) => {
            let subjectType =
              profession === "Actor"
                ? "role"
                : profession === "Songwriter"
                  ? "song"
                  : "";
            let details = person.details
              .map((detail) =>
                subjectType
                  ? `<a class="detail-subject-link" href="${filmPageEscape(window.subjectPageUrl(window.makeCreditSubjectId(subjectType, film.id, detail)))}">${filmPageEscape(detail)}</a>`
                  : filmPageEscape(detail),
              )
              .join(" · ");
            return `<div class="film-credit-person"><a href="${filmPageEscape(window.personPageUrl(person.id))}">${filmPageEscape(person.name)}</a>${awardCreditAchievementHtml(person)}</div>${details ? `<span>${details}</span>` : ""}`;
          })
          .join("");
        return `<div class="film-credit-group"><h3>${filmPageEscape(profession)}</h3>${people}</div>`;
      })
      .join("");
    let posterHtml = renderPosterArea(film);
    let franchiseHtml = window.renderFranchiseMembershipLinks(film.franchises, {
      filmId: film.id,
      escape: filmPageEscape,
    });
    let relationsHtml = renderFilmRelations(film);
    let tagHtml = window
      .parseFilmTags(film.tags)
      .map(
        (tag) =>
          `<a class="film-tag" href="${filmPageEscape(window.tagPageUrl(tag))}">${filmPageEscape(tag)}</a>`,
      )
      .join("");
    let projectMembershipHtml = window.renderProjectMembershipSection(
      window.activeProjectsForFilm?.({ archiveId: film.id }) || [],
      { escape: filmPageEscape, title: ui("Active projects") },
    );
    let awardsHtml = awards.length || officialContext?.nominations.length
      ? `<section class="film-awards" data-collapsible-section><h2 data-collapsible-heading>${filmPageEscape(ui("Awards"))}</h2><div data-collapsible-body>
  <fieldset class="film-awards-view-controls"><legend>${filmPageEscape(ui("Display"))}</legend><label><input type="radio" name="filmAwardsView" value="periods" ${awardsView === "periods" ? "checked" : ""}> ${filmPageEscape(ui("Period tables"))}</label><label><input type="radio" name="filmAwardsView" value="matrix" ${awardsView === "matrix" ? "checked" : ""}> ${filmPageEscape(ui("Progression table"))}</label></fieldset>
  ${
    awardsView === "matrix"
      ? renderAwardMatrix(film, awards)
      : `<div class="film-award-period-grid">${renderAwardGroups(film, awards, officialContext)}</div>`
  }</div></section>`
      : "";
    let openIntake = (window.state.intakeWorkflows || []).find(
      (workflow) => workflow.filmId === film.id && !workflow.completedAt,
    );
    let intakeBannerHtml = openIntake
      ? `<section class="detail-note"><div><h2>${filmPageEscape(ui("Watched-film intake is open"))}</h2></div><p>${filmPageEscape(ui("Rating, global ranking, or awards review still needs an explicit decision."))}</p><a class="button-link" href="${filmPageEscape(window.intakePageUrl(openIntake.id))}">${filmPageEscape(ui("Continue intake"))}</a></section>`
      : "";

    let moreToolsOpen = posterOptions.length > 0 || !!posterPickerStatus;
    container.innerHTML = `${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${filmPageEscape(displayTitle)}</h1>${film.rating ? `<strong class="detail-rating">${filmPageEscape(film.rating)}</strong>` : ""}</div>${localizedTitleMeta}${directorHtml ? `<p>${filmPageEscape(ui("by"))} ${directorHtml}</p>` : ""}
      ${statsHtml}
      ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}
      ${viewingHtml}
      ${film.review ? `<section class="detail-note film-review-compact"><div><h2>${filmPageEscape(ui("Review"))}</h2></div><p>${filmPageEscape(film.review)}</p></section>` : ""}`,
      actionsHtml: `<a class="button-link" href="${filmPageEscape(window.comparePageUrl([film.id]))}">${filmPageEscape(ui("Compare"))}</a>${
        canEdit
          ? `<button type="button" data-toggle-film-rewatch>${filmPageEscape(ui(film.wantToRewatch ? "Remove from rewatchlist" : "Want to rewatch"))}</button><button type="button" data-edit-film>${filmPageEscape(ui("Edit"))}</button><details class="detail-header-more"${moreToolsOpen ? " open" : ""}><summary class="button-link">${filmPageEscape(ui("More"))}</summary><div class="detail-header-more-panel"><button type="button" data-enrich-film="${filmPageEscape(film.id)}">${filmPageEscape(ui("Find metadata"))}</button><button type="button" data-find-film-poster="${filmPageEscape(film.id)}">${filmPageEscape(film.poster ? ui("Refresh poster") : ui("Find poster"))}</button><button type="button" data-load-poster-options="${filmPageEscape(film.id)}">${filmPageEscape(posterOptions.length ? ui("Reload poster options") : ui("Browse posters"))}</button></div></details>`
          : ""
      }`,
    })}
  ${intakeBannerHtml}
  ${tagHtml ? `<section class="film-tags"><h2>${filmPageEscape(ui("Tags"))}</h2><div class="film-tag-list">${tagHtml}</div></section>` : ""}
  ${franchiseHtml ? `<section class="film-franchises"><h2>${filmPageEscape(ui("Franchises"))}</h2><div class="film-franchise-links">${franchiseHtml}</div></section>` : ""}
  ${relationsHtml}
  ${projectMembershipHtml}
  ${professionHtml ? `<section class="film-credits" data-collapsible-section><h2 data-collapsible-heading>${filmPageEscape(ui("Award credits"))}</h2><div class="film-credit-grid" data-collapsible-body>${professionHtml}</div></section>` : ""}
  ${awardsHtml}`;
    window.enhanceCollapsibles?.(container);
  }

  function renderEdit(film) {
    let awards = sortedAwards(film);
    container.innerHTML = `<form id="filmEditForm" class="film-edit-form">
    ${window.renderDetailHeader({ mainHtml: `<h1>${filmPageEscape(ui("Edit {title}", { title: film.title }))}</h1><p>${filmPageEscape(ui("Film metadata and credits"))}</p>`, actionsHtml: `<button type="submit">${filmPageEscape(ui("Save"))}</button><button type="button" data-cancel-film-edit>${filmPageEscape(ui("Cancel"))}</button>` })}
    <section class="film-edit-section"><h2>${filmPageEscape(ui("Details"))}</h2><div class="film-edit-grid">
      <label>${filmPageEscape(ui("Title"))} <input name="title" value="${filmPageEscape(film.title)}" required></label>
      <label>${filmPageEscape(ui("Release year"))} <input name="year" type="number" min="1900" max="2099" value="${filmPageEscape(film.year || "")}" required></label>
      <label class="wide">${filmPageEscape(ui("Director(s)"))} <input name="director" value="${filmPageEscape(film.director || (film.directors || []).join(", "))}"></label>
      <label>${filmPageEscape(ui("Rating"))} ${window.renderRatingInput({ value: film.rating || "" })}</label>
      <label>${filmPageEscape(ui("Country"))} <input name="country" value="${filmPageEscape(film.country || "")}"></label>
      <label>${filmPageEscape(ui("Primary country"))} <input name="primaryCountry" value="${filmPageEscape(window.primaryCountryValue(film))}"></label>
      <label>${filmPageEscape(ui("Medium"))} <select name="medium"><option value="unknown" ${selected(film.medium, "unknown")}>${filmPageEscape(ui("Unknown"))}</option><option value="live-action" ${selected(film.medium, "live-action")}>${filmPageEscape(ui("Live action"))}</option><option value="animation" ${selected(film.medium, "animation")}>${filmPageEscape(ui("Animation"))}</option><option value="hybrid" ${selected(film.medium, "hybrid")}>${filmPageEscape(ui("Hybrid"))}</option></select></label>
      <label>${filmPageEscape(ui("Screenplay"))} <select name="screenplayType"><option value="unknown" ${selected(film.screenplayType, "unknown")}>${filmPageEscape(ui("Unknown"))}</option><option value="original" ${selected(film.screenplayType, "original")}>${filmPageEscape(ui("Original"))}</option><option value="adapted" ${selected(film.screenplayType, "adapted")}>${filmPageEscape(ui("Adapted"))}</option></select></label>
      <label>${filmPageEscape(ui("Adaptation source"))} <input name="adaptationSource" value="${filmPageEscape(film.adaptationSource || "")}" placeholder="${filmPageEscape(ui("Novel, play, video game…"))}"></label>
      <label class="wide">${filmPageEscape(ui("Film URL"))} <input name="url" type="url" value="${filmPageEscape(film.url || "")}"></label>
      <label class="wide">${filmPageEscape(ui("Poster URL"))} <input name="posterUrl" type="url" value="${filmPageEscape(film.poster?.url || "")}"></label>
      <label class="wide">${filmPageEscape(ui("Franchises"))} <textarea name="franchises" rows="5" placeholder="${filmPageEscape(ui("Parent franchise > Subfranchise | rank"))}">${filmPageEscape(window.formatFranchiseMemberships(film.franchises))}</textarea><span class="field-help">${filmPageEscape(ui("One per line. Examples: James Bond | 5 or Marvel Cinematic Universe > Iron Man | 2. Chain as many levels as needed, e.g. Marvel > MCU > Infinity Saga > Phase 1 | 2 — each intermediate name is created automatically."))}</span></label>
      <label class="wide">${filmPageEscape(ui("Tags"))} <input name="tags" value="${filmPageEscape(window.formatFilmTags(film.tags))}" placeholder="${filmPageEscape(ui("Noir, courtroom drama, rewatch"))}"><span class="field-help">${filmPageEscape(ui("Separate tags with commas."))}</span></label>
      <label class="wide">${filmPageEscape(ui("Review / comment"))} <textarea name="review" rows="5" maxlength="1000">${filmPageEscape(film.review || "")}</textarea><span class="field-help">${filmPageEscape(ui("A short personal note about the film."))}</span></label>
      <label><input type="checkbox" name="wantToRewatch" ${film.wantToRewatch ? "checked" : ""}> ${filmPageEscape(ui("Rewatchlist"))}</label>
      <label>${filmPageEscape(ui("Rewatch tier"))} <select name="rewatchTier">${rewatchTierOptions(film.rewatchTier)}</select></label>
    </div></section>
    <section class="film-edit-section"><h2>${filmPageEscape(ui("Ranks"))}</h2><div class="film-edit-grid ranks">
      <label>${filmPageEscape(ui("All-time"))} <input name="allTimeRank" type="number" min="1" value="${filmPageEscape(film.allTimeRank || "")}"></label>
      <label>${filmPageEscape(ui("Century"))} <input name="centuryRank" type="number" min="1" value="${filmPageEscape(film.centuryRank || "")}"></label>
      <label>${filmPageEscape(ui("Decade"))} <input name="decadeRank" type="number" min="1" value="${filmPageEscape(film.decadeRank || "")}"></label>
      <label>${filmPageEscape(ui("Year"))} <input name="yearRank" type="number" min="1" value="${filmPageEscape(film.yearRank || "")}"></label>
    </div></section>
    <section class="film-edit-section"><h2>${filmPageEscape(ui("Award credits"))}</h2><p class="edit-help">${filmPageEscape(ui("Period, placement, and category define the bracket entry and remain structural. Recipients and details can be edited here."))}</p>
      <div class="leaderboard-wrap"><table class="leaderboard film-edit-awards"><thead><tr><th>${filmPageEscape(ui("Period"))}</th><th>${filmPageEscape(ui("Place"))}</th><th>${filmPageEscape(ui("Category"))}</th><th>${filmPageEscape(ui("Recipients"))}</th><th>${filmPageEscape(ui("Detail"))}</th></tr></thead><tbody>${renderEditAwardRows(awards)}</tbody></table></div>
    </section>
    <div class="film-edit-actions"><button type="submit">${filmPageEscape(ui("Save changes"))}</button><button type="button" data-cancel-film-edit>${filmPageEscape(ui("Cancel"))}</button></div>
  </form>`;
    window.enhanceRatingInputs?.(container);
  }

  function render(editing = false) {
    let finishRenderTimer = window.startOskarsPerformance?.("film:render");
    let film = currentFilm();
    if (!film) {
      document.title = "Film not found · The Oskars";
      container.innerHTML =
        '<div class="detail-empty"><h1>Film not found</h1><a href="index.html">Return home</a></div>';
      finishRenderTimer?.("not found");
      return;
    }
    editing = editing && canEdit;
    document.title = `${editing ? ui("Edit {title}", { title: film.title }) : window.localizedFilmTitle(film)} · The Oskars`;
    if (editing) renderEdit(film);
    else renderView(film);
    finishRenderTimer?.(
      `${film.id}, ${editing ? "edit" : "view"}, ${(film.awards || []).length} award(s)`,
    );
  }

  if (typeof window !== "undefined") {
    window.removeEventListener?.(
      "oskars:localechange",
      window.__oskarsFilmLocaleRender,
    );
    window.__oskarsFilmLocaleRender = () => {
      if (String(container.innerHTML || "").includes('id="filmEditForm"'))
        return;
      render(false);
    };
    window.addEventListener?.(
      "oskars:localechange",
      window.__oskarsFilmLocaleRender,
    );
  }

  container.addEventListener("click", async (event) => {
    if (event.target.closest("[data-toggle-film-rewatch]")) {
      let film = currentFilm();
      let backup = window.cloneRecord(window.getSerializableState());
      try {
        window.updateFilmMetadata(
          film.id,
          Object.assign(window.filmMetadataFormValues(film), {
            wantToRewatch: !film.wantToRewatch,
          }),
        );
        window.save();
        render(false);
      } catch (err) {
        window.hydrateState(backup);
        alert(err.message || String(err));
        render(false);
      }
      return;
    }
    if (event.target.closest("[data-edit-film]")) {
      render(true);
      return;
    }
    if (event.target.closest("[data-cancel-film-edit]")) {
      render(false);
      return;
    }
    let enrichButton = event.target.closest("[data-enrich-film]");
    if (enrichButton) {
      enrichButton.disabled = true;
      enrichButton.textContent = ui("Finding...");
      try {
        let metadata = await window.loadFilmMetadata(
          enrichButton.dataset.enrichFilm,
        );
        if (!metadata) throw new Error(ui("No TMDB match was found."));
        render(false);
      } catch (err) {
        enrichButton.disabled = false;
        enrichButton.textContent = ui("Find metadata");
        alert(err.message || String(err));
      }
      return;
    }
    let optionsButton = event.target.closest("[data-load-poster-options]");
    if (optionsButton) {
      optionsButton.disabled = true;
      optionsButton.textContent = ui("Loading posters...");
      try {
        posterOptions = await window.loadFilmPosterOptions(
          optionsButton.dataset.loadPosterOptions,
          { limit: 12 },
        );
        posterOptionIndex = currentPosterOptionIndex(currentFilm());
        posterPickerStatus = posterOptions.length
          ? ""
          : ui("No TMDB posters were found for this film.");
        render(false);
      } catch (err) {
        optionsButton.disabled = false;
        optionsButton.textContent = posterOptions.length
          ? ui("Reload poster options")
          : ui("Browse posters");
        posterPickerStatus = window.posterPickerErrorText(err);
        render(false);
      }
      return;
    }
    let posterStepButton = event.target.closest("[data-poster-option-step]");
    if (posterStepButton) {
      selectPosterOption(
        currentPosterOptionIndex(currentFilm()) +
          (Number(posterStepButton.dataset.posterOptionStep) || 0),
      );
      return;
    }
    let posterSelectButton = event.target.closest(
      "[data-poster-option-select]",
    );
    if (posterSelectButton) {
      selectPosterOption(
        Number(posterSelectButton.dataset.posterOptionSelect) || 0,
      );
      return;
    }
    let button = event.target.closest("[data-find-film-poster]");
    if (!button) return;
    button.disabled = true;
    button.textContent = ui("Finding…");
    try {
      let poster = await window.loadFilmPoster(button.dataset.findFilmPoster);
      if (!poster) throw new Error(ui("No poster was found."));
      render(false);
    } catch (err) {
      button.disabled = false;
      button.textContent = currentFilm()?.poster
        ? ui("Refresh poster")
        : ui("Find poster");
      alert(err.message || String(err));
    }
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (
      !posterOptions.length ||
      !event.target.closest?.("[data-film-poster-picker]")
    )
      return;
    event.preventDefault();
    selectPosterOption(
      currentPosterOptionIndex(currentFilm()) +
        (event.key === "ArrowRight" ? 1 : -1),
    );
  });

  container.addEventListener("change", (event) => {
    let input = event.target.closest('input[name="filmAwardsView"]');
    if (!input) return;
    awardsView = input.value;
    updateFilmViewUrl();
    render(false);
  });

  container.addEventListener("submit", (event) => {
    let form = event.target.closest("#filmEditForm");
    if (!form) return;
    event.preventDefault();
    let backup = window.cloneRecord(window.getSerializableState());
    try {
      let values = Object.fromEntries(new FormData(form).entries());
      let updated = window.updateFilmMetadata(filmId, values);
      if (!updated) throw new Error(ui("Film could not be updated."));
      let nextId = updated.id;
      form.querySelectorAll("[data-award-edit-row]").forEach((row) => {
        let category = row.dataset.category;
        let placement = row.dataset.placement;
        let period = row.dataset.period;
        let recipient = row.querySelector('[name="recipient"]').value;
        let detail = row.querySelector('[name="detail"]').value;
        if (
          !window.updateAwardRecipient(
            nextId,
            category,
            placement,
            period,
            recipient,
          )
        ) {
          let message =
            window.lastRuleViolation?.errors?.join("\n") ||
            ui("Could not update {category} recipients.", { category });
          throw new Error(message);
        }
        if (
          !window.updateAwardDetail(nextId, category, placement, period, detail)
        ) {
          throw new Error(
            ui("Could not update {category} detail.", { category }),
          );
        }
      });
      window.save();
      filmId = nextId;
      updateFilmViewUrl();
      render(false);
    } catch (err) {
      window.hydrateState(backup);
      alert(err.message || String(err));
      render(true);
    }
  });

  render(false);
})();
