/** @file Derives deterministic, evidence-backed stories from one period's award placements. */

const AWARD_STORY_MIN_CATEGORIES = 4;
const AWARD_STORY_MIN_SWEEP_NOMINATIONS = 3;
const AWARD_STORY_MIN_NEAR_SWEEP_NOMINATIONS = 4;
const AWARD_STORY_MIN_SHUTOUT_NOMINATIONS = 3;
const AWARD_STORY_MIN_RIVALRY_CATEGORIES = 3;

function awardStoryTitleCompare(left, right) {
  return window.compareEnglishTitles(
    String(left?.film?.title || ""),
    String(right?.film?.title || ""),
  );
}

function awardStoryStrengthCompare(left, right) {
  return (
    right.wins - left.wins ||
    right.nominations - left.nominations ||
    awardStoryTitleCompare(left, right)
  );
}

function uniqueLeader(entries, value) {
  if (!entries.length) return null;
  let maximum = Math.max(...entries.map(value));
  let leaders = entries.filter((entry) => value(entry) === maximum);
  return leaders.length === 1 ? leaders[0] : null;
}

function completeAwardStoryCategories(awards) {
  let categories = new Map();
  (awards || []).forEach((entry) => {
    let filmId = String(entry?.film?.id || "");
    let category = String(entry?.award?.category || "");
    let placement = Number(entry?.award?.placement);
    if (!filmId || !category || !Number.isInteger(placement) || placement < 1)
      return;
    let films = categories.get(category) || new Map();
    let existing = films.get(filmId);
    if (!existing || placement < existing.placement) {
      films.set(filmId, { film: entry.film, placement });
    }
    categories.set(category, films);
  });

  return [...categories.entries()]
    .map(([category, films]) => ({
      category,
      entries: [...films.values()],
    }))
    .filter(
      (record) =>
        record.entries.length >= 2 &&
        record.entries.filter((entry) => entry.placement === 1).length === 1,
    )
    .sort((left, right) =>
      window.compareEnglishTitles(left.category, right.category),
    );
}

/**
 * Derives significant period award stories and their underlying records.
 * Tied superlatives and incomplete or tiny brackets deliberately produce no claim.
 * @param {PeriodAwardEntry[]} awards Film-and-award entries for one period.
 * @returns {Object[]} Deterministically ordered award stories.
 */
window.periodAwardStories = function (awards) {
  let categories = completeAwardStoryCategories(awards);
  if (categories.length < AWARD_STORY_MIN_CATEGORIES) return [];

  let filmsById = new Map();
  categories.forEach((record) => {
    record.entries.forEach((entry) => {
      let filmId = String(entry.film.id);
      let film = filmsById.get(filmId) || {
        film: entry.film,
        nominations: 0,
        wins: 0,
        categories: [],
        winCategories: [],
      };
      film.nominations += 1;
      film.categories.push(record.category);
      if (entry.placement === 1) {
        film.wins += 1;
        film.winCategories.push(record.category);
      }
      filmsById.set(filmId, film);
    });
  });
  let films = [...filmsById.values()].sort(awardStoryStrengthCompare);
  if (films.length < 2) return [];

  let stories = [];
  let sweepCandidates = films.filter(
    (film) =>
      film.nominations >= AWARD_STORY_MIN_SWEEP_NOMINATIONS &&
      film.wins === film.nominations,
  );
  let sweep = uniqueLeader(
    sweepCandidates,
    (film) => film.wins * 1000 + film.nominations,
  );
  if (sweep) {
    stories.push({ type: "sweep", films: [sweep], categories: sweep.categories });
  }
  let nearSweepCandidates = films.filter(
    (film) =>
      film.nominations >= AWARD_STORY_MIN_NEAR_SWEEP_NOMINATIONS &&
      film.wins === film.nominations - 1,
  );
  let nearSweep = uniqueLeader(
    nearSweepCandidates,
    (film) => film.wins * 1000 + film.nominations,
  );
  if (nearSweep) {
    stories.push({
      type: "near-sweep",
      films: [nearSweep],
      categories: nearSweep.categories,
    });
  }

  let winners = films.filter((film) => film.wins >= 2);
  let mostWins = uniqueLeader(winners, (film) => film.wins);
  if (mostWins) {
    stories.push({
      type: "most-wins",
      films: [mostWins],
      categories: mostWins.winCategories,
    });
  }

  let winless = films.filter(
    (film) =>
      film.wins === 0 &&
      film.nominations >= AWARD_STORY_MIN_SHUTOUT_NOMINATIONS,
  );
  let shutout = uniqueLeader(winless, (film) => film.nominations);
  if (shutout) {
    stories.push({
      type: "shutout",
      films: [shutout],
      categories: shutout.categories,
    });
  }

  let rivalries = [];
  for (let leftIndex = 0; leftIndex < films.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < films.length;
      rightIndex += 1
    ) {
      let left = films[leftIndex];
      let right = films[rightIndex];
      let rightCategories = new Set(right.categories);
      let sharedCategories = left.categories.filter((category) =>
        rightCategories.has(category),
      );
      if (sharedCategories.length < AWARD_STORY_MIN_RIVALRY_CATEGORIES)
        continue;
      let shared = new Set(sharedCategories);
      let leftWins = left.winCategories.filter((category) =>
        shared.has(category),
      ).length;
      let rightWins = right.winCategories.filter((category) =>
        shared.has(category),
      ).length;
      if (!leftWins || !rightWins) continue;
      let rivalryFilms = [left, right].sort(awardStoryTitleCompare);
      rivalries.push({
        films: rivalryFilms,
        categories: sharedCategories,
        sharedCount: sharedCategories.length,
        wins: rivalryFilms.map((film) =>
          film.winCategories.filter((category) => shared.has(category)).length,
        ),
      });
    }
  }
  let rivalry = uniqueLeader(rivalries, (entry) => entry.sharedCount);
  if (rivalry) stories.push({ type: "rivalry", ...rivalry });

  return stories;
};
