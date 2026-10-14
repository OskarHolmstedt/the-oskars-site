/** @file Routes legacy public archive links to the dedicated member profile without changing the viewer's archive context. */

/**
 * Redirects an old public archive URL to its member profile and clears the retired tab override.
 * @returns {boolean} Whether navigation to a member profile started.
 */
window.redirectLegacyPublicProfile = function () {
  let slug = new URLSearchParams(window.location.search || "").get("profile");
  try {
    window.sessionStorage?.removeItem("oskars-active-profile");
  } catch (_) {}
  slug = String(slug || "").trim();
  if (!slug) return false;
  window.location.replace(`user.html?u=${encodeURIComponent(slug)}`);
  return true;
};
