/**
 * @file Thin wrapper over Firebase Authentication's Google sign-in (issue
 * #255) — the rest of the app calls signOutOfFirebase()/
 * onFirebaseAuthChange()/renderGoogleSignInButton() and never touches the
 * Firebase or Google Identity Services SDKs directly, mirroring how
 * src/domain/image-providers.js wraps TMDB's raw REST shape. Real
 * Firestore reads/writes live in src/core/firestore-sync.js (issue #248),
 * not here; this file exposes only what that module needs to attach to
 * the same signed-in app instance (ensureFirebaseApp(),
 * getFirebaseCurrentUser()) without touching the Firestore SDK itself.
 *
 * Signs in via Google Identity Services' ID-token flow
 * (google.accounts.id — the modern, FedCM-compatible "Sign in with
 * Google" button), exchanged into a Firebase session via
 * GoogleAuthProvider.credential()/signInWithCredential() — NOT
 * signInWithPopup()/signInWithRedirect(). Both of those were tried and
 * confirmed broken for this app's real deployment shape (GitHub Pages,
 * not Firebase Hosting): they depend on a background connection to
 * Firebase's own authDomain that modern Chrome's third-party storage
 * partitioning blocks, a known, acknowledged Firebase SDK limitation for
 * exactly this situation - not a bug in this file. This ID-token approach
 * sidesteps that entirely: Google's own button (rendered client-side, no
 * popup/redirect/iframe handshake) hands back an ID token directly, which
 * is just verified locally by Firebase - see
 * docs/google-signin-firestore-decision.md.
 *
 * Loads both Firebase's pre-built ES modules (Google's own CDN) and
 * Google Identity Services (accounts.google.com/gsi/client) via dynamic
 * import()/script injection from a plain classic script — no bundler, no
 * npm runtime dependency. The GIS script is loaded independently of
 * src/data/google-sheets.js's own loadGoogleIdentity() (same URL, but a
 * separate concern — Sheets' raw token-client flow is for spreadsheet API
 * scope access; this is identity, for Firebase). Not unified, to avoid
 * coupling two different concerns.
 */

// Exposed on window (not a module-private let) so firestore-sync.js
// (issue #248) pins the identical Firestore SDK build without a second,
// possibly drifting, hardcoded version string.
window.OSKARS_FIREBASE_SDK_VERSION = "12.17.1";
let firebaseModulesPromise = null;
let firebaseAppInstance = null;
let firebaseAuthInstance = null;
let googleIdentityScriptPromise = null;
let googleIdentityInitialized = false;
// Distinguishes signOutOfFirebase()'s deliberate sign-out from an
// unexpected one (expired/revoked session) for onFirebaseAuthChange's
// second callback argument (issue #254). A timestamp, not a clear-on-read
// flag: onFirebaseAuthChange() is called independently by several
// subscribers (site-header.js, profile.js, firestore-sync.js), each
// registering its own onAuthStateChanged listener - a flag one subscriber
// clears after reading would leave the others unable to see it.
let deliberateSignOutAt = 0;
const DELIBERATE_SIGN_OUT_WINDOW_MS = 5000;
let firebaseAuthResolutionPromise = null;

function firebaseSdkUrl(name) {
  return `https://www.gstatic.com/firebasejs/${OSKARS_FIREBASE_SDK_VERSION}/firebase-${name}.js`;
}

// showStorageStatus() alone isn't enough to debug a failure with: it's a
// DOM update, not a console message, and gets silently overwritten by
// whatever the app's normal startup status shows moments later - by the
// time anyone looks, it's gone. console.error() persists (especially with
// DevTools' "Preserve log" on across a page reload), so every caught
// error is reported both ways.
function reportFirebaseError(err) {
  console.error("Firebase:", err);
  window.showStorageStatus?.(String(err?.message || err), "error");
}

/**
 * Whether a real Firebase project has been configured for this deployment.
 * @returns {boolean} True when firebase.config.js has loaded window.OSKARS_FIREBASE_CONFIG.
 */
