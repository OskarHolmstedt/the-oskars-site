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

/** Returns categories outside the fixed categoryOrder set, sorted. @returns {string[]} Extra categories. */
function extraCategoriesSorted() {
  let known = new Set(window.categoryOrder);
  return (window.categories || []).filter((cat) => !known.has(cat)).sort();
}

/** Returns canonical categories followed by sorted extras. @returns {string[]} Ordered categories. */
window.getOrderedCategories = function () {
  return window.categoryOrder.concat(extraCategoriesSorted());
};

/** Returns two-column presentation slots followed by extras. @returns {Array<string|null>} Presentation slots. */
window.getCategoryPresentationSlots = function () {
  let fixedSlots = window.categoryPresentationRows.reduce(
    (slots, row) => slots.concat(row),
    [],
  );
  return fixedSlots.concat(extraCategoriesSorted());
};

/** Returns a category's canonical sort index. @param {string} category Category name. @returns {number} Sort index. */
window.categorySortIndex = function (category) {
  let index = window.getOrderedCategories().indexOf(category);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};
