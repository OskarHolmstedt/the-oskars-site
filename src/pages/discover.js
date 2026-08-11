/** @file Controls URL-backed discovery filters and random film or person selection. */

(function () {
  let escape = window.pageEscape;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));
  window.load();
  let container = document.getElementById("discoverPage");
  let filterNames = [
    "period",
    "profession",
    "medium",
    "screenplay",
    "adaptationSource",
    "category",
    "exactRating",
    "minimumRating",
    "maximumRating",
    "watchlistTier",
    "director",
  ];
  // Free-text, not part of the shared film-filter vocabulary (no archive
  // equivalent), so it's validated like "profession" instead of routed
  // through filmFilterDefinition.
  let freeTextFilterNames = ["profession", "director"];
  let filmFilterNames = filterNames.filter(
    (name) => !freeTextFilterNames.includes(name) && name !== "watchlistTier",
  );
  // Rating and award-category signals don't exist pre-watch; "all-time"
  // period means "no restriction" here since watchlist items never carry an
  // all-time rank (mirrors period.js's watchlist view - issue #100).
  let watchlistFilterNames = [
    "period",
    "medium",
    "screenplay",
    "adaptationSource",
    "watchlistTier",
  ];
  let discoverUrlState = window.createPageViewState({
    path: "discover.html",
    schema: Object.fromEntries(
      filterNames.map((name) => [
        name,
        {
          default: "",
          validate: (value) =>
            freeTextFilterNames.includes(name) ||
            window.filmFilterDefinition(name)?.validate(value),
        },
      ]),
    ),
  });
  let currentFilters = discoverUrlState.read();

  /**
   * Lists archive films matching the discovery filters.
   * @param {Object} [filters] Shared film-filter values.
   * @returns {FilmRecord[]}
   */
  window.discoveryFilmCandidates = function (filters = {}) {
    let filmFilters = Object.fromEntries(
      filmFilterNames.map((name) => [name, filters[name]]),
    );
    return Object.values(state.filmsById || {}).filter((film) =>
      window.filmMatchesFilters(film, filmFilters),
    );
  };

  /**
   * Lists watchlist items matching the discovery filters, for the "watch
   * tonight" picker. Reuses the shared `watchQueueCandidates` (issue #160)
   * rather than a parallel query, plus a free-text director match that
   * isn't part of the shared film-filter vocabulary.
   * @param {Object} [filters] Shared film-filter values, plus `director`.
   * @returns {WatchlistItem[]}
   */
  window.discoveryWatchlistCandidates = function (filters = {}) {
    let watchlistFilters = Object.fromEntries(
      watchlistFilterNames.map((name) => [name, filters[name]]),
    );
    let director = String(filters.director || "")
      .trim()
      .toLowerCase();
    let candidates = window.watchQueueCandidates(watchlistFilters, {
      period: { alltimeMatchesAll: true },
    });
    return candidates.filter(
      (item) => !director || item.director?.toLowerCase().includes(director),
    );
  };

  /**
   * Lists people whose credits and films match the discovery filters.
   * @param {Object} [filters] Film, profession, and category filter values.
   * @returns {PersonRecord[]}
   */
  window.discoveryPersonCandidates = function (filters = {}) {
    let matchingFilmIds = new Set(
      window.discoveryFilmCandidates(filters).map((film) => film.id),
    );
    return Object.values(
      window.ensurePeopleIndex?.() || state.peopleById || {},
    ).filter(
      (person) =>
        (!filters.profession ||
          person.professions.includes(filters.profession)) &&
        person.filmIds.some((id) => matchingFilmIds.has(id)) &&
        (!filters.category ||
          person.credits.some(
            (credit) =>
              credit.source === "award" &&
              credit.category === filters.category &&
              matchingFilmIds.has(credit.filmId),
          )),
    );
  };

  function randomItem(items) {
    if (!items.length) return null;
    let index;
    if (window.crypto?.getRandomValues) {
      let value = new Uint32Array(1);
      window.crypto.getRandomValues(value);
      index = value[0] % items.length;
    } else index = Math.floor(Math.random() * items.length);
    return items[index];
  }

  function option(value, label, name) {
    return `<option value="${escape(value)}"${name && currentFilters[name] === String(value) ? " selected" : ""}>${escape(label)}</option>`;
  }
  function ratingLabel(kind, value) {
    let rating = `${value % 1 ? value : value.toFixed(0)}★`;
    if (kind === "minimum") return ui("At least {rating}", { rating });
    if (kind === "maximum") return ui("At most {rating}", { rating });
    return rating;
  }
  function ratingOptions(kind) {
    return Array.from({ length: 10 }, (_, index) => {
      let value = (index + 1) / 2;
      return option(
        value,
        ratingLabel(kind, value),
        kind === "minimum" ? "minimumRating" : "maximumRating",
      );
    }).join("");
  }
  function mediumLabel(value) {
    if (value === "live-action") return ui("Live action");
    if (value === "animation") return ui("Animation");
    if (value === "hybrid") return ui("Hybrid");
    return value;
  }
  function watchlistTierOptions() {
    return window.WATCHLIST_TIERS.map((tier) =>
      option(tier, tier, "watchlistTier"),
    ).join("");
  }
  function exactRatingOptions() {
    return [
      ...new Set(
        Object.values(state.filmsById || {})
          .map((film) => window.filmRatingValue(film))
          .filter(Boolean),
      ),
    ]
      .sort((left, right) => right - left)
      .map((value) =>
        option(
          value,
          `${value % 1 ? value : value.toFixed(0)}★`,
          "exactRating",
        ),
      )
      .join("");
  }

  function renderDiscover() {
    let finishRenderTimer = window.startOskarsPerformance?.("discover:render");
    let finishOptionsTimer =
      window.startOskarsPerformance?.("discover:options");
    let years = Object.keys(state.years || {})
      .filter((key) => /^\d{4}$/.test(key))
      .sort((a, b) => Number(a) - Number(b));
    let decades = [
      ...new Set(
        Object.values(state.filmsById || {})
          .filter((film) => /^\d{4}$/.test(String(film.year || "")))
          .map((film) => window.getDecadeKey(film.year)),
      ),
    ].sort();
    let centuries = [
      ...new Set(
        Object.values(state.filmsById || {})
          .filter((film) => /^\d{4}$/.test(String(film.year || "")))
          .map((film) => window.getCenturyKey(film.year)),
      ),
    ].sort();
    let periodOptions = `${option("", ui("Any period"), "period")}${option("alltime:alltime", ui("All-time ranked"), "period")}<optgroup label="${escape(ui("Centuries"))}">${centuries.map((key) => option(`century:${key}`, key, "period")).join("")}</optgroup><optgroup label="${escape(ui("Decades"))}">${decades.map((key) => option(`decade:${key}`, key, "period")).join("")}</optgroup><optgroup label="${escape(ui("Years"))}">${years.map((key) => option(`year:${key}`, key, "period")).join("")}</optgroup>`;
    let professionOptions = window.PERSON_PROFESSION_ORDER.map((value) =>
      option(value, ui(value), "profession"),
    ).join("");
    let categoryOptions = window
      .getOrderedCategories()
      .map((value) =>
        option(
          value,
          window.localizedCategoryName?.(value) || value,
          "category",
        ),
      )
      .join("");
    let adaptationSourceOptions = window
      .getAdaptationSources()
      .map((value) => option(value, ui(value), "adaptationSource"))
      .join("");
    finishOptionsTimer?.(
      `${years.length} years, ${decades.length} decades, ${centuries.length} centuries`,
    );

    container.innerHTML = `${window.renderDetailHeader({ mainHtml: `<h1>${escape(ui("Discover"))}</h1><p>${escape(ui("Let the archive choose something for you."))}</p>` })}
    <form class="discovery-filters" id="discoveryFilters">
      <label>${escape(ui("Period"))}<select name="period">${periodOptions}</select></label>
      <label>${escape(ui("Profession"))}<select name="profession">${option("", ui("Any profession"), "profession")}${professionOptions}</select></label>
      <label>${escape(ui("Medium"))}<select name="medium">${option("", ui("Any medium"), "medium")}${option("live-action", ui("Live action"), "medium")}${option("animation", ui("Animation"), "medium")}${option("hybrid", ui("Hybrid"), "medium")}</select></label>
      <label>${escape(ui("Screenplay"))}<select name="screenplay">${option("", ui("Any screenplay"), "screenplay")}${option("original", ui("Original"), "screenplay")}${option("adapted", ui("Adapted"), "screenplay")}</select></label>
      <label>${escape(ui("Adapted from"))}<select name="adaptationSource">${option("", ui("Any source"), "adaptationSource")}${adaptationSourceOptions}</select></label>
      <label>${escape(ui("Award category"))}<select name="category">${option("", ui("Any category"), "category")}${categoryOptions}</select></label>
      <label>${escape(ui("Exact rating"))}<select name="exactRating">${option("", ui("Any rating"), "exactRating")}${exactRatingOptions()}</select></label>
      <label>${escape(ui("Minimum rating"))}<select name="minimumRating">${option("", ui("No minimum"), "minimumRating")}${ratingOptions("minimum")}</select></label>
      <label>${escape(ui("Maximum rating"))}<select name="maximumRating">${option("", ui("No maximum"), "maximumRating")}${ratingOptions("maximum")}</select></label>
      <label>${escape(ui("Tier"))}<select name="watchlistTier">${option("", ui("Any tier"), "watchlistTier")}${watchlistTierOptions()}</select></label>
      <label>${escape(ui("Director"))}<input type="text" name="director" value="${escape(currentFilters.director || "")}"></label>
      <div class="discovery-actions"><button type="button" data-discover="film">${escape(ui("Random film"))}</button><button type="button" data-discover="person">${escape(ui("Random person"))}</button><button type="button" data-discover="watchlist">${escape(ui("Surprise me"))}</button><button type="button" data-discover="double-feature">${escape(ui("Double feature"))}</button>${window.renderCopyViewLinkButton({ escape })}</div>
    </form>
    <section id="discoveryResult" class="discovery-result"><p>${escape(ui("Choose filters if you like, then take a chance."))}</p></section>`;
    finishRenderTimer?.(`${filterNames.length} filter(s)`);
  }

  renderDiscover();
  window.addEventListener?.("oskars:localechange", renderDiscover);

  function filters() {
    currentFilters = Object.fromEntries(
      new FormData(document.getElementById("discoveryFilters")).entries(),
    );
    return currentFilters;
  }
  function renderFilm(film, count) {
    let tags = window.parseFilmTags(film.tags);
    let title = window.localizedFilmTitle?.(film) || film.title;
    return window.renderSharedFilmCard(film, {
      classes: ["discovery-pick"],
      openFilm: false,
      rating: false,
      escape,
      beforeTitleHtml: `<span class="discovery-count">${escape(ui("Chosen from {count} films", { count }))}</span>`,
      titleHtml: `<h2><a href="${escape(window.filmPageUrl(film.id))}">${escape(title)}</a></h2>`,
      bodyHtml: `<p>${escape(film.year || "")}${film.director ? ` · ${escape(film.director)}` : ""}</p><strong class="rating">${escape(film.rating || "")}${window.renderTop250Marker(film)}</strong>${tags.length ? `<div class="film-tag-list">${tags.map((tag) => `<a class="film-tag" href="${escape(window.tagPageUrl(tag))}">${escape(tag)}</a>`).join("")}</div>` : ""}`,
    });
  }
  function renderPerson(person, count) {
    return `<article class="discovery-pick person-pick">${window.renderPersonPortrait(person, "detail")}<div><span class="discovery-count">${escape(ui("Chosen from {count} people", { count }))}</span><h2><a href="${escape(window.personPageUrl(person.id))}">${escape(person.name)}</a></h2><p>${escape(person.professions.map((profession) => ui(profession)).join(" · "))}</p><span>${escape(ui("{count} films", { count: person.filmIds.length }))} · ${escape(ui("{count} annual nominations", { count: person.stats?.nominations || 0 }))}</span></div></article>`;
  }
  function watchlistFilmCardHtml(item, options = {}) {
    let tags = item.tags || [];
    let title = window.localizedFilmTitle?.(item) || item.title;
    return window.renderSharedFilmCard(item, {
      classes: ["discovery-pick"],
      openFilm: false,
      rating: false,
      escape,
      beforeTitleHtml: options.beforeTitleHtml || "",
      titleHtml: `<h2><a href="${escape(window.watchlistFilmPageUrl(item.id))}">${escape(title)}</a></h2>`,
      bodyHtml: `<p>${escape(item.year || "")}${item.director ? ` · ${escape(item.director)}` : ""}</p>${window.renderWatchlistTierBadge(item.tier, { escape })}${options.extraBodyHtml || ""}${tags.length ? `<div class="film-tag-list">${tags.map((tag) => `<a class="film-tag" href="${escape(window.tagPageUrl(tag))}">${escape(tag)}</a>`).join("")}</div>` : ""}`,
    });
  }
  function renderWatchlistPick(pick, count) {
    return watchlistFilmCardHtml(pick.item, {
      beforeTitleHtml: `<span class="discovery-count">${escape(ui("Chosen from {count} watchlist films", { count }))}</span>`,
      extraBodyHtml: `<p class="discovery-reason">${escape(window.watchQueueReasonText(pick.reason))}</p>`,
    });
  }
  // Turns a watch-queue pairing (issue #162) into one full, independently
  // localizable sentence per pairing type, same principle as
  // window.watchQueueReasonText (src/ui/page-utils.js) - shared with the
  // watchlist-view queue panel (issue #163) - above.
  function doubleFeaturePairingText(pairing) {
    if (pairing?.type === "collaboration")
      return ui("Paired because both are by {name}.", {
        name: pairing.params.name,
      });
    if (pairing?.type === "similarity-franchise")
      return ui('Paired because both belong to the "{name}" franchise.', {
        name: pairing.params.name,
      });
    if (pairing?.type === "similarity-tag")
      return ui('Paired because both are tagged "{tag}".', {
        tag: pairing.params.tag,
      });
    if (pairing?.type === "historical-context")
      return ui("Paired for historical context - both are from the {decade}.", {
        decade: pairing.params.decade,
      });
    if (pairing?.type === "contrast")
      return ui("Paired for contrast: {mediumA} against {mediumB}.", {
        mediumA: mediumLabel(pairing.params.mediumA),
        mediumB: mediumLabel(pairing.params.mediumB),
      });
    return ui(
      "No strong connection found between these two — paired from the same filtered set.",
    );
  }
  function renderDoubleFeature(pair, count) {
    let cards = [pair.anchor.item, pair.partner]
      .map((item) => watchlistFilmCardHtml(item))
      .join("");
    return `<div class="discovery-double-feature"><span class="discovery-count">${escape(ui("Chosen from {count} watchlist films", { count }))}</span><div class="double-feature-pair">${cards}</div><p class="discovery-reason">${escape(doubleFeaturePairingText(pair.pairing))}</p></div>`;
  }
  function emptyResultHtml() {
    return `<div class="detail-empty"><h2>${escape(ui("No matches"))}</h2><p>${escape(ui("Try relaxing one or two filters."))}</p></div>`;
  }
  container.addEventListener("click", (event) => {
    let copyButton = event.target.closest("[data-copy-view-link]");
    if (copyButton) {
      window.copyViewLink().then((copied) => {
        copyButton.textContent = ui(copied ? "Copied" : "Copy failed");
      });
      return;
    }
    let button = event.target.closest("[data-discover]");
    if (!button) return;
    let values = filters();
    let resultContainer = document.getElementById("discoveryResult");
    if (button.dataset.discover === "watchlist") {
      let items = window.discoveryWatchlistCandidates(values);
      let picks = window.pickWatchQueueItems(items, { count: 1 });
      resultContainer.innerHTML = picks.length
        ? renderWatchlistPick(picks[0], items.length)
        : emptyResultHtml();
      return;
    }
    if (button.dataset.discover === "double-feature") {
      let items = window.discoveryWatchlistCandidates(values);
      let pair = window.pickWatchQueueDoubleFeature(items);
      resultContainer.innerHTML = pair
        ? renderDoubleFeature(pair, items.length)
        : emptyResultHtml();
      return;
    }
    let items =
      button.dataset.discover === "film"
        ? window.discoveryFilmCandidates(values)
        : window.discoveryPersonCandidates(values);
    let picked = randomItem(items);
    resultContainer.innerHTML = picked
      ? button.dataset.discover === "film"
        ? renderFilm(picked, items.length)
        : renderPerson(picked, items.length)
      : emptyResultHtml();
  });
  container.addEventListener("change", (event) => {
    if (!event.target.closest("#discoveryFilters select, #discoveryFilters input"))
      return;
    filters();
    discoverUrlState.replace(currentFilters);
  });
})();
