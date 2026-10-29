/** @file Defines curated collection trophies with 3-tier persona progression (Essentialist, Completionist, Sycophant) and dynamic qualification. */
(function () {
  /** @type {[string, string, number, string?][]} */
  const missionEssentials = [
    ["ddd7fcef-c3e9-4522-ba77-200706403ec0", "Mission: Impossible", 1996],
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
  ];

  /** @type {[string, string, number, string?][]} */
  const missionCanonExtras = [
    ["854bcfc3-61b2-4d2c-8903-bb9e14c18c8a", "Mission: Impossible II", 2000],
    ["231326f1-6479-484b-bb62-4336c272ce09", "Mission: Impossible III", 2006],
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

  /** @type {[string, string, number, string?][]} */
  const nolanEssentials = [
    ["c0d8e763-d62b-4cd4-88b5-b526f83cfc35", "Memento", 2000],
    ["2985bae3-a3b1-4792-9c64-012f09164593", "The Prestige", 2006],
    ["071e827f-e611-4d07-9d39-8cca44b96d65", "The Dark Knight", 2008],
    ["868d9953-8cd0-49ee-97a2-edc982f01a81", "Inception", 2010],
    ["723f481f-6eea-4757-9a42-b17a1b2071f4", "Interstellar", 2014],
    ["c0ae2931-1220-4ef6-bbfc-728b1bbbc755", "Oppenheimer", 2023],
  ];

  /** @type {[string, string, number, string?][]} */
  const nolanCanonExtras = [
    ["9ee7de2a-2316-4554-abbd-780bb73d507b", "Following", 1998],
    ["31557a0c-dad5-4e65-8aa8-611068d3eb59", "Insomnia", 2002],
    ["6a61d6e3-36cd-4e48-a0ae-4bdf6e939294", "Batman Begins", 2005],
    ["01f7112a-8e7a-48df-8352-3299e04ff21b", "The Dark Knight Rises", 2012],
    ["be6e34d8-3762-4301-8f9e-cbf8dd96dd4e", "Dunkirk", 2017],
    ["f21dcf15-4365-4876-bf2a-77796859a873", "Tenet", 2020],
    ["985ce2ce-7abf-48b3-8749-f82117582c2c", "The Odyssey", 2026],
  ];

  /** @type {[string, string, number, string?][]} */
  const weirEssentials = [
    ["eb435647-df25-44a2-a108-087afdbf1393", "Picnic at Hanging Rock", 1975],
    ["3eec713e-c2ba-4d18-b5ed-b3b7455014fb", "Gallipoli", 1981],
    ["aab69c60-baa8-4882-960f-38346d7187b6", "Witness", 1985],
    ["19c9e32e-6ceb-42cb-a776-877543067be5", "Dead Poets Society", 1989],
    ["ace4a9b6-1a0f-4dd8-8de3-4e6806f4a32b", "The Truman Show", 1998],
    [
      "8fff76e9-babd-4b8d-843f-ab4560a88587",
      "Master and Commander: The Far Side of the World",
      2003,
    ],
  ];

  /** @type {[string, string, number, string?][]} */
  const weirCanonExtras = [
    ["7a5c1578-737a-4916-a9f6-6dba3ae5044f", "The Cars That Ate Paris", 1974],
    ["7888da50-0a3c-46bd-932d-09b0172dd6ae", "The Last Wave", 1977],
    [
      "41155773-6deb-493d-a137-da15dd9a91e0",
      "The Year of Living Dangerously",
      1982,
    ],
    ["f6f73671-bd6f-4165-9410-3787fa5cf5bb", "The Mosquito Coast", 1986],
    ["45a2b102-a6bd-4e41-9c3e-5e8d7e539fa0", "Green Card", 1990],
    ["455b7445-befd-462c-b45f-6d7ad3c8adb3", "Fearless", 1993],
    ["dfcb39ff-0337-403a-a784-91fd82354ca9", "The Way Back", 2010],
  ];

  /** @type {[string, string, number, string?][]} */
  const weirSycophantExtras = [
    ["402d7225-bcce-498a-b794-10295b1fa4ad", "Homesdale", 1971],
    ["25c34a24-4663-4f2a-a0cf-62bf3f7eec07", "The Plumber", 1979],
  ];

  /** @type {[string, string, number, string?][]} */
  const konEssentials = [
    ["21eda3c1-3c66-46ba-8a51-c750903d87cd", "Perfect Blue", 1997],
    ["08011b46-828b-45e3-aba0-17fd6e4f364a", "Millennium Actress", 2001],
    ["fda9ca2f-3512-47ef-a5f0-eafd58779b5a", "Paprika", 2006],
  ];

  /** @type {[string, string, number, string?][]} */
  const konCanonExtras = [
    ["4431c920-b0ef-4f0d-a2be-6c94a06fb0ff", "Tokyo Godfathers", 2003],
  ];

  /** @type {[string, string, number, string?][]} */
  const konSycophantExtras = [
    [
      "d47ad214-df20-4ba7-b66a-799834b89923",
      "Paranoia Agent",
      2004,
      "TV series",
    ],
  ];

  /**
   * Baseline in-memory definitions of curated collection trophies.
   */
  const fallbackDefinitions = [
    {
      id: "mission-impossible",
      domId: "missionTrophy",
      title: "Mission: Impossible",
      personaName: "Mission: Impossible",
      entityType: "franchise",
      entityId: "mission-impossible",
      emblem: "M:I",
      edition: "VIII",
      scope: "8-film franchise canon",
      celebration: "You did the impossible.",
      invitation: "Your mission: watch the canonical films.",
      criteria:
        "Watch all official Mission: Impossible releases. Newly cataloged entries update qualification dynamically.",
      aliases: ["mission-impossible-eight"],
      tiers: {
        essentialist: {
          scope: "4 landmark films",
          celebration: "You mastered the essential landmarks.",
          invitation: "Experience the peak four impossible missions.",
          criteria:
            "Watch 4 curated landmarks: Mission: Impossible, Ghost Protocol, Rogue Nation, and Fallout.",
          films: missionEssentials,
        },
        completionist: {
          scope: "8 mainline theatrical films",
          celebration: "You completed the full theatrical canon.",
          invitation: "Your mission: watch all eight mainline films.",
          criteria:
            "Watch all 8 mainline theatrical films from the 1996 original to The Final Reckoning.",
          tierOnlyFilms: missionCanonExtras,
        },
        sycophant: {
          scope: "The entire expanded franchise",
          celebration: "Unhinged dedication to the entire franchise catalog.",
          invitation: "Watch every mission, spin-off, and bonus work.",
          criteria:
            "Watch every cataloged work associated with the franchise in the database.",
          tierOnlyFilms: [],
        },
      },
    },
    {
      id: "christopher-nolan",
      domId: "nolanTrophy",
      title: "Christopher Nolan",
      personaName: "Nolan",
      entityType: "person",
      entityId: "christopher-nolan",
      emblem: "CN",
      edition: "XIII",
      scope: "13 feature films",
      celebration: "Every piece in place.",
      invitation: "From Following to The Odyssey.",
      criteria:
        "Watch directed features, including upcoming releases as they catalog. Shorts and producing-only credits are not required.",
      aliases: ["christopher-nolan-thirteen"],
      tiers: {
        essentialist: {
          scope: "6 landmark films",
          celebration: "You mastered Nolan's defining masterpieces.",
          invitation: "Six essential films from Memento to Oppenheimer.",
          criteria:
            "Watch 6 landmark artistic peaks: Memento, The Prestige, The Dark Knight, Inception, Interstellar, and Oppenheimer.",
          films: nolanEssentials,
        },
        completionist: {
          scope: "13 theatrical features",
          celebration: "Every piece in place across the theatrical canon.",
          invitation:
            "The complete theatrical canon from Following to The Odyssey.",
          criteria:
            "Watch all 13 official narrative theatrical features from Following to The Odyssey.",
          tierOnlyFilms: nolanCanonExtras,
        },
        sycophant: {
          scope: "The complete expanded catalog",
          celebration: "Unhinged completist devotion to Christopher Nolan.",
          invitation: "Watch all features and every expanded project.",
          criteria:
            "Watch all 13 theatrical features and any expanded catalog projects.",
          tierOnlyFilms: [],
        },
      },
    },
    {
      id: "peter-weir",
      domId: "weirTrophy",
      title: "Peter Weir",
      personaName: "Weir",
      entityType: "person",
      entityId: "peter-weir",
      emblem: "PW",
      edition: "XIII / XV",
      scope: "13 features · 15 complete works",
      celebration: "You took the long way home.",
      invitation: "From The Cars That Ate Paris to The Way Back.",
      criteria:
        "Watch all 13 theatrical features or go further with Homesdale and The Plumber for the Sycophant badge.",
      aliases: ["peter-weir-thirteen", "peter-weir-fifteen"],
      customRules: {
        completionist_exclude_film_ids: [
          "402d7225-bcce-498a-b794-10295b1fa4ad",
        ],
        sycophant_include_film_ids: [
          "402d7225-bcce-498a-b794-10295b1fa4ad",
          "25c34a24-4663-4f2a-a0cf-62bf3f7eec07",
        ],
      },
      tiers: {
        essentialist: {
          scope: "6 landmark films",
          celebration: "You experienced Weir's towering classics.",
          invitation:
            "Six essential films from Picnic at Hanging Rock to Master and Commander.",
          criteria:
            "Watch 6 curated landmarks: Picnic at Hanging Rock, Gallipoli, Witness, Dead Poets Society, The Truman Show, and Master and Commander.",
          films: weirEssentials,
        },
        completionist: {
          scope: "13 theatrical features",
          celebration: "You completed the full theatrical feature filmography.",
          invitation: "From The Cars That Ate Paris to The Way Back.",
          criteria:
            "Watch all 13 theatrical features. Homesdale and The Plumber belong to the Sycophant tier.",
          tierOnlyFilms: weirCanonExtras,
        },
        sycophant: {
          scope: "Expanded archive · 15 feature-length works",
          celebration:
            "The complete journey into every corner of Weir's career.",
          invitation: "Go further with Homesdale and The Plumber.",
          criteria:
            "Watch all 13 core features plus Homesdale and The Plumber.",
          tierOnlyFilms: weirSycophantExtras,
        },
      },
    },
    {
      id: "satoshi-kon",
      domId: "konTrophy",
      title: "Satoshi Kon",
      personaName: "Kon",
      entityType: "person",
      entityId: "satoshi-kon",
      emblem: "SK",
      edition: "IV + I",
      scope: "4 feature films + 1 series",
      celebration: "You crossed into the dream.",
      invitation: "Four features and Paranoia Agent.",
      criteria:
        "Watch the four features and complete Paranoia Agent. The series counts as one work when marked watched.",
      aliases: ["satoshi-kon-five"],
      customRules: {
        sycophant_include_film_ids: ["d47ad214-df20-4ba7-b66a-799834b89923"],
      },
      tiers: {
        essentialist: {
          scope: "3 landmark films",
          celebration: "You entered the surreal masterworks.",
          invitation:
            "Three essential films: Perfect Blue, Millennium Actress, and Paprika.",
          criteria:
            "Watch 3 essential masterpieces: Perfect Blue, Millennium Actress, and Paprika.",
          films: konEssentials,
        },
        completionist: {
          scope: "4 theatrical feature films",
          celebration: "The complete feature film canon.",
          invitation: "Watch all four features including Tokyo Godfathers.",
          criteria:
            "Watch all four directed theatrical features: Perfect Blue, Millennium Actress, Tokyo Godfathers, and Paprika.",
          tierOnlyFilms: konCanonExtras,
        },
        sycophant: {
          scope: "4 feature films + 1 series",
          celebration: "You crossed entirely into the dream.",
          invitation: "Four features and the complete Paranoia Agent series.",
          criteria: "Watch the four features and complete Paranoia Agent.",
          tierOnlyFilms: konSycophantExtras,
        },
      },
    },
  ];

  /** @type {Object[]} Active in-memory registry of curated collection trophy definitions. */
  window.collectionTrophiesRegistry = fallbackDefinitions.map((d) => ({
    ...d,
    aliases: [...(d.aliases || [])],
    customRules: { ...(d.customRules || {}) },
    essentialFilmIds: (d.tiers.essentialist.films || []).map((f) => f[0]),
    tiers: {
      essentialist: {
        ...d.tiers.essentialist,
        films: d.tiers.essentialist.films.map((f) => [...f]),
      },
      completionist: {
        ...d.tiers.completionist,
        tierOnlyFilms: (d.tiers.completionist.tierOnlyFilms || []).map((f) => [
          ...f,
        ]),
      },
      sycophant: {
        ...d.tiers.sycophant,
        tierOnlyFilms: (d.tiers.sycophant.tierOnlyFilms || []).map((f) => [
          ...f,
        ]),
      },
    },
  }));

  /**
   * Applies curated collection trophy rows from Supabase into the local registry.
   * @param {CollectionTrophyRow[]} rows Rows from public.collection_trophies.
   * @returns {void}
   */
  window.applyCollectionTrophies = function (rows) {
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      if (!row || !row.id) return;
      const id = String(row.id).trim();
      let def = (window.collectionTrophiesRegistry || []).find(
        (d) => d.id === id,
      );
      const customRules = row.custom_rules || {};
      const essentials = (row.collection_trophy_essentials || [])
        .slice()
        .sort(
          (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0),
        );

      if (def) {
        def.title = row.title || def.title;
        def.personaName = row.persona_name || def.personaName;
        def.entityType = row.entity_type || def.entityType;
        def.entityId = row.entity_id || def.entityId;
        def.emblem = row.emblem ?? def.emblem;
        def.edition = row.edition ?? def.edition;
        def.letterboxdUrl = row.letterboxd_url ?? def.letterboxdUrl;
        def.customRules = customRules;
        def.aliases = [
          ...new Set([...(def.aliases || []), ...(customRules.aliases || [])]),
        ];
        if (essentials.length) {
          def.essentialFilmIds = essentials.map((e) => e.film_id);
        }
      } else {
        const domId = `${id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}Trophy`;
        const newDef = {
          id,
          domId,
          title: row.title,
          personaName: row.persona_name,
          entityType: row.entity_type,
          entityId: row.entity_id,
          emblem: row.emblem || "",
          edition: row.edition || "",
          letterboxdUrl: row.letterboxd_url || null,
          customRules,
          aliases: customRules.aliases || [],
          essentialFilmIds: essentials.map((e) => e.film_id),
          tiers: {
            essentialist: { films: [] },
            completionist: { tierOnlyFilms: [] },
            sycophant: { tierOnlyFilms: [] },
          },
        };
        (window.collectionTrophiesRegistry ||= []).push(newDef);
      }
    });
  };

  /**
   * Loads active collection trophies and essential landmarks from Supabase.
   * @returns {Promise<CollectionTrophyProgress[]>} Curated collection trophies with active qualification.
   */
  window.loadCollectionTrophies = async function () {
    let ready = await window.ensureSupabaseClient?.();
    if (!ready) return window.collectionTrophiesData();
    try {
      let { data, error } = await ready.client
        .from("collection_trophies")
        .select(
          "id, entity_type, entity_id, title, persona_name, emblem, edition, letterboxd_url, custom_rules, is_active, collection_trophy_essentials(film_id, sort_order)",
        )
        .eq("is_active", true)
        .order("id");
      if (error) {
        console.warn?.("loadCollectionTrophies query failed", error);
        return window.collectionTrophiesData();
      }
      if (Array.isArray(data)) {
        window.applyCollectionTrophies(data);
      }
    } catch (e) {
      console.warn?.("loadCollectionTrophies exception", e);
    }
    return window.collectionTrophiesData();
  };

  /**
   * Resolves a film record from an archive or shared catalog by ID.
   * @param {string} id Film UUID.
   * @param {Object} [archive] Hydrated archive.
   * @returns {Object|null} Film record or null.
   */
  function findFilmInArchive(id, archive = window.state || {}) {
    if (!id) return null;
    if (archive.filmsById && archive.filmsById[id])
      return archive.filmsById[id];
    if (window.state?.filmsById && window.state.filmsById[id])
      return window.state.filmsById[id];
    const other =
      (archive.watchedOther || []).find((f) => f.id === id) ||
      (window.state?.watchedOther || []).find((f) => f.id === id);
    if (other) return other;
    const wl =
      (archive.watchlist || []).find(
        (w) => w.id === id || w.supabaseFilmId === id,
      ) ||
      (window.state?.watchlist || []).find(
        (w) => w.id === id || w.supabaseFilmId === id,
      );
    if (wl) return wl;
    if (
      window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID &&
      window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID[id]
    ) {
      return window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID[id];
    }
    if (Array.isArray(archive.films)) {
      const match = archive.films.find(
        (f) =>
          f &&
          (f.id === id ||
            f.supabaseFilmId === id ||
            String(f.tmdb_id) === String(id)),
      );
      if (match) return match;
    }
    if (Array.isArray(window.state?.films)) {
      const match = window.state.films.find(
        (f) =>
          f &&
          (f.id === id ||
            f.supabaseFilmId === id ||
            String(f.tmdb_id) === String(id)),
      );
      if (match) return match;
    }
    return null;
  }

  /**
   * Sorts films by release year ascending.
   * @param {[string, string, number, string?][]} list
   * @returns {[string, string, number, string?][]}
   */
  function sortFilmsByYear(list) {
    return [...list].sort(
      (a, b) => a[2] - b[2] || String(a[1]).localeCompare(String(b[1])),
    );
  }

  /**
   * Collects all watched IDs from an archive record.
   * @param {Object} [archive] Hydrated archive.
   * @returns {Set<string>} Watched canonical UUIDs.
   */
  function extractWatchedIds(archive = window.state || {}) {
    const watchedIds = new Set();
    [
      ...Object.values(archive.filmsById || {}),
      ...(archive.watchedOther || []),
    ].forEach((film) => {
      if (film?.supabaseFilmId || film?.id)
        watchedIds.add(film.supabaseFilmId || film.id);
    });
    return watchedIds;
  }

  /**
   * Determines whether a film is classified as lost and excluded from collection trophies.
   * @param {Object|string|[string, string, number, string?]|null} film Film record, ID, or tuple.
   * @param {Object} [customRules] Optional trophy custom rules containing exclusion IDs.
   * @returns {boolean} True if the film is classified as lost.
   */
  window.isLostFilm = function (film, customRules = {}) {
    if (!film) return false;

    const rules = customRules || {};
    const lostIds = new Set([
      ...(rules.lost_film_ids || []),
      ...(rules.lostFilmIds || []),
      ...(rules.exclude_film_ids || []),
      ...(rules.excludeFilmIds || []),
    ]);

    let filmObj = null;

    if (typeof film === "string") {
      if (lostIds.has(film)) return true;
      filmObj = findFilmInArchive(film);
    } else if (Array.isArray(film)) {
      const id = film[0];
      if (id && lostIds.has(id)) return true;
      filmObj = id ? findFilmInArchive(id) : null;
    } else if (typeof film === "object") {
      filmObj = film;
      const id = film.supabaseFilmId || film.id;
      if (id && lostIds.has(id)) return true;
    }

    if (!filmObj) return false;

    if (
      filmObj.is_lost === true ||
      filmObj.lost === true ||
      filmObj.isLost === true
    ) {
      return true;
    }

    const isLostTagName = (name) => {
      if (typeof name !== "string") return false;
      const lower = name.trim().toLowerCase();
      return lower === "lost" || lower === "lost film";
    };

    const tags = Array.isArray(filmObj.tags) ? filmObj.tags : [];
    for (const tag of tags) {
      if (typeof tag === "string" && isLostTagName(tag)) return true;
      if (tag && typeof tag === "object" && isLostTagName(tag.name))
        return true;
    }

    const catalogTags = Array.isArray(filmObj.catalog_tags)
      ? filmObj.catalog_tags
      : Array.isArray(filmObj.film_catalog_tags)
        ? filmObj.film_catalog_tags
        : [];
    for (const tag of catalogTags) {
      if (typeof tag === "string" && isLostTagName(tag)) return true;
      if (tag && typeof tag === "object") {
        if (isLostTagName(tag.name)) return true;
        if (tag.catalog_tags && isLostTagName(tag.catalog_tags.name))
          return true;
      }
    }

    const keywords = [
      ...(Array.isArray(filmObj.keywords) ? filmObj.keywords : []),
      ...(Array.isArray(filmObj.tmdb_keywords) ? filmObj.tmdb_keywords : []),
    ];
    for (const kw of keywords) {
      if (!kw) continue;
      if (Number(kw.id) === 181429) return true;
      if (typeof kw.name === "string" && isLostTagName(kw.name)) return true;
    }

    return false;
  };

  /**
   * Evaluates dynamic qualification and resolves tier progress for a single collection trophy definition.
   * Excludes lost films across all collection trophy levels (Essentialist, Completionist, and Sycophant).
   * @param {CollectionTrophyRow|Object} def Curated collection definition.
   * @param {Object} [archive] Hydrated archive.
   * @param {Set<string>} [watchedIds] Optional pre-extracted watched IDs set.
   * @returns {CollectionTrophyProgress} Curated collection trophy with active qualification.
   */
  window.resolveCollectionTrophyTiers = function (
    def,
    archive = window.state || {},
    watchedIds = null,
  ) {
    const watched = watchedIds || extractWatchedIds(archive);

    /** @type {Map<string, { id: string, title: string, year: number, kind: string, isFeature: boolean, isEssential: boolean }>} */
    const collectedFilms = new Map();

    const customRules = def.customRules || def.custom_rules || {};
    const completionistExcludes = new Set(
      customRules.completionist_exclude_film_ids || [],
    );
    const completionistIncludes = new Set(
      customRules.completionist_include_film_ids || [],
    );
    const sycophantExcludes = new Set(
      customRules.sycophant_exclude_film_ids || [],
    );
    const sycophantIncludes = new Set(
      customRules.sycophant_include_film_ids || [],
    );

    // 1. Curated essentials from def.tiers.essentialist.films
    (def.tiers?.essentialist?.films || []).forEach(
      ([id, title, year, kind]) => {
        const filmRecord = findFilmInArchive(id, archive);
        if (
          window.isLostFilm(filmRecord || [id, title, year, kind], customRules)
        ) {
          return;
        }
        collectedFilms.set(id, {
          id,
          title,
          year: Number(year) || 0,
          kind: kind || "",
          isFeature: true,
          isEssential: true,
        });
      },
    );

    // 2. Curated essentials from essentialFilmIds (from Supabase)
    (def.essentialFilmIds || []).forEach((filmId) => {
      const film = findFilmInArchive(filmId, archive);
      if (window.isLostFilm(film || filmId, customRules)) {
        return;
      }
      if (!collectedFilms.has(filmId)) {
        collectedFilms.set(filmId, {
          id: filmId,
          title: film?.title || `Film ${filmId.slice(0, 8)}`,
          year: Number(film?.year) || 0,
          kind: "",
          isFeature: true,
          isEssential: true,
        });
      } else {
        collectedFilms.get(filmId).isEssential = true;
      }
    });

    // 3. Predefined tierOnly films from seed definitions
    (def.tiers?.completionist?.tierOnlyFilms || []).forEach(
      ([id, title, year, kind]) => {
        const filmRecord = findFilmInArchive(id, archive);
        if (
          window.isLostFilm(filmRecord || [id, title, year, kind], customRules)
        ) {
          return;
        }
        if (!collectedFilms.has(id)) {
          collectedFilms.set(id, {
            id,
            title,
            year: Number(year) || 0,
            kind: kind || "",
            isFeature: true,
            isEssential: false,
          });
        }
      },
    );

    (def.tiers?.sycophant?.tierOnlyFilms || []).forEach(
      ([id, title, year, kind]) => {
        const filmRecord = findFilmInArchive(id, archive);
        if (
          window.isLostFilm(filmRecord || [id, title, year, kind], customRules)
        ) {
          return;
        }
        if (!collectedFilms.has(id)) {
          collectedFilms.set(id, {
            id,
            title,
            year: Number(year) || 0,
            kind: kind || "",
            isFeature: false,
            isEssential: false,
          });
        }
      },
    );

    // 4. Dynamic discovery from catalog when entityType === 'person'
    if (def.entityType === "person") {
      const normKey = window.normalizePersonName
        ? window.normalizePersonName(def.entityId || def.title)
        : String(def.entityId || def.title).toLowerCase();
      const peopleIndex =
        (window.ensurePeopleIndex ? window.ensurePeopleIndex() : null) ||
        archive.peopleById ||
        window.state?.peopleById ||
        {};
      const person =
        peopleIndex[normKey] ||
        Object.values(peopleIndex).find(
          (p) =>
            p.id === normKey ||
            p.name === def.title ||
            (p.aliases || []).includes(def.title),
        );

      if (person) {
        const addDirected = (film) => {
          if (!film || window.isLostFilm(film, customRules)) return;
          const filmId = film.supabaseFilmId || film.id;
          if (
            !filmId ||
            (sycophantExcludes.has(filmId) && !sycophantIncludes.has(filmId))
          )
            return;
          const typeStr = String(film.type || "").trim();
          const isNonFeature = window.isNonFeatureFilm
            ? window.isNonFeatureFilm(film)
            : typeStr && typeStr.toLowerCase() !== "film";
          const isFeature =
            completionistIncludes.has(filmId) ||
            (!completionistExcludes.has(filmId) &&
              (!isNonFeature || typeStr.toLowerCase() === "film"));

          const existing = collectedFilms.get(filmId);
          if (!existing) {
            collectedFilms.set(filmId, {
              id: filmId,
              title: film.title || "",
              year: Number(film.year) || 0,
              kind: isFeature ? "" : typeStr || "Other",
              isFeature,
              isEssential: false,
            });
          }
        };

        (person.filmIds || []).forEach((fId) => {
          const film =
            archive.filmsById?.[fId] ||
            window.state?.filmsById?.[fId] ||
            window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID?.[fId];
          if (film) {
            const isDirector =
              (person.credits || []).some(
                (c) => c.filmId === fId && c.profession === "Director",
              ) || (person.professions || []).includes("Director");
            if (isDirector) addDirected(film);
          }
        });

        (person.watchedOtherIds || []).forEach((fId) => {
          const film =
            (archive.watchedOther || []).find((f) => f.id === fId) ||
            (window.state?.watchedOther || []).find((f) => f.id === fId);
          if (film) addDirected(film);
        });

        (person.watchlistIds || []).forEach((wId) => {
          const item =
            (archive.watchlist || []).find(
              (w) => w.id === wId || w.supabaseFilmId === wId,
            ) ||
            (window.state?.watchlist || []).find(
              (w) => w.id === wId || w.supabaseFilmId === wId,
            );
          if (item) addDirected(item);
        });

        (person.catalogIds || []).forEach((cId) => {
          const film = window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID?.[cId];
          if (film) {
            const isDirector = Object.values(film.people || {}).some(
              (c) =>
                (c.professions || []).includes("Director") &&
                ((window.normalizePersonName
                  ? window.normalizePersonName(c.name)
                  : c.name) === normKey ||
                  c.supabasePersonIds?.includes(person.id)),
            );
            if (isDirector) addDirected(film);
          }
        });

        if (window.watchlistItemsByDirector) {
          const items = window.watchlistItemsByDirector(person.name);
          items.forEach((item) => addDirected(item));
        }

        (customRules.sycophant_include_film_ids || []).forEach((extraId) => {
          if (!collectedFilms.has(extraId)) {
            const film = findFilmInArchive(extraId, archive);
            if (film) addDirected(film);
          }
        });
      }
    }

    // 5. Dynamic discovery from catalog when entityType === 'franchise'
    if (def.entityType === "franchise") {
      const normKey = window.normalizeFranchiseId
        ? window.normalizeFranchiseId(def.entityId || def.title)
        : String(def.entityId || def.title).toLowerCase();
      const franchiseIndex =
        (window.ensureFranchiseIndex ? window.ensureFranchiseIndex() : null) ||
        archive.franchiseIndex ||
        window.state?.franchiseIndex ||
        {};
      const franchise = franchiseIndex[normKey];
      if (franchise) {
        const addFranchise = (film, isFeature) => {
          if (!film || window.isLostFilm(film, customRules)) return;
          const filmId = film.supabaseFilmId || film.id;
          if (!filmId) return;
          const typeStr = String(film.type || "").trim();
          const existing = collectedFilms.get(filmId);
          if (!existing) {
            collectedFilms.set(filmId, {
              id: filmId,
              title: film.title || "",
              year: Number(film.year) || 0,
              kind: isFeature ? "" : typeStr || "Other",
              isFeature,
              isEssential: false,
            });
          }
        };

        (franchise.films || []).forEach((entry) => {
          const film =
            archive.filmsById?.[entry.filmId] ||
            window.state?.filmsById?.[entry.filmId];
          if (film) addFranchise(film, true);
        });
        (franchise.otherFilms || []).forEach((entry) => {
          const film = (archive.watchedOther || []).find(
            (f) => f.id === entry.filmId,
          );
          if (film) addFranchise(film, false);
        });
        (franchise.watchlist || []).forEach((item) => {
          const typeStr = String(item.type || "").trim();
          const isFeature = !typeStr || typeStr.toLowerCase() === "film";
          addFranchise(item, isFeature);
        });
        (franchise.catalogFilms || []).forEach((film) => {
          const typeStr = String(film.type || "").trim();
          const isFeature = !typeStr || typeStr.toLowerCase() === "film";
          addFranchise(film, isFeature);
        });
      }
    }

    // Final filter pass: ensure no lost films are present in collectedFilms
    for (const [filmId, item] of collectedFilms.entries()) {
      const filmRecord = findFilmInArchive(filmId, archive);
      if (window.isLostFilm(filmRecord || item, customRules)) {
        collectedFilms.delete(filmId);
      }
    }

    /** @type {[string, string, number, string?][]} */
    const essentialTuples = [];
    /** @type {[string, string, number, string?][]} */
    const completionistTierOnlyTuples = [];
    /** @type {[string, string, number, string?][]} */
    const sycophantTierOnlyTuples = [];

    for (const item of collectedFilms.values()) {
      /** @type {[string, string, number, string?]} */
      const tuple = [item.id, item.title, item.year, item.kind || undefined];
      if (item.isEssential) {
        essentialTuples.push(tuple);
      } else if (item.isFeature) {
        completionistTierOnlyTuples.push(tuple);
      } else {
        sycophantTierOnlyTuples.push(tuple);
      }
    }

    const sortedEssentialTuples = sortFilmsByYear(essentialTuples);
    const sortedCompletionistTuples = sortFilmsByYear([
      ...essentialTuples,
      ...completionistTierOnlyTuples,
    ]);
    const sortedSycophantTuples = sortFilmsByYear([
      ...essentialTuples,
      ...completionistTierOnlyTuples,
      ...sycophantTierOnlyTuples,
    ]);

    /**
     * Maps raw film tuples to qualified checklist objects.
     * @param {[string, string, number, string?][]} tuples
     */
    const mapChecklist = (tuples) =>
      tuples.map(([id, title, year, kind = ""]) => ({
        id,
        title,
        year,
        watched: watched.has(id),
        kind,
      }));

    const essentialFilms = mapChecklist(sortedEssentialTuples);
    const completionistFilms = mapChecklist(sortedCompletionistTuples);
    const sycophantFilms = mapChecklist(sortedSycophantTuples);

    const essentialTierOnly = mapChecklist(sortedEssentialTuples);
    const completionistTierOnly = mapChecklist(
      sortFilmsByYear(completionistTierOnlyTuples),
    );
    const sycophantTierOnly = mapChecklist(
      sortFilmsByYear(sycophantTierOnlyTuples),
    );

    const essentialWatched = essentialFilms.filter((f) => f.watched).length;
    const completionistWatched = completionistFilms.filter(
      (f) => f.watched,
    ).length;
    const sycophantWatched = sycophantFilms.filter((f) => f.watched).length;

    const defTiers = def.tiers || {};
    const essDef = defTiers.essentialist || {};
    const compDef = defTiers.completionist || {};
    const sycDef = defTiers.sycophant || {};
    const ui =
      window.uiText ||
      ((text, params = {}) => text.replace(/\{(\w+)\}/g, (_, k) => params[k]));

    const essentialScope =
      essDef.scope ||
      ui("{count} landmark films", { count: essentialFilms.length });
    const essentialCriteria =
      essDef.criteria ||
      ui("Watch {count} curated landmarks.", {
        count: essentialFilms.length,
      });
    const essentialCelebration =
      essDef.celebration ||
      ui("You mastered {personaName}'s defining masterpieces.", {
        personaName: def.personaName,
      });
    const essentialInvitation =
      essDef.invitation || ui("Experience the essential landmark films.");

    const completionistScope =
      compDef.scope ||
      ui("{count} theatrical feature films", {
        count: completionistFilms.length,
      });
    const completionistCriteria =
      compDef.criteria ||
      ui("Watch all {count} official films in the theatrical canon.", {
        count: completionistFilms.length,
      });
    const completionistCelebration =
      compDef.celebration || ui("You completed the full theatrical canon.");
    const completionistInvitation =
      compDef.invitation ||
      ui("Watch all {count} official films in the theatrical canon.", {
        count: completionistFilms.length,
      });

    const sycophantScope =
      sycDef.scope ||
      ui("Complete catalog · {count} works", {
        count: sycophantFilms.length,
      });
    const sycophantCriteria =
      sycDef.criteria ||
      ui("Watch every cataloged work directed by {personaName}.", {
        personaName: def.personaName,
      });
    const sycophantCelebration =
      sycDef.celebration ||
      ui("Unhinged completist devotion to {personaName}.", {
        personaName: def.personaName,
      });
    const sycophantInvitation =
      sycDef.invitation || ui("Watch all features and every expanded project.");

    const overallScope =
      def.scope ||
      ui("{count} theatrical feature films", {
        count: completionistFilms.length,
      });
    const overallCelebration = def.celebration || completionistCelebration;
    const overallInvitation = def.invitation || completionistInvitation;
    const overallCriteria = def.criteria || completionistCriteria;

    /** @type {CollectionTierProgress} */
    const essentialistTier = {
      tier: "essentialist",
      title: "Essentialist",
      personaTitle: ui("{personaName} Essentialist", {
        personaName: def.personaName,
      }),
      badge: "🥉",
      level: 1,
      scope: essentialScope,
      criteria: essentialCriteria,
      celebration: essentialCelebration,
      invitation: essentialInvitation,
      films: essentialFilms,
      tierOnlyFilms: essentialTierOnly,
      watchedCount: essentialWatched,
      total: essentialFilms.length,
      earned:
        essentialFilms.length > 0 && essentialWatched === essentialFilms.length,
    };

    /** @type {CollectionTierProgress} */
    const completionistTier = {
      tier: "completionist",
      title: "Completionist",
      personaTitle: ui("{personaName} Completionist", {
        personaName: def.personaName,
      }),
      badge: "🥈",
      level: 2,
      scope: completionistScope,
      criteria: completionistCriteria,
      celebration: completionistCelebration,
      invitation: completionistInvitation,
      films: completionistFilms,
      tierOnlyFilms: completionistTierOnly,
      watchedCount: completionistWatched,
      total: completionistFilms.length,
      earned:
        completionistFilms.length > 0 &&
        completionistWatched === completionistFilms.length,
    };

    /** @type {CollectionTierProgress} */
    const sycophantTier = {
      tier: "sycophant",
      title: "Sycophant",
      personaTitle: ui("{personaName} Sycophant", {
        personaName: def.personaName,
      }),
      badge: "🥇",
      level: 3,
      scope: sycophantScope,
      criteria: sycophantCriteria,
      celebration: sycophantCelebration,
      invitation: sycophantInvitation,
      films: sycophantFilms,
      tierOnlyFilms: sycophantTierOnly,
      watchedCount: sycophantWatched,
      total: sycophantFilms.length,
      earned:
        sycophantFilms.length > 0 && sycophantWatched === sycophantFilms.length,
    };

    const tierList = [essentialistTier, completionistTier, sycophantTier];
    const activeTier = sycophantTier.earned
      ? sycophantTier
      : completionistTier.earned
        ? completionistTier
        : essentialistTier.earned
          ? essentialistTier
          : null;

    const nextTier = !essentialistTier.earned
      ? essentialistTier
      : !completionistTier.earned
        ? completionistTier
        : !sycophantTier.earned
          ? sycophantTier
          : null;

    return {
      id: def.id,
      domId: def.domId,
      title: def.title,
      personaName: def.personaName,
      entityType: /** @type {'person'|'franchise'|'collection'} */ (
        def.entityType
      ),
      entityId: def.entityId,
      emblem: def.emblem,
      edition: def.edition,
      letterboxdUrl: def.letterboxdUrl || null,
      scope: overallScope,
      celebration: overallCelebration,
      invitation: overallInvitation,
      criteria: overallCriteria,
      tiers: {
        essentialist: essentialistTier,
        completionist: completionistTier,
        sycophant: sycophantTier,
      },
      tierList,
      activeTier,
      activePersonaTitle: activeTier ? activeTier.personaTitle : null,
      activeBadge: activeTier ? activeTier.badge : null,
      nextTier,
      highestEarnedLevel: activeTier ? activeTier.level : 0,
      films: sycophantFilms,
      watchedCount: sycophantWatched,
      total: sycophantFilms.length,
      earned: sycophantTier.earned,
      isCurated: true,
    };
  };

  /**
   * Evaluates dynamic qualification for all curated collections and their three tiers.
   * @param {Object} [archive] Hydrated archive.
   * @returns {CollectionTrophyProgress[]} Curated collection trophies with active qualification.
   */
  window.collectionTrophiesData = function (archive = window.state || {}) {
    const watchedIds = extractWatchedIds(archive);

    return (window.collectionTrophiesRegistry || []).map((def) =>
      window.resolveCollectionTrophyTiers(def, archive, watchedIds),
    );
  };

  /**
   * Derives fixed collection progress from watched records in one archive.
   * Backwards-compatible alias for collectionTrophiesData.
   * @param {Object} [archive] Active hydrated archive.
   * @returns {CollectionTrophyProgress[]} Curated trophies with current qualification.
   */
  window.trophyCabinetData = function (archive = window.state || {}) {
    return window.collectionTrophiesData(archive);
  };

  /**
   * Retrieves the curated collection trophy and tier progress for an entity, if curated.
   * @param {string|null} entityType Entity kind ('person', 'franchise', 'collection', or null).
   * @param {string} entityKey Entity key, slug, or title.
   * @param {Object} [archive] Hydrated archive.
   * @returns {CollectionTrophyProgress|null} Curated collection trophy with qualification, or null.
   */
  window.getCollectionTrophy = function (
    entityType,
    entityKey,
    archive = window.state || {},
  ) {
    if (!entityKey) return null;
    const key = String(entityKey).trim().toLowerCase();
    const normName = window.normalizePersonName
      ? window.normalizePersonName(key)
      : key;
    const normFranchise = window.normalizeFranchiseId
      ? window.normalizeFranchiseId(key)
      : key;

    const collections = window.collectionTrophiesData(archive);
    return (
      collections.find((col) => {
        const def = (window.collectionTrophiesRegistry || []).find(
          (d) => d.id === col.id,
        );
        const aliases = (def?.aliases || def?.customRules?.aliases || []).map(
          (a) => String(a).toLowerCase(),
        );

        if (col.id === key || col.entityId === key || aliases.includes(key)) {
          return true;
        }

        if (entityType === "person") {
          return (
            col.entityType === "person" &&
            (col.entityId === normName ||
              col.id === normName ||
              (window.normalizePersonName &&
                window.normalizePersonName(col.title) === normName))
          );
        }

        if (entityType === "franchise") {
          return (
            col.entityType === "franchise" &&
            (col.entityId === normFranchise ||
              col.id === normFranchise ||
              (window.normalizeFranchiseId &&
                window.normalizeFranchiseId(col.title) === normFranchise))
          );
        }

        if (entityType === "collection") {
          return col.entityType === "collection" && col.entityId === key;
        }

        return (
          col.entityId === normName ||
          col.entityId === normFranchise ||
          col.title.toLowerCase() === key
        );
      }) || null
    );
  };

  /**
   * Reports the primary curation tier for a film within a curated collection.
   * @param {CollectionTrophyProgress|string|null} collectionOrId Curated collection trophy or identifier.
   * @param {string|CollectionTrophyProgress|null} filmId Film identifier or canonical UUID.
   * @returns {TrophyTierKey|null} Primary tier ('essentialist', 'completionist', 'sycophant'), or null.
   */
  window.getCollectionFilmTier = function (collectionOrId, filmId) {
    if (!collectionOrId || !filmId) return null;
    let col = null;
    let targetFilmId = "";
    if (
      typeof collectionOrId === "object" &&
      /** @type {any} */ (collectionOrId).tiers
    ) {
      col = /** @type {CollectionTrophyProgress} */ (collectionOrId);
      targetFilmId = String(filmId);
    } else if (
      typeof filmId === "object" &&
      /** @type {any} */ (filmId).tiers
    ) {
      col = /** @type {CollectionTrophyProgress} */ (filmId);
      targetFilmId = String(collectionOrId);
    } else {
      const col1 = window.getCollectionTrophy(null, String(collectionOrId));
      if (col1) {
        col = col1;
        targetFilmId = String(filmId);
      } else {
        const col2 = window.getCollectionTrophy(null, String(filmId));
        if (col2) {
          col = col2;
          targetFilmId = String(collectionOrId);
        }
      }
    }
    if (!col || !col.tiers || !targetFilmId) return null;

    if (col.tiers.essentialist.films.some((f) => f.id === targetFilmId)) {
      return "essentialist";
    }
    if (
      col.tiers.completionist.tierOnlyFilms.some((f) => f.id === targetFilmId)
    ) {
      return "completionist";
    }
    if (col.tiers.sycophant.tierOnlyFilms.some((f) => f.id === targetFilmId)) {
      return "sycophant";
    }
    return null;
  };

  /**
   * Collects all earned persona titles unlocked by an archive across curated collections.
   * @param {Object} [archive] Hydrated archive.
   * @returns {EarnedPersonaTitle[]} Earned persona milestones.
   */
  window.getEarnedPersonaTitles = function (archive = window.state || {}) {
    const collections = window.collectionTrophiesData(archive);
    /** @type {EarnedPersonaTitle[]} */
    const earned = [];
    for (const col of collections) {
      if (col.activeTier) {
        earned.push({
          collectionId: col.id,
          collectionTitle: col.title,
          entityType: col.entityType,
          entityId: col.entityId,
          tier: col.activeTier.tier,
          title: col.activeTier.title,
          personaTitle: col.activeTier.personaTitle,
          badge: col.activeTier.badge,
          level: col.activeTier.level,
          emblem: col.emblem,
        });
      }
    }
    return earned;
  };

  /**
   * Dynamically adds a work to a curated collection tier to update qualification requirements.
   * @param {string} collectionId Unique collection identifier.
   * @param {TrophyTierKey} tierKey Tier to add work to ('essentialist', 'completionist', 'sycophant').
   * @param {[string, string, number, string?]} film Work tuple [id, title, year, kind?].
   * @returns {boolean} Whether the addition succeeded.
   */
  window.addFilmToCollectionTier = function (collectionId, tierKey, film) {
    const registry = window.collectionTrophiesRegistry || [];
    const def = registry.find(
      (d) =>
        d.id === collectionId ||
        (d.aliases || []).includes(collectionId) ||
        (d.customRules?.aliases || []).includes(collectionId),
    );
    if (!def || !film || !film[0]) return false;

    def.tiers ||= {
      essentialist: { films: [] },
      completionist: { tierOnlyFilms: [] },
      sycophant: { tierOnlyFilms: [] },
    };

    if (tierKey === "essentialist") {
      def.tiers.essentialist.films.push(film);
      return true;
    }
    if (tierKey === "completionist") {
      def.tiers.completionist.tierOnlyFilms = [
        ...(def.tiers.completionist.tierOnlyFilms || []),
        film,
      ];
      return true;
    }
    if (tierKey === "sycophant") {
      def.tiers.sycophant.tierOnlyFilms = [
        ...(def.tiers.sycophant.tierOnlyFilms || []),
        film,
      ];
      return true;
    }
    return false;
  };
})();
