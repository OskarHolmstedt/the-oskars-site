/**
 * @file Non-canonical watched-film lookup, archive/watchedOther bucket
 * moves, and project-reference derivation for watched films.
 */

(function () {
  function clone(value) {
    return value === undefined ? undefined : window.cloneRecord(value);
  }
  window.watchedFilmClone = clone;

  function baseRevision() {
    return String(
      window.state.draftMetadata?.baseRevision ||
        window.state.canonicalRevision ||
        "legacy-unversioned",
    );
  }
  window.watchedFilmBaseRevision = baseRevision;

  /**
   * Finds a first-class non-archive watched film by id.
   * @param {string} id Watched-film id.
   * @returns {WatchedOtherEntry|null} Watched film or null.
   */
  window.findWatchedFilmById = function (id) {
    return (
      (window.state.watchedOther || []).find(
        (film) => film.id === String(id || ""),
      ) || null
    );
  };

  /**
   * Moves a film between the ranked archive (`years[film.year].films`) and
   * `watchedOther`, in place. Looks up the real array-resident object by
   * `film.id` rather than trusting `film`'s own reference - `film` may be
   * `state.filmsById`'s canonical clone (built by `addFilmToStore`, a
   * genuinely different object from whatever sits in `years[year].films`),
   * not the object physically in either array. Moving that clone instead of
   * the real object would silently no-op (or worse, leave a duplicate
   * behind). The real object moves untouched, so every other field already
   * on it (tags, franchises, notes-by-id, dateWatched, views, ...) carries
   * over as-is. Also fixes up any project `filmRefs` pointing at this id,
   * since resolveProjectFilmRef is strictly type-gated ("archive" only
   * resolves via state.filmsById, "watched" only via findWatchedFilmById) -
   * a stale ref after a move would silently stop resolving and the film
   * would vanish from any project it's in.
   * @param {FilmRecord|WatchedOtherEntry} film Film currently in either bucket (by id).
   * @param {"archive"|"watchedOther"} targetBucket Destination bucket.
   * @returns {boolean} Whether a move actually happened.
   */
  window.moveFilmBetweenArchiveAndWatchedOther = function (film, targetBucket) {
    if (!film?.id) return false;
    let hasYear = /^\d{4}$/.test(String(film.year || ""));
    let archiveFilms = hasYear
      ? window.state.years?.[film.year]?.films || []
      : [];
    let archiveMatch = archiveFilms.find((entry) => entry.id === film.id);
    let watchedOtherMatch = (window.state.watchedOther || []).find(
      (entry) => entry.id === film.id,
    );
    let source = archiveMatch || watchedOtherMatch;
    if (!source) return false;
    if (targetBucket === "archive" && archiveMatch) return false;
    if (targetBucket === "watchedOther" && watchedOtherMatch) return false;
    if (targetBucket === "archive" && !hasYear) return false;
    let refType;
    if (archiveMatch) {
      let films = window.state.years[film.year].films;
      films.splice(films.indexOf(source), 1);
    } else {
      let others = window.state.watchedOther;
      others.splice(others.indexOf(source), 1);
    }
    if (targetBucket === "archive") {
      window.state.years[film.year] ||= { periodType: "years", films: [] };
      window.state.years[film.year].films.push(source);
      refType = "archive";
    } else {
      window.state.watchedOther ||= [];
      window.state.watchedOther.push(source);
      refType = "watched";
    }
    (window.state.projects || []).forEach((project) => {
      (project.filmRefs || []).forEach((ref) => {
        if (
          ref.id === film.id &&
          (ref.type === "archive" || ref.type === "watched")
        )
          ref.type = refType;
      });
    });
    window.markAggregatesDirty?.("film bucket reclassified");
    return true;
  };

  function watchedDirectorIds(film) {
    return (
      window.splitRecipientNames?.(
        film.director || (film.directors || []).join(", "),
      ) || []
    ).map(
      (name) =>
        window.normalizePersonName?.(
          window.state.peopleAliases?.[window.normalizePersonName(name)] ||
            name,
        ) || window.normalizeTitle(name),
    );
  }

  /** Returns watched-film project refs for a person source. @param {string} personId Person id. @returns {ProjectFilmRef[]} References. */
  window.watchedFilmRefsForPerson = function (personId) {
    return (window.state.watchedOther || [])
      .filter((film) => watchedDirectorIds(film).includes(personId))
      .map((film) => window.projectFilmRef("watched", film.id));
  };

  /** Returns watched-film project refs for a franchise source. @param {string} franchiseId Franchise id. @returns {ProjectFilmRef[]} References. */
  window.watchedFilmRefsForFranchise = function (franchiseId) {
    return (window.state.watchedOther || [])
      .filter((film) =>
        (film.franchises || []).some((membership) =>
          [
            membership.id,
            membership.parentId,
            ...(membership.parentIds || []),
            ...(membership.parentChainIds || []),
          ].includes(franchiseId),
        ),
      )
      .map((film) => window.projectFilmRef("watched", film.id));
  };

  /** Returns watched-film project refs for a tag source. @param {string} tag Tag label. @returns {ProjectFilmRef[]} References. */
  window.watchedFilmRefsForTag = function (tag) {
    let normalized = window.normalizeTag?.(tag) || window.normalizeTitle(tag);
    return (window.state.watchedOther || [])
      .filter((film) =>
        (film.tags || []).some(
          (value) =>
            (window.normalizeTag?.(value) || window.normalizeTitle(value)) ===
            normalized,
        ),
      )
      .map((film) => window.projectFilmRef("watched", film.id));
  };
})();
