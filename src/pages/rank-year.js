/**
 * @file Renders one ranking scope's shelves (year, decade, century, or all-time) for Watched (exact ratings) and Watchlist (exact tiers).
 * Owns shelf reordering, bounded pagination, confirmation, and broader ranking handoffs.
 */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  let container = document.getElementById("rankYearPage");

  const PAGE_SIZE = 24;

  let category =
    window.pageQueryParam?.("category") === "watchlist"
      ? "watchlist"
      : "watched";

  function parseRankingScope() {
    let typeParam = window.pageQueryParam?.("type");
    let keyParam = window.pageQueryParam?.("key");
    let decadeParam = window.pageQueryParam?.("decade");
    let centuryParam = window.pageQueryParam?.("century");
    let yearParam =
      window.pageQueryParam?.("year") ??
      window.pageQueryParam?.("years") ??
      window.pageQueryParam?.("watchlistYear");

    let rawType = typeParam ? String(typeParam).trim().toLowerCase() : "";
    let rawKey =
      keyParam !== undefined && keyParam !== null
        ? String(keyParam).trim()
        : "";

    if (!rawType) {
      if (decadeParam) {
        rawType = "decade";
        rawKey = String(decadeParam).trim();
      } else if (centuryParam) {
        rawType = "century";
        rawKey = String(centuryParam).trim();
      } else if (yearParam !== undefined && yearParam !== null) {
        let str = String(yearParam).trim();
        if (str.toLowerCase() === "alltime") {
          rawType = "alltime";
          rawKey = "alltime";
        } else if (/^\d{4}s$/i.test(str)) {
          rawType = "decade";
          rawKey = str.toLowerCase();
        } else if (/^\d{1,2}C$/i.test(str)) {
          rawType = "century";
          rawKey = str.toUpperCase();
        } else {
          rawType = "year";
          rawKey = str;
        }
      }
    }

    let scopeType = window.normalizeSupabaseRankingReviewScopeType
      ? window.normalizeSupabaseRankingReviewScopeType(rawType || "years")
      : rawType === "decade" || rawType === "decades"
        ? "decades"
        : rawType === "century" || rawType === "centuries"
          ? "centuries"
          : rawType === "alltime" || rawType === "allTime"
            ? "allTime"
            : "years";

    let periodType =
      {
        years: "year",
        decades: "decade",
        centuries: "century",
        allTime: "alltime",
      }[scopeType] || "year";

    let scopeKey = rawKey;
    if (periodType === "alltime") {
      scopeKey = "alltime";
    } else if (!scopeKey && yearParam !== undefined && yearParam !== null) {
      scopeKey = String(yearParam).trim();
    }

    let valid = false;
    if (periodType === "year") {
      valid = /^\d{1,4}$/.test(scopeKey);
    } else if (periodType === "decade") {
      valid = /^\d{4}s$/i.test(scopeKey);
      if (valid) scopeKey = scopeKey.toLowerCase();
    } else if (periodType === "century") {
      valid = /^\d{4}s$/i.test(scopeKey) || /^\d{1,2}C$/i.test(scopeKey);
      if (valid && /^\d{1,2}C$/i.test(scopeKey))
        scopeKey = scopeKey.toUpperCase();
      if (valid && /^\d{4}s$/i.test(scopeKey))
        scopeKey = scopeKey.toLowerCase();
    } else if (periodType === "alltime") {
      valid = true;
      scopeKey = "alltime";
    }

    return { scopeType, periodType, scopeKey, valid };
  }

  let { scopeType, periodType, scopeKey, valid } = parseRankingScope();
  let tierFilter = window.pageQueryParam?.("tier") || "";

  let categories = {
    watched: "Watched",
    watchlist: "Watchlist",
  };

  // Watched state
  let rankingId = null;
  let allEntries = [];
  let watchedByFilmId = new Map();
  let expandedRatingBucket;

  // Watchlist state
  let drafts = new Map();
  let expandedWatchlistShelf;
  let statusMessage = "";

  // Shared state
  let shelfPages = new Map();
  let dragPayload = null;
  let isMutating = false;

  function periodLabel() {
    if (periodType === "alltime") return ui("All-time");
    if (periodType === "year") {
      let num = Number(scopeKey);
      return num === 0 ? "Unknown year" : String(scopeKey);
    }
    return String(scopeKey);
  }

  // --- Watched helpers ---

  function scopeEntries() {
    return allEntries.filter(
      (entry) =>
        window.supabaseRankingEntryInScope(
          scopeType,
          scopeKey,
          watchedByFilmId.get(entry.film_id) || entry,
        ) &&
        window.supabaseRankingFilmEligible(
          watchedByFilmId.get(entry.film_id) || entry,
        ),
    );
  }

  function ratingBuckets() {
    let buckets = new Map();
    scopeEntries().forEach((entry) => {
      let key = window.supabaseRankingRatingKey(
        watchedByFilmId.get(entry.film_id),
      );
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    });
    return buckets;
  }

  function renderRankCard(entry, bucketIndex) {
    let film = entry.films || {};
    return `<article class="film-card ranking-edit-card"${canEdit && !isMutating ? ' draggable="true"' : ""} data-setup-rank-film-id="${escape(entry.film_id)}" data-setup-rank-index="${escape(bucketIndex)}">
      ${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="" class="rate-watched-poster-thumb" loading="lazy" decoding="async">` : ""}
      <a class="table-film-link" href="${escape(window.filmPageUrl(entry.film_id))}">${escape(film.title || "Unknown film")}</a>
      ${entry.rank_confirmed === false ? `<span class="film-rank">${escape("NR")}</span>` : ""}
    </article>`;
  }

  function renderRatingBucket(key, bucketEntries) {
    let watched = watchedByFilmId.get(bucketEntries[0].film_id);
    let label =
      key === "unrated"
        ? ui("Unrated")
        : watched?.rating
          ? window.renderFilmRating(watched)
          : key;
    if (bucketEntries.length === 1) {
      return `<div class="setup-year-category-row setup-year-shelf is-settled">
        <div class="setup-year-category-header setup-year-shelf-header">
          <span class="setup-year-rank-bucket-label">${escape(label)}</span>
          <a class="setup-year-section-empty" href="${escape(window.filmPageUrl(bucketEntries[0].film_id))}">${escape(bucketEntries[0].films?.title || "")}</a>
          <span class="setup-ranking-state is-reviewed">Settled</span>
        </div>
      </div>`;
    }
    let reviewed = bucketEntries.every(
      (entry) => entry.rank_confirmed !== false,
    );
    let isExpanded = expandedRatingBucket === key;
    let header = `<div class="setup-year-category-header setup-year-shelf-header">
      <button type="button" class="setup-year-shelf-toggle" data-setup-rank-bucket-toggle="${escape(key)}" aria-expanded="${isExpanded}">
        <span class="setup-year-shelf-chevron">${isExpanded ? "▼" : "▶"}</span>
        <span class="setup-year-rank-bucket-label">${escape(label)} <small>(${escape(bucketEntries.length)})</small></span>
      </button>
      <span class="setup-ranking-state ${reviewed ? "is-reviewed" : "is-mechanical"}">${escape(reviewed ? "Reviewed" : "Mechanical order")}</span>
      ${canEdit ? `<button type="button" class="sort-order-button" data-setup-rank-bucket-toggle="${escape(key)}">${escape(isExpanded ? "Collapse" : "Reorder")}</button>` : ""}
    </div>`;
    if (!isExpanded)
      return `<div class="setup-year-category-row setup-year-shelf">${header}</div>`;

    let total = bucketEntries.length;
    let pageState = window.paginationState
      ? window.paginationState(total, shelfPages.get(key) || 1, PAGE_SIZE)
      : { sliceStart: 0, sliceEnd: total, page: 1, pageCount: 1 };
    shelfPages.set(key, pageState.page);

    let pagedEntries = bucketEntries.slice(
      pageState.sliceStart,
      pageState.sliceEnd,
    );
    let cards = pagedEntries
      .map((entry, index) =>
        renderRankCard(entry, pageState.sliceStart + index),
      )
      .join("");

    let paginationHtml =
      pageState.pageCount > 1 && window.renderPaginationControls
        ? window.renderPaginationControls({
            total,
            page: pageState.page,
            pageSize: PAGE_SIZE,
            dataAttribute: "data-shelf-page-target",
            itemLabel: ui("films"),
            ariaLabel: ui("Film pages"),
          })
        : "";

    return `<div class="setup-year-category-row setup-year-shelf is-expanded" data-shelf-key="${escape(key)}">
      ${header}
      <div class="film-grid setup-year-pool-grid">${cards}</div>
      ${paginationHtml}
      <div class="setup-ranking-actions">${canEdit ? `<button type="button" class="button-link" data-setup-rank-confirm="${escape(key)}">Keep this order</button>` : ""}<a class="button-link" href="ranking-review.html?type=${escape(scopeType)}&amp;key=${escape(scopeKey)}">Compare two at a time</a></div>
    </div>`;
  }

  function rankingSection() {
    let buckets = ratingBuckets();
    let titleLabel = periodLabel();
    if (!buckets.size) {
      let rateLink =
        periodType === "year"
          ? `rate-watched.html?year=${escape(scopeKey)}`
          : "rate-watched.html";
      let rateText =
        periodType === "year" ? "Rate this year" : "Rate watched films";
      return `<div class="setup-year-section-empty"><p>No watched films yet for ${escape(titleLabel)}.</p><a class="button-link" href="${rateLink}">${escape(rateText)}</a></div>`;
    }
    let orderedKeys = [...buckets.keys()].sort(
      (left, right) =>
        window.supabaseRankingRatingSortValueFromKey(right) -
        window.supabaseRankingRatingSortValueFromKey(left),
    );
    if (expandedRatingBucket === undefined) {
      expandedRatingBucket =
        orderedKeys.find((key) => buckets.get(key).length > 1) || null;
    }
    let sections = orderedKeys
      .map((key) => renderRatingBucket(key, buckets.get(key)))
      .join("");
    let multiFilmGroups = orderedKeys
      .map((key) => buckets.get(key))
      .filter((group) => group.length > 1);
    let heatComplete = multiFilmGroups.every((group) =>
      group.every((entry) => entry.rank_confirmed !== false),
    );

    let footerHtml;
    if (periodType === "year") {
      let decade = window.getDecadeKey
        ? window.getDecadeKey(scopeKey)
        : `${Math.floor(Number(scopeKey) / 10) * 10}s`;
      footerHtml = heatComplete
        ? `<span>Year heat complete</span><a class="button-link" href="ranking-review.html?type=decades&amp;key=${escape(decade)}">Continue to ${escape(decade)} finals →</a>`
        : `<a class="button-link" href="ranking-review.html?type=years&amp;key=${escape(scopeKey)}">Compare this year two at a time</a>`;
    } else if (periodType === "decade") {
      let century = window.getCenturyKey
        ? window.getCenturyKey(parseInt(scopeKey, 10))
        : `${Math.floor(Number.parseInt(scopeKey, 10) / 100) * 100}s`;
      footerHtml = heatComplete
        ? `<span>Decade heat complete</span><a class="button-link" href="ranking-review.html?type=centuries&amp;key=${escape(century)}">Continue to ${escape(century)} finals →</a>`
        : `<a class="button-link" href="ranking-review.html?type=decades&amp;key=${escape(scopeKey)}">Compare this decade two at a time</a>`;
    } else if (periodType === "century") {
      footerHtml = heatComplete
        ? `<span>Century heat complete</span><a class="button-link" href="ranking-review.html?type=allTime&amp;key=alltime">Continue to all-time finals →</a>`
        : `<a class="button-link" href="ranking-review.html?type=centuries&amp;key=${escape(scopeKey)}">Compare this century two at a time</a>`;
    } else {
      footerHtml = heatComplete
        ? `<span>All-time ranking complete</span><a class="button-link" href="rankings.html?category=watched">View all rankings →</a>`
        : `<a class="button-link" href="ranking-review.html?type=allTime&amp;key=alltime">Compare all-time two at a time</a>`;
    }

    let scopeNoun =
      periodType === "year"
        ? "year"
        : periodType === "decade"
          ? "decade"
          : periodType === "century"
            ? "century"
            : "all-time";

    return `<p class="setup-year-section-empty">Edits this ${escape(scopeNoun)}’s order inside the same exact rating only. Broader rankings are confirmed separately.</p>
      <div class="setup-year-category-list">${sections}</div>
      <div class="setup-ranking-footer">${footerHtml}</div>`;
  }

  // --- Watchlist helpers ---

  function watchlistBelongsToScope(row) {
    let filmYear = window.watchlistOrderYear
      ? window.watchlistOrderYear(row)
      : row.films?.year || 0;
    if (periodType === "alltime") return true;
    if (periodType === "year") return filmYear === Number(scopeKey);
    if (periodType === "decade")
      return window.getDecadeKey(filmYear) === scopeKey;
    return window.getCenturyKey(filmYear) === scopeKey;
  }

  function watchlistShelves() {
    let tiers = window.watchlistExactTiers ? window.watchlistExactTiers() : [];
    return tiers.flatMap((tier) => {
      if (tierFilter && tierFilter !== tier) return [];
      let tierRows = window.supabaseWatchlistTierItemsInOrder
        ? window.supabaseWatchlistTierItemsInOrder(tier)
        : [];
      let items = tierRows.filter(watchlistBelongsToScope);
      if (!items.length) return [];
      let yearShelves = window.watchlistOrderingShelves
        ? window.watchlistOrderingShelves(tier)
        : [];
      let yearShelfMap = new Map(yearShelves.map((s) => [s.year, s]));
      let distinctYears = [
        ...new Set(items.map((r) => window.watchlistOrderYear(r))),
      ];
      let confirmed =
        items.length === 1 ||
        distinctYears.every((y) => yearShelfMap.get(y)?.confirmed);
      return [{ tier, items, confirmed, distinctYears }];
    });
  }

  function watchlistShelfItems(shelf) {
    return drafts.get(shelf.tier) || shelf.items;
  }

  function renderWatchlistCard(row, index, tier, total) {
    let film = row.films || {};
    return `<article class="film-card ranking-edit-card"${canEdit && !isMutating ? ' draggable="true"' : ""} data-setup-rank-film-id="${escape(row.film_id)}" data-watchlist-year-film="${escape(row.film_id)}" data-setup-rank-index="${escape(index)}">
      ${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="" class="rate-watched-poster-thumb" loading="lazy" decoding="async">` : ""}
      <span class="film-rank">${index + 1}</span>
      <a class="table-film-link" href="${escape(window.filmPageUrl(row.film_id))}">${escape(film.title || "Unknown film")}</a>
      ${
        canEdit
          ? `<div class="watchlist-year-order-actions">
        <button type="button" class="sort-order-button" data-watchlist-year-move="-1" aria-label="Move ${escape(film.title || "film")} up"${isMutating || index === 0 ? " disabled" : ""}>↑</button>
        <button type="button" class="sort-order-button" data-watchlist-year-move="1" aria-label="Move ${escape(film.title || "film")} down"${isMutating || index === total - 1 ? " disabled" : ""}>↓</button>
      </div>`
          : ""
      }
    </article>`;
  }

  function renderWatchlistSettledShelf(shelf) {
    let items = watchlistShelfItems(shelf);
    let film = items[0];
    let badgeHtml = window.renderWatchlistTierBadge
      ? window.renderWatchlistTierBadge(shelf.tier, { escape })
      : `Tier ${escape(shelf.tier)}`;
    return `<div class="setup-year-category-row setup-year-shelf is-settled" data-watchlist-year-tier="${escape(shelf.tier)}">
      <div class="setup-year-category-header setup-year-shelf-header">
        <span class="setup-year-rank-bucket-label">${badgeHtml}</span>
        <a class="setup-year-section-empty" href="${escape(window.filmPageUrl(film.film_id))}">${escape(film.films?.title || "")}</a>
        <span class="setup-ranking-state is-reviewed">Settled</span>
      </div>
    </div>`;
  }

  function renderWatchlistShelf(shelf) {
    let items = watchlistShelfItems(shelf);
    let count = items.length;
    let badgeHtml = window.renderWatchlistTierBadge
      ? window.renderWatchlistTierBadge(shelf.tier, { escape })
      : `Tier ${escape(shelf.tier)}`;
    let isExpanded = expandedWatchlistShelf === shelf.tier;
    let reviewed = shelf.confirmed && !drafts.has(shelf.tier);
    let stateLabel = drafts.has(shelf.tier)
      ? "Unsaved order"
      : shelf.confirmed
        ? periodType === "year"
          ? "Year order ready"
          : "Period order ready"
        : periodType === "year"
          ? "Awaiting year ordering"
          : "Awaiting period ordering";
    let stateClass = reviewed ? "is-reviewed" : "is-mechanical";

    let header = `<div class="setup-year-category-header setup-year-shelf-header">
      <button type="button" class="setup-year-shelf-toggle" data-setup-rank-bucket-toggle="${escape(shelf.tier)}" aria-expanded="${isExpanded}">
        <span class="setup-year-shelf-chevron">${isExpanded ? "▼" : "▶"}</span>
        <span class="setup-year-rank-bucket-label">${badgeHtml} <small>(${escape(count)})</small></span>
      </button>
      <span class="setup-ranking-state ${stateClass}">${escape(stateLabel)}</span>
      ${canEdit ? `<button type="button" class="sort-order-button" data-setup-rank-bucket-toggle="${escape(shelf.tier)}">${escape(isExpanded ? "Collapse" : "Reorder")}</button>` : ""}
    </div>`;

    if (!isExpanded) {
      return `<div class="setup-year-category-row setup-year-shelf" data-watchlist-year-tier="${escape(shelf.tier)}">${header}</div>`;
    }

    let pageState = window.paginationState
      ? window.paginationState(
          count,
          shelfPages.get(shelf.tier) || 1,
          PAGE_SIZE,
        )
      : { sliceStart: 0, sliceEnd: count, page: 1, pageCount: 1 };
    shelfPages.set(shelf.tier, pageState.page);

    let pagedItems = items.slice(pageState.sliceStart, pageState.sliceEnd);
    let cards = pagedItems
      .map((row, index) =>
        renderWatchlistCard(
          row,
          pageState.sliceStart + index,
          shelf.tier,
          count,
        ),
      )
      .join("");

    let paginationHtml =
      pageState.pageCount > 1 && window.renderPaginationControls
        ? window.renderPaginationControls({
            total: count,
            page: pageState.page,
            pageSize: PAGE_SIZE,
            dataAttribute: "data-shelf-page-target",
            itemLabel: ui("films"),
            ariaLabel: ui("Film pages"),
          })
        : "";

    return `<div class="setup-year-category-row setup-year-shelf is-expanded" data-watchlist-year-tier="${escape(shelf.tier)}" data-shelf-key="${escape(shelf.tier)}">
      ${header}
      <div class="film-grid setup-year-pool-grid watchlist-year-order-list">${cards}</div>
      ${paginationHtml}
      <div class="setup-ranking-actions">
        ${canEdit ? `<button type="button" class="button-link" data-watchlist-year-confirm="${escape(shelf.tier)}"${isMutating ? " disabled" : ""}>${isMutating ? "Saving…" : "Keep this order"}</button>` : ""}
        <a class="button-link" href="merge.html?mode=watchlist&amp;tier=${encodeURIComponent(shelf.tier)}">Merge ordered groups</a>
      </div>
    </div>`;
  }

  function watchlistRankingSection() {
    let shelves = watchlistShelves();
    let titleLabel = periodLabel();
    if (!shelves.length) {
      return `<div class="setup-year-section-empty"><p>No tiered watchlist films yet for ${escape(titleLabel)}.</p><a class="button-link" href="tier-watchlist.html">Tier your watchlist</a></div>`;
    }
    if (expandedWatchlistShelf === undefined) {
      expandedWatchlistShelf =
        tierFilter || shelves.find((s) => s.items.length > 1)?.tier || null;
    }
    let sections = shelves
      .map((shelf) =>
        shelf.items.length === 1
          ? renderWatchlistSettledShelf(shelf)
          : renderWatchlistShelf(shelf),
      )
      .join("");
    let multiFilmGroups = shelves.filter((s) => s.items.length > 1);
    let ready =
      multiFilmGroups.length === 0 ||
      multiFilmGroups.every((s) => s.confirmed && !drafts.has(s.tier));
    let statusText = statusMessage
      ? `<p role="status" class="setup-year-status">${escape(statusMessage)}</p>`
      : '<p role="status" class="setup-year-status" style="display:none;"></p>';

    let readyLabel =
      periodType === "year" ? "Year order ready" : "Period order ready";
    return `<p class="setup-year-section-empty">Drag films within the same exact tier, or use Move up and Move down. Confirm each shelf before merging with other ${periodType === "year" ? "years" : "periods"}.</p>
      ${statusText}
      <div class="setup-year-category-list">${sections}</div>
      <div class="setup-ranking-footer">${ready ? `<span>${escape(readyLabel)}</span><a class="button-link" href="merge.html?mode=watchlist${tierFilter ? `&amp;tier=${encodeURIComponent(tierFilter)}` : ""}">Merge watchlist groups →</a>` : `<a class="button-link" href="merge.html?mode=watchlist${tierFilter ? `&amp;tier=${encodeURIComponent(tierFilter)}` : ""}">Merge available groups</a>`}</div>`;
  }

  function moveWatchlist(tier, filmId, targetIndex) {
    let shelf = watchlistShelves().find((s) => s.tier === tier);
    if (!shelf) return;
    let rows = [...(drafts.get(tier) || shelf.items)];
    let index = rows.findIndex((row) => row.film_id === filmId);
    if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
    rows.splice(targetIndex, 0, rows.splice(index, 1)[0]);
    drafts.set(tier, rows);
    let newPage = Math.floor(targetIndex / PAGE_SIZE) + 1;
    shelfPages.set(tier, newPage);
    statusMessage = "Order changed. Confirm this shelf to save it.";
    render();
  }

  async function confirmWatchlistShelf(tier) {
    let shelf = watchlistShelves().find((s) => s.tier === tier);
    if (!shelf) return;
    let rows = drafts.get(tier) || shelf.items;
    let distinctYears =
      shelf.distinctYears ||
      [...new Set(rows.map((r) => window.watchlistOrderYear(r)))].sort(
        (a, b) => a - b,
      );
    isMutating = true;
    statusMessage = `Saving ${periodType === "year" ? "year" : "period"} order…`;
    render();
    try {
      await window.saveWatchlistOrdering(tier, distinctYears, rows);
      drafts.delete(tier);
      statusMessage = `Tier ${tier} ${periodType === "year" ? "year" : "period"} order saved. Ready to merge.`;
    } catch (error) {
      statusMessage = `Could not save: ${error.message || error}. Your draft is preserved; reload if the watchlist changed elsewhere.`;
      alert(error.message || String(error));
    } finally {
      isMutating = false;
      render();
    }
  }

  function overallNeighborFilmId(filmId, direction) {
    let index = allEntries.findIndex((entry) => entry.film_id === filmId);
    if (index < 0) return null;
    let neighbor = allEntries[index + direction];
    return neighbor ? neighbor.film_id : null;
  }

  function render() {
    let finishRankYear = window.startOskarsPerformance?.("rankYear:render");
    let finishWatchlistYear = window.startOskarsPerformance?.(
      "watchlistYear:render",
    );
    let titleLabel = periodLabel();

    document.title =
      category === "watched"
        ? `Rank ${titleLabel} · The Oskars`
        : `Order ${titleLabel} watchlist · The Oskars`;

    let scopeNoun =
      periodType === "year"
        ? "year"
        : periodType === "decade"
          ? "decade"
          : periodType === "century"
            ? "century"
            : "all-time";
    let eyebrow =
      category === "watched"
        ? `Watched ${scopeNoun} ranking`
        : `Watchlist ${scopeNoun} ranking`;
    let h1Text =
      category === "watched"
        ? escape(titleLabel)
        : `Order ${escape(titleLabel)} watchlist`;
    let descText =
      category === "watched"
        ? "Arrange films only against others with the same exact rating."
        : "Arrange films only against others with the same exact tier.";

    let viewUrl =
      category === "watched"
        ? `${window.periodPageUrl(periodType, scopeKey)}&view=films&order=rank`
        : `${window.periodPageUrl(periodType, scopeKey)}&view=watchlist`;

    let actionsHtml =
      category === "watched"
        ? `<a class="button-link" href="rankings.html?category=watched">Rankings</a><a class="button-link" href="${escape(viewUrl)}">View ${escape(titleLabel)}</a><a class="button-link" href="build.html">Build your Oskars</a>`
        : `<a class="button-link" href="rankings.html?category=watchlist">Rankings</a><a class="button-link" href="${escape(viewUrl)}">View ${escape(titleLabel)}</a><a class="button-link" href="merge.html?mode=watchlist${tierFilter ? `&amp;tier=${encodeURIComponent(tierFilter)}` : ""}">Merge ordered groups</a>`;

    let breadcrumbsHtml = window.renderBreadcrumbs
      ? window.renderBreadcrumbs([
          { label: "Rankings", href: `rankings.html?category=${category}` },
          {
            label: categories[category],
            href: `rankings.html?category=${category}`,
          },
          { label: titleLabel },
        ])
      : "";

    let header = window.renderDetailHeader({
      mainHtml: `${breadcrumbsHtml}<span class="eyebrow">${escape(eyebrow)}</span><h1>${h1Text}</h1><p>${escape(descText)}</p>`,
      actionsHtml,
    });

    let watchedUrl = window.periodRankingPageUrl(
      periodType,
      scopeKey,
      "watched",
      tierFilter,
    );
    let watchlistUrl = window.periodRankingPageUrl(
      periodType,
      scopeKey,
      "watchlist",
      tierFilter,
    );

    let categorySwitcher = `<nav class="period-edit-controls" aria-label="Ranking category">
      <a class="sort-order-button${category === "watched" ? " active" : ""}" href="${escape(watchedUrl)}" data-ranking-category="watched"${category === "watched" ? ' aria-current="page"' : ""}>Watched</a>
      <a class="sort-order-button${category === "watchlist" ? " active" : ""}" href="${escape(watchlistUrl)}" data-ranking-category="watchlist"${category === "watchlist" ? ' aria-current="page"' : ""}>Watchlist</a>
    </nav>`;

    let bodyHtml =
      category === "watched" ? rankingSection() : watchlistRankingSection();

    container.innerHTML = `${header}${categorySwitcher}<section class="setup-year-section"><h2>Ranking shelves</h2>${bodyHtml}</section>`;

    finishRankYear?.(`${scopeKey} · ${scopeEntries().length} films`);
    finishWatchlistYear?.(
      `${scopeKey} · ${watchlistShelves().reduce((sum, s) => sum + s.items.length, 0)} films`,
    );
  }

  container.addEventListener("click", async (event) => {
    let categoryLink = event.target.closest("[data-ranking-category]");
    if (
      categoryLink &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    ) {
      event.preventDefault();
      history.pushState({}, "", categoryLink.href);
      category = categoryLink.dataset.rankingCategory;
      shelfPages.clear();
      await initCategory();
      render();
      container.querySelector(`[data-ranking-category="${category}"]`)?.focus();
      return;
    }

    let pageButton = event.target.closest("[data-shelf-page-target]");
    if (pageButton) {
      let shelf = pageButton.closest("[data-shelf-key]");
      let shelfKey = shelf?.dataset.shelfKey;
      let targetPage = Number(pageButton.dataset.shelfPageTarget);
      if (shelfKey && targetPage >= 1) {
        shelfPages.set(shelfKey, targetPage);
        render();
      }
      return;
    }

    let toggle = event.target.closest("[data-setup-rank-bucket-toggle]");
    if (toggle) {
      if (!canEdit || isMutating) return;
      let key = toggle.dataset.setupRankBucketToggle;
      if (category === "watched") {
        expandedRatingBucket = expandedRatingBucket === key ? null : key;
      } else {
        expandedWatchlistShelf = expandedWatchlistShelf === key ? null : key;
      }
      render();
      return;
    }

    // Watchlist accessible move buttons
    let moveButton = event.target.closest("[data-watchlist-year-move]");
    if (moveButton && category === "watchlist") {
      if (!canEdit || isMutating) return;
      let card = moveButton.closest("[data-watchlist-year-film]");
      let shelf = moveButton.closest("[data-watchlist-year-tier]");
      if (!card || !shelf) return;
      let tier = shelf.dataset.watchlistYearTier;
      let index = Number(card.dataset.setupRankIndex);
      let delta = Number(moveButton.dataset.watchlistYearMove);
      moveWatchlist(tier, card.dataset.watchlistYearFilm, index + delta);
      container
        .querySelector(
          `[data-watchlist-year-film="${card.dataset.watchlistYearFilm}"] button:not(:disabled)`,
        )
        ?.focus();
      return;
    }

    // Watchlist confirm
    let watchlistConfirm = event.target.closest(
      "[data-watchlist-year-confirm]",
    );
    if (watchlistConfirm && category === "watchlist") {
      if (!canEdit || isMutating) return;
      let tier =
        watchlistConfirm.dataset.watchlistYearConfirm ||
        watchlistConfirm.closest("[data-watchlist-year-tier]")?.dataset
          .watchlistYearTier;
      await confirmWatchlistShelf(tier);
      return;
    }

    // Watched confirm
    let confirm = event.target.closest("[data-setup-rank-confirm]");
    if (confirm && category === "watched") {
      if (!canEdit || confirm.disabled || isMutating) return;
      confirm.disabled = true;
      isMutating = true;
      try {
        let key = confirm.dataset.setupRankConfirm;
        let bucketEntries = ratingBuckets().get(key) || [];
        await window.resolveSupabaseYearRankingBucket(
          rankingId,
          scopeKey,
          bucketEntries,
          scopeType,
        );
        let loaded = await window.loadSupabaseRanking(scopeKey, scopeType);
        allEntries = loaded.entries;
        render();
      } catch (error) {
        confirm.disabled = false;
        alert(error.message || String(error));
      } finally {
        isMutating = false;
      }
      return;
    }
  });

  container.addEventListener("dragstart", (event) => {
    if (!canEdit || isMutating) {
      event.preventDefault();
      return;
    }
    let card = event.target.closest("[data-setup-rank-film-id]");
    if (!card) return;
    let shelf = card.closest("[data-watchlist-year-tier]");
    dragPayload = {
      filmId: card.dataset.setupRankFilmId,
      tier: shelf?.dataset.watchlistYearTier,
      index: Number(card.dataset.setupRankIndex),
    };
    event.dataTransfer.effectAllowed = "move";
    if (category === "watchlist") {
      event.dataTransfer.setData("text/plain", dragPayload.filmId);
    }
    card.classList.add("dragging");
  });

  container.addEventListener("dragend", (event) => {
    event.target
      .closest("[data-setup-rank-film-id]")
      ?.classList.remove("dragging");
    dragPayload = null;
  });

  container.addEventListener("dragover", (event) => {
    if (!canEdit || isMutating) return;
    let target = event.target.closest("[data-setup-rank-film-id]");
    if (!dragPayload || !target) return;
    let targetShelf = target.closest("[data-watchlist-year-tier]");
    if (
      category === "watchlist" &&
      targetShelf?.dataset.watchlistYearTier !== dragPayload.tier
    )
      return;
    event.preventDefault();
    target.classList.add("drop-target");
  });

  container.addEventListener("dragleave", (event) => {
    event.target
      .closest("[data-setup-rank-film-id]")
      ?.classList.remove("drop-target");
  });

  container.addEventListener("drop", async (event) => {
    let target = event.target.closest("[data-setup-rank-film-id]");
    if (
      !canEdit ||
      isMutating ||
      !dragPayload ||
      !target ||
      target.dataset.setupRankFilmId === dragPayload.filmId
    )
      return;
    event.preventDefault();
    target.classList.remove("drop-target");

    if (category === "watchlist") {
      let targetShelf = target.closest("[data-watchlist-year-tier]");
      if (targetShelf?.dataset.watchlistYearTier !== dragPayload.tier) return;
      let targetIndex = Number(target.dataset.setupRankIndex);
      moveWatchlist(dragPayload.tier, dragPayload.filmId, targetIndex);
      return;
    }

    isMutating = true;
    let bucketEntries = ratingBuckets().get(expandedRatingBucket) || [];
    let targetIndex = Number(target.dataset.setupRankIndex);
    let movingBefore = dragPayload.index < targetIndex;
    let insertIndex = movingBefore ? targetIndex + 1 : targetIndex;
    let beforeEntry = bucketEntries[insertIndex - 1];
    let afterEntry = bucketEntries[insertIndex];
    let beforeFilmId = beforeEntry
      ? beforeEntry.film_id
      : overallNeighborFilmId(bucketEntries[0].film_id, -1);
    let afterFilmId = afterEntry
      ? afterEntry.film_id
      : overallNeighborFilmId(
          bucketEntries[bucketEntries.length - 1].film_id,
          1,
        );
    try {
      await window.moveSupabaseRankingEntryToPosition(
        rankingId,
        dragPayload.filmId,
        allEntries,
        beforeFilmId,
        afterFilmId,
      );
      let loaded = await window.loadSupabaseRanking(scopeKey, scopeType);
      allEntries = loaded.entries;
      render();
    } catch (error) {
      alert(error.message || String(error));
    } finally {
      isMutating = false;
    }
  });

  window.addEventListener("popstate", async () => {
    let nextCategory =
      window.pageQueryParam?.("category") === "watchlist" ||
      Boolean(window.pageQueryParam?.("watchlistYear"))
        ? "watchlist"
        : "watched";
    let nextScope = parseRankingScope();
    if (
      nextCategory !== category ||
      nextScope.scopeKey !== scopeKey ||
      nextScope.scopeType !== scopeType
    ) {
      category = nextCategory;
      scopeType = nextScope.scopeType;
      periodType = nextScope.periodType;
      scopeKey = nextScope.scopeKey;
      valid = nextScope.valid;
      tierFilter = window.pageQueryParam?.("tier") || "";
      shelfPages.clear();
      await initCategory();
      render();
    }
  });

  async function initCategory() {
    if (!valid) return;
    if (category === "watched") {
      await window.loadSupabaseWorkspace({ parts: ["watched"] });
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
    } else {
      await window.loadSupabaseWorkspace({ parts: ["watchlist"] });
      await window.loadWatchlistOrdering?.();
      drafts.clear();
      statusMessage = "";
      expandedWatchlistShelf =
        tierFilter ||
        watchlistShelves().find((s) => s.items.length > 1)?.tier ||
        null;
    }
  }

  async function boot() {
    if (!valid) {
      document.title = "Ranking not found · The Oskars";
      container.innerHTML = `<div class="detail-empty"><h1>${periodType === "year" ? "Year not found" : "Period not found"}</h1><a href="rankings.html">Return to rankings</a></div>`;
      return;
    }
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      await initCategory();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your ranking</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
