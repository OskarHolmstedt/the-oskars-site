/** @file Defines fixed film-collection trophies and derives qualification from the active archive's watched records. */
(function () {
  const missionFilms = [
    ["ddd7fcef-c3e9-4522-ba77-200706403ec0", "Mission: Impossible", 1996],
    ["854bcfc3-61b2-4d2c-8903-bb9e14c18c8a", "Mission: Impossible II", 2000],
    ["231326f1-6479-484b-bb62-4336c272ce09", "Mission: Impossible III", 2006],
    [
      "f3e07501-93b6-4925-a431-63e9d33582a3",
      "Mission: Impossible – Ghost Protocol",
      2011,
    ],
    [
      "71a178f8-1763-48e3-b833-77e4728dccc0",
      "Mission: Impossible – Rogue Nation",
      2015,
    ],
    [
      "a4b5318d-99a1-44d5-92aa-6cb35b9ee01d",
      "Mission: Impossible – Fallout",
      2018,
    ],
    [
      "cf2b56e1-f4e0-4721-b07b-5ab90c6e544e",
      "Mission: Impossible – Dead Reckoning Part One",
      2023,
    ],
    [
      "fadba8b3-f78c-45f0-a93f-6769f1a9550a",
      "Mission: Impossible – The Final Reckoning",
      2025,
    ],
  ];

  /**
   * Derives the fixed Mission: Impossible trophy without counting watchlist or shared-catalog entries.
   * @param {Object} [archive] Active hydrated archive.
   * @returns {Object} Trophy definition with per-film watched flags and current qualification.
   */
  window.missionImpossibleTrophy = function (archive = window.state || {}) {
    const watchedIds = new Set();
    [
      ...Object.values(archive.filmsById || {}),
      ...(archive.watchedOther || []),
    ].forEach((film) => {
      if (film?.supabaseFilmId || film?.id)
        watchedIds.add(film.supabaseFilmId || film.id);
    });
    const films = missionFilms.map(([id, title, year]) => ({
      id,
      title,
      year,
      watched: watchedIds.has(id),
    }));
    const watchedCount = films.filter((film) => film.watched).length;
    return {
      id: "mission-impossible-eight",
      title: "Mission: Impossible",
      films,
      watchedCount,
      total: films.length,
      earned: watchedCount === films.length,
    };
  };
})();
