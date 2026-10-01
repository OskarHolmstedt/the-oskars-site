/** @file Builds populated collection previews and a small, varied discovery selection for the hub. */
(function () {
  function filmKey(film) {
    return String(
      film.supabaseFilmId ||
        film.tmdbId ||
        film.id ||
        `${film.year}:${film.title}`,
    );
  }

  function uniqueFilms(films) {
    let seen = new Set();
    return films.filter((film) => {
      if (!film) return false;
      let id = filmKey(film);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function posters(films) {
    return uniqueFilms(films)
      .sort(
        (a, b) =>
          Number(Boolean(b.poster?.url || b.poster_url)) -
            Number(Boolean(a.poster?.url || a.poster_url)) ||
          Number(a.allTimeRank || Number.MAX_SAFE_INTEGER) -
            Number(b.allTimeRank || Number.MAX_SAFE_INTEGER) ||
          Number(b.ratingValue || 0) - Number(a.ratingValue || 0) ||
          String(a.title).localeCompare(String(b.title)),
      )
      .slice(0, 3);
  }

  /**
   * Builds the hub from the same indexes used by its destination pages.
   * @param {Object[]} [customCollections] Own collections with bounded poster previews.
   * @param {boolean} [readOnly=false] Whether owner-only destinations must be omitted.
   * @returns {{groups: Record<string, CollectionsHubItem[]>, suggestions: CollectionsHubItem[], items: CollectionsHubItem[]}}
   */
  window.buildCollectionsHubModel = function (
    customCollections = [],
    readOnly = false,
  ) {
    let state = window.state;
    let watched = new Map(
      Object.values(state.filmsById || {}).map((film) => [film.id, film]),
    );
    let other = new Map(
      (state.watchedOther || []).map((film) => [film.id, film]),
    );
    let watchlist = new Map(
      (state.watchlist || []).map((film) => [
        film.id || window.watchlistItemId(film),
        film,
      ]),
    );
    let groups = { directors: [], franchises: [], tags: [], custom: [] };
    function add(type, id, name, href, films, waiting) {
      films = uniqueFilms(films);
      let watchedIds = new Set(films.map(filmKey));
      waiting = uniqueFilms(waiting).filter(
        (film) => !watchedIds.has(filmKey(film)),
      );
      if (!films.length && !waiting.length) return;
      groups[type].push({
        type,
        id,
        name,
        href,
        watched: films.length,
        remaining: waiting.length,
        total: films.length + waiting.length,
        posters: posters([...films, ...waiting]),
      });
    }
    Object.values(window.ensurePeopleIndex() || {}).forEach((person) => {
      if (!person.professions?.includes("Director")) return;
      let films = (person.credits || [])
        .filter(
          (credit) =>
            credit.source === "film" && credit.profession === "Director",
        )
        .map((credit) => watched.get(credit.filmId));
      films.push(...(person.watchedOtherIds || []).map((id) => other.get(id)));
      add(
        "directors",
        person.id,
        person.name,
        window.personPageUrl(person.id),
        films,
        (person.watchlistIds || []).map((id) => watchlist.get(id)),
      );
    });
    Object.values(window.ensureFranchiseIndex() || {}).forEach((franchise) => {
      if (franchise.parentId || franchise.parentIds?.length) return;
      let films = [
        ...(franchise.films || []).map((entry) => watched.get(entry.filmId)),
        ...(franchise.otherFilms || []).map((entry) => other.get(entry.filmId)),
      ];
      let waiting = (franchise.watchlistFilms || []).map((entry) =>
        watchlist.get(entry.itemId),
      );
      if (uniqueFilms([...films, ...waiting]).length < 2) return;
      add(
        "franchises",
        franchise.id,
        franchise.name,
        window.franchisePageUrl(franchise.id),
        films,
        waiting,
      );
    });
    window
      .getFilmTagIndex()
      .forEach((tag) =>
        add(
          "tags",
          tag.name,
          tag.name,
          window.tagPageUrl(tag.name),
          tag.films || [],
          tag.watchlist || [],
        ),
      );
    if (!readOnly)
      customCollections
        .filter((collection) => collection.itemCount > 0)
        .forEach((collection) => {
          groups.custom.push({
            type: "custom",
            id: collection.id,
            name: collection.name,
            href: window.collectionPageUrl(collection.id),
            total: collection.itemCount,
            watched: 0,
            remaining: 0,
            posters: posters(collection.posterFilms || []),
          });
        });
    for (let type of ["directors", "franchises", "tags"]) {
      groups[type].sort(
        (a, b) =>
          b.watched - a.watched ||
          b.total - a.total ||
          a.name.localeCompare(b.name),
      );
    }
    let nearFinish = groups.franchises
      .filter((item) => item.watched > 0 && item.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining || b.watched - a.watched)[0];
    let candidates = [
      nearFinish || groups.franchises[0],
      groups.custom[0],
      groups.directors[0],
      groups.tags[0],
    ].filter(Boolean);
    let items = readOnly ? [] : Object.values(groups).flat();
    let suggestions = readOnly
      ? []
      : [
          ...new Map(
            [...candidates, ...items].map((item) => [item.href, item]),
          ).values(),
        ].slice(0, 3);
    return { groups, suggestions, items };
  };
})();
