/**
 * @file Ranking Hub page controller. Connects all-time, decade, century,
 * and year-by-year Watched rankings with Watchlist interest-tier ranking
 * merges and Collection local ranks.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("rankingsPage");

  function renderHeader(watchedCount, watchlistCount) {
    let mainHtml = `<h1>${escape(window.t ? window.t("nav.rankings", "Rankings") : "Rankings")}</h1>`;
    let subHtml = `<p class="period-header-meta">${escape(
      `Central hub for ordering watched films (${watchedCount} rated) and watchlist tiers (${watchlistCount} items).`,
    )}</p>`;
    return window.renderDetailHeader({ mainHtml, subHtml });
  }

  function renderQuickActions() {
    return `<div class="period-edit-controls" style="margin-bottom: 24px;">
      <a class="sort-order-button" href="merge.html">Merge tool (All)</a>
      <a class="sort-order-button" href="merge.html?mode=watched">Watched period merge</a>
      <a class="sort-order-button" href="merge.html?mode=watchlist">Watchlist tier merge</a>
      <a class="sort-order-button" href="merge.html?mode=collections">Collection merge</a>
      <a class="sort-order-button" href="ranking-review.html">Review consistency</a>
      <a class="sort-order-button" href="period.html?type=alltime&view=films&order=rank">All-time ranked films</a>
    </div>`;
  }

  function renderWatchedPeriods(watchedRows) {
    let scopes = window.supabaseWatchedScopes
      ? window.supabaseWatchedScopes(watchedRows)
      : [];
    if (!scopes.length) {
      return `<section class="rankings-section">
        <div class="rankings-section-header">
          <h2>Watched Periods</h2>
        </div>
        <p class="detail-empty">No rated watched films found.</p>
      </section>`;
    }

    let cardsHtml = scopes
      .map((scope) => {
        let periodTypeParam =
          scope.type === "allTime"
            ? "alltime"
            : scope.type === "decades"
              ? "decade"
              : "century";
        let mergeUrl = `merge.html?mode=watched&type=${encodeURIComponent(scope.type)}&key=${encodeURIComponent(scope.key)}`;
        let reviewUrl = `ranking-review.html?type=${encodeURIComponent(scope.type)}&key=${encodeURIComponent(scope.key)}`;
        let viewUrl = `period.html?type=${encodeURIComponent(periodTypeParam)}&key=${encodeURIComponent(scope.key)}&view=films&order=rank`;

        return `<div class="rankings-card">
          <div class="rankings-card-title">
            <span>${escape(scope.label)}</span>
            <span class="rankings-card-meta">${escape(scope.count)} films</span>
          </div>
          <div class="rankings-card-actions">
            <a class="sort-order-button" href="${escape(mergeUrl)}">Merge</a>
            <a class="sort-order-button" href="${escape(reviewUrl)}">Review</a>
            <a class="sort-order-button" href="${escape(viewUrl)}">View</a>
          </div>
        </div>`;
      })
      .join("");

    return `<section class="rankings-section">
      <div class="rankings-section-header">
        <h2>Watched Periods</h2>
        <a class="sort-order-button" href="merge.html?mode=watched">Merge periods</a>
      </div>
      <div class="rankings-grid">${cardsHtml}</div>
    </section>`;
  }

  function renderYearShelves(watchedRows) {
    let yearMap = new Map();
    (watchedRows || []).forEach((row) => {
      let year = row.films?.year;
      if (!Number.isInteger(year)) return;
      let isRated = Boolean(
        row.rating || window.supabaseRankingRatingKey?.(row),
      );
      let current = yearMap.get(year) || { rated: 0, total: 0 };
      current.total += 1;
      if (isRated) current.rated += 1;
      yearMap.set(year, current);
    });

    let sortedYears = [...yearMap.keys()].sort((a, b) => b - a);
    if (!sortedYears.length) return "";

    let cardsHtml = sortedYears
      .map((year) => {
        let stats = yearMap.get(year);
        let rankUrl = `rank-year.html?year=${encodeURIComponent(year)}`;
        let viewUrl = `period.html?type=year&key=${encodeURIComponent(year)}&view=films&order=rank`;
        return `<div class="rankings-year-card">
          <span class="rankings-year-num">${escape(year)}</span>
          <span class="rankings-year-count">${escape(stats.rated)} rated</span>
          <div class="rankings-card-actions" style="justify-content: center;">
            <a class="sort-order-button" href="${escape(rankUrl)}">Rank</a>
            <a class="sort-order-button" href="${escape(viewUrl)}">View</a>
          </div>
        </div>`;
      })
      .join("");

    return `<section class="rankings-section">
      <div class="rankings-section-header">
        <h2>Release Year Rankings</h2>
        <span class="rankings-card-meta">${escape(sortedYears.length)} release years</span>
      </div>
      <div class="rankings-years-grid">${cardsHtml}</div>
    </section>`;
  }

  function renderWatchlistTiers(watchlistRows) {
    let tiers = window.WATCHLIST_TIERS || ["S", "A", "B", "C", "D", "E", "F"];
    let rows = watchlistRows || [];

    let cardsHtml = tiers
      .map((tier) => {
        let tierItems = rows.filter((r) => r.tier === tier);
        let count = tierItems.length;
        let rankedCount = tierItems.filter(
          (r) => r.position != null && r.position !== "",
        ).length;
        let nrCount = count - rankedCount;

        let badgeHtml = window.renderWatchlistTierBadge
          ? window.renderWatchlistTierBadge(tier, { escape })
          : `Tier ${escape(tier)}`;
        let mergeUrl = `merge.html?mode=watchlist&tier=${encodeURIComponent(tier)}`;
        let viewUrl = `period.html?view=watchlist&tier=${encodeURIComponent(tier)}`;

        return `<div class="rankings-card">
          <div class="rankings-card-title">
            <span>${badgeHtml}</span>
            <span class="rankings-card-meta">${escape(count)} items</span>
          </div>
          <div class="rankings-card-meta">
            ${rankedCount} ranked · ${nrCount} unranked (NR)
          </div>
          <progress value="${rankedCount}" max="${count || 1}" style="width: 100%; height: 6px;"></progress>
          <div class="rankings-card-actions">
            ${count >= 2 ? `<a class="sort-order-button" href="${escape(mergeUrl)}">Merge order</a>` : ""}
            <a class="sort-order-button" href="${escape(viewUrl)}">View tier</a>
          </div>
        </div>`;
      })
      .join("");

    return `<section class="rankings-section">
      <div class="rankings-section-header">
        <h2>Watchlist Interest Tiers</h2>
        <a class="sort-order-button" href="merge.html?mode=watchlist">Merge watchlist</a>
      </div>
      <div class="rankings-grid">${cardsHtml}</div>
    </section>`;
  }

  function renderCollections() {
    return `<section class="rankings-section">
      <div class="rankings-section-header">
        <h2>Collection Local Ranks</h2>
        <a class="sort-order-button" href="merge.html?mode=collections">Merge collections</a>
      </div>
      <div class="rankings-card">
        <p style="margin: 0; font-size: 13px; color: var(--muted);">
          Sort director filmographies or custom-tagged films by personal preference using pairwise merge sort.
        </p>
        <div class="rankings-card-actions">
          <a class="sort-order-button" href="merge.html?mode=collections">Merge director / tag</a>
          <a class="sort-order-button" href="directors.html">Directors</a>
          <a class="sort-order-button" href="tags.html">Tags</a>
        </div>
      </div>
    </section>`;
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate?.();
    if (access && !access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }

    try {
      let workspace = await window.loadSupabaseWorkspace({
        parts: ["watched", "watchlist"],
      });
      let watched = workspace?.watched || [];
      let watchlist = workspace?.watchlist || [];

      let ratedWatched = watched.filter(
        (row) => row.rating || window.supabaseRankingRatingKey?.(row),
      );

      let headerHtml = renderHeader(ratedWatched.length, watchlist.length);
      let quickActionsHtml = renderQuickActions();
      let watchedPeriodsHtml = renderWatchedPeriods(watched);
      let watchlistTiersHtml = renderWatchlistTiers(watchlist);
      let yearShelvesHtml = renderYearShelves(watched);
      let collectionsHtml = renderCollections();

      container.innerHTML = `
        ${headerHtml}
        ${quickActionsHtml}
        ${watchedPeriodsHtml}
        ${watchlistTiersHtml}
        ${yearShelvesHtml}
        ${collectionsHtml}
      `;
    } catch (err) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load rankings hub</h2><p>${escape(err.message || String(err))}</p></section>`;
    }
  }

  boot();
})();
