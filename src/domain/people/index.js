/**
 * @file Builds lazy people and credit-subject indexes from canonical films and awards.
 */

window.PERSON_AWARD_PROFESSIONS = {
  "Best Director": "Director",
  "Best Original Screenplay": "Screenwriter",
  "Best Lead Actor": "Actor",
  "Best Supporting Actor": "Actor",
  "Best Score": "Composer",
  "Best Cinematography": "Cinematographer",
  "Best Editing": "Editor",
  "Best Adapted Screenplay": "Screenwriter",
  "Best Lead Actress": "Actor",
  "Best Supporting Actress": "Actor",
  "Best Song": "Songwriter",
  "Best Visual Effects": "Visual effects",
  "Best Costume Design": "Costume designer",
};

/**
 * Groups one film's own award recipients by profession (issue #636): every
 * person nominated for this film, with the roles/songs/details and award
 * placements from this film alone. Pure, and equivalent to the film's own
 * slice of `rebuildPeopleIndex()`'s archive-wide `film.peopleByProfession`
 * (which calls this for every loaded film) - both key each entry by
 * `window.resolveAwardRecipients()`'s alias-resolved `personId`, so a
 * caller with only this one film's data reproduces the exact same groups a
 * full archive read would (in Supabase mode this is a no-op, since it
 * never populates `state.peopleAliases`, issue #633), letting a compact
 * page render credits without loading the shared people index.
 * `supabasePersonId` (a real people.id, when this film's own recipient
 * rows carry one and no alias remapped them) lets a caller build a direct
 * link without an index lookup; a caller that has the full people index
 * can still resolve a better-known id there instead.
 * @param {FilmRecord} film Film with its own `.awards`.
 * @returns {Record<string, {id: string, supabasePersonId: string|null, name: string, details: string[], awards: {category: string, period: string, placement: number}[]}[]>}
 */
window.buildFilmPeopleByProfession = function (film) {
  let groups = {};
  (film?.awards || []).forEach((award) => {
    let profession = window.PERSON_AWARD_PROFESSIONS[award.category];
    if (!profession) return;
    let detail = window.awardDetail(award);
    window.resolveAwardRecipients(award).forEach((recipient) => {
      let group = (groups[profession] ||= []);
      let entry = group.find(
        (candidate) => candidate.id === recipient.personId,
      );
      if (!entry) {
        entry = {
          id: recipient.personId,
          supabasePersonId: recipient.supabasePersonId || null,
          name: recipient.name,
          details: [],
          awards: [],
        };
        group.push(entry);
      } else if (!entry.supabasePersonId && recipient.supabasePersonId) {
        entry.supabasePersonId = recipient.supabasePersonId;
      }
      if (detail && !entry.details.includes(detail)) entry.details.push(detail);
      let placement = Number(award.placement) || 0;
      if (
        !entry.awards.some(
          (existing) =>
            existing.category === award.category &&
            String(existing.period) === String(award.year) &&
            Number(existing.placement) === placement,
        )
      ) {
        entry.awards.push({
          category: award.category,
          period: award.year,
          placement,
        });
      }
    });
  });
  Object.values(groups).forEach((group) =>
    group.sort((left, right) =>
      window.comparePersonNamesBySurname(left.name, right.name),
    ),
  );
  return groups;
};

// TMDB's own cast gender field (0 not set, 1 female, 2 male, 3 non-binary),
// keyed by the four gendered acting categories this app names after the
// historical Oscar convention - used only to narrow the default cast list
// shown for a nomination (src/pages/awards-year.js), never to block a
// nomination outright. The consuming filter only excludes the *opposite*
// binary gender (Actor hides confirmed-female, Actress hides
// confirmed-male) - a non-binary or untagged cast member is left eligible
// for either category, since the field is self-reported and often unset.
window.ACTOR_CATEGORY_GENDER = {
  "Best Lead Actor": 2,
  "Best Supporting Actor": 2,
  "Best Lead Actress": 1,
  "Best Supporting Actress": 1,
};

window.PERSON_PROFESSION_ORDER = [
  "Director",
  "Screenwriter",
  "Actor",
  "Composer",
  "Songwriter",
  "Cinematographer",
  "Editor",
  "Visual effects",
  "Costume designer",
];

let knownGroupPersonCredits = new Set(["huey lewis and the news"]);

/** Builds a role or song subject id. @param {string} type Subject type. @param {string} filmId Film id. @param {string} title Subject title. @returns {string} Subject id. */
window.makeCreditSubjectId = function (type, filmId, title) {
  if (type === "role") return `role::${normalizeTitle(title)}`;
  return `${type}::${filmId}::${normalizeTitle(title)}`;
};

