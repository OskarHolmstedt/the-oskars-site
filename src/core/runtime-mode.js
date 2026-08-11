/**
 * @file Defines the explicit owner/local/viewer deployment-mode contract
 * (issue #245) that gates startup snapshot fetching, publication
 * reconciliation, and the owner-mutation pages below the UI layer.
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
 * Derives startup and mutation capabilities from a validated runtime mode.
 * @param {string} mode One of window.OSKARS_RUNTIME_MODES.
 * @returns {{fetchPublishedSnapshot: boolean, allowOwnerPages: boolean}}
 *   fetchPublishedSnapshot gates the owner-snapshot fetch/reconciliation
 *   startup path; allowOwnerPages gates loading the editor/data owner-
 *   mutation pages at all, below the page-controller layer.
 */
window.runtimeModeCapabilities = function (mode) {
  return {
    fetchPublishedSnapshot: mode === "owner",
    allowOwnerPages: mode !== "viewer",
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
