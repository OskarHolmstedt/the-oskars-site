/** @file Derives the resumable Supabase watched-film Intake lifecycle. */

(function () {
  let RANKING_LEVELS = ["year", "decade", "century", "allTime"];
  let AWARD_LEVELS = ["year", "decade", "century", "allTime"];

  function concreteYear(workflow) {
    return Number(workflow?.watched?.films?.year) || null;
  }

  /** Returns a sortable exact Supabase rating grade. @param {Object} watched Watched row. @returns {number} */
  window.supabaseIntakeRatingGrade = function (watched) {
    let rating = Number(watched?.rating);
    if (!rating) return 0;
    let modifier =
      watched.rating_modifier === "minus"
        ? 1
        : watched.rating_modifier === "plus"
          ? 3
          : 2;
    return (Math.round(rating * 2) - 1) * 3 + modifier;
  };

  /** Returns the Supabase ranking/award scope for one Intake level. @param {Object} workflow Intake row. @param {'year'|'decade'|'century'|'allTime'} level Editorial level. @returns {{scope:string, scopeType:'years'|'decades'|'centuries'|'allTime'}|null} */
  window.supabaseIntakeScope = function (workflow, level) {
    let year = concreteYear(workflow);
    if (!year) return null;
    if (level === "year") return { scope: String(year), scopeType: "years" };
    if (level === "decade")
      return { scope: `${Math.floor(year / 10) * 10}s`, scopeType: "decades" };
    if (level === "century")
      return {
        scope: `${Math.floor(year / 100) * 100}s`,
        scopeType: "centuries",
      };
    if (level === "allTime") return { scope: "alltime", scopeType: "allTime" };
    return null;
  };

  /** Returns the next incomplete ranking level. @param {Object} workflow Intake row. @returns {string} */
  window.supabaseIntakeNextRankingLevel = function (workflow) {
    let decisions = workflow?.steps?.ranking?.decisions || {};
    return RANKING_LEVELS.find((level) => !decisions[level]) || "";
  };

  /** Returns the next incomplete awards level. @param {Object} workflow Intake row. @returns {string} */
  window.supabaseIntakeNextAwardLevel = function (workflow) {
    return (
      AWARD_LEVELS.find(
        (level) => workflow?.steps?.awards?.[level]?.status !== "complete",
      ) || ""
    );
  };

  /** Filters a ranking to the Intake film's exact-rating cohort and level. @param {Object} workflow Intake row. @param {Object[]} entries Ranking entries. @param {Object[]} watched Watched workspace rows. @param {string} level Editorial level. @returns {Object[]} */
  window.supabaseIntakeRankingCandidates = function (
    workflow,
    entries,
    watched,
    level,
  ) {
    let target = workflow?.watched;
    let targetRating = window.supabaseIntakeRatingGrade(target);
    let year = concreteYear(workflow);
    if (!targetRating || !year) return [];
    let watchedByFilm = new Map(
      (watched || []).map((row) => [row.film_id, row]),
    );
    return (entries || []).filter((entry) => {
      if (entry.film_id === target.film_id) return false;
      if (
        window.supabaseIntakeRatingGrade(watchedByFilm.get(entry.film_id)) !==
        targetRating
      )
        return false;
      let candidateYear = Number(entry.films?.year);
      if (level === "year") return candidateYear === year;
      if (level === "decade")
        return Math.floor(candidateYear / 10) === Math.floor(year / 10);
      if (level === "century")
        return Math.floor(candidateYear / 100) === Math.floor(year / 100);
      return true;
    });
  };

  /** Returns compatible insertion gaps, constrained by the narrower decision when its anchor is present. @param {Object[]} candidates Exact-rating candidates. @param {Object|null} priorDecision Previous level decision. @returns {Object[]} */
  window.supabaseIntakeRankingGaps = function (candidates, priorDecision) {
    let rows = candidates || [];
    if (!rows.length)
      return [{ targetFilmId: null, position: "after", insertionIndex: 0 }];
    let gaps = rows.map((entry, index) => ({
      targetFilmId: entry.film_id,
      position: "before",
      insertionIndex: index,
    }));
    gaps.push({
      targetFilmId: rows[rows.length - 1].film_id,
      position: "after",
      insertionIndex: rows.length,
    });
    if (!priorDecision?.targetFilmId) return gaps;
    let anchorIndex = rows.findIndex(
      (entry) => entry.film_id === priorDecision.targetFilmId,
    );
    if (anchorIndex < 0) return [];
    let boundary = anchorIndex + (priorDecision.position === "after" ? 1 : 0);
    return gaps.filter((gap) =>
      priorDecision.position === "after"
        ? gap.insertionIndex >= boundary
        : gap.insertionIndex <= boundary,
    );
  };

  /** Returns a copy with one ranking decision recorded. @param {Object} steps Current steps JSON. @param {string} level Ranking level. @param {Object} decision Bounded placement reference. @returns {Object} */
  window.supabaseIntakeRecordRanking = function (steps, level, decision) {
    let next = JSON.parse(JSON.stringify(steps));
    next.ranking ||= { status: "pending", decisions: {} };
    next.ranking.decisions ||= {};
    next.ranking.decisions[level] = decision;
    next.ranking.status = RANKING_LEVELS.every(
      (name) => next.ranking.decisions[name],
    )
      ? "complete"
      : "pending";
    return next;
  };

  /** Returns the next unreviewed category for one awards level. @param {Object} workflow Intake row. @param {string} level Awards level. @param {string[]} categories Ordered categories. @returns {string} */
  window.supabaseIntakeNextAwardCategory = function (
    workflow,
    level,
    categories,
  ) {
    let decisions = workflow?.steps?.awards?.[level]?.decisions || {};
    return (categories || []).find((category) => !decisions[category]) || "";
  };

  /** Returns a copy with one award decision recorded and level completion derived. @param {Object} steps Current steps JSON. @param {string} level Award level. @param {string} category Category name. @param {'nominate'|'skip'} action Decision. @param {string[]} categories Complete ordered category set. @returns {Object} */
  window.supabaseIntakeRecordAward = function (
    steps,
    level,
    category,
    action,
    categories,
  ) {
    let next = JSON.parse(JSON.stringify(steps));
    next.awards ||= {};
    next.awards[level] ||= { status: "pending", decisions: {} };
    next.awards[level].decisions ||= {};
    next.awards[level].decisions[category] = { action };
    next.awards[level].status = (categories || []).every(
      (name) => next.awards[level].decisions[name],
    )
      ? "complete"
      : "pending";
    return next;
  };

  /** Reports whether every Intake step can be completed. @param {Object} workflow Intake row. @returns {boolean} */
  window.supabaseIntakeReadyToComplete = function (workflow) {
    return (
      workflow?.steps?.rating?.status === "complete" &&
      workflow?.steps?.ranking?.status === "complete" &&
      AWARD_LEVELS.every(
        (level) => workflow?.steps?.awards?.[level]?.status === "complete",
      )
    );
  };
})();
