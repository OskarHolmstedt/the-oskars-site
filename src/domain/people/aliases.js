/**
 * @file Manages confirmed and rejected person aliases and suggests likely duplicate people.
 */

function foldPersonName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/[ðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function personNameDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    let current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** Builds an order-independent alias-pair key. @param {string} leftId First id. @param {string} rightId Second id. @returns {string} Pair key. */
window.personAliasPairKey = function (leftId, rightId) {
  return [String(leftId || ""), String(rightId || "")].sort().join("\n");
};

/** Confirms an alias and transfers variant-owned metadata. @param {string} canonicalId Canonical id. @param {string} variantId Variant id. @returns {boolean} Whether the alias was applied. */
window.confirmPersonAlias = function (canonicalId, variantId) {
  let peopleById = window.ensurePeopleIndex?.() || state.peopleById || {};
  let canonical = peopleById[canonicalId];
  let variant = peopleById[variantId];
  if (!canonical || !variant || canonicalId === variantId) return false;
  state.peopleAliases ||= {};
  state.peopleAliases[variantId] = canonical.name;
  state.personPortraits ||= {};
  if (!state.personPortraits[canonicalId] && state.personPortraits[variantId]) {
    state.personPortraits[canonicalId] = state.personPortraits[variantId];
  }
  delete state.personPortraits[variantId];
  state.directorLinks ||= {};
  if (!state.directorLinks[canonicalId] && state.directorLinks[variantId]) {
    state.directorLinks[canonicalId] = state.directorLinks[variantId];
  }
  delete state.directorLinks[variantId];
  state.rejectedPersonAliases = (state.rejectedPersonAliases || []).filter(
    (key) => key !== window.personAliasPairKey(canonicalId, variantId),
  );
  window.markAggregatesDirty?.("person alias confirmed");
  window.ensureAggregatesFresh?.();
  return true;
};

/** Removes a confirmed alias. @param {string} variantId Variant id. @returns {boolean} Whether an alias was removed. */
window.removePersonAlias = function (variantId) {
  if (!state.peopleAliases?.[variantId]) return false;
  delete state.peopleAliases[variantId];
  window.markAggregatesDirty?.("person alias removed");
  window.ensureAggregatesFresh?.();
  return true;
};

/** Rejects a suggested alias pair. @param {string} leftId First id. @param {string} rightId Second id. @returns {boolean} Always true. */
window.rejectPersonAlias = function (leftId, rightId) {
  let key = window.personAliasPairKey(leftId, rightId);
  state.rejectedPersonAliases ||= [];
  if (!state.rejectedPersonAliases.includes(key))
    state.rejectedPersonAliases.push(key);
  state.personAliasCandidates = null;
  return true;
};

/** Clears rejected alias pairs and cached suggestions. */
window.resetRejectedPersonAliases = function () {
  state.rejectedPersonAliases = [];
  state.personAliasCandidates = null;
};

/** Ranks likely duplicate people by normalized-name similarity. @param {number} [limit] Maximum suggestions. @returns {Object[]} Alias candidates. */
window.findPotentialPersonAliases = function (limit = 50) {
  let people = Object.values(
    window.ensurePeopleIndex?.() || state.peopleById || {},
  ).filter((person) => foldPersonName(person.name).split(" ").length >= 2);
  let candidates = [];
  let seenPairs = new Set();

  function addCandidate(left, right, reason, score) {
    let pairKey = [left.id, right.id].sort().join("\n");
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    if ((state.rejectedPersonAliases || []).includes(pairKey)) return;
    let sharedProfessions = left.professions.filter((profession) =>
      right.professions.includes(profession),
    );
    if (sharedProfessions.length) score += 3;
    candidates.push({
      leftId: left.id,
      rightId: right.id,
      leftName: left.name,
      rightName: right.name,
      reason,
      score: Math.min(100, score),
      sharedProfessions,
    });
  }

  function groupedBy(keyForPerson) {
    let groups = new Map();
    people.forEach((person) => {
      let key = keyForPerson(person);
      if (!key) return;
      let group = groups.get(key) || [];
      group.push(person);
      groups.set(key, group);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  }

  function eachPair(group, callback) {
    for (let leftIndex = 0; leftIndex < group.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < group.length;
        rightIndex++
      ) {
        callback(group[leftIndex], group[rightIndex]);
      }
    }
  }

  groupedBy((person) => foldPersonName(person.name)).forEach((group) =>
    eachPair(group, (left, right) =>
      addCandidate(left, right, "Diacritics or punctuation differ", 100),
    ),
  );
  groupedBy((person) =>
    foldPersonName(person.name).split(" ").sort().join(" "),
  ).forEach((group) =>
    eachPair(group, (left, right) =>
      addCandidate(left, right, "Name order differs", 98),
    ),
  );
  groupedBy(
    (person) => foldPersonName(person.name).split(" ").slice(-1)[0],
  ).forEach((group) =>
    eachPair(group, (left, right) => {
      let leftGiven = foldPersonName(left.name)
        .split(" ")
        .slice(0, -1)
        .join(" ");
      let rightGiven = foldPersonName(right.name)
        .split(" ")
        .slice(0, -1)
        .join(" ");
      let distance = personNameDistance(leftGiven, rightGiven);
      if (distance === 1)
        addCandidate(
          left,
          right,
          "Matching surname; given name differs by one character",
          92,
        );
      else if (
        distance === 2 &&
        Math.max(leftGiven.length, rightGiven.length) >= 6
      ) {
        addCandidate(left, right, "Matching surname; similar given name", 82);
      }
    }),
  );
  groupedBy((person) => foldPersonName(person.name).split(" ")[0]).forEach(
    (group) =>
      eachPair(group, (left, right) => {
        let leftTokens = foldPersonName(left.name).split(" ");
        let rightTokens = foldPersonName(right.name).split(" ");
        let leftSurname = leftTokens[leftTokens.length - 1];
        let rightSurname = rightTokens[rightTokens.length - 1];
        if (personNameDistance(leftSurname, rightSurname) === 1) {
          addCandidate(
            left,
            right,
            "Matching given name; surname differs by one character",
            90,
          );
        }
      }),
  );

  return candidates
    .sort((a, b) => b.score - a.score || a.leftName.localeCompare(b.leftName))
    .slice(0, limit);
};

/** Returns cached likely alias candidates. @returns {Object[]} Alias candidates. */
window.getPotentialPersonAliases = function () {
  if (!Array.isArray(state.personAliasCandidates)) {
    state.personAliasCandidates = window.findPotentialPersonAliases();
  }
  return state.personAliasCandidates;
};
