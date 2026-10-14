/** @file Owns scoped rankings, local collection orders, and ranking review persistence. */

(function () {
  /** Reports whether a joined film can participate in feature-film rankings. @param {Object} entry Watched row or ranking entry joined with its film. @returns {boolean} Whether the title is eligible. */
  window.supabaseRankingFilmEligible = function (entry) {
    return (
      String(entry?.films?.type || "")
        .trim()
        .toLowerCase() !== "short"
    );
  };

  const RANKING_ENTRY_SELECT =
    "film_id, position, rank_confirmed, tie_group_id, films(id, tmdb_id, tmdb_tv_ref, title, year, type, poster_url)";

  /**
   * Finds or creates one account-scoped ranking under the unique owner, scope type, and scope constraint.
   * @param {Object} client Ready Supabase client.
   * @param {string} scope
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @returns {Promise<string>} The ranking row's id.
   */
  async function getOrCreateSupabaseRankingId(client, scope, scopeType) {
    let { data: existing, error: selectError } = await client
      .from("rankings")
      .select("id")
      .eq("scope", scope)
      .eq("scope_type", scopeType)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing.id;

    let { data: created, error: insertError } = await client
      .from("rankings")
      .insert({ scope, scope_type: scopeType })
      .select("id")
      .single();
    if (insertError) {
      if (insertError.code === "23505") {
        let { data: retryExisting, error: retryError } = await client
          .from("rankings")
          .select("id")
          .eq("scope", scope)
          .eq("scope_type", scopeType)
          .single();
        if (retryError) throw retryError;
        return retryExisting.id;
      }
      throw insertError;
    }
    return created.id;
  }

  /**
   * Loads the signed-in user's ranking entries for one scope, ordered by
   * position, joined with films. Not cached - a fresh fetch every call,
   * left to the caller (a page-local variable, same as
   * rate-watched-supabase.js's queue) rather than a shared session cache.
   * @param {string} scope
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @returns {Promise<{rankingId: string, entries: Object[]}|{rankingId: null, entries: []}>}
   */
  window.loadSupabaseRanking = async function (scope, scopeType) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in")
      return { rankingId: null, entries: [] };

    let rankingId = await getOrCreateSupabaseRankingId(
      ready.client,
      scope,
      scopeType,
    );
    let entries = await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) =>
        ready.client
          .from("ranking_entries")
          .select(
            RANKING_ENTRY_SELECT,
            withCount ? { count: "exact" } : undefined,
          )
          .eq("ranking_id", rankingId)
          .order("position")
          .order("film_id"),
    );
    return {
      rankingId,
      entries: entries.filter(window.supabaseRankingFilmEligible),
    };
  };

  /**
   * Loads existing ranking scopes with fully paged entries, without creating empty rankings.
   * @returns {Promise<Object[]>} Rankings with ordered film entries.
   */
  window.loadSupabaseStoredRankings = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let [rankings, entries] = await Promise.all([
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        ready.client
          .from("rankings")
          .select(
            "id, scope, scope_type",
            withCount ? { count: "exact" } : undefined,
          )
          .order("id"),
      ),
      window.supabaseWorkspaceContext.fetchAllSupabaseRows((withCount) =>
        ready.client
          .from("ranking_entries")
          .select(
            `ranking_id, ${RANKING_ENTRY_SELECT}`,
            withCount ? { count: "exact" } : undefined,
          )
          .order("ranking_id")
          .order("position")
          .order("film_id"),
      ),
    ]);
    let byRanking = new Map();
    entries.forEach((entry) => {
      if (!byRanking.has(entry.ranking_id)) byRanking.set(entry.ranking_id, []);
      byRanking.get(entry.ranking_id).push(entry);
    });
    return rankings.map((ranking) => ({
      ...ranking,
      ranking_entries: (byRanking.get(ranking.id) || []).filter(
        window.supabaseRankingFilmEligible,
      ),
    }));
  };

  /**
   * Prepares the selected period's own ranking, carrying narrower ordering forward provisionally.
   * @param {string} scope Period key.
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType Period type.
   * @param {Object[]} watched Watched rows joined with films.
   * @returns {Promise<{rankingId: string, entries: Object[]}>} Selected ranking.
   */
  window.prepareSupabasePeriodRanking = async function (
    scope,
    scopeType,
    watched,
  ) {
    let loaded = await window.loadSupabaseRanking(scope, scopeType);
    let watchedById = new Map(watched.map((row) => [row.film_id, row]));
    let eligible = watched.filter((row) =>
      window.supabaseRankingEntryInScope(scopeType, scope, row),
    );
    let existingIds = new Set(loaded.entries.map((entry) => entry.film_id));
    let missing = eligible.some(
      (row) =>
        window.supabaseRankingRatingKey(row) && !existingIds.has(row.film_id),
    );
    let sourceEntries = [];
    if (missing) {
      let stored = await window.loadSupabaseStoredRankings();
      let narrower = {
        years: "allTime",
        decades: "years",
        centuries: "decades",
        allTime: "centuries",
      }[scopeType];
      sourceEntries = stored
        .filter((ranking) => ranking.scope_type === narrower)
        .sort((a, b) => a.scope.localeCompare(b.scope))
        .flatMap((ranking) => ranking.ranking_entries);
    }
    if (
      await window.seedSupabaseYearRanking(
        loaded.rankingId,
        loaded.entries,
        eligible,
        null,
        sourceEntries,
      )
    ) {
      loaded = await window.loadSupabaseRanking(scope, scopeType);
    }
    // A year shelf with one film has no ordering decision to make. Broader
    // scopes require explicit confirmation even when they contain one film.
    if (scopeType === "years") {
      let byId = new Map(eligible.map((row) => [row.film_id, row]));
      let buckets = new Map();
      loaded.entries.forEach((entry) => {
        let key = window.supabaseRankingRatingKey(byId.get(entry.film_id));
        if (!key) return;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
      });
      let singles = [...buckets.values()]
        .filter(
          (group) => group.length === 1 && group[0].rank_confirmed === false,
        )
        .flat();
      if (singles.length) {
        await window.confirmSupabaseRankingEntries(
          loaded.rankingId,
          singles.map((entry) => entry.film_id),
        );
        loaded = await window.loadSupabaseRanking(scope, scopeType);
      }
    }
    return {
      ...loaded,
      entries: loaded.entries.filter((entry) =>
        window.supabaseRankingFilmEligible(
          watchedById.get(entry.film_id) || entry,
        ),
      ),
    };
  };

  /**
   * Confirms the specified films in one ranking without changing other scopes.
   * @param {string} rankingId Selected ranking id.
   * @param {string[]} filmIds Films deliberately ordered in that ranking.
   */
  window.confirmSupabaseRankingEntries = async function (rankingId, filmIds) {
    if (!filmIds.length) return;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    // Keep PostgREST filter URLs bounded even for an all-time list with thousands of films.
    for (let index = 0; index < filmIds.length; index += 100) {
      let { error } = await ready.client
        .from("ranking_entries")
        .update({ rank_confirmed: true })
        .eq("ranking_id", rankingId)
        .in("film_id", filmIds.slice(index, index + 100));
      if (error) throw error;
    }
  };

  /**
   * Seeds missing rated watched films into a selected ranking’s exact-rating shelves without changing existing entries.
   * @param {string} rankingId Selected ranking id.
   * @param {Object[]} entries Existing ordered ranking entries.
   * @param {Object[]} watched Watched rows joined with films.
   * @param {string|null} year Selected year, or null for prefiltered period rows.
   * @param {Object[]} [sourceEntries] Preferred order inherited from a narrower period.
   * @returns {Promise<boolean>} Whether missing entries were submitted.
   */
  window.seedSupabaseYearRanking = async function (
    rankingId,
    entries,
    watched,
    year,
    sourceEntries = [],
  ) {
    let preferred = new Map(
      sourceEntries.map((entry, index) => [entry.film_id, index]),
    );
    let byId = new Map(watched.map((row) => [row.film_id, row]));
    let rankedIds = new Set(entries.map((entry) => entry.film_id));
    let ratingValue = (row) =>
      window.supabaseRankingRatingSortValueFromKey(
        window.supabaseRankingRatingKey(row),
      );
    let missing = watched
      .filter(
        (row) =>
          window.supabaseRankingFilmEligible(row) &&
          (year === null || String(row.films?.year) === String(year)) &&
          window.supabaseRankingRatingKey(row) &&
          !rankedIds.has(row.film_id),
      )
      .sort(
        (a, b) =>
          ratingValue(b) - ratingValue(a) ||
          (preferred.get(a.film_id) ?? Infinity) -
            (preferred.get(b.film_id) ?? Infinity) ||
          a.film_id.localeCompare(b.film_id),
      );
    if (!missing.length) return false;
    let ordered = entries.slice();
    let additions = [];
    for (let row of missing) {
      if (rankedIds.has(row.film_id)) continue;
      let index = ordered.findIndex(
        (entry) => ratingValue(byId.get(entry.film_id)) < ratingValue(row),
      );
      if (index < 0) index = ordered.length;
      let entry = {
        ranking_id: rankingId,
        film_id: row.film_id,
        position: window.fractionalPositionBetween(
          ordered[index - 1]?.position || null,
          ordered[index]?.position || null,
        ),
        rank_confirmed: false,
      };
      ordered.splice(index, 0, entry);
      additions.push(entry);
      rankedIds.add(row.film_id);
    }
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("ranking_entries")
      .upsert(additions, {
        onConflict: "ranking_id,film_id",
        ignoreDuplicates: true,
      });
    if (error) throw error;
    return true;
  };

  /**
   * Adds a film to the end of a scope's ranking, straight through to
   * Supabase. Position uses the same simple monotonic base-36 timestamp
   * scheme addToSupabaseWatchlist() uses - always sorts after every
   * existing entry, no fractional-index gap management.
   * @param {string} scope
   * @param {string} filmId
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   */
  window.addToSupabaseRanking = async function (scope, filmId, scopeType) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let rankingId = await getOrCreateSupabaseRankingId(
      ready.client,
      scope,
      scopeType,
    );
    let { error } = await ready.client.from("ranking_entries").insert({
      ranking_id: rankingId,
      film_id: filmId,
      position: Date.now().toString(36),
    });
    if (error) throw error;
  };

  /** Inserts or moves an Intake film at a chosen gap in one ranking. @param {string} rankingId Ranking row id. @param {Object[]} entries Full ordered ranking. @param {string} filmId Intake film id. @param {string|null} targetFilmId Comparison target, or null for an empty cohort. @param {'before'|'after'} position Side of the comparison target. @returns {Promise<string>} New sort key. */
  window.placeSupabaseIntakeRankingFilm = async function (
    rankingId,
    entries,
    filmId,
    targetFilmId,
    position,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let withoutTarget = (entries || []).filter(
      (entry) => entry.film_id !== filmId,
    );
    let insertionIndex = withoutTarget.length;
    if (targetFilmId) {
      let targetIndex = withoutTarget.findIndex(
        (entry) => entry.film_id === targetFilmId,
      );
      if (targetIndex < 0)
        throw new Error("The comparison film is no longer ranked.");
      insertionIndex = targetIndex + (position === "after" ? 1 : 0);
    }
    let before = withoutTarget[insertionIndex - 1]?.position || null;
    let after = withoutTarget[insertionIndex]?.position || null;
    let newPosition = window.fractionalPositionBetween(before, after);
    let { error } = await ready.client.from("ranking_entries").upsert(
      {
        ranking_id: rankingId,
        film_id: filmId,
        position: newPosition,
        rank_confirmed: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ranking_id,film_id" },
    );
    if (error) throw error;
    return newPosition;
  };

  /**
   * Moves one ranking entry up or down by swapping its `position` value
   * with its immediate neighbor's - the minimal reorder operation that
   * proves the wiring pattern without needing a fractional-indexing
   * scheme. No optimistic-concurrency check on this swap (unlike
   * setSupabaseWatchedRating) - a deliberate scope cut for this PoC, not
   * an oversight; that guarantee is already proven elsewhere.
   * @param {string} rankingId
   * @param {Object[]} entries The full ordered list loadSupabaseRanking() returned.
   * @param {string} filmId The entry to move.
   * @param {'up'|'down'} direction
   */
  window.moveSupabaseRankingEntry = async function (
    rankingId,
    entries,
    filmId,
    direction,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");

    let index = entries.findIndex((entry) => entry.film_id === filmId);
    let targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) return;

    let current = entries[index];
    let target = entries[targetIndex];
    let [{ error: firstError }, { error: secondError }] = await Promise.all([
      ready.client
        .from("ranking_entries")
        .update({ position: target.position })
        .eq("ranking_id", rankingId)
        .eq("film_id", current.film_id),
      ready.client
        .from("ranking_entries")
        .update({ position: current.position })
        .eq("ranking_id", rankingId)
        .eq("film_id", target.film_id),
    ]);
    if (firstError) throw firstError;
    if (secondError) throw secondError;
  };

  /**
   * Removes one film from a scope's ranking, straight through to Supabase.
   * @param {string} rankingId
   * @param {string} filmId
   */
  window.removeFromSupabaseRanking = async function (rankingId, filmId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error } = await ready.client
      .from("ranking_entries")
      .delete()
      .eq("ranking_id", rankingId)
      .eq("film_id", filmId);
    if (error) throw error;
  };

  const LOCAL_RANK_FILM_SELECT =
    "id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, medium, type";

  /**
   * Resolves a local-rank collection's display name and current films in stable alphabetical title order.
   * @param {'person'|'tag'} kind
   * @param {string} collectionId people.id or tags.id.
   * @returns {Promise<{name: string, films: Object[]}|null>} `null` when
   *   the collection can't be found.
   */
  window.loadSupabaseLocalRankCollectionFilms = async function (
    kind,
    collectionId,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");

    if (kind === "person") {
      let { data: person, error: personError } = await ready.client
        .from("people")
        .select("id, name")
        .eq("id", collectionId)
        .maybeSingle();
      if (personError) throw personError;
      if (!person) return null;
      let { data: credits, error: creditsError } = await ready.client
        .from("credits")
        .select(`film_id, films(${LOCAL_RANK_FILM_SELECT})`)
        .eq("person_id", collectionId)
        .eq("role", "director")
        .order("title", { foreignTable: "films" });
      if (creditsError) throw creditsError;
      return { name: person.name, films: credits.map((row) => row.films) };
    }

    if (kind === "tag") {
      let { data: tag, error: tagError } = await ready.client
        .from("tags")
        .select("id, name")
        .eq("id", collectionId)
        .maybeSingle();
      if (tagError) throw tagError;
      if (!tag) return null;
      let { data: filmTags, error: filmTagsError } = await ready.client
        .from("film_tags")
        .select(`film_id, films(${LOCAL_RANK_FILM_SELECT})`)
        .eq("tag_id", collectionId)
        .order("title", { foreignTable: "films" });
      if (filmTagsError) throw filmTagsError;
      return { name: tag.name, films: filmTags.map((row) => row.films) };
    }

    return null;
  };

  /**
   * Reads the signed-in user's stored explicit order for one local-rank
   * collection.
   * @param {'person'|'tag'} kind
   * @param {string} collectionId
   * @returns {Promise<string[]>} Explicit film ids, in stored order - `[]`
   *   when none stored yet.
   */
  window.loadSupabaseLocalRankOrder = async function (kind, collectionId) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client
      .from("local_ranks")
      .select("film_id")
      .eq("collection_kind", kind)
      .eq("collection_id", collectionId)
      .order("position");
    if (error) throw error;
    return data.map((row) => row.film_id);
  };

  /**
   * Sets the signed-in user's explicit order for one local-rank
   * collection - a full replace (delete then insert), matching
   * local_ranks' composite primary key
   * (user_id, collection_kind, collection_id, film_id) and
   * setLocalRankOrder()'s own full-replace semantics.
   * @param {'person'|'tag'} kind
   * @param {string} collectionId
   * @param {string[]} filmIds New order.
   */
  window.setSupabaseLocalRankOrder = async function (
    kind,
    collectionId,
    filmIds,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { error: deleteError } = await ready.client
      .from("local_ranks")
      .delete()
      .eq("collection_kind", kind)
      .eq("collection_id", collectionId);
    if (deleteError) throw deleteError;

    let ids = (filmIds || []).filter(Boolean);
    if (!ids.length) return;
    let { error: insertError } = await ready.client.from("local_ranks").insert(
      ids.map((film_id, index) => ({
        collection_kind: kind,
        collection_id: collectionId,
        film_id,
        position: String(index).padStart(6, "0"),
      })),
    );
    if (insertError) throw insertError;
  };

  function supabaseRankingPairReviewKey(filmIdA, filmIdB) {
    return [String(filmIdA || ""), String(filmIdB || "")].sort().join("::");
  }

  /**
   * Loads the signed-in user's already-reviewed pair keys for one ranking
   * consistency scope - resumable progress, matching
   * ranking_pair_reviews' role as the durable replacement for the
   * previous window.state.rankingReviews[type][key] array.
   * @param {string} scope
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @returns {Promise<Set<string>>} Pair keys already reviewed.
   */
  window.loadSupabaseRankingPairReviews = async function (scope, scopeType) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") return new Set();

    let { data, error } = await ready.client
      .from("ranking_pair_reviews")
      .select("film_id_a, film_id_b")
      .eq("scope", scope)
      .eq("scope_type", scopeType);
    if (error) throw error;
    return new Set(
      data.map((row) =>
        supabaseRankingPairReviewKey(row.film_id_a, row.film_id_b),
      ),
    );
  };

  /**
   * Records one pair as reviewed without confirming a partially reviewed shelf.
   * Confirmation is explicit for the selected ranking.
   * @param {string} scope
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @param {string} rankingId
   * @param {string} filmIdA
   * @param {string} filmIdB
   */
  window.resolveSupabaseRankingPairReview = async function (
    scope,
    scopeType,
    rankingId,
    filmIdA,
    filmIdB,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let [filmIdLower, filmIdUpper] = [filmIdA, filmIdB].sort();
    let { error: insertError } = await ready.client
      .from("ranking_pair_reviews")
      .upsert(
        {
          scope,
          scope_type: scopeType,
          film_id_a: filmIdLower,
          film_id_b: filmIdUpper,
        },
        { onConflict: "user_id,scope_type,scope,film_id_a,film_id_b" },
      );
    if (insertError) throw insertError;
  };

  /**
   * Reopens one reviewed pair after a session undo.
   * @param {string} scope
   * @param {'years'|'decades'|'centuries'|'allTime'} scopeType
   * @param {string} filmIdA
   * @param {string} filmIdB
   */
  window.reopenSupabaseRankingPairReview = async function (
    scope,
    scopeType,
    filmIdA,
    filmIdB,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let [a, b] = [filmIdA, filmIdB].sort();
    let { error } = await ready.client
      .from("ranking_pair_reviews")
      .delete()
      .eq("scope", scope)
      .eq("scope_type", scopeType)
      .eq("film_id_a", a)
      .eq("film_id_b", b);
    if (error) throw error;
  };

  /**
   * Moves one ranking entry to an arbitrary new position between two given
   * neighbors, using fractionalPositionBetween() - unlike
   * moveSupabaseRankingEntry's adjacent-only swap, this supports real
   * drag-and-drop to any spot in the list, not just moving one step.
   * @param {string} rankingId
   * @param {string} filmId The entry to move.
   * @param {Object[]} entries The full ordered list loadSupabaseRanking() returned (read for beforeFilmId/afterFilmId's current position values).
   * @param {string|null} beforeFilmId Neighbor the entry should sort after, or null to move to the very start.
   * @param {string|null} afterFilmId Neighbor the entry should sort before, or null to move to the very end.
   * @returns {Promise<string>} The entry's new position value.
   */
  window.moveSupabaseRankingEntryToPosition = async function (
    rankingId,
    filmId,
    entries,
    beforeFilmId,
    afterFilmId,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let beforePosition = beforeFilmId
      ? entries.find((entry) => entry.film_id === beforeFilmId)?.position
      : null;
    let afterPosition = afterFilmId
      ? entries.find((entry) => entry.film_id === afterFilmId)?.position
      : null;
    let newPosition = window.fractionalPositionBetween(
      beforePosition,
      afterPosition,
    );
    let { error } = await ready.client
      .from("ranking_entries")
      .update({ position: newPosition })
      .eq("ranking_id", rankingId)
      .eq("film_id", filmId);
    if (error) throw error;
    return newPosition;
  };

  /**
   * Confirms every film in one year's exact-rating bucket as deliberately
   * ordered:
   * marks every entry's rank_confirmed and records every adjacent pair
   * within the bucket as reviewed, so ranking-review.html won't re-ask
   * about a pair already settled here.
   * @param {string} rankingId
   * @param {string} year
   * @param {Object[]} bucketEntries The bucket's entries, in position order.
   * @returns {Promise<{reviewed: number}>}
   */
  window.resolveSupabaseYearRankingBucket = async function (
    rankingId,
    year,
    bucketEntries,
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    if (bucketEntries.length < 2) return { reviewed: 0 };

    let filmIds = bucketEntries.map((entry) => entry.film_id);
    let { error: confirmError } = await ready.client
      .from("ranking_entries")
      .update({ rank_confirmed: true })
      .eq("ranking_id", rankingId)
      .in("film_id", filmIds);
    if (confirmError) throw confirmError;

    let reviewed = 0;
    for (let index = 0; index < bucketEntries.length - 1; index += 1) {
      await window.resolveSupabaseRankingPairReview(
        String(year),
        "years",
        rankingId,
        bucketEntries[index].film_id,
        bucketEntries[index + 1].film_id,
      );
      reviewed += 1;
    }
    return { reviewed };
  };

  /**
   * Loads the caller's ranking entries for a set of films, each carrying
   * its real rank within the whole ranking, shaped like
   * loadSupabaseLegacyHydrationSource()'s `rankings` so
   * buildLegacyStateFromSupabaseHydration() consumes it unchanged. The rank
   * comes from read_ranking_positions() in SQL: a compact read only has
   * these films' own entries, so the client can't derive rank from array
   * position the way the complete read does.
   * @param {string[]} filmIds
   * @returns {Promise<Object[]>} Rankings with nested, rank-ordered entries.
   */
  window.loadSupabaseRankingsForFilms = async function (filmIds) {
    let ids = [...new Set((filmIds || []).filter(Boolean))];
    if (!ids.length) return [];
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let { data, error } = await ready.client.rpc("read_ranking_positions", {
      p_film_ids: ids,
    });
    if (error) throw error;
    let rankings = new Map();
    (data || []).forEach((row) => {
      let ranking = rankings.get(row.ranking_id);
      if (!ranking) {
        ranking = {
          id: row.ranking_id,
          scope: row.scope,
          scope_type: row.scope_type,
          ranking_entries: [],
        };
        rankings.set(row.ranking_id, ranking);
      }
      ranking.ranking_entries.push({
        ranking_id: row.ranking_id,
        film_id: row.film_id,
        position: row.position,
        rank: Number(row.rank),
        rank_confirmed: row.rank_confirmed,
        suppress_all_time_rank: row.suppress_all_time_rank,
        tie_group_id: row.tie_group_id,
        tie_group_title: row.tie_group_title,
      });
    });
    return [...rankings.values()];
  };

  /**
   * Moves one film to an arbitrary position within a local-rank collection
   * - reuses `mergeSupabaseLocalRankOrder()`
   * (src/domain/supabase-local-rank.js, a Node-testable direct port of
   * local-rank.js's mergeLocalRankOrder() with no window.state coupling,
   * built for local-rank-merge.html's own cutover) to compute the merged
   * order, then re-derives fresh sequential positions for the whole
   * collection via `setSupabaseLocalRankOrder()`'s full-replace semantics
   * - local_ranks rows are opt-in (most films have none until first
   * explicitly moved), so there's no fixed neighbor position to
   * interpolate between the way moveSupabaseRankingEntryToPosition() can
   * for the always-fully-populated ranking_entries.
   * @param {'person'|'tag'|'franchise'} kind
   * @param {string} collectionId
   * @param {string[]} currentIds Every film id currently in the collection.
   * @param {string} fromFilmId
   * @param {string} toFilmId
   * @param {'before'|'after'} [position]
   * @returns {Promise<boolean>} Whether the move was applied.
   */
  window.moveSupabaseLocalRankFilm = async function (
    kind,
    collectionId,
    currentIds,
    fromFilmId,
    toFilmId,
    position = "before",
  ) {
    if (!fromFilmId || !toFilmId || fromFilmId === toFilmId) return false;
    let stored = await window.loadSupabaseLocalRankOrder(kind, collectionId);
    let order = window.mergeSupabaseLocalRankOrder(stored, currentIds);
    if (!order.includes(fromFilmId) || !order.includes(toFilmId)) return false;
    let next = order.filter((filmId) => filmId !== fromFilmId);
    let toIndex = next.indexOf(toFilmId);
    next.splice(position === "after" ? toIndex + 1 : toIndex, 0, fromFilmId);
    await window.setSupabaseLocalRankOrder(kind, collectionId, next);
    return true;
  };

  /**
   * Persists a within-rating move in the moved film's four affected ranking scopes.
   * @param {FilmRecord} movedFilm Film after the validated local ranking move.
   * @returns {Promise<void>} Resolves after the affected ranking orders are saved.
   */
  window.persistSupabaseFilmRankingMove = async function (movedFilm) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    if (!window.OSKARS_STATE_HYDRATION_COMPLETE)
      throw new Error("Load the complete ranking before editing its order.");
    let scopes = [
      ["allTime", "alltime"],
      ["years", String(movedFilm.year)],
      ["decades", window.getDecadeKey(movedFilm.year)],
      ["centuries", window.getCenturyKey(movedFilm.year)],
    ];
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    for (let [scopeType, scope] of scopes) {
      window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
      let rankField = window.RANK_FIELD_BY_SCOPE_TYPE[scopeType];
      let films = Object.values(window.state.filmsById || {})
        .filter(
          (film) =>
            Number(film[rankField]) > 0 &&
            (scopeType === "allTime" ||
              (scopeType === "years"
                ? String(film.year)
                : scopeType === "decades"
                  ? window.getDecadeKey(film.year)
                  : window.getCenturyKey(film.year)) === scope),
        )
        .sort((a, b) => Number(a[rankField]) - Number(b[rankField]));
      let original = window.OSKARS_SUPABASE_HYDRATION_SOURCE?.rankings?.find(
        (ranking) =>
          ranking.scope_type === scopeType && ranking.scope === scope,
      );
      let byFilm = new Map(
        (original?.ranking_entries || []).map((entry) => [
          entry.film_id,
          entry,
        ]),
      );
      let seen = new Set();
      let entries = [];
      for (let film of films) {
        if (!film.supabaseFilmId)
          throw new Error("Refresh the ranked film before editing it.");
        if (seen.has(film.supabaseFilmId)) continue;
        seen.add(film.supabaseFilmId);
        let previous = byFilm.get(film.supabaseFilmId) || {};
        entries.push({
          film_id: film.supabaseFilmId,
          position: String((entries.length + 1) * 1000).padStart(12, "0"),
          rank_confirmed:
            film.rankConfirmedByScope?.[scopeType] ??
            film.rankConfirmed !== false,
          suppress_all_time_rank: Boolean(film.suppressAllTimeRank),
          tie_group_id: film.rankingGroupId || previous.tie_group_id || "",
          tie_group_title:
            film.rankingGroupTitle || previous.tie_group_title || "",
        });
      }
      let { error } = await ready.client.rpc("replace_ranking_order", {
        p_scope: scope,
        p_scope_type: scopeType,
        p_entries: entries,
      });
      if (error) throw error;
    }
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    window.invalidateCachedSupabaseHydrationSource?.();
  };
})();
