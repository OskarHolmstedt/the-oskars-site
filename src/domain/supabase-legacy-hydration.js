/**
 * @file Reshapes the raw Supabase rows from
 * `window.loadSupabaseLegacyHydrationSource()` into the same `window.state`
 * shape (`state.years`, `state.watchlist`, `state.publicProfileDisplayName`)
 * the established page controllers already expect - so their
 * existing, already-tested rendering logic (and `rebuildAggregates()`,
 * `rebuildPeopleIndex()`, `rebuildFranchiseIndex()`, all pure functions over
 * `window.state`) keeps working unmodified, just fed by Supabase data
 * instead of Firestore/IndexedDB (issues #438, #440). It also builds the
 * existing shared-film discovery contract from Supabase catalog rows. Pure
 * and Node-testable - no Supabase client, no DOM.
 *
 * Deliberately does not populate `state.watchedOther`, `state.projects`,
 * `state.entityNotes`, `state.localRanks`, `state.watchlistProjectSources`,
 * `state.declinedOfficialWatchlistAdds`, `state.franchiseLinks`,
 * `state.rejectedPersonAliases`, or `state.opinionRebuildSession` - each
 * either has no Supabase table yet or belongs to a collection-page cutover
 * tracked separately by issue #439.
 */

(function () {
  let RANK_FIELD_BY_SCOPE_TYPE = {
    years: "yearRank",
    decades: "decadeRank",
    centuries: "centuryRank",
    allTime: "allTimeRank",
  };

  /**
   * Returns the state that the entry loader has already hydrated from
   * Supabase. This preserves established controller startup calls without
   * installing the IndexedDB-backed persistence module on hydrated routes.
   * @returns {Promise<Object>} The current hydrated application state.
   */
  window.load = async function () {
    return window.state;
  };

  /**
   * Reshapes the shared Supabase film catalog into the discovery archive
   * contract used by period Shared view, global search, and preview pages.
   * @param {Object[]} films Raw shared `films` rows with credit joins.
   * @returns {Record<string, Object>} TMDB-id-keyed shared film records.
   */
  window.buildSharedFilmArchiveFromSupabase = function (films) {
    let archive = {};
    (films || []).forEach((film) => {
      let tmdbId = String(film.tmdb_id || "");
      if (!tmdbId) return;
      let people = {};
      (film.credits || []).forEach((credit) => {
        let name = credit.people?.name;
        if (!name) return;
        let id = window.normalizePersonName?.(name) || name;
        let profession =
          credit.role === "director"
            ? "Director"
            : String(credit.role || "").trim();
        if (!profession) return;
        people[id] ||= { name, professions: [] };
        if (!people[id].professions.includes(profession))
          people[id].professions.push(profession);
      });
      archive[tmdbId] = {
        id: film.id,
        tmdbId,
        title: film.title,
        year: film.year != null ? String(film.year) : "",
        poster: film.poster_url
          ? {
              url: film.poster_url,
              source: "tmdb",
              sourceUrl: "",
              providerId: tmdbId,
              fetchedAt: "",
            }
          : null,
        country: film.country || "",
        primaryCountry: film.primary_country || "",
        runtimeMinutes: film.runtime_minutes || null,
        swedishTitle: film.swedish_title || "",
        medium: film.medium || "unknown",
        type: film.type || "",
        screenplayType: film.screenplay_type || "unknown",
        adaptationSource: film.adaptation_source || "",
        letterboxdUrl: film.letterboxd_url || "",
        people,
      };
    });
    return archive;
  };

  /**
   * Builds an id -> franchise row map plus a parent-chain walker, from the
   * full franchise catalog (not just what's embedded per film, so a chain
   * resolves correctly even through an ancestor with no film of its own).
   * @param {Object[]} franchiseRows Raw `franchises` rows (id, name, parent_id).
   * @returns {{byId: Map, chainFor: function}}
   */
  function buildFranchiseChains(franchiseRows) {
    let byId = new Map();
    (franchiseRows || []).forEach((row) => byId.set(row.id, row));
    function chainFor(id) {
      let ids = [];
      let names = [];
      let current = byId.get(id);
      let guard = 0;
      while (current?.parent_id && guard++ < 20) {
        let parent = byId.get(current.parent_id);
        if (!parent) break;
        ids.unshift(parent.id);
        names.unshift(parent.name);
        current = parent;
      }
      return { ids, names };
    }
    return { byId, chainFor };
  }
  // Exposed for other Supabase-backed pages that reshape a single film's
  // franchise memberships outside the bulk hydration pass (e.g. film.js's
  // watchlisted-detail branch, issue #439/#457).
  window.buildSupabaseFranchiseChains = buildFranchiseChains;

  /**
   * Reshapes one embedded `film_franchises` row into a `FranchiseMembership`.
   * @param {Object} membership Raw `{franchises: {id, name, parent_id}}` row.
   * @param {{byId: Map, chainFor: function}} chains From `buildFranchiseChains`.
   * @returns {Object|null}
   */
  function reshapeFranchiseMembership(membership, chains) {
    let franchise = membership?.franchises;
    if (!franchise) return null;
    let { ids: parentChainIds, names: parentChainNames } = chains.chainFor(
      franchise.id,
    );
    let parentId = franchise.parent_id || "";
    let parentName = parentId ? chains.byId.get(parentId)?.name || "" : "";
    return {
      id: franchise.id,
      name: franchise.name,
      parentId,
      parentName,
      parentIds: parentId ? [parentId] : [],
      parentNames: parentId ? [parentName] : [],
      parentChainIds,
      parentChainNames,
      rank: null,
    };
  }

  /**
   * Reshapes one Supabase `films` row (with embedded credits/tags/
   * franchises) into the shared, opinion-free part of a `FilmRecord`.
   * @param {Object} film Raw `films` row.
   * @param {{byId: Map, chainFor: function}} chains From `buildFranchiseChains`.
   * @returns {Object} Partial FilmRecord.
   */
  function reshapeSharedFilmFields(film, chains) {
    let directors = (film.credits || [])
      .filter((credit) => credit.role === "director")
      .map((credit) => credit.people?.name)
      .filter(Boolean);
    let tags = (film.film_tags || [])
      .map((entry) => entry.tags?.name)
      .filter(Boolean);
    let franchises = (film.film_franchises || [])
      .map((entry) => reshapeFranchiseMembership(entry, chains))
      .filter(Boolean);
    return {
      // Overwritten by addFilmToStore()'s own makeFilmId() for every
      // caller that runs through rebuildAggregates() (the 15 read-only
      // pages, issue #438) - kept as the real Supabase id for callers
      // that render these records directly without that pipeline
      // (tag.html, issue #439), so shared film-card/table helpers'
      // default filmPageUrl(film.id) link resolves once film.html itself
      // cuts over to Supabase and starts using the same real ids.
      id: film.id,
      supabaseFilmId: film.id,
      title: film.title,
      year: film.year != null ? String(film.year) : "",
      director: directors.join(", "),
      directors,
      tmdbId: film.tmdb_id != null ? String(film.tmdb_id) : "",
      country: film.country || "",
      primaryCountry: film.primary_country || "",
      medium: film.medium || "unknown",
      screenplayType: film.screenplay_type || "unknown",
      adaptationSource: film.adaptation_source || "",
      swedishTitle: film.swedish_title || "",
      type: film.type || "",
      runtimeMinutes: film.runtime_minutes || null,
      letterboxdUrl: film.letterboxd_url || "",
      poster: film.poster_url
        ? {
            url: film.poster_url,
            source: "tmdb",
            sourceUrl: "",
            providerId: film.tmdb_id != null ? String(film.tmdb_id) : "",
            fetchedAt: "",
          }
        : null,
      tags,
      franchises,
      awards: [],
    };
  }

  /**
   * Reshapes one `watched` row (with its joined `films`) into a `FilmRecord`
   * - rank fields and awards are attached in later passes.
   * @param {Object} row Raw `watched` row.
   * @param {{byId: Map, chainFor: function}} chains From `buildFranchiseChains`.
   * @returns {Object|null}
   */
  window.supabaseLegacyHydrationFilmFromWatched = function (row, chains) {
    if (!row?.films) return null;
    let record = reshapeSharedFilmFields(row.films, chains);
    record.supabaseWatchedId = row.id;
    record.supabaseWatchedUpdatedAt = row.updated_at || "";
    if (row.rating != null) {
      record.ratingValue = Number(row.rating);
      record.ratingModifier = row.rating_modifier || "";
      record.rating = window.renderFilmRating?.(record) || "";
    }
    record.dateWatched = row.date_watched || "";
    record.review = row.review || "";
    record.wantToRewatch = Boolean(row.want_to_rewatch);
    record.rewatchTier = row.rewatch_tier || "";
    record.musicScore = row.music_score || "";
    record.musicRating = row.music_rating || "";
    record.musicRatingValue = row.music_rating_value ?? null;
    record.views = row.views || null;
    record.platform = row.platform || "";
    return record;
  };

  /**
   * Reshapes one `watchlist` row (with its joined `films`) into a
   * `WatchlistItem`, using its array position (already sorted ascending by
   * the fractional `position` key) as the legacy numeric `order` - 1-based,
   * matching every other WatchlistItem producer in the codebase
   * (watchlists.js/watched-films.js's own `index + 1`). compareWatchlistItemsBy's
   * default "order" sort does `Number(item.order || 999999)` - a 0-based
   * first item would be falsy-zero'd into sorting dead last instead of
   * first, a real bug found live via tag.html's watchlist-reorder
   * verification (issue #439) that would have equally affected every
   * already-shipped #438 hydrated page's watchlist rendering.
   * @param {Object} row Raw `watchlist` row.
   * @param {number} index Position in the already-ordered watchlist array.
   * @param {{byId: Map, chainFor: function}} chains From `buildFranchiseChains`.
   * @returns {Object|null}
   */
  window.supabaseLegacyHydrationWatchlistItem = function (row, index, chains) {
    if (!row?.films) return null;
    let shared = reshapeSharedFilmFields(row.films, chains);
    return {
      id: row.id,
      supabaseFilmId: shared.supabaseFilmId,
      supabaseWatchlistUpdatedAt: row.updated_at || "",
      supabaseWatchlistPosition: row.position || "",
      title: shared.title,
      year: shared.year,
      letterboxdUrl: shared.letterboxdUrl,
      added: row.added_at ? String(row.added_at).slice(0, 10) : "",
      tmdbId: shared.tmdbId,
      swedishTitle: shared.swedishTitle,
      tier: row.tier || "",
      order: index + 1,
      director: shared.director,
      directors: shared.directors,
      country: shared.country,
      medium: shared.medium,
      screenplayType: shared.screenplayType,
      runtimeMinutes: shared.runtimeMinutes,
      adaptationSource: shared.adaptationSource,
      platform: "",
      tags: shared.tags,
      franchises: shared.franchises,
      poster: shared.poster,
    };
  };

  /**
   * Builds `{years, watchlist, publicProfileDisplayName}` from raw Supabase
   * rows - the exact fields `window.state` needs assigned before
   * `rebuildAggregates()` runs. Pure; call sites own actually mutating
   * `window.state` and calling `rebuildAggregates()` afterward.
   * @param {Object} source Result of `window.loadSupabaseLegacyHydrationSource()`.
   * @returns {{years: Object, watchlist: Object[], publicProfileDisplayName: string}}
   */
  window.buildLegacyStateFromSupabaseHydration = function (source) {
    let chains = buildFranchiseChains(source.franchises);
    let filmsBySupabaseId = new Map();

    (source.watched || []).forEach((row) => {
      let film = window.supabaseLegacyHydrationFilmFromWatched(row, chains);
      if (film) filmsBySupabaseId.set(film.supabaseFilmId, film);
    });

    let allTimeFilms = [];
    (source.rankings || []).forEach((ranking) => {
      let rankField = RANK_FIELD_BY_SCOPE_TYPE[ranking.scope_type];
      (ranking.ranking_entries || []).forEach((entry, index) => {
        let film = filmsBySupabaseId.get(entry.film_id);
        if (!film) return;
        if (rankField) film[rankField] = index + 1;
        film.rankConfirmed = entry.rank_confirmed !== false;
        film.suppressAllTimeRank = Boolean(entry.suppress_all_time_rank);
        if (entry.tie_group_id) {
          film.rankingGroupId = entry.tie_group_id;
          film.rankingGroupTitle = entry.tie_group_title || "";
        }
        if (ranking.scope_type === "allTime") allTimeFilms.push(film);
      });
    });

    (source.personalAwards || []).forEach((award) => {
      (award.personal_nominations || []).forEach((nomination) => {
        let film = filmsBySupabaseId.get(nomination.film_id);
        if (!film) return;
        let recipients = (nomination.personal_nomination_recipients || []).map(
          (recipient) => ({
            name: recipient.recipient_name,
            personId:
              window.normalizePersonName?.(recipient.recipient_name) ||
              recipient.recipient_name,
          }),
        );
        film.awards.push({
          supabaseNominationId: nomination.id || "",
          category: nomination.category,
          placement: nomination.placement,
          year: award.scope,
          periodType: award.scope_type,
          recipients,
          recipientText: recipients.map((r) => r.name).join(", "),
          detail: nomination.detail || "",
        });
      });
    });

    let years = {};
    filmsBySupabaseId.forEach((film) => {
      if (!film.year) return;
      years[film.year] ||= { films: [] };
      years[film.year].films.push(film);
    });
    years.alltime = { periodType: "allTime", films: allTimeFilms };

    let watchlist = (source.watchlist || [])
      .map((row, index) =>
        window.supabaseLegacyHydrationWatchlistItem(row, index, chains),
      )
      .filter(Boolean);

    return {
      years,
      watchlist,
      publicProfileDisplayName: source.profile?.display_name || "",
    };
  };
})();