/** Maps an award credit to a subject type. @param {string} category Category. @param {string} profession Profession. @returns {string} Subject type or empty string. */
window.creditSubjectType = function (category, profession) {
  if (category === "Best Song") return "song";
  if (profession === "Actor") return "role";
  return "";
};

/** Reports whether a category can have more than one nominee from the same film in the same period (acting, song). @param {string} category Award category. @returns {boolean} Whether multiple nominees are allowed. */
window.isMultiNomineeCategory = function (category) {
  return Boolean(
    window.creditSubjectType(
      category,
      window.PERSON_AWARD_PROFESSIONS[category],
    ),
  );
};

/** Normalizes a person name to its canonical id. @param {*} value Name. @returns {string} Person id. */
window.normalizePersonName = function (value) {
  return window.normalizeTitle(window.stripPersonDisambiguator(value));
};

/** Parses credited names and reports ambiguous separators. @param {*} value Credit text. @returns {{names: string[], ambiguous: boolean}} Parsed credit. */
window.parsePersonCredit = function (value) {
  let original = String(value || "").trim();
  if (!original) return { names: [], ambiguous: false };
  if (knownGroupPersonCredits.has(original.toLowerCase()))
    return { names: [original], ambiguous: false };

  let names = window.splitRecipientNames(original);

  return {
    names,
    // These separators and annotations can represent alternatives, teams, or roles.
    ambiguous: /\/|\s&\s|\sand\s|\([^)]*\)/i.test(original),
  };
};

// Watchlist/catalog edges from read_people_directory_edges(), used only
// while the watchlist and shared catalog themselves are not loaded. They are
// the signed-in account's own, so never for a public profile's archive.
function peopleDirectoryEdges() {
  if (window.OSKARS_STATE_HYDRATION_COMPLETE === true) return null;
  if (state.isPublicProfileView) return null;
  return state.peopleDirectoryEdges || null;
}

/** Reports whether the people index takes its watchlist and catalog edges from read_people_directory_edges() rows. @returns {boolean} Whether those rows are in use. */
window.peopleDirectoryEdgesInUse = function () {
  return Boolean(peopleDirectoryEdges());
};

/**
 * Returns a person's watchlist items (issue #633): from the loaded
 * watchlist, or - while the people index uses read_people_directory_edges()
 * rows - reshaped from the items those rows carry, which are every item
 * only when requested with allWatchlistItems.
 * @param {PersonRecord} person
 * @returns {WatchlistItem[]} Items in watchlist order.
 */
window.personWatchlistItems = function (person) {
  if (!peopleDirectoryEdges()) {
    let byId = new Map(
      (state.watchlist || []).map((item) => [
        item.id || window.watchlistItemId?.(item),
        item,
      ]),
    );
    return (person?.watchlistIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean);
  }
  return (person?.watchlistPreview || [])
    .map((row) =>
      window.supabaseLegacyHydrationWatchlistItem?.(
        row,
        row.order != null ? Number(row.order) - 1 : null,
        null,
      ),
    )
    .filter(Boolean);
};

/** Reports whether this page's own-account archive is partial (no watchlist or shared catalog) and needs read_people_directory_edges() rows for its people index; never for a public profile. @returns {boolean} */
window.peopleDirectoryEdgesNeeded = function () {
  return (
    window.OSKARS_STATE_HYDRATION_COMPLETE === false &&
    !state.isPublicProfileView &&
    Boolean(window.loadSupabasePeopleDirectoryEdges)
  );
};

/**
 * Loads read_people_directory_edges() rows into the people index (issue
 * #633), or the complete archive if that read fails. Never rejects.
 * @param {{allWatchlistItems?: boolean}} [options]
 * @returns {Promise<void>}
 */
window.loadPeopleDirectoryEdges = async function (options = {}) {
  try {
    state.peopleDirectoryEdges =
      await window.loadSupabasePeopleDirectoryEdges(options);
    state.peopleIndexVersion = null;
  } catch (error) {
    console.warn(
      "Could not load people edges; loading the full archive.",
      error,
    );
    await window.ensureFocusedShellData?.().catch(() => {});
  }
};

