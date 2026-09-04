/** @file Controls Supabase-native import, backup, health, publication, and opinion maintenance. */

(function () {
  let ui = window.uiText || ((text) => text);
  let escape = window.pageEscape;
  let pendingLetterboxd = null;
  let pendingBackup = null;
  let legacyIntakeId = window.pageQueryParam?.("intake") || "";
  if (legacyIntakeId) {
    window.location.replace(window.intakePageUrl(legacyIntakeId));
    return;
  }

  function source() {
    return (
      window.OSKARS_SUPABASE_HYDRATION_SOURCE || {
        watched: [],
        watchlist: [],
        rankings: [],
        personalAwards: [],
        franchises: [],
        catalogFilms: [],
        profile: null,
      }
    );
  }

  function downloadJson(value, filename) {
    let url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    let link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function stampedFilename(prefix) {
    return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  }

  async function backupValue() {
    let { client } = await readyClient();
    let [awardReviews, entityNotes] = await Promise.all([
      client
        .from("award_reviews")
        .select("year, category, status, reviewed_at")
        .order("year")
        .order("category"),
      client
        .from("entity_notes")
        .select("entity_kind, entity_key, note, updated_at")
        .order("entity_kind")
        .order("entity_key"),
    ]);
    if (awardReviews.error) throw awardReviews.error;
    if (entityNotes.error) throw entityNotes.error;
    return {
      format: "the-oskars-supabase-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        ...source(),
        awardReviews: awardReviews.data,
        entityNotes: entityNotes.data,
      },
    };
  }

  function renderHealth() {
    let finishRenderTimer = window.startOskarsPerformance?.(
      "data:renderWorkspace",
    );
    let value = source();
    let nominations = (value.personalAwards || []).reduce(
      (total, award) => total + (award.personal_nominations || []).length,
      0,
    );
    let missingPosters = (value.watched || []).filter(
      (row) => !row.films?.poster_url,
    ).length;
    document.getElementById("dataHealthView").innerHTML =
      `<h2>${escape(ui("Supabase health"))}</h2>
      <div class="data-health-summary">
        <div><b>${value.watched?.length || 0}</b><span>${escape(ui("Watched"))}</span></div>
        <div><b>${value.watchlist?.length || 0}</b><span>${escape(ui("Watchlist"))}</span></div>
        <div><b>${value.rankings?.length || 0}</b><span>${escape(ui("Ranking scopes"))}</span></div>
        <div><b>${nominations}</b><span>${escape(ui("Award placements"))}</span></div>
      </div>
      <p>${escape(
        missingPosters
          ? ui(
              "{count} watched film(s) have no shared-catalog poster. Catalog corrections remain a service-role maintenance task.",
              { count: missingPosters },
            )
          : ui("Every watched film has a shared-catalog poster."),
      )}</p>
      <p>${escape(ui("Browser sync conflicts, local edit history, metadata batches, and blind-rebuild baselines are not part of the Supabase data model and are no longer shown here."))}</p>`;
    finishRenderTimer?.(`${value.watched?.length || 0} watched film(s)`);
  }

  async function readyClient() {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error(ui("Supabase is not configured."));
    let auth = await window.resolveSupabaseAuthState();
    if (auth.status !== "signed-in") throw new Error(ui("Sign in first."));
    return { client: ready.client, user: auth.user };
  }

  async function deleteAll(client, table, column = "id") {
    let { error } = await client.from(table).delete().not(column, "is", null);
    if (error) throw error;
  }

  async function clearPersonalArchive(client) {
    await deleteAll(client, "award_reviews", "category");
    for (let table of [
      "entity_notes",
      "tags",
      "personal_awards",
      "rankings",
      "watchlist",
      "watched",
    ])
      await deleteAll(client, table);
  }

  async function restoreFilmTags(client, userId, watchedRows) {
    for (let row of watchedRows || []) {
      let names = [
        ...new Set(
          (row.films?.film_tags || [])
            .map((item) => item.tags?.name)
            .filter(Boolean),
        ),
      ];
      let { error: deleteError } = await client
        .from("film_tags")
        .delete()
        .eq("film_id", row.film_id);
      if (deleteError) throw deleteError;
      for (let name of names) {
        let { data: tag, error: tagError } = await client
          .from("tags")
          .upsert({ user_id: userId, name }, { onConflict: "user_id,name" })
          .select("id")
          .single();
        if (tagError) throw tagError;
        let { error } = await client.from("film_tags").insert({
          user_id: userId,
          film_id: row.film_id,
          tag_id: tag.id,
        });
        if (error) throw error;
      }
    }
  }

  async function restoreBackup(value, mode) {
    if (value?.format !== "the-oskars-supabase-backup" || value.version !== 1)
      throw new Error(ui("This is not a supported Supabase backup."));
    let { client, user } = await readyClient();
    let data = value.data || {};
    if (mode === "replace") await clearPersonalArchive(client);

    for (let row of data.watched || []) {
      let { error } = await client.from("watched").upsert(
        {
          user_id: user.id,
          film_id: row.film_id,
          rating: row.rating,
          rating_modifier: row.rating_modifier,
          date_watched: row.date_watched,
          review: row.review,
          want_to_rewatch: Boolean(row.want_to_rewatch),
          rewatch_tier: row.rewatch_tier,
          music_score: row.music_score,
          music_rating: row.music_rating,
          music_rating_value: row.music_rating_value,
          views: row.views,
          platform: row.platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,film_id" },
      );
      if (error) throw error;
    }
    for (let row of data.watchlist || []) {
      let { error } = await client.from("watchlist").upsert(
        {
          user_id: user.id,
          film_id: row.film_id,
          tier: row.tier,
          position: row.position,
          reason: row.reason,
          added_at: row.added_at,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,film_id" },
      );
      if (error) throw error;
    }
    await restoreFilmTags(client, user.id, data.watched);
    for (let ranking of data.rankings || []) {
      let { error } = await client.rpc("replace_ranking_order", {
        p_scope: ranking.scope,
        p_scope_type: ranking.scope_type,
        p_entries: (ranking.ranking_entries || []).map((entry, index) => ({
          ...entry,
          position:
            entry.position || String((index + 1) * 1000).padStart(12, "0"),
        })),
      });
      if (error) throw error;
    }
    for (let award of data.personalAwards || []) {
      let categories = new Set(
        (award.personal_nominations || []).map((entry) => entry.category),
      );
      for (let category of categories) {
        let nominations = (award.personal_nominations || [])
          .filter((entry) => entry.category === category)
          .map((entry) => ({
            film_id: entry.film_id,
            placement: entry.placement,
            detail: entry.detail || "",
            recipients: (entry.personal_nomination_recipients || []).map(
              (recipient) => recipient.recipient_name,
            ),
          }));
        let { error } = await client.rpc("replace_personal_award_category", {
          p_scope: award.scope,
          p_scope_type: award.scope_type,
          p_category: category,
          p_nominations: nominations,
        });
        if (error) throw error;
      }
    }
    if (data.awardReviews?.length) {
      let { error } = await client.from("award_reviews").upsert(
        data.awardReviews.map((row) => ({
          year: row.year,
          category: row.category,
          status: row.status,
          reviewed_at: row.reviewed_at,
        })),
        { onConflict: "user_id,year,category" },
      );
      if (error) throw error;
    }
    if (data.entityNotes?.length) {
      let { error } = await client.from("entity_notes").upsert(
        data.entityNotes.map((row) => ({
          entity_kind: row.entity_kind,
          entity_key: row.entity_key,
          note: row.note,
          updated_at: row.updated_at,
        })),
        { onConflict: "user_id,entity_kind,entity_key" },
      );
      if (error) throw error;
    }
  }

  async function eraseOpinions() {
    let { client } = await readyClient();
    let { error: watchedError } = await client
      .from("watched")
      .update({
        rating: null,
        rating_modifier: null,
        review: null,
        want_to_rewatch: false,
        rewatch_tier: null,
        music_score: null,
        music_rating: null,
        music_rating_value: null,
        updated_at: new Date().toISOString(),
      })
      .not("id", "is", null);
    if (watchedError) throw watchedError;
    let { error: watchlistError } = await client
      .from("watchlist")
      .update({
        tier: null,
        reason: null,
        updated_at: new Date().toISOString(),
      })
      .not("id", "is", null);
    if (watchlistError) throw watchlistError;
    await deleteAll(client, "award_reviews", "category");
    for (let table of ["entity_notes", "personal_awards", "rankings"])
      await deleteAll(client, table);
  }

  async function refreshSource() {
    let refreshed = await window.loadSupabaseLegacyHydrationSource();
    window.OSKARS_SUPABASE_HYDRATION_SOURCE = refreshed;
    window.applySharedFilmArchive?.(
      window.buildSharedFilmArchiveFromSupabase(refreshed.catalogFilms),
    );
    Object.assign(
      window.state,
      window.buildLegacyStateFromSupabaseHydration(refreshed),
    );
    window.rebuildAggregates();
    renderHealth();
  }

  async function setPublication(published) {
    let current = await window.loadSupabaseProfile();
    let slug = published
      ? window.publicProfileSlugify(current?.display_name)
      : null;
    if (published && !slug)
      throw new Error(ui("Set a display name on the Profile page first."));
    let { client } = await readyClient();
    let { error } = await client
      .from("profiles")
      .update({ public_slug: slug })
      .eq("id", current.id);
    if (error) throw error;
    document.getElementById("profileStatus").textContent = slug
      ? ui("Published as {slug}.", { slug })
      : ui("Not published.");
  }

  async function initialize() {
    await window.ensureOskarsData();
    renderHealth();

    document
      .getElementById("downloadBtn")
      .addEventListener("click", async () => {
        let status = document.getElementById("restoreStatus");
        try {
          downloadJson(
            await backupValue(),
            stampedFilename("the-oskars-supabase-backup"),
          );
          status.textContent = ui("Backup downloaded.");
        } catch (error) {
          status.textContent = error.message || String(error);
        }
      });
    document
      .getElementById("uploadInput")
      .addEventListener("change", async (event) => {
        let status = document.getElementById("restoreStatus");
        try {
          pendingBackup = JSON.parse(await event.target.files?.[0]?.text());
          if (pendingBackup?.format !== "the-oskars-supabase-backup")
            throw new Error(ui("Unsupported backup format."));
          status.textContent = ui(
            "Backup from {date}: {watched} watched, {watchlist} watchlist, {rankings} ranking scope(s).",
            {
              date: pendingBackup.exportedAt || ui("unknown date"),
              watched: pendingBackup.data?.watched?.length || 0,
              watchlist: pendingBackup.data?.watchlist?.length || 0,
              rankings: pendingBackup.data?.rankings?.length || 0,
            },
          );
          document.getElementById("jsonImportApplyBtn").disabled = false;
        } catch (error) {
          pendingBackup = null;
          status.textContent = error.message || String(error);
        }
      });
    document
      .getElementById("jsonImportApplyBtn")
      .addEventListener("click", async (event) => {
        if (!pendingBackup) return;
        let button = event.currentTarget;
        let status = document.getElementById("restoreStatus");
        button.disabled = true;
        try {
          await restoreBackup(
            pendingBackup,
            document.getElementById("restoreModeSelect").value,
          );
          await refreshSource();
          status.textContent = ui("Backup restored to Supabase.");
        } catch (error) {
          status.textContent = error.message || String(error);
        } finally {
          button.disabled = false;
        }
      });

    document
      .getElementById("letterboxdZipInput")
      .addEventListener("change", async (event) => {
        let status = document.getElementById("letterboxdImportStatus");
        try {
          pendingLetterboxd = await window.proposeLetterboxdZipImport(
            event.target.files?.[0],
            { baseState: window.state },
          );
          status.textContent = JSON.stringify(
            pendingLetterboxd.report,
            null,
            2,
          );
          document.getElementById("letterboxdImportApplyBtn").disabled =
            !pendingLetterboxd.allowed;
        } catch (error) {
          pendingLetterboxd = null;
          status.textContent = error.message || String(error);
        }
      });
    document
      .getElementById("letterboxdImportApplyBtn")
      .addEventListener("click", async (event) => {
        if (!pendingLetterboxd) return;
        let button = event.currentTarget;
        let status = document.getElementById("letterboxdImportStatus");
        button.disabled = true;
        try {
          let result = await window.applyImportProposal(pendingLetterboxd);
          if (!result?.ok)
            throw new Error(result?.reason || ui("Import failed."));
          await refreshSource();
          status.textContent = ui("Letterboxd import saved to Supabase.");
        } catch (error) {
          status.textContent = error.message || String(error);
        }
      });

    let profile = await window.loadSupabaseProfile();
    document.getElementById("profileStatus").textContent = profile?.public_slug
      ? ui("Published as {slug}.", { slug: profile.public_slug })
      : ui("Not published.");
    document
      .getElementById("publishProfileBtn")
      .addEventListener("click", () =>
        setPublication(true).catch((error) => window.alert(error.message)),
      );
    document
      .getElementById("unpublishProfileBtn")
      .addEventListener("click", () =>
        setPublication(false).catch((error) => window.alert(error.message)),
      );

    document
      .getElementById("clearOpinionsBtn")
      .addEventListener("click", async (event) => {
        if (
          !confirm(
            ui(
              "Permanently erase your Supabase opinions? A backup downloads first.",
            ),
          )
        )
          return;
        let button = event.currentTarget;
        let status = document.getElementById("clearOpinionsStatus");
        button.disabled = true;
        try {
          downloadJson(
            await backupValue(),
            stampedFilename("the-oskars-before-opinion-erasure"),
          );
          await eraseOpinions();
          await refreshSource();
          status.textContent = ui(
            "Opinions erased. Watch history and catalog facts remain.",
          );
        } catch (error) {
          status.textContent = error.message || String(error);
        } finally {
          button.disabled = false;
        }
      });
  }

  initialize().catch((error) => {
    console.error("Failed to initialize Supabase data tools", error);
    document.getElementById("dataHealthView").innerHTML =
      `<div class="detail-empty"><h2>${escape(ui("Could not load data tools"))}</h2><p>${escape(error.message || String(error))}</p></div>`;
  });
})();
