/**
 * @file Data-page preview/publish/revoke UI for the public-profile publish
 * pipeline (issue #253). Mirrors src/data/publication.js's shape and
 * download-then-manually-commit pattern — including that file's lack of
 * i18n wrapping, since this is owner-only technical Data-page tooling, not
 * the app's general reader-facing UI: the browser can preview the exact
 * public projection (window.publicProjectionPreview, already built for
 * #246 but never wired to a UI until now) and stage a candidate
 * data/public-profile-config.json for download, but never publishes
 * anything itself — no browser-embedded GitHub credential exists to do
 * that with (docs/canonical-publication-decision.md). The owner replaces
 * the file, commits, pushes, and runs the publish-profiles GitHub Action.
 * Supports exactly one configured profile at a time via this UI (matching
 * this app's single-owner scale); data/public-profile-config.json's schema
 * technically allows more, editable by hand if that's ever needed.
 */

let preparedPublicProfilePreview = null;

function publicProfileEscape(value) {
  return window.pageEscape?.(String(value ?? "")) || String(value ?? "");
}

function publicProfileConfigCandidate(slug, ownerName, optIn) {
  return {
    publicProfileConfigSchemaVersion: 1,
    profiles: slug ? [{ slug, ownerName, optIn: [...optIn] }] : [],
  };
}

function downloadJson(filename, data) {
  let blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: "application/json",
  });
  let url = URL.createObjectURL(blob);
  let link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Builds a public-profile publication preview from the current form inputs. */
window.planPublicProfilePublication = function (slug, ownerName, optIn) {
  let canonical = window.getCanonicalData(window.state, { clone: false });
  let preview = window.publicProjectionPreview(canonical, { optIn });
  return { slug, ownerName, optIn, ...preview };
};

/** Downloads a public-profile-config.json candidate for the given profile (or revocation if slug is empty). */
window.downloadPublicProfileConfig = function (slug, ownerName, optIn) {
  downloadJson(
    "public-profile-config.json",
    publicProfileConfigCandidate(slug, ownerName, optIn),
  );
};

/** Renders the public-profile publish/preview/revoke panel. */
window.renderPublicProfilePublication = function (container) {
  if (!container) return;
  let canPublish = window.oskarsCapabilities?.().canPublish;
  if (!canPublish) {
    container.innerHTML = `<h2>Publish a public profile</h2><p class="data-panel-status">Publishing a public profile requires the owner deployment.</p>`;
    return;
  }
  let form = preparedPublicProfilePreview || {
    slug: "",
    ownerName: "",
    optIn: [],
  };
  let previewHtml = "";
  if (preparedPublicProfilePreview) {
    let sections = preparedPublicProfilePreview.sections
      .map(
        (entry) =>
          `<li><strong>${publicProfileEscape(entry.section)}</strong> (${publicProfileEscape(entry.disclosure)}): ${entry.includedRecordCount} / ${entry.totalRecordCount} record(s)</li>`,
      )
      .join("");
    let findings = preparedPublicProfilePreview.errors
      .map(
        (entry) =>
          `<li><code>${publicProfileEscape(entry.path)}</code> ${publicProfileEscape(entry.message)}</li>`,
      )
      .join("");
    previewHtml = `<div class="publication-preview">
      <h3>Sections</h3><ul>${sections}</ul>
      ${findings ? `<h3>Findings</h3><ul>${findings}</ul>` : "<p>This projection is valid.</p>"}
    </div>`;
  }
  let downloadDisabled = !form.slug || (preparedPublicProfilePreview && !preparedPublicProfilePreview.valid);
  container.innerHTML = `<h2>Publish a public profile</h2>
    <p>Create a read-only public projection of your archive at a stable share URL. This never publishes anything itself — it stages a candidate data/public-profile-config.json for you to commit, then a GitHub Action does the actual publish.</p>
    <label>Profile slug<input type="text" data-public-profile-slug value="${publicProfileEscape(form.slug)}" placeholder="oskar"></label>
    <label>Owner display name<input type="text" data-public-profile-owner-name value="${publicProfileEscape(form.ownerName)}" placeholder="Oskar"></label>
    <label><input type="checkbox" data-public-profile-opt-in="localRanks" ${form.optIn.includes("localRanks") ? "checked" : ""}> Include local ranks (opt-in)</label>
    <div class="data-actions">
      <button type="button" data-public-profile-preview>Preview publication</button>
      <button type="button" data-public-profile-download ${downloadDisabled ? "disabled" : ""}>Download config candidate</button>
      <button type="button" data-public-profile-revoke>Prepare revocation</button>
    </div>
    <ol>
      <li>Replace data/public-profile-config.json with the downloaded file.</li>
      <li>Review the diff and commit, then push.</li>
      <li>Run the publish-profiles GitHub Action (Actions tab → publish-profiles → Run workflow, typing &ldquo;deploy&rdquo;).</li>
    </ol>
    ${previewHtml}`;
};

/** Handles public-profile publication controls in the Data workspace. */
window.handlePublicProfilePublicationAction = function (event) {
  let container = event.currentTarget;
  let slug = container.querySelector("[data-public-profile-slug]")?.value.trim() || "";
  let ownerName = container.querySelector("[data-public-profile-owner-name]")?.value.trim() || "";
  let optIn = container.querySelector('[data-public-profile-opt-in="localRanks"]')?.checked
    ? ["localRanks"]
    : [];
  if (event.target.closest("[data-public-profile-preview]")) {
    preparedPublicProfilePreview = window.planPublicProfilePublication(slug, ownerName, optIn);
  } else if (event.target.closest("[data-public-profile-download]")) {
    window.downloadPublicProfileConfig(slug, ownerName, optIn);
  } else if (event.target.closest("[data-public-profile-revoke]")) {
    if (
      typeof window.confirm === "function" &&
      !window.confirm(
        "This stages an empty config that unpublishes every public profile on the next publish-profiles run. Continue?",
      )
    )
      return;
    window.downloadPublicProfileConfig("", "", []);
    return;
  } else return;
  window.renderPublicProfilePublication(container);
};
