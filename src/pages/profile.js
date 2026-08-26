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
      return `<h2>${ui("Sign in")}</h2><p>${ui("Signed in as {name}.", { name: escape(user.displayName || user.email || ui("your Google account")) })}</p>${required ? `<p>${ui("Signing out downloads a backup, then clears this browser's private archive. Sign back into the same account to sync it again.")}</p>` : ""}${lineageAction}<div class="data-actions"><button id="profileSignOutBtn" type="button">${ui(required ? "Sign out and clear" : "Sign out")}</button>${required ? `<button id="profileSwitchAccountBtn" type="button">${ui("Switch accounts safely")}</button>` : ""}</div><p id="profileAccountStatus" class="data-panel-status"></p>`;
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
          !required ||
          window.confirm(
            ui(
              "Sign out and clear this browser's private archive? A backup downloads first. Sign back into the same account to sync it again from the cloud.",
            ),
          )
        ) {
          if (await (window.confirmSignOutWithPendingSync?.() ?? true)) {
            // Only the mandatory-account (Shared Edition) session ties local
            // IndexedDB state to sign-in at all - a plain, optional sign-in
            // (e.g. owner mode's Google Sheets import) has no private
            // workspace to clear, so this mirrors data.js's "Remove archive
            // from this browser" sequence only in that case.
            if (required) {
              let stamp = new Date().toISOString().replace(/[:.]/g, "-");
              window.downloadDataSnapshot?.(
                `oskars-data-backup-before-sign-out-${stamp}.json`,
              );
              await window.clearStoredOskarsData({ scheduleSync: false });
              window.detachOskarsBrowserWorkspace?.();
            }
            await window.signOutOfFirebase?.();
          }
        }
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
            `<div class="cloud-sync-conflict-item"><div class="cloud-sync-conflict-row"><span>${escape(conflict.sectionKey)} / ${escape(conflict.shardKey)}</span><button type="button" data-preview data-section="${escape(conflict.sectionKey)}" data-shard="${escape(conflict.shardKey)}">${ui("Preview changes")}</button><button type="button" data-resolve="keep-local" data-section="${escape(conflict.sectionKey)}" data-shard="${escape(conflict.shardKey)}">${ui("Keep this device's version")}</button><button type="button" data-resolve="keep-remote" data-section="${escape(conflict.sectionKey)}" data-shard="${escape(conflict.shardKey)}">${ui("Use the other device's version")}</button></div><div class="cloud-sync-conflict-preview" hidden></div></div>`,
        )
        .join("");
  }

  // Bounded record list rendering shared by the added/removed/changed
  // groups: first 5 entries visible, the rest behind a native <details> (no
  // new JS state needed), plus a plain overflow note if the diff itself
  // already truncated beyond its own cap (issue #334 - "bounded... allow
  // expansion when detail is needed", not a raw per-record dump).
  function conflictPreviewGroupHtml(label, group) {
    if (!group || !group.total) return "";
    let visible = group.entries.slice(0, 5);
    let rest = group.entries.slice(5);
    let restHtml = rest.length
      ? `<details><summary>${ui("+{count} more", { count: rest.length })}</summary><ul>${rest.map((entry) => `<li>${escape(entry.label)}</li>`).join("")}</ul></details>`
      : "";
    let truncatedHtml =
      group.total > group.entries.length
        ? `<p class="cloud-sync-conflict-preview-truncated">${ui("(+{count} more not shown)", { count: group.total - group.entries.length })}</p>`
        : "";
    return `<div class="cloud-sync-conflict-preview-group"><h4>${escape(label)}</h4><ul>${visible.map((entry) => `<li>${escape(entry.label)}</li>`).join("")}</ul>${restHtml}${truncatedHtml}</div>`;
  }

  function renderConflictPreview(container, diff) {
    if (diff.kind === "opaque") {
      container.innerHTML = `<p>${ui("This section's content differs between devices. Individual changes can't be previewed for this data type.")}</p>`;
      return;
    }
    if (!diff.changed) {
      container.innerHTML = `<p>${ui("No content differences found.")}</p>`;
      return;
    }
    let groups =
      conflictPreviewGroupHtml(
        ui("The other device's version would add"),
        { entries: diff.added, total: diff.addedTotal },
      ) +
      conflictPreviewGroupHtml(
        ui("Using the other device's version would discard"),
        { entries: diff.removed, total: diff.removedTotal },
      ) +
      conflictPreviewGroupHtml(
        ui("The other device's version would change"),
        { entries: diff.changedRecords, total: diff.changedTotal },
      );
    container.innerHTML =
      groups ||
      `<p>${ui("Content differs, but no individual record changes were found (a field outside per-record tracking may differ).")}</p>`;
  }

  async function handleConflictPreviewClick(button) {
    let section = button.dataset.section;
    let shard = button.dataset.shard;
    let container = button
      .closest(".cloud-sync-conflict-item")
      ?.querySelector(".cloud-sync-conflict-preview");
    if (!container) return;
    button.disabled = true;
    container.hidden = false;
    container.innerHTML = `<p>${ui("Loading preview...")}</p>`;
    let result = await window.previewWorkspaceSyncConflict?.(section, shard);
    button.disabled = false;
    if (!result?.ok) {
      container.innerHTML = `<p>${ui("Could not load preview. Try again.")}</p>`;
      return;
    }
    renderConflictPreview(container, result.diff);
  }

  async function restoreSyncConflictRecovery(status) {
    if (
      typeof window.confirm === "function" &&
      !window.confirm(
        ui("Restore the version saved before this conflict was resolved? It replaces this browser's current archive. Download a backup first if you may want to return to the current version."),
      )
    )
      return;
    let restored = await window.restoreRecoveryWorkspace?.();
    if (restored && typeof window.location?.reload === "function") {
      window.location.reload();
      return;
    }
    if (status)
      status.textContent = restored
        ? ui("Restored.")
        : ui("Nothing to restore.");
  }

  async function handleConflictResolveClick(event) {
    let preview = event.target.closest("[data-preview]");
    if (preview) {
      await handleConflictPreviewClick(preview);
      return;
    }
    let button = event.target.closest("[data-resolve]");
    if (!button) return;
    if (
      button.dataset.resolve === "keep-remote" &&
      typeof window.confirm === "function" &&
      !window.confirm(
        ui("Use the other device's version? This device's current version will be retained for recovery."),
      )
    )
      return;
    button.disabled = true;
    let result = await window.resolveWorkspaceSyncConflict?.(
      button.dataset.section,
      button.dataset.shard,
      button.dataset.resolve,
    );
    renderConflicts();
    if (result?.ok && button.dataset.resolve === "keep-remote") {
      let status = document.getElementById("cloudSyncStatus");
      if (status && (await window.readRecoveryWorkspace?.())) {
        let restoreLink = document.createElement("button");
        restoreLink.type = "button";
        restoreLink.textContent = ui("Restore previous");
        restoreLink.addEventListener("click", () =>
          restoreSyncConflictRecovery(status),
        );
        status.textContent = "";
        status.append(`${ui("Resolved.")} `, restoreLink);
      }
    }
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
        status.innerHTML = `${ui("The cloud version could not be loaded. Check your connection and sign-in, then try again.")}${window.renderTechnicalDetails?.({ text: fetched?.error || "unknown error" }) || ""}`;
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
        "The cloud version is ready to review below. Nothing has changed yet; use the reviewed version when it looks right.",
      );
    } catch (err) {
      status.innerHTML = `${ui("The cloud version could not be reviewed. Try loading it again.")}${window.renderTechnicalDetails?.({ text: err.message || String(err) }) || ""}`;
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
    button.textContent = ui("Cloud version restored");
    window.hideImportReport?.();
  }

  function accountDeletionHtml() {
    return `<span class="eyebrow">${ui("Cloud storage")}</span><h2>${ui("Delete synced cloud copy")}</h2>
      <p>${ui("Deletes the private sync copy stored online, then signs this browser out. The archive in this browser, your Google login, and any published profile stay. Signing in again from a browser that still has the archive can upload it again. A full backup downloads first.")}</p>
      <div class="data-actions"><button id="accountDeletionBtn" type="button" class="danger-button">${ui("Delete synced cloud copy")}</button></div>
      <p id="accountDeletionStatus" class="data-panel-status" role="status"></p>`;
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
          "A public profile ({name}) may still be published. This does not take it down. ",
          { name: publicProfileName },
        )
      : "";
    if (
      !window.confirm(
        warning +
          ui(
            "Delete the synced cloud copy? A backup downloads first. The archive in this browser stays, and you will be signed out. Any browser with a retained archive can upload it again.",
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
        "Deleted the synced cloud copy and verified {count} part(s). Signing out now. This browser's archive was not changed.",
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
      button.textContent = ui("Delete synced cloud copy");
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
