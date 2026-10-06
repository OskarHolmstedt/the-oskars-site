/**
 * @file Resolves films and people into the shared Supabase catalog, where
 * every record carries a TMDB identity. A record that arrives without one is
 * matched against the existing catalog first and looked up on TMDB second;
 * when both fail nothing is created and the caller reports it as not added.
 * Loaded by every page that writes catalog films or people, and by the owner
 * Sheets import script's sandbox.
 */

function identityFetch(options) {
  let fetchFn = options?.fetchFn || window.fetch?.bind(window);
  if (!fetchFn) throw new Error("TMDB lookup requires network access.");
  return fetchFn;
}

function positiveInteger(value) {
  let text = String(value ?? "").trim();
  return /^[1-9][0-9]*$/.test(text) ? Number(text) : null;
}

/**
 * Formats a parsed TMDB TV reference as the `films.tmdb_tv_ref` notation.
 * @param {{id: string, season: number|null, episode: number|null}} reference Parsed TV reference.
 * @returns {string} "TV:<id>", "TV:<id>/S<season>" or "TV:<id>/S<season>E<episode>".
 */
window.formatTmdbTvRef = function (reference) {
  let ref = `TV:${Number(reference.id)}`;
  if (reference.season !== null && reference.season !== undefined) {
    ref += `/S${reference.season}`;
    if (reference.episode !== null && reference.episode !== undefined)
      ref += `E${reference.episode}`;
  }
  return ref;
};

/**
 * Normalizes a stored film TMDB identity: a movie ID or a TV reference.
 * @param {string|number|null|undefined} value Stored tmdbId.
 * @returns {string|null} The movie ID or "TV:..." reference, or null when absent or malformed.
 */
window.filmTmdbIdentity = function (value) {
  let text = String(value ?? "").trim();
  if (/^TV:/i.test(text)) {
    let reference = window.parseTmdbReference(text);
    return reference.mediaType === "tv"
      ? window.formatTmdbTvRef(reference)
      : null;
  }
  return positiveInteger(text) ? text : null;
};

/**
 * Looks a film up on TMDB by Letterboxd URL, or by title and year: a movie first, then a TV series.
 * @param {{title?: string, year?: number|string|null, type?: string, letterboxdUrl?: string, url?: string}} film Film to identify.
 * @param {{fetchFn?: Function}} [options] Network controls.
 * @returns {Promise<string|null>} The movie ID or "TV:<id>" reference, or null without a confident match.
 */
window.lookupTmdbFilmIdentity = async function (film, options = {}) {
  let fetchFn = identityFetch(options);
  let lbUrl = film?.letterboxdUrl || film?.url;
  if (lbUrl) {
    let directTmdbId = await window.lookupLetterboxdFilmTmdbId?.(
      lbUrl,
      fetchFn,
    );
    if (directTmdbId) return String(directTmdbId);
  }

  let title = String(film?.title || "").trim();
  let searchFilm = film;
  if (!title && lbUrl) {
    let slugTitle = window.extractLetterboxdSlugTitle?.(lbUrl);
    if (slugTitle) searchFilm = { ...film, title: slugTitle };
  }
  if (!String(searchFilm?.title || "").trim()) return null;

  let match =
    (await window.lookupTmdbMovieSearch(searchFilm, fetchFn)) ||
    (await window.lookupTmdbTvSearch(searchFilm, fetchFn));

  if (!match && lbUrl && title) {
    let slugTitle = window.extractLetterboxdSlugTitle?.(lbUrl);
    if (slugTitle && slugTitle.toLowerCase() !== title.toLowerCase()) {
      let slugFilm = { ...film, title: slugTitle };
      match =
        (await window.lookupTmdbMovieSearch(slugFilm, fetchFn)) ||
        (await window.lookupTmdbTvSearch(slugFilm, fetchFn));
    }
  }

  return match?.id ? String(match.id) : null;
};

let filmResolutionCache = new WeakMap();
let personResolutionCache = new WeakMap();
let fallbackCacheTarget = {};

function getResolutionCache(map, client) {
  let target =
    client && typeof client === "object" ? client : fallbackCacheTarget;
  let cache = map.get(target);
  if (!cache) {
    cache = new Map();
    map.set(target, cache);
  }
  return cache;
}

/**
 * Retries an idempotent PostgREST operation if it fails with a transient
 * network error (such as a dropped socket during body streaming).
 */
