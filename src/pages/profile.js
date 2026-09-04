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

  function authSectionHtml(user) {
    return `<section id="profileAuthSection" class="data-panel">
      <h2>Profile</h2>
      <p>Signed in as ${escape(user.email || "your profile")}.</p>
      <div class="data-actions"><button id="profileSignOutBtn" type="button">Sign out</button></div>
    </section>`;
  }

  function publicProfileNameHtml(user) {
    let suggested = profile?.display_name || "";
    let slug = window.publicProfileSlugify?.(suggested) || "";
    return `<section id="publicProfileNamePanel" class="data-panel">
      <h2>Public profile name</h2>
      <p>Used as your public profile's display name and URL slug when you publish one.</p>
      <label>Name<input type="text" id="publicProfileNameInput" value="${escape(suggested)}" placeholder="${escape(user.email || "")}"></label>
      <p class="data-panel-status">${slug ? `URL slug: ${escape(slug)}` : "Enter a name to see its URL slug."}</p>
      <div class="data-actions">
        <button id="publicProfileNameSaveBtn" type="button">Save</button>
      </div>
      <p id="publicProfileNameStatus" class="data-panel-status"></p>
    </section>`;
  }

  function deleteProfileHtml(profileRecord) {
    return `<section id="profileDeletePanel" class="data-panel profile-danger-panel">
      <h2>Delete profile</h2>
      <p>Permanently deletes this account and every row it owns in Supabase - watched films, watchlist, rankings, tags, personal awards, projects, and everything else - plus all saved Oskars data in this browser. This cannot be undone: the login itself is deleted, not just its data.</p>
      <p>A complete backup of every row downloads automatically before anything is deleted.</p>
      ${
        profileRecord?.public_slug
          ? `<p>Public profile slug set: <strong>${escape(profileRecord.public_slug)}</strong>. Deleting your account removes this too.</p>`
          : ""
      }
      <div class="data-actions"><button id="profileDeleteBtn" type="button">Delete profile</button></div>
      <p id="profileDeleteStatus" class="data-panel-status"></p>
    </section>`;
  }

  function render(user) {
    container.innerHTML = `<div class="data-workspace-heading">
        <div>
          <span class="eyebrow">Profile</span>
          <h1>Profile</h1>
          <p>Sign in with Google to save your ratings, watchlist, and rankings to your profile.</p>
        </div>
      </div>
      <div class="data-panel-stack">
        ${authSectionHtml(user)}
        ${publicProfileNameHtml(user)}
        ${deleteProfileHtml(profile)}
      </div>`;
    wireEvents(user);
  }

  function wireEvents(user) {
    document
      .getElementById("profileSignOutBtn")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
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
  }

  function renderHeaderAuthStatus(user, profileRecord) {
    let statusContainer = document.querySelector("[data-auth-status]");
    if (!statusContainer) return;
    let displayName =
      profileRecord?.display_name ||
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email ||
      "Profile";
    window.renderSignedInHeaderAccount?.(statusContainer, user, displayName);
    statusContainer
      .querySelector("[data-supabase-sign-out]")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
      });
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
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your profile</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
