/** @file Owns the read-only Award hub model, connecting watched periods and saved annual ballots to existing ceremony editors. */

(function () {
  /**
   * Derives period choices and annual continuation cards without creating ballots.
   * @param {SupabaseWatchedRow[]} watched Watched films joined with metadata.
   * @param {Object[]} awards Saved personal award scopes and nominations.
   * @param {SupabaseAwardReview[]} reviews Annual category outcomes.
   * @param {string[]} categories Current ordered ceremony categories.
   * @returns {{periods: Object[], continuing: Object[], completed: Object[]}} Period choices and saved annual progress.
   */
  window.buildAwardHub = function (watched, awards, reviews, categories) {
    let scopes = new Map();
    function scope(type, key) {
      let id = `${type}:${key}`;
      if (!scopes.has(id))
        scopes.set(id, {
          type,
          key,
          name: key,
          films: [],
          nominationCount: 0,
          reviewed: 0,
          total: categories.length,
          complete: false,
        });
      return scopes.get(id);
    }
    for (let row of watched) {
      let film = row.films;
      let year = Number(film?.year);
      if (!film || !Number.isInteger(year) || year < 1000 || year > 9999)
        continue;
      for (let [type, key] of [
        ["year", String(year)],
        ["decade", `${Math.floor(year / 10) * 10}s`],
        ["century", `${Math.floor(year / 100) * 100}s`],
        ["alltime", "alltime"],
      ])
        scope(type, key).films.push(film);
    }
    let types = {
      years: "year",
      decades: "decade",
      centuries: "century",
      allTime: "alltime",
    };
    for (let award of awards) {
      let type = types[award.scope_type];
      if (!type) continue;
      let key = type === "alltime" ? "alltime" : String(award.scope);
      let period = scope(type, key);
      period.nominationCount += (award.personal_nominations || []).length;
    }
    let reviewedByYear = new Map();
    let allowed = new Set(categories);
    for (let review of reviews) {
      if (!allowed.has(review.category)) continue;
      let key = String(review.year);
      let set = reviewedByYear.get(key) || new Set();
      set.add(review.category);
      reviewedByYear.set(key, set);
      scope("year", key).reviewed = set.size;
    }
    let periods = [...scopes.values()]
      .map((period) => ({
        ...period,
        complete:
          period.type === "year" &&
          categories.length > 0 &&
          period.reviewed === categories.length,
        href:
          period.type === "year"
            ? window.yearAwardsPageUrl(period.key)
            : `${window.periodPageUrl(period.type, period.key)}&view=awards`,
      }))
      .sort(
        (a, b) =>
          parseInt(b.key, 10) - parseInt(a.key, 10) ||
          a.type.localeCompare(b.type),
      );
    return {
      periods,
      continuing: periods.filter(
        (period) =>
          period.type === "year" &&
          !period.complete &&
          (period.nominationCount > 0 || period.reviewed > 0),
      ),
      completed: periods.filter((period) => period.complete),
    };
  };
})();
