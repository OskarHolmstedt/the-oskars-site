/**
 * @file Owns the private blind opinion-rebuild baseline, lifecycle, and
 * old-versus-current comparison model used by the Data workspace.
 */

window.OSKARS_OPINION_REBUILD_SCHEMA_VERSION = 1;

const OPINION_REBUILD_FILM_FIELDS = [
  "awards",
  "rating",
  "ratingValue",
  "ratingModifier",
  "rank",
  "yearRank",
  "decadeRank",
  "centuryRank",
  "allTimeRank",
  "suppressAllTimeRank",
  "rankingGroupId",
  "rankingGroupTitle",
  "rankConfirmed",
  "review",
  "wantToRewatch",
  "rewatchTier",
  "musicScore",
  "musicRating",
  "musicRatingValue",
];

function opinionRebuildClone(value) {
  return window.cloneRecord(value);
}

function opinionRebuildKey(record) {
  let id = String(record?.id || "").trim();
  if (id) return id;
  let title = String(record?.normalizedTitle || record?.title || "")
    .trim()
    .toLowerCase();
  return title ? `${String(record?.year || "")}::${title}` : "";
}

function opinionRebuildPresentFields(record, fields) {
  let snapshot = {};
  fields.forEach((field) => {
    if (
      Object.prototype.hasOwnProperty.call(record || {}, field) &&
      record[field] !== undefined
    )
      snapshot[field] = opinionRebuildClone(record[field]);
  });
  let franchiseRanks = {};
  (record?.franchises || []).forEach((membership) => {
    let key = String(membership?.id || membership?.name || "").trim();
    if (key && membership?.rank != null) franchiseRanks[key] = membership.rank;
  });
  if (Object.keys(franchiseRanks).length) snapshot.franchiseRanks = franchiseRanks;
  return snapshot;
}

function opinionRebuildMergeSnapshot(target, source) {
  Object.keys(source || {}).forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(target, field))
      target[field] = source[field];
  });
  return target;
}

function opinionRebuildFilmSnapshots(source) {
  let snapshots = {};
  Object.values(source?.years || {}).forEach((period) => {
    (period?.films || []).forEach((film) => {
      let key = opinionRebuildKey(film);
      if (!key) return;
      snapshots[key] ||= {};
      opinionRebuildMergeSnapshot(
        snapshots[key],
        opinionRebuildPresentFields(film, OPINION_REBUILD_FILM_FIELDS),
      );
    });
  });
  return snapshots;
}

function opinionRebuildWatchlistSnapshots(source) {
  let snapshots = {};
  (source?.watchlist || []).forEach((item) => {
    let key = opinionRebuildKey(item);
    if (!key) return;
    snapshots[key] = opinionRebuildPresentFields(item, ["tier", "order"]);
  });
  return snapshots;
}

function opinionRebuildWatchedOtherSnapshots(source) {
  let snapshots = {};
  (source?.watchedOther || []).forEach((item) => {
    let key = opinionRebuildKey(item);
    if (!key) return;
    snapshots[key] = opinionRebuildPresentFields(item, [
      "rating",
      "ratingValue",
      "wantToRewatch",
      "rewatchTier",
    ]);
  });
  return snapshots;
}

/**
 * Captures the opinion fields removed by `clearOpinionData` without copying
 * factual film, watch, credit, metadata, or project data.
 * @param {OskarsState|Object} [source] Runtime state.
 * @param {string} [startedAt] ISO start time.
 * @returns {Object} Versioned private baseline.
 */
window.captureOpinionRebuildBaseline = function (
  source = window.state,
  startedAt = new Date().toISOString(),
) {
  return {
    schemaVersion: window.OSKARS_OPINION_REBUILD_SCHEMA_VERSION,
    status: "active",
    startedAt,
    films: opinionRebuildFilmSnapshots(source),
    watchlist: opinionRebuildWatchlistSnapshots(source),
    watchedOther: opinionRebuildWatchedOtherSnapshots(source),
    entityNotes: opinionRebuildClone(source.entityNotes || {}),
    localRanks: opinionRebuildClone(source.localRanks || {}),
    rankingReviews: opinionRebuildClone(source.rankingReviews || {}),
    awardReviews: opinionRebuildClone(source.awardReviews || {}),
    sourceConflicts: opinionRebuildClone(source.sourceConflicts || []),
  };
};

