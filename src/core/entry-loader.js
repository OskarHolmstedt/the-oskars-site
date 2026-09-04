/**
 * @file Validates each HTML entry point, paints the lightweight header shell,
 * and loads shared dependencies plus the selected page controller in order.
 */

(function () {
  let entry = document.currentScript?.dataset.entry;
  let pageEntries = new Set([
    "home",
    "data",
    "profile",
    "intake",
    "build",
    "rate-watched",
    "film",
    "person",
    "people",
    "directors",
    "subject",
    "category",
    "categories",
    "period",
    "periods",
    "tags",
    "tag",
    "discover",
    "franchises",
    "franchise",
    "watchlist-merge",
    "local-rank-merge",
    "ranking-review",
    "rank-year",
    "awards-year",
    "compare",
    "presentation",
    "community",
    "completion",
    "stats",
    "projects",
    "project",
    "collections",
    "collection",
  ]);
  if (!pageEntries.has(entry))
    throw new Error(`Unknown application entry: ${entry}`);

  // Light/dark/papyrus cycle (issue #152); papyrus is only ever reached by
  // explicit toggle, never inferred from prefers-color-scheme.
  // Duplicated verbatim in src/ui/site-header.js (this file paints the
  // header synchronously before site-header.js loads, so it can't depend on
  // that later copy) - keep both in sync on any theme change.
  let THEME_CYCLE = ["light", "dark", "papyrus"];
  let THEME_ICON = { light: "☾", dark: "🔥", papyrus: "☀" };

  function preferredTheme() {
    try {
      let saved = localStorage.getItem("oskars-theme");
      if (THEME_CYCLE.includes(saved)) return saved;
    } catch (err) {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function preferredPosterGrid() {
    try {
      return localStorage.getItem("oskars-poster-grid") === "on";
    } catch (err) {
      return false;
    }
  }

  function preferredPosterBackdrop() {
    try {
      return localStorage.getItem("oskars-poster-backdrop") === "on";
    } catch (err) {
      return false;
    }
  }

  function currentSection() {
    if (entry === "period") {
      let params = new URLSearchParams(window.location?.search || "");
      let view = params.get("view");
      if (
        view === "watchlist" ||
        view === "shared" ||
        view === "other" ||
        (params.get("type") === "alltime" && view === "films")
      )
        return "films";
      return "periods";
    }
    if (entry === "periods" || entry === "ranking-review") return "periods";
    if (entry === "category" || entry === "categories") return "categories";
    if (
      entry === "directors" ||
      entry === "franchise" ||
      entry === "franchises" ||
      entry === "tag" ||
      entry === "tags"
    )
      return "collections";
    if (entry === "watchlist-merge") return "films";
    // collection/collections (issue #449) join the "projects" active-nav
    // section, not the pre-existing "collections" one above (which is a
    // separate, unrelated umbrella for Directors/Franchises/Tags) -
    // conflating the two names in the nav would be exactly the kind of
    // domain/navigation mismatch this issue's own epic warns against.
    if (
      entry === "project" ||
      entry === "projects" ||
      entry === "collection" ||
      entry === "collections"
    )
      return "projects";
    if (entry === "community") return "community";
    if (entry === "home") return "home";
    return "";
  }

  function initialLocale() {
    try {
      return localStorage.getItem("oskars-locale") === "sv" ? "sv" : "en";
    } catch (err) {
      return "en";
    }
  }

  function renderStaticSiteHeader() {
    let header = document.querySelector(".app-header");
    if (!header || header.dataset.siteHeaderReady) return;
    let active = currentSection();
    let locale = initialLocale();
    let text = {
      home: locale === "sv" ? "Hem" : "Home",
      periods: locale === "sv" ? "Perioder" : "Periods",
      categories: locale === "sv" ? "Kategorier" : "Categories",
      collections: locale === "sv" ? "Samlingar" : "Collections",
      films: locale === "sv" ? "Filmer" : "Films",
      projects: locale === "sv" ? "Projekt" : "Projects",
      search: locale === "sv" ? "Sök" : "Search",
      searchAria: locale === "sv" ? "Sök i The Oskars" : "Search The Oskars",
      languageNext: locale === "sv" ? "EN" : "SV",
      languageAria: locale === "sv" ? "Switch to English" : "Switch to Swedish",
      menuAria: locale === "sv" ? "Öppna sidkatalog" : "Open site directory",
      menuTitle: locale === "sv" ? "Sidkatalog" : "Site directory",
      posterGridAria:
        locale === "sv" ? "Växla endast affischer" : "Toggle posters only",
      posterBackdropShow:
        locale === "sv" ? "Visa affischbakgrund" : "Show poster backdrop",
      posterBackdropHide:
        locale === "sv" ? "Dölj affischbakgrund" : "Hide poster backdrop",
      elsewhere: locale === "sv" ? "Annat" : "Elsewhere",
      discover: locale === "sv" ? "Upptäck" : "Discover",
      compare: locale === "sv" ? "Jämför" : "Compare",
      community: locale === "sv" ? "Gemenskap" : "Community",
      showcase: locale === "sv" ? "Utställning" : "Showcase",
      completion: locale === "sv" ? "Färdigställande" : "Completion",
      statistics: locale === "sv" ? "Statistik" : "Statistics",
      people: locale === "sv" ? "Personer" : "People",
      data: "Data",
      intake: locale === "sv" ? "Intag" : "Intake",
      build: locale === "sv" ? "Bygg dina Oskars" : "Build your Oskars",
      rateWatched: locale === "sv" ? "Betygsätt sett" : "Rate watched",
    };
    let navItems = [
      ["home", text.home, "index.html"],
      ["periods", text.periods, "periods.html"],
      ["categories", text.categories, "categories.html"],
      ["collections", text.collections, "franchises.html"],
      ["films", text.films, "period.html?type=alltime&view=films"],
      ["projects", text.projects, "projects.html"],
    ];
    let primary = navItems
      .map(([section, label, href]) => {
        let current = active === section;
        return `<a class="primary-nav-link${current ? " is-active" : ""}" href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a>`;
      })
      .join("");
    let theme = preferredTheme();
    document.documentElement.dataset.theme = theme;
    let posterGrid = preferredPosterGrid();
    if (posterGrid) document.documentElement.dataset.posterGrid = "on";
    let posterBackdrop = preferredPosterBackdrop();
    if (posterBackdrop) document.documentElement.dataset.posterBackdrop = "on";
    document.documentElement.lang = locale;
    header.dataset.siteHeaderReady = "shell";
    header.removeAttribute("data-site-header-pending");
    header.innerHTML = `<a class="app-brand" href="index.html">The Oskars</a>
    <div class="app-header-actions">
      <nav class="app-primary-nav" aria-label="Primary">${primary}</nav>
      <form class="site-search" role="search" data-site-search>
        <input type="search" autocomplete="off" placeholder="${text.search}" aria-label="${text.searchAria}" data-site-search-input>
        <div class="site-search-results" data-site-search-results hidden></div>
      </form>
      <button class="language-toggle" type="button" data-language-toggle aria-label="${text.languageAria}">${text.languageNext}</button>
      <button class="theme-toggle" type="button" data-theme-toggle title="Switch color theme" aria-label="Switch color theme">${THEME_ICON[theme] || "☾"}</button>
      <button class="poster-grid-toggle" type="button" data-poster-grid-toggle aria-pressed="${posterGrid ? "true" : "false"}" title="${text.posterGridAria}" aria-label="${text.posterGridAria}">🖼️</button>
      <button class="poster-backdrop-toggle" type="button" data-poster-backdrop-toggle aria-pressed="${posterBackdrop ? "true" : "false"}" title="${posterBackdrop ? text.posterBackdropHide : text.posterBackdropShow}" aria-label="${posterBackdrop ? text.posterBackdropHide : text.posterBackdropShow}">🎞️</button>
      <div class="auth-status" data-auth-status aria-live="polite"></div>
      <details class="site-menu">
        <summary aria-label="${text.menuAria}" title="${text.menuTitle}"><span></span><span></span><span></span></summary>
        <div class="site-menu-panel">
          <section><h2>${text.elsewhere}</h2><div class="site-menu-links"><a href="community.html">${text.community}</a><a href="discover.html">${text.discover}</a><a href="compare.html">${text.compare}</a><a href="presentation.html">${text.showcase}</a><a href="completion.html">${text.completion}</a><a href="stats.html">${text.statistics}</a><a href="people.html">${text.people}</a><a href="build.html">${text.build}</a><a href="intake.html">${text.intake}</a><a href="rate-watched.html">${text.rateWatched}</a><a href="data.html">${text.data}</a></div></section>
        </div>
      </details>
    </div>`;
    header
      .querySelector("[data-theme-toggle]")
      ?.addEventListener("click", (event) => {
        let current = document.documentElement.dataset.theme;
        let index = THEME_CYCLE.indexOf(current);
        let next = THEME_CYCLE[(index + 1) % THEME_CYCLE.length] || "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("oskars-theme", next);
        } catch (err) {}
        event.currentTarget.textContent = THEME_ICON[next] || "☾";
      });
    header
      .querySelector("[data-language-toggle]")
      ?.addEventListener("click", () => {
        try {
          localStorage.setItem("oskars-locale", locale === "sv" ? "en" : "sv");
        } catch (err) {}
        window.location?.reload?.();
      });
    let escapeHeaderText = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[character],
      );
    let signedInHeaderAccountHtml = (user, displayName) => {
      let name = String(displayName || user?.email || "Profile").trim();
      let initial = Array.from(name)[0]?.toLocaleUpperCase() || "?";
      let candidateAvatar =
        user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "";
      let avatar = /^https:\/\//i.test(candidateAvatar)
        ? `<img src="${escapeHeaderText(candidateAvatar)}" alt="" referrerpolicy="no-referrer">`
        : `<span aria-hidden="true">${escapeHeaderText(initial)}</span>`;
      return `<div class="auth-status-account"><a class="auth-status-profile" href="profile.html" title="${escapeHeaderText(name)}"><span class="auth-status-avatar">${avatar}</span><span class="auth-status-name">${escapeHeaderText(name)}</span></a><button class="auth-status-sign-out" type="button" data-supabase-sign-out aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M8 4H4.8A1.8 1.8 0 0 0 3 5.8v8.4A1.8 1.8 0 0 0 4.8 16H8M12.5 6.5 16 10l-3.5 3.5M7 10h9"/></svg></button></div>`;
    };
    window.renderStaticHeaderAuth = async function () {
      let status = header.querySelector("[data-auth-status]");
      if (!status || !window.resolveSupabaseAuthState) return;
      let auth = await window.resolveSupabaseAuthState();
      if (auth?.status !== "signed-in" || !auth.user?.id) {
        status.innerHTML = '<div class="auth-status-sign-in" data-supabase-sign-in></div>';
        window.renderGoogleSignInButtonForSupabase?.(
          status.querySelector("[data-supabase-sign-in]"),
        );
        return;
      }
      let profile = await window.loadSupabaseProfile?.().catch(() => null);
      let name =
        profile?.display_name ||
        auth.user.user_metadata?.full_name ||
        auth.user.user_metadata?.name ||
        auth.user.email ||
        "Profile";
      status.innerHTML = signedInHeaderAccountHtml(auth.user, name);
      status
        .querySelector("[data-supabase-sign-out]")
        ?.addEventListener("click", async (event) => {
          event.currentTarget.disabled = true;
          await window.signOutOfSupabase?.();
          window.location.reload();
        });
    };
    window.onSupabaseAuthChange?.(() => window.renderStaticHeaderAuth?.());
  }

  renderStaticSiteHeader();

  // Loaded and rendered before anything else, on every page, so the header is
  // always the first thing painted regardless of how much the rest of a page's
  // dependency chain has to load (previously home/editor/data only rendered the
  // header from their own page script, i.e. after the *entire* list below).
  let headerDependencies = [
    // Must load before state-shape.js: createEmptyState() reads this
    // bundled default synchronously at module-load time (issue #277).
    "src/core/bundled-official-results.js",
    "src/core/state-shape.js",
    "src/core/performance.js",
    "src/domain/category-order.js",
    "src/core/urls.js",
    "src/ui/page-utils.js",
    "src/ui/i18n.js",
    "src/ui/archive-indexes.js",
    "src/ui/site-header.js",
  ];

  let dependencies = [
    "src/core/canonical-data.js",
    "src/core/canonical-data-official.js",
    "src/core/edit-log.js",
    "src/core/edit-undo.js",
    "src/core/state.js",
    "src/domain/film-matching.js",
    "src/domain/film-filters.js",
    "src/domain/credits.js",
    "src/domain/tags.js",
    "src/domain/awards.js",
    ...(["data", "completion"].includes(entry)
      ? ["src/domain/award-bracket-completion.js"]
      : []),
    ...(["completion", "project"].includes(entry)
      ? ["src/domain/watch-goals.js"]
      : []),
    ...(["film", "period", "data", "intake", "awards-year"].includes(entry)
      ? ["src/domain/nomination-plans.js"]
      : []),
    "src/domain/franchises.js",
    "src/domain/collection-awards.js",
    "src/domain/official-completion.js",
    ...(["period", "category", "stats"].includes(entry)
      ? ["src/domain/official-comparison.js"]
      : []),
    ...(entry === "person" ? ["src/domain/official-people.js"] : []),
    "src/domain/projects.js",
    "src/domain/watch-queue.js",
    "src/domain/local-rank.js",
    "src/domain/merge-order.js",
    "src/domain/watched-films.js",
    "src/domain/watched-intake.js",
    "src/domain/watched-ratings.js",
    "src/domain/posters.js",
    ...([
      "build",
      "rate-watched",
      "tags",
      "franchises",
      "directors",
      "projects",
      "periods",
      "categories",
    ].includes(entry)
      ? ["src/ui/poster-deck.js"]
      : []),
    "src/domain/poster-selection.js",
    "src/domain/image-providers.js",
    "src/domain/image-batches.js",
    "src/domain/tmdb-link-check.js",
    ...(["film", "period", "data", "rate-watched", "build"].includes(entry)
      ? [
          "src/domain/film-metadata-editing.js",
          "src/domain/all-time-ranking.js",
          "src/domain/award-placement-editing.js",
        ]
      : []),
    ...(entry === "rank-year"
      ? ["src/domain/all-time-ranking.js", "src/domain/ranking-consistency.js"]
      : []),
    ...(entry === "awards-year"
      ? [
          "src/domain/film-metadata-editing.js",
          "src/domain/award-placement-editing.js",
        ]
      : []),
    ...(entry === "ranking-review"
      ? [
          "src/domain/film-metadata-editing.js",
          "src/domain/all-time-ranking.js",
          "src/domain/award-placement-editing.js",
          "src/domain/ranking-consistency.js",
        ]
      : []),
    ...(entry === "period"
      ? ["src/domain/ranking-consistency.js", "src/domain/award-stories.js"]
      : []),
    ...(entry === "period" ? ["src/domain/decade-merge.js"] : []),
    ...(["data", "intake", "awards-year"].includes(entry)
      ? ["src/domain/films.js"]
      : []),
    ...(entry === "data" ? ["src/domain/opinion-rebuild.js"] : []),
    "src/domain/stats.js",
    ...(entry === "community" ? ["src/domain/community.js"] : []),
    ...(entry === "compare" ? ["src/domain/compare-targets.js"] : []),
    ...(entry === "presentation" ? ["src/domain/presentation-packs.js"] : []),
    "src/domain/people/index.js",
    "src/domain/shared-film-archive.js",
    "src/domain/people/aliases.js",
    "src/domain/people/subjects.js",
    "src/core/aggregates.js",
    ...(entry === "data" ? ["src/domain/data-health.js"] : []),
    "src/imports/ranked-list.js",
    "src/imports/diary.js",
    "src/imports/watchlists.js",
    "src/imports/sheet-import-utils.js",
    "src/imports/brackets.js",
    "src/imports/bracket-sheet.js",
    "src/imports/franchise-sheet.js",
    "src/imports/director-sheet.js",
    "src/imports/importer.js",
    "src/ui/country.js",
    "src/ui/film-rating.js",
    "src/ui/sort-keys.js",
    "src/ui/people-credits.js",
    "src/ui/scroll-affordance.js",
    "src/ui/collapsibles.js",
    "src/ui/award-credit.js",
    "src/ui/pagination.js",
    "src/ui/leaderboard.js",
    "src/ui/detail-scaffold.js",
    "src/ui/navigation.js",
    "src/ui/view-state.js",
    "src/ui/order-edit.js",
    "src/ui/film-card.js",
    "src/ui/film-table.js",
    "src/ui/progression.js",
    "src/ui/notes.js",
    "src/ui/search.js",
    "src/ui/posters.js",
    "src/ui/backdrop.js",
    ...(entry === "data"
      ? [
          "src/data/health-view.js",
          "src/data/import-report.js",
          "src/data/import-summary.js",
          "src/data/import-consistency.js",
          "src/data/metadata-batch.js",
        ]
      : entry === "profile"
        ? ["src/data/import-report.js", "src/data/import-summary.js"]
        : []),
    ...(entry === "period"
      ? [
          "src/pages/period/navigation.js",
          "src/pages/period/highlights.js",
          "src/pages/period/award-view.js",
          "src/pages/period/film-view.js",
          "src/pages/period/official-results-view.js",
          "src/pages/period/watchlist-view.js",
        ]
      : []),
    ...(entry === "compare" ? ["src/pages/compare/panels.js"] : []),
    ...(entry === "data"
      ? [
          "src/data/transfer.js",
          "src/data/public-profile-publication.js",
          "src/data/import-proposals.js",
          "src/imports/zip.js",
          "src/imports/letterboxd.js",
        ]
      : entry === "profile"
        ? ["src/data/transfer.js", "src/data/import-proposals.js"]
        : []),
    "src/core/persistence.js",
    "src/core/migrations.js",
    "src/core/bootstrap.js",
  ];

  // Supabase-backed workflows own their data loading and persistence, so the
  // Legacy window.state application stack above is not part of their page
  // contract. Keep the shared-header search usable (state.js supplies its
  // text normalizer; tags.js supplies the one non-optional index it calls),
  // then load only the UI/domain helpers each controller actually invokes.
  let supabaseEntryDependencies = {
    "rate-watched": [
      "src/core/state.js",
      "src/domain/tags.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
      "src/ui/search.js",
    ],
    "watchlist-merge": [
      "src/core/state.js",
      "src/domain/tags.js",
      "src/domain/merge-order.js",
      "src/imports/watchlists.js",
      "src/ui/detail-scaffold.js",
      "src/ui/film-table.js",
      "src/ui/search.js",
    ],
    "local-rank-merge": [
      "src/core/state.js",
      "src/domain/tags.js",
      "src/domain/merge-order.js",
      "src/ui/detail-scaffold.js",
      "src/ui/search.js",
    ],
    "ranking-review": [
      "src/core/state.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
    ],
    profile: ["src/core/state.js", "src/core/persistence.js"],
    "rank-year": [
      "src/core/state.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
    ],
    "awards-year": [
      "src/core/state.js",
      "src/domain/people/index.js",
      "src/domain/credits.js",
      "src/ui/award-credit.js",
      "src/ui/detail-scaffold.js",
    ],
    build: [
      "src/core/state.js",
      "src/ui/poster-deck.js",
      "src/ui/detail-scaffold.js",
    ],
    intake: [
      "src/core/state.js",
      "src/domain/people/index.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
    ],
  };

  function loadScript(path, optional = false) {
    return new Promise((resolve, reject) => {
      let script = document.createElement("script");
      script.src = path;
      script.onload = resolve;
      script.onerror = () =>
        optional ? resolve() : reject(new Error(`Could not load ${path}`));
      document.head.appendChild(script);
    });
  }

  function renderBlockedMessage(heading, detail) {
    let message = document.createElement("div");
    message.className = "detail-empty";
    let headingEl = document.createElement("h1");
    headingEl.textContent = heading;
    let detailEl = document.createElement("p");
    detailEl.textContent = detail;
    let home = document.createElement("a");
    home.href = "index.html";
    home.textContent = "Return home";
    message.append(headingEl, detailEl, home);
    document.querySelector("main")?.replaceChildren(message);
  }

  function renderLoadError(err) {
    console.error(`Failed to initialize ${entry}`, err);
    renderBlockedMessage("Could not load page", String(err.message || err));
  }

  // Owner-mutation pages: data.html and every guided mutation-workflow
  // page that has no independent read-only content of its own (intake,
  // rank-year, awards-year, watchlist-merge, local-rank-merge,
  // ranking-review — issue #256 broadened this from editor/data alone,
  // issue #245's original set; editor.html itself was removed in #433).
  // Gated below the UI layer — a viewer-mode session never loads their
  // dependencies or controller script at all, regardless of how it
  // navigated there.
  let ownerOnlyEntries = new Set([
    "data",
    "profile",
    "intake",
    "build",
    "rate-watched",
    "rank-year",
    "awards-year",
    "watchlist-merge",
    "local-rank-merge",
    "ranking-review",
    // tag.html, franchise.html, person.html, project.html, and
    // projects.html read/write real per-user Supabase data now (issue
    // #439) - unlike the other pages in this set, they did have
    // independent, publicly-viewable read content before this cutover (a
    // public-profile visitor could browse someone's tagged films, a
    // franchise page, a director's page, or their watch projects). Made
    // owner-only here as a deliberate, flagged scope simplification
    // rather than also building the public-profile-view branch on every
    // write-capable page this pass - a real regression for that viewing
    // path, not an oversight; worth reconsidering once all of #439/#440's
    // write-capable pages are done, as one holistic pass rather than
    // piecemeal per page. (A watchlisted film's own detail was folded
    // into film.html in #457, which is public-viewable/canEdit-gated
    // like every other film state - it never rejoined this set.)
    "tag",
    "franchise",
    "person",
    "project",
    "projects",
    // Bare collections (issue #449) - RLS confirms these are just as
    // strictly owner-only as projects, no public-read policy exists for
    // collections/collection_items.
    "collection",
    "collections",
  ]);

  // Entries with dedicated Supabase data loading and persistence. Every
  // other entry's path through this file is unaffected by this set.
  let supabaseBackedEntries = new Set([
    "rate-watched",
    "watchlist-merge",
    "local-rank-merge",
    "ranking-review",
    "profile",
    "rank-year",
    "awards-year",
    "build",
    "intake",
  ]);

  // Entries that reuse the established window.state-derived view model while
  // sourcing it exclusively from Supabase. The original read-only set came
  // from #438; film/period/data join it in #440 and install a Supabase write
  // boundary after their pure legacy dependencies load.
  let supabaseHydratedEntries = new Set([
    "home",
    "people",
    "directors",
    "subject",
    "category",
    "categories",
    "periods",
    "tags",
    "discover",
    "franchises",
    "compare",
    "presentation",
    "community",
    "completion",
    "stats",
    "film",
    "period",
    "data",
  ]);

  // Supabase-backed entries with real edit actions of their own that still
  // reuse their existing
  // page controller's full legacy dependency list rather than a curated
  // minimal one (unlike supabaseBackedEntries) - the controller calls
  // Supabase functions directly for both reads and writes (matching
  // intake.js's pattern), it just needs the same wide set of shared UI/
  // domain helpers (film cards, tags, franchises, posters, ...) the
  // collection controllers depend on (issue #439).
  let supabaseFullDependencyEntries = new Set([
    "tag",
    "franchise",
    "person",
    "project",
    "projects",
    "collection",
    "collections",
  ]);
  // Every one of these entries' own page controller (or a file it loads,
  // e.g. src/pages/film.js's/period.js's error-rollback window.hydrateState()
  // calls) still calls into persistence.js's window.load()/window.save()
  // (issue #438's finding) - persistence.js checks this flag directly so a
  // real IndexedDB read/write can't silently race with Supabase-sourced
  // state.
  window.OSKARS_ENTRY_SKIPS_LEGACY_DATA_LOAD =
    supabaseHydratedEntries.has(entry) || supabaseFullDependencyEntries.has(entry);

  (async function () {
    await loadScript("src/core/runtime-mode.js");
    await loadScript("runtime-mode.config.js", true);
    // Loaded early, before the owner-page gate below, so an active public-
    // profile session (issue #253 — a per-tab override on top of the baked
    // mode, not a baked mode itself) can block owner-only pages regardless
    // of deployment mode. Its later entry in `dependencies` is removed.
    await loadScript("src/core/public-profile.js");
    let runtimeModeResult = window.resolveRuntimeMode(
      window.OSKARS_RUNTIME_MODE,
    );
    window.OSKARS_RESOLVED_RUNTIME_MODE = runtimeModeResult.mode;
    if (!runtimeModeResult.valid) {
      renderBlockedMessage("Configuration error", runtimeModeResult.error);
      return;
    }
    let capabilities = window.runtimeModeCapabilities(runtimeModeResult.mode);
    let activeProfileSlug = window.resolveActiveProfileSlug?.();
    if (!capabilities.allowOwnerPages || activeProfileSlug) {
      document
        .querySelectorAll(
          '.site-menu-links a[href="data.html"], .site-menu-links a[href="profile.html"], .site-menu-links a[href="intake.html"], .site-menu-links a[href="build.html"], .site-menu-links a[href="rate-watched.html"]',
        )
        .forEach((link) => link.remove());
    }
    if (
      ownerOnlyEntries.has(entry) &&
      (!capabilities.allowOwnerPages || activeProfileSlug)
    ) {
      renderBlockedMessage(
        activeProfileSlug
          ? "Not available while viewing a public profile"
          : "Not available in viewer mode",
        activeProfileSlug
          ? "Stop viewing the public profile to use this page."
          : "This page requires owner or local access.",
      );
      return;
    }
    await loadScript("config.local.js", true);
    // Every entry now runs entirely on Supabase (epic #428) - the Firebase
    // account-gate path this used to branch to is gone.
    // page-utils.js is normally part of headerDependencies below, but
    // renderSupabaseAccountGate() needs window.pageEscape before that
    // point - loaded early here instead (and skipped when
    // headerDependencies is walked below, since it has a top-level
    // `let` that throws a real redeclaration error if the file loads
    // twice).
    await loadScript("src/ui/page-utils.js");
    await loadScript("supabase.config.js", true);
    await loadScript("src/core/supabase-client.js");
    await loadScript("src/core/supabase-workspace.js");
    await loadScript("src/core/supabase-account-gate.js");
    await window.renderStaticHeaderAuth?.();
    // Per-entry Supabase domain logic - the same
    // `entry === "..." ? [...] : []` conditional-loading shape the
    // existing `dependencies` array already uses throughout, just
    // evaluated in this branch instead since it needs to exist before
    // ensureOskarsData()'s skip check below, not interleaved with it.
    if (entry === "rate-watched")
      await loadScript("src/domain/supabase-watched-ratings.js");
    if (entry === "watchlist-merge")
      await loadScript("src/domain/supabase-watchlist-merge.js");
    if (entry === "local-rank-merge")
      await loadScript("src/domain/supabase-local-rank.js");
    if (entry === "ranking-review")
      await loadScript("src/domain/supabase-ranking-consistency.js");
    if (entry === "rank-year") {
      await loadScript("src/domain/supabase-ranking-consistency.js");
      await loadScript("src/domain/fractional-position.js");
    }
    if (entry === "build") {
      await loadScript("src/ui/film-rating.js");
      await loadScript("src/domain/supabase-ranking-consistency.js");
      await loadScript("src/domain/build-journey.js");
    }
    if (entry === "intake") {
      await loadScript("src/domain/fractional-position.js");
      await loadScript("src/domain/supabase-watched-intake.js");
    }
    if (["tag", "franchise", "person"].includes(entry)) {
      await loadScript("src/domain/fractional-position.js");
      await loadScript("src/domain/supabase-local-rank.js");
      // Shared Supabase-backed entity note/bulk-tier UI (issue #439) -
      // built for tag.js, then generalized here rather than duplicated
      // once franchise.js/person.js needed the identical capability.
      await loadScript("src/ui/supabase-entity-note.js");
      await loadScript("src/ui/supabase-watchlist-bulk-tier.js");
    }
    // project.html/collection.html both need the entity-note module (a
    // project/collection note) and fractional-position.js for their own
    // queue reorder (moveSupabaseCollectionItem) - not
    // supabase-local-rank.js (no local rank axis here) or the bulk-tier
    // module (no watchlist tiers on a project's/collection's own films).
    // projects.html/collections.html (the hub/create-dialog pages) need
    // neither - they only ever call createSupabaseProject/
    // listSupabaseProjects or createSupabaseCollection/
    // listSupabaseCollections, all plain supabase-workspace.js functions.
    if (entry === "project" || entry === "collection") {
      await loadScript("src/domain/fractional-position.js");
      await loadScript("src/ui/supabase-entity-note.js");
    }
    // state.js/aggregates.js/film-rating.js aren't loaded here (unlike
    // rate-watched/build/intake above) - these entries fall through to
    // the full legacy `dependencies` array below, which already
    // includes all three for every non-Supabase-pattern entry.
    if (
      supabaseHydratedEntries.has(entry) ||
      supabaseFullDependencyEntries.has(entry)
    )
      await loadScript("src/domain/supabase-legacy-hydration.js");
    if (
      window.runtimeAccountAccessRequired(runtimeModeResult.mode) &&
      !activeProfileSlug
    ) {
      window.renderSupabaseAccountGate(
        { status: "loading" },
        document.querySelector("main"),
      );
      let access = await window.resolveSupabaseAccountGate();
      if (!access.allowed) {
        window.renderSupabaseAccountGate(
          access,
          document.querySelector("main"),
        );
        return;
      }
      window.OSKARS_ACCOUNT_ACCESS_BLOCKED = false;
    }
    // page-utils.js has a top-level `let` - loading it twice throws a
    // real redeclaration SyntaxError in the browser (found running this
    // for real), so it's already been loaded early above (for
    // renderSupabaseAccountGate()'s pageEscape) and must be skipped here
    // rather than being "harmlessly" reloaded.
    let remainingHeaderDependencies = headerDependencies.filter(
      (dependency) => dependency !== "src/ui/page-utils.js",
    );
    for (let dependency of remainingHeaderDependencies)
      await loadScript(dependency);
    window.renderSiteHeader?.();
    if (supabaseBackedEntries.has(entry)) {
      for (let dependency of supabaseEntryDependencies[entry])
        await loadScript(dependency);
    } else {
      let pageDependencies = supabaseHydratedEntries.has(entry)
        ? dependencies.filter(
            (dependency) =>
              !["src/core/persistence.js", "src/core/migrations.js"].includes(
                dependency,
              ),
          )
        : dependencies;
      for (let dependency of pageDependencies) await loadScript(dependency);
      if (["film", "period", "data"].includes(entry))
        await loadScript("src/core/supabase-legacy-writes.js");
    }
    let pageLoadsOwnData =
      ["home", "data", "community"].includes(entry) ||
      supabaseBackedEntries.has(entry) ||
      supabaseFullDependencyEntries.has(entry);
    // "home" calls ensureOskarsData() itself (src/pages/home.js), so it's
    // correctly excluded here even though it's Supabase-hydrated (issue
    // #438). "community" never calls it at all.
    if (!pageLoadsOwnData) {
      await window.ensureOskarsData();
      if (window.oskarsAccountAccessBlocked?.()) return;
    }
    await loadScript(
      entry === "home" ? "src/pages/home.js" : `src/pages/${entry}.js`,
    );
    window.enhanceHorizontalScroll?.(document);
    window.refreshOskarsBackdrop?.();
    window.renderPosterAttribution?.();
  })().catch(renderLoadError);
})();