async function withPostgrestRetry(operation) {
  if (!window.withRetry) return operation();
  return window.withRetry(
    async () => {
      let result = await operation();
      if (
        result?.error &&
        /load failed|network connection|network request failed|failed to fetch/i.test(
          result.error.message || "",
        )
      ) {
        let err = new Error(result.error.message);
        err.originalError = result.error;
        throw err;
      }
      return result;
    },
    {
      maxAttempts: 4,
      baseDelayMs: 300,
      maxDelayMs: 4000,
      shouldRetry(error) {
        return (
          error instanceof TypeError ||
          /load failed|network connection|network request failed|failed to fetch/i.test(
            error?.message || "",
          )
        );
      },
    },
  );
}

async function findOrCreateIdentifiedFilm(
  client,
  identity,
  title,
  year,
  payload,
) {
  let reference = window.parseTmdbReference(identity);
  let { data, error } = await withPostgrestRetry(() =>
    reference.mediaType === "tv"
      ? client.rpc("find_or_create_tv_film", {
          p_tv_ref: window.formatTmdbTvRef(reference),
          p_title: title,
          p_year: year,
          p_poster_url: payload.p_poster_url || null,
        })
      : client.rpc("find_or_create_film", {
          ...payload,
          p_tmdb_id: Number(reference.id),
          p_title: title,
          p_year: year,
        }),
  );
  if (error) throw error;
  return data || null;
}

/**
 * Finds the oldest catalog film with this case-insensitive title and year,
 * the same match `find_or_create_film` makes without a TMDB ID. A plain read,
 * so it never creates a film whatever that function does.
 * @param {Object} client Supabase client.
 * @param {string} title Film title.
 * @param {number|null} year Release year, or null for a film without one.
 * @returns {Promise<string|null>} The film id, or null.
 */
window.findSupabaseCatalogFilm = async function (client, title, year) {
  let wanted = String(title || "")
    .trim()
    .toLowerCase();
  if (!wanted) return null;
  // Every LIKE wildcard (and PostgREST's `*`) becomes a one-character
  // wildcard, so the pattern matches a superset that is then compared exactly.
  let query = client
    .from("films")
    .select("id,title")
    .ilike("title", wanted.replace(/[\\%_*]/g, "_"));
  query = year == null ? query.is("year", null) : query.eq("year", year);
  let { data, error } = await withPostgrestRetry(() =>
    query.order("created_at").limit(50),
  );
  if (error) throw error;
  return (
    (data || []).find((row) => String(row.title).toLowerCase() === wanted)
      ?.id || null
  );
};

/**
 * Resolves a film to its shared catalog row. A film with a TMDB identity is
 * found or created by it; one without is matched by exact title and year in
 * the catalog, then looked up on TMDB. Without either match nothing is
 * created and `filmId` is null.
 * @param {Object} client Supabase client.
 * @param {{title: string, year?: number|string|null, type?: string, tmdbId?: string|number|null}} film Film to resolve.
 * @param {Record<string, *>} [payload] Further `find_or_create_film` columns (p_medium, p_type, ...) for a new row.
 * @param {{fetchFn?: Function}} [options] Network controls for the TMDB lookup.
 * @returns {Promise<{filmId: string|null, tmdbId: string|null, via: 'tmdb-id'|'catalog'|'tmdb-search'|null}>} The resolved row and how it was found.
 */
window.resolveSupabaseCatalogFilm = async function (
  client,
  film,
  payload = {},
  options = {},
) {
  let title = String(film?.title || "").trim();
  let year = Number(film?.year) || null;
  let letterboxdUrl = film?.letterboxdUrl || film?.url || "";
  let known = window.filmTmdbIdentity(film?.tmdbId);
  let cacheKey = known
    ? `tmdb:${known}`
    : letterboxdUrl
      ? `lb:${letterboxdUrl}`
      : title
        ? `title:${title.toLowerCase()}:${year}`
        : null;

  if (cacheKey) {
    let cache = getResolutionCache(filmResolutionCache, client);
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey);
    }
    let resolutionPromise = (async () => {
      if (known) {
        return {
          filmId: await findOrCreateIdentifiedFilm(
            client,
            known,
            title,
            year,
            payload,
          ),
          tmdbId: known,
          via: "tmdb-id",
        };
      }
      if (!title && !letterboxdUrl)
        return { filmId: null, tmdbId: null, via: null };
      let catalogId = title
        ? await window.findSupabaseCatalogFilm(client, title, year)
        : null;
      if (catalogId) return { filmId: catalogId, tmdbId: null, via: "catalog" };
      let found = await window.lookupTmdbFilmIdentity(
        {
          title,
          year,
          type: film?.type,
          letterboxdUrl: letterboxdUrl || undefined,
        },
        options,
      );
      if (!found) return { filmId: null, tmdbId: null, via: null };
      return {
        filmId: await findOrCreateIdentifiedFilm(
          client,
          found,
          title,
          year,
          payload,
        ),
        tmdbId: found,
        via: "tmdb-search",
      };
    })();

    resolutionPromise.catch(() => cache.delete(cacheKey));
    cache.set(cacheKey, resolutionPromise);
    return resolutionPromise;
  }

  return { filmId: null, tmdbId: null, via: null };
};