/** Rebuilds people, film-profession, and credit-subject indexes. @returns {Record<string, PersonRecord>} People index. */
window.rebuildPeopleIndex = function () {
  let done = window.startOskarsPerformance?.("rebuildPeopleIndex");
  let peopleById = {};
  let issues = [];
  let issueKeys = new Set();

  function ensurePerson(name, supabasePersonId = null) {
    let variantId = window.normalizePersonName(name);
    if (!variantId) return null;
    let canonicalName = state.peopleAliases?.[variantId] || String(name).trim();
    let id = window.normalizePersonName(canonicalName);
    if (!id) return null;

    let person = (peopleById[id] ||= {
      id,
      name: canonicalName,
      portrait:
        window.normalizePosterRecord?.(state.personPortraits?.[id]) || null,
      sourceUrl: state.directorLinks?.[id] || "",
      aliases: [],
      professions: [],
      credits: [],
      filmIds: [],
      watchedOtherIds: [],
      watchlistIds: [],
      catalogIds: [],
      _creditKeys: new Set(),
      _supabasePersonIds: new Set(),
    });
    if (!person.aliases.includes(String(name).trim()))
      person.aliases.push(String(name).trim());
    // Real people.id candidates (issue #633) - resolved to one
    // supabasePersonId at finalize only if every source agrees; a slug that
    // maps to two different database people stays slug-only.
    if (supabasePersonId) person._supabasePersonIds.add(supabasePersonId);
    let portraitPersonId = state.personSupabaseIds?.[id];
    if (portraitPersonId) person._supabasePersonIds.add(portraitPersonId);
    return person;
  }

  // film.directors/film.directorIds are index-aligned (see
  // reshapeSharedFilmFields); a name parsed back out of the flat director
  // string is matched to its id by normalized name.
  function directorSupabaseId(record, name) {
    let key = window.normalizePersonName(name);
    let index = (record?.directors || []).findIndex(
      (candidate) => window.normalizePersonName(candidate) === key,
    );
    return index >= 0 ? record.directorIds?.[index] || null : null;
  }

  // Same index resolution as directorSupabaseId, for the parallel
  // directorUncredited array (issue #784).
  function directorIsUncredited(record, name) {
    let key = window.normalizePersonName(name);
    let index = (record?.directors || []).findIndex(
      (candidate) => window.normalizePersonName(candidate) === key,
    );
    return index >= 0 ? Boolean(record.directorUncredited?.[index]) : false;
  }

  function addCredit(name, credit, supabasePersonId = null) {
    let person = ensurePerson(name, supabasePersonId);
    if (!person) return;
    if (credit.profession && !person.professions.includes(credit.profession))
      person.professions.push(credit.profession);
    if (!person.filmIds.includes(credit.filmId))
      person.filmIds.push(credit.filmId);

    let creditKey = [
      credit.source,
      credit.filmId,
      credit.period,
      credit.category,
      credit.placement,
    ].join("\n");
    if (!person._creditKeys.has(creditKey)) {
      person._creditKeys.add(creditKey);
      person.credits.push(credit);
    }
  }

  function addWatchlistDirector(name, item) {
    let person = ensurePerson(name, directorSupabaseId(item, name));
    if (!person) return;
    if (!person.professions.includes("Director"))
      person.professions.push("Director");
    let itemId = item.id || window.watchlistItemId?.(item);
    if (itemId && !person.watchlistIds.includes(itemId))
      person.watchlistIds.push(itemId);
  }

  function addWatchedOtherDirector(name, film) {
    let person = ensurePerson(name, directorSupabaseId(film, name));
    if (!person) return;
    if (!person.professions.includes("Director"))
      person.professions.push("Director");
    if (film.id && !person.watchedOtherIds.includes(film.id))
      person.watchedOtherIds.push(film.id);
  }

  // Rows from read_people_directory_edges() stand in for the watchlist and
  // shared-catalog walks below when those domains were never hydrated
  // (issue #633); each row goes through the same ensurePerson(name, id)
  // path the walks use, so the resulting person records are identical.
  function addDirectoryEdges(rows) {
    let catalogById = new Map();
    rows.forEach((row) =>
      (row.catalog_films || []).forEach((film) =>
        catalogById.set(film.id, {
          id: film.id,
          tmdbId: film.tmdb_id != null ? String(film.tmdb_id) : "",
          title: film.title,
          year: film.year != null ? String(film.year) : "",
        }),
      ),
    );
    let unseenIds = new Set(
      window
        .sharedArchiveFilmsOutsideCollection([...catalogById.values()])
        .map((film) => film.id),
    );
    rows.forEach((row) => {
      let person = ensurePerson(row.name, row.person_id);
      if (!person) return;
      let professions = (row.catalog_films || [])
        .filter((film) => unseenIds.has(film.id))
        .map((film) =>
          film.role === "director"
            ? "Director"
            : String(film.role || "").trim(),
        );
      if ((row.watchlist_ids || []).length) professions.push("Director");
      professions.filter(Boolean).forEach((profession) => {
        if (!person.professions.includes(profession))
          person.professions.push(profession);
      });
      (row.watchlist_ids || []).forEach((itemId) => {
        if (!person.watchlistIds.includes(itemId))
          person.watchlistIds.push(itemId);
      });
      (row.watchlist_preview || []).forEach((item) => {
        person.watchlistPreview ||= [];
        if (!person.watchlistPreview.some((entry) => entry.id === item.id))
          person.watchlistPreview.push(item);
      });
      (row.catalog_films || []).forEach((film) => {
        if (unseenIds.has(film.id) && !person.catalogIds.includes(film.id))
          person.catalogIds.push(film.id);
      });
    });
  }

  let films = Object.values(state.filmsById || {});
  let doneCollect = window.startOskarsPerformance?.(
    "rebuildPeopleIndex:collect",
  );
  films.forEach((film) => {
    let directors = film.directors?.length
      ? film.directors
      : window.parsePersonCredit(film.director).names;
    directors.forEach((name) =>
      addCredit(
        name,
        {
          source: "film",
          filmId: film.id,
          filmTitle: film.title,
          filmYear: film.year,
          period: film.year,
          category: "Director",
          placement: null,
          profession: "Director",
          originalCredit: film.director || directors.join(", "),
          detail: directorIsUncredited(film, name) ? "uncredited" : undefined,
        },
        directorSupabaseId(film, name),
      ),
    );

    (film.awards || []).forEach((award) => {
      let profession = window.PERSON_AWARD_PROFESSIONS[award.category];
      if (!profession) return;
      let originalCredit = window.awardRecipientText(award);
      let parsed = window.parsePersonCredit(originalCredit);
      let detail = window.awardDetail(award);
      let subjectType = window.creditSubjectType(award.category, profession);
      let subjectId =
        detail && subjectType
          ? window.makeCreditSubjectId(subjectType, film.id, detail)
          : "";

      if (parsed.ambiguous) {
        let issueKey = `${award.category}\n${originalCredit}`;
        if (!issueKeys.has(issueKey)) {
          issueKeys.add(issueKey);
          issues.push({
            category: award.category,
            credit: originalCredit,
            film: film.title,
          });
        }
      }

      window.awardRecipients(award).forEach((recipient) =>
        addCredit(
          recipient.name,
          {
            source: "award",
            filmId: film.id,
            filmTitle: film.title,
            filmYear: film.year,
            period: award.year,
            category: award.category,
            placement: Number(award.placement),
            profession,
            originalCredit,
            detail,
            subjectType,
            subjectId,
          },
          recipient.supabasePersonId,
        ),
      );
    });
  });
  let directoryEdges = peopleDirectoryEdges();
  if (!directoryEdges)
    (state.watchlist || []).forEach((item) => {
      window
        .parsePersonCredit(item.director)
        .names.forEach((name) => addWatchlistDirector(name, item));
    });
  (state.watchedOther || []).forEach((film) => {
    let directors = film.directors?.length
      ? film.directors
      : window.parsePersonCredit(film.director).names;
    directors.forEach((name) => addWatchedOtherDirector(name, film));
  });
  // Unseen catalog credits (issue #467): a person credited only on a
  // catalog film the viewer hasn't watched, other-watched, or watchlisted
  // previously never got a peopleById entry at all (every path above needs
  // a personal film/watchlist/otherWatched record to call ensurePerson
  // from), so their person.html page was always "Person not found" - the
  // old catalogIds enrichment (issue #453) only ever extended a person who
  // already existed for some other reason. This creates (or extends) a
  // person from every profession credited in sharedArchiveCandidateFilms()
  // - the same already-collection-filtered "unseen" film set period.html's
  // Unseen tab uses - not just directors, since the underlying credit data
  // already carries every profession. Nominee-only records (no real
  // films.id) are skipped - catalogIds only ever holds real catalog rows,
  // since there's no id to link a film.html?id= page to otherwise.
  if (directoryEdges) addDirectoryEdges(directoryEdges);
  (directoryEdges ? [] : window.sharedArchiveCandidateFilms?.() || []).forEach(
    (film) => {
      if (!film.id) return;
      Object.values(film.people || {}).forEach((credit) => {
        let person = ensurePerson(
          credit.name,
          credit.supabasePersonIds?.length === 1
            ? credit.supabasePersonIds[0]
            : null,
        );
        if (!person) return;
        (credit.professions || []).forEach((profession) => {
          if (!person.professions.includes(profession))
            person.professions.push(profession);
        });
        if (!person.catalogIds.includes(film.id))
          person.catalogIds.push(film.id);
      });
    },
  );
  doneCollect?.();

  let doneFinalize = window.startOskarsPerformance?.(
    "rebuildPeopleIndex:finalizePeople",
  );
  Object.values(peopleById).forEach((person) => {
    person.aliases.sort((a, b) => a.localeCompare(b));
    person.professions.sort((a, b) => a.localeCompare(b));
    // Unseen films (issue #453, generalized in #467): catalogIds is
    // already populated above, while collecting credits - nothing left
    // to do here.
    person.credits.sort(
      (a, b) =>
        String(b.period || "").localeCompare(
          String(a.period || ""),
          undefined,
          { numeric: true },
        ) ||
        window.compareEnglishTitles(a.filmTitle, b.filmTitle) ||
        String(a.category).localeCompare(String(b.category)),
    );
    let annualAwards = person.credits.filter(
      (credit) =>
        credit.source === "award" &&
        /^\d{4}$/.test(String(credit.period || "")),
    );
    person.stats = calculateAwardStats(annualAwards);
    person.awardScores = window.calculateAwardsScores(
      person.credits.filter((credit) => credit.source === "award"),
    );
    person.ratingStatistics = window.collectionRatingStatistics(
      person.filmIds
        .map((filmId) => state.filmsById?.[filmId])
        .concat(
          person.watchedOtherIds
            .map((filmId) =>
              (state.watchedOther || []).find((film) => film.id === filmId),
            )
            .filter(Boolean),
        )
        .filter(Boolean),
    );
    delete person._creditKeys;
    person.supabasePersonId =
      person._supabasePersonIds.size === 1
        ? [...person._supabasePersonIds][0]
        : null;
    delete person._supabasePersonIds;
  });
  doneFinalize?.(`${Object.keys(peopleById).length} people`);

  let doneProfession = window.startOskarsPerformance?.(
    "rebuildPeopleIndex:filmProfessions",
  );
  films.forEach((film) => {
    film.peopleByProfession = window.buildFilmPeopleByProfession(film);
  });
  doneProfession?.();

  let doneSubjects = window.startOskarsPerformance?.(
    "rebuildPeopleIndex:subjects",
  );
  let creditSubjectsById = window.buildCreditSubjects?.(peopleById) || {};
  doneSubjects?.(`${Object.keys(creditSubjectsById || {}).length} subjects`);

  state.peopleById = peopleById;
  state.creditSubjectsById = creditSubjectsById;
  state.peopleCreditIssues = issues;
  state.personAliasCandidates = null;
  state.peopleIndexVersion = Number(state.aggregateVersion) || 0;
  state.creditSubjectsVersion = Number(state.aggregateVersion) || 0;
  done?.(`${Object.keys(peopleById).length} people`);
  return peopleById;
};