window.oskarsFirebaseConfigured = function () {
  return Boolean(window.OSKARS_FIREBASE_CONFIG);
};

function loadFirebaseModules() {
  if (firebaseModulesPromise) return firebaseModulesPromise;
  firebaseModulesPromise = Promise.all([
    import(firebaseSdkUrl("app")),
    import(firebaseSdkUrl("auth")),
  ]).then(([appModule, authModule]) => ({ appModule, authModule }));
  return firebaseModulesPromise;
}

async function ensureFirebaseAuth() {
  if (!window.oskarsFirebaseConfigured()) return null;
  let { appModule, authModule } = await loadFirebaseModules();
  if (!firebaseAuthInstance) {
    firebaseAppInstance = appModule.initializeApp(window.OSKARS_FIREBASE_CONFIG);
    firebaseAuthInstance = authModule.getAuth(firebaseAppInstance);
  }
  return { authModule, auth: firebaseAuthInstance };
}

/**
 * Returns the shared Firebase app instance, initializing it if needed.
 * Exposed so firestore-sync.js (issue #248) can attach Firestore to the
 * same app sign-in already established, without a second, independent
 * `initializeApp()` call (Firebase rejects re-initializing the default
 * app with the same name).
 * @returns {Promise<{appModule: Object, app: Object}|null>} Null when unconfigured.
 */
window.ensureFirebaseApp = async function () {
  let ready = await ensureFirebaseAuth();
  if (!ready) return null;
  let { appModule } = await loadFirebaseModules();
  return { appModule, app: firebaseAppInstance };
};

/**
 * Returns the currently signed-in Firebase user, synchronously, or null.
 * A thin accessor over the same auth instance onFirebaseAuthChange
 * subscribes to - callers that only need a one-off read (rather than a
 * subscription) don't need to set up their own listener.
 * @returns {Object|null} Current Firebase user, or null when signed out or unconfigured.
 */
window.getFirebaseCurrentUser = function () {
  return firebaseAuthInstance?.currentUser || null;
};

/**
 * Resolves Firebase's initial persisted authentication state once, including
 * explicit configuration, offline, timeout, and initialization failures for
 * the account-required startup gate (issue #332).
 * @param {{timeoutMs?: number}} [options] Initial-state timeout override.
 * @returns {Promise<{status: 'signed-in'|'signed-out'|'unconfigured'|'offline'|'error', user?: Object, error?: string}>}
 */
window.resolveFirebaseAuthState = function (options = {}) {
  if (!window.oskarsFirebaseConfigured())
    return Promise.resolve({ status: "unconfigured" });
  if (firebaseAuthResolutionPromise) return firebaseAuthResolutionPromise;
  let timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : 15000;
  firebaseAuthResolutionPromise = ensureFirebaseAuth()
    .then(
      (ready) =>
        new Promise((resolve) => {
          let settled = false;
          let unsubscribe = () => {};
          let timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            unsubscribe();
            resolve({
              status: window.navigator?.onLine === false ? "offline" : "error",
              error: "Timed out while checking the signed-in account.",
            });
          }, timeoutMs);
          function finish(result) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            unsubscribe();
            resolve(result);
          }
          unsubscribe = ready.authModule.onAuthStateChanged(
            ready.auth,
            (user) =>
              finish(
                user
                  ? { status: "signed-in", user }
                  : {
                      status:
                        window.navigator?.onLine === false
                          ? "offline"
                          : "signed-out",
                    },
              ),
            (err) =>
              finish({
                status:
                  window.navigator?.onLine === false ? "offline" : "error",
                error: String(err?.message || err),
              }),
          );
        }),
    )
    .catch((err) => {
      reportFirebaseError(err);
      return {
        status: window.navigator?.onLine === false ? "offline" : "error",
        error: String(err?.message || err),
      };
    });
  return firebaseAuthResolutionPromise;
};

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleIdentityScriptPromise) return googleIdentityScriptPromise;
  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    let script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error("Could not load Google Identity Services."));
    document.head.appendChild(script);
  });
  return googleIdentityScriptPromise;
}

