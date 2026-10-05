/** @file Renders the Supabase-backed owner-only Build your Oskars journey hub and visual year map. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("buildPage");
  let journeyYears = [];

  function stageLabel(stage) {
    return ui(
      {
        rating: "Needs ratings",
        ranking: "Ready to rank",
        awards: "Build the ceremony",
        complete: "Year complete",
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
          <div class="build-stage-step ${rateDone ? "is-complete" : year.stage === "rating" ? "is-active" : ""}">
            <span class="build-stage-step-marker">${rateDone ? "✓" : "1"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Rate"))}</span>
              <small class="build-stage-step-metric">${rateMetric}</small>
            </span>
          </div>
          <div class="build-stage-connector ${rateDone ? "is-complete" : ""}"></div>
          <div class="build-stage-step ${rankDone ? "is-complete" : year.stage === "ranking" ? "is-active" : ""}">
            <span class="build-stage-step-marker">${rankDone ? "✓" : "2"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Rank"))}</span>
              <small class="build-stage-step-metric">${rankMetric}</small>
            </span>
          </div>
          <div class="build-stage-connector ${rankDone ? "is-complete" : ""}"></div>
          <div class="build-stage-step ${awardDone ? "is-complete" : year.stage === "awards" ? "is-active" : ""}">
            <span class="build-stage-step-marker">${awardDone ? "✓" : "3"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Ceremony"))}</span>
              <small class="build-stage-step-metric">${awardMetric}</small>
            </span>
          </div>
          <div class="build-stage-connector ${awardDone ? "is-complete" : ""}"></div>
          <div class="build-stage-step ${isComplete ? "is-complete is-active" : ""}">
            <span class="build-stage-step-marker">${isComplete ? "★" : "4"}</span>
            <span class="build-stage-step-text">
              <span class="build-stage-step-name">${escape(ui("Done"))}</span>
            </span>
          </div>
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
    let visible =
      stage === "all" ? years : years.filter((year) => year.stage === stage);
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
      ["awards", ui("Ceremonies")],
      ["complete", ui("Complete")],
    ]
      .map(
        ([value, label]) =>
          `<a href="${escape(filterUrl(value))}"${stage === value ? ' class="active" aria-current="page"' : ""}>${escape(label)}<span>${escape(value === "all" ? years.length : years.filter((year) => year.stage === value).length)}</span></a>`,
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
      <section><div class="build-year-grid">${visible.map((year, index) => yearCard(year, index)).join("") || `<p class="detail-empty">${escape(ui("No years at this stage."))}</p>`}</div></section>`;
    finish?.(
      `${years.length} years, ${visible.length} shown, ${recommendation?.year || "complete"}`,
    );
  }

  container.addEventListener("click", (event) => {
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
      journeyYears = window.buildJourneyYears(
        workspace.watched,
        ranking
          .filter((scope) => scope.scope_type === "years")
          .flatMap((scope) => scope.ranking_entries),
        awardReviews,
        window.getOrderedCategories?.() || [],
      );
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load your journey"))}</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
