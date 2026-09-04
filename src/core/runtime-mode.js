/**
 * @file Defines the explicit owner/local/viewer deployment-mode contract
 * (issue #245) that gates startup snapshot fetching, publication
 * reconciliation, and the owner-mutation pages below the UI layer. Also
 * derives the finer-grained viewer capabilities (issue #256) that the
 * persistence and entry-loader boundaries enforce so a viewer session can
 * never mutate or persist owner state, regardless of how a page reaches
 * those code paths.
 */

window.OSKARS_RUNTIME_MODES = ["owner", "local", "viewer"];

/**
 * Resolves and validates a raw runtime-mode configuration value. Absent
 * configuration defaults to "owner", preserving this repository's existing
 * single-deployment behavior; any other value must be one of the known
 * modes or is rejected so deployment intent is never silently guessed.
 * @param {*} raw Raw `window.OSKARS_RUNTIME_MODE` configuration value.
 * @returns {{mode: string, valid: boolean, error: string}} Resolved mode.
 */
window.resolveRuntimeMode = function (raw) {
  if (raw === undefined) return { mode: "owner", valid: true, error: "" };
  if (typeof raw === "string" && window.OSKARS_RUNTIME_MODES.includes(raw))
    return { mode: raw, valid: true, error: "" };
  return {
    mode: "owner",
    valid: false,
    error:
      `Invalid runtime mode configuration: ${JSON.stringify(raw)}. ` +
      `Expected one of ${window.OSKARS_RUNTIME_MODES.join(", ")}.`,
  };
};

/**
 * Whether a deployment requires an authenticated account before opening an
 * editable workspace. Every `local` deployment requires an account - Google
 * sign-in is mandatory for all use of this app, with no anonymous/offline
 * option (a prior `OSKARS_ACCESS_POLICY` axis allowed opting out of this;
 * removed). Viewer sessions have no editable workspace, while the owner
 * checkout retains its established repository-backed workflow.
 * @param {string} mode Resolved runtime mode.
 * @returns {boolean} True only for local deployments.
 */
window.runtimeAccountAccessRequired = function (mode) {
  return mode === "local";
};

/**
 * Derives startup and mutation capabilities from a validated runtime mode.
 * In the current three-mode model several capabilities collapse to the same
 * boolean, but each is named for the one thing it gates so a future mode
 * (or #243's accounts work) can separate them without renaming call sites.
 * @param {string} mode One of window.OSKARS_RUNTIME_MODES.
 * @returns {{fetchPublishedSnapshot: boolean, allowOwnerPages: boolean, canEdit: boolean, canImport: boolean, canPublish: boolean, canPersistPrivateState: boolean}}
 *   fetchPublishedSnapshot gates the owner-snapshot fetch/reconciliation
 *   startup path. allowOwnerPages gates loading data/intake and other
 *   owner-only mutation-workflow pages at all, below the page-
 *   controller layer. canEdit gates using any in-page mutation control.
 *   canImport gates replacing or merging in imported/recovered data.
 *   canPublish gates the owner-only public-profile publish workflow — only a
 *   true owner deployment has access to its repository-backed public output.
 *   canPersistPrivateState gates every write to IndexedDB/localStorage that
 *   still goes through `src/core/persistence.js`'s save()/
 *   replaceStoredState()/saveRecoveryWorkspace() - the remaining
 *   local-archive write path. It has no bearing on Supabase-cutover
 *   routes, which write straight to Postgres instead (or, for entries
 *   that skip legacy data load entirely, treat window.save() as a hard
 *   error) and hold no browser-stored app data this capability could gate.
 */
window.runtimeModeCapabilities = function (mode) {
  let isOwner = mode === "owner";
  let isViewer = mode === "viewer";
  return {
    fetchPublishedSnapshot: isOwner,
    allowOwnerPages: !isViewer,
    canEdit: !isViewer,
    canImport: !isViewer,
    canPublish: isOwner,
    canPersistPrivateState: !isViewer,
  };
};

/**
 * Reads, resolves, and caches the active runtime mode from global
 * configuration. Falls back to resolving fresh (defaulting to "owner")
 * when called before entry-loader.js has populated the cache, e.g. in
 * tests that exercise bootstrap.js directly.
 * @returns {string} The resolved mode.
 */
window.getRuntimeMode = function () {
  return (
    window.OSKARS_RESOLVED_RUNTIME_MODE ||
    window.resolveRuntimeMode(window.OSKARS_RUNTIME_MODE).mode
  );
};

/**
 * Reads the active runtime mode's capabilities in one call — folding in an
 * active public-profile view (issue #253) as a per-tab override to the same
 * "viewer" capability set, regardless of the deployment's baked mode. A
 * `local`-mode deployment (the only real one, `the-oskars-site`) otherwise
 * reports full owner-equivalent `canEdit`/`canImport`/`canPublish` even
 * while a visitor is viewing someone else's published profile - the
 * persistence layer's own separate `isPublicProfileView` check
 * (`persistence.js`'s `persistenceAllowed()`) already stops any of that
 * from actually writing anything, but every page-controller call site that
 * decides whether to *render* a mutation control from this function's
 * output was seeing stale, baked-mode-only capabilities, showing fully
 * interactive edit UI to anonymous profile visitors that would silently
 * no-op on save. Folding the override in here, once, fixes every current
 * and future `oskarsCapabilities()` call site instead of requiring each
 * page to separately remember to check `state.isPublicProfileView` too.
 * @returns {{fetchPublishedSnapshot: boolean, allowOwnerPages: boolean, canEdit: boolean, canImport: boolean, canPublish: boolean, canPersistPrivateState: boolean}}
 *   See runtimeModeCapabilities() for what each capability gates.
 */
window.oskarsCapabilities = function () {
  if (window.state?.isPublicProfileView)
    return window.runtimeModeCapabilities("viewer");
  return window.runtimeModeCapabilities(window.getRuntimeMode());
};
