/** @file Builds one year's Oskars ballot category by category and hands the completed ceremony into presentation. */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();

  let container = document.getElementById("awardsYearPage");
  let year = String(window.pageQueryParam?.("year") || "").trim();
  let valid = /^\d{4}$/.test(year);

  if (!valid) {
    document.title = `${ui("Build annual awards")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Year not found"))}</h1><a href="index.html">${escape(ui("Return home"))}</a></div>`;
    return;
  }

  document.title = `${ui("Build {year} awards", { year })} · The Oskars`;

  function yearFilms() {
    return [...(window.state.years?.alltime?.films || [])].filter(
      (film) =>
        String(window.filmConcreteYear?.(film.year) || film.year || "") ===
        year,
    );
  }

  // ---- Bracket state ----
  let expandedCategory; // undefined opens the next unfinished ballot category.
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
    let detailField = window.creditDetailFieldHtml(category, detail, {
      escape,
      ui,
    });
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
    let review = window.annualAwardReview(year, category);
    let capacities = window.bracketCapacities("years");
    let capacity =
      category === "Best Picture" ? capacities.picture : capacities.category;
    let isExpanded = expandedCategory === category;
    let statusClass = review ? "is-full" : nominees.length ? "is-started" : "is-empty";
    let toggleLabel = isExpanded ? ui("Collapse") : review ? ui("Review") : ui("Fill");
    let header = `<div class="setup-year-category-header">
      <a class="category-link" href="${escape(window.categoryPageUrl(category))}">${escape(window.localizedCategoryName?.(category) || category)}</a>
      <span class="setup-year-category-progress ${statusClass}">${review?.status === "none" ? escape(ui("None")) : `${escape(nominees.length)}/${escape(capacity)}`}</span>
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
      <div class="setup-ballot-actions">${nominees.length ? `<button type="button" data-setup-award-finish="${escape(category)}">${escape(ui("Finish category"))}</button>` : `<button type="button" class="button-secondary" data-setup-award-none="${escape(category)}">${escape(ui("No award this year"))}</button>`}</div>
    </div>`;
  }

  function renderBracketSection() {
    let films = yearFilms();
    let progress = window.annualAwardReviewProgress(year);
    if (expandedCategory === undefined)
      expandedCategory = progress.nextCategory || null;
    let rows = progress.categories
      .map((entry) => entry.category)
      .map((category) => renderCategoryRow(category, films))
      .join("");
    let nav = progress.categories.map((entry) => {
      let label = window.localizedCategoryName?.(entry.category) || entry.category;
      let percent = entry.reviewed ? 100 : entry.nominees.length ? 50 : 0;
      return `<button type="button" class="setup-ballot-nav-item${entry.reviewed ? " is-complete" : ""}${entry.category === progress.nextCategory ? " is-next" : ""}" style="--ballot-progress:${percent}%" data-setup-award-toggle="${escape(entry.category)}"><span>${entry.reviewed ? "✓" : escape(entry.nominees.length)}</span><b>${escape(label)}</b></button>`;
    }).join("");
    let ceremony = progress.complete
      ? `<section class="setup-ceremony-summary"><span class="eyebrow">${escape(ui("The envelope is sealed"))}</span><h3>${escape(ui("Your {year} ceremony is ready", { year }))}</h3><div class="setup-ceremony-winners">${progress.winners.slice(0, 8).map((entry) => window.renderFilmPoster(entry.film, "thumb")).join("")}</div><div class="setup-ballot-actions"><a class="button-link" href="presentation.html?scope=period&amp;id=year:${escape(year)}">${escape(ui("Run the ceremony"))} →</a><a class="button-link" href="${escape(window.periodPageUrl("decade", window.getDecadeKey(year)))}&amp;view=awards">${escape(ui("Continue to decade awards"))}</a></div></section>`
      : `<p class="setup-ballot-next">${escape(ui("Next: {category}", { category: window.localizedCategoryName?.(progress.nextCategory) || progress.nextCategory }))} · ${escape(progress.reviewed)} / ${escape(progress.total)} ${escape(ui("reviewed"))}</p>`;
    return `<nav class="setup-ballot-nav" aria-label="${escape(ui("Ballot categories"))}">${nav}</nav><div class="setup-year-category-list">${rows}</div>${ceremony}`;
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
    window.reopenAnnualAwardReview(year, category);
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
    window.reopenAnnualAwardReview(year, category);
    window.save?.({ immediate: true });
    render();
  }

  function toggleCategory(category) {
    expandedCategory = expandedCategory === category ? null : category;
    pendingNominee = null;
    editingNominee = null;
    render();
  }

  function render() {
    let finish = window.startOskarsPerformance?.("awardsYear:render");
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">${escape(ui("Annual awards"))}</span><h1>${escape(year)}</h1><p>${escape(ui("Build the ballot category by category, then run the ceremony."))}</p>`,
      actionsHtml: `<a class="button-link" href="build.html">${escape(ui("Build your Oskars"))}</a><a class="button-link" href="${escape(window.yearRankingPageUrl(year))}">${escape(ui("Rank this year"))}</a><a class="button-link" href="${escape(window.periodPageUrl("years", year))}">${escape(ui("View {year}", { year }))}</a>`,
    });
    container.innerHTML = `${header}
      <section class="setup-year-section">
        <h2>${escape(ui("Annual ballot"))}</h2>
        ${renderBracketSection()}
      </section>`;
    finish?.(`${year} · ${window.annualAwardReviewProgress(year).reviewed} reviewed`);
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
    let toggleTarget = event.target.closest("[data-setup-award-toggle]");
    if (toggleTarget) return toggleCategory(toggleTarget.dataset.setupAwardToggle);

    let finishTarget = event.target.closest("[data-setup-award-finish]");
    let noneTarget = event.target.closest("[data-setup-award-none]");
    if (finishTarget || noneTarget) {
      let category = (finishTarget || noneTarget).dataset.setupAwardFinish ||
        (finishTarget || noneTarget).dataset.setupAwardNone;
      window.setAnnualAwardReview(year, category, finishTarget ? "complete" : "none");
      expandedCategory = undefined;
      window.save?.({ immediate: true, rebuild: false });
      render();
      return;
    }

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

  let draggedFilmId = null;
  container.addEventListener("dragstart", (event) => {
    let card = event.target.closest("[data-setup-award-film]");
    if (!card) return;
    draggedFilmId = card.dataset.setupAwardFilm;
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  container.addEventListener("dragend", (event) => {
    event.target.closest("[data-setup-award-film]")?.classList.remove("dragging");
    draggedFilmId = null;
  });
  container.addEventListener("dragover", (event) => {
    let target = draggedFilmId
      ? event.target.closest("[data-setup-award-target]")
      : null;
    if (!target) return;
    event.preventDefault();
    target.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    event.target
      .closest("[data-setup-award-target]")
      ?.classList.remove("drop-target");
  });
  container.addEventListener("drop", (event) => {
    if (!draggedFilmId) return;
    let target = event.target.closest("[data-setup-award-target]");
    if (!target) return;
    event.preventDefault();
    target.classList.remove("drop-target");
    let category = target.closest("[data-setup-award-board]")?.dataset.setupAwardBoard;
    if (!category) return;
    beginNominee(category, draggedFilmId, Number(target.dataset.setupAwardTarget));
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
