/** @file Owns protected catalog metadata, poster enrichment, and person portrait updates. */

(function () {
  /**
   * Writes a fetched poster straight to the shared film catalog. Also
   * corrects the stored year when the poster lookup found the film under a
   * neighboring year instead (Oscar-eligibility-derived years can be one
   * year off from TMDB's own release year - see lookupTmdbFilmPoster in
   * src/domain/supabase-metadata-batch.js).
   * @param {string} filmId
   * @param {string} posterUrl
   * @param {number} [year] Corrected release year, if the match was found under a different year than currently stored.
   * @returns {Promise<void>}
   */
  window.setSupabaseFilmPoster = async function (filmId, posterUrl, year) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let update = { poster_url: posterUrl };
    if (year !== undefined && year !== null) update.year = year;
    let { error } = await ready.client
      .from("films")
      .update(update)
      .eq("id", filmId);
    if (error) throw error;
  };

  /**
   * Writes fetched poster + country/runtime/tmdb_id metadata straight to
   * the shared film catalog, in one call - the broader sibling of
   * setSupabaseFilmPoster, for window.lookupTmdbFilmMetadata's fuller
   * result. Only ever fills in a field that was actually resolved (a null/
   * undefined field here leaves the stored value untouched, it never
   * blanks out existing data). A film always keeps a TMDB identity: tmdbId
   * (a movie) and tvTmdbRef (TV content) each replace the other atomically,
   * so a correction from a wrong movie match to real TV content clears the
   * stale movie id, and neither can be cleared on its own. Likewise
   * `markVerified`/`clearVerified` control tmdb_verified_at - once "Verify
   * TMDB links" confirms a film's id (or the owner explicitly confirms/
   * corrects it), it's skipped by future checks until something clears
   * that verification again.
   * @param {string} filmId
   * @param {{title?: string, posterUrl?: string, year?: number, country?: string, primaryCountry?: string, runtimeMinutes?: number, tmdbId?: string|number|null, tvTmdbRef?: string, markVerified?: boolean, clearVerified?: boolean, directors?: (string|{tmdbId?: number|null, name: string, profilePath?: string|null})[], director?: string, medium?: string, screenplayType?: string|null, originalLanguage?: string}} fields
   * @returns {Promise<void>}
   */
  window.setSupabaseFilmMetadata = async function (filmId, fields) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let update = {};
    if (fields.title != null) update.title = fields.title;
    if (fields.posterUrl != null) update.poster_url = fields.posterUrl;
    if (fields.year != null) update.year = fields.year;
    if (fields.country != null) update.country = fields.country;
    if (fields.primaryCountry != null)
      update.primary_country = fields.primaryCountry;
    if (fields.runtimeMinutes != null)
      update.runtime_minutes = fields.runtimeMinutes;
    if (fields.tvTmdbRef != null) {
      if (fields.tmdbId != null)
        throw new Error("Choose either a movie or TV identity.");
      if (
        !/^TV:[1-9]\d*(?:\/S(?:0|[1-9]\d*)(?:E[1-9]\d*)?)?$/.test(
          fields.tvTmdbRef,
        )
      )
        throw new Error("Invalid TMDB TV reference.");
      update.tmdb_tv_ref = fields.tvTmdbRef;
      update.tmdb_id = null;
    } else if (fields.tmdbId != null) {
      update.tmdb_id = fields.tmdbId;
      update.tmdb_tv_ref = null;
    }
    if (fields.markVerified) update.tmdb_verified_at = new Date().toISOString();
    else if (fields.clearVerified) update.tmdb_verified_at = null;
    if (fields.medium != null) update.medium = fields.medium;
    if (fields.screenplayType != null)
      update.screenplay_type = fields.screenplayType;
    if (fields.originalLanguage != null)
      update.original_language = fields.originalLanguage;
    if (Object.keys(update).length > 0) {
      let { error } = await ready.client
        .from("films")
        .update(update)
        .eq("id", filmId);
      if (error) throw error;
    }
    let directors = fields.directors?.length
      ? fields.directors
      : typeof fields.director === "string" && fields.director.trim()
        ? fields.director
            .split(",")
            .map((s) => ({ name: s.trim() }))
            .filter((d) => d.name)
        : null;
    if (directors?.length && window.persistSupabaseFilmCredits) {
      await window.persistSupabaseFilmCredits(filmId, "director", directors);
    }
  };

  /**
   * Writes a fetched portrait, with its TMDB provenance, straight to the
   * shared people catalog.
   * @param {string} personId
   * @param {{url: string, source?: string, sourceUrl?: string, providerId?: string}} posterRecord
   * @returns {Promise<string>} Canonical person id after identity reconciliation.
   */
  window.setSupabasePersonPortrait = async function (personId, posterRecord) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    if (
      posterRecord.source !== "tmdb" ||
      !/^[1-9][0-9]*$/.test(String(posterRecord.providerId || ""))
    )
      throw new Error("A resolved TMDB person identity is required.");
    let { data, error } = await ready.client.rpc("save_person_tmdb_portrait", {
      p_person_id: personId,
      p_tmdb_id: Number(posterRecord.providerId),
      p_portrait_url: posterRecord.url,
    });
    if (error) throw error;
    return data;
  };

  /**
   * Updates a person row's metadata (name, tmdb_id, verification timestamp)
   * in the shared catalog.
   * @param {string} personId Person UUID.
   * @param {{name?: string, tmdbId?: number|null, markVerified?: boolean, clearVerified?: boolean}} fields
   * @returns {Promise<void>}
   */
  window.setSupabasePersonMetadata = async function (personId, fields) {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    let update = {};
    if (fields.name != null) update.name = fields.name;
    if (fields.tmdbId != null) update.tmdb_id = fields.tmdbId;
    if (fields.markVerified) update.tmdb_verified_at = new Date().toISOString();
    else if (fields.clearVerified) update.tmdb_verified_at = null;
    if (Object.keys(update).length > 0) {
      let { error } = await ready.client
        .from("people")
        .update(update)
        .eq("id", personId);
      if (error) throw error;
    }
  };

  /**
   * Enriches newly added watchlist films through the catalog's protected fill-gaps RPC.
   * @param {WatchlistItem[]} items Persisted watchlist items with catalog ids.
   * @param {Object} [options] Batch concurrency, fetch, and progress callbacks.
   * @returns {Promise<MetadataBatchResult>} Persisted metadata outcomes.
   */
  window.fetchSupabaseWatchlistMetadata = async function (items, options = {}) {
    let isCurrent = window.supabaseWorkspaceContext.beginWorkspaceMutation();
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error("Supabase not configured.");
    window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(isCurrent);
    let skipped = 0;
    let result = await window.runBoundedLookupBatch(
      items,
      {
        idOf: (item) => item.id,
        eligible: (item) => Boolean(item.supabaseFilmId),
        attempts: new Set(),
        failureType: "watchlist-metadata",
        failureRecord: (item, reason) => ({
          id: item.id,
          title: item.title,
          reason: String(reason),
        }),
        persisted: true,
        async lookup(item, context) {
          window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(
            isCurrent,
          );
          let { data: prepared, error } = await ready.client.rpc(
            "prepare_background_film_lookup",
            { p_film_id: item.supabaseFilmId },
          );
          if (error) throw error;
          if (!prepared)
            throw new Error("Film lookup preparation returned no data.");
          let checked = (prepared.requested_fields || []).filter((field) =>
            ["poster_url", "country", "runtime_minutes", "directors"].includes(
              field,
            ),
          );
          if (!checked.length) return { skipped: true };
          let match = await window.lookupTmdbMovieMetadata(
            {
              title: prepared.title,
              year: prepared.year,
              tmdbId: prepared.tmdb_tv_ref || prepared.tmdb_id,
            },
            context,
          );
          if (!match) return null;
          let identity = window.filmTmdbIdentity(match.tmdbId);
          if (!identity)
            throw new Error(
              "Metadata lookup returned no confirmed TMDB identity.",
            );
          let metadata = identity.startsWith("TV:")
            ? { tmdb_tv_ref: identity }
            : { tmdb_id: Number(identity) };
          metadata.checked_fields = checked;
          if (checked.includes("poster_url"))
            metadata.poster_url = match.poster?.url || null;
          if (checked.includes("country")) {
            metadata.country = match.country || null;
            metadata.primary_country = match.primaryCountry || null;
          }
          if (checked.includes("runtime_minutes"))
            metadata.runtime_minutes = Number(match.runtimeMinutes) || null;
          if (checked.includes("directors"))
            metadata.directors = match.directors || [];
          return metadata;
        },
        async apply(item, metadata) {
          window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(
            isCurrent,
          );
          if (metadata.skipped) {
            skipped++;
            return true;
          }
          let { data, error } = await ready.client.rpc(
            "apply_background_film_metadata",
            { p_film_id: item.supabaseFilmId, p_metadata: metadata },
          );
          if (error) throw error;
          if (data?.success === false)
            throw new Error(data.error || "Film metadata could not be saved.");
          window.supabaseWorkspaceContext.assertCurrentWorkspaceMutation(
            isCurrent,
          );
          window.invalidateCachedSupabaseHydrationSource?.();
          return true;
        },
        notFoundReason: "No TMDB match found.",
        warnMessage: (item) =>
          `Watchlist metadata lookup failed for ${item.title}`,
      },
      { ...options, limit: items.length },
    );
    result.found -= skipped;
    result.skipped += skipped;
    return result;
  };
})();
