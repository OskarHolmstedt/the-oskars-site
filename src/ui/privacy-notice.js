/** @file Renders the plain-language privacy notice modal and content. */

/**
 * Returns the plain-language HTML content of the privacy notice.
 * @returns {string} HTML string describing data collection, processing, and rights.
 */
window.renderPrivacyNoticeContentHtml = function () {
  return `<article class="privacy-notice-content">
  <header>
    <h2>Privacy Notice</h2>
    <p class="privacy-notice-lead">The Oskars is a personal, non-commercial film archive operated by Oskar Holmstedt, who is the data controller for the personal data described below. This notice explains what data is collected, why, how long it is kept, and how you retain full control over it.</p>
  </header>

  <section>
    <h3>What Data Is Collected</h3>
    <ul>
      <li><strong>Google account identity:</strong> When you sign in with Google, Supabase Auth receives your email address, display name, avatar URL, and Google user ID to identify and authenticate your account. This identity data is held by Supabase Auth on the app's behalf; it is not duplicated into the app's own database tables beyond the display name you choose to set.</li>
      <li><strong>Film activity and archive data:</strong> Watched films, watch dates, star ratings, review notes, watchlists, interest tiers, custom collections, and personal award ballots that you record in the app.</li>
    </ul>
  </section>

  <section>
    <h3>Why Your Data Is Processed &amp; Legal Basis</h3>
    <ul>
      <li><strong>To provide the service you asked for (Art. 6(1)(b)):</strong> Your account identity and archive data are processed because they are necessary to authenticate you and operate the personal film archive you use.</li>
      <li><strong>Security and abuse prevention (Art. 6(1)(f)):</strong> Minimal technical logs (e.g. authentication events) may be processed under a legitimate interest in keeping the service secure and reliable.</li>
      <li><strong>Public profile publication (Art. 6(1)(a), consent):</strong> Publishing any part of your archive publicly happens only because you deliberately opt in, and that consent can be withdrawn at any time by unpublishing (see "Your Rights" below).</li>
    </ul>
  </section>

  <section>
    <h3>Privacy by Default &amp; Public Sharing</h3>
    <ul>
      <li><strong>Isolated private storage:</strong> All personal activity is stored in Supabase with PostgreSQL Row-Level Security (RLS). Other users cannot access or view your private records.</li>
      <li><strong>Strictly opt-in public profiles:</strong> Public profile publication on <code>profile.html</code> is completely optional and takes effect immediately through <code>profiles.public_slug</code>. If published, only allowlisted fields (display name, URL slug, ratings, awards, and public list structure) appear in the live profile and Community directory. Private notes, exact review text, watch dates, and unranked watchlists remain hidden. Unpublishing removes it from the live view immediately.</li>
      <li><strong>Separate, manual snapshot mechanism:</strong> The app also has a second, owner-only publication path that can generate a fixed, deployed snapshot file of a profile. As of this notice, that mechanism has never been used and no such snapshot files exist. If it is ever used, revoking it requires a separate manual step from unpublishing the live profile above.</li>
    </ul>
  </section>

  <section>
    <h3>How Long Data Is Kept</h3>
    <ul>
      <li><strong>While your account exists:</strong> Your account identity and archive data are kept for as long as your account exists, with no separate expiry - this is a personal archive you are expected to keep using indefinitely.</li>
      <li><strong>On deletion:</strong> Deleting your account (<code>delete_my_account</code>) removes your Supabase Auth identity and atomically cascades the deletion through every app-owned database row across all archive tables.</li>
      <li><strong>Infrastructure-level retention:</strong> Like any managed hosting provider, Supabase, Cloudflare, and GitHub Pages may retain data briefly in automated operational backups, caches, or logs after deletion, for a limited window outside the app's direct control, before it is fully purged from their infrastructure.</li>
    </ul>
  </section>

  <section>
    <h3>Infrastructure &amp; Processors</h3>
    <p>The app relies on the following infrastructure providers to operate. Each acts as a data processor for the personal data described next to it, except where noted:</p>
    <ul>
      <li><strong>Supabase:</strong> Managed database (PostgreSQL), authentication, and row-level security enforcement - processes your account identity and archive data.</li>
      <li><strong>Google Identity Services:</strong> OAuth authentication provider used to sign you in; Google also acts as an independent controller for its own sign-in service under its own privacy terms.</li>
      <li><strong>Cloudflare Workers:</strong> Reverse proxy relaying movie-metadata requests to TMDB. It receives your browser's connection (e.g. IP address as part of ordinary web traffic) but no film-archive or account data.</li>
      <li><strong>GitHub Pages:</strong> Static hosting for the application's code and assets - serves the app but does not process your Supabase-stored data.</li>
      <li><strong>The Movie Database (TMDB):</strong> Source of public film metadata, posters, and portrait images. TMDB does not receive your personal data - the proxy above only forwards film-lookup queries, never your identity or archive data.</li>
    </ul>
    <p>Supabase, where your account identity and archive data live, is hosted in the EU (AWS <code>eu-west-1</code>, Ireland) - your personal data does not leave the European Economic Area through that processor. Cloudflare's global edge network relays film-metadata requests (no personal data) and may route through infrastructure outside the EEA as an ordinary part of how a global CDN works; Google Identity Services and GitHub Pages may likewise process limited connection-level data (such as your IP address as part of routine web traffic) outside the EEA under their own standard safeguards.</p>
  </section>

  <section>
    <h3>Cookies &amp; Local Storage</h3>
    <p>The app uses only strictly necessary browser storage: Supabase session tokens to keep you signed in, and local preferences for display settings (such as theme, language, and poster backdrop). We do not use advertising, tracking, marketing, or third-party analytics cookies.</p>
  </section>

  <section>
    <h3>Your Rights &amp; Data Control (GDPR)</h3>
    <p>Under GDPR (Articles 15–21), you have the following rights over your personal data:</p>
    <ul>
      <li><strong>Access &amp; portability (Art. 15, 20):</strong> Download a JSON export of your archive data at any time from <code>data.html</code>; a fuller export covering every app-owned table downloads automatically before account deletion. This export covers your film-archive data; your underlying Google account identity fields held by Supabase Auth (email, name, avatar, user ID) are available on request using the contact route below.</li>
      <li><strong>Rectification (Art. 16):</strong> Most fields (display name, ratings, notes, watch dates, and more) can be corrected directly in the app. Anything not editable in-app can be corrected on request.</li>
      <li><strong>Erasure (Art. 17):</strong> Permanently delete your account and all associated personal rows at any time from <code>profile.html</code> using the atomic account deletion control (<code>delete_my_account</code>).</li>
      <li><strong>Withdraw consent to public sharing (Art. 7(3), 21):</strong> Unpublish a public profile at any time from <code>profile.html</code> to withdraw that consent; it stops appearing in the live view and Community directory immediately.</li>
      <li><strong>Restriction &amp; objection (Art. 18, 21):</strong> Because processing your archive data is necessary to provide the service you use, the practical way to restrict or object to that processing is to stop using the app and delete your account, or to unpublish a public profile to stop that specific disclosure.</li>
      <li><strong>Lodge a complaint (Art. 77):</strong> You can complain to your local data protection supervisory authority at any time - in Sweden, that is <a href="https://www.imy.se/" target="_blank" rel="noopener noreferrer">IMY (Integritetsskyddsmyndigheten)</a>.</li>
    </ul>
  </section>

  <section>
    <h3>How To Exercise Your Rights</h3>
    <p>For access, rectification, erasure, or any other personal-data request, or any other question about this notice, contact <a href="mailto:oskarholmstedtsax@gmail.com">oskarholmstedtsax@gmail.com</a>. We aim to respond within one month, extendable by a further two months for complex requests, as GDPR allows.</p>
  </section>

  <section>
    <h3>Data Breaches</h3>
    <p>If a personal data breach affecting your data were to occur, it would be assessed for risk and, where the law requires it, reported to the relevant supervisory authority within 72 hours of the operator becoming aware, with affected users notified directly where the risk to you is high.</p>
  </section>
</article>`;
};

