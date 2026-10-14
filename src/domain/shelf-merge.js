/**
 * @file Owns shared candidate-block storage and shelf merge sessions for the
 * Supabase Watched and Watchlist adapters beside the two-pointer merge engine.
 */

(function () {
  let memoryStorage = new Map();
  function getStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memoryStorage.get(key) ?? null;
    }
  }
  function setStorageItem(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {
      memoryStorage.set(key, val);
    }
  }
  function removeStorageItem(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      memoryStorage.delete(key);
    }
  }

  /**
   * Formats release years as contiguous spans, decades, or disjoint lists.
   * @param {number[]} years
   * @returns {string}
   */
  window.formatShelfMergeBlockLabel = function (years) {
    if (!Array.isArray(years) || !years.length) return "";
    let sorted = [...new Set(years.map(Number).filter(Number.isInteger))].sort(
      (a, b) => a - b,
    );
    if (!sorted.length) return "";

    let runs = [];
    let current = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      let prev = sorted[i - 1];
      let curr = sorted[i];
      if (curr === prev + 1) {
        current.push(curr);
      } else {
        runs.push(current);
        current = [curr];
      }
    }
    runs.push(current);

    let parts = runs.map((run) => {
      if (run.length === 1) return String(run[0]);
      if (run.length === 10 && run[0] % 10 === 0 && window.getDecadeKey) {
        return window.getDecadeKey(run[0]);
      }
      return `${run[0]}–${run[run.length - 1]}`;
    });

    return parts.join(", ");
  };

  /**
   * Binds candidate-block operations to one existing storage key and scope.
   * @param {string} storageKey
   * @param {() => number[]} getPopulatedYears
   * @param {(years: number[]) => Object[]} itemsForYears
   * @returns {Object}
   */
  window.createShelfMergeBlockStore = function (
    storageKey,
    getPopulatedYears,
    itemsForYears,
  ) {
    function load() {
      let populatedYears = getPopulatedYears();
      let populatedSet = new Set(populatedYears);
      let savedRaw = getStorageItem(storageKey);
      let rawBlocks = [];

      if (savedRaw) {
        try {
          let parsed = JSON.parse(savedRaw);
          if (Array.isArray(parsed)) {
            let seenYears = new Set();
            parsed.forEach((entry) => {
              if (!Array.isArray(entry)) return;
              let validYears = entry
                .map(Number)
                .filter((y) => populatedSet.has(y) && !seenYears.has(y));
              if (validYears.length) {
                validYears.forEach((y) => seenYears.add(y));
                rawBlocks.push(validYears.sort((a, b) => a - b));
              }
            });
            populatedYears.forEach((year) => {
              if (!seenYears.has(year)) rawBlocks.push([year]);
            });
          }
        } catch {
          rawBlocks = [];
        }
      }

      if (!rawBlocks.length) {
        rawBlocks = populatedYears.map((year) => [year]);
      }

      rawBlocks.sort((left, right) => Math.min(...left) - Math.min(...right));

      return rawBlocks.map((years) => {
        let items = itemsForYears(years);
        return {
          id: years.join(","),
          years,
          label: window.formatShelfMergeBlockLabel(years),
          count: items.length,
          isSingle: years.length === 1,
        };
      });
    }
    function save(blocks) {
      let yearArrays = (blocks || [])
        .map((b) =>
          (Array.isArray(b) ? b : b?.years || [])
            .map(Number)
            .sort((a, b) => a - b),
        )
        .filter((arr) => arr.length > 0);
      setStorageItem(storageKey, JSON.stringify(yearArrays));
    }
    function unite(blockAId, blockBId) {
      if (!blockAId || !blockBId || blockAId === blockBId) {
        return load();
      }
      let blocks = load();
      let blockA = blocks.find((b) => b.id === blockAId);
      let blockB = blocks.find((b) => b.id === blockBId);
      if (!blockA || !blockB) return blocks;

      let unitedYears = [...new Set([...blockA.years, ...blockB.years])].sort(
        (a, b) => a - b,
      );

      let remainingBlocks = blocks
        .filter((b) => b.id !== blockAId && b.id !== blockBId)
        .map((b) => b.years);
      remainingBlocks.push(unitedYears);

      save(remainingBlocks);
      return load();
    }
    function split(blockId) {
      let blocks = load();
      let target = blocks.find((b) => b.id === blockId);
      if (!target || target.isSingle) return blocks;

      let remaining = blocks
        .filter((b) => b.id !== blockId)
        .map((b) => b.years);
      target.years.forEach((year) => remaining.push([year]));

      save(remaining);
      return load();
    }
    function reset() {
      removeStorageItem(storageKey);
      return load();
    }
    function groupByDecade() {
      let populatedYears = getPopulatedYears();
      let decadeGroups = new Map();
      populatedYears.forEach((year) => {
        let decade = window.getDecadeKey
          ? window.getDecadeKey(year)
          : `${Math.floor(year / 10) * 10}s`;
        if (!decadeGroups.has(decade)) decadeGroups.set(decade, []);
        decadeGroups.get(decade).push(year);
      });
      let yearArrays = [...decadeGroups.values()];
      save(yearArrays);
      return load();
    }
    return { load, save, unite, split, reset, groupByDecade };
  };

  function syncShelfSession(session) {
    while (session.currentShelfIndex < session.shelves.length) {
      let shelf = session.shelves[session.currentShelfIndex];
      if (shelf.pointerA >= shelf.listA.length) {
        if (shelf.pointerB < shelf.listB.length) {
          let remainder = shelf.listB.slice(shelf.pointerB);
          shelf.merged.push(...remainder);
          session.merged.push(...remainder);
          shelf.pointerB = shelf.listB.length;
        }
        session.currentShelfIndex += 1;
        continue;
      }
      if (shelf.pointerB >= shelf.listB.length) {
        if (shelf.pointerA < shelf.listA.length) {
          let remainder = shelf.listA.slice(shelf.pointerA);
          shelf.merged.push(...remainder);
          session.merged.push(...remainder);
          shelf.pointerA = shelf.listA.length;
        }
        session.currentShelfIndex += 1;
        continue;
      }
      // Interactive shelf reached
      session.currentShelf = shelf;
      session.listA = shelf.listA;
      session.listB = shelf.listB;
      session.pointerA = shelf.pointerA;
      session.pointerB = shelf.pointerB;
      session.shelfLabel = shelf.label;
      session.done = false;
      return session;
    }

    session.currentShelf = null;
    session.listA = [];
    session.listB = [];
    session.pointerA = 0;
    session.pointerB = 0;
    session.shelfLabel = "";
    session.done = true;
    return session;
  }

  /**
   * Creates a merge session that compares only items in the same grade shelf.
   * @param {Object[]} listA
   * @param {Object[]} listB
   * @param {{gradeKey: (item: Object) => string, gradeValue: (key: string) => number, direction: number, formatLabel: (sample: Object, key: string) => string}} options
   * @returns {Object}
   */
  window.createShelfMergeSession = function (
    listA,
    listB,
    { gradeKey, gradeValue, direction, formatLabel },
  ) {
    let mapA = new Map();
    (listA || []).forEach((item) => {
      let key = gradeKey(item);
      if (!mapA.has(key)) mapA.set(key, []);
      mapA.get(key).push(item);
    });

    let mapB = new Map();
    (listB || []).forEach((item) => {
      let key = gradeKey(item);
      if (!mapB.has(key)) mapB.set(key, []);
      mapB.get(key).push(item);
    });

    let allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    let sortedKeys = [...allKeys].sort((a, b) => {
      let valA = gradeValue(a);
      let valB = gradeValue(b);
      return direction * (valA - valB);
    });

    let shelves = sortedKeys.map((key) => {
      let shelfA = mapA.get(key) || [];
      let shelfB = mapB.get(key) || [];
      let sample = shelfA[0] || shelfB[0];
      return {
        key,
        label: formatLabel(sample, key),
        listA: shelfA,
        listB: shelfB,
        pointerA: 0,
        pointerB: 0,
        merged: [],
      };
    });

    let session = {
      shelves,
      currentShelfIndex: 0,
      merged: [],
      history: [],
      done: false,
      listA: [],
      listB: [],
      pointerA: 0,
      pointerB: 0,
      currentShelf: null,
      shelfLabel: "",
    };

    syncShelfSession(session);
    return session;
  };

  /**
   * Records a pick and automatically passes shelves with only one remaining side.
   * @param {Object} session
   * @param {'a'|'b'} side
   * @returns {Object}
   */
  window.pickShelfMergeSide = function (session, side) {
    if (!session || session.done || !session.currentShelf) return session;

    let shelf = session.currentShelf;
    let historyEntry = {
      shelfIndex: session.currentShelfIndex,
      side,
      mergedCountBefore: session.merged.length,
      shelvesState: session.shelves.map((s) => ({
        pointerA: s.pointerA,
        pointerB: s.pointerB,
        mergedLen: s.merged.length,
      })),
    };

    let item =
      side === "a" ? shelf.listA[shelf.pointerA] : shelf.listB[shelf.pointerB];
    shelf.merged.push(item);
    session.merged.push(item);

    if (side === "a") shelf.pointerA += 1;
    else shelf.pointerB += 1;

    session.history.push(historyEntry);
    syncShelfSession(session);
    return session;
  };

  /**
   * Restores the previous pick including any automatically passed remainder.
   * @param {Object} session
   * @returns {Object}
   */
  window.undoShelfMergeChoice = function (session) {
    if (!session || !session.history || !session.history.length) return session;

    let entry = session.history.pop();
    session.merged.length = entry.mergedCountBefore;
    session.shelves.forEach((s, idx) => {
      let saved = entry.shelvesState[idx];
      s.pointerA = saved.pointerA;
      s.pointerB = saved.pointerB;
      s.merged.length = saved.mergedLen;
    });

    session.currentShelfIndex = entry.shelfIndex;
    syncShelfSession(session);
    return session;
  };

  /**
   * Suggests adjacent pairwise groupings for candidate blocks without rigid round ceremony.
   * @param {{id: string, years: number[], label: string, count: number, isSingle: boolean}[]} blocks
   * @returns {{pairs: {blockA: {id: string, years: number[], label: string, count: number, isSingle: boolean}, blockB: {id: string, years: number[], label: string, count: number, isSingle: boolean}, id: string, label: string}[], remainder: {id: string, years: number[], label: string, count: number, isSingle: boolean}|null}}
   */
  window.suggestShelfMergePairs = function (blocks) {
    let list = Array.isArray(blocks) ? blocks : [];
    let pairs = [];
    for (let i = 0; i < list.length - 1; i += 2) {
      let blockA = list[i];
      let blockB = list[i + 1];
      pairs.push({
        blockA,
        blockB,
        id: `${blockA.id}::${blockB.id}`,
        label: `${blockA.label} & ${blockB.label}`,
      });
    }
    let remainder = list.length % 2 === 1 ? list[list.length - 1] : null;
    return { pairs, remainder };
  };
})();
