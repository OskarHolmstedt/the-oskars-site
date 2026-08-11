/**
 * @file Pure first-run onboarding decision logic (issue #252): whether a
 * local-mode session with no persisted workspace should see the
 * empty/sample/import choice screen instead of the normal dashboard.
 */

/**
 * Decides whether the first-run onboarding choice screen should show.
 * Only fires for `local` mode (owner mode always has its own snapshot;
 * viewer mode has no editor/data pages to onboard into, see #245) and only
 * for a session that has genuinely never persisted anything —
 * `source === "none"` excludes `invalid-localStorage`/`invalid-browser-state`,
 * which report `found: false` for corrupted prior data, not a fresh browser,
 * and should surface as a recovery condition instead of a welcome screen.
 * @param {Object} input
 * @param {string} input.runtimeMode Resolved runtime mode.
 * @param {{found: boolean, source: string}} input.persistenceLoadInfo Startup load result.
 * @returns {boolean} Whether to render onboarding instead of the dashboard.
 */
window.shouldShowOnboarding = function ({ runtimeMode, persistenceLoadInfo }) {
  if (runtimeMode !== "local") return false;
  let info = persistenceLoadInfo || {};
  return info.found !== true && info.source === "none";
};
