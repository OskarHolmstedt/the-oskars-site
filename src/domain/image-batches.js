/**
 * @file Runs bounded metadata, poster, portrait, and TMDB media-type batches with session retry tracking.
 */

let filmMetadataLookupAttempts = new Set();
let posterLookupAttempts = new Set();
let portraitLookupAttempts = new Set();

// Session-level failed-lookup registry (issue #44): every metadata, poster,
// and portrait batch records its failures here - keyed by batch type - so
// Data Health can show visible retry queues for the current session instead
// of only the last batch's report. A later success clears the item's entry.
// Session-only; nothing is persisted. This file loads before watchlists.js
// on every page, so the watchlist fetchers there can rely on these helpers.
window.metadataSessionFailures = {};

/** Records one failed lookup for a session queue. @param {string} type Queue type. @param {Object} record Failure. */
window.recordMetadataSessionFailure = function (type, record) {
  if (!record?.id) return;
  let bucket = (window.metadataSessionFailures[type] ||= new Map());
  bucket.set(String(record.id), record);
};

/** Clears one recorded session failure. @param {string} type Queue type. @param {string} id Item id. */
window.clearMetadataSessionFailure = function (type, id) {
  window.metadataSessionFailures[type]?.delete(String(id));
};

/** Returns failures for a session queue. @param {string} type Queue type. @returns {Object[]} Failures. */
window.metadataSessionFailureList = function (type) {
  return [...(window.metadataSessionFailures[type]?.values() || [])];
};

/** Returns attempted items for a session queue. @param {string} type Queue type. @returns {number} Attempt count. */
window.metadataSessionAttemptCount = function (type) {
  if (type === "film-metadata") return filmMetadataLookupAttempts.size;
  if (type === "film-posters") return posterLookupAttempts.size;
  if (type === "person-portraits") return portraitLookupAttempts.size;
  return window.watchlistSessionAttemptCount?.(type) || 0;
};

/** Tests whether a film lacks fetchable TMDB metadata. @param {FilmRecord} film Film. @returns {boolean} Whether lookup is needed. */
window.filmNeedsMetadataLookup = function (film) {
  return (
    Boolean(film?.id && film.title) &&
    (!film.tmdbId ||
      !film.director ||
      !film.country ||
      !film.runtimeMinutes)
  );
};

function lookupItemLabel(item) {
  return String(item?.title || item?.name || item?.id || "Unknown item");
}

function lookupFailureRecord(item, reason) {
  return {
    title: lookupItemLabel(item),
    year: item?.year || "",
    id: item?.id || "",
    reason: String(reason || "No match found."),
  };
}

/** Fetches bounded film metadata concurrently. @param {FilmRecord[]} films Films. @param {Object} [options] Batch controls. @returns {Promise<MetadataBatchResult>} Batch result. */
window.fetchFilmMetadata = async function (films, options = {}) {
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  let seen = new Set();
  let limit = Math.max(1, Number(options.limit) || 25);
  let skippedItems = [];
  let eligible = settings.tmdbCredential
    ? (films || []).filter((film) => {
        if (!window.filmNeedsMetadataLookup(film) || seen.has(film.id))
          return false;
        seen.add(film.id);
        if (!options.force && filmMetadataLookupAttempts.has(film.id)) {
          skippedItems.push(
            lookupFailureRecord(film, "Already attempted this session."),
          );
          return false;
        }
        return true;
      })
    : [];
  let candidates = eligible.slice(0, limit);
  candidates.forEach((film) => filmMetadataLookupAttempts.add(film.id));

  let result = {
    attempted: candidates.length,
    found: 0,
    failed: 0,
    skipped: skippedItems.length,
    failures: [],
    skippedItems,
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let film = candidates[cursor++];
      try {
        let metadata = await window.lookupTmdbMovieMetadata(film, {
          settings,
          fetchFn: options.fetchFn,
        });
        if (
          metadata &&
          window.setFilmTmdbMetadata(film.id, metadata, { save: false })
        ) {
          result.found += 1;
          window.clearMetadataSessionFailure("film-metadata", film.id);
        } else {
          result.failed += 1;
          result.failures.push(
            lookupFailureRecord(film, "No TMDB match found."),
          );
          window.recordMetadataSessionFailure(
            "film-metadata",
            lookupFailureRecord(film, "No TMDB match found."),
          );
        }
      } catch (err) {
        console.warn(`Film metadata lookup failed for ${film.title}`, err);
        result.failed += 1;
        result.failures.push(lookupFailureRecord(film, err.message || err));
        window.recordMetadataSessionFailure(
          "film-metadata",
          lookupFailureRecord(film, err.message || err),
        );
      }
      options.onProgress?.(
        result.found + result.failed,
        candidates.length,
        film,
      );
    }
  }

  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 2),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  // Failure-only batches store nothing durable; skipping the save keeps
  // read-only page loads write-free. Failure counters live in in-memory
  // state and persist with the next genuine save.
  if (result.found) {
    window.save();
  }
  return result;
};

