/**
 * @file Client-side index over the shared film catalog, built from
 * Supabase's `films`/`credits` tables (`buildSharedFilmArchiveFromSupabase()`
 * in src/domain/supabase-legacy-hydration.js) and applied once per
 * hydration via `applySharedFilmArchive()`. Lets director filmographies,
 * period pages, and global search surface films other eligible accounts
 * have already shared, even when the viewer has never personally watched
 * or watchlisted them.
 */

window.OSKARS_SHARED_FILM_ARCHIVE = {};
window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID = {};
window.OSKARS_SHARED_FILM_ARCHIVE_VERSION = 0;
window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "idle";
let sharedFilmArchiveListeners = new Set();
let sharedFilmArchiveIdentitySource = null;
let sharedFilmArchiveByTitleYear = new Map();

function rebuildSharedFilmArchiveIdentityIndex() {
  let source = window.OSKARS_SHARED_FILM_ARCHIVE || {};
  if (source === sharedFilmArchiveIdentitySource) return;
  sharedFilmArchiveIdentitySource = source;
  sharedFilmArchiveByTitleYear = new Map();
  Object.values(source).forEach((film) => {
    let title = window.normalizeTitle(film?.title || "");
    let year = String(film?.year || "").trim();
    if (!title || !year) return;
    let key = `${year}::${title}`;
    let matches = sharedFilmArchiveByTitleYear.get(key) || [];
    matches.push(film);
    sharedFilmArchiveByTitleYear.set(key, matches);
  });
}

/**
 * Indexes a flat tmdbId-keyed shared-film map by its own real Supabase
 * films.id, for a caller (a film.html?id=<filmId> visit) that needs to
 * resolve a catalog-only film by that id rather than by tmdbId. Pure
 * function of the map alone.
 * @param {Object} map `{ [tmdbId]: {id, tmdbId, title, year, people, ...} }`.
 * @returns {Record<string, Object>} id -> shared film record.
 */
window.rebuildSharedFilmArchiveByIdIndex = function (map) {
  let byId = {};
  Object.values(map || {}).forEach((film) => {
    if (film.id) byId[film.id] = film;
  });
  return byId;
};

/**
 * Applies a freshly-pulled sharedFilmMetadata archive section, rebuilding
 * the by-id index alongside it. The index only ever changes as a result of
 * a successful pull (sign-in / periodic recheck / reconnect), never as a
 * side effect of local mutations, so an eager synchronous rebuild here is
 * correct - unlike window.watchlistItemsByDirector, which caches lazily
 * against the viewer's own constantly-changing local state.
 * @param {Object} map Raw pulled `sharedFilmMetadata` flat map.
 */
window.applySharedFilmArchive = function (map) {
  window.OSKARS_SHARED_FILM_ARCHIVE = map || {};
  window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID = window.rebuildSharedFilmArchiveByIdIndex(
    window.OSKARS_SHARED_FILM_ARCHIVE,
  );
  window.OSKARS_SHARED_FILM_ARCHIVE_VERSION += 1;
  window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "ready";
  sharedFilmArchiveListeners.forEach((listener) => listener());
};

/**
 * Subscribes to shared-film archive or loading-status changes.
 * @param {Function} listener Called after a status or archive change.
 * @returns {Function} Unsubscribes the listener.
 */
window.onSharedFilmArchiveChange = function (listener) {
  sharedFilmArchiveListeners.add(listener);
  return () => sharedFilmArchiveListeners.delete(listener);
};

/**
 * Returns objective director names carried by one shared-film record.
 * @param {Object} film Shared film record.
 * @returns {string[]} Director names.
 */
window.sharedArchiveFilmDirectorNames = function (film) {
  return Object.values(film?.people || {})
    .filter((credit) => (credit.professions || []).includes("Director"))
    .map((credit) => String(credit.name || ""))
    .filter(Boolean);
};

/**
 * Finds an objective shared-archive record for one personal/import record.
 * TMDB identity wins; title/year fallback is accepted only when exactly one
 * shared film has that identity, so imports never borrow metadata from an
 * ambiguous remake or duplicate.
 * @param {FilmRecord|WatchlistItem|WatchedOtherEntry} record Personal record.
 * @returns {Object|null} Matching shared record, if unambiguous.
 */
