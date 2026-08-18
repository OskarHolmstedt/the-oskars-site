/**
 * @file Guided head-to-head ranking-consistency review (issue #138): shows
 * two adjacent films sharing an exact rating bucket and asks whether the
 * current order still holds, reusing the existing guarded
 * `moveRankedFilmWithinRating` mutation for any resulting swap. Session
 * decisions persist by scope while skipped pairs remain session-only.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();

  let container = document.getElementById("rankingReviewPage");
  let scopeType = window.normalizeRankingReviewScopeType(window.pageQueryParam("type"));
  let scopeKey = scopeType === "allTime" ? "alltime" : window.pageQueryParam("key");

  let sessionExcludedKeys = new Set();
  let stats = { confirmed: 0, swapped: 0, skipped: 0 };
  let pairs = [];
  let currentPair = null;
  let pendingSwap = null;

  function loadNextPair() {
    pairs = window.rankingConsistencyPairsForScope(
      scopeType,
      scopeKey,
      sessionExcludedKeys,
    );
    currentPair = pairs[0] || null;
  }

  function scopeLabel() {
    if (scopeType === "years") return ui("{scope} year heat", { scope: scopeKey });
    if (scopeType === "decades") return ui("{scope} finals", { scope: scopeKey });
    if (scopeType === "centuries") return ui("{scope} finals", { scope: scopeKey });
    return ui("All-time final");
  }

  function backUrl() {
    return scopeType === "years"
      ? window.yearRankingPageUrl(scopeKey)
      : window.periodPageUrl(scopeType, scopeKey);
  }

  function nextScope() {
    if (scopeType === "years")
      return { type: "decades", key: window.getDecadeKey(scopeKey) };
    if (scopeType === "decades")
      return { type: "centuries", key: window.getCenturyKey(Number.parseInt(scopeKey, 10)) };
    if (scopeType === "centuries") return { type: "allTime", key: "alltime" };
    return null;
  }

  function renderConsistencyCard(film, side, caption) {
    let directorHtml = window.renderLinkedDirectors(film, { escape });
    return window.renderSharedFilmCard(film, {
      classes: ["ranking-consistency-card"],
      openFilm: false,
      attributes: {
        "data-ranking-consistency-pick": side,
        tabindex: "0",
        role: "button",
      },
      showYear: true,
      rankLabel: `${film.allTimeRank || film.rank || ""}.`,
      directorHtml: directorHtml
        ? `<div class="film-director">${escape(ui("by"))} ${directorHtml}</div>`
        : "",
      escape,
      beforeTitleHtml: `<div class="ranking-consistency-card-kicker">${escape(caption)}</div>`,
    });
  }

  function renderEmpty() {
    let next = nextScope();
    let nextAction = next
      ? `<a class="button-link" href="ranking-review.html?type=${escape(next.type)}&key=${escape(next.key)}">${escape(ui("Continue to {scope}", { scope: next.type === "allTime" ? ui("all-time final") : next.key }))} →</a>`
      : `<a class="button-link" href="build.html">${escape(ui("Return to Build your Oskars"))}</a>`;
    return `<div class="detail-empty">
      <span class="eyebrow">${escape(ui("Final settled"))}</span><h2>${escape(scopeLabel())}</h2>
      <p>${escape(ui("Every relevant same-rating comparison in this scope is settled, or there are not two films to compare yet."))}</p>
      ${nextAction}
    </div>`;
  }

  function renderReview() {
    let progressText = ui("{count} reviewed · {remaining} pairs remain", {
      count: window.rankingReviewResolvedKeys(scopeType, scopeKey).size,
      remaining: pairs.length,
    });
    return `<section class="ranking-consistency-compare" data-ranking-consistency-compare>
      <p class="ranking-consistency-progress">${escape(ui("Do you still prefer the film above this one?"))} · ${escape(progressText)}</p>
      <div class="ranking-consistency-choice">
        ${renderConsistencyCard(currentPair.above, "above", ui("Currently ranked higher"))}
        <span class="ranking-consistency-vs">${escape(ui("or"))}</span>
        ${renderConsistencyCard(currentPair.below, "below", ui("Currently ranked lower"))}
      </div>
      <div class="ranking-consistency-actions">
        <button type="button" class="sort-order-button" data-ranking-consistency-skip>${escape(ui("Skip this pair"))}</button>
      </div>
    </section>`;
  }

  function renderConfirmSwap() {
    let above = pendingSwap.above;
    let below = pendingSwap.below;
    let summaryText = ui('Move "{below}" to rank {aboveRank}, directly above "{above}".', {
      below: window.localizedFilmTitle?.(below) || below.title,
      above: window.localizedFilmTitle?.(above) || above.title,
      aboveRank: above.allTimeRank || above.rank || "",
    });
    let groupNote =
      above.rankingGroupId || below.rankingGroupId
        ? `<p class="ranking-consistency-note">${escape(ui("One of these films shares its rank with other tied films, which will move together."))}</p>`
        : "";
    return `<section class="ranking-consistency-confirm" data-ranking-consistency-confirm>
      <h2>${escape(ui("Confirm the swap"))}</h2>
      <p>${escape(summaryText)}</p>
      ${groupNote}
      <div class="ranking-consistency-confirm-actions">
        <button type="button" class="sort-order-button" data-ranking-consistency-apply>${escape(ui("Apply swap"))}</button>
        <button type="button" class="sort-order-button" data-ranking-consistency-cancel>${escape(ui("Cancel"))}</button>
      </div>
    </section>`;
  }

  function render() {
    document.title = `${scopeLabel()} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">${escape(ui("Ranking heat"))}</span><h1>${escape(scopeLabel())}</h1><p>${escape(ui("Only comparisons that cross the already-settled narrower scope are shown in later finals."))}</p>`,
      actionsHtml: `<a class="button-link" href="${escape(backUrl())}">${escape(ui("Back"))}</a>`,
    });
    let body = !currentPair
      ? renderEmpty()
      : pendingSwap
        ? renderConfirmSwap()
        : renderReview();
    container.innerHTML = `${header}${body}`;
  }

  function pick(side) {
    if (side === "above") {
      window.resolveRankingReviewPair(scopeType, scopeKey, currentPair);
      stats.confirmed += 1;
      window.save?.({ immediate: true, rebuild: false });
      loadNextPair();
    } else {
      pendingSwap = currentPair;
    }
    render();
  }

  function skip() {
    sessionExcludedKeys.add(currentPair.key);
    stats.skipped += 1;
    loadNextPair();
    render();
  }

  function applySwap() {
    let result = window.moveRankedFilmWithinRating(
      pendingSwap.below.id,
      pendingSwap.above.id,
      "before",
    );
    if (!result.ok) {
      window.alert?.(result.reason);
      return;
    }
    stats.swapped += 1;
    window.resolveRankingReviewPair(scopeType, scopeKey, pendingSwap);
    window.save?.({ immediate: true, rebuild: false });
    pendingSwap = null;
    loadNextPair();
    render();
  }

  function cancelSwap() {
    pendingSwap = null;
    render();
  }

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    let pickTarget = event.target.closest("[data-ranking-consistency-pick]");
    if (!pickTarget) return;
    event.preventDefault();
    pick(pickTarget.dataset.rankingConsistencyPick);
  });

  container.addEventListener("click", (event) => {
    let pickTarget = event.target.closest("[data-ranking-consistency-pick]");
    if (pickTarget) {
      pick(pickTarget.dataset.rankingConsistencyPick);
      return;
    }
    if (event.target.closest("[data-ranking-consistency-skip]")) {
      skip();
      return;
    }
    if (event.target.closest("[data-ranking-consistency-apply]")) {
      applySwap();
      return;
    }
    if (event.target.closest("[data-ranking-consistency-cancel]")) {
      cancelSwap();
    }
  });

  loadNextPair();
  render();
  window.addEventListener?.("oskars:localechange", render);
})();
