/**
 * @file Merges the split-out official-results document
 * (`data/oskars-data-official.json`, `docs/official-results-file-split-decision.md`)
 * into a personal canonical document before validation, and applies its
 * `films`/`people` metadata onto the bundled-official-results globals. Kept
 * as one small, reused function rather than duplicated at every fetch/read
 * site (browser bootstrap, each Node pipeline script) - the same "one
 * canonical merge point" reasoning this codebase already applies elsewhere.
 */

/**
 * Copies `officialResults` from a parsed official-results document onto a
 * parsed personal canonical document, in place. `data/oskars-data.json`
 * itself keeps an empty `officialResults: {}` placeholder so every other
 * direct reader of that file alone (audit/privacy/packaging scripts, most
 * tests) keeps working unchanged; only load-bearing consumers call this
 * before validation.
 * @param {Object} personalDocument Parsed `data/oskars-data.json` (or
 *   equivalent), mutated in place.
 * @param {Object|null} officialDocument Parsed `data/oskars-data-official.json`,
 *   or null if unavailable (personal document's own value, typically `{}`,
 *   is left untouched).
 * @returns {Object} `personalDocument`, for chaining.
 */
window.mergeOfficialResultsIntoCanonical = function (
  personalDocument,
  officialDocument,
) {
  if (officialDocument && officialDocument.officialResults)
    personalDocument.officialResults = officialDocument.officialResults;
  return personalDocument;
};

/**
 * Applies an official-results document's `films`/`people` metadata onto the
 * bundled-official-results globals (`src/core/bundled-official-results.js`),
 * overwriting the bundled defaults - the same "bundled default, live fetch
 * overwrites" pattern `officialResults` itself already follows. Called
 * after a fresh owner-mode fetch and after a successful backend
 * shared-archive pull (`shared-archive-sync.js`), so
 * `official-results-view.js`'s rendering always reads from these two
 * globals regardless of which tier supplied them.
 * @param {Object|null} officialDocument Parsed official-results document,
 *   or an object with `films`/`people` maps pulled from Firestore.
 */
window.applyOfficialMetadataGlobals = function (officialDocument) {
  if (!officialDocument) return;
  if (officialDocument.films)
    window.OSKARS_BUNDLED_OFFICIAL_FILM_METADATA = officialDocument.films;
  if (officialDocument.people)
    window.OSKARS_BUNDLED_OFFICIAL_PEOPLE_METADATA = officialDocument.people;
};
