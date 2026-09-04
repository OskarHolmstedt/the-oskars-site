/**
 * @file Resolves one year's same-rating ranking shelves, cut over to
 * Supabase for real (issue #432), continuing #420/#421/#422/#429/#430's
 * pattern: gate check -> loadSupabaseWorkspace() +
 * loadSupabaseRanking("alltime", "allTime") -> render -> each action
 * calls its supabase-workspace.js function directly.
 *
 * Filters the single all-time ranking down to one year, same as #429's
 * ranking-review.js (see its header for why year/decade/century rankings
 * are filtered views of one order, not independently-stored per-scope
 * lists). Drag-and-drop reordering within a bucket uses
 * moveSupabaseRankingEntryToPosition() - genuine arbitrary repositioning
 * via fractionalPositionBetween(), unlike #429's swap-only
 * moveSupabaseRankingEntry(). Reordering is bucket-relative (computed
 * from the bucket's own current neighbor positions), matching the
 * previous moveRankedFilmWithinRating()'s behavior exactly: that
 * function also only ever spliced within one rating bucket's own local
 * array, then rebuilt the entire all-time order from bucket-grouped data
 * (guaranteeing bucket contiguity by construction). Supabase's
 * independent per-row position column doesn't auto-guarantee that same
 * contiguity if a film's rating changes after its position was set, but
 * bucket-relative reordering is still correct for what this tool
 * actually promises: keeping one bucket's own relative order right.
 *
 * "Keep this order" reuses resolveSupabaseYearRankingBucket() (marks
 * every film in the bucket confirmed and records every adjacent pair as
 * reviewed via #429's ranking_pair_reviews), so ranking-review.html
 * won't re-ask about a pair already settled here.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("rankYearPage");
  let year = String(window.pageQueryParam?.("year") || "").trim();
  let valid = /^\d{4}$/.test(year);

  let rankingId = null;
  let allEntries = [];
  let watchedByFilmId = new Map();
  let expandedRatingBucket;
  let dragPayload = null;

  function yearEntries() {
    return allEntries.filter((entry) => String(entry.films?.year) === year);
  }

  function ratingBuckets() {
    let buckets = new Map();
    yearEntries().forEach((entry) => {
      let key = window.supabaseRankingRatingKey(watchedByFilmId.get(entry.film_id));
      if (!key) return;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    });
    return buckets;
  }

  function renderRankCard(entry, bucketIndex) {
    let film = entry.films || {};
    return `<article class="film-card ranking-edit-card" draggable="true" data-setup-rank-film-id="${escape(entry.film_id)}" data-setup-rank-index="${escape(bucketIndex)}">
      ${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="" class="rate-watched-poster-thumb">` : ""}
      <span class="table-film-link">${escape(film.title || "Unknown film")}</span>
      ${entry.rank_confirmed === false ? `<span class="film-rank">${escape("NR")}</span>` : ""}
    </article>`;
  }

  function renderRatingBucket(key, bucketEntries) {
    let watched = watchedByFilmId.get(bucketEntries[0].film_id);
    let label = watched?.rating ? window.renderFilmRating(watched) : key;
    if (bucketEntries.length === 1) {
      return `<div class="setup-year-category-row">
        <div class="setup-year-category-header">
          <span class="setup-year-rank-bucket-label">${escape(label)}</span>
          <span class="setup-year-section-empty">${escape(bucketEntries[0].films?.title || "")}</span>
          <span class="setup-ranking-state is-reviewed">Settled</span>
        </div>
      </div>`;
    }
    let reviewed = bucketEntries.every((entry) => entry.rank_confirmed !== false);
    let isExpanded = expandedRatingBucket === key;
    let header = `<div class="setup-year-category-header">
      <span class="setup-year-rank-bucket-label">${escape(label)} <small>(${escape(bucketEntries.length)})</small></span>
      <span class="setup-ranking-state ${reviewed ? "is-reviewed" : "is-mechanical"}">${escape(reviewed ? "Reviewed" : "Mechanical order")}</span>
      <button type="button" class="sort-order-button" data-setup-rank-bucket-toggle="${escape(key)}">${escape(isExpanded ? "Collapse" : "Reorder")}</button>
    </div>`;
    if (!isExpanded) return `<div class="setup-year-category-row">${header}</div>`;
    let cards = bucketEntries.map((entry, index) => renderRankCard(entry, index)).join("");
    return `<div class="setup-year-category-row is-expanded">
      ${header}
      <div class="film-grid setup-year-pool-grid">${cards}</div>
      <div class="setup-ranking-actions"><button type="button" data-setup-rank-confirm="${escape(key)}">Keep this order</button><a class="button-link" href="ranking-review.html?type=years&amp;key=${escape(year)}">Compare two at a time</a></div>
    </div>`;
  }

  function rankingSection() {
    let buckets = ratingBuckets();
    if (!buckets.size) {
      return `<div class="setup-year-section-empty"><p>No rated films yet for ${escape(year)}.</p><a class="button-link" href="rate-watched.html?year=${escape(year)}">Rate this year</a></div>`;
    }
    let orderedKeys = [...buckets.keys()].sort(
      (left, right) =>
        window.supabaseRankingRatingSortValueFromKey(right) -
        window.supabaseRankingRatingSortValueFromKey(left),
    );
    if (expandedRatingBucket === undefined) {
      expandedRatingBucket = orderedKeys.find((key) => buckets.get(key).length > 1) || null;
    }
    let sections = orderedKeys.map((key) => renderRatingBucket(key, buckets.get(key))).join("");
    let multiFilmGroups = orderedKeys.map((key) => buckets.get(key)).filter((group) => group.length > 1);
    let heatComplete = multiFilmGroups.every((group) =>
      group.every((entry) => entry.rank_confirmed !== false),
    );
    let decade = window.getDecadeKey(year);
    return `<p class="setup-year-section-empty">Edits all-time order inside the same exact rating only.</p>
      <div class="setup-year-category-list">${sections}</div>
      <div class="setup-ranking-footer">${heatComplete ? `<span>Year heat complete</span><a class="button-link" href="ranking-review.html?type=decades&amp;key=${escape(decade)}">Continue to ${escape(decade)} finals →</a>` : `<a class="button-link" href="ranking-review.html?type=years&amp;key=${escape(year)}">Compare this year two at a time</a>`}</div>`;
  }

  function render() {
    let finish = window.startOskarsPerformance?.("rankYear:render");
    document.title = `Rank ${year} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">Year ranking</span><h1>${escape(year)}</h1><p>Arrange films only against others with the same exact rating.</p>`,
      actionsHtml: `<a class="button-link" href="build.html">Build your Oskars</a><a class="button-link" href="${escape(window.periodPageUrl("years", year))}">View ${escape(year)}</a>`,
    });
    container.innerHTML = `${header}<section class="setup-year-section"><h2>Ranking shelves</h2>${rankingSection()}</section>`;
    finish?.(`${year} · ${yearEntries().length} films`);
  }

  container.addEventListener("click", async (event) => {
    let toggle = event.target.closest("[data-setup-rank-bucket-toggle]");
    if (toggle) {
      let key = toggle.dataset.setupRankBucketToggle;
      expandedRatingBucket = expandedRatingBucket === key ? null : key;
      render();
      return;
    }
    let confirm = event.target.closest("[data-setup-rank-confirm]");
    if (!confirm) return;
    confirm.disabled = true;
    try {
      let key = confirm.dataset.setupRankConfirm;
      let bucketEntries = ratingBuckets().get(key) || [];
      await window.resolveSupabaseYearRankingBucket(rankingId, year, bucketEntries);
      let loaded = await window.loadSupabaseRanking("alltime", "allTime");
      allEntries = loaded.entries;
      render();
    } catch (error) {
      confirm.disabled = false;
      alert(error.message || String(error));
    }
  });

  container.addEventListener("dragstart", (event) => {
    let card = event.target.closest("[data-setup-rank-film-id]");
    if (!card) return;
    dragPayload = {
      filmId: card.dataset.setupRankFilmId,
      index: Number(card.dataset.setupRankIndex),
    };
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  container.addEventListener("dragend", (event) => {
    event.target.closest("[data-setup-rank-film-id]")?.classList.remove("dragging");
    dragPayload = null;
  });
  container.addEventListener("dragover", (event) => {
    let target = event.target.closest("[data-setup-rank-film-id]");
    if (!dragPayload || !target) return;
    event.preventDefault();
    target.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    event.target.closest("[data-setup-rank-film-id]")?.classList.remove("drop-target");
  });
  // The entry immediately before/after one film in the full all-time
  // order (not the bucket-local order) - the true boundary to fall back
  // to when a move lands at a bucket's own edge, so a film can never
  // drift into a neighboring (differently-rated) bucket's territory just
  // because it moved to the start/end of its own bucket. Without this,
  // moving a film to the end of a bucket that isn't the very last bucket
  // overall would compute a position with no real upper bound at all -
  // found running this for real: it let a 4.5-star film's position
  // overtake a 4-star film's, changing their overall relative order even
  // though the user only meant to reorder within the 4.5-star shelf.
  function overallNeighborFilmId(filmId, direction) {
    let index = allEntries.findIndex((entry) => entry.film_id === filmId);
    if (index < 0) return null;
    let neighbor = allEntries[index + direction];
    return neighbor ? neighbor.film_id : null;
  }

  container.addEventListener("drop", async (event) => {
    let target = event.target.closest("[data-setup-rank-film-id]");
    if (!dragPayload || !target || target.dataset.setupRankFilmId === dragPayload.filmId)
      return;
    event.preventDefault();
    target.classList.remove("drop-target");
    // Drag-and-drop only ever operates within the one currently-expanded
    // bucket - only one bucket can be expanded at a time.
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
      : overallNeighborFilmId(bucketEntries[bucketEntries.length - 1].film_id, 1);
    try {
      await window.moveSupabaseRankingEntryToPosition(
        rankingId,
        dragPayload.filmId,
        allEntries,
        beforeFilmId,
        afterFilmId,
      );
      let loaded = await window.loadSupabaseRanking("alltime", "allTime");
      allEntries = loaded.entries;
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  });

  async function boot() {
    if (!valid) {
      document.title = "Rank a year · The Oskars";
      container.innerHTML = `<div class="detail-empty"><h1>Year not found</h1><a href="index.html">Return home</a></div>`;
      return;
    }
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      await window.loadSupabaseWorkspace();
      let workspace = window.getSupabaseWorkspace();
      watchedByFilmId = new Map((workspace?.watched || []).map((row) => [row.film_id, row]));
      let loaded = await window.loadSupabaseRanking("alltime", "allTime");
      rankingId = loaded.rankingId;
      allEntries = loaded.entries;
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your ranking</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