window.sharedArchiveFilmForPersonalRecord = function (record) {
  if (!record) return null;
  let tmdbId = String(record.tmdbId || "").trim();
  if (tmdbId && window.OSKARS_SHARED_FILM_ARCHIVE?.[tmdbId])
    return window.OSKARS_SHARED_FILM_ARCHIVE[tmdbId];
  let title = window.normalizeTitle(record.title || "");
  let year = String(record.year || "").trim();
  if (!title || !year) return null;
  rebuildSharedFilmArchiveIdentityIndex();
  let matches = sharedFilmArchiveByTitleYear.get(`${year}::${title}`) || [];
  return matches.length === 1 ? matches[0] : null;
};

function sharedArchiveMetadataMissing(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return false;
  let text = String(value ?? "").trim();
  return !text || text === "0" || text.toLocaleLowerCase() === "unknown";
}

/**
 * Fills missing objective metadata on an imported personal record from its
 * unambiguous shared-archive counterpart. Personal viewing facts, opinions,
 * collection membership, and any already-populated objective values remain
 * authoritative.
 * @param {FilmRecord|WatchlistItem|WatchedOtherEntry} record Imported record.
 * @param {'film'|'watchlist'} [target] Canonical target shape.
 * @returns {FilmRecord|WatchlistItem|WatchedOtherEntry} Enriched input record.
 */
window.enrichPersonalRecordFromSharedArchive = function (
  record,
  target = "film",
) {
  let shared = window.sharedArchiveFilmForPersonalRecord(record);
  if (!shared) return record;
  let fields = [
    "tmdbId",
    "poster",
    "country",
    "runtimeMinutes",
    "swedishTitle",
  ];
  if (target !== "watchlist") fields.push("primaryCountry", "type");
  fields.forEach((field) => {
    if (
      sharedArchiveMetadataMissing(record[field]) &&
      !sharedArchiveMetadataMissing(shared[field])
    ) {
      record[field] = window.cloneRecord
        ? window.cloneRecord(shared[field])
        : shared[field];
    }
  });
  let directors = window.sharedArchiveFilmDirectorNames(shared);
  if (sharedArchiveMetadataMissing(record.directors) && directors.length)
    record.directors = directors.slice();
  if (sharedArchiveMetadataMissing(record.director) && directors.length)
    record.director = directors.join(", ");
  return record;
};

function sharedArchiveTitleYearKey(record) {
  return `${record?.year || ""}::${window.normalizeTitle(record?.title || "")}`;
}

/**
 * Removes shared films already present in watched, other-watched, or watchlist data.
 * @param {Object[]} [candidates] Shared-film candidates; defaults to the complete archive.
 * @returns {Object[]} Shared films absent from every personal collection.
 */
window.sharedArchiveFilmsOutsideCollection = function (
  candidates = Object.values(window.OSKARS_SHARED_FILM_ARCHIVE || {}),
) {
  if (!candidates.length) return [];
  let ownTmdbIds = new Set();
  let ownTitleYearKeys = new Set();
  function noteOwn(record) {
    if (!record) return;
    let tmdbId = String(record.tmdbId || "").trim();
    if (tmdbId) ownTmdbIds.add(tmdbId);
    else ownTitleYearKeys.add(sharedArchiveTitleYearKey(record));
  }
  Object.values(window.state?.filmsById || {}).forEach(noteOwn);
  (window.state?.watchedOther || []).forEach(noteOwn);
  (window.state?.watchlist || []).forEach(noteOwn);
  return candidates.filter(
    (film) =>
      !ownTmdbIds.has(String(film.tmdbId || "")) &&
      !ownTitleYearKeys.has(sharedArchiveTitleYearKey(film)),
  );
};

