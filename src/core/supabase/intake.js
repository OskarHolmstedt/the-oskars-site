/** @file Owns watched-film Intake creation, workflow progress, and scoped unfinished-workflow reads. */

(function () {
  const INTAKE_WORKFLOW_FIELDS =
    "id, watched_id, version, source, steps, summary, completed_at, created_at, updated_at";
  const INTAKE_WORKFLOW_SELECT = `${INTAKE_WORKFLOW_FIELDS}, watched(id, film_id, rating, rating_modifier, date_watched, platform, views, updated_at, films(id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, medium, type))`;

  function intakeCollectionWriteSelect(options) {
    return options.refreshWorkspace === false
      ? `${INTAKE_WORKFLOW_FIELDS}, watched(${window.supabaseWorkspaceContext.WATCHED_SELECT})`
      : INTAKE_WORKFLOW_SELECT;
  }

  /** Loads every resumable Intake for the signed-in user. @returns {Promise<Object[]>} */
  window.loadSupabaseIntakeWorkflows = async function () {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") return [];
    let { data, error } = await ready.client
      .from("intake_workflows")
      .select(INTAKE_WORKFLOW_SELECT)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  };

  /**
   * Loads the signed-in account's newest unfinished Intake for one catalog film.
   * @param {string} filmId Catalog film UUID.
   * @returns {Promise<Object|null>}
   */
  window.loadSupabaseOpenIntakeForFilm = async function (filmId) {
    if (!window.isUuid(filmId)) return null;
    if (window.oskarsCapabilities?.().canEdit === false) return null;
    if (window.state?.isPublicProfileView) return null;
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let authState = await window.resolveSupabaseAuthState();
    if (authState.status !== "signed-in") return null;
    let { data, error } = await ready.client
      .from("intake_workflows")
      .select("id, completed_at, watched!inner(film_id)")
      .eq("user_id", authState.user.id)
      .is("completed_at", null)
      .eq("watched.film_id", filmId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  // Film detail owns its scoped refresh; other Intake callers retain the
  // complete workspace refresh they already depend on.
  async function finishIntakeCollectionWrite(workflow, isCurrent, options) {
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (options.refreshWorkspace !== false) {
      await window.refreshSupabaseWorkspace();
      return;
    }
    let workspace = window.supabaseWorkspaceContext.workspaceState;
    let watched = workflow.watched;
    if (workspace) {
      let index = workspace.watched.findIndex(
        (row) => row.film_id === watched.film_id,
      );
      if (index >= 0) {
        let previous = workspace.watched[index];
        workspace.watched[index] = {
          ...previous,
          ...watched,
          films: { ...previous.films, ...watched.films },
        };
      } else workspace.watched.push(watched);
      workspace.watchlist = workspace.watchlist.filter(
        (row) => row.film_id !== watched.film_id,
      );
    }
    window.invalidateCachedSupabaseHydrationSource?.();
  }

  /** Atomically creates a shared film, watched row, and fresh Intake, refusing a film with no catalog or TMDB match. @param {Object} values Form values. @param {{refreshWorkspace?: boolean}} [options] Whether to refresh the complete workspace (default true). @returns {Promise<Object>} The joined workflow, with `notAddedPeople` listing directors that matched no catalog or TMDB person. */
  window.createSupabaseFreshWatchedIntake = async function (
    values,
    options = {},
  ) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let title = String(values?.title || "").trim();
    if (!title) throw new Error("Title is required.");
    let rawYear = values?.year;
    let year =
      rawYear !== null && rawYear !== undefined && String(rawYear).trim() !== ""
        ? Number(rawYear)
        : NaN;
    if (!Number.isInteger(year) || year < 1888 || year > 2100) {
      throw new Error(
        "Release year must be a valid integer between 1888 and 2100.",
      );
    }
    let directors = String(values?.director || "")
      .split(/\s*(?:,|\band\b|&)\s*/i)
      .map((name) => name.trim())
      .filter(Boolean);
    // A film without a TMDB identity is matched in the catalog first (the
    // RPC below finds it again by exact title and year), then on TMDB; with
    // neither it is not added.
    await window.ensureCatalogIdentity?.();
    let identity = window.filmTmdbIdentity(values?.tmdbId);
    if (!identity) {
      let catalogId = await window.findSupabaseCatalogFilm(
        ready.client,
        title,
        year,
      );
      if (!catalogId) {
        identity = await window.lookupTmdbFilmIdentity({
          title,
          year,
          letterboxdUrl: values?.letterboxdUrl || values?.url,
        });
        if (!identity)
          throw new Error(
            window.catalogIdentityWarning("film", [
              window.catalogFilmLabel({ title, year }),
            ]),
          );
      }
    }
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let tvRef = /^TV:/.test(identity || "");
    let { data, error } = await ready.client.rpc(
      tvRef ? "create_tv_watched_intake" : "create_fresh_watched_intake",
      {
        p_title: title,
        p_year: year,
        ...(tvRef
          ? { p_tv_ref: identity }
          : { p_tmdb_id: identity ? Number(identity) : null }),
        p_directors: directors,
        p_rating: values?.rating ? Number(values.rating) : null,
        p_rating_modifier: values?.ratingModifier || null,
        p_date_watched: values?.dateWatched || null,
        p_platform: values?.platform || null,
        p_views: values?.views ? Number(values.views) : 1,
      },
    );
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let { data: joined, error: selectError } = await ready.client
      .from("intake_workflows")
      .select(intakeCollectionWriteSelect(options))
      .eq("id", data.id)
      .single();
    if (selectError) throw selectError;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    // The RPC credits directors already in the catalog; the rest are looked
    // up on TMDB here, and any still unmatched are reported.
    joined.notAddedPeople = directors.length
      ? await window.persistSupabaseFilmCredits(
          joined.watched.film_id,
          "director",
          directors,
        )
      : [];
    await finishIntakeCollectionWrite(joined, isCurrent, options);
    return joined;
  };

  /** Updates one Intake using optimistic concurrency. @param {Object} workflow Last loaded workflow. @param {Object} changes Allowed column changes. @returns {Promise<Object>} Joined updated workflow. */
  window.updateSupabaseIntakeWorkflow = async function (workflow, changes) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let payload = { updated_at: new Date().toISOString() };
    for (let key of ["steps", "summary", "completed_at"])
      if (Object.prototype.hasOwnProperty.call(changes, key))
        payload[key] = changes[key];
    let { data, error } = await ready.client
      .from("intake_workflows")
      .update(payload)
      .eq("id", workflow.id)
      .eq("updated_at", workflow.updated_at)
      .select(INTAKE_WORKFLOW_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw Object.assign(
        new Error("This Intake changed elsewhere. Refresh before continuing."),
        { code: "OSKARS_STALE_WRITE" },
      );
    }
    return data;
  };

  /** Writes Intake rating/viewing facts and returns a cache-shaped watched row. @param {Object} watched Last loaded watched row. @param {Object} values Form values. @returns {Promise<Object>} */
  window.setSupabaseIntakeWatchedFacts = async function (watched, values) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let { data, error } = await ready.client
      .from("watched")
      .update({
        rating: Number(values.rating),
        rating_modifier: values.ratingModifier || null,
        date_watched: values.dateWatched || null,
        platform: values.platform || null,
        views: values.views ? Number(values.views) : 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", watched.id)
      .eq("updated_at", watched.updated_at)
      .select(window.supabaseWorkspaceContext.WATCHED_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw Object.assign(
        new Error(
          "This watched film changed elsewhere. Refresh before continuing.",
        ),
        { code: "OSKARS_STALE_WRITE" },
      );
    }
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    if (window.supabaseWorkspaceContext.workspaceState) {
      let index =
        window.supabaseWorkspaceContext.workspaceState.watched.findIndex(
          (row) => row.id === data.id,
        );
      if (index >= 0)
        window.supabaseWorkspaceContext.workspaceState.watched[index] = data;
    }
    return data;
  };

  /**
   * Moves a film from the signed-in user's watchlist to watched, straight
   * through to Supabase's move_watchlist_to_watched RPC (already proven
   * atomic in tests/supabase-integration.test.js), then updates the
   * in-memory cache on both sides. The RPC returns a bare `watched` row
   * (no film join); this borrows the film join data already present on
   * the watchlist entry being removed rather than a second round trip.
   * @param {string} filmId Shared catalog film id (not the watchlist row id).
   * @param {{rating?: number, dateWatched?: string, review?: string}} [options]
   * @returns {Promise<Object>} The new, cache-shaped watched row.
   */
  window.moveSupabaseWatchlistToWatched = async function (
    filmId,
    options = {},
  ) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();

    let watchlistEntry =
      window.supabaseWorkspaceContext.workspaceState?.watchlist?.find(
        (row) => row.film_id === filmId,
      );

    let { data, error } = await ready.client.rpc("move_watchlist_to_watched", {
      p_film_id: filmId,
      p_rating: options.rating ?? null,
      p_date_watched: options.dateWatched ?? null,
      p_review: options.review ?? null,
    });
    if (error) throw error;

    let films = watchlistEntry?.films;
    if (!films) {
      let { data: filmRow, error: filmError } = await ready.client
        .from("films")
        .select(
          "id, tmdb_id, tmdb_tv_ref, title, year, poster_url, runtime_minutes, country, primary_country, medium, type, screenplay_type",
        )
        .eq("id", filmId)
        .maybeSingle();
      if (filmError) throw filmError;
      films = filmRow || null;
    }

    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let watchedRow = { ...data, films };
    if (window.supabaseWorkspaceContext.workspaceState) {
      if (
        Array.isArray(window.supabaseWorkspaceContext.workspaceState.watchlist)
      ) {
        window.supabaseWorkspaceContext.workspaceState.watchlist =
          window.supabaseWorkspaceContext.workspaceState.watchlist.filter(
            (row) => row.film_id !== filmId,
          );
      }
      if (
        Array.isArray(window.supabaseWorkspaceContext.workspaceState.watched)
      ) {
        window.supabaseWorkspaceContext.workspaceState.watched.push(watchedRow);
      }
    }
    return watchedRow;
  };

  /**
   * Atomically moves a watchlist film to watched and opens its Intake workflow using the existing shared-catalog film.
   * @param {string} watchlistId
   * @param {{rating?: number, ratingModifier?: string, dateWatched?: string, platform?: string, views?: number}} values
   * @param {{refreshWorkspace?: boolean}} [options] Whether to refresh the complete workspace (default true).
   * @returns {Promise<Object>} The joined intake_workflows row.
   */
  window.createSupabaseWatchlistWatchedIntake = async function (
    watchlistId,
    values,
    options = {},
  ) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let { data, error } = await ready.client.rpc(
      "create_watchlist_watched_intake",
      {
        p_watchlist_id: watchlistId,
        p_rating: values.rating ? Number(values.rating) : null,
        p_rating_modifier: values.ratingModifier || null,
        p_date_watched: values.dateWatched || null,
        p_platform: values.platform || null,
        p_views: values.views ? Number(values.views) : 1,
      },
    );
    if (error) throw error;
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let { data: joined, error: selectError } = await ready.client
      .from("intake_workflows")
      .select(intakeCollectionWriteSelect(options))
      .eq("id", data.id)
      .single();
    if (selectError) throw selectError;
    await finishIntakeCollectionWrite(joined, isCurrent, options);
    return joined;
  };

  /**
   * Adds a shared-catalog candidate as watched and opens a real Supabase
   * Intake workflow.
   * @param {Object} record Shared film candidate.
   * @param {{refreshWorkspace?: boolean}} [options] Whether to refresh the complete workspace (default true).
   * @returns {Promise<{ok: boolean, filmId?: string, intakeId?: string, reason?: string}>}
   */
  window.addSupabaseCandidateToWatched = async function (record, options = {}) {
    try {
      let result = await window.createSupabaseFreshWatchedIntake(
        {
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
        },
        options,
      );
      return {
        ok: true,
        filmId: result.watched.film_id,
        intakeId: result.id,
      };
    } catch (error) {
      return { ok: false, reason: error.message || String(error) };
    }
  };
})();
