/**
 * @file Profile page, backed by Supabase (issue #430, refactored in #958).
 * Provides identity settings, consolidated public profile presence,
 * default application preferences (language, theme, poster view),
 * and account deletion. Data sync/export lives on data.html.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("profilePage");
  let profile = null;

  let downloadJson = window.downloadJson;
  let stampedFilename = window.stampedFilename;

  // Removes what the retired IndexedDB/localStorage workspace may have left
  // in this browser - its "oskars" database and its "oskars" and
  // "oskars-recovery" keys - plus this tab's remembered public-profile slug.
  async function clearBrowserStorage() {
    localStorage.removeItem("oskars");
    localStorage.removeItem("oskars-recovery");
    sessionStorage.removeItem("oskars-active-profile");
    if (!window.indexedDB) return;
    await new Promise((resolve, reject) => {
      let request = window.indexedDB.deleteDatabase("oskars");
      request.onsuccess = resolve;
      request.onerror = () =>
        reject(request.error || new Error("Could not clear browser data."));
      request.onblocked = () =>
        reject(
          new Error("Close other Oskars tabs before deleting the profile."),
        );
    });
  }

  function publicProfileCardHtml(user) {
    let name = profile?.display_name || "";
    let slug = profile?.public_slug || "";
    let previewSlug = window.publicProfileSlugify?.(name) || "";
    let isPublic = Boolean(slug);

    let statusHtml = isPublic
      ? `<span class="data-source-badge data-source-badge--connected">Public</span>
         <span>Available at <a href="user.html?u=${encodeURIComponent(slug)}">user.html?u=${escape(slug)}</a></span>`
      : `<span class="data-source-badge data-source-badge--disconnected">Private</span>
         <span>Only you can open your personal archive.</span>`;

    return `<section id="publicProfilePanel" class="data-panel">
      <span class="eyebrow">Identity &amp; Sharing</span>
      <h2>Public Profile</h2>
      <p>Choose your public display name. When public access is enabled, your public link and community presence use this name's URL slug.</p>
      
      <div style="display: grid; gap: 12px; margin-top: 14px;">
        <label class="data-field">
          Display name
          <input type="text" id="publicProfileNameInput" value="${escape(name)}" placeholder="${escape(user.email || "e.g. Oskar")}">
        </label>
        
        <p class="data-panel-status" id="publicProfileSlugPreview" style="margin: 0;">
          ${
            previewSlug
              ? `URL slug: <strong>${escape(previewSlug)}</strong>`
              : "Enter a name to generate its URL slug."
          }
        </p>

        <div class="profile-settings-row">
          <div class="profile-settings-label">
            <strong>Public access</strong>
            <span>Publish your watched films, ratings, rankings, awards, tags, watchlist, and viewing facts (watch dates, platforms, and view counts). Notes and reviews stay private.</span>
          </div>
          <div class="profile-settings-control">
            <button id="togglePublicAccessBtn" type="button" class="${isPublic ? "button-secondary" : ""}" ${!name && !isPublic ? "disabled" : ""}>
              ${isPublic ? "Make private" : "Make public"}
            </button>
          </div>
        </div>
      </div>

      <div class="data-actions" style="margin-top: 12px; align-items: center; justify-content: space-between;">
        <button id="publicProfileNameSaveBtn" type="button">Save name</button>
        <span id="publicProfileNameStatus" class="data-panel-status" style="margin: 0;"></span>
      </div>

      <div class="data-panel-status" id="profileStatus" role="status" style="margin-top: 10px; display: flex; align-items: center; gap: 8px;">
        ${statusHtml}
      </div>
    </section>`;
  }

  function preferencesSectionHtml() {
    let currentLocale = window.oskarsLocale?.() || "en";
    let currentTheme =
      document.documentElement.dataset.theme ||
      localStorage.getItem("oskars-theme") ||
      "dark";
    let isPosterGrid = document.documentElement.dataset.posterGrid === "on";
    let isPosterBackdrop =
      document.documentElement.dataset.posterBackdrop === "on";

    return `<section id="profilePreferencesSection" class="data-panel">
      <span class="eyebrow">Experience</span>
      <h2>Preferences</h2>
      <p>Customize your default language, color theme, and display preferences.</p>

      <div class="profile-settings-row">
        <div class="profile-settings-label">
          <strong>Language</strong>
          <span>Select interface and film title display language.</span>
        </div>
        <div class="profile-settings-control">
          <div class="profile-radio-group" role="radiogroup" aria-label="Language">
            <label class="profile-radio-btn">
              <input type="radio" name="oskarsLocalePref" value="en" ${currentLocale === "en" ? "checked" : ""}>
              English
            </label>
            <label class="profile-radio-btn">
              <input type="radio" name="oskarsLocalePref" value="sv" ${currentLocale === "sv" ? "checked" : ""}>
              Svenska
            </label>
          </div>
        </div>
      </div>

      <div class="profile-settings-row">
        <div class="profile-settings-label">
          <strong>Theme</strong>
          <span>Choose between dark, light, or papyrus color themes.</span>
        </div>
        <div class="profile-settings-control">
          <div class="profile-radio-group" role="radiogroup" aria-label="Theme">
            <label class="profile-radio-btn">
              <input type="radio" name="oskarsThemePref" value="dark" ${currentTheme === "dark" ? "checked" : ""}>
              Dark
            </label>
            <label class="profile-radio-btn">
              <input type="radio" name="oskarsThemePref" value="light" ${currentTheme === "light" ? "checked" : ""}>
              Light
            </label>
            <label class="profile-radio-btn">
              <input type="radio" name="oskarsThemePref" value="papyrus" ${currentTheme === "papyrus" ? "checked" : ""}>
              Papyrus
            </label>
          </div>
        </div>
      </div>

      <div class="profile-settings-row">
        <div class="profile-settings-label">
          <strong>Poster-only grid</strong>
          <span>Hide text metadata on film cards by default in grid views.</span>
        </div>
        <div class="profile-settings-control">
          <label class="profile-switch">
            <input type="checkbox" id="posterGridPrefToggle" ${isPosterGrid ? "checked" : ""}>
          </label>
        </div>
      </div>

      <div class="profile-settings-row">
        <div class="profile-settings-label">
          <strong>Ambient poster backdrop</strong>
          <span>Show a dynamic blurred poster artwork backdrop behind page headers.</span>
        </div>
        <div class="profile-settings-control">
          <label class="profile-switch">
            <input type="checkbox" id="posterBackdropPrefToggle" ${isPosterBackdrop ? "checked" : ""}>
          </label>
        </div>
      </div>
    </section>`;
  }

  function authSectionHtml(user) {
    return `<section id="profileAuthSection" class="data-panel">
      <span class="eyebrow">Session</span>
      <h2>Account</h2>
      <p>Signed in as <strong>${escape(user.email || "your profile")}</strong>.</p>
      <div class="data-actions" style="justify-content: space-between; align-items: center;">
        <button id="profileSignOutBtn" type="button" class="button-secondary">Sign out</button>
        <a href="privacy.html" id="profilePrivacyNoticeLink" class="data-panel-status" data-privacy-notice-trigger>Privacy notice</a>
      </div>
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

  function followingSectionHtml(followingList) {
    let items = followingList || [];
    return `<section id="profileFollowingSection" class="data-panel">
      <span class="eyebrow">Connections</span>
      <h2>Following &amp; Friends</h2>
      <p>Members you follow on The Oskars. Mutual follows establish a friend connection that highlights ratings and ceremonies on film details.</p>

      ${
        items.length
          ? `<ul class="profile-following-list" style="list-style: none; padding: 0; margin: 16px 0 0; display: grid; gap: 8px;">
              ${items
                .map((item) => {
                  let p = item.profile || {};
                  let name = p.display_name || p.public_slug || "Member";
                  let initial = (name || "?").charAt(0).toUpperCase();
                  let isFriend = Boolean(item.isMutualFriend);
                  let userUrl = p.public_slug
                    ? `user.html?u=${encodeURIComponent(p.public_slug)}`
                    : "#";
                  return `<li class="profile-following-item" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: var(--card-bg, rgba(255,255,255,0.04)); border: 1px solid var(--border-color, rgba(255,255,255,0.1)); border-radius: 8px;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                      <span class="film-social-avatar" aria-hidden="true" style="width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--accent); color: #fff; font-weight: bold; font-size: 0.9rem;">${escape(initial)}</span>
                      <div>
                        ${
                          p.public_slug
                            ? `<a href="${escape(userUrl)}" style="font-weight: 600; text-decoration: none; color: inherit;">${escape(name)}</a>`
                            : `<strong style="font-weight: 600;">${escape(name)}</strong>`
                        }
                        ${
                          isFriend
                            ? `<span class="data-source-badge data-source-badge--connected" style="margin-left: 6px; font-size: 0.75rem;">Friend</span>`
                            : `<span class="data-source-badge" style="margin-left: 6px; font-size: 0.75rem;">Following</span>`
                        }
                      </div>
                    </div>
                    <button type="button" class="button-secondary" data-profile-unfollow-id="${escape(item.following_id)}" style="padding: 4px 10px; font-size: 0.85rem;">
                      Unfollow
                    </button>
                  </li>`;
                })
                .join("")}
            </ul>`
          : `<p class="data-panel-status" style="margin-top: 12px;">You are not following any members yet. Discover public profiles in <a href="community.html">Community</a>.</p>`
      }
    </section>`;
  }

  function render(user, followingList = []) {
    container.innerHTML = `<div class="data-workspace-heading">
        <div>
          <span class="eyebrow">Settings</span>
          <h1>Profile</h1>
          <p>Manage your identity, public presence, and application preferences.</p>
        </div>
        <div>
          <a href="data.html" class="button-link button-secondary">Data &amp; Sync</a>
        </div>
      </div>
      <div class="data-panel-stack">
        ${publicProfileCardHtml(user)}
        ${followingSectionHtml(followingList)}
        ${preferencesSectionHtml()}
        ${authSectionHtml(user)}
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
          await clearBrowserStorage();
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

    let nameInput = document.getElementById("publicProfileNameInput");
    nameInput?.addEventListener("input", (event) => {
      let slug = window.publicProfileSlugify?.(event.target.value) || "";
      let preview = document.getElementById("publicProfileSlugPreview");
      if (preview) {
        preview.innerHTML = slug
          ? `URL slug: <strong>${escape(slug)}</strong>`
          : "Enter a name to generate its URL slug.";
      }
      let toggleBtn = document.getElementById("togglePublicAccessBtn");
      if (toggleBtn && !profile?.public_slug) {
        toggleBtn.disabled = !event.target.value.trim();
      }
    });

    document
      .getElementById("publicProfileNameSaveBtn")
      ?.addEventListener("click", async () => {
        let value = nameInput?.value.trim() || "";
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

    let togglePublicBtn = document.getElementById("togglePublicAccessBtn");
    togglePublicBtn?.addEventListener("click", async () => {
      if (togglePublicBtn.disabled) return;
      togglePublicBtn.disabled = true;
      let shouldPublish = !profile?.public_slug;
      try {
        await setPublication(shouldPublish);
        render(user);
      } catch (error) {
        togglePublicBtn.disabled = false;
        window.alert(error.message || String(error));
      }
    });

    // Preferences: Language
    document
      .querySelectorAll('input[name="oskarsLocalePref"]')
      .forEach((radio) => {
        radio.addEventListener("change", (e) => {
          let input = /** @type {HTMLInputElement} */ (e.target);
          let next = input.value;
          window.setOskarsLocale?.(next);
        });
      });

    // Preferences: Theme
    document
      .querySelectorAll('input[name="oskarsThemePref"]')
      .forEach((radio) => {
        radio.addEventListener("change", (e) => {
          let input = /** @type {HTMLInputElement} */ (e.target);
          let next = /** @type {'dark'|'light'|'papyrus'} */ (input.value);
          window.applyOskarsTheme?.(next);
        });
      });

    // Preferences: Poster-only grid
    document
      .getElementById("posterGridPrefToggle")
      ?.addEventListener("change", (e) => {
        let input = /** @type {HTMLInputElement} */ (e.target);
        window.applyOskarsPosterGrid?.(input.checked);
      });

    // Preferences: Poster backdrop
    document
      .getElementById("posterBackdropPrefToggle")
      ?.addEventListener("change", (e) => {
        let input = /** @type {HTMLInputElement} */ (e.target);
        window.applyOskarsPosterBackdrop?.(input.checked);
      });
    // Connections: Unfollow
    container
      .querySelectorAll("[data-profile-unfollow-id]")
      .forEach((button) => {
        button.addEventListener("click", async (e) => {
          let followingId = e.currentTarget.dataset.profileUnfollowId;
          if (!followingId) return;
          button.disabled = true;
          try {
            await window.unfollowSupabaseUser?.(followingId);
            let updatedList = (await window.listSupabaseFollowing?.()) || [];
            render(user, updatedList);
          } catch (err) {
            button.disabled = false;
            console.warn("Unfollow failed:", err);
          }
        });
      });
  }

  function renderHeaderAuthStatus(user, profileRecord) {
    window.renderHeaderAuthStatus?.(user, profileRecord?.display_name);
  }

  async function boot() {
    let params = new URLSearchParams(window.location.search || "");
    let querySlug = params.get("u") || params.get("profile");
    if (querySlug) {
      window.location.replace(`user.html?u=${encodeURIComponent(querySlug)}`);
      return;
    }
    let finish = window.startOskarsPerformance?.("profile:render");
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      profile = await window.loadSupabaseProfile();
      let followingList = [];
      try {
        if (window.listSupabaseFollowing) {
          followingList = await window.listSupabaseFollowing();
        }
      } catch (err) {
        console.warn("Failed loading following list:", err);
      }
      render(access.user, followingList);
      renderHeaderAuthStatus(access.user, profile);
      finish?.();
      window.refreshFocusedShellBackdrop?.();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your profile</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
