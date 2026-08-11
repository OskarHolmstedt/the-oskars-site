/** @file Derives a small, reasoned pick from a filtered watchlist subset — the shared "choose what's next" operation behind the Discover picker, double features, and the temporary queue (issue #159). */

/**
 * @typedef {Object} WatchQueueReason
 * @property {'director-completion'|'franchise-completion'|'tag-match'|'highest-tier'|'random'} type
 *   Closed vocabulary so every caller renders the reason the same way.
 * @property {Object} params Template values for the reason's display text
 *   (`name`, `tag`, or `tier`, depending on `type`). Left as structured data
 *   rather than a formatted sentence so callers can localize it with `ui()`.
 */

/**
 * @typedef {Object} WatchQueuePick
 * @property {WatchlistItem} item
 * @property {WatchQueueReason} reason
 */

/**
 * @typedef {Object} WatchQueuePairing
 * @property {'collaboration'|'similarity-franchise'|'similarity-tag'|'historical-context'|'contrast'|'unrelated'} type
 *   Closed vocabulary, checked in this priority order. `unrelated` is an
 *   honest outcome, not a bug - the two picks just share no signal available
 *   on `WatchlistItem` today.
 * @property {Object} params Template values for the pairing's display text
 *   (`name`, `tag`, `decade`, `mediumA`/`mediumB`, depending on `type`).
 */

/**
 * @typedef {Object} WatchQueueDoubleFeature
 * @property {WatchQueuePick} anchor First pick, with its own stated reason.
 * @property {WatchlistItem} partner Second film, chosen for its relationship to the anchor.
 * @property {WatchQueuePairing} pairing How the two relate.
 */

