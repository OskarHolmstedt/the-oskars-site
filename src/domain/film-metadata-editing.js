/** @file Applies film metadata and award-credit edits across source records. */

/** Finds an award on a film by category, placement, and period. @param {FilmRecord} film Film. @param {string} category Category. @param {number} placement Placement. @param {string} year Period key. @returns {AwardRecord|null} Award. */
window.findAwardOnFilm = function (film, category, placement, year) {
  if (!film) return null;
  return (film.awards || []).find(
    (award) =>
      award.category === category &&
      Number(award.placement) === Number(placement) &&
      (!year || !award.year || String(award.year) === String(year)),
  );
};

/** Finds every authoritative source record for a canonical film id. @param {string} id Film id. @returns {FilmRecord[]} Source films. */
window.findSourceFilmsById = function (id) {
  let matches = [];
  let seen = new Set();
  Object.entries(window.state.years || {}).forEach(([periodKey, period]) => {
    (period.films || []).forEach((film) => {
      if (
        window.filmMatchesId?.(film, id, {
          periodType: period.periodType,
          periodKey,
        }) &&
        !seen.has(film)
      ) {
        seen.add(film);
        matches.push(film);
      }
    });
  });
  (window.state.watchedOther || []).forEach((film) => {
    if (film.id === id && !seen.has(film)) {
      seen.add(film);
      matches.push(film);
    }
  });
  return matches;
};

/**
 * Builds the complete form-shaped metadata values for a film, matching the
 * shape `updateFilmMetadata` accepts, so callers can override individual
 * fields without dropping the rest.
 * @param {FilmRecord} film Film record.
 * @returns {Object} Full metadata values in edit-form shape.
 */
window.filmMetadataFormValues = function (film) {
  return {
    title: film.title || "",
    year: String(film.year || ""),
    director: film.director || "",
    rating: film.rating || "",
    country: film.country || "",
    primaryCountry: film.primaryCountry || "",
    url: film.url || "",
    medium: film.medium || "unknown",
    screenplayType: film.screenplayType || "unknown",
    adaptationSource: film.adaptationSource || "",
    franchises: window.formatFranchiseMemberships(film.franchises),
    tags: [...(film.tags || [])],
    review: film.review || "",
    wantToRewatch: Boolean(film.wantToRewatch),
    rewatchTier: film.rewatchTier || "",
    allTimeRank: film.allTimeRank || "",
    centuryRank: film.centuryRank || "",
    decadeRank: film.decadeRank || "",
    yearRank: film.yearRank || "",
    posterUrl: film.poster?.url || "",
  };
};

// Typed, form-shaped snapshot of the film fields whose edits are reversible
// (issue #132). Identity (title/year), ranks, and the poster record stay out:
// their restoration is not an unambiguous field write.
let FILM_UNDO_FIELD_LABELS = {
  director: "director",
  rating: "rating",
  country: "country",
  primaryCountry: "primary country",
  url: "url",
  medium: "medium",
  screenplayType: "screenplay type",
  adaptationSource: "adaptation source",
  review: "review",
  tags: "tags",
  franchises: "franchises",
  wantToRewatch: "rewatchlist",
  rewatchTier: "rewatch tier",
};

function filmUndoSnapshot(source) {
  let snapshot = {};
  Object.keys(FILM_UNDO_FIELD_LABELS).forEach((key) => {
    snapshot[key] =
      key === "wantToRewatch"
        ? Boolean(source.wantToRewatch)
        : key === "tags"
        ? [...(source.tags || [])]
        : key === "franchises"
          ? window.formatFranchiseMemberships(source.franchises)
          : String(source[key] ?? "").trim();
  });
  return snapshot;
}

