/**
 * @file Merges the split-out official-results document
 * (`data/oskars-data-official.json`, `docs/official-results-file-split-decision.md`)
 * into a personal canonical document before validation. Kept as one small,
 * reused function rather than duplicated at every fetch/read site (browser
 * bootstrap, each Node pipeline script).
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
