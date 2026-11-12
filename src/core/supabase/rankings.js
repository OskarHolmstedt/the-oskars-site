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

  function ratingKey(row) {
    return !(Number(row.rating) >= 0.5 && Number(row.rating) <= 5)
      ? "unrated"
      : `${Number(row.rating)}|${row.rating_modifier || ""}`;
  }

  function ratingValue(row) {
    return ratingKey(row) === "unrated"
      ? 0
      : Number(row.rating) * 6 +
          (row.rating_modifier === "plus"
            ? 1
            : row.rating_modifier === "minus"
              ? -1
              : 0);
  }

  function orderedRows(rows) {
    return rows
      .slice()
      .sort(
        (a, b) =>
          ratingValue(b) - ratingValue(a) ||
          (a.position && b.position
            ? a.position < b.position
              ? -1
              : a.position > b.position
                ? 1
                : a.film_id.localeCompare(b.film_id)
            : a.position
              ? -1
              : b.position
                ? 1
                : a.film_id.localeCompare(b.film_id)),
      );
  }

  function rowInScope(row, scope, type) {
    if (!window.supabaseRankingFilmEligible(row)) return false;
    if (type === "allTime") return true;
    let year = row.films?.year || 0;
    return type === "years"
      ? String(year) === String(scope)
      : `${Math.floor(year / (type === "decades" ? 10 : 100)) * (type === "decades" ? 10 : 100)}s` ===
          scope;
  }

  /** Reads the account's reviewed exact-rating year and merge groups. @returns {Promise<Object[]>} Stored groups. */
  window.loadSupabaseWatchedOrderGroups = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let groups = await window.supabaseWorkspaceContext.fetchAllSupabaseRows(
      (withCount) =>
        ready.client
          .from("watched_order_groups")
          .select(
            "id,rating_key,kind,years,film_ids",
            withCount ? { count: "exact" } : undefined,
          )
          .eq("user_id", window.getSupabaseCurrentUser()?.id)
          .order("id"),
    );
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    return groups;
  };

  /** Returns watched rows sorted within their exact rating buckets. @param {Object[]} [rows] Explicit rows. @returns {Object[]} Ordered eligible rows. */
  window.supabaseWatchedItemsInOrder = function (rows) {
    return orderedRows(
      (rows || window.getSupabaseWorkspace()?.watched || []).filter(
        window.supabaseRankingFilmEligible,
      ),
    );
  };

  /** Returns one exact rating bucket in its canonical order. @param {string} key Rating key. @returns {Object[]} Watched rows. */
  window.supabaseWatchedRatingItemsInOrder = function (key) {
    return window
      .supabaseWatchedItemsInOrder()
      .filter((row) => ratingKey(row) === key);
  };

  /** Places a Build film among same-rating neighbors in the shared order. @param {string} rankingId Scope id. @param {Object[]} entries Scoped entries. @param {string} filmId Selected film. @param {string|null} targetFilmId Neighbor. @param {'before'|'after'} side Placement side. @returns {Promise<string>} Saved key. */
  window.placeSupabaseIntakeRankingFilm = async function (
    rankingId,
    entries,
    filmId,
    targetFilmId,
    side,
  ) {
    let selected = window
      .getSupabaseWorkspace()
      ?.watched.find((row) => row.film_id === filmId);
    if (!selected) throw new Error("Refresh the film before placing it.");
    let bucket = window.supabaseWatchedRatingItemsInOrder(ratingKey(selected));
    let others = bucket.filter((row) => row.film_id !== filmId);
    let index = others.findIndex((row) => row.film_id === targetFilmId);
    if (index < 0) index = others.length;
    else if (side === "after") index++;
    others.splice(index, 0, selected);
    await window.saveWatchedOrdering(
      ratingKey(selected),
      [...new Set(others.map((row) => row.films?.year || 0))],
      others,
    );
    void rankingId;
    void entries;
    return window
      .getSupabaseWorkspace()
      .watched.find((row) => row.film_id === filmId).position;
  };

  /** Loads a scope as a filter over the single watched order, without writing on page entry. @param {string} scope Period key. @param {string} scopeType Period type. @returns {Promise<Object>} Projected entries, including pending films. */
  window.loadSupabaseRanking = async function (scope, scopeType) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let workspace = await window.loadSupabaseWorkspace({ parts: ["watched"] });
    let groups = await window.loadSupabaseWatchedOrderGroups();
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let all = window.supabaseWatchedItemsInOrder(workspace.watched);
    let selected = all.filter((row) => rowInScope(row, scope, scopeType));
    let byRating = new Map();
    for (let row of selected) {
      let key = ratingKey(row);
      if (!byRating.has(key)) byRating.set(key, []);
      byRating.get(key).push(row);
    }
    let confirmed = new Set();
    for (let [key, rows] of byRating) {
      if (rows.length === 1) {
        confirmed.add(rows[0].film_id);
        continue;
      }
      for (let group of groups.filter((group) => group.rating_key === key)) {
        let actual = all.filter(
          (row) =>
            ratingKey(row) === key &&
            group.years.includes(row.films?.year || 0),
        );
        if (
          actual.length !== group.film_ids.length ||
          actual.some(
            (row, i) => !row.position || row.film_id !== group.film_ids[i],
          )
        )
          continue;
        if (rows.every((row) => group.film_ids.includes(row.film_id)))
          rows.forEach((row) => confirmed.add(row.film_id));
      }
    }
    return {
      rankingId: `${scopeType}:${scope}`,
      entries: selected.map((row) => ({
        ...row,
        ranking_id: `${scopeType}:${scope}`,
        rank_confirmed: confirmed.has(row.film_id),
        tie_group_id: row.ranking_group_id || null,
        tie_group_title: row.ranking_group_title || null,
        suppress_all_time_rank: Boolean(row.suppress_all_time_rank),
      })),
    };
  };

  /** Loads paged archive projections of the canonical order. @returns {Promise<Object[]>} Scope read models. */
  window.loadSupabaseStoredRankings = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let fetch = window.supabaseWorkspaceContext.fetchAllSupabaseRows;
    let [rankings, entries] = await Promise.all([
      fetch((withCount) =>
        ready.client
          .from("rankings")
          .select(
            "id,scope,scope_type",
            withCount ? { count: "exact" } : undefined,
          )
          .order("id"),
      ),
      fetch((withCount) =>
        ready.client
          .from("ranking_entries")
          .select(
            "ranking_id,film_id,position,rank_confirmed,suppress_all_time_rank,tie_group_id,tie_group_title,films(id,title,year,type,poster_url)",
            withCount ? { count: "exact" } : undefined,
          )
          .order("ranking_id")
          .order("position")
          .order("film_id"),
      ),
    ]);
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let byId = new Map();
    for (let entry of entries) {
      if (!byId.has(entry.ranking_id)) byId.set(entry.ranking_id, []);
      byId.get(entry.ranking_id).push(entry);
    }
    return rankings.map((row) => ({
      ...row,
      ranking_entries: byId.get(row.id) || [],
    }));
  };

  /** Projects an existing watched order into the selected period. @param {string} scope Period key. @param {string} scopeType Period type. @param {Object[]} watched Watched rows. @returns {Promise<Object>} Scope read model. */
  window.prepareSupabasePeriodRanking = async function (
    scope,
    scopeType,
    watched,
  ) {
    void watched;
    return window.loadSupabaseRanking(scope, scopeType);
  };

  async function refreshWatchedOrder(isCurrent) {
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    window.invalidateCachedSupabaseHydrationSource?.();
    await window.loadSupabaseWorkspace({ parts: ["watched"], force: true });
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
  }

  function positionsFor(rows, all) {
    let selected = new Set(rows.map((row) => row.film_id));
    let slots = all
      .filter((row) => selected.has(row.film_id))
      .map((row) => row.position)
      .filter(Boolean)
      .sort();
    let outside = new Set(
      all
        .filter((row) => !selected.has(row.film_id))
        .map((row) => row.position)
        .filter(Boolean),
    );
    if (
      slots.length !== rows.length ||
      new Set(slots).size !== rows.length ||
      slots.some((pos) => outside.has(pos))
    ) {
      let last =
        all
          .map((row) => row.position)
          .filter(Boolean)
          .sort()
          .at(-1) || null;
      slots = rows.map(() => {
        last = window.fractionalPositionBetween(last, null);
        return last;
      });
    }
    return slots;
  }

  /** Saves a complete exact-rating shelf or reviewed merge without moving unrelated films. @param {string} key Exact rating key. @param {number[]} years Selected years. @param {Object[]} rows Reviewed rows and their versions. @param {number[][]} [inputs] Two reviewed merge groups. @returns {Promise<void>} Save completion. */
  window.saveWatchedOrdering = async function (key, years, rows, inputs) {
    if (rows.some((row) => ratingKey(row) !== key))
      throw new Error("Keep films within their exact rating.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let all = window
      .supabaseWatchedItemsInOrder()
      .filter((row) => ratingKey(row) === key);
    let slots = positionsFor(rows, all);
    let { error } = await ready.client.rpc("save_watched_order", {
      p_rating_key: key,
      p_years: [...new Set(years)].sort((a, b) => a - b),
      p_entries: rows.map((row, i) => ({
        film_id: row.film_id,
        updated_at: row.updated_at,
        position: slots[i],
      })),
      p_inputs: inputs || null,
    });
    if (error) throw error;
    await refreshWatchedOrder(isCurrent);
  };

  /** Confirms the selected films in complete exact-rating shelves. @param {string} rankingId Scope read model id. @param {string[]} filmIds Selected films. @returns {Promise<void>} Save completion. */
  window.confirmSupabaseRankingEntries = async function (rankingId, filmIds) {
    let rows = window
      .supabaseWatchedItemsInOrder()
      .filter((row) => filmIds.includes(row.film_id));
    let keys = [...new Set(rows.map(ratingKey))];
    for (let key of keys) {
      let bucket = rows.filter((row) => ratingKey(row) === key);
      await window.saveWatchedOrdering(
        key,
        [...new Set(bucket.map((row) => row.films?.year || 0))],
        bucket,
      );
    }
    void rankingId;
  };

  /** Confirms one exact-rating shelf in the canonical watched order. @param {string} rankingId Scope read model id. @param {string} year Scope key. @param {Object[]} entries Ordered shelf rows. @param {string} [scopeType] Scope type. @returns {Promise<Object>} Review result. */
  window.resolveSupabaseYearRankingBucket = async function (
    rankingId,
    year,
    entries,
    scopeType = "years",
  ) {
    if (!entries.length) return { reviewed: 0 };
    await window.saveWatchedOrdering(
      ratingKey(entries[0]),
      [...new Set(entries.map((row) => row.films?.year || 0))],
      entries,
    );
    void rankingId;
    void year;
    void scopeType;
    return { reviewed: Math.max(0, entries.length - 1) };
  };
  window.resolveSupabaseRankingBucket = window.resolveSupabaseYearRankingBucket;

  async function moveRows(rows) {
    let key = ratingKey(rows[0]);
    if (rows.some((row) => ratingKey(row) !== key))
      throw new Error("Keep films within their exact rating.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let { error } = await ready.client.rpc("move_watched_order", {
      p_rating_key: key,
      p_entries: rows.map((row) => ({
        film_id: row.film_id,
        updated_at: row.updated_at,
        position: row.position,
      })),
    });
    if (error) throw error;
    await refreshWatchedOrder(isCurrent);
  }

  /** Moves one watched film between same-rating neighbors. @param {string} rankingId Scope read model id. @param {string} filmId Selected film. @param {Object[]} entries Scoped entries. @param {string|null} beforeFilmId Preceding neighbor. @param {string|null} afterFilmId Following neighbor. @returns {Promise<string>} New key. */
  window.moveSupabaseRankingEntryToPosition = async function (
    rankingId,
    filmId,
    entries,
    beforeFilmId,
    afterFilmId,
  ) {
    let row = entries.find((entry) => entry.film_id === filmId);
    if (!row) throw new Error("Refresh the ranking before moving this film.");
    let neighbor = (id) =>
      id ? entries.find((entry) => entry.film_id === id) : null;
    let before = neighbor(beforeFilmId),
      after = neighbor(afterFilmId);
    if (
      [before, after].some(
        (other) => other && ratingKey(other) !== ratingKey(row),
      )
    )
      throw new Error("Keep films within their exact rating.");
    let all = window
      .supabaseWatchedItemsInOrder()
      .filter((other) => ratingKey(other) === ratingKey(row));
    let old = all.find((other) => other.film_id === filmId);
    let actual = window.fractionalPositionBetween(
      before?.position || null,
      after?.position || null,
    );
    await moveRows([{ ...row, position: actual }]);
    row.position = actual;
    row.updated_at =
      window
        .getSupabaseWorkspace()
        ?.watched.find((other) => other.film_id === filmId)?.updated_at ||
      old?.updated_at;
    void rankingId;
    return actual;
  };

  /** Swaps adjacent films within one exact rating atomically. @param {string} rankingId Scope read model id. @param {Object[]} entries Scoped entries. @param {string} filmId Selected film. @param {'up'|'down'} direction Move direction. @returns {Promise<void>} Save completion. */
  window.moveSupabaseRankingEntry = async function (
    rankingId,
    entries,
    filmId,
    direction,
  ) {
    let index = entries.findIndex((entry) => entry.film_id === filmId),
      targetIndex = index + (direction === "up" ? -1 : 1);
    if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) return;
    let current = entries[index],
      target = entries[targetIndex];
    if (ratingKey(current) !== ratingKey(target))
      throw new Error("Keep films within their exact rating.");
    if (!current.position || !target.position) {
      let bucket = entries.filter(
        (row) => ratingKey(row) === ratingKey(current),
      );
      let from = bucket.indexOf(current),
        to = bucket.indexOf(target);
      [bucket[from], bucket[to]] = [bucket[to], bucket[from]];
      let slots = positionsFor(
        bucket,
        window.supabaseWatchedRatingItemsInOrder(ratingKey(current)),
      );
      await moveRows(bucket.map((row, i) => ({ ...row, position: slots[i] })));
      for (let row of bucket)
        Object.assign(
          row,
          window
            .getSupabaseWorkspace()
            .watched.find((other) => other.film_id === row.film_id),
        );
      return;
    }
    await moveRows([
      { ...current, position: target.position },
      { ...target, position: current.position },
    ]);
    [current.position, target.position] = [target.position, current.position];
    for (let row of [current, target])
      row.updated_at = window
        .getSupabaseWorkspace()
        ?.watched.find((other) => other.film_id === row.film_id)?.updated_at;
    void rankingId;
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

  /** Saves the moved film's exact-rating order once for every period view. @param {FilmRecord} movedFilm Moved film. @returns {Promise<void>} Save completion. */
  window.persistSupabaseFilmRankingMove = async function (movedFilm) {
    if (!window.OSKARS_STATE_HYDRATION_COMPLETE)
      throw new Error("Load the complete ranking before editing its order.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let workspace = await window.loadSupabaseWorkspace({ parts: ["watched"] });
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let rows = window.supabaseWatchedItemsInOrder(workspace.watched);
    let selected = rows.find((row) => row.film_id === movedFilm.supabaseFilmId);
    if (!selected) throw new Error("Refresh the ranking before editing it.");
    let byId = new Map(
      Object.values(window.state.filmsById || {}).map((film) => [
        film.supabaseFilmId,
        film,
      ]),
    );
    let bucket = rows
      .filter((row) => ratingKey(row) === ratingKey(selected))
      .sort(
        (a, b) =>
          (byId.get(a.film_id)?.allTimeRank || Infinity) -
          (byId.get(b.film_id)?.allTimeRank || Infinity),
      );
    await window.saveWatchedOrdering(
      ratingKey(selected),
      [...new Set(bucket.map((row) => row.films?.year || 0))],
      bucket,
    );
  };
})();
