/** @file Persists deliberate annual ballot outcomes and derives ceremony progress. */

(function () {
  function reviewStore(year) {
    window.state.awardReviews ||= { years: {} };
    window.state.awardReviews.years ||= {};
    window.state.awardReviews.years[String(year)] ||= {};
    return window.state.awardReviews.years[String(year)];
  }

  /** Returns the stored review outcome for one annual category. @param {string|number} year Release year. @param {string} category Award category. @returns {{status:'complete'|'none', reviewedAt:string}|null} Outcome. */
  window.annualAwardReview = function (year, category) {
    return reviewStore(year)[category] || null;
  };

  /** Marks an annual category deliberately complete or reviewed with no nominees. @param {string|number} year Release year. @param {string} category Award category. @param {'complete'|'none'} status Outcome. @returns {Object} Stored outcome. */
  window.setAnnualAwardReview = function (year, category, status) {
    if (!window.getOrderedCategories?.().includes(category))
      throw new Error("Unknown award category.");
    if (!['complete', 'none'].includes(status))
      throw new Error("Unknown award review outcome.");
    let outcome = { status, reviewedAt: new Date().toISOString() };
    reviewStore(year)[category] = outcome;
    return outcome;
  };

  /** Clears a stored annual outcome when ballot contents change. @param {string|number} year Release year. @param {string} category Award category. */
  window.reopenAnnualAwardReview = function (year, category) {
    delete reviewStore(year)[category];
  };

  /** Derives category completion and winner-led ceremony data for a year. @param {string|number} year Release year. @returns {{total:number, reviewed:number, complete:boolean, nextCategory:string, categories:Object[], winners:Object[]}} Progress. */
  window.annualAwardReviewProgress = function (year) {
    year = String(year);
    let categories = (window.getOrderedCategories?.() || []).map((category) => {
      let nominees = window.nomineesForCategory?.(year, "years", category) || [];
      let review = window.annualAwardReview(year, category);
      return {
        category,
        nominees,
        review,
        reviewed: Boolean(review),
        winner: nominees.find((entry) => Number(entry.award?.placement) === 1) || null,
      };
    });
    return {
      total: categories.length,
      reviewed: categories.filter((entry) => entry.reviewed).length,
      complete: categories.length > 0 && categories.every((entry) => entry.reviewed),
      nextCategory: categories.find((entry) => !entry.reviewed)?.category || "",
      categories,
      winners: categories.map((entry) => entry.winner).filter(Boolean),
    };
  };
})();