function opinionRebuildApplyFields(record, snapshot, fields) {
  fields.forEach((field) => delete record[field]);
  Object.entries(snapshot || {}).forEach(([field, value]) => {
    if (fields.includes(field)) record[field] = opinionRebuildClone(value);
  });
  let ranks = snapshot?.franchiseRanks || {};
  (record.franchises || []).forEach((membership) => {
    delete membership.rank;
    let key = String(membership?.id || membership?.name || "").trim();
    if (Object.prototype.hasOwnProperty.call(ranks, key)) membership.rank = ranks[key];
  });
}

function opinionRebuildApplyMap(records, snapshots, fields) {
  (records || []).forEach((record) => {
    let snapshot = snapshots?.[opinionRebuildKey(record)];
    opinionRebuildApplyFields(record, snapshot || {}, fields);
  });
}

/**
 * Starts one blind rebuild by retaining the current opinion layer and clearing
 * the active layer used by every ordinary app surface.
 * @param {string} [startedAt] ISO start time.
 * @returns {{ok: boolean, reason?: string, baseline?: Object, cleared?: Object}}
 */
window.startOpinionRebuild = function (startedAt) {
  if (window.state.opinionRebuildSession)
    return { ok: false, reason: "A blind rebuild is already active." };
  let baseline = window.captureOpinionRebuildBaseline(window.state, startedAt);
  window.state.opinionRebuildSession = baseline;
  let cleared = window.clearOpinionData();
  return { ok: true, baseline, cleared };
};

/**
 * Cancels the active rebuild, restoring captured opinions onto the current
 * factual records and leaving factual changes made during the rebuild intact.
 * @returns {{ok: boolean, reason?: string}}
 */
window.restoreOpinionRebuildBaseline = function () {
  let baseline = window.state.opinionRebuildSession;
  if (!baseline)
    return { ok: false, reason: "No blind rebuild is active." };
  window.clearOpinionData();
  Object.values(window.state.years || {}).forEach((period) =>
    opinionRebuildApplyMap(
      period?.films,
      baseline.films,
      OPINION_REBUILD_FILM_FIELDS,
    ),
  );
  opinionRebuildApplyMap(window.state.watchlist, baseline.watchlist, [
    "tier",
    "order",
  ]);
  opinionRebuildApplyMap(window.state.watchedOther, baseline.watchedOther, [
    "rating",
    "ratingValue",
    "wantToRewatch",
    "rewatchTier",
  ]);
  window.state.entityNotes = opinionRebuildClone(baseline.entityNotes || {});
  window.state.localRanks = opinionRebuildClone(baseline.localRanks || {});
  window.state.rankingReviews = opinionRebuildClone(baseline.rankingReviews || {});
  window.state.awardReviews = opinionRebuildClone(baseline.awardReviews || {});
  window.state.sourceConflicts = opinionRebuildClone(baseline.sourceConflicts || []);
  window.state.opinionRebuildSession = null;
  window.recomputeWatchlistOrder?.();
  window.rebuildAggregates?.();
  return { ok: true };
};

/**
 * Finishes the active rebuild by keeping current opinions and retaining the
 * private baseline as a completed comparison.
 * @returns {{ok: boolean, reason?: string}}
 */
window.finishOpinionRebuild = function (finishedAt = new Date().toISOString()) {
  if (!window.state.opinionRebuildSession)
    return { ok: false, reason: "No blind rebuild is active." };
  if (window.state.opinionRebuildSession.status === "complete")
    return { ok: false, reason: "The blind rebuild is already complete." };
  window.state.opinionRebuildSession.status = "complete";
  window.state.opinionRebuildSession.finishedAt = finishedAt;
  return { ok: true };
};

/**
 * Closes a completed comparison by discarding its private baseline while
 * retaining the rebuilt active opinions.
 * @returns {{ok: boolean, reason?: string}}
 */