/**
 * Builds one film's people credits from every official nomination it holds
 * across every source, plus its director(s) - the same
 * category-to-profession mapping `buildSharedFilmPeopleCredits`
 * (`src/core/shared-film-metadata-sync.js`) already uses for an organic
 * account's own award placements, applied here to objective nomination
 * facts (category/recipient) instead. A film nominated for both Best
 * Picture and Best Cinematography, say, carries its cinematographer
 * alongside its director; Best Picture itself has no
 * `PERSON_AWARD_PROFESSIONS` entry, so it contributes nothing beyond the
 * director, same as any other unmapped category.
 * @param {Object[]} nominations Every nomination (any source/period) for one tmdbId.
 * @param {Object} metadata `OSKARS_BUNDLED_OFFICIAL_FILM_METADATA[tmdbId]` entry.
 * @returns {Record<string, {name: string, professions: string[], details: string[]}>}
 */
function officialNomineeFilmPeopleCredits(nominations, metadata) {
  let people = {};
  function addPerson(name, profession) {
    let personId = window.normalizePersonName?.(name);
    if (!personId) return;
    let entry = (people[personId] ||= {
      name: String(name).trim(),
      professions: [],
      details: [],
    });
    if (profession && !entry.professions.includes(profession))
      entry.professions.push(profession);
  }
  let directorNames = metadata.directors?.length
    ? metadata.directors
    : window.parsePersonCredit?.(metadata.director).names || [];
  directorNames.forEach((name) => addPerson(name, "Director"));
  nominations.forEach((nomination) => {
    let profession = window.PERSON_AWARD_PROFESSIONS?.[nomination.category];
    if (!profession) return;
    (window.parsePersonCredit?.(nomination.recipient).names || []).forEach((name) =>
      addPerson(name, profession),
    );
  });
  return people;
}

/**
 * Converts every TMDB-linked official-results nomination into a
 * shared-archive-shaped candidate record, one per film, aggregating every
 * nomination that film holds across every source/period (issue #375 -
 * originally only the first-seen nomination per film contributed anything,
 * and only its director). Metadata comes entirely from
 * `OSKARS_BUNDLED_OFFICIAL_FILM_METADATA` (bundled, or live-pulled the same
 * way for every eligible client via shared-archive-sync.js - no separate
 * Firestore read needed here) and carries only the same objective fields
 * `sharedFilmMetadataPayload` does - no category/placement/winner status.
 * A ceremony period can represent more than one calendar release year
 * (`officialResultPeriodYears`, e.g. early biennial Academy ceremonies), so
 * each record keeps every represented year rather than guessing one.
 * @returns {Object[]} `{tmdbId, title, year, years, poster, country, primaryCountry, runtimeMinutes, swedishTitle, people}`
 */
window.officialNomineeSharedFilmRecords = function () {
  let nominationsByTmdbId = new Map();
  let firstSeenByTmdbId = new Map();
  Object.values(window.state?.officialResults || {}).forEach((source) => {
    Object.entries(source?.periods || {}).forEach(([periodKey, period]) => {
      let years = window.officialResultPeriodYears?.(periodKey) || [];
      if (!years.length) return;
      (period?.nominations || []).forEach((nomination) => {
        let tmdbId = String(nomination.tmdbId || "");
        if (!tmdbId) return;
        if (!nominationsByTmdbId.has(tmdbId)) {
          nominationsByTmdbId.set(tmdbId, []);
          firstSeenByTmdbId.set(tmdbId, {
            title: nomination.sourceTitle || "",
            years,
          });
        }
        nominationsByTmdbId.get(tmdbId).push(nomination);
      });
    });
  });
  return [...nominationsByTmdbId.entries()].map(([tmdbId, nominations]) => {
    let metadata = window.OSKARS_BUNDLED_OFFICIAL_FILM_METADATA?.[tmdbId] || {};
    let { title, years } = firstSeenByTmdbId.get(tmdbId);
    return {
      tmdbId,
      title,
      year: years[0],
      years,
      poster: metadata.poster || null,
      country: metadata.country || "",
      primaryCountry: metadata.primaryCountry || "",
      runtimeMinutes: metadata.runtimeMinutes || 0,
      swedishTitle: metadata.swedishTitle || "",
      people: officialNomineeFilmPeopleCredits(nominations, metadata),
    };
  });
};

/**
 * Combined Shared archive candidates (issue #371): organic
 * `sharedFilmMetadata` records plus official-results nominees not already
 * covered by an organic record for the same film - the organic record wins
 * on overlap since it may carry richer award-derived people credits from a
 * real account's own bracket. Both are already filtered to films the
 * viewer doesn't personally have watched, other-watched, or watchlisted.
 * @returns {Object[]}
 */
