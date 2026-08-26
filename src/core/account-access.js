/**
 * @file Owns the account-required Shared Edition startup boundary (issue
 * #332, #335, #339, #340, #346, and #355): pure access/account-lineage planning,
 * the one-time browser/account attachment marker, bounded same-tab
 * navigation handoffs, safe account switching, and pre-hydration
 * signed-out/gate surfaces.
 * Published public-profile URLs remain anonymous and bypass this boundary.
 */

window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY = "oskars-account-workspace-uid-v1";
window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_KEY =
  "oskars-account-navigation-handoff-v1";
window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_MS = 10000;
let trustedNavigationUid = "";
let trustedNavigationTarget = "";
let accountNavigationListenerInstalled = false;
let activeAccountNavigationUid = "";
const SIGNED_OUT_POSTERS = [
  {
    title: "Portrait of a Lady on Fire",
    url: "https://image.tmdb.org/t/p/w500/rUDuOKpkKBHxx41BScqKej72iT3.jpg",
  },
  {
    title: "Apocalypse Now",
    url: "https://image.tmdb.org/t/p/w500/gQB8Y5RCMkv2zwzFHbUJX3kAhvA.jpg",
  },
  {
    title: "Dune",
    url: "https://image.tmdb.org/t/p/w500/4kJmUCE7mkVJjXa7A0g2rY4IGTm.jpg",
  },
  {
    title: "Little Women",
    url: "https://image.tmdb.org/t/p/w500/1ZzH1XMcKAe5NdrKL5MfcqZHHsZ.jpg",
  },
  {
    title: "Seven Samurai",
    url: "https://image.tmdb.org/t/p/w500/lOMGc8bnSwQhS4XyE1S99uH8NXf.jpg",
  },
];

/**
 * Plans access to an editable browser workspace without reading or hydrating
 * that workspace. Called only when this deployment's mode requires an
 * account (`runtimeAccountAccessRequired()`) - Google sign-in is mandatory
 * for every `local` deployment, with no anonymous/offline option.
 * @param {Object} input
 * @param {string} [input.publicProfileSlug] Active anonymous public profile.
 * @param {boolean} [input.configured] Whether Firebase is configured.
 * @param {string} [input.authStatus] Resolved Firebase auth status.
 * @param {Object} [input.user] Signed-in Firebase user.
 * @param {string} [input.boundUid] UID previously attached to this browser.
 * @param {string} [input.error] Auth initialization failure detail.
 * @returns {{allowed: boolean, status: string, user?: Object, boundUid?: string, error?: string}}
 */
window.planOskarsAccountAccess = function (input) {
  if (input.publicProfileSlug)
    return { allowed: true, status: "public-profile" };
  if (!input.configured)
    return { allowed: false, status: "unconfigured" };
  if (input.authStatus !== "signed-in" || !input.user?.uid)
    return {
      allowed: false,
      status: input.authStatus || "signed-out",
      ...(input.error ? { error: input.error } : {}),
    };
  let boundUid = String(input.boundUid || "");
  if (!boundUid)
    return { allowed: false, status: "unlinked", user: input.user };
  if (boundUid !== input.user.uid)
    return {
      allowed: false,
      status: "different-account",
      user: input.user,
      boundUid,
    };
  return { allowed: true, status: "account", user: input.user, boundUid };
};

function accountAccessRequired() {
  return window.runtimeAccountAccessRequired?.(window.getRuntimeMode?.());
}

function readBoundAccountUid() {
  try {
    return String(
      window.localStorage?.getItem(window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY) ||
        "",
    );
  } catch (err) {
    return "";
  }
}

function currentNavigationTarget() {
  return `${String(window.location?.pathname || "")}${String(
    window.location?.search || "",
  )}`;
}

/**
 * Validates a one-use navigation handoff without reading browser storage.
 * @param {Object} input
 * @param {Object|null} input.handoff Parsed handoff record.
 * @param {string} input.boundUid UID attached to this browser workspace.
 * @param {string} input.currentTarget Current path and query string.
 * @param {number} input.now Current Unix time in milliseconds.
 * @returns {{allowed: boolean, status: string, uid?: string}}
 */
