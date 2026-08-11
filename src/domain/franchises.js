/**
 * @file Normalizes franchise memberships and builds the lazy hierarchical franchise index.
 */

/** Normalizes a franchise name to its canonical id. @param {*} value Franchise name. @returns {string} Franchise id. */
window.normalizeFranchiseId = function (value) {
  return window.normalizeTitle(value);
};

function isBlankFranchiseValue(value) {
  return /^(?:-|–|—|n\/?a|none|no franchise)$/i.test(
    String(value || "").trim(),
  );
}

/** Normalizes and merges franchise memberships. @param {*} value Membership input. @returns {FranchiseMembership[]} Memberships. */
window.normalizeFranchiseMemberships = function (value) {
  let source = Array.isArray(value) ? value : [];
  let seen = new Set();
  return source
    .map((entry) => {
      let record = typeof entry === "string" ? { name: entry } : entry || {};
      let name = String(record.name || "").trim();
      if (isBlankFranchiseValue(name)) name = "";
      let id = window.normalizeFranchiseId(name);

      // parentChain is the full ancestor lineage (outermost to innermost,
      // last link = direct parent), e.g. ['Marvel','MCU','Infinity Saga'] for
      // a 'Phase 1' entry. This function must stay idempotent (it's re-run on
      // its own already-normalized output, e.g. by normalizeFilmMetadata and
      // by every rebuildFranchiseIndex call), so a second pass falls back to
      // the previous pass's parentChainNames before falling further back to a
      // single-link chain from the legacy parentName/parentNames shape (for
      // callers that don't know about chains, or a plain direct membership).
      let rawChain =
        Array.isArray(record.parentChain) && record.parentChain.length
          ? record.parentChain
          : Array.isArray(record.parentChainNames) &&
              record.parentChainNames.length
            ? record.parentChainNames
            : record.parentName || record.parent || record.parentNames?.[0]
              ? [
                  String(
                    record.parentName || record.parent || record.parentNames[0],
                  ).trim(),
                ]
              : [];
      let parentChainIds = [];
      let parentChainNames = [];
      let chainSeen = new Set([id]);
      rawChain
        .map((link) => String(link || "").trim())
        .filter((link) => link && !isBlankFranchiseValue(link))
        .forEach((link) => {
          let linkId = window.normalizeFranchiseId(link);
          if (!linkId || chainSeen.has(linkId)) return;
          chainSeen.add(linkId);
          parentChainIds.push(linkId);
          parentChainNames.push(link);
        });

      let parentNames = Array.isArray(record.parentNames)
        ? record.parentNames
            .map((name) => String(name || "").trim())
            .filter(Boolean)
        : [];
      parentNames = parentNames.filter(
        (parent) => parent && !isBlankFranchiseValue(parent),
      );
      parentNames = parentNames.filter((parent) => {
        let parentId = window.normalizeFranchiseId(parent);
        return parentId && parentId !== id;
      });
      let parentIds = [
        ...new Set(
          parentNames.map((parent) => window.normalizeFranchiseId(parent)),
        ),
      ];
      parentNames = parentIds.map(
        (parentId) =>
          parentNames.find(
            (parent) => window.normalizeFranchiseId(parent) === parentId,
          ) || parentId,
      );
      // The chain's own direct parent (its last link) takes precedence as
      // *the* direct parent, folded into the plural parentIds/parentNames
      // crossover list so every single-hop parent lookup keeps working.
      if (parentChainIds.length) {
        let directId = parentChainIds[parentChainIds.length - 1];
        let directName = parentChainNames[parentChainNames.length - 1];
        if (!parentIds.includes(directId)) {
          parentIds = [directId, ...parentIds];
          parentNames = [directName, ...parentNames];
        }
      }
      let parentId = parentIds[0] || "";
      let rank = Number(record.rank);
      return {
        id,
        name,
        parentId,
        parentName: parentId ? parentNames[0] : "",
        parentIds,
        parentNames,
        parentChainIds,
        parentChainNames,
        rank: Number.isInteger(rank) && rank > 0 ? rank : null,
      };
    })
    .filter((entry) => {
      let key = `${entry.id}::${entry.parentIds.join("|")}`;
      return entry.id && !seen.has(key) && seen.add(key);
    });
};