window.sharedArchiveCandidateFilms = function () {
  let organic = window.sharedArchiveFilmsOutsideCollection();
  let organicTmdbIds = new Set(
    organic.map((film) => String(film.tmdbId || "")).filter(Boolean),
  );
  let nominees = window
    .sharedArchiveFilmsOutsideCollection(window.officialNomineeSharedFilmRecords())
    .filter((film) => !organicTmdbIds.has(String(film.tmdbId || "")));
  return [...organic, ...nominees];
};

/**
 * Returns Shared-archive candidates whose release covers one period - a
 * nominee record may represent more than one calendar year (see
 * officialNomineeSharedFilmRecords), so membership checks every year it
 * represents rather than a single assigned one.
 * @param {'year'|'decade'|'century'|'alltime'} type Period URL type.
 * @param {string} key Period key.
 * @returns {Object[]} Chronologically sorted shared-film records.
 */
window.sharedArchiveFilmsForPeriod = function (type, key) {
  return window
    .sharedArchiveCandidateFilms()
    .filter((film) => {
      let years = (film.years || [film.year]).filter((year) =>
        /^\d{4}$/.test(String(year || "")),
      );
      if (!years.length) return false;
      if (type === "alltime") return true;
      if (type === "year") return years.some((year) => String(year) === String(key));
      if (type === "decade")
        return years.some((year) => window.getDecadeKey(year) === key);
      if (type === "century")
        return years.some((year) => window.getCenturyKey(year) === key);
      return false;
    })
    .sort(
      (left, right) =>
        Number(left.year) - Number(right.year) ||
        window.compareEnglishTitles(left.title, right.title),
    );
};

/**
 * Resolves a director display string for an external record - its own
 * `director` field if already flat, or derived from its `people` map
 * (the shared-archive/nominee record shape) otherwise. Every
 * add-to-watched/add-to-watchlist caller used to derive this itself,
 * independently and by hand (issue #378 - the same root cause #372/#376/
 * #377 each hit separately: a caller not forwarding a field the source
 * record already had).
 * @param {Object} record
 * @returns {string}
 */
function externalRecordDirector(record) {
  return (
    record?.director ||
    (record?.people ? window.sharedArchiveFilmDirectorNames(record).join(", ") : "")
  );
}

/**
 * Adds any external film record (shared archive, official-results nominee,
 * or similar - anything with no local film id yet) through the normal
 * watchlist persistence path, then applies any country/runtime the source
 * record already carries (issue #376 - normalizeWatchlistItem deliberately
 * excludes these at creation time for a manual/CSV entry that doesn't know
 * them yet, but an external record with these fields already resolved
 * shouldn't lose them on add).
 * @param {Object} record `{title, year, tmdbId, swedishTitle, poster, country, runtimeMinutes, director|people}`.
 * @returns {Object} Normal addWatchlistItem result.
 */
window.addFilmRecordToWatchlist = function (record) {
  if (!record) return { ok: false, reason: "Could not add this film." };
  let director = externalRecordDirector(record);
  let result = window.addWatchlistItem(
    {
      title: record.title,
      year: record.year,
      tmdbId: record.tmdbId,
      swedishTitle: record.swedishTitle,
      poster: record.poster,
      director,
    },
    { save: false },
  );
  if (result.ok)
    window.setWatchlistTmdbMetadata?.(result.item.id, {
      tmdbId: record.tmdbId,
      director,
      swedishTitle: record.swedishTitle,
      poster: record.poster,
      country: record.country,
      runtimeMinutes: record.runtimeMinutes,
    });
  return result;
};

/**
 * Looks up one Shared-archive candidate (organic or official-results
 * nominee) by tmdbId - the single-film equivalent of
 * sharedArchiveCandidateFilms(), for a caller (a preview page, an add
 * action) that only needs one film rather than every candidate for a
 * period. Tries the fast O(1) organic lookup first, falling back to a
 * nominee-set scan only when that misses (issue #377).
 * @param {string|number} tmdbId Shared film TMDB id.
 * @returns {Object|null}
 */
