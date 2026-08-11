/**
 * @file Derives role and song credit-subject records from the people index.
 */

/** Builds deduplicated credit subjects from indexed people. @param {Record<string, PersonRecord>} peopleById People index. @returns {Record<string, CreditSubjectRecord>} Subject index. */
window.buildCreditSubjects = function (peopleById) {
  let subjectsById = {};

  Object.values(peopleById).forEach((person) => {
    person.credits
      .filter((credit) => credit.subjectId)
      .forEach((credit) => {
        let subject = (subjectsById[credit.subjectId] ||= {
          id: credit.subjectId,
          type: credit.subjectType,
          title: credit.detail,
          films: [],
          people: [],
          appearances: [],
          awards: [],
          _appearanceKeys: new Set(),
          _awardKeys: new Set(),
        });
        if (!subject.films.some((film) => film.id === credit.filmId)) {
          subject.films.push({
            id: credit.filmId,
            title: credit.filmTitle,
            year: credit.filmYear,
          });
        }
        if (!subject.people.some((candidate) => candidate.id === person.id)) {
          subject.people.push({ id: person.id, name: person.name });
        }

        let appearanceKey = [credit.filmId, person.id].join("\n");
        if (!subject._appearanceKeys.has(appearanceKey)) {
          subject._appearanceKeys.add(appearanceKey);
          subject.appearances.push({
            filmId: credit.filmId,
            filmTitle: credit.filmTitle,
            filmYear: credit.filmYear,
            personId: person.id,
            personName: person.name,
          });
        }

        let awardKey = [
          credit.filmId,
          credit.period,
          credit.category,
          credit.placement,
        ].join("\n");
        if (!subject._awardKeys.has(awardKey)) {
          subject._awardKeys.add(awardKey);
          subject.awards.push({
            period: credit.period,
            category: credit.category,
            placement: credit.placement,
            filmId: credit.filmId,
            filmTitle: credit.filmTitle,
            filmYear: credit.filmYear,
          });
        }
      });
  });

  Object.values(subjectsById).forEach((subject) => {
    subject.people.sort((left, right) => left.name.localeCompare(right.name));
    subject.films.sort(
      (left, right) => Number(left.year || 0) - Number(right.year || 0),
    );
    subject.awards.sort(
      (left, right) =>
        String(right.period || "").localeCompare(
          String(left.period || ""),
          undefined,
          { numeric: true },
        ) || Number(left.placement) - Number(right.placement),
    );
    subject.stats = calculateAwardStats(
      subject.awards.filter((award) =>
        /^\d{4}$/.test(String(award.period || "")),
      ),
    );
    subject.ratingStatistics = window.collectionRatingStatistics(
      subject.films
        .map((film) => window.state.filmsById?.[film.id])
        .filter(Boolean),
    );
    delete subject._appearanceKeys;
    delete subject._awardKeys;
  });

  return subjectsById;
};
