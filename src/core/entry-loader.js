/**
 * @file Validates each HTML entry point, paints the lightweight header shell,
 * and loads shared dependencies plus the selected page controller in order.
 */

(function () {
  let entry = document.currentScript?.dataset.entry;
  let pageEntries = new Set([
    "home",
    "editor",
    "data",
    "intake",
    "film",
    "person",
    "people",
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
    "watchlist-film",
    "watchlist-merge",
    "local-rank-merge",
    "ranking-review",
    "setup-year",
    "compare",
    "presentation",
    "completion",
    "stats",
    "projects",
    "project",
  ]);
  if (!pageEntries.has(entry))
    throw new Error(`Unknown application entry: ${entry}`);

  // Light/dark/papyrus cycle (issue #152); papyrus is only ever reached by
  // explicit toggle, never inferred from prefers-color-scheme.
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

  function currentSection() {
    if (entry === "period") {
      let params = new URLSearchParams(window.location?.search || "");
      if (params.get("view") === "watchlist") return "watchlist";
      if (params.get("type") === "alltime" && params.get("view") === "films")
        return "watched";
      return "periods";
    }
    if (entry === "periods" || entry === "ranking-review") return "periods";
    if (entry === "category" || entry === "categories") return "categories";
    if (entry === "franchise" || entry === "franchises") return "franchises";
    if (entry === "watchlist-film" || entry === "watchlist-merge")
      return "watchlist";
    if (entry === "project" || entry === "projects") return "projects";
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
      franchises: "Franchises",
      watchlist: "Watchlist",
      watched: locale === "sv" ? "Sett" : "Watched",
      projects: locale === "sv" ? "Projekt" : "Projects",
      search: locale === "sv" ? "Sök" : "Search",
      searchAria: locale === "sv" ? "Sök i The Oskars" : "Search The Oskars",
      languageNext: locale === "sv" ? "EN" : "SV",
      languageAria: locale === "sv" ? "Switch to English" : "Switch to Swedish",
      menuAria: locale === "sv" ? "Öppna sidkatalog" : "Open site directory",
      menuTitle: locale === "sv" ? "Sidkatalog" : "Site directory",
      posterGridAria:
        locale === "sv" ? "Växla endast affischer" : "Toggle posters only",
      elsewhere: locale === "sv" ? "Annat" : "Elsewhere",
      discover: locale === "sv" ? "Upptäck" : "Discover",
      compare: locale === "sv" ? "Jämför" : "Compare",
      showcase: locale === "sv" ? "Utställning" : "Showcase",
      completion: locale === "sv" ? "Färdigställande" : "Completion",
      statistics: locale === "sv" ? "Statistik" : "Statistics",
      people: locale === "sv" ? "Personer" : "People",
      tags: locale === "sv" ? "Taggar" : "Tags",
      editor: "Editor",
      data: "Data",
      intake: locale === "sv" ? "Intag" : "Intake",
    };
    let navItems = [
      ["home", text.home, "index.html"],
      ["periods", text.periods, "periods.html"],
      ["categories", text.categories, "categories.html"],
      ["franchises", text.franchises, "franchises.html"],
      [
        "watchlist",
        text.watchlist,
        "period.html?type=alltime&view=watchlist",
      ],
      ["watched", text.watched, "period.html?type=alltime&view=films"],
      ["projects", text.projects, "projects.html"],
    ];
    let primary = navItems
      .map(([section, label, href]) =>
        active === section
          ? `<strong>${label}</strong>`
          : `<a href="${href}">${label}</a>`,
      )
      .join("");
    let theme = preferredTheme();
    document.documentElement.dataset.theme = theme;
    let posterGrid = preferredPosterGrid();
    if (posterGrid) document.documentElement.dataset.posterGrid = "on";
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
      <details class="site-menu">
        <summary aria-label="${text.menuAria}" title="${text.menuTitle}"><span></span><span></span><span></span></summary>
        <div class="site-menu-panel">
          <section><h2>${text.elsewhere}</h2><div class="site-menu-links"><a href="discover.html">${text.discover}</a><a href="compare.html">${text.compare}</a><a href="presentation.html">${text.showcase}</a><a href="completion.html">${text.completion}</a><a href="stats.html">${text.statistics}</a><a href="people.html">${text.people}</a><a href="tags.html">${text.tags}</a><a href="intake.html">${text.intake}</a><a href="editor.html">${text.editor}</a><a href="data.html">${text.data}</a></div></section>
        </div>
      </details>
    </div>`;
  }

  renderStaticSiteHeader();

  // Loaded and rendered before anything else, on every page, so the header is
  // always the first thing painted regardless of how much the rest of a page's
  // dependency chain has to load (previously home/editor/data only rendered the
  // header from their own page script, i.e. after the *entire* list below).
  let headerDependencies = [
    "src/core/state-shape.js",
    "src/core/performance.js",
    "src/domain/category-order.js",
    "src/core/urls.js",
    "src/ui/page-utils.js",
    "src/ui/i18n.js",
    "src/ui/site-header.js",
  ];

  let dependencies = [
    "src/core/canonical-data.js",
    "src/core/reconciliation.js",
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
    ...(["film", "period", "editor", "data", "intake", "setup-year"].includes(
      entry,
    )
      ? ["src/domain/nomination-plans.js"]
      : []),
    "src/domain/franchises.js",
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
    "src/domain/posters.js",
    "src/domain/poster-selection.js",
    "src/domain/image-providers.js",
    "src/domain/image-batches.js",
    ...(["film", "period", "data", "setup-year"].includes(entry)
      ? ["src/domain/editing.js"]
      : []),
    ...(entry === "ranking-review"
      ? ["src/domain/editing.js", "src/domain/ranking-consistency.js"]
      : []),
    ...(["period", "setup-year"].includes(entry)
      ? ["src/domain/ranking-consistency.js"]
      : []),
    ...(entry === "period" ? ["src/domain/decade-merge.js"] : []),
    ...(["editor", "data", "intake", "setup-year"].includes(entry)
      ? ["src/domain/films.js"]
      : []),
    "src/domain/stats.js",
    ...(entry === "compare" ? ["src/domain/compare-targets.js"] : []),
    ...(entry === "presentation" ? ["src/domain/presentation-packs.js"] : []),
    "src/domain/people/index.js",
    "src/domain/people/aliases.js",
    "src/domain/people/subjects.js",
    "src/core/aggregates.js",
    ...(entry === "data" ? ["src/domain/data-health.js"] : []),
    "src/imports/ranked-list.js",
    "src/imports/watchlists.js",
    "src/imports/sheet-import-utils.js",
    "src/imports/brackets.js",
    "src/imports/bracket-sheet.js",
    "src/imports/franchise-sheet.js",
    "src/imports/director-sheet.js",
    "src/imports/importer.js",
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
    ...(entry === "data"
      ? [
          "src/data/health-view.js",
          "src/editor/import-report.js",
          "src/data/import-summary.js",
          "src/data/import-consistency.js",
          "src/data/metadata-batch.js",
        ]
      : []),
    ...(entry === "period"
      ? [
          "src/pages/period/navigation.js",
          "src/pages/period/highlights.js",
          "src/pages/period/award-view.js",
          "src/pages/period/film-view.js",
          "src/pages/period/official-results-view.js",
        ]
      : []),
    "src/core/persistence.js",
    ...(entry === "data"
      ? [
          "src/data/transfer.js",
          "src/data/publication.js",
          "src/data/import-proposals.js",
          "src/data/official-results.js",
          "src/data/google-sheets.js",
        ]
      : []),
    ...(entry === "editor" ? ["src/editor/forms.js"] : []),
    ...(entry === "home"
      ? [
          "src/core/onboarding.js",
          "src/core/sample-archive.js",
          "src/pages/home-onboarding.js",
        ]
      : []),
    "src/core/bootstrap.js",
  ];

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
    let container = document.querySelector("main");
    if (container) {
      container.replaceChildren(message);
      return;
    }
    // editor.html has no <main> wrapper; clear everything but the
    // already-rendered header shell instead of silently no-oping.
    Array.from(document.body.children).forEach((child) => {
      if (!child.classList.contains("app-header")) child.remove();
    });
    document.body.appendChild(message);
  }

  function renderLoadError(err) {
    console.error(`Failed to initialize ${entry}`, err);
    renderBlockedMessage("Could not load page", String(err.message || err));
  }

  // Owner-mutation pages: editor.html and data.html. Gated below the UI
  // layer (issue #245) — a viewer-mode session never loads their
  // dependencies or controller script at all, regardless of how it
  // navigated there.
  let ownerOnlyEntries = new Set(["editor", "data"]);

  (async function () {
    await loadScript("src/core/runtime-mode.js");
    await loadScript("runtime-mode.config.js", true);
    let runtimeModeResult = window.resolveRuntimeMode(
      window.OSKARS_RUNTIME_MODE,
    );
    window.OSKARS_RESOLVED_RUNTIME_MODE = runtimeModeResult.mode;
    if (!runtimeModeResult.valid) {
      renderBlockedMessage("Configuration error", runtimeModeResult.error);
      return;
    }
    let capabilities = window.runtimeModeCapabilities(runtimeModeResult.mode);
    if (!capabilities.allowOwnerPages) {
      document
        .querySelectorAll(
          '.site-menu-links a[href="editor.html"], .site-menu-links a[href="data.html"]',
        )
        .forEach((link) => link.remove());
    }
    if (ownerOnlyEntries.has(entry) && !capabilities.allowOwnerPages) {
      renderBlockedMessage(
        "Not available in viewer mode",
        "This page requires owner or local access.",
      );
      return;
    }
    await loadScript("config.local.js", true);
    for (let dependency of headerDependencies) await loadScript(dependency);
    window.renderSiteHeader?.();
    for (let dependency of dependencies) await loadScript(dependency);
    let pageLoadsOwnData = ["home", "editor", "data"].includes(entry);
    if (!pageLoadsOwnData) await window.ensureOskarsData();
    await loadScript(
      entry === "home"
        ? "src/pages/home.js"
        : entry === "editor"
          ? "src/editor/app.js"
          : `src/pages/${entry}.js`,
    );
    window.renderPosterAttribution?.();
  })().catch(renderLoadError);
})();
