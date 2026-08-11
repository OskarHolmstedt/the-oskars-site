/**
 * @file Guided head-to-head ranking-consistency review (issue #138): shows
 * two adjacent films sharing an exact rating bucket and asks whether the
 * current order still holds, reusing the existing guarded
 * `moveRankedFilmWithinRating` mutation for any resulting swap. Session
 * progress (confirmed/swapped/skipped counts and which pairs are resolved)
 * is entirely in-memory - nothing new is persisted beyond an applied swap.
 */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();

  let container = document.getElementById("rankingReviewPage");
  document.title = `${ui("Ranking consistency review")} · The Oskars`;

  let resolvedKeys = new Set();
  let stats = { confirmed: 0, swapped: 0, skipped: 0 };
  let pairs = [];
  let currentPair = null;
  let pendingSwap = null;

  function loadNextPair() {
    pairs = window.rankingConsistencyPairs(resolvedKeys);
    currentPair = pairs[0] || null;
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
    return `<div class="detail-empty">
      <h2>${escape(ui("Nothing left to review"))}</h2>
      <p>${escape(ui("Every adjacent pair sharing an exact rating has been reviewed this session, or there aren't two rated films to compare yet."))}</p>
      <a href="period.html?type=alltime&key=alltime">${escape(ui("Return to all-time ranking"))}</a>
    </div>`;
  }

  function renderReview() {
    let progressText = ui("{count} reviewed this session · {remaining} pairs remain", {
      count: stats.confirmed + stats.swapped + stats.skipped,
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
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Ranking consistency review"))}</h1><p><a href="period.html?type=alltime&key=alltime">${escape(ui("Back to all-time ranking"))}</a></p>`,
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
      resolvedKeys.add(currentPair.key);
      stats.confirmed += 1;
      loadNextPair();
    } else {
      pendingSwap = currentPair;
    }
    render();
  }

  function skip() {
    resolvedKeys.add(currentPair.key);
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
    resolvedKeys.add(pendingSwap.key);
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
