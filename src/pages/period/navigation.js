/** @file Renders navigation among neighboring, parent, and child periods with available content. */

function populatedPeriodKeys(periodType) {
  let group =
    periodType === "year"
      ? "years"
      : periodType === "decade"
        ? "decades"
        : "centuries";
  let pattern = periodType === "year" ? /^\d{4}(?:\/\d{2})?$/ : /^\d{4}s$/;
  let populated = new Set(
    Object.keys(state.periods?.[group] || {}).filter(
      (period) =>
        pattern.test(period) &&
        (state.periods[group][period]?.films || []).some(
          (entry) => state.filmsById?.[entry.id],
        ),
    ),
  );
  Object.values(state.filmsById || {}).forEach((film) => {
    if (!/^\d{4}$/.test(String(film.year || ""))) return;
    populated.add(
      periodType === "year"
        ? String(film.year)
        : periodType === "decade"
          ? window.getDecadeKey(film.year)
          : window.getCenturyKey(film.year),
    );
  });
  (window.watchlistPeriodKeys?.(periodType) || []).forEach((period) =>
    populated.add(period),
  );
  if (periodType === "year")
    Object.values(state.officialResults || {}).forEach((source) => {
      Object.keys(source.periods || {})
        .filter((period) => pattern.test(period))
        .forEach((period) => populated.add(period));
    });
  return [...populated].sort(
    (left, right) =>
      Number.parseInt(left, 10) - Number.parseInt(right, 10) ||
      left.localeCompare(right),
  );
}

/**
 * Renders previous, parent, and next navigation for a populated period.
 * @param {string} type Period type.
 * @param {string} key Period key.
 * @param {(value:*) => string} [escape] HTML escaper.
 * @returns {string}
 */
window.renderPeriodNeighborNavigation = function (
  type,
  key,
  escape = window.pageEscape,
) {
  if (type === "alltime") return "";
  let periods = populatedPeriodKeys(type);
  let index = periods.indexOf(key);
  let previous = index > 0 ? periods[index - 1] : "";
  let next = index >= 0 && index < periods.length - 1 ? periods[index + 1] : "";
  let parentType =
    type === "year" ? "decade" : type === "decade" ? "century" : "alltime";
  let parentKey =
    type === "year"
      ? window.getDecadeKey(String(key).slice(0, 4))
      : type === "decade"
        ? window.getCenturyKey(key.replace(/s$/, ""))
        : "alltime";
  let links = [
    previous
      ? `<a href="${escape(window.periodPageUrl(type, previous))}">← ${escape(previous)}</a>`
      : "",
    `<a href="${escape(window.periodPageUrl(parentType, parentKey))}">${escape(type === "century" ? window.uiText?.("All-time") || "All-time" : parentKey)}</a>`,
    next
      ? `<a href="${escape(window.periodPageUrl(type, next))}">${escape(next)} →</a>`
      : "",
  ]
    .filter(Boolean)
    .join('<span aria-hidden="true">·</span>');
  return `<nav class="period-neighbor-nav" aria-label="${escape(window.uiText?.("Related periods") || "Related periods")}">${links}</nav>`;
};

/**
 * Renders populated child-period links for a period.
 * @param {string} type Period type.
 * @param {string} key Period key.
 * @param {(value:*) => string} [escape] HTML escaper.
 * @returns {string}
 */
window.renderPeriodChildNavigation = function (
  type,
  key,
  escape = window.pageEscape,
) {
  if (type === "year") return "";
  let childType =
    type === "decade" ? "year" : type === "century" ? "decade" : "century";
  let children = populatedPeriodKeys(childType).filter((child) => {
    if (type === "decade")
      return window.getDecadeKey(String(child).slice(0, 4)) === key;
    if (type === "century")
      return window.getCenturyKey(child.replace(/s$/, "")) === key;
    return true;
  });
  if (!children.length) return "";
  let links = children
    .map(
      (child) =>
        `<a href="${escape(window.periodPageUrl(childType, child))}">${escape(child)}</a>`,
    )
    .join("");
  let label =
    type === "decade"
      ? window.uiText?.("Years in this decade") || "Years in this decade"
      : type === "century"
        ? window.uiText?.("Decades in this century") ||
          "Decades in this century"
        : window.uiText?.("Centuries") || "Centuries";
  return `<nav class="period-subperiod-nav" aria-label="${escape(label)}">${links}</nav>`;
};
