/**
 * @file Derives year-level rating, ranking, and award progress for the
 * Supabase-backed Build your Oskars journey.
 */

(function () {
  // Maps Supabase film object references created during buildJourneyYears()
  // to their derived rating/ranking priority for buildJourneyMilestone().
  // If films are supplied without prior registration, representativePosterFilms
  // gracefully falls back to title ordering.
  let posterPriority = new WeakMap();

  function concreteYear(row) {
    let year = Number(row?.films?.year);
    return Number.isInteger(year) ? String(year) : "";
  }

  function percent(done, total) {
    return total ? Math.round((done / total) * 100) : 100;
  }

  function representativeFilms(rows, rankingPositionByFilmId, limit = 5) {
    rows.forEach((row) => {
      if (!row.films) return;
      posterPriority.set(row.films, {
        rating: Number(row.rating || 0),
        position: rankingPositionByFilmId.get(row.film_id) || "\uffff",
      });
    });
    return representativePosterFilms(
      rows.map((row) => row.films).filter(Boolean),
      limit,
    );
  }

  function representativePosterFilms(films, limit = 5) {
    let ordered = [...films].sort(
      (left, right) =>
        (posterPriority.get(right)?.rating || 0) -
          (posterPriority.get(left)?.rating || 0) ||
        (posterPriority.get(left)?.position || "\uffff").localeCompare(
          posterPriority.get(right)?.position || "\uffff",
        ) ||
        String(left.title || "").localeCompare(String(right.title || ""), "en"),
    );
    let withPosters = ordered.filter((film) => film.poster_url);
    return withPosters
      .concat(ordered.filter((film) => !film.poster_url))
      .slice(0, limit);
  }

  function rankingGroups(entries, watchedByFilmId) {
    let groups = new Map();
    entries.forEach((entry) => {
      let key = window.supabaseRankingRatingKey?.(
        watchedByFilmId.get(entry.film_id),
      );
      if (!key) return;
      let group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  }

  /**
   * Derives every populated watched year in chronological order.
   * @param {SupabaseWatchedRow[]} watchedRows Watched rows joined with films.
   * @param {SupabaseRankingEntry[]} rankingEntries Entries from independently stored yearly rankings.
   * @param {SupabaseAwardReview[]} awardReviews Annual category outcomes.
   * @param {string[]} categoryNames Ordered annual award categories.
   * @returns {BuildYearProgress[]} Year progress rows.
   */
  window.buildJourneyYears = function (
    watchedRows = [],
    rankingEntries = [],
    awardReviews = [],
    categoryNames = [],
  ) {
    let watchedByFilmId = new Map(watchedRows.map((row) => [row.film_id, row]));
    let rankingPositionByFilmId = new Map(
      rankingEntries.map((entry) => [entry.film_id, entry.position]),
    );
    let watchedByYear = new Map();
    watchedRows.forEach((row) => {
      let year = concreteYear(row);
      if (!year) return;
      let rows = watchedByYear.get(year) || [];
      rows.push(row);
      watchedByYear.set(year, rows);
    });
    rankingEntries = rankingEntries.filter((entry) =>
      window.supabaseRankingFilmEligible(
        watchedByFilmId.get(entry.film_id) || entry,
      ),
    );
    let rankingByYear = new Map();
    rankingEntries.forEach((entry) => {
      let year = String(entry.films?.year || "");
      if (!watchedByYear.has(year)) return;
      let entries = rankingByYear.get(year) || [];
      entries.push(entry);
      rankingByYear.set(year, entries);
    });
    let categories = new Set(categoryNames);
    let reviewedCategoriesByYear = new Map();
    awardReviews.forEach((review) => {
      let year = String(review.year || "");
      if (!watchedByYear.has(year) || !categories.has(review.category)) return;
      let reviewed = reviewedCategoriesByYear.get(year) || new Set();
      reviewed.add(review.category);
      reviewedCategoriesByYear.set(year, reviewed);
    });

    return [...watchedByYear.keys()]
      .sort((left, right) => Number(left) - Number(right))
      .map((year) => {
        let yearRows = watchedByYear.get(year) || [];
        let yearRankingEntries = rankingByYear.get(year) || [];
        let films = yearRows.map((row) => row.films).filter(Boolean);
        let ratedCount = yearRows.filter(
          (row) => Number(row.rating) > 0,
        ).length;
        let groups = rankingGroups(yearRankingEntries, watchedByFilmId);
        let reviewedGroups = groups.filter((group) =>
          group.every((entry) => entry.rank_confirmed !== false),
        ).length;
        let reviewedCategories = reviewedCategoriesByYear.get(year)?.size || 0;
        let rankingRows = yearRows.filter(window.supabaseRankingFilmEligible);
        let rankingReady = rankingRows.length > 0;
        let rankedIds = new Set(
          yearRankingEntries
            .filter((entry) => entry.rank_confirmed !== false)
            .map((entry) => entry.film_id),
        );
        let rankingComplete = rankingRows.every((row) =>
          rankedIds.has(row.film_id),
        );
        let awardStarted = reviewedCategories > 0;
        let awardComplete =
          categoryNames.length > 0 &&
          reviewedCategories >= categoryNames.length;
        /** @type {BuildYearProgress['stage']} */
        let stage =
          awardComplete && rankingComplete && ratedCount === yearRows.length
            ? "complete"
            : awardStarted && !awardComplete
              ? "awards"
              : ratedCount < yearRows.length
                ? "rating"
                : !rankingComplete
                  ? "ranking"
                  : !awardComplete
                    ? "awards"
                    : "complete";
        return {
          year,
          archiveFilms: films,
          otherFilms: [],
          ratingFilms: films,
          totalCount: yearRows.length,
          ratedCount,
          ratingPercent: percent(ratedCount, yearRows.length),
          rankingGroupCount: groups.length,
          reviewedRankingGroupCount: reviewedGroups,
          rankingPercent: percent(
            rankingRows.filter((row) => rankedIds.has(row.film_id)).length,
            rankingRows.length,
          ),
          rankingReady,
          rankingComplete,
          awardFilledSlots: reviewedCategories,
          awardTotalSlots: categoryNames.length,
          awardPercent: percent(reviewedCategories, categoryNames.length),
          awardStarted: reviewedCategories > 0,
          awardComplete,
          posterFilms: representativeFilms(yearRows, rankingPositionByFilmId),
          thresholdStats: window.periodThresholdStats
            ? window.periodThresholdStats(films, "year")
            : null,
          stage,
        };
      });
  };

  /**
   * Chooses a resumable year before untouched work.
   * @param {BuildYearProgress[]} years Derived years.
   * @returns {BuildYearProgress|null} Recommended year.
   */
  window.buildJourneyRecommendation = function (years = []) {
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
        right.totalCount - left.totalCount ||
        Number(right.year) - Number(left.year),
    )[0];
    return mostInviting || years[years.length - 1] || null;
  };

  /**
   * Chooses the strongest currently reached creative milestone.
   * @param {BuildYearProgress[]} years Derived year progress.
   * @returns {{id:string,type:string,key:string,posterFilms:SupabaseFilmRow[]}|null} Milestone.
   */
  window.buildJourneyMilestone = function (years = []) {
    if (!years.length) return null;
    let allPosters = years.flatMap((entry) => entry.posterFilms);
    if (years.every((entry) => entry.stage === "complete"))
      return {
        id: "archive:complete",
        type: "archive",
        key: "",
        posterFilms: representativePosterFilms(allPosters),
      };
    let byDecade = new Map();
    years.forEach((entry) => {
      let key = window.getDecadeKey(entry.year);
      let entries = byDecade.get(key) || [];
      entries.push(entry);
      byDecade.set(key, entries);
    });
    let completeDecades = [...byDecade.entries()]
      .filter(
        ([, entries]) =>
          entries.length &&
          entries.every((entry) => entry.stage === "complete"),
      )
      .sort(
        (left, right) =>
          Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10),
      );
    if (completeDecades.length) {
      let [key, entries] = completeDecades[completeDecades.length - 1];
      return {
        id: `decade:${key}`,
        type: "decade",
        key,
        posterFilms: representativePosterFilms(
          entries.flatMap((entry) => entry.posterFilms),
        ),
      };
    }
    /** @type {[string, (entry: BuildYearProgress) => unknown][]} */
    let stages = [
      ["ceremony", (entry) => entry.archiveFilms.length && entry.awardComplete],
      ["ranked", (entry) => entry.archiveFilms.length && entry.rankingComplete],
      ["rated", (entry) => entry.totalCount && entry.ratingPercent === 100],
    ];
    for (let [type, matches] of stages) {
      let reached = years.filter(matches);
      if (reached.length) {
        let entry = reached[reached.length - 1];
        return {
          id: `${type}:${entry.year}`,
          type,
          key: entry.year,
          posterFilms: entry.posterFilms,
        };
      }
    }
    return null;
  };

  /**
   * Derives actionable inbox items for recent watches that need ratings,
   * pinpoint ranking insertion into an already-ranked year, or ceremony evaluation.
   * @param {SupabaseWatchedRow[]} watchedRows Watched rows joined with films.
   * @param {SupabaseRankingEntry[]} rankingEntries Entries from stored yearly rankings.
   * @param {SupabaseAwardReview[]} awardReviews Annual category outcomes.
   * @param {string[]} categoryNames Ordered annual award categories.
   * @param {Set<string>} [dismissedCeremonyFilmIds] Film IDs dismissed from ceremony check.
   * @returns {{watched: SupabaseWatchedRow, film: SupabaseFilmRow, year: string, type: 'rate'|'rank'|'awards', reason: string}[]}
   */
  window.deriveBuildInbox = function (
    watchedRows = [],
    rankingEntries = [],
    awardReviews = [],
    categoryNames = [],
    dismissedCeremonyFilmIds = new Set(),
  ) {
    let rankedFilmIdsByYear = new Map();
    let rankingCountsByYear = new Map();
    rankingEntries.forEach((entry) => {
      let year = String(entry.films?.year || "");
      if (!year) return;
      if (!rankedFilmIdsByYear.has(year)) {
        rankedFilmIdsByYear.set(year, new Set());
      }
      if (entry.rank_confirmed !== false) {
        rankedFilmIdsByYear.get(year).add(entry.film_id);
      }
      rankingCountsByYear.set(year, (rankingCountsByYear.get(year) || 0) + 1);
    });

    let reviewedCategoriesByYear = new Map();
    let categories = new Set(categoryNames);
    awardReviews.forEach((review) => {
      let year = String(review.year || "");
      if (!categories.size || categories.has(review.category)) {
        let set = reviewedCategoriesByYear.get(year) || new Set();
        set.add(review.category);
        reviewedCategoriesByYear.set(year, set);
      }
    });

    let sortedWatches = [...watchedRows].sort((left, right) => {
      let dLeft = left.date_watched || left.updated_at || "";
      let dRight = right.date_watched || right.updated_at || "";
      return dRight.localeCompare(dLeft);
    });

    let inbox = [];
    for (let row of sortedWatches) {
      let film = row.films || {};
      let year = concreteYear(row);
      if (!year) continue;

      if (!row.rating) {
        inbox.push({
          watched: row,
          film,
          year,
          type: "rate",
          reason: "Needs rating",
        });
      } else {
        let yearRankingsExist = (rankingCountsByYear.get(year) || 0) > 0;
        let isRanked = rankedFilmIdsByYear.get(year)?.has(row.film_id);
        if (
          yearRankingsExist &&
          !isRanked &&
          window.supabaseRankingFilmEligible(row)
        ) {
          inbox.push({
            watched: row,
            film,
            year,
            type: "rank",
            reason: `Slot into ${year}`,
          });
        } else {
          let ceremonyStarted =
            (reviewedCategoriesByYear.get(year)?.size || 0) > 0;
          if (ceremonyStarted && !dismissedCeremonyFilmIds.has(row.film_id)) {
            inbox.push({
              watched: row,
              film,
              year,
              type: "awards",
              reason: `Ceremony candidate (${year})`,
            });
          }
        }
      }
    }
    return inbox;
  };
})();
