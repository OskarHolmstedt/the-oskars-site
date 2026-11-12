/** @file Defines curated collection trophies with 3-tier persona progression (Essentialist, Completionist, Sycophant) and dynamic qualification. */
(function () {
  /** @type {Object[]} Curated collection trophy definitions, built from curator rows by applyCollectionTrophies(). */
  window.collectionTrophiesRegistry = [];

  /**
   * Applies curated collection trophy rows, each with its complete curator film list, to the local registry.
   * @param {CollectionTrophyRow[]} rows Trophy rows from the bundled curator copy.
   * @returns {void}
   */
  window.applyCollectionTrophies = function (rows) {
    if (!Array.isArray(rows)) return;
    const registry = (window.collectionTrophiesRegistry ||= []);
    rows.forEach((row) => {
      if (!row || !row.id) return;
      const id = String(row.id).trim();
      const def = {
        id,
        domId: `${id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}Trophy`,
        title: row.title,
        personaName: row.persona_name,
        entityType: row.entity_type,
        entityId: row.entity_id,
        emblem: row.emblem || "",
        edition: row.edition || "",
        letterboxdUrl: row.letterboxd_url || null,
        films: (row.collection_trophy_films || []).map((film) => ({
          id: film.film_id,
          tier: film.tier,
          title: film.title || "",
          year: Number(film.year) || 0,
          type: film.type || "",
        })),
      };
      const index = registry.findIndex((existing) => existing.id === id);
      if (index >= 0) registry[index] = def;
      else registry.push(def);
    });
  };

  if (Array.isArray(window.BUNDLED_COLLECTION_TROPHIES)) {
    window.applyCollectionTrophies(window.BUNDLED_COLLECTION_TROPHIES);
  }

  /**
   * Resolves a film record from an archive or shared catalog by ID.
   * @param {string} id Film UUID.
   * @param {Object} [archive] Hydrated archive.
   * @returns {Object|null} Film record or null.
   */
  // Secondary film index per source collection, cached by object identity and
  // validated by entry count. Trophy resolution looks up thousands of ids and
  // most are misses, so the linear scans this replaces made a single
  // collectionTrophiesData() call take seconds on a hydrated archive.
  const filmSourceIndexCache = new WeakMap();

  function filmSourceLookup(source, id, includeTmdb) {
    if (!source || typeof source !== "object") return null;
    const isArray = Array.isArray(source);
    let cached = filmSourceIndexCache.get(source);
    // Arrays revalidate by length on every call (O(1)); keyed pools only
    // recount their entries at most twice a second, since counting keys of a
    // multi-thousand-entry object per lookup is itself the quadratic cost
    // this cache exists to remove.
    let stale = !cached;
    if (cached) {
      if (isArray) {
        stale = cached.size !== source.length;
      } else if (Date.now() - cached.checkedAt > 500) {
        stale = cached.size !== Object.keys(source).length;
        cached.checkedAt = Date.now();
      }
    }
    if (stale) {
      const films = isArray ? source : Object.values(source);
      const map = new Map();
      films.forEach((f) => {
        if (!f) return;
        // First match wins, like the linear scans this replaces.
        if (f.id != null && !map.has(f.id)) map.set(f.id, f);
        if (f.supabaseFilmId != null && !map.has(f.supabaseFilmId))
          map.set(f.supabaseFilmId, f);
        if (f.tmdb_id != null && !map.has(`tmdb:${f.tmdb_id}`))
          map.set(`tmdb:${f.tmdb_id}`, f);
      });
      cached = { size: films.length, map, checkedAt: Date.now() };
      filmSourceIndexCache.set(source, cached);
    }
    return (
      cached.map.get(id) ||
      (includeTmdb ? cached.map.get(`tmdb:${String(id)}`) : null) ||
      null
    );
  }

  function findFilmInArchive(id, archive = window.state || {}) {
    if (!id) return null;
    const direct = archive.filmsById?.[id] || window.state?.filmsById?.[id];
    if (direct) return direct;

    const filmsByIdPool = archive.filmsById || window.state?.filmsById;
    const match =
      filmSourceLookup(filmsByIdPool, id, true) ||
      filmSourceLookup(archive.watchedOther, id, false) ||
      filmSourceLookup(window.state?.watchedOther, id, false) ||
      filmSourceLookup(archive.watchlist, id, false) ||
      filmSourceLookup(window.state?.watchlist, id, false) ||
      filmSourceLookup(archive.watched, id, false) ||
      filmSourceLookup(window.state?.watched, id, false) ||
      window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID?.[id] ||
      filmSourceLookup(window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID, id, true) ||
      (Array.isArray(archive.films)
        ? filmSourceLookup(archive.films, id, true)
        : null) ||
      (Array.isArray(window.state?.films)
        ? filmSourceLookup(window.state.films, id, true)
        : null);
    return match || null;
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
      ...(Array.isArray(archive.watched) ? archive.watched : []),
      ...Object.values(archive.filmsById || {}),
      ...(archive.watchedOther || []),
    ].forEach((film) => {
      if (film?.supabaseFilmId) watchedIds.add(film.supabaseFilmId);
      if (film?.id) watchedIds.add(film.id);
    });
    return watchedIds;
  }

  /**
   * Evaluates qualification for one curated collection trophy, placing each film in its curator-assigned tier.
   * @param {Object} def Curated collection definition from applyCollectionTrophies().
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

    /** @type {Record<TrophyTierKey, [string, string, number, string?][]>} */
    const tuplesByTier = { essentialist: [], completionist: [], sycophant: [] };
    (def.films || []).forEach((film) => {
      const tuples = tuplesByTier[film.tier];
      if (!tuples || !film.id) return;
      const type = String(film.type || "").trim();
      tuples.push([
        film.id,
        film.title,
        film.year,
        type && type.toLowerCase() !== "film" ? type : undefined,
      ]);
    });
    const essentialTuples = tuplesByTier.essentialist;
    const completionistTierOnlyTuples = tuplesByTier.completionist;
    const sycophantTierOnlyTuples = tuplesByTier.sycophant;

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
    // Each film appears in up to six tier lists; resolve its archive record once.
    /** @type {Map<string, boolean>} */
    const watchedByFilmId = new Map();
    const isWatchedFilm = (id) => {
      let isWatched = watchedByFilmId.get(id);
      if (isWatched === undefined) {
        const filmRecord = watched.has(id)
          ? null
          : findFilmInArchive(id, archive);
        isWatched =
          watched.has(id) ||
          Boolean(
            filmRecord &&
            ((filmRecord.id && watched.has(filmRecord.id)) ||
              (filmRecord.supabaseFilmId &&
                watched.has(filmRecord.supabaseFilmId))),
          );
        watchedByFilmId.set(id, isWatched);
      }
      return isWatched;
    };
    const mapChecklist = (tuples) =>
      tuples.map(([id, title, year, kind = ""]) => ({
        id,
        title,
        year,
        watched: isWatchedFilm(id),
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

    const ui =
      window.uiText ||
      ((text, params = {}) => text.replace(/\{(\w+)\}/g, (_, k) => params[k]));

    const essentialScope = ui("{count} landmark films", {
      count: essentialFilms.length,
    });
    const essentialCriteria = ui("Watch {count} curated landmarks.", {
      count: essentialFilms.length,
    });
    const essentialCelebration = ui(
      "You mastered {personaName}'s defining masterpieces.",
      { personaName: def.personaName },
    );
    const essentialInvitation = ui("Experience the essential landmark films.");

    const completionistScope = ui("{count} theatrical feature films", {
      count: completionistFilms.length,
    });
    const completionistCriteria = ui(
      "Watch all {count} official films in the theatrical canon.",
      { count: completionistFilms.length },
    );
    const completionistCelebration = ui(
      "You completed the full theatrical canon.",
    );

    const sycophantScope = ui("Complete catalog · {count} works", {
      count: sycophantFilms.length,
    });
    const sycophantCriteria =
      def.entityType === "franchise"
        ? ui("Watch every cataloged work in the {personaName} franchise.", {
            personaName: def.personaName,
          })
        : ui("Watch every cataloged work directed by {personaName}.", {
            personaName: def.personaName,
          });
    const sycophantCelebration = ui(
      "Unhinged completist devotion to {personaName}.",
      { personaName: def.personaName },
    );
    const sycophantInvitation = ui(
      "Watch all features and every expanded project.",
    );

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
      invitation: completionistCriteria,
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

    const kind =
      def.kind ||
      (def.entityType === "person"
        ? "filmography"
        : def.entityType === "franchise"
          ? "franchise"
          : "other-collection");

    return {
      id: def.id,
      domId: def.domId,
      title: def.title,
      personaName: def.personaName,
      kind,
      entityType: /** @type {'person'|'franchise'|'collection'} */ (
        def.entityType ||
          (kind === "filmography"
            ? "person"
            : kind === "franchise"
              ? "franchise"
              : "collection")
      ),
      entityId: def.entityId,
      emblem: def.emblem,
      edition: def.edition,
      letterboxdUrl: def.letterboxdUrl || null,
      scope: completionistScope,
      celebration: "",
      invitation: completionistCriteria,
      criteria: completionistCriteria,
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
   * Derives viewing journey progress trophies (Volume, Decathlon, Critic, Canon).
   * @param {Object} [archive] Hydrated archive.
   * @returns {CollectionTrophyProgress[]} Progress milestones with active qualification.
   */
  window.progressTrophiesData = function (archive = window.state || {}) {
    const ui = window.uiText || ((text) => text);
    const watchedMap = archive.filmsById || {};
    const watchedList = Object.values(watchedMap).filter(
      (f) => f && (f.id || f.title),
    );
    const watchedOther = archive.watchedOther || [];
    const watchedCount = watchedList.length + watchedOther.length;
    const ratedCount = watchedList.filter((f) => f.rating).length;

    // 1. Decade Decathlon
    const decadeGoals = window.watchGoalProgress
      ? window.watchGoalProgress("decade", { state: archive })
      : [];
    const decadeTarget = window.WATCH_GOAL_TARGETS?.decade || 50;
    const metDecades = (decadeGoals || []).filter((d) => {
      const totalMetric = (d.metrics || []).find((m) => m.key === "total");
      return totalMetric
        ? totalMetric.met
        : (d.watchedCount || 0) >= decadeTarget;
    }).length;

    // 2. Canonical Lists
    const canonicalLists = window.allCanonicalListsCompletion
      ? [
          ...(
            window.allCanonicalListsCompletion({ state: archive }) || new Map()
          ).values(),
        ]
      : [];
    const canonicalWatched = canonicalLists.reduce(
      (sum, list) => sum + (list.watchedCount || 0),
      0,
    );

    function createProgressTrophy(config) {
      const tierList = config.tiers.map((t, index) => {
        const earned = t.current >= t.target;
        return {
          tier: t.key,
          title: t.title,
          personaTitle: t.personaTitle,
          badge: t.badge,
          level: index + 1,
          scope: t.scope,
          criteria: t.criteria,
          celebration: t.celebration,
          invitation: t.invitation,
          films: [],
          tierOnlyFilms: [],
          watchedCount: Math.min(t.current, t.target),
          total: t.target,
          earned,
        };
      });

      const activeTier = tierList[2].earned
        ? tierList[2]
        : tierList[1].earned
          ? tierList[1]
          : tierList[0].earned
            ? tierList[0]
            : null;

      const nextTier = !tierList[0].earned
        ? tierList[0]
        : !tierList[1].earned
          ? tierList[1]
          : !tierList[2].earned
            ? tierList[2]
            : null;

      return {
        id: config.id,
        domId: config.domId,
        title: config.title,
        personaName: config.personaName,
        kind: "progress",
        entityType: /** @type {'progress'} */ ("progress"),
        entityId: config.id,
        emblem: config.emblem,
        edition: config.edition || null,
        letterboxdUrl: null,
        scope: config.scope,
        celebration: config.celebration,
        invitation: config.invitation,
        criteria: config.criteria,
        tiers: {
          essentialist: tierList[0],
          completionist: tierList[1],
          sycophant: tierList[2],
        },
        tierList,
        activeTier,
        activePersonaTitle: activeTier ? activeTier.personaTitle : null,
        activeBadge: activeTier ? activeTier.badge : null,
        nextTier,
        highestEarnedLevel: activeTier ? activeTier.level : 0,
        films: [],
        watchedCount: tierList[2].watchedCount,
        total: tierList[2].total,
        earned: tierList[2].earned,
        isCurated: true,
      };
    }

    return [
      createProgressTrophy({
        id: "progress-volume",
        domId: "progressVolumeTrophy",
        title: ui("Archive Volume"),
        personaName: ui("Archivist"),
        emblem: "AV",
        scope: ui("Watched films logged across your archive"),
        celebration: ui("You have built an extraordinary cinematic archive."),
        invitation: ui(
          "Grow your total watch count across all cinematic eras.",
        ),
        criteria: ui("Log watched films in your personal archive."),
        tiers: [
          {
            key: "essentialist",
            badge: "🥉",
            title: "Century",
            personaTitle: ui("Century Archivist"),
            scope: ui("100 films watched"),
            criteria: ui("Log 100 watched films in your archive."),
            celebration: ui("You have logged your first hundred films."),
            invitation: ui("Reach 100 films logged in your archive."),
            current: watchedCount,
            target: 100,
          },
          {
            key: "completionist",
            badge: "🥈",
            title: "Cinéaste",
            personaTitle: ui("Cinéaste Archivist"),
            scope: ui("500 films watched"),
            criteria: ui("Log 500 watched films in your archive."),
            celebration: ui("Half a thousand films cataloged and watched."),
            invitation: ui("Reach 500 films logged in your archive."),
            current: watchedCount,
            target: 500,
          },
          {
            key: "sycophant",
            badge: "🥇",
            title: "Grand Archivist",
            personaTitle: ui("Grand Archivist"),
            scope: ui("1,000 films watched"),
            criteria: ui("Log 1,000 watched films in your archive."),
            celebration: ui("A monumental cinephile milestone: 1,000 films."),
            invitation: ui("Reach 1,000 films logged in your archive."),
            current: watchedCount,
            target: 1000,
          },
        ],
      }),
      createProgressTrophy({
        id: "progress-decathlon",
        domId: "progressDecathlonTrophy",
        title: ui("Decade Decathlon"),
        personaName: ui("Decathlete"),
        emblem: "DD",
        scope: ui("Coverage goals across film history decades"),
        celebration: ui(
          "Complete temporal mastery: 10 decades of cinema conquered.",
        ),
        invitation: ui(
          "Reach watch targets across distinct decades of film history.",
        ),
        criteria: ui("Reach the 50-film watch goal in historical decades."),
        tiers: [
          {
            key: "essentialist",
            badge: "🥉",
            title: "Decade Explorer",
            personaTitle: ui("Decade Explorer"),
            scope: ui("3 decades reached"),
            criteria: ui("Reach the watch goal in 3 distinct decades."),
            celebration: ui(
              "You have broad taste spanning multiple cinematic eras.",
            ),
            invitation: ui("Reach watch goals in 3 decades."),
            current: metDecades,
            target: 3,
          },
          {
            key: "completionist",
            badge: "🥈",
            title: "Decade Pioneer",
            personaTitle: ui("Decade Pioneer"),
            scope: ui("6 decades reached"),
            criteria: ui("Reach the watch goal in 6 distinct decades."),
            celebration: ui(
              "Over half a century of film history thoroughly explored.",
            ),
            invitation: ui("Reach watch goals in 6 decades."),
            current: metDecades,
            target: 6,
          },
          {
            key: "sycophant",
            badge: "🥇",
            title: "Decathlon Master",
            personaTitle: ui("Decathlon Master"),
            scope: ui("10 decades reached"),
            criteria: ui("Reach the watch goal across 10 distinct decades."),
            celebration: ui("Mastery across ten distinct decades of cinema."),
            invitation: ui("Reach watch goals across 10 decades."),
            current: metDecades,
            target: 10,
          },
        ],
      }),
      createProgressTrophy({
        id: "progress-critic",
        domId: "progressCriticTrophy",
        title: ui("Critic's Notebook"),
        personaName: ui("Critic"),
        emblem: "CN",
        scope: ui("Calibrated star ratings across your archive"),
        celebration: ui(
          "A discerning critical voice with deep ratings coverage.",
        ),
        invitation: ui(
          "Rate watched films to calibrate your personal critical archive.",
        ),
        criteria: ui("Give star ratings to films you have watched."),
        tiers: [
          {
            key: "essentialist",
            badge: "🥉",
            title: "Initiate Reviewer",
            personaTitle: ui("Initiate Reviewer"),
            scope: ui("100 films rated"),
            criteria: ui("Rate at least 100 films in your archive."),
            celebration: ui("Your critical standard has begun to take shape."),
            invitation: ui("Rate 100 films in your archive."),
            current: ratedCount,
            target: 100,
          },
          {
            key: "completionist",
            badge: "🥈",
            title: "Archive Critic",
            personaTitle: ui("Archive Critic"),
            scope: ui("500 films rated"),
            criteria: ui("Rate at least 500 films in your archive."),
            celebration: ui(
              "A comprehensive critical catalog spanning hundreds of works.",
            ),
            invitation: ui("Rate 500 films in your archive."),
            current: ratedCount,
            target: 500,
          },
          {
            key: "sycophant",
            badge: "🥇",
            title: "Master of Taste",
            personaTitle: ui("Master of Taste"),
            scope: ui("1,000 films rated"),
            criteria: ui("Rate at least 1,000 films in your archive."),
            celebration: ui(
              "An encyclopedic, thoroughly evaluated personal canon.",
            ),
            invitation: ui("Rate 1,000 films in your archive."),
            current: ratedCount,
            target: 1000,
          },
        ],
      }),
      createProgressTrophy({
        id: "progress-canonical",
        domId: "progressCanonicalTrophy",
        title: ui("The Canon"),
        personaName: ui("Scholar"),
        emblem: "TC",
        scope: ui("Films watched from canonical historical lists"),
        celebration: ui(
          "Deep immersion in the universally recognized cinematic canon.",
        ),
        invitation: ui(
          "Explore landmark works across curated canonical lists.",
        ),
        criteria: ui("Watch films included on canonical historical lists."),
        tiers: [
          {
            key: "essentialist",
            badge: "🥉",
            title: "Canon Seeker",
            personaTitle: ui("Canon Seeker"),
            scope: ui("25 canonical films watched"),
            criteria: ui("Watch 25 films from curated canonical lists."),
            celebration: ui(
              "First steps into cinema's established landmark works.",
            ),
            invitation: ui("Watch 25 canonical list films."),
            current: canonicalWatched,
            target: 25,
          },
          {
            key: "completionist",
            badge: "🥈",
            title: "Canon Scholar",
            personaTitle: ui("Canon Scholar"),
            scope: ui("100 canonical films watched"),
            criteria: ui("Watch 100 films from curated canonical lists."),
            celebration: ui(
              "Solid foundation across the historical film canon.",
            ),
            invitation: ui("Watch 100 canonical list films."),
            current: canonicalWatched,
            target: 100,
          },
          {
            key: "sycophant",
            badge: "🥇",
            title: "Canon Authority",
            personaTitle: ui("Canon Authority"),
            scope: ui("250 canonical films watched"),
            criteria: ui("Watch 250 films from curated canonical lists."),
            celebration: ui("Exhaustive command of essential film history."),
            invitation: ui("Watch 250 canonical list films."),
            current: canonicalWatched,
            target: 250,
          },
        ],
      }),
    ];
  };

  /**
   * Returns all collection and progress trophies.
   * @param {Object} [archive] Hydrated archive.
   * @returns {CollectionTrophyProgress[]} All trophies.
   */
  window.allTrophiesData = function (archive = window.state || {}) {
    return [
      ...window.collectionTrophiesData(archive),
      ...window.progressTrophiesData(archive),
    ];
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

    const def = (window.collectionTrophiesRegistry || []).find((col) => {
      if (col.id === key || col.entityId === key) {
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
    });
    return def ? window.resolveCollectionTrophyTiers(def, archive, null) : null;
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
    const list = window.allTrophiesData
      ? window.allTrophiesData(archive)
      : window.collectionTrophiesData(archive);
    /** @type {EarnedPersonaTitle[]} */
    const earned = [];
    for (const col of list) {
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
})();