async function findOrCreatePersonRpc(client, tmdbId, name, profilePath) {
  let { data, error } = await withPostgrestRetry(() =>
    client.rpc("find_or_create_person", {
      p_tmdb_id: tmdbId,
      p_name: name,
      p_portrait_url: profilePath
        ? `https://image.tmdb.org/t/p/w300${profilePath}`
        : null,
    }),
  );
  return { personId: data || null, error };
}

/**
 * Resolves a person to their shared catalog row. A person with a TMDB ID is
 * found or created by it; one without is matched by name in the catalog,
 * then looked up on TMDB (an ambiguous catalog name goes straight to TMDB).
 * Without either match nothing is created and `personId` is null.
 * @param {Object} client Supabase client.
 * @param {{name: string, tmdbId?: number|string|null, profilePath?: string|null, creditedFilmTmdbIds?: (number|string)[]}} person Person to resolve; credited film IDs help TMDB tell namesakes apart.
 * @param {{fetchFn?: Function}} [options] Network controls for the TMDB lookup.
 * @returns {Promise<{personId: string|null, via: 'tmdb-id'|'catalog'|'tmdb-search'|null}>} The resolved row and how it was found.
 */
window.resolveSupabaseCatalogPerson = async function (
  client,
  person,
  options = {},
) {
  let name = String(person?.name || "").trim();
  if (!name) return { personId: null, via: null };
  let tmdbId = positiveInteger(person?.tmdbId);
  let cacheKey = tmdbId
    ? `tmdb:${tmdbId}`
    : `name:${name.toLowerCase()}:${(person?.creditedFilmTmdbIds || []).join(",")}`;

  let cache = getResolutionCache(personResolutionCache, client);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let resolutionPromise = (async () => {
    if (tmdbId) {
      let { personId, error } = await findOrCreatePersonRpc(
        client,
        tmdbId,
        name,
        person?.profilePath,
      );
      if (error) throw error;
      return { personId, via: "tmdb-id" };
    }
    let { personId: catalogId, error } = await findOrCreatePersonRpc(
      client,
      null,
      name,
      null,
    );
    if (error && !/ambiguous person name/i.test(error.message || ""))
      throw error;
    if (catalogId) return { personId: catalogId, via: "catalog" };
    let match = await window.lookupTmdbPersonIdentity(
      { name, creditedFilmTmdbIds: person?.creditedFilmTmdbIds || [] },
      identityFetch(options),
    );
    if (!match) return { personId: null, via: null };
    let created = await findOrCreatePersonRpc(
      client,
      match.tmdbId,
      match.name || name,
      match.profilePath,
    );
    if (created.error) throw created.error;
    return { personId: created.personId, via: "tmdb-search" };
  })();

  resolutionPromise.catch(() => cache.delete(cacheKey));
  cache.set(cacheKey, resolutionPromise);
  return resolutionPromise;
};

/**
 * Builds the warning shown when films or people could not be added.
 * @param {'film'|'person'} kind Record kind.
 * @param {string[]} labels Display labels, such as "Title (1999)" or a name.
 * @returns {string} The warning, or "" when nothing was left out.
 */
window.catalogIdentityWarning = function (kind, labels) {
  let unique = [...new Set((labels || []).filter(Boolean))];
  if (!unique.length) return "";
  let noun =
    kind === "person"
      ? unique.length === 1
        ? "person was"
        : "people were"
      : unique.length === 1
        ? "film was"
        : "films were";
  return `${unique.length} ${noun} not added: no match in the catalog or on TMDB. ${unique.join("; ")}`;
};

/**
 * Formats a film as "Title (year)" for identity warnings.
 * @param {{title?: string, year?: number|string|null}} film Film.
 * @returns {string} Display label.
 */
window.catalogFilmLabel = function (film) {
  let title = String(film?.title || "").trim() || "Untitled";
  return film?.year ? `${title} (${film.year})` : title;
};
