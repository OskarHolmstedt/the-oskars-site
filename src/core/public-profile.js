/**
 * @file Fetches and hydrates a published public profile by stable slug URL
 * (issue #253). Works as a per-tab override on top of whatever the
 * deployment's baked runtime mode is — a `local`-mode deployment that
 * normally supports its own editable archive still becomes read-only for
 * the duration of an active profile view, exactly like a `viewer`-mode
 * deployment, via the enforcement points in persistence.js/entry-loader.js/
 * bootstrap.js that consult `resolveActiveProfileSlug()`/
 * `state.isPublicProfileView`. This file only ever consumes already-
 * published static JSON, never writes any of it.
 */

window.OSKARS_PROFILE_MANIFEST_SCHEMA_VERSION = 1;
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
      window.sessionStorage?.getItem(
        window.OSKARS_PROFILE_ACTIVE_SLUG_KEY,
      ) || "",
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

function validateProfileManifestShape(manifest, slug) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    return "manifest is not a JSON object";
  if (manifest.profileManifestSchemaVersion !== window.OSKARS_PROFILE_MANIFEST_SCHEMA_VERSION)
    return `manifest.profileManifestSchemaVersion must be ${window.OSKARS_PROFILE_MANIFEST_SCHEMA_VERSION}`;
  if (typeof manifest.slug !== "string" || manifest.slug !== slug)
    return "manifest.slug does not match the requested profile";
  if (typeof manifest.activeRevision !== "string" || !manifest.activeRevision)
    return "manifest.activeRevision is missing";
  if (typeof manifest.ownerName !== "string" || !manifest.ownerName)
    return "manifest.ownerName is missing";
  return "";
}

/**
 * Fetches and validates a public profile's small active-revision manifest.
 * @param {string} slug Profile slug.
 * @returns {Promise<{ok: boolean, manifest?: Object, error?: string, detail?: string}>}
 */
window.fetchPublicProfileManifest = async function (slug) {
  let path = `./profiles/${encodeURIComponent(slug)}/manifest.json`;
  let response;
  try {
    let doneFetch = window.startOskarsPerformance?.(`profile:fetchManifest ${slug}`);
    response = await fetch(path, { cache: "no-store" });
    doneFetch?.();
  } catch (err) {
    return { ok: false, error: "unavailable", detail: String(err?.message || err) };
  }
  if (!response.ok)
    return { ok: false, error: "not-found", detail: `HTTP ${response.status}` };
  let manifest;
  try {
    manifest = await response.json();
  } catch (err) {
    return { ok: false, error: "invalid", detail: String(err?.message || err) };
  }
  let shapeError = validateProfileManifestShape(manifest, slug);
  if (shapeError) return { ok: false, error: "invalid", detail: shapeError };
  return { ok: true, manifest };
};

/**
 * Fetches one immutable public-profile revision document. Structural/schema
 * validation (`assertPublicData`) happens in `hydratePublicProfileState()`,
 * not here — this only reports fetch/parse failure.
 * @param {string} slug Profile slug.
 * @param {string} revisionId Revision id from the profile's manifest.
 * @returns {Promise<{ok: boolean, data?: Object, error?: string, detail?: string}>}
 */
window.fetchPublicProfileRevision = async function (slug, revisionId) {
  let path = `./profiles/${encodeURIComponent(slug)}/${encodeURIComponent(revisionId)}.json`;
  let response;
  try {
    let doneFetch = window.startOskarsPerformance?.(`profile:fetchRevision ${slug}`);
    response = await fetch(path, { cache: "no-store" });
    doneFetch?.();
  } catch (err) {
    return { ok: false, error: "unavailable", detail: String(err?.message || err) };
  }
  if (!response.ok)
    return { ok: false, error: "unavailable", detail: `HTTP ${response.status}` };
  try {
    return { ok: true, data: await response.json() };
  } catch (err) {
    return { ok: false, error: "invalid", detail: String(err?.message || err) };
  }
};

/**
 * Loads a public profile end to end: fetches its manifest, fetches the
 * manifest's active revision, validates it, and hydrates it into browsable
 * state. Every failure path is a recoverable, reported error rather than a
 * thrown exception or a silently empty archive — readers either get one
 * complete valid revision or a clear reason they didn't (issue #253).
 * @param {string} slug Profile slug to load.
 * @returns {Promise<{ok: boolean, meta?: Object, error?: string, detail?: string}>}
 */
window.loadPublicProfile = async function (slug) {
  if (typeof fetch !== "function")
    return { ok: false, error: "offline" };
  let manifestResult = await window.fetchPublicProfileManifest(slug);
  if (!manifestResult.ok) return manifestResult;
  let revisionResult = await window.fetchPublicProfileRevision(
    slug,
    manifestResult.manifest.activeRevision,
  );
  if (!revisionResult.ok) return revisionResult;
  try {
    window.hydratePublicProfileState(revisionResult.data, {
      slug,
      ownerName: manifestResult.manifest.ownerName,
      revision: manifestResult.manifest.activeRevision,
      publishedAt: manifestResult.manifest.publishedAt,
    });
  } catch (err) {
    return { ok: false, error: "invalid", detail: String(err?.message || err) };
  }
  return { ok: true, meta: window.state.publicProfileMeta };
};
