/** @file Coordinates on-demand archive data for explicitly focused pages' shared search, previews and optional backdrop. Page queries remain owned by their controllers. */

(function () {
  let loadDependencies;
  let owner = window.getSupabaseCurrentUser?.()?.id || null;
  let generation = 0;
  let pending = null;
  let readyAt = null;
  let pageReady = false;

  function changedError() {
    let error = new Error("The account or archive changed. Please try again.");
    error.code = "OSKARS_SHELL_CHANGED";
    return error;
  }

  function invalidate(clearIdentity = false) {
    generation += 1;
    pending = null;
    readyAt = null;
    window._oskarsSearchEntriesCache = {};
    if (clearIdentity) {
      window.state = window.createEmptyState();
      window.OSKARS_SUPABASE_HYDRATION_SOURCE = null;
      window.OSKARS_STATE_HYDRATION_COMPLETE = false;
      window.OSKARS_PROJECT_SOURCE_INDEX_BY_ID = {};
      window.OSKARS_PROJECT_SOURCE_INDEX_BY_SOURCE = {};
      window.applySharedFilmArchive?.({});
      window.refreshOskarsBackdrop?.();
    }
    window.dispatchEvent(new CustomEvent("oskars:focused-shell-invalidated"));
  }

  /** Installs the entry loader's once-only shared archive dependency loader. @param {Function} loader Asynchronous dependency loader. */
  window.configureFocusedShell = function (loader) {
    loadDependencies = loader;
  };

  /** Reports whether the shell archive belongs to this account and is within its freshness window. @returns {boolean} Whether interaction data is ready. */
  window.focusedShellDataFresh = function () {
    return Boolean(
      readyAt !== null &&
      owner &&
      owner === (window.getSupabaseCurrentUser?.()?.id || null) &&
      !window.resolveActiveProfileSlug?.() &&
      !window.state?.isPublicProfileView &&
      Date.now() - readyAt < window.OSKARS_HYDRATION_CACHE_TTL_MS,
    );
  };

  /** Loads complete shared-shell data on demand, sharing concurrent requests and rejecting stale account/write results. @returns {Promise<void>} Resolves when existing search and preview builders can run. */
  window.ensureFocusedShellData = function () {
    if (
      window.resolveActiveProfileSlug?.() ||
      window.state?.isPublicProfileView
    )
      return Promise.reject(changedError());
    if (window.focusedShellDataFresh()) return Promise.resolve();
    if (pending) return pending;
    let requestGeneration = generation;
    let requestOwner = owner;
    let isCurrent = () =>
      generation === requestGeneration &&
      requestOwner &&
      requestOwner === (window.getSupabaseCurrentUser?.()?.id || null) &&
      !window.resolveActiveProfileSlug?.() &&
      !window.state?.isPublicProfileView;
    let finish = window.startOskarsPerformance?.("focusedShell:load");
    let request = (async () => {
      let auth = await window.resolveSupabaseAuthState();
      if (
        auth.status !== "signed-in" ||
        auth.user.id !== requestOwner ||
        !isCurrent()
      )
        throw changedError();
      await loadDependencies();
      if (!isCurrent()) throw changedError();
      // Fresh on each deferred load: do not extend a session-cache timestamp
      // into another freshness window. Repeated interactions reuse this model.
      await window.ensureOskarsData({ isCurrent, forceRefresh: true });
      if (!isCurrent()) throw changedError();
      readyAt = Date.now();
      window.dispatchEvent(new CustomEvent("oskars:focused-shell-ready"));
      if (document.documentElement.dataset.posterBackdrop === "on")
        window.refreshOskarsBackdrop?.();
    })().finally(() => {
      if (pending === request) pending = null;
      finish?.();
    });
    pending = request;
    return request;
  };

  /** Restores an explicitly enabled poster backdrop after focused page content is ready. @returns {Promise<void>} Resolves after the optional backdrop attempt. */
  window.refreshFocusedShellBackdrop = async function () {
    pageReady = true;
    let status = document.querySelector("[data-focused-backdrop-status]");
    if (status) status.hidden = true;
    if (document.documentElement.dataset.posterBackdrop !== "on") return;
    try {
      await window.ensureFocusedShellData();
    } catch (_) {
      if (status && document.documentElement.dataset.posterBackdrop === "on")
        status.hidden = false;
    }
  };

  window.onSupabaseAuthChange?.((user) => {
    let nextOwner = user?.id || null;
    if (owner === nextOwner) return;
    owner = nextOwner;
    invalidate(true);
  });
  window.addEventListener("oskars:hydration-invalidated", () => invalidate());
  window.addEventListener("focus", () => {
    if (readyAt !== null && !window.focusedShellDataFresh()) invalidate();
    if (pageReady && readyAt === null) window.refreshFocusedShellBackdrop();
  });
})();
