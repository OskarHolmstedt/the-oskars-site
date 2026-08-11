/**
 * @file Guided "set up {year}" dashboard (issue #232): resolve this year's
 * ranking ties and build its Oskars bracket category by category, reusing
 * existing domain calls (moveRankedFilmWithinRating,
 * planNominationInsertion/applyNominationPlacementPlan, deleteNomination)
 * rather than raw dialogs. No new state is persisted - remaining ties and
 * unfilled categories are derived fresh from live data on every render, so
 * the flow is resumable across sessions for free, and either section can be
 * worked in any order.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();

  let container = document.getElementById("setupYearPage");
  let year = String(window.pageQueryParam?.("year") || "").trim();
  let valid = /^\d{4}$/.test(year);

  if (!valid) {
    document.title = `${ui("Set up a year")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Year not found"))}</h1><a href="index.html">${escape(ui("Return home"))}</a></div>`;
    return;
  }

  document.title = `${ui("Set up {year}", { year })} · The Oskars`;

  function yearFilms() {
    return window.allTimeSourceFilmsInOrder().filter(
      (film) =>
        String(window.filmConcreteYear?.(film.year) || film.year || "") ===
        year,
    );
  }

  // ---- Ranking section: one collapsible accordion row per exact rating
  // tier (mirrors the Bracket section's own expandedCategory accordion,
  // issue #237), each expanding into a drag-and-drop poster grid that
  // mirrors period.html's ranking-edit mechanic exactly
  // (src/pages/period/film-view.js, src/pages/period.js) rather than a
  // bespoke interaction. Dropping onto another card in the same tier
  // reorders via moveRankedFilmWithinRating; cross-tier drops can't
  // happen here since each grid only ever holds one exact rating.
  let expandedRatingBucket; // undefined = not yet auto-selected this load

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
      // The year-local subrank, not the all-time one - more meaningful
      // while working through a single year. "NR" when the reset tool has
      // dropped this film back to the mechanical default order and it
      // hasn't been deliberately placed again yet.
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
        </div>
      </div>`;
    }
    let isExpanded = expandedRatingBucket === key;
    let toggleLabel = isExpanded ? ui("Collapse") : ui("Reorder");
    let header = `<div class="setup-year-category-header">
      <span class="setup-year-rank-bucket-label">${escape(label)} <small>(${escape(bucketFilms.length)})</small></span>
      <button type="button" class="sort-order-button" data-setup-rank-bucket-toggle="${escape(key)}">${escape(toggleLabel)}</button>
    </div>`;
    if (!isExpanded) return `<div class="setup-year-category-row">${header}</div>`;
    let cards = bucketFilms
      .map((film, index) => renderRankCard(film, index))
      .join("");
    return `<div class="setup-year-category-row is-expanded">
      ${header}
      <div class="film-grid setup-year-pool-grid">${cards}</div>
    </div>`;
  }

  function renderRankingSection() {
    let films = yearFilms().filter((film) => window.rankingRatingKey(film));
    if (!films.length) {
      return `<div class="setup-year-section-empty">
        <p>${escape(ui("No rated films yet for {year}.", { year }))}</p>
      </div>`;
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
    // Nothing expanded yet this render cycle (fresh page load): open the
    // first tier that actually has a tie to resolve, so the common case
    // ("there's real work here") doesn't cost an extra click.
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
    return `<p class="setup-year-section-empty">${escape(ui("Edits all-time order inside the same exact rating only."))} ${escape(statusText)}</p>
      <div class="setup-year-category-list">${sections}</div>`;
  }

  // ---- Bracket section state ----
  let expandedCategory = null;
  // Staged rather than instant-add for every category except Best Picture,
  // which has no recipient concept at all: adding or editing a credit
  // needs the same small recipient(+detail) form, so both flows share it.
  let pendingNominee = null; // { category, filmId, placement }
  let editingNominee = null; // { category, filmId, placement }
  // Films X'd out of a category's eligible pool while narrowing down
  // choices. Deliberately in-memory only (like expandedCategory) rather
  // than saved state: this is scratch work for thinking it through, not a
  // real judgment about the film, so it resets on reload and never touches
  // the domain layer. Scoped per category, since a film ruled out for Best
  // Picture can still be very much in play for Best Actor.
  let excludedFromPool = new Map(); // category -> Set<filmId>

  function excludedFromPoolFor(category) {
    return excludedFromPool.get(category) || new Set();
  }

  function categoryDefaultRecipient(category, film) {
    return category === "Best Director"
      ? (film.directors || []).join(", ") || film.director || ""
      : "";
  }

  function creditFieldsHtml(category, recipient, detail) {
    let subjectType = window.creditSubjectType(
      category,
      window.PERSON_AWARD_PROFESSIONS[category],
    );
    let detailField =
      subjectType === "role"
        ? `<label>${escape(ui("Role"))}<input name="detail" value="${escape(detail || "")}"></label>`
        : subjectType === "song"
          ? `<label>${escape(ui("Song title"))}<input name="detail" value="${escape(detail || "")}"></label>`
          : "";
    return `<label>${escape(ui("Recipient(s)"))}<input name="recipient" value="${escape(recipient || "")}"></label>${detailField}`;
  }

  function renderPoolCard(film, category) {
    return window.renderSharedFilmCard(film, {
      classes: ["setup-year-pool-card"],
      openFilm: false,
      attributes: {
        draggable: "true",
        "data-setup-award-film": film.id,
        "data-setup-award-add": category,
        tabindex: "0",
        role: "button",
      },
      showYear: false,
      actionsHtml: window.renderCardRemoveButton({
        escape,
        title: ui("Not a contender - hide from this pool"),
        attributes: { "data-setup-pool-exclude": "" },
      }),
      escape,
    });
  }

  function renderNomineeRow(entry, category) {
    let rankBadge = `<span class="${window.placementEmoji?.[entry.award.placement] ? "rank medal" : "rank numeric"}">${window.pagePlacement(entry.award.placement)}</span>`;
    let filmLink = `<a class="table-film-link" href="${escape(window.filmPageUrl(entry.film.id))}">${escape(entry.film.title)}</a>`;
    let removeButton = window.renderCardRemoveButton({
      escape,
      title: ui("Remove"),
      attributes: {
        "data-setup-award-remove": "",
        "data-setup-award-category": category,
        "data-setup-award-film-id": entry.film.id,
        "data-setup-award-placement": entry.award.placement,
      },
    });
    let isEditing =
      editingNominee?.category === category &&
      editingNominee?.filmId === entry.film.id &&
      Number(editingNominee?.placement) === Number(entry.award.placement);
    if (isEditing) {
      return `<div class="card setup-year-nominee">
        ${rankBadge}
        <form class="setup-year-credit-form" data-setup-award-credit-form data-setup-award-mode="edit" data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(entry.film.id)}" data-setup-award-placement="${escape(entry.award.placement)}">
          ${creditFieldsHtml(category, window.awardRecipientText?.(entry.award) || "", window.awardDetail?.(entry.award) || "")}
          <button type="submit">${escape(ui("Save"))}</button>
          <button type="button" data-setup-award-credit-cancel>${escape(ui("Cancel"))}</button>
        </form>
        ${filmLink}
        ${removeButton}
      </div>`;
    }
    let credit =
      window.renderAwardCreditHtml?.({
        film: entry.film,
        award: entry.award,
        category,
        escape,
        detailStyle: "divider",
        wrapperClass: "nominee-recipient-credit",
      })?.html || "";
    let creditControl =
      category === "Best Picture"
        ? ""
        : `<button type="button" class="setup-year-credit-edit" data-setup-award-credit-edit data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(entry.film.id)}" data-setup-award-placement="${escape(entry.award.placement)}">${credit || escape(ui("Add credit"))}</button><span class="separator">—</span>`;
    return `<div class="card setup-year-nominee" data-setup-award-target="${escape(entry.award.placement)}">
      ${rankBadge}
      ${creditControl}
      ${filmLink}
      ${removeButton}
    </div>`;
  }

  function renderCategoryRow(category, films) {
    let nominees = window.nomineesForCategory(year, "years", category);
    let capacities = window.bracketCapacities("years");
    let capacity =
      category === "Best Picture" ? capacities.picture : capacities.category;
    let isExpanded = expandedCategory === category;
    let statusClass = nominees.length
      ? nominees.length >= capacity
        ? "is-full"
        : "is-started"
      : "is-empty";
    let toggleLabel = isExpanded ? ui("Collapse") : ui("Fill");
    let header = `<div class="setup-year-category-header">
      <a class="category-link" href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a>
      <span class="setup-year-category-progress ${statusClass}">${escape(nominees.length)}/${escape(capacity)}</span>
      <button type="button" class="sort-order-button" data-setup-award-toggle="${escape(category)}">${escape(toggleLabel)}</button>
    </div>`;
    if (!isExpanded) return `<div class="setup-year-category-row">${header}</div>`;

    let nomineeRowsHtml = nominees.map((entry) => renderNomineeRow(entry, category)).join("");
    // A film already nominated here drops out of the pool, unless the
    // category allows more than one nominee from the same film (acting
    // categories, Best Song) - a different person/song from that film can
    // still take another slot.
    let multiNominee = window.isMultiNomineeCategory(category);
    let nominatedIds = multiNominee
      ? new Set()
      : new Set(nominees.map((entry) => entry.film.id));
    let excludedIds = excludedFromPoolFor(category);
    let pool = window
      .eligibleFilmsForCategory(films, category, "years")
      .filter(
        (entry) =>
          !nominatedIds.has(entry.film.id) && !excludedIds.has(entry.film.id),
      );
    let isPending = pendingNominee?.category === category;
    let poolHtml = isPending
      ? renderPendingNomineeForm(films)
      : pool.length
        ? `<div class="film-grid setup-year-pool-grid">${pool.map((entry) => renderPoolCard(entry.film, category)).join("")}</div>`
        : `<p class="setup-year-section-empty">${escape(ui("No more of {year}'s watched films are eligible for this category.", { year }))}</p>`;
    let fullNotice =
      nominees.length >= capacity
        ? `<p class="setup-year-category-full">${escape(ui("{category} is full. Drop a film onto a nominee above to bump it in, or remove one first.", { category: window.localizedCategoryName?.(category) || category }))}</p>`
        : "";
    let restoreHtml = excludedIds.size
      ? `<button type="button" class="sort-order-button" data-setup-pool-restore="${escape(category)}">${escape(ui("Show {count} hidden", { count: excludedIds.size }))}</button>`
      : "";

    return `<div class="setup-year-category-row is-expanded">
      ${header}
      <div class="board full-width setup-year-board" data-setup-award-board="${escape(category)}">
        <div class="board-content">
          <div class="board-nominees">${nomineeRowsHtml || `<p class="setup-year-section-empty">${escape(ui("No nominees yet."))}</p>`}</div>
        </div>
      </div>
      ${fullNotice}
      <h4>${escape(ui("Eligible films from {year}", { year }))} ${restoreHtml}</h4>
      ${poolHtml}
    </div>`;
  }

  function renderBracketSection() {
    let films = yearFilms();
    let rows = window
      .getOrderedCategories()
      .map((category) => renderCategoryRow(category, films))
      .join("");
    return `<div class="setup-year-category-list">${rows}</div>`;
  }

  function renderPendingNomineeForm(films) {
    let { category, filmId, placement } = pendingNominee;
    let film = films.find((candidate) => candidate.id === filmId);
    let defaultRecipient = film ? categoryDefaultRecipient(category, film) : "";
    return `<form class="setup-year-credit-form" data-setup-award-credit-form data-setup-award-mode="add" data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(filmId)}" data-setup-award-placement="${escape(placement)}">
      <p>${escape(ui("Nominate {title} for {category}", { title: film?.title || filmId, category: window.localizedCategoryName?.(category) || category }))}</p>
      ${creditFieldsHtml(category, defaultRecipient, "")}
      <button type="submit">${escape(ui("Add"))}</button>
      <button type="button" data-setup-award-credit-cancel>${escape(ui("Cancel"))}</button>
    </form>`;
  }

  // Best Picture has no recipient concept (no PERSON_AWARD_PROFESSIONS
  // entry) and adds instantly; every other category stages the pick and
  // collects a recipient (+ detail for role/song categories) first, since
  // a second same-film nomination in a multi-nominee category needs a
  // distinct recipient to avoid colliding with the first at the plan layer.
  function beginNominee(category, filmId, placement) {
    if (category === "Best Picture") {
      addNominee(category, filmId, placement, "", "");
      return;
    }
    pendingNominee = { category, filmId, placement };
    editingNominee = null;
    render();
  }

  function addNominee(category, filmId, placement, recipient, detail) {
    let plan = window.planNominationInsertion({
      periodType: "years",
      periodKey: year,
      category,
      filmId,
      placement,
      recipient: recipient || "",
      detail: detail || "",
    });
    if (!plan.ok) {
      window.alert?.(plan.errors.join("\n"));
      return;
    }
    window.applyNominationPlacementPlan(plan);
    window.save?.({ immediate: true });
    pendingNominee = null;
    render();
  }

  function saveNomineeCredit(category, filmId, placement, recipient, detail) {
    let ok = window.updateAwardRecipient(
      filmId,
      category,
      Number(placement),
      year,
      recipient,
    );
    if (!ok) {
      window.alert?.(
        window.lastRuleViolation?.errors?.join("\n") ||
          ui("Could not update the recipient."),
      );
      return;
    }
    if (detail !== undefined)
      window.updateAwardDetail(filmId, category, Number(placement), year, detail);
    window.save?.({ immediate: true });
    editingNominee = null;
    render();
  }

  function nextOpenPlacement(category) {
    let nominees = window.nomineesForCategory(year, "years", category);
    let capacities = window.bracketCapacities("years");
    let capacity =
      category === "Best Picture" ? capacities.picture : capacities.category;
    return Math.min(nominees.length + 1, capacity);
  }

  function removeNominee(category, filmId, placement) {
    let result = window.deleteNomination(year, category, filmId, Number(placement));
    if (!result.ok) {
      window.alert?.(result.reason);
      return;
    }
    window.save?.({ immediate: true });
    render();
  }

  function toggleCategory(category) {
    expandedCategory = expandedCategory === category ? null : category;
    pendingNominee = null;
    editingNominee = null;
    render();
  }

  // ---- Combined render ----
  function render() {
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">${escape(ui("Set up a year"))}</span><h1>${escape(year)}</h1><p><a href="${escape(window.periodPageUrl("years", year))}">${escape(ui("View {year}", { year }))}</a></p>`,
    });
    container.innerHTML = `${header}
      <section class="setup-year-section">
        <h2>${escape(ui("Ranking"))}</h2>
        ${renderRankingSection()}
      </section>
      <section class="setup-year-section">
        <h2>${escape(ui("Bracket"))}</h2>
        ${renderBracketSection()}
      </section>`;
  }

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest("[data-setup-pool-exclude]")) return;
    let addTarget = event.target.closest("[data-setup-award-add]");
    if (addTarget) {
      event.preventDefault();
      let category = addTarget.dataset.setupAwardAdd;
      beginNominee(category, addTarget.dataset.setupAwardFilm, nextOpenPlacement(category));
    }
  });

  container.addEventListener("click", (event) => {
    let rankBucketToggle = event.target.closest(
      "[data-setup-rank-bucket-toggle]",
    );
    if (rankBucketToggle) {
      let key = rankBucketToggle.dataset.setupRankBucketToggle;
      expandedRatingBucket = expandedRatingBucket === key ? null : key;
      render();
      return;
    }

    let toggleTarget = event.target.closest("[data-setup-award-toggle]");
    if (toggleTarget) return toggleCategory(toggleTarget.dataset.setupAwardToggle);

    let poolExcludeTarget = event.target.closest("[data-setup-pool-exclude]");
    if (poolExcludeTarget) {
      let card = poolExcludeTarget.closest("[data-setup-award-film]");
      let category = card?.dataset.setupAwardAdd;
      let filmId = card?.dataset.setupAwardFilm;
      if (category && filmId) {
        if (!excludedFromPool.has(category))
          excludedFromPool.set(category, new Set());
        excludedFromPool.get(category).add(filmId);
        render();
      }
      return;
    }

    let poolRestoreTarget = event.target.closest("[data-setup-pool-restore]");
    if (poolRestoreTarget) {
      excludedFromPool.delete(poolRestoreTarget.dataset.setupPoolRestore);
      render();
      return;
    }

    let removeTarget = event.target.closest("[data-setup-award-remove]");
    if (removeTarget) {
      return removeNominee(
        removeTarget.dataset.setupAwardCategory,
        removeTarget.dataset.setupAwardFilmId,
        removeTarget.dataset.setupAwardPlacement,
      );
    }

    let creditEditTarget = event.target.closest("[data-setup-award-credit-edit]");
    if (creditEditTarget) {
      editingNominee = {
        category: creditEditTarget.dataset.setupAwardCategory,
        filmId: creditEditTarget.dataset.setupAwardFilmId,
        placement: creditEditTarget.dataset.setupAwardPlacement,
      };
      pendingNominee = null;
      render();
      return;
    }

    if (event.target.closest("[data-setup-award-credit-cancel]")) {
      pendingNominee = null;
      editingNominee = null;
      render();
      return;
    }

    let addTarget = event.target.closest("[data-setup-award-add]");
    if (addTarget && !event.target.closest("a")) {
      let category = addTarget.dataset.setupAwardAdd;
      beginNominee(category, addTarget.dataset.setupAwardFilm, nextOpenPlacement(category));
    }
  });

  container.addEventListener("submit", (event) => {
    let form = event.target.closest("[data-setup-award-credit-form]");
    if (!form) return;
    event.preventDefault();
    let category = form.dataset.setupAwardCategory;
    let filmId = form.dataset.setupAwardFilmId;
    let placement = Number(form.dataset.setupAwardPlacement);
    let recipient = form.querySelector('[name="recipient"]')?.value || "";
    let detailInput = form.querySelector('[name="detail"]');
    let detail = detailInput ? detailInput.value : undefined;
    if (form.dataset.setupAwardMode === "edit")
      saveNomineeCredit(category, filmId, placement, recipient, detail);
    else addNominee(category, filmId, placement, recipient, detail || "");
  });

  // Drag-and-drop covers two independent kinds sharing one set of listeners
  // (mirroring how period.js branches its own shared listeners between
  // ranking/award/watchlist drag kinds): reordering a rating-tier ranking
  // card, and dropping a bracket pool card onto a nominee slot.
  let dragPayload = null;
  container.addEventListener("dragstart", (event) => {
    let rankCard = event.target.closest("[data-setup-rank-film-id]");
    let awardCard = !rankCard && event.target.closest("[data-setup-award-film]");
    let card = rankCard || awardCard;
    if (!card) return;
    dragPayload = rankCard
      ? {
          kind: "rank",
          filmId: rankCard.dataset.setupRankFilmId,
          index: Number(rankCard.dataset.setupRankIndex),
        }
      : { kind: "award", filmId: awardCard.dataset.setupAwardFilm };
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  container.addEventListener("dragend", (event) => {
    (
      event.target.closest("[data-setup-rank-film-id]") ||
      event.target.closest("[data-setup-award-film]")
    )?.classList.remove("dragging");
    dragPayload = null;
  });
  container.addEventListener("dragover", (event) => {
    let target =
      dragPayload?.kind === "rank"
        ? event.target.closest("[data-setup-rank-film-id]")
        : dragPayload?.kind === "award"
          ? event.target.closest("[data-setup-award-target]")
          : null;
    if (!target) return;
    event.preventDefault();
    target.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    (
      event.target.closest("[data-setup-rank-film-id]") ||
      event.target.closest("[data-setup-award-target]")
    )?.classList.remove("drop-target");
  });
  container.addEventListener("drop", (event) => {
    if (dragPayload?.kind === "rank") {
      let target = event.target.closest("[data-setup-rank-film-id]");
      if (!target || target.dataset.setupRankFilmId === dragPayload.filmId)
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
      return;
    }
    if (dragPayload?.kind !== "award") return;
    let target = event.target.closest("[data-setup-award-target]");
    if (!target) return;
    event.preventDefault();
    target.classList.remove("drop-target");
    let category = target.closest("[data-setup-award-board]")?.dataset.setupAwardBoard;
    if (!category) return;
    beginNominee(category, dragPayload.filmId, Number(target.dataset.setupAwardTarget));
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