/** Increments persisted image failure counters. @param {'poster'|'portrait'} type Image type. @param {number} [count] Increment. @returns {number} Updated count. */
window.recordImageImportFailure = function (type, count = 1) {
  window.state.imageImportStats ||= { posterFailures: 0, portraitFailures: 0 };
  let field = type === "portrait" ? "portraitFailures" : "posterFailures";
  window.state.imageImportStats[field] =
    Math.max(0, Number(window.state.imageImportStats[field]) || 0) +
    Math.max(0, Number(count) || 0);
  return window.state.imageImportStats[field];
};

/** Tests whether a film needs a poster or TMDB upgrade. @param {FilmRecord} film Film. @param {Object} [settings] Provider settings. @returns {boolean} Whether lookup is needed. */
window.filmNeedsPosterLookup = function (
  film,
  settings = window.getPosterSettings(),
) {
  return (
    Boolean(film?.id) &&
    (!film.poster ||
      (settings.tmdbCredential && film.poster.source === "wikimedia"))
  );
};

/** Fetches bounded film posters concurrently. @param {FilmRecord[]} films Films. @param {Object} [options] Batch controls. @returns {Promise<MetadataBatchResult>} Batch result. */
window.fetchFilmPosters = async function (films, options = {}) {
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  let seen = new Set();
  let limit = Math.max(1, Number(options.limit) || 25);
  let skippedItems = [];
  let eligible = (films || []).filter((film) => {
    if (!window.filmNeedsPosterLookup(film, settings) || seen.has(film.id))
      return false;
    seen.add(film.id);
    if (!options.force && posterLookupAttempts.has(film.id)) {
      skippedItems.push(
        lookupFailureRecord(film, "Already attempted this session."),
      );
      return false;
    }
    return true;
  });
  let candidates = eligible.slice(0, limit);
  candidates.forEach((film) => posterLookupAttempts.add(film.id));

  let result = {
    attempted: candidates.length,
    found: 0,
    failed: 0,
    skipped: skippedItems.length,
    failures: [],
    skippedItems,
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let film = candidates[cursor++];
      try {
        let poster = await window.lookupFilmPoster(film, {
          settings,
          fetchFn: options.fetchFn,
        });
        if (poster && window.setFilmPoster(film.id, poster, { save: false })) {
          result.found += 1;
          window.clearMetadataSessionFailure("film-posters", film.id);
        } else {
          result.failed += 1;
          result.failures.push(lookupFailureRecord(film, "No poster found."));
          window.recordMetadataSessionFailure(
            "film-posters",
            lookupFailureRecord(film, "No poster found."),
          );
        }
      } catch (err) {
        console.warn(`Poster lookup failed for ${film.title}`, err);
        result.failed += 1;
        result.failures.push(lookupFailureRecord(film, err.message || err));
        window.recordMetadataSessionFailure(
          "film-posters",
          lookupFailureRecord(film, err.message || err),
        );
      }
      options.onProgress?.(
        result.found + result.failed,
        candidates.length,
        film,
      );
    }
  }

  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (result.failed) window.recordImageImportFailure("poster", result.failed);
  // Failure-only batches store nothing durable; skipping the save keeps
  // read-only page loads write-free. Failure counters live in in-memory
  // state and persist with the next genuine save.
  if (result.found) window.save();
  return result;
};

/** Fetches bounded person portraits concurrently. @param {PersonRecord[]} people People. @param {Object} [options] Batch controls. @returns {Promise<MetadataBatchResult>} Batch result. */
window.fetchPersonPortraits = async function (people, options = {}) {
  let settings = Object.assign(
    window.getPosterSettings(),
    options.settings || {},
  );
  let seen = new Set();
  let limit = Math.max(1, Number(options.limit) || 25);
  let skippedItems = [];
  let eligible = settings.tmdbCredential
    ? (people || []).filter((person) => {
        if (!person?.id || person.portrait || seen.has(person.id)) return false;
        seen.add(person.id);
        if (!options.force && portraitLookupAttempts.has(person.id)) {
          skippedItems.push(
            lookupFailureRecord(person, "Already attempted this session."),
          );
          return false;
        }
        return true;
      })
    : [];
  let candidates = eligible.slice(0, limit);
  candidates.forEach((person) => portraitLookupAttempts.add(person.id));

  let result = {
    attempted: candidates.length,
    found: 0,
    failed: 0,
    skipped: skippedItems.length,
    failures: [],
    skippedItems,
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let person = candidates[cursor++];
      try {
        let portrait = await window.lookupPersonPortrait(person, {
          settings,
          fetchFn: options.fetchFn,
        });
        if (
          portrait &&
          window.setPersonPortrait(person.id, portrait, { save: false })
        ) {
          result.found += 1;
          window.clearMetadataSessionFailure("person-portraits", person.id);
        } else {
          result.failed += 1;
          result.failures.push(
            lookupFailureRecord(person, "No portrait found."),
          );
          window.recordMetadataSessionFailure(
            "person-portraits",
            lookupFailureRecord(person, "No portrait found."),
          );
        }
      } catch (err) {
        console.warn(`Portrait lookup failed for ${person.name}`, err);
        result.failed += 1;
        result.failures.push(lookupFailureRecord(person, err.message || err));
        window.recordMetadataSessionFailure(
          "person-portraits",
          lookupFailureRecord(person, err.message || err),
        );
      }
      options.onProgress?.(
        result.found + result.failed,
        candidates.length,
        person,
      );
    }
  }

  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (result.failed) window.recordImageImportFailure("portrait", result.failed);
  // Failure-only batches store nothing durable; skipping the save keeps
  // read-only page loads write-free. Failure counters live in in-memory
  // state and persist with the next genuine save.
  if (result.found) window.save();
  return result;
};

