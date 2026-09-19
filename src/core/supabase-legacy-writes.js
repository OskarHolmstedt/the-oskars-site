/**
 * @file Persists mutations made by the established film and period view
 * models directly to Supabase, without browser persistence hydration.
 */

(function () {
  const RANK_FIELD_BY_SCOPE_TYPE = {
    years: "yearRank",
    decades: "decadeRank",
    centuries: "centuryRank",
    allTime: "allTimeRank",
  };
  let saveChain = Promise.resolve();

  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
      return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
        .join(",")}}`;
    return JSON.stringify(value ?? null);
  }

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
      p_screenplay_type: record?.screenplayType || null,
      p_adaptation_source: record?.adaptationSource || null,
      p_letterboxd_url: record?.letterboxdUrl || null,
    };
  }

  async function resolveFilmId(client, record) {
    if (record?.supabaseFilmId) return record.supabaseFilmId;
    let tmdbId = Number(record?.tmdbId);
    if (tmdbId) {
      let { data, error } = await client
        .from("films")
        .select("id")
        .eq("tmdb_id", tmdbId)
        .maybeSingle();
      if (error) throw error;
      if (data?.id) {
        record.supabaseFilmId = data.id;
        return data.id;
      }
    }
    if (!String(record?.title || "").trim())
      throw new Error("A film title is required before it can be saved.");
    let { data, error } = await client.rpc(
      "find_or_create_film",
      catalogPayload(record),
    );
    if (error) throw error;
    record.supabaseFilmId = data;
    return data;
  }

  async function syncWatched(client, source, films) {
    let sourceByFilm = new Map(
      (source.watched || []).map((row) => [row.film_id, row]),
    );
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
        let { error } = await client
          .from("watched")
          .upsert(
            { film_id: filmId, ...payload },
            { onConflict: "user_id,film_id" },
          );
        if (error) throw error;
      } else if (stable(payload) !== stable(sourceWatchedPayload(existing))) {
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
      }
    }
  }

  async function syncTags(client, authUserId, source, films) {
    let sourceTags = new Map(
      (source.watched || []).map((row) => [
        row.film_id,
        (row.films?.film_tags || [])
          .map((item) => item.tags?.name)
          .filter(Boolean)
          .sort(),
      ]),
    );
    for (let film of films) {
      let filmId = await resolveFilmId(client, film);
      let desired = [
        ...new Set(window.parseFilmTags?.(film.tags) || []),
      ].sort();
      if (stable(desired) === stable(sourceTags.get(filmId) || [])) continue;

      let desiredTagIds = [];
      for (let name of desired) {
        let { data: tag, error: tagError } = await client
          .from("tags")
          .upsert({ user_id: authUserId, name }, { onConflict: "user_id,name" })
          .select("id")
          .single();
        if (tagError) throw tagError;
        desiredTagIds.push(tag.id);
      }

      if (desiredTagIds.length) {
        let { error: insertError } = await client.from("film_tags").upsert(
          desiredTagIds.map((tagId) => ({
            user_id: authUserId,
            film_id: filmId,
            tag_id: tagId,
          })),
          { onConflict: "user_id,film_id,tag_id" },
        );
        if (insertError) throw insertError;
      }

      let { data: existingRows, error: fetchError } = await client
        .from("film_tags")
        .select("tag_id")
        .eq("user_id", authUserId)
        .eq("film_id", filmId);
      if (fetchError) throw fetchError;

      let toRemove = (existingRows || [])
        .map((r) => r.tag_id)
        .filter((id) => !desiredTagIds.includes(id));
      if (toRemove.length) {
        let { error: deleteError } = await client
          .from("film_tags")
          .delete()
          .eq("user_id", authUserId)
          .eq("film_id", filmId)
          .in("tag_id", toRemove);
        if (deleteError) throw deleteError;
      }
    }
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  async function findOrCreateFranchise(client, name, parentId) {
    let slug = slugify(name);
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

  async function syncFranchiseAdditions(client, source, films) {
    let existing = new Set();
    (source.watched || []).forEach((row) =>
      (row.films?.film_franchises || []).forEach((membership) =>
        existing.add(`${row.film_id}\n${membership.franchises?.id || ""}`),
      ),
    );
    for (let film of films) {
      let filmId = await resolveFilmId(client, film);
      for (let membership of film.franchises || []) {
        let names = [
          ...(membership.parentChainNames || membership.parentNames || []),
          membership.name,
        ].filter(Boolean);
        let parentId = null;
        let leafId = null;
        for (let name of names) {
          leafId = await findOrCreateFranchise(client, name, parentId);
          parentId = leafId;
        }
        if (!leafId || existing.has(`${filmId}\n${leafId}`)) continue;
        let { error } = await client.from("film_franchises").insert({
          franchise_id: leafId,
          film_id: filmId,
          position: Number(membership.rank) || null,
        });
        if (error) throw error;
      }
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

  async function syncAwards(client, source, films) {
    let desired = desiredAwardGroups(films);
    let original = sourceAwardGroups(source);
    let keys = new Set([...desired.keys(), ...original.keys()]);
    for (let key of keys) {
      let next = desired.get(key) || [];
      if (stable(next) === stable(original.get(key) || [])) continue;
      let [scopeType, scope, category] = key.split("\n");
      let { error } = await client.rpc("replace_personal_award_category", {
        p_scope: scope,
        p_scope_type: scopeType,
        p_category: category,
        p_nominations: next,
      });
      if (error) throw error;
    }
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
        if (!scope || !(Number(film[RANK_FIELD_BY_SCOPE_TYPE[scopeType]]) > 0))
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
    for (let ranking of rankings.values()) {
      let rankField = RANK_FIELD_BY_SCOPE_TYPE[ranking.scope_type];
      if (!rankField) continue;
      let originalIds = (ranking.ranking_entries || []).map(
        (entry) => entry.film_id,
      );
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
      let desiredIds = desiredFilms.map((film) => film.supabaseFilmId);
      if (stable(originalIds) === stable(desiredIds)) continue;
      let originalByFilm = new Map(
        (ranking.ranking_entries || []).map((entry) => [entry.film_id, entry]),
      );
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
      let { error } = await client.rpc("replace_ranking_order", {
        p_scope: ranking.scope,
        p_scope_type: ranking.scope_type,
        p_entries: entries,
      });
      if (error) throw error;
    }
  }

  async function syncWatchlist(client, source, items) {
    let originalById = new Map(
      (source.watchlist || []).map((row) => [row.id, row]),
    );
    let desiredIds = new Set();
    for (let [index, item] of items.entries()) {
      let original = originalById.get(item.id);
      let filmId = original?.film_id || (await resolveFilmId(client, item));
      let payload = {
        film_id: filmId,
        tier: item.tier || null,
        tier_modifier: item.tierModifier || null,
        position: positionFor(index),
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
        if (stable(before) !== stable(comparable)) {
          let query = client
            .from("watchlist")
            .update(payload)
            .eq("id", original.id);
          if (original.updated_at)
            query = query.eq("updated_at", original.updated_at);
          let { data, error } = await query.select("id");
          if (error) throw error;
          if (!data?.length)
            throw new Error(
              "Watchlist changed in another session — reload first.",
            );
        }
      } else {
        let { data, error } = await client
          .from("watchlist")
          .upsert(payload, { onConflict: "user_id,film_id" })
          .select("id")
          .single();
        if (error) throw error;
        desiredIds.add(data.id);
      }
    }
    for (let row of source.watchlist || []) {
      if (desiredIds.has(row.id)) continue;
      let { error } = await client.from("watchlist").delete().eq("id", row.id);
      if (error) throw error;
    }
  }

  async function reconcile(options = {}) {
    let onProgress = options.onProgress;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let auth = await window.resolveSupabaseAuthState();
    if (auth.status !== "signed-in") throw new Error("Sign in before editing.");
    let source = window.OSKARS_SUPABASE_HYDRATION_SOURCE || {};
    window.ensureAggregatesFresh?.();
    let films = Object.values(window.state?.filmsById || {});
    // Coarse per-stage progress, not per-film: this is the shared write
    // path behind every window.save() call in the app (single-edit saves
    // included), so reporting stays a cheap optional hook here rather than
    // plumbed into each stage's own per-row loop.
    let stages = [
      ["Watched films", () => syncWatched(ready.client, source, films)],
      ["Tags", () => syncTags(ready.client, auth.user.id, source, films)],
      [
        "Franchise additions",
        () => syncFranchiseAdditions(ready.client, source, films),
      ],
      ["Awards", () => syncAwards(ready.client, source, films)],
      ["Rankings", () => syncRankings(ready.client, source, films)],
      [
        "Watchlist",
        () =>
          syncWatchlist(ready.client, source, window.state?.watchlist || []),
      ],
    ];
    for (let index = 0; index < stages.length; index++) {
      let [label, run] = stages[index];
      await run();
      onProgress?.(label, index + 1, stages.length);
    }
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
    window.showStorageStatus?.("Saved to Supabase", "saved");
    return true;
  }

  /**
   * Saves the current film/period view model straight through to Supabase.
   * Calls are serialized so rapid UI actions cannot interleave writes.
   * @param {Object} [options] Save options.
   * @param {function(string, number, number): void} [options.onProgress]
   *   Called once per reconcile stage as (label, doneStages, totalStages) -
   *   optional, for callers doing a large bulk save (e.g. an import apply)
   *   that want to show real progress instead of a silent wait.
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
        intakeId: result.workflow.id,
      };
    } catch (error) {
      return { ok: false, reason: error.message || String(error) };
    }
  };

  window.addFilmRecordToWatched = window.addSupabaseCandidateToWatched;
})();