(function () {
  /**
   * Lists watchlist items matching the shared film-filter vocabulary
   * (period, tier, director, franchise, tag, rating, ...).
   * @param {Record<string, import('../domain/film-filters.js').FilmFilterValue>} [filters]
   * @param {Record<string, Object>} [options] Per-filter predicate context,
   *   forwarded to `filmMatchesFilters` (e.g. `{period: {alltimeMatchesAll: true}}`
   *   since watchlist items never carry an all-time rank).
   * @returns {WatchlistItem[]}
   */
  window.watchQueueCandidates = function (filters = {}, options = {}) {
    return (state.watchlist || []).filter((item) =>
      window.filmMatchesFilters(item, filters, options),
    );
  };

  // "Closest to finishing this director": the one watchlist item left for a
  // director whose other films are already watched. Checked against the
  // whole watchlist, not just the current candidate set, so the signal holds
  // even under a narrow filter.
  function directorReason(item) {
    let name = item?.director;
    if (!name) return null;
    let siblings = window.watchlistItemsByDirector?.(name) || [];
    if (
      siblings.length !== 1 ||
      window.watchlistItemId(siblings[0]) !== window.watchlistItemId(item)
    )
      return null;
    let canonicalId = window.normalizePersonName?.(name);
    let canonicalName = state.peopleAliases?.[canonicalId] || name;
    let person = (window.ensurePeopleIndex?.() || state.peopleById || {})[
      window.normalizePersonName?.(canonicalName)
    ];
    if (!person || !window.directorCompletion?.(person)?.watchedCount)
      return null;
    return {
      type: "director-completion",
      params: { name: person.name },
    };
  }

  // Same idea as directorReason, but for a franchise the item belongs to.
  function franchiseReason(item) {
    let franchisesById =
      window.ensureFranchiseIndex?.() || state.franchisesById || {};
    let memberships =
      window.normalizeFranchiseMemberships?.(item?.franchises) || [];
    for (let membership of memberships) {
      let franchise = franchisesById[membership.id];
      let completion = franchise && window.franchiseCompletion?.(franchise);
      if (
        completion?.watchlistCount === 1 &&
        completion.watchedCount > 0 &&
        completion.nextItem &&
        window.watchlistItemId(completion.nextItem) ===
          window.watchlistItemId(item)
      ) {
        return {
          type: "franchise-completion",
          params: { name: franchise.name },
        };
      }
    }
    return null;
  }

  function tagReason(item, tag) {
    if (!tag || !(item?.tags || []).includes(tag)) return null;
    return { type: "tag-match", params: { tag } };
  }

  // Reasons are checked in tier order so that among several candidates
  // carrying the same signal, the better-tiered one wins.
  function pickOne(candidates, options) {
    if (!candidates.length) return null;
    let sorted = [...candidates].sort(window.compareWatchlistItems);
    for (let item of sorted) {
      let reason =
        directorReason(item) ||
        franchiseReason(item) ||
        tagReason(item, options.tag);
      if (reason) return { item, reason };
    }
    let topTier = window.watchlistTierRank(sorted[0].tier);
    let tied = sorted.filter(
      (item) => window.watchlistTierRank(item.tier) === topTier,
    );
    if (tied.length === 1) {
      return {
        item: tied[0],
        reason: {
          type: "highest-tier",
          params: { tier: tied[0].tier || "" },
        },
      };
    }
    let seed = options.seed || window.freshShuffleSeed();
    let chosen = [...tied].sort((left, right) =>
      window.compareBySeededShuffle(
        window.watchlistItemId(left),
        window.watchlistItemId(right),
        seed,
      ),
    )[0];
    return {
      item: chosen,
      reason: {
        type: "random",
        params: { tier: chosen.tier || "" },
      },
    };
  }

  /**
   * Picks up to `count` items from an already-filtered watchlist candidate
   * set, each with a stated reason, without repeating an item. Backs a
   * single "watch tonight" suggestion (`count` omitted) and a small
   * disposable queue (`count` > 1). A double feature (`pickWatchQueueDoubleFeature`)
   * needs a stated relationship *between* the two picks, not just two
   * independent ones, so it builds on this rather than just calling it with
   * `count: 2`.
   * @param {WatchlistItem[]} candidates Already-filtered candidates (see `watchQueueCandidates`).
   * @param {Object} [options]
   * @param {number} [options.count=1] Number of items to pick.
   * @param {string} [options.tag] Preferred tag; boosts a matching item.
   * @param {string} [options.seed] Deterministic tiebreak seed; a fresh one
   *   is generated per call otherwise, so repeated picks vary.
   * @returns {WatchQueuePick[]} Picks in chosen order; shorter than `count`
   *   when the candidate set runs out.
   */
  window.pickWatchQueueItems = function (candidates, options = {}) {
    let count = Math.max(1, Number(options.count) || 1);
    let pool = (candidates || []).slice();
    let picks = [];
    while (picks.length < count && pool.length) {
      let pick = pickOne(pool, options);
      if (!pick) break;
      picks.push(pick);
      let pickedId = window.watchlistItemId(pick.item);
      pool = pool.filter((item) => window.watchlistItemId(item) !== pickedId);
    }
    return picks;
  };

  // Checked in priority order; the first that holds wins. Only signals
  // already on WatchlistItem (director, franchises, tags, year, medium) are
  // used - no new data modeled for this.
  function pairingSignal(anchorItem, candidate) {
    if (
      anchorItem.director &&
      window.normalizePersonName(anchorItem.director) ===
        window.normalizePersonName(candidate.director)
    )
      return { type: "collaboration", params: { name: anchorItem.director } };
    let anchorFranchiseIds = new Set(
      (window.normalizeFranchiseMemberships?.(anchorItem.franchises) || []).map(
        (membership) => membership.id,
      ),
    );
    let sharedFranchise = (
      window.normalizeFranchiseMemberships?.(candidate.franchises) || []
    ).find((membership) => anchorFranchiseIds.has(membership.id));
    if (sharedFranchise)
      return {
        type: "similarity-franchise",
        params: { name: sharedFranchise.name },
      };
    let sharedTag = (anchorItem.tags || []).find((tag) =>
      (candidate.tags || []).includes(tag),
    );
    if (sharedTag) return { type: "similarity-tag", params: { tag: sharedTag } };
    let anchorDecade = window.getDecadeKey?.(anchorItem.year);
    if (anchorDecade && anchorDecade === window.getDecadeKey?.(candidate.year))
      return { type: "historical-context", params: { decade: anchorDecade } };
    if (
      anchorItem.medium &&
      candidate.medium &&
      anchorItem.medium !== candidate.medium
    )
      return {
        type: "contrast",
        params: { mediumA: anchorItem.medium, mediumB: candidate.medium },
      };
    return { type: "unrelated", params: {} };
  }

  /**
   * Picks a double feature: one anchor film (via the same reasoning as
   * `pickWatchQueueItems`) plus a second film chosen for how it relates to
   * the anchor - collaboration, franchise/tag similarity, historical
   * context, or medium contrast, checked in that order. Falls back to the
   * next-best-tiered remaining candidate (pairing type `unrelated`) when
   * nothing connects them, rather than fabricating a reason.
   * @param {WatchlistItem[]} candidates Already-filtered candidates (see `watchQueueCandidates`).
   * @param {Object} [options] Forwarded to the anchor pick (see `pickWatchQueueItems`).
   * @returns {WatchQueueDoubleFeature|null} `null` when fewer than two candidates are available.
   */
  window.pickWatchQueueDoubleFeature = function (candidates, options = {}) {
    let anchorPicks = window.pickWatchQueueItems(
      candidates,
      Object.assign({}, options, { count: 1 }),
    );
    if (!anchorPicks.length) return null;
    let anchor = anchorPicks[0];
    let anchorId = window.watchlistItemId(anchor.item);
    let remaining = (candidates || []).filter(
      (item) => window.watchlistItemId(item) !== anchorId,
    );
    if (!remaining.length) return null;
    let sorted = [...remaining].sort(window.compareWatchlistItems);
    let partner =
      sorted.find(
        (candidate) => pairingSignal(anchor.item, candidate).type !== "unrelated",
      ) || sorted[0];
    return { anchor, partner, pairing: pairingSignal(anchor.item, partner) };
  };
})();