window.planOskarsAccountNavigationHandoff = function (input) {
  let handoff = input?.handoff;
  if (!handoff || typeof handoff !== "object")
    return { allowed: false, status: "missing" };
  let uid = String(handoff.uid || "");
  let target = String(handoff.target || "");
  let boundUid = String(input.boundUid || "");
  let currentTarget = String(input.currentTarget || "");
  let issuedAt = Number(handoff.issuedAt);
  let expiresAt = Number(handoff.expiresAt);
  let now = Number(input.now);
  if (
    !uid ||
    !target ||
    !boundUid ||
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(now) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_MS ||
    issuedAt > now + 1000
  )
    return { allowed: false, status: "malformed" };
  if (expiresAt <= now) return { allowed: false, status: "expired" };
  if (uid !== boundUid)
    return { allowed: false, status: "different-account" };
  if (target !== currentTarget)
    return { allowed: false, status: "different-destination" };
  return { allowed: true, status: "trusted-navigation", uid };
};

/** Clears any not-yet-consumed same-tab account navigation handoff. */
window.clearOskarsAccountNavigationHandoff = function () {
  try {
    window.sessionStorage?.removeItem(
      window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_KEY,
    );
  } catch (err) {}
};

/**
 * Consumes and validates the same-tab handoff for the current document.
 * The storage record is removed before parsing so malformed or mismatched
 * values can never be retried.
 * @returns {string} Trusted Firebase UID, or an empty string.
 */
window.consumeOskarsAccountNavigationHandoff = function () {
  let raw = "";
  try {
    raw = String(
      window.sessionStorage?.getItem(
        window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_KEY,
      ) || "",
    );
  } catch (err) {}
  window.clearOskarsAccountNavigationHandoff();
  if (!raw) return "";
  let handoff = null;
  try {
    handoff = JSON.parse(raw);
  } catch (err) {
    return "";
  }
  let plan = window.planOskarsAccountNavigationHandoff({
    handoff,
    boundUid: readBoundAccountUid(),
    currentTarget: currentNavigationTarget(),
    now: Date.now(),
  });
  if (!plan.allowed) return "";
  trustedNavigationUid = plan.uid;
  trustedNavigationTarget = currentNavigationTarget();
  return plan.uid;
};

/**
 * Plans whether background Firebase state still validates a trusted document.
 * @param {Object} input
 * @param {string} input.expectedUid UID that authorized the document.
 * @param {string} input.authStatus Firebase resolution status.
 * @param {string} [input.userUid] Resolved Firebase UID.
 * @returns {boolean} Whether private content may remain visible.
 */
window.oskarsAccountRevalidationMatches = function (input) {
  return Boolean(
    input?.expectedUid &&
      input.authStatus === "signed-in" &&
      input.userUid === input.expectedUid,
  );
};

function rememberAccountNavigation(uid, target) {
  let issuedAt = Date.now();
  try {
    window.sessionStorage?.setItem(
      window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_KEY,
      JSON.stringify({
        uid,
        target,
        issuedAt,
        expiresAt:
          issuedAt + window.OSKARS_ACCOUNT_NAVIGATION_HANDOFF_MS,
      }),
    );
  } catch (err) {}
}

/**
 * Continues from a Firebase-confirmed sign-in without making the next document
 * repeat a blocking authentication check.
 * @param {Object} user Firebase user confirmed by the auth-state listener.
 * @param {Element} host Account-gate host to update for blocked account states.
 */
window.continueOskarsAccountSignIn = function (user, host) {
  let access = window.planOskarsAccountAccess({
    configured: Boolean(window.oskarsFirebaseConfigured?.()),
    authStatus: "signed-in",
    user,
    boundUid: readBoundAccountUid(),
  });
  if (access.allowed) {
    // The auth listener has verified this exact UID in the current document.
    // Reuse #339's one-use, UID-bound handoff for the same-page reload; the
    // normal session monitor still revalidates Firebase in the background.
    rememberAccountNavigation(user.uid, currentNavigationTarget());
    window.location?.reload?.();
    return;
  }
  window.renderOskarsAccountGate(access, host);
};

