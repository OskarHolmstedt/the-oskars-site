/** @file Controls account import, backup, summary, publication, and opinion maintenance. */

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

  let downloadJson = window.downloadJson;
  let stampedFilename = window.stampedFilename;

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
    let [awardReviews, entityNotes, collectionBallots] = await Promise.all([
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
      window.fetchAllSupabaseRows((count) =>
        client
          .from("collection_ballots")
          .select(
            "collection_type, collection_id, collection_name, nominations, reviews",
            count ? { count: "exact" } : undefined,
          )
          .order("id"),
      ),
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
        collectionBallots,
      },
    };
  }

  // Updates the health panel's own elements in place rather than replacing
  // its innerHTML wholesale. The panel's static markup in data.html already
  // has this exact shape (heading, message, four metric cards) with
  // placeholder content, so the page never goes from empty to fully-grown
  // once account data loads - only the numbers and message text change,
  // which keeps everything below it from dropping down a notch mid-load.
  function renderHealth() {
    let finishRenderTimer = window.startOskarsPerformance?.(
      "data:renderWorkspace",
    );
    let value = source();
    let nominations = (value.personalAwards || []).reduce(
      (total, award) => total + (award.personal_nominations || []).length,
      0,
    );
    let empty = archiveIsEmpty(value);
    let letterboxdPanel = document.getElementById("letterboxdImport");
    letterboxdPanel?.classList.toggle("data-panel--recommended", empty);
    let importEyebrow = document.getElementById("letterboxdImportEyebrow");
    if (importEyebrow)
      importEyebrow.textContent = ui(
        empty ? "Recommended first step" : "Import from another service",
      );
    document.getElementById("dataHealthHeading").textContent =
      ui("Data summary");
    document.getElementById("dataHealthMessage").innerHTML = empty
      ? `${escape(ui("Your archive is empty."))} <a href="#letterboxdImport">${escape(ui("Start with a Letterboxd import."))}</a>`
      : `${escape(ui("Your archive is ready."))} <a href="#backupRestore">${escape(ui("Download a backup before a large restore or irreversible change."))}</a>`;
    document.getElementById("dataHealthWatched").textContent =
      value.watched?.length || 0;
    document.getElementById("dataHealthWatchlist").textContent =
      value.watchlist?.length || 0;
    document.getElementById("dataHealthRankings").textContent =
      value.rankings?.length || 0;
    document.getElementById("dataHealthAwards").textContent = nominations;
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
      "collection_ballots",
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

    if (
      data.collectionBallots != null &&
      !Array.isArray(data.collectionBallots)
    )
      throw new Error(ui("This is not a supported backup."));
    for (let ballot of data.collectionBallots || [])
      window.validateCollectionBallot(ballot);

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
    if (data.collectionBallots?.length) {
      let { error } = await client.from("collection_ballots").upsert(
        data.collectionBallots.map((row) => ({
          collection_type: row.collection_type,
          collection_id: row.collection_id,
          collection_name: row.collection_name,
          nominations: row.nominations,
          reviews: row.reviews,
        })),
        { onConflict: "user_id,collection_type,collection_id" },
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

  // Each entry covers one piece of the archive so a user can delete just
  // that part instead of everything (issue: "Data page should have a
  // delete section"). `opinion: true` marks the categories the old
  // single-button "Erase opinions" control used to bundle together - the
  // "Just opinions" shortcut checkbox recreates that exact bundle instead
  // of a second, half-overlapping code path. Ordering doesn't matter -
  // every run() is safe to call after an earlier one already removed its
  // rows (deleteAll/update simply touch zero rows), which lets "Delete
  // selected" run every checked category in one pass regardless of order.
  const DELETE_CATEGORIES = [
    {
      id: "watched",
      label: "Watched history",
      description:
        "Removes every watched film, along with its rating, review, and rewatch preference.",
      async run(client) {
        await deleteAll(client, "watched");
      },
    },
    {
      id: "ratings",
      label: "Ratings and reviews",
      description:
        "Clears star ratings, music scores, and written reviews. Watch dates and history stay.",
      opinion: true,
      async run(client) {
        let { error } = await client
          .from("watched")
          .update({
            rating: null,
            rating_modifier: null,
            review: null,
            music_score: null,
            music_rating: null,
            music_rating_value: null,
            updated_at: new Date().toISOString(),
          })
          .not("id", "is", null);
        if (error) throw error;
      },
    },
    {
      id: "rewatch",
      label: "Rewatch preferences",
      description: 'Clears "want to rewatch" flags and rewatch tiers.',
      opinion: true,
      async run(client) {
        let { error } = await client
          .from("watched")
          .update({
            want_to_rewatch: false,
            rewatch_tier: null,
            rewatch_tier_modifier: null,
            updated_at: new Date().toISOString(),
          })
          .not("id", "is", null);
        if (error) throw error;
      },
    },
    {
      id: "watchlist",
      label: "Watchlist",
      description:
        "Removes every film from your watchlist, including its tier and order.",
      async run(client) {
        await deleteAll(client, "watchlist");
        await deleteAll(client, "declined_official_watchlist_adds", "film_id");
      },
    },
    {
      id: "watchlist-tiers",
      label: "Watchlist tiers",
      description:
        "Clears interest tiers on watchlist entries. Membership and order stay.",
      opinion: true,
      async run(client) {
        let { error } = await client
          .from("watchlist")
          .update({
            tier: null,
            tier_modifier: null,
            updated_at: new Date().toISOString(),
          })
          .not("id", "is", null);
        if (error) throw error;
      },
    },
    {
      id: "watchlist-ranking",
      label: "Watchlist ranking",
      description:
        "Clears your manual watchlist order. Membership and tiers stay.",
      async run(client) {
        let { error } = await client
          .from("watchlist")
          .update({ position: "", updated_at: new Date().toISOString() })
          .not("id", "is", null);
        if (error) throw error;
      },
    },
    {
      id: "rankings",
      label: "Rankings (watched films)",
      description:
        "Deletes every year/decade/century/all-time ranking, and saved ranking-review progress.",
      opinion: true,
      async run(client) {
        await deleteAll(client, "rankings");
        await deleteAll(client, "ranking_pair_reviews", "scope");
      },
    },
    {
      id: "awards",
      label: "Awards",
      description:
        "Deletes every personal award ballot, its nominations, and its reviewed status.",
      opinion: true,
      async run(client) {
        await deleteAll(client, "personal_awards");
        await deleteAll(client, "award_reviews", "category");
        await deleteAll(client, "collection_ballots");
      },
    },
    {
      id: "notes",
      label: "Notes",
      description:
        "Deletes notes left on people, periods, franchises, tags, categories, and projects.",
      opinion: true,
      async run(client) {
        await deleteAll(client, "entity_notes");
      },
    },
    {
      id: "tags",
      label: "Tags",
      description: "Deletes your custom tags and removes them from every film.",
      async run(client) {
        await deleteAll(client, "tags");
      },
    },
    {
      id: "projects",
      label: "Projects and collections",
      description:
        "Deletes every project and collection you've built, and any local film order inside them.",
      async run(client) {
        await deleteAll(client, "projects");
        await deleteAll(client, "collections");
        await deleteAll(client, "local_ranks", "film_id");
      },
    },
  ];

  function renderDeleteDataRows() {
    let container = document.getElementById("deleteDataRows");
    let status = document.getElementById("deleteDataStatus");
    let selectedBtn = document.getElementById("deleteSelectedBtn");
    let selectAll = document.getElementById("deleteSelectAll");
    let selectOpinions = document.getElementById("deleteSelectOpinions");

    container.innerHTML = DELETE_CATEGORIES.map(
      (category) => `
      <label class="data-delete-row">
        <input type="checkbox" data-delete-category="${escape(category.id)}" />
        <span>
          <h4>${escape(ui(category.label))}</h4>
          <p>${escape(ui(category.description))}</p>
        </span>
      </label>`,
    ).join("");

    let checkboxes = [...container.querySelectorAll("[data-delete-category]")];
    function checkedCategories() {
      return DELETE_CATEGORIES.filter((category) =>
        checkboxes.find(
          (box) => box.dataset.deleteCategory === category.id && box.checked,
        ),
      );
    }
    function syncSelectedButton() {
      selectedBtn.disabled = checkedCategories().length === 0;
    }
    checkboxes.forEach((box) =>
      box.addEventListener("change", syncSelectedButton),
    );

    selectAll.addEventListener("change", () => {
      checkboxes.forEach((box) => (box.checked = selectAll.checked));
      syncSelectedButton();
    });
    selectOpinions.addEventListener("change", () => {
      checkboxes.forEach((box) => {
        let category = DELETE_CATEGORIES.find(
          (item) => item.id === box.dataset.deleteCategory,
        );
        if (category?.opinion) box.checked = selectOpinions.checked;
      });
      syncSelectedButton();
    });

    selectedBtn.addEventListener("click", async () => {
      let categories = checkedCategories();
      if (!categories.length) return;
      if (
        !confirm(
          ui(
            "Permanently delete this, with no way to undo it: {labels}? A backup downloads first.",
            {
              labels: categories
                .map((category) => ui(category.label))
                .join(", "),
            },
          ),
        )
      )
        return;
      selectedBtn.disabled = true;
      try {
        let { client } = await readyClient();
        downloadJson(
          await window.buildSupabaseAccountBackup(),
          stampedFilename("the-oskars-before-delete"),
        );
        window.noteBackupTaken?.();
        for (let category of categories) await category.run(client);
        await refreshSource();
        status.textContent = ui("Deleted: {labels}.", {
          labels: categories.map((category) => ui(category.label)).join(", "),
        });
        checkboxes.forEach((box) => (box.checked = false));
        selectAll.checked = false;
        selectOpinions.checked = false;
      } catch (error) {
        status.textContent = error.message || String(error);
      } finally {
        syncSelectedButton();
      }
    });
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

  async function initialize() {
    await window.ensureOskarsData();
    renderHealth();
    renderDeleteDataRows();

    document
      .getElementById("downloadBtn")
      .addEventListener("click", async () => {
        let status = document.getElementById("downloadStatus");
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
  }

  initialize().catch((error) => {
    console.error("Failed to initialize Supabase data tools", error);
    document.getElementById("dataHealthView").innerHTML =
      `<div class="detail-empty"><h2>${escape(ui("Could not load data tools"))}</h2><p>${escape(error.message || String(error))}</p></div>`;
  });
})();
