/**
 * @file Renders the account page: Google sign-in status, Firestore cloud
 * sync controls (issue #248), and the public-profile display name (issue
 * #253) that the Data page's publish panel slugifies into a URL. Moved out
 * of data.html, which had accumulated backup/restore, canonical
 * publication, public-profile publication, Google Sheets/Letterboxd
 * import, danger zones, edit log, data health, and metadata batches
 * alongside it - account/identity settings get their own focused page
 * instead of adding to that pile.
 */

(function () {
  let ui = window.uiText || ((text) => text);
  let escape = window.pageEscape || ((value) => String(value ?? ""));
  let pendingCloudRestoreProposal = null;

  function authSectionHtml(user) {
    if (!window.oskarsFirebaseConfigured?.()) {
      return `<h2>${ui("Sign in")}</h2><p>${ui("Cloud sync isn't set up for this deployment yet.")}</p>`;
    }
    if (user) {
      return `<h2>${ui("Sign in")}</h2><p>${ui("Signed in as {name}.", { name: escape(user.displayName || user.email || ui("your Google account")) })}</p><div class="data-actions"><button id="profileSignOutBtn" type="button">${ui("Sign out")}</button></div>`;
    }
    return `<h2>${ui("Sign in")}</h2><p>${ui("Sign in with Google to sync this workspace across your devices.")}</p><div id="profileSignInButton"></div>`;
  }

  function renderAuthSection(user) {
    let container = document.getElementById("profileAuthSection");
    if (!container) return;
    container.innerHTML = authSectionHtml(user);
    let signInContainer = document.getElementById("profileSignInButton");
    if (signInContainer) window.renderGoogleSignInButton?.(signInContainer);
    document
      .getElementById("profileSignOutBtn")
      ?.addEventListener("click", () => window.signOutOfFirebase?.());
  }

  function updateCloudSyncPanelVisibility(user) {
    let panel = document.getElementById("cloudSyncPanel");
    if (panel) panel.hidden = !user;
  }

  function publicProfileNameHtml(user) {
    let saved = (window.state.publicProfileDisplayName || "").trim();
    let suggested = saved || user?.displayName || "";
    let slug = window.publicProfileSlugify?.(suggested) || "";
    return `<h2>${ui("Public profile name")}</h2>
      <p>${ui("Used as your public profile's display name and URL slug when you publish one (see the Data page's “Publish a public profile” panel).")}</p>
      <label>${ui("Name")}<input type="text" id="publicProfileNameInput" value="${escape(suggested)}" placeholder="${escape(user?.displayName || "")}"></label>
      <p class="data-panel-status">${slug ? ui("URL slug: {slug}", { slug }) : ui("Enter a name to see its URL slug.")}</p>
      <div class="data-actions">
        <button id="publicProfileNameSaveBtn" type="button">${ui("Save")}</button>
      </div>
      <p id="publicProfileNameStatus" class="data-panel-status"></p>`;
  }

  function renderPublicProfileNamePanel(user) {
    let container = document.getElementById("publicProfileNamePanel");
    if (!container) return;
    container.innerHTML = publicProfileNameHtml(user);
    document
      .getElementById("publicProfileNameSaveBtn")
      ?.addEventListener("click", async () => {
        let value =
          document.getElementById("publicProfileNameInput")?.value.trim() ||
          "";
        window.state.publicProfileDisplayName = value;
        // Immediate and awaited, not the usual debounced save: a page
        // navigation (e.g. straight to the Data page's publish panel)
        // right after clicking Save must not race the write and lose it.
        await window.save({ immediate: true });
        renderPublicProfileNamePanel(user);
        let status = document.getElementById("publicProfileNameStatus");
        if (status) status.textContent = value ? ui("Saved.") : ui("Cleared.");
      });
  }

  function renderConflicts() {
    let container = document.getElementById("cloudSyncConflicts");
    if (!container) return;
    let conflicts = window.getWorkspaceSyncConflicts?.() || [];
    if (!conflicts.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML =
      `<p>${ui("{count} item(s) changed on this device and elsewhere - choose which version to keep for each:", { count: conflicts.length })}</p>` +
      conflicts
        .map(
          (conflict) =>
            `<div class="cloud-sync-conflict-row"><span>${escape(conflict.sectionKey)} / ${escape(conflict.shardKey)}</span><button type="button" data-resolve="keep-local" data-section="${escape(conflict.sectionKey)}" data-shard="${escape(conflict.shardKey)}">${ui("Keep this device's version")}</button><button type="button" data-resolve="keep-remote" data-section="${escape(conflict.sectionKey)}" data-shard="${escape(conflict.shardKey)}">${ui("Use the other device's version")}</button></div>`,
        )
        .join("");
  }

  async function handleConflictResolveClick(event) {
    let button = event.target.closest("[data-resolve]");
    if (!button) return;
    button.disabled = true;
    await window.resolveWorkspaceSyncConflict?.(
      button.dataset.section,
      button.dataset.shard,
      button.dataset.resolve,
    );
    renderConflicts();
  }

  async function runManualCloudSync() {
    let button = document.getElementById("cloudSyncNowBtn");
    let status = document.getElementById("cloudSyncStatus");
    button.disabled = true;
    button.textContent = ui("Syncing...");
    let result = await window.runWorkspaceSync?.({ reason: "manual" });
    button.disabled = false;
    button.textContent = ui("Sync now");
    renderConflicts();
    if (!result) return;
    if (result.conflicts?.length) {
      status.textContent = ui(
        "{count} item(s) changed on this device and elsewhere - see below to choose which version to keep.",
        { count: result.conflicts.length },
      );
    } else if (result.hadError) {
      status.textContent = ui("Cloud sync hit an error - it will retry automatically.");
    } else if (result.pushedCount || result.pulledCount) {
      status.textContent = ui(
        "Synced: {pushed} shard(s) uploaded, {pulled} shard(s) downloaded.",
        { pushed: result.pushedCount, pulled: result.pulledCount },
      );
    } else {
      status.textContent = ui("Already up to date.");
    }
  }

  async function previewCloudRestore() {
    let button = document.getElementById("cloudRestoreBtn");
    let status = document.getElementById("cloudSyncStatus");
    button.disabled = true;
    button.textContent = ui("Loading from cloud...");
    try {
      let fetched = await window.fetchCanonicalDataFromCloud?.();
      if (!fetched?.ok) {
        status.textContent = ui("Could not load the cloud archive: {error}", {
          error: fetched?.error || "unknown error",
        });
        return;
      }
      let proposal = window.proposeJsonImport(fetched.canonical, {
        mode: "replace",
        sourceName: "Cloud workspace",
      });
      pendingCloudRestoreProposal = proposal;
      window.showImportReport?.(
        window.compactImportReport?.(proposal.report, { preview: true }) ||
          proposal.report,
      );
      document.getElementById("cloudRestoreApplyBtn").disabled = !proposal.allowed;
      status.textContent = ui(
        "Previewed below as a replace proposal - review, then apply the reviewed archive to draft it locally.",
      );
    } catch (err) {
      status.textContent = ui("Could not preview the cloud archive: {error}", {
        error: err.message || String(err),
      });
    } finally {
      button.disabled = false;
      button.textContent = ui("Load complete archive from cloud");
    }
  }

  async function applyCloudRestoreProposal() {
    let button = document.getElementById("cloudRestoreApplyBtn");
    if (!pendingCloudRestoreProposal) return;
    button.disabled = true;
    button.textContent = ui("Applying...");
    let result = await window.applyImportProposal(pendingCloudRestoreProposal);
    if (!result.ok) {
      button.textContent = ui("Apply failed");
      alert(result.errors.join("\n"));
      return;
    }
    pendingCloudRestoreProposal = null;
    button.textContent = ui("Applied to draft");
    window.hideImportReport?.();
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("profile:render");
    let user = window.getFirebaseCurrentUser?.() || null;
    renderAuthSection(user);
    renderPublicProfileNamePanel(user);
    updateCloudSyncPanelVisibility(user);
    renderConflicts();
    finishRenderTimer?.();
  }

  render();
  window.onFirebaseAuthChange?.(render);

  document
    .getElementById("cloudSyncNowBtn")
    ?.addEventListener("click", runManualCloudSync);
  document
    .getElementById("cloudRestoreBtn")
    ?.addEventListener("click", previewCloudRestore);
  document
    .getElementById("cloudRestoreApplyBtn")
    ?.addEventListener("click", applyCloudRestoreProposal);
  document
    .getElementById("cloudSyncConflicts")
    ?.addEventListener("click", handleConflictResolveClick);
  document
    .getElementById("dismissImportReport")
    ?.addEventListener("click", window.hideImportReport);
})();
