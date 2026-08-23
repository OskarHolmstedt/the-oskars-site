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
      let required = window.oskarsRequiredAccountSession?.();
      let syncAccess = window.getWorkspaceSyncAccountAccess?.() || {
        allowed: false,
        status: "unlinked",
      };
      let lineageAction = "";
      if (syncAccess.status === "unlinked")
        lineageAction = `<p>${ui("This local workspace is not attached to a cloud account yet. Connect it explicitly before any upload or download.")}</p><div class="data-actions"><button id="profileAttachAccountBtn" type="button">${ui("Connect this workspace to this account")}</button></div>`;
      else if (syncAccess.status === "different-account")
        lineageAction = `<p class="data-panel-status">${ui("Cloud actions are locked because this workspace belongs to another account.")}</p>`;
      return `<h2>${ui("Sign in")}</h2><p>${ui("Signed in as {name}.", { name: escape(user.displayName || user.email || ui("your Google account")) })}</p>${required ? `<p>${ui("Signing out locks this private archive immediately. Sign back into the same account to reopen it.")}</p>` : ""}${lineageAction}<div class="data-actions"><button id="profileSignOutBtn" type="button">${ui(required ? "Sign out and lock" : "Sign out")}</button>${required ? `<button id="profileSwitchAccountBtn" type="button">${ui("Switch accounts safely")}</button>` : ""}</div><p id="profileAccountStatus" class="data-panel-status"></p>`;
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
      ?.addEventListener("click", async () => {
        let required = window.oskarsRequiredAccountSession?.();
        if (
          window.confirm(
            ui(
              required
                ? "Sign out and lock this browser's private archive? Nothing is deleted; the same account can reopen it later."
                : "Stop cloud sync and continue locally? You can sign in again anytime - nothing local is lost either way.",
            ),
          )
        )
          await window.signOutOfFirebase?.();
      });
    document
      .getElementById("profileAttachAccountBtn")
      ?.addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        let result = await window.attachOskarsWorkspaceToCurrentAccount?.();
        if (result?.ok) render();
        else {
          event.currentTarget.disabled = false;
          let status = document.getElementById("profileAccountStatus");
          if (status)
            status.textContent = ui(
              "Could not connect this workspace: {reason}",
              { reason: result?.reason || "unknown error" },
            );
        }
      });
    document
      .getElementById("profileSwitchAccountBtn")
      ?.addEventListener("click", runSafeAccountSwitch);
  }

  async function runSafeAccountSwitch() {
    if (
      !window.confirm(
        ui(
          "Switch accounts? A full backup downloads first, an account-bound recovery is retained, and this archive is removed from the active browser before sign-out. Cloud data is not deleted.",
        ),
      )
    )
      return;
    let button = document.getElementById("profileSwitchAccountBtn");
    let status = document.getElementById("profileAccountStatus");
    button.disabled = true;
    button.textContent = ui("Preparing safe switch...");
    let result = await window.prepareOskarsAccountSwitch?.();
    if (!result?.ok) {
      button.disabled = false;
      button.textContent = ui("Switch accounts safely");
      status.textContent = ui("Could not prepare account switch: {reason}", {
        reason: result?.reason || "unknown error",
      });
      return;
    }
    status.textContent = ui("Backup retained. Locking this browser and signing out...");
    await window.signOutOfFirebase?.();
  }

  function updateCloudSyncPanelVisibility(user) {
    let panel = document.getElementById("cloudSyncPanel");
    if (panel)
      panel.hidden = !user || !window.getWorkspaceSyncAccountAccess?.().allowed;
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
    } else if (result.unauthorized) {
      status.textContent = ui(
        "This account isn't authorized for cloud sync on this deployment. Changes stay saved locally on this device.",
      );
    } else if (result.hadError) {
      status.textContent = ui("Cloud sync hit an error - it will retry automatically.");
    } else if (
      result.reason === "unlinked" ||
      result.reason === "different-account"
    ) {
      status.textContent = ui(
        "Cloud sync is locked until this workspace is attached to the signed-in account.",
      );
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

  function accountDeletionHtml() {
    return `<h2>${ui("Delete cloud account data")}</h2>
      <p>${ui("Permanently deletes every document Firestore holds for this account - every synced section and this device's sync history. A full backup downloads first. This is final; there is no admin-side recovery once it verifies removal.")}</p>
      <div class="data-actions"><button id="accountDeletionBtn" type="button">${ui("Delete cloud account data")}</button></div>
      <p id="accountDeletionStatus" class="data-panel-status"></p>`;
  }

  function updateAccountDeletionPanelVisibility(user) {
    let panel = document.getElementById("accountDeletionPanel");
    if (panel)
      panel.hidden = !user || !window.getWorkspaceSyncAccountAccess?.().allowed;
  }

  function renderAccountDeletionPanel(user) {
    let container = document.getElementById("accountDeletionPanel");
    if (!container) return;
    container.innerHTML = accountDeletionHtml();
    document
      .getElementById("accountDeletionBtn")
      ?.addEventListener("click", runAccountDeletion);
  }

  async function runAccountDeletion() {
    let publicProfileName = (window.state.publicProfileDisplayName || "").trim();
    let warning = publicProfileName
      ? ui(
          "A public profile ({name}) may currently be published. Deleting your cloud account data does NOT take it down - that needs the separate revocation step on the Data page's publish panel. ",
          { name: publicProfileName },
        )
      : "";
    if (
      !window.confirm(
        warning +
          ui(
            "This downloads a full backup, then permanently deletes every document Firestore holds for this account. It cannot be undone. Continue?",
          ),
      )
    )
      return;

    let button = document.getElementById("accountDeletionBtn");
    let status = document.getElementById("accountDeletionStatus");
    button.disabled = true;
    button.textContent = ui("Deleting...");
    let stamp = new Date().toISOString().replace(/[:.]/g, "-");
    window.downloadDataSnapshot?.(`oskars-pre-deletion-backup-${stamp}.json`);

    let result = await window.deleteCloudAccountData?.();
    if (result?.ok) {
      status.textContent = ui(
        "Deleted and verified {count} section(s). Signing out - your local archive is untouched.",
        { count: result.sections.length },
      );
      await window.signOutOfFirebase?.();
    } else {
      let failed = (result?.sections || [])
        .filter((s) => !s.ok)
        .map((s) => s.sectionKey);
      status.textContent = failed.length
        ? ui("Could not verify deletion for: {sections}. Nothing was signed out - try again.", {
            sections: failed.join(", "),
          })
        : ui("Deletion failed. Nothing was signed out - try again.");
      button.disabled = false;
      button.textContent = ui("Delete cloud account data");
    }
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.("profile:render");
    let user = window.getFirebaseCurrentUser?.() || null;
    renderAuthSection(user);
    renderPublicProfileNamePanel(user);
    updateCloudSyncPanelVisibility(user);
    renderAccountDeletionPanel(user);
    updateAccountDeletionPanelVisibility(user);
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