// A film can end up tagged with both an ancestor (e.g. a simple "MCU" tag
// from the ranked list's Franchise column) and one of that ancestor's own
// descendants (e.g. "Phase One", from a deeper chain elsewhere) — the
// ancestor is already implied by the descendant's own breadcrumb, so only
// the most specific ("leaf") membership per branch needs to be shown.
/** Removes memberships represented by a more specific descendant. @param {FranchiseMembership[]} franchises Memberships. @returns {FranchiseMembership[]} Leaf memberships. */
window.leafFranchiseMemberships = function (franchises) {
  let normalized = window.normalizeFranchiseMemberships(franchises);
  let ancestorIds = new Set();
  normalized.forEach((membership) =>
    (membership.parentChainIds || []).forEach((id) => ancestorIds.add(id)),
  );
  return normalized.filter((membership) => !ancestorIds.has(membership.id));
};

/** Parses stored or delimited franchise memberships. @param {*} value Membership input. @returns {FranchiseMembership[]} Memberships. */
window.parseFranchiseMemberships = function (value) {
  let lines = String(value || "")
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter((line) => line && !isBlankFranchiseValue(line));
  return window.normalizeFranchiseMemberships(
    lines.map((line) => {
      let rankMatch = line.match(/\|\s*(\d+)\s*$/);
      let rank = rankMatch ? Number(rankMatch[1]) : null;
      let names = (rankMatch ? line.slice(0, rankMatch.index) : line)
        .split(/\s*>\s*/)
        .map((name) => name.trim())
        .filter(Boolean);
      return names.length > 1
        ? {
            parentChain: names.slice(0, -1),
            name: names[names.length - 1],
            rank,
          }
        : { name: names[0] || "", rank };
    }),
  );
};

/** Formats franchise memberships for editing. @param {*} value Membership input. @returns {string} Formatted text. */
window.formatFranchiseMemberships = function (value) {
  return window
    .normalizeFranchiseMemberships(value)
    .map((entry) => {
      let chain = entry.parentChainNames?.length
        ? entry.parentChainNames.join(" > ")
        : "";
      return `${chain ? `${chain} > ` : ""}${entry.name}${entry.rank ? ` | ${entry.rank}` : ""}`;
    })
    .join("\n");
};

/** Calculates watched and known-film completion for a franchise. @param {FranchiseRecord} franchise Franchise. @returns {Object} Completion counts. */
window.franchiseCompletion = function (franchise) {
  let watchedCount = franchise?.films?.length || 0;
  let watchlistCount = franchise?.watchlistFilms?.length || 0;
  let total = watchedCount + watchlistCount;
  let percent = total ? Math.round((watchedCount / total) * 100) : 0;
  let nextEntry = (franchise?.watchlistFilms || [])[0] || null;
  let nextItem = nextEntry
    ? window.findWatchlistItemById?.(nextEntry.itemId)
    : null;
  return {
    watchedCount,
    watchlistCount,
    total,
    percent,
    nextEntry,
    nextItem,
  };
};

// The next few unwatched films in franchise order (authored rank first, then
// watchlist tier/order) — franchise pages show a short queue instead of a
// single pick (issue #17).
/** Returns the next ranked unwatched franchise items. @param {FranchiseRecord} franchise Franchise. @param {number} [limit] Maximum items. @returns {Object[]} Items. */
window.franchiseUpNext = function (franchise, limit = 3) {
  return (franchise?.watchlistFilms || [])
    .slice(0, Math.max(1, limit))
    .map((entry) => window.findWatchlistItemById?.(entry.itemId))
    .filter(Boolean);
};

// 1-indexed position of a film/watchlist item within a franchise's own
// (already fully rolled-up) films list — used to show a derived "this film
// is #N of everything under this franchise" rank at every level of a
// membership breadcrumb. The sheet only ever authors a rank at the one
// level a row was actually listed under, never for its ancestors, so
// ancestor-level ranks have to be computed from list position instead.
/** Finds a film's direct and inherited franchise position. @param {FranchiseRecord} franchise Franchise. @param {Object} [identity] Film identity. @returns {Object|null} Position. */
window.franchiseFilmPosition = function (
  franchise,
  { filmId = "", itemId = "" } = {},
) {
  if (filmId) {
    let index = (franchise?.films || []).findIndex(
      (entry) => entry.filmId === filmId,
    );
    if (index >= 0) return index + 1;
  }
  if (itemId) {
    let index = (franchise?.watchlistFilms || []).findIndex(
      (entry) => entry.itemId === itemId,
    );
    if (index >= 0) return index + 1;
  }
  return null;
};

