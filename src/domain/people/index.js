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
    window.creditSubjectType(category, window.PERSON_AWARD_PROFESSIONS[category]),
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

  function ensurePerson(name) {
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
      _creditKeys: new Set(),
    });
    if (!person.aliases.includes(String(name).trim()))
      person.aliases.push(String(name).trim());
    return person;
  }

  function addCredit(name, credit) {
    let person = ensurePerson(name);
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
    let person = ensurePerson(name);
    if (!person) return;
    if (!person.professions.includes("Director"))
      person.professions.push("Director");
    let itemId = item.id || window.watchlistItemId?.(item);
    if (itemId && !person.watchlistIds.includes(itemId))
      person.watchlistIds.push(itemId);
  }

  function addWatchedOtherDirector(name, film) {
    let person = ensurePerson(name);
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
      addCredit(name, {
        source: "film",
        filmId: film.id,
        filmTitle: film.title,
        filmYear: film.year,
        period: film.year,
        category: "Director",
        placement: null,
        profession: "Director",
        originalCredit: film.director || directors.join(", "),
      }),
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
        addCredit(recipient.name, {
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
        }),
      );
    });
  });
  (state.watchlist || []).forEach((item) => {
    window.parsePersonCredit(item.director).names.forEach((name) =>
      addWatchlistDirector(name, item),
    );
  });
  (state.watchedOther || []).forEach((film) => {
    let directors = film.directors?.length
      ? film.directors
      : window.parsePersonCredit(film.director).names;
    directors.forEach((name) => addWatchedOtherDirector(name, film));
  });
  doneCollect?.();

  let doneFinalize = window.startOskarsPerformance?.(
    "rebuildPeopleIndex:finalizePeople",
  );
  Object.values(peopleById).forEach((person) => {
    person.aliases.sort((a, b) => a.localeCompare(b));
    person.professions.sort((a, b) => a.localeCompare(b));
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
