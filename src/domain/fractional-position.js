/**
 * @file Fractional/lexicographic sort-key generation for ordered
 * collections stored as a single text "position" column
 * (ranking_entries.position, watchlist.position) - the "large
 * reorderable list, cheap single-item moves" technique
 * docs/supabase-backend-decision.md's "Ordered collections" section
 * documents as the intended design. Pure and backend-agnostic (issue
 * #432): no function computing an actual key between two neighbors
 * existed anywhere before this - every position-touching function built
 * so far either appended via a monotonic timestamp, swapped two
 * existing values, reused an existing set's own positions, or did a
 * full reindex, none of which support inserting at an arbitrary point
 * between two specific neighbors (what real drag-and-drop reordering
 * needs).
 */

const FRACTIONAL_POSITION_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Generates a position key that sorts strictly between `before` and
 * `after` under plain string comparison. Either bound may be omitted for
 * an open end ("start of the list" / "end of the list"). Terminates in
 * at most `max(before.length, after.length) + 1` steps: once digits
 * diverge, the digit exactly halfway between them is picked immediately
 * (or descended into one more level when they're adjacent, which
 * consumes one of the two strings' remaining length every time).
 * @param {string|null|undefined} before Existing key that must sort before the result, or none for no lower bound.
 * @param {string|null|undefined} after Existing key that must sort after the result, or none for no upper bound.
 * @returns {string} A new key with `before < key < after` (given valid, distinct, correctly-ordered inputs).
 */
window.fractionalPositionBetween = function (before, after) {
  let alphabet = FRACTIONAL_POSITION_ALPHABET;
  before = before || "";
  let afterConstrained = after != null;
  let result = "";
  let i = 0;
  while (true) {
    let digitBefore = i < before.length ? alphabet.indexOf(before[i]) : 0;
    let digitAfter =
      afterConstrained && i < after.length
        ? alphabet.indexOf(after[i])
        : alphabet.length;
    if (digitBefore === digitAfter) {
      result += alphabet[digitBefore];
      i += 1;
      continue;
    }
    if (digitAfter - digitBefore > 1) {
      let mid = Math.floor((digitBefore + digitAfter) / 2);
      return result + alphabet[mid];
    }
    // Adjacent digits: take before's digit and descend one level deeper.
    // The difference is fully consumed at this digit, so nothing below it
    // is bounded by `after` any more - only `before`'s remaining digits
    // (if any) still constrain the lower end.
    result += alphabet[digitBefore];
    i += 1;
    afterConstrained = false;
  }
};
