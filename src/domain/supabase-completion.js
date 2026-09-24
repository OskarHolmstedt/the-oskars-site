/** @file Reads the private compact Completion projection (issue #597) and applies the
 * established official-results, award-bracket, and watch-goal completion accounting
 * without mutating the shared shell. Directors/franchises/projects ("known
 * collections") are unchanged and still need the complete archive (shared
 * people/franchise indexes used by many other pages) - see
 * docs/completion-official-projection-597.md for why. */

/** Builds one isolated {filmsById, years, watchedOther, watchlist} model from the compact projection, reusing the canonical film merger so duplicate-appearance films collapse exactly like full hydration does. @param {Object} source Compact Completion projection. @returns {Object} Isolated state shape officialCollectionCompletion()/awardBracketCompletion()/awardBracketCategoryCompletion()/watchGoalProgress() can each read via their options.state. */
window.buildSupabaseCompletionWatchedState = function (source) {
  if (source?.version !== 2)
    throw new Error("Unsupported Completion projection.");
  let shaped = window.buildLegacyStateFromSupabaseHydration(source);
  let store = { years: shaped.years, filmsById: {} };
  for (let [year, period] of Object.entries(shaped.years)) {
    for (let film of period.films || []) {
      window.addFilmToStore(year, film, { store });
    }
  }
  return {
    filmsById: store.filmsById,
    years: shaped.years,
    watchedOther: shaped.watchedOther,
    watchlist: shaped.watchlist,
  };
};

/** Builds award-bracket completion models from the compact projection, reusing window.awardBracketCompletion()/awardBracketCategoryCompletion() unchanged over an isolated state. @param {Object} source Compact Completion projection. @returns {{bracketCompletion: Object[], bracketCategoryCompletion: Object[]}} */
window.buildSupabaseCompletionBracketModel = function (source) {
  let state = window.buildSupabaseCompletionWatchedState(source);
  return {
    bracketCompletion: window.awardBracketCompletion({ state }),
    bracketCategoryCompletion: window.awardBracketCategoryCompletion({
      state,
    }),
  };
};

/** Builds watch-goal progress models from the compact projection, reusing window.watchGoalProgress() unchanged over an isolated state. @param {Object} source Compact Completion projection. @returns {{watchGoalYears: Object[], watchGoalDecades: Object[], watchGoalCenturies: Object[]}} */
window.buildSupabaseCompletionWatchGoalModel = function (source) {
  let state = window.buildSupabaseCompletionWatchedState(source);
  return {
    watchGoalYears: window.watchGoalProgress("year", { state }),
    watchGoalDecades: window.watchGoalProgress("decade", { state }),
    watchGoalCenturies: window.watchGoalProgress("century", { state }),
  };
};

/** Builds one official-results completion model per currently populated source, from the compact watched/watchlist projection plus an already-hydrated officialResults object. @param {Object} watchedSource Compact Completion watched/watchlist projection. @param {Object} officialResults Live official-results object (e.g. window.state.officialResults, or the result of hydrateOfficialResultsFromSupabase()/buildOfficialResultsFromSupabase()). @returns {Map<string, Object>} sourceId -> OfficialCollectionCompletion, in the same academy-awards-first order completion.js's own refreshOfficialCompletions() uses. */
window.buildSupabaseCompletionOfficialModel = function (
  watchedSource,
  officialResults,
) {
  let state = window.buildSupabaseCompletionWatchedState(watchedSource);
  state.officialResults = officialResults || {};
  let sourceIds = Object.keys(state.officialResults).sort((a, b) =>
    a === "academy-awards" ? -1 : b === "academy-awards" ? 1 : 0,
  );
  return new Map(
    sourceIds.map((sourceId) => [
      sourceId,
      window.officialCollectionCompletion(sourceId, { state }),
    ]),
  );
};

/** Reads one versioned private Completion watched/watchlist projection; the official-results side stays on the existing hydrateOfficialResultsFromSupabase()/window.state.officialResults path, unchanged. @returns {Promise<Object>} Compact watched/watchlist projection. */
window.loadSupabaseCompletionWatchedProjection = async function () {
  if (window.resolveActiveProfileSlug?.() || window.state?.isPublicProfileView)
    throw new Error("Private Completion reads are unavailable in public mode.");
  let auth = await window.resolveSupabaseAuthState();
  if (auth.status !== "signed-in")
    throw new Error("Sign in to view completion.");
  let ready = await window.ensureSupabaseClient();
  if (!ready) throw new Error("Supabase not configured.");
  let { data, error } = await ready.client.rpc(
    "read_completion_watched_projection",
  );
  if (error) throw error;
  if (data?.version !== 2)
    throw new Error("Unsupported Completion watched response.");
  return data;
};
