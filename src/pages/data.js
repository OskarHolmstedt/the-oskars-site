/** @file Controls account import, backup, summary, publication, and opinion maintenance. */

(function () {
  let ui = window.uiText || ((text) => text);
  let escape = window.pageEscape;
  let pendingLetterboxd = null;
  let pendingBackup = null;
  let pendingGoogleSheetsSource = null;
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

  function archiveIsEmpty(value) {
    return ![
      value.watched,
      value.watchlist,
      value.rankings,
      value.personalAwards,
    ].some((records) => records?.length);
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
    let empty = archiveIsEmpty(value);
    let letterboxdPanel = document.getElementById("letterboxdImport");
    letterboxdPanel?.classList.toggle("data-panel--recommended", empty);
    let importEyebrow = document.getElementById("letterboxdImportEyebrow");
    if (importEyebrow)
      importEyebrow.textContent = ui(
        empty ? "Recommended first step" : "Import from another service",
      );
    document.getElementById("dataHealthView").innerHTML =
      `<div class="data-health-heading">
        <div><span class="eyebrow">${escape(ui("Your archive"))}</span><h2>${escape(ui("Data summary"))}</h2></div>
        <p>${
          empty
            ? `${escape(ui("Your archive is empty."))} <a href="#letterboxdImport">${escape(ui("Start with a Letterboxd import."))}</a>`
            : `${escape(ui("Your archive is ready."))} <a href="#backupRestore">${escape(ui("Download a backup before a large restore or irreversible change."))}</a>`
        }</p>
      </div>
      <div class="data-health-summary">
        <div><b>${value.watched?.length || 0}</b><span>${escape(ui("Watched"))}</span></div>
        <div><b>${value.watchlist?.length || 0}</b><span>${escape(ui("Watchlist"))}</span></div>
        <div><b>${value.rankings?.length || 0}</b><span>${escape(ui("Ranking scopes"))}</span></div>
        <div><b>${nominations}</b><span>${escape(ui("Award placements"))}</span></div>
      </div>
      <p class="data-health-note">${escape(
        missingPosters
          ? ui("{count} watched film(s) are missing poster artwork.", {
              count: missingPosters,
            })
          : ui("Every watched film has a shared-catalog poster."),
      )}</p>`;
    finishRenderTimer?.(`${value.watched?.length || 0} watched film(s)`);
  }

  async function readyClient() {
    let ready = await window.ensureSupabaseClient();
    if (!ready) throw new Error(ui("Account storage is not configured."));
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
    let rowsWithTags = (watchedRows || []).filter(
      (row) => (row.films?.film_tags || []).length > 0,
    );
    for (let row of rowsWithTags) {
      let names = [
        ...new Set(
          (row.films?.film_tags || [])
            .map((item) => item.tags?.name)
            .filter(Boolean),
        ),
      ];
      if (!names.length) continue;
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

  /**
   * Validates the structure and required row fields of a Supabase backup payload before restoration.
   * @param {object} value - The parsed JSON backup payload.
   */
  function validateBackupPayload(value) {
    if (value?.format !== "the-oskars-supabase-backup" || value.version !== 1) {
      throw new Error(ui("This is not a supported backup."));
    }
    let data = value.data;
    if (!data || typeof data !== "object") {
      throw new Error(ui("This is not a supported backup."));
    }
    if (data.watched != null && !Array.isArray(data.watched)) {
      throw new Error(ui("This is not a supported backup."));
    }
    if (data.watchlist != null && !Array.isArray(data.watchlist)) {
      throw new Error(ui("This is not a supported backup."));
    }
    if (data.rankings != null && !Array.isArray(data.rankings)) {
      throw new Error(ui("This is not a supported backup."));
    }
    if (data.personalAwards != null && !Array.isArray(data.personalAwards)) {
      throw new Error(ui("This is not a supported backup."));
    }
    if (data.awardReviews != null && !Array.isArray(data.awardReviews)) {
      throw new Error(ui("This is not a supported backup."));
    }
    if (data.entityNotes != null && !Array.isArray(data.entityNotes)) {
      throw new Error(ui("This is not a supported backup."));
    }

    for (let row of data.watched || []) {
      if (!row || typeof row !== "object" || !row.film_id) {
        throw new Error(ui("This is not a supported backup."));
      }
    }
    for (let row of data.watchlist || []) {
      if (!row || typeof row !== "object" || !row.film_id) {
        throw new Error(ui("This is not a supported backup."));
      }
    }
    for (let ranking of data.rankings || []) {
      if (
        !ranking ||
        typeof ranking !== "object" ||
        !ranking.scope ||
        !ranking.scope_type
      ) {
        throw new Error(ui("This is not a supported backup."));
      }
      if (
        ranking.ranking_entries != null &&
        !Array.isArray(ranking.ranking_entries)
      ) {
        throw new Error(ui("This is not a supported backup."));
      }
      for (let entry of ranking.ranking_entries || []) {
        if (!entry || typeof entry !== "object" || !entry.film_id) {
          throw new Error(ui("This is not a supported backup."));
        }
      }
    }
    for (let award of data.personalAwards || []) {
      if (
        !award ||
        typeof award !== "object" ||
        !award.scope ||
        !award.scope_type
      ) {
        throw new Error(ui("This is not a supported backup."));
      }
      if (
        award.personal_nominations != null &&
        !Array.isArray(award.personal_nominations)
      ) {
        throw new Error(ui("This is not a supported backup."));
      }
      for (let nom of award.personal_nominations || []) {
        if (!nom || typeof nom !== "object" || !nom.category || !nom.film_id) {
          throw new Error(ui("This is not a supported backup."));
        }
      }
    }
    for (let review of data.awardReviews || []) {
      if (
        !review ||
        typeof review !== "object" ||
        !review.year ||
        !review.category
      ) {
        throw new Error(ui("This is not a supported backup."));
      }
    }
    for (let note of data.entityNotes || []) {
      if (
        !note ||
        typeof note !== "object" ||
        !note.entity_kind ||
        !note.entity_key
      ) {
        throw new Error(ui("This is not a supported backup."));
      }
    }
  }
  window.validateBackupPayload = validateBackupPayload;

  async function restoreBackup(value, mode) {
    validateBackupPayload(value);
    let { client, user } = await readyClient();
    let data = value.data || {};
    if (mode === "replace") {
      let safetyBackup = await backupValue();
      downloadJson(safetyBackup, stampedFilename("the-oskars-before-restore"));
      await clearPersonalArchive(client);
    }

    let watchedRows = (data.watched || []).map((row) => ({
      user_id: user.id,
      film_id: row.film_id,
      rating: row.rating,
      rating_modifier: row.rating_modifier,
      date_watched: row.date_watched,
      review: row.review,
      want_to_rewatch: Boolean(row.want_to_rewatch),
      rewatch_tier: row.rewatch_tier,
      rewatch_tier_modifier: row.rewatch_tier_modifier,
      music_score: row.music_score,
      music_rating: row.music_rating,
      music_rating_value: row.music_rating_value,
      views: row.views,
      platform: row.platform,
      updated_at: new Date().toISOString(),
    }));

    const BATCH_SIZE = 200;
    for (let from = 0; from < watchedRows.length; from += BATCH_SIZE) {
      let batch = watchedRows.slice(from, from + BATCH_SIZE);
      let { error } = await client
        .from("watched")
        .upsert(batch, { onConflict: "user_id,film_id" });
      if (error) throw error;
    }

    let watchlistRows = (data.watchlist || []).map((row) => ({
      user_id: user.id,
      film_id: row.film_id,
      tier: row.tier,
      tier_modifier: row.tier_modifier,
      position: row.position,
      reason: row.reason,
      added_at: row.added_at,
      updated_at: new Date().toISOString(),
    }));

    for (let from = 0; from < watchlistRows.length; from += BATCH_SIZE) {
      let batch = watchlistRows.slice(from, from + BATCH_SIZE);
      let { error } = await client
        .from("watchlist")
        .upsert(batch, { onConflict: "user_id,film_id" });
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
      window.buildSharedFilmArchiveFromSupabase(
        refreshed.catalogFilms,
        refreshed.franchises,
      ),
    );
    Object.assign(
      window.state,
      window.buildLegacyStateFromSupabaseHydration(refreshed),
    );
    window.rebuildAggregates();
    renderHealth();
  }

  function formatGoogleSheetsReports(reports) {
    return reports
      .map((report) => {
        let lines = [
          `${report.name}: ${report.totalRows} row(s) - resolved ${report.resolved} ` +
            `(tmdb ${report.viaTmdb}, title+year ${report.viaTitleYear}, ` +
            `fuzzy ${report.viaFuzzy}, title-only ${report.viaTitleOnly}, ` +
            `period history ${report.viaPeriodHistory}, ` +
            `category history ${report.viaCategoryHistory}), ` +
            `would-create ${report.wouldCreateFilms}, created ${report.createdFilms}, ` +
            `ambiguous ${report.ambiguous.length}, skipped ${report.skipped.length}`,
        ];
        for (let [key, value] of Object.entries(report.notes))
          lines.push(`  ${key}: ${value}`);
        if (report.ambiguous.length)
          lines.push(
            `  ambiguous (sample): ${report.ambiguous
              .slice(0, 10)
              .map((entry) => `"${entry.title}" (${entry.year || "?"})`)
              .join("; ")}`,
          );
        if (report.skipped.length)
          lines.push(
            `  skipped (sample): ${report.skipped
              .slice(0, 10)
              .map((entry) => entry.reason)
              .join("; ")}`,
          );
        return lines.join("\n");
      })
      .join("\n\n");
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
            stampedFilename("the-oskars-backup"),
          );
          window.noteBackupTaken?.();
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
          validateBackupPayload(pendingBackup);
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
          status.textContent = ui("Backup restored to your account.");
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
        let progress = document.getElementById("letterboxdImportProgress");
        let applyBtn = document.getElementById("letterboxdImportApplyBtn");
        applyBtn.disabled = true;
        status.textContent = ui("Parsing your export…");
        try {
          pendingLetterboxd = await window.proposeLetterboxdZipImport(
            event.target.files?.[0],
            { baseState: window.state },
          );
          // Films with no archive match get their TMDB details looked up
          // now, before Apply - the shared catalog is create-only once a
          // film row exists (issue #440), so this is the only point a
          // fresh film's metadata can still be filled in automatically.
          let freshCount =
            pendingLetterboxd.report.freshArchiveFilms?.length || 0;
          if (freshCount) {
            status.textContent = ui(
              "Looking up film details for {count} new film(s)…",
              { count: freshCount },
            );
            await window.enrichLetterboxdProposalMetadata(pendingLetterboxd, {
              onProgress(done, total) {
                progress.hidden = false;
                progress.max = total || 1;
                progress.value = done;
                status.textContent = ui(
                  "Looking up film details ({done}/{total})…",
                  { done, total },
                );
              },
            });
          }
          status.textContent = JSON.stringify(
            pendingLetterboxd.report,
            null,
            2,
          );
          applyBtn.disabled = !pendingLetterboxd.allowed;
        } catch (error) {
          pendingLetterboxd = null;
          status.textContent = error.message || String(error);
        } finally {
          progress.hidden = true;
        }
      });
    document
      .getElementById("letterboxdImportApplyBtn")
      .addEventListener("click", async (event) => {
        if (!pendingLetterboxd) return;
        let button = event.currentTarget;
        let status = document.getElementById("letterboxdImportStatus");
        let progress = document.getElementById("letterboxdImportProgress");
        button.disabled = true;
        // Saving reconciles the whole archive against Supabase one changed
        // film at a time (src/core/supabase-legacy-writes.js), so a large
        // import can take a real while - the stage progress below is the
        // only other visible sign it's still working, not stuck.
        status.textContent = ui(
          "Saving to your account… this can take a while for a large import. Don't close this tab.",
        );
        function onProgress(stage, done, total) {
          progress.hidden = false;
          progress.max = total || 1;
          progress.value = done;
          status.textContent = ui(
            "Saving {stage} ({done}/{total})… Don't close this tab.",
            { stage, done, total },
          );
        }
        try {
          let result = await window.applyImportProposal(pendingLetterboxd, {
            onProgress,
          });
          if (!result?.ok)
            throw new Error(result?.errors?.join(" ") || ui("Import failed."));
          await refreshSource();
          status.textContent = ui("Letterboxd import saved to your account.");
        } catch (error) {
          status.textContent = error.message || String(error);
        } finally {
          progress.hidden = true;
          button.disabled = false;
        }
      });

    if (window.googleSheetsSupabaseImportConfigured?.()) {
      let section = document.getElementById("googleSheetsImport");
      section.hidden = false;
      let status = document.getElementById("googleSheetsStatus");
      let progress = document.getElementById("googleSheetsProgress");
      let applyBtn = document.getElementById("googleSheetsApplyBtn");
      function onProgress(stage, done, total) {
        progress.hidden = false;
        progress.max = total || 1;
        progress.value = done;
        status.textContent = ui("{stage}: {done}/{total}...", {
          stage,
          done,
          total,
        });
      }
      document
        .getElementById("googleSheetsPreviewBtn")
        .addEventListener("click", async (event) => {
          let button = event.currentTarget;
          button.disabled = true;
          applyBtn.disabled = true;
          pendingGoogleSheetsSource = null;
          try {
            status.textContent = ui("Signing in and fetching your Sheet...");
            let source = await window.fetchGoogleSheetsSupabaseSource();
            let { reports } = await window.runGoogleSheetsSupabaseImport(
              source,
              { confirm: false, onProgress },
            );
            pendingGoogleSheetsSource = source;
            progress.hidden = true;
            status.textContent = formatGoogleSheetsReports(reports);
            applyBtn.disabled = false;
          } catch (error) {
            progress.hidden = true;
            status.textContent = error.message || String(error);
          } finally {
            button.disabled = false;
          }
        });
      applyBtn.addEventListener("click", async (event) => {
        if (!pendingGoogleSheetsSource) return;
        if (
          !confirm(
            ui("Save the previewed Google Sheets changes to your account?"),
          )
        )
          return;
        let button = event.currentTarget;
        let previewBtn = document.getElementById("googleSheetsPreviewBtn");
        button.disabled = true;
        previewBtn.disabled = true;
        try {
          let { reports } = await window.runGoogleSheetsSupabaseImport(
            pendingGoogleSheetsSource,
            { confirm: true, onProgress },
          );
          await refreshSource();
          progress.hidden = true;
          status.textContent = formatGoogleSheetsReports(reports);
          pendingGoogleSheetsSource = null;
        } catch (error) {
          progress.hidden = true;
          status.textContent = error.message || String(error);
        } finally {
          previewBtn.disabled = false;
        }
      });
    }

    document.getElementById("dataSharingGroup").hidden =
      !window.oskarsCapabilities?.().canPublish;
    let communitySnapshotView = document.getElementById(
      "publicProfilePublicationView",
    );
    window.renderPublicProfilePublication(communitySnapshotView);
    communitySnapshotView.addEventListener(
      "click",
      window.handlePublicProfilePublicationAction,
    );

    document
      .getElementById("clearOpinionsBtn")
      .addEventListener("click", async (event) => {
        if (
          !confirm(
            ui(
              "Permanently erase your ratings, rankings, and other opinions? A backup downloads first.",
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
          window.noteBackupTaken?.();
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
