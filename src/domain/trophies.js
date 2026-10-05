/** @file Defines curated fixed filmographies and film collections, deriving trophy qualification from the active archive's watched records. */
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

  const nolanFilms = [
    ["9ee7de2a-2316-4554-abbd-780bb73d507b", "Following", 1998],
    ["c0d8e763-d62b-4cd4-88b5-b526f83cfc35", "Memento", 2000],
    ["31557a0c-dad5-4e65-8aa8-611068d3eb59", "Insomnia", 2002],
    ["6a61d6e3-36cd-4e48-a0ae-4bdf6e939294", "Batman Begins", 2005],
    ["2985bae3-a3b1-4792-9c64-012f09164593", "The Prestige", 2006],
    ["071e827f-e611-4d07-9d39-8cca44b96d65", "The Dark Knight", 2008],
    ["868d9953-8cd0-49ee-97a2-edc982f01a81", "Inception", 2010],
    ["01f7112a-8e7a-48df-8352-3299e04ff21b", "The Dark Knight Rises", 2012],
    ["723f481f-6eea-4757-9a42-b17a1b2071f4", "Interstellar", 2014],
    ["be6e34d8-3762-4301-8f9e-cbf8dd96dd4e", "Dunkirk", 2017],
    ["f21dcf15-4365-4876-bf2a-77796859a873", "Tenet", 2020],
    ["c0ae2931-1220-4ef6-bbfc-728b1bbbc755", "Oppenheimer", 2023],
    ["985ce2ce-7abf-48b3-8749-f82117582c2c", "The Odyssey", 2026],
  ];
  const weirFilms = [
    ["7a5c1578-737a-4916-a9f6-6dba3ae5044f", "The Cars That Ate Paris", 1974],
    ["eb435647-df25-44a2-a108-087afdbf1393", "Picnic at Hanging Rock", 1975],
    ["7888da50-0a3c-46bd-932d-09b0172dd6ae", "The Last Wave", 1977],
    ["3eec713e-c2ba-4d18-b5ed-b3b7455014fb", "Gallipoli", 1981],
    [
      "41155773-6deb-493d-a137-da15dd9a91e0",
      "The Year of Living Dangerously",
      1982,
    ],
    ["aab69c60-baa8-4882-960f-38346d7187b6", "Witness", 1985],
    ["f6f73671-bd6f-4165-9410-3787fa5cf5bb", "The Mosquito Coast", 1986],
    ["19c9e32e-6ceb-42cb-a776-877543067be5", "Dead Poets Society", 1989],
    ["45a2b102-a6bd-4e41-9c3e-5e8d7e539fa0", "Green Card", 1990],
    ["455b7445-befd-462c-b45f-6d7ad3c8adb3", "Fearless", 1993],
    ["ace4a9b6-1a0f-4dd8-8de3-4e6806f4a32b", "The Truman Show", 1998],
    [
      "8fff76e9-babd-4b8d-843f-ab4560a88587",
      "Master and Commander: The Far Side of the World",
      2003,
    ],
    ["dfcb39ff-0337-403a-a784-91fd82354ca9", "The Way Back", 2010],
  ];
  const weirExtras = [
    ["402d7225-bcce-498a-b794-10295b1fa4ad", "Homesdale", 1971],
    ["25c34a24-4663-4f2a-a0cf-62bf3f7eec07", "The Plumber", 1979],
  ];
  const konWorks = [
    ["21eda3c1-3c66-46ba-8a51-c750903d87cd", "Perfect Blue", 1997],
    ["08011b46-828b-45e3-aba0-17fd6e4f364a", "Millennium Actress", 2001],
    ["4431c920-b0ef-4f0d-a2be-6c94a06fb0ff", "Tokyo Godfathers", 2003],
    [
      "d47ad214-df20-4ba7-b66a-799834b89923",
      "Paranoia Agent",
      2004,
      "TV series",
    ],
    ["fda9ca2f-3512-47ef-a5f0-eafd58779b5a", "Paprika", 2006],
  ];

  const definitions = [
    {
      id: "mission-impossible-eight",
      domId: "missionTrophy",
      title: "Mission: Impossible",
      emblem: "M:I",
      edition: "VIII",
      scope: "8-film collection",
      celebration: "You did the impossible.",
      invitation: "Your mission: watch all eight films.",
      criteria:
        "This collection is fixed at eight films. Existing watches count; future releases do not change it.",
      films: missionFilms,
    },
    {
      id: "christopher-nolan-thirteen",
      domId: "nolanTrophy",
      title: "Christopher Nolan",
      emblem: "CN",
      edition: "XIII",
      scope: "13 feature films",
      celebration: "Every piece in place.",
      invitation: "From Following to The Odyssey.",
      criteria:
        "Watch these 13 directed features, including The Odyssey. Shorts and producing-only credits are not required. Future films do not change this collection.",
      films: nolanFilms,
    },
    {
      id: "peter-weir-thirteen",
      domId: "weirTrophy",
      title: "Peter Weir",
      emblem: "PW",
      edition: "XIII",
      scope: "13 feature films",
      celebration: "You took the long way home.",
      invitation: "From The Cars That Ate Paris to The Way Back.",
      criteria:
        "Watch these 13 theatrical features. Homesdale and The Plumber belong to the separate bonus trophy and are not required here.",
      films: weirFilms,
    },
    {
      id: "peter-weir-fifteen",
      domId: "weirBonusTrophy",
      title: "Peter Weir",
      emblem: "PW",
      edition: "XV",
      scope: "Bonus · 15 feature-length films",
      celebration: "The complete journey.",
      invitation: "Go further with Homesdale and The Plumber.",
      criteria:
        "Watch all 13 core features plus Homesdale and The Plumber. The bonus does not replace your 13-film trophy.",
      films: [...weirFilms, ...weirExtras].sort((a, b) => a[2] - b[2]),
    },
    {
      id: "satoshi-kon-five",
      domId: "konTrophy",
      title: "Satoshi Kon",
      emblem: "SK",
      edition: "IV + I",
      scope: "4 feature films + 1 series",
      celebration: "You crossed into the dream.",
      invitation: "Four features and Paranoia Agent.",
      criteria:
        "Watch the four features and complete Paranoia Agent. The series counts as one work when marked watched in your archive; individual episodes are not tracked here.",
      films: konWorks,
    },
  ];

  /**
   * Derives fixed collection progress from watched records in one archive, excluding watchlist and shared-catalog entries.
   * @param {Object} [archive] Active hydrated archive.
   * @returns {CollectionTrophyProgress[]} Curated trophies with current qualification.
   */
  window.trophyCabinetData = function (archive = window.state || {}) {
    const watchedIds = new Set();
    [
      ...Object.values(archive.filmsById || {}),
      ...(archive.watchedOther || []),
    ].forEach((film) => {
      if (film?.supabaseFilmId || film?.id)
        watchedIds.add(film.supabaseFilmId || film.id);
    });
    return definitions.map((definition) => {
      const films = definition.films.map(([id, title, year, kind = ""]) => ({
        id,
        title,
        year,
        watched: watchedIds.has(id),
        kind,
      }));
      const watchedCount = films.filter((film) => film.watched).length;
      return {
        ...definition,
        films,
        watchedCount,
        total: films.length,
        earned: watchedCount === films.length,
      };
    });
  };

  /**
   * Derives the fixed Mission: Impossible trophy without counting watchlist or shared-catalog entries.
   * @param {Object} [archive] Active hydrated archive.
   * @returns {CollectionTrophyProgress} The eight-film trophy with current qualification.
   */
  window.missionImpossibleTrophy = function (archive = window.state || {}) {
    return window.trophyCabinetData(archive)[0];
  };
})();
