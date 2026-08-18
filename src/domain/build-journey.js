/** @file Derives year-level rating, ranking, and award progress for the Build your Oskars journey. */

(function () {
  function concreteYear(film) {
    let year = String(window.filmConcreteYear?.(film?.year) || film?.year || "");
    return /^\d{4}$/.test(year) ? year : "";
  }

  function percent(done, total) {
    return total ? Math.round((done / total) * 100) : 100;
  }

  function representativeFilms(films, limit = 5) {
    let ordered = [...films].sort(
      (left, right) =>
        Number(right.ratingValue || 0) - Number(left.ratingValue || 0) ||
        Number(left.allTimeRank || 999999) -
          Number(right.allTimeRank || 999999) ||
        window.compareEnglishTitles(left.title, right.title),
    );
    let withPosters = ordered.filter((film) =>
      window.normalizePosterRecord?.(film.poster),
    );
    return withPosters
      .concat(ordered.filter((film) => !withPosters.includes(film)))
      .slice(0, limit);
  }

  function rankingGroups(films) {
    let groups = new Map();
    films.forEach((film) => {
      let key = window.rankingRatingKey?.(film) || "";
      if (!key) return;
      let group = groups.get(key) || [];
      group.push(film);
      groups.set(key, group);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  }

  function annualAwardProgress(year, films) {
    if (window.annualAwardReviewProgress) {
      let review = window.annualAwardReviewProgress(year);
      return { filled: review.reviewed, total: review.total };
    }
    let categories = window.getOrderedCategories?.() || [];
    let capacities = window.bracketCapacities?.("years") || {
      picture: 10,
      category: 5,
    };
    let slots = new Set();
    films.forEach((film) => {
      (film.awards || []).forEach((award) => {
        if (
          String(award.year || "") !== year ||
          window.getAwardPeriodType?.(award) !== "years" ||
          !categories.includes(award.category) ||
          !Number.isFinite(Number(award.placement))
        )
          return;
        slots.add(`${award.category}\n${Number(award.placement)}`);
      });
    });
    let total = categories.reduce(
      (sum, category) =>
        sum +
        (category === "Best Picture"
          ? capacities.picture
          : capacities.category),
      0,
    );
    return { filled: slots.size, total };
  }

  /** Derives every populated watched year in chronological order. @returns {BuildYearProgress[]} Year progress rows. */
  window.buildJourneyYears = function () {
    let archiveByYear = new Map();
    Object.values(state.filmsById || {}).forEach((film) => {
      let year = concreteYear(film);
      if (!year) return;
      let films = archiveByYear.get(year) || [];
      films.push(film);
      archiveByYear.set(year, films);
    });
    let otherByYear = new Map();
    (state.watchedOther || []).forEach((film) => {
      let year = concreteYear(film);
      if (!year) return;
      let films = otherByYear.get(year) || [];
      films.push(film);
      otherByYear.set(year, films);
    });
    let years = [...new Set([...archiveByYear.keys(), ...otherByYear.keys()])]
      .sort((left, right) => Number(left) - Number(right));
    return years.map((year) => {
      let archiveFilms = archiveByYear.get(year) || [];
      let otherFilms = otherByYear.get(year) || [];
      let ratingFilms = archiveFilms.concat(otherFilms);
      let ratedCount = ratingFilms.filter((film) =>
        window.filmRatingGrade?.(film),
      ).length;
      let groups = rankingGroups(archiveFilms);
      let reviewedGroups = groups.filter((group) =>
        group.every((film) => film.rankConfirmed !== false),
      ).length;
      let awards = annualAwardProgress(year, archiveFilms);
      let rankingReady = ratedCount === ratingFilms.length;
      let rankingComplete = rankingReady && reviewedGroups === groups.length;
      let awardComplete =
        !archiveFilms.length || (awards.total > 0 && awards.filled >= awards.total);
      let stage =
        ratedCount < ratingFilms.length
          ? "rating"
          : !rankingComplete
            ? "ranking"
            : !awardComplete
              ? "awards"
              : "complete";
      return {
        year,
        archiveFilms,
        otherFilms,
        ratingFilms,
        totalCount: ratingFilms.length,
        ratedCount,
        ratingPercent: percent(ratedCount, ratingFilms.length),
        rankingGroupCount: groups.length,
        reviewedRankingGroupCount: reviewedGroups,
        rankingPercent: percent(reviewedGroups, groups.length),
        rankingReady,
        rankingComplete,
        awardFilledSlots: awards.filled,
        awardTotalSlots: awards.total,
        awardPercent: percent(awards.filled, awards.total),
        awardStarted: awards.filled > 0,
        awardComplete,
        posterFilms: representativeFilms(ratingFilms),
        stage,
      };
    });
  };

  /** Chooses a resumable year before untouched work. @param {BuildYearProgress[]} [years] Derived years. @returns {BuildYearProgress|null} Recommended year. */
  window.buildJourneyRecommendation = function (years = window.buildJourneyYears()) {
    let incomplete = years.filter((year) => year.stage !== "complete");
    let inProgress = incomplete.filter(
      (year) =>
        (year.ratedCount > 0 && year.ratedCount < year.totalCount) ||
        (year.reviewedRankingGroupCount > 0 && !year.rankingComplete) ||
        (year.awardStarted && !year.awardComplete),
    );
    if (inProgress.length) return inProgress[inProgress.length - 1];
    let mostInviting = [...incomplete].sort(
      (left, right) =>
        right.totalCount - left.totalCount || Number(right.year) - Number(left.year),
    )[0];
    return mostInviting || years[years.length - 1] || null;
  };

  /** Chooses the strongest currently reached creative milestone. @param {BuildYearProgress[]} [years] Derived year progress. @returns {{id:string,type:string,key:string,posterFilms:FilmRecord[]}|null} Milestone. */
  window.buildJourneyMilestone = function (years = window.buildJourneyYears()) {
    if (!years.length) return null;
    let allPosters = years.flatMap((entry) => entry.posterFilms);
    if (years.every((entry) => entry.stage === "complete"))
      return { id: "archive:complete", type: "archive", key: "", posterFilms: representativeFilms(allPosters) };
    let byDecade = new Map();
    years.forEach((entry) => {
      let key = window.getDecadeKey(entry.year);
      let entries = byDecade.get(key) || [];
      entries.push(entry);
      byDecade.set(key, entries);
    });
    let completeDecades = [...byDecade.entries()]
      .filter(([, entries]) => entries.length && entries.every((entry) => entry.stage === "complete"))
      .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10));
    if (completeDecades.length) {
      let [key, entries] = completeDecades[completeDecades.length - 1];
      return { id: `decade:${key}`, type: "decade", key, posterFilms: representativeFilms(entries.flatMap((entry) => entry.posterFilms)) };
    }
    let stages = [
      ["ceremony", (entry) => entry.archiveFilms.length && entry.awardComplete],
      ["ranked", (entry) => entry.archiveFilms.length && entry.rankingComplete],
      ["rated", (entry) => entry.totalCount && entry.ratingPercent === 100],
    ];
    for (let [type, matches] of stages) {
      let reached = years.filter(matches);
      if (reached.length) {
        let entry = reached[reached.length - 1];
        return { id: `${type}:${entry.year}`, type, key: entry.year, posterFilms: entry.posterFilms };
      }
    }
    return null;
  };
})();