// TMDB media type check (issue #42): the app treats every tmdbId as a
// *movie* id, but sheet-imported ids can accidentally be TV ids (e.g. a
// miniseries stored as Type=Film). This probes TMDB only on an explicit
// button press and reports ids that resolve as TV or as nothing at all.
// Results are session-only; nothing is persisted.
let mediaTypeCheckAttempts = new Set();

async function fetchTmdbResource(kind, id, credential, fetchFn) {
  let params = new URLSearchParams({ language: "en-US" });
  let headers = { accept: "application/json" };
  if (String(credential).startsWith("eyJ"))
    headers.Authorization = `Bearer ${credential}`;
  else params.set("api_key", credential);
  let response = await fetchFn(
    `https://api.themoviedb.org/3/${kind}/${encodeURIComponent(id)}?${params}`,
    { headers },
  );
  if (response.status === 404) return { exists: false };
  if (!response.ok) throw new Error(`TMDB request failed (${response.status})`);
  let data = await response.json();
  return { exists: true, title: String(data.title || data.name || "") };
}

/** Classifies movie/TV TMDB probe results. @param {Object} movieResult Movie result. @param {Object|null} tvResult TV result. @returns {Object} Verdict. */
window.classifyTmdbMediaCheck = function (movieResult, tvResult) {
  if (movieResult?.exists) return { status: "ok", detail: "" };
  if (tvResult?.exists)
    return {
      status: "tv",
      detail: tvResult.title
        ? `Resolves as TV: ${tvResult.title}`
        : "Resolves as TV",
    };
  return { status: "missing", detail: "Not found on TMDB" };
};

window.tmdbMediaTypeSession = { checked: 0, issues: [] };

/** Checks stored TMDB ids against movie and TV endpoints. @param {Object} [options] Batch controls. @returns {Promise<Object>} Check totals. */
window.checkTmdbMediaTypes = async function (options = {}) {
  let settings = Object.assign(
    {},
    window.getPosterSettings?.() || {},
    options.settings || {},
  );
  if (!settings.tmdbCredential)
    throw new Error("A TMDB credential is required for media type checks.");
  let fetchFn = options.fetchFn || window.fetch?.bind(window);
  if (!fetchFn)
    throw new Error("Media type checks require browser network access.");
  let limit = Math.max(1, Number(options.limit) || 250);
  let films = (
    options.films || Object.values(window.state.filmsById || {})
  ).filter(
    (film) => film?.id && film.title && film.tmdbId && !film.watchlistItem,
  );
  let candidates = films
    .filter((film) => options.force || !mediaTypeCheckAttempts.has(film.id))
    .slice(0, limit);
  candidates.forEach((film) => mediaTypeCheckAttempts.add(film.id));

  let session = window.tmdbMediaTypeSession;
  let result = {
    attempted: candidates.length,
    ok: 0,
    issues: 0,
    failed: 0,
    remaining: 0,
  };
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      let film = candidates[cursor++];
      try {
        let movie = await fetchTmdbResource(
          "movie",
          film.tmdbId,
          settings.tmdbCredential,
          fetchFn,
        );
        let tv = movie.exists
          ? null
          : await fetchTmdbResource(
              "tv",
              film.tmdbId,
              settings.tmdbCredential,
              fetchFn,
            );
        let verdict = window.classifyTmdbMediaCheck(movie, tv);
        session.checked += 1;
        if (verdict.status === "ok") result.ok += 1;
        else {
          result.issues += 1;
          if (!session.issues.some((issue) => issue.id === film.id)) {
            session.issues.push({
              id: film.id,
              title: `${film.title}${film.year ? ` (${film.year})` : ""}`,
              href: window.filmPageUrl?.(film.id) || "",
              tmdbId: String(film.tmdbId),
              localType: String(film.type || "").trim(),
              status: verdict.status,
              detail: verdict.detail,
            });
          }
        }
      } catch (err) {
        console.warn(`TMDB media type check failed for ${film.title}`, err);
        result.failed += 1;
        // A network hiccup shouldn't consume the film's one attempt.
        mediaTypeCheckAttempts.delete(film.id);
      }
      options.onProgress?.(
        result.ok + result.issues + result.failed,
        candidates.length,
        film,
      );
    }
  }
  let concurrency = Math.min(
    candidates.length,
    Math.max(1, Number(options.concurrency) || 3),
  );
  await Promise.all(Array.from({ length: concurrency }, worker));
  result.remaining = films.filter(
    (film) => !mediaTypeCheckAttempts.has(film.id),
  ).length;
  return result;
};