/**
 * Opens the accessible privacy notice modal dialog.
 * @returns {HTMLDialogElement} The dialog element.
 */
window.openPrivacyNoticeModal = function () {
  let existing = document.getElementById("privacyNoticeDialog");
  if (existing) {
    if (!existing.open) existing.showModal();
    return existing;
  }

  let dialog = document.createElement("dialog");
  dialog.id = "privacyNoticeDialog";
  dialog.className = "privacy-notice-dialog";
  dialog.innerHTML = `
    <div class="privacy-notice-modal-body">
      ${window.renderPrivacyNoticeContentHtml()}
      <div class="dialog-actions">
        <button type="button" id="closePrivacyNoticeBtn" class="button-secondary">Close</button>
      </div>
    </div>`;

  document.body.appendChild(dialog);

  let closeBtn = dialog.querySelector("#closePrivacyNoticeBtn");
  closeBtn?.addEventListener("click", () => dialog.close());

  dialog.addEventListener("click", (event) => {
    let rect = dialog.getBoundingClientRect();
    let isInDialog =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width;
    if (!isInDialog) dialog.close();
  });

  dialog.showModal();
  return dialog;
};

/** Sets up global click delegation for privacy notice triggers. */
window.setupPrivacyNoticeDelegation = function () {
  if (window._privacyNoticeDelegationReady) return;
  if (typeof document === "undefined" || !document.addEventListener) return;
  window._privacyNoticeDelegationReady = true;

  document.addEventListener("click", (event) => {
    let trigger = event.target?.closest?.("[data-privacy-notice-trigger]");
    if (!trigger) return;
    event.preventDefault();
    window.openPrivacyNoticeModal();
  });
};

window.setupPrivacyNoticeDelegation();
