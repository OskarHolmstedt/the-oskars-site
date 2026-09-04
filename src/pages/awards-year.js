/**
 * @file Builds one year's Oskars ballot category by category, cut over to
 * Supabase for real (issue #435), continuing #420/.../#432's pattern:
 * gate check -> loadSupabaseWorkspace() +
 * supabaseAnnualAwardReviewProgress(year) -> render -> each action calls
 * its supabase-workspace.js function directly.
 *
 * Deliberate, documented scope cut from the previous implementation this
 * replaces: category-specific eligibility rules (Best Animated Picture
 * requires animation medium, Best Original/Adapted Screenplay requires a
 * matching screenplay type, Best International Picture's US/UK warning,
 * Best Director's credited-recipient-matches-director check) are not
 * ported. films.medium/screenplay_type/adaptation_source columns do
 * exist (issue #406's field audit), but no real write path populates
 * them yet - find_or_create_film accepts them, but nothing in src/ calls
 * it with real values today, so every row's value would be null
 * regardless. Previously, unknown metadata already degraded
 * every one of these rules to a non-blocking warning, never a hard block
 * - dropping them here means every watched film is eligible for every
 * category, the same practical outcome as today's all-null data. Real
 * gap, not silently dropped - once a real import path populates these
 * columns, this page should read them back and restore the rules.
 *
 * Also drops tie support (two nominees sharing one placement) - confirmed
 * by reading the previous implementation in full that this page never sets
 * planNominationInsertion's `tie` option; that branch belongs to a
 * different page's tooling this cutover doesn't touch.
 *
 * insertSupabasePersonalNomination()/deleteSupabasePersonalNomination()
 * do the real work (atomic placement-bump-cascade / shift-up via a
 * Postgres RPC - see their migration), matching the previous implementation's
 * planNominationInsertion/applyNominationPlacementPlan bump-cascade
 * exactly, just server-side instead of a window.state clone-and-diff.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("awardsYearPage");
  let year = String(window.pageQueryParam?.("year") || "").trim();
  let valid = /^\d{4}$/.test(year);

  let personalAwardId = null;
  let progress = null; // supabaseAnnualAwardReviewProgress(year) result
  let watchedByFilmId = new Map();

  // ---- Bracket state (session-only) ----
  let expandedCategory;
  let pendingNominee = null; // { category, filmId, placement }
  let editingNominee = null; // { category, nominationId, placement }
  let excludedFromPool = new Map(); // category -> Set<filmId>

  let CAPACITIES = { picture: 10, category: 5 };

  function excludedFromPoolFor(category) {
    return excludedFromPool.get(category) || new Set();
  }

  function capacityFor(category) {
    return category === "Best Picture" ? CAPACITIES.picture : CAPACITIES.category;
  }

  function yearWatchedFilms() {
    let workspace = window.getSupabaseWorkspace();
    return (workspace?.watched || [])
      .filter((row) => String(row.films?.year) === year)
      .map((row) => row.films);
  }

  // The previous implementation pre-filled Best Director's recipient from the
  // film's own director credit. The session workspace cache doesn't carry
  // per-film credits (only watched/watchlist rows), and a per-nomination
  // query just for this convenience isn't worth it - dropped, the owner
  // types the name once same as any other category.
  function categoryDefaultRecipient() {
    return "";
  }

  function creditFieldsHtml(category, recipient, detail) {
    let detailField = window.creditDetailFieldHtml?.(category, detail, { escape }) || "";
    return `<label>Recipient(s)<input name="recipient" value="${escape(recipient || "")}"></label>${detailField}`;
  }

  function nominationRecipientText(nomination) {
    return (nomination.personal_nomination_recipients || [])
      .map((row) => row.recipient_name)
      .join(", ");
  }

  function renderCreditHtml(category, nomination) {
    let recipient = nominationRecipientText(nomination);
    let detail = nomination.detail || "";
    if (recipient && detail) return `${escape(recipient)} <span class="credit-divider">·</span> ${escape(detail)}`;
    return escape(recipient || detail);
  }

  function renderPoolCard(film, category) {
    return `<article class="film-card setup-year-pool-card" draggable="true" data-setup-award-film="${escape(film.id)}" data-setup-award-add="${escape(category)}" tabindex="0" role="button">
      ${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="" class="rate-watched-poster-thumb">` : ""}
      <span class="table-film-link">${escape(film.title)}</span>
      <button type="button" class="card-remove-button" title="Not a contender - hide from this pool" data-setup-pool-exclude></button>
    </article>`;
  }

  function renderNomineeRow(nomination, category) {
    let film = nomination.films || {};
    let rankBadge = `<span class="${window.placementEmoji?.[nomination.placement] ? "rank medal" : "rank numeric"}">${escape(window.pagePlacement?.(nomination.placement) ?? nomination.placement)}</span>`;
    let filmLink = `<span class="table-film-link">${escape(film.title || "Unknown film")}</span>`;
    let removeButton = `<button type="button" class="card-remove-button" title="Remove" data-setup-award-remove data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(film.id)}" data-setup-award-placement="${escape(nomination.placement)}"></button>`;
    let isEditing = editingNominee?.nominationId === nomination.id;
    if (isEditing) {
      return `<div class="card setup-year-nominee">
        ${rankBadge}
        <form class="setup-year-credit-form" data-setup-award-credit-form data-setup-award-mode="edit" data-setup-award-nomination-id="${escape(nomination.id)}">
          ${creditFieldsHtml(category, nominationRecipientText(nomination), nomination.detail || "")}
          <button type="submit">Save</button>
          <button type="button" data-setup-award-credit-cancel>Cancel</button>
        </form>
        ${filmLink}
        ${removeButton}
      </div>`;
    }
    let credit = renderCreditHtml(category, nomination);
    let creditControl =
      category === "Best Picture"
        ? ""
        : `<button type="button" class="setup-year-credit-edit" data-setup-award-credit-edit data-setup-award-nomination-id="${escape(nomination.id)}">${credit || "Add credit"}</button><span class="separator">—</span>`;
    return `<div class="card setup-year-nominee" data-setup-award-target="${escape(nomination.placement)}">
      ${rankBadge}
      ${creditControl}
      ${filmLink}
      ${removeButton}
    </div>`;
  }

  function renderCategoryRow(entry, films) {
    let category = entry.category;
    let nominations = entry.nominations;
    let review = entry.review;
    let capacity = capacityFor(category);
    let isExpanded = expandedCategory === category;
    let statusClass = review ? "is-full" : nominations.length ? "is-started" : "is-empty";
    let toggleLabel = isExpanded ? "Collapse" : review ? "Review" : "Fill";
    let header = `<div class="setup-year-category-header">
      <a class="category-link" href="${escape(window.categoryPageUrl?.(category) || "#")}">${escape(window.localizedCategoryName?.(category) || category)}</a>
      <span class="setup-year-category-progress ${statusClass}">${review?.status === "none" ? "None" : `${escape(nominations.length)}/${escape(capacity)}`}</span>
      <button type="button" class="sort-order-button" data-setup-award-toggle="${escape(category)}">${escape(toggleLabel)}</button>
    </div>`;
    if (!isExpanded) return `<div class="setup-year-category-row">${header}</div>`;

    let nomineeRowsHtml = nominations.map((nomination) => renderNomineeRow(nomination, category)).join("");
    let multiNominee = window.isMultiNomineeCategory?.(category);
    let nominatedIds = multiNominee ? new Set() : new Set(nominations.map((n) => n.film_id));
    let excludedIds = excludedFromPoolFor(category);
    let pool = films.filter(
      (film) => !nominatedIds.has(film.id) && !excludedIds.has(film.id),
    );
    let isPending = pendingNominee?.category === category;
    let poolHtml = isPending
      ? renderPendingNomineeForm(films)
      : pool.length
        ? `<div class="film-grid setup-year-pool-grid">${pool.map((film) => renderPoolCard(film, category)).join("")}</div>`
        : `<p class="setup-year-section-empty">No more of ${escape(year)}'s watched films are eligible for this category.</p>`;
    let fullNotice =
      nominations.length >= capacity
        ? `<p class="setup-year-category-full">${escape(window.localizedCategoryName?.(category) || category)} is full. Drop a film onto a nominee above to bump it in, or remove one first.</p>`
        : "";
    let restoreHtml = excludedIds.size
      ? `<button type="button" class="sort-order-button" data-setup-pool-restore="${escape(category)}">Show ${escape(excludedIds.size)} hidden</button>`
      : "";

    return `<div class="setup-year-category-row is-expanded">
      ${header}
      <div class="board full-width setup-year-board" data-setup-award-board="${escape(category)}">
        <div class="board-content">
          <div class="board-nominees">${nomineeRowsHtml || `<p class="setup-year-section-empty">No nominees yet.</p>`}</div>
        </div>
      </div>
      ${fullNotice}
      <h4>Eligible films from ${escape(year)} ${restoreHtml}</h4>
      ${poolHtml}
      <div class="setup-ballot-actions">${nominations.length ? `<button type="button" data-setup-award-finish="${escape(category)}">Finish category</button>` : `<button type="button" class="button-secondary" data-setup-award-none="${escape(category)}">No award this year</button>`}</div>
    </div>`;
  }

  function renderBracketSection() {
    let films = yearWatchedFilms();
    if (expandedCategory === undefined) expandedCategory = progress.nextCategory || null;
    let rows = progress.categories.map((entry) => renderCategoryRow(entry, films)).join("");
    let nav = progress.categories
      .map((entry) => {
        let label = window.localizedCategoryName?.(entry.category) || entry.category;
        let percent = entry.reviewed ? 100 : entry.nominations.length ? 50 : 0;
        return `<button type="button" class="setup-ballot-nav-item${entry.reviewed ? " is-complete" : ""}${entry.category === progress.nextCategory ? " is-next" : ""}" style="--ballot-progress:${percent}%" data-setup-award-toggle="${escape(entry.category)}"><span>${entry.reviewed ? "✓" : escape(entry.nominations.length)}</span><b>${escape(label)}</b></button>`;
      })
      .join("");
    let ceremony = progress.complete
      ? `<section class="setup-ceremony-summary"><span class="eyebrow">The envelope is sealed</span><h3>Your ${escape(year)} ceremony is ready</h3><div class="setup-ballot-actions"><a class="button-link" href="presentation.html?scope=period&amp;id=year:${escape(year)}">Run the ceremony →</a><a class="button-link" href="${escape(window.periodPageUrl?.("decade", window.getDecadeKey(year)) || "#")}&amp;view=awards">Continue to decade awards</a></div></section>`
      : `<p class="setup-ballot-next">Next: ${escape(window.localizedCategoryName?.(progress.nextCategory) || progress.nextCategory)} · ${escape(progress.reviewed)} / ${escape(progress.total)} reviewed</p>`;
    return `<nav class="setup-ballot-nav" aria-label="Ballot categories">${nav}</nav><div class="setup-year-category-list">${rows}</div>${ceremony}`;
  }

  function renderPendingNomineeForm(films) {
    let { category, filmId, placement } = pendingNominee;
    let film = films.find((candidate) => candidate.id === filmId);
    let defaultRecipient = film ? categoryDefaultRecipient(category, film) : "";
    return `<form class="setup-year-credit-form" data-setup-award-credit-form data-setup-award-mode="add" data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(filmId)}" data-setup-award-placement="${escape(placement)}">
      <p>Nominate ${escape(film?.title || filmId)} for ${escape(window.localizedCategoryName?.(category) || category)}</p>
      ${creditFieldsHtml(category, defaultRecipient, "")}
      <button type="submit">Add</button>
      <button type="button" data-setup-award-credit-cancel>Cancel</button>
    </form>`;
  }

  function beginNominee(category, filmId, placement) {
    if (category === "Best Picture") {
      addNominee(category, filmId, placement, "", "");
      return;
    }
    pendingNominee = { category, filmId, placement };
    editingNominee = null;
    render();
  }

  async function refreshProgress() {
    progress = await window.supabaseAnnualAwardReviewProgress(year);
    personalAwardId = progress.personalAwardId;
  }

  async function addNominee(category, filmId, placement, recipient, detail) {
    try {
      let recipients = recipient ? window.splitRecipientNames?.(recipient) || [recipient] : [];
      await window.insertSupabasePersonalNomination(
        personalAwardId,
        category,
        placement,
        capacityFor(category),
        filmId,
        detail || "",
        recipients,
      );
      await window.reopenSupabaseAwardReview(year, category);
      pendingNominee = null;
      await refreshProgress();
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  async function saveNomineeCredit(nominationId, recipient, detail) {
    try {
      let recipients = recipient ? window.splitRecipientNames?.(recipient) || [recipient] : [];
      await window.updateSupabaseNominationRecipients(nominationId, recipients);
      if (detail !== undefined) await window.updateSupabaseNominationDetail(nominationId, detail);
      editingNominee = null;
      await refreshProgress();
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  function nextOpenPlacement(category) {
    let entry = progress.categories.find((candidate) => candidate.category === category);
    return Math.min((entry?.nominations.length || 0) + 1, capacityFor(category));
  }

  async function removeNominee(category, filmId, placement) {
    try {
      await window.deleteSupabasePersonalNomination(personalAwardId, category, Number(placement), filmId);
      await window.reopenSupabaseAwardReview(year, category);
      await refreshProgress();
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
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
      mainHtml: `<span class="eyebrow">Annual awards</span><h1>${escape(year)}</h1><p>Build the ballot category by category, then run the ceremony.</p>`,
      actionsHtml: `<a class="button-link" href="build.html">Build your Oskars</a><a class="button-link" href="${escape(window.yearRankingPageUrl?.(year) || "#")}">Rank this year</a><a class="button-link" href="${escape(window.periodPageUrl?.("years", year) || "#")}">View ${escape(year)}</a>`,
    });
    container.innerHTML = `${header}
      <section class="setup-year-section">
        <h2>Annual ballot</h2>
        ${renderBracketSection()}
      </section>`;
    finish?.(`${year} · ${progress.reviewed} reviewed`);
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
      let category =
        (finishTarget || noneTarget).dataset.setupAwardFinish ||
        (finishTarget || noneTarget).dataset.setupAwardNone;
      (async () => {
        try {
          await window.setSupabaseAwardReview(year, category, finishTarget ? "complete" : "none");
          expandedCategory = undefined;
          await refreshProgress();
          render();
        } catch (error) {
          alert(error.message || String(error));
        }
      })();
      return;
    }

    let poolExcludeTarget = event.target.closest("[data-setup-pool-exclude]");
    if (poolExcludeTarget) {
      let card = poolExcludeTarget.closest("[data-setup-award-film]");
      let category = card?.dataset.setupAwardAdd;
      let filmId = card?.dataset.setupAwardFilm;
      if (category && filmId) {
        if (!excludedFromPool.has(category)) excludedFromPool.set(category, new Set());
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
      removeNominee(
        removeTarget.dataset.setupAwardCategory,
        removeTarget.dataset.setupAwardFilmId,
        removeTarget.dataset.setupAwardPlacement,
      );
      return;
    }

    let creditEditTarget = event.target.closest("[data-setup-award-credit-edit]");
    if (creditEditTarget) {
      editingNominee = { nominationId: creditEditTarget.dataset.setupAwardNominationId };
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
    let recipient = form.querySelector('[name="recipient"]')?.value || "";
    let detailInput = form.querySelector('[name="detail"]');
    let detail = detailInput ? detailInput.value : undefined;
    if (form.dataset.setupAwardMode === "edit") {
      saveNomineeCredit(form.dataset.setupAwardNominationId, recipient, detail);
    } else {
      addNominee(
        form.dataset.setupAwardCategory,
        form.dataset.setupAwardFilmId,
        Number(form.dataset.setupAwardPlacement),
        recipient,
        detail || "",
      );
    }
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
    let target = draggedFilmId ? event.target.closest("[data-setup-award-target]") : null;
    if (!target) return;
    event.preventDefault();
    target.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    event.target.closest("[data-setup-award-target]")?.classList.remove("drop-target");
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

  async function boot() {
    if (!valid) {
      document.title = "Build annual awards · The Oskars";
      container.innerHTML = `<div class="detail-empty"><h1>Year not found</h1><a href="index.html">Return home</a></div>`;
      return;
    }
    document.title = `Build ${year} awards · The Oskars`;
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      await window.loadSupabaseWorkspace();
      await refreshProgress();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load this year's ballot</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
