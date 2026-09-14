/** @file Reviews and confirms exact-rating order in the selected independently stored ranking scope. */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("rankingReviewPage");
  let scopeType = window.normalizeSupabaseRankingReviewScopeType(
    window.pageQueryParam("type"),
  );
  let scopeKey =
    scopeType === "allTime" ? "alltime" : window.pageQueryParam("key");

  let rankingId = null;
  let allEntries = [];
  let watchedByFilmId = new Map();
  let resolvedKeys = new Set();
  let sessionExcludedKeys = new Set();
  let pairs = [];
  let currentPair = null;
  let lastSwap = null;
  let feedback = "";

  function loadNextPair() {
    pairs = window.supabaseRankingConsistencyPairs(
      scopeType,
      scopeKey,
      allEntries,
      watchedByFilmId,
      resolvedKeys,
      sessionExcludedKeys,
    );
    currentPair = pairs[0] || null;
  }

  function scopeLabel() {
    if (scopeType === "years") return `${scopeKey} year heat`;
    if (scopeType === "decades") return `${scopeKey} finals`;
    if (scopeType === "centuries") return `${scopeKey} finals`;
    return "All-time final";
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
      return {
        type: "centuries",
        key: window.getCenturyKey(Number.parseInt(scopeKey, 10)),
      };
    if (scopeType === "centuries") return { type: "allTime", key: "alltime" };
    return null;
  }

  function renderConsistencyCard(entry, side, caption) {
    let film = entry.films || {};
    return `<article class="film-card ranking-consistency-card" data-ranking-consistency-pick="${side}" tabindex="0" role="button">
      ${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="" class="rate-watched-poster-thumb">` : ""}
      <div class="ranking-consistency-card-kicker">${escape(caption)}</div>
      <h3>${escape(film.title || "Unknown film")}</h3>
      <span class="film-year">(${escape(film.year || "—")})</span>
    </article>`;
  }

  function renderEmpty() {
    let remaining = window.supabaseRankingConsistencyPairs(
      scopeType,
      scopeKey,
      allEntries,
      watchedByFilmId,
      resolvedKeys,
      new Set(),
    );
    let canConfirm =
      allEntries.length &&
      !remaining.length &&
      allEntries.some((entry) => entry.rank_confirmed === false);
    let next = nextScope();
    let nextAction = next
      ? `<a class="button-link" href="ranking-review.html?type=${escape(next.type)}&key=${escape(next.key)}">${escape(`Continue to ${next.type === "allTime" ? "all-time final" : next.key}`)} →</a>`
      : `<a class="button-link" href="build.html">Return to Build your Oskars</a>`;
    return `<div class="detail-empty">
      <span class="eyebrow">${remaining.length ? "Comparisons skipped" : canConfirm ? "Ready to confirm" : allEntries.length ? "Period confirmed" : "No rated films"}</span><h2>${escape(scopeLabel())}</h2>
      <p>${remaining.length ? "Skipped comparisons remain. Reload to revisit them before confirming this period." : "Confirmation applies only to this period. Broader rankings are settled separately."}</p>
      ${canConfirm ? `<button type="button" data-ranking-confirm-scope>Keep this order for this period</button>` : ""}
      ${!remaining.length && !canConfirm ? nextAction : ""}
    </div>`;
  }

  function renderReview() {
    let progressText = `${resolvedKeys.size} reviewed · ${pairs.length} pairs remain`;
    return `<section class="ranking-consistency-compare" data-ranking-consistency-compare>
      <p class="ranking-consistency-progress">Do you still prefer the film above this one? · ${escape(progressText)}</p>
      <div class="ranking-consistency-choice">
        ${renderConsistencyCard(currentPair.above, "above", "Currently ranked higher")}
        <span class="ranking-consistency-vs">or</span>
        ${renderConsistencyCard(currentPair.below, "below", "Currently ranked lower")}
      </div>
      <div class="ranking-consistency-actions">
        <button type="button" class="sort-order-button" data-ranking-consistency-skip>Skip this pair</button>
      </div>
    </section>`;
  }

  function render() {
    document.title = `${scopeLabel()} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">Ranking heat</span><h1>${escape(scopeLabel())}</h1><p>Only comparisons that cross the already-settled narrower scope are shown in later finals.</p>`,
      actionsHtml: `<a class="button-link" href="${escape(backUrl())}">Back</a>`,
    });
    let body = !currentPair ? renderEmpty() : renderReview();
    let feedbackHtml = window.renderActionFeedback({
      message: feedback,
      actionLabel: lastSwap ? "Undo" : "",
      actionAttribute: "data-ranking-consistency-undo",
      escape,
    });
    container.innerHTML = `${header}${feedbackHtml}${body}`;
  }

  function renderHeaderAuthStatus(user) {
    let statusContainer = document.querySelector("[data-auth-status]");
    if (!statusContainer) return;
    window.renderSignedInHeaderAccount?.(
      statusContainer,
      user,
      user.email || "Signed in",
    );
    statusContainer
      .querySelector("[data-supabase-sign-out]")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
      });
  }

  // Swaps two overall-adjacent entries' positions both in Supabase and in
  // the local cache, keeping allEntries' array order authoritative for
  // subsequent pair lookups without a full refetch.
  async function swapAdjacentEntries(laterFilmId) {
    await window.moveSupabaseRankingEntry(
      rankingId,
      allEntries,
      laterFilmId,
      "up",
    );
    let laterIndex = allEntries.findIndex(
      (entry) => entry.film_id === laterFilmId,
    );
    [allEntries[laterIndex - 1], allEntries[laterIndex]] = [
      allEntries[laterIndex],
      allEntries[laterIndex - 1],
    ];
  }

  async function pick(side) {
    feedback = "";
    lastSwap = null;
    try {
      if (side === "above") {
        await window.resolveSupabaseRankingPairReview(
          scopeKey,
          scopeType,
          rankingId,
          currentPair.above.film_id,
          currentPair.below.film_id,
        );
        resolvedKeys.add(currentPair.key);
        loadNextPair();
        render();
      } else {
        await applySwap(currentPair);
      }
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  async function applySwap(pair) {
    await swapAdjacentEntries(pair.below.film_id);
    await window.resolveSupabaseRankingPairReview(
      scopeKey,
      scopeType,
      rankingId,
      pair.above.film_id,
      pair.below.film_id,
    );
    resolvedKeys.add(pair.key);
    lastSwap = pair;
    feedback = `Moved "${pair.below.films?.title}" above "${pair.above.films?.title}".`;
    loadNextPair();
    render();
  }

  async function undoSwap() {
    if (!lastSwap) return;
    let pair = lastSwap;
    try {
      await swapAdjacentEntries(pair.above.film_id);
      await window.reopenSupabaseRankingPairReview(
        scopeKey,
        scopeType,
        pair.above.film_id,
        pair.below.film_id,
      );
      resolvedKeys.delete(pair.key);
      lastSwap = null;
      feedback = "Swap undone.";
      loadNextPair();
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  function skip() {
    feedback = "";
    lastSwap = null;
    sessionExcludedKeys.add(currentPair.key);
    loadNextPair();
    render();
  }

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    let pickTarget = event.target.closest("[data-ranking-consistency-pick]");
    if (!pickTarget) return;
    event.preventDefault();
    pick(pickTarget.dataset.rankingConsistencyPick);
  });

  container.addEventListener("click", async (event) => {
    let confirm = event.target.closest("[data-ranking-confirm-scope]");
    if (!confirm) return;
    confirm.disabled = true;
    try {
      await window.confirmSupabaseRankingEntries(
        rankingId,
        allEntries.map((entry) => entry.film_id),
      );
      allEntries.forEach((entry) => {
        entry.rank_confirmed = true;
      });
      feedback =
        "This period’s order is confirmed. Other periods are unchanged.";
      render();
    } catch (error) {
      confirm.disabled = false;
      alert(error.message || String(error));
    }
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
    if (event.target.closest("[data-ranking-consistency-undo]")) undoSwap();
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    renderHeaderAuthStatus(access.user);
    try {
      await window.loadSupabaseWorkspace();
      let workspace = window.getSupabaseWorkspace();
      watchedByFilmId = new Map(
        (workspace?.watched || []).map((row) => [row.film_id, row]),
      );
      let loaded = await window.prepareSupabasePeriodRanking(
        scopeKey,
        scopeType,
        workspace?.watched || [],
      );
      rankingId = loaded.rankingId;
      allEntries = loaded.entries;
      resolvedKeys = await window.loadSupabaseRankingPairReviews(
        scopeKey,
        scopeType,
      );
      loadNextPair();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your ranking</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
