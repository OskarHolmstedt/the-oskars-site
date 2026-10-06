/** @file Renders and binds the shared site header, navigation, search, locale, menu, and theme controls. */

(function () {
  // Mirrors window.pageEscape's own body - a defensive fallback for the
  // rare case this file's functions run before page-utils.js has defined
  // it.
  function defaultHeaderEscape(value) {
    return (window.escapeHtml || window.pageEscape || String)(value ?? "");
  }

  // Light/dark/papyrus cycle (issue #152); papyrus is only ever reached by
  // explicit toggle, never inferred from prefers-color-scheme. The icon
  // shown for a theme represents the *next* theme the toggle switches to.
  // Duplicated verbatim in src/core/entry-loader.js (that file paints the
  // header synchronously before this file loads, so it can't depend on this
  // copy without reintroducing a blocking request) - keep both in sync on
  // any theme change.
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

  function nextOskarsTheme(current) {
    let index = THEME_CYCLE.indexOf(current);
    return THEME_CYCLE[(index + 1) % THEME_CYCLE.length] || "dark";
  }

  function themeToggleTitle(next) {
    return headerText("theme.switchTo", `Switch to ${next} mode`, {
      mode: headerText(`theme.${next}`, next),
    });
  }

  /**
   * Applies and persists the selected color theme.
   * @param {'dark'|'light'|'papyrus'} theme Theme name.
   */
  window.applyOskarsTheme = function (theme) {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("oskars-theme", theme);
    } catch (err) {}
  };

  if (typeof document !== "undefined")
    document.documentElement.dataset.theme = preferredTheme();

  function preferredPosterGrid() {
    try {
      return localStorage.getItem("oskars-poster-grid") === "on";
    } catch (err) {
      return false;
    }
  }

  function posterGridToggleTitle(enabled) {
    return headerText(
      enabled ? "posterGrid.switchOff" : "posterGrid.switchOn",
      enabled ? "Show film details" : "Show posters only",
    );
  }

  /**
   * Applies and persists the poster-only film grid display mode (issue #223).
   * @param {boolean} enabled Whether poster-only mode is on.
   */
  window.applyOskarsPosterGrid = function (enabled) {
    if (enabled) document.documentElement.dataset.posterGrid = "on";
    else delete document.documentElement.dataset.posterGrid;
    try {
      localStorage.setItem("oskars-poster-grid", enabled ? "on" : "off");
    } catch (err) {}
  };

  function preferredPosterBackdrop() {
    try {
      return localStorage.getItem("oskars-poster-backdrop") === "on";
    } catch (err) {
      return false;
    }
  }

  function posterBackdropToggleTitle(enabled) {
    return headerText(
      enabled ? "posterBackdrop.switchOff" : "posterBackdrop.switchOn",
      enabled ? "Hide poster backdrop" : "Show poster backdrop",
    );
  }

  /** Applies and persists the decorative contextual poster backdrop preference. @param {boolean} enabled Whether the backdrop is on. */
  window.applyOskarsPosterBackdrop = function (enabled) {
    if (enabled) document.documentElement.dataset.posterBackdrop = "on";
    else delete document.documentElement.dataset.posterBackdrop;
    try {
      localStorage.setItem("oskars-poster-backdrop", enabled ? "on" : "off");
    } catch (err) {}
    if (window.refreshFocusedShellBackdrop)
      window.refreshFocusedShellBackdrop();
    else window.refreshOskarsBackdrop?.();
  };

  if (typeof document !== "undefined" && preferredPosterBackdrop())
    document.documentElement.dataset.posterBackdrop = "on";

  function headerText(key, fallback, values) {
    return window.t ? window.t(key, fallback, values) : fallback;
  }

  // Reuses the existing literal-text translation table (films.js's own
  // "Other"/"Shorts, docs & TV" strings) instead of duplicating them under
  // new nav.*/menu.* keys.
  function literalText(fallback, values) {
    return window.uiText ? window.uiText(fallback, values) : fallback;
  }

  function searchTypeLabel(type) {
    let key = `search.type.${String(type || "")
      .toLowerCase()
      .replace(/\s+/g, "")}`;
    return headerText(key, type || "");
  }

  // The tiered, ordered watchlist view (period.html's Watchlist mode), not
  // films.html's catalog status filter.
  let WATCHLIST_HREF = "period.html?type=alltime&view=watchlist";
  let BUILD_PAGES = ["build.html", "rank-year.html", "awards-year.html"];
  let RANKING_PAGES = [
    "rankings.html",
    "merge.html",
    "watchlist-merge.html",
    "local-rank-merge.html",
    "ranking-review.html",
  ];
  // Browse rail pane each archive page opens on.
  let BROWSE_PANE_BY_PAGE = {
    "films.html": "films",
    "periods.html": "periods",
    "period.html": "periods",
    "categories.html": "categories",
    "category.html": "categories",
    "collections.html": "collections",
    "custom-collections.html": "collections",
    "collection.html": "collections",
    "directors.html": "collections",
    "franchises.html": "collections",
    "franchise.html": "collections",
    "tags.html": "collections",
    "tag.html": "collections",
    "people.html": "people",
  };

  function currentPage() {
    return (
      String(window.location?.pathname || "")
        .split("/")
        .pop() || "index.html"
    );
  }

  function currentSection() {
    let path = currentPage();
    if (path === "period.html") {
      let params = new URLSearchParams(window.location?.search || "");
      return params.get("view") === "watchlist" ? "watchlist" : "browse";
    }
    if (BUILD_PAGES.includes(path)) return "build";
    if (RANKING_PAGES.includes(path)) return "rankings";
    if (BROWSE_PANE_BY_PAGE[path]) return "browse";
    if (path === "projects.html" || path === "project.html") return "projects";
    if (path === "compare.html") return "compare";
    if (path === "community.html") return "community";
    if (path === "data.html") return "data";
    if (path === "index.html" || !path) return "home";
    return "";
  }

  function ownerPagesAllowed() {
    // Owner-only pages (issue #256) are also omitted for an active
    // public-profile session (issue #253) regardless of baked mode,
    // matching entry-loader.js's owner-page gate.
    return (
      (window.runtimeModeCapabilities?.(window.getRuntimeMode?.())
        ?.allowOwnerPages ??
        true) &&
      !window.resolveActiveProfileSlug?.()
    );
  }

  function buildSiteSearchIndex() {
    let labels = {
      tier: headerText("search.meta.tier", "Tier"),
      watched: headerText("search.meta.inArchive", "Watched"),
      watchlist: headerText("search.meta.watchlist", "Watchlist"),
      projectWatched: headerText("search.meta.watched", "watched"),
      projectOpen: headerText("search.meta.open", "Open"),
      projectComplete: headerText("search.meta.complete", "Complete"),
      projectArchived: headerText("search.meta.archived", "Archived"),
    };
    let entries = window.buildSearchEntries({
      locale: window.currentOskarsLocale?.(),
      labels,
      cacheKeySuffix: "site-header",
    });
    return entries;
  }

  function siteSearchMatches(entries, query) {
    return window.searchMatches(entries, query, { limit: 8 });
  }

  function previewLinksHtml(rows, escape) {
    return `<div class="browse-preview-links">${rows.map(([href, label]) => `<a class="browse-preview-link" href="${escape(href)}">${escape(label)}</a>`).join("")}</div>`;
  }

  function filmsPreviewLinksHtml(escape) {
    // Mirrors films.html's own status row, then its non-feature format
    // across every status. Other (neither watched nor watchlisted) reads the
    // viewer's own watched/watchlist data to compute what's missing,
    // meaningless (and hidden the same way period.js's own view-switcher
    // hides it) for a public-profile visitor. Watchlist here is the catalog
    // filter; the primary Watchlist item stays the tiered view.
    let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
    return previewLinksHtml(
      [
        ["films.html", literalText("All")],
        ["films.html?status=watched", headerText("nav.watched", "Watched")],
        [
          "films.html?status=watchlist",
          headerText("nav.watchlist", "Watchlist"),
        ],
        ...(canEdit
          ? [["films.html?status=unseen", literalText("Other")]]
          : []),
        ["films.html?format=non-feature", literalText("Shorts, docs & TV")],
      ],
      escape,
    );
  }

  function collectionsPreviewLinksHtml(escape) {
    return previewLinksHtml(
      [
        ["directors.html", headerText("menu.directors", "Directors")],
        ["franchises.html", headerText("nav.franchises", "Franchises")],
        ["tags.html", headerText("menu.tags", "Tags")],
        ["custom-collections.html", literalText("Custom Collections")],
      ],
      escape,
    );
  }

  function peoplePreviewLinksHtml(escape) {
    return previewLinksHtml(
      [
        ["people.html", headerText("menu.people", "People")],
        ["directors.html", headerText("menu.directors", "Directors")],
      ],
      escape,
    );
  }

  function browseDestinations() {
    return [
      ["films", headerText("menu.films", "Films"), "films.html"],
      ["periods", headerText("menu.periods", "Periods"), "periods.html"],
      [
        "categories",
        headerText("menu.categories", "Categories"),
        "categories.html",
      ],
      [
        "collections",
        headerText("menu.collections", "Collections"),
        "collections.html",
      ],
      ["people", headerText("menu.people", "People"), "people.html"],
    ];
  }

  function browsePaneBodyHtml(pane, escape) {
    if (pane === "periods")
      return window.renderPeriodIndexMatrix({ compact: true });
    if (pane === "categories")
      return window.renderCategoryIndexBoard({ compact: true });
    if (pane === "collections") return collectionsPreviewLinksHtml(escape);
    if (pane === "people") return peoplePreviewLinksHtml(escape);
    return filmsPreviewLinksHtml(escape);
  }

  function browseAllLabel(pane) {
    if (pane === "periods")
      return headerText("menu.browsePeriods", "Browse all periods");
    if (pane === "categories")
      return headerText("menu.browseCategories", "Browse all categories");
    if (pane === "films")
      return headerText("menu.browseFilms", "Browse all films");
    if (pane === "people")
      return headerText("menu.browsePeople", "Browse all people");
    return headerText("menu.browseCollections", "Browse all collections");
  }

  // Each rail link is an ordinary page link; hovering or focusing it swaps
  // the pane beside it (bindPrimaryNavHoverIntent), so every archive
  // preview stays one pointer move from the Browse item.
  function browsePreviewHtml(escape) {
    let openPane = BROWSE_PANE_BY_PAGE[currentPage()] || "periods";
    let destinations = browseDestinations();
    let rail = destinations
      .map(
        ([pane, label, href]) =>
          `<a class="browse-preview-rail-link${pane === openPane ? " is-active" : ""}" href="${escape(href)}" data-browse-pane="${escape(pane)}">${escape(label)}</a>`,
      )
      .join("");
    let panes = destinations
      .map(
        ([pane, label, href]) =>
          `<section class="browse-preview-pane browse-preview-pane--${escape(pane)}" data-browse-pane-content="${escape(pane)}" aria-label="${escape(label)}"${pane === openPane ? "" : " hidden"}><div class="primary-nav-preview-heading"><strong>${escape(label)}</strong><a href="${escape(href)}">${escape(browseAllLabel(pane))} →</a></div>${browsePaneBodyHtml(pane, escape)}</section>`,
      )
      .join("");
    return `<div class="primary-nav-preview primary-nav-preview--browse" aria-label="${escape(headerText("nav.browse", "Browse"))}"><div class="primary-nav-preview-panel browse-preview"><nav class="browse-preview-rail" aria-label="${escape(headerText("nav.browse", "Browse"))}">${rail}</nav>${panes}</div></div>`;
  }

  function primaryNavHtml(active, escape) {
    // Kept short and fixed so the header never wraps or resizes between pages.
    // The archive's own indexes live in Browse's flyout; everything else
    // (Discover, Compare, Data, ...) lives in the site-menu dropdown.
    let ownerItems = ownerPagesAllowed();
    let primaryItems = [
      ["home", headerText("nav.home", "Home"), "index.html"],
      ...(ownerItems
        ? [
            [
              "build",
              headerText("nav.buildOskars", "Build Oskars"),
              "build.html",
            ],
          ]
        : []),
      ["watchlist", headerText("nav.watchlist", "Watchlist"), WATCHLIST_HREF],
      ...(ownerItems
        ? [
            [
              "rankings",
              headerText("nav.rankings", "Rankings"),
              "rankings.html",
            ],
          ]
        : []),
      ["projects", headerText("nav.projects", "Projects"), "projects.html"],
      ["browse", headerText("nav.browse", "Browse"), "films.html"],
    ];
    return primaryItems
      .map(([section, label, href]) => {
        let current = active === section;
        let link = `<a class="primary-nav-link${current ? " is-active" : ""}" href="${escape(href)}"${current ? ' aria-current="page"' : ""}>${escape(label)}</a>`;
        return section === "browse"
          ? `<span class="primary-nav-item primary-nav-item--browse">${link}${browsePreviewHtml(escape)}</span>`
          : link;
      })
      .join("");
  }

  function dynamicMenuHtml(escape) {
    // Owner-only sections (issue #256): entry-loader.js already removes these
    // from the initial static header before this dynamic render replaces
    // the whole panel, so this render must independently omit them too, or
    // it would silently put them right back for a viewer-mode session.
    // Browse repeats the flyout's destinations for viewports where the
    // flyout stays hidden.
    let section = (heading, links, ownerOnly) =>
      `<section${ownerOnly ? " data-site-menu-owner" : ""}><h2>${escape(heading)}</h2><div class="site-menu-links">${links
        .map(
          ([label, href]) => `<a href="${escape(href)}">${escape(label)}</a>`,
        )
        .join("")}</div></section>`;
    let sections = [
      section(
        headerText("nav.browse", "Browse"),
        browseDestinations().map(([, label, href]) => [label, href]),
      ),
      section(headerText("menu.archiveProjections", "Archive projections"), [
        [headerText("menu.community", "Community"), "community.html"],
        [headerText("menu.discover", "Discover"), "discover.html"],
        [headerText("nav.compare", "Compare"), "compare.html"],
        [headerText("menu.showcase", "Showcase"), "presentation.html"],
        [headerText("menu.completion", "Completion"), "completion.html"],
        [headerText("menu.statistics", "Statistics"), "stats.html"],
      ]),
    ];
    if (ownerPagesAllowed()) {
      sections.push(
        section(
          headerText("menu.editors", "Editors"),
          [
            [headerText("nav.intake", "Intake"), "intake.html"],
            [
              headerText("nav.rateWatched", "Rate watched"),
              "rate-watched.html",
            ],
            [
              headerText("nav.tierWatchlist", "Set watchlist tier"),
              "tier-watchlist.html",
            ],
          ],
          true,
        ),
        section(
          headerText("menu.admin", "Admin"),
          [
            [headerText("nav.data", "Data"), "data.html"],
            [headerText("nav.profile", "Profile"), "profile.html"],
          ],
          true,
        ),
      );
    }
    return sections.join("");
  }

  function updateLanguageToggle(button) {
    if (!button) return;
    button.textContent = headerText("language.next", "SV");
    button.title = headerText("language.switchTo", "Switch to Swedish");
    button.setAttribute("aria-label", button.title);
  }

  // CSS alone (:hover) drops the Browse preview the instant the
  // pointer leaves the link's own small box, which happens well before a
  // diagonal path toward the (much wider) panel below arrives - closing the
  // preview out from under the pointer. This grace period keeps it open
  // briefly after the pointer truly leaves, the standard fix for hover
  // flyouts. Delegated on the never-replaced .app-header (nav.innerHTML is
  // rebuilt on every render, so per-item listeners would be lost).
  let previewCloseTimers = new WeakMap();
  function openPreviewItem(item) {
    let pending = previewCloseTimers.get(item);
    if (pending) {
      clearTimeout(pending);
      previewCloseTimers.delete(item);
    }
    item.classList.add("is-preview-open");
  }
  function schedulePreviewClose(item) {
    let pending = previewCloseTimers.get(item);
    if (pending) clearTimeout(pending);
    previewCloseTimers.set(
      item,
      setTimeout(() => {
        previewCloseTimers.delete(item);
        item.classList.remove("is-preview-open");
      }, 300),
    );
  }
  function showBrowsePane(railLink) {
    let panel = railLink.closest(".browse-preview");
    if (!panel || railLink.classList.contains("is-active")) return;
    let pane = railLink.dataset.browsePane;
    panel
      .querySelectorAll("[data-browse-pane]")
      .forEach((link) => link.classList.toggle("is-active", link === railLink));
    panel.querySelectorAll("[data-browse-pane-content]").forEach((section) => {
      section.hidden = section.dataset.browsePaneContent !== pane;
    });
  }
  function bindPrimaryNavHoverIntent(header) {
    header.addEventListener("focusin", (event) => {
      let item = event.target.closest(".primary-nav-item");
      if (item && header.contains(item)) openPreviewItem(item);
      let railLink = event.target.closest("[data-browse-pane]");
      if (railLink) showBrowsePane(railLink);
    });
    header.addEventListener("focusout", (event) => {
      let item = event.target.closest(".primary-nav-item");
      if (item && !item.contains(event.relatedTarget))
        schedulePreviewClose(item);
    });
    header.addEventListener("click", (event) => {
      if (event.target.closest("[data-focused-backdrop-retry]"))
        window.refreshFocusedShellBackdrop?.();
    });
    header.addEventListener("mouseover", (event) => {
      let item = event.target.closest(".primary-nav-item");
      if (!item || !header.contains(item)) return;
      openPreviewItem(item);
      let railLink = event.target.closest("[data-browse-pane]");
      if (railLink) showBrowsePane(railLink);
    });
    header.addEventListener("mouseout", (event) => {
      let item = event.target.closest(".primary-nav-item");
      if (!item || !header.contains(item)) return;
      if (item.contains(event.relatedTarget)) return;
      schedulePreviewClose(item);
    });
  }

  function bindSiteHeader(header, escape) {
    if (header.dataset.siteHeaderBound) return;
    header.dataset.siteHeaderBound = "true";
    bindPrimaryNavHoverIntent(header);
    header
      .querySelector("[data-theme-toggle]")
      ?.addEventListener("click", (event) => {
        let next = nextOskarsTheme(document.documentElement.dataset.theme);
        window.applyOskarsTheme(next);
        event.currentTarget.textContent = THEME_ICON[next] || "☾";
        event.currentTarget.title = themeToggleTitle(nextOskarsTheme(next));
      });
    header
      .querySelector("[data-poster-grid-toggle]")
      ?.addEventListener("click", (event) => {
        let next = !(document.documentElement.dataset.posterGrid === "on");
        window.applyOskarsPosterGrid(next);
        event.currentTarget.setAttribute(
          "aria-pressed",
          next ? "true" : "false",
        );
        event.currentTarget.title = posterGridToggleTitle(next);
        event.currentTarget.setAttribute(
          "aria-label",
          posterGridToggleTitle(next),
        );
      });
    header
      .querySelector("[data-poster-backdrop-toggle]")
      ?.addEventListener("click", (event) => {
        let next = !(document.documentElement.dataset.posterBackdrop === "on");
        window.applyOskarsPosterBackdrop(next);
        event.currentTarget.setAttribute(
          "aria-pressed",
          next ? "true" : "false",
        );
        event.currentTarget.title = posterBackdropToggleTitle(next);
        event.currentTarget.setAttribute(
          "aria-label",
          posterBackdropToggleTitle(next),
        );
      });
    header
      .querySelector("[data-language-toggle]")
      ?.addEventListener("click", () => {
        window.toggleOskarsLocale?.();
        header.dataset.siteHeaderReady = "";
        header.dataset.siteHeaderBound = "";
        window.renderSiteHeader?.();
      });
    header
      .querySelector("[data-auth-status]")
      ?.addEventListener("click", async (event) => {
        let signOut = event.target.closest("[data-supabase-sign-out]");
        if (!signOut) return;
        signOut.disabled = true;
        try {
          await window.signOutOfSupabase?.();
          window.location.reload();
        } catch (error) {
          signOut.disabled = false;
          signOut.title = String(error?.message || error);
        }
      });
    window.onSupabaseAuthChange?.(() => refreshHeaderAuthStatus(header));
    let searchForm = header.querySelector("[data-site-search]");
    let searchInput = header.querySelector("[data-site-search-input]");
    let searchResults = header.querySelector("[data-site-search-results]");
    // Keyboard navigation (issue #66): Up/Down move an active result (tracked
    // via aria-activedescendant so focus stays in the input), Enter opens the
    // active result (or the first match), Escape and blur behave as before.
    let searchStatus = header.querySelector("[data-site-search-status]");
    let searchRequest = 0;
    let searchMatchList = [];
    let activeResultIndex = -1;
    function setActiveResult(nextIndex) {
      activeResultIndex = nextIndex;
      let options = searchResults
        ? [...searchResults.querySelectorAll(".site-search-result")]
        : [];
      options.forEach((option, index) => {
        option.classList.toggle("is-active", index === activeResultIndex);
        option.setAttribute(
          "aria-selected",
          index === activeResultIndex ? "true" : "false",
        );
      });
      let active = options[activeResultIndex];
      if (active) {
        searchInput.setAttribute("aria-activedescendant", active.id);
        active.scrollIntoView?.({ block: "nearest" });
      } else {
        searchInput.removeAttribute("aria-activedescendant");
      }
    }
    function getSearchEntries() {
      return buildSiteSearchIndex();
    }
    function renderSearchResults() {
      let finishQueryTimer =
        window.startOskarsPerformance?.("siteSearch:query");
      searchMatchList = siteSearchMatches(
        getSearchEntries(),
        searchInput.value,
      );
      searchResults.hidden = !searchMatchList.length;
      searchInput.setAttribute(
        "aria-expanded",
        searchMatchList.length ? "true" : "false",
      );
      searchResults.innerHTML = searchMatchList
        .map(
          (entry, index) =>
            `<div class="site-search-result" role="option" id="site-search-option-${index}" aria-selected="false"><a class="site-search-primary" href="${escape(entry.href)}" tabindex="-1"><strong>${escape(entry.name)}</strong><span>${escape(searchTypeLabel(entry.type))}${entry.meta ? ` · ${escape(entry.meta)}` : ""}</span></a></div>`,
        )
        .join("");
      setActiveResult(-1);
      finishQueryTimer?.(`${searchMatchList.length} result(s)`);
    }
    function clearResults() {
      searchMatchList = [];
      searchResults.hidden = true;
      searchResults.innerHTML = "";
      searchInput.setAttribute("aria-expanded", "false");
      setActiveResult(-1);
    }
    function showSearchStatus(message, retry = false) {
      if (!searchStatus) return;
      searchStatus.hidden = !message;
      searchStatus.innerHTML = message
        ? `<span>${escape(message)}</span>${retry ? ` <button type="button" data-site-search-retry>${escape(headerText("shell.retry", "Try again"))}</button>` : ""}`
        : "";
    }
    async function requestSearch(submit = false) {
      if (!window.ensureFocusedShellData) {
        renderSearchResults();
        return;
      }
      let request = ++searchRequest;
      let query = searchInput.value;
      let selectedHref = searchMatchList[activeResultIndex]?.href;
      if (!query.trim()) {
        clearResults();
        showSearchStatus("");
        searchInput.removeAttribute("aria-busy");
        return;
      }
      if (!window.focusedShellDataFresh()) {
        clearResults();
        showSearchStatus(headerText("search.loading", "Loading search…"));
      }
      searchInput.setAttribute("aria-busy", "true");
      let finish = window.startOskarsPerformance?.("siteSearch:ready");
      try {
        await window.ensureFocusedShellData();
        if (
          request !== searchRequest ||
          query !== searchInput.value ||
          searchInput.isConnected === false
        )
          return;
        showSearchStatus("");
        renderSearchResults();
        if (submit) {
          let match =
            searchMatchList.find((entry) => entry.href === selectedHref) ||
            searchMatchList[0];
          if (match) window.location.href = match.href;
        }
      } catch (_) {
        if (request !== searchRequest || searchInput.isConnected === false)
          return;
        clearResults();
        showSearchStatus(
          headerText("search.error", "Could not load search."),
          true,
        );
      } finally {
        if (request === searchRequest) searchInput.removeAttribute("aria-busy");
        finish?.();
      }
    }
    searchInput?.addEventListener("input", () => requestSearch());
    searchInput?.addEventListener("focus", () => requestSearch());
    searchStatus?.addEventListener("click", (event) => {
      if (event.target.closest("[data-site-search-retry]")) {
        if (document.activeElement === searchInput) requestSearch();
        else searchInput.focus();
      }
    });
    if (window.ensureFocusedShellData) {
      if (header._shellInvalidated)
        window.removeEventListener(
          "oskars:focused-shell-invalidated",
          header._shellInvalidated,
        );
      header._shellInvalidated = () => {
        searchRequest += 1;
        clearResults();
        showSearchStatus("");
        searchInput.removeAttribute("aria-busy");
        window.renderSiteHeader?.();
      };
      window.addEventListener(
        "oskars:focused-shell-invalidated",
        header._shellInvalidated,
      );
    }
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        searchRequest += 1;
        showSearchStatus("");
        searchInput.removeAttribute("aria-busy");
        searchInput.value = "";
        searchResults.hidden = true;
        searchInput.setAttribute("aria-expanded", "false");
        searchMatchList = [];
        setActiveResult(-1);
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!searchMatchList.length || searchResults.hidden) return;
      event.preventDefault();
      let delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveResult(
        (activeResultIndex + delta + searchMatchList.length) %
          searchMatchList.length,
      );
    });
    searchForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (window.ensureFocusedShellData) {
        requestSearch(true);
        return;
      }
      let match = searchMatchList.length
        ? searchMatchList[activeResultIndex >= 0 ? activeResultIndex : 0]
        : siteSearchMatches(getSearchEntries(), searchInput.value)[0];
      if (match) window.location.href = match.href;
    });
    searchForm?.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!searchForm.contains(document.activeElement) && searchResults) {
          searchRequest += 1;
          searchResults.hidden = true;
          showSearchStatus("");
          searchInput.removeAttribute("aria-busy");
        }
      }, 120);
    });
  }

  async function refreshHeaderAuthStatus(header) {
    let status = header.querySelector("[data-auth-status]");
    if (!status) return;
    if (window.renderPublicProfileExit?.(status)) return;
    let auth = await window.resolveSupabaseAuthState?.();
    if (auth?.status !== "signed-in" || !auth.user?.id) {
      status.innerHTML = `<div class="auth-status-sign-in" data-supabase-sign-in></div>`;
      window.renderGoogleSignInButtonForSupabase?.(
        status.querySelector("[data-supabase-sign-in]"),
      );
      return;
    }
    let profile = await window.loadSupabaseProfile?.().catch(() => null);
    let displayName =
      profile?.display_name ||
      auth.user.user_metadata?.full_name ||
      auth.user.user_metadata?.name ||
      auth.user.email ||
      "Profile";
    window.renderSignedInHeaderAccount(status, auth.user, displayName);
  }

  /** Renders the compact signed-in account control inside a header status container.
   * @param {Element} container Header account-status container.
   * @param {Object} user Signed-in Supabase user.
   * @param {string} displayName Account name shown beside the avatar.
   */
  window.renderSignedInHeaderAccount = function (container, user, displayName) {
    if (!container) return;
    let escape = window.pageEscape || defaultHeaderEscape;
    let name = String(displayName || user?.email || "Profile").trim();
    let initial = Array.from(name)[0]?.toLocaleUpperCase() || "?";
    let candidateAvatar =
      user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "";
    let avatar = /^https:\/\//i.test(candidateAvatar)
      ? `<img src="${escape(candidateAvatar)}" alt="" referrerpolicy="no-referrer">`
      : `<span aria-hidden="true">${escape(initial)}</span>`;
    container.innerHTML = `<div class="auth-status-account"><a class="auth-status-profile" href="profile.html" title="${escape(name)}"><span class="auth-status-avatar">${avatar}</span><span class="auth-status-name">${escape(name)}</span></a><button class="auth-status-sign-out" type="button" data-supabase-sign-out aria-label="Sign out" title="Sign out"><svg aria-hidden="true" viewBox="0 0 20 20"><path d="M8 4H4.8A1.8 1.8 0 0 0 3 5.8v8.4A1.8 1.8 0 0 0 4.8 16H8M12.5 6.5 16 10l-3.5 3.5M7 10h9"/></svg></button></div>`;
  };

  /**
   * Renders the signed-in user status into any page's [data-auth-status] container
   * and wires up the sign-out action with page reload.
   * @param {Object} user Signed-in Supabase user.
   * @param {string} [displayName] Optional display name override.
   */
  window.renderHeaderAuthStatus = function (user, displayName) {
    let statusContainer = document.querySelector("[data-auth-status]");
    if (!statusContainer || !user) return;
    let name =
      displayName ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email ||
      "Signed in";
    window.renderSignedInHeaderAccount(statusContainer, user, name);
    statusContainer
      .querySelector("[data-supabase-sign-out]")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
      });
  };

  /** Renders or refreshes the shared site header and binds its controls. */
  window.renderSiteHeader = function () {
    let done = window.startOskarsPerformance?.("siteHeader:render");
    let header = document.querySelector(".app-header");
    if (!header) {
      done?.("no header");
      return;
    }
    let escape = window.pageEscape || ((value) => String(value ?? ""));
    let active = currentSection();
    let primary = primaryNavHtml(active, escape);
    header.removeAttribute("data-site-header-pending");
    if (
      !header.dataset.siteHeaderReady ||
      header.dataset.siteHeaderReady === "shell"
    ) {
      header.dataset.siteHeaderReady = "true";
      header.innerHTML = `<a class="app-brand" href="index.html">The Oskars</a>
    <div class="app-header-actions">
      <nav class="app-primary-nav" aria-label="Primary">${primary}</nav>
      <form class="site-search" role="search" data-site-search>
        <input type="search" autocomplete="off" placeholder="${escape(headerText("search.placeholder", "Search"))}" aria-label="${escape(headerText("search.aria", "Search The Oskars"))}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="siteSearchResults" data-site-search-input>
        <div class="site-search-results" id="siteSearchResults" role="listbox" aria-label="${escape(headerText("search.aria", "Search The Oskars"))}" data-site-search-results hidden></div>
        <div class="site-search-results" role="status" data-site-search-status hidden></div>
      </form>
      <button class="language-toggle" type="button" data-language-toggle></button>
      <button class="theme-toggle" type="button" data-theme-toggle title="${escape(themeToggleTitle(nextOskarsTheme(preferredTheme())))}" aria-label="${escape(headerText("theme.switch", "Switch color theme"))}">${THEME_ICON[preferredTheme()] || "☾"}</button>
      <button class="poster-grid-toggle" type="button" data-poster-grid-toggle aria-pressed="${preferredPosterGrid() ? "true" : "false"}" title="${escape(posterGridToggleTitle(preferredPosterGrid()))}" aria-label="${escape(posterGridToggleTitle(preferredPosterGrid()))}">🖼️</button>
      <button class="poster-backdrop-toggle" type="button" data-poster-backdrop-toggle aria-pressed="${preferredPosterBackdrop() ? "true" : "false"}" title="${escape(posterBackdropToggleTitle(preferredPosterBackdrop()))}" aria-label="${escape(posterBackdropToggleTitle(preferredPosterBackdrop()))}">🎞️</button>
      <div class="auth-status" data-auth-status aria-live="polite"></div>
      <details class="site-menu">
        <summary aria-label="${escape(headerText("menu.openDirectory", "Open site directory"))}" title="${escape(headerText("menu.openDirectory", "Site directory"))}"><span></span><span></span><span></span></summary>
        <div class="site-menu-panel">
          ${dynamicMenuHtml(escape)}
        </div>
      </details>
    </div>
      ${window.ensureFocusedShellData ? `<span role="status" data-focused-backdrop-status hidden>${escape(headerText("shell.error", "Could not load the archive."))} <button type="button" data-focused-backdrop-retry>${escape(headerText("shell.retry", "Try again"))}</button></span>` : ""}`;
    } else {
      let nav = header.querySelector(".app-primary-nav");
      if (nav) nav.innerHTML = primary;
      let panel = header.querySelector(".site-menu-panel");
      if (panel) panel.innerHTML = dynamicMenuHtml(escape);
      let input = header.querySelector("[data-site-search-input]");
      if (input) {
        input.placeholder = headerText("search.placeholder", "Search");
        input.setAttribute(
          "aria-label",
          headerText("search.aria", "Search The Oskars"),
        );
      }
    }
    bindSiteHeader(header, escape);
    refreshHeaderAuthStatus(header);
    updateLanguageToggle(header.querySelector("[data-language-toggle]"));
    done?.();
  };
})();