async function handleGoogleCredential(response) {
  try {
    let ready = await ensureFirebaseAuth();
    if (!ready) return;
    let credential = ready.authModule.GoogleAuthProvider.credential(
      response.credential,
    );
    await ready.authModule.signInWithCredential(ready.auth, credential);
  } catch (err) {
    reportFirebaseError(err);
  }
}

// Requires firebase.config.js's googleWebClientId field — a DIFFERENT
// value from googleClientId in config.local.js (that one's Sheets'
// separate API-scope OAuth client). Find it in the Firebase Console:
// Authentication -> Sign-in method -> Google provider -> "Web SDK
// configuration" -> Web client ID.
async function ensureGoogleIdentityInitialized() {
  if (!window.oskarsFirebaseConfigured()) return false;
  let clientId = window.OSKARS_FIREBASE_CONFIG.googleWebClientId;
  if (!clientId) return false;
  await loadGoogleIdentityScript();
  if (!googleIdentityInitialized) {
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: handleGoogleCredential,
    });
    googleIdentityInitialized = true;
  }
  return true;
}

/**
 * Renders Google's own "Sign in with Google" button into the given
 * container once Google Identity Services is ready. A no-op if
 * unconfigured (nothing renders) or the container doesn't exist, matching
 * every other optional-credential feature in this app.
 * @param {Element} container Empty element to render the button into.
 */
window.renderGoogleSignInButton = async function (container) {
  if (!container) return;
  try {
    let ready = await ensureGoogleIdentityInitialized();
    if (!ready) return;
    container.innerHTML = "";
    window.google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "medium",
      type: "standard",
    });
  } catch (err) {
    reportFirebaseError(err);
  }
};

/**
 * Signs the current user out, if Firebase is configured and initialized.
 * Stamps deliberateSignOutAt first so onFirebaseAuthChange's subscribers
 * can tell this apart from an unexpected sign-out (issue #254).
 */
window.signOutOfFirebase = async function () {
  window.clearOskarsAccountNavigationHandoff?.();
  let ready = await ensureFirebaseAuth();
  if (!ready) return;
  deliberateSignOutAt = Date.now();
  // Account-required deployments hide the hydrated private workspace before
  // the asynchronous Firebase transition begins. If sign-out itself fails,
  // reload to re-resolve the still-valid session instead of leaving a false
  // locked screen in place (issue #335).
  window.hidePrivateWorkspaceForAccountExit?.();
  try {
    await ready.authModule.signOut(ready.auth);
  } catch (err) {
    window.location?.reload?.();
    throw err;
  }
};

/**
 * Subscribes to sign-in state changes. A no-op (never calls back) when
 * Firebase isn't configured, so callers don't need their own guard.
 * @param {(user: Object|null, meta: {deliberate: boolean}) => void} callback Called with the current user (or null when signed out) and whether a null transition was a deliberate signOutOfFirebase() call vs. an unexpected/expired session (issue #254). `deliberate` is meaningless when `user` is non-null.
 * @returns {() => void} Unsubscribe function.
 */
window.onFirebaseAuthChange = function (callback) {
  if (!window.oskarsFirebaseConfigured()) return () => {};
  let unsubscribe = () => {};
  let cancelled = false;
  ensureFirebaseAuth()
    .then((ready) => {
      if (!ready || cancelled) return;
      unsubscribe = ready.authModule.onAuthStateChanged(
        ready.auth,
        (user) =>
          callback(user, {
            deliberate: Boolean(user) || Date.now() - deliberateSignOutAt < DELIBERATE_SIGN_OUT_WINDOW_MS,
          }),
        reportFirebaseError,
      );
    })
    // Without this, a failure here (e.g. the CDN import failing) was a
    // silent unhandled rejection - no console message a typical user
    // would ever see, and no visible sign anything went wrong.
    .catch(reportFirebaseError);
  return () => {
    cancelled = true;
    unsubscribe();
  };
};
