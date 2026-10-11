/** @file Renders the shared save-status indicator that Supabase writes and client errors report through. */

(function () {
  let storageStatusDismissTimer = null;

  /**
   * Shows a transient save-status message.
   * @param {string} message Status text.
   * @param {'saved'|'error'} [status] Status kind; `saved` dismisses itself.
   */
  function storageStatus(message, status) {
    if (!document?.querySelector || !document?.createElement || !document.body)
      return;
    let indicator = document.querySelector("#storageStatus");
    if (!indicator) {
      indicator = document.createElement("div");
      indicator.id = "storageStatus";
      indicator.className = "storage-status";
      indicator.setAttribute("role", "status");
      indicator.setAttribute("aria-live", "polite");
      document.body.appendChild(indicator);
    }
    if (storageStatusDismissTimer) {
      clearTimeout(storageStatusDismissTimer);
      storageStatusDismissTimer = null;
    }
    indicator.hidden = false;
    indicator.className = `storage-status ${status || ""}`.trim();
    indicator.textContent = message;
    if (status === "saved") {
      storageStatusDismissTimer = setTimeout(() => {
        indicator.hidden = true;
        storageStatusDismissTimer = null;
      }, 2800);
    }
  }

  window.showStorageStatus = storageStatus;
})();
