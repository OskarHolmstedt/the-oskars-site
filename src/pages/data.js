/** @file Controls account import, backup, connected sources, publication, and opinion maintenance. */

(function () {
  let ui = window.uiText || ((text) => text);
  let escape = window.pageEscape;
  let pendingLetterboxd = null;
  let pendingBackup = null;
  let pendingImdb = null;
  let pendingImdbFiles = {};
  let pendingGoogleSpreadsheet = null;
  let pendingGooglePush = null;
  const GOOGLE_SHEETS_STORAGE_KEY = "oskars-google-sheets-spreadsheet-id";
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
    let [awardReviews, entityNotes, collectionBallots, awardPoolExclusions] =
      await Promise.all([
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
        window.fetchAllSupabaseRows((count) =>
          client
            .from("award_pool_exclusions")
            .select("year, film_id", count ? { count: "exact" } : undefined)
            .order("year")
            .order("film_id"),
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
        awardPoolExclusions,
        googleSheetsSpreadsheetId:
          (typeof localStorage !== "undefined"
            ? localStorage.getItem(GOOGLE_SHEETS_STORAGE_KEY)
            : null) || undefined,
      },
    };
  }

  function renderWorkspace() {
    let finishRenderTimer = window.startOskarsPerformance?.(
      "data:renderWorkspace",
    );
    let value = source();
    let empty = archiveIsEmpty(value);
    let letterboxdPanel = document.getElementById("letterboxdImport");
    letterboxdPanel?.classList.toggle("data-panel--recommended", empty);
    let importEyebrow = document.getElementById("letterboxdImportEyebrow");
    if (importEyebrow)
      importEyebrow.textContent = ui(
        empty ? "Recommended first step" : "Import from another service",
      );
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
      "award_pool_exclusions",
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
      data.googleSheetsSpreadsheetId != null &&
      typeof data.googleSheetsSpreadsheetId !== "string"
    ) {
      throw new Error(ui("This is not a supported backup."));
    }

    if (
      data.collectionBallots != null &&
      !Array.isArray(data.collectionBallots)
    )
      throw new Error(ui("This is not a supported backup."));
    for (let ballot of data.collectionBallots || [])
      window.validateCollectionBallot(ballot);

    if (
      data.awardPoolExclusions != null &&
      !Array.isArray(data.awardPoolExclusions)
    )
      throw new Error(ui("This is not a supported backup."));
    for (let row of data.awardPoolExclusions || []) {
      if (
        !Number.isInteger(row?.year) ||
        row.year < 0 ||
        row.year > 9999 ||
        typeof row.film_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          row.film_id,
        )
      )
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
    if (data.awardPoolExclusions?.length) {
      let { error } = await client.from("award_pool_exclusions").upsert(
        data.awardPoolExclusions.map((row) => ({
          year: row.year,
          film_id: row.film_id,
        })),
        { onConflict: "user_id,year,film_id", ignoreDuplicates: true },
      );
      if (error) throw error;
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
    if (data.googleSheetsSpreadsheetId) {
      persistConnectedSheet(data.googleSheetsSpreadsheetId);
    }
  }

  let dataSourcesProfile = null;

  async function handleLetterboxdDisconnect() {
    let confirmMsg = ui(
      "Disconnect Letterboxd RSS sync? This stops automatic intake sync and removes your saved username. Previously imported films and ratings will stay in your archive.",
    );
    if (!window.confirm(confirmMsg)) return;
    let status = document.getElementById("dataSourcesStatus");
    if (status) {
      status.style.display = "block";
      status.textContent = ui("Disconnecting Letterboxd RSS sync…");
    }
    try {
      dataSourcesProfile = await window.setSupabaseProfileLetterboxd("");
      renderDataSources(dataSourcesProfile);
      if (status) {
        status.textContent = ui("Letterboxd RSS sync disconnected.");
      }
    } catch (err) {
      if (status) status.textContent = err.message || String(err);
    }
  }

  async function handleGoogleSheetDisconnect() {
    let confirmMsg = ui(
      "Disconnect Google Sheet? This removes the connected spreadsheet link and stops syncing. Previously imported films and archive data will stay in your account.",
    );
    if (!window.confirm(confirmMsg)) return;
    persistConnectedSheet("");
    let status = document.getElementById("dataSourcesStatus");
    if (status) {
      status.style.display = "block";
      status.textContent = ui("Google Sheet disconnected.");
    }
    let syncStatus = document.getElementById("syncGoogleSheetStatus");
    if (syncStatus) {
      syncStatus.style.display = "block";
      syncStatus.textContent = ui("Google Sheet disconnected.");
    }
    renderDataSources();
  }

  function renderDataSources(profile) {
    if (profile !== undefined) dataSourcesProfile = profile;
    let grid = document.getElementById("dataSourcesGrid");
    if (!grid) return;

    let val = source();
    let currentProf = dataSourcesProfile;
    let lbUsername = currentProf?.letterboxd_username || "";
    let lbLastSync = currentProf?.letterboxd_last_synced_at;
    let lbSyncText = lbLastSync
      ? ui("Last synced on {date}.", {
          date: new Date(lbLastSync).toLocaleDateString(),
        })
      : ui("Never synced yet.");

    let imdbCount =
      (val.watched || []).filter(
        (f) =>
          f.url?.includes("imdb.com") ||
          f.imdbId ||
          f.sourceKind === "imdb" ||
          f.source === "imdb",
      ).length +
      (val.watchlist || []).filter(
        (w) =>
          w.url?.includes("imdb.com") || w.imdbId || w.sourceKind === "imdb",
      ).length;

    let sheetId =
      (typeof localStorage !== "undefined"
        ? localStorage.getItem(GOOGLE_SHEETS_STORAGE_KEY)
        : null) || "";

    grid.innerHTML = `
      <article class="data-source-card" id="dataSourceCardFresh">
        <div class="data-source-card-header">
          <span class="eyebrow">${escape(ui("Path 1 · Start fresh"))}</span>
          <span class="data-source-badge data-source-badge--active">${escape(ui("Active"))}</span>
        </div>
        <h3>${escape(ui("Manual logging & Intake"))}</h3>
        <p>${escape(ui("Direct logging via Intake and catalog. Always available with no persistent connection needed."))}</p>
        <div class="data-actions">
          <a href="intake.html" class="button-link button-secondary">${escape(ui("Open Intake"))}</a>
          <a href="films.html?start=fresh" class="button-link button-secondary">${escape(ui("Explore years"))}</a>
        </div>
      </article>

      <article class="data-source-card" id="dataSourceCardLetterboxd">
        <div class="data-source-card-header">
          <span class="eyebrow">${escape(ui("Path 2 · Letterboxd"))}</span>
          <span class="data-source-badge ${lbUsername ? "data-source-badge--connected" : "data-source-badge--disconnected"}">
            ${escape(lbUsername ? ui("Connected") : ui("Not connected"))}
          </span>
        </div>
        <h3>${escape(ui("Letterboxd sync"))}</h3>
        <p>${escape(
          lbUsername
            ? ui("RSS auto-sync active for @{user}. {syncInfo}", {
                user: lbUsername,
                syncInfo: lbSyncText,
              })
            : ui(
                "Public RSS sync is not connected. Enter your username to auto-sync future watches.",
              ),
        )}</p>
        <div class="data-actions">
          ${
            lbUsername
              ? `<button id="disconnectLetterboxdSourceBtn" type="button" class="button-secondary button-danger-subtle">${escape(ui("Disconnect RSS"))}</button>
                 <a href="profile.html#letterboxdProfilePanel" class="button-link button-secondary">${escape(ui("Profile settings"))}</a>
                 <a href="#letterboxdImport" class="button-link">${escape(ui("Re-import ZIP"))}</a>`
              : `<a href="profile.html#letterboxdProfilePanel" class="button-link button-secondary">${escape(ui("Connect username"))}</a>
                 <a href="#letterboxdImport" class="button-link">${escape(ui("Import ZIP"))}</a>`
          }
        </div>
      </article>

      <article class="data-source-card" id="dataSourceCardImdb">
        <div class="data-source-card-header">
          <span class="eyebrow">${escape(ui("Path 3 · IMDb"))}</span>
          <span class="data-source-badge ${imdbCount > 0 ? "data-source-badge--connected" : "data-source-badge--disconnected"}">
            ${escape(imdbCount > 0 ? ui("Imported ({count})", { count: imdbCount }) : ui("Not imported"))}
          </span>
        </div>
        <h3>${escape(ui("IMDb import"))}</h3>
        <p>${escape(
          imdbCount > 0
            ? ui(
                "{count} IMDb-sourced film(s) and watchlist item(s) in your archive.",
                { count: imdbCount },
              )
            : ui(
                "Import your ratings.csv and watchlist.csv exports with linear 1–10 to star rating conversion.",
              ),
        )}</p>
        <div class="data-actions">
          <a href="#imdbImport" class="button-link">${escape(ui(imdbCount > 0 ? "Re-import CSVs" : "Import CSVs"))}</a>
        </div>
      </article>

      <article class="data-source-card" id="dataSourceCardSheets">
        <div class="data-source-card-header">
          <span class="eyebrow">${escape(ui("Path 4 · Google Sheets"))}</span>
          <span class="data-source-badge ${sheetId ? "data-source-badge--connected" : "data-source-badge--disconnected"}">
            ${escape(sheetId ? ui("Connected") : ui("Not connected"))}
          </span>
        </div>
        <h3>${escape(ui("Google Sheets"))}</h3>
        <p>${escape(
          sheetId
            ? ui("Connected spreadsheet ID: {id}. Two-way sync ready.", {
                id: sheetId.length > 20 ? sheetId.slice(0, 16) + "…" : sheetId,
              })
            : ui(
                "Create a workbook on Google Drive or connect an existing sheet.",
              ),
        )}</p>
        <div class="data-actions">
          ${
            sheetId
              ? `<button id="disconnectGoogleSheetSourceBtn" type="button" class="button-secondary button-danger-subtle">${escape(ui("Disconnect"))}</button>
                 <a href="https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit" target="_blank" rel="noopener noreferrer" class="button-link button-secondary">${escape(ui("Open in Sheets ↗"))}</a>
                 <a href="#spreadsheetTemplates" class="button-link">${escape(ui("Sync / Push"))}</a>`
              : `<a href="#spreadsheetTemplates" class="button-link">${escape(ui("Connect sheet"))}</a>`
          }
        </div>
      </article>
    `;

    document
      .getElementById("disconnectLetterboxdSourceBtn")
      ?.addEventListener("click", handleLetterboxdDisconnect);
    document
      .getElementById("disconnectGoogleSheetSourceBtn")
      ?.addEventListener("click", handleGoogleSheetDisconnect);
  }

  function updateConnectedSheetUI(id) {
    pendingGooglePush = null;
    let pushApply = document.getElementById("pushGoogleSheetApplyBtn");
    if (pushApply) pushApply.disabled = true;
    let connectedSheetInput = document.getElementById("connectedSheetInput");
    let openConnectedSheetLink = document.getElementById(
      "openConnectedSheetLink",
    );
    let disconnectConnectedSheetBtn = document.getElementById(
      "disconnectConnectedSheetBtn",
    );
    let connectedSheetWorkflow = document.getElementById(
      "connectedSheetWorkflow",
    );
    let syncGoogleSheetBtn = document.getElementById("syncGoogleSheetBtn");
    let syncGoogleSheetApplyBtn = document.getElementById(
      "syncGoogleSheetApplyBtn",
    );
    let pushToGoogleSheetBtn = document.getElementById("pushToGoogleSheetBtn");

    if (connectedSheetInput) connectedSheetInput.value = id || "";
    if (id) {
      let sheetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
      if (openConnectedSheetLink) {
        openConnectedSheetLink.href = sheetUrl;
        if (openConnectedSheetLink.style) {
          openConnectedSheetLink.style.display = "inline-flex";
        }
      }
      if (disconnectConnectedSheetBtn) {
        disconnectConnectedSheetBtn.style.display = "inline-flex";
      }
      if (connectedSheetWorkflow?.style) {
        connectedSheetWorkflow.style.display = "block";
      }
      if (syncGoogleSheetBtn) syncGoogleSheetBtn.disabled = false;
      if (pushToGoogleSheetBtn) pushToGoogleSheetBtn.disabled = false;
    } else {
      if (openConnectedSheetLink) {
        openConnectedSheetLink.href = "#";
        if (openConnectedSheetLink.style) {
          openConnectedSheetLink.style.display = "none";
        }
      }
      if (disconnectConnectedSheetBtn) {
        disconnectConnectedSheetBtn.style.display = "none";
      }
      if (connectedSheetWorkflow?.style) {
        connectedSheetWorkflow.style.display = "none";
      }
      if (syncGoogleSheetBtn) syncGoogleSheetBtn.disabled = true;
      if (syncGoogleSheetApplyBtn) syncGoogleSheetApplyBtn.disabled = true;
      if (pushToGoogleSheetBtn) pushToGoogleSheetBtn.disabled = true;
    }
  }

  function persistConnectedSheet(id) {
    if (typeof localStorage !== "undefined") {
      if (id) {
        localStorage.setItem(GOOGLE_SHEETS_STORAGE_KEY, id);
      } else {
        localStorage.removeItem(GOOGLE_SHEETS_STORAGE_KEY);
      }
    }
    updateConnectedSheetUI(id || "");
    renderDataSources();
    window
      .ensureSupabaseClient?.()
      .then((ready) => {
        ready?.client?.auth
          ?.updateUser?.({
            data: { googleSheetsSpreadsheetId: id || null },
          })
          .catch(() => {});
      })
      .catch(() => {});
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
        "Deletes every personal award ballot, its nominations, reviewed status, and hidden annual candidate films.",
      opinion: true,
      async run(client) {
        await deleteAll(client, "personal_awards");
        await deleteAll(client, "award_reviews", "category");
        await deleteAll(client, "collection_ballots");
        await deleteAll(client, "award_pool_exclusions");
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

  function setupDeleteDataRows() {
    let container = document.getElementById("deleteDataRows");
    let status = document.getElementById("deleteDataStatus");
    let selectedBtn = document.getElementById("deleteSelectedBtn");
    let selectAll = document.getElementById("deleteSelectAll");
    let selectOpinions = document.getElementById("deleteSelectOpinions");
    if (!container || !selectedBtn || !selectAll || !selectOpinions) return;

    if (!container.children.length) {
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
    }

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
    renderWorkspace();
    renderDataSources();
  }

  async function initialize() {
    setupDeleteDataRows();
    await window.ensureOskarsData();
    renderWorkspace();
    renderDataSources();
    window
      .loadSupabaseProfile?.()
      .then((profile) => renderDataSources(profile))
      .catch(() => {});

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

    function blockedImportMessage(proposal, fallback) {
      let errors = proposal?.validation?.errors || [];
      if (
        errors.some((entry) =>
          String(entry?.message || "").includes("changes no canonical data"),
        )
      )
        return ui(
          "Nothing new to import: everything in this export is already in your archive.",
        );
      let findings = errors
        .map((entry) =>
          [entry?.path, entry?.message].filter(Boolean).join(": "),
        )
        .filter(Boolean);
      if (!findings.length) return fallback;
      let shown = findings.slice(0, 5).join(" ");
      return findings.length > 5
        ? `${shown} ${ui("(and {count} more)", { count: findings.length - 5 })}`
        : shown;
    }

    function renderLetterboxdConfirmationCard(proposal) {
      let report = proposal?.report || {};
      let archiveAdded = report.archiveAdded || 0;
      let watchedOtherAdded = report.watchedOtherAdded || 0;
      let watchedArchiveMerged = report.watchedArchiveMerged || 0;
      let watchedOtherMerged = report.watchedOtherMerged || 0;
      let newWatchedCount = archiveAdded + watchedOtherAdded;
      let updatedWatchedCount = watchedArchiveMerged + watchedOtherMerged;
      let filmsParsed =
        report.filmsParsed || newWatchedCount + updatedWatchedCount;
      let watchlistAdded = report.watchlistAdded || 0;
      let watchlistMerged = report.watchlistMerged || 0;
      let watchlistRemoved = report.watchlistRemoved || 0;
      let totalWatchlist = watchlistAdded + watchlistMerged;

      let warnings = report.warnings || [];
      let warningsHtml = warnings.length
        ? `<div class="data-import-warnings">${warnings.map((w) => escape(w)).join("<br>")}</div>`
        : "";
      let skippedHtml =
        report.skipped > 0
          ? `<p class="data-panel-status" style="margin: 0;">${escape(ui("{count} row(s) skipped (missing required title or year).", { count: report.skipped }))}</p>`
          : "";

      return `<div class="data-import-confirm-card">
        <div class="data-import-confirm-header">
          <h4>${escape(ui("Ready to import"))}</h4>
          <p>${escape(ui("Review what was found in your Letterboxd export before saving:"))}</p>
        </div>
        <div class="data-import-stats-grid">
          <div class="data-import-stat-item">
            <span class="data-import-stat-val">${filmsParsed}</span>
            <span class="data-import-stat-lbl">${escape(ui("Watched films"))}</span>
            <span class="data-import-stat-sub">${newWatchedCount} ${escape(ui("new"))} · ${updatedWatchedCount} ${escape(ui("updated"))}</span>
          </div>
          <div class="data-import-stat-item">
            <span class="data-import-stat-val">${totalWatchlist}</span>
            <span class="data-import-stat-lbl">${escape(ui("Watchlist items"))}</span>
            <span class="data-import-stat-sub">${watchlistAdded} ${escape(ui("new"))} · ${watchlistMerged} ${escape(ui("updated"))}${watchlistRemoved ? ` · ${watchlistRemoved} ${escape(ui("watched"))}` : ""}</span>
          </div>
        </div>
        ${warningsHtml}
        ${skippedHtml}
        <div class="data-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="letterboxdConfirmImportBtn">${escape(ui("Confirm import"))}</button>
          <button type="button" id="letterboxdCancelImportBtn" class="button-secondary">${escape(ui("Cancel"))}</button>
        </div>
      </div>`;
    }

    function renderImdbConfirmationCard(proposal) {
      let report = proposal?.report || {};
      let archiveAdded = report.archiveAdded || 0;
      let watchedOtherAdded = report.watchedOtherAdded || 0;
      let watchedArchiveMerged = report.watchedArchiveMerged || 0;
      let watchedOtherMerged = report.watchedOtherMerged || 0;
      let newWatchedCount = archiveAdded + watchedOtherAdded;
      let updatedWatchedCount = watchedArchiveMerged + watchedOtherMerged;
      let filmsParsed =
        report.filmsParsed || newWatchedCount + updatedWatchedCount;
      let watchlistAdded = report.watchlistAdded || 0;
      let watchlistMerged = report.watchlistMerged || 0;
      let watchlistRemoved = report.watchlistRemoved || 0;
      let totalWatchlist = watchlistAdded + watchlistMerged;

      let warnings = report.warnings || [];
      let warningsHtml = warnings.length
        ? `<div class="data-import-warnings">${warnings.map((w) => escape(w)).join("<br>")}</div>`
        : "";
      let skippedHtml =
        report.skipped > 0
          ? `<p class="data-panel-status" style="margin: 0;">${escape(ui("{count} row(s) skipped (missing required title or year).", { count: report.skipped }))}</p>`
          : "";

      return `<div class="data-import-confirm-card">
        <div class="data-import-confirm-header">
          <h4>${escape(ui("Ready to import"))}</h4>
          <p>${escape(ui("Review what was found in your IMDb export before saving:"))}</p>
        </div>
        <div class="data-import-stats-grid">
          <div class="data-import-stat-item">
            <span class="data-import-stat-val">${filmsParsed}</span>
            <span class="data-import-stat-lbl">${escape(ui("Watched films"))}</span>
            <span class="data-import-stat-sub">${newWatchedCount} ${escape(ui("new"))} · ${updatedWatchedCount} ${escape(ui("updated"))}</span>
          </div>
          <div class="data-import-stat-item">
            <span class="data-import-stat-val">${totalWatchlist}</span>
            <span class="data-import-stat-lbl">${escape(ui("Watchlist items"))}</span>
            <span class="data-import-stat-sub">${watchlistAdded} ${escape(ui("new"))} · ${watchlistMerged} ${escape(ui("updated"))}${watchlistRemoved ? ` · ${watchlistRemoved} ${escape(ui("watched"))}` : ""}</span>
          </div>
        </div>
        ${warningsHtml}
        ${skippedHtml}
        <div class="data-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
          <button type="button" id="imdbConfirmImportBtn">${escape(ui("Confirm import"))}</button>
          <button type="button" id="imdbCancelImportBtn" class="button-secondary">${escape(ui("Cancel"))}</button>
        </div>
      </div>`;
    }

    document
      .getElementById("letterboxdZipInput")
      ?.addEventListener("change", async (event) => {
        let status = document.getElementById("letterboxdImportStatus");
        let progress = document.getElementById("letterboxdImportProgress");
        let file = event.target.files?.[0];
        if (!file) return;
        if (progress) {
          progress.hidden = false;
          progress.removeAttribute("max");
          progress.removeAttribute("value");
        }
        status.innerHTML = `<span class="data-panel-subtext">${escape(ui("Reading and parsing your export…"))}</span>`;
        try {
          pendingLetterboxd = await window.proposeLetterboxdZipImport(file, {
            baseState: window.state,
          });
          // Films with no archive match get their TMDB details looked up
          // now, before saving - the shared catalog is create-only once a
          // film row exists (issue #440), so this is the only point a
          // fresh film's metadata can still be filled in automatically.
          let freshCount =
            pendingLetterboxd.report?.freshArchiveFilms?.length || 0;
          if (freshCount) {
            status.innerHTML = `<span class="data-panel-subtext">${escape(
              ui("Looking up film details for {count} new film(s)…", {
                count: freshCount,
              }),
            )}</span>`;
            await window.enrichLetterboxdProposalMetadata(pendingLetterboxd, {
              onProgress(done, total) {
                if (progress) {
                  progress.hidden = false;
                  progress.max = total || 1;
                  progress.value = done;
                }
                status.innerHTML = `<span class="data-panel-subtext">${escape(
                  ui("Looking up film details ({done}/{total})…", {
                    done,
                    total,
                  }),
                )}</span>`;
              },
            });
          }
          if (progress) progress.hidden = true;
          if (!pendingLetterboxd.allowed) {
            let errorMsg = blockedImportMessage(
              pendingLetterboxd,
              ui("Letterboxd export could not be imported."),
            );
            status.innerHTML = `<div class="data-import-confirm-card"><strong style="color: var(--error);">${escape(errorMsg)}</strong></div>`;
          } else {
            status.innerHTML =
              renderLetterboxdConfirmationCard(pendingLetterboxd);
          }
        } catch (error) {
          pendingLetterboxd = null;
          if (progress) progress.hidden = true;
          status.innerHTML = `<div class="data-import-confirm-card"><strong style="color: var(--error);">${escape(error.message || String(error))}</strong></div>`;
        }
      });

    document
      .getElementById("letterboxdImport")
      ?.addEventListener("click", async (event) => {
        let confirmBtn = event.target.closest("#letterboxdConfirmImportBtn");
        let cancelBtn = event.target.closest("#letterboxdCancelImportBtn");
        if (cancelBtn) {
          pendingLetterboxd = null;
          let fileInput = document.getElementById("letterboxdZipInput");
          if (fileInput) fileInput.value = "";
          let progress = document.getElementById("letterboxdImportProgress");
          if (progress) progress.hidden = true;
          let status = document.getElementById("letterboxdImportStatus");
          if (status)
            status.innerHTML = `<span class="data-panel-subtext">${escape(ui("Import cancelled. The ZIP never leaves this browser."))}</span>`;
          return;
        }
        if (confirmBtn) {
          if (!pendingLetterboxd) return;
          let status = document.getElementById("letterboxdImportStatus");
          let progress = document.getElementById("letterboxdImportProgress");
          confirmBtn.disabled = true;
          status.innerHTML = `<div class="data-import-saving-box">
            <div class="data-import-saving-title">${escape(ui("Saving to your account…"))}</div>
            <div class="data-import-saving-step" id="letterboxdImportSavingStep">${escape(ui("Preparing records… Don't close this tab."))}</div>
          </div>`;
          if (progress) {
            progress.hidden = false;
            progress.removeAttribute("value");
          }
          function onProgress(stage, done, total) {
            if (progress) {
              progress.hidden = false;
              progress.max = total || 1;
              if (done === 0) progress.removeAttribute("value");
              else progress.value = done;
            }
            let stepEl = document.getElementById("letterboxdImportSavingStep");
            let msg = ui(
              "Saving {stage} ({done}/{total})… Don't close this tab.",
              {
                stage,
                done,
                total,
              },
            );
            if (stepEl) stepEl.textContent = msg;
          }
          try {
            let result = await window.applyImportProposal(pendingLetterboxd, {
              onProgress,
            });
            if (!result?.ok)
              throw new Error(
                result?.errors?.join(" ") || ui("Import failed."),
              );
            await refreshSource();
            try {
              await window.updateSupabaseProfileLetterboxdLastSynced?.(
                new Date().toISOString(),
              );
            } catch (syncErr) {
              console.warn(
                "Could not update Letterboxd last synced date",
                syncErr,
              );
            }
            let importedCount =
              pendingLetterboxd?.report?.archiveAdded ||
              pendingLetterboxd?.report?.filmsAdded ||
              0;
            let profile = await window.loadSupabaseProfile?.();
            let celebrationText =
              importedCount > 0
                ? ui(
                    "Your {count} films are in! Explore your decades or head to Home.",
                    { count: importedCount },
                  )
                : ui("Letterboxd import saved to your account.");
            let connectCta = !profile?.letterboxd_username
              ? `<a class="button-link button-secondary" href="profile.html#letterboxdProfilePanel">${escape(ui("Connect username for RSS sync"))}</a>`
              : "";
            status.innerHTML = `<div class="data-import-success"><strong>${escape(celebrationText)}</strong><div class="data-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;"><a class="button-link" href="periods.html">${escape(ui("Explore your decades →"))}</a><a class="button-link button-secondary" href="index.html">${escape(ui("Go to Home"))}</a>${connectCta}</div></div>`;
            pendingLetterboxd = null;
            let fileInput = document.getElementById("letterboxdZipInput");
            if (fileInput) fileInput.value = "";
          } catch (error) {
            status.innerHTML = `<div class="data-import-confirm-card"><strong style="color: var(--error);">${escape(error.message || String(error))}</strong></div>`;
          } finally {
            if (progress) progress.hidden = true;
          }
        }
      });

    document
      .getElementById("imdbCsvInput")
      ?.addEventListener("change", async (event) => {
        let status = document.getElementById("imdbImportStatus");
        let progress = document.getElementById("imdbImportProgress");
        let fileList = Array.from(event.target.files || []);
        if (!fileList.length) return;
        if (progress) {
          progress.hidden = false;
          progress.removeAttribute("max");
          progress.removeAttribute("value");
        }
        status.innerHTML = `<span class="data-panel-subtext">${escape(ui("Reading and parsing your export…"))}</span>`;
        try {
          pendingImdbFiles = {};
          for (let file of fileList) {
            pendingImdbFiles[file.name] = await file.text();
          }
          pendingImdb = window.proposeImdbImport(pendingImdbFiles, {
            baseState: window.state,
            fileName: Object.keys(pendingImdbFiles).join(", "),
          });
          let freshCount = pendingImdb.report?.freshArchiveFilms?.length || 0;
          if (freshCount) {
            status.innerHTML = `<span class="data-panel-subtext">${escape(
              ui("Looking up film details for {count} new film(s)…", {
                count: freshCount,
              }),
            )}</span>`;
            await window.enrichImdbProposalMetadata(pendingImdb, {
              onProgress(done, total) {
                if (progress) {
                  progress.hidden = false;
                  progress.max = total || 1;
                  progress.value = done;
                }
                status.innerHTML = `<span class="data-panel-subtext">${escape(
                  ui("Looking up film details ({done}/{total})…", {
                    done,
                    total,
                  }),
                )}</span>`;
              },
            });
          }
          if (progress) progress.hidden = true;
          if (!pendingImdb.allowed) {
            let errorMsg = blockedImportMessage(
              pendingImdb,
              ui("IMDb export could not be imported."),
            );
            status.innerHTML = `<div class="data-import-confirm-card"><strong style="color: var(--error);">${escape(errorMsg)}</strong></div>`;
          } else {
            status.innerHTML = renderImdbConfirmationCard(pendingImdb);
          }
        } catch (error) {
          pendingImdb = null;
          if (progress) progress.hidden = true;
          status.innerHTML = `<div class="data-import-confirm-card"><strong style="color: var(--error);">${escape(error.message || String(error))}</strong></div>`;
        }
      });

    document
      .getElementById("imdbImport")
      ?.addEventListener("click", async (event) => {
        let confirmBtn = event.target.closest("#imdbConfirmImportBtn");
        let cancelBtn = event.target.closest("#imdbCancelImportBtn");
        if (cancelBtn) {
          pendingImdb = null;
          pendingImdbFiles = {};
          let fileInput = document.getElementById("imdbCsvInput");
          if (fileInput) fileInput.value = "";
          let progress = document.getElementById("imdbImportProgress");
          if (progress) progress.hidden = true;
          let status = document.getElementById("imdbImportStatus");
          if (status)
            status.innerHTML = `<span class="data-panel-subtext">${escape(ui("Import cancelled. Upload ratings.csv or watchlist.csv (or both)."))}</span>`;
          return;
        }
        if (confirmBtn) {
          if (!pendingImdb) return;
          let status = document.getElementById("imdbImportStatus");
          let progress = document.getElementById("imdbImportProgress");
          confirmBtn.disabled = true;
          status.innerHTML = `<div class="data-import-saving-box">
            <div class="data-import-saving-title">${escape(ui("Saving to your account…"))}</div>
            <div class="data-import-saving-step" id="imdbImportSavingStep">${escape(ui("Preparing records… Don't close this tab."))}</div>
          </div>`;
          if (progress) {
            progress.hidden = false;
            progress.max = 6;
            progress.value = 0;
          }
          function onProgress(stage, done, total) {
            if (progress) {
              progress.hidden = false;
              progress.max = total || 1;
              progress.value = done;
            }
            let stepEl = document.getElementById("imdbImportSavingStep");
            let msg = ui(
              "Saving {stage} ({done}/{total})… Don't close this tab.",
              {
                stage,
                done,
                total,
              },
            );
            if (stepEl) stepEl.textContent = msg;
          }
          try {
            let result = await window.applyImportProposal(pendingImdb, {
              onProgress,
            });
            if (!result?.ok)
              throw new Error(
                result?.errors?.join(" ") || ui("Import failed."),
              );
            await refreshSource();
            let importedCount =
              pendingImdb?.report?.archiveAdded ||
              pendingImdb?.report?.filmsAdded ||
              0;
            let celebrationText =
              importedCount > 0
                ? ui(
                    "Your {count} films are in! Explore your decades or head to Home.",
                    { count: importedCount },
                  )
                : ui("IMDb import saved to your account.");
            let watchlistCta = pendingImdb?.report?.watchlistAdded
              ? `<a class="button-link button-secondary" href="watchlist.html">${escape(ui("Organise watchlist"))}</a>`
              : "";
            status.innerHTML = `<div class="data-import-success"><strong>${escape(celebrationText)}</strong><div class="data-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;"><a class="button-link" href="periods.html">${escape(ui("Explore your decades →"))}</a><a class="button-link button-secondary" href="index.html">${escape(ui("Go to Home"))}</a>${watchlistCta}</div></div>`;
            pendingImdb = null;
            pendingImdbFiles = {};
            let fileInput = document.getElementById("imdbCsvInput");
            if (fileInput) fileInput.value = "";
          } catch (error) {
            status.innerHTML = `<div class="data-import-confirm-card"><strong style="color: var(--error);">${escape(error.message || String(error))}</strong></div>`;
          } finally {
            if (progress) progress.hidden = true;
          }
        }
      });

    let connectedSheetInput = document.getElementById("connectedSheetInput");
    let syncGoogleSheetApplyBtn = document.getElementById(
      "syncGoogleSheetApplyBtn",
    );
    let googleDriveFeedback = document.getElementById("googleDriveFeedback");
    let syncGoogleSheetStatus = document.getElementById(
      "syncGoogleSheetStatus",
    );

    let initialSheetId =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(GOOGLE_SHEETS_STORAGE_KEY) || ""
        : "";
    updateConnectedSheetUI(initialSheetId);

    async function syncConnectedSheetMetadata() {
      let ready = await window.ensureSupabaseClient?.().catch(() => null);
      if (!ready) return;
      let auth = await window.resolveSupabaseAuthState?.().catch(() => null);
      if (auth?.status !== "signed-in" || !auth.user) return;
      let cloudSheetId =
        auth.user.user_metadata?.googleSheetsSpreadsheetId ||
        auth.user.user_metadata?.google_sheets_spreadsheet_id;
      let localSheetId =
        typeof localStorage !== "undefined"
          ? localStorage.getItem(GOOGLE_SHEETS_STORAGE_KEY)
          : null;
      if (!localSheetId && cloudSheetId) {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(GOOGLE_SHEETS_STORAGE_KEY, cloudSheetId);
        }
        updateConnectedSheetUI(cloudSheetId);
      } else if (
        localSheetId &&
        !cloudSheetId &&
        ready.client?.auth?.updateUser
      ) {
        ready.client.auth
          .updateUser({
            data: { googleSheetsSpreadsheetId: localSheetId },
          })
          .catch(() => {});
      }
    }
    syncConnectedSheetMetadata();

    function handleHashNavigation() {
      let hash = window.location.hash;
      if (!hash) return;
      let target = document.querySelector(hash);
      if (target && target.classList.contains("data-panel")) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          target.classList.add("data-panel--target-highlight");
          setTimeout(() => {
            target.classList.remove("data-panel--target-highlight");
          }, 2500);
        }, 100);
      }
    }
    handleHashNavigation();
    window.addEventListener?.("hashchange", handleHashNavigation);

    document
      .getElementById("saveConnectedSheetBtn")
      ?.addEventListener("click", () => {
        let raw = connectedSheetInput?.value.trim() || "";
        let match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        let id = match ? match[1] : raw;
        if (id) {
          persistConnectedSheet(id);
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.style.display = "block";
            syncGoogleSheetStatus.textContent = ui(
              "Connected spreadsheet ID saved.",
            );
          }
        } else {
          persistConnectedSheet("");
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.style.display = "none";
            syncGoogleSheetStatus.textContent = "";
          }
        }
      });

    document
      .getElementById("disconnectConnectedSheetBtn")
      ?.addEventListener("click", handleGoogleSheetDisconnect);

    document
      .getElementById("createGoogleSheetBtn")
      ?.addEventListener("click", async (event) => {
        let button = event.currentTarget;
        button.disabled = true;
        if (googleDriveFeedback) {
          googleDriveFeedback.style.display = "block";
          googleDriveFeedback.textContent = ui(
            "Creating spreadsheet on Google Drive…",
          );
        }
        try {
          let populate =
            document.getElementById("populateFromArchiveCheckbox")?.checked !==
            false;
          let created = await window.createGoogleSheetsDocument({
            populateFromArchive: populate,
          });
          persistConnectedSheet(created.spreadsheetId);
          if (googleDriveFeedback) {
            googleDriveFeedback.innerHTML = `<div class="data-import-success"><strong>${escape(ui("Created spreadsheet:"))} <a href="${escape(created.spreadsheetUrl)}" target="_blank" rel="noopener noreferrer">${escape(created.title)} ↗</a></strong><p class="data-help-text" style="margin: 4px 0 0;">${escape(ui("Your sheet is connected. Edit films in Google Sheets, then sync back anytime."))}</p></div>`;
          }
        } catch (error) {
          if (googleDriveFeedback) {
            googleDriveFeedback.textContent = window.formatGoogleSheetsError
              ? window.formatGoogleSheetsError(error)
              : error.message || String(error);
          }
        } finally {
          button.disabled = false;
        }
      });

    let googleSheetProgress = document.getElementById("googleSheetProgress");
    function showGoogleSheetProgress(message, done, total) {
      if (googleSheetProgress) {
        googleSheetProgress.hidden = false;
        googleSheetProgress.style.display = "block";
        googleSheetProgress.max = total || 1;
        if (done > 0) googleSheetProgress.value = done;
        else googleSheetProgress.removeAttribute("value");
      }
      if (syncGoogleSheetStatus) {
        syncGoogleSheetStatus.style.display = "block";
        syncGoogleSheetStatus.textContent = message;
      }
    }
    function hideGoogleSheetProgress() {
      if (googleSheetProgress) {
        googleSheetProgress.hidden = true;
        googleSheetProgress.style.display = "none";
      }
    }
    function renderGoogleSheetReview(proposal) {
      let report = proposal.report;
      let counts = [
        [report.filmsAdded || 0, ui("New films")],
        [report.filmsMerged || 0, ui("Updated films")],
        [report.watchlistItemsParsed || 0, ui("Watchlist items")],
        [report.awardsAdded || 0, ui("Award nominations")],
      ];
      let diagnostics = [...new Set(report.warnings || [])].filter(
        (warning) => !String(warning).startsWith("$proposal:"),
      );
      if (report.skipped)
        diagnostics.push(
          ui("{count} rows could not be read.", { count: report.skipped }),
        );
      if (report.awardsRejected)
        diagnostics.push(
          ui("{count} award nominations could not be imported.", {
            count: report.awardsRejected,
          }),
        );
      let problems = window
        .googleSheetsImportProblemGroups(report)
        .map(
          (group) =>
            `<details><summary>${escape(ui(group.label))} (${group.lines.length})</summary><ul>${group.lines.map((line) => `<li>${escape(line)}</li>`).join("")}</ul></details>`,
        )
        .join("");
      let heading = proposal.allowed
        ? ui("Ready to import")
        : ui("Nothing ready to import");
      let explanation = proposal.allowed
        ? ui("Review what was found, then confirm to save it to your archive.")
        : proposal.validation.errors.every(
              (error) => error.path === "$proposal",
            )
          ? ui("Your archive already matches this sheet.")
          : ui(
              "Check the issues below and read the sheet again before importing.",
            );
      return `<div class="data-import-confirm-card"><h4>${escape(heading)}</h4><p>${escape(explanation)}</p><div class="data-import-stats-grid">${counts.map(([count, label]) => `<div class="data-import-stat-item"><span class="data-import-stat-val">${count}</span><span class="data-import-stat-lbl">${escape(label)}</span></div>`).join("")}</div>${problems}${diagnostics.length ? `<div class="data-import-warnings">${diagnostics.map((warning) => `<p>${escape(warning)}</p>`).join("")}</div>` : `<p>${escape(ui("No import issues were reported."))}</p>`}</div>`;
    }

    document
      .getElementById("syncGoogleSheetBtn")
      ?.addEventListener("click", async (event) => {
        let button = event.currentTarget;
        let spreadsheetId =
          (typeof localStorage !== "undefined"
            ? localStorage.getItem(GOOGLE_SHEETS_STORAGE_KEY)
            : null) || connectedSheetInput?.value.trim();
        let match = spreadsheetId?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        if (match) spreadsheetId = match[1];

        if (!spreadsheetId) {
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.style.display = "block";
            syncGoogleSheetStatus.textContent = ui(
              "Please connect a spreadsheet first.",
            );
          }
          return;
        }

        pendingGoogleSpreadsheet = null;
        button.disabled = true;
        showGoogleSheetProgress(ui("Reading Google Sheet…"));
        if (syncGoogleSheetApplyBtn) syncGoogleSheetApplyBtn.disabled = true;
        if (syncGoogleSheetStatus) {
          syncGoogleSheetStatus.style.display = "block";
          syncGoogleSheetStatus.textContent = ui(
            "Connecting to Google Sheets…",
          );
        }

        try {
          let accessToken = await window.requestGoogleAccessToken({
            write: false,
          });
          let metadata = await window.fetchGoogleSpreadsheetMetadata(
            spreadsheetId,
            accessToken,
          );
          let ranges = [];
          if (!metadata.sheetTitles.includes("Watched")) {
            throw new Error(ui("Spreadsheet must contain a 'Watched' sheet."));
          }
          ranges.push("'Watched'");
          if (metadata.sheetTitles.includes("Watchlist")) {
            ranges.push("'Watchlist'");
          }
          if (metadata.sheetTitles.includes("Awards")) {
            ranges.push("'Awards'");
          }

          let valuesResult = await window.fetchGoogleSheetValues(
            spreadsheetId,
            ranges,
            accessToken,
          );
          let watchedRows = [];
          let watchlistRows = [];
          let awardsRows = [];
          for (let valueRange of valuesResult.valueRanges || []) {
            let r = valueRange.range || "";
            if (r.startsWith("'Watched'") || r.startsWith("Watched")) {
              watchedRows = valueRange.values || [];
            } else if (
              r.startsWith("'Watchlist'") ||
              r.startsWith("Watchlist")
            ) {
              watchlistRows = valueRange.values || [];
            } else if (r.startsWith("'Awards'") || r.startsWith("Awards")) {
              awardsRows = valueRange.values || [];
            }
          }

          pendingGoogleSpreadsheet = window.proposeGoogleSpreadsheetSync(
            { watchedRows, watchlistRows, awardsRows },
            {
              spreadsheetId,
              sourceName: metadata.title,
              mode: "merge",
            },
          );

          if (syncGoogleSheetStatus)
            syncGoogleSheetStatus.innerHTML = renderGoogleSheetReview(
              pendingGoogleSpreadsheet,
            );
          if (syncGoogleSheetApplyBtn) {
            syncGoogleSheetApplyBtn.disabled =
              !pendingGoogleSpreadsheet.allowed;
          }
        } catch (error) {
          pendingGoogleSpreadsheet = null;
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.textContent = window.formatGoogleSheetsError
              ? window.formatGoogleSheetsError(error)
              : error.message || String(error);
          }
        } finally {
          hideGoogleSheetProgress();
          button.disabled = false;
        }
      });

    document
      .getElementById("syncGoogleSheetApplyBtn")
      ?.addEventListener("click", async (event) => {
        if (!pendingGoogleSpreadsheet) return;
        let button = event.currentTarget;
        button.disabled = true;
        let readButton = document.getElementById("syncGoogleSheetBtn");
        if (readButton) readButton.disabled = true;
        showGoogleSheetProgress(ui("Saving to your archive…"));
        if (syncGoogleSheetStatus) {
          syncGoogleSheetStatus.textContent = ui(
            "Saving to your account… this can take a while for a large import. Don't close this tab.",
          );
        }
        try {
          let result = await window.applyImportProposal(
            pendingGoogleSpreadsheet,
            {
              onProgress: (label, done, total) =>
                showGoogleSheetProgress(
                  `${ui("Saving to your archive…")} ${ui(label)}`,
                  done,
                  total,
                ),
            },
          );
          if (!result?.ok)
            throw new Error(result?.errors?.join(" ") || ui("Import failed."));
          await refreshSource();
          let importedCount =
            pendingGoogleSpreadsheet?.report?.filmsAdded ||
            pendingGoogleSpreadsheet?.report?.archiveAdded ||
            0;
          let celebrationText =
            importedCount > 0
              ? ui(
                  "Your {count} films are in! Explore your decades or head to Home.",
                  { count: importedCount },
                )
              : ui("Spreadsheet sync saved to your account.");
          let watchlistCount =
            pendingGoogleSpreadsheet?.report?.watchlistItemsAdded ||
            pendingGoogleSpreadsheet?.report?.watchlistAdded ||
            0;
          let watchlistCta =
            watchlistCount > 0
              ? `<a class="button-link button-secondary" href="watchlist.html">${escape(ui("Organise watchlist"))}</a>`
              : "";
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.innerHTML = `<div class="data-import-success"><strong>${escape(celebrationText)}</strong><div class="data-actions" style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;"><a class="button-link" href="periods.html">${escape(ui("Explore your decades →"))}</a><a class="button-link button-secondary" href="index.html">${escape(ui("Go to Home"))}</a>${watchlistCta}</div></div>`;
          }
          pendingGoogleSpreadsheet = null;
        } catch (error) {
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.textContent = window.formatGoogleSheetsError
              ? window.formatGoogleSheetsError(error)
              : error.message || String(error);
          }
          button.disabled = false;
        } finally {
          hideGoogleSheetProgress();
          if (readButton) readButton.disabled = false;
        }
      });

    let pushGoogleSheetApplyBtn = document.getElementById(
      "pushGoogleSheetApplyBtn",
    );
    function connectedSpreadsheetId() {
      let value =
        (typeof localStorage !== "undefined"
          ? localStorage.getItem(GOOGLE_SHEETS_STORAGE_KEY)
          : "") || connectedSheetInput?.value.trim();
      return value?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1] || value;
    }
    document
      .getElementById("pushToGoogleSheetBtn")
      ?.addEventListener("click", async (event) => {
        let button = event.currentTarget;
        let spreadsheetId = connectedSpreadsheetId();
        if (!spreadsheetId) return;
        pendingGooglePush = null;
        button.disabled = true;
        showGoogleSheetProgress(ui("Reading Google Sheet…"));
        if (pushGoogleSheetApplyBtn) pushGoogleSheetApplyBtn.disabled = true;
        if (syncGoogleSheetStatus) {
          syncGoogleSheetStatus.style.display = "block";
          syncGoogleSheetStatus.textContent = ui("Reading Google Sheet…");
        }
        try {
          await refreshSource();
          pendingGooglePush =
            await window.previewGoogleSpreadsheetArchive(spreadsheetId);
          if (syncGoogleSheetStatus) {
            syncGoogleSheetStatus.textContent = [
              ui(
                "Review push: {films} watched films, {watchlist} watchlist items, {awards} award placements, {removed} award placements removed.",
                {
                  films: pendingGooglePush.filmsPushed,
                  watchlist: pendingGooglePush.watchlistPushed,
                  awards: pendingGooglePush.awardsPushed,
                  removed: pendingGooglePush.awardsCleared,
                },
              ),
              ui(
                "Watched and Watchlist values will be replaced, including extra columns. Awards changes are listed below; other Awards cells and formatting are preserved. Sync any Sheet edits you want to keep before pushing.",
              ),
              ...pendingGooglePush.warnings,
              ...pendingGooglePush.awardChanges,
            ].join("\n\n");
          }
          if (pushGoogleSheetApplyBtn)
            pushGoogleSheetApplyBtn.disabled = !pendingGooglePush.hasChanges;
        } catch (error) {
          if (syncGoogleSheetStatus)
            syncGoogleSheetStatus.textContent =
              window.formatGoogleSheetsError(error);
        } finally {
          hideGoogleSheetProgress();
          button.disabled = false;
        }
      });
    pushGoogleSheetApplyBtn?.addEventListener("click", async () => {
      if (!pendingGooglePush) return;
      let previewButton = document.getElementById("pushToGoogleSheetBtn");
      pushGoogleSheetApplyBtn.disabled = true;
      showGoogleSheetProgress(ui("Writing to Google Sheet…"));
      if (previewButton) previewButton.disabled = true;
      try {
        let result = await window.writeGoogleSpreadsheetArchive(
          connectedSpreadsheetId(),
          { plan: pendingGooglePush },
        );
        if (syncGoogleSheetStatus)
          syncGoogleSheetStatus.textContent = ui(
            "Archive pushed to Google Sheets ({films} films, {watchlist} watchlist items, {awards} award placements).",
            {
              films: result.filmsPushed,
              watchlist: result.watchlistPushed,
              awards: result.awardsPushed,
            },
          );
      } catch (error) {
        if (syncGoogleSheetStatus)
          syncGoogleSheetStatus.textContent =
            window.formatGoogleSheetsError(error);
      } finally {
        hideGoogleSheetProgress();
        pendingGooglePush = null;
        if (previewButton) previewButton.disabled = false;
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

    initImportTabs();
  }

  const IMPORT_TAB_PANELS = [
    "letterboxdImport",
    "imdbImport",
    "spreadsheetTemplates",
  ];

  function switchImportTab(panelId) {
    if (!IMPORT_TAB_PANELS.includes(panelId)) return;
    let tabs = document.querySelectorAll?.(".data-import-tab") || [];
    tabs.forEach((tab) => {
      let isTarget = tab.getAttribute?.("aria-controls") === panelId;
      tab.classList?.toggle?.("is-active", isTarget);
      tab.setAttribute?.("aria-selected", isTarget ? "true" : "false");
    });
    IMPORT_TAB_PANELS.forEach((id) => {
      let panel = document.getElementById(id);
      if (panel) {
        panel.hidden = id !== panelId;
      }
    });
  }

  function initImportTabs() {
    let tabs = document.querySelectorAll?.(".data-import-tab") || [];
    tabs.forEach((tab) => {
      tab.addEventListener?.("click", () => {
        let panelId = tab.getAttribute?.("aria-controls");
        if (panelId) {
          switchImportTab(panelId);
          if (window.location?.hash !== `#${panelId}`) {
            try {
              window.history?.replaceState?.(null, "", `#${panelId}`);
            } catch {
              if (window.location) window.location.hash = panelId;
            }
          }
        }
      });
    });

    function syncTabFromHash() {
      let hash = (window.location?.hash || "").replace(/^#/, "");
      if (IMPORT_TAB_PANELS.includes(hash)) {
        switchImportTab(hash);
      }
    }

    window.addEventListener?.("hashchange", syncTabFromHash);
    window.addEventListener?.("click", (e) => {
      let link = e.target?.closest?.('a[href^="#"]');
      if (!link) return;
      let targetId = (link.getAttribute?.("href") || "").slice(1);
      if (IMPORT_TAB_PANELS.includes(targetId)) {
        switchImportTab(targetId);
      }
    });

    syncTabFromHash();
  }

  initialize().catch((error) => {
    console.error("Failed to initialize Supabase data tools", error);
    let container = document.querySelector(".data-workspace");
    if (container) {
      container.innerHTML = `<div class="detail-empty"><h2>${escape(ui("Could not load data tools"))}</h2><p>${escape(error.message || String(error))}</p></div>`;
    }
  });
})();