/** Selects a representative watched or watchlist film. @param {FranchiseRecord} franchise Franchise. @returns {FilmAxisRecord|null} Representative. */
window.franchiseRepresentativeFilm = function (franchise) {
  let archiveEntries = (franchise?.films || [])
    .map((entry) => state.filmsById?.[entry.filmId])
    .filter(Boolean);
  let watchlistEntries = (franchise?.watchlistFilms || [])
    .map((entry) =>
      window.watchlistFilmLike?.(window.findWatchlistItemById?.(entry.itemId)),
    )
    .filter(Boolean);
  function posterReady(film) {
    return window.normalizePosterRecord?.(film?.poster);
  }
  function allTimeOrder(left, right) {
    let leftRank = Number(left.allTimeRank || 999999);
    let rightRank = Number(right.allTimeRank || 999999);
    return (
      leftRank - rightRank ||
      Number(left.year || 999999) - Number(right.year || 999999) ||
      window.compareEnglishTitles(left.title, right.title)
    );
  }
  function releaseOrder(left, right) {
    return (
      Number(left.year || 999999) - Number(right.year || 999999) ||
      window.compareEnglishTitles(left.title, right.title)
    );
  }
  let rankedWithPoster = archiveEntries
    .filter(posterReady)
    .sort(allTimeOrder)[0];
  if (rankedWithPoster) return rankedWithPoster;
  let firstWithPoster = [...archiveEntries]
    .filter(posterReady)
    .sort(releaseOrder)[0];
  if (firstWithPoster) return firstWithPoster;
  let watchlistWithPoster = watchlistEntries
    .filter(posterReady)
    .sort(releaseOrder)[0];
  if (watchlistWithPoster) return watchlistWithPoster;
  return (
    archiveEntries.sort(allTimeOrder)[0] ||
    watchlistEntries.sort(releaseOrder)[0] ||
    null
  );
};

