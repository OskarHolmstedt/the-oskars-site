/**
 * @file Owns public-profile tab routing (issue #253). A profile URL works
 * as a per-tab override on top of whatever the deployment's baked runtime
 * mode is — a `local`-mode deployment that normally supports its own
 * editable archive becomes read-only for the duration of an active profile
 * view, exactly like a `viewer`-mode deployment, via the enforcement points
 * in persistence.js/entry-loader.js/bootstrap.js that consult
 * `resolveActiveProfileSlug()`/`state.isPublicProfileView`. Direct profile
 * views, and Community's live comparison/ceremony views, both hydrate/fetch
 * from Supabase in public-profile-supabase.js (issue #483) — this file no
 * longer owns any static-revision fetch path.
 */

window.OSKARS_PROFILE_SLUG_QUERY_PARAM = "profile";
window.OSKARS_PROFILE_ACTIVE_SLUG_KEY = "oskars-active-profile";

/**
 * Resolves the profile slug a viewer-mode session should load: an explicit
 * `?profile=` URL parameter takes priority and is remembered for the tab,
 * so internal navigation to a page without that parameter (film.html,
 * period.html, ...) still resolves the same profile on reload. Falls back
 * to a previously remembered slug when the parameter is absent, and to ""
 * when neither exists — the only shared state this needs is per-tab, not a
 * persisted mutation, so sessionStorage (not localStorage/IndexedDB) is the
 * right store and is exempt from the viewer-mode persistence boundary
 * (issue #256), which only ever governs private canonical/workspace data.
 * @returns {string} Resolved profile slug, or "" when none is active.
 */
window.resolveActiveProfileSlug = function () {
  let fromUrl = "";
  try {
    fromUrl = new URLSearchParams(window.location?.search || "").get(
      window.OSKARS_PROFILE_SLUG_QUERY_PARAM,
    );
  } catch (err) {}
  fromUrl = String(fromUrl || "").trim();
  if (fromUrl) {
    try {
      window.sessionStorage?.setItem(
        window.OSKARS_PROFILE_ACTIVE_SLUG_KEY,
        fromUrl,
      );
    } catch (err) {}
    return fromUrl;
  }
  try {
    return String(
      window.sessionStorage?.getItem(window.OSKARS_PROFILE_ACTIVE_SLUG_KEY) ||
        "",
    ).trim();
  } catch (err) {
    return "";
  }
};

/**
 * Ends the current tab's public-profile view and returns to `index.html`
 * with no `?profile=` parameter, so the deployment's own normal startup
 * (an owner's own archive on an `owner`/`local` deployment, or an empty
 * shell on `viewer`) runs on the next load. A full navigation, not a
 * reload, since the query parameter must actually be dropped from the URL.
 */
window.stopViewingPublicProfile = function () {
  try {
    window.sessionStorage?.removeItem(window.OSKARS_PROFILE_ACTIVE_SLUG_KEY);
  } catch (err) {}
  let base = String(window.location?.href || "").replace(/[^/]*$/, "");
  window.location.href = `${base}index.html`;
};

/**
 * Renders the public-profile exit control independently of account and profile loading.
 * @param {Element} container Header account-status container.
 * @returns {boolean} Whether the active public profile owns the header control.
 */
window.renderPublicProfileExit = function (container) {
  if (!container || !window.resolveActiveProfileSlug()) return false;
  container.innerHTML =
    '<button class="public-profile-exit" type="button" data-public-profile-exit>Exit public mode</button>';
  container
    .querySelector("[data-public-profile-exit]")
    ?.addEventListener("click", () => window.stopViewingPublicProfile());
  return true;
};

/**
 * Shows public-profile attribution or a recoverable load failure independently of private persistence.
 * @param {string} message Public status message.
 * @param {string} status Status kind, including error for load failures.
 * @param {{label: string, run: Function}[]} [actions] Available status actions.
 */
window.showPublicProfileStatus = function (message, status, actions = []) {
  if (!document?.body || !document?.createElement) return;
  let banner = document.getElementById("publicProfileStatus");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "publicProfileStatus";
    banner.className = "public-profile-status";
    let header = document.querySelector(".app-header");
    if (header) header.after(banner);
    else document.body.prepend(banner);
  }
  banner.setAttribute("role", status === "error" ? "alert" : "status");
  banner.textContent = message;
  actions.forEach((action) => {
    let button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", action.run);
    banner.appendChild(button);
  });
};
