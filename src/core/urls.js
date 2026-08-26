/**
 * @file Builds relative detail and comparison URLs while centralizing query
 * encoding and typed comparison-target serialization.
 */

/**
 * Builds a film detail URL.
 * @param {string} filmId Canonical film id.
 * @returns {string} Relative film URL.
 */
window.filmPageUrl = function (filmId) {
  return `film.html?id=${encodeURIComponent(String(filmId || ""))}`;
};

/**
 * Builds a preview URL for a film known only to the shared archive (no
 * local film id yet).
 * @param {string} tmdbId TMDB id.
 * @returns {string} Relative film preview URL.
 */
window.sharedFilmPreviewUrl = function (tmdbId) {
  return `film.html?tmdb=${encodeURIComponent(String(tmdbId || ""))}`;
};

/**
 * Builds a watched-film intake URL.
 * @param {string} [workflowId] Intake workflow id to open.
 * @returns {string} Relative intake URL.
 */
window.intakePageUrl = function (workflowId) {
  return workflowId
    ? `intake.html?intake=${encodeURIComponent(String(workflowId))}`
    : "intake.html";
};

/**
 * Builds the dedicated year-ranking workflow URL.
 * @param {string|number} year Release year.
 * @returns {string} Relative year-ranking URL.
 */
window.yearRankingPageUrl = function (year) {
  return `rank-year.html?year=${encodeURIComponent(String(year || ""))}`;
};

/**
 * Builds the dedicated annual-awards workflow URL.
 * @param {string|number} year Release year.
 * @returns {string} Relative annual-awards URL.
 */
window.yearAwardsPageUrl = function (year) {
  return `awards-year.html?year=${encodeURIComponent(String(year || ""))}`;
};

/**
 * Builds a person detail URL.
 * @param {string} personId Canonical person id.
 * @returns {string} Relative person URL.
 */
window.personPageUrl = function (personId) {
  return `person.html?id=${encodeURIComponent(String(personId || ""))}`;
};

/**
 * Builds a credit-subject detail URL.
 * @param {string} subjectId Canonical credit-subject id.
 * @returns {string} Relative subject URL.
 */
window.subjectPageUrl = function (subjectId) {
  return `subject.html?id=${encodeURIComponent(String(subjectId || ""))}`;
};

/**
 * Builds an award-category detail URL.
 * @param {string} category Canonical category name.
 * @returns {string} Relative category URL.
 */
window.categoryPageUrl = function (category) {
  return `category.html?name=${encodeURIComponent(String(category || ""))}`;
};

/**
 * Builds a tag detail URL.
 * @param {string} tag Tag name.
 * @returns {string} Relative tag URL.
 */
window.tagPageUrl = function (tag) {
  return `tag.html?name=${encodeURIComponent(String(tag || ""))}`;
};

/**
 * Maps an internal period collection name to its URL type.
 * @param {string} type Internal period type.
 * @returns {string} URL-facing period type.
 */
window.periodPageType = function (type) {
  return (
    {
      years: "year",
      decades: "decade",
      centuries: "century",
      allTime: "alltime",
    }[type] || type
  );
};

/**
 * Builds a period detail URL.
 * @param {string} type Internal or URL-facing period type.
 * @param {string|number} key Period key.
 * @returns {string} Relative period URL.
 */
window.periodPageUrl = function (type, key) {
  let pageType = window.periodPageType(type);
  let pageKey = pageType === "alltime" ? "alltime" : String(key || "");
  return `period.html?type=${encodeURIComponent(pageType)}&key=${encodeURIComponent(pageKey)}`;
};

/**
 * Builds a franchise detail URL.
 * @param {string} id Canonical franchise id.
 * @returns {string} Relative franchise URL.
 */
window.franchisePageUrl = function (id) {
  return `franchise.html?id=${encodeURIComponent(id)}`;
};

/**
 * Builds a project detail URL.
 * @param {string} id Project id.
 * @returns {string} Relative project URL.
 */
window.projectPageUrl = function (id) {
  return `project.html?id=${encodeURIComponent(String(id || ""))}`;
};

/**
 * Builds a local-rank merge-tool URL (issue #165).
 * @param {'franchises'|'people'|'tags'} type Collection kind.
 * @param {string} id Collection entity id (a tag's name for `tags`).
 * @param {string} [returnUrl] Where to send the user back when done.
 * @returns {string} Relative local-rank merge tool URL.
 */
window.localRankMergePageUrl = function (type, id, returnUrl) {
  let parts = [
    `type=${encodeURIComponent(type)}`,
    `id=${encodeURIComponent(String(id || ""))}`,
  ];
  if (returnUrl) parts.push(`returnUrl=${encodeURIComponent(returnUrl)}`);
  return `local-rank-merge.html?${parts.join("&")}`;
};

/**
 * Builds a legacy film-only comparison URL.
 * @param {string|string[]} [filmIds] Film ids to compare.
 * @returns {string} Relative comparison URL.
 */
window.comparePageUrl = function (filmIds = []) {
  let ids = Array.isArray(filmIds) ? filmIds : [filmIds];
  let value = ids
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .join(",");
  return value
    ? `compare.html?films=${encodeURIComponent(value)}`
    : "compare.html";
};

/**
 * Builds a stable equality key for a typed comparison target.
 * @param {CompareTargetReference|null} target Typed target reference.
 * @returns {string} Unencoded `type:id` key, or an empty string.
 */
window.compareTargetKey = function (target) {
  let type = String(target?.type || "").trim();
  let id = String(target?.id || "").trim();
  return type && id ? `${type}:${id}` : "";
};

/**
 * Encodes a typed comparison target for a query value.
 * @param {CompareTargetReference|null} target Typed target reference.
 * @returns {string} Encoded `type:id` value, or an empty string.
 */
window.encodeCompareTarget = function (target) {
  let type = String(target?.type || "").trim();
  let id = String(target?.id || "").trim();
  return type && id
    ? `${encodeURIComponent(type)}:${encodeURIComponent(id)}`
    : "";
};

/**
 * Decodes a typed comparison-target query value.
 * @param {string} value Encoded `type:id` value.
 * @returns {CompareTargetReference|null} Typed target reference, or null when invalid.
 */
window.decodeCompareTarget = function (value) {
  let text = String(value || "").trim();
  let separator = text.indexOf(":");
  if (separator <= 0) return null;
  let type = decodeURIComponent(text.slice(0, separator)).trim();
  let id = decodeURIComponent(text.slice(separator + 1)).trim();
  return type && id ? { type, id } : null;
};

/**
 * Builds a typed-target comparison URL.
 * @param {CompareTargetReference[]|CompareTargetReference} [targets] Target references to compare.
 * @returns {string} Relative comparison URL.
 */
window.compareTargetsPageUrl = function (targets = []) {
  let list = Array.isArray(targets) ? targets : [targets];
  let encoded = list.map(window.encodeCompareTarget).filter(Boolean);
  return encoded.length
    ? `compare.html?targets=${encoded.join(",")}`
    : "compare.html";
};
