/** @file Renders the Supabase-backed owner-only Build your Oskars journey hub, actionable inbox, and visual year map. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("buildPage");
  let journeyYears = [];
  let currentWorkspace = null;
  let currentRanking = [];
  let currentAwardReviews = [];
  let currentInbox = [];
  let dismissedCeremonyFilmIds = new Set();
  try {
    for (let key in localStorage) {
      if (key.startsWith("oskars-build-ceremony-dismissed:")) {
        dismissedCeremonyFilmIds.add(
          key.replace("oskars-build-ceremony-dismissed:", ""),
        );
      }
    }
  } catch (error) {}

  function updateJourneyState() {
    let categories = window.getOrderedCategories?.() || [];
    journeyYears = window.buildJourneyYears(
      currentWorkspace?.watched || [],
      currentRanking
        .filter((scope) => scope.scope_type === "years")
        .flatMap((scope) => scope.ranking_entries),
      currentAwardReviews,
      categories,
    );
    currentInbox = window.deriveBuildInbox(
      currentWorkspace?.watched || [],
      currentRanking
        .filter((scope) => scope.scope_type === "years")
        .flatMap((scope) => scope.ranking_entries),
      currentAwardReviews,
      categories,
      dismissedCeremonyFilmIds,
    );
  }

  // Director and franchise ceremonies load after the year map renders.
  /** @type {{loading?: boolean, model?: Object, error?: string}} */
  let collectionCeremonies = { loading: true };

  function stageLabel(stage) {
    return ui(
      {
        rating: "Needs ratings",
        ranking: "Ready to rank",
        awards: "Ready for ceremony",
        complete: "Complete",
      }[stage],
    );
  }

  function stageAction(year) {
    if (year.stage === "rating")
      return {
        href: `rate-watched.html?year=${encodeURIComponent(year.year)}`,
        label: ui("Rate this year"),
      };
    if (year.stage === "ranking")
      return {
        href: window.yearRankingPageUrl(year.year),
        label: ui("Rank this year"),
      };
    if (year.stage === "awards")
      return {
        href: window.yearAwardsPageUrl(year.year),
        label: ui("Build the ceremony"),
      };
    return {
      href: window.periodPageUrl("year", year.year),
      label: ui("View year"),
    };
  }

  // Rating and ranking are their own useful progress, not a prerequisite
  // for nominating - awards-year.js has never required either. The
  // "rating"/"ranking" stage badge and primary action above stay as a
  // suggested order, but a year with anything watched and any award slot
  // still open always keeps a direct way to start its ceremony, so a new
  // account isn't stuck grinding through a whole year's ratings first.
  function secondaryAwardsAction(year) {
    if (year.stage === "awards") {
      if (year.ratedCount < year.totalCount)
        return {
          href: `rate-watched.html?year=${encodeURIComponent(year.year)}`,
          label: ui("Rate this year"),
        };
      if (!year.rankingComplete)
        return {
          href: window.yearRankingPageUrl(year.year),
          label: ui("Rank this year"),
        };
      return null;
    }
    let needsPrompt = year.stage === "rating" || year.stage === "ranking";
    if (needsPrompt && year.totalCount > 0 && !year.awardComplete)
      return {
        href: window.yearAwardsPageUrl(year.year),
        label: ui("Build the ceremony"),
      };
    return null;
  }

  function yearCard(year, index = 0) {
    let action = stageAction(year);
    let secondary = secondaryAwardsAction(year);
    let priority = index < 3 ? "high" : undefined;
    let rateDone = year.ratedCount === year.totalCount;
    let rankDone = year.rankingComplete;
    let awardDone = year.awardComplete;
    let isComplete = year.stage === "complete";

    let rateMetric = `${escape(year.ratedCount)}/${escape(year.totalCount)}`;
    let rankMetric =
      year.rankingGroupCount === 0
        ? ui("None")
        : `${escape(year.reviewedRankingGroupCount)}/${escape(year.rankingGroupCount)}`;
    let awardMetric = `${escape(year.awardFilledSlots)}/${escape(year.awardTotalSlots)}`;

    return `<article class="build-year-card" data-build-year="${escape(year.year)}" data-build-stage="${escape(year.stage)}">
      <a class="build-year-card-visual" href="${escape(action.href)}" aria-label="${escape(`${action.label}: ${year.year}`)}">${window.renderPosterDeck(year.posterFilms, { priority })}</a>
      <div class="build-year-card-body">
        <div class="build-year-card-heading">
          <h2>${escape(year.year)}</h2>
          <span class="build-stage-pill build-stage-pill--${escape(year.stage)}">${escape(stageLabel(year.stage))}</span>
        </div>
        <div class="build-stage-banner" aria-label="${escape(ui("Stage progression for {year}", { year: year.year }))}">
          <a class="build-stage-step ${rateDone ? "is-complete" : year.stage === "rating" ? "is-active" : ""}" href="rate-watched.html?year=${encodeURIComponent(year.year)}" aria-label="${escape(ui("Rate {year}", { year: year.year }))}">
            <span class="build-stage-step-marker">${rateDone ? "✓" : "1"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Rate"))}</span>
              <small class="build-stage-step-metric">${rateMetric}</small>
            </span>
          </a>
          <a class="build-stage-step ${rankDone ? "is-complete" : year.stage === "ranking" ? "is-active" : ""}" href="${escape(window.yearRankingPageUrl(year.year))}" aria-label="${escape(ui("Rank {year}", { year: year.year }))}">
            <span class="build-stage-step-marker">${rankDone ? "✓" : "2"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Rank"))}</span>
              <small class="build-stage-step-metric">${rankMetric}</small>
            </span>
          </a>
          <a class="build-stage-step ${awardDone ? "is-complete" : year.stage === "awards" ? "is-active" : ""}" href="${escape(window.yearAwardsPageUrl(year.year))}" aria-label="${escape(ui("Ceremony for {year}", { year: year.year }))}">
            <span class="build-stage-step-marker">${awardDone ? "✓" : "3"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Ceremony"))}</span>
              <small class="build-stage-step-metric">${awardMetric}</small>
            </span>
          </a>
          <a class="build-stage-step ${isComplete ? "is-complete is-active" : ""}" href="${escape(window.periodPageUrl("year", year.year))}" aria-label="${escape(ui("View {year}", { year: year.year }))}">
            <span class="build-stage-step-marker">${isComplete ? "★" : "4"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Done"))}</span>
            </span>
          </a>
        </div>
        ${window.renderPeriodThresholdBadges ? window.renderPeriodThresholdBadges(year.thresholdStats || year.archiveFilms || [], { escape, ui, periodType: "year" }) : ""}
        ${year.otherFilms.length ? `<p class="build-year-note">${escape(ui("{count} rating-only standalone work(s)", { count: year.otherFilms.length }))}</p>` : ""}
        <div class="build-year-card-actions">
          <a class="button-link build-year-action" href="${escape(action.href)}">${escape(action.label)} →</a>
          ${secondary ? `<a class="build-year-action-secondary" href="${escape(secondary.href)}">${escape(secondary.label)} →</a>` : ""}
        </div>
      </div>
    </article>`;
  }

  function collectionCeremonyCard(ceremony, suggested) {
    let pill = suggested
      ? ["awards", ui("Ready for ceremony")]
      : ceremony.complete
        ? ["complete", ui("Complete")]
        : [
            "ranking",
            ui("{reviewed}/{total} categories", {
              reviewed: ceremony.reviewed,
              total: ceremony.total,
            }),
          ];
    let action = suggested
      ? ui("Hold ceremony")
      : ceremony.complete
        ? ui("View ceremony")
        : ui("Continue ceremony");
    return `<article class="build-collection-card" data-build-collection="${escape(ceremony.type)}">
      <a class="build-collection-card-visual" href="${escape(ceremony.href)}" aria-label="${escape(`${action}: ${ceremony.name}`)}">${window.renderPosterDeck(ceremony.films.slice(0, 5))}</a>
      <div class="build-collection-card-body">
        <span class="eyebrow">${escape(ui(ceremony.type === "director" ? "Director" : "Franchise"))}</span>
        <h3><a href="${escape(ceremony.href)}">${escape(ceremony.name)}</a></h3>
        <span class="build-stage-pill build-stage-pill--${pill[0]}">${escape(pill[1])}</span>
        <p>${escape(ui(ceremony.filmCount === 1 ? "{count} watched film" : "{count} watched films", { count: ceremony.filmCount }))}</p>
        <a class="build-year-action-secondary" href="${escape(ceremony.href)}">${escape(action)} →</a>
      </div>
    </article>`;
  }

  function collectionCeremoniesHtml() {
    let body;
    if (collectionCeremonies.loading)
      body = `<p role="status">${escape(ui("Loading collection ceremonies…"))}</p>`;
    else if (collectionCeremonies.error)
      body = `<p role="alert">${escape(ui("Could not load collection ceremonies."))} <button type="button" class="link-button" data-build-collections-retry>${escape(ui("Try again"))}</button></p>`;
    else {
      let { saved, suggested } = collectionCeremonies.model;
      if (!saved.length && !suggested.length) return "";
      body = `<div class="build-collection-grid">${saved.map((ceremony) => collectionCeremonyCard(ceremony, false)).join("")}${suggested.map((ceremony) => collectionCeremonyCard(ceremony, true)).join("")}</div>`;
    }
    return `<section class="build-collections" aria-labelledby="buildCollectionsHeading"><div class="build-section-heading"><h2 id="buildCollectionsHeading">${escape(ui("Collection ceremonies"))}</h2><p>${escape(ui("Director and franchise awards from your own watched films."))}</p></div>${body}</section>`;
  }

  function loadCollectionCeremonies() {
    collectionCeremonies = { loading: true };
    let finish = window.startOskarsPerformance?.("build:collections");
    window
      .loadSupabaseCollectionCeremonySource()
      .then((source) => {
        collectionCeremonies = {
          model: window.buildCollectionCeremonies(source, {
            categories: window.getOrderedCategories?.() || [],
          }),
        };
      })
      .catch((error) => {
        collectionCeremonies = { error: error.message || String(error) };
      })
      .then(() => {
        refreshCollectionCeremonies();
        let model = collectionCeremonies.model;
        finish?.(
          model
            ? `${model.saved.length} saved, ${model.suggested.length} suggested`
            : "failed",
        );
      });
  }

  // Updates only this section, so the year map isn't rendered twice.
  function refreshCollectionCeremonies() {
    let section = container.querySelector("[data-build-collections]");
    if (section) section.innerHTML = collectionCeremoniesHtml();
  }

  function filterUrl(stage) {
    return stage === "all" ? "build.html" : `build.html?stage=${stage}`;
  }

  function milestoneDismissed(id) {
    try {
      return (
        localStorage.getItem(`oskars-build-milestone:${id}`) === "dismissed"
      );
    } catch (error) {
      return false;
    }
  }

  function milestoneCopy(milestone) {
    if (milestone.type === "archive")
      return {
        eyebrow: ui("Archive milestone"),
        title: ui("Your Oskars are complete"),
        text: ui("Every watched year is rated, ranked, and celebrated."),
        href: "presentation.html",
        action: ui("Open the showcase"),
      };
    if (milestone.type === "decade")
      return {
        eyebrow: ui("Decade milestone"),
        title: ui("{scope} is complete", { scope: milestone.key }),
        text: ui(
          "Every watched year in this decade has completed its creative journey.",
        ),
        href: window.periodPageUrl("decade", milestone.key),
        action: ui("View the decade"),
      };
    if (milestone.type === "ceremony")
      return {
        eyebrow: ui("Ceremony complete"),
        title: ui("Your {year} ceremony is ready", { year: milestone.key }),
        text: ui("The ballot is sealed and ready to present."),
        href: `presentation.html?scope=period&id=year:${encodeURIComponent(milestone.key)}`,
        action: ui("Run the ceremony"),
      };
    if (milestone.type === "ranked")
      return {
        eyebrow: ui("Year ranked"),
        title: ui("{scope} has its order", { scope: milestone.key }),
        text: ui("The year's same-rating shelves are deliberately arranged."),
        href: window.yearAwardsPageUrl(milestone.key),
        action: ui("Build the ceremony"),
      };
    return {
      eyebrow: ui("Year rated"),
      title: ui("{scope} is rated", { scope: milestone.key }),
      text: ui("Every watched work from the year now has your grade."),
      href: window.yearRankingPageUrl(milestone.key),
      action: ui("Rank this year"),
    };
  }

  function renderMilestone(milestone) {
    if (!milestone || milestoneDismissed(milestone.id)) return "";
    let copy = milestoneCopy(milestone);
    return `<aside class="build-milestone" data-build-milestone="${escape(milestone.id)}"><button type="button" class="build-milestone-dismiss" data-build-milestone-dismiss aria-label="${escape(ui("Dismiss milestone"))}">×</button><div><span class="eyebrow">${escape(copy.eyebrow)}</span><h2>${escape(copy.title)}</h2><p>${escape(copy.text)}</p><a class="button-link" href="${escape(copy.href)}">${escape(copy.action)} →</a></div>${window.renderPosterDeck(milestone.posterFilms, { classes: "poster-deck--featured", priority: "high" })}</aside>`;
  }

  function renderInboxCard(item) {
    let film = item.film || {};
    let year = item.year;
    let isRate = item.type === "rate";
    let isRank = item.type === "rank";

    let pillClass = isRate
      ? "build-inbox-pill--unrated"
      : isRank
        ? "build-inbox-pill--ranking"
        : "build-inbox-pill--awards";

    let pillLabel = isRate
      ? ui("Needs rating")
      : isRank
        ? ui("Slot into {year}", { year })
        : ui("Ceremony candidate");

    let ratingDisplay = item.watched.rating
      ? window.renderFilmRating?.({
          ratingValue: item.watched.rating,
          ratingModifier: item.watched.rating_modifier,
        }) || String(item.watched.rating)
      : "";

    let metaText = isRate
      ? `${escape(year)}${item.watched.date_watched ? ` · ${escape(item.watched.date_watched)}` : ""}`
      : `${escape(year)} · ${escape(ui("Rated"))} ${escape(ratingDisplay)}`;

    let primaryAction = isRate
      ? `<button type="button" class="button-link" data-inbox-rate="${escape(item.watched.id)}">${escape(ui("Rate"))}</button>`
      : isRank
        ? `<button type="button" class="button-link" data-inbox-rank="${escape(item.film.id)}" data-year="${escape(year)}">${escape(ui("Slot into ranking"))}</button>`
        : `<button type="button" class="button-link" data-inbox-awards="${escape(item.film.id)}" data-year="${escape(year)}">${escape(ui("Ceremony check"))}</button>`;

    let secondaryAction = isRate
      ? `<a class="build-year-action-secondary" href="rate-watched.html?year=${encodeURIComponent(year)}">${escape(ui("Rate year"))} →</a>`
      : isRank
        ? `<a class="build-year-action-secondary" href="${escape(window.yearRankingPageUrl(year))}">${escape(ui("Rank year"))} →</a>`
        : `<a class="build-year-action-secondary" href="${escape(window.yearAwardsPageUrl(year))}">${escape(ui("Ceremony"))} →</a>`;

    let posterHtml = film.poster_url
      ? `<img src="${escape(film.poster_url)}" alt="" class="build-inbox-card-thumb" loading="lazy" decoding="async">`
      : `<div class="build-inbox-card-thumb-placeholder" aria-hidden="true">★</div>`;

    return `<article class="build-inbox-card" data-inbox-film="${escape(item.film.id)}">
      ${posterHtml}
      <div class="build-inbox-card-info">
        <div class="build-inbox-card-title" title="${escape(film.title || "")}">${escape(film.title || ui("Untitled"))}</div>
        <div class="build-inbox-card-meta">${metaText}</div>
        <span class="build-inbox-pill ${pillClass}">${escape(pillLabel)}</span>
        <div class="build-inbox-card-actions">
          ${primaryAction}
          ${secondaryAction}
        </div>
      </div>
    </article>`;
  }

  function renderInboxHtml(inbox) {
    if (!inbox.length) {
      return `<section class="build-inbox" aria-label="${escape(ui("Recent watches inbox"))}">
        <div class="build-inbox-heading">
          <h2>${escape(ui("Recent watches"))}</h2>
          <span class="build-inbox-badge-done">${escape(ui("All caught up ✓"))}</span>
        </div>
        <p class="build-inbox-empty-note">${escape(ui("All logged watches are rated and arranged."))}</p>
      </section>`;
    }
    return `<section class="build-inbox" aria-label="${escape(ui("Recent watches inbox"))}">
      <div class="build-inbox-heading">
        <h2>${escape(ui("Recent watches"))}</h2>
        <span class="build-inbox-count">${escape(ui("{count} to review", { count: inbox.length }))}</span>
      </div>
      <div class="build-inbox-grid">
        ${inbox.slice(0, 8).map(renderInboxCard).join("")}
      </div>
      ${inbox.length > 8 ? `<p class="build-inbox-empty-note" style="margin-top:10px;"><a href="rate-watched.html">${escape(ui("View all {count} unrated films →", { count: inbox.length }))}</a></p>` : ""}
    </section>`;
  }

  function openRateModal(watchedId) {
    let watchedRow = currentWorkspace?.watched?.find((r) => r.id === watchedId);
    if (!watchedRow) return;
    let film = watchedRow.films || {};
    let dialog = document.createElement("dialog");
    dialog.className = "quick-add-dialog build-action-dialog";
    dialog.innerHTML = `<div class="quick-add-panel">
      <div class="quick-add-header">
        <h3>${escape(ui("Rate {title}", { title: film.title || ui("film") }))}${film.year ? ` (${escape(film.year)})` : ""}</h3>
        <button type="button" class="quick-add-close" data-dialog-close aria-label="${escape(ui("Close"))}">✕</button>
      </div>
      <form class="data-form" data-inbox-rate-form>
        <label class="data-field">
          ${escape(ui("Rating"))}
          ${window.renderRatingInput({ name: "rating", required: true, compact: false })}
        </label>
        <div class="quick-add-submit-row">
          <button type="submit" class="quick-add-submit-btn">${escape(ui("Save rating"))}</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(dialog);
    window.enhanceRatingInputs?.(dialog);
    dialog.showModal();

    dialog
      .querySelector("[data-dialog-close]")
      .addEventListener("click", () => {
        dialog.close();
        dialog.remove();
      });
    dialog.addEventListener("cancel", () => dialog.remove());

    let form = /** @type {HTMLFormElement} */ (
      dialog.querySelector("[data-inbox-rate-form]")
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        let parsed = window.parseFilmRating(new FormData(form).get("rating"));
        if (!parsed.value)
          throw new Error(ui("Choose a rating before saving."));
        await window.setSupabaseWatchedRating(
          watchedRow.id,
          parsed.value,
          parsed.modifier,
        );
        watchedRow.rating = parsed.value;
        watchedRow.rating_modifier = parsed.modifier;
        updateJourneyState();
        render();
        window.showOskarsToast?.(
          ui("Saved rating for {title}", { title: film.title || "" }),
        );
        dialog.close();
        dialog.remove();
      } catch (err) {
        submitBtn.disabled = false;
        alert(err.message || String(err));
      }
    });
  }

  async function openRankInsertionModal(filmId, year) {
    let watchedRow = currentWorkspace?.watched?.find(
      (r) => r.film_id === filmId,
    );
    if (!watchedRow) return;
    let film = watchedRow.films || {};
    let yearScope = String(year);
    let stored = currentRanking.find(
      (s) => s.scope_type === "years" && String(s.scope_value) === yearScope,
    );
    let rankingData = stored
      ? { rankingId: stored.id, entries: stored.ranking_entries }
      : await window.loadSupabaseRanking(yearScope, "years");

    let candidates = window.supabaseIntakeRankingCandidates(
      { watched: watchedRow },
      rankingData.entries,
      currentWorkspace?.watched,
      "year",
    );
    let gaps = window.supabaseIntakeRankingGaps(candidates, null);

    let dialog = document.createElement("dialog");
    dialog.className = "quick-add-dialog build-action-dialog";

    let candidateById = new Map(candidates.map((c) => [c.film_id, c]));
    let optionsHtml = gaps
      .map((gap) => {
        if (!gap.targetFilmId)
          return `<option value="|after">${escape(ui("First film at this rating"))}</option>`;
        let target = candidateById.get(gap.targetFilmId)?.films || {};
        return `<option value="${escape(`${gap.targetFilmId}|${gap.position}`)}">${escape(gap.position === "before" ? ui("Before") : ui("After"))} ${escape(target.title || ui("comparison film"))}</option>`;
      })
      .join("");

    let comparisonStrip = candidates.length
      ? `<div class="intake-comparison-strip" style="display:flex;gap:8px;overflow-x:auto;padding:8px 0;margin-bottom:12px;">${candidates
          .map(
            (
              c,
            ) => `<article class="film-card intake-ranking-card" style="width:70px;text-align:center;">
            ${c.films?.poster_url ? `<img src="${escape(c.films.poster_url)}" alt="" style="width:60px;height:90px;object-fit:cover;border-radius:4px;" loading="lazy">` : ""}
            <span style="font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escape(c.films?.title || "")}</span>
          </article>`,
          )
          .join("")}</div>`
      : `<p class="data-panel-status" style="margin-bottom:12px;">${escape(ui("No other films in {year} share this rating. Slot directly into ranking order.", { year }))}</p>`;

    dialog.innerHTML = `<div class="quick-add-panel">
      <div class="quick-add-header">
        <h3>${escape(ui("Slot {title} into {year} ranking", { title: film.title || ui("film"), year }))}</h3>
        <button type="button" class="quick-add-close" data-dialog-close aria-label="${escape(ui("Close"))}">✕</button>
      </div>
      <form class="data-form" data-inbox-rank-form>
        ${comparisonStrip}
        ${candidates.length ? `<label class="data-field">${escape(ui("Placement"))}<select name="placement">${optionsHtml}</select></label>` : ""}
        <div class="quick-add-submit-row">
          <button type="submit" class="quick-add-submit-btn">${escape(ui("Insert into ranking"))}</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(dialog);
    dialog.showModal();

    dialog
      .querySelector("[data-dialog-close]")
      .addEventListener("click", () => {
        dialog.close();
        dialog.remove();
      });
    dialog.addEventListener("cancel", () => dialog.remove());

    let form = /** @type {HTMLFormElement} */ (
      dialog.querySelector("[data-inbox-rank-form]")
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        let placementTargetFilmId = null;
        let placementPosition = "after";
        if (candidates.length) {
          let [targetId, pos] = String(
            new FormData(form).get("placement") || "",
          ).split("|");
          placementTargetFilmId = targetId || null;
          placementPosition = pos || "after";
        } else {
          let watchedByFilm = new Map(
            (currentWorkspace?.watched || []).map((r) => [r.film_id, r]),
          );
          let targetGrade = window.supabaseIntakeRatingGrade(watchedRow);
          let firstLower = rankingData.entries.find(
            (entry) =>
              window.supabaseIntakeRatingGrade(
                watchedByFilm.get(entry.film_id),
              ) < targetGrade,
          );
          if (firstLower) {
            placementTargetFilmId = firstLower.film_id;
            placementPosition = "before";
          } else if (rankingData.entries.length) {
            placementTargetFilmId =
              rankingData.entries[rankingData.entries.length - 1].film_id;
            placementPosition = "after";
          }
        }
        let newPos = await window.placeSupabaseIntakeRankingFilm(
          rankingData.rankingId,
          rankingData.entries,
          filmId,
          placementTargetFilmId,
          placementPosition,
        );
        let existingEntry = rankingData.entries.find(
          (entry) => entry.film_id === filmId,
        );
        if (existingEntry) {
          existingEntry.position = newPos;
          existingEntry.rank_confirmed = true;
        } else {
          let createdEntry = {
            film_id: filmId,
            position: newPos,
            rank_confirmed: true,
            ranking_id: rankingData.rankingId,
            films: film,
          };
          rankingData.entries.push(createdEntry);
          if (!stored) {
            currentRanking.push({
              id: rankingData.rankingId,
              scope_type: "years",
              scope_value: yearScope,
              ranking_entries: rankingData.entries,
            });
          }
        }
        updateJourneyState();
        render();
        window.showOskarsToast?.(
          ui("Placed {title} into {year} ranking", {
            title: film.title || "",
            year,
          }),
        );
        dialog.close();
        dialog.remove();
      } catch (err) {
        submitBtn.disabled = false;
        alert(err.message || String(err));
      }
    });
  }

  async function openAwardsModal(filmId, year) {
    let watchedRow = currentWorkspace?.watched?.find(
      (r) => r.film_id === filmId,
    );
    if (!watchedRow) return;
    let film = watchedRow.films || {};
    let categories = window.getOrderedCategories?.() || ["Best Picture"];

    let dialog = document.createElement("dialog");
    dialog.className = "quick-add-dialog build-action-dialog";

    let categoryOptions = categories
      .map((cat) => `<option value="${escape(cat)}">${escape(cat)}</option>`)
      .join("");

    dialog.innerHTML = `<div class="quick-add-panel">
      <div class="quick-add-header">
        <h3>${escape(ui("Ceremony check: {title}", { title: film.title || ui("film") }))}</h3>
        <button type="button" class="quick-add-close" data-dialog-close aria-label="${escape(ui("Close"))}">✕</button>
      </div>
      <form class="data-form" data-inbox-award-form>
        <label class="data-field">
          ${escape(ui("Category"))}
          <select name="category">${categoryOptions}</select>
        </label>
        <label class="data-field">
          ${escape(ui("Placement"))}
          <select name="placement">
            <option value="1">1 (Winner)</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5" selected>5</option>
          </select>
        </label>
        <label class="data-field">
          ${escape(ui("Recipient(s)"))}
          <input name="recipients" placeholder="${escape(ui("Comma-separated (optional)"))}">
        </label>
        <label class="data-field">
          ${escape(ui("Detail"))}
          <input name="detail" placeholder="${escape(ui("Optional note"))}">
        </label>
        <div class="quick-add-submit-row" style="display:flex;gap:10px;justify-content:flex-end;">
          <button type="button" class="button-link" data-inbox-award-skip>${escape(ui("No nominations needed"))}</button>
          <button type="submit" class="quick-add-submit-btn">${escape(ui("Nominate"))}</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(dialog);
    dialog.showModal();

    dialog
      .querySelector("[data-dialog-close]")
      .addEventListener("click", () => {
        dialog.close();
        dialog.remove();
      });
    dialog.addEventListener("cancel", () => dialog.remove());

    dialog
      .querySelector("[data-inbox-award-skip]")
      .addEventListener("click", () => {
        dismissedCeremonyFilmIds.add(filmId);
        try {
          localStorage.setItem(
            `oskars-build-ceremony-dismissed:${filmId}`,
            "1",
          );
        } catch (error) {}
        updateJourneyState();
        render();
        window.showOskarsToast?.(
          ui("Marked {title} as reviewed for ceremony", {
            title: film.title || "",
          }),
        );
        dialog.close();
        dialog.remove();
      });

    let form = /** @type {HTMLFormElement} */ (
      dialog.querySelector("[data-inbox-award-form]")
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      let submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        let data = new FormData(form);
        let category = String(data.get("category"));
        let placement = Number(data.get("placement")) || 1;
        let detail = String(data.get("detail") || "").trim();
        let recipients = String(data.get("recipients") || "")
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean);

        let loaded = await window.loadSupabasePersonalNominations(
          String(year),
          category,
          "years",
        );
        await window.insertSupabasePersonalNomination(
          loaded.personalAwardId,
          category,
          placement,
          category === "Best Picture" ? 10 : 5,
          filmId,
          detail,
          recipients,
        );
        dismissedCeremonyFilmIds.add(filmId);
        try {
          localStorage.setItem(
            `oskars-build-ceremony-dismissed:${filmId}`,
            "1",
          );
        } catch (error) {}
        updateJourneyState();
        render();
        window.showOskarsToast?.(
          ui("Nominated {title} for {category}", {
            title: film.title || "",
            category,
          }),
        );
        dialog.close();
        dialog.remove();
      } catch (err) {
        submitBtn.disabled = false;
        alert(err.message || String(err));
      }
    });
  }

  function render() {
    let finish = window.startOskarsPerformance?.("build:render");
    let years = journeyYears;
    let recommendation = window.buildJourneyRecommendation(years);
    let milestone = window.buildJourneyMilestone(years);
    let requestedStage = window.pageQueryParam("stage");
    let stage = ["rating", "ranking", "awards", "complete"].includes(
      requestedStage,
    )
      ? requestedStage
      : "all";
    function matchesStageFilter(item, filterStage) {
      if (filterStage === "all") return true;
      if (filterStage === "rating") return item.ratedCount < item.totalCount;
      if (filterStage === "ranking")
        return item.rankingGroupCount > 0 && !item.rankingComplete;
      if (filterStage === "awards")
        return item.totalCount > 0 && !item.awardComplete;
      if (filterStage === "complete") return item.stage === "complete";
      return item.stage === filterStage;
    }

    let visible =
      stage === "all"
        ? years
        : years.filter((item) => matchesStageFilter(item, stage));
    let totals = years.reduce(
      (summary, year) => {
        summary.watched += year.totalCount;
        summary.rated += year.ratedCount;
        summary.rankingGroups += year.rankingGroupCount;
        summary.reviewedGroups += year.reviewedRankingGroupCount;
        summary.awardSlots += year.awardTotalSlots;
        summary.filledSlots += year.awardFilledSlots;
        if (year.stage === "complete") summary.completeYears += 1;
        return summary;
      },
      {
        watched: 0,
        rated: 0,
        rankingGroups: 0,
        reviewedGroups: 0,
        awardSlots: 0,
        filledSlots: 0,
        completeYears: 0,
      },
    );
    let filters = [
      ["all", ui("All years")],
      ["rating", ui("Needs ratings")],
      ["ranking", ui("Ready to rank")],
      ["awards", ui("Ready for ceremony")],
      ["complete", ui("Complete")],
    ]
      .map(
        ([value, label]) =>
          `<a href="${escape(filterUrl(value))}"${stage === value ? ' class="active" aria-current="page"' : ""}>${escape(label)}<span>${escape(value === "all" ? years.length : years.filter((item) => matchesStageFilter(item, value)).length)}</span></a>`,
      )
      .join("");
    let recommendationAction = recommendation && stageAction(recommendation);
    let recommendationSecondary =
      recommendation && secondaryAwardsAction(recommendation);
    document.title = `${ui("Build your Oskars")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ classes: "build-hero", mainHtml: `<span class="eyebrow">${escape(ui("Your film journey"))}</span><h1>${escape(ui("Build your Oskars"))}</h1><p>${escape(ui("Rate, rank, and celebrate your watched history one release year at a time."))}</p>` })}
      <section class="build-control-panel" aria-label="${escape(ui("Journey overview and filters"))}">
        <div class="build-overview" aria-label="${escape(ui("Journey progress"))}">
          <div title="${escape(ui("Watched films that have been given a rating"))}">
            <strong>${escape(totals.watched > 0 ? `${totals.rated} / ${totals.watched}` : totals.rated)}</strong>
            <span>${escape(ui("films rated"))}</span>
          </div>
          <div title="${escape(totals.rankingGroups > 0 ? ui("Groups of films with tied ratings placed in order") : ui("No tied ratings need arranging into ranking order yet."))}">
            <strong>${escape(totals.rankingGroups > 0 ? `${totals.reviewedGroups} / ${totals.rankingGroups}` : "—")}</strong>
            <span>${escape(totals.rankingGroups > 0 ? ui("ranking groups arranged") : ui("Nothing to arrange yet"))}</span>
          </div>
          <div title="${escape(ui("Ceremony categories with winners and nominees chosen across all years"))}">
            <strong>${escape(totals.awardSlots > 0 ? `${totals.filledSlots} / ${totals.awardSlots}` : totals.filledSlots)}</strong>
            <span>${escape(ui("award categories reviewed"))}</span>
          </div>
          <div title="${escape(ui("Years where all films are rated, rankings are confirmed, and awards are reviewed"))}">
            <strong>${escape(totals.completeYears)} / ${escape(years.length)}</strong>
            <span>${escape(ui("years complete"))}</span>
          </div>
        </div>
        <nav class="build-stage-filters" aria-label="${escape(ui("Filter years by next stage"))}">${filters}</nav>
      </section>
      ${renderMilestone(milestone)}
      ${recommendation ? `<section class="build-continue-card"><div><span class="eyebrow">${escape(ui("Continue your journey"))}</span><h2>${escape(recommendation.year)}</h2><p>${escape(stageLabel(recommendation.stage))} · ${escape(recommendation.ratedCount)} / ${escape(recommendation.totalCount)} ${escape(ui("rated"))}</p><div class="build-year-card-actions"><a class="button-link" href="${escape(recommendationAction.href)}">${escape(recommendationAction.label)} →</a>${recommendationSecondary ? `<a class="build-year-action-secondary" href="${escape(recommendationSecondary.href)}">${escape(recommendationSecondary.label)} →</a>` : ""}</div></div>${window.renderPosterDeck(recommendation.posterFilms, { classes: "poster-deck--featured", priority: "high" })}</section>` : ""}
      ${renderInboxHtml(currentInbox)}
      <div data-build-collections>${collectionCeremoniesHtml()}</div>
      <section class="build-years" aria-labelledby="buildYearsHeading"><div class="build-section-heading"><h2 id="buildYearsHeading">${escape(ui("Annual ceremonies"))}</h2></div><div class="build-year-grid">${visible.map((year, index) => yearCard(year, index)).join("") || `<p class="detail-empty">${escape(ui("No years at this stage."))}</p>`}</div></section>`;
    finish?.(
      `${years.length} years, ${visible.length} shown, ${recommendation?.year || "complete"}`,
    );
  }

  container.addEventListener("click", (event) => {
    let rateBtn = event.target.closest("[data-inbox-rate]");
    if (rateBtn) {
      openRateModal(rateBtn.dataset.inboxRate);
      return;
    }
    let rankBtn = event.target.closest("[data-inbox-rank]");
    if (rankBtn) {
      openRankInsertionModal(rankBtn.dataset.inboxRank, rankBtn.dataset.year);
      return;
    }
    let awardsBtn = event.target.closest("[data-inbox-awards]");
    if (awardsBtn) {
      openAwardsModal(awardsBtn.dataset.inboxAwards, awardsBtn.dataset.year);
      return;
    }
    if (event.target.closest("[data-build-collections-retry]")) {
      loadCollectionCeremonies();
      refreshCollectionCeremonies();
      return;
    }
    let dismiss = event.target.closest("[data-build-milestone-dismiss]");
    if (!dismiss) return;
    let milestone = dismiss.closest("[data-build-milestone]");
    try {
      localStorage.setItem(
        `oskars-build-milestone:${milestone.dataset.buildMilestone}`,
        "dismissed",
      );
    } catch (error) {}
    render();
  });

  window.addEventListener?.("oskars:localechange", render);
  window.addEventListener?.("oskars:collectionchange", () => {
    boot();
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      let [workspace, ranking, awardReviews] = await Promise.all([
        window.loadSupabaseWorkspace({ parts: ["watched"] }),
        window.loadSupabaseStoredRankings(),
        window.loadSupabaseAwardReviews(),
      ]);
      currentWorkspace = workspace;
      currentRanking = ranking;
      currentAwardReviews = awardReviews;
      updateJourneyState();
      render();
      loadCollectionCeremonies();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load your journey"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
