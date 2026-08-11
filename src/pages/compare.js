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

  // --- Shared render helpers --------------------------------------------------

  function valueCell(value, options = {}) {
    let text =
      value === null || value === undefined || value === ""
        ? "—"
        : String(value);
    let content =
      options.href && text !== "—"
        ? `<a href="${escape(options.href)}">${escape(text)}</a>`
        : escape(text);
    return `<td${options.className ? ` class="${escape(options.className)}"` : ""}>${content}</td>`;
  }

  function metricRow(label, films, valueFn) {
    return `<tr><th>${escape(label)}</th>${films.map((film) => valueFn(film)).join("")}</tr>`;
  }

  function comparePanel(title, bodyHtml, options = {}) {
    let classes = ["compare-panel", ...(options.classes || [])]
      .filter(Boolean)
      .join(" ");
    return `<section class="${classes}"><h2>${escape(ui(title))}</h2>${options.introHtml || ""}${bodyHtml}</section>`;
  }

  // Compare tables keep their own scaffold rather than the shared
  // renderLeaderboardTable (issue #104): their bodies carry row-header <th>
  // cells and per-target column headers, a different contract from the
  // read-only data leaderboards.
  function compareTable(headers, rows, extraClasses = "") {
    let headerCells = headers.map((header) => `<th>${header}</th>`).join("");
    return `<div class="leaderboard-wrap"><table class="leaderboard compare-table${extraClasses ? ` ${extraClasses}` : ""}"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function targetTypeLabel(target) {
    return ui(TARGET_TYPE_LABELS[target.type] || target.type);
  }

  function targetHeaderCell(target) {
    return `<th><a href="${escape(target.url)}">${escape(target.displayName)}</a><span class="leaderboard-meta">${escape(targetTypeLabel(target))}</span></th>`;
  }

  function filmLinkList(films) {
    if (!films.length) return `<span class="compare-muted">—</span>`;
    return films
      .map(
        (film) =>
          `<a class="table-film-link" href="${escape(window.filmPageUrl(film.id))}">${escape(window.localizedFilmTitle?.(film) || film.title)}</a>`,
      )
      .join(", ");
  }

  function watchlistItemLinkList(items) {
    if (!items.length) return `<span class="compare-muted">—</span>`;
    return items
      .map((item) => {
        let film = window.watchlistFilmLike?.(item) || item;
        let id = item.id || window.watchlistItemId?.(item);
        let href = window.watchlistFilmPageUrl?.(id) || "";
        let title =
          window.localizedFilmTitle?.(film) || item.title || film.title;
        let meta = [
          item.tier ? `${ui("Tier")} ${item.tier}` : "",
          item.year || film.year || "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `${href ? `<a class="table-film-link" href="${escape(href)}">${escape(title)}</a>` : escape(title)}${meta ? `<span class="leaderboard-meta"> ${escape(meta)}</span>` : ""}`;
      })
      .join(", ");
  }

  function linkedPersonList(people, limit = 5) {
    if (!people.length) return `<span class="compare-muted">—</span>`;
    let visible = people
      .slice(0, limit)
      .map(
        (person) =>
          `<a class="table-film-link" href="${escape(window.personPageUrl(person.id))}">${escape(person.name)}</a>`,
      )
      .join(", ");
    let overflow =
      people.length > limit
        ? ` <span class="leaderboard-meta">+${escape(people.length - limit)}</span>`
        : "";
    return `${visible}${overflow}`;
  }

  function facetEntryList(entries, limit = 5) {
    if (!entries.length) return `<span class="compare-muted">—</span>`;
    let visible = entries
      .slice(0, limit)
      .map((entry) =>
        entry.href
          ? `<a class="table-film-link" href="${escape(entry.href)}">${escape(entry.label)}</a>`
          : escape(entry.label),
      )
      .join(", ");
    let overflow =
      entries.length > limit
        ? ` <span class="leaderboard-meta">+${escape(entries.length - limit)}</span>`
        : "";
    return `${visible}${overflow}`;
  }

  function countSummary(values, options = {}) {
    let counts = new Map();
    (values || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .forEach((value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
      });
    let entries = [...counts.entries()].sort(
      (left, right) =>
        right[1] - left[1] || window.compareEnglishTitles(left[0], right[0]),
    );
    if (!entries.length) return `<span class="compare-muted">—</span>`;
    return entries
      .slice(0, options.limit || 4)
      .map(
        ([label, count]) =>
          `${escape(label)} <span class="leaderboard-meta">${escape(count)}</span>`,
      )
      .join(", ");
  }

  function categoryCountList(counts, limit = 4) {
    if (!counts.length) return `<span class="compare-muted">—</span>`;
    return counts
      .slice(0, limit)
      .map(
        ([category, count]) =>
          `<a class="table-film-link" href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a><span class="leaderboard-meta"> ${escape(count)}</span>`,
      )
      .join(", ");
  }

  function topRepresentedFilms(filmIds, limit = 3) {
    return (filmIds || [])
      .map((id) => state.filmsById?.[id])
      .filter(Boolean)
      .sort(
        (left, right) =>
          Number(left.allTimeRank || 999999) -
            Number(right.allTimeRank || 999999) ||
          Number(left.year || 9999) - Number(right.year || 9999) ||
          window.compareEnglishTitles(left.title, right.title),
      )
      .slice(0, limit);
  }

  function topWatchlistItems(target, limit = 2) {
    return window
      .compareTargetWatchlistItems(target)
      .sort(
        (left, right) =>
          (window.watchlistTierRank?.(left.tier) ?? 999) -
            (window.watchlistTierRank?.(right.tier) ?? 999) ||
          Number(left.order || 999999) - Number(right.order || 999999) ||
          Number(left.year || 9999) - Number(right.year || 9999) ||
          window.compareEnglishTitles(left.title, right.title),
      )
      .slice(0, limit);
  }

  function normalizeList(values) {
    return (
      Array.isArray(values)
        ? values
        : String(values || "").split(/\s*(?:,|&|\band\b)\s*/i)
    )
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function scoreText(stats) {
    return `${stats.awardScore} (${window.formatNormalizedAwardScore(stats.normalizedAwardScore)})`;
  }

  function rankLink(type, key, rank) {
    return rank ? window.periodPageUrl(type, key) : "";
  }

  function initials(name) {
    return (
      String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase() || "?"
    );
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

  // --- Film-only panels (every target is a film) ------------------------------

  function statsFor(film, periodType) {
    let awards = (film.awards || []).filter(
      (award) => window.awardScorePeriodType(award) === periodType,
    );
    return calculateAwardStats(awards);
  }

  function filmMetricBundle(film) {
    let annualStats = statsFor(film, "years");
    let decadeStats = statsFor(film, "decades");
    let centuryStats = statsFor(film, "centuries");
    let allTimeStats = statsFor(film, "allTime");
    let totalStats = calculateAwardStats(film.awards || []);
    return { annualStats, decadeStats, centuryStats, allTimeStats, totalStats };
  }

  function sharedByKey(
    films,
    valuesFn,
    keyFn = (value) => normalizeTitle(value),
    labelFn = (value) => value,
  ) {
    let [first, ...rest] = films.map(valuesFn);
    if (!first?.length) return [];
    return first
      .filter((value) => {
        let key = keyFn(value);
        return (
          key &&
          rest.every((values) =>
            values.some((candidate) => keyFn(candidate) === key),
          )
        );
      })
      .map(labelFn);
  }

  function traitChip(label, value, href) {
    let content = href
      ? `<a href="${escape(href)}">${escape(value)}</a>`
      : escape(value);
    return `<span class="compare-trait"><b>${escape(ui(label))}</b>${content}</span>`;
  }

  function sharedPeopleByProfession(films) {
    let professions = window.PERSON_PROFESSION_ORDER.filter(
      (profession) => profession !== "Director",
    );
    return professions.flatMap((profession) => {
      let shared = sharedByKey(
        films,
        (film) => film.peopleByProfession?.[profession] || [],
        (person) => person.id,
        (person) => person,
      );
      return shared.map((person) => ({
        profession,
        id: person.id,
        name: person.name,
      }));
    });
  }

  function renderSharedTraits(films) {
    let traits = [];
    let years = [
      ...new Set(
        films
          .map((film) => String(film.year || ""))
          .filter((year) => /^\d{4}$/.test(year)),
      ),
    ];
    if (
      years.length === 1 &&
      films.every((film) => String(film.year || "") === years[0])
    ) {
      traits.push(
        traitChip("Year", years[0], window.periodPageUrl("year", years[0])),
      );
    }
    let decades = [
      ...new Set(
        films
          .map((film) =>
            /^\d{4}$/.test(String(film.year || ""))
              ? window.getDecadeKey(film.year)
              : "",
          )
          .filter(Boolean),
      ),
    ];
    if (decades.length === 1 && decades[0] !== "unknown")
      traits.push(
        traitChip(
          "Decade",
          decades[0],
          window.periodPageUrl("decade", decades[0]),
        ),
      );
    let centuries = [
      ...new Set(
        films
          .map((film) =>
            /^\d{4}$/.test(String(film.year || ""))
              ? window.getCenturyKey(film.year)
              : "",
          )
          .filter(Boolean),
      ),
    ];
    if (centuries.length === 1 && centuries[0] !== "unknown")
      traits.push(
        traitChip(
          "Century",
          centuries[0],
          window.periodPageUrl("century", centuries[0]),
        ),
      );

    let countries = sharedByKey(films, (film) => normalizeList(film.country));
    countries
      .slice(0, 4)
      .forEach((country) => traits.push(traitChip("Country", country)));
    let media = [
      ...new Set(
        films
          .map((film) => film.medium)
          .filter((value) => value && value !== "unknown"),
      ),
    ];
    if (media.length === 1 && films.every((film) => film.medium === media[0]))
      traits.push(traitChip("Medium", media[0]));
    let screenplayTypes = [
      ...new Set(
        films
          .map((film) => film.screenplayType)
          .filter((value) => value && value !== "unknown"),
      ),
    ];
    if (
      screenplayTypes.length === 1 &&
      films.every((film) => film.screenplayType === screenplayTypes[0])
    )
      traits.push(traitChip("Screenplay", screenplayTypes[0]));

    sharedByKey(films, (film) =>
      normalizeList(film.directors?.length ? film.directors : film.director),
    )
      .slice(0, 4)
      .forEach((name) =>
        traits.push(
          traitChip(
            "Director",
            name,
            window.personPageUrl(window.normalizePersonName(name)),
          ),
        ),
      );
    sharedPeopleByProfession(films)
      .slice(0, 10)
      .forEach((person) => {
        traits.push(
          traitChip(
            person.profession,
            person.name,
            window.personPageUrl(person.id),
          ),
        );
      });
    sharedByKey(films, (film) => window.parseFilmTags?.(film.tags) || [])
      .slice(0, 8)
      .forEach((tag) =>
        traits.push(traitChip("Tag", tag, window.tagPageUrl(tag))),
      );
    sharedByKey(
      films,
      (film) => window.normalizeFranchiseMemberships?.(film.franchises) || [],
      (membership) => membership.id,
      (membership) => membership.name || membership.id,
    )
      .slice(0, 6)
      .forEach((name) => {
        let membership = films
          .flatMap(
            (film) =>
              window.normalizeFranchiseMemberships?.(film.franchises) || [],
          )
          .find((item) => (item.name || item.id) === name);
        traits.push(
          traitChip(
            "Franchise",
            name,
            membership?.id ? window.franchisePageUrl(membership.id) : "",
          ),
        );
      });

    return comparePanel(
      "Shared traits",
      `<div class="compare-trait-list">${traits.join("") || `<span class="compare-muted">${escape(ui("No obvious shared metadata."))}</span>`}</div>`,
      { classes: ["compare-shared-panel"] },
    );
  }

  function renderMetricTable(films) {
    let bundles = new Map(
      films.map((film) => [film.id, filmMetricBundle(film)]),
    );
    let rows = [
      metricRow(ui("Year"), films, (film) =>
        valueCell(film.year, {
          href: film.year ? window.periodPageUrl("year", film.year) : "",
        }),
      ),
      metricRow(ui("Director"), films, (film) =>
        valueCell(
          window.compactNameList?.(film.director || film.directors || [])
            .displayText ||
            film.director ||
            (film.directors || []).join(", "),
        ),
      ),
      metricRow(ui("Rating"), films, (film) => valueCell(film.rating)),
      metricRow(ui("Country"), films, (film) => valueCell(film.country)),
      metricRow(ui("All-time rank"), films, (film) =>
        valueCell(film.allTimeRank, {
          href: rankLink("alltime", "alltime", film.allTimeRank),
        }),
      ),
      metricRow(ui("Century rank"), films, (film) =>
        valueCell(film.centuryRank, {
          href: rankLink(
            "century",
            window.getCenturyKey(film.year),
            film.centuryRank,
          ),
        }),
      ),
      metricRow(ui("Decade rank"), films, (film) =>
        valueCell(film.decadeRank, {
          href: rankLink(
            "decade",
            window.getDecadeKey(film.year),
            film.decadeRank,
          ),
        }),
      ),
      metricRow(ui("Year rank"), films, (film) =>
        valueCell(film.yearRank, {
          href: rankLink("year", film.year, film.yearRank),
        }),
      ),
      metricRow(ui("Year score"), films, (film) =>
        valueCell(scoreText(bundles.get(film.id).annualStats), {
          className: "compare-number-cell",
        }),
      ),
      metricRow(ui("Decade score"), films, (film) =>
        valueCell(scoreText(bundles.get(film.id).decadeStats), {
          className: "compare-number-cell",
        }),
      ),
      metricRow(ui("Century score"), films, (film) =>
        valueCell(scoreText(bundles.get(film.id).centuryStats), {
          className: "compare-number-cell",
        }),
      ),
      metricRow(ui("All-time score"), films, (film) =>
        valueCell(scoreText(bundles.get(film.id).allTimeStats), {
          className: "compare-number-cell",
        }),
      ),
      metricRow(ui("Total wins"), films, (film) =>
        valueCell(bundles.get(film.id).totalStats.wins, {
          className: "compare-number-cell",
        }),
      ),
      metricRow(ui("Total nominations"), films, (film) =>
        valueCell(bundles.get(film.id).totalStats.nominations, {
          className: "compare-number-cell",
        }),
      ),
      metricRow(ui("Big wins"), films, (film) =>
        valueCell(bundles.get(film.id).annualStats.bigWin),
      ),
    ].join("");
    let headers = [
      escape(ui("Measure")),
      ...films.map((film) =>
        escape(window.localizedFilmTitle?.(film) || film.title),
      ),
    ];
    return comparePanel("Metrics", compareTable(headers, rows));
  }

  function awardGroupKey(award) {
    return `${window.getAwardPeriodType(award)}\n${award.year || ""}\n${award.category || ""}`;
  }

  function directCompetitionKeys(films) {
    let groups = new Map();
    films.forEach((film) =>
      (film.awards || []).forEach((award) => {
        let key = awardGroupKey(award);
        let group = groups.get(key) || { award, entries: [] };
        group.entries.push({ film, award });
        groups.set(key, group);
      }),
    );
    return new Set(
      [...groups.values()]
        .map((group) => {
          let seenFilms = new Set(group.entries.map((entry) => entry.film.id));
          return seenFilms.size >= 2 ? awardGroupKey(group.award) : "";
        })
        .filter(Boolean),
    );
  }

  function awardCell(film, category, competitionKeys) {
    let awards = (film.awards || [])
      .filter((award) => award.category === category)
      .sort(
        (left, right) =>
          Number(String(left.year || "").replace(/\D/g, "")) -
            Number(String(right.year || "").replace(/\D/g, "")) ||
          Number(left.placement) - Number(right.placement),
      );
    if (!awards.length) return "<td>—</td>";
    let parts = awards
      .map((award) => {
        let type = window.getAwardPeriodType(award);
        let periodLabel = award.year === "alltime" ? "All-time" : award.year;
        let href = window.periodPageUrl(type, award.year);
        let isCompetition = competitionKeys.has(awardGroupKey(award));
        return `<span class="${isCompetition ? "compare-direct-marker" : ""}"><a href="${escape(href)}">${window.pagePlacement(award.placement)}</a><span>${escape(periodLabel)}</span>${isCompetition ? `<b title="${escape(ui("Direct competition among compared films"))}">${escape(ui("Direct"))}</b>` : ""}</span>`;
      })
      .join("");
    return `<td class="compare-award-cell">${parts}</td>`;
  }

  function renderAwardTable(films) {
    let categories = [
      ...new Set(
        films.flatMap((film) =>
          (film.awards || []).map((award) => award.category),
        ),
      ),
    ].sort((left, right) => categorySortIndex(left) - categorySortIndex(right));
    let competitionKeys = directCompetitionKeys(films);
    let rows = categories
      .map((category) => {
        let hasCompetition = films.some((film) =>
          (film.awards || []).some(
            (award) =>
              award.category === category &&
              competitionKeys.has(awardGroupKey(award)),
          ),
        );
        return `<tr${hasCompetition ? ' class="compare-direct-competition"' : ""}><th><a href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a></th>${films.map((film) => awardCell(film, category, competitionKeys)).join("")}</tr>`;
      })
      .join("");
    let headers = [
      escape(ui("Category")),
      ...films.map((film) =>
        escape(window.localizedFilmTitle?.(film) || film.title),
      ),
    ];
    return comparePanel(
      "Award overlap",
      compareTable(
        headers,
        rows ||
          `<tr><td colspan="${films.length + 1}">${escape(ui("No nominations"))}</td></tr>`,
        "compare-awards-table",
      ),
    );
  }

  // --- Universal panels (render for every target mix) -------------------------

  function targetMetricValue(target, key) {
    let value = target.metrics?.[key];
    return value === null || value === undefined || value === "" ? "—" : value;
  }

  function renderTargetOverviewTable(targets) {
    let metricKeys = [
      ...new Set(
        targets.flatMap((target) => Object.keys(target.metrics || {})),
      ),
    ];
    let rows = [
      `<tr><th>${escape(ui("Type"))}</th>${targets.map((target) => valueCell(targetTypeLabel(target))).join("")}</tr>`,
      `<tr><th>${escape(ui("Name"))}</th>${targets.map((target) => valueCell(target.displayName, { href: target.url })).join("")}</tr>`,
      ...metricKeys.map(
        (key) =>
          `<tr><th>${escape(ui(key))}</th>${targets.map((target) => valueCell(targetMetricValue(target, key), { className: typeof targetMetricValue(target, key) === "number" ? "compare-number-cell" : "" })).join("")}</tr>`,
      ),
    ].join("");
    let headers = [
      escape(ui("Measure")),
      ...targets.map((target) => escape(target.displayName)),
    ];
    return comparePanel("Overview", compareTable(headers, rows));
  }

  function renderRepresentedFilmsPanel(targets) {
    let filmSets = targets.map((target) => new Set(target.filmIds));
    let sharedFilmIds = filmSets.length
      ? [...filmSets[0]].filter((id) => filmSets.every((set) => set.has(id)))
      : [];
    let sharedFilms = topRepresentedFilms(sharedFilmIds, 8);
    let rows = targets
      .map(
        (target) => `<tr>
      ${targetHeaderCell(target)}
      <td class="compare-number-cell">${escape(target.filmIds.length)}</td>
      <td class="compare-number-cell">${escape(target.watchlistIds.length)}</td>
      <td class="compare-number-cell">${escape(window.formatAverageRating(target.ratingStatistics.mean))}</td>
      <td class="compare-number-cell">${escape(window.formatRatingStatistic(target.ratingStatistics.standardDeviation))}</td>
      <td class="compare-number-cell">${escape(`${target.ratingStatistics.ratedCount}/${target.ratingStatistics.totalCount} (${target.ratingStatistics.coveragePercent}%)`)}</td>
      <td>${filmLinkList(topRepresentedFilms(target.filmIds, 4))}</td>
    </tr>`,
      )
      .join("");
    let sharedHtml = sharedFilms.length
      ? `<p class="compare-muted">${escape(ui("Shared films"))}: ${filmLinkList(sharedFilms)}</p>`
      : `<p class="compare-muted">${escape(ui("No shared represented films."))}</p>`;
    return comparePanel(
      "Represented films",
      compareTable(
        [
          ui("Target"),
          ui("Watched"),
          ui("Watchlist"),
          ui("Average rating"),
          ui("Standard deviation"),
          ui("Rated coverage"),
          ui("Top films"),
        ].map(escape),
        rows,
      ),
      { introHtml: sharedHtml },
    );
  }

  function targetAwardCategoryCounts(entries) {
    let counts = new Map();
    entries.forEach(({ award }) => {
      if (!award.category) return;
      counts.set(award.category, (counts.get(award.category) || 0) + 1);
    });
    return [...counts.entries()].sort(
      (left, right) =>
        categorySortIndex(left[0]) - categorySortIndex(right[0]) ||
        right[1] - left[1] ||
        window.compareEnglishTitles(left[0], right[0]),
    );
  }

  function renderAwardFootprintPanel(targets) {
    let targetEntries = targets.map((target) => ({
      target,
      entries: window.compareTargetAwardEntries(target),
    }));
    let categorySets = targetEntries.map(
      ({ entries }) =>
        new Set(entries.map(({ award }) => award.category).filter(Boolean)),
    );
    let sharedCategories = categorySets.length
      ? [...categorySets[0]]
          .filter((category) => categorySets.every((set) => set.has(category)))
          .sort(
            (left, right) =>
              categorySortIndex(left) - categorySortIndex(right) ||
              window.compareEnglishTitles(left, right),
          )
      : [];
    let rows = targetEntries
      .map(({ target, entries }) => {
        let stats = calculateAwardStats(entries.map(({ award }) => award));
        return `<tr>
      ${targetHeaderCell(target)}
      <td class="compare-number-cell">${escape(stats.wins)}</td>
      <td class="compare-number-cell">${escape(stats.nominations)}</td>
      <td class="compare-number-cell">${escape(scoreText(stats))}</td>
      <td>${categoryCountList(targetAwardCategoryCounts(entries))}</td>
    </tr>`;
      })
      .join("");
    let sharedHtml = sharedCategories.length
      ? `<p class="compare-muted">${escape(ui("Shared categories"))}: ${categoryCountList(sharedCategories.map((category) => [category, categorySets.length]))}</p>`
      : `<p class="compare-muted">${escape(ui("No shared award categories."))}</p>`;
    return comparePanel(
      "Award footprint",
      compareTable(
        [
          ui("Target"),
          ui("Wins"),
          ui("Nominations"),
          ui("Score"),
          ui("Categories"),
        ].map(escape),
        rows,
      ),
      { introHtml: sharedHtml },
    );
  }

  function renderFacetOverlapPanel(targets) {
    let configs = [
      ["countries", "Countries"],
      ["years", "Years"],
      ["tags", "Tags"],
      ["franchises", "Franchises"],
      ["people", "People"],
      ["media", "Media"],
      ["screenplays", "Screenplays"],
    ];
    let targetFacetList = targets.map(window.compareTargetFacets);
    let rows = configs
      .map(([key, label]) => {
        let shared = window.compareSharedFacetEntries(targetFacetList, key);
        let targetCells = targetFacetList
          .map((facets) => `<td>${facetEntryList(facets[key] || [])}</td>`)
          .join("");
        return `<tr><th>${escape(ui(label))}</th><td>${facetEntryList(shared)}</td>${targetCells}</tr>`;
      })
      .join("");
    let headers = [
      escape(ui("Facet")),
      escape(ui("Shared")),
      ...targets.map((target) => escape(target.displayName)),
    ];
    return comparePanel("Metadata overlap", compareTable(headers, rows));
  }

  function targetProjectAction(target) {
    if (!["person", "franchise", "tag"].includes(target.type))
      return `<span class="compare-muted">—</span>`;
    return (
      window.renderSourceProjectAction?.(target.type, target.id, {
        escape,
        buttonClass: "button-link",
      }) || `<span class="compare-muted">—</span>`
    );
  }

  function targetSourceLinks(target) {
    let links = [
      `<a class="button-link" href="${escape(target.url)}">${escape(ui("Open page"))}</a>`,
    ];
    if (target.type === "project") {
      let sourceHref = window.projectSourceHref?.(target.record);
      if (sourceHref)
        links.push(
          `<a class="button-link" href="${escape(sourceHref)}">${escape(ui("Source"))}</a>`,
        );
    }
    return links.join("");
  }

  function renderActionPanel(targets) {
    let rows = targets
      .map(
        (target) => `<tr>
    ${targetHeaderCell(target)}
    <td><div class="compare-action-list">${targetSourceLinks(target)}</div></td>
    <td>${targetProjectAction(target)}</td>
  </tr>`,
      )
      .join("");
    let introHtml = `<p class="compare-muted">${escape(ui("Open source pages, share this comparison, or continue collection-like targets as projects."))}</p>
    <div class="compare-action-list"><a class="button-link" href="${escape(currentCompareUrl(targets))}">${escape(ui("Share URL"))}</a></div>`;
    return comparePanel(
      "Actions",
      compareTable(
        [ui("Target"), ui("Links"), ui("Project")].map(escape),
        rows,
      ),
      { introHtml },
    );
  }

  // --- Mixed-target relationship panel --------------------------------------

  function targetPairLabel(left, right) {
    return `<a href="${escape(left.url)}">${escape(left.displayName)}</a><span class="leaderboard-meta">${escape(targetTypeLabel(left))}</span> × <a href="${escape(right.url)}">${escape(right.displayName)}</a><span class="leaderboard-meta">${escape(targetTypeLabel(right))}</span>`;
  }

  function overlapFilms(ids) {
    return ids.map((id) => state.filmsById?.[id]).filter(Boolean);
  }

  function overlapWatchlistItems(ids) {
    let wanted = new Set(ids);
    return (state.watchlist || []).filter((item) =>
      wanted.has(item.id || window.watchlistItemId?.(item)),
    );
  }

  function relationshipItemCell(filmIds, watchlistIds) {
    let films = overlapFilms(filmIds);
    let items = overlapWatchlistItems(watchlistIds);
    let total = films.length + items.length;
    if (!total)
      return `<td><span class="compare-muted">${escape(ui("None"))}</span></td>`;
    let details = [
      films.length ? filmLinkList(films.slice(0, 4)) : "",
      items.length ? watchlistItemLinkList(items.slice(0, 4)) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `<td><b>${escape(total)}</b>${details ? ` · ${details}` : ""}</td>`;
  }

  function filmPersonRoles(filmTarget, personTarget) {
    let film = filmTarget.record;
    let roles = [];
    let directorIds = normalizeList(
      film.directors?.length ? film.directors : film.director,
    ).map(
      (name) =>
        window.normalizePersonName?.(name) || window.normalizeTitle(name),
    );
    if (directorIds.includes(personTarget.id)) roles.push(ui("Director"));
    Object.entries(film.peopleByProfession || {}).forEach(
      ([profession, people]) => {
        let credit = people.find((person) => person.id === personTarget.id);
        if (!credit) return;
        let details = (credit.details || []).join(", ");
        roles.push(`${ui(profession)}${details ? ` (${details})` : ""}`);
      },
    );
    return [...new Set(roles)];
  }

  function filmPeriodContext(filmTarget, periodTarget) {
    let entry = (periodTarget.record?.films || []).find(
      (candidate) =>
        (candidate.id || candidate.filmId) === filmTarget.record.id,
    );
    if (!entry) return ui("Not represented in this period");
    let awards = window
      .comparePeriodAwardEntries(periodTarget)
      .filter(({ film }) => film.id === filmTarget.record.id);
    let parts = [ui("Represented in this period")];
    if (Number(entry.rank) > 0)
      parts.push(`${ui("Rank")} #${entry.rank}`);
    parts.push(`${awards.length} ${ui("period nominations")}`);
    return parts.join(" · ");
  }

  function sharedPeriodAwards(periodTarget, sharedFilmIds) {
    let ids = new Set(sharedFilmIds);
    return window
      .comparePeriodAwardEntries(periodTarget)
      .filter(({ film }) => ids.has(film.id)).length;
  }

  function relationshipContext(left, right, overlap) {
    let filmTarget =
      left.type === "film" ? left : right.type === "film" ? right : null;
    let personTarget =
      left.type === "person" ? left : right.type === "person" ? right : null;
    let periodTarget =
      left.type === "period" ? left : right.type === "period" ? right : null;
    if (filmTarget && personTarget) {
      let roles = filmPersonRoles(filmTarget, personTarget);
      return roles.length ? roles.join(", ") : ui("No credited role in this film");
    }
    if (filmTarget && periodTarget)
      return filmPeriodContext(filmTarget, periodTarget);
    if (periodTarget) {
      return `${overlap.sharedFilmIds.length} ${ui("shared films")} · ${sharedPeriodAwards(periodTarget, overlap.sharedFilmIds)} ${ui("period nominations")}`;
    }
    if (filmTarget) {
      return overlap.sharedFilmIds.length
        ? ui("Film is represented by this target")
        : ui("Film is not represented by this target");
    }
    if (isCollectionTarget(left) && isCollectionTarget(right)) {
      return `${overlap.sharedFilmIds.length} ${ui("shared films")} · ${overlap.leftOnlyFilmIds.length} ${ui("unique to first")} · ${overlap.rightOnlyFilmIds.length} ${ui("unique to second")}`;
    }
    return `${overlap.sharedFilmIds.length} ${ui("shared films")} · ${overlap.sharedWatchlistIds.length} ${ui("shared watchlist")}`;
  }

  function renderRelationshipPanel(targets) {
    let mixedTypes = new Set(targets.map((target) => target.type)).size > 1;
    if (!mixedTypes && !targets.every(isCollectionTarget)) return "";
    let rows = [];
    targets.forEach((left, leftIndex) => {
      targets.slice(leftIndex + 1).forEach((right) => {
        let overlap = window.compareTargetOverlap(left, right);
        rows.push(`<tr>
      <th>${targetPairLabel(left, right)}</th>
      <td>${escape(relationshipContext(left, right, overlap))}</td>
      ${relationshipItemCell(overlap.sharedFilmIds, overlap.sharedWatchlistIds)}
      ${relationshipItemCell(overlap.leftOnlyFilmIds, overlap.leftOnlyWatchlistIds)}
      ${relationshipItemCell(overlap.rightOnlyFilmIds, overlap.rightOnlyWatchlistIds)}
    </tr>`);
      });
    });
    return comparePanel(
      "Relationships",
      compareTable(
        [
          ui("Pair"),
          ui("Relationship"),
          ui("Shared"),
          ui("Only first"),
          ui("Only second"),
        ].map(escape),
        rows.join(""),
      ),
      {
        introHtml: `<p class="compare-muted">${escape(ui("Each selected pair appears once; counts include watched films and watchlist items."))}</p>`,
      },
    );
  }

  // --- Specialized panels (render only for a uniform target kind) --------------

  function isCollectionTarget(target) {
    return ["franchise", "tag", "project"].includes(target.type);
  }

  function collectionCompletion(target) {
    let watched = target.filmIds.length;
    let total = watched + target.watchlistIds.length;
    return total ? `${Math.round((watched / total) * 100)}%` : "—";
  }

  function renderCollectionProfilePanel(targets) {
    if (!targets.length || !targets.every(isCollectionTarget)) return "";
    let rows = targets
      .map(
        (target) => `<tr>
      ${targetHeaderCell(target)}
      <td class="compare-number-cell">${escape(target.filmIds.length)}</td>
      <td class="compare-number-cell">${escape(target.watchlistIds.length)}</td>
      <td class="compare-number-cell">${escape(collectionCompletion(target))}</td>
      <td>${filmLinkList(topRepresentedFilms(target.filmIds, 3))}</td>
      <td>${watchlistItemLinkList(topWatchlistItems(target))}</td>
    </tr>`,
      )
      .join("");
    return comparePanel(
      "Collection profile",
      compareTable(
        [
          ui("Target"),
          ui("Watched"),
          ui("Watchlist"),
          ui("Completion"),
          ui("Top films"),
          ui("Next unwatched"),
        ].map(escape),
        rows,
      ),
    );
  }

  function renderCollectionDistributionPanel(targets) {
    if (!targets.length || !targets.every(isCollectionTarget)) return "";
    let rows = targets
      .map((target) => {
        let films = window.compareTargetFilms(target);
        let watchlistItems = window.compareTargetWatchlistItems(target);
        let ranked = films.filter((film) => Number(film.allTimeRank) > 0);
        let top250 = ranked.filter((film) => Number(film.allTimeRank) <= 250);
        return `<tr>
      ${targetHeaderCell(target)}
      <td class="compare-number-cell">${escape(ranked.length)}</td>
      <td class="compare-number-cell">${escape(top250.length)}</td>
      <td>${countSummary(films.map((film) => film.rating))}</td>
      <td>${countSummary(watchlistItems.map((item) => item.tier))}</td>
    </tr>`;
      })
      .join("");
    return comparePanel(
      "Collection distribution",
      compareTable(
        [
          ui("Target"),
          ui("Ranked"),
          ui("Top 250"),
          ui("Rating"),
          ui("Tier"),
        ].map(escape),
        rows,
      ),
    );
  }

  function isPersonTarget(target) {
    return target.type === "person";
  }

  function renderPeopleProfilePanel(targets) {
    if (!targets.length || !targets.every(isPersonTarget)) return "";
    let filmSets = targets.map((target) => new Set(target.filmIds));
    let sharedFilms = filmSets.length
      ? topRepresentedFilms(
          [...filmSets[0]].filter((id) => filmSets.every((set) => set.has(id))),
          6,
        )
      : [];
    let sharedCollaborators = window.compareSharedCollaborators(targets);
    let rows = targets
      .map((target) => {
        let collaborators = window.comparePersonCollaborators(target);
        let professions = (target.record.professions || [])
          .map((profession) => ui(profession))
          .join(", ");
        return `<tr>
      ${targetHeaderCell(target)}
      <td>${escape(professions || "—")}</td>
      <td class="compare-number-cell">${escape(target.filmIds.length)}</td>
      <td class="compare-number-cell">${escape(target.metrics?.wins || 0)}</td>
      <td class="compare-number-cell">${escape(target.metrics?.nominations || 0)}</td>
      <td>${linkedPersonList(collaborators)}</td>
    </tr>`;
      })
      .join("");
    let introHtml = `<p class="compare-muted">${escape(ui("Shared films"))}: ${filmLinkList(sharedFilms)} · ${escape(ui("Shared collaborators"))}: ${linkedPersonList(sharedCollaborators)}</p>`;
    return comparePanel(
      "People profile",
      compareTable(
        [
          ui("Person"),
          ui("Professions"),
          ui("Films"),
          ui("Wins"),
          ui("Nominations"),
          ui("Collaborators"),
        ].map(escape),
        rows,
      ),
      { introHtml },
    );
  }

  function isPeriodTarget(target) {
    return target.type === "period";
  }

  function periodTopFilms(target, limit = 3) {
    let awardsByFilm = new Map();
    window.comparePeriodAwardEntries(target).forEach(({ film, award }) => {
      let list = awardsByFilm.get(film.id) || [];
      list.push(award);
      awardsByFilm.set(film.id, list);
    });
    return window
      .compareTargetFilms(target)
      .map((film) => ({
        film,
        stats: calculateAwardStats(awardsByFilm.get(film.id) || []),
      }))
      .sort(
        (left, right) =>
          right.stats.awardScore - left.stats.awardScore ||
          right.stats.wins - left.stats.wins ||
          right.stats.nominations - left.stats.nominations ||
          Number(left.film.allTimeRank || 999999) -
            Number(right.film.allTimeRank || 999999) ||
          window.compareEnglishTitles(left.film.title, right.film.title),
      )
      .slice(0, limit)
      .map((entry) => entry.film);
  }

  function renderPeriodProfilePanel(targets) {
    if (
      !targets.length ||
      !targets.every(isPeriodTarget) ||
      !window.compareSamePeriodType(targets)
    )
      return "";
    let targetEntries = targets.map((target) => ({
      target,
      entries: window.comparePeriodAwardEntries(target),
    }));
    let categorySets = targetEntries.map(
      ({ entries }) =>
        new Set(entries.map(({ award }) => award.category).filter(Boolean)),
    );
    let sharedCategories = categorySets.length
      ? [...categorySets[0]]
          .filter((category) => categorySets.every((set) => set.has(category)))
          .sort(
            (left, right) =>
              categorySortIndex(left) - categorySortIndex(right) ||
              window.compareEnglishTitles(left, right),
          )
      : [];
    let rows = targetEntries
      .map(({ target, entries }) => {
        let stats = calculateAwardStats(entries.map(({ award }) => award));
        let filmCount = target.filmIds.length;
        let density = filmCount
          ? (stats.awardScore / filmCount).toFixed(1)
          : "—";
        return `<tr>
      ${targetHeaderCell(target)}
      <td class="compare-number-cell">${escape(filmCount)}</td>
      <td class="compare-number-cell">${escape(stats.wins)}</td>
      <td class="compare-number-cell">${escape(stats.nominations)}</td>
      <td class="compare-number-cell">${escape(scoreText(stats))}</td>
      <td class="compare-number-cell">${escape(density)}</td>
      <td>${filmLinkList(periodTopFilms(target))}</td>
      <td>${categoryCountList(targetAwardCategoryCounts(entries))}</td>
    </tr>`;
      })
      .join("");
    let sharedHtml = sharedCategories.length
      ? `<p class="compare-muted">${escape(ui("Shared categories"))}: ${categoryCountList(sharedCategories.map((category) => [category, categorySets.length]))}</p>`
      : `<p class="compare-muted">${escape(ui("No shared award categories."))}</p>`;
    return comparePanel(
      "Period profile",
      compareTable(
        [
          ui("Period"),
          ui("Films"),
          ui("Wins"),
          ui("Nominations"),
          ui("Score"),
          ui("Award density"),
          ui("Top films"),
          ui("Top categories"),
        ].map(escape),
        rows,
      ),
      { introHtml: sharedHtml },
    );
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
      renderTargetOverviewTable,
      renderPeopleProfilePanel,
      renderCollectionProfilePanel,
      renderCollectionDistributionPanel,
      renderPeriodProfilePanel,
      renderRelationshipPanel,
      renderRepresentedFilmsPanel,
      renderAwardFootprintPanel,
      renderFacetOverlapPanel,
      renderActionPanel,
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
  ${renderSharedTraits(films)}
  ${renderMetricTable(films)}
  ${renderAwardTable(films)}`;
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
