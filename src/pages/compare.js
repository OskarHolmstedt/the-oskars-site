/**
 * @file Compare page controller: typed target selection (films, people,
 * franchises, tags, projects, periods, categories, and credit subjects), the film-only comparison view, and
 * the mixed-target panel view. Target resolution and per-target data
 * derivation live in src/domain/compare-targets.js; this file owns search,
 * URL/recent-comparison state, and panel rendering.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("comparePage");
  let currentSearch = "";
  let RECENT_COMPARISONS_KEY = "oskars.recentComparisons";
  let MAX_COMPARE_TARGETS = 4;
  let selectedTargets = initialTargets();
  let TARGET_TYPE_LABELS = {
    film: "Film",
    person: "Person",
    franchise: "Franchise",
    tag: "Tag",
    project: "Project",
    period: "Period",
    category: "Category",
    song: "Song",
    role: "Role",
  };
  // Exposed for src/pages/compare/panels.js's targetTypeLabel, which runs
  // outside this closure.
  window.TARGET_TYPE_LABELS = TARGET_TYPE_LABELS;

  // --- Target selection -----------------------------------------------------

  function topDefaultFilmIds() {
    return Object.values(state.filmsById || {})
      .filter((film) => film.awards?.length || film.allTimeRank || film.rating)
      .sort(
        (left, right) =>
          Number(left.allTimeRank || 999999) -
            Number(right.allTimeRank || 999999) ||
          window.calculateAwardsScore(right.awards || [], "years") -
            window.calculateAwardsScore(left.awards || [], "years") ||
          window.compareEnglishTitles(left.title, right.title),
      )
      .slice(0, 2)
      .map((film) => film.id);
  }

  function filmTarget(id) {
    return { type: "film", id };
  }

  function normalizeTargets(targets) {
    return window.normalizeCompareTargets(targets, MAX_COMPARE_TARGETS);
  }

  function initialTargets() {
    let typed = String(window.pageQueryParam("targets") || "")
      .split(",")
      .map(window.decodeCompareTarget)
      .filter(Boolean);
    if (typed.length) return normalizeTargets(typed);
    let ids = String(window.pageQueryParam("films") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!ids.length) {
      let legacy = window.pageQueryParam("ids");
      ids = String(legacy || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
    return normalizeTargets([...new Set(ids)].map(filmTarget));
  }

  function ensureTargets() {
    selectedTargets = normalizeTargets(selectedTargets);
    if (!selectedTargets.length)
      selectedTargets = normalizeTargets(topDefaultFilmIds().map(filmTarget));
    return selectedTargets;
  }

  function selectedFilmRecords(targets) {
    return targets
      .filter((target) => target.type === "film")
      .map((target) => target.record)
      .filter(Boolean);
  }

  function updateUrl() {
    if (!window.history?.replaceState) return;
    window.history.replaceState(null, "", currentCompareUrl());
  }

  function currentCompareUrl(targets = selectedTargets) {
    let filmIds = targets
      .filter((target) => target.type === "film")
      .map((target) => target.id);
    let allFilmTargets = targets.length && filmIds.length === targets.length;
    return allFilmTargets
      ? window.comparePageUrl(filmIds)
      : window.compareTargetsPageUrl(targets);
  }
  // Exposed for src/pages/compare/panels.js's renderActionPanel, which runs
  // outside this closure.
  window.currentCompareUrl = currentCompareUrl;

  // --- Recent comparisons ---------------------------------------------------

  function comparisonKey(ids) {
    return [...new Set(ids)].filter(Boolean).join(",");
  }

  function readRecentComparisons() {
    try {
      let parsed = JSON.parse(
        window.localStorage?.getItem(RECENT_COMPARISONS_KEY) || "[]",
      );
      return Array.isArray(parsed)
        ? parsed.filter(
            (item) => Array.isArray(item.ids) && item.ids.length >= 2,
          )
        : [];
    } catch {
      return [];
    }
  }

  function writeRecentComparisons(comparisons) {
    try {
      window.localStorage?.setItem(
        RECENT_COMPARISONS_KEY,
        JSON.stringify(comparisons.slice(0, 8)),
      );
    } catch {}
  }

  function rememberComparison(films) {
    if (films.length < 2) return;
    let ids = films.map((film) => film.id).filter(Boolean);
    let key = comparisonKey(ids);
    if (!key) return;
    let recent = readRecentComparisons().filter(
      (item) => comparisonKey(item.ids) !== key,
    );
    recent.unshift({
      ids,
      titles: films.map(
        (film) => window.localizedFilmTitle?.(film) || film.title,
      ),
      updatedAt: new Date().toISOString(),
    });
    writeRecentComparisons(recent);
  }

  function renderRecentComparisons(films) {
    let currentKey = comparisonKey(films.map((film) => film.id));
    let recent = readRecentComparisons()
      .filter((item) => comparisonKey(item.ids) !== currentKey)
      .filter((item) => item.ids.every((id) => window.findFilmById(id)))
      .slice(0, 4);
    if (!recent.length) return "";
    return `<section class="compare-recent"><h2>${escape(ui("Recent comparisons"))}</h2><div>${recent
      .map((item) => {
        let label = item.ids
          .map(
            (id) =>
              window.localizedFilmTitle?.(window.findFilmById(id)) ||
              window.findFilmById(id)?.title,
          )
          .filter(Boolean)
          .join(" / ");
        return `<a href="${escape(window.comparePageUrl(item.ids))}">${escape(label)}</a>`;
      })
      .join("")}</div></section>`;
  }

  // --- Target search --------------------------------------------------------

  function compareSearchCandidates() {
    let labels = {
      films: ui("films"),
      allTime: ui("All-time"),
      projectWatched: ui("watched"),
      projectOpen: ui("Open"),
      projectComplete: ui("Complete"),
      projectArchived: ui("Archived"),
    };
    return window
      .buildSearchEntries({
        locale: window.currentOskarsLocale?.(),
        labels,
        cacheKeySuffix: "compare",
      })
      .filter((entry) => TARGET_TYPE_LABELS[entry.target?.type])
      .map((entry) => {
        let type = entry.target.type;
        let film = type === "film" ? state.filmsById?.[entry.target.id] : null;
        let person =
          type === "person"
            ? (window.ensurePeopleIndex?.() || state.peopleById || {})[
                entry.target.id
              ]
            : null;
        let tag = type === "tag" ? window.tagRecord?.(entry.target.id) : null;
        let subtitle =
          type === "film"
            ? [
                film?.year,
                window.compactNameList?.(film?.director)?.displayText ||
                  film?.director,
              ]
                .filter(Boolean)
                .join(" · ")
            : type === "person"
              ? (person?.professions || [])
                  .map((profession) => ui(profession))
                  .join(", ")
              : type === "tag"
                ? `${(tag?.films || []).length + (tag?.watchlist || []).length} ${ui("films")}`
                : type === "period"
                  ? ui(entry.type)
                  : ui(TARGET_TYPE_LABELS[type]);
        return {
          target: entry.target,
          type: entry.type,
          label:
            type === "film"
              ? window.localizedFilmTitle?.(film) || entry.name
              : entry.name,
          name:
            type === "film"
              ? window.localizedFilmTitle?.(film) || entry.name
              : entry.name,
          subtitle,
          meta: subtitle,
          searchText: [entry.searchText, entry.type, type]
            .filter(Boolean)
            .join(" "),
          aliasNames: entry.aliasNames || [],
          typeLabel: ui(TARGET_TYPE_LABELS[type]),
          href: entry.href,
          film,
        };
      });
  }

  function compareSearchMatches(query, targets) {
    let selected = new Set(
      targets.map(
        (target) =>
          window.compareTargetKey?.(target) || `${target.type}:${target.id}`,
      ),
    );
    let candidates = compareSearchCandidates().filter(
      (candidate) =>
        !selected.has(
          window.compareTargetKey?.(candidate.target) ||
            `${candidate.target.type}:${candidate.target.id}`,
        ),
    );
    return window.searchMatches(candidates, query, {
      limit: 10,
      tieBreaker: (left, right) =>
        Number(left.film?.allTimeRank || 999999) -
          Number(right.film?.allTimeRank || 999999) ||
        window.compareEnglishTitles(left.label, right.label) ||
        window.compareEnglishTitles(left.typeLabel, right.typeLabel),
    });
  }

  function addCompareTarget(target) {
    let next = normalizeTargets([...selectedTargets, target]);
    if (
      !target?.id ||
      next.length === selectedTargets.length ||
      next.length > MAX_COMPARE_TARGETS
    )
      return false;
    selectedTargets = next;
    currentSearch = "";
    updateUrl();
    render();
    return true;
  }

  function addFilmId(id) {
    return addCompareTarget(filmTarget(id));
  }

  // --- Target cards -----------------------------------------------------------

  function renderFilmCard(film) {
    return window.renderSharedFilmCard(film, {
      classes: ["compare-film-card"],
      openFilm: false,
      compare: false,
      showYear: false,
      escape,
      titleHtml: `<a class="table-film-link" href="${escape(window.filmPageUrl(film.id))}">${escape(window.localizedFilmTitle?.(film) || film.title)}</a>`,
      actionsHtml: window.renderCardRemoveButton({
        escape,
        title: ui("Remove {title}", {
          title: window.localizedFilmTitle?.(film) || film.title,
        }),
        attributes: { "data-remove-compare-film": film.id },
      }),
    });
  }

  function renderPersonTargetCard(target) {
    let portrait =
      window.renderPersonPortrait?.(target.record, "card") ||
      `<div class="person-portrait-placeholder person-portrait-placeholder--compare" aria-hidden="true">${escape(initials(target.displayName))}</div>`;
    return `<article class="card compare-film-card compare-person-card">
    ${portrait}
    <div class="card-content">
      <span class="eyebrow">${escape(targetTypeLabel(target))}</span>
      <h2><a class="table-film-link" href="${escape(target.url)}">${escape(target.displayName)}</a></h2>
      <div class="leaderboard-meta">${Object.entries(target.metrics || {})
        .filter(
          ([, value]) => value !== "" && value !== null && value !== undefined,
        )
        .slice(0, 3)
        .map(([key, value]) => `${escape(ui(key))}: ${escape(value)}`)
        .join(" · ")}</div>
    </div>
    ${window.renderCardRemoveButton({
      escape,
      title: ui("Remove {title}", { title: target.displayName }),
      attributes: {
        "data-remove-compare-target":
          window.compareTargetKey?.(target) || `${target.type}:${target.id}`,
      },
    })}
  </article>`;
  }

  function renderTargetCard(target) {
    if (target.type === "film") return renderFilmCard(target.record);
    if (target.type === "person") return renderPersonTargetCard(target);
    return `<article class="card compare-film-card">
    <div class="card-content">
      <span class="eyebrow">${escape(targetTypeLabel(target))}</span>
      <h2><a class="table-film-link" href="${escape(target.url)}">${escape(target.displayName)}</a></h2>
      <div class="leaderboard-meta">${Object.entries(target.metrics || {})
        .filter(
          ([, value]) => value !== "" && value !== null && value !== undefined,
        )
        .slice(0, 3)
        .map(([key, value]) => `${escape(ui(key))}: ${escape(value)}`)
        .join(" · ")}</div>
    </div>
    ${window.renderCardRemoveButton({
      escape,
      title: ui("Remove {title}", { title: target.displayName }),
      attributes: {
        "data-remove-compare-target":
          window.compareTargetKey?.(target) || `${target.type}:${target.id}`,
      },
    })}
  </article>`;
  }

  // --- Controls, summary, and page render --------------------------------------

  function compareSummaryText(targets = selectedTargets) {
    let lines = [
      "The Oskars comparison",
      "",
      ...targets.map((target, index) => {
        let metrics = Object.entries(target.metrics || {})
          .filter(
            ([, value]) =>
              value !== "" && value !== null && value !== undefined,
          )
          .slice(0, 4)
          .map(([key, value]) => `${ui(key)}: ${value}`)
          .join("; ");
        let represented = [
          `${target.filmIds.length} ${ui("watched")}`,
          `${target.watchlistIds.length} ${ui("watchlist")}`,
        ].join(", ");
        return `${index + 1}. ${target.displayName} (${targetTypeLabel(target)})${metrics ? ` — ${metrics}` : ""} — ${represented}`;
      }),
      "",
      currentCompareUrl(targets),
    ];
    return lines.join("\n");
  }

  async function copyCompareSummary(targets = selectedTargets) {
    let text = compareSummaryText(targets);
    if (!text.trim() || !window.navigator?.clipboard?.writeText) return false;
    await window.navigator.clipboard.writeText(text);
    return true;
  }

  function renderControls(targets) {
    let films = selectedFilmRecords(targets);
    let searchResults = renderSearchResults(targets, currentSearch);
    let recent = targets.every((target) => target.type === "film")
      ? renderRecentComparisons(films)
      : "";
    return `<form class="compare-controls" data-compare-form>
    <label>${escape(ui("Add target"))}<input type="search" name="targetSearch" value="${escape(currentSearch)}" placeholder="${escape(ui("Search films, people, periods..."))}" autocomplete="off" data-compare-search ${targets.length >= MAX_COMPARE_TARGETS ? "disabled" : ""}></label>
    <button type="submit" ${targets.length >= MAX_COMPARE_TARGETS ? "disabled" : ""}>${escape(ui("Add"))}</button>
    <a class="button-link" href="${escape(currentCompareUrl(targets))}">${escape(ui("Share URL"))}</a>
    <button type="button" data-copy-compare-summary>${escape(ui("Copy summary"))}</button>
    <div class="compare-search-results" data-compare-results>${searchResults}</div>
  </form>${recent}`;
  }

  function renderSearchResults(targets, query) {
    if (targets.length >= MAX_COMPARE_TARGETS)
      return `<span class="compare-muted">${escape(ui("Remove a target before adding another."))}</span>`;
    if (!String(query || "").trim())
      return `<span class="compare-muted">${escape(ui("Search by title, person, period, tag, franchise, or project."))}</span>`;
    let matches = compareSearchMatches(query, targets);
    if (!matches.length)
      return `<span class="compare-muted">${escape(ui("No matching targets."))}</span>`;
    return matches
      .map(
        (
          candidate,
        ) => `<button type="button" class="compare-result" data-add-compare-target="${escape(window.encodeCompareTarget(candidate.target))}">
    ${candidate.film ? window.renderFilmPoster(candidate.film, "thumb") : `<span class="compare-result-kind">${escape(candidate.typeLabel)}</span>`}
    <span><strong>${escape(candidate.label)}</strong><small>${escape(candidate.typeLabel)}${candidate.subtitle ? ` · ${escape(candidate.subtitle)}` : ""}</small></span>
  </button>`,
      )
      .join("");
  }

  function renderObjectComparison(targets) {
    // Universal panels apply to every target mix; the specialized panels
    // between Overview and Represented films each render only when all
    // targets are the same kind (people / collections / same-type periods).
    let panels = [
      window.compareRenderOverviewPanel,
      window.compareRenderPeopleProfilePanel,
      window.compareRenderCollectionProfilePanel,
      window.compareRenderCollectionDistributionPanel,
      window.compareRenderPeriodProfilePanel,
      window.compareRenderRelationshipPanel,
      window.compareRenderRepresentedFilmsPanel,
      window.compareRenderAwardFootprintPanel,
      window.compareRenderFacetOverlapPanel,
      window.compareRenderActionPanel,
    ];
    document.title = `${ui("Compare")} · The Oskars`;
    container.innerHTML = `<header class="film-detail-header compare-header">
    <div><h1>${escape(ui("Compare"))}</h1><p>${escape(ui("Side-by-side comparison across films, people, periods, franchises, tags, projects, categories, roles, and songs."))}</p></div>
  </header>
  ${renderControls(targets)}
  <section class="compare-film-grid">${targets.map(renderTargetCard).join("")}</section>
  ${panels.map((panel) => panel(targets)).join("")}`;
    window.enhanceCollapsibles?.(container);
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("compare:render");
    let finishTargetsTimer = window.startOskarsPerformance?.("compare:targets");
    let targets = ensureTargets();
    let films = selectedFilmRecords(targets);
    finishTargetsTimer?.(
      `${targets.length} target(s), ${films.length} film record(s)`,
    );
    if (!targets.every((target) => target.type === "film")) {
      renderObjectComparison(targets);
      finishRenderTimer?.(`object comparison, ${targets.length} target(s)`);
      return;
    }
    rememberComparison(films);
    document.title = `${ui("Compare films")} · The Oskars`;
    container.innerHTML = `<header class="film-detail-header compare-header">
    <div><h1>${escape(ui("Compare"))}</h1><p>${escape(ui("Side-by-side film rankings, scores, metadata, and award overlap."))}</p></div>
  </header>
  ${renderControls(targets)}
  <section class="compare-film-grid">${targets.map(renderTargetCard).join("")}</section>
  ${window.compareRenderSharedTraitsPanel(films)}
  ${window.compareRenderMetricsPanel(films)}
  ${window.compareRenderAwardsPanel(films)}`;
    window.enhanceCollapsibles?.(container);
    finishRenderTimer?.(`film comparison, ${films.length} film(s)`);
  }

  container.addEventListener("submit", (event) => {
    let form = event.target.closest("[data-compare-form]");
    if (!form) return;
    event.preventDefault();
    let match = compareSearchMatches(
      new FormData(form).get("targetSearch"),
      ensureTargets(),
    )[0];
    addCompareTarget(match?.target);
  });

  container.addEventListener("click", (event) => {
    let copySummaryButton = event.target.closest("[data-copy-compare-summary]");
    if (copySummaryButton) {
      copySummaryButton.disabled = true;
      copyCompareSummary(ensureTargets())
        .then((copied) => {
          copySummaryButton.textContent = copied
            ? ui("Copied")
            : ui("Copy failed");
        })
        .catch(() => {
          copySummaryButton.textContent = ui("Copy failed");
        })
        .finally(() => {
          setTimeout(() => {
            copySummaryButton.disabled = false;
            copySummaryButton.textContent = ui("Copy summary");
          }, 1600);
        });
      return;
    }
    let projectButton = event.target.closest("[data-start-project-source]");
    if (projectButton) {
      window.startProjectFromSourceAndOpen(
        projectButton.dataset.startProjectSource,
        projectButton.dataset.projectSourceId,
      );
      return;
    }
    let addTargetButton = event.target.closest("[data-add-compare-target]");
    if (addTargetButton) {
      addCompareTarget(
        window.decodeCompareTarget(addTargetButton.dataset.addCompareTarget),
      );
      return;
    }
    let addButton = event.target.closest("[data-add-compare-film]");
    if (addButton) {
      addFilmId(addButton.dataset.addCompareFilm);
      return;
    }
    let removeTargetButton = event.target.closest(
      "[data-remove-compare-target]",
    );
    if (removeTargetButton) {
      selectedTargets = selectedTargets.filter(
        (target) =>
          (window.compareTargetKey?.(target) ||
            `${target.type}:${target.id}`) !==
          removeTargetButton.dataset.removeCompareTarget,
      );
      updateUrl();
      render();
      return;
    }
    let button = event.target.closest("[data-remove-compare-film]");
    if (!button) return;
    selectedTargets = selectedTargets.filter(
      (target) =>
        !(
          target.type === "film" &&
          target.id === button.dataset.removeCompareFilm
        ),
    );
    updateUrl();
    render();
  });

  container.addEventListener("input", (event) => {
    let input = event.target.closest("[data-compare-search]");
    if (!input) return;
    currentSearch = input.value;
    let results = container.querySelector("[data-compare-results]");
    if (results)
      results.innerHTML = renderSearchResults(ensureTargets(), currentSearch);
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
