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
  let homeModel = null;
  let homeLoadGeneration = 0;
  let homeTopExpanded = false;
  let homeIntakeState = { status: "loading", workflows: [] };
  let homeDashboardContext = null;
  let homeProfileCache = null;
  let homeLastSyncResult = null;

  function updateHomeLetterboxdSyncStatus(profile, syncResult) {
    if (profile !== undefined) homeProfileCache = profile;
    if (syncResult !== undefined) homeLastSyncResult = syncResult;
    let el = document.getElementById("homeLetterboxdSyncStatus");
    if (!el) return;
    let currentProfile = homeProfileCache;
    if (!currentProfile?.letterboxd_username) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    let detail;
    if (homeLastSyncResult?.createdCount > 0) {
      detail = ui("Synced {count} new watch(es)", {
        count: homeLastSyncResult.createdCount,
      });
    } else if (currentProfile.letterboxd_last_synced_at) {
      detail = ui("Synced {date}", {
        date: new Date(
          currentProfile.letterboxd_last_synced_at,
        ).toLocaleDateString(),
      });
    } else {
      detail = ui("Connected");
    }
    el.innerHTML = `<b>Letterboxd:</b> ${homeEscape(detail)}`;
    el.style.display = "";
  }

  function homeFilmHref(film) {
    let id = film?.supabaseFilmId || film?.id;
    return id ? window.filmPageUrl(id) : "";
  }

  function homeFilmMedia(film) {
    return film
      ? `<div class="home-daily-card-media">${window.renderFilmPoster(film, "hub", { priority: "high" })}</div>`
      : "";
  }

  function homeFilmMeta(film) {
    return `${homeEscape(film?.year || "")}${film?.director ? ` · ${homeEscape(film.director)}` : ""}`;
  }

  function homePrimaryActionHtml(context) {
    let { counts, projects, publicProfile, annualAwardCount, actions } =
      context;
    let openIntake = homeIntakeState.workflows.find(
      (workflow) => !workflow.completed_at,
    );
    if (!publicProfile && openIntake) {
      let film = openIntake.watched?.films || {};
      let eyebrow =
        openIntake.summary === "Letterboxd sync"
          ? ui("New Letterboxd watch")
          : ui("Continue your Oskars");
      return `<article class="home-daily-card home-daily-card--primary" id="homeNextAction" data-home-action="intake">
        ${homeFilmMedia(film)}
        <div class="home-daily-card-body"><span class="eyebrow">${homeEscape(eyebrow)}</span><h2>${homeEscape(film.title || ui("Unfinished Intake"))}</h2><p>${homeEscape(ui("Your rating, ranking, or ceremony decisions are waiting."))}</p><a class="button-link" href="intake.html?intake=${homeEscape(encodeURIComponent(openIntake.id))}">${homeEscape(ui("Resume Intake"))}</a></div>
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
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="public"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Published archive"))}</span><h2>${homeEscape(ui("Explore this film world"))}</h2><p>${homeEscape(ui("Browse its years, decades, and all-time collection."))}</p><a class="button-link" href="${counts.films ? "periods.html" : "films.html?status=watched"}">${homeEscape(ui(counts.films ? "Explore periods" : "Browse watched entries"))}</a></div></article>`;
    }
    if (!counts.films && counts.watched) {
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="watched"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Your watched archive"))}</span><h2>${homeEscape(ui("Revisit your watches"))}</h2><p>${homeEscape(ui("Your shorts, series, and other watches are saved. Browse them or add your latest watch."))}</p><div class="home-daily-actions"><a class="button-link" href="films.html?status=watched">${homeEscape(ui("Browse watched entries"))}</a><a href="intake.html">${homeEscape(ui("Add a watched film"))}</a></div></div></article>`;
    }
    let unratedCount = actions?.unratedCount || 0;
    if (unratedCount > 0) {
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="rate-unrated"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Rate your films"))}</span><h2>${homeEscape(ui("Rate your unrated imports"))}</h2><p>${homeEscape(ui("You have {count} unrated films in your archive. Rate them to unlock leaderboards and rankings.", { count: unratedCount }))}</p><div class="home-daily-actions"><a class="button-link" href="rate-watched.html">${homeEscape(ui("Rate unrated films"))}</a><a class="button-link button-secondary" href="intake.html">${homeEscape(ui("Add a watched film"))}</a></div></div></article>`;
    }
    let untieredCount = actions?.untieredCount || 0;
    if (untieredCount > 0) {
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="tier-watchlist"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Enrich your watchlist"))}</span><h2>${homeEscape(ui("Set tiers for your {count} imported watchlist films", { count: untieredCount }))}</h2><p>${homeEscape(ui("Prioritise your watchlist with S/A/B/C/D tiers to decide what to watch next."))}</p><div class="home-daily-actions"><a class="button-link" href="watchlist.html">${homeEscape(ui("Set watchlist tiers"))}</a><a class="button-link button-secondary" href="periods.html">${homeEscape(ui("Explore decades"))}</a></div></div></article>`;
    }
    if (annualAwardCount === 0 && counts.watched > 0) {
      return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="build-first-year"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Build your Oskars"))}</span><h2>${homeEscape(ui("Build your first ceremony"))}</h2><p>${homeEscape(ui("Explore your imported films across decades and pick a year to build your first ceremony."))}</p><div class="home-daily-actions"><a class="button-link" href="periods.html">${homeEscape(ui("Explore decades"))}</a><a class="button-link button-secondary" href="build.html">${homeEscape(ui("Build a ceremony"))}</a></div></div></article>`;
    }
    let intakeStatus =
      homeIntakeState.status === "loading"
        ? `<small>${homeEscape(ui("Checking for unfinished Intake…"))}</small>`
        : homeIntakeState.status === "error"
          ? `<small>${homeEscape(ui("Could not check unfinished Intake. Intake is still available."))}</small>`
          : `<small>${homeEscape(ui("No unfinished Intake or project."))}</small>`;
    return `<article class="home-daily-card home-daily-card--primary home-daily-card--text" id="homeNextAction" data-home-action="caught-up" data-home-intake-status="${homeEscape(homeIntakeState.status)}"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("All caught up"))}</span><h2>${homeEscape(ui("Add your latest watch"))}</h2><p>${homeEscape(ui("Start with rating, then place the film in your rankings and ceremonies."))}</p><a class="button-link" href="intake.html">${homeEscape(ui("Open Intake"))}</a>${intakeStatus}</div></article>`;
  }

  function homeMemoryHtml(memory, watchedCount) {
    if (!memory)
      return `<article class="home-daily-card home-daily-card--empty"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Archive memory"))}</span><h2>${homeEscape(ui("No memories yet"))}</h2><p>${homeEscape(ui("Watched entries will bring a different memory back each day."))}</p></div></article>`;
    let film = memory.film;
    let href = homeFilmHref(film);
    let reason = memory.anniversary
      ? ui("Watched on this day in {year}.", { year: memory.date.slice(0, 4) })
      : ui(
          "Today's stable pick from {count} watched entries, including shorts and series.",
          {
            count: watchedCount,
          },
        );
    return `<article class="home-daily-card">${homeFilmMedia(film)}<div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("Archive memory"))}</span><h2>${href ? `<a href="${homeEscape(href)}">${homeEscape(window.localizedFilmTitle?.(film) || film.title)}</a>` : homeEscape(film.title)}</h2><p class="home-daily-film-meta">${homeFilmMeta(film)}</p><p>${homeEscape(reason)}</p>${film.rating ? `<strong class="rating">${homeEscape(film.rating)}</strong>` : ""}</div></article>`;
  }

  function homeWatchlistHtml(pick, count) {
    if (!pick)
      return `<article class="home-daily-card home-daily-card--empty"><div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("From your watchlist"))}</span><h2>${homeEscape(ui("Nothing waiting"))}</h2><p>${homeEscape(ui("Add films to your watchlist and one will appear here each day."))}</p><a href="discover.html">${homeEscape(ui("Discover films"))}</a></div></article>`;
    let film = pick.item;
    let href = pick.item.supabaseFilmId
      ? window.filmPageUrl(pick.item.supabaseFilmId)
      : homeFilmHref(film);
    return `<article class="home-daily-card">${homeFilmMedia(film)}<div class="home-daily-card-body"><span class="eyebrow">${homeEscape(ui("From your watchlist"))}</span><h2>${href ? `<a href="${homeEscape(href)}">${homeEscape(window.localizedFilmTitle?.(film) || film.title)}</a>` : homeEscape(film.title)}</h2><p class="home-daily-film-meta">${homeFilmMeta(film)}</p><p>${homeEscape(window.watchQueueReasonText(pick.reason))} ${homeEscape(ui("This pick stays the same today."))}</p>${window.renderWatchlistTierBadge(pick.item.tier, { escape: homeEscape, modifier: pick.item.tierModifier })}<small>${homeEscape(ui("Chosen from {count} watchlist films", { count }))}</small></div></article>`;
  }

  function homeLateJoinNudgeHtml(context, profile) {
    let { counts, publicProfile } = context || {};
    if (publicProfile || !counts?.watched) return "";
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("oskars-dismissed-late-join-nudge") === "1"
    ) {
      return "";
    }

    let lbConnected = Boolean(profile?.letterboxd_username);
    let sheetsConnected = Boolean(
      typeof localStorage !== "undefined"
        ? localStorage.getItem("oskars-google-sheets-spreadsheet-id")
        : null,
    );

    let eyebrow;
    let heading;
    let description;
    let actions;

    if (!lbConnected) {
      eyebrow = ui("Path 2 · Letterboxd");
      heading = ui("Sync future watches automatically");
      description = ui(
        "Connect your Letterboxd username to detect new diary entries via RSS and start an Intake for them.",
      );
      actions = `<a class="button-link" href="profile.html#letterboxdProfilePanel">${homeEscape(ui("Connect Letterboxd"))}</a><a class="button-link button-secondary" href="data.html#letterboxdImport">${homeEscape(ui("Import ZIP"))}</a>`;
    } else if (!sheetsConnected) {
      eyebrow = ui("Path 4 · Spreadsheets");
      heading = ui("Track your archive in Google Sheets");
      description = ui(
        "Connect a Google Sheet to edit your films in a spreadsheet and sync changes back anytime.",
      );
      actions = `<a class="button-link" href="data.html#spreadsheetTemplates">${homeEscape(ui("Connect Google Sheet"))}</a>`;
    } else {
      return "";
    }

    return `<aside class="home-late-join-nudge" id="homeLateJoinNudge" aria-label="${homeEscape(ui("Connected source suggestion"))}">
      <div class="home-late-join-nudge-body">
        <span class="eyebrow">${homeEscape(eyebrow)}</span>
        <h3>${homeEscape(heading)}</h3>
        <p>${homeEscape(description)}</p>
        <div class="home-late-join-actions">
          ${actions}
        </div>
      </div>
      <button type="button" class="home-late-join-dismiss" id="homeLateJoinDismissBtn" aria-label="${homeEscape(ui("Dismiss suggestion"))}" title="${homeEscape(ui("Dismiss suggestion"))}">×</button>
    </aside>`;
  }

  function updateHomeLateJoinNudge(profile) {
    if (profile !== undefined) homeProfileCache = profile;
    let host = document.getElementById("homeLateJoinNudgeHost");
    if (!host || !homeDashboardContext) return;
    host.innerHTML = homeLateJoinNudgeHtml(
      homeDashboardContext,
      homeProfileCache,
    );
    wireHomeLateJoinDismiss();
  }

  function wireHomeLateJoinDismiss() {
    let dismissBtn = document.getElementById("homeLateJoinDismissBtn");
    dismissBtn?.addEventListener("click", () => {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("oskars-dismissed-late-join-nudge", "1");
      }
      let nudge = document.getElementById("homeLateJoinNudge");
      if (nudge) {
        nudge.style.opacity = "0";
        nudge.style.transform = "translateY(-4px)";
        setTimeout(() => nudge.remove(), 200);
      }
    });
  }

  function homeOnboardingHubHtml() {
    return `<div class="home-onboarding-grid">
      <article class="home-daily-card home-daily-card--primary home-daily-card--text home-onboarding-card">
        <div class="home-daily-card-body">
          <span class="eyebrow">${homeEscape(ui("Path 1 · Start fresh"))}</span>
          <h2>${homeEscape(ui("Start with films you remember"))}</h2>
          <p>${homeEscape(ui("Find old favourites, revisit a year, or log your latest watch. Your Oskars starts with one film."))}</p>
          <div class="home-daily-actions">
            <a class="button-link" href="films.html?start=fresh">${homeEscape(ui("Explore a year"))}</a>
            <a class="button-link button-secondary" href="intake.html?start=fresh">${homeEscape(ui("Add a film"))}</a>
          </div>
          <details class="home-onboarding-how-to">
            <summary>${homeEscape(ui("How does fresh start work?"))}</summary>
            <p>
              ${homeEscape(ui("Pick a release year to mark films you've seen, or add individual watches with ratings and ceremony ballots in Intake."))}<br />
              <a href="films.html?start=fresh">${homeEscape(ui("Explore release years ↗"))}</a>
            </p>
          </details>
        </div>
      </article>
      <article class="home-daily-card home-daily-card--text home-onboarding-card">
        <div class="home-daily-card-body">
          <span class="eyebrow">${homeEscape(ui("Path 2 · Letterboxd"))}</span>
          <h2>${homeEscape(ui("Letterboxd sync"))}</h2>
          <p>${homeEscape(ui("Import your Letterboxd export ZIP once, then connect your username to auto-sync future watches via RSS."))}</p>
          <div class="home-daily-actions">
            <a class="button-link" href="data.html#letterboxdImport">${homeEscape(ui("Import Letterboxd"))}</a>
          </div>
          <details class="home-onboarding-how-to">
            <summary>${homeEscape(ui("How do I get my export?"))}</summary>
            <p>
              ${homeEscape(ui("Go to Letterboxd Settings → Data and click Export Your Data, then upload the ZIP on the Data page."))}<br />
              <a href="https://letterboxd.com/settings/data/" target="_blank" rel="noopener noreferrer">${homeEscape(ui("Open Letterboxd export settings ↗"))}</a>
            </p>
          </details>
        </div>
      </article>
      <article class="home-daily-card home-daily-card--text home-onboarding-card">
        <div class="home-daily-card-body">
          <span class="eyebrow">${homeEscape(ui("Path 3 · IMDb"))}</span>
          <h2>${homeEscape(ui("IMDb import"))}</h2>
          <p>${homeEscape(ui("Import your IMDb ratings and watchlist CSVs. 1–10 ratings are converted directly to our 0.5–5.0★ scale."))}</p>
          <div class="home-daily-actions">
            <a class="button-link" href="data.html#imdbImport">${homeEscape(ui("Import IMDb"))}</a>
          </div>
          <details class="home-onboarding-how-to">
            <summary>${homeEscape(ui("How do I get my export?"))}</summary>
            <p>
              ${homeEscape(ui("Go to Your Ratings on IMDb, click the three dots (···) menu and select Export. You can do the same for Your Watchlist."))}<br />
              <a href="https://www.imdb.com/list/ratings/" target="_blank" rel="noopener noreferrer">${homeEscape(ui("Open IMDb ratings export ↗"))}</a>
            </p>
          </details>
        </div>
      </article>
      <article class="home-daily-card home-daily-card--text home-onboarding-card">
        <div class="home-daily-card-body">
          <span class="eyebrow">${homeEscape(ui("Path 4 · Spreadsheets"))}</span>
          <h2>${homeEscape(ui("Google Sheets & Excel"))}</h2>
          <p>${homeEscape(ui("Create a spreadsheet directly in your Google Drive, download CSV starter templates, or sync your custom sheets."))}</p>
          <div class="home-daily-actions">
            <a class="button-link" href="data.html#spreadsheetTemplates">${homeEscape(ui("Connect Google Sheets"))}</a>
          </div>
          <details class="home-onboarding-how-to">
            <summary>${homeEscape(ui("How does spreadsheet sync work?"))}</summary>
            <p>
              ${homeEscape(ui("Create a formatted workbook on Google Drive or download CSV starter templates. Edit in sheets, then sync or push updates anytime."))}<br />
              <a href="data.html#spreadsheetTemplates">${homeEscape(ui("Open spreadsheet templates ↗"))}</a>
            </p>
          </details>
        </div>
      </article>
    </div>`;
  }

  function renderHome() {
    let doneRender = window.startOskarsPerformance?.("home:render");
    if (!homeModel) {
      doneRender?.();
      return;
    }
    let { counts, memory, watchlistPick, projects, publicProfile, actions } =
      homeModel;
    let annualAwardCount = counts.annualNominations;
    homeDashboardContext = {
      counts,
      projects,
      publicProfile,
      annualAwardCount,
      actions,
    };
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
    let topFilms = homeModel.entries;
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
        let priority = index === 0 ? "high" : undefined;
        return `<article class="home-top-preview-card">${window.renderFilmPoster(film, "hub", { priority })}<div><span class="leaderboard-position">#${index + 1}</span><h3><a href="${homeEscape(window.filmPageUrl(film.id))}">${homeEscape(window.localizedFilmTitle?.(film) || film.title)}</a></h3><p>${homeFilmMeta(film)}</p><strong class="home-top-preview-metric">${topMetricHtml(entry)}</strong></div></article>`;
      })
      .join("");

    let topRows = topFilms
      .map(
        (entry, index) => `<tr>
    <td class="leaderboard-position">${index + 1}</td>
    <td class="film-table-cell">${window.renderFilmPoster(entry.film, "thumb", { priority: index < 4 ? "high" : undefined })}<span><a class="table-film-link" href="${homeEscape(window.filmPageUrl(entry.film.id))}"><strong>${homeEscape(window.localizedFilmTitle?.(entry.film) || entry.film.title)}</strong></a><span class="leaderboard-meta">${homeEscape(entry.film.year || "")}${entry.film.director ? ` · ${window.renderCompactNameListText(entry.film.director, { escape: homeEscape })}` : ""}</span></span></td>
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
    let mainGrid =
      !counts.watched && !publicProfile
        ? homeOnboardingHubHtml()
        : `<div class="home-daily-grid">${homePrimaryActionHtml(homeDashboardContext)}${homeMemoryHtml(memory, counts.watched)}${homeWatchlistHtml(watchlistPick, counts.watchlist)}</div>`;

    let topSection =
      !counts.films && !publicProfile
        ? ""
        : `<section class="home-top-films" id="top-films"><header class="home-top-films-header"><div><span class="eyebrow">${homeEscape(ui("Your rankings"))}</span><h2>${homeEscape(ui("Top films"))}</h2></div><span>${homeEscape(ui("Sorted by {sort}", { sort: sortLabel }))}</span></header><div class="home-top-preview">${topPreview}</div><details class="home-top-details"${homeTopExpanded ? " open" : ""}><summary>${homeEscape(ui("Explore the full Top 25 score table"))}</summary><div data-home-top-table>${homeTopExpanded ? topTable : ""}</div></details></section>`;

    let todayHeading =
      !counts.watched && !publicProfile
        ? `<span class="eyebrow">${homeEscape(ui("Welcome to The Oskars"))}</span><h1 id="homeTodayHeading">${homeEscape(ui("Start your archive"))}</h1><p>${homeEscape(ui("Choose the onboarding path that matches how you want to build and track your films."))}</p>`
        : `<span class="eyebrow">${homeEscape(ui("Today"))}</span><h1 id="homeTodayHeading">${homeEscape(ui("What will you explore?"))}</h1><p>${homeEscape(ui("One next step, one memory, and one film waiting for you."))}</p>`;

    let lateJoinNudge = homeLateJoinNudgeHtml(
      homeDashboardContext,
      homeProfileCache,
    );

    document.getElementById("homeContent").innerHTML = `
    <section class="home-today" aria-labelledby="homeTodayHeading">
      <header class="home-today-header">${todayHeading}</header>
      <section class="home-summary" aria-label="${homeEscape(ui("Archive summary"))}"><span><b>${counts.watched}</b> ${homeEscape(ui("Watched entries"))}</span><span><b>${counts.people}</b> ${homeEscape(ui("People"))}</span><span><b>${counts.releaseYears}</b> ${homeEscape(ui("Release years"))}</span><span><b>${annualAwardCount}</b> ${homeEscape(ui("Annual nominations"))}</span><span id="homeLetterboxdSyncStatus" class="home-summary-sync" style="display: none;"></span></section>
      ${mainGrid}
      <div id="homeLateJoinNudgeHost">${lateJoinNudge}</div>
    </section>
    ${topSection}`;
    window.enhanceCollapsibles?.(document.getElementById("homeContent"));
    wireHomeLateJoinDismiss();
    updateHomeLetterboxdSyncStatus();
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

  /** Renders the loaded compact Home model in the current locale. */
  window.renderHomeDashboard = renderHome;

  async function loadHome() {
    let generation = ++homeLoadGeneration;
    try {
      let model = await window.loadSupabaseHome({
        sort: homeTopSort,
        previousSort: homePreviousTopSort,
      });
      if (
        generation !== homeLoadGeneration ||
        window.oskarsAccountAccessBlocked?.()
      )
        return;
      homeModel = model;
      if (model.publicProfile) {
        window.state.isPublicProfileView = true;
        let slug = window.resolveActiveProfileSlug?.();
        window.showPublicProfileStatus?.(
          `Viewing ${model.profile?.display_name || slug}’s public profile · live data`,
          "viewer",
          [
            {
              label: "Copy profile link",
              run: () =>
                window.copyViewLink?.(
                  new URL(
                    `index.html?profile=${encodeURIComponent(slug)}`,
                    window.location.href,
                  ).href,
                ),
            },
          ],
        );
      }
      homeIntakeState = {
        status: model.actionsError ? "error" : "ready",
        workflows: model.intake ? [model.intake] : [],
      };
      renderHome();
      window.refreshFocusedShellBackdrop?.();
    } catch (err) {
      if (generation !== homeLoadGeneration) return;
      if (window.resolveActiveProfileSlug?.())
        window.showPublicProfileStatus?.(
          "This profile is temporarily unavailable",
          "error",
          [{ label: "Retry", run: loadHome }],
        );
      document.getElementById("homeContent").innerHTML =
        `<div class="detail-empty"><h1>${homeEscape(ui("Could not load The Oskars"))}</h1><p>${homeEscape(err.message)}</p><button type="button" data-home-retry>${homeEscape(ui("Try again"))}</button></div>`;
    }
  }

  document.getElementById("homeContent").addEventListener("click", (event) => {
    if (event.target.closest("[data-home-retry]")) {
      loadHome();
      return;
    }
    let button = event.target.closest("[data-home-top-sort]");
    if (!button || !homeTopSortValues.has(button.dataset.homeTopSort)) return;
    if (button.dataset.homeTopSort !== homeTopSort)
      homePreviousTopSort = homeTopSort;
    homeTopSort = button.dataset.homeTopSort;
    if (window.history?.replaceState && window.location?.href) {
      let url = new URL(window.location.href);
      if (homeTopSort === "yearScore") url.searchParams.delete("top");
      else url.searchParams.set("top", homeTopSort);
      window.history.replaceState(null, "", url);
    }
    loadHome();
  });
  window.addEventListener?.("oskars:localechange", renderHome);
  window.addEventListener?.("oskars:home-account-changed", () => {
    homeLoadGeneration += 1;
    homeModel = null;
    homeDashboardContext = null;
    homeProfileCache = null;
    homeLastSyncResult = null;
    document.getElementById("homeContent").innerHTML = "";
    if (window.getSupabaseCurrentUser?.()?.id) loadHome();
  });
  window.addEventListener?.("oskars:hydration-invalidated", () => {
    loadHome();
  });
  loadHome().then(async () => {
    if (!homeDashboardContext || homeDashboardContext.publicProfile) return;
    try {
      let identity = window.getSupabaseCurrentUser?.()?.id;
      let isCurrent = () =>
        identity === window.getSupabaseCurrentUser?.()?.id &&
        !window.resolveActiveProfileSlug?.();
      let profile = await window.loadSupabaseProfile?.();
      if (!isCurrent()) return;
      updateHomeLetterboxdSyncStatus(profile);
      updateHomeLateJoinNudge(profile);
      let syncResult = await window.syncLetterboxdIntakes?.();
      if (!isCurrent()) return;
      profile = await window.loadSupabaseProfile?.();
      if (!isCurrent()) return;
      updateHomeLetterboxdSyncStatus(profile, syncResult);
      updateHomeLateJoinNudge(profile);
      if (syncResult?.createdCount > 0) await loadHome();
    } catch (error) {
      console.warn("Letterboxd intake sync skipped", error);
    }
  });
})();
