/**
 * @file Defines canonical award-category ordering and presentation slots.
 */

window.placementEmoji = {
  1: "🏆",
  2: "🥈",
  3: "🥉",
};

window.categoryPresentationRows = [
  ["Best Director", "Best Cinematography"],
  ["Best Original Screenplay", "Best Adapted Screenplay"],
  ["Best Lead Actor", "Best Lead Actress"],
  ["Best Supporting Actor", "Best Supporting Actress"],
  ["Best International Picture", "Best Animated Picture"],
  ["Best Score", "Best Song"],
  ["Best Casting", null],
  ["Best Editing", "Best Visual Effects"],
  ["Best Production Design", "Best Costume Design"],
];

window.categoryOrder = ["Best Picture"].concat(
  window.categoryPresentationRows.reduce(
    (categories, row) => categories.concat(row.filter(Boolean)),
    [],
  ),
);

window.categories = [...window.categoryOrder];

/** Returns canonical categories followed by sorted extras. @returns {string[]} Ordered categories. */
window.getOrderedCategories = function () {
  let known = new Set(window.categoryOrder);
  let extras = (window.categories || [])
    .filter((cat) => !known.has(cat))
    .sort();
  return window.categoryOrder.concat(extras);
};

/** Returns two-column presentation slots followed by extras. @returns {Array<string|null>} Presentation slots. */
window.getCategoryPresentationSlots = function () {
  let fixedSlots = window.categoryPresentationRows.reduce(
    (slots, row) => slots.concat(row),
    [],
  );
  let fixedCategories = new Set(window.categoryOrder);
  let extras = (window.categories || [])
    .filter((category) => !fixedCategories.has(category))
    .sort();
  return fixedSlots.concat(extras);
};

/** Returns a category's canonical sort index. @param {string} category Category name. @returns {number} Sort index. */
window.categorySortIndex = function (category) {
  let index = window.getOrderedCategories().indexOf(category);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};
