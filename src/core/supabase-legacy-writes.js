/**
 * @file Persists mutations made by the established film and period view
 * models directly to Supabase, without browser persistence hydration.
 */

(function () {
  let saveChain = Promise.resolve();

  function positionFor(index) {
    return String((index + 1) * 1000).padStart(12, "0");
  }

  function ratingValue(film) {
    let numeric = Number(film?.ratingValue);
    if (numeric > 0) return numeric;
    return Number(window.parseFilmRating?.(film?.rating)?.value) || null;
  }

  function watchedPayload(film) {
    return {
      rating: ratingValue(film),
      rating_modifier:
        film.ratingModifier ||
        window.parseFilmRating?.(film.rating)?.modifier ||
        null,
      date_watched: film.dateWatched || null,
      review: film.review || null,
      want_to_rewatch: Boolean(film.wantToRewatch),
      rewatch_tier: film.rewatchTier || null,
      rewatch_tier_modifier: film.rewatchTierModifier || null,
      music_score: film.musicScore || null,
      music_rating: film.musicRating || null,
      music_rating_value: film.musicRatingValue ?? null,
      views: Number(film.views) > 0 ? Number(film.views) : null,
      platform: film.platform || null,
    };
  }

  function sourceWatchedPayload(row) {
    return {
      rating: row.rating == null ? null : Number(row.rating),
      rating_modifier: row.rating_modifier || null,
      date_watched: row.date_watched || null,
      review: row.review || null,
      want_to_rewatch: Boolean(row.want_to_rewatch),
      rewatch_tier: row.rewatch_tier || null,
      rewatch_tier_modifier: row.rewatch_tier_modifier || null,
      music_score: row.music_score || null,
      music_rating: row.music_rating || null,
      music_rating_value: row.music_rating_value ?? null,
      views: row.views || null,
      platform: row.platform || null,
    };
  }

  function catalogPayload(record) {
    let posterUrl = record?.poster?.url || record?.poster_url || null;
    return {
      p_tmdb_id: Number(record?.tmdbId || record?.tmdb_id) || null,
      p_title: String(record?.title || "").trim(),
      p_year: Number(record?.year) || null,
      p_medium: record?.medium || null,
      p_type: record?.type || null,
      p_runtime_minutes: Number(record?.runtimeMinutes) || null,
      p_country: record?.country || null,
      p_primary_country: record?.primaryCountry || null,
      p_poster_url: posterUrl,
      p_swedish_title: record?.swedishTitle || null,
      p_genre: record?.genre || null,
      p_screenplay_type: ["original", "adapted"].includes(
        record?.screenplayType,
      )
        ? record.screenplayType
        : null,
      p_adaptation_source: record?.adaptationSource || null,
      p_letterboxd_url: record?.letterboxdUrl || null,
    };
  }

  async function resolveFilmId(
    client,
    record,
    peopleNotAdded = [],
    knownCatalog = null,
  ) {
    if (record?.supabaseFilmId) return record.supabaseFilmId;
    if (!String(record?.title || "").trim())
      throw new Error("A film title is required before it can be saved.");

    if (knownCatalog) {
      let known = window.filmTmdbIdentity(record?.tmdbId);
      if (known && knownCatalog.byTmdbId?.has(String(known))) {
        record.supabaseFilmId = knownCatalog.byTmdbId.get(String(known));
        return record.supabaseFilmId;
      }
      if (record?.title) {
        let titleKey = `${record.title.trim().toLowerCase()}:${record.year ?? ""}`;
        if (knownCatalog.byTitleYear?.has(titleKey)) {
          record.supabaseFilmId = knownCatalog.byTitleYear.get(titleKey);
          return record.supabaseFilmId;
        }
      }
    }

    let { filmId } = await window.resolveSupabaseCatalogFilm(
      client,
      record,
      catalogPayload(record),
    );
    if (!filmId) return null;
    record.supabaseFilmId = filmId;

    if (knownCatalog) {
      let known = window.filmTmdbIdentity(record?.tmdbId);
      if (known) knownCatalog.byTmdbId?.set(String(known), filmId);
      if (record?.title) {
        let titleKey = `${record.title.trim().toLowerCase()}:${record.year ?? ""}`;
        knownCatalog.byTitleYear?.set(titleKey, filmId);
      }
    }

    let directors = record?.directors?.length
      ? record.directors
      : typeof record?.director === "string" && record.director.trim()
        ? record.director
            .split(",")
            .map((s) => ({ name: s.trim() }))
            .filter((d) => d.name)
        : null;
    if (directors?.length && window.persistSupabaseFilmCredits) {
      try {
        peopleNotAdded.push(
          ...((await window.persistSupabaseFilmCredits(
            filmId,
            "director",
            directors,
          )) || []),
        );
      } catch (err) {
        console.warn(
          `Could not persist directors for film "${record.title}"`,
          err,
        );
      }
    }
    return filmId;
  }

  async function syncWatched(client, source, films, onProgress) {
    let sourceByFilm = new Map(
      (source.watched || []).map((row) => [row.film_id, row]),
    );
    let toInsert = [];
    let toUpdate = [];

    for (let film of films) {
      let filmId = await resolveFilmId(client, film);
      // A film built from offline import preview only has a placeholder
      // makeFilmId()-shaped id until this resolves its real Supabase id -
      // propagate that everywhere the placeholder was already indexed
      // (issue #454), reusing the same rename-everywhere utility
      // addFilmToStore() uses for its own id-reconciliation cases.
      if (film.id !== filmId)
        window.replaceFilmStoreId?.(film.id, filmId, film);
      let existing = sourceByFilm.get(filmId);
      let payload = watchedPayload(film);
      if (!existing) {
        toInsert.push({ film_id: filmId, ...payload });
      } else if (
        window.stableJson(payload) !==
        window.stableJson(sourceWatchedPayload(existing))
      ) {
        toUpdate.push({ existing, payload });
      }
    }

    let totalOperations = toInsert.length + toUpdate.length;
    let completed = 0;
    onProgress?.("Watched films", completed, Math.max(1, totalOperations));

    const BATCH_SIZE = 50;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      let chunk = toInsert.slice(i, i + BATCH_SIZE);
      let { error } = await client
        .from("watched")
        .upsert(chunk, { onConflict: "user_id,film_id" });
      if (error) throw error;
      completed += chunk.length;
      onProgress?.("Watched films", completed, totalOperations);
    }

    if (toUpdate.length > 0) {
      let updateCursor = 0;
      let concurrency = Math.min(toUpdate.length, 6);
      async function updateWorker() {
        while (updateCursor < toUpdate.length) {
          let { existing, payload } = toUpdate[updateCursor++];
          let query = client
            .from("watched")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", existing.id);
          if (existing.updated_at)
            query = query.eq("updated_at", existing.updated_at);
          let { data, error } = await query.select("id");
          if (error) throw error;
          if (!data?.length) {
            let stale = new Error(
              "Changed in another session — reload before editing.",
            );
            stale.code = "OSKARS_STALE_WRITE";
            throw stale;
          }
          completed++;
          onProgress?.("Watched films", completed, totalOperations);
        }
      }
      await Promise.all(
        Array.from({ length: concurrency }, () => updateWorker()),
      );
    }

    if (totalOperations === 0) {
      onProgress?.("Watched films", 1, 1);
    }
  }

  const TAG_NAME_BATCH_SIZE = 500;
  // Bounded by the `film_id=in.(...)` URL the stale-link read and deletes
  // send, not by row counts.
  const TAG_FILM_BATCH_SIZE = 100;

  async function syncTags(client, authUserId, source, films, onProgress) {
    let sourceTags = new Map(
      (source.watched || []).map((row) => [
        row.film_id,
        (row.films?.film_tags || [])
          .map((item) => item.tags?.name)
          .filter(Boolean)
          .sort(),
      ]),
    );
    // Keyed by Supabase film id so two local records of one film collapse
    // to the later one's tags; a batched upsert can't touch a row twice.
    let desiredByFilm = new Map();
    for (let film of films) {
      let filmId = await resolveFilmId(client, film);
      let desired = [
        ...new Set(window.parseFilmTags?.(film.tags) || []),
      ].sort();
      if (
        window.stableJson(desired) ===
        window.stableJson(sourceTags.get(filmId) || [])
      )
        continue;
      desiredByFilm.set(filmId, desired);
    }

    let changed = [...desiredByFilm];
    let completed = 0;
    onProgress?.("Tags", completed, Math.max(1, changed.length));
    if (!changed.length) return;

    let tagIdByName = new Map();
    let names = [...new Set(changed.flatMap(([, desired]) => desired))];
    for (let i = 0; i < names.length; i += TAG_NAME_BATCH_SIZE) {
      let { data, error } = await client
        .from("tags")
        .upsert(
          names
            .slice(i, i + TAG_NAME_BATCH_SIZE)
            .map((name) => ({ user_id: authUserId, name })),
          { onConflict: "user_id,name" },
        )
        .select("id,name");
      if (error) throw error;
      (data || []).forEach((tag) => tagIdByName.set(tag.name, tag.id));
    }
    let missing = names.filter((name) => !tagIdByName.has(name));
    if (missing.length)
      throw new Error(`Could not save tags: ${missing.join(", ")}`);

    for (let i = 0; i < changed.length; i += TAG_FILM_BATCH_SIZE) {
      let batch = changed.slice(i, i + TAG_FILM_BATCH_SIZE);
      let links = batch.flatMap(([filmId, desired]) =>
        desired.map((name) => ({
          user_id: authUserId,
          film_id: filmId,
          tag_id: tagIdByName.get(name),
        })),
      );
      if (links.length) {
        let { error } = await client
          .from("film_tags")
          .upsert(links, { onConflict: "user_id,film_id,tag_id" });
        if (error) throw error;
      }

      let filmIds = batch.map(([filmId]) => filmId);
      let existingRows = await window.fetchAllSupabaseRows((withCount) =>
        client
          .from("film_tags")
          .select("film_id,tag_id", withCount ? { count: "exact" } : undefined)
          .eq("user_id", authUserId)
          .in("film_id", filmIds)
          .order("film_id")
          .order("tag_id"),
      );
      let desiredIdsByFilm = new Map(
        batch.map(([filmId, desired]) => [
          filmId,
          new Set(desired.map((name) => tagIdByName.get(name))),
        ]),
      );
      let staleFilmsByTag = new Map();
      existingRows.forEach((row) => {
        if (desiredIdsByFilm.get(row.film_id)?.has(row.tag_id)) return;
        let filmsForTag = staleFilmsByTag.get(row.tag_id) || [];
        filmsForTag.push(row.film_id);
        staleFilmsByTag.set(row.tag_id, filmsForTag);
      });
      for (let [tagId, staleFilmIds] of staleFilmsByTag) {
        let { error } = await client
          .from("film_tags")
          .delete()
          .eq("user_id", authUserId)
          .eq("tag_id", tagId)
          .in("film_id", staleFilmIds);
        if (error) throw error;
      }

      completed += batch.length;
      onProgress?.("Tags", completed, changed.length);
    }
  }

  async function findOrCreateFranchise(client, name, parentId) {
    let slug = window.publicProfileSlugify(name);
    let { data: existing, error: selectError } = await client
      .from("franchises")
      .select("id,parent_id")
      .eq("slug", slug)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing.id;
    let { data, error } = await client
      .from("franchises")
      .insert({ slug, name, parent_id: parentId || null })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        let { data: retryExisting, error: retryError } = await client
          .from("franchises")
          .select("id,parent_id")
          .eq("slug", slug)
          .single();
        if (retryError) throw retryError;
        return retryExisting.id;
      }
      throw error;
    }
    return data.id;
  }

  async function syncFranchiseAdditions(client, source, films, onProgress) {
    let franchiseIds = new Map();
    let completed = 0;
    onProgress?.("Franchise additions", 0, films.length);
    let existing = new Set();
    (source.watched || []).forEach((row) =>
      (row.films?.film_franchises || []).forEach((membership) =>
        existing.add(`${row.film_id}\n${membership.franchises?.id || ""}`),
      ),
    );
    for (let film of films) {
      let filmId = await resolveFilmId(client, film);
      for (let membership of film.franchises || []) {
        if (membership.id && existing.has(`${filmId}\n${membership.id}`))
          continue;
        let names = [
          ...(membership.parentChainNames || membership.parentNames || []),
          membership.name,
        ].filter(Boolean);
        let parentId = null;
        let leafId = null;
        for (let name of names) {
          let key = `${parentId || ""}\n${name}`;
          if (!franchiseIds.has(key))
            franchiseIds.set(
              key,
              await findOrCreateFranchise(client, name, parentId),
            );
          leafId = franchiseIds.get(key);
          parentId = leafId;
        }
        if (!leafId || existing.has(`${filmId}\n${leafId}`)) continue;
        let { error } = await client.from("film_franchises").insert({
          franchise_id: leafId,
          film_id: filmId,
          position: Number(membership.rank) || null,
        });
        if (error) throw error;
        existing.add(`${filmId}\n${leafId}`);
      }
      completed++;
      onProgress?.("Franchise additions", completed, films.length);
    }
  }

  function desiredAwardGroups(films) {
    let groups = new Map();
    films.forEach((film) =>
      (film.awards || []).forEach((award) => {
        let scopeType = award.periodType || window.getAwardPeriodType?.(award);
        let key = `${scopeType}\n${award.year}\n${award.category}`;
        let rows = groups.get(key) || [];
        rows.push({
          film_id: film.supabaseFilmId,
          placement: Number(award.placement),
          detail: window.awardDetail?.(award) || award.detail || "",
          recipients: (award.recipients || [])
            .map((recipient) => recipient.name || recipient)
            .filter(Boolean),
        });
        groups.set(key, rows);
      }),
    );
    groups.forEach((rows) => rows.sort((a, b) => a.placement - b.placement));
    return groups;
  }

  function sourceAwardGroups(source) {
    let groups = new Map();
    (source.personalAwards || []).forEach((award) =>
      (award.personal_nominations || []).forEach((nomination) => {
        let key = `${award.scope_type}\n${award.scope}\n${nomination.category}`;
        let rows = groups.get(key) || [];
        rows.push({
          film_id: nomination.film_id,
          placement: Number(nomination.placement),
          detail: nomination.detail || "",
          recipients: (nomination.personal_nomination_recipients || [])
            .map((recipient) => recipient.recipient_name)
            .filter(Boolean),
        });
        groups.set(key, rows);
      }),
    );
    groups.forEach((rows) => rows.sort((a, b) => a.placement - b.placement));
    return groups;
  }

  // Stop scheduling on failure, but drain started writes before the save
  // rejects so a later save cannot overlap with this stage.
  async function runWriteJobs(jobs) {
    let cursor = 0;
    let failure;
    async function worker() {
      while (!failure && cursor < jobs.length) {
        let job = jobs[cursor++];
        try {
          await job();
        } catch (error) {
          failure ||= error;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, worker));
    if (failure) throw failure;
  }

  async function syncAwards(client, source, films) {
    let desired = desiredAwardGroups(films);
    let original = sourceAwardGroups(source);
    let keys = new Set([...desired.keys(), ...original.keys()]);
    let jobs = [];
    for (let key of keys) {
      let next = desired.get(key) || [];
      if (
        window.stableJson(next) === window.stableJson(original.get(key) || [])
      )
        continue;
      let [scopeType, scope, category] = key.split("\n");
      jobs.push(async () => {
        let { error } = await client.rpc("replace_personal_award_category", {
          p_scope: scope,
          p_scope_type: scopeType,
          p_category: category,
          p_nominations: next,
        });
        if (error) throw error;
      });
    }
    await runWriteJobs(jobs);
  }

  async function syncRankings(client, source, films) {
    let rankings = new Map(
      (source.rankings || []).map((ranking) => [
        `${ranking.scope_type}\n${ranking.scope}`,
        ranking,
      ]),
    );
    films.forEach((film) => {
      let scopes = [
        ["years", String(film.year || "")],
        ["decades", window.getDecadeKey?.(film.year) || ""],
        ["centuries", window.getCenturyKey?.(film.year) || ""],
        ["allTime", "alltime"],
      ];
      scopes.forEach(([scopeType, scope]) => {
        if (
          !scope ||
          !(Number(film[window.RANK_FIELD_BY_SCOPE_TYPE[scopeType]]) > 0)
        )
          return;
        let key = `${scopeType}\n${scope}`;
        if (!rankings.has(key))
          rankings.set(key, {
            scope,
            scope_type: scopeType,
            ranking_entries: [],
          });
      });
    });
    let jobs = [];
    for (let ranking of rankings.values()) {
      let rankField = window.RANK_FIELD_BY_SCOPE_TYPE[ranking.scope_type];
      if (!rankField) continue;
      let desiredFilms = films
        .filter((film) => {
          if (!(Number(film[rankField]) > 0)) return false;
          if (ranking.scope_type === "years")
            return String(film.year) === String(ranking.scope);
          if (ranking.scope_type === "decades")
            return window.getDecadeKey?.(film.year) === ranking.scope;
          if (ranking.scope_type === "centuries")
            return window.getCenturyKey?.(film.year) === ranking.scope;
          return true;
        })
        .sort((a, b) => Number(a[rankField]) - Number(b[rankField]));
      let originalByFilm = new Map(
        (ranking.ranking_entries || []).map((entry) => [entry.film_id, entry]),
      );
      // Local aliases can resolve to one catalog film during import. Keep
      // the highest-ranked occurrence in this scope and its metadata.
      let seenFilmIds = new Set();
      desiredFilms = desiredFilms.filter((film) => {
        if (seenFilmIds.has(film.supabaseFilmId)) return false;
        seenFilmIds.add(film.supabaseFilmId);
        return true;
      });
      let entries = desiredFilms.map((film, index) => {
        let original = originalByFilm.get(film.supabaseFilmId) || {};
        return {
          film_id: film.supabaseFilmId,
          position: positionFor(index),
          rank_confirmed:
            film.rankConfirmedByScope?.[ranking.scope_type] ??
            film.rankConfirmed !== false,
          suppress_all_time_rank: Boolean(film.suppressAllTimeRank),
          tie_group_id: film.rankingGroupId || original.tie_group_id || "",
          tie_group_title:
            film.rankingGroupTitle || original.tie_group_title || "",
        };
      });
      let comparableEntries = (rows) =>
        rows.map((entry) => ({
          film_id: entry.film_id,
          rank_confirmed: entry.rank_confirmed !== false,
          suppress_all_time_rank: Boolean(entry.suppress_all_time_rank),
          tie_group_id: entry.tie_group_id || "",
          tie_group_title: entry.tie_group_title || "",
        }));
      if (
        window.stableJson(comparableEntries(ranking.ranking_entries || [])) ===
        window.stableJson(comparableEntries(entries))
      )
        continue;
      jobs.push(async () => {
        let { error } = await client.rpc("replace_ranking_order", {
          p_scope: ranking.scope,
          p_scope_type: ranking.scope_type,
          p_entries: entries,
        });
        if (error) throw error;
      });
    }
    await runWriteJobs(jobs);
  }

  async function syncWatchlist(client, source, items, onProgress) {
    let originalById = new Map(
      (source.watchlist || []).map((row) => [row.id, row]),
    );
    let desiredIds = new Set();
    let sortedItems = [...items].sort((left, right) => {
      let orderLeft = Number(left?.order);
      let orderRight = Number(right?.order);
      let leftRanked = Number.isFinite(orderLeft) && orderLeft > 0;
      let rightRanked = Number.isFinite(orderRight) && orderRight > 0;
      if (leftRanked && rightRanked && orderLeft !== orderRight) {
        return orderLeft - orderRight;
      }
      if (leftRanked && !rightRanked) return -1;
      if (!leftRanked && rightRanked) return 1;
      return 0;
    });
    let rankedIndex = 0;
    let toInsert = [];
    let toUpdate = [];

    for (let item of sortedItems) {
      let order = Number(item?.order);
      let isRanked = Number.isFinite(order) && order > 0;
      let original = originalById.get(item.id);
      let filmId = original?.film_id || (await resolveFilmId(client, item));
      let payload = {
        film_id: filmId,
        tier: item.tier || null,
        tier_modifier: item.tierModifier || null,
        position: isRanked ? positionFor(rankedIndex++) : null,
        reason: item.reason || null,
        updated_at: new Date().toISOString(),
      };
      if (original) {
        desiredIds.add(original.id);
        let before = {
          film_id: original.film_id,
          tier: original.tier || null,
          tier_modifier: original.tier_modifier || null,
          position: original.position,
          reason: original.reason || null,
        };
        let comparable = { ...payload };
        delete comparable.updated_at;
        if (window.stableJson(before) !== window.stableJson(comparable)) {
          toUpdate.push({ original, payload });
        }
      } else {
        toInsert.push(payload);
      }
    }

    let totalOperations = toInsert.length + toUpdate.length;
    let completed = 0;
    onProgress?.("Watchlist", completed, Math.max(1, totalOperations));

    const BATCH_SIZE = 50;
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      let chunk = toInsert.slice(i, i + BATCH_SIZE);
      let { data, error } = await client
        .from("watchlist")
        .upsert(chunk, { onConflict: "user_id,film_id" })
        .select("id");
      if (error) throw error;
      (data || []).forEach((row) => desiredIds.add(row.id));
      completed += chunk.length;
      onProgress?.("Watchlist", completed, totalOperations);
    }

    for (let { original, payload } of toUpdate) {
      let query = client
        .from("watchlist")
        .update(payload)
        .eq("id", original.id);
      if (original.updated_at)
        query = query.eq("updated_at", original.updated_at);
      let { data, error } = await query.select("id");
      if (error) throw error;
      if (!data?.length)
        throw new Error("Watchlist changed in another session — reload first.");
      completed++;
      onProgress?.("Watchlist", completed, totalOperations);
    }

    for (let row of source.watchlist || []) {
      if (desiredIds.has(row.id)) continue;
      let { error } = await client.from("watchlist").delete().eq("id", row.id);
      if (error) throw error;
    }

    if (totalOperations === 0) {
      onProgress?.("Watchlist", 1, 1);
    }
  }

  async function reconcile(options = {}) {
    let onProgress = options.onProgress;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let auth = await window.resolveSupabaseAuthState();
    if (auth.status !== "signed-in") throw new Error("Sign in before editing.");
    // syncAwards/syncRankings/syncWatchlist below all diff window.state
    // against window.OSKARS_SUPABASE_HYDRATION_SOURCE and delete anything
    // present in the source but absent from state - correct only when
    // state holds the complete archive, not a partial/compact read. Refuse
    // outright rather than risk silently deleting records outside a
    // partial set (issue #607); every legitimate save() caller today goes
    // through the full hydration in bootstrap.js's ensureOskarsData(),
    // which sets this flag once its reshape actually completes.
    if (window.OSKARS_STATE_HYDRATION_COMPLETE !== true) {
      let incomplete = new Error(
        "Archive not fully loaded — reload before saving.",
      );
      incomplete.code = "OSKARS_INCOMPLETE_STATE";
      throw incomplete;
    }
    let source = window.OSKARS_SUPABASE_HYDRATION_SOURCE || {};
    window.ensureAggregatesFresh?.();
    // Every film is resolved up front so a film with no catalog or TMDB
    // match is left out of every stage below and reported afterwards,
    // instead of failing the whole save.
    onProgress?.("Preparing records", 0, 1);
    await window.ensureCatalogIdentity?.();
    let films = [];
    let notAdded = [];
    let peopleNotAdded = [];
    let candidates = Object.values(window.state?.filmsById || {});
    let watchlistCandidates = window.state?.watchlist || [];
    let preparationTotal = candidates.length + watchlistCandidates.length;
    let prepared = 0;
    onProgress?.("Preparing records", prepared, preparationTotal);

    let knownCatalog = {
      byTmdbId: new Map(),
      byTitleYear: new Map(),
    };
    (source.catalogFilms || []).forEach((f) => {
      if (f?.tmdb_id) knownCatalog.byTmdbId.set(String(f.tmdb_id), f.id);
      if (f?.tmdb_tv_ref)
        knownCatalog.byTmdbId.set(String(f.tmdb_tv_ref), f.id);
      if (f?.title) {
        let key = `${f.title.trim().toLowerCase()}:${f.year ?? ""}`;
        if (!knownCatalog.byTitleYear.has(key))
          knownCatalog.byTitleYear.set(key, f.id);
      }
    });

    let candidateResults = new Array(candidates.length);
    let candidateCursor = 0;
    let candidateConcurrency = Math.min(candidates.length, 6);
    async function candidateWorker() {
      while (candidateCursor < candidates.length) {
        let idx = candidateCursor++;
        let film = candidates[idx];
        let localPeople = [];
        let id = await resolveFilmId(
          ready.client,
          film,
          localPeople,
          knownCatalog,
        );
        candidateResults[idx] = { film, id, localPeople };
        prepared++;
        onProgress?.("Preparing records", prepared, preparationTotal);
      }
    }
    if (candidates.length > 0) {
      await Promise.all(
        Array.from({ length: candidateConcurrency }, () => candidateWorker()),
      );
    }
    for (let res of candidateResults) {
      if (res.localPeople?.length) peopleNotAdded.push(...res.localPeople);
      if (res.id) films.push(res.film);
      else notAdded.push(window.catalogFilmLabel(res.film));
    }

    let watchlistResults = new Array(watchlistCandidates.length);
    let watchlistCursor = 0;
    let watchlistConcurrency = Math.min(watchlistCandidates.length, 6);
    async function watchlistWorker() {
      while (watchlistCursor < watchlistCandidates.length) {
        let idx = watchlistCursor++;
        let item = watchlistCandidates[idx];
        let original = (source.watchlist || []).some(
          (row) => row.id === item.id,
        );
        let localPeople = [];
        let id = original
          ? item.id
          : await resolveFilmId(ready.client, item, localPeople, knownCatalog);
        watchlistResults[idx] = { item, id, localPeople };
        prepared++;
        onProgress?.("Preparing records", prepared, preparationTotal);
      }
    }
    if (watchlistCandidates.length > 0) {
      await Promise.all(
        Array.from({ length: watchlistConcurrency }, () => watchlistWorker()),
      );
    }
    let watchlist = [];
    for (let res of watchlistResults) {
      if (res.localPeople?.length) peopleNotAdded.push(...res.localPeople);
      if (res.id) watchlist.push(res.item);
      else notAdded.push(window.catalogFilmLabel(res.item));
    }
    let stages = [
      [
        "Watched films",
        () => syncWatched(ready.client, source, films, onProgress),
      ],
      [
        "Tags",
        () => syncTags(ready.client, auth.user.id, source, films, onProgress),
      ],
      [
        "Franchise additions",
        () => syncFranchiseAdditions(ready.client, source, films, onProgress),
      ],
      ["Awards", () => syncAwards(ready.client, source, films)],
      ["Rankings", () => syncRankings(ready.client, source, films)],
      [
        "Watchlist",
        () => syncWatchlist(ready.client, source, watchlist, onProgress),
      ],
    ];
    for (let index = 0; index < stages.length; index++) {
      let [label, run] = stages[index];
      onProgress?.(label, 0, 1);
      await run();
      onProgress?.(label, 1, 1);
    }
    onProgress?.("Reloading saved archive", 0, 1);
    window.OSKARS_SUPABASE_HYDRATION_SOURCE =
      await window.loadSupabaseLegacyHydrationSource();
    window.writeCachedSupabaseHydrationSource?.(
      auth.user.id,
      window.OSKARS_SUPABASE_HYDRATION_SOURCE,
    );
    window.applySharedFilmArchive?.(
      window.buildSharedFilmArchiveFromSupabase(
        window.OSKARS_SUPABASE_HYDRATION_SOURCE.catalogFilms,
        window.OSKARS_SUPABASE_HYDRATION_SOURCE.franchises,
      ),
    );
    onProgress?.("Reloading saved archive", 1, 1);
    let warning = [
      window.catalogIdentityWarning("film", notAdded),
      window.catalogIdentityWarning("person", peopleNotAdded),
    ]
      .filter(Boolean)
      .join("\n");
    if (warning) {
      window.showStorageStatus?.(warning, "error");
      window.alert?.(warning);
    } else {
      window.showStorageStatus?.("Saved to Supabase", "saved");
    }
    return true;
  }

  /**
   * Saves the current film/period view model straight through to Supabase.
   * Calls are serialized so rapid UI actions cannot interleave writes.
   * @param {Object} [options] Save options.
   * @param {(label: string, done: number, total: number) => void} [options.onProgress]
   *   Reports stage-local progress during preparation, writes and reload.
   *   Counts restart when the label changes; totals may be zero for empty stages.
   * @returns {Promise<boolean>} Resolves after the requested state is durable.
   */
  window.saveSupabaseHydratedState = function (options = {}) {
    let operation = saveChain.catch(() => false).then(() => reconcile(options));
    saveChain = operation.catch((error) => {
      console.error("Could not save Supabase page changes", error);
      window.invalidateCachedSupabaseHydrationSource?.();
      window.showStorageStatus?.(error.message || String(error), "error");
      window.alert?.(error.message || String(error));
      return false;
    });
    return operation;
  };

  // Legacy controllers already funnel every mutation through save(). On
  // these routes this is deliberately a Supabase write boundary, not the
  // IndexedDB persistence implementation used by the retired backend path.
  window.save = window.saveSupabaseHydratedState;

  /**
   * Adds a shared-catalog candidate as watched and opens a real Supabase
   * Intake workflow.
   * @param {Object} record Shared film candidate.
   * @returns {Promise<{ok: boolean, filmId?: string, intakeId?: string, reason?: string}>}
   */
  window.addSupabaseCandidateToWatched = async function (record) {
    try {
      let result = await window.createSupabaseFreshWatchedIntake({
        title: record?.title,
        year: record?.year,
        tmdbId: record?.tmdbId,
        director: record?.director || "",
        medium: record?.medium,
        type: record?.type,
        runtimeMinutes: record?.runtimeMinutes,
        country: record?.country,
        primaryCountry: record?.primaryCountry,
        posterUrl: record?.poster?.url,
        swedishTitle: record?.swedishTitle,
        screenplayType: record?.screenplayType,
        adaptationSource: record?.adaptationSource,
        letterboxdUrl: record?.letterboxdUrl,
      });
      return {
        ok: true,
        filmId: result.watched.film_id,
        intakeId: result.id,
      };
    } catch (error) {
      return { ok: false, reason: error.message || String(error) };
    }
  };

  window.addFilmRecordToWatched = window.addSupabaseCandidateToWatched;
})();
