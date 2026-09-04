/** @file Controls the home dashboard, archive search, saved views, top films, and project shortcuts. */

(function () {
  let homeEscape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  // entry-loader.js's early Supabase account-gate render replaces <main>'s
  // entire innerHTML before this script ever runs (issue #430's finding,
  // proven again in #437/#438) - render the static search shell fresh
  // here, matching every other single-container Supabase-backed page,
  // rather than relying on any pre-existing static markup in index.html.
  document.getElementById("homePage").innerHTML =
    `<section class="home-search-band">
      <label for="globalSearch">Search</label>
      <input id="globalSearch" type="search" autocomplete="off" placeholder="Films, people, roles, songs, categories, periods">
    </section>
    <section id="searchResults" class="home-search-results" hidden></section>
    <div id="homeContent"><p class="home-loading">Loading database…</p></div>`;
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

  function buildSearchIndex() {
    return window.buildSearchEntries({
      labels: {
        tier: ui("Tier"),
        watched: ui("Watched"),
        watchlist: "Watchlist",
      },
    });
  }

  function renderHome() {
    let doneRender = window.startOskarsPerformance?.("home:render");
    let films = Object.values(state.filmsById || {});
    let people = Object.values(
      window.ensurePeopleIndex?.() || state.peopleById || {},
    );
    let years = Object.keys(state.years || {})
      .filter((key) => /^\d{4}$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    let annualAwardCount = 0;
    films.forEach((film) =>
      (film.awards || []).forEach((award) => {
        if (/^\d{4}$/.test(String(award.year || ""))) annualAwardCount += 1;
      }),
    );
    // "Active project" (window.activeProject()/state.activeProjectId) is
    // retired, not fixed (issue #459) - it had no real UI to set it even
    // before the Supabase cutover (its only setter, setActiveProject(),
    // was already confirmed dead code and deleted in #458) and no
    // Supabase-backed equivalent concept exists; `pinned` is the one real,
    // persisted "highlight this project" signal a project actually has.
    let recentProjectLinks = [
      ...Object.values(window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID || {}),
    ]
      .filter((project) => !["archived", "complete"].includes(project.status))
      .sort((left, right) =>
        String(right.updatedAt || right.createdAt || "").localeCompare(
          String(left.updatedAt || left.createdAt || ""),
        ),
      )
      .map((project) => ({
        project,
        next: window.projectProgress(project).next,
      }))
      .filter((entry) => entry.next)
      .slice(0, 3);
    let recentProjectsHtml = recentProjectLinks.length
      ? `<section class="home-recent-projects"><span class="eyebrow">${homeEscape(ui("Recent project picks"))}</span><div class="home-recent-project-links">${recentProjectLinks.map((entry) => `<a href="${homeEscape(entry.next.href)}">${homeEscape(entry.project.name)}: ${homeEscape(window.localizedFilmTitle?.(entry.next.film) || entry.next.film.title)}</a>`).join("")}</div></section>`
      : "";
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
      return calculateAwardStats(
        (film.awards || []).filter(
          (award) => window.awardScorePeriodType(award) === periodType,
        ),
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
              allStats: calculateAwardStats(film.awards || []),
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

    let topRows = topFilms
      .map(
        (entry, index) => `<tr>
    <td class="leaderboard-position">${index + 1}</td>
    <td class="film-table-cell">${window.renderFilmPoster(entry.film, "thumb")}<span><a class="table-film-link" href="${homeEscape(filmPageUrl(entry.film.id))}"><strong>${homeEscape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</strong></a><span class="leaderboard-meta">${homeEscape(entry.film.year || "")}${entry.film.director ? ` · ${window.renderCompactNameListText(entry.film.director, { escape: homeEscape })}` : ""}</span></span></td>
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

    document.getElementById("homeContent").innerHTML = `
    <section class="home-summary"><span><b>${films.length}</b> ${homeEscape(ui("Films"))}</span><span><b>${people.length}</b> ${homeEscape(ui("People"))}</span><span><b>${years.length}</b> ${homeEscape(ui("Years"))}</span><span><b>${annualAwardCount}</b> ${homeEscape(ui("Annual nominations"))}</span></section>
    ${recentProjectsHtml}
    <section class="home-top-films"><h2>${homeEscape(ui("Top films"))} <span>${homeEscape(ui("sorted by"))} ${homeEscape(sortLabel)}</span></h2><div class="leaderboard-wrap"><table class="leaderboard home-top-table"><thead><tr><th>#</th><th>${homeEscape(ui("Film"))}</th><th>${sortButton("allTimeRank", ui("All-time"))}</th><th>${sortButton("rating", ui("Rating"))}</th><th>${sortButton("yearScore", ui("Year score"))} <small>0–1</small></th><th>${sortButton("decadeScore", ui("Decade score"))} <small>0–1</small></th><th>${sortButton("centuryScore", ui("Century score"))} <small>0–1</small></th><th>${sortButton("allTimeScore", ui("All-time score"))} <small>0–1</small></th><th>${sortButton("wins", ui("Wins"))}</th><th>${sortButton("nominations", ui("Noms"))}</th></tr></thead><tbody>${topRows}</tbody></table></div></section>`;
    window.enhanceCollapsibles?.(document.getElementById("homeContent"));
    doneRender?.();
  }

  function renderSearch(entries, query) {
    let finishQueryTimer = window.startOskarsPerformance?.("home:searchQuery");
    let results = document.getElementById("searchResults");
    let matches = window.searchMatches(entries, query, { limit: 40 });
    if (!matches.length) {
      results.hidden = true;
      results.innerHTML = "";
      finishQueryTimer?.("0 result(s)");
      return;
    }
    let rows = matches
      .map(
        (entry) =>
          `<tr><td>${homeEscape(entry.type)}</td><td><a class="table-film-link" href="${homeEscape(entry.href)}"><strong>${homeEscape(entry.name)}</strong></a></td><td>${homeEscape(entry.meta)}</td></tr>`,
      )
      .join("");
    results.hidden = false;
    results.innerHTML = window.renderLeaderboardTable({
      headers: [ui("Type"), ui("Name"), ui("Context")].map(homeEscape),
      rows,
    });
    finishQueryTimer?.(`${matches.length} result(s)`);
  }

  window.renderHomeDashboard = renderHome;

  window
    .ensureOskarsData()
    .then(() => {
      if (window.oskarsAccountAccessBlocked?.()) return;
      renderHome();
      let entries = null;
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
      document
        .getElementById("globalSearch")
        .addEventListener("input", (event) => {
          entries ||= buildSearchIndex();
          renderSearch(entries, event.target.value);
        });
      window.addEventListener?.("oskars:localechange", () => {
        entries = null;
        renderHome();
        let searchInput = document.getElementById("globalSearch");
        if (searchInput?.value)
          renderSearch(buildSearchIndex(), searchInput.value);
      });
    })
    .catch((err) => {
      console.error("Failed to initialize Oskars", err);
      document.getElementById("homeContent").innerHTML =
        `<div class="detail-empty"><h1>${homeEscape(ui("Could not load The Oskars"))}</h1><p>${homeEscape(err.message)}</p><a href="data.html">${homeEscape(ui("Open Data"))}</a></div>`;
    });
})();
