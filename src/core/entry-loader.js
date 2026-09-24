/**
 * @file Validates each HTML entry point, paints the lightweight header shell,
 * and loads shared dependencies plus the selected page controller in order.
 */

(function () {
  let entry = document.currentScript?.dataset.entry;
  window.OSKARS_ENTRY = entry;
  // Every script this loader adds carries one shared version, so a browser
  // can never pair a fresh page controller with a stale cached dependency.
  // A deployed artifact stamps the commit onto this loader's own tag
  // (scripts/package-artifact.py); a local dev server sends no cache
  // headers at all, so there every page load is its own version.
  let assetVersion =
    new URL(
      document.currentScript?.src || window.location.href,
    ).searchParams.get("v") ||
    (["localhost", "127.0.0.1", ""].includes(window.location.hostname)
      ? String(Date.now())
      : "");
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
    "custom-collections",
    "collection",
    "films",
    "data-tools",
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
      // The all-time Watched view moved to its own films.html destination
      // (issue #495) - period.html?view=films remains a valid, narrower
      // period-scoped Watched browse (e.g. just the 1990s), so it isn't
      // retired, but it no longer claims the primary Films section.
      if (view === "watchlist" || view === "shared" || view === "other")
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
    if (entry === "watchlist-merge" || entry === "films") return "films";
    if (
      entry === "collections" ||
      entry === "custom-collections" ||
      entry === "collection"
    )
      return "collections";
    if (entry === "project" || entry === "projects") return "projects";
    if (entry === "community") return "community";
    if (entry === "home") return "home";
    return "";
  }

  // "oskars-locale" is written here as a literal, not via
  // window.OSKARS_LOCALE_KEY (src/ui/i18n.js) - this runs before i18n.js
  // has loaded (this function and the language-toggle handler below fire
  // from the pre-hydration header render), so that constant doesn't exist
  // yet. Keep this literal in sync with OSKARS_LOCALE_KEY's value by hand.
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
      ["collections", text.collections, "collections.html"],
      ["films", text.films, "films.html"],
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
        // Same "oskars-locale" literal as initialLocale() above, same reason.
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
    window.pageEscape = window.escapeHtml = escapeHeaderText;
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
      if (!status) return;
      if (window.renderPublicProfileExit?.(status)) return;
      if (!window.resolveSupabaseAuthState) return;
      let auth = await window.resolveSupabaseAuthState();
      if (auth?.status !== "signed-in" || !auth.user?.id) {
        status.innerHTML =
          '<div class="auth-status-sign-in" data-supabase-sign-in></div>';
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
    // Not window.onSupabaseAuthChange?.(...) here: this runs before
    // src/core/supabase-client.js (the only place that global is ever
    // defined) has loaded, so a registration attempt at this point is
    // always a no-op. src/ui/site-header.js re-registers the identical
    // callback later, once supabase-client.js is actually loaded, and is
    // the registration that does the real work.
  }

  // Rendered unconditionally alongside the header, before the account gate
  // or any hydration - so the Privacy Notice link is always present, signed
  // in or out, gated or not (issue #587 follow-up: it was previously only
  // linked from the sign-in gate and profile page, not reachable from
  // every page the way a footer disclosure normally is). Relies on
  // src/ui/privacy-notice.js's global [data-privacy-notice-trigger]
  // delegation, loaded a few lines into the async flow below on every
  // entry - the same trigger the gate and profile links already use.
  //
  // The single site-wide footer object: this is the only place that
  // creates document.body's <footer class="app-footer">. Anything else
  // that wants a footer entry (src/ui/posters.js's TMDB attribution is the
  // other current one) fills the empty [data-footer-attribution] slot
  // below instead of creating a second, competing <footer> - two stacked
  // footers was the actual bug an owner screenshot caught here.
  function renderStaticSiteFooter() {
    if (document.querySelector(".app-footer")) return;
    let footer = document.createElement("footer");
    footer.className = "app-footer";
    footer.innerHTML = `<div class="app-footer-links"><a href="privacy.html" data-privacy-notice-trigger>Privacy notice</a></div><div class="app-footer-attribution" data-footer-attribution></div>`;
    document.body.appendChild(footer);
  }

  renderStaticSiteHeader();
  renderStaticSiteFooter();

  // Loaded and rendered before anything else, on every page, so the header is
  // always the first thing painted regardless of how much the rest of a page's
  // dependency chain has to load (previously home/editor/data only rendered the
  // header from their own page script, i.e. after the *entire* list below).
  window.OSKARS_STATS_COMPACT =
    entry === "stats" &&
    new URLSearchParams(window.location.search).get("statsSource") !== "legacy";
  // Period Watchlist compact-read cutover (issue #598): period.html serves
  // both the period-ranking view and, at ?view=watchlist, the Watchlist
  // view in one shared entry - unlike stats, only THIS specific view skips
  // eager full hydration; every other period.html visit (any other `view`,
  // or `view=watchlist` with the legacy escape hatch below) is completely
  // unaffected and keeps its existing eager-hydration behavior.
  window.OSKARS_WATCHLIST_COMPACT =
    entry === "period" &&
    new URLSearchParams(window.location.search).get("view") === "watchlist" &&
    new URLSearchParams(window.location.search).get("legacyWatchlist") !== "1";
  // Compact Completion cutover (issue #597 expansion): official-results,
  // award-bracket, and watch-goal completion paint fast from a compact
  // read; directors/franchises/projects ("known collections") still needs
  // the complete archive (the shared people/franchise indexes many other
  // pages also depend on - a materially wider-blast-radius problem #592
  // explicitly deferred), so that section shows a loading placeholder
  // until the same eager background full hydration used elsewhere
  // completes. `&legacyCompletion=1` is the manual escape hatch.
  window.OSKARS_COMPLETION_COMPACT =
    entry === "completion" &&
    new URLSearchParams(window.location.search).get("legacyCompletion") !== "1";
  // film.html compact-read cutover (issue #617): a bookmarked/direct
  // film.html?id=<filmId> visit gets a fast initial paint from a
  // one-film-scoped read instead of eager full archive hydration.
  // Unlike stats/watchlist above, this only applies to the canonical
  // Watched/Watchlist detail visit (`?id=`) - a `?tmdb=` Unseen-preview
  // visit has no filmId at all and depends on the shared film-catalog
  // archive regardless, so it's excluded here and keeps today's full
  // hydration unconditionally. `&legacyFilm=1` is the manual escape hatch.
  window.OSKARS_FILM_COMPACT =
    entry === "film" &&
    Boolean(new URLSearchParams(window.location.search).get("id")) &&
    new URLSearchParams(window.location.search).get("legacyFilm") !== "1";
  // person.html compact-read cutover (issue #633): a canonical
  // person.html?id=<people.id uuid> visit reads only that person's slice
  // of the archive. A legacy name-slug URL keeps the complete read (it
  // needs the people index to find the person at all) and redirects to the
  // uuid form, so the next visit is compact. `&legacyPerson=1` is the
  // manual escape hatch.
  window.OSKARS_PERSON_COMPACT =
    entry === "person" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      new URLSearchParams(window.location.search).get("id") || "",
    ) &&
    new URLSearchParams(window.location.search).get("legacyPerson") !== "1";
  let focusedShellEntries = new Set([
    "profile",
    ...(window.OSKARS_STATS_COMPACT ? ["stats"] : []),
    ...(window.OSKARS_WATCHLIST_COMPACT ? ["period"] : []),
    ...(window.OSKARS_COMPLETION_COMPACT ? ["completion"] : []),
    ...(window.OSKARS_FILM_COMPACT ? ["film"] : []),
    ...(window.OSKARS_PERSON_COMPACT ? ["person"] : []),
  ]);
  let headerDependencies = [
    // Hydrated entries need bundled defaults before state creation. Focused
    // entries restore them when the deferred archive is reshaped - except
    // compact Completion, which keeps this eager: unlike Stats (one known
    // source, gated on its own compact hasLiveAcademy flag) it can show
    // any number of official sources, several of which may have no live
    // ceremony data at all and rely entirely on this bundled fallback:
    // deferring it produced a real, confirmed regression (real-browser
    // verification showed sources like Cannes/Guldbaggen silently missing
    // from the compact view's official-results summary).
    ...(focusedShellEntries.has(entry) &&
    entry !== "completion" &&
    entry !== "person"
      ? []
      : ["src/core/bundled-official-results.js"]),
    "src/core/state-shape.js",
    "src/core/performance.js",
    "src/domain/category-order.js",
    "src/core/urls.js",
    "src/ui/page-utils.js",
    "src/ui/i18n.js",
    "src/ui/archive-indexes.js",
    ...(focusedShellEntries.has(entry) ? ["src/core/focused-shell.js"] : []),
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
    ...(entry === "completion"
      ? ["src/domain/trophies.js", "src/ui/trophies.js"]
      : []),
    ...(["completion", "project"].includes(entry)
      ? ["src/domain/watch-goals.js"]
      : []),
    ...(entry === "completion" ? ["src/domain/supabase-completion.js"] : []),
    ...(["film", "period", "data", "intake", "awards-year"].includes(entry)
      ? ["src/domain/nomination-plans.js"]
      : []),
    "src/domain/franchises.js",
    "src/domain/collection-awards.js",
    "src/domain/official-completion.js",
    ...(["period", "category", "stats"].includes(entry)
      ? ["src/domain/official-comparison.js"]
      : []),
    ...(entry === "person"
      ? ["src/domain/official-people.js", "src/domain/person-hero.js"]
      : []),
    ...([
      "period",
      "category",
      "stats",
      "completion",
      "film",
      "person",
      "films",
    ].includes(entry)
      ? ["src/domain/supabase-official-results-hydration.js"]
      : []),
    "src/domain/projects.js",
    "src/domain/watch-queue.js",
    ...(entry === "home" ? ["src/domain/home-dashboard.js"] : []),
    ...(entry === "collections" ? ["src/domain/collections-hub.js"] : []),
    ...(entry === "films"
      ? ["src/domain/film-catalog.js", "src/domain/collection-filters.js"]
      : []),
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
      "people",
      "projects",
      "project",
      "periods",
      "collections",
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
    "src/domain/stats.js",
    ...(entry === "community" ? ["src/domain/community.js"] : []),
    ...(entry === "compare" ? ["src/domain/compare-targets.js"] : []),
    ...(entry === "presentation" ? ["src/domain/presentation-packs.js"] : []),
    "src/domain/people/index.js",
    "src/domain/shared-film-archive.js",
    "src/domain/people/aliases.js",
    "src/domain/people/subjects.js",
    "src/core/aggregates.js",
    "src/imports/ranked-list.js",
    "src/imports/diary.js",
    "src/imports/watchlists.js",
    "src/imports/sheet-import-utils.js",
    "src/imports/brackets.js",
    "src/imports/bracket-sheet.js",
    "src/imports/franchise-sheet.js",
    "src/imports/director-sheet.js",
    "src/imports/directors-franchises-sheet.js",
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
      ? ["src/data/import-report.js", "src/data/import-summary.js"]
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
          "src/data/public-profile-publication.js",
          "src/data/import-proposals.js",
          "src/imports/zip.js",
          "src/imports/letterboxd.js",
        ]
      : entry === "profile"
        ? ["src/data/import-proposals.js"]
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
  // Every list here omitted src/ui/scroll-affordance.js (found via #447's
  // responsive-audit repair) - the giant legacy `dependencies` array below
  // carries it for every other entry, but these 9 pages load only this
  // trimmed list, so their mobile primary nav never got the horizontal-
  // overflow scroll affordance at all. Added uniformly rather than only to
  // the one entry (intake) the audit happens to exercise.
  let supabaseEntryDependencies = {
    "rate-watched": [
      "src/core/state.js",
      "src/core/urls.js",
      "src/domain/tags.js",
      "src/domain/posters.js",
      "src/ui/film-rating.js",
      "src/ui/posters.js",
      "src/ui/detail-scaffold.js",
      "src/ui/search.js",
      "src/ui/scroll-affordance.js",
    ],
    "watchlist-merge": [
      "src/core/state.js",
      "src/domain/tags.js",
      "src/domain/merge-order.js",
      "src/imports/watchlists.js",
      "src/ui/detail-scaffold.js",
      "src/ui/film-table.js",
      "src/ui/search.js",
      "src/ui/scroll-affordance.js",
    ],
    "local-rank-merge": [
      "src/core/state.js",
      "src/domain/tags.js",
      "src/domain/merge-order.js",
      "src/ui/detail-scaffold.js",
      "src/ui/search.js",
      "src/ui/scroll-affordance.js",
    ],
    "ranking-review": [
      "src/core/state.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
      "src/ui/scroll-affordance.js",
    ],
    stats: [
      "src/domain/people/index.js",
      "src/domain/credits.js",
      "src/core/state.js",
      "src/domain/film-matching.js",
      "src/domain/awards.js",
      "src/ui/film-rating.js",
      "src/ui/country.js",
      "src/domain/stats.js",
      "src/domain/official-completion.js",
      "src/domain/official-comparison.js",
      "src/domain/supabase-legacy-hydration.js",
      "src/domain/supabase-stats.js",
      "src/ui/leaderboard.js",
      "src/ui/detail-scaffold.js",
      "src/ui/scroll-affordance.js",
    ],
    profile: [
      "src/core/state.js",
      "src/core/persistence.js",
      "src/ui/scroll-affordance.js",
    ],
    "rank-year": [
      "src/core/state.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
      "src/ui/scroll-affordance.js",
    ],
    "awards-year": [
      "src/core/state.js",
      "src/domain/awards.js",
      "src/domain/people/index.js",
      "src/domain/credits.js",
      "src/domain/posters.js",
      "src/domain/image-providers.js",
      "src/domain/tmdb-credit-jobs.js",
      "src/ui/country.js",
      "src/ui/award-credit.js",
      "src/ui/detail-scaffold.js",
      "src/ui/scroll-affordance.js",
    ],
    build: [
      "src/core/state.js",
      "src/ui/poster-deck.js",
      "src/ui/detail-scaffold.js",
      "src/ui/scroll-affordance.js",
    ],
    intake: [
      "src/core/state.js",
      "src/domain/people/index.js",
      "src/ui/film-rating.js",
      "src/ui/detail-scaffold.js",
      "src/ui/scroll-affordance.js",
    ],
    // The Google Sheets importer (src/data/google-sheets-supabase-import.js)
    // fans out into nearly every import/domain helper in the app depending
    // on which sheet ranges the owner's local config defines (films,
    // watchlist, brackets, franchise/director sheets, ranked lists, ...),
    // several of them called without `?.` - a hand-curated trimmed list
    // here reliably went stale one missing function at a time (found via
    // real "window.parseRankedList/parseFilmRating is not a function"
    // reports). Reuse the same broad `dependencies` list every hydrated
    // entry gets, filtered the same way, plus this page's own
    // metadata/Sheets-specific files.
    "data-tools": dependencies
      .filter(
        (dependency) =>
          !["src/core/persistence.js", "src/core/migrations.js"].includes(
            dependency,
          ),
      )
      .concat([
        "src/domain/supabase-metadata-batch.js",
        "src/domain/metadata-jobs.js",
        "src/data/google-sheets.js",
        "src/data/google-sheets-supabase-import.js",
        "src/data/google-sheets-write-back.js",
        // Only merge-check.js's own report needs window.state.years
        // populated - it calls window.ensureOskarsData() itself, lazily,
        // rather than this page paying that hydration cost on every visit
        // just for its usual TMDB/duplicate tooling. Still needs
        // supabase-legacy-hydration.js loaded up front since that's what
        // defines buildLegacyStateFromSupabaseHydration/
        // buildSharedFilmArchiveFromSupabase that ensureOskarsData() calls.
        "src/domain/supabase-legacy-hydration.js",
        "src/domain/merge-check.js",
      ]),
  };

  function versionedAsset(path) {
    if (!assetVersion) return path;
    return `${path}${path.includes("?") ? "&" : "?"}v=${assetVersion}`;
  }

  let loadedScripts = new Map();
  function loadScript(path, optional = false) {
    if (loadedScripts.has(path)) return loadedScripts.get(path);
    let pending = new Promise((resolve, reject) => {
      let script = document.createElement("script");
      script.src = versionedAsset(path);
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        loadedScripts.delete(path);
        if (optional) resolve();
        else reject(new Error(`Could not load ${path}`));
      };
      document.head.appendChild(script);
    });
    loadedScripts.set(path, pending);
    return pending;
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
    "custom-collections",
    // Local-only owner tools (missing-metadata fetch, duplicate film/
    // person detection and merge) - gated a second time, inside its own
    // controller, on window.OSKARS_LOCAL_CONFIG?.ownerDataTools, so it's
    // inert on the deployed site even though it's registered the same as
    // any other owner-only entry here.
    "data-tools",
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
    "data-tools",
  ]);

  // Entries that reuse the established window.state-derived view model while
  // sourcing it exclusively from Supabase. The original read-only set came
  // from #438; film/period/data join it in #440 and install a Supabase write
  // boundary after their pure legacy dependencies load.
  let supabaseHydratedEntries = new Set([
    "home",
    "collections",
    "films",
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
    "custom-collections",
  ]);
  if (window.OSKARS_STATS_COMPACT) {
    supabaseHydratedEntries.delete("stats");
    supabaseBackedEntries.add("stats");
  }
  // Every one of these entries' own page controller (or a file it loads,
  // e.g. src/pages/film.js's/period.js's error-rollback window.hydrateState()
  // calls) still calls into persistence.js's window.load()/window.save()
  // (issue #438's finding) - persistence.js checks this flag directly so a
  // real IndexedDB read/write can't silently race with Supabase-sourced
  // state.
  // Every one of these entries across all sets is Supabase-backed. Derive
  // the legacy-skip flag comprehensively so no entry or Set can drift
  // (issue #508).
  window.OSKARS_ENTRY_SKIPS_LEGACY_DATA_LOAD =
    pageEntries.has(entry) ||
    supabaseHydratedEntries.has(entry) ||
    supabaseFullDependencyEntries.has(entry) ||
    supabaseBackedEntries.has(entry);

  let pageDependencies = supabaseHydratedEntries.has(entry)
    ? dependencies.filter(
        (dependency) =>
          !["src/core/persistence.js", "src/core/migrations.js"].includes(
            dependency,
          ),
      )
    : supabaseBackedEntries.has(entry)
      ? supabaseEntryDependencies[entry] || []
      : dependencies;

  function useLegacyStats() {
    if (!window.OSKARS_STATS_COMPACT) return;
    window.OSKARS_STATS_COMPACT = false;
    focusedShellEntries.delete("stats");
    supabaseBackedEntries.delete("stats");
    supabaseHydratedEntries.add("stats");
    headerDependencies = headerDependencies.filter(
      (path) => path !== "src/core/focused-shell.js",
    );
    headerDependencies.unshift("src/core/bundled-official-results.js");
    pageDependencies = dependencies.filter(
      (path) =>
        !["src/core/persistence.js", "src/core/migrations.js"].includes(path),
    );
  }

  // Performance: the loops below load headerDependencies and this entry's
  // main dependency list one script at a time, `await`ing each one fully
  // (download + parse + execute) before even requesting the next - a
  // serial network waterfall found to dominate page-load time (a
  // performance investigation into the app feeling slow after the
  // Supabase migration). A `<link rel=preload>` hint per script lets the
  // browser fetch all of them concurrently from this point on, while
  // execution below stays in the exact same serial order as before (a
  // real ordering dependency exists between at least two of these files -
  // see headerDependencies' own comment on bundled-official-results.js -
  // so scripts are still executed one at a time via loadScript(), just no
  // longer wait on each other's *download* first). Unsupported browsers
  // simply ignore the hint with no behavior change.
  [...new Set([...headerDependencies, ...pageDependencies])].forEach((path) => {
    let link = document.createElement("link");
    link.rel = "preload";
    link.as = "script";
    link.href = versionedAsset(path);
    document.head.appendChild(link);
  });

  (async function () {
    await loadScript("src/core/runtime-mode.js");
    await loadScript("runtime-mode.config.js", true);
    // Loaded early, before the owner-page gate below, so an active public-
    // profile session (issue #253 — a per-tab override on top of the baked
    // mode, not a baked mode itself) can block owner-only pages regardless
    // of deployment mode. Its later entry in `dependencies` is removed.
    await loadScript("src/core/public-profile.js");
    await window.renderStaticHeaderAuth?.();
    await loadScript("src/core/public-profile-supabase.js");
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
    if (activeProfileSlug) useLegacyStats();
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
    if (window.OSKARS_STATS_COMPACT_READS === false) useLegacyStats();
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
    if (["awards-year", "person", "franchise", "data"].includes(entry))
      await loadScript("src/domain/supabase-collection-ballots.js");
    await loadScript("src/core/supabase-hydration-cache.js");
    await loadScript("src/ui/privacy-notice.js");
    await loadScript("src/core/supabase-account-gate.js");
    await window.renderStaticHeaderAuth?.();
    // Per-entry Supabase domain logic - the same
    // `entry === "..." ? [...] : []` conditional-loading shape the
    // existing `dependencies` array already uses throughout, just
    // evaluated in this branch instead since it needs to exist before
    // ensureOskarsData()'s skip check below, not interleaved with it.
    if (entry === "rate-watched") {
      await loadScript("src/domain/supabase-watched-ratings.js");
      // supabaseIntakeRatingGrade() sorts the Rated section by exact
      // grade (rating + minus/plus) - "intake" in the name is a misnomer
      // for this reuse, the function itself is just a pure grade
      // calculator over a {rating, rating_modifier}-shaped row.
      await loadScript("src/domain/supabase-watched-intake.js");
    }
    if (entry === "watchlist-merge")
      await loadScript("src/domain/supabase-watchlist-merge.js");
    if (entry === "local-rank-merge")
      await loadScript("src/domain/supabase-local-rank.js");
    if (entry === "ranking-review") {
      await loadScript("src/domain/supabase-ranking-consistency.js");
      await loadScript("src/domain/fractional-position.js");
    }
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
    // projects.html/custom-collections.html (the list/create-dialog pages) need
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
    // Compact Watchlist read (issue #598) - only actually called in
    // window.OSKARS_WATCHLIST_COMPACT mode, but loading it unconditionally
    // for "period" is simpler than a second narrower condition and costs
    // nothing on every other period.html visit (a few hundred bytes,
    // parsed but never invoked).
    if (entry === "period")
      await loadScript("src/domain/supabase-watchlist.js");
    // Community's directory/compare/ceremony views are read-only over the
    // same isolated anonymous public reader direct profile viewing uses
    // (issue #483) - `activeProfileSlug` only ever recognizes the
    // singular `?profile=` viewing param, never Community's own bare
    // directory or its plural `?view=compare/ceremony&profiles=a,b`, so
    // without this it fell through to the same sign-in gate as every
    // owner page even though it depends on no account at all (issue #490).
    /**
     * Reports whether owner account access is currently blocked by the account gate.
     * @returns {boolean}
     */
    window.oskarsAccountAccessBlocked = () => false;
    if (
      window.runtimeAccountAccessRequired(runtimeModeResult.mode) &&
      !activeProfileSlug &&
      entry !== "community"
    ) {
      window.renderSupabaseAccountGate(
        { status: "loading" },
        document.querySelector("main"),
      );
      let access = await window.resolveSupabaseAccountGate();
      let blocked = !access.allowed;
      window.oskarsAccountAccessBlocked = () => blocked;
      if (blocked) {
        window.renderSupabaseAccountGate(
          access,
          document.querySelector("main"),
        );
        return;
      }
      window.OSKARS_ACCOUNT_ACCESS_BLOCKED = false;
      // Clears the "loading" overlay renderSupabaseAccountGate() prepended
      // above - some pages (data.html) have real static <main> content the
      // controller below needs intact, so nothing may have replaced it, but
      // the transient overlay itself still needs removing now that this
      // visit turned out to be signed in.
      window.renderSupabaseAccountGate(access, document.querySelector("main"));
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
    if (focusedShellEntries.has(entry)) {
      window.configureFocusedShell(async () => {
        await loadScript("src/core/bundled-official-results.js");
        await loadScript("src/domain/supabase-legacy-hydration.js");
        for (let dependency of dependencies) {
          if (
            !["src/core/persistence.js", "src/core/migrations.js"].includes(
              dependency,
            )
          )
            await loadScript(dependency);
        }
      });
    }
    if (window.OSKARS_STATS_COMPACT) {
      /** Loads bundled Academy results only when the compact read has no live Academy source. @returns {Promise<void>} Resolves when bundled defaults are available. */
      window.loadStatsOfficialFallback = () =>
        loadScript("src/core/bundled-official-results.js");
    }
    window.renderSiteHeader?.();
    if (supabaseBackedEntries.has(entry)) {
      for (let dependency of pageDependencies) await loadScript(dependency);
    } else {
      for (let dependency of pageDependencies) await loadScript(dependency);
      // Pre-existing gap found while building #597's compact-read cutover
      // (issue #613): completion.js's official-results "add unseen films
      // to the watchlist" action calls window.save?.(), but "completion"
      // was missing from this list - window.save was genuinely undefined
      // on completion.html, so that write silently no-op'd in production.
      if (["film", "period", "data", "completion"].includes(entry))
        await loadScript("src/core/supabase-legacy-writes.js");
    }
    let pageLoadsOwnData =
      ["home", "data", "community", "collections"].includes(entry) ||
      supabaseBackedEntries.has(entry) ||
      supabaseFullDependencyEntries.has(entry) ||
      // Compact Watchlist (issue #598): period.js manages its own lazy
      // hydration for this one view (fetching read_watchlist_page() first,
      // then falling back to a real ensureFocusedShellData() call before
      // any write or unsupported-sort-axis interaction) - unlike stats/
      // profile above, it keeps its full page dependency list (it's not in
      // supabaseBackedEntries), only the automatic eager hydration below is
      // skipped.
      window.OSKARS_WATCHLIST_COMPACT ||
      // Compact Completion (issue #597): completion.js manages its own
      // lazy hydration (fetching the compact projection first, then
      // falling back to a real ensureFocusedShellData() call before any
      // write or once known-collections data is actually needed) - it
      // keeps its full page dependency list, unlike stats/profile above,
      // since it's not in supabaseBackedEntries.
      window.OSKARS_COMPLETION_COMPACT ||
      // Compact film detail (issue #617): film.js manages its own lazy
      // hydration - fetching loadSupabaseFilmDetail() first, then falling
      // back to a real ensureFocusedShellData() call before any write -
      // it keeps its full page dependency list (it's not in
      // supabaseBackedEntries), only the automatic eager hydration below
      // is skipped.
      window.OSKARS_FILM_COMPACT;
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
