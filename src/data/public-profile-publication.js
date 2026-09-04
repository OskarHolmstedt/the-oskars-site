/**
 * @file Data-page preview/publish/revoke UI for the public-profile publish
 * pipeline (issue #253). This is owner-only technical Data-page tooling, not
 * the app's general reader-facing UI: the browser can preview the exact
 * public projection (window.publicProjectionPreview, already built for
 * #246 but never wired to a UI until now) and stage a candidate
 * data/public-profile-config.json for download, but never publishes
 * anything itself — no browser-embedded GitHub credential exists to do
 * that with (docs/public-profile-publish-pipeline-decision.md). The owner replaces
 * the file, commits, pushes, and runs the publish-profiles GitHub Action.
 * Supports exactly one configured profile at a time via this UI (matching
 * this app's single-owner scale); data/public-profile-config.json's schema
 * technically allows more, editable by hand if that's ever needed.
 *
 * The slug and display name are not typed here: both come from the Account
 * page's single public-profile display name setting
 * (window.state.publicProfileDisplayName), slugified via
 * window.publicProfileSlugify. A separately-typed slug field would drift
 * from the name it is supposed to label; deriving it keeps exactly one
 * source of truth, at the cost of the slug changing if the name is ever
 * renamed after a real publish (acceptable at this app's single-owner,
 * revoke-and-republish scale).
 */

let preparedPublicProfilePreview = null;
let preparedPublicProfileOptIn = [];

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
  let ownerName = (window.state.publicProfileDisplayName || "").trim();
  let slug = window.publicProfileSlugify?.(ownerName) || "";
  if (!ownerName) {
    container.innerHTML = `<h2>Publish a public profile</h2><p class="data-panel-status">Set a public profile name on the <a href="profile.html">Profile page</a> first — it becomes both the display name and the URL slug.</p>`;
    return;
  }
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
      <h3>What will be shared</h3><ul>${sections}</ul>
      ${findings ? `<h3>Findings</h3><ul>${findings}</ul>` : "<p>This projection is valid.</p>"}
    </div>`;
  }
  let downloadDisabled = preparedPublicProfilePreview && !preparedPublicProfilePreview.valid;
  container.innerHTML = `<h2>Publish a public profile</h2>
    <p>Create a read-only public version of selected archive information. Reviewing and downloading here never publishes anything.</p>
    <p>Publishing as <strong>${publicProfileEscape(ownerName)}</strong>. Change the name on the <a href="profile.html">Profile page</a>.</p>
    <label><input type="checkbox" data-public-profile-opt-in="localRanks" ${preparedPublicProfileOptIn.includes("localRanks") ? "checked" : ""}> Include local ranks (opt-in)</label>
    <div class="data-actions">
      <button type="button" data-public-profile-preview>Review public profile</button>
      <button type="button" data-public-profile-download ${downloadDisabled ? "disabled" : ""}>Download publishing file</button>
      <button type="button" data-public-profile-revoke>Prepare to unpublish</button>
    </div>
    <details class="technical-details"><summary>Technical details</summary><p>The public URL slug is <code>${publicProfileEscape(slug)}</code>. The downloaded candidate replaces <code>data/public-profile-config.json</code>. Review and commit that diff, push it, then run the <code>publish-profiles</code> GitHub Action with the input <code>deploy</code>.</p></details>
    ${previewHtml}`;
};

/** Handles public-profile publication controls in the Data workspace. */
window.handlePublicProfilePublicationAction = function (event) {
  let container = event.currentTarget;
  let ownerName = (window.state.publicProfileDisplayName || "").trim();
  let slug = window.publicProfileSlugify?.(ownerName) || "";
  let optIn = container.querySelector('[data-public-profile-opt-in="localRanks"]')?.checked
    ? ["localRanks"]
    : [];
  preparedPublicProfileOptIn = optIn;
  if (event.target.closest("[data-public-profile-preview]")) {
    preparedPublicProfilePreview = window.planPublicProfilePublication(slug, ownerName, optIn);
  } else if (event.target.closest("[data-public-profile-download]")) {
    window.downloadPublicProfileConfig(slug, ownerName, optIn);
  } else if (event.target.closest("[data-public-profile-revoke]")) {
    if (
      typeof window.confirm === "function" &&
      !window.confirm(
        "Prepare to unpublish every public profile? Nothing changes online until the publishing workflow runs. The existing published files remain in repository history and can be published again.",
      )
    )
      return;
    window.downloadPublicProfileConfig("", "", []);
    return;
  } else return;
  window.renderPublicProfilePublication(container);
};
