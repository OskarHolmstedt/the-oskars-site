/** @file Orchestrates period identity, films, awards, filters, view state, ranking edits, and submodule rendering. */

(function () {
  let periodEscape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;

  window.load();
  let periodIdentityState = window
    .createPageViewState({
      path: "period.html",
      schema: {
        type: { default: "" },
        key: { default: "" },
        returnIntake: { default: "" },
      },
    })
    .read();
  let type = window.periodPageType(periodIdentityState.type);
  let key = type === "alltime" ? "alltime" : periodIdentityState.key;
  let container = document.getElementById("periodPage");
  let valid =
    (type === "year" && /^\d{4}(?:\/\d{2})?$/.test(key)) ||
    ((type === "decade" || type === "century") && /^\d{4}s$/.test(key)) ||
    (type === "alltime" && key === "alltime");
  let awardPeriodType =
    type === "year"
      ? "years"
      : type === "decade"
        ? "decades"
        : type === "century"
          ? "centuries"
          : "allTime";

  if (!valid) {
    document.title = `${ui("Period not found")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${periodEscape(ui("Period not found"))}</h1><a href="index.html">${periodEscape(ui("Return home"))}</a></div>`;
    return;
  }

  function belongsToPeriod(film) {
    if (film?.canonicalComposite && film?.suppressAllTimeRank)
      return type === "year" && String(film.year || "") === key;
    if (type === "alltime") return Number(film.allTimeRank) > 0;
    if (type === "year") return String(film.year || "") === key;
    if (type === "decade") return window.getDecadeKey(film.year) === key;
    return window.getCenturyKey(film.year) === key;
  }

  function otherBelongsToPeriod(film) {
    if (!/^\d{4}$/.test(String(film?.year || ""))) return false;
    if (type === "alltime") return true;
    if (type === "year") return String(film.year) === key;
    if (type === "decade") return window.getDecadeKey(film.year) === key;
    return window.getCenturyKey(film.year) === key;
  }

  function awardInPeriod(award) {
    return (
      String(award.year || "") === key &&
      window.getAwardPeriodType(award) === awardPeriodType
    );
  }

  function rankForFilm(film) {
    return type === "year"
      ? film.yearRank
      : type === "decade"
        ? film.decadeRank
        : type === "century"
          ? film.centuryRank
          : film.allTimeRank;
  }

  function canonicalCompositeFilm(film) {
    return film?.canonicalComposite?.id
      ? window.findFilmById(film.canonicalComposite.id)
      : null;
  }

  function canonicalRankContext(film) {
    let canonical = canonicalCompositeFilm(film);
    if (!canonical) return null;
    let rank = Number(canonical.allTimeRank || canonical.rank);
    return {
      film: canonical,
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
    };
  }

  function periodSortRankForFilm(film) {
    let rank = Number(rankForFilm(film));
    if (Number.isFinite(rank) && rank > 0) return rank;
    let context = canonicalRankContext(film);
    return context?.rank || 0;
  }

  function canonicalRankContextHtml(film, escape = periodEscape) {
    let context = canonicalRankContext(film);
    if (!context?.film) return "";
    let title = window.localizedFilmTitle?.(context.film) || context.film.title;
    let prefix = context.rank ? `#${context.rank} ` : "";
    return `<div class="canonical-rank-context">${escape(ui("Part of"))} <a class="table-film-link" href="${escape(window.filmPageUrl(context.film.id))}">${escape(prefix + title)}</a></div>`;
  }

  // Comparator over raw watched films or raw watchlist items via the shared
  // axis resolver (issue #53) - `isWatchlistItem` says which of the two
  // record types both values are.
  function periodCompareValues(left, right, axis, order, isWatchlistItem) {
    let record = (value) =>
      isWatchlistItem ? { item: value } : { film: value };
    return window.compareFilmAxisRecords(record(left), record(right), {
      axis,
      order,
    });
  }

  function titlesLikelyMatch(leftTitle, rightTitle) {
    let comparable = (value) =>
      normalizeTitle(value).replace(/[^a-z0-9\u00c0-\u024f]+/g, "");
    let left = comparable(leftTitle);
    let right = comparable(rightTitle);
    return (
      left === right ||
      (Math.min(left.length, right.length) >= 8 &&
        (left.startsWith(right) || right.startsWith(left)))
    );
  }

  function mergePeriodAwards(first, second) {
    let merged = [];
    [...(first || []), ...(second || [])].forEach((award) => {
      if (!merged.some((existing) => window.sameAward(existing, award)))
        merged.push(award);
    });
    return merged;
  }

  function awardsWithSourceFilm(film) {
    return (film?.awards || []).map((award) =>
      Object.assign({}, award, {
        sourceFilmId: film.id || "",
      }),
    );
  }

  function rankedCounterpart(film) {
    if (/^\d{4}$/.test(String(film.year || ""))) return null;
    return Object.values(state.filmsById || {}).find(
      (candidate) =>
        Number(candidate.allTimeRank) > 0 &&
        /^\d{4}$/.test(String(candidate.year || "")) &&
        belongsToPeriod(candidate) &&
        titlesLikelyMatch(candidate.title, film.title),
    );
  }

  let allFilms = [];
  let hasNominees = false;
  let canEditBracket = false;

  function rebuildPeriodViewModel() {
    let periodFilmMap = new Map();
    Object.values(state.filmsById || {})
      .filter(
        (film) =>
          belongsToPeriod(film) || (film.awards || []).some(awardInPeriod),
      )
      .forEach((sourceFilm) => {
        let counterpart = rankedCounterpart(sourceFilm);
        let film = counterpart
          ? Object.assign({}, counterpart, {
              awards: mergePeriodAwards(
                awardsWithSourceFilm(counterpart),
                awardsWithSourceFilm(sourceFilm),
              ),
            })
          : Object.assign({}, sourceFilm);
        if (!counterpart) film.awards = awardsWithSourceFilm(sourceFilm);
        let existing = periodFilmMap.get(film.id);
        if (existing)
          existing.awards = mergePeriodAwards(existing.awards, film.awards);
        else periodFilmMap.set(film.id, film);
      });
    allFilms = window.rankByAllTimeRank(
      periodFilmMap.values(),
      (film) => ({ allTimeRank: periodSortRankForFilm(film), title: film.title }),
      { rankTieBreak: false, yearFallback: false },
    );
    hasNominees = allFilms.some((film) =>
      (film.awards || []).some(awardInPeriod),
    );
    canEditBracket =
      hasNominees &&
      (type === "year" || type === "decade" || type === "century");
  }

  rebuildPeriodViewModel();
  // Academy Awards first (the primary source, and the only one with a
  // personal-pick comparison), then every other populated source
  // alphabetically - matches completion.js's own source ordering.
  let officialSourceIds =
    type === "year"
      ? Object.keys(window.state?.officialResults || {}).sort(
          (left, right) =>
            (left === "academy-awards" ? -1 : right === "academy-awards" ? 1 : 0) ||
            left.localeCompare(right),
        )
      : [];
  let officialResult =
    type === "year" ? window.officialResultsPeriod(key) : null;
  let officialResultsBySource = officialSourceIds
    .map((sourceId) => ({
      sourceId,
      result: window.officialResultsPeriod(key, sourceId),
    }))
    .filter((entry) => entry.result);
  let hasOfficialResults = officialResultsBySource.length > 0;
  let countryValues = [
    ...new Set(
      allFilms.flatMap((film) => window.countryListValues(film.country)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  let exactRatingValues = [
    ...new Set(
      allFilms.map((film) => window.filmRatingValue(film)).filter(Boolean),
    ),
  ].sort((left, right) => right - left);
  let periodOrderValues = new Set([
    "rank",
    "title",
    "year",
    "rating",
    "wins",
    "nominations",
    "score",
    "shuffle",
  ]);
  let periodUrlState = window.createPageViewState({
    path: "period.html",
    preserveUnknown: true,
    schema: {
      type: {
        default: type,
        parse: (value) => window.periodPageType(value),
        omit: () => false,
      },
      key: {
        default: key,
        parse: (value, state) => (state.type === "alltime" ? "alltime" : value),
        omit: () => false,
      },
      viewMode: {
        param: "view",
        default: hasNominees ? "awards" : "films",
        parse: (value) =>
          value === "official" && hasOfficialResults
            ? "official"
            : value === "other"
              ? "other"
            : value === "rewatch"
              ? "rewatch"
              : value === "watchlist"
                ? "watchlist"
                : !hasNominees || value === "films"
                  ? "films"
                  : "awards",
        omit: (value) => value === "awards",
        clear: ["watchStatus"],
      },
      edit: {
        default: "",
        validate: (value) =>
          ["", "bracket", "ranking", "order", "interest"].includes(value),
      },
      scope: {
        default: "all",
        parse: (value) =>
          value === "all" || !hasNominees ? "all" : "nominees",
        omit: (value, state) => state.viewMode !== "films" || value === "all",
      },
      mediumFilter: {
        param: "medium",
        default: "all",
        validate: (value) =>
          window.filmFilterDefinition("medium").validate(value),
        omit: (value, state) => state.viewMode !== "films" || value === "all",
      },
      screenplayFilter: {
        param: "screenplay",
        default: "all",
        validate: (value) =>
          window.filmFilterDefinition("screenplay").validate(value),
        omit: (value, state) => state.viewMode !== "films" || value === "all",
      },
      sourceFilter: {
        param: "source",
        default: "all",
        parse: (value) =>
          window.parseFilmFilterValue("adaptationSource", value, {
            values: window.getAdaptationSources(allFilms),
            defaultValue: "all",
          }),
        omit: (value, state) => state.viewMode !== "films" || value === "all",
      },
      countryFilter: {
        param: "country",
        default: "all",
        parse: (value) =>
          window.parseFilmFilterValue("country", value, {
            values: countryValues,
            defaultValue: "all",
          }),
        omit: (value, state) => state.viewMode !== "films" || value === "all",
      },
      exactRatingFilter: {
        param: "rating",
        default: "all",
        parse: (value) => {
          let rating = Number(value) || window.filmRatingValue(value);
          return window.parseFilmFilterValue("exactRating", rating, {
            values: exactRatingValues,
            defaultValue: "all",
          });
        },
        omit: (value, state) => state.viewMode !== "films" || value === "all",
      },
      minimumRatingFilter: {
        param: "minRating",
        default: 0,
        parse: (value) => {
          let rating = Number(value) || 0;
          return window.parseFilmFilterValue("minimumRating", rating, {
            defaultValue: 0,
          });
        },
        omit: (value, state) => state.viewMode !== "films" || !value,
      },
      maximumRatingFilter: {
        param: "maxRating",
        default: 0,
        parse: (value) => {
          let rating = Number(value) || 0;
          return window.parseFilmFilterValue("maximumRating", rating, {
            defaultValue: 0,
          });
        },
        omit: (value, state) => state.viewMode !== "films" || !value,
      },
      // Shared between Films and Rewatchlist, like sort order/direction and
      // grid/list layout already are - unlike medium/screenplay/rating,
      // which stay films-only.
      minimumRuntimeFilter: {
        param: "filmMinRuntime",
        default: 0,
        parse: (value) => {
          let runtime = Number(value) || 0;
          return window.parseFilmFilterValue("minimumRuntime", runtime, {
            defaultValue: 0,
          });
        },
        omit: (value, state) =>
          (state.viewMode !== "films" && state.viewMode !== "rewatch") ||
          !value,
      },
      maximumRuntimeFilter: {
        param: "filmMaxRuntime",
        default: 0,
        parse: (value) => {
          let runtime = Number(value) || 0;
          return window.parseFilmFilterValue("maximumRuntime", runtime, {
            defaultValue: 0,
          });
        },
        omit: (value, state) =>
          (state.viewMode !== "films" && state.viewMode !== "rewatch") ||
          !value,
      },
      watchlistTierFilter: {
        param: "tiers",
        aliases: ["tier", "watchTier"],
        default: null,
        read: (params) =>
          window.parseWatchlistTierFilters(
            params.get("tiers") || params.get("tier") || params.get("watchTier"),
          ),
        write(params, value, state) {
          if (state.viewMode !== "watchlist" || value === null) return;
          params.set(
            "tiers",
            value.length
              ? value.map((tier) => tier || "unset").join(",")
              : "none",
          );
        },
      },
      rewatchTierFilter: {
        param: "rewatchTiers",
        default: null,
        read: (params) =>
          window.parseWatchlistTierFilters(params.get("rewatchTiers")),
        write(params, value, state) {
          if (state.viewMode !== "rewatch" || value === null) return;
          params.set(
            "rewatchTiers",
            value.length
              ? value.map((tier) => tier || "unset").join(",")
              : "none",
          );
        },
      },
      watchlistSearch: {
        param: "q",
        default: "",
        omit: (value, state) => state.viewMode !== "watchlist" || !value,
      },
      watchlistDirector: {
        param: "director",
        default: "",
        omit: (value, state) => state.viewMode !== "watchlist" || !value,
      },
      watchlistMinRuntimeFilter: {
        param: "minRuntime",
        default: 0,
        parse: (value) => {
          let runtime = Number(value) || 0;
          return window.parseFilmFilterValue("minimumRuntime", runtime, {
            defaultValue: 0,
          });
        },
        omit: (value, state) => state.viewMode !== "watchlist" || !value,
      },
      watchlistMaxRuntimeFilter: {
        param: "maxRuntime",
        default: 0,
        parse: (value) => {
          let runtime = Number(value) || 0;
          return window.parseFilmFilterValue("maximumRuntime", runtime, {
            defaultValue: 0,
          });
        },
        omit: (value, state) => state.viewMode !== "watchlist" || !value,
      },
      watchlistSubCentury: {
        param: "subCentury",
        default: "all",
        validate: (value) => value === "all" || /^\d{4}s$/.test(value),
        omit: (value, state) =>
          state.viewMode !== "watchlist" ||
          state.type !== "alltime" ||
          value === "all",
      },
      watchlistSubDecade: {
        param: "subDecade",
        default: "all",
        validate: (value) => value === "all" || /^\d{4}s$/.test(value),
        omit: (value, state) =>
          state.viewMode !== "watchlist" ||
          (state.type !== "century" && state.type !== "alltime") ||
          value === "all",
      },
      watchlistSubYear: {
        param: "subYear",
        default: "all",
        validate: (value) => value === "all" || /^\d{4}$/.test(value),
        omit: (value, state) =>
          state.viewMode !== "watchlist" ||
          state.type === "year" ||
          value === "all",
      },
      periodOrder: {
        param: "order",
        default: (state) =>
          state.viewMode === "other"
            ? state.type === "year"
              ? "title"
              : "year"
            : "rank",
        validate: (value) => periodOrderValues.has(value),
        omit: (value, state) =>
          state.viewMode === "awards" ||
          value ===
            (state.viewMode === "other"
              ? state.type === "year"
                ? "title"
                : "year"
              : "rank"),
      },
      periodDirection: {
        param: "dir",
        default: (state) => window.defaultOrderForFilmAxis(state.periodOrder),
        validate: (value) => value === "asc" || value === "desc",
        omit: (value, state) =>
          state.viewMode === "awards" ||
          state.periodOrder === "shuffle" ||
          value === window.defaultOrderForFilmAxis(state.periodOrder),
      },
      layout: {
        default: "grid",
        validate: (value) => value === "grid" || value === "list",
      },
      showAwards: {
        param: "awards",
        default: false,
        parse: (value) => value !== "0",
        serialize: (value) => (value ? "1" : "0"),
        omit: (value, state) =>
          (state.viewMode !== "films" && state.viewMode !== "rewatch") ||
          value === false,
      },
      filmPage: {
        param: "page",
        default: 1,
        parse: (value) => Math.max(1, Number.parseInt(value, 10) || 1),
        omit: (value, state) => state.viewMode === "awards" || value <= 1,
      },
    },
  });
  let initialViewState = periodUrlState.read();
  let scope = initialViewState.scope;
  let viewMode = initialViewState.viewMode;
  let editMode =
    canEditBracket &&
    viewMode === "awards" &&
    initialViewState.edit === "bracket";
  let rankingEditMode =
    viewMode === "films" && initialViewState.edit === "ranking";
  let watchlistOrderEditMode =
    viewMode === "watchlist" && initialViewState.edit === "order";
  let tierEditMode =
    viewMode === "watchlist" && initialViewState.edit === "interest";
  let mediumFilter = initialViewState.mediumFilter;
  let screenplayFilter = initialViewState.screenplayFilter;
  let sourceFilter = initialViewState.sourceFilter;
  let countryFilter = initialViewState.countryFilter;
  let exactRatingFilter = initialViewState.exactRatingFilter;
  let minimumRatingFilter = initialViewState.minimumRatingFilter;
  let maximumRatingFilter = initialViewState.maximumRatingFilter;
  let minimumRuntimeFilter = initialViewState.minimumRuntimeFilter;
  let maximumRuntimeFilter = initialViewState.maximumRuntimeFilter;
  let watchlistTierFilter = initialViewState.watchlistTierFilter;
  let rewatchTierFilter = initialViewState.rewatchTierFilter;
  let watchlistSearch = initialViewState.watchlistSearch;
  let watchlistDirector = initialViewState.watchlistDirector;
  let watchlistMinRuntimeFilter = initialViewState.watchlistMinRuntimeFilter;
  let watchlistMaxRuntimeFilter = initialViewState.watchlistMaxRuntimeFilter;
  let watchlistSubCentury = initialViewState.watchlistSubCentury;
  let watchlistSubDecade = initialViewState.watchlistSubDecade;
  let watchlistSubYear = initialViewState.watchlistSubYear;
  let periodOrder = initialViewState.periodOrder;
  let periodDirection = initialViewState.periodDirection;
  let layout = initialViewState.layout;
  let showAwards = initialViewState.showAwards;
  let shuffleSeed = String(Date.now());
  const FILMS_PER_PAGE = 100;
  let filmPage = initialViewState.filmPage;
  let visibleFilmPage = [];
  let visibleWatchlistPage = [];
  let fetchedPosterPage = "";
  let fetchedWatchlistPosterPage = "";
  let draggedAwardData = null;
  let draggedRankingData = null;
  let bulkTierControl = null;
  let decadeMergeOpen = false;
  let decadeMergeCategory = "";
  let filmMinRuntimeRenderTimer = null;
  let filmMaxRuntimeRenderTimer = null;
  // Disposable, not persisted to the URL or state: recomputed from the
  // current filter every time it's shown rather than saved anywhere,
  // deliberately lighter than "Start project" (issue #163).
  let watchlistQueueVisible = false;

  function periodViewStateValues() {
    return {
      type,
      key,
      viewMode,
      edit:
        viewMode === "awards" && editMode && canEditBracket
          ? "bracket"
          : viewMode === "films" && rankingEditMode
            ? "ranking"
            : viewMode === "watchlist" && tierEditMode
              ? "interest"
              : viewMode === "watchlist" && watchlistOrderEditMode
                ? "order"
                : "",
      scope,
      mediumFilter,
      screenplayFilter,
      sourceFilter,
      countryFilter,
      exactRatingFilter,
      minimumRatingFilter,
      maximumRatingFilter,
      minimumRuntimeFilter,
      maximumRuntimeFilter,
      watchlistTierFilter,
      rewatchTierFilter,
      watchlistSearch,
      watchlistDirector,
      watchlistMinRuntimeFilter,
      watchlistMaxRuntimeFilter,
      watchlistSubCentury,
      watchlistSubDecade,
      watchlistSubYear,
      periodOrder,
      periodDirection,
      layout,
      showAwards,
      filmPage,
    };
  }

  function updateViewUrl() {
    periodUrlState.replace(periodViewStateValues());
  }

  // Shared by Films and Rewatchlist, unlike the rest of matchesMetadataFilters
  // below (medium/screenplay/source/country/rating stay films-only).
  function matchesRuntimeFilter(film) {
    return window.filmMatchesFilters(film, {
      minimumRuntime: minimumRuntimeFilter,
      maximumRuntime: maximumRuntimeFilter,
    });
  }

  function matchesMetadataFilters(film) {
    return (
      window.filmMatchesFilters(film, {
        medium: mediumFilter,
        screenplay: screenplayFilter,
        adaptationSource: sourceFilter,
        country: countryFilter,
        exactRating: exactRatingFilter,
        minimumRating: minimumRatingFilter,
        maximumRating: maximumRatingFilter,
      }) && matchesRuntimeFilter(film)
    );
  }

  function matchesRewatchTierFilter(film) {
    if (rewatchTierFilter === null) return true;
    return rewatchTierFilter.includes(
      window.normalizeWatchlistTier(film.rewatchTier),
    );
  }

  // Period/runtime-filtered but not yet tier-filtered, so tier-toggle counts
  // (renderRewatchTierFilter) never read 0 for the tier the user just picked -
  // same reasoning as window.periodWatchlistBaseEntries/window.renderWatchlistTierFilter
  // in period/watchlist-view.js.
  function periodRewatchBaseFilms() {
    let filmsById = new Map();
    [
      ...Object.values(state.filmsById || {}),
      ...(state.watchedOther || []),
    ].forEach((film) => {
      if (
        film.wantToRewatch &&
        /^\d{4}$/.test(String(film.year || "")) &&
        window.filmMatchesFilters(
          film,
          { period: `${type}:${key}` },
          { period: { alltimeMatchesAll: true } },
        ) &&
        matchesRuntimeFilter(film)
      )
        filmsById.set(film.id, film);
    });
    return [...filmsById.values()];
  }

  function periodRewatchFilms() {
    return periodRewatchBaseFilms()
      .filter((film) => matchesRewatchTierFilter(film))
      .sort((left, right) => {
        let tierComparison =
          window.watchlistTierRank(left.rewatchTier) -
          window.watchlistTierRank(right.rewatchTier);
        return (
          tierComparison ||
          window.compareByAllTimeRank(left, right, undefined, {
            rankTieBreak: false,
            yearFallback: false,
          })
        );
      });
  }

  function periodOtherFilms() {
    return (state.watchedOther || []).filter(otherBelongsToPeriod);
  }

  function renderPeriodHighlights() {
    let films = Object.values(state.filmsById || {}).filter(
      (film) =>
        /^\d{4}$/.test(String(film.year || "")) && belongsToPeriod(film),
    );
    return window.renderPeriodHighlights({
      type,
      key,
      films,
      rankForFilm,
      escape: periodEscape,
    });
  }

  function renderRatingHistogram() {
    return window.renderRatingHistogram(allFilms);
  }

  function selectedRewatchTierSet() {
    return new Set(
      rewatchTierFilter === null
        ? window.watchlistTierFilterValues()
        : rewatchTierFilter,
    );
  }

  function renderRewatchTierFilter() {
    let films = periodRewatchBaseFilms();
    let counts = new Map(
      window.watchlistTierFilterValues().map((tier) => [tier, 0]),
    );
    films.forEach((film) => {
      let tier = window.normalizeWatchlistTier(film.rewatchTier);
      counts.set(tier, (counts.get(tier) || 0) + 1);
    });
    let selected = selectedRewatchTierSet();
    let buttons = window.watchlistTierFilterValues()
      .map((tier) => {
        let label = tier || ui("Unset");
        let active = selected.has(tier);
        let cls = tier ? ` tier-${tier.toLowerCase()}` : "";
        return `<button type="button" class="watchlist-tier-filter-button${active ? " is-active" : ""}${cls}" data-period-rewatch-tier-toggle="${periodEscape(tier || "unset")}" aria-pressed="${active ? "true" : "false"}"><span>${periodEscape(label)}</span><small>${periodEscape(counts.get(tier) || 0)}</small></button>`;
      })
      .join("");
    return `<fieldset class="watchlist-filter-card watchlist-tier-filter"><legend>${periodEscape(ui("Interest"))}</legend><div>${buttons}</div></fieldset>`;
  }

  function periodViewUrl(next = {}) {
    let overrides = {};
    if (next.view !== undefined) overrides.viewMode = next.view;
    if (next.layout !== undefined) overrides.layout = next.layout;
    if (next.showAwards !== undefined) overrides.showAwards = next.showAwards;
    if (next.page !== undefined) overrides.filmPage = Number(next.page) || 1;
    return periodUrlState.build(periodViewStateValues(), overrides);
  }

  // Standard collection rows (issue #135): Period rank | Film | Director |
  // Rating, with year and the single all-time rank presentation in Film
  // metadata and the canonical-composite context kept below it.
  function renderPeriodFilmList(films, options = {}) {
    if (!films.length)
      return `<div class="detail-empty"><p>${periodEscape(ui("No films"))}</p></div>`;
    let rows = films
      .map((film) => {
        let rank = rankForFilm(film);
        return `<tr><td class="leaderboard-position">${periodEscape(rank || "")}</td>${window.renderFilmIdentityCell(
          film,
          {
            escape: periodEscape,
            year: true,
            allTimeRank: true,
            extraHtml: canonicalRankContextHtml(film),
          },
        )}<td class="film-people-cell">${window.renderLinkedDirectors(filmDirectorNames(film), { escape: periodEscape, assumeIndexed: true })}</td>${window.renderRatingTierCell(
          { film },
          {
            escape: periodEscape,
            editHtml: options.showRewatchTier
              ? window.renderWatchlistTierBadge(film.rewatchTier, {
                  escape: periodEscape,
                })
              : "",
          },
        )}</tr>`;
      })
      .join("");
    return window.renderLeaderboardTable({
      headers: [
        ui("Rank"),
        ui("Film"),
        ui("Director"),
        options.showRewatchTier ? ui("Interest") : ui("Rating"),
      ].map(periodEscape),
      rows,
    });
  }

  function renderOtherWatchedList(films) {
    if (!films.length)
      return `<div class="detail-empty"><p>${periodEscape(ui("No other watched entries in this period."))}</p></div>`;
    let rows = films
      .map(
        (film) => `<tr><td><a class="period-link" href="${periodEscape(`${window.periodPageUrl("year", film.year)}&view=other`)}">${periodEscape(film.year || "")}</a></td>${window.renderFilmIdentityCell(film, { escape: periodEscape })}<td>${periodEscape(film.type || ui("Other"))}</td><td class="film-people-cell">${window.renderLinkedDirectors(film, { escape: periodEscape })}</td>${window.renderRatingTierCell({ film }, { escape: periodEscape })}</tr>`,
      )
      .join("");
    return window.renderLeaderboardTable({
      headers: [ui("Year"), ui("Title"), ui("Type"), ui("Director"), ui("Rating")].map(periodEscape),
      rows,
    });
  }

  function renderOtherWatchedGrid(films) {
    return films
      .map((film) =>
        window.renderSharedFilmCard(film, {
          classes: ["other-watched-card"],
          showYear: true,
          director: filmDirector(film),
          directorPrefix: `${ui("by")} `,
          escape: periodEscape,
          bodyHtml: `<div class="leaderboard-meta">${periodEscape(film.type || ui("Other"))}</div>`,
        }),
      )
      .join("");
  }

  function shortenCredit(value, maxLength = 56) {
    let text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    let shortened = text.slice(0, maxLength - 1);
    let lastSpace = shortened.lastIndexOf(" ");
    if (lastSpace >= Math.floor(maxLength * 0.65))
      shortened = shortened.slice(0, lastSpace);
    return shortened.replace(/[\s,;:/-]+$/, "") + "…";
  }

  // Director names for a period film: the film's own credits when present,
  // otherwise the period's Best Director recipients.
  function filmDirectorNames(film) {
    if (film.director) return film.director;
    if ((film.directors || []).length) return film.directors;
    let award = (film.awards || []).find(
      (item) =>
        item.category === "Best Director" &&
        awardInPeriod(item) &&
        window.awardRecipients(item).length,
    );
    return award
      ? window.awardRecipients(award).map((recipient) => recipient.name)
      : "";
  }

  function filmDirector(film) {
    let names = filmDirectorNames(film);
    if (!names || !names.length) return "";
    return (
      window.compactNameList?.(names).displayText ||
      (Array.isArray(names) ? names.join(", ") : String(names).trim())
    );
  }

  function renderFilmStats(stats) {
    if (!stats.nominations) return "";
    return `<div class="film-stats">${stats.awardScore ? `<span><b>${stats.awardScore}</b> ${periodEscape(ui("Score"))} <small class="normalized-score" title="${periodEscape(ui("Score divided by the maximum attainable score"))}">${window.formatNormalizedAwardScore(stats.normalizedAwardScore)}</small></span>` : ""}<span><b>${stats.wins}</b> ${periodEscape(ui("Wins"))}</span><span><b>${stats.second}</b> ${periodEscape(ui("2nd"))}</span><span><b>${stats.third}</b> ${periodEscape(ui("3rd"))}</span><span><b>${stats.nominations}</b> ${periodEscape(ui("Noms"))}</span>${stats.bigWin ? `<strong class="big-win">${periodEscape(stats.bigWin)}</strong>` : ""}</div>`;
  }

  // Shared by the Films "Film filters" fieldset and Rewatchlist's own small
  // filter fieldset - both views filter on the same minimumRuntimeFilter/
  // maximumRuntimeFilter pair (see matchesRuntimeFilter above).
  function filmRuntimeFilterInputsHtml() {
    return `<label>${periodEscape(ui("Minimum runtime (minutes)"))} <input type="number" min="1" max="2000" data-period-film-min-runtime value="${minimumRuntimeFilter ? periodEscape(String(minimumRuntimeFilter)) : ""}"></label><label>${periodEscape(ui("Maximum runtime (minutes)"))} <input type="number" min="1" max="2000" data-period-film-max-runtime value="${maximumRuntimeFilter ? periodEscape(String(maximumRuntimeFilter)) : ""}"></label>`;
  }

  function ratingFilterOptions(selected, prefix) {
    return Array.from({ length: 10 }, (_, index) => {
      let value = (index + 1) / 2;
      let rating = `${value % 1 ? value : value.toFixed(0)}★`;
      let label =
        prefix === "At least "
          ? ui("At least {rating}", { rating })
          : prefix === "At most "
            ? ui("At most {rating}", { rating })
            : `${prefix}${rating}`;
      return `<option value="${value}" ${selected === value ? "selected" : ""}>${periodEscape(label)}</option>`;
    }).join("");
  }

  function exactRatingOptions(selected) {
    return exactRatingValues
      .map((value) => {
        let label = `${value % 1 ? value : value.toFixed(0)}★`;
        return `<option value="${value}" ${selected === value ? "selected" : ""}>${periodEscape(label)}</option>`;
      })
      .join("");
  }

  function periodOrderControls() {
    if (viewMode === "awards" || viewMode === "official") return "";
    let axes = viewMode === "other" ? [
      { value: "title", label: "Title" },
      ...(type !== "year" ? [{ value: "year", label: "Release year" }] : []),
      { value: "rating", label: "Rating" },
    ] : [
      {
        value: "rank",
        label:
          viewMode === "watchlist" || viewMode === "rewatch"
            ? "Interest order"
            : "Rank order",
      },
      { value: "title", label: "Title" },
      ...(type !== "year" ? [{ value: "year", label: "Release year" }] : []),
      { value: "rating", label: "Rating" },
      { value: "wins", label: "Wins" },
      { value: "nominations", label: "Nominations" },
      { value: "score", label: "Score" },
    ];
    let sortControl = window.renderSortAxisControl({
      escape: periodEscape,
      value: periodOrder === "shuffle" ? "" : periodOrder,
      attribute: "data-period-sort",
      axes,
    });
    return `<div class="detail-toolbar-controls">${sortControl}${window.renderChronologyControl({ order: periodDirection, escape: periodEscape, iconOnly: true, title: ui("Reverse current order") })}${window.renderShuffleControl({ escape: periodEscape, label: ui("Shuffle") })}</div>`;
  }

  function periodEditControls() {
    if (viewMode !== "awards" || !canEditBracket || !canEdit) return "";
    return `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-period-edit-toggle>${periodEscape(ui(editMode ? "Finish editing" : "Edit bracket"))}</button>${editMode ? `<span>${periodEscape(ui("Move by dragging or choosing an exact destination; delete with ×."))}</span>` : ""}</div>`;
  }

  // "decade-merge" is the historical name (issue #126, annual-to-decade
  // only); issue #140 generalized the same dialog/data-attributes to also
  // progress decade brackets to century and century brackets to all-time,
  // dispatched by page type through this one config rather than duplicating
  // the dialog for each level. UI text stays as literal ui-call arguments in
  // the helpers below (not config properties) so the i18n completeness
  // check can still find every string statically.
  let periodMergeConfig = {
    decade: {
      periodType: "decades",
      categories: () => window.decadeAnnualCategories?.(key) || [],
      collect: (category) =>
        window.collectDecadeCategoryCandidates?.(key, category) || [],
      plan: (assignments, category) =>
        window.planDecadeCategoryMerge({ decadeKey: key, category, assignments }),
    },
    century: {
      periodType: "centuries",
      categories: () => window.centuryDecadeCategories?.(key) || [],
      collect: (category) =>
        window.collectCenturyDecadeCandidates?.(key, category) || [],
      plan: (assignments, category) =>
        window.planCenturyDecadeMerge({ centuryKey: key, category, assignments }),
    },
    alltime: {
      periodType: "allTime",
      categories: () => window.allTimeCenturyCategories?.() || [],
      collect: (category) => window.collectAllTimeCenturyCandidates?.(category) || [],
      plan: (assignments, category) =>
        window.planAllTimeCenturyMerge({ category, assignments }),
    },
  }[type];

  function periodMergeLabel() {
    if (type === "century") return ui("Merge decade category");
    if (type === "alltime") return ui("Merge century category");
    return ui("Merge annual category");
  }

  function periodMergeOpenHint() {
    if (type === "century")
      return ui("Build one century category from its decade nominees.");
    if (type === "alltime")
      return ui("Build the all-time category from its century nominees.");
    return ui("Build one decade category from its annual nominees.");
  }

  function periodMergeDialogHint() {
    if (type === "century")
      return ui("Assign explicit century placements. Blank placements are excluded.");
    if (type === "alltime")
      return ui("Assign explicit all-time placements. Blank placements are excluded.");
    return ui("Assign explicit decade placements. Blank placements are excluded.");
  }

  function periodMergeReplaceText(count) {
    if (type === "century")
      return ui(
        "This replaces {count} existing century nomination(s) in this category.",
        { count },
      );
    if (type === "alltime")
      return ui(
        "This replaces {count} existing all-time nomination(s) in this category.",
        { count },
      );
    return ui(
      "This replaces {count} existing decade nomination(s) in this category.",
      { count },
    );
  }

  function periodMergeCreateText() {
    if (type === "century") return ui("This creates the century category.");
    if (type === "alltime") return ui("This creates the all-time category.");
    return ui("This creates the decade category.");
  }

  function periodMergeSourceChoosePlaceholder() {
    if (type === "century") return ui("Choose decade");
    if (type === "alltime") return ui("Choose century");
    return ui("Choose year");
  }

  function decadeMergeCategories() {
    return periodMergeConfig ? periodMergeConfig.categories() : [];
  }

  function decadeMergeControls() {
    if (!periodMergeConfig || !decadeMergeCategories().length) return "";
    return `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-decade-merge-open>${periodEscape(periodMergeLabel())}</button><span>${periodEscape(periodMergeOpenHint())}</span></div>`;
  }

  function decadeMergeDialog() {
    if (!decadeMergeOpen || !periodMergeConfig) return "";
    let categories = decadeMergeCategories();
    if (!categories.length) return "";
    if (!categories.includes(decadeMergeCategory))
      decadeMergeCategory = categories[0];
    let candidates = periodMergeConfig.collect(decadeMergeCategory);
    let capacities = window.bracketCapacities(periodMergeConfig.periodType);
    let capacity =
      decadeMergeCategory === "Best Picture" ? capacities.picture : capacities.category;
    let groups = new Map();
    candidates.forEach((candidate, index) => {
      let rows = groups.get(candidate.primaryYear) || [];
      rows.push({ candidate, index });
      groups.set(candidate.primaryYear, rows);
    });
    let categoryOptions = categories
      .map(
        (category) =>
          `<option value="${periodEscape(category)}" ${category === decadeMergeCategory ? "selected" : ""}>${periodEscape(category)}</option>`,
      )
      .join("");
    let groupHtml = [...groups.entries()]
      .map(
        ([year, rows]) => `<section class="decade-merge-group"><h3>${periodEscape(year)}</h3>${rows
          .map(({ candidate, index }) => {
            let provenance = candidate.sources
              .map((source) => `${source.year} #${source.placement}`)
              .join(" · ");
            let sourceControl =
              candidate.sources.length > 1
                ? `<label>${periodEscape(ui("Credit source"))}<select data-decade-merge-source-year><option value="">${periodEscape(periodMergeSourceChoosePlaceholder())}</option>${candidate.sources.map((source) => `<option value="${periodEscape(source.year)}">${periodEscape(`${source.year} #${source.placement}`)}</option>`).join("")}</select></label>`
                : `<input type="hidden" data-decade-merge-source-year value="${periodEscape(candidate.sources[0].year)}">`;
            return `<div class="decade-merge-row" data-decade-merge-candidate="${index}"><div><strong>${periodEscape(candidate.title)}</strong>${candidate.year ? ` <span>(${periodEscape(candidate.year)})</span>` : ""}<small>${periodEscape(provenance)}</small></div><label>${periodEscape(ui("Placement"))}<input type="number" min="1" max="${capacity}" inputmode="numeric" data-decade-merge-placement></label>${sourceControl}</div>`;
          })
          .join("")}</section>`,
      )
      .join("");
    let currentCount = allFilms.flatMap((film) => film.awards || []).filter(
      (award) => awardInPeriod(award) && award.category === decadeMergeCategory,
    ).length;
    return `<dialog class="decade-merge-dialog" data-decade-merge-dialog><form data-decade-merge-form><h2>${periodEscape(periodMergeLabel())}</h2><p>${periodEscape(periodMergeDialogHint())}</p><label class="decade-merge-category">${periodEscape(ui("Category"))}<select data-decade-merge-category>${categoryOptions}</select></label><p class="decade-merge-warning">${periodEscape(currentCount ? periodMergeReplaceText(currentCount) : periodMergeCreateText())}</p><div class="decade-merge-groups">${groupHtml}</div><div class="dialog-actions"><button type="button" data-decade-merge-cancel>${periodEscape(ui("Cancel"))}</button><button type="submit">${periodEscape(ui("Preview merge"))}</button></div></form></dialog>`;
  }

  function rankingEditControls() {
    if (viewMode !== "films" || periodOrder !== "rank" || !canEdit) return "";
    return `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-period-ranking-edit-toggle>${periodEscape(ui(rankingEditMode ? "Finish ranking" : "Edit ranking"))}</button>${rankingEditMode ? `<span>${periodEscape(ui("Edits all-time order inside the same exact rating only."))}</span>` : ""}${rankingEditMode && type === "alltime" ? `<a class="sort-order-button" href="ranking-review.html">${periodEscape(ui("Review consistency"))}</a>` : ""}</div>`;
  }

  function watchlistEditControls() {
    if (viewMode !== "watchlist" || !canEdit) return "";
    return `<div class="period-edit-controls"><button type="button" class="sort-order-button" data-period-watchlist-tier-edit-toggle>${periodEscape(ui(tierEditMode ? "Finish interest" : "Edit interest"))}</button><button type="button" class="sort-order-button" data-period-watchlist-order-edit-toggle ${periodOrder === "rank" ? "" : "disabled"}>${periodEscape(ui(watchlistOrderEditMode ? "Finish order" : "Reorder"))}</button><a class="sort-order-button" href="watchlist-merge.html">${periodEscape(ui("Merge order"))}</a>${watchlistOrderEditMode ? `<span>${periodEscape(ui("Edits global watchlist order inside the same interest tier only."))}</span>` : ""}</div>`;
  }

  // Bundles the Watchlist view's period/filter/sort state into the plain
  // object window.periodWatchlistEntries and friends take as an explicit
  // parameter, since watchlist-view.js's functions don't share this file's
  // closure (issue #304).
  function currentWatchlistFilters() {
    return {
      type,
      key,
      search: watchlistSearch,
      director: watchlistDirector,
      minRuntime: watchlistMinRuntimeFilter,
      maxRuntime: watchlistMaxRuntimeFilter,
      tierFilter: watchlistTierFilter,
      subCentury: watchlistSubCentury,
      subDecade: watchlistSubDecade,
      subYear: watchlistSubYear,
      order: periodOrder,
      direction: periodDirection,
      shuffleSeed,
    };
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("period:render");
    let watchlistFilters = currentWatchlistFilters();
    let watchlistEntries = window.periodWatchlistEntries(watchlistFilters);
    let watchlistFilterProjectSourceId =
      viewMode === "watchlist"
        ? window.registerWatchlistFilterProjectSource(
            watchlistFilters,
            watchlistEntries,
            periodViewUrl(),
          )
        : "";
    let scopedFilms =
      scope === "nominees"
        ? allFilms.filter((film) => (film.awards || []).some(awardInPeriod))
        : allFilms;
    let rewatchFilms = periodRewatchFilms();
    let otherFilms = periodOtherFilms();
    let finishFilterTimer =
      window.startOskarsPerformance?.("period:filterSort");
    let films =
      viewMode === "films"
        ? scopedFilms.filter(matchesMetadataFilters)
        : viewMode === "other"
          ? otherFilms
        : viewMode === "rewatch"
          ? rewatchFilms
          : viewMode === "watchlist"
            ? []
            : allFilms.filter((film) =>
                (film.awards || []).some(awardInPeriod),
              );
    if (
      (viewMode === "films" || viewMode === "rewatch" || viewMode === "other") &&
      periodOrder === "shuffle"
    ) {
      films = [...films].sort((left, right) =>
        window.compareBySeededShuffle(
          left.id || `${left.year || ""}::${left.title}`,
          right.id || `${right.year || ""}::${right.title}`,
          shuffleSeed,
        ),
      );
    } else if (
      (viewMode === "films" || viewMode === "rewatch" || viewMode === "other") &&
      periodOrder !== "rank"
    ) {
      films = [...films].sort((left, right) =>
        periodCompareValues(left, right, periodOrder, periodDirection, false),
      );
    }
    let officialNominations = officialResultsBySource.flatMap(
      (entry) => entry.result.period?.nominations || [],
    );
    let pageTotal =
      viewMode === "official"
        ? officialNominations.length
        : viewMode === "watchlist"
          ? watchlistEntries.length
          : films.length;
    let pageCount = Math.max(1, Math.ceil(pageTotal / FILMS_PER_PAGE));
    filmPage = Math.min(filmPage, pageCount);
    visibleFilmPage =
      viewMode === "films" || viewMode === "rewatch" || viewMode === "other"
        ? films.slice(
            (filmPage - 1) * FILMS_PER_PAGE,
            filmPage * FILMS_PER_PAGE,
          )
        : films;
    visibleWatchlistPage =
      viewMode === "watchlist"
        ? watchlistEntries.slice(
            (filmPage - 1) * FILMS_PER_PAGE,
            filmPage * FILMS_PER_PAGE,
          )
        : [];
    finishFilterTimer?.(
      `${viewMode}: ${pageTotal} item(s), page ${filmPage}/${pageCount}`,
    );
    let finishCardsTimer = window.startOskarsPerformance?.("period:cards");
    let awards = films.flatMap((film) =>
      (film.awards || [])
        .filter(awardInPeriod)
        .map((award) => ({ film, award })),
    );
    let officialComparison =
      type === "year" &&
      officialResult &&
      (viewMode === "awards" || viewMode === "official")
        ? window.officialAwardPeriodComparison({
            periodKey: key,
            personalEntries: awards,
            officialPeriod: officialResult.period,
          })
        : null;
    let categorySections =
      viewMode === "awards"
        ? window.renderPeriodAwardView({
            awards,
            type,
            key,
            editMode,
            officialComparison,
            escape: periodEscape,
          })
        : "";
    let filmCards =
      viewMode === "films" || viewMode === "rewatch"
        ? window.renderPeriodFilmGrid({
            films: visibleFilmPage,
            type,
            key,
            rankForFilm,
            awardInPeriod,
            filmDirector,
            renderFilmStats,
            shortenCredit,
            escape: periodEscape,
            rankingEditMode,
            canonicalRankContextHtml,
            showRewatchTier: viewMode === "rewatch",
            showAwards,
          })
        : "";
    let otherCards =
      viewMode === "other" ? renderOtherWatchedGrid(visibleFilmPage) : "";
    let pagination =
      viewMode === "films" ||
      viewMode === "other" ||
      viewMode === "rewatch" ||
      viewMode === "watchlist"
        ? window.renderFilmPagination({
            total: pageTotal,
            page: filmPage,
            pageCount,
            pageSize: FILMS_PER_PAGE,
          })
        : "";
    let watchlistCards = visibleWatchlistPage
      .map((entry, visibleIndex) =>
        window.renderWatchlistCard(entry, visibleIndex, {
          tierEditMode,
          watchlistOrderEditMode,
          periodOrder,
          escape: periodEscape,
          ui,
        }),
      )
      .join("");
    finishCardsTimer?.(
      `${visibleFilmPage.length} film record(s), ${visibleWatchlistPage.length} watchlist record(s), ${awards.length} award row(s)`,
    );
    let sourceOptions = window
      .getAdaptationSources(allFilms)
      .map(
        (source) =>
          `<option value="${periodEscape(source)}" ${sourceFilter === source ? "selected" : ""}>${periodEscape(source)}</option>`,
      )
      .join("");
    let countryOptions = countryValues
      .map(
        (country) =>
          `<option value="${periodEscape(country)}" ${countryFilter === country ? "selected" : ""}>${periodEscape(country)}</option>`,
      )
      .join("");
    let title = type === "alltime" ? "All-time" : key;
    let typeLabel =
      type === "alltime"
        ? ui("All-time rank")
        : ui(
            type === "year" ? "Year" : type === "decade" ? "Decade" : "Century",
          );
    let sourceUrl = state.years?.[key]?.sourceUrl || "";
    let sourceLinkHtml = sourceUrl
      ? ` · <a class="period-link" href="${periodEscape(sourceUrl)}" target="_blank" rel="noopener noreferrer">${periodEscape(ui("Source"))}</a>`
      : "";
    document.title = `${title} · The Oskars`;
    let returnIntake = periodIdentityState.returnIntake;
    let intakeReturnHtml = returnIntake
      ? `<section class="detail-note"><p>${periodEscape(ui("You opened this bracket from a watched-film intake."))}</p><a class="button-link" href="${periodEscape(window.intakePageUrl(returnIntake))}">${periodEscape(ui("Return to intake"))}</a></section>`
      : "";
    // Issue #232: a year with watched films but no ranking and/or no
    // bracket yet has nothing else on this page inviting the user to build
    // either from scratch - offer the guided setup page whenever there's
    // still real work left, rather than leaving that undiscoverable.
    let unresolvedYearTies =
      type === "year" && allFilms.length
        ? window.rankingConsistencyPairsForYear?.(key, new Set()) || []
        : [];
    let setupYearCtaHtml =
      type === "year" && allFilms.length && (!hasNominees || unresolvedYearTies.length)
        ? `<section class="detail-note setup-year-cta"><p>${periodEscape(ui("{year} isn't fully built yet.", { year: key }))}</p><a class="button-link" href="${periodEscape(window.yearRankingPageUrl(key))}">${periodEscape(ui("Rank {year}", { year: key }))}</a><a class="button-link" href="${periodEscape(window.yearAwardsPageUrl(key))}">${periodEscape(ui("Build {year} awards", { year: key }))}</a></section>`
        : "";
    let periodRatingStatistics = window.collectionRatingStatistics(allFilms);
    let otherRatingStatistics = window.collectionRatingStatistics(otherFilms);
    let officialAgreementSummaryHtml = officialComparison?.comparedCount
      ? `<span class="period-official-agreement-summary"><b>${officialComparison.matches}/${officialComparison.comparedCount}</b> ${periodEscape(ui("Oskars–Oscars agreement"))} · ${officialComparison.agreementPercent}%</span>`
      : "";
    let periodSummaryItemsHtml =
      viewMode === "official"
        ? `<span><b>${officialNominations.length}</b> ${periodEscape(ui("Official nominations"))}</span><span><b>${officialNominations.filter((entry) => entry.winner).length}</b> ${periodEscape(ui("Official winners"))}</span>${officialAgreementSummaryHtml}`
        : `<span><b>${viewMode === "watchlist" ? watchlistEntries.length : films.length}</b> ${periodEscape(viewMode === "watchlist" ? "Watchlist" : viewMode === "rewatch" ? ui("Rewatchlist") : viewMode === "other" ? ui("Other watched") : ui("Films"))}</span>${viewMode === "other" ? "" : `<span><b>${awards.length}</b> ${periodEscape(ui("Nominations"))}</span>`}${viewMode === "awards" ? officialAgreementSummaryHtml : ""}${viewMode === "films" ? window.renderRatingStatisticsItems(periodRatingStatistics, { escape: periodEscape, ui }) : viewMode === "other" ? window.renderRatingStatisticsItems(otherRatingStatistics, { escape: periodEscape, ui }) : ""}`;
    let ceremonyActionHtml = hasNominees
      ? `<a class="button-link" href="presentation.html?scope=period&amp;id=${periodEscape(encodeURIComponent(`${type}:${key}`))}&amp;section=ceremony">${periodEscape(ui("Run ceremony"))}</a>`
      : "";
    container.innerHTML = `${window.renderDetailHeader({ mainHtml: `<h1>${periodEscape(title)}</h1><div class="period-heading-meta"><p>${periodEscape(typeLabel)}${sourceLinkHtml}</p>${window.renderPeriodNeighborNavigation(type, key, periodEscape)}${window.renderPeriodChildNavigation(type, key, periodEscape)}</div>`, actionsHtml: ceremonyActionHtml })}
    ${intakeReturnHtml}
    ${setupYearCtaHtml}
    ${window.renderEntityNote("periods", `${type}:${key}`, ui("Period note"))}
    ${window.renderDetailStats({ itemsHtml: periodSummaryItemsHtml })}
    ${viewMode === "official" || viewMode === "rewatch" || viewMode === "other" ? "" : renderPeriodHighlights()}
    ${viewMode === "official" || viewMode === "rewatch" || viewMode === "other" ? "" : renderRatingHistogram()}
    <fieldset class="period-view-controls"><legend>${periodEscape(ui("View"))}</legend><label><input type="radio" name="periodViewMode" value="awards" ${viewMode === "awards" ? "checked" : ""} ${hasNominees ? "" : "disabled"}> ${periodEscape(ui("Award bracket"))}</label><label><input type="radio" name="periodViewMode" value="films" ${viewMode === "films" ? "checked" : ""}> ${periodEscape(ui("Films"))}</label><label><input type="radio" name="periodViewMode" value="other" ${viewMode === "other" ? "checked" : ""}> ${periodEscape(ui("Other watched"))}</label><label><input type="radio" name="periodViewMode" value="rewatch" ${viewMode === "rewatch" ? "checked" : ""}> ${periodEscape(ui("Rewatchlist"))}</label><label><input type="radio" name="periodViewMode" value="watchlist" ${viewMode === "watchlist" ? "checked" : ""}> Watchlist</label>${type === "year" ? `<label><input type="radio" name="periodViewMode" value="official" ${viewMode === "official" ? "checked" : ""} ${hasOfficialResults ? "" : "disabled"}> ${periodEscape(ui("Official results"))}</label>` : ""}</fieldset>
    ${periodEditControls()}
    ${decadeMergeControls()}
    ${rankingEditControls()}
    ${watchlistEditControls()}
    ${viewMode === "films" || viewMode === "other" || viewMode === "rewatch" || viewMode === "watchlist" ? `<div class="detail-toolbar">${periodOrderControls()}<div class="period-toolbar-actions">${viewMode === "films" ? `<button type="button" class="sort-order-button sort-order-button--icon period-film-scope-toggle${scope === "all" ? " is-active" : ""}" title="${periodEscape(ui(scope === "all" ? "Showing all films" : "Showing nominees only"))}" aria-label="${periodEscape(ui("Toggle films shown"))}" aria-pressed="${scope === "all" ? "true" : "false"}" data-period-film-scope-toggle ${hasNominees ? "" : "disabled"}>${periodEscape(ui("All"))}</button>` : ""}${(viewMode === "films" || viewMode === "rewatch") && layout === "grid" ? `<a class="sort-order-button" href="${periodEscape(periodViewUrl({ showAwards: !showAwards }))}">${periodEscape(showAwards ? ui("Hide awards") : ui("Show awards"))}</a>` : ""}${window.renderFilmViewToggle({ view: layout, listUrl: periodViewUrl({ layout: "list" }), gridUrl: periodViewUrl({ layout: "grid" }), escape: periodEscape, classes: "period-film-view-toggle", ariaLabel: ui("Period film display") })}</div></div>` : ""}
    ${
      viewMode === "official"
        ? officialResultsBySource
            .map((entry) =>
              window.renderPeriodOfficialResults({
                ...entry.result,
                // Personal-pick comparison only exists for Academy Awards
                // (issue #345 non-goal: other sources have no personal
                // category counterpart to compare against).
                personalComparison:
                  entry.sourceId === "academy-awards" ? officialComparison : null,
                escape: periodEscape,
              }),
            )
            .join("")
        : viewMode === "rewatch"
          ? `${renderRewatchTierFilter()}<fieldset class="period-filter-controls"><legend>${periodEscape(ui("Rewatchlist filters"))}</legend>${filmRuntimeFilterInputsHtml()}</fieldset>${pagination}${pageTotal ? (layout === "grid" ? `<div class="film-grid period-film-grid">${filmCards}</div>` : renderPeriodFilmList(visibleFilmPage, { showRewatchTier: true })) : `<p class="detail-empty">${periodEscape(ui("No films are marked for rewatch yet."))}</p>`}${pagination}`
        : viewMode === "other"
          ? `${pagination}${pageTotal ? (layout === "grid" ? `<div class="film-grid period-film-grid">${otherCards}</div>` : renderOtherWatchedList(visibleFilmPage)) : `<p class="detail-empty">${periodEscape(ui("No other watched entries in this period."))}</p>`}${pagination}`
        : viewMode === "films"
        ? `<fieldset class="period-filter-controls"><legend>${periodEscape(ui("Film filters"))}</legend><label>${periodEscape(ui("Medium"))} <select data-period-film-filter="medium"><option value="all" ${mediumFilter === "all" ? "selected" : ""}>${periodEscape(ui("All"))}</option><option value="live-action" ${mediumFilter === "live-action" ? "selected" : ""}>${periodEscape(ui("Live action"))}</option><option value="animation" ${mediumFilter === "animation" ? "selected" : ""}>${periodEscape(ui("Animation"))}</option><option value="hybrid" ${mediumFilter === "hybrid" ? "selected" : ""}>${periodEscape(ui("Hybrid"))}</option></select></label><label>${periodEscape(ui("Screenplay"))} <select data-period-film-filter="screenplay"><option value="all" ${screenplayFilter === "all" ? "selected" : ""}>${periodEscape(ui("All"))}</option><option value="original" ${screenplayFilter === "original" ? "selected" : ""}>${periodEscape(ui("Original"))}</option><option value="adapted" ${screenplayFilter === "adapted" ? "selected" : ""}>${periodEscape(ui("Adapted"))}</option></select></label><label>${periodEscape(ui("Adapted from"))} <select data-period-film-filter="adaptationSource"><option value="all">${periodEscape(ui("All sources"))}</option>${sourceOptions}</select></label><label>${periodEscape(ui("Country"))} <select data-period-film-filter="country"><option value="all" ${countryFilter === "all" ? "selected" : ""}>${periodEscape(ui("All countries"))}</option>${countryOptions}</select></label><label>${periodEscape(ui("Exact rating"))} <select data-period-film-filter="exactRating"><option value="all" ${exactRatingFilter === "all" ? "selected" : ""}>${periodEscape(ui("All ratings"))}</option>${exactRatingOptions(exactRatingFilter)}</select></label><label>${periodEscape(ui("Minimum rating"))} <select data-period-film-filter="minimumRating"><option value="0">${periodEscape(ui("No minimum"))}</option>${ratingFilterOptions(minimumRatingFilter, "At least ")}</select></label><label>${periodEscape(ui("Maximum rating"))} <select data-period-film-filter="maximumRating"><option value="0">${periodEscape(ui("No maximum"))}</option>${ratingFilterOptions(maximumRatingFilter, "At most ")}</select></label>${filmRuntimeFilterInputsHtml()}</fieldset>
      ${pagination}${layout === "grid" ? `<div class="film-grid period-film-grid">${filmCards}</div>` : renderPeriodFilmList(visibleFilmPage)}${pagination}`
        : viewMode === "watchlist"
          ? `${window.renderAddWatchlistForm({ escape: periodEscape, ui })}${window.watchlistSubPeriodControls(watchlistFilters, { escape: periodEscape, ui })}${window.renderWatchlistTierFilter(watchlistFilters, { escape: periodEscape, ui })}${window.watchlistFilterControls(watchlistFilters, { filteredCount: watchlistEntries.length, projectSourceId: watchlistFilterProjectSourceId, bulkTierValue: bulkTierControl?.value(), queueVisible: watchlistQueueVisible, escape: periodEscape, ui })}${watchlistQueueVisible ? window.renderWatchlistQueue(watchlistEntries, { escape: periodEscape, ui }) : ""}${pagination}${layout === "grid" ? `<div class="film-grid period-film-grid watchlist-grid">${watchlistCards || `<p>${periodEscape(ui("No watchlist films in this period."))}</p>`}</div>` : `<div class="leaderboard-wrap watchlist-list"><table class="leaderboard"><thead><tr><th>${periodEscape(ui("Interest"))}</th><th>${periodEscape(ui("Film"))}</th><th>${periodEscape(ui("Director"))}</th><th>${periodEscape(ui("Tier"))}</th></tr></thead><tbody>${visibleWatchlistPage.map((entry, visibleIndex) => window.renderWatchlistRow(entry, visibleIndex, { tierEditMode, watchlistOrderEditMode, escape: periodEscape })).join("") || `<tr><td colspan="4">${periodEscape(ui("No watchlist films in this period."))}</td></tr>`}</tbody></table></div>`}${pagination}`
          : `<div class="period-award-view">${categorySections}</div>`
    }
    ${decadeMergeDialog()}`;
    let mergeDialog = container.querySelector("[data-decade-merge-dialog]");
    if (mergeDialog && !mergeDialog.open) {
      if (mergeDialog.showModal) mergeDialog.showModal();
      else mergeDialog.setAttribute("open", "");
    }
    window.enhanceCollapsibles?.(container);
    window.syncWinnerPosterHeights?.(container);
    finishRenderTimer?.(`${type}:${key} ${viewMode}, ${pageTotal} item(s)`);
    let posterPageKey = `${scope}|${mediumFilter}|${screenplayFilter}|${sourceFilter}|${countryFilter}|${exactRatingFilter}|${minimumRatingFilter}|${maximumRatingFilter}|${minimumRuntimeFilter}|${maximumRuntimeFilter}|${filmPage}`;
    if (
      (viewMode === "films" || viewMode === "rewatch") &&
      typeof window.fetch === "function" &&
      fetchedPosterPage !== posterPageKey
    ) {
      fetchedPosterPage = posterPageKey;
      window
        .fetchFilmPosters(visibleFilmPage, { limit: 25, concurrency: 3 })
        .then((result) => {
          if (result.found) {
            allFilms.forEach((film) => {
              let savedFilm = state.filmsById?.[film.id];
              if (savedFilm?.poster) film.poster = savedFilm.poster;
            });
            render();
          }
        });
    }
    let watchlistPosterPageKey = `${type}|${key}|${watchlistTierFilter}|${filmPage}|${visibleWatchlistPage.map((entry) => entry.item.id || window.watchlistItemId(entry.item)).join(",")}`;
    if (
      viewMode === "watchlist" &&
      visibleWatchlistPage.length &&
      typeof window.fetch === "function" &&
      fetchedWatchlistPosterPage !== watchlistPosterPageKey
    ) {
      fetchedWatchlistPosterPage = watchlistPosterPageKey;
      window
        .fetchWatchlistPosters(
          visibleWatchlistPage.map((entry) => entry.item),
          { limit: 25, concurrency: 3 },
        )
        .then((result) => {
          if (result.found) render();
        });
    }
  }

  if ((state.watchlist || []).length || !window.ensureWatchlistData) render();
  else window.ensureWatchlistData().then(render);
  window.bindEntityNoteEditor(container);
  if (typeof window.fetch === "function") {
    let winningPeople = allFilms.flatMap((film) =>
      (film.awards || [])
        .filter(
          (award) => awardInPeriod(award) && Number(award.placement) === 1,
        )
        .flatMap((award) => window.awardRecipientPeople(award)),
    );
    window
      .fetchPersonPortraits(winningPeople, { limit: 25, concurrency: 3 })
      .then((result) => {
        if (result.found) render();
      });
  }

  function clearAwardDropTargets() {
    container
      .querySelectorAll(".nominee-card.drop-target")
      .forEach((card) => card.classList.remove("drop-target"));
  }

  function commitNominationPlan(plan, options = {}) {
    if (!plan || !window.confirmNominationPlacementPlan?.(plan)) return false;
    let outcome = window.applyNominationPlacementPlan?.(plan);
    if (!outcome?.ok) {
      if (outcome?.reason) window.alert?.(outcome.reason);
      return false;
    }

    rebuildPeriodViewModel();
    if (!canEditBracket) editMode = false;
    options.beforeRender?.();
    render();
    window.save?.({ immediate: true, rebuild: false });
    return true;
  }

  function commitAwardPlacementMove(from, targetCard) {
    if (
      !from ||
      !targetCard ||
      from.year !== targetCard.dataset.year ||
      from.category !== targetCard.dataset.category
    )
      return false;
    if (
      from.filmId === targetCard.dataset.filmId &&
      String(from.placement) === String(targetCard.dataset.placement)
    )
      return false;

    let plan = window.planAwardPlacementReorder?.(
      targetCard.dataset.year,
      targetCard.dataset.category,
      from.filmId,
      from.placement,
      targetCard.dataset.filmId,
      targetCard.dataset.placement,
    );
    return commitNominationPlan(plan);
  }

  container.addEventListener("input", (event) => {
    let filmMinRuntimeInput = event.target.closest(
      "[data-period-film-min-runtime]",
    );
    if (filmMinRuntimeInput) {
      minimumRuntimeFilter = window.parseFilmFilterValue(
        "minimumRuntime",
        Number(filmMinRuntimeInput.value) || 0,
        { defaultValue: 0 },
      );
      filmPage = 1;
      if (filmMinRuntimeRenderTimer) clearTimeout(filmMinRuntimeRenderTimer);
      filmMinRuntimeRenderTimer = setTimeout(() => {
        filmMinRuntimeRenderTimer = null;
        updateViewUrl();
        render();
        container.querySelector("[data-period-film-min-runtime]")?.focus();
      }, 160);
      return;
    }
    let filmMaxRuntimeInput = event.target.closest(
      "[data-period-film-max-runtime]",
    );
    if (filmMaxRuntimeInput) {
      maximumRuntimeFilter = window.parseFilmFilterValue(
        "maximumRuntime",
        Number(filmMaxRuntimeInput.value) || 0,
        { defaultValue: 0 },
      );
      filmPage = 1;
      if (filmMaxRuntimeRenderTimer) clearTimeout(filmMaxRuntimeRenderTimer);
      filmMaxRuntimeRenderTimer = setTimeout(() => {
        filmMaxRuntimeRenderTimer = null;
        updateViewUrl();
        render();
        container.querySelector("[data-period-film-max-runtime]")?.focus();
      }, 160);
      return;
    }
  });
  container.addEventListener("change", (event) => {
    let mergeCategory = event.target.closest("[data-decade-merge-category]");
    if (mergeCategory) {
      decadeMergeCategory = mergeCategory.value;
      render();
      return;
    }
    let destinationSelect = event.target.closest(
      "[data-nomination-destination]",
    );
    if (destinationSelect && editMode) {
      let sourceCard = destinationSelect.closest(".nominee-card");
      let selectedOption =
        destinationSelect.options[destinationSelect.selectedIndex];
      let targetCard = [...container.querySelectorAll(".nominee-card")].find(
        (card) =>
          card.dataset.year === sourceCard?.dataset.year &&
          card.dataset.category === sourceCard?.dataset.category &&
          card.dataset.filmId === selectedOption?.value &&
          String(card.dataset.placement) ===
            String(selectedOption?.dataset.placement),
      );
      let moved = commitAwardPlacementMove(
        sourceCard
          ? {
              year: sourceCard.dataset.year,
              category: sourceCard.dataset.category,
              filmId: sourceCard.dataset.filmId,
              placement: sourceCard.dataset.placement,
            }
          : null,
        targetCard,
      );
      if (!moved && sourceCard) {
        let sourcePlacement = String(sourceCard.dataset.placement);
        let sourceIndex = [...destinationSelect.options].findIndex(
          (option) => String(option.dataset.placement) === sourcePlacement,
        );
        if (sourceIndex >= 0) destinationSelect.selectedIndex = sourceIndex;
      }
      return;
    }
    let filterInput = event.target.closest("[data-period-film-filter]");
    if (filterInput) {
      if (filterInput.dataset.periodFilmFilter === "medium")
        mediumFilter = filterInput.value;
      else if (filterInput.dataset.periodFilmFilter === "screenplay")
        screenplayFilter = filterInput.value;
      else if (filterInput.dataset.periodFilmFilter === "adaptationSource")
        sourceFilter = filterInput.value;
      else if (filterInput.dataset.periodFilmFilter === "country")
        countryFilter = filterInput.value;
      else if (filterInput.dataset.periodFilmFilter === "exactRating")
        exactRatingFilter =
          filterInput.value === "all"
            ? "all"
            : Number(filterInput.value) || "all";
      else if (filterInput.dataset.periodFilmFilter === "minimumRating")
        minimumRatingFilter = Number(filterInput.value) || 0;
      else maximumRatingFilter = Number(filterInput.value) || 0;
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
    let viewInput = event.target.closest('input[name="periodViewMode"]');
    if (viewInput) {
      viewMode = viewInput.value;
      if (viewMode === "awards") {
        periodOrder = "rank";
        periodDirection = window.defaultOrderForFilmAxis("rank");
      } else if (viewMode === "other") {
        editMode = false;
        periodOrder = type === "year" ? "title" : "year";
        periodDirection = window.defaultOrderForFilmAxis(periodOrder);
      } else editMode = false;
      if (viewMode !== "films") rankingEditMode = false;
      if (viewMode !== "watchlist") {
        watchlistOrderEditMode = false;
        tierEditMode = false;
      }
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
    let sortSelect = event.target.closest("[data-period-sort]");
    if (sortSelect) {
      periodOrder = sortSelect.value;
      periodDirection = window.defaultOrderForFilmAxis(periodOrder);
      if (periodOrder !== "rank") rankingEditMode = false;
      if (periodOrder !== "rank") watchlistOrderEditMode = false;
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
  });
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-period-film-scope-toggle]")) {
      scope = scope === "all" ? "nominees" : "all";
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
    if (event.target.closest("[data-decade-merge-open]")) {
      decadeMergeOpen = true;
      decadeMergeCategory ||= decadeMergeCategories()[0] || "";
      render();
      return;
    }
    if (event.target.closest("[data-decade-merge-cancel]")) {
      decadeMergeOpen = false;
      render();
      return;
    }
    let deleteButton = event.target.closest("[data-delete-nomination]");
    if (deleteButton && editMode) {
      let card = deleteButton.closest(".nominee-card");
      let plan = card
        ? window.planNominationDeletion?.(
            card.dataset.year,
            card.dataset.category,
            card.dataset.filmId,
            card.dataset.placement,
          )
        : null;
      commitNominationPlan(plan);
      return;
    }
    if (event.target.closest("[data-period-edit-toggle]")) {
      editMode = !editMode;
      updateViewUrl();
      render();
      return;
    }
    if (event.target.closest("[data-period-ranking-edit-toggle]")) {
      rankingEditMode = !rankingEditMode;
      updateViewUrl();
      render();
      return;
    }
    let rewatchTierToggle = event.target.closest(
      "[data-period-rewatch-tier-toggle]",
    );
    if (rewatchTierToggle) {
      let tier =
        rewatchTierToggle.dataset.periodRewatchTierToggle === "unset"
          ? ""
          : window.normalizeWatchlistTier(
              rewatchTierToggle.dataset.periodRewatchTierToggle,
            );
      let selected = selectedRewatchTierSet();
      if (selected.has(tier)) selected.delete(tier);
      else selected.add(tier);
      let allValues = window.watchlistTierFilterValues();
      let next = allValues.filter((value) => selected.has(value));
      rewatchTierFilter = next.length === allValues.length ? null : next;
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
    if (event.target.closest("[data-reverse-order-button]")) {
      if (periodOrder === "shuffle") {
        periodOrder = "rank";
        rankingEditMode = false;
        watchlistOrderEditMode = false;
      }
      periodDirection = periodDirection === "asc" ? "desc" : "asc";
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
    if (event.target.closest("[data-shuffle-button]")) {
      periodOrder = "shuffle";
      shuffleSeed = window.freshShuffleSeed();
      rankingEditMode = false;
      watchlistOrderEditMode = false;
      filmPage = 1;
      updateViewUrl();
      render();
      return;
    }
    let pageButton = event.target.closest("[data-film-page]");
    if (pageButton && !pageButton.disabled) {
      filmPage = Math.max(1, Number(pageButton.dataset.filmPage) || 1);
      updateViewUrl();
      render();
      container
        .querySelector(".period-view-controls")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    let card = event.target.closest("[data-open-film-id]");
    if (!card || event.target.closest("a,button,input,label")) return;
    window.location.href = window.prepareOskarsAccountNavigation(
      window.filmPageUrl(card.dataset.openFilmId),
    );
  });
  container.addEventListener("submit", (event) => {
    let form = event.target.closest("[data-decade-merge-form]");
    if (!form || !periodMergeConfig) return;
    event.preventDefault();
    let candidates = periodMergeConfig.collect(decadeMergeCategory);
    let assignments = [...form.querySelectorAll("[data-decade-merge-candidate]")]
      .map((row) => {
        let placement = row.querySelector("[data-decade-merge-placement]")?.value.trim();
        if (!placement) return null;
        let candidate = candidates[Number(row.dataset.decadeMergeCandidate)];
        return {
          filmId: candidate?.filmId || "",
          placement: Number(placement),
          sourceYear: row.querySelector("[data-decade-merge-source-year]")?.value || "",
        };
      })
      .filter(Boolean);
    let plan = periodMergeConfig.plan(assignments, decadeMergeCategory);
    commitNominationPlan(plan, {
      beforeRender: () => {
        decadeMergeOpen = false;
      },
    });
  });
  container.addEventListener("dragstart", (event) => {
    let card = editMode
      ? event.target.closest(".nominee-card")
      : rankingEditMode
        ? event.target.closest(".ranking-edit-card")
        : null;
    if (!card) return;
    let payloadType = editMode ? "award" : "ranking";
    let payload =
      payloadType === "award"
        ? {
            type: payloadType,
            year: card.dataset.year,
            category: card.dataset.category,
            filmId: card.dataset.filmId,
            placement: card.dataset.placement,
          }
        : {
            type: payloadType,
            filmId: card.dataset.rankingFilmId,
            index: Number(card.dataset.rankingIndex),
            rank: card.dataset.rankingRank,
          };
    if (payloadType === "award") draggedAwardData = payload;
    else draggedRankingData = payload;
    if (event.dataTransfer) {
      let payloadText = JSON.stringify(payload);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", payloadText);
      try {
        event.dataTransfer.setData("application/json", payloadText);
      } catch (err) {}
    }
    card.classList.add("dragging");
  });
  container.addEventListener("dragend", (event) => {
    let card =
      event.target.closest(".nominee-card") ||
      event.target.closest(".ranking-edit-card");
    if (card) card.classList.remove("dragging");
    clearAwardDropTargets();
    draggedAwardData = null;
    draggedRankingData = null;
  });
  container.addEventListener("dragover", (event) => {
    let card = editMode
      ? event.target.closest(".nominee-card")
      : rankingEditMode
        ? event.target.closest(".ranking-edit-card")
        : null;
    if (!card) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (editMode) clearAwardDropTargets();
    card.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    let card =
      event.target.closest(".nominee-card") ||
      event.target.closest(".ranking-edit-card");
    if (card) card.classList.remove("drop-target");
  });
  container.addEventListener("drop", (event) => {
    let isAwardDrop = editMode && event.target.closest(".nominee-card");
    let isRankingDrop =
      rankingEditMode && event.target.closest(".ranking-edit-card");
    let card = isAwardDrop || isRankingDrop;
    if (!card) return;
    event.preventDefault();
    clearAwardDropTargets();

    let from = isAwardDrop ? draggedAwardData : draggedRankingData;
    if (event.dataTransfer) {
      try {
        let payload =
          event.dataTransfer.getData("application/json") ||
          event.dataTransfer.getData("text/plain");
        if (payload) from = JSON.parse(payload);
      } catch (err) {}
    }

    if (isRankingDrop) {
      if (
        !from ||
        from.type !== "ranking" ||
        !from.filmId ||
        from.filmId === card.dataset.rankingFilmId
      )
        return;
      let position =
        Number(from.index) < Number(card.dataset.rankingIndex)
          ? "after"
          : "before";
      let result = window.moveRankedFilmWithinRating?.(
        from.filmId,
        card.dataset.rankingFilmId,
        position,
      );
      if (!result?.ok) {
        if (result?.reason) window.alert?.(result.reason);
        return;
      }
      rebuildPeriodViewModel();
      render();
      window.save?.({ immediate: true, rebuild: false });
      return;
    }

    commitAwardPlacementMove(from, card);
  });
  bulkTierControl = window.wirePeriodWatchlistControls(container, {
    setMinRuntime(value) {
      watchlistMinRuntimeFilter = window.parseFilmFilterValue(
        "minimumRuntime",
        value,
        { defaultValue: 0 },
      );
      filmPage = 1;
    },
    setMaxRuntime(value) {
      watchlistMaxRuntimeFilter = window.parseFilmFilterValue(
        "maximumRuntime",
        value,
        { defaultValue: 0 },
      );
      filmPage = 1;
    },
    setSearch(value) {
      watchlistSearch = value;
      filmPage = 1;
    },
    commit() {
      updateViewUrl();
      render();
    },
    setItemTier(id, tier) {
      window.setWatchlistMetadata(id, { tier }, { save: false });
      window.save?.({ immediate: true, rebuild: false });
      render();
    },
    setSubPeriod(level, value) {
      if (level === "century") {
        watchlistSubCentury = value;
        watchlistSubDecade = "all";
        watchlistSubYear = "all";
      } else if (level === "decade") {
        watchlistSubDecade = value;
        watchlistSubYear = "all";
        if (value !== "all")
          watchlistSubCentury = window.getCenturyKey(value.replace(/s$/, ""));
      } else {
        watchlistSubYear = value;
        if (value !== "all") {
          watchlistSubDecade = window.getDecadeKey(value);
          watchlistSubCentury = window.getCenturyKey(value);
        }
      }
      filmPage = 1;
      updateViewUrl();
      render();
    },
    toggleOrderEdit() {
      watchlistOrderEditMode = !watchlistOrderEditMode;
      if (watchlistOrderEditMode) tierEditMode = false;
      updateViewUrl();
      render();
    },
    toggleTierEdit() {
      tierEditMode = !tierEditMode;
      if (tierEditMode) watchlistOrderEditMode = false;
      updateViewUrl();
      render();
    },
    toggleQueue() {
      watchlistQueueVisible = !watchlistQueueVisible;
      render();
    },
    toggleTierFilter(rawValue) {
      let tier =
        rawValue === "unset" ? "" : window.normalizeWatchlistTier(rawValue);
      let allValues = window.watchlistTierFilterValues();
      let selected = new Set(
        watchlistTierFilter === null ? allValues : watchlistTierFilter,
      );
      if (selected.has(tier)) selected.delete(tier);
      else selected.add(tier);
      let next = allValues.filter((value) => selected.has(value));
      watchlistTierFilter = next.length === allValues.length ? null : next;
      filmPage = 1;
      updateViewUrl();
      render();
    },
    clearDirector() {
      watchlistDirector = "";
      filmPage = 1;
      updateViewUrl();
      render();
    },
    addItem(values) {
      let result = window.addWatchlistItem(values, { save: false });
      if (!result.ok) {
        alert(result.reason);
        return;
      }
      window.save?.({ immediate: true, rebuild: false });
      render();
    },
    filteredEntries: () =>
      window.periodWatchlistEntries(currentWatchlistFilters()),
    applyBulkTier(outcome) {
      watchlistTierFilter = [outcome.tier || ""];
      watchlistOrderEditMode = false;
      filmPage = 1;
      updateViewUrl();
      render();
    },
    orderEditEnabled: () => watchlistOrderEditMode,
    orderRejectedMessage: ui(
      "Watchlist ordering moves are limited to the same interest tier.",
    ),
    moveItem: (from, target, position) =>
      window.moveWatchlistItemWithinTier?.(from.id, target.id, position),
    afterMove() {
      render();
      window.save?.({ immediate: true, rebuild: false });
    },
  }).bulkTierControl;
  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    let card = event.target.closest("[data-open-film-id]");
    if (!card || event.target.closest("a,button,input,label")) return;
    event.preventDefault();
    window.location.href = window.prepareOskarsAccountNavigation(
      window.filmPageUrl(card.dataset.openFilmId),
    );
  });
})();
