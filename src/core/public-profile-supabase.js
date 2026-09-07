/**
 * @file Builds and hydrates a public-profile projection straight from
 * Supabase (issue #452's live reader), while `public-profile.js` retains
 * immutable static revisions for Community comparisons. Reuses the same
 * validated `buildPublicProjection()`/`hydratePublicProfileState()`
 * contract unchanged, so every existing page renders identically
 * regardless of which source produced the projection - only how the
 * `years`/`watchedFilms` input is assembled differs here.
 *
 * officialResults is not queried from Supabase at all: it is shared,
 * non-personal data every deployment already ships bundled
 * (`window.OSKARS_BUNDLED_OFFICIAL_RESULTS`, issue #277) - reusing it
 * directly avoids reshaping four more Supabase tables for data that was
 * never per-user in the first place. collectionAwards is intentionally
 * left empty: issue #450 established personal_nominations as the durable
 * award authority, with the legacy director/franchise collection
 * brackets now compatibility-only, not the live source a fresh public
 * profile reader should query.
 */

(function () {
  let PAGE_SIZE = 1000;
  let FILTER_CHUNK_SIZE = 100;
  let RANK_FIELD_BY_SCOPE_TYPE = {
    years: "yearRank",
    decades: "decadeRank",
    centuries: "centuryRank",
    allTime: "allTimeRank",
  };

  function posterFromUrl(url, tmdbId) {
    return url
      ? {
          url,
          source: "tmdb",
          sourceUrl: "",
          providerId: tmdbId != null ? String(tmdbId) : "",
          fetchedAt: "",
        }
      : null;
  }

  async function fetchAllPages(buildPage) {
    let rows = [];
    while (true) {
      let from = rows.length;
      let result = await buildPage(from, from + PAGE_SIZE - 1);
      if (result.error) throw result.error;
      let page = result.data || [];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  function chunks(values) {
    let result = [];
    for (let index = 0; index < values.length; index += FILTER_CHUNK_SIZE)
      result.push(values.slice(index, index + FILTER_CHUNK_SIZE));
    return result;
  }

  /**
   * Queries every table this reader needs for one published profile.
   * Separate, narrow selects (not one giant embedded query) so a missing
   * optional section (a user with no personal awards yet, say) can't fail
   * the whole fetch.
   * @param {Object} client Supabase client.
   * @param {string} slug Published profile slug.
   * @returns {Promise<Object>} Raw rows by section.
   */
  window.fetchSupabasePublicProfileSource = async function (client, slug) {
    let [profileResult, films, rankings, awards, tags] = await Promise.all([
      client
        .from("profiles")
        .select("id, public_slug, display_name")
        .eq("public_slug", slug)
        .maybeSingle(),
      fetchAllPages((from, to) =>
        client
          .from("public_watched_films")
          .select("*")
          .eq("public_slug", slug)
          .order("year")
          .order("title")
          .order("film_id")
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        client
          .from("public_rankings")
          .select("*")
          .eq("public_slug", slug)
          .order("scope_type")
          .order("scope")
          .order("position")
          .order("film_id")
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        client
          .from("public_personal_awards")
          .select("*")
          .eq("public_slug", slug)
          .order("nomination_id")
          .order("recipient_name")
          .range(from, to),
      ),
      fetchAllPages((from, to) =>
        client
          .from("public_profile_tags")
          .select("*")
          .eq("public_slug", slug)
          .order("film_id")
          .order("name")
          .range(from, to),
      ),
    ]);
    if (profileResult.error) throw profileResult.error;
    return {
      profile: profileResult.data,
      films,
      rankings,
      awards,
      tags,
    };
  };

  /**
   * Resolves director names for a set of films from the already
   * anon-readable `credits`/`people` tables (issue #405's original
   * projection opened both) - `public_watched_films` itself carries no
   * credit info, so this is a second, narrow query rather than a wider
   * view.
   * @param {Object} client Supabase client.
   * @param {string[]} filmIds Film ids to resolve directors for.
   * @returns {Promise<Map<string, string[]>>} filmId -> director names.
   */
  async function fetchDirectorsByFilm(client, filmIds) {
    let directors = new Map();
    if (!filmIds.length) return directors;
    for (let filmIdChunk of chunks(filmIds)) {
      let rows = await fetchAllPages((from, to) =>
        client
          .from("credits")
          .select("film_id, role, billing_order, people(name)")
          .in("film_id", filmIdChunk)
          .eq("role", "director")
          .order("film_id")
          .order("billing_order")
          .range(from, to),
      );
      rows.forEach((row) => {
        let name = row.people?.name;
        if (!name) return;
        let list = directors.get(row.film_id) || [];
        list.push(name);
        directors.set(row.film_id, list);
      });
    }
    return directors;
  }

  async function fetchFranchisesByFilm(client, filmIds) {
    let byFilm = new Map();
    if (!filmIds.length) return byFilm;
    let franchises = await fetchAllPages((from, to) =>
      client
        .from("franchises")
        .select("id, name, parent_id")
        .order("id")
        .range(from, to),
    );
    let franchiseById = new Map(franchises.map((row) => [row.id, row]));
    for (let filmIdChunk of chunks(filmIds)) {
      let memberships = await fetchAllPages((from, to) =>
        client
          .from("film_franchises")
          .select("film_id, franchise_id, position")
          .in("film_id", filmIdChunk)
          .order("film_id")
          .order("position")
          .range(from, to),
      );
      memberships.forEach((membership) => {
        let franchise = franchiseById.get(membership.franchise_id);
        if (!franchise) return;
        let parentChainIds = [];
        let parentChainNames = [];
        let current = franchise;
        let guard = 0;
        while (current?.parent_id && guard++ < 20) {
          let parent = franchiseById.get(current.parent_id);
          if (!parent) break;
          parentChainIds.unshift(parent.id);
          parentChainNames.unshift(parent.name);
          current = parent;
        }
        let parentId = franchise.parent_id || "";
        let parentName = parentId
          ? franchiseById.get(parentId)?.name || ""
          : "";
        let list = byFilm.get(membership.film_id) || [];
        list.push({
          id: franchise.id,
          name: franchise.name,
          parentId,
          parentName,
          parentIds: parentId ? [parentId] : [],
          parentNames: parentId ? [parentName] : [],
          parentChainIds,
          parentChainNames,
          rank: membership.position ?? null,
        });
        byFilm.set(membership.film_id, list);
      });
    }
    return byFilm;
  }

  /**
   * Builds `{years, watchedFilms}` - buildPublicProjection()'s two
   * per-film input sections - from the raw Supabase rows. Bucketing
   * mirrors the app's own established rule (README's Award Model
   * section, `posters.js`'s bucket-reclassification): a real "Film"
   * belongs in the year archive, anything else (documentary/TV/short/
   * standalone) belongs in the flat watchedFilms ("Other Watched") list.
   * Pure - no Supabase client or DOM - exposed on window so it's directly
   * testable with plain row fixtures, matching
   * supabase-legacy-hydration.js's own established pattern.
   * @param {{films: Object[], rankings: Object[], awards: Object[], tags?: Object[]}} source
   *   `fetchPublicProfileSource()`'s result (minus `profile`).
   * @param {Map<string, string[]>} directorsByFilm From `fetchDirectorsByFilm()`.
   * @param {Map<string, Object[]>} franchisesByFilm From `fetchFranchisesByFilm()`.
   * @returns {{years: Object, watchedFilms: Object[]}}
   */
  window.buildPublicProfileYearsFromSupabase = function (
    source,
    directorsByFilm = new Map(),
    franchisesByFilm = new Map(),
  ) {
    let tagsByFilm = new Map();
    (source.tags || []).forEach((row) => {
      let names = tagsByFilm.get(row.film_id) || [];
      if (!names.includes(row.name)) names.push(row.name);
      tagsByFilm.set(row.film_id, names);
    });
    let filmsById = new Map();
    source.films.forEach((row) => {
      let directors = directorsByFilm.get(row.film_id) || [];
      filmsById.set(row.film_id, {
        id: row.film_id,
        title: row.title,
        year: row.year != null ? String(row.year) : "",
        tmdbId: row.tmdb_id != null ? String(row.tmdb_id) : "",
        director: directors.join(", "),
        directors,
        country: row.country || "",
        primaryCountry: row.primary_country || "",
        medium: row.medium || "unknown",
        screenplayType: row.screenplay_type || "unknown",
        adaptationSource: row.adaptation_source || "",
        swedishTitle: row.swedish_title || "",
        type: row.type || "",
        runtimeMinutes: row.runtime_minutes || null,
        letterboxdUrl: row.letterboxd_url || "",
        poster: posterFromUrl(row.poster_url, row.tmdb_id),
        ratingValue: row.rating != null ? Number(row.rating) : null,
        ratingModifier: row.rating_modifier || "",
        rating:
          row.rating != null
            ? window.renderFilmRating?.({
                ratingValue: Number(row.rating),
                ratingModifier: row.rating_modifier || "",
              }) || ""
            : "",
        awards: [],
        tags: tagsByFilm.get(row.film_id) || [],
        franchises: franchisesByFilm.get(row.film_id) || [],
      });
    });

    let allTimeFilms = [];
    // Positions are fractional/lexicographic sort keys, not rank numbers -
    // assign 1-based ranks per individual scope by sorted position order,
    // matching supabase-legacy-hydration.js's own index-based approach.
    let byScope = new Map();
    source.rankings.forEach((entry) => {
      if (!filmsById.has(entry.film_id)) return;
      let key = `${entry.scope_type}\u0000${entry.scope}`;
      let list = byScope.get(key) || [];
      list.push(entry);
      byScope.set(key, list);
    });
    byScope.forEach((entries) => {
      let scopeType = entries[0]?.scope_type;
      let rankField = RANK_FIELD_BY_SCOPE_TYPE[scopeType];
      entries
        .slice()
        .sort((a, b) =>
          a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
        )
        .forEach((entry, index) => {
          let film = filmsById.get(entry.film_id);
          if (rankField) film[rankField] = index + 1;
          film.rankConfirmed = entry.rank_confirmed !== false;
          film.suppressAllTimeRank = Boolean(entry.suppress_all_time_rank);
          if (entry.tie_group_id) {
            film.rankingGroupId = entry.tie_group_id;
            film.rankingGroupTitle = entry.tie_group_title || "";
          }
          if (scopeType === "allTime") allTimeFilms.push(film);
        });
    });

    let awardsByNomination = new Map();
    source.awards.forEach((row) => {
      if (!filmsById.has(row.film_id)) return;
      let award = awardsByNomination.get(row.nomination_id);
      if (!award) {
        award = {
          filmId: row.film_id,
          category: row.category,
          placement: row.placement,
          year: row.scope,
          periodType: row.scope_type,
          recipients: [],
          recipientText: "",
          detail: row.detail || "",
        };
        awardsByNomination.set(row.nomination_id, award);
      }
      if (
        row.recipient_name &&
        !award.recipients.some((entry) => entry.name === row.recipient_name)
      )
        award.recipients.push({
          name: row.recipient_name,
          personId:
            row.person_id ||
            window.normalizePersonName?.(row.recipient_name) ||
            row.recipient_name,
        });
    });
    awardsByNomination.forEach((award) => {
      let film = filmsById.get(award.filmId);
      delete award.filmId;
      award.recipientText = award.recipients
        .map((recipient) => recipient.name)
        .join(", ");
      film.awards.push(award);
    });

    let years = {};
    let watchedFilms = [];
    filmsById.forEach((film) => {
      if (film.type === "Film" && /^\d{4}$/.test(film.year)) {
        years[film.year] ||= { films: [] };
        years[film.year].films.push(film);
      } else {
        watchedFilms.push(film);
      }
    });
    if (allTimeFilms.length)
      years.alltime = { periodType: "allTime", films: allTimeFilms };
    return { years, watchedFilms };
  };

  /**
   * Loads one published profile straight from Supabase and hydrates it
   * into browsable state. Immutable Community revisions use the separate
   * static-JSON helpers in public-profile.js.
   * Same result contract: `{ok:true, meta}` or `{ok:false, error, detail}`.
   * @param {string} slug Profile slug to load.
   * @returns {Promise<{ok: boolean, meta?: Object, error?: string, detail?: string}>}
   */
  window.loadSupabasePublicProfile = async function (slug) {
    let ready = await window.ensureSupabaseClient?.();
    if (!ready) return { ok: false, error: "offline" };
    let source;
    try {
      source = await window.fetchSupabasePublicProfileSource(
        ready.client,
        slug,
      );
    } catch (err) {
      return {
        ok: false,
        error: "unavailable",
        detail: String(err?.message || err),
      };
    }
    if (!source.profile) return { ok: false, error: "not-found" };
    let directorsByFilm;
    let franchisesByFilm;
    try {
      let filmIds = source.films.map((row) => row.film_id);
      [directorsByFilm, franchisesByFilm] = await Promise.all([
        fetchDirectorsByFilm(ready.client, filmIds),
        fetchFranchisesByFilm(ready.client, filmIds),
      ]);
    } catch (err) {
      return {
        ok: false,
        error: "unavailable",
        detail: String(err?.message || err),
      };
    }
    let { years, watchedFilms } = window.buildPublicProfileYearsFromSupabase(
      source,
      directorsByFilm,
      franchisesByFilm,
    );
    let projection = window.buildPublicProjection(
      {
        years,
        watchedFilms,
        officialResults: window.OSKARS_BUNDLED_OFFICIAL_RESULTS || {},
      },
      {},
    );
    try {
      window.hydratePublicProfileState(projection, {
        slug,
        ownerName: source.profile.display_name || slug,
        revision: "",
        publishedAt: "",
      });
    } catch (err) {
      return {
        ok: false,
        error: "invalid",
        detail: String(err?.message || err),
      };
    }
    return { ok: true, meta: window.state.publicProfileMeta };
  };
})();