/** Rebuilds direct and inherited franchise records. @returns {Record<string, FranchiseRecord>} Franchise index. */
window.rebuildFranchiseIndex = function () {
  let done = window.startOskarsPerformance?.("rebuildFranchiseIndex");
  let franchises = {};
  function ensure(id, name) {
    return (franchises[id] ||= {
      id,
      name: name || id,
      parentId: "",
      parentName: "",
      parentIds: [],
      parentNames: [],
      childIds: [],
      _films: new Map(),
      _watchlistFilms: new Map(),
      sourceUrl: state.franchiseLinks?.[id] || "",
    });
  }
  // Links one parent->child edge, creating the parent node if it doesn't
  // exist yet. Edge-building only — no film/watchlist rollup here, so this
  // is safe to call for both a membership's direct parent(s) (crossover-
  // capable) and every intermediate link in a deep parentChain.
  function linkParentChild(parentId, parentName, child) {
    if (!parentId || parentId === child.id) return;
    if (!child.parentIds.includes(parentId)) {
      child.parentIds.push(parentId);
      child.parentNames.push(parentName);
    }
    child.parentId ||= parentId;
    child.parentName ||= parentName;
    let parent = ensure(parentId, parentName);
    if (!parent.childIds.includes(child.id)) parent.childIds.push(child.id);
  }
  function addParent(franchise, membership) {
    let parentIds = membership.parentIds?.length
      ? membership.parentIds
      : membership.parentId
        ? [membership.parentId]
        : [];
    let parentNames = membership.parentNames?.length
      ? membership.parentNames
      : membership.parentName
        ? [membership.parentName]
        : [];
    parentIds.forEach((parentId, index) =>
      linkParentChild(parentId, parentNames[index] || parentId, franchise),
    );
    // Ancestor links above the direct parent (parentChain's last link *is*
    // the direct parent, already linked above) — each adjacent pair in the
    // chain becomes its own parent->child edge, however deep it goes.
    let chainIds = membership.parentChainIds || [];
    let chainNames = membership.parentChainNames || [];
    for (let i = 1; i < chainIds.length; i += 1) {
      linkParentChild(
        chainIds[i - 1],
        chainNames[i - 1],
        ensure(chainIds[i], chainNames[i]),
      );
    }
  }
  // Propagates one direct film/watchlist membership up through the full
  // ancestor graph (not just the immediate parent), so a mid-tier grouping
  // franchise like "Phase 1" rolls up credit all the way to "Marvel". Must
  // only run once every parent/child edge exists (see the two-pass split
  // below) — otherwise rollup silently misses ancestors whose edges haven't
  // been created yet, depending on which film happened to declare them.
  function rollUpToAncestors(start, filmOrItem, isWatchlist) {
    let visited = new Set([start.id]);
    let queue = [...start.parentIds];
    while (queue.length) {
      let parentId = queue.shift();
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      let parent = franchises[parentId];
      if (!parent) continue;
      if (isWatchlist) addWatchlistFilm(parent, filmOrItem, null, false);
      else addFilm(parent, filmOrItem, null, false);
      queue.push(...parent.parentIds);
    }
  }
  function addFilm(franchise, film, rank, direct) {
    let existing = franchise._films.get(film.id);
    if (!existing || (direct && !existing.direct)) {
      franchise._films.set(film.id, {
        filmId: film.id,
        rank: rank || null,
        direct: Boolean(direct),
      });
    } else if (direct && rank && !existing.rank) {
      existing.rank = rank;
    }
  }
  function addWatchlistFilm(franchise, item, rank, direct) {
    let id = item.id || window.watchlistItemId?.(item);
    if (!id) return;
    let existing = franchise._watchlistFilms.get(id);
    if (!existing || (direct && !existing.direct)) {
      franchise._watchlistFilms.set(id, {
        itemId: id,
        rank: rank || null,
        direct: Boolean(direct),
      });
    } else if (direct && rank && !existing.rank) {
      existing.rank = rank;
    }
  }

  let eligibleFilms = Object.values(state.filmsById || {}).filter((film) =>
    /^\d{4}$/.test(String(film.year || "")),
  );

  // Pass 1: create every franchise node, attach each film/item directly to
  // its own named franchise, and build every parent->child edge (direct
  // parent and full ancestor chain). No rollup yet — a later film in this
  // same pass might still be the one that establishes an edge higher up an
  // earlier film's ancestor chain, so rollup has to wait until every edge
  // in the whole graph exists (pass 2, below).
  eligibleFilms.forEach((film) => {
    film.franchises = window.normalizeFranchiseMemberships(film.franchises);
    film.franchises.forEach((membership) => {
      let franchise = ensure(membership.id, membership.name);
      addFilm(franchise, film, membership.rank, true);
      addParent(franchise, membership);
    });
  });

  (state.watchlist || []).forEach((item) => {
    item.id ||= window.watchlistItemId?.(item);
    item.franchises = window.normalizeFranchiseMemberships(item.franchises);
    item.franchises.forEach((membership) => {
      let franchise = ensure(membership.id, membership.name);
      addWatchlistFilm(franchise, item, membership.rank, true);
      addParent(franchise, membership);
    });
  });

  // Pass 2: every edge now exists, so roll each direct membership up
  // through its full (possibly multi-level) ancestor chain.
  eligibleFilms.forEach((film) => {
    (film.franchises || []).forEach((membership) => {
      let franchise = franchises[membership.id];
      if (franchise) rollUpToAncestors(franchise, film, false);
    });
  });

  (state.watchlist || []).forEach((item) => {
    (item.franchises || []).forEach((membership) => {
      let franchise = franchises[membership.id];
      if (franchise) rollUpToAncestors(franchise, item, true);
    });
  });

  Object.values(franchises).forEach((franchise) => {
    franchise.childIds.sort((left, right) =>
      franchises[left].name.localeCompare(franchises[right].name),
    );
    franchise.films = [...franchise._films.values()].sort((left, right) => {
      let leftFilm = state.filmsById[left.filmId];
      let rightFilm = state.filmsById[right.filmId];
      let leftRank = Number(leftFilm?.allTimeRank || 999999);
      let rightRank = Number(rightFilm?.allTimeRank || 999999);
      return (
        leftRank - rightRank ||
        Number(leftFilm?.year || 0) - Number(rightFilm?.year || 0) ||
        window.compareEnglishTitles(leftFilm?.title, rightFilm?.title)
      );
    });
    franchise.watchlistFilms = [...franchise._watchlistFilms.values()].sort(
      (left, right) => {
        let leftItem = window.findWatchlistItemById?.(left.itemId);
        let rightItem = window.findWatchlistItemById?.(right.itemId);
        let leftRank = Number(left.rank || 999999);
        let rightRank = Number(right.rank || 999999);
        return (
          leftRank - rightRank ||
          window.compareWatchlistItems?.(leftItem || {}, rightItem || {}) ||
          window.compareEnglishTitles(leftItem?.title, rightItem?.title)
        );
      },
    );
    franchise.ratingStatistics = window.collectionRatingStatistics(
      franchise.films
        .map((entry) => state.filmsById?.[entry.filmId])
        .filter(Boolean),
    );
    delete franchise._films;
    delete franchise._watchlistFilms;
  });
  state.franchisesById = franchises;
  state.franchiseIndexVersion = Number(state.aggregateVersion) || 0;
  done?.(`${Object.keys(franchises).length} franchises`);
  return franchises;
};

/** Returns the current franchise index, rebuilding when stale. @returns {Record<string, FranchiseRecord>} Franchise index. */
window.ensureFranchiseIndex = function () {
  let version = Number(state.aggregateVersion) || 0;
  if (state.franchiseIndexVersion === version && state.franchisesById)
    return state.franchisesById;
  return window.rebuildFranchiseIndex();
};