window.discardOpinionRebuildBaseline = function () {
  if (window.state.opinionRebuildSession?.status !== "complete")
    return { ok: false, reason: "Finish the blind rebuild before closing it." };
  window.state.opinionRebuildSession = null;
  return { ok: true };
};

function opinionRebuildCurrentFilms(source) {
  let current = {};
  Object.values(source?.years || {}).forEach((period) => {
    (period?.films || []).forEach((film) => {
      let key = opinionRebuildKey(film);
      if (key && !current[key]) current[key] = film;
    });
  });
  return current;
}

function opinionRebuildAwards(films, titleSource = films) {
  let records = new Map();
  Object.entries(films || {}).forEach(([filmId, film]) => {
    (film?.awards || []).forEach((award) => {
      let key = [
        award.periodType,
        award.year,
        award.category,
        Number(award.placement),
        filmId,
      ].join("\n");
      records.set(key, {
        filmId,
        title: titleSource?.[filmId]?.title || film.title || filmId,
        periodType: award.periodType || "",
        year: award.year || "",
        category: award.category || "",
        placement: Number(award.placement) || 0,
      });
    });
  });
  return records;
}

/**
 * Builds the explicit reveal model comparing an active rebuild with its
 * captured baseline.
 * @param {OskarsState|Object} [source] Runtime state.
 * @returns {Object|null} Comparison, or null when no rebuild is active.
 */
window.compareOpinionRebuild = function (source = window.state) {
  let baseline = source.opinionRebuildSession;
  if (!baseline) return null;
  let current = opinionRebuildCurrentFilms(source);
  let filmIds = new Set([
    ...Object.keys(baseline.films || {}),
    ...Object.keys(current),
  ]);
  let ratingRows = [];
  let rankRows = [];
  let baselineRated = 0;
  let currentRated = 0;
  let rankFields = ["yearRank", "decadeRank", "centuryRank", "allTimeRank"];
  filmIds.forEach((filmId) => {
    let oldFilm = baseline.films?.[filmId] || {};
    let newFilm = current[filmId] || {};
    let title = newFilm.title || oldFilm.title || filmId;
    let oldRating = Number(oldFilm.ratingValue) || 0;
    let newRating = Number(newFilm.ratingValue) || 0;
    if (oldRating) baselineRated += 1;
    if (newRating) currentRated += 1;
    if (oldRating && newRating)
      ratingRows.push({
        filmId,
        title,
        before: oldRating,
        after: newRating,
        delta: newRating - oldRating,
      });
    if (newFilm.rankConfirmed === false) return;
    rankFields.forEach((field) => {
      let before = Number(oldFilm[field]) || 0;
      let after = Number(newFilm[field]) || 0;
      if (before && after)
        rankRows.push({
          filmId,
          title,
          scope: field.replace("Rank", "").replace("allTime", "all-time"),
          before,
          after,
          delta: after - before,
        });
    });
  });
  ratingRows.sort(
    (left, right) =>
      Math.abs(right.delta) - Math.abs(left.delta) ||
      left.title.localeCompare(right.title),
  );
  rankRows.sort(
    (left, right) =>
      Math.abs(right.delta) - Math.abs(left.delta) ||
      left.title.localeCompare(right.title),
  );
  let baselineAwards = opinionRebuildAwards(baseline.films, current);
  let currentAwards = opinionRebuildAwards(current);
  let awardRows = [];
  new Set([...baselineAwards.keys(), ...currentAwards.keys()]).forEach((key) => {
    let before = baselineAwards.get(key) || null;
    let after = currentAwards.get(key) || null;
    if (!before || !after) awardRows.push({ before, after });
  });
  return {
    status: baseline.status || "active",
    startedAt: baseline.startedAt || "",
    finishedAt: baseline.finishedAt || "",
    filmCount: filmIds.size,
    baselineRated,
    currentRated,
    comparedRatings: ratingRows.length,
    unchangedRatings: ratingRows.filter((row) => row.delta === 0).length,
    ratingRows,
    comparedRanks: rankRows.length,
    unchangedRanks: rankRows.filter((row) => row.delta === 0).length,
    rankRows,
    baselineAwardCount: baselineAwards.size,
    currentAwardCount: currentAwards.size,
    awardRows,
  };
};
