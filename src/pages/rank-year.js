/** @file Resolves one year's same-rating ranking shelves and hands completed heats into broader ranking finals. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("rankYearPage");
  let year = String(window.pageQueryParam?.("year") || "").trim();
  let valid = /^\d{4}$/.test(year);
  let expandedRatingBucket;

  window.load();

  if (!valid) {
    document.title = `${ui("Rank a year")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Year not found"))}</h1><a href="index.html">${escape(ui("Return home"))}</a></div>`;
    return;
  }

  document.title = `${ui("Rank {year}", { year })} · The Oskars`;

  function yearFilms() {
    return window.allTimeSourceFilmsInOrder().filter(
      (film) =>
        String(window.filmConcreteYear?.(film.year) || film.year || "") ===
        year,
    );
  }

  function renderRankCard(film, index) {
    let directorHtml = window.renderLinkedDirectors?.(film, { escape }) || "";
    return window.renderSharedFilmCard(film, {
      classes: ["ranking-edit-card"],
      attributes: {
        draggable: "true",
        "data-setup-rank-film-id": film.id,
        "data-setup-rank-index": index,
      },
      openFilm: false,
      titleHtml: `<span class="table-film-link">${escape(film.title)}</span>`,
      showYear: false,
      rankLabel:
        film.rankConfirmed === false ? ui("NR") : `${film.yearRank || ""}.`,
      directorHtml: directorHtml
        ? `<div class="film-director">${escape(ui("by"))} ${directorHtml}</div>`
        : "",
      escape,
    });
  }

  function renderRatingBucket(key, bucketFilms) {
    bucketFilms = [...bucketFilms].sort(
      (left, right) =>
        Number(left.allTimeRank || left.rank || 999999) -
        Number(right.allTimeRank || right.rank || 999999),
    );
    let label = bucketFilms[0].rating || key;
    if (bucketFilms.length === 1) {
      return `<div class="setup-year-category-row">
        <div class="setup-year-category-header">
          <span class="setup-year-rank-bucket-label">${escape(label)}</span>
          <span class="setup-year-section-empty">${escape(bucketFilms[0].title)}</span>
          <span class="setup-ranking-state is-reviewed">${escape(ui("Settled"))}</span>
        </div>
      </div>`;
    }
    let reviewed = bucketFilms.every((film) => film.rankConfirmed !== false);
    let isExpanded = expandedRatingBucket === key;
    let header = `<div class="setup-year-category-header">
      <span class="setup-year-rank-bucket-label">${escape(label)} <small>(${escape(bucketFilms.length)})</small></span>
      <span class="setup-ranking-state ${reviewed ? "is-reviewed" : "is-mechanical"}">${escape(ui(reviewed ? "Reviewed" : "Mechanical order"))}</span>
      <button type="button" class="sort-order-button" data-setup-rank-bucket-toggle="${escape(key)}">${escape(isExpanded ? ui("Collapse") : ui("Reorder"))}</button>
    </div>`;
    if (!isExpanded)
      return `<div class="setup-year-category-row">${header}</div>`;
    let cards = bucketFilms
      .map((film, index) => renderRankCard(film, index))
      .join("");
    return `<div class="setup-year-category-row is-expanded">
      ${header}
      <div class="film-grid setup-year-pool-grid">${cards}</div>
      <div class="setup-ranking-actions"><button type="button" data-setup-rank-confirm="${escape(key)}">${escape(ui("Confirm this order"))}</button><a class="button-link" href="ranking-review.html?type=years&amp;key=${escape(year)}">${escape(ui("Compare two at a time"))}</a></div>
    </div>`;
  }

  function rankingSection() {
    let films = yearFilms().filter((film) => window.rankingRatingKey(film));
    if (!films.length) {
      return `<div class="setup-year-section-empty"><p>${escape(ui("No rated films yet for {year}.", { year }))}</p><a class="button-link" href="rate-watched.html?year=${escape(year)}">${escape(ui("Rate this year"))}</a></div>`;
    }
    let buckets = new Map();
    films.forEach((film) => {
      let key = window.rankingRatingKey(film);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(film);
    });
    let orderedKeys = [...buckets.keys()].sort(
      (left, right) =>
        window.rankingRatingSortValueFromKey(right) -
        window.rankingRatingSortValueFromKey(left),
    );
    if (expandedRatingBucket === undefined) {
      expandedRatingBucket =
        orderedKeys.find((key) => buckets.get(key).length > 1) || null;
    }
    let tieCount = window.rankingConsistencyPairsForYear(
      year,
      new Set(),
    ).length;
    let statusText = tieCount
      ? ui("{count} tie(s) to resolve.", { count: tieCount })
      : ui("Every rating tier is already in a single order.");
    let sections = orderedKeys
      .map((key) => renderRatingBucket(key, buckets.get(key)))
      .join("");
    let multiFilmGroups = orderedKeys
      .map((key) => buckets.get(key))
      .filter((group) => group.length > 1);
    let heatComplete = multiFilmGroups.every((group) =>
      group.every((film) => film.rankConfirmed !== false),
    );
    let decade = window.getDecadeKey(year);
    return `<p class="setup-year-section-empty">${escape(ui("Edits all-time order inside the same exact rating only."))} ${escape(statusText)}</p>
      <div class="setup-year-category-list">${sections}</div>
      <div class="setup-ranking-footer">${heatComplete ? `<span>${escape(ui("Year heat complete"))}</span><a class="button-link" href="ranking-review.html?type=decades&amp;key=${escape(decade)}">${escape(ui("Continue to {scope} finals", { scope: decade }))} →</a><a class="button-link" href="${escape(window.yearAwardsPageUrl(year))}">${escape(ui("Build annual awards"))} →</a>` : `<a class="button-link" href="ranking-review.html?type=years&amp;key=${escape(year)}">${escape(ui("Compare this year two at a time"))}</a>`}</div>`;
  }

  function render() {
    let finish = window.startOskarsPerformance?.("rankYear:render");
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">${escape(ui("Year ranking"))}</span><h1>${escape(year)}</h1><p>${escape(ui("Arrange films only against others with the same exact rating."))}</p>`,
      actionsHtml: `<a class="button-link" href="build.html">${escape(ui("Build your Oskars"))}</a><a class="button-link" href="${escape(window.yearAwardsPageUrl(year))}">${escape(ui("Build annual awards"))}</a><a class="button-link" href="${escape(window.periodPageUrl("years", year))}">${escape(ui("View {year}", { year }))}</a>`,
    });
    container.innerHTML = `${header}<section class="setup-year-section"><h2>${escape(ui("Ranking shelves"))}</h2>${rankingSection()}</section>`;
    finish?.(`${year} · ${yearFilms().length} films`);
  }

  container.addEventListener("click", (event) => {
    let toggle = event.target.closest("[data-setup-rank-bucket-toggle]");
    if (toggle) {
      let key = toggle.dataset.setupRankBucketToggle;
      expandedRatingBucket = expandedRatingBucket === key ? null : key;
      render();
      return;
    }
    let confirm = event.target.closest("[data-setup-rank-confirm]");
    if (!confirm) return;
    window.confirmYearRankingBucket(year, confirm.dataset.setupRankConfirm);
    window.save?.({ immediate: true, rebuild: false });
    render();
  });

  let dragPayload = null;
  container.addEventListener("dragstart", (event) => {
    let card = event.target.closest("[data-setup-rank-film-id]");
    if (!card) return;
    dragPayload = {
      filmId: card.dataset.setupRankFilmId,
      index: Number(card.dataset.setupRankIndex),
    };
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  container.addEventListener("dragend", (event) => {
    event.target
      .closest("[data-setup-rank-film-id]")
      ?.classList.remove("dragging");
    dragPayload = null;
  });
  container.addEventListener("dragover", (event) => {
    let target = event.target.closest("[data-setup-rank-film-id]");
    if (!dragPayload || !target) return;
    event.preventDefault();
    target.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    event.target
      .closest("[data-setup-rank-film-id]")
      ?.classList.remove("drop-target");
  });
  container.addEventListener("drop", (event) => {
    let target = event.target.closest("[data-setup-rank-film-id]");
    if (!dragPayload || !target || target.dataset.setupRankFilmId === dragPayload.filmId)
      return;
    event.preventDefault();
    target.classList.remove("drop-target");
    let position =
      dragPayload.index < Number(target.dataset.setupRankIndex)
        ? "after"
        : "before";
    let result = window.moveRankedFilmWithinRating(
      dragPayload.filmId,
      target.dataset.setupRankFilmId,
      position,
    );
    if (!result.ok) {
      window.alert?.(result.reason);
      return;
    }
    window.save?.({ immediate: true, rebuild: false });
    render();
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
