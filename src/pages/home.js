/** @file Controls the daily Home dashboard, archive summary, and Top films preview. */

(function () {
  let homeEscape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  // The account gate can replace the page container before this controller
  // runs. Home owns only its content; global search now lives in the shared
  // header and must not be duplicated here.
  document.getElementById("homePage").innerHTML =
    '<div id="homeContent"><p class="home-loading">Loading archive…</p></div>';
  let homeTopSortValues = new Set([
    "allTimeRank",
    "rating",
    "yearScore",
    "decadeScore",
    "centuryScore",
    "allTimeScore",
    "wins",
    "nominations",
  ]);
  let requestedHomeTopSort = window.pageQueryParam("top");
  let homeTopSort = homeTopSortValues.has(requestedHomeTopSort)
    ? requestedHomeTopSort
    : "yearScore";
  let homePreviousTopSort = "";
  let homeTopCache = { key: "", entries: [] };
  let homeTopExpanded = false;
  let homeIntakeState = { status: "loading", workflows: [] };
  let homeDashboardContext = null;

  function homeProjectPicks() {
    return [...Object.values(window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID || {})]
      .filter((project) => !["archived", "complete"].includes(project.status))
      .sort(
        (left, right) =>
          Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) ||
          String(right.updatedAt || right.createdAt || "").localeCompare(
            String(left.updatedAt || left.createdAt || ""),
          ),
      )
      .map((project) => ({
        project,
        next: window.projectProgress(project).next,
      }))
      .filter((entry) => entry.next);
  }

  function homeFilmHref(film) {
    let id = film?.supabaseFilmId || film?.id;
    return id ? window.filmPageUrl(id) : "";
  }

  function homeFilmMedia(film) {
    return film
      ? `<div class="home-daily-card-media">${window.renderFilmPoster(film, "hub")}</div>`
      : "";
  }

  function homeFilmMeta(film) {
    return `${homeEscape(film?.year || "")}${film?.director ? ` · ${homeEscape(film.director)}` : ""}`;
  }

  function homePrimaryActionHtml(context) {
    let { films, projects, publicProfile } = context;
    let openIntake = homeIntakeState.workflows.find(
      (workflow) => !workflow.completed_at,
    );
    if (!publicProfile && openIntake) {
      let film = openIntake.watched?.films || {};
      return `<article class="home-daily-card home-daily-card--primary" id="homeNextAction" data-home-action="intake">
        ${homeFilmMedia(film)}
        <div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Continue your Oskars"))}</span><h2>${homeEscape(film.title || ui("Unfinished Intake"))}</h2><p>${homeEscape(ui("Your rating, ranking, or ceremony decisions are waiting."))}</p><a class="button-link" href="intake.html?intake=${homeEscape(encodeURIComponent(openIntake.id))}">${homeEscape(ui("Resume Intake"))}</a></div>
      </article>`;
    }
    if (!publicProfile && projects.length) {
      let { project, next } = projects[0];
      let film = next.film;
      return `<article class="home-daily-card home-daily-card--primary" id="homeNextAction" data-home-action="project">
        ${homeFilmMedia(film)}
        <div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Continue a project"))}</span><h2>${homeEscape(project.name)}</h2><p>${homeEscape(ui("Up next: {title}", { title: window.localizedFilmTitle?.(film) || film.title }))}</p><a class="button-link" href="${homeEscape(next.href || window.projectPageUrl(project.id))}">${homeEscape(ui("Open next film"))}</a></div>
      </article>`;
    }
    if (publicProfile) {
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="public"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Published archive"))}</span><h2>${homeEscape(ui("Explore this film world"))}</h2><p>${homeEscape(ui("Browse its years, decades, and all-time collection."))}</p><a class="button-link" href="periods.html">${homeEscape(ui("Explore periods"))}</a></div></article>`;
    }
    if (!films.length) {
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="import"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Start your archive"))}</span><h2>${homeEscape(ui("Bring in your films"))}</h2><p>${homeEscape(ui("Import an existing diary or add your latest watch."))}</p><div class="home-daily-actions"><a class="button-link" href="data.html">${homeEscape(ui("Import films"))}</a><a href="intake.html">${homeEscape(ui("Add a watched film"))}</a></div></div></article>`;
    }
    let intakeStatus =
      homeIntakeState.status === "loading"
        ? `<small>${homeEscape(ui("Checking for unfinished Intake…"))}</small>`
        : homeIntakeState.status === "error"
          ? `<small>${homeEscape(ui("Could not check unfinished Intake. Intake is still available."))}</small>`
          : `<small>${homeEscape(ui("No unfinished Intake or project."))}</small>`;
    return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="caught-up" data-home-intake-status="${homeEscape(homeIntakeState.status)}"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("All caught up"))}</span><h2>${homeEscape(ui("Add your latest watch"))}</h2><p>${homeEscape(ui("Start with rating, then place the film in your rankings and ceremonies."))}</p><a class="button-link" href="intake.html">${homeEscape(ui("Open Intake"))}</a>${intakeStatus}</div></article>`;
  }

  function homeMemoryHtml(memory, filmCount) {
    if (!memory)
      return `<article class="home-daily-card home-daily-card--empty"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Archive memory"))}</span><h2>${homeEscape(ui("No memories yet"))}</h2><p>${homeEscape(ui("Watched films will bring a different memory back each day."))}</p></div></article>`;
    let film = memory.film;
    let href = homeFilmHref(film);
    let reason = memory.anniversary
      ? ui("Watched on this day in {year}.", { year: memory.date.slice(0, 4) })
      : ui("Today's stable pick from {count} watched films.", {
          count: filmCount,
        });
    return `<article class="home-daily-card">${homeFilmMedia(film)}<div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Archive memory"))}</span><h2>${href ? `<a href="${homeEscape(href)}">${homeEscape(window.localizedFilmTitle?.(film) || film.title)}</a>` : homeEscape(film.title)}</h2><p class="home-daily-film-meta">${homeFilmMeta(film)}</p><p>${homeEscape(reason)}</p>${film.rating ? `<strong class="rating">${homeEscape(film.rating)}</strong>` : ""}</div></article>`;
  }

  function homeWatchlistHtml(pick, count) {
    if (!pick)
      return `<article class="home-daily-card home-daily-card--empty"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("From your watchlist"))}</span><h2>${homeEscape(ui("Nothing waiting"))}</h2><p>${homeEscape(ui("Add films to your watchlist and one will appear here each day."))}</p><a href="discover.html">${homeEscape(ui("Discover films"))}</a></div></article>`;
    let film = window.watchlistFilmLike?.(pick.item) || pick.item;
    let href = pick.item.supabaseFilmId
      ? window.filmPageUrl(pick.item.supabaseFilmId)
      : homeFilmHref(film);
    return `<article class="home-daily-card">${homeFilmMedia(film)}<div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("From your watchlist"))}</span><h2>${href ? `<a href="${homeEscape(href)}">${homeEscape(window.localizedFilmTitle?.(film) || film.title)}</a>` : homeEscape(film.title)}</h2><p class="home-daily-film-meta">${homeFilmMeta(film)}</p><p>${homeEscape(window.watchQueueReasonText(pick.reason))} ${homeEscape(ui("This pick stays the same today."))}</p>${window.renderWatchlistTierBadge(pick.item.tier, { escape: homeEscape, modifier: pick.item.tierModifier })}<small>${homeEscape(ui("Chosen from {count} watchlist films", { count }))}</small></div></article>`;
  }

  function updateHomePrimaryAction() {
    let target = document.getElementById("homeNextAction");
    if (target && homeDashboardContext)
      target.outerHTML = homePrimaryActionHtml(homeDashboardContext);
  }

  function renderHome() {
    let doneRender = window.startOskarsPerformance?.("home:render");
    let films = Object.values(window.state.filmsById || {});
    let people = Object.values(
      window.ensurePeopleIndex?.() || window.state.peopleById || {},
    );
    let years = Object.keys(window.state.years || {})
      .filter((key) => /^\d{4}$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    let annualAwardCount = 0;
    films.forEach((film) =>
      (film.awards || []).forEach((award) => {
        if (/^\d{4}$/.test(String(award.year || ""))) annualAwardCount += 1;
      }),
    );
    let doneDaily = window.startOskarsPerformance?.("home:dailyDashboard");
    let projects = homeProjectPicks();
    let publicProfile = Boolean(
      window.state.isPublicProfileView || window.resolveActiveProfileSlug?.(),
    );
    let memory = window.homeArchiveMemory(films);
    let watchlistPick = window.homeWatchlistPick(window.state.watchlist || []);
    homeDashboardContext = { films, projects, publicProfile };
    doneDaily?.();
    let sortLabels = {
      allTimeRank: ui("all-time rank"),
      rating: ui("rating"),
      yearScore: ui("year score"),
      decadeScore: ui("decade score"),
      centuryScore: ui("century score"),
      allTimeScore: ui("all-time score"),
      wins: ui("wins"),
      nominations: ui("nominations"),
    };
    function scoreStats(film, periodType) {
      return (
        window.calculateAwardStats?.(
          (film.awards || []).filter(
            (award) => window.awardScorePeriodType(award) === periodType,
          ),
        ) || {
          awardScore: 0,
          normalizedAwardScore: 0,
          wins: 0,
          nominations: 0,
        }
      );
    }
    function sortValue(entry, key) {
      if (key === "allTimeRank")
        return entry.film.allTimeRank
          ? -Number(entry.film.allTimeRank)
          : -999999;
      if (key === "rating") return window.filmRatingSortValue(entry.film);
      if (key === "wins") return entry.allStats.wins;
      if (key === "nominations") return entry.allStats.nominations;
      return entry[`${key}Stats`]?.awardScore || 0;
    }
    function compareBySort(left, right, key) {
      return sortValue(right, key) - sortValue(left, key);
    }
    function sortButton(key, label) {
      return `<button type="button" data-home-top-sort="${homeEscape(key)}" ${homeTopSort === key ? 'aria-pressed="true"' : ""}>${homeEscape(label)}</button>`;
    }
    function allTimeRankCell(film) {
      let rank = Number(film?.allTimeRank);
      if (!Number.isFinite(rank) || rank <= 0) return "";
      let rankText = homeEscape(film.allTimeRank);
      return rank <= 250
        ? `<span class="home-top-250-rank" title="${homeEscape(ui("Top 250 all-time film"))}" aria-label="${homeEscape(ui("Top 250 all-time film"))}: ${rankText}"><span class="top-250-marker"><span aria-hidden="true">★</span><small>${rankText}</small></span></span>`
        : `<span class="home-alltime-rank">${rankText}</span>`;
    }
    let topCacheKey = String(window.state?.aggregateVersion || 0);
    if (homeTopCache.key !== topCacheKey) {
      let doneTop = window.startOskarsPerformance?.("home:topStats");
      homeTopCache = {
        key: topCacheKey,
        entries: films
          .map((film) => {
            let yearScoreStats = scoreStats(film, "years");
            let decadeScoreStats = scoreStats(film, "decades");
            let centuryScoreStats = scoreStats(film, "centuries");
            let allTimeScoreStats = scoreStats(film, "allTime");
            return {
              film,
              yearScoreStats,
              decadeScoreStats,
              centuryScoreStats,
              allTimeScoreStats,
              allStats: window.calculateAwardStats?.(film.awards || []) || {
                awardScore: 0,
                normalizedAwardScore: 0,
                wins: 0,
                nominations: 0,
              },
            };
          })
          .filter(
            (entry) =>
              entry.allStats.nominations ||
              entry.film.allTimeRank ||
              entry.film.rating,
          ),
      };
      doneTop?.(`${homeTopCache.entries.length} entries`);
    }
    let topFilms = [...homeTopCache.entries]
      .sort((left, right) => {
        let primary = compareBySort(left, right, homeTopSort);
        if (primary) return primary;
        let previous =
          homePreviousTopSort && homePreviousTopSort !== homeTopSort
            ? compareBySort(left, right, homePreviousTopSort)
            : 0;
        if (previous) return previous;
        return (
          compareBySort(left, right, "yearScore") ||
          compareBySort(left, right, "wins") ||
          compareBySort(left, right, "nominations") ||
          Number(left.film.allTimeRank || 999999) -
            Number(right.film.allTimeRank || 999999) ||
          window.compareEnglishTitles(left.film.title, right.film.title)
        );
      })
      .slice(0, 25);
    let sortLabel = sortLabels[homeTopSort] || sortLabels.yearScore;

    function topMetricHtml(entry) {
      if (homeTopSort === "allTimeRank") {
        let rank = Number(entry.film.allTimeRank);
        return rank > 0 ? `#${homeEscape(rank)}` : "—";
      }
      if (homeTopSort === "rating") return homeEscape(entry.film.rating || "—");
      if (homeTopSort === "wins") return homeEscape(entry.allStats.wins);
      if (homeTopSort === "nominations")
        return homeEscape(entry.allStats.nominations);
      let stats = entry[`${homeTopSort}Stats`] || {};
      return `${homeEscape(stats.awardScore || 0)}<small>${homeEscape(window.formatNormalizedAwardScore(stats.normalizedAwardScore))}</small>`;
    }

    let doneTopPresentation = window.startOskarsPerformance?.(
      "home:topPresentation",
    );
    let topPreview = topFilms
      .slice(0, 5)
      .map((entry, index) => {
        let film = entry.film;
        return `<article class="home-top-preview-card">${window.renderFilmPoster(film, "hub")}<div><span class="leaderboard-position">#${index + 1}</span><h3><a href="${homeEscape(window.filmPageUrl(film.id))}">${homeEscape(window.localizedFilmTitle?.(film) || film.title)}</a></h3><p>${homeFilmMeta(film)}</p><strong class="home-top-preview-metric">${topMetricHtml(entry)}</strong></div></article>`;
      })
      .join("");

    let topRows = topFilms
      .map(
        (entry, index) => `<tr>
    <td class="leaderboard-position">${index + 1}</td>
    <td class="film-table-cell">${window.renderFilmPoster(entry.film, "thumb")}<span><a class="table-film-link" href="${homeEscape(window.filmPageUrl(entry.film.id))}"><strong>${homeEscape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</strong></a><span class="leaderboard-meta">${homeEscape(entry.film.year || "")}${entry.film.director ? ` · ${window.renderCompactNameListText(entry.film.director, { escape: homeEscape })}` : ""}</span></span></td>
    <td>${allTimeRankCell(entry.film)}</td>
    <td>${homeEscape(entry.film.rating || "")}</td>
    <td><strong>${entry.yearScoreStats.awardScore}</strong><span class="normalized-score">${window.formatNormalizedAwardScore(entry.yearScoreStats.normalizedAwardScore)}</span></td>
    <td><strong>${entry.decadeScoreStats.awardScore}</strong><span class="normalized-score">${window.formatNormalizedAwardScore(entry.decadeScoreStats.normalizedAwardScore)}</span></td>
    <td><strong>${entry.centuryScoreStats.awardScore}</strong><span class="normalized-score">${window.formatNormalizedAwardScore(entry.centuryScoreStats.normalizedAwardScore)}</span></td>
    <td><strong>${entry.allTimeScoreStats.awardScore}</strong><span class="normalized-score">${window.formatNormalizedAwardScore(entry.allTimeScoreStats.normalizedAwardScore)}</span></td>
    <td>${entry.allStats.wins}</td>
    <td>${entry.allStats.nominations}</td>
  </tr>`,
      )
      .join("");
    let topTable = window.renderLeaderboardTable({
      classes: "home-top-table",
      headers: [
        "#",
        homeEscape(ui("Film")),
        sortButton("allTimeRank", ui("All-time")),
        sortButton("rating", ui("Rating")),
        `${sortButton("yearScore", ui("Year score"))} <small>0–1</small>`,
        `${sortButton("decadeScore", ui("Decade score"))} <small>0–1</small>`,
        `${sortButton("centuryScore", ui("Century score"))} <small>0–1</small>`,
        `${sortButton("allTimeScore", ui("All-time score"))} <small>0–1</small>`,
        sortButton("wins", ui("Wins")),
        sortButton("nominations", ui("Noms")),
      ],
      rows: topRows,
    });
    doneTopPresentation?.();

    let doneDom = window.startOskarsPerformance?.("home:dom");
    document.getElementById("homeContent").innerHTML = `
    <section class="home-today" aria-labelledby="homeTodayHeading">
      <header class="home-today-header"><span class="eyebrow">${homeEscape(ui("Today"))}</span><h1 id="homeTodayHeading">${homeEscape(ui("What will you explore?"))}</h1><p>${homeEscape(ui("One next step, one memory, and one film waiting for you."))}</p></header>
      <section class="home-summary" aria-label="${homeEscape(ui("Archive summary"))}"><span><b>${films.length}</b> ${homeEscape(ui("Films"))}</span><span><b>${people.length}</b> ${homeEscape(ui("People"))}</span><span><b>${years.length}</b> ${homeEscape(ui("Years"))}</span><span><b>${annualAwardCount}</b> ${homeEscape(ui("Annual nominations"))}</span></section>
      <div class="home-daily-grid">${homePrimaryActionHtml(homeDashboardContext)}${homeMemoryHtml(memory, films.length)}${homeWatchlistHtml(watchlistPick, (window.state.watchlist || []).length)}</div>
    </section>
    <section class="home-top-films" id="top-films"><header class="home-top-films-header"><div><span class="eyebrow">${homeEscape(ui("Your rankings"))}</span><h2>${homeEscape(ui("Top films"))}</h2></div><span>${homeEscape(ui("Sorted by {sort}", { sort: sortLabel }))}</span></header><div class="home-top-preview">${topPreview}</div><details class="home-top-details"${homeTopExpanded ? " open" : ""}><summary>${homeEscape(ui("Explore the full Top 25 score table"))}</summary><div data-home-top-table>${homeTopExpanded ? topTable : ""}</div></details></section>`;
    window.enhanceCollapsibles?.(document.getElementById("homeContent"));
    let topDetails = document.querySelector(".home-top-details");
    topDetails?.addEventListener("toggle", (event) => {
      homeTopExpanded = event.currentTarget.open;
      if (!homeTopExpanded) return;
      let tableHost = event.currentTarget.querySelector(
        "[data-home-top-table]",
      );
      if (tableHost && !tableHost.firstElementChild)
        tableHost.innerHTML = topTable;
      window.enhanceHorizontalScroll?.(event.currentTarget);
    });
    if (homeTopExpanded) window.enhanceHorizontalScroll?.(topDetails);
    doneDom?.();
    doneRender?.();
  }

  window.renderHomeDashboard = renderHome;

  window
    .ensureOskarsData()
    .then(() => {
      if (window.oskarsAccountAccessBlocked?.()) return;
      renderHome();
      document
        .getElementById("homeContent")
        .addEventListener("click", (event) => {
          let button = event.target.closest("[data-home-top-sort]");
          if (!button) return;
          if (button.dataset.homeTopSort !== homeTopSort)
            homePreviousTopSort = homeTopSort;
          homeTopSort = button.dataset.homeTopSort;
          if (window.history?.replaceState && window.location?.href) {
            let url = new URL(window.location.href);
            if (homeTopSort === "yearScore") url.searchParams.delete("top");
            else url.searchParams.set("top", homeTopSort);
            window.history.replaceState(null, "", url);
          }
          renderHome();
        });
      window.addEventListener?.("oskars:localechange", renderHome);
      // A public-profile Home is entirely read-only. In particular, it must
      // never query the signed-in viewer's private Intake workflows.
      if (
        !homeDashboardContext.publicProfile &&
        window.loadSupabaseIntakeWorkflows
      ) {
        window
          .loadSupabaseIntakeWorkflows()
          .then((workflows) => {
            homeIntakeState = { status: "ready", workflows: workflows || [] };
            updateHomePrimaryAction();
          })
          .catch((error) => {
            console.warn("Could not check unfinished Intake", error);
            homeIntakeState = { status: "error", workflows: [] };
            updateHomePrimaryAction();
          });
      }
    })
    .catch((err) => {
      console.error("Failed to initialize Oskars", err);
      document.getElementById("homeContent").innerHTML =
        `<div class="detail-empty"><h1>${homeEscape(ui("Could not load The Oskars"))}</h1><p>${homeEscape(err.message)}</p><a href="data.html">${homeEscape(ui("Open Data"))}</a></div>`;
    });
})();