/**
 * The key a person's own stored data (notes, local ranks, director
 * ballots, person projects) is saved under (issue #633): their real
 * people.id when the index resolved one, else the legacy name slug.
 * @param {{id: string, supabasePersonId?: string|null}|null} person
 * @returns {string}
 */
window.personStorageKey = function (person) {
  return person?.supabasePersonId || person?.id || "";
};

/**
 * Finds a people-index record by either key form - a people.id uuid or a
 * legacy name slug.
 * @param {string} key
 * @returns {Object|null}
 */
window.findPersonByKey = function (key) {
  let people = window.ensurePeopleIndex?.() || state.peopleById || {};
  if (!key) return null;
  if (!window.isUuid?.(key)) return people[key] || null;
  return (
    Object.values(people).find((person) => person.supabasePersonId === key) ||
    null
  );
};

/** Returns the current people index, rebuilding stale indexes. @returns {Record<string, PersonRecord>} People index. */
window.ensurePeopleIndex = function () {
  let version = Number(state.aggregateVersion) || 0;
  if (
    state.peopleIndexVersion === version &&
    state.creditSubjectsVersion === version &&
    state.peopleById &&
    state.creditSubjectsById
  )
    return state.peopleById;
  return window.rebuildPeopleIndex();
};

/** Returns the current credit-subject index, rebuilding when stale. @returns {Record<string, CreditSubjectRecord>} Subject index. */
window.ensureCreditSubjects = function () {
  let version = Number(state.aggregateVersion) || 0;
  if (state.creditSubjectsVersion !== version || !state.creditSubjectsById)
    window.ensurePeopleIndex();
  return state.creditSubjectsById || {};
};
