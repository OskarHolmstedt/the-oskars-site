/** @file Controls film detail rendering, awards, read-only catalog metadata, and personal editing. */

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

  // Film credits use the derived peopleByProfession groups. Most pages can keep
  // the people index lazy, but the film page explicitly needs it before render.
  window.ensurePeopleIndex?.();

  let filmId = window.pageQueryParam("id");
  let previewTmdbId = filmId ? "" : window.pageQueryParam("tmdb");
  let awardsView =
    window.pageQueryParam("awards") === "matrix" ? "matrix" : "periods";
  let container = document.getElementById("filmPage");

  // Watchlisted-film detail (issue #451/#457): film.html?id=<filmId> is now
  // the one canonical URL regardless of status - a Watchlisted film used to
  // live at a separate watchlist-film.html?id=<watchlistRowId> URL entirely.
  // Resolved once at load, not recomputed per render, since a film's
  // Watched/Watchlisted status doesn't change without a navigation away
  // (mark-as-watched/add-to-watched both redirect elsewhere; removal shows
  // an inline "Removed from watchlist" state via removedWatchlistSnapshot
  // below, matching this file's existing shared-preview add flow rather
  // than re-deriving status from window.state on every render).
  let watchlistItem = filmId
    ? window.state.watchlist?.find(
        (entry) => entry.supabaseFilmId === filmId,
      ) || null
    : null;
  let isWatchlistDetail = Boolean(watchlistItem);
  let watchlistBusy = false;
  let removedWatchlistSnapshot = null;
  let watchlistFranchiseChains = null;
  // Read-only archive-match hint, ported from watchlist-film.js: built
  // from the already-hydrated window.state.filmsById (every watched film,
  // Supabase-side there's no separate "watchedOther" bucket) rather than a
  // live loadSupabaseWorkspace() call watchlist-film.js's own boot() used
  // to make - the data's already sitting in window.state by the time this
  // page's script runs.
  let watchedTitlesByYear = new Map();
  if (isWatchlistDetail) {
    Object.values(window.state.filmsById || {}).forEach((watched) => {
      let title = window.normalizeTitle(watched.title || "");
      if (!title) return;
      let entry = { title: watched.title, year: watched.year };
      watchedTitlesByYear.set(`${title}::${watched.year || ""}`, entry);
      watchedTitlesByYear.set(`${title}::`, entry);
    });
  }

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

  // Ported from watchlist-film.js (issue #457) - metadataLabel/formatRuntime
  // above are already identical between the two files, reused as-is.
  function tierOptions(selected) {
    return `<option value="">${filmPageEscape(ui("Unranked"))}</option>${window.WATCHLIST_TIERS.map(
      (tier) =>
        `<option value="${filmPageEscape(tier)}" ${window.normalizeWatchlistTier(selected) === tier ? "selected" : ""}>${filmPageEscape(tier)}</option>`,
    ).join("")}`;
  }

  function watchlistMetadataRow(label, value, href) {
    if (!value) return "";
    return `<div><dt>${filmPageEscape(label)}</dt><dd>${
      href
        ? `<a class="period-link" href="${filmPageEscape(href)}"${/^https?:\/\//i.test(String(href)) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${filmPageEscape(value)}</a>`
        : filmPageEscape(value)
    }</dd></div>`;
  }

  // Read-only archive-match hint (issue #439's confirmed scope reduction
  // drops metadata/poster editing entirely, but this stays useful and
  // needs no write of its own): a simple normalized-title/year match
  // against the signed-in user's own already-watched titles.
  function archiveMatchCandidate() {
    let normalizedTitle = window.normalizeTitle(watchlistItem.title || "");
    let year = String(watchlistItem.year || "");
    let sameTitleYear = watchedTitlesByYear.get(`${normalizedTitle}::${year}`);
    let sameTitle = watchedTitlesByYear.get(`${normalizedTitle}::`);
    if (sameTitleYear)
      return {
        level: "exact",
        label: ui("Title and year match"),
        film: sameTitleYear,
      };
    if (sameTitle)
      return {
        level: "possible",
        label: year
          ? ui("Same title, different year")
          : ui("Same title, year unknown"),
        film: sameTitle,
      };
    return null;
  }

  function renderArchiveMatchReview() {
    let match = archiveMatchCandidate();
    if (!match) return "";
    let film = match.film;
    let table = window.renderLeaderboardTable({
      headers: [ui("Confidence"), ui("Film")].map(filmPageEscape),
      rows: `<tr><td><span class="match-confidence match-confidence--${filmPageEscape(match.level)}">${filmPageEscape(match.level === "exact" ? ui("Exact") : ui("Possible"))}</span><span class="leaderboard-meta">${filmPageEscape(match.label)}</span></td><td class="film-table-cell"><a class="table-film-link" href="${filmPageEscape(window.periodPageUrl("year", film.year))}"><strong>${filmPageEscape(film.title)}</strong></a><span class="leaderboard-meta">${filmPageEscape(film.year || "")}</span></td></tr>`,
    });
    return `<section class="archive-match-review"><h2>${filmPageEscape(ui("Archive match review"))}</h2><p>${filmPageEscape(ui("Possible archive matches are shown for review only."))}</p>${table}</section>`;
  }

  function renderWatchlistWatchedForm() {
    document.title = `${ui("Mark {title} as watched", { title: watchlistItem.title })} · The Oskars`;
    container.innerHTML = `<form id="markWatchlistWatchedForm" class="film-edit-form">
      ${window.renderDetailHeader({ mainHtml: `<h1>${filmPageEscape(ui("Mark {title} as watched", { title: watchlistItem.title }))}</h1><p>${filmPageEscape(ui("Add any viewing facts you know, then mark it watched."))}</p>`, actionsHtml: `${window.renderCollectionActionButton({ kind: "watched", label: ui("Mark as watched"), escape: filmPageEscape, attributes: { type: "submit", disabled: watchlistBusy } })}<button type="button" data-cancel-watchlist-transition>${filmPageEscape(ui("Cancel"))}</button>` })}
      <section class="film-edit-section"><h2>${filmPageEscape(ui("Viewing facts"))}</h2><div class="film-edit-grid">
        <label>${filmPageEscape(ui("Rating"))} ${window.renderRatingInput({})}</label>
        <label>${filmPageEscape(ui("Date watched"))} <input name="dateWatched" type="date"></label>
        <label>${filmPageEscape(ui("Platform"))} <input name="platform" value="${filmPageEscape(watchlistItem.platform || "")}"></label>
        <label>${filmPageEscape(ui("Views"))} <input name="views" type="number" min="1" step="1" value="1"></label>
      </div></section>
      <p>${filmPageEscape(ui("Any unfinished rating, ranking, and awards work will remain in the intake queue."))}</p>
    </form>`;
    window.enhanceRatingInputs?.(container);
  }

  // canEdit-gated throughout (issue #457): watchlist-film.html was
  // entirely owner-only before this merge, so its own mutation controls
  // never needed to check capabilities - film.html is publicly viewable
  // (matching how the Watched view already gates its own edit controls),
  // so every control that writes needs the same explicit check here.
  function renderWatchlistTagEditor() {
    let tags = watchlistItem.tags || [];
    let tagsHtml = tags
      .map((tag) =>
        canEdit
          ? `<span class="film-tag">${filmPageEscape(tag)}<button type="button" class="chip-remove" data-remove-tag="${filmPageEscape(tag)}" aria-label="${filmPageEscape(ui("Remove tag {tag}", { tag }))}">×</button></span>`
          : `<a class="film-tag" href="${filmPageEscape(window.tagPageUrl(tag))}">${filmPageEscape(tag)}</a>`,
      )
      .join("");
    let addFormHtml = canEdit
      ? `<form class="data-form data-form--inline" data-add-tag-form><label>${filmPageEscape(ui("Add tag"))} <input name="tag" required></label><button type="submit"${watchlistBusy ? " disabled" : ""}>${filmPageEscape(ui("Add"))}</button></form>`
      : "";
    if (!tagsHtml && !addFormHtml) return "";
    return `<section class="film-tags"><h2>${filmPageEscape(ui("Tags"))}</h2><div class="film-tag-list">${tagsHtml}</div>${addFormHtml}</section>`;
  }

  function renderWatchlistFranchiseEditor() {
    let franchiseHtml = window.renderFranchiseMembershipLinks(
      watchlistItem.franchises,
      { itemId: watchlistItem.id, escape: filmPageEscape },
    );
    let addFormHtml = canEdit
      ? `<form class="data-form data-form--inline" data-add-franchise-form><label>${filmPageEscape(ui("Add franchise"))} <input name="franchise" placeholder="${filmPageEscape(ui("Franchise name"))}" required></label><label>${filmPageEscape(ui("Parent (optional)"))} <input name="parent" placeholder="${filmPageEscape(ui("Parent franchise"))}"></label><button type="submit"${watchlistBusy ? " disabled" : ""}>${filmPageEscape(ui("Add"))}</button></form><p class="data-panel-status">${filmPageEscape(ui("Adds a new membership only - an existing one can't be edited or removed here."))}</p>`
      : "";
    if (!franchiseHtml && !addFormHtml) return "";
    return `<section class="film-franchises"><h2>${filmPageEscape(ui("Franchises"))}</h2>${franchiseHtml ? `<div class="film-franchise-links">${franchiseHtml}</div>` : ""}${addFormHtml}</section>`;
  }

  function renderWatchlistDetail() {
    if (!watchlistItem) {
      if (removedWatchlistSnapshot) {
        document.title = `${ui("Removed from watchlist")} · The Oskars`;
        container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Removed from watchlist"))}</h1>${window.renderActionFeedback({ message: ui('Removed "{title}" from your watchlist.', { title: removedWatchlistSnapshot.title }), actionLabel: ui("Undo"), actionAttribute: "data-undo-watchlist-removal", escape: filmPageEscape })}<a href="watchlist-merge.html">${filmPageEscape(ui("Return to watchlist"))}</a></div>`;
        return;
      }
      document.title = `${ui("Watchlist film not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Watchlist film not found"))}</h1><a href="watchlist-merge.html">${filmPageEscape(ui("Return to watchlist"))}</a></div>`;
      return;
    }

    let displayTitle = window.localizedFilmTitle(watchlistItem);
    let localizedTitleMeta = window.hasLocalizedFilmTitle(watchlistItem)
      ? `<span class="leaderboard-meta localized-title-meta">${filmPageEscape(ui("Original title"))}: ${filmPageEscape(watchlistItem.title)}</span>`
      : "";
    let posterHtml = renderPosterArea(watchlistItem);
    let directorHtml = window.renderLinkedDirectors(watchlistItem.director, {
      escape: filmPageEscape,
      expanded: true,
    });
    let tmdbId = watchlistItem.tmdbId || "";
    let metadataHtml = [
      watchlistMetadataRow(
        ui("Year"),
        watchlistItem.year,
        watchlistItem.year ? window.periodPageUrl("year", watchlistItem.year) : "",
      ),
      watchlistMetadataRow(
        "TMDB",
        tmdbId ? `#${tmdbId}` : "",
        tmdbId
          ? `https://www.themoviedb.org/${window.tmdbResourcePath(window.parseTmdbReference(tmdbId))}`
          : "",
      ),
      watchlistMetadataRow(
        "Letterboxd",
        watchlistItem.letterboxdUrl ? "Open on Letterboxd" : "",
        watchlistItem.letterboxdUrl,
      ),
      watchlistMetadataRow(
        ui("Medium"),
        watchlistItem.medium && watchlistItem.medium !== "unknown"
          ? metadataLabel(watchlistItem.medium)
          : "",
      ),
      watchlistMetadataRow(
        ui("Screenplay"),
        watchlistItem.screenplayType && watchlistItem.screenplayType !== "unknown"
          ? metadataLabel(watchlistItem.screenplayType)
          : "",
      ),
      watchlistMetadataRow(ui("Adapted from"), watchlistItem.adaptationSource),
      watchlistMetadataRow(ui("Swedish title"), watchlistItem.swedishTitle),
      watchlistItem.country
        ? `<div><dt>${filmPageEscape(ui("Country"))}</dt><dd>${window.renderCountryLinks(watchlistItem.country, filmPageEscape)}</dd></div>`
        : "",
      watchlistMetadataRow(ui("Runtime"), formatRuntime(watchlistItem.runtimeMinutes)),
    ].join("");
    let archiveMatchHtml = renderArchiveMatchReview();

    document.title = `${displayTitle} · Watchlist · The Oskars`;
    container.innerHTML = `<nav class="detail-breadcrumbs" aria-label="Breadcrumb"><a href="watchlist-merge.html">Watchlist</a><span aria-hidden="true">›</span><span aria-current="page">${filmPageEscape(watchlistItem.title)}</span></nav>
    ${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${filmPageEscape(displayTitle)}</h1>${window.renderWatchlistTierBadge(watchlistItem.tier, { escape: filmPageEscape })}</div>
        ${localizedTitleMeta}
        ${directorHtml ? `<p>${filmPageEscape(ui("by"))} ${directorHtml}</p>` : ""}
        ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}
        ${canEdit ? `<label class="data-field">${filmPageEscape(ui("Interest tier"))}<select name="tier" data-tier-select${watchlistBusy ? " disabled" : ""}>${tierOptions(watchlistItem.tier)}</select></label>` : ""}`,
      actionsHtml: canEdit
        ? `${window.renderCollectionActionButton({ kind: "watched", label: ui("Mark as watched"), escape: filmPageEscape, attributes: { "data-mark-watchlist-watched": true, disabled: watchlistBusy } })}<button type="button" class="danger-button" data-remove-watchlist-film${watchlistBusy ? " disabled" : ""}>${filmPageEscape(ui("Remove from watchlist"))}</button>`
        : "",
    })}
    ${renderWatchlistTagEditor()}
    ${renderWatchlistFranchiseEditor()}
    ${archiveMatchHtml}`;
  }

  async function reloadWatchlistItem() {
    if (!watchlistFranchiseChains) {
      let franchiseCatalog = await window.loadSupabaseFranchiseCatalog();
      watchlistFranchiseChains =
        window.buildSupabaseFranchiseChains(franchiseCatalog);
    }
    watchlistItem = window.supabaseLegacyHydrationWatchlistItem(
      await window.loadSupabaseWatchlistItemDetail(watchlistItem.id),
      0,
      watchlistFranchiseChains,
    );
    render(false);
  }

  function renderPosterArea(film) {
    return window.renderFilmPoster(film, "detail");
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
      !!award && hasOfficialNomination && personalWinner === officialWinner;
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
    let awardsHtml =
      awards.length || officialContext?.nominations.length
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
          ? `<button type="button" data-toggle-film-rewatch>${filmPageEscape(ui(film.wantToRewatch ? "Remove from rewatchlist" : "Want to rewatch"))}</button><button type="button" data-edit-film>${filmPageEscape(ui("Edit"))}</button>`
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
    ${window.renderDetailHeader({ mainHtml: `<h1>${filmPageEscape(ui("Edit {title}", { title: film.title }))}</h1><p>${filmPageEscape(ui("Your rating, notes, tags, and memberships"))}</p>`, actionsHtml: `<button type="submit">${filmPageEscape(ui("Save"))}</button><button type="button" data-cancel-film-edit>${filmPageEscape(ui("Cancel"))}</button>` })}
    <section class="film-edit-section"><h2>${filmPageEscape(ui("Your film data"))}</h2><p class="edit-help">${filmPageEscape(ui("Shared catalog facts and posters are read-only. Corrections are handled through the catalog maintenance workflow."))}</p><div class="film-edit-grid">
      <label>${filmPageEscape(ui("Rating"))} ${window.renderRatingInput({ value: film.rating || "" })}</label>
      <label class="wide">${filmPageEscape(ui("Franchises"))} <textarea name="franchises" rows="5" placeholder="${filmPageEscape(ui("Parent franchise > Subfranchise | rank"))}">${filmPageEscape(window.formatFranchiseMemberships(film.franchises))}</textarea><span class="field-help">${filmPageEscape(ui("New memberships can be added. Existing shared-catalog memberships cannot be removed or corrected here."))}</span></label>
      <label class="wide">${filmPageEscape(ui("Tags"))} <input name="tags" value="${filmPageEscape(window.formatFilmTags(film.tags))}" placeholder="${filmPageEscape(ui("Noir, courtroom drama, rewatch"))}"><span class="field-help">${filmPageEscape(ui("Separate tags with commas."))}</span></label>
      <label class="wide">${filmPageEscape(ui("Review / comment"))} <textarea name="review" rows="5" maxlength="1000">${filmPageEscape(film.review || "")}</textarea><span class="field-help">${filmPageEscape(ui("A short personal note about the film."))}</span></label>
      <label><input type="checkbox" name="wantToRewatch" ${film.wantToRewatch ? "checked" : ""}> ${filmPageEscape(ui("Rewatchlist"))}</label>
      <label>${filmPageEscape(ui("Rewatch tier"))} <select name="rewatchTier">${rewatchTierOptions(film.rewatchTier)}</select></label>
    </div></section>
    <section class="film-edit-section"><h2>${filmPageEscape(ui("Award credits"))}</h2><p class="edit-help">${filmPageEscape(ui("Period, placement, and category define the bracket entry and remain structural. Recipients and details can be edited here."))}</p>
      <div class="leaderboard-wrap"><table class="leaderboard film-edit-awards"><thead><tr><th>${filmPageEscape(ui("Period"))}</th><th>${filmPageEscape(ui("Place"))}</th><th>${filmPageEscape(ui("Category"))}</th><th>${filmPageEscape(ui("Recipients"))}</th><th>${filmPageEscape(ui("Detail"))}</th></tr></thead><tbody>${renderEditAwardRows(awards)}</tbody></table></div>
    </section>
    <div class="film-edit-actions"><button type="submit">${filmPageEscape(ui("Save changes"))}</button><button type="button" data-cancel-film-edit>${filmPageEscape(ui("Cancel"))}</button></div>
  </form>`;
    window.enhanceRatingInputs?.(container);
  }

  // An Unseen (catalog-only) film has no personal record at all - it's
  // reached either via film.html?tmdb=<id> (a shared-archive card, a
  // director page's Unseen grid, or a header search "Unseen" result built
  // before this film's real id was known) or film.html?id=<filmId> (every
  // other Unseen link, once resolved to the film's own Supabase id).
  // Rendered with a deliberately separate, much simpler template rather
  // than threading preview-mode conditionals through renderView's full
  // local-film layout, which assumes dozens of fields (medium,
  // screenplayType, rank, awards, notes...) a shared record never has.
  function currentSharedPreview() {
    return previewTmdbId
      ? window.sharedArchiveCandidateFilmByTmdbId?.(previewTmdbId)
      : window.sharedArchiveCandidateFilmById?.(filmId);
  }
  function renderSharedPreview() {
    let preview = currentSharedPreview();
    if (!preview) {
      let status = window.OSKARS_SHARED_FILM_ARCHIVE_STATUS;
      document.title = `${ui("Unseen film")} · The Oskars`;
      let message =
        status === "loading" || status === "idle"
          ? ui("Loading unseen films…")
          : ui("This film could not be found.");
      container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Unseen film"))}</h1><p>${filmPageEscape(message)}</p><a href="index.html">${filmPageEscape(ui("Return home"))}</a></div>`;
      return;
    }
    let title = window.localizedFilmTitle?.(preview) || preview.title;
    document.title = `${title} · The Oskars`;
    // Same director-link/metadata construction renderView uses below (director
    // as its own linked "by X" line under the title, not a metadata dt/dd row;
    // renderLinkedDirectors links every name to person.html regardless of
    // whether that person has any local record yet - see person.js's matching
    // preview-mode fallback), so this page reads like a real film page rather
    // than a stripped-down lookalike.
    let director = window.sharedArchiveFilmDirectorNames(preview).join(", ");
    let directorHtml = window.renderLinkedDirectors(director, {
      escape: filmPageEscape,
      expanded: true,
    });
    let localizedTitle = window.localizedFilmTitle?.(preview);
    let localizedTitleMeta =
      preview.swedishTitle && preview.swedishTitle !== preview.title
        ? `<p class="film-localized-title">${filmPageEscape(preview.swedishTitle === localizedTitle ? preview.title : preview.swedishTitle)}</p>`
        : "";
    let metadataRows = [
      preview.tmdbId
        ? [
            "TMDB",
            `#${preview.tmdbId}`,
            `https://www.themoviedb.org/${window.tmdbResourcePath(window.parseTmdbReference(preview.tmdbId))}`,
          ]
        : null,
      preview.primaryCountry || preview.country
        ? [ui("Country"), preview.primaryCountry || preview.country]
        : null,
      preview.runtimeMinutes
        ? [ui("Runtime"), formatRuntime(preview.runtimeMinutes)]
        : null,
    ].filter(Boolean);
    let metadataHtml = metadataRows
      .map(
        ([label, value, href]) =>
          `<div><dt>${filmPageEscape(label)}</dt><dd>${href ? `<a href="${filmPageEscape(href)}" target="_blank" rel="noopener">${filmPageEscape(value)}</a>` : filmPageEscape(value)}</dd></div>`,
      )
      .join("");
    let posterHtml = window.renderFilmPoster(
      { poster: preview.poster, title },
      "detail",
    );
    container.innerHTML = `${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${filmPageEscape(title)}</h1></div>${localizedTitleMeta}${directorHtml ? `<p>${filmPageEscape(ui("by"))} ${directorHtml}</p>` : ""}
      <p>${filmPageEscape(preview.year)}</p>
      ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}`,
      actionsHtml: canEdit
        ? `<div class="collection-action-buttons">${window.renderCollectionActionButton({ kind: "watchlist", label: ui("Add to watchlist"), escape: filmPageEscape, attributes: { "data-add-shared-preview-watchlist": true } })}${window.renderCollectionActionButton({ kind: "watched", label: ui("Add to watched"), escape: filmPageEscape, attributes: { "data-add-shared-preview-watched": true } })}</div>`
        : "",
    })}
    <p class="detail-empty">${filmPageEscape(ui("This film is in the catalog but hasn't been added to your own collection yet."))}</p>`;
  }

  function render(editing = false) {
    let finishRenderTimer = window.startOskarsPerformance?.("film:render");
    let film = currentFilm();
    if (!film && isWatchlistDetail) {
      renderWatchlistDetail();
      finishRenderTimer?.("watchlist detail");
      return;
    }
    if (!film && (previewTmdbId || filmId)) {
      renderSharedPreview();
      finishRenderTimer?.("shared preview");
      return;
    }
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
    if (event.target.closest("[data-mark-watchlist-watched]")) {
      renderWatchlistWatchedForm();
      return;
    }
    if (event.target.closest("[data-cancel-watchlist-transition]")) {
      render(false);
      return;
    }
    let removeTagButton = event.target.closest("[data-remove-tag]");
    if (removeTagButton) {
      watchlistBusy = true;
      render(false);
      try {
        await window.removeSupabaseFilmTag(
          watchlistItem.supabaseFilmId,
          removeTagButton.dataset.removeTag,
        );
        await reloadWatchlistItem();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    let removeWatchlistButton = event.target.closest(
      "[data-remove-watchlist-film]",
    );
    if (removeWatchlistButton) {
      watchlistBusy = true;
      render(false);
      try {
        removedWatchlistSnapshot = {
          title: watchlistItem.title,
          filmId: watchlistItem.supabaseFilmId,
          tier: watchlistItem.tier,
        };
        await window.removeFromSupabaseWatchlist(watchlistItem.id);
        watchlistItem = null;
        render(false);
      } catch (err) {
        alert(err.message || String(err));
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    if (event.target.closest("[data-undo-watchlist-removal]")) {
      if (!removedWatchlistSnapshot) return;
      watchlistBusy = true;
      render(false);
      try {
        await window.addToSupabaseWatchlist(removedWatchlistSnapshot.filmId, {
          tier: removedWatchlistSnapshot.tier,
        });
        removedWatchlistSnapshot = null;
        // Undo recreates a watchlist row for the same film - the URL
        // (film.html?id=<filmId>) doesn't change, unlike before this merge
        // when a new watchlist row meant a new watchlist-film.html?id=
        // <rowId> URL to navigate to.
        window.location.href = window.filmPageUrl(filmId);
      } catch (err) {
        alert(err.message || String(err));
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    if (event.target.closest("[data-add-shared-preview-watchlist]")) {
      let preview = currentSharedPreview();
      let backup = window.cloneRecord(window.getSerializableState());
      try {
        let result = window.addFilmRecordToWatchlist(preview);
        if (!result.ok)
          throw new Error(result.reason || ui("Could not add this film."));
        await window.save();
        // One canonical URL regardless of status (issue #451/#457) - no
        // need to look up the new watchlist row's own id anymore, the
        // film's own id already resolves the detail page.
        window.location.href = window.filmPageUrl(result.item.supabaseFilmId);
      } catch (err) {
        window.hydrateState(backup);
        alert(err.message || String(err));
      }
      return;
    }
    let addWatchedButton = event.target.closest(
      "[data-add-shared-preview-watched]",
    );
    if (addWatchedButton) {
      let preview = currentSharedPreview();
      window.setCollectionActionButtonState(addWatchedButton, {
        label: ui("Adding…"),
        busy: true,
      });
      try {
        let result = await window.addFilmRecordToWatched(preview);
        if (!result.ok)
          throw new Error(result.reason || ui("Could not add this film."));
        window.location.href = result.intakeId
          ? window.intakePageUrl(result.intakeId)
          : window.filmPageUrl(result.filmId);
      } catch (err) {
        window.setCollectionActionButtonState(addWatchedButton, {
          label: ui("Add to watched"),
        });
        alert(err.message || String(err));
      }
      return;
    }
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
        await window.save();
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
  });

  container.addEventListener("change", async (event) => {
    let tierSelect = event.target.closest("[data-tier-select]");
    if (tierSelect) {
      watchlistBusy = true;
      render(false);
      try {
        await window.setSupabaseWatchlistTier(watchlistItem.id, tierSelect.value);
        await reloadWatchlistItem();
      } catch (err) {
        alert(err.message || String(err));
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    let input = event.target.closest('input[name="filmAwardsView"]');
    if (!input) return;
    awardsView = input.value;
    updateFilmViewUrl();
    render(false);
  });

  container.addEventListener("submit", async (event) => {
    let transitionForm = event.target.closest("#markWatchlistWatchedForm");
    if (transitionForm) {
      event.preventDefault();
      let values = Object.fromEntries(new FormData(transitionForm).entries());
      let parsed = window.parseFilmRating(values.rating);
      watchlistBusy = true;
      render(false);
      try {
        let workflow = await window.createSupabaseWatchlistWatchedIntake(
          watchlistItem.id,
          {
            rating: parsed.value || null,
            ratingModifier: parsed.modifier,
            dateWatched: values.dateWatched,
            platform: values.platform,
            views: values.views,
          },
        );
        window.location.href = window.intakePageUrl(workflow.id);
      } catch (err) {
        alert(err.message || String(err));
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    let watchlistTagForm = event.target.closest("[data-add-tag-form]");
    if (watchlistTagForm) {
      event.preventDefault();
      let name = new FormData(watchlistTagForm).get("tag")?.trim();
      if (!name) return;
      watchlistBusy = true;
      render(false);
      try {
        await window.addSupabaseFilmTag(watchlistItem.supabaseFilmId, name);
        await reloadWatchlistItem();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    let watchlistFranchiseForm = event.target.closest(
      "[data-add-franchise-form]",
    );
    if (watchlistFranchiseForm) {
      event.preventDefault();
      let values = Object.fromEntries(
        new FormData(watchlistFranchiseForm).entries(),
      );
      let name = values.franchise?.trim();
      if (!name) return;
      watchlistBusy = true;
      render(false);
      try {
        await window.addSupabaseFilmFranchiseMembership(
          watchlistItem.supabaseFilmId,
          name,
          values.parent?.trim() || "",
        );
        await reloadWatchlistItem();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    let form = event.target.closest("#filmEditForm");
    if (!form) return;
    event.preventDefault();
    let backup = window.cloneRecord(window.getSerializableState());
    try {
      let film = currentFilm();
      let values = Object.assign(
        window.filmMetadataFormValues(film),
        Object.fromEntries(new FormData(form).entries()),
      );
      values.wantToRewatch = form.elements.wantToRewatch.checked;
      values.franchises = window.formatFranchiseMemberships(
        window.normalizeFranchiseMemberships([
          ...(film.franchises || []),
          ...window.parseFranchiseMemberships(values.franchises),
        ]),
      );
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
      await window.save();
      filmId = nextId;
      updateFilmViewUrl();
      render(false);
    } catch (err) {
      window.hydrateState(backup);
      alert(err.message || String(err));
      render(true);
    }
  });

  // A direct/bookmarked film.html?tmdb=... or ?id=<unseenFilmId> load can
  // land here before the async shared-archive pull finishes - re-render
  // once it does so the preview appears without a manual reload (same fix
  // as person.js's director-page Unseen section). Guarded by
  // !isWatchlistDetail so an archive refresh doesn't spuriously re-render
  // a Watchlisted-detail page too, which also has filmId set.
  window.onSharedFilmArchiveChange?.(() => {
    if (!currentFilm() && !isWatchlistDetail && (previewTmdbId || filmId))
      render(false);
  });

  render(false);
})();