window.sharedArchiveCandidateFilmByTmdbId = function (tmdbId) {
  let id = String(tmdbId || "");
  if (!id) return null;
  return (
    window.OSKARS_SHARED_FILM_ARCHIVE?.[id] ||
    window.sharedArchiveCandidateFilms().find((candidate) => String(candidate.tmdbId || "") === id) ||
    null
  );
};

/**
 * Looks up one Shared-archive candidate by its own real Supabase films.id
 * (issue #453's Unseen-film work) - the id-keyed counterpart to
 * sharedArchiveCandidateFilmByTmdbId(), for film.html?id=<filmId> visits.
 * Official-results nominee placeholders have no real films.id, so unlike
 * the tmdbId lookup there is no nominee-set fallback to scan - a miss here
 * genuinely means "not a real catalog film."
 * @param {string} filmId Supabase films.id.
 * @returns {Object|null}
 */
window.sharedArchiveCandidateFilmById = function (filmId) {
  let id = String(filmId || "");
  if (!id) return null;
  return window.OSKARS_SHARED_FILM_ARCHIVE_BY_ID?.[id] || null;
};

/**
 * Adds one Shared-archive card's film through the normal watchlist
 * persistence path. Looks up the combined candidate set (issue #371), not
 * just OSKARS_SHARED_FILM_ARCHIVE directly, since the card that triggered
 * this may be an official-results nominee with no entry there.
 * @param {string|number} tmdbId Shared film TMDB id.
 * @returns {Object} Normal addWatchlistItem result.
 */
window.addSharedArchiveFilmToWatchlist = function (tmdbId) {
  let film = window.sharedArchiveCandidateFilmByTmdbId(tmdbId);
  if (!film) return { ok: false, reason: "Could not add this film." };
  return window.addFilmRecordToWatchlist(film);
};

/**
 * Creates a fresh watched-film entry from an external record (shared
 * archive or official-results nominee), so the existing classify-and-route
 * logic (classifyTmdbFilmType/setFilmTmdbMetadata) places it correctly: a
 * real film lands unranked in the archive (shows under "Not yet ranked"),
 * anything else (TV/short/documentary) lands in Other Watched.
 *
 * When `record.type` is already known (issue #372 - shared records pushed
 * after schema v2 carry it), that classification is applied directly from
 * the record via setFilmTmdbMetadata, the same application path a fresh
 * fetch result already uses - no TMDB round trip for data the shared
 * archive already paid for once. Falls back to a full forced fetch
 * (loadFilmMetadata with skipSharedArchive:true, bypassing the default
 * shared-metadata shortcut that would otherwise fire here and return the
 * same type-less cached shape) for an older shared doc or an
 * official-results nominee, neither of which carries `type` yet.
 * @param {Object} record `{title, year, tmdbId, type, country, primaryCountry, swedishTitle, runtimeMinutes, poster, director|people}`.
 * @returns {Promise<Object>} `{ok, filmId}` or `{ok:false, reason}`.
 */
window.addFilmRecordToWatched = async function (record) {
  let director = externalRecordDirector(record);
  let plan = window.planFreshWatchedFilm({
    title: record?.title,
    year: record?.year,
    tmdbId: record?.tmdbId,
    director,
    type: record?.type,
  });
  if (!plan.ok)
    return { ok: false, reason: plan.errors?.[0] || "Could not add this film." };
  let result = window.applyFreshWatchedFilm(plan, { save: false });
  if (!result.ok)
    return { ok: false, reason: result.reason || "Could not add this film." };
  if (record?.type) {
    window.setFilmTmdbMetadata(
      result.film.id,
      {
        tmdbId: record.tmdbId,
        type: record.type,
        director,
        country: record.country,
        primaryCountry: record.primaryCountry,
        swedishTitle: record.swedishTitle,
        runtimeMinutes: record.runtimeMinutes,
        poster: record.poster,
      },
      { save: false, log: false },
    );
    window.save();
  } else {
    await window.loadFilmMetadata?.(result.film.id, {
      skipSharedArchive: true,
      log: false,
    });
  }
  return { ok: true, filmId: result.film.id };
};
