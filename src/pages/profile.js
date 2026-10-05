/**
 * @file Profile page, backed by Supabase (issue #430),
 * continuing #420/#421/#422/#429's pattern: gate check ->
 * loadSupabaseProfile() -> render -> each action calls its
 * supabase-workspace.js function directly.
 *
 * Deliberately focused on the current Supabase profile model rather than the
 * previous implementation's workspace-sync conflict resolution, "load complete archive
 * from cloud" preview/apply, and "attach workspace to this account" /
 * "switch accounts safely" have no Supabase equivalent at all - there is
 * no local-first archive to sync, every write is already live in
 * Postgres, so that entire category of complexity stops existing rather
 * than needing a port. Profile deletion removes the Supabase Auth row,
 * cascading through all app-owned rows, then clears this browser and signs
 * out the user.
 *
 * Single top-level container (#profilePage, matching entry-loader.js's
 * `document.querySelector("main")` for its own loading-gate render),
 * not separate pre-existing named child elements like the previous
 * version used - found running this for real: entry-loader.js's early
 * "loading" gate render replaces <main>'s entire innerHTML before this
 * page's own script ever runs, which would silently destroy any static
 * child elements a page's HTML shell pre-declared.
 *
 * Deletion itself (issue #431, reconciled in #452/#453) downloads a
 * complete backup of every row the account owns first
 * (window.buildSupabaseAccountBackup - deliberately wider than the Data
 * page's restore-format backup), states the actual scope in the confirm
 * prompt (the login itself is deleted, not just its data, and any public
 * profile slug goes with it), then calls delete_my_account() and clears
 * this browser.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("profilePage");
  let profile = null;

  let downloadJson = window.downloadJson;
  let stampedFilename = window.stampedFilename;

  function authSectionHtml(user) {
    return `<section id="profileAuthSection" class="data-panel">
      <span class="eyebrow">Session</span>
      <h2>Account</h2>
      <p>Signed in as <strong>${escape(user.email || "your profile")}</strong>.</p>
      <p class="data-panel-status"><a href="privacy.html" id="profilePrivacyNoticeLink" data-privacy-notice-trigger>Privacy notice</a></p>
      <div class="data-actions"><button id="profileSignOutBtn" type="button" class="button-secondary">Sign out</button></div>
    </section>`;
  }

  function publicProfileNameHtml(user) {
    let suggested = profile?.display_name || "";
    let slug = window.publicProfileSlugify?.(suggested) || "";
    return `<section id="publicProfileNamePanel" class="data-panel">
      <span class="eyebrow">Public presence</span>
      <h2>Public profile name</h2>
      <p>Used as your public profile's display name and URL slug when you publish one.</p>
      <label class="data-field">Name<input type="text" id="publicProfileNameInput" value="${escape(suggested)}" placeholder="${escape(user.email || "")}"></label>
      <p class="data-panel-status">${slug ? `URL slug: ${escape(slug)}` : "Enter a name to see its URL slug."}</p>
      <div class="data-actions">
        <button id="publicProfileNameSaveBtn" type="button">Save</button>
      </div>
      <p id="publicProfileNameStatus" class="data-panel-status"></p>
    </section>`;
  }

  function publicProfilePublishHtml() {
    let slug = profile?.public_slug || "";
    let name = (profile?.display_name || "").trim();
    return `<section id="publicProfilePublishPanel" class="data-panel">
      <span class="eyebrow">Sharing</span>
      <h2>Public access</h2>
      <p>Make your archive available through its public link, or keep it private. This changes access immediately.</p>
      <div class="data-actions">
        <button id="publishProfileBtn" type="button" ${slug ? "hidden" : ""} ${name ? "" : "disabled"}>Make public</button>
        <button id="unpublishProfileBtn" type="button" class="button-secondary" ${slug ? "" : "hidden"}>Remove public access</button>
      </div>
      <p id="profileStatus" class="data-panel-status" role="status">${
        slug
          ? `Public now. <a href="index.html?profile=${encodeURIComponent(slug)}">View public profile</a>`
          : name
            ? "Private now. Only you can open this profile."
            : "Set a name above first — it becomes your public link."
      }</p>
    </section>`;
  }

  function letterboxdSyncHtml(profileRecord) {
    let username = profileRecord?.letterboxd_username || "";
    let lastSynced = profileRecord?.letterboxd_last_synced_at;
    let lastSyncedText = lastSynced
      ? `Last synced with Letterboxd on ${new Date(lastSynced).toLocaleDateString()}.`
      : "Never synced yet. Enter your Letterboxd username to start.";
    return `<section id="letterboxdProfilePanel" class="data-panel">
      <span class="eyebrow">Sync &amp; Connections</span>
      <h2>Letterboxd sync</h2>
      <p>Automatically detect new diary watches from your public Letterboxd RSS feed and start an Intake for them.</p>
      <label class="data-field">Letterboxd username<input type="text" id="letterboxdUsernameInput" value="${escape(username)}" placeholder="e.g. username" autocomplete="off" spellcheck="false"></label>
      <p class="data-panel-status" id="letterboxdSyncDescription">${escape(lastSyncedText)}</p>
      <div class="data-actions">
        <button id="letterboxdUsernameSaveBtn" type="button">Save</button>
        ${username ? `<button id="letterboxdSyncNowBtn" type="button" class="button-secondary">Sync now</button><button id="letterboxdDisconnectBtn" type="button" class="button-secondary button-danger-subtle">Disconnect</button>` : ""}
      </div>
      <p id="letterboxdProfileStatus" class="data-panel-status" role="status"></p>
    </section>`;
  }

  function exportProfileHtml() {
    return `<section id="profileExportPanel" class="data-panel">
      <span class="eyebrow">Data portability</span>
      <h2>Account export</h2>
      <p>Download a complete JSON backup of every row your account owns in Supabase (watched films, watchlist, rankings, personal awards, projects, notes, and tags).</p>
      <div class="data-actions">
        <button id="profileExportBtn" type="button" class="button-secondary">Download account backup</button>
      </div>
      <p id="profileExportStatus" class="data-panel-status" role="status"></p>
    </section>`;
  }

  function deleteProfileHtml(profileRecord) {
    return `<section id="profileDeletePanel" class="data-panel profile-danger-panel data-danger-zone-list">
      <span class="eyebrow">Irreversible changes</span>
      <h2>Delete profile</h2>
      <p>Permanently deletes this account and every row it owns in Supabase - watched films, watchlist, rankings, tags, personal awards, projects, and everything else - plus all saved Oskars data in this browser. This cannot be undone: the login itself is deleted, not just its data.</p>
      <p>A complete backup of every row downloads automatically before anything is deleted.</p>
      ${
        profileRecord?.public_slug
          ? `<p>Public profile slug set: <strong>${escape(profileRecord.public_slug)}</strong>. Deleting your account removes this too.</p>`
          : ""
      }
      <div class="data-actions"><button id="profileDeleteBtn" type="button" class="button-danger">Delete profile</button></div>
      <p id="profileDeleteStatus" class="data-panel-status"></p>
    </section>`;
  }

  function render(user) {
    container.innerHTML = `<div class="data-workspace-heading">
        <div>
          <span class="eyebrow">Settings</span>
          <h1>Profile &amp; Account</h1>
          <p>Manage your account identity, public profile, connected services, and archive portability.</p>
        </div>
      </div>
      <div class="data-panel-stack">
        ${authSectionHtml(user)}
        ${publicProfileNameHtml(user)}
        ${publicProfilePublishHtml()}
        ${letterboxdSyncHtml(profile)}
        ${exportProfileHtml()}
        ${deleteProfileHtml(profile)}
      </div>`;
    wireEvents(user);
  }

  async function setPublication(published) {
    let slug = published
      ? window.publicProfileSlugify?.(profile?.display_name)
      : null;
    if (published && !slug) throw new Error("Set a display name above first.");
    let { client } = await window.ensureSupabaseClient();
    let { error } = await client
      .from("profiles")
      .update({ public_slug: slug })
      .eq("id", profile.id);
    if (error) throw error;
    profile = { ...profile, public_slug: slug };
  }

  function wireEvents(user) {
    document
      .getElementById("profileSignOutBtn")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
      });
    document
      .getElementById("profileExportBtn")
      ?.addEventListener("click", async (event) => {
        let button = event.currentTarget;
        let status = document.getElementById("profileExportStatus");
        button.disabled = true;
        if (status) status.textContent = "Building complete account backup…";
        try {
          let backup = await window.buildSupabaseAccountBackup();
          downloadJson(backup, stampedFilename("the-oskars-account-backup"));
          if (status) status.textContent = "Backup downloaded successfully.";
        } catch (error) {
          if (status) status.textContent = error.message || String(error);
        } finally {
          button.disabled = false;
        }
      });
    document
      .getElementById("profileDeleteBtn")
      ?.addEventListener("click", async (event) => {
        let confirmMessage =
          "Permanently delete this account and every row it owns in " +
          "Supabase (watched films, watchlist, rankings, tags, personal " +
          "awards, projects, and more)? A complete backup downloads " +
          "first. This cannot be undone — the login itself is " +
          "deleted, not just its data.";
        if (profile?.public_slug)
          confirmMessage += ` Your public profile slug ("${profile.public_slug}") is deleted too.`;
        if (!window.confirm(confirmMessage)) return;
        let button = event.currentTarget;
        button.disabled = true;
        let status = document.getElementById("profileDeleteStatus");
        try {
          if (status) status.textContent = "Downloading backup…";
          downloadJson(
            await window.buildSupabaseAccountBackup(),
            stampedFilename("the-oskars-account-backup"),
          );
          if (status) status.textContent = "Deleting account…";
          await window.deleteSupabaseAccount?.();
          await window.clearAllStoredOskarsData?.();
          try {
            await window.signOutOfSupabase?.();
          } catch (error) {
            console.warn(
              "Profile was deleted, but sign-out reported an error.",
              error,
            );
          }
          window.location.replace("index.html");
        } catch (error) {
          button.disabled = false;
          if (status) status.textContent = error.message || String(error);
        }
      });
    document
      .getElementById("publicProfileNameInput")
      ?.addEventListener("input", (event) => {
        let slug = window.publicProfileSlugify?.(event.target.value) || "";
        let status = document.querySelector(
          "#publicProfileNamePanel .data-panel-status",
        );
        if (status)
          status.textContent = slug
            ? `URL slug: ${slug}`
            : "Enter a name to see its URL slug.";
      });
    document
      .getElementById("publicProfileNameSaveBtn")
      ?.addEventListener("click", async () => {
        let value =
          document.getElementById("publicProfileNameInput")?.value.trim() || "";
        let button = document.getElementById("publicProfileNameSaveBtn");
        let status = document.getElementById("publicProfileNameStatus");
        button.disabled = true;
        try {
          profile = await window.setSupabaseProfileDisplayName(value);
          render(user);
          let newStatus = document.getElementById("publicProfileNameStatus");
          if (newStatus) newStatus.textContent = value ? "Saved." : "Cleared.";
        } catch (error) {
          button.disabled = false;
          if (status) status.textContent = error.message || String(error);
        }
      });
    let publishBtn = document.getElementById("publishProfileBtn");
    publishBtn?.addEventListener("click", async () => {
      if (publishBtn.disabled) return;
      publishBtn.disabled = true;
      try {
        await setPublication(true);
        render(user);
      } catch (error) {
        publishBtn.disabled = false;
        window.alert(error.message || String(error));
      }
    });
    let unpublishBtn = document.getElementById("unpublishProfileBtn");
    unpublishBtn?.addEventListener("click", async () => {
      if (unpublishBtn.disabled) return;
      unpublishBtn.disabled = true;
      try {
        await setPublication(false);
        render(user);
      } catch (error) {
        unpublishBtn.disabled = false;
        window.alert(error.message || String(error));
      }
    });

    document
      .getElementById("letterboxdUsernameSaveBtn")
      ?.addEventListener("click", async () => {
        let value =
          document.getElementById("letterboxdUsernameInput")?.value.trim() ||
          "";
        let button = document.getElementById("letterboxdUsernameSaveBtn");
        let status = document.getElementById("letterboxdProfileStatus");
        button.disabled = true;
        try {
          profile = await window.setSupabaseProfileLetterboxd(value);
          render(user);
          let newStatus = document.getElementById("letterboxdProfileStatus");
          if (newStatus)
            newStatus.textContent = value
              ? "Letterboxd settings saved."
              : "Letterboxd username cleared.";
        } catch (error) {
          button.disabled = false;
          if (status) status.textContent = error.message || String(error);
        }
      });

    document
      .getElementById("letterboxdDisconnectBtn")
      ?.addEventListener("click", async () => {
        let confirmMsg =
          "Disconnect Letterboxd RSS sync? This stops automatic intake sync and removes your saved username. Previously imported films and ratings will stay in your archive.";
        if (!window.confirm(confirmMsg)) return;
        let button = document.getElementById("letterboxdDisconnectBtn");
        let status = document.getElementById("letterboxdProfileStatus");
        button.disabled = true;
        if (status) status.textContent = "Disconnecting Letterboxd RSS sync…";
        try {
          profile = await window.setSupabaseProfileLetterboxd("");
          render(user);
          let newStatus = document.getElementById("letterboxdProfileStatus");
          if (newStatus)
            newStatus.textContent = "Letterboxd RSS sync disconnected.";
        } catch (error) {
          button.disabled = false;
          if (status) status.textContent = error.message || String(error);
        }
      });

    document
      .getElementById("letterboxdSyncNowBtn")
      ?.addEventListener("click", async () => {
        let button = document.getElementById("letterboxdSyncNowBtn");
        let status = document.getElementById("letterboxdProfileStatus");
        button.disabled = true;
        if (status) status.textContent = "Syncing from Letterboxd…";
        try {
          let result = await window.syncLetterboxdIntakes?.({ force: true });
          if (result?.status === "synced") {
            if (status) {
              status.textContent =
                result.createdCount > 0
                  ? `Synced ${result.createdCount} new watch(es) into Intake.`
                  : "All caught up — no new Letterboxd watches found.";
            }
            profile = await window.loadSupabaseProfile();
            let desc = document.getElementById("letterboxdSyncDescription");
            if (desc && profile?.letterboxd_last_synced_at) {
              desc.textContent = `Last synced with Letterboxd on ${new Date(profile.letterboxd_last_synced_at).toLocaleDateString()}.`;
            }
          } else if (result?.status === "fetch_failed") {
            if (status)
              status.textContent =
                "Could not fetch Letterboxd feed (check username or profile privacy).";
          } else {
            if (status) status.textContent = result?.reason || "Sync finished.";
          }
        } catch (error) {
          if (status) status.textContent = error.message || String(error);
        } finally {
          button.disabled = false;
        }
      });
  }

  function renderHeaderAuthStatus(user, profileRecord) {
    window.renderHeaderAuthStatus?.(user, profileRecord?.display_name);
  }

  async function boot() {
    let finish = window.startOskarsPerformance?.("profile:render");
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      profile = await window.loadSupabaseProfile();
      render(access.user);
      renderHeaderAuthStatus(access.user, profile);
      finish?.();
      window.refreshFocusedShellBackdrop?.();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your profile</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
