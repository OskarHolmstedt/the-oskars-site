/**
 * @file User profile page (issue #982).
 * Presents another member's public archive with tailored Letterboxd-style tabs
 * (Overview, The Oskars, Films, Watchlist, Rankings, Taste Compare) while preserving
 * the viewer's own authenticated session, header, and personal archive context.
 */

(async function () {
  let escape =
    window.pageEscape ||
    ((s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (m) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[m],
      ));
  let container = document.getElementById("userProfilePage");
  if (!container) return;

  let finishRender = window.startOskarsPerformance?.("user:render");

  function formatNumber(num) {
    return Number(num || 0).toLocaleString(window.oskarsLocale?.() || "en");
  }

  function safePosterUrl(film) {
    let url = film?.poster?.url || "";
    return /^https?:\/\//.test(url) ? url : "";
  }

  let searchParams = new URLSearchParams(window.location.search || "");
  let slug = String(
    searchParams.get("u") || searchParams.get("profile") || "",
  ).trim();

  // If no slug is specified in query parameters, check if the signed-in user has their own profile.
  if (!slug) {
    let auth = await window.resolveSupabaseAuthState?.().catch(() => null);
    if (auth?.status === "signed-in") {
      let myProfile = await window.loadSupabaseProfile?.().catch(() => null);
      if (myProfile?.public_slug) {
        window.location.replace(
          `user.html?u=${encodeURIComponent(myProfile.public_slug)}`,
        );
        return;
      }
    }
    container.innerHTML = `
      <div class="detail-empty">
        <span class="eyebrow">Member Profile</span>
        <h1>No user specified</h1>
        <p>Explore member archives in Community or visit your own profile settings.</p>
        <div class="data-actions" style="justify-content: center; margin-top: 16px;">
          <a class="button-link button-primary" href="community.html">Explore Community</a>
          <a class="button-link button-secondary" href="profile.html">Profile Settings</a>
        </div>
      </div>
    `;
    finishRender?.("empty");
    return;
  }

  // Fetch target user's validated public projection without touching window.state
  let fetchResult = await window.fetchSupabasePublicProfileProjection(slug);
  if (!fetchResult.ok) {
    if (fetchResult.error === "not-found") {
      container.innerHTML = `
        <div class="detail-empty">
          <span class="eyebrow">Member Profile</span>
          <h1>Profile not found</h1>
          <p>No published profile exists with the link &quot;${escape(slug)}&quot;.</p>
          <div class="data-actions" style="justify-content: center; margin-top: 16px;">
            <a class="button-link button-primary" href="community.html">Browse Community</a>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="detail-empty">
          <span class="eyebrow">Error</span>
          <h1>Could not load profile</h1>
          <p>${escape(fetchResult.detail || fetchResult.error || "Could not load archive.")}</p>
          <div class="data-actions" style="justify-content: center; margin-top: 16px;">
            <button type="button" class="button-secondary" onclick="window.location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
    finishRender?.("error");
    return;
  }

  let targetData = fetchResult.data || {};
  let ownerName = fetchResult.ownerName || slug;

  // Flatten watched films from years (excluding alltime bracket) and flat watchedFilms
  let watchedFromYears = Object.entries(targetData.years || {})
    .filter(([yearKey]) => yearKey !== "alltime")
    .flatMap(([, yearGroup]) => yearGroup.films || []);
  let allWatchedFilms = [
    ...watchedFromYears,
    ...(targetData.watchedFilms || []),
  ];

  // Public profile and social state
  let targetUserId = fetchResult.id || null;
  let viewerAuth = await window.resolveSupabaseAuthState?.().catch(() => null);
  let followState = {
    isFollowing: false,
    isMutualFriend: false,
    loading: false,
  };

  async function checkFollowStatus() {
    if (window.checkSupabaseFollowing && slug) {
      try {
        let res = await window.checkSupabaseFollowing(slug);
        followState.isFollowing = Boolean(res.isFollowing);
        followState.isMutualFriend = Boolean(res.isMutualFriend);
        if (res.targetUserId) targetUserId = res.targetUserId;
        renderHeroActions();
      } catch (err) {
        console.warn("Follow check failed:", err);
      }
    }
  }

  // Signature 4: All-time ranking leads, fallback to highest-rated films
  let allTimeFilms = (targetData.years?.alltime?.films || []).slice();
  let signatureFilms = [];
  if (allTimeFilms.length >= 4) {
    signatureFilms = allTimeFilms.slice(0, 4);
  } else {
    signatureFilms = [...allTimeFilms];
    let candidatePool = allWatchedFilms
      .filter((f) => !signatureFilms.some((s) => s.id === f.id))
      .sort((a, b) => {
        let rA = Number(a.ratingValue) || 0;
        let rB = Number(b.ratingValue) || 0;
        if (rB !== rA) return rB - rA;
        let yA = Number(a.year) || 0;
        let yB = Number(b.year) || 0;
        if (yB !== yA) return yB - yA;
        return a.title.localeCompare(b.title);
      });
    signatureFilms.push(...candidatePool.slice(0, 4 - signatureFilms.length));
  }

  // Public watchlist
  let publicWatchlist = targetData.watchlist || [];

  // Gather ceremonies data
  let ceremonyMap = new Map();
  allWatchedFilms.forEach((film) => {
    (film.awards || []).forEach((award) => {
      let key = String(award.year || film.year || "alltime");
      let ceremony = ceremonyMap.get(key) || {
        key,
        periodType:
          award.periodType || (/^\d{4}$/.test(key) ? "years" : "period"),
        awards: [],
        films: new Set(),
      };
      ceremony.awards.push({ ...award, film });
      ceremony.films.add(film);
      ceremonyMap.set(key, ceremony);
    });
  });
  let ceremonyList = Array.from(ceremonyMap.values()).sort((a, b) => {
    let isYearA = /^\d{4}$/.test(a.key);
    let isYearB = /^\d{4}$/.test(b.key);
    if (isYearA && isYearB) return Number(b.key) - Number(a.key);
    if (isYearA) return -1;
    if (isYearB) return 1;
    return a.key.localeCompare(b.key);
  });

  // Check viewer's own archive context from window.state (non-destructive)
  let viewerState = window.state || {};
  let viewerWatchedMap = new Map();
  let viewerWatchlistMap = new Map();

  function indexViewerArchive() {
    viewerWatchedMap.clear();
    viewerWatchlistMap.clear();

    let vYears = viewerState.years || {};
    let vWatched = Object.entries(vYears)
      .filter(([k]) => k !== "alltime")
      .flatMap(([, g]) => g.films || [])
      .concat(viewerState.watchedFilms || []);

    vWatched.forEach((f) => {
      if (f.id) viewerWatchedMap.set(f.id, f);
      let normKey = `${f.year || ""}::${(f.title || "").toLowerCase().trim()}`;
      viewerWatchedMap.set(normKey, f);
    });

    (viewerState.watchlist || []).forEach((item) => {
      if (item.id) viewerWatchlistMap.set(item.id, item);
      let normKey = `${item.year || ""}::${(item.title || "").toLowerCase().trim()}`;
      viewerWatchlistMap.set(normKey, item);
    });
  }

  indexViewerArchive();

  function getViewerFilm(film) {
    if (!film) return null;
    let normKey = `${film.year || ""}::${(film.title || "").toLowerCase().trim()}`;
    return (
      viewerWatchedMap.get(film.id) || viewerWatchedMap.get(normKey) || null
    );
  }

  function getViewerWatchlistItem(film) {
    if (!film) return null;
    let normKey = `${film.year || ""}::${(film.title || "").toLowerCase().trim()}`;
    return (
      viewerWatchlistMap.get(film.id) || viewerWatchlistMap.get(normKey) || null
    );
  }

  // Active tab state
  let validTabs = [
    "overview",
    "ceremonies",
    "films",
    "watchlist",
    "rankings",
    "compare",
  ];
  let hashTab = (window.location.hash || "").replace("#", "").toLowerCase();
  let paramTab = (searchParams.get("tab") || "").toLowerCase();
  let activeTab = validTabs.includes(hashTab)
    ? hashTab
    : validTabs.includes(paramTab)
      ? paramTab
      : "overview";

  // State for films filtering & sorting
  let filmFilters = {
    search: "",
    decade: "all",
    ratingMin: "all",
    sort: "rating-desc",
    ratingDisplay: "both",
  };

  // State for watchlist filtering
  let watchlistFilters = {
    filter: "all",
    search: "",
    sort: "default",
  };

  // State for rankings tab
  let rankingsScope = "allTime";

  // Build Profile Header & Hero
  function renderProfileHero() {
    let initial = Array.from(ownerName)[0]?.toUpperCase() || "?";
    let isOwnProfile = Boolean(
      targetUserId && viewerAuth?.user?.id === targetUserId,
    );

    let totalWatched = allWatchedFilms.length;
    let totalCeremonies = ceremonyList.length;
    let totalWatchlist = publicWatchlist.length;
    let topRatedCount = allWatchedFilms.filter(
      (f) => (Number(f.ratingValue) || 0) >= 4.5,
    ).length;

    let avgRating = "";
    let ratedFilms = allWatchedFilms.filter(
      (f) => (Number(f.ratingValue) || 0) > 0,
    );
    if (ratedFilms.length) {
      let sum = ratedFilms.reduce(
        (acc, f) => acc + (Number(f.ratingValue) || 0),
        0,
      );
      avgRating = (sum / ratedFilms.length).toFixed(1);
    }

    return `
      <section class="user-profile-hero" aria-label="${escape(ownerName)}'s Profile">
        <div class="user-profile-header-main">
          <div class="user-profile-avatar" aria-hidden="true">
            <span>${escape(initial)}</span>
          </div>
          <div class="user-profile-identity">
            <div class="user-profile-badges">
              <span class="data-source-badge data-source-badge--connected">Public Archive</span>
              ${isOwnProfile ? `<span class="data-source-badge" style="background:var(--accent);color:#fff">You</span>` : ""}
            </div>
            <h1 class="user-profile-name">${escape(ownerName)}</h1>
            <p class="user-profile-bio">
              Film archive and personal awards on The Oskars.
            </p>
            <div class="user-profile-actions" id="userProfileHeroActions">
              ${
                !isOwnProfile
                  ? `<button type="button" class="${followState.isFollowing ? "button-secondary" : "button-primary"} user-profile-action-btn" data-profile-action="toggle-follow" ${followState.loading ? "disabled" : ""}>
                      ${
                        followState.isFollowing
                          ? followState.isMutualFriend
                            ? "✓ Friends"
                            : "✓ Following"
                          : "+ Follow"
                      }
                    </button>`
                  : ""
              }
              <button type="button" class="button-secondary user-profile-action-btn" data-profile-action="copy-link">
                <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"/></svg>
                Share profile
              </button>
              ${isOwnProfile ? `<a class="button-link button-secondary user-profile-action-btn" href="profile.html">Edit settings</a>` : ""}
            </div>
          </div>
        </div>

        <div class="user-profile-stats" role="region" aria-label="Archive Statistics">
          <div class="user-profile-stat-box">
            <span class="user-profile-stat-value">${formatNumber(totalWatched)}</span>
            <span class="user-profile-stat-label">Films</span>
          </div>
          <div class="user-profile-stat-box">
            <span class="user-profile-stat-value">${formatNumber(totalCeremonies)}</span>
            <span class="user-profile-stat-label">Ceremonies</span>
          </div>
          <div class="user-profile-stat-box">
            <span class="user-profile-stat-value">${formatNumber(totalWatchlist)}</span>
            <span class="user-profile-stat-label">Watchlist</span>
          </div>
          <div class="user-profile-stat-box">
            <span class="user-profile-stat-value">${formatNumber(topRatedCount)}</span>
            <span class="user-profile-stat-label">Top Rated</span>
          </div>
          <div class="user-profile-stat-box">
            <span class="user-profile-stat-value">${avgRating ? `${avgRating} ★` : "—"}</span>
            <span class="user-profile-stat-label">Avg Rating</span>
          </div>
        </div>
      </section>
    `;
  }

  // Render Signature 4 Films Shelf
  function renderSignatureShelf() {
    if (!signatureFilms.length) return "";
    return `
      <section class="user-signature-shelf" aria-labelledby="signatureHeading">
        <div class="user-signature-header">
          <div>
            <span class="eyebrow">Hall of Fame</span>
            <h2 id="signatureHeading">Favorite Films</h2>
          </div>
          <p class="user-signature-subtext">Signature four picks</p>
        </div>
        <div class="user-signature-grid">
          ${signatureFilms
            .map((film, index) => {
              let posterUrl = safePosterUrl(film);
              let ratingStr = film.rating
                ? window.renderFilmRatingHtml?.(film, { escape })
                : "";
              let rank = index + 1;
              return `
                <article class="user-signature-card" data-open-film-id="${escape(film.id || "")}">
                  <span class="user-signature-rank-badge">#${rank}</span>
                  <div class="user-signature-poster-wrap">
                    ${posterUrl ? `<img src="${escape(posterUrl)}" alt="${escape(film.title)}" loading="lazy" decoding="async">` : `<div class="film-poster-placeholder">${escape(film.title)}</div>`}
                  </div>
                  <div class="user-signature-info">
                    <h3 class="user-signature-title"><a href="${escape(window.filmPageUrl?.(film.id) || `film.html?id=${encodeURIComponent(film.id)}`)}">${escape(film.title)}</a></h3>
                    <div class="user-signature-meta">
                      <span>${escape(film.year || "")}</span>
                      ${ratingStr ? `<span class="rating">${ratingStr}</span>` : ""}
                    </div>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  // Render Tabs Navigation Bar
  function renderTabsNav() {
    let tabs = [
      { id: "overview", label: "Overview" },
      { id: "ceremonies", label: "The Oskars" },
      { id: "films", label: `Films (${formatNumber(allWatchedFilms.length)})` },
      {
        id: "watchlist",
        label: `Watchlist (${formatNumber(publicWatchlist.length)})`,
      },
      { id: "rankings", label: "Rankings" },
      { id: "compare", label: "Taste Compare" },
    ];

    return `
      <nav class="user-profile-tabs period-view-controls" role="tablist" aria-label="Profile views">
        ${tabs
          .map(
            (tab) => `
              <button
                type="button"
                role="tab"
                id="tab-${tab.id}"
                class="period-view-pill user-tab-pill${activeTab === tab.id ? " is-active" : ""}"
                aria-selected="${activeTab === tab.id ? "true" : "false"}"
                aria-controls="panel-${tab.id}"
                data-tab-target="${tab.id}"
              >
                ${escape(tab.label)}
              </button>
            `,
          )
          .join("")}
      </nav>
    `;
  }

  // Quick Action Buttons on a Film Card
  function renderFilmCardActions(film) {
    let viewerWatchlist = getViewerWatchlistItem(film);
    let inWatchlist = Boolean(viewerWatchlist);
    let viewerWatched = getViewerFilm(film);
    let isWatchedByViewer = Boolean(viewerWatched);

    let watchlistTitle = inWatchlist
      ? "Remove from your watchlist"
      : "Add to your watchlist";
    let watchlistLabel = inWatchlist ? "✓" : "+";

    return `
      <div class="user-card-actions" data-film-id="${escape(film.id)}" data-film-title="${escape(film.title)}" data-film-year="${escape(film.year || "")}">
        <button
          type="button"
          class="user-card-action-btn user-action-watchlist${inWatchlist ? " is-active" : ""}"
          data-user-action="toggle-watchlist"
          aria-label="${escape(watchlistTitle)}"
          title="${escape(watchlistTitle)}"
          aria-pressed="${inWatchlist ? "true" : "false"}"
        >
          <span aria-hidden="true">${watchlistLabel}</span> Watchlist
        </button>
        <button
          type="button"
          class="user-card-action-btn user-action-rate${isWatchedByViewer ? " is-rated" : ""}"
          data-user-action="rate"
          title="${escape(isWatchedByViewer ? "Update your rating" : "Rate this film")}"
        >
          ★ ${isWatchedByViewer && viewerWatched.ratingValue ? escape(Number(viewerWatched.ratingValue).toFixed(1)) : "Rate"}
        </button>
      </div>
    `;
  }

  // Single Film Card in Grid
  function renderProfileFilmCard(film, options = {}) {
    let posterUrl = safePosterUrl(film);
    let viewerFilm = getViewerFilm(film);
    let viewerRating =
      viewerFilm?.ratingValue != null ? Number(viewerFilm.ratingValue) : null;

    let targetRatingHtml = film.rating
      ? window.renderFilmRatingHtml?.(film, { escape })
      : "";
    let viewerRatingHtml = viewerFilm?.rating
      ? window.renderFilmRatingHtml?.(viewerFilm, { escape })
      : viewerRating != null
        ? `${viewerRating} ★`
        : "";

    let displayMode = options.ratingDisplay || filmFilters.ratingDisplay;

    let ratingSectionHtml;
    if (displayMode === "target") {
      ratingSectionHtml = targetRatingHtml
        ? `<div class="user-film-rating-row"><span class="user-film-rating-badge user-rating-target">${targetRatingHtml}</span></div>`
        : "";
    } else if (displayMode === "viewer") {
      ratingSectionHtml = `
        <div class="user-film-rating-row">
          <span class="user-film-rating-badge user-rating-viewer">${viewerRatingHtml || `<small class="unseen-label">Unwatched</small>`}</span>
        </div>
      `;
    } else {
      ratingSectionHtml = `
        <div class="user-film-rating-row user-film-rating-row--dual">
          <span class="user-film-rating-badge user-rating-target" title="${escape(ownerName)}'s rating">
            <small>${escape(ownerName)}:</small> ${targetRatingHtml || "—"}
          </span>
          <span class="user-film-rating-badge user-rating-viewer" title="Your rating">
            <small>You:</small> ${viewerRatingHtml || `<small class="unseen-label">Unwatched</small>`}
          </span>
        </div>
      `;
    }

    return `
      <article class="user-film-card" data-film-id="${escape(film.id || "")}">
        <div class="user-film-poster-container">
          ${posterUrl ? `<img src="${escape(posterUrl)}" alt="${escape(film.title)}" loading="lazy" decoding="async">` : `<div class="film-poster-placeholder">${escape(film.title)}</div>`}
        </div>
        <div class="user-film-card-content">
          <h3 class="user-film-title">
            <a href="${escape(window.filmPageUrl?.(film.id) || `film.html?id=${encodeURIComponent(film.id)}`)}">${escape(film.title)}</a>
          </h3>
          <p class="user-film-meta">
            <span>${escape(film.year || "")}</span>
            ${film.director ? `<span class="user-film-director" title="${escape(film.director)}">${escape(film.director)}</span>` : ""}
          </p>
          ${ratingSectionHtml}
          ${renderFilmCardActions(film)}
        </div>
      </article>
    `;
  }

  // Tab 1: Overview Tab Content
  function renderOverviewTab() {
    let topRated = allWatchedFilms
      .filter((f) => (Number(f.ratingValue) || 0) >= 4.0)
      .sort(
        (a, b) =>
          (Number(b.ratingValue) || 0) - (Number(a.ratingValue) || 0) ||
          Number(b.year) - Number(a.year),
      )
      .slice(0, 10);

    let recentCeremonyWinners = ceremonyList
      .slice(0, 4)
      .map((ceremony) => {
        let bestPic = ceremony.awards.find(
          (a) =>
            /Best Picture|Best Film|Bästa film/i.test(a.category) &&
            Number(a.placement) === 1,
        );
        if (!bestPic)
          bestPic = ceremony.awards.find((a) => Number(a.placement) === 1);
        return { ceremony, award: bestPic };
      })
      .filter((item) => item.award);

    let diaryFilms = allWatchedFilms
      .filter((f) => Boolean(f.dateWatched))
      .sort((a, b) =>
        String(b.dateWatched).localeCompare(String(a.dateWatched)),
      )
      .slice(0, 6);

    return `
      <div class="user-tab-panel" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
        ${renderSignatureShelf()}

        ${
          topRated.length
            ? `
          <section class="user-overview-section" aria-labelledby="topRatedHeading">
            <div class="user-section-title-row">
              <div>
                <span class="eyebrow">Highest rated</span>
                <h2 id="topRatedHeading">Top Rated Films</h2>
              </div>
              <button type="button" class="button-link" data-switch-tab="films" data-filter-rating="4">View all →</button>
            </div>
            <div class="user-card-scroll-row">
              ${topRated.map((f) => renderProfileFilmCard(f, { ratingDisplay: "target" })).join("")}
            </div>
          </section>
        `
            : ""
        }

        ${
          recentCeremonyWinners.length
            ? `
          <section class="user-overview-section" aria-labelledby="recentWinnersHeading">
            <div class="user-section-title-row">
              <div>
                <span class="eyebrow">The Oskars</span>
                <h2 id="recentWinnersHeading">Recent Ceremony Winners</h2>
              </div>
              <button type="button" class="button-link" data-switch-tab="ceremonies">All ceremonies →</button>
            </div>
            <div class="user-ceremony-winner-grid">
              ${recentCeremonyWinners
                .map(({ ceremony, award }) => {
                  let film = award.film;
                  let posterUrl = safePosterUrl(film);
                  return `
                    <article class="user-winner-highlight-card">
                      <div class="user-winner-poster">
                        ${posterUrl ? `<img src="${escape(posterUrl)}" alt="${escape(film.title)}" loading="lazy">` : `<div class="film-poster-placeholder">${escape(film.title)}</div>`}
                      </div>
                      <div class="user-winner-details">
                        <span class="eyebrow">${escape(ceremony.key)} · ${escape(award.category)}</span>
                        <h3><a href="${escape(window.filmPageUrl?.(film.id) || `film.html?id=${encodeURIComponent(film.id)}`)}">${escape(film.title)}</a></h3>
                        <p>${escape(film.year || "")}${film.director ? ` · ${escape(film.director)}` : ""}</p>
                        ${film.rating ? `<span class="rating">${window.renderFilmRatingHtml?.(film, { escape })}</span>` : ""}
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          </section>
        `
            : ""
        }

        ${
          diaryFilms.length
            ? `
          <section class="user-overview-section" aria-labelledby="diaryHeading">
            <div class="user-section-title-row">
              <div>
                <span class="eyebrow">Viewing History</span>
                <h2 id="diaryHeading">Recent Activity &amp; Diary</h2>
              </div>
            </div>
            <div class="user-diary-list">
              ${diaryFilms
                .map((film) => {
                  let posterUrl = safePosterUrl(film);
                  return `
                    <div class="user-diary-item">
                      <div class="user-diary-poster">
                        ${posterUrl ? `<img src="${escape(posterUrl)}" alt="" loading="lazy">` : ""}
                      </div>
                      <div class="user-diary-info">
                        <strong><a href="${escape(window.filmPageUrl?.(film.id) || `film.html?id=${encodeURIComponent(film.id)}`)}">${escape(film.title)}</a></strong>
                        <span>(${escape(film.year || "")})</span>
                        ${film.rating ? `<span class="rating">${window.renderFilmRatingHtml?.(film, { escape })}</span>` : ""}
                        ${film.platform ? `<span class="user-diary-platform">${escape(film.platform)}</span>` : ""}
                      </div>
                      <time class="user-diary-date" datetime="${escape(film.dateWatched)}">${escape(film.dateWatched)}</time>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </section>
        `
            : ""
        }
      </div>
    `;
  }

  // Tab 2: The Oskars Ceremonies & Brackets Content
  function renderCeremoniesTab() {
    if (!ceremonyList.length) {
      return `
        <div class="user-tab-panel" id="panel-ceremonies" role="tabpanel" aria-labelledby="tab-ceremonies">
          <div class="detail-empty">
            <h2>0 ceremonies recorded</h2>
            <p>This member hasn't held any award ceremonies yet.</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="user-tab-panel" id="panel-ceremonies" role="tabpanel" aria-labelledby="tab-ceremonies">
        <header class="user-subpanel-header">
          <div>
            <span class="eyebrow">Personal Awards</span>
            <h2>Ceremonies &amp; Brackets</h2>
            <p>Award winners, nominations, and ballots across years, decades, and all-time.</p>
          </div>
        </header>

        <div class="user-ceremonies-timeline">
          ${ceremonyList
            .map((ceremony) => {
              let winners = ceremony.awards.filter(
                (a) => Number(a.placement) === 1,
              );
              let bestPic =
                winners.find((a) =>
                  /Best Picture|Best Film|Bästa film/i.test(a.category),
                ) || winners[0];

              let isYear = /^\d{4}$/.test(ceremony.key);
              let title = isYear ? `The ${ceremony.key} Oskars` : ceremony.key;

              return `
                <article class="user-ceremony-timeline-card">
                  <div class="user-ceremony-header-row">
                    <div>
                      <span class="eyebrow">${escape(ceremony.periodType)}</span>
                      <h3>${escape(title)}</h3>
                    </div>
                    <span class="user-ceremony-stats-pill">
                      ${formatNumber(ceremony.films.size)} films · ${formatNumber(ceremony.awards.length)} awards
                    </span>
                  </div>

                  ${
                    bestPic
                      ? `
                    <div class="user-ceremony-spotlight">
                      <div class="user-ceremony-spotlight-poster">
                        ${safePosterUrl(bestPic.film) ? `<img src="${escape(safePosterUrl(bestPic.film))}" alt="${escape(bestPic.film.title)}" loading="lazy">` : ""}
                      </div>
                      <div class="user-ceremony-spotlight-content">
                        <span class="user-award-crown">🏆 ${escape(bestPic.category)}</span>
                        <h4><a href="${escape(window.filmPageUrl?.(bestPic.film.id) || `film.html?id=${encodeURIComponent(bestPic.film.id)}`)}">${escape(bestPic.film.title)}</a></h4>
                        <p>${escape(bestPic.film.year || "")}${bestPic.film.director ? ` · ${escape(bestPic.film.director)}` : ""}</p>
                        ${bestPic.recipientText ? `<p class="user-award-recipient">${escape(bestPic.recipientText)}</p>` : ""}
                      </div>
                    </div>
                  `
                      : ""
                  }

                  <div class="user-ceremony-winners-list">
                    <h5>Award Winners</h5>
                    <div class="user-ceremony-awards-compact-grid">
                      ${winners
                        .map(
                          (award) => `
                            <div class="user-award-mini-row">
                              <span class="user-award-category">${escape(award.category)}:</span>
                              <strong class="user-award-winner-title"><a href="${escape(window.filmPageUrl?.(award.film.id) || `film.html?id=${encodeURIComponent(award.film.id)}`)}">${escape(award.film.title)}</a></strong>
                              ${award.recipientText ? `<small>(${escape(award.recipientText)})</small>` : ""}
                            </div>
                          `,
                        )
                        .join("")}
                    </div>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  // Tab 3: Films Grid Content
  function renderFilmsTab() {
    let filtered = allWatchedFilms.filter((film) => {
      if (filmFilters.search) {
        let q = filmFilters.search.toLowerCase();
        let matchTitle = (film.title || "").toLowerCase().includes(q);
        let matchDirector = (film.director || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDirector) return false;
      }
      if (filmFilters.decade !== "all") {
        let yr = Number(film.year);
        let dec = Number(filmFilters.decade);
        if (isNaN(yr) || yr < dec || yr >= dec + 10) return false;
      }
      if (filmFilters.ratingMin !== "all") {
        let min = Number(filmFilters.ratingMin);
        if ((Number(film.ratingValue) || 0) < min) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (filmFilters.sort === "rating-desc") {
        let diff = (Number(b.ratingValue) || 0) - (Number(a.ratingValue) || 0);
        if (diff !== 0) return diff;
      } else if (filmFilters.sort === "rating-asc") {
        let diff = (Number(a.ratingValue) || 0) - (Number(b.ratingValue) || 0);
        if (diff !== 0) return diff;
      } else if (filmFilters.sort === "year-desc") {
        let diff = (Number(b.year) || 0) - (Number(a.year) || 0);
        if (diff !== 0) return diff;
      } else if (filmFilters.sort === "year-asc") {
        let diff = (Number(a.year) || 0) - (Number(b.year) || 0);
        if (diff !== 0) return diff;
      } else if (filmFilters.sort === "title-asc") {
        return (a.title || "").localeCompare(b.title || "");
      } else if (filmFilters.sort === "viewer-rating") {
        let vA = getViewerFilm(a)?.ratingValue || 0;
        let vB = getViewerFilm(b)?.ratingValue || 0;
        if (vB !== vA) return vB - vA;
      }
      return (b.year || 0) - (a.year || 0);
    });

    let decades = new Set();
    allWatchedFilms.forEach((f) => {
      let yr = Number(f.year);
      if (yr >= 1900 && yr <= 2099) {
        decades.add(Math.floor(yr / 10) * 10);
      }
    });
    let sortedDecades = Array.from(decades).sort((a, b) => b - a);

    return `
      <div class="user-tab-panel" id="panel-films" role="tabpanel" aria-labelledby="tab-films">
        <header class="user-films-toolbar">
          <div class="user-films-search-box">
            <input
              type="search"
              id="userFilmsSearchInput"
              placeholder="Filter by title or director…"
              value="${escape(filmFilters.search)}"
              aria-label="Search watched films"
            >
          </div>

          <div class="user-films-filters-row">
            <label class="user-select-filter">
              <span>Decade:</span>
              <select id="userFilmsDecadeSelect">
                <option value="all"${filmFilters.decade === "all" ? " selected" : ""}>All Decades</option>
                ${sortedDecades
                  .map(
                    (d) =>
                      `<option value="${d}"${filmFilters.decade === String(d) ? " selected" : ""}>${d}s</option>`,
                  )
                  .join("")}
              </select>
            </label>

            <label class="user-select-filter">
              <span>Rating:</span>
              <select id="userFilmsRatingSelect">
                <option value="all"${filmFilters.ratingMin === "all" ? " selected" : ""}>All Ratings</option>
                <option value="5"${filmFilters.ratingMin === "5" ? " selected" : ""}>5★</option>
                <option value="4"${filmFilters.ratingMin === "4" ? " selected" : ""}>4★+</option>
                <option value="3"${filmFilters.ratingMin === "3" ? " selected" : ""}>3★+</option>
                <option value="2"${filmFilters.ratingMin === "2" ? " selected" : ""}>2★+</option>
              </select>
            </label>

            <label class="user-select-filter">
              <span>Sort:</span>
              <select id="userFilmsSortSelect">
                <option value="rating-desc"${filmFilters.sort === "rating-desc" ? " selected" : ""}>Highest Rated</option>
                <option value="year-desc"${filmFilters.sort === "year-desc" ? " selected" : ""}>Release Year (Newest)</option>
                <option value="year-asc"${filmFilters.sort === "year-asc" ? " selected" : ""}>Release Year (Oldest)</option>
                <option value="title-asc"${filmFilters.sort === "title-asc" ? " selected" : ""}>Title (A-Z)</option>
                <option value="viewer-rating"${filmFilters.sort === "viewer-rating" ? " selected" : ""}>My Rating</option>
              </select>
            </label>

            <label class="user-select-filter">
              <span>Ratings shown:</span>
              <select id="userFilmsCompareToggle">
                <option value="both"${filmFilters.ratingDisplay === "both" ? " selected" : ""}>Compare Both</option>
                <option value="target"${filmFilters.ratingDisplay === "target" ? " selected" : ""}>${escape(ownerName)}</option>
                <option value="viewer"${filmFilters.ratingDisplay === "viewer" ? " selected" : ""}>My Ratings</option>
              </select>
            </label>
          </div>
        </header>

        <p class="user-results-count" aria-live="polite">
          ${formatNumber(filtered.length)} films matched
        </p>

        ${
          filtered.length
            ? `
          <div class="user-films-grid">
            ${filtered.map((film) => renderProfileFilmCard(film)).join("")}
          </div>
        `
            : `
          <div class="detail-empty">
            <h2>No films matched</h2>
            <p>Try adjusting your filters or search query.</p>
          </div>
        `
        }
      </div>
    `;
  }

  // Tab 4: Watchlist Content
  function renderWatchlistTab() {
    let mutualCount = publicWatchlist.filter((item) =>
      Boolean(getViewerWatchlistItem(item)),
    ).length;
    let unseenCount = publicWatchlist.filter(
      (item) => !getViewerFilm(item),
    ).length;
    let seenCount = publicWatchlist.filter((item) =>
      Boolean(getViewerFilm(item)),
    ).length;

    let filtered = publicWatchlist.filter((item) => {
      if (watchlistFilters.search) {
        let q = watchlistFilters.search.toLowerCase();
        let matchTitle = (item.title || "").toLowerCase().includes(q);
        let matchDirector = (item.director || "").toLowerCase().includes(q);
        if (!matchTitle && !matchDirector) return false;
      }
      if (watchlistFilters.filter === "mutual") {
        return Boolean(getViewerWatchlistItem(item));
      }
      if (watchlistFilters.filter === "unseen") {
        return !getViewerFilm(item);
      }
      if (watchlistFilters.filter === "seen") {
        return Boolean(getViewerFilm(item));
      }
      return true;
    });

    return `
      <div class="user-tab-panel" id="panel-watchlist" role="tabpanel" aria-labelledby="tab-watchlist">
        <header class="user-watchlist-toolbar">
          <div class="user-watchlist-filter-pills period-view-controls" role="group" aria-label="Watchlist mutual filters">
            <button type="button" class="period-view-pill${watchlistFilters.filter === "all" ? " is-active" : ""}" data-watchlist-filter="all">
              All (${formatNumber(publicWatchlist.length)})
            </button>
            <button type="button" class="period-view-pill${watchlistFilters.filter === "mutual" ? " is-active" : ""}" data-watchlist-filter="mutual">
              🤝 On both our watchlists (${formatNumber(mutualCount)})
            </button>
            <button type="button" class="period-view-pill${watchlistFilters.filter === "unseen" ? " is-active" : ""}" data-watchlist-filter="unseen">
              ✨ Unseen by me (${formatNumber(unseenCount)})
            </button>
            <button type="button" class="period-view-pill${watchlistFilters.filter === "seen" ? " is-active" : ""}" data-watchlist-filter="seen">
              ✓ Seen by me (${formatNumber(seenCount)})
            </button>
          </div>

          <div class="user-films-search-box" style="margin-top: 10px;">
            <input
              type="search"
              id="userWatchlistSearchInput"
              placeholder="Search watchlist…"
              value="${escape(watchlistFilters.search)}"
              aria-label="Search watchlist"
            >
          </div>
        </header>

        <p class="user-results-count" aria-live="polite">
          ${formatNumber(filtered.length)} items
        </p>

        ${
          filtered.length
            ? `
          <div class="user-films-grid">
            ${filtered
              .map((item) => {
                let posterUrl = safePosterUrl(item);
                let onViewerWatchlist = Boolean(getViewerWatchlistItem(item));
                let viewerFilm = getViewerFilm(item);

                let statusBadge;
                if (onViewerWatchlist) {
                  statusBadge = `<span class="user-film-badge user-film-badge--mutual">🤝 In your watchlist</span>`;
                } else if (viewerFilm) {
                  statusBadge = `<span class="user-film-badge user-film-badge--watched">✓ You watched ${viewerFilm.rating ? `(${viewerFilm.rating})` : ""}</span>`;
                } else {
                  statusBadge = `<span class="user-film-badge user-film-badge--unseen">✨ Unseen by you</span>`;
                }

                return `
                  <article class="user-film-card" data-film-id="${escape(item.id || "")}">
                    <div class="user-film-poster-container">
                      ${posterUrl ? `<img src="${escape(posterUrl)}" alt="${escape(item.title)}" loading="lazy">` : `<div class="film-poster-placeholder">${escape(item.title)}</div>`}
                    </div>
                    <div class="user-film-card-content">
                      <h3 class="user-film-title">
                        <a href="${escape(window.filmPageUrl?.(item.id) || `film.html?id=${encodeURIComponent(item.id)}`)}">${escape(item.title)}</a>
                      </h3>
                      <p class="user-film-meta">
                        <span>${escape(item.year || "")}</span>
                        ${item.tier ? `<span class="data-source-badge">${escape(window.renderTierWithModifier ? window.renderTierWithModifier(item.tier, item.tier_modifier || item.tierModifier) : item.tier)}</span>` : ""}
                        ${item.director ? `<span class="user-film-director" title="${escape(item.director)}">${escape(item.director)}</span>` : ""}
                      </p>
                      <div class="user-film-status-row">
                        ${statusBadge}
                      </div>
                      <div class="user-card-actions" data-film-id="${escape(item.id)}" data-film-title="${escape(item.title)}" data-film-year="${escape(item.year || "")}">
                        <button
                          type="button"
                          class="user-card-action-btn user-action-watchlist${onViewerWatchlist ? " is-active" : ""}"
                          data-user-action="toggle-watchlist"
                          aria-pressed="${onViewerWatchlist ? "true" : "false"}"
                        >
                          <span aria-hidden="true">${onViewerWatchlist ? "✓" : "+"}</span> ${onViewerWatchlist ? "In watchlist" : "Watchlist"}
                        </button>
                      </div>
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        `
            : `
          <div class="detail-empty">
            <h2>No watchlist items found</h2>
            <p>No films matched the current watchlist filter.</p>
          </div>
        `
        }
      </div>
    `;
  }

  // Tab 5: Rankings Tab Content
  function renderRankingsTab() {
    let list;
    if (rankingsScope === "allTime") {
      list = (targetData.years?.alltime?.films || []).slice(0, 100);
    } else {
      let yearGroup = targetData.years?.[rankingsScope];
      list = (yearGroup?.films || []).slice();
    }

    let availableScopes = Object.keys(targetData.years || {})
      .filter((k) => k !== "alltime" && /^\d{4}$/.test(k))
      .sort((a, b) => Number(b) - Number(a));

    return `
      <div class="user-tab-panel" id="panel-rankings" role="tabpanel" aria-labelledby="tab-rankings">
        <header class="user-subpanel-header">
          <div class="user-section-title-row">
            <div>
              <span class="eyebrow">Leaderboards</span>
              <h2>Ranked Lists</h2>
            </div>
            <div class="user-rankings-scope-picker">
              <label class="user-select-filter">
                <span>Scope:</span>
                <select id="userRankingsScopeSelect">
                  <option value="allTime"${rankingsScope === "allTime" ? " selected" : ""}>All-Time Top 100</option>
                  ${availableScopes.map((scope) => `<option value="${scope}"${rankingsScope === scope ? " selected" : ""}>${scope}</option>`).join("")}
                </select>
              </label>
            </div>
          </div>
        </header>

        ${
          list.length
            ? `
          <div class="user-rankings-table">
            ${list
              .map((film, index) => {
                let rank = index + 1;
                let posterUrl = safePosterUrl(film);
                let viewerFilm = getViewerFilm(film);
                return `
                  <div class="user-ranking-row" data-film-id="${escape(film.id || "")}">
                    <span class="user-ranking-pos">#${rank}</span>
                    <div class="user-ranking-poster">
                      ${posterUrl ? `<img src="${escape(posterUrl)}" alt="" loading="lazy">` : ""}
                    </div>
                    <div class="user-ranking-info">
                      <h4><a href="${escape(window.filmPageUrl?.(film.id) || `film.html?id=${encodeURIComponent(film.id)}`)}">${escape(film.title)}</a></h4>
                      <p>${escape(film.year || "")}${film.director ? ` · ${escape(film.director)}` : ""}</p>
                    </div>
                    <div class="user-ranking-ratings">
                      <div class="user-ranking-score-pill">
                        <small>${escape(ownerName)}</small>
                        <strong>${film.rating ? window.renderFilmRatingHtml?.(film, { escape }) : "—"}</strong>
                      </div>
                      <div class="user-ranking-score-pill">
                        <small>You</small>
                        <strong>${viewerFilm?.rating ? window.renderFilmRatingHtml?.(viewerFilm, { escape }) : "—"}</strong>
                      </div>
                    </div>
                  </div>
                `;
              })
              .join("")}
          </div>
        `
            : `
          <div class="detail-empty">
            <h2>No ranked films</h2>
            <p>No ranked films found in this period.</p>
          </div>
        `
        }
      </div>
    `;
  }

  // Tab 6: Taste Compare Tab Content
  function renderCompareTab() {
    let isOwnProfile = Boolean(
      targetUserId && viewerAuth?.user?.id === targetUserId,
    );
    if (isOwnProfile) {
      return `
        <div class="user-tab-panel" id="panel-compare" role="tabpanel" aria-labelledby="tab-compare">
          <div class="detail-empty">
            <span class="eyebrow">Taste Compatibility</span>
            <h2>This is your own profile!</h2>
            <p>Visit another member from Community to compare archives and taste compatibility.</p>
            <div class="data-actions" style="justify-content: center; margin-top: 16px;">
              <a class="button-link button-primary" href="community.html">Browse Community</a>
            </div>
          </div>
        </div>
      `;
    }

    let viewerFilmCount = viewerWatchedMap.size;
    if (viewerFilmCount === 0) {
      return `
        <div class="user-tab-panel" id="panel-compare" role="tabpanel" aria-labelledby="tab-compare">
          <div class="detail-empty">
            <span class="eyebrow">Taste Compatibility</span>
            <h2>Sign in or add films to compare</h2>
            <p>Your personal archive has 0 watched films. Log films to calculate taste compatibility and compare ratings!</p>
          </div>
        </div>
      `;
    }

    let comparison = window.buildCommunityComparison?.([
      { slug, ownerName, data: targetData },
      { slug: "you", ownerName: "You", data: viewerState },
    ]) || {
      unionFilmCount: 0,
      sharedByAllCount: 0,
      overlapRows: [],
      agreements: [],
      disagreements: [],
    };

    let sharedCount =
      comparison.sharedByAllCount || comparison.overlapRows.length;
    let agreementCount = comparison.agreements?.length || 0;
    let clashCount = comparison.disagreements?.length || 0;

    let matchPercentage = 0;
    if (sharedCount > 0) {
      let closeMatchWeight = agreementCount * 1.0;
      let neutralMatchWeight =
        (sharedCount - agreementCount - clashCount) * 0.6;
      let clashWeight = clashCount * 0.1;
      matchPercentage = Math.min(
        100,
        Math.round(
          ((closeMatchWeight + neutralMatchWeight + clashWeight) /
            sharedCount) *
            100,
        ),
      );
    }

    return `
      <div class="user-tab-panel" id="panel-compare" role="tabpanel" aria-labelledby="tab-compare">
        <header class="user-subpanel-header">
          <div>
            <span class="eyebrow">Taste Alignment</span>
            <h2>${escape(ownerName)} &amp; You</h2>
            <p>In-depth taste compatibility, shared favorites, and rating divergence.</p>
          </div>
        </header>

        <section class="user-compare-summary">
          <div class="user-compare-score-box">
            <div class="user-compare-score-circle">
              <span class="user-compare-score-num">${sharedCount > 0 ? `${matchPercentage}%` : "—"}</span>
              <span class="user-compare-score-lbl">Compatibility</span>
            </div>
          </div>
          <div class="user-compare-stat-grid">
            <div class="user-compare-stat-cell">
              <strong>${formatNumber(sharedCount)}</strong>
              <span>Shared Films</span>
            </div>
            <div class="user-compare-stat-cell">
              <strong style="color:var(--accent);">${formatNumber(agreementCount)}</strong>
              <span>Shared Favorites (≤0.5★)</span>
            </div>
            <div class="user-compare-stat-cell">
              <strong style="color:#e57373;">${formatNumber(clashCount)}</strong>
              <span>Taste Clashes (≥1.5★)</span>
            </div>
          </div>
        </section>

        ${
          comparison.agreements?.length
            ? `
          <section class="user-overview-section" aria-labelledby="sharedFavsHeading">
            <div class="user-section-title-row">
              <div>
                <span class="eyebrow">Consensus</span>
                <h3 id="sharedFavsHeading">🤝 Shared Favorites</h3>
              </div>
            </div>
            <div class="user-card-scroll-row">
              ${comparison.agreements
                .slice(0, 10)
                .map((row) =>
                  renderProfileFilmCard(row.film, { ratingDisplay: "both" }),
                )
                .join("")}
            </div>
          </section>
        `
            : ""
        }

        ${
          comparison.disagreements?.length
            ? `
          <section class="user-overview-section" aria-labelledby="clashesHeading">
            <div class="user-section-title-row">
              <div>
                <span class="eyebrow">Divergence</span>
                <h3 id="clashesHeading">⚡ Taste Clashes &amp; Disagreements</h3>
              </div>
            </div>
            <div class="user-card-scroll-row">
              ${comparison.disagreements
                .slice(0, 10)
                .map((row) =>
                  renderProfileFilmCard(row.film, { ratingDisplay: "both" }),
                )
                .join("")}
            </div>
          </section>
        `
            : ""
        }

        <section class="user-overview-section" aria-labelledby="sharedShelfHeading">
          <div class="user-section-title-row">
            <div>
              <span class="eyebrow">Archive Overlap</span>
              <h3 id="sharedShelfHeading">Complete Shared Shelf (${formatNumber(sharedCount)})</h3>
            </div>
          </div>
          ${
            comparison.overlapRows?.length
              ? `
            <div class="user-films-grid">
              ${comparison.overlapRows.map((row) => renderProfileFilmCard(row.film, { ratingDisplay: "both" })).join("")}
            </div>
          `
              : `
            <p class="data-panel-status">No shared watched films found between your archives.</p>
          `
          }
        </section>
      </div>
    `;
  }

  function renderHeroActions() {
    let heroActions = document.getElementById("userProfileHeroActions");
    if (!heroActions) return;
    let isOwnProfile = Boolean(
      targetUserId && viewerAuth?.user?.id === targetUserId,
    );
    heroActions.innerHTML = `
      ${
        !isOwnProfile
          ? `<button type="button" class="${followState.isFollowing ? "button-secondary" : "button-primary"} user-profile-action-btn" data-profile-action="toggle-follow" ${followState.loading ? "disabled" : ""}>
              ${
                followState.isFollowing
                  ? followState.isMutualFriend
                    ? "✓ Friends"
                    : "✓ Following"
                  : "+ Follow"
              }
            </button>`
          : ""
      }
      <button type="button" class="button-secondary user-profile-action-btn" data-profile-action="copy-link">
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"/></svg>
        Share profile
      </button>
      ${isOwnProfile ? `<a class="button-link button-secondary user-profile-action-btn" href="profile.html">Edit settings</a>` : ""}
    `;
    wireEvents();
  }

  // Render Full Page View
  function render() {
    let tabHtml = "";
    if (activeTab === "overview") tabHtml = renderOverviewTab();
    else if (activeTab === "ceremonies") tabHtml = renderCeremoniesTab();
    else if (activeTab === "films") tabHtml = renderFilmsTab();
    else if (activeTab === "watchlist") tabHtml = renderWatchlistTab();
    else if (activeTab === "rankings") tabHtml = renderRankingsTab();
    else if (activeTab === "compare") tabHtml = renderCompareTab();

    container.innerHTML = `
      ${renderProfileHero()}
      ${renderTabsNav()}
      <div class="user-profile-tab-content">
        ${tabHtml}
      </div>
    `;

    wireEvents();
    window.enhanceHorizontalScroll?.(container);
  }

  // Wire interactive controls, tabs, filters, and personal quick-actions
  function wireEvents() {
    // Tab switching
    container.querySelectorAll("[data-tab-target]").forEach((button) => {
      button.addEventListener("click", (e) => {
        let target = e.currentTarget.dataset.tabTarget;
        if (target && validTabs.includes(target)) {
          activeTab = target;
          try {
            history.replaceState(null, "", `#${activeTab}`);
          } catch (err) {}
          render();
        }
      });
    });

    // Overview buttons switching tabs
    container.querySelectorAll("[data-switch-tab]").forEach((button) => {
      button.addEventListener("click", (e) => {
        let target = e.currentTarget.dataset.switchTab;
        if (target && validTabs.includes(target)) {
          activeTab = target;
          if (e.currentTarget.dataset.filterRating) {
            filmFilters.ratingMin = e.currentTarget.dataset.filterRating;
          }
          try {
            history.replaceState(null, "", `#${activeTab}`);
          } catch (err) {}
          render();
        }
      });
    });

    // Toggle follow button
    container
      .querySelector('[data-profile-action="toggle-follow"]')
      ?.addEventListener("click", async () => {
        let auth = await window.resolveSupabaseAuthState?.().catch(() => null);
        if (auth?.status !== "signed-in") {
          window.showOskarsToast?.("Sign in to follow profiles!");
          return;
        }
        if (!targetUserId && !slug) return;
        followState.loading = true;
        renderHeroActions();
        try {
          if (followState.isFollowing) {
            await window.unfollowSupabaseUser?.(targetUserId || slug);
            followState.isFollowing = false;
            followState.isMutualFriend = false;
            window.showOskarsToast?.(`Unfollowed ${ownerName}`);
          } else {
            await window.followSupabaseUser?.(targetUserId || slug);
            followState.isFollowing = true;
            window.showOskarsToast?.(`Followed ${ownerName}`);
            // Check if it became mutual
            if (window.checkSupabaseFollowing) {
              let updated = await window.checkSupabaseFollowing(slug);
              followState.isMutualFriend = Boolean(updated.isMutualFriend);
            }
          }
        } catch (err) {
          window.showOskarsToast?.(err.message || String(err));
        } finally {
          followState.loading = false;
          renderHeroActions();
        }
      });

    // Share link button
    container
      .querySelector('[data-profile-action="copy-link"]')
      ?.addEventListener("click", async () => {
        let url = window.location.href;
        try {
          if (navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            window.showOskarsToast?.("Profile link copied to clipboard!");
          } else {
            window.showOskarsToast?.(url);
          }
        } catch (err) {
          window.showOskarsToast?.(`Link: ${url}`);
        }
      });

    // Films Tab: Search & Filters
    let filmsSearchInput = document.getElementById("userFilmsSearchInput");
    filmsSearchInput?.addEventListener("input", (e) => {
      filmFilters.search = e.target.value.trim();
      let tabContent = document.getElementById("panel-films");
      if (tabContent) {
        tabContent.outerHTML = renderFilmsTab();
        wireEvents();
        document.getElementById("userFilmsSearchInput")?.focus();
      }
    });

    document
      .getElementById("userFilmsDecadeSelect")
      ?.addEventListener("change", (e) => {
        filmFilters.decade = e.target.value;
        render();
      });

    document
      .getElementById("userFilmsRatingSelect")
      ?.addEventListener("change", (e) => {
        filmFilters.ratingMin = e.target.value;
        render();
      });

    document
      .getElementById("userFilmsSortSelect")
      ?.addEventListener("change", (e) => {
        filmFilters.sort = e.target.value;
        render();
      });

    document
      .getElementById("userFilmsCompareToggle")
      ?.addEventListener("change", (e) => {
        filmFilters.ratingDisplay = e.target.value;
        render();
      });

    // Watchlist Tab: Filter Pills & Search
    container.querySelectorAll("[data-watchlist-filter]").forEach((pill) => {
      pill.addEventListener("click", (e) => {
        watchlistFilters.filter = e.currentTarget.dataset.watchlistFilter;
        render();
      });
    });

    document
      .getElementById("userWatchlistSearchInput")
      ?.addEventListener("input", (e) => {
        watchlistFilters.search = e.target.value.trim();
        let tabContent = document.getElementById("panel-watchlist");
        if (tabContent) {
          tabContent.outerHTML = renderWatchlistTab();
          wireEvents();
          document.getElementById("userWatchlistSearchInput")?.focus();
        }
      });

    // Rankings Tab: Scope select
    document
      .getElementById("userRankingsScopeSelect")
      ?.addEventListener("change", (e) => {
        rankingsScope = e.target.value;
        render();
      });

    // Personal Quick-Action: Watchlist Toggle
    container
      .querySelectorAll('[data-user-action="toggle-watchlist"]')
      .forEach((button) => {
        button.addEventListener("click", async (e) => {
          e.stopPropagation();
          let actionRoot = button.closest(".user-card-actions");
          if (!actionRoot) return;

          let filmId = actionRoot.dataset.filmId;
          let title = actionRoot.dataset.filmTitle;
          let year = actionRoot.dataset.filmYear;

          let auth = await window
            .resolveSupabaseAuthState?.()
            .catch(() => null);
          if (auth?.status !== "signed-in") {
            window.showOskarsToast?.(
              "Sign in to save films to your personal watchlist!",
            );
            return;
          }

          let existingWatchlistItem = getViewerWatchlistItem({
            id: filmId,
            title,
            year,
          });
          button.disabled = true;

          try {
            if (existingWatchlistItem) {
              if (window.removeFromSupabaseWatchlist) {
                await window.removeFromSupabaseWatchlist(
                  existingWatchlistItem.id,
                );
              }
              if (Array.isArray(viewerState.watchlist)) {
                viewerState.watchlist = viewerState.watchlist.filter(
                  (item) => item.id !== existingWatchlistItem.id,
                );
              }
              window.showOskarsToast?.(
                `Removed "${title}" from your watchlist`,
              );
            } else {
              let record = {
                title,
                year,
                supabaseFilmId: filmId,
              };
              if (window.addSupabaseWatchlistRecord) {
                await window.addSupabaseWatchlistRecord(record);
              } else if (window.addWatchlistItem) {
                window.addWatchlistItem(record);
              }
              window.showOskarsToast?.(`Added "${title}" to your watchlist`);
            }
            indexViewerArchive();
            render();
          } catch (err) {
            button.disabled = false;
            window.showOskarsToast?.(err.message || String(err));
          }
        });
      });

    // Personal Quick-Action: Rate
    container
      .querySelectorAll('[data-user-action="rate"]')
      .forEach((button) => {
        button.addEventListener("click", async (e) => {
          e.stopPropagation();
          let actionRoot = button.closest(".user-card-actions");
          if (!actionRoot) return;

          let filmId = actionRoot.dataset.filmId;
          let title = actionRoot.dataset.filmTitle;
          let year = actionRoot.dataset.filmYear;

          let auth = await window
            .resolveSupabaseAuthState?.()
            .catch(() => null);
          if (auth?.status !== "signed-in") {
            window.showOskarsToast?.("Sign in to rate films!");
            return;
          }

          let viewerFilm = getViewerFilm({ id: filmId, title, year });
          let currentRating =
            viewerFilm?.ratingValue != null
              ? String(viewerFilm.ratingValue)
              : "";

          let promptText = `Rate "${title}" (1.0 to 5.0 stars, e.g. 4.5):`;
          let userRatingInput = window.prompt(promptText, currentRating);
          if (userRatingInput === null) return;

          let parsed = window.parseFilmRating?.(userRatingInput);
          if (!parsed || parsed.value <= 0) {
            window.showOskarsToast?.(
              "Please enter a valid rating between 1 and 5 stars.",
            );
            return;
          }

          button.disabled = true;
          try {
            if (viewerFilm && window.updateFilmMetadata) {
              let rendered =
                window.renderFilmRating?.(parsed) || `${parsed.value}★`;
              window.updateFilmMetadata(viewerFilm.id, {
                rating: rendered,
                ratingValue: parsed.value,
                ratingModifier: parsed.modifier,
              });
              window.save?.();
            } else if (window.addSupabaseCandidateToWatched) {
              await window.addSupabaseCandidateToWatched({
                title,
                year,
                rating: window.renderFilmRating?.(parsed) || `${parsed.value}★`,
                ratingValue: parsed.value,
                ratingModifier: parsed.modifier,
              });
            }
            window.showOskarsToast?.(`Saved rating for "${title}"!`);
            indexViewerArchive();
            render();
          } catch (err) {
            button.disabled = false;
            window.showOskarsToast?.(err.message || String(err));
          }
        });
      });
  }

  // Initial render
  await checkFollowStatus();
  render();
  finishRender?.();
})();
