/**
 * @file Ranking Hub page controller. Connects all-time, decade, century,
 * and year-by-year Watched, Watchlist, and Rewatchlist rankings through
 * a unified annual matrix, visual unranked backlog strip, and staged placement.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("rankingsPage");

  const categories = {
    watched: "Watched",
    watchlist: "Watchlist",
    rewatchlist: "Rewatchlist",
  };
  let workspace;
  let category;

  function selectedCategory() {
    let value = window.pageQueryParam("category");
    if (Object.hasOwn(categories, value)) return value;
    return window.pageQueryParam("watchlistPlacement") === "1" ||
      window.location.hash === "#watchlist-ordering"
      ? "watchlist"
      : "watched";
  }

  function renderHeader(summary, percent) {
    return (
      window.renderBreadcrumbs([
        { label: "Rankings", href: "rankings.html" },
        { label: categories[category] },
      ]) +
      window.renderDetailHeader({
        mainHtml: `<h1>Rankings · ${categories[category]}</h1><p class="period-header-meta">${escape(summary)}</p><div class="rankings-progress-wrap" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Ranking completion"><div class="rankings-progress-bar" style="width: ${percent}%;"></div></div>`,
      }) +
      `<nav class="period-edit-controls" aria-label="Ranking category">${Object.entries(
        categories,
      )
        .map(
          ([key, label]) =>
            `<a class="sort-order-button${key === category ? " active" : ""}" href="rankings.html?category=${key}" data-ranking-category="${key}"${key === category ? ' aria-current="page"' : ""}>${label}</a>`,
        )
        .join("")}</nav>`
    );
  }

  function renderQuickActions() {
    let view =
      category === "watched"
        ? "period.html?type=alltime&view=films&order=rank"
        : category === "watchlist"
          ? "period.html?type=alltime&view=watchlist"
          : "period.html?type=alltime&view=rewatch";
    let merge =
      category === "watched"
        ? "merge.html?mode=watched"
        : category === "watchlist"
          ? "merge.html?mode=watchlist"
          : "";
    let review =
      category === "watched"
        ? "ranking-review.html"
        : category === "watchlist"
          ? "merge.html?mode=watchlist"
          : `${view}&order=rank`;
    return `<div class="period-edit-controls" aria-label="Ranking actions">
      <button type="button" class="sort-order-button" ${category === "watchlist" ? "data-watchlist-placement-open" : "data-ranking-placement-open"}>Place a film</button>
      ${merge ? `<a class="sort-order-button" href="${merge}">Merge groups</a>` : '<button type="button" class="sort-order-button" disabled title="Rewatchlist uses a single order within each tier">Merge groups</button>'}
      <a class="sort-order-button" href="${review}">Review order</a>
      <a class="sort-order-button" href="${view}">View</a>
    </div>`;
  }

  function renderUnrankedStrip(unrankedFilms, unreviewedFilms = []) {
    if (!unrankedFilms.length && !unreviewedFilms.length) {
      return `<section class="rankings-section">
        <div class="rankings-section-header">
          <h2>Unranked films (0)</h2>
        </div>
        <div class="rankings-unranked-empty">
          <span class="sparkle" aria-hidden="true">✦</span>
          <p>All ${escape(categories[category].toLowerCase())} films are placed in rankings!</p>
        </div>
      </section>`;
    }

    let filmCard = (row, tag = "") => {
      let filmId = row.film_id || row.id;
      let title = row.films?.title || "Unknown film";
      let year = row.films?.year || "Unknown";
      let posterUrl = row.films?.poster_url;
      let posterHtml = posterUrl
        ? `<img src="${escape(posterUrl)}" alt="" loading="lazy">`
        : `<span>${escape(String(title).slice(0, 1).toUpperCase())}</span>`;
      let meta = String(year);
      if (category === "watchlist" && row.tier) {
        meta += ` · ${window.watchlistTierKey(row.tier, row.tier_modifier || row.tierModifier)}`;
      } else if (category === "rewatchlist" && row.rewatch_tier) {
        meta += ` · ${window.watchlistTierKey(row.rewatch_tier, row.rewatch_tier_modifier)}`;
      } else if (
        category === "watched" &&
        (row.rating || row.rating_modifier)
      ) {
        meta += ` · ${window.renderFilmRating?.(row) || row.rating}`;
      }
      if (tag) meta += ` · ${tag}`;
      return `<div class="rankings-unranked-card" data-place-film-id="${escape(filmId)}">
        <div class="rankings-unranked-poster" aria-hidden="true">${posterHtml}</div>
        <div class="rankings-unranked-body">
          <a class="table-film-link rankings-unranked-title" href="${escape(window.filmPageUrl(row.film_id || filmId))}">${escape(title)}</a>
          <span class="rankings-unranked-meta">${escape(meta)}</span>
        </div>
        <button type="button" class="rankings-unranked-action" data-place-film-id="${escape(filmId)}">Place ↗</button>
      </div>`;
    };

    let unrankedHtml = unrankedFilms.length
      ? `<div class="rankings-section-header">
          <h2>Unranked films (${unrankedFilms.length})</h2>
          <button type="button" class="sort-order-button" data-unranked-placement-open>Find any film ↗</button>
        </div>
        <div class="rankings-unranked-strip" role="region" aria-label="Unranked films">
          ${unrankedFilms
            .slice(0, 30)
            .map((r) => filmCard(r))
            .join("")}
        </div>`
      : "";

    let unreviewedHtml = unreviewedFilms.length
      ? `<div class="rankings-section-header" style="margin-top: 16px;">
          <h2>Awaiting review (${unreviewedFilms.length})</h2>
          <a class="sort-order-button" href="ranking-review.html">Review consistency</a>
        </div>
        <div class="rankings-unranked-strip" role="region" aria-label="Awaiting review">
          ${unreviewedFilms
            .slice(0, 30)
            .map((r) => filmCard(r, "Awaiting review"))
            .join("")}
        </div>`
      : "";

    return `<section class="rankings-section">
      ${unrankedHtml}
      ${unreviewedHtml}
    </section>`;
  }

  function renderRankingsMatrix(yearMap, populatedYears) {
    let matrixHtml = window.renderPeriodIndexMatrix({
      years: populatedYears,
      allTimeUrl:
        category === "rewatchlist"
          ? "period.html?type=alltime&view=rewatch"
          : window.periodRankingPageUrl("alltime", "alltime", category),
      centuryUrl: (century) =>
        category === "rewatchlist"
          ? `period.html?type=century&key=${encodeURIComponent(century)}&view=rewatch`
          : window.periodRankingPageUrl("century", century, category),
      decadeUrl: (decade) =>
        category === "rewatchlist"
          ? `period.html?type=decade&key=${encodeURIComponent(decade)}&view=rewatch`
          : window.periodRankingPageUrl("decade", decade, category),
      yearUrl: (yearStr) => {
        let y = Number(yearStr);
        if (category === "rewatchlist")
          return `period.html?type=year&key=${encodeURIComponent(y)}&view=rewatch`;
        return window.periodRankingPageUrl("year", y, category);
      },
      yearClass: (yearStr) => {
        let stats = yearMap.get(Number(yearStr));
        if (!stats || stats.total === 0) return "is-empty";
        return stats.unranked === 0 ? "is-complete" : "is-in-progress";
      },
      yearAttrs: (yearStr) => {
        let stats = yearMap.get(Number(yearStr));
        if (!stats || stats.total === 0) return `title="${yearStr}: No films"`;
        let reviewPart = stats.unreviewed
          ? ` · ${stats.unreviewed} awaiting review`
          : "";
        return `title="${yearStr}: ${stats.ranked} ranked · ${stats.unranked} unranked${reviewPart}" data-year-status="${stats.unranked === 0 ? "complete" : "in-progress"}"`;
      },
      yearContent: (yearStr) => {
        let stats = yearMap.get(Number(yearStr));
        let indicator = "";
        if (stats && stats.total > 0) {
          indicator =
            stats.unranked === 0
              ? '<span class="rankings-cell-indicator" aria-hidden="true">✓</span>'
              : `<span class="rankings-cell-indicator" aria-hidden="true">${stats.unranked}</span>`;
        }
        return `${escape(yearStr)}${indicator}`;
      },
    });

    return `<section class="rankings-section rankings-matrix-section">
      <div class="rankings-section-header">
        <h2>Annual ranking matrix</h2>
        <div class="rankings-matrix-legend" aria-hidden="true">
          <span class="rankings-matrix-legend-item"><span class="rankings-legend-dot is-complete"></span> Complete</span>
          <span class="rankings-matrix-legend-item"><span class="rankings-legend-dot is-in-progress"></span> In progress</span>
          <span class="rankings-matrix-legend-item"><span class="rankings-legend-dot is-empty"></span> No films</span>
        </div>
      </div>
      ${matrixHtml}
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

  function openPlacement(initialId = "") {
    if (category !== "watchlist") {
      window.openRankingPlacement(category, initialId, () => renderHub());
      return;
    }
    window.openWatchlistPlacement({
      items: window.watchlistPlacementItems(),
      getItems: window.watchlistPlacementItems,
      initialId,
      onSaved() {
        renderHub();
      },
    });
  }

  container.addEventListener("click", (event) => {
    let link = event.target.closest("[data-ranking-category]");
    if (
      link &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      history.pushState({}, "", link.href);
      category = selectedCategory();
      renderHub();
      container.querySelector(`[data-ranking-category="${category}"]`)?.focus();
      return;
    }
    let unrankedCard = event.target.closest("[data-place-film-id]");
    if (unrankedCard && !event.target.closest(".table-film-link")) {
      event.preventDefault();
      openPlacement(unrankedCard.dataset.placeFilmId);
      return;
    }
    if (
      !event.target.closest(
        "[data-watchlist-placement-open], [data-ranking-placement-open], [data-unranked-placement-open]",
      )
    )
      return;
    event.preventDefault();
    openPlacement();
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    let unrankedCard = event.target.closest("[data-place-film-id]");
    if (unrankedCard && !event.target.closest(".table-film-link")) {
      event.preventDefault();
      openPlacement(unrankedCard.dataset.placeFilmId);
    }
  });

  function renderHub() {
    let watched = (workspace?.watched || []).filter(
      window.supabaseRankingFilmEligible,
    );
    let rankings = workspace?.rankings || [];
    let watchlist = workspace?.watchlist || [];
    let rewatch = (workspace?.watched || []).filter(
      (row) => row.want_to_rewatch,
    );

    let totalCount;
    let unrankedCount;
    let rankedCount;
    let summary;
    let unrankedFilms;
    let unreviewedFilms = [];
    let yearMap = new Map();

    if (category === "watched") {
      let ratedWatched = watched.filter(
        (row) => row.rating || window.supabaseRankingRatingKey?.(row),
      );
      let yearRankedIds = new Set();
      let yearUnreviewedIds = new Set();
      rankings
        .filter((ranking) => ranking.scope_type === "years")
        .forEach((ranking) => {
          (ranking.ranking_entries || []).forEach((entry) => {
            if (entry.position != null && entry.position !== "") {
              yearRankedIds.add(`${ranking.scope}:${entry.film_id}`);
              if (entry.rank_confirmed === false) {
                yearUnreviewedIds.add(`${ranking.scope}:${entry.film_id}`);
              }
            }
          });
        });
      unrankedFilms = watched.filter(
        (row) =>
          Number.isInteger(row.films?.year) &&
          !yearRankedIds.has(`${row.films.year}:${row.film_id}`),
      );
      unreviewedFilms = watched.filter(
        (row) =>
          Number.isInteger(row.films?.year) &&
          yearUnreviewedIds.has(`${row.films.year}:${row.film_id}`),
      );
      totalCount = ratedWatched.length;
      unrankedCount = unrankedFilms.length;
      rankedCount = Math.max(0, totalCount - unrankedCount);
      summary = `${totalCount} rated · ${unrankedCount} unranked in release years`;

      watched.forEach((row) => {
        let y = row.films?.year;
        if (!Number.isInteger(y)) return;
        let current = yearMap.get(y) || {
          total: 0,
          ranked: 0,
          unranked: 0,
          unreviewed: 0,
        };
        current.total += 1;
        if (yearRankedIds.has(`${y}:${row.film_id}`)) {
          current.ranked += 1;
          if (yearUnreviewedIds.has(`${y}:${row.film_id}`)) {
            current.unreviewed += 1;
          }
        } else {
          current.unranked += 1;
        }
        yearMap.set(y, current);
      });
    } else if (category === "watchlist") {
      let tiered = watchlist.filter((row) =>
        window.normalizeWatchlistTier(row.tier),
      );
      unrankedFilms = tiered.filter(
        (row) => row.position == null || row.position === "",
      );
      let pending = window
        .watchlistExactTiers()
        .flatMap((tier) => window.watchlistOrderingShelves(tier))
        .filter((shelf) => !shelf.confirmed)
        .reduce((sum, shelf) => sum + shelf.items.length, 0);
      let groups = window
        .watchlistExactTiers()
        .reduce(
          (sum, tier) => sum + window.watchlistOrderingBlocks(tier).length,
          0,
        );
      totalCount = tiered.length;
      unrankedCount = unrankedFilms.length;
      rankedCount = Math.max(0, totalCount - unrankedCount);
      summary = `${totalCount} tiered · ${pending} awaiting year ordering · ${groups} ordered groups`;

      let pendingYears = new Map();
      for (let tier of window.watchlistExactTiers()) {
        for (let shelf of window.watchlistOrderingShelves(tier)) {
          let y = shelf.year;
          if (!pendingYears.has(y))
            pendingYears.set(y, { pending: 0, count: 0 });
          let stat = pendingYears.get(y);
          stat.count += shelf.items.length;
          if (!shelf.confirmed) stat.pending += shelf.items.length;
        }
      }

      tiered.forEach((row) => {
        let y = Number(row.films?.year);
        if (!Number.isInteger(y)) return;
        let current = yearMap.get(y) || {
          total: 0,
          ranked: 0,
          unranked: 0,
          unreviewed: 0,
        };
        current.total += 1;
        if (row.position != null && row.position !== "") {
          current.ranked += 1;
        } else {
          current.unranked += 1;
        }
        let py = pendingYears.get(y);
        if (py && py.pending > 0) {
          current.unreviewed = py.pending;
        }
        yearMap.set(y, current);
      });
    } else {
      unrankedFilms = rewatch.filter(
        (row) => row.rewatch_position == null || row.rewatch_position === "",
      );
      totalCount = rewatch.length;
      unrankedCount = unrankedFilms.length;
      rankedCount = Math.max(0, totalCount - unrankedCount);
      summary = `${totalCount} marked for rewatch · ${rankedCount} ordered · ${unrankedCount} unranked`;

      rewatch.forEach((row) => {
        let y = Number(row.films?.year);
        if (!Number.isInteger(y)) return;
        let current = yearMap.get(y) || {
          total: 0,
          ranked: 0,
          unranked: 0,
          unreviewed: 0,
        };
        current.total += 1;
        if (row.rewatch_position != null && row.rewatch_position !== "") {
          current.ranked += 1;
        } else {
          current.unranked += 1;
        }
        yearMap.set(y, current);
      });
    }

    let percent =
      totalCount > 0 ? Math.round((rankedCount / totalCount) * 100) : 100;

    let populatedYears = [
      ...new Set([
        ...watched.map((r) => Number(r.films?.year)),
        ...watchlist.map((r) => Number(r.films?.year)),
      ]),
    ]
      .filter((y) => Number.isInteger(y) && y >= 1900)
      .map(String);

    document.title = `${categories[category]} rankings · The Oskars`;
    let finishRender = window.startOskarsPerformance?.("rankings:render");
    container.innerHTML =
      renderHeader(summary, percent) +
      renderQuickActions() +
      renderUnrankedStrip(unrankedFilms, unreviewedFilms) +
      renderRankingsMatrix(yearMap, populatedYears) +
      (category === "watched" ? renderCollections() : "");
    finishRender?.();
  }

  window.addEventListener("popstate", () => {
    if (!workspace || window.pageQueryParam("watchlistYear")) return;
    category = selectedCategory();
    renderHub();
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate?.();
    if (access && !access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }

    try {
      workspace = await window.loadSupabaseWorkspace({
        parts: ["watched", "watchlist", "rankings"],
      });
      await window.loadWatchlistOrdering();
      if (window.mountWatchlistYearOrder(container)) return;
      category = selectedCategory();
      renderHub();
      if (
        window.pageQueryParam("watchlistPlacement") === "1" ||
        window.pageQueryParam("placeFilm")
      )
        openPlacement(window.pageQueryParam("placeFilm") || "");
    } catch (err) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load rankings hub</h2><p>${escape(err.message || String(err))}</p></section>`;
    }
  }

  boot();
})();
