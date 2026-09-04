/** @file Selects and applies a deterministic contextual film-poster backdrop for the active page. */

(function () {
  let contextualPaths = new Set([
    "film.html",
    "person.html",
    "franchise.html",
    "tag.html",
    "project.html",
    "category.html",
    "period.html",
  ]);

  function posterReady(film) {
    return film && window.normalizePosterRecord?.(film.poster) ? film : null;
  }

  function filmOrder(left, right) {
    let leftRank = Number(left?.allTimeRank) || 999999;
    let rightRank = Number(right?.allTimeRank) || 999999;
    return (
      leftRank - rightRank ||
      Number(left?.year || 999999) - Number(right?.year || 999999) ||
      String(left?.title || "").localeCompare(String(right?.title || "")) ||
      String(left?.id || "").localeCompare(String(right?.id || ""))
    );
  }

  function bestPoster(records) {
    return [...(records || [])].filter(posterReady).sort(filmOrder)[0] || null;
  }

  function watchlistFilm(item) {
    return item ? window.watchlistFilmLike?.(item) || item : null;
  }

  function pagePath(locationLike) {
    return (
      String(locationLike?.pathname || locationLike?.href || "")
        .split(/[?#]/)[0]
        .split("/")
        .pop() || "index.html"
    );
  }

  function pageParams(locationLike) {
    let search = String(locationLike?.search || "");
    if (!search && locationLike?.href)
      search = String(locationLike.href).split("?")[1]?.split("#")[0] || "";
    return new URLSearchParams(search);
  }

  function periodMatches(film, type, key) {
    if (type === "alltime") return Number(film?.allTimeRank) > 0;
    if (type === "year") return String(film?.year || "") === key;
    if (type === "decade") return window.getDecadeKey?.(film?.year) === key;
    if (type === "century") return window.getCenturyKey?.(film?.year) === key;
    return false;
  }

  function contextualCandidates(path, params) {
    let id = params.get("id") || "";
    if (path === "film.html")
      return [
        window.findFilmById?.(id) ||
          window.findWatchedFilmById?.(id) ||
          watchlistFilm(
            window.state.watchlist?.find(
              (entry) => entry.supabaseFilmId === id,
            ),
          ),
      ];
    if (path === "person.html") {
      let person = (window.ensurePeopleIndex?.() || window.state.peopleById || {})[
        id
      ];
      if (!person) return [];
      return [
        ...(person.filmIds || []).map((filmId) =>
          window.findFilmById?.(filmId),
        ),
        ...(person.watchedOtherIds || []).map((filmId) =>
          window.findWatchedFilmById?.(filmId),
        ),
        ...(person.watchlistIds || []).map((itemId) =>
          watchlistFilm(window.findWatchlistItemById?.(itemId)),
        ),
      ];
    }
    if (path === "franchise.html") {
      let franchise = (window.state.franchisesById || {})[id];
      return [window.franchiseRepresentativeFilm?.(franchise)];
    }
    if (path === "tag.html") {
      let tag = window.tagRecord?.(params.get("name") || id);
      return [
        ...(tag?.films || []),
        ...(tag?.watchlist || []).map(watchlistFilm),
      ];
    }
    if (path === "project.html") {
      let project = window.findProjectById?.(id);
      return [
        window.projectRepresentativeFilm?.(
          project ? window.projectProgress?.(project) : null,
        ),
      ];
    }
    if (path === "category.html") {
      let entries = window.awardCategoryEntries?.(params.get("name") || id) || [];
      let winners = entries
        .filter((entry) => Number(entry.award?.placement) === 1)
        .map((entry) => entry.film);
      return winners.some(posterReady)
        ? winners
        : entries.map((entry) => entry.film);
    }
    if (path === "period.html") {
      let type = params.get("type") || "alltime";
      let key = params.get("key") || params.get("id") || type;
      return Object.values(window.state.filmsById || {}).filter((film) =>
        periodMatches(film, type, key),
      );
    }
    return [];
  }

  function stablePagePoster(path) {
    let pool = Object.values(window.state.filmsById || {})
      .filter(posterReady)
      .sort(filmOrder)
      .slice(0, 40);
    if (!pool.length) return null;
    let hash = [...path].reduce(
      (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
      0,
    );
    return pool[hash % pool.length];
  }

  /** Selects the poster-bearing film that represents the active page. @param {Location|Object} [locationLike] URL-like page location. @returns {FilmAxisRecord|null} Backdrop film. */
  window.contextualBackdropFilm = function (locationLike = window.location) {
    let path = pagePath(locationLike);
    let contextual = bestPoster(
      contextualCandidates(path, pageParams(locationLike)),
    );
    return contextualPaths.has(path) ? contextual : stablePagePoster(path);
  };

  /** Refreshes the active page's poster backdrop after archive data is ready. @returns {FilmAxisRecord|null} Applied backdrop film. */
  window.refreshOskarsBackdrop = function () {
    let root = document.documentElement;
    let film = window.contextualBackdropFilm();
    let poster = window.normalizePosterRecord?.(film?.poster);
    if (!poster) {
      delete root.dataset.posterBackdropReady;
      delete root.dataset.posterBackdropFilm;
      if (root.style?.removeProperty)
        root.style.removeProperty("--poster-backdrop-image");
      else if (root.style) delete root.style["--poster-backdrop-image"];
      return null;
    }
    root.dataset.posterBackdropReady = "true";
    root.dataset.posterBackdropFilm = String(film.id || "");
    let image = `url(${JSON.stringify(poster.url)})`;
    if (root.style?.setProperty)
      root.style.setProperty("--poster-backdrop-image", image);
    else if (root.style) root.style["--poster-backdrop-image"] = image;
    return film;
  };
})();
