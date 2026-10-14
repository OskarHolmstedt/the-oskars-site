/**
 * @file Ranking Hub page controller. Connects all-time, decade, century,
 * and year-by-year Watched rankings with Watchlist interest-tier ranking
 * merges and Collection local ranks.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("rankingsPage");

  function renderHeader(watchedCount, watchlistCount, unrankedCount) {
    let mainHtml = `<h1>${escape(window.t ? window.t("nav.rankings", "Rankings") : "Rankings")}</h1>`;
    let subHtml = `<p class="period-header-meta">${escape(
      `Central hub for ordering watched films (${watchedCount} rated; ${unrankedCount} unranked in release years) and watchlist tiers (${watchlistCount} items).`,
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

  function rankingProgress(rows, rankings, type, key) {
    let entries = (rankings || [])
      .filter(
        (ranking) =>
          ranking.scope_type === type && String(ranking.scope) === String(key),
      )
      .flatMap((ranking) => ranking.ranking_entries || []);
    let positioned = new Map(
      entries
        .filter(
          (entry) =>
            entry.position != null &&
            entry.position !== "" &&
            (type !== "allTime" || !entry.suppress_all_time_rank),
        )
        .map((entry) => [entry.film_id, entry]),
    );
    let unranked = rows.filter((row) => !positioned.has(row.film_id));
    let unreviewed = rows.filter(
      (row) => positioned.get(row.film_id)?.rank_confirmed === false,
    );
    return { ranked: rows.length - unranked.length, unranked, unreviewed };
  }

  function renderProgress(progress) {
    let filmList = (rows) =>
      rows
        .map(
          (row) =>
            `<li><a href="${escape(window.filmPageUrl(row.film_id))}">${escape(row.films?.title || "Unknown film")}</a></li>`,
        )
        .join("");
    return `<div class="rankings-card-meta">${progress.ranked} ranked · ${progress.unranked.length} unranked${progress.unreviewed.length ? ` · ${progress.unreviewed.length} awaiting review` : ""}</div>
      ${progress.unranked.length ? `<details><summary>Unranked films (${progress.unranked.length})</summary><ul>${filmList(progress.unranked)}</ul></details>` : ""}
      ${progress.unreviewed.length ? `<details><summary>Awaiting review (${progress.unreviewed.length})</summary><ul>${filmList(progress.unreviewed)}</ul></details>` : ""}`;
  }

  function renderWatchedPeriods(watchedRows, rankings) {
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

        let rows = watchedRows.filter((row) => {
          let year = row.films?.year;
          if (
            !Number.isInteger(year) ||
            !(row.rating || window.supabaseRankingRatingKey?.(row))
          )
            return false;
          return (
            scope.type === "allTime" ||
            (scope.type === "decades"
              ? window.getDecadeKey(year)
              : window.getCenturyKey(year)) === scope.key
          );
        });
        let progress = rankingProgress(rows, rankings, scope.type, scope.key);
        return `<div class="rankings-card">
          <div class="rankings-card-title">
            <span>${escape(scope.label)}</span>
            <span class="rankings-card-meta">${escape(scope.count)} films</span>
          </div>
          ${renderProgress(progress)}
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

  function renderYearShelves(watchedRows, rankings) {
    let yearMap = new Map();
    (watchedRows || []).forEach((row) => {
      let year = row.films?.year;
      if (!Number.isInteger(year)) return;
      let isRated = Boolean(
        row.rating || window.supabaseRankingRatingKey?.(row),
      );
      let current = yearMap.get(year) || { rated: 0, total: 0, rows: [] };
      current.total += 1;
      current.rows.push(row);
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
          ${renderProgress(rankingProgress(stats.rows, rankings, "years", String(year)))}
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
    let tiers = window.watchlistExactTiers();
    let rows = watchlistRows || [];

    let cardsHtml = tiers
      .map((tier) => {
        let tierItems = rows.filter(
          (r) =>
            window.watchlistTierKey(
              r.tier,
              r.tier_modifier || r.tierModifier,
            ) === tier,
        );
        let count = tierItems.length;
        let pendingCount = window
          .watchlistOrderingShelves(tier)
          .filter((shelf) => !shelf.confirmed)
          .reduce((sum, shelf) => sum + shelf.items.length, 0);
        let groupCount = window.watchlistOrderingBlocks(tier).length;

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
            ${pendingCount} awaiting year ordering · ${groupCount} ordered groups
          </div>
          <progress value="${count - pendingCount}" max="${count || 1}" style="width: 100%; height: 6px;"></progress>
          <div class="rankings-card-actions">
            <a class="sort-order-button" href="#watchlist-ordering">Order years</a>
            ${groupCount >= 2 ? `<a class="sort-order-button" href="${escape(mergeUrl)}">Merge order</a>` : ""}
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
        parts: ["watched", "watchlist", "rankings"],
      });
      await window.loadWatchlistOrdering();
      if (window.mountWatchlistYearOrder(container)) return;
      let watched = (workspace?.watched || []).filter(
        window.supabaseRankingFilmEligible,
      );
      let rankings = workspace?.rankings || [];
      let watchlist = workspace?.watchlist || [];

      let ratedWatched = watched.filter(
        (row) => row.rating || window.supabaseRankingRatingKey?.(row),
      );

      let yearRankedIds = new Set(
        rankings
          .filter((ranking) => ranking.scope_type === "years")
          .flatMap((ranking) =>
            (ranking.ranking_entries || [])
              .filter(
                (entry) => entry.position != null && entry.position !== "",
              )
              .map((entry) => `${ranking.scope}:${entry.film_id}`),
          ),
      );
      let unrankedCount = watched.filter(
        (row) =>
          Number.isInteger(row.films?.year) &&
          !yearRankedIds.has(`${row.films.year}:${row.film_id}`),
      ).length;
      let finishRender = window.startOskarsPerformance?.("rankings:render");
      let headerHtml = renderHeader(
        ratedWatched.length,
        watchlist.length,
        unrankedCount,
      );
      let quickActionsHtml = renderQuickActions();
      let watchedPeriodsHtml = renderWatchedPeriods(watched, rankings);
      let watchlistTiersHtml = renderWatchlistTiers(watchlist);
      let yearShelvesHtml = renderYearShelves(watched, rankings);
      let collectionsHtml = renderCollections();

      container.innerHTML = `
        ${headerHtml}
        ${quickActionsHtml}
        ${watchedPeriodsHtml}
        ${window.renderWatchlistOrderingProgress()}
        ${watchlistTiersHtml}
        ${yearShelvesHtml}
        ${collectionsHtml}
      `;
      finishRender?.();
    } catch (err) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load rankings hub</h2><p>${escape(err.message || String(err))}</p></section>`;
    }
  }

  boot();
})();
