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
 * Also never fires during an active public-profile view (issue #253):
 * ensureOskarsData() returns before ever touching local persistence when a
 * profile hydrates, so persistenceLoadInfo still reads as a fresh, never-
 * persisted session even though state is fully populated with someone
 * else's published archive — without this guard, every visitor to a
 * published profile URL on a fresh browser would see the empty-archive
 * choice screen instead of the profile they came to view.
 * @param {Object} input
 * @param {string} input.runtimeMode Resolved runtime mode.
 * @param {{found: boolean, source: string}} input.persistenceLoadInfo Startup load result.
 * @param {boolean} [input.isPublicProfileView] Whether an active public-profile view is hydrated.
 * @returns {boolean} Whether to render onboarding instead of the dashboard.
 */
window.shouldShowOnboarding = function ({
  runtimeMode,
  persistenceLoadInfo,
  isPublicProfileView,
}) {
  if (isPublicProfileView) return false;
  if (runtimeMode !== "local") return false;
  let info = persistenceLoadInfo || {};
  return info.found !== true && info.source === "none";
};
