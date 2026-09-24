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
  (window.sharedArchiveCandidateFilms?.() || []).forEach((film) => {
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
      if (!person.catalogIds.includes(film.id)) person.catalogIds.push(film.id);
    });
  });
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
    film.peopleByProfession = {};
  });
  Object.values(peopleById).forEach((person) => {
    person.credits.forEach((credit) => {
      if (credit.source !== "award") return;
      if (!credit.profession) return;
      let film = state.filmsById?.[credit.filmId];
      if (!film) return;
      let group = (film.peopleByProfession[credit.profession] ||= []);
      let entry = group.find((candidate) => candidate.id === person.id);
      if (!entry) {
        entry = { id: person.id, name: person.name, details: [], awards: [] };
        group.push(entry);
      }
      if (credit.detail && !entry.details.includes(credit.detail))
        entry.details.push(credit.detail);
      if (
        !entry.awards.some(
          (award) =>
            award.category === credit.category &&
            String(award.period) === String(credit.period) &&
            Number(award.placement) === Number(credit.placement),
        )
      ) {
        entry.awards.push({
          category: credit.category,
          period: credit.period,
          placement: Number(credit.placement) || 0,
        });
      }
    });
  });
  films.forEach((film) => {
    Object.values(film.peopleByProfession || {}).forEach((group) =>
      group.sort((left, right) =>
        window.comparePersonNamesBySurname(left.name, right.name),
      ),
    );
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