/** Updates metadata on every source copy of a film. @param {string} id Film id. @param {Object} values Metadata values. @param {Object} [options] Logging options. @returns {FilmRecord|null} Updated canonical film. */
window.updateFilmMetadata = function (id, values, options = {}) {
  let film = window.findFilmById(id) || window.findWatchedFilmById?.(id);
  if (!film) throw new Error("Film not found.");
  let beforeLog = {
    title: film.title,
    year: film.year,
    director: film.director,
    rating: film.rating,
    country: film.country,
    primaryCountry: film.primaryCountry,
    url: film.url,
    medium: film.medium,
    screenplayType: film.screenplayType,
    adaptationSource: film.adaptationSource,
    franchises: film.franchises,
    tags: film.tags,
    review: film.review,
    wantToRewatch: Boolean(film.wantToRewatch),
    rewatchTier: film.rewatchTier || "",
    allTimeRank: film.allTimeRank,
    centuryRank: film.centuryRank,
    decadeRank: film.decadeRank,
    yearRank: film.yearRank,
    posterUrl: film.poster?.url || "",
  };
  let title = String(values.title || "").trim();
  let year = String(values.year || "").trim();
  if (!title) throw new Error("Title is required.");
  if (!/^\d{4}$/.test(year)) throw new Error("Year must contain four digits.");
  let nextId = window.makeFilmId(year, title);
  let duplicate = Object.values(state.filmsById || {}).find(
    (candidate) => candidate.id !== film.id && candidate.id === nextId,
  );
  if (duplicate)
    throw new Error(`${duplicate.title} (${year}) already exists.`);

  let posterUrl = String(values.posterUrl || "").trim();
  if (posterUrl && !/^https?:\/\//i.test(posterUrl))
    throw new Error("Poster URL must use HTTP or HTTPS.");
  let sources = window.findSourceFilmsById(id);
  if (!sources.length) sources = [film];
  let directors = window.splitRecipientNames(values.director);
  let rankFields = ["allTimeRank", "centuryRank", "decadeRank", "yearRank"];

  sources.forEach((source) => {
    let sourceUsesActualYear = /^\d{4}$/.test(String(source.year || ""));
    source.title = title;
    source.normalizedTitle = window.normalizeTitle(title);
    if (sourceUsesActualYear) source.year = year;
    source.id = window.makeFilmId(
      sourceUsesActualYear ? year : source.year,
      title,
    );
    source.director = String(values.director || "").trim();
    source.directors = directors;
    // Drop the parsed rating fields so normalizeFilmMetadata re-derives them
    // from the new text; a stale ratingValue would otherwise overwrite it.
    source.rating = String(values.rating || "").trim();
    delete source.ratingValue;
    delete source.ratingModifier;
    source.country = String(values.country || "").trim();
    source.primaryCountry = String(values.primaryCountry || "").trim();
    source.url = String(values.url || "").trim();
    source.medium = values.medium || "unknown";
    source.screenplayType = values.screenplayType || "unknown";
    source.adaptationSource =
      source.screenplayType === "original"
        ? ""
        : window.normalizeAdaptationSource(values.adaptationSource);
    source.franchises = window.parseFranchiseMemberships(values.franchises);
    source.tags = window.parseFilmTags(
      values.tags === undefined ? source.tags : values.tags,
    );
    source.review =
      values.review === undefined
        ? String(source.review || "").trim()
        : String(values.review || "").trim();
    if (values.wantToRewatch === true || values.wantToRewatch === "on")
      source.wantToRewatch = true;
    else delete source.wantToRewatch;
    source.rewatchTier = source.wantToRewatch
      ? window.normalizeWatchlistTier(values.rewatchTier)
      : "";
    source.liveAction =
      source.medium === "animation"
        ? "Animation"
        : source.medium === "live-action"
          ? "Live action"
          : source.medium === "hybrid"
            ? "Hybrid"
            : "";
    source.adaptation =
      source.screenplayType === "original"
        ? "Original"
        : source.screenplayType === "adapted"
          ? "Adapted"
          : "";
    rankFields.forEach((field) => {
      let rank = Number(values[field]);
      source[field] = Number.isInteger(rank) && rank > 0 ? rank : null;
    });
    if (!posterUrl) delete source.poster;
    else if (source.poster?.url !== posterUrl) {
      source.poster = {
        url: posterUrl,
        source: "manual",
        sourceUrl: "",
        fetchedAt: new Date().toISOString(),
      };
    }
    window.normalizeFilmMetadata(source);
  });

  window.markAggregatesDirty?.("film metadata updated");
  window.ensureAggregatesFresh?.();
  let updatedFilm =
    window.findFilmById(nextId) ||
    window.findWatchedFilmById?.(nextId) ||
    Object.values(state.filmsById || {}).find(
      (candidate) =>
        candidate.normalizedTitle === window.normalizeTitle(title) &&
        String(candidate.year) === year,
    );
  if (options.log !== false && updatedFilm && window.recordEdit) {
    let afterLog = {
      title: updatedFilm.title,
      year: updatedFilm.year,
      director: updatedFilm.director,
      rating: updatedFilm.rating,
      country: updatedFilm.country,
      primaryCountry: updatedFilm.primaryCountry,
      url: updatedFilm.url,
      medium: updatedFilm.medium,
      screenplayType: updatedFilm.screenplayType,
      adaptationSource: updatedFilm.adaptationSource,
      franchises: updatedFilm.franchises,
      tags: updatedFilm.tags,
      review: updatedFilm.review,
      wantToRewatch: Boolean(updatedFilm.wantToRewatch),
      rewatchTier: updatedFilm.rewatchTier || "",
      allTimeRank: updatedFilm.allTimeRank,
      centuryRank: updatedFilm.centuryRank,
      decadeRank: updatedFilm.decadeRank,
      yearRank: updatedFilm.yearRank,
      posterUrl: updatedFilm.poster?.url || "",
    };
    let changes = window.editLogChanges(beforeLog, afterLog, [
      "title",
      "year",
      "director",
      "rating",
      "country",
      { key: "primaryCountry", label: "primary country" },
      "url",
      { key: "medium", label: "medium" },
      { key: "screenplayType", label: "screenplay type" },
      { key: "adaptationSource", label: "adaptation source" },
      "franchises",
      "tags",
      "review",
      { key: "wantToRewatch", label: "rewatchlist" },
      { key: "rewatchTier", label: "rewatch tier" },
      { key: "allTimeRank", label: "all-time rank" },
      { key: "centuryRank", label: "century rank" },
      { key: "decadeRank", label: "decade rank" },
      { key: "yearRank", label: "year rank" },
      { key: "posterUrl", label: "poster URL" },
    ]);
    if (changes.length) {
      // Reversible payload (issue #132): only when the film kept its
      // identity and every changed field is a supported typed field - a
      // partial undo would silently keep part of the edit.
      let undoBefore = filmUndoSnapshot(beforeLog);
      let undoAfter = filmUndoSnapshot(updatedFilm);
      let undoFields = Object.keys(FILM_UNDO_FIELD_LABELS)
        .filter(
          (key) =>
            JSON.stringify(undoBefore[key]) !== JSON.stringify(undoAfter[key]),
        )
        .map((key) => ({
          key,
          label: FILM_UNDO_FIELD_LABELS[key],
          before: undoBefore[key],
          after: undoAfter[key],
        }));
      window.recordEdit({
        type: "film metadata",
        summary: `${beforeLog.title || updatedFilm.title} (${beforeLog.year || updatedFilm.year || ""})`,
        sheetHint: "Film metadata / ranked list rows",
        changes,
        undo:
          updatedFilm.id === id &&
          undoFields.length &&
          undoFields.length === changes.length
            ? {
                version: 1,
                kind: "film-metadata",
                target: { filmId: updatedFilm.id },
                fields: undoFields,
              }
            : null,
        context: { filmId: updatedFilm.id, previousFilmId: id },
      });
    }
  }
  return updatedFilm;
};

/** Updates award recipients across source copies after validation. @param {string} filmId Film id. @param {string} category Category. @param {number} placement Placement. @param {string} year Period key. @param {*} value Recipients. @returns {boolean} Whether updated. */
window.updateAwardRecipient = function (
  filmId,
  category,
  placement,
  year,
  value,
) {
  let sources = window.findSourceFilmsById(filmId);
  let canonical = window.findFilmById(filmId);
  let currentAward = window.findAwardOnFilm(
    canonical,
    category,
    placement,
    year,
  );
  if (!currentAward) return false;
  let candidate = window.cloneRecord(currentAward);
  let beforeText = window.awardRecipientText(currentAward);
  window.setAwardRecipients(candidate, value);
  let validation = window.validateAward(canonical, candidate, {
    periodType: window.getAwardPeriodType(candidate),
  });
  window.lastRuleViolation = validation;
  if (!validation.valid) return false;
  let changed = false;
  sources.forEach((film) => {
    let award = window.findAwardOnFilm(film, category, placement, year);
    if (!award) return;
    window.setAwardRecipients(award, value);
    changed = true;
  });
  if (!changed) return false;
  window.markAggregatesDirty?.("award recipients updated");
  window.ensureAggregatesFresh?.();
  let afterText = window.awardRecipientText(candidate);
  if (beforeText !== afterText && window.recordEdit) {
    window.recordEdit({
      type: "award credit",
      summary: `${canonical.title} (${year}) · ${category} #${placement}`,
      sheetHint: `${year} / ${category} recipients`,
      changes: [{ field: "recipients", before: beforeText, after: afterText }],
      context: { filmId, period: year, category, placement },
    });
  }
  return true;
};

/** Updates award detail across source copies. @param {string} filmId Film id. @param {string} category Category. @param {number} placement Placement. @param {string} year Period key. @param {*} value Detail. @returns {boolean} Whether updated. */
window.updateAwardDetail = function (filmId, category, placement, year, value) {
  let changed = false;
  let canonical = window.findFilmById(filmId);
  let currentAward = window.findAwardOnFilm(
    canonical,
    category,
    placement,
    year,
  );
  let beforeDetail = window.awardDetail(currentAward);
  let afterDetail = String(value || "").trim();
  window.findSourceFilmsById(filmId).forEach((film) => {
    let award = window.findAwardOnFilm(film, category, placement, year);
    if (!award) return;
    award.detail = String(value || "").trim();
    delete award.role;
    changed = true;
  });
  if (!changed) return false;
  window.markAggregatesDirty?.("award detail updated");
  window.ensureAggregatesFresh?.();
  if (beforeDetail !== afterDetail && window.recordEdit) {
    window.recordEdit({
      type: "award detail",
      summary: `${canonical?.title || "Film"} (${year}) · ${category} #${placement}`,
      sheetHint: `${year} / ${category} detail`,
      changes: [{ field: "detail", before: beforeDetail, after: afterDetail }],
      context: { filmId, period: year, category, placement },
    });
  }
  return true;
};

