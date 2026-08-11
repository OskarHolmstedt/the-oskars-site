/** @file Renders and binds the shared site header, navigation, search, locale, menu, and theme controls. */

(function () {
  let siteSearchCache = { key: "", entries: [] };

  // Light/dark/papyrus cycle (issue #152); papyrus is only ever reached by
  // explicit toggle, never inferred from prefers-color-scheme. The icon
  // shown for a theme represents the *next* theme the toggle switches to.
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

  function headerText(key, fallback, values) {
    return window.t ? window.t(key, fallback, values) : fallback;
  }

  function searchTypeLabel(type) {
    let key = `search.type.${String(type || "")
      .toLowerCase()
      .replace(/\s+/g, "")}`;
    return headerText(key, type || "");
  }

  function currentSection() {
    let path =
      String(window.location?.pathname || "")
        .split("/")
        .pop() || "index.html";
    if (path === "period.html") {
      let params = new URLSearchParams(window.location?.search || "");
      if (params.get("view") === "watchlist") return "watchlist";
      if (params.get("type") === "alltime" && params.get("view") === "films")
        return "watched";
      return "periods";
    }
    if (path === "periods.html") return "periods";
    if (path === "categories.html" || path === "category.html")
      return "categories";
    if (path === "franchises.html" || path === "franchise.html")
      return "franchises";
    if (path === "watchlist-film.html") return "watchlist";
    if (path === "projects.html" || path === "project.html") return "projects";
    if (path === "compare.html") return "compare";
    if (path === "data.html") return "data";
    if (path === "editor.html") return "editor";
    if (path === "index.html" || !path) return "home";
    return "";
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
    siteSearchCache = { key: "", entries };
    return entries;
  }

  function siteSearchMatches(entries, query) {
    return window.searchMatches(entries, query, { limit: 8 });
  }

  function primaryNavHtml(active) {
    // Kept short and fixed so the header never wraps or resizes between pages.
    // Everything else (Discover, Compare, People, Tags, Editor, Data) lives in
    // the site-menu dropdown instead.
    let primaryItems = [
      ["home", headerText("nav.home", "Home"), "index.html"],
      ["periods", headerText("nav.periods", "Periods"), "periods.html"],
      [
        "categories",
        headerText("nav.categories", "Categories"),
        "categories.html",
      ],
      [
        "franchises",
        headerText("nav.franchises", "Franchises"),
        "franchises.html",
      ],
      [
        "watchlist",
        headerText("nav.watchlist", "Watchlist"),
        "period.html?type=alltime&view=watchlist",
      ],
      [
        "watched",
        headerText("nav.watched", "Watched"),
        "period.html?type=alltime&view=films",
      ],
      ["projects", headerText("nav.projects", "Projects"), "projects.html"],
    ];
    return primaryItems
      .map(([section, label, href]) =>
        active === section
          ? `<strong>${label}</strong>`
          : `<a href="${href}">${label}</a>`,
      )
      .join("");
  }

  function dynamicMenuHtml(escape) {
    let categories = window
      .getOrderedCategories()
      .map(
        (category) =>
          `<a href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a>`,
      )
      .join("");
    let centuries = Object.keys(window.state?.periods?.centuries || {})
      .filter((key) => key !== "unknown")
      .sort(
        (left, right) =>
          Number(left.replace(/\D/g, "")) - Number(right.replace(/\D/g, "")),
      );
    let decades = Object.keys(window.state?.periods?.decades || {})
      .filter((key) => key !== "unknown")
      .sort(
        (left, right) =>
          Number(left.replace(/\D/g, "")) - Number(right.replace(/\D/g, "")),
      );
    let periodLinks = [
      `<a href="${escape(window.periodPageUrl("alltime", "alltime"))}">${escape(headerText("period.allTime", "All-time"))}</a>`,
      ...centuries.map(
        (key) =>
          `<a href="${escape(window.periodPageUrl("century", key))}">${escape(key)}</a>`,
      ),
      ...decades.map(
        (key) =>
          `<a href="${escape(window.periodPageUrl("decade", key))}">${escape(key)}</a>`,
      ),
    ].join("");
    return `<section class="site-menu-categories"><h2>${escape(headerText("menu.categories", "Categories"))}</h2><div class="site-menu-links"><a href="categories.html"><b>${escape(headerText("menu.browseCategories", "Browse all categories"))}</b></a>${categories}</div></section>
    <section><h2>${escape(headerText("menu.periods", "Periods"))}</h2><div class="site-menu-links site-menu-periods"><a href="periods.html"><b>${escape(headerText("menu.browsePeriods", "Browse all periods"))}</b></a>${periodLinks}</div></section>
    <section><h2>${escape(headerText("menu.elsewhere", "Elsewhere"))}</h2><div class="site-menu-links"><a href="discover.html">${escape(headerText("menu.discover", "Discover"))}</a><a href="compare.html">${escape(headerText("nav.compare", "Compare"))}</a><a href="presentation.html">${escape(headerText("menu.showcase", "Showcase"))}</a><a href="completion.html">${escape(headerText("menu.completion", "Completion"))}</a><a href="stats.html">${escape(headerText("menu.statistics", "Statistics"))}</a><a href="people.html">${escape(headerText("menu.people", "People"))}</a><a href="tags.html">${escape(headerText("menu.tags", "Tags"))}</a><a href="intake.html">${escape(headerText("nav.intake", "Intake"))}</a><a href="editor.html">${escape(headerText("nav.editor", "Editor"))}</a><a href="data.html">${escape(headerText("nav.data", "Data"))}</a></div></section>`;
  }

  function updateLanguageToggle(button) {
    if (!button) return;
    button.textContent = headerText("language.next", "SV");
    button.title = headerText("language.switchTo", "Switch to Swedish");
    button.setAttribute("aria-label", button.title);
  }

  function bindSiteHeader(header, escape) {
    if (header.dataset.siteHeaderBound) return;
    header.dataset.siteHeaderBound = "true";
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
      .querySelector("[data-language-toggle]")
      ?.addEventListener("click", () => {
        window.toggleOskarsLocale?.();
        header.dataset.siteHeaderReady = "";
        header.dataset.siteHeaderBound = "";
        window.renderSiteHeader?.();
      });
    let searchForm = header.querySelector("[data-site-search]");
    let searchInput = header.querySelector("[data-site-search-input]");
    let searchResults = header.querySelector("[data-site-search-results]");
    // Keyboard navigation (issue #66): Up/Down move an active result (tracked
    // via aria-activedescendant so focus stays in the input), Enter opens the
    // active result (or the first match), Escape and blur behave as before.
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
      if (!header._siteSearchEntries)
        header._siteSearchEntries = buildSiteSearchIndex();
      return header._siteSearchEntries;
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
    searchInput?.addEventListener("input", renderSearchResults);
    searchInput?.addEventListener("focus", renderSearchResults);
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
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
      let match = searchMatchList.length
        ? searchMatchList[activeResultIndex >= 0 ? activeResultIndex : 0]
        : siteSearchMatches(getSearchEntries(), searchInput.value)[0];
      if (match) window.location.href = match.href;
    });
    searchForm?.addEventListener("focusout", () => {
      setTimeout(() => {
        if (!searchForm.contains(document.activeElement) && searchResults)
          searchResults.hidden = true;
      }, 120);
    });
  }

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
    let primary = primaryNavHtml(active);
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
      </form>
      <button class="language-toggle" type="button" data-language-toggle></button>
      <button class="theme-toggle" type="button" data-theme-toggle title="${escape(themeToggleTitle(nextOskarsTheme(preferredTheme())))}" aria-label="${escape(headerText("theme.switch", "Switch color theme"))}">${THEME_ICON[preferredTheme()] || "☾"}</button>
      <button class="poster-grid-toggle" type="button" data-poster-grid-toggle aria-pressed="${preferredPosterGrid() ? "true" : "false"}" title="${escape(posterGridToggleTitle(preferredPosterGrid()))}" aria-label="${escape(posterGridToggleTitle(preferredPosterGrid()))}">🖼️</button>
      <details class="site-menu">
        <summary aria-label="${escape(headerText("menu.openDirectory", "Open site directory"))}" title="${escape(headerText("menu.openDirectory", "Site directory"))}"><span></span><span></span><span></span></summary>
        <div class="site-menu-panel">
          ${dynamicMenuHtml(escape)}
        </div>
      </details>
    </div>`;
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
    updateLanguageToggle(header.querySelector("[data-language-toggle]"));
    header._siteSearchEntries = null;
    done?.();
  };
})();