function rememberVerifiedNavigationDestination(destination, expectedUid) {
  if (
    !destination ||
    destination.origin !== window.location?.origin ||
    !["http:", "https:"].includes(destination.protocol)
  )
    return;
  let target = `${String(destination.pathname || "")}${String(
    destination.search || "",
  )}`;
  if (
    !target ||
    target === currentNavigationTarget() ||
    new URLSearchParams(destination.search || "").has("profile")
  )
    return;
  let realUid = String(window.getFirebaseCurrentUser?.()?.uid || "");
  if (realUid !== expectedUid || readBoundAccountUid() !== expectedUid) {
    window.clearOskarsAccountNavigationHandoff();
    return;
  }
  rememberAccountNavigation(expectedUid, target);
}

/**
 * Prepares a programmatic same-tab destination for fast account navigation.
 * The original value is always returned so callers can assign it to
 * `location.href` even when it is external, malformed, or ineligible.
 * @param {string} destination Destination URL or relative reference.
 * @returns {string} The unchanged destination.
 */
window.prepareOskarsAccountNavigation = function (destination) {
  let value = String(destination || "");
  try {
    rememberVerifiedNavigationDestination(
      new URL(value, window.location?.href),
      activeAccountNavigationUid,
    );
  } catch (err) {}
  window.markSameOriginNavigation?.(destination);
  return destination;
};

