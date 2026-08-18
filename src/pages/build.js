/** @file Renders the owner-only Build your Oskars journey hub and visual year map. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("buildPage");
  window.load();

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

  function meter(label, done, total, complete) {
    let value = total ? Math.round((done / total) * 100) : complete ? 100 : 0;
    return `<div class="build-stage-meter${complete ? " is-complete" : ""}"><span><b>${escape(label)}</b><small>${escape(done)} / ${escape(total)}</small></span><progress value="${escape(value)}" max="100"></progress></div>`;
  }

  function yearCard(year) {
    let action = stageAction(year);
    let rankingTotal = year.rankingGroupCount;
    return `<article class="build-year-card" data-build-year="${escape(year.year)}" data-build-stage="${escape(year.stage)}">
      <a class="build-year-card-visual" href="${escape(action.href)}" aria-label="${escape(`${action.label}: ${year.year}`)}">${window.renderPosterDeck(year.posterFilms)}</a>
      <div class="build-year-card-body"><div class="build-year-card-heading"><h2>${escape(year.year)}</h2><span class="build-stage-pill build-stage-pill--${escape(year.stage)}">${escape(stageLabel(year.stage))}</span></div>
      <div class="build-year-meters">
        ${meter(ui("Rated"), year.ratedCount, year.totalCount, year.ratingPercent === 100)}
        ${meter(ui("Ranking groups"), year.reviewedRankingGroupCount, rankingTotal, year.rankingComplete)}
        ${meter(ui("Award categories"), year.awardFilledSlots, year.awardTotalSlots, year.awardComplete)}
      </div>
      ${year.otherFilms.length ? `<p class="build-year-note">${escape(ui("{count} rating-only standalone work(s)", { count: year.otherFilms.length }))}</p>` : ""}
      <a class="button-link build-year-action" href="${escape(action.href)}">${escape(action.label)} →</a></div>
    </article>`;
  }

  function filterUrl(stage) {
    return stage === "all" ? "build.html" : `build.html?stage=${stage}`;
  }

  function milestoneDismissed(id) {
    try {
      return localStorage.getItem(`oskars-build-milestone:${id}`) === "dismissed";
    } catch (error) {
      return false;
    }
  }

  function milestoneCopy(milestone) {
    if (milestone.type === "archive")
      return { eyebrow: ui("Archive milestone"), title: ui("Your Oskars are complete"), text: ui("Every watched year is rated, ranked, and celebrated."), href: "presentation.html", action: ui("Open the showcase") };
    if (milestone.type === "decade")
      return { eyebrow: ui("Decade milestone"), title: ui("{scope} is complete", { scope: milestone.key }), text: ui("Every watched year in this decade has completed its creative journey."), href: window.periodPageUrl("decade", milestone.key), action: ui("View the decade") };
    if (milestone.type === "ceremony")
      return { eyebrow: ui("Ceremony complete"), title: ui("Your {year} ceremony is ready", { year: milestone.key }), text: ui("The ballot is sealed and ready to present."), href: `presentation.html?scope=period&id=year:${encodeURIComponent(milestone.key)}`, action: ui("Run the ceremony") };
    if (milestone.type === "ranked")
      return { eyebrow: ui("Year ranked"), title: ui("{scope} has its order", { scope: milestone.key }), text: ui("The year's same-rating shelves are deliberately arranged."), href: window.yearAwardsPageUrl(milestone.key), action: ui("Build the ceremony") };
    return { eyebrow: ui("Year rated"), title: ui("{scope} is rated", { scope: milestone.key }), text: ui("Every watched work from the year now has your grade."), href: window.yearRankingPageUrl(milestone.key), action: ui("Rank this year") };
  }

  function renderMilestone(milestone) {
    if (!milestone || milestoneDismissed(milestone.id)) return "";
    let copy = milestoneCopy(milestone);
    return `<aside class="build-milestone" data-build-milestone="${escape(milestone.id)}"><button type="button" class="build-milestone-dismiss" data-build-milestone-dismiss aria-label="${escape(ui("Dismiss milestone"))}">×</button><div><span class="eyebrow">${escape(copy.eyebrow)}</span><h2>${escape(copy.title)}</h2><p>${escape(copy.text)}</p><a class="button-link" href="${escape(copy.href)}">${escape(copy.action)} →</a></div>${window.renderPosterDeck(milestone.posterFilms, { classes: "poster-deck--featured" })}</aside>`;
  }

  function render() {
    let finish = window.startOskarsPerformance?.("build:render");
    let years = window.buildJourneyYears();
    let recommendation = window.buildJourneyRecommendation(years);
    let milestone = window.buildJourneyMilestone(years);
    let requestedStage = window.pageQueryParam("stage");
    let stage = ["rating", "ranking", "awards", "complete"].includes(requestedStage)
      ? requestedStage
      : "all";
    let visible = stage === "all" ? years : years.filter((year) => year.stage === stage);
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
      { watched: 0, rated: 0, rankingGroups: 0, reviewedGroups: 0, awardSlots: 0, filledSlots: 0, completeYears: 0 },
    );
    let filters = [
      ["all", ui("All years")],
      ["rating", ui("Needs ratings")],
      ["ranking", ui("Ready to rank")],
      ["awards", ui("Ceremonies")],
      ["complete", ui("Complete")],
    ]
      .map(([value, label]) => `<a href="${escape(filterUrl(value))}"${stage === value ? ' class="active" aria-current="page"' : ""}>${escape(label)}<span>${escape(value === "all" ? years.length : years.filter((year) => year.stage === value).length)}</span></a>`)
      .join("");
    let recommendationAction = recommendation && stageAction(recommendation);
    document.title = `${ui("Build your Oskars")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ classes: "build-hero", mainHtml: `<span class="eyebrow">${escape(ui("Your film journey"))}</span><h1>${escape(ui("Build your Oskars"))}</h1><p>${escape(ui("Rate, rank, and celebrate your watched history one release year at a time."))}</p>` })}
      <section class="build-overview" aria-label="${escape(ui("Journey progress"))}">
        <div><strong>${escape(totals.rated)} / ${escape(totals.watched)}</strong><span>${escape(ui("films rated"))}</span></div>
        <div><strong>${escape(totals.reviewedGroups)} / ${escape(totals.rankingGroups)}</strong><span>${escape(ui("ranking groups arranged"))}</span></div>
        <div><strong>${escape(totals.filledSlots)} / ${escape(totals.awardSlots)}</strong><span>${escape(ui("award categories reviewed"))}</span></div>
        <div><strong>${escape(totals.completeYears)} / ${escape(years.length)}</strong><span>${escape(ui("years complete"))}</span></div>
      </section>
      ${renderMilestone(milestone)}
      ${recommendation ? `<section class="build-continue-card"><div><span class="eyebrow">${escape(ui("Continue your journey"))}</span><h2>${escape(recommendation.year)}</h2><p>${escape(stageLabel(recommendation.stage))} · ${escape(recommendation.ratedCount)} / ${escape(recommendation.totalCount)} ${escape(ui("rated"))}</p><a class="button-link" href="${escape(recommendationAction.href)}">${escape(recommendationAction.label)} →</a></div>${window.renderPosterDeck(recommendation.posterFilms, { classes: "poster-deck--featured" })}</section>` : ""}
      <nav class="build-stage-filters" aria-label="${escape(ui("Filter years by next stage"))}">${filters}</nav>
      <section><div class="build-year-grid">${visible.map(yearCard).join("") || `<p class="detail-empty">${escape(ui("No years at this stage."))}</p>`}</div></section>`;
    finish?.(`${years.length} years, ${visible.length} shown, ${recommendation?.year || "complete"}`);
  }

  container.addEventListener("click", (event) => {
    let dismiss = event.target.closest("[data-build-milestone-dismiss]");
    if (!dismiss) return;
    let milestone = dismiss.closest("[data-build-milestone]");
    try {
      localStorage.setItem(`oskars-build-milestone:${milestone.dataset.buildMilestone}`, "dismissed");
    } catch (error) {}
    render();
  });

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