function installAccountNavigationHandoff(expectedUid) {
  if (accountNavigationListenerInstalled || !expectedUid) return;
  accountNavigationListenerInstalled = true;
  activeAccountNavigationUid = expectedUid;
  window.addEventListener?.(
    "click",
    (event) => {
      if (
        event.defaultPrevented ||
        (event.button !== undefined && event.button !== 0) ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      let anchor = event.target?.closest?.("a[href]");
      if (
        !anchor ||
        anchor.hasAttribute?.("download") ||
        (anchor.target && anchor.target.toLowerCase() !== "_self")
      )
        return;
      rememberVerifiedNavigationDestination(anchor, expectedUid);
    },
    false,
  );
}

/** Returns the UID explicitly attached to this browser. @returns {string} */
window.getOskarsBrowserAccountUid = readBoundAccountUid;

/**
 * Detaches the active browser workspace from its previously attached account.
 * @returns {boolean} Whether the attachment marker was removed.
 */
window.detachOskarsBrowserWorkspace = function () {
  window.clearOskarsAccountNavigationHandoff();
  try {
    window.localStorage?.removeItem(window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY);
    return true;
  } catch (err) {
    return false;
  }
};

/** Whether the active deployment requires an account for private state. @returns {boolean} */
window.oskarsRequiredAccountSession = accountAccessRequired;

/**
 * Plans whether Firestore bookkeeping may be used by the current account.
 * Legacy unbound metadata can be claimed only when #332's browser marker
 * proves that the user already made an explicit attachment decision.
 * @param {Object} input
 * @param {string} [input.currentUid] Current Firebase UID.
 * @param {string} [input.browserUid] Explicit browser attachment UID.
 * @param {string} [input.syncUid] UID stored with remote-sync metadata.
 * @returns {{allowed: boolean, status: string, uid?: string, claim?: boolean}}
 */
window.planOskarsWorkspaceAccount = function (input = {}) {
  let currentUid = String(input.currentUid || "");
  let browserUid = String(input.browserUid || "");
  let syncUid = String(input.syncUid || "");
  if (!currentUid) return { allowed: false, status: "signed-out" };
  if (browserUid && browserUid !== currentUid)
    return {
      allowed: false,
      status: "different-account",
      uid: browserUid,
    };
  if (syncUid === currentUid)
    return { allowed: true, status: "bound", uid: currentUid };
  if (syncUid)
    return { allowed: false, status: "different-account", uid: syncUid };
  if (browserUid === currentUid)
    return {
      allowed: true,
      status: "legacy-attached",
      uid: currentUid,
      claim: true,
    };
  return { allowed: false, status: "unlinked" };
};

/**
 * Checks whether a recovery record belongs to the active account lineage.
 * Unbound legacy recovery is accepted only for a browser already explicitly
 * attached to the current account, or outside any signed-in account context.
 * @param {Object} input
 * @param {string} [input.currentUid] Current Firebase UID.
 * @param {string} [input.browserUid] Explicit browser attachment UID.
 * @param {string} [input.recoveryUid] UID stored on the recovery record.
 * @returns {boolean} Whether the recovery may be exposed and restored.
 */
window.oskarsAccountCanAccessRecovery = function (input = {}) {
  let currentUid = String(input.currentUid || "");
  let browserUid = String(input.browserUid || "");
  let recoveryUid = String(input.recoveryUid || "");
  if (currentUid && browserUid && browserUid !== currentUid) return false;
  if (recoveryUid) return Boolean(currentUid) && recoveryUid === currentUid;
  if (!currentUid) return true;
  return browserUid === currentUid;
};

/**
 * Resolves account access without loading private persistence. Only called
 * when this deployment's mode requires an account
 * (`runtimeAccountAccessRequired()`) - entry-loader.js's own caller already
 * checks that first.
 * @param {{publicProfileSlug?: string}} [options] Active public-profile entry.
 * @returns {Promise<{allowed: boolean, status: string, user?: Object, boundUid?: string, error?: string}>}
 */
window.resolveOskarsAccountAccess = async function (options = {}) {
  if (options.publicProfileSlug) {
    window.clearOskarsAccountNavigationHandoff();
    return window.planOskarsAccountAccess({
      publicProfileSlug: options.publicProfileSlug,
    });
  }
  let configured = Boolean(window.oskarsFirebaseConfigured?.());
  if (!configured) return window.planOskarsAccountAccess({ configured });
  let currentTarget = currentNavigationTarget();
  let handoffUid =
    trustedNavigationUid && trustedNavigationTarget === currentTarget
      ? trustedNavigationUid
      : window.consumeOskarsAccountNavigationHandoff();
  if (handoffUid) {
    // Start the authoritative SDK check immediately without putting the next
    // document back behind the visible gate. The session monitor below owns
    // fail-closed handling for signed-out, mismatched, offline, and error
    // results; Firestore still reads only getFirebaseCurrentUser().
    window.resolveFirebaseAuthState?.();
    return {
      allowed: true,
      status: "trusted-navigation",
      user: { uid: handoffUid },
      boundUid: handoffUid,
    };
  }
  let auth = await window.resolveFirebaseAuthState?.();
  return window.planOskarsAccountAccess({
    configured,
    authStatus: auth?.status,
    user: auth?.user,
    error: auth?.error,
    boundUid: readBoundAccountUid(),
  });
};

function accountName(user) {
  return String(user?.displayName || user?.email || "this Google account");
}

function escapeGateText(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function welcomeHeroHtml({ eyebrow, heading, description }) {
  let posters = SIGNED_OUT_POSTERS.map(
    (poster, index) =>
      `<span class="account-welcome-poster" style="--welcome-offset:${(index - 2) * 63}px;--welcome-mobile-offset:${(index - 2) * 44}px;--welcome-rotate:${(index - 2) * 5}deg" title="${escapeGateText(poster.title)}"><img src="${poster.url}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer"></span>`,
  ).join("");
  return `<section class="account-welcome-hero" aria-labelledby="accountWelcomeTitle">
      <div class="account-welcome-copy">
        <span class="eyebrow">${eyebrow}</span>
        <h1 id="accountWelcomeTitle">${heading}</h1>
        <p>${description}</p>
      </div>
      <div class="account-welcome-visual">
        <div class="account-welcome-poster-deck" aria-hidden="true">${posters}</div>
        <p class="account-welcome-attribution">Poster images from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
    </section>`;
}

function welcomeSignInHtml() {
  return `<section class="account-welcome-signin" aria-labelledby="accountWelcomeSignIn">
      <div><span class="eyebrow">Private by design</span><h2 id="accountWelcomeSignIn">Bring your archive with you</h2><p>Sign in to open your private workspace and keep it synchronized with your account.</p></div>
      <div class="account-welcome-signin-action"><div data-account-google-signin></div><p>No browser archive is loaded or uploaded until sign-in succeeds and you explicitly connect this browser.</p></div>
    </section>`;
}

function signedOutHomeContent() {
  return `<div class="account-welcome">
    ${welcomeHeroHtml({
      eyebrow: "Your personal film world",
      heading: "A home for the films you watch, rank, and remember.",
      description:
        "The Oskars turns a lifetime of watching into a living archive—your ratings, your awards, your watchlists, and the journeys still ahead.",
    })}
    <section class="account-welcome-features" aria-label="What The Oskars can do">
      <article><span aria-hidden="true">✦</span><h2>Keep your film life together</h2><p>Collect watched films, ratings, notes, people, franchises, and every detail you want to remember.</p></article>
      <article><span aria-hidden="true">★</span><h2>Build your own canon</h2><p>Rank films across years and eras, create personal award ballots, and see the taste that emerges.</p></article>
      <article><span aria-hidden="true">→</span><h2>Know what comes next</h2><p>Shape watchlists into focused projects, follow your progress, and always have a meaningful next film.</p></article>
    </section>
    ${welcomeSignInHtml()}
  </div>`;
}

function isSignedOutHome(access, host) {
  return Boolean(
    access?.status === "signed-out" &&
      host?.classList?.contains?.("home-shell"),
  );
}

// Signed-out previews for the six primary-nav destinations besides Home
// (issue #346): a scaled-down version of home's hero (no features strip)
// per page, replacing the generic gate on exactly these six so a visitor
// sees what that specific page offers instead of an undifferentiated
// sign-in prompt. Every other page (editor, data, intake, ...) keeps the
// plain gate - reachability from the primary nav is what draws the line.
const SIGNED_OUT_TEASERS = {
  periods: {
    eyebrow: "Every era, mapped",
    heading: "Decades of awards, laid out year by year.",
    description:
      "Walk the full period matrix—every year, decade, and century—and open any of them onto its own awards, rankings, and film history.",
  },
  categories: {
    eyebrow: "Category by category",
    heading: "Every award category, its full history.",
    description:
      "Browse every category that shapes your personal Oskars and jump straight into any year's nominees, winners, and how your picks compare to the official record.",
  },
  franchises: {
    eyebrow: "Series, sagas, and sequels",
    heading: "Every franchise, tracked start to finish.",
    description:
      "See what you've watched, what's left, and how a whole series ranks against itself—from trilogies to decades-spanning sagas.",
  },
  watchlist: {
    eyebrow: "What's next",
    heading: "Your queue, ranked and ready.",
    description:
      "Hold everything you plan to watch with real interest tiers, then turn a filtered slice of it straight into your next watch project.",
  },
  watched: {
    eyebrow: "Everything you've seen",
    heading: "Every film you've watched, ranked and remembered.",
    description:
      "Your complete watched history in one place—ratings, rewatches, and the running average of the taste you've built over time.",
  },
  projects: {
    eyebrow: "Guided journeys",
    heading: "Turn a watchlist into a real plan.",
    description:
      "Queue up a director's filmography, a franchise, or a custom set as a workflow-ordered project, and follow your progress through it.",
  },
};

/**
 * Resolves which of the six primary-nav destinations (if any) the current
 * page is, for picking a signed-out teaser. Watchlist and Watched share
 * one entry (`period.html`) and are told apart only by the exact query
 * string the header links to; any other `period.html` visit (a specific
 * year, `view=official`, ...) deliberately falls through to the generic
 * gate rather than guessing at a teaser.
 * @returns {string} A `SIGNED_OUT_TEASERS` key, or `""` if none applies.
 */
function signedOutTeaserKey() {
  let entry = String(window.OSKARS_ENTRY || "");
  if (Object.prototype.hasOwnProperty.call(SIGNED_OUT_TEASERS, entry))
    return entry;
  if (entry === "period") {
    let params = new URLSearchParams(window.location?.search || "");
    if (params.get("type") === "alltime" && params.get("view") === "watchlist")
      return "watchlist";
    if (params.get("type") === "alltime" && params.get("view") === "films")
      return "watched";
  }
  return "";
}

function signedOutTeaserContent(teaser) {
  return `<div class="account-welcome">${welcomeHeroHtml(teaser)}${welcomeSignInHtml()}</div>`;
}

function gateContent(access) {
  // This boundary renders before page-utils.js, so it must not rely on the
  // later pageEscape() helper for account-supplied display names/errors.
  let escape = window.pageEscape || escapeGateText;
  let name = escape(accountName(access.user));
  if (access.status === "loading")
    return `<h1>Checking your account</h1><p>Please wait while The Oskars verifies this browser's signed-in session.</p><p class="account-gate-status" role="status">Connecting…</p>`;
  if (access.status === "locking")
    return `<h1>Private archive locked</h1><p>Your signed-in session is ending. This browser's saved archive is no longer visible and remains attached to its account.</p><p class="account-gate-status" role="status">Signing out…</p>`;
  if (access.status === "unlinked")
    return `<h1>Connect this browser</h1><p>You are signed in as <strong>${name}</strong>. This browser may already contain an Oskars archive from before sign-in became required.</p><p>Nothing has been loaded or uploaded yet. Continue only if this browser's archive should belong to this account; otherwise sign out and the existing browser data will remain untouched.</p><div class="account-gate-actions"><button type="button" class="button-link" data-account-attach>Use this browser with ${name}</button><button type="button" data-account-sign-out>Sign out</button></div>`;
  if (access.status === "different-account")
    return `<h1>This browser belongs to another account</h1><p>The saved workspace on this browser is attached to a different Google account. It will not be opened, uploaded, restored, or replaced while signed in as <strong>${name}</strong>.</p><p>Sign back into the owning account and use Account → Switch accounts safely. That flow downloads a backup and removes the old archive from the active browser before detaching it.</p><div class="account-gate-actions"><button type="button" data-account-sign-out>Sign out</button></div>`;
  if (access.status === "unconfigured")
    return `<h1>Account sign-in is unavailable</h1><p>This deployment requires an account, but Firebase has not been configured. No browser workspace has been loaded.</p><div class="account-gate-actions"><button type="button" data-account-retry>Retry</button></div>`;
  if (access.status === "offline")
    return `<h1>Connect to verify your account</h1><p>The Oskars could not verify a signed-in session while offline. Your browser archive remains untouched.</p><div class="account-gate-actions"><button type="button" data-account-retry>Retry</button></div>`;
  if (access.status === "error")
    return `<h1>Could not verify your account</h1><p>${escape(access.error || "Account verification failed. Your browser archive remains untouched.")}</p><div class="account-gate-actions"><button type="button" data-account-retry>Retry</button></div>`;
  return `<h1>Sign in to The Oskars</h1><p>Your private archive is stored in this browser and synchronized to your account. Published profile links remain viewable without signing in.</p><p>No browser archive is loaded or uploaded until sign-in succeeds and you explicitly connect this browser.</p><div data-account-google-signin></div>`;
}

/**
 * Renders the account gate, replacing page content before private state loads.
 * @param {{allowed?: boolean, status: string, user?: Object, error?: string}} access Access result.
 * @param {Element} [container] Optional test/host container.
 */
window.renderOskarsAccountGate = function (access, container) {
  window.OSKARS_ACCOUNT_ACCESS_BLOCKED = true;
  let header = document.querySelector?.(".app-header");
  let host =
    container || document.querySelector?.("main") || document.body;
  if (!host) return;
  let signedOutHome = isSignedOutHome(access, host);
  // A teaser only applies on the same terms as home's own welcome - a
  // reachable, informative surface for a plain signed-out visitor, not
  // for any of the actionable states below (unlinked, different-account,
  // ...) that still need the generic gate's specific instructions.
  let teaserKey =
    !signedOutHome && access?.status === "signed-out"
      ? signedOutTeaserKey()
      : "";
  let signedOutLanding = signedOutHome || Boolean(teaserKey);
  if (signedOutLanding) {
    header?.removeAttribute?.("data-site-header-pending");
    header?.setAttribute?.("data-account-landing", "");
  } else {
    header?.removeAttribute?.("data-account-landing");
    header?.setAttribute?.("data-site-header-pending", "");
  }
  host.innerHTML = signedOutHome
    ? signedOutHomeContent()
    : teaserKey
      ? signedOutTeaserContent(SIGNED_OUT_TEASERS[teaserKey])
      : `<div class="account-gate">${gateContent(access)}</div>`;
  let attach = host.querySelector?.("[data-account-attach]");
  attach?.addEventListener("click", () => {
    try {
      window.localStorage?.setItem(
        window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY,
        access.user.uid,
      );
    } catch (err) {
      window.renderOskarsAccountGate(
        {
          status: "error",
          error: "This browser could not retain the account attachment. Nothing was loaded or uploaded.",
        },
        host,
      );
      return;
    }
    window.location?.reload?.();
  });
  host
    .querySelector?.("[data-account-sign-out]")
    ?.addEventListener("click", async () => {
      await window.signOutOfFirebase?.();
      window.location?.reload?.();
    });
  host
    .querySelector?.("[data-account-retry]")
    ?.addEventListener("click", () => window.location?.reload?.());
  let signIn = host.querySelector?.("[data-account-google-signin]");
  if (signIn) window.renderGoogleSignInButton?.(signIn);
  if (access.status === "signed-out") {
    window.onFirebaseAuthChange?.((user) => {
      if (user) window.continueOskarsAccountSignIn(user, host);
    });
  }
};

/** Whether startup stopped at the account boundary. @returns {boolean} */
window.oskarsAccountAccessBlocked = function () {
  return Boolean(window.OSKARS_ACCOUNT_ACCESS_BLOCKED);
};

/**
 * Replaces already-rendered private content before a required account session
 * is signed out. The persisted workspace is deliberately untouched.
 */
window.hidePrivateWorkspaceForAccountExit = function () {
  window.clearOskarsAccountNavigationHandoff();
  if (!accountAccessRequired()) return;
  window.renderOskarsAccountGate({ status: "locking" });
};

/**
 * Explicitly attaches the currently loaded workspace to the signed-in account,
 * for a browser that reached the profile page already unlinked (the same
 * attachment the pre-persistence gate offers via its own "Use this browser
 * with..." action).
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
window.attachOskarsWorkspaceToCurrentAccount = async function () {
  let currentUid = String(window.getFirebaseCurrentUser?.()?.uid || "");
  let previousRemoteSync = window.state?.draftMetadata?.remoteSync;
  let syncUid = String(previousRemoteSync?.uid || "");
  if (!currentUid) return { ok: false, reason: "signed-out" };
  if (syncUid && syncUid !== currentUid)
    return { ok: false, reason: "different-account" };
  try {
    window.localStorage?.setItem(
      window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY,
      currentUid,
    );
  } catch (err) {
    return { ok: false, reason: "attach-failed" };
  }
  window.state.draftMetadata = {
    ...(window.state.draftMetadata || {}),
    remoteSync: {
      ...(window.state.draftMetadata?.remoteSync || {}),
      uid: currentUid,
      shards: window.state.draftMetadata?.remoteSync?.shards || {},
      conflicts: window.state.draftMetadata?.remoteSync?.conflicts || [],
    },
  };
  let saved = window.save?.({
    immediate: true,
    rebuild: false,
    scheduleSync: false,
  });
  if (saved?.then) saved = await saved;
  if (!saved) {
    if (previousRemoteSync)
      window.state.draftMetadata.remoteSync = previousRemoteSync;
    else delete window.state.draftMetadata.remoteSync;
    try {
      window.localStorage?.removeItem(
        window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY,
      );
    } catch (err) {}
    return { ok: false, reason: "save-failed" };
  }
  let sync = await window.runWorkspaceSync?.({ reason: "manual" });
  return { ok: true, ...(sync ? { sync } : {}) };
};

/**
 * Prepares this browser for another account while the owning account is still
 * active: downloads a backup, retains an account-bound recovery, replaces the
 * active workspace with an unsynced empty state, and removes the attachment.
 * The caller signs out only after this succeeds.
 * @returns {Promise<{ok: boolean, reason?: string, fromUid?: string}>}
 */
window.prepareOskarsAccountSwitch = async function () {
  if (!accountAccessRequired())
    return { ok: false, reason: "account-not-required" };
  let currentUid = String(window.getFirebaseCurrentUser?.()?.uid || "");
  let browserUid = readBoundAccountUid();
  let syncUid = String(window.state?.draftMetadata?.remoteSync?.uid || "");
  if (!currentUid) return { ok: false, reason: "signed-out" };
  if (browserUid !== currentUid || (syncUid && syncUid !== currentUid))
    return { ok: false, reason: "different-account" };

  if (typeof window.downloadDataSnapshot !== "function")
    return { ok: false, reason: "backup-unavailable" };
  let stamp = new Date().toISOString().replace(/[:.]/g, "-");
  window.downloadDataSnapshot(`oskars-before-account-switch-${stamp}.json`);
  let snapshot = window.getBrowserPersistenceState?.();
  if (!snapshot) return { ok: false, reason: "snapshot-unavailable" };
  let retained = await window.saveRecoveryWorkspace?.(snapshot, {
    reason: "account-switch",
    accountUid: currentUid,
  });
  if (!retained) return { ok: false, reason: "recovery-failed" };

  let cleared = window.createClearedLocalState
    ? window.createClearedLocalState()
    : window.createEmptyState?.();
  if (!cleared) return { ok: false, reason: "clear-unavailable" };
  let canonical = window.getCanonicalData?.(cleared, { clone: false });
  let baseRevision = canonical
    ? window.canonicalDataRevision?.(canonical) || ""
    : "";
  cleared.draftMetadata = {
    baseRevision,
    dirty: false,
    lastLocalSaveAt: new Date().toISOString(),
    reason: "account-switch-cleared",
  };
  let replaced = await window.replaceStoredState?.(cleared, {
    message: "Browser ready for another account",
    fallbackMessage: "Browser ready for another account using fallback storage",
    scheduleSync: false,
  });
  if (!replaced) return { ok: false, reason: "clear-failed" };
  try {
    window.localStorage?.removeItem(window.OSKARS_ACCOUNT_WORKSPACE_UID_KEY);
  } catch (err) {
    return { ok: false, reason: "detach-failed" };
  }
  return { ok: true, fromUid: currentUid };
};

/**
 * Hides a hydrated private workspace immediately if its required session ends.
 * The reload then returns to the signed-out gate without touching IndexedDB.
 */
window.monitorRequiredAccountSession = function (expectedUid) {
  if (!accountAccessRequired()) return;
  let initialUid = String(
    expectedUid || window.getFirebaseCurrentUser?.()?.uid || "",
  );
  installAccountNavigationHandoff(initialUid);
  let locked = false;
  function lockAndReload() {
    if (locked) return;
    locked = true;
    window.clearOskarsAccountNavigationHandoff();
    window.renderOskarsAccountGate({ status: "locking" });
    window.location?.reload?.();
  }
  let verification = window.resolveFirebaseAuthState?.();
  verification?.then((auth) => {
    if (
      !window.oskarsAccountRevalidationMatches({
        expectedUid: initialUid,
        authStatus: auth?.status,
        userUid: auth?.user?.uid,
      })
    )
      lockAndReload();
  });
  window.onFirebaseAuthChange?.((user) => {
    if (user?.uid === initialUid) return;
    lockAndReload();
  });
};
