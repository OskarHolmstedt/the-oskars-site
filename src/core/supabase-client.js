/**
 * @file Owns Supabase Authentication's Google sign-in flow and the shared
 * Supabase client used by the static application.
 *
 * Google Identity Services supplies an ID token, which Supabase exchanges
 * for a session with signInWithIdToken(). A fresh nonce is used for each
 * rendered sign-in control. The module is loaded dynamically so pages that
 * do not need authentication do not load the client SDK.
 */

window.OSKARS_SUPABASE_SDK_VERSION = "2.112.4";
let supabaseModulePromise = null;
let supabaseClientInstance = null;
let googleIdentityScriptPromise = null;
let currentRawGoogleNonce = null;
let deliberateSignOutAt = 0;
const DELIBERATE_SIGN_OUT_WINDOW_MS = 5000;
let supabaseAuthResolutionPromise = null;

function supabaseSdkUrl() {
  return `https://esm.sh/@supabase/supabase-js@${OSKARS_SUPABASE_SDK_VERSION}`;
}

function reportSupabaseError(err) {
  console.error("Supabase:", err);
  window.showStorageStatus?.(String(err?.message || err), "error");
}

/**
 * Whether a real Supabase project has been configured for this
 * deployment.
 * @returns {boolean} True when supabase.config.js has loaded window.OSKARS_SUPABASE_CONFIG.
 */
window.oskarsSupabaseConfigured = function () {
  return Boolean(
    window.OSKARS_SUPABASE_CONFIG?.url &&
    window.OSKARS_SUPABASE_CONFIG?.anonKey,
  );
};

function loadSupabaseModule() {
  if (supabaseModulePromise) return supabaseModulePromise;
  supabaseModulePromise = import(supabaseSdkUrl());
  return supabaseModulePromise;
}

/**
 * Returns the shared Supabase client instance, initializing it if
 * needed. A single client per page is sufficient because Supabase's client
 * already manages its session
 * storage/refresh internally, so there's no reason for more than one.
 * @returns {Promise<{module: Object, client: Object}|null>} Null when unconfigured.
 */
window.ensureSupabaseClient = async function () {
  if (!window.oskarsSupabaseConfigured()) return null;
  let module = await loadSupabaseModule();
  if (!supabaseClientInstance) {
    supabaseClientInstance = module.createClient(
      window.OSKARS_SUPABASE_CONFIG.url,
      window.OSKARS_SUPABASE_CONFIG.anonKey,
    );
    // Whatever resolveSupabaseAuthState() last resolved may no longer be
    // current the moment a real auth event fires - reset its cache so a
    // later call re-resolves instead of returning a stale answer forever
    // (found: nothing reset it at all, so a "signed-out" resolved before
    // sign-in completed would stick for the rest of the page's life).
    // Set up once here, rather than inside the public
    // onSupabaseAuthChange() below (which creates a new listener per
    // caller), so this holds even when nothing ever subscribes.
    supabaseClientInstance.auth.onAuthStateChange(() => {
      supabaseAuthResolutionPromise = null;
    });
  }
  return { module, client: supabaseClientInstance };
};

let lastResolvedSupabaseUser = null;

/**
 * Returns the currently signed-in Supabase user, synchronously, or null.
 * Reads from the last-resolved session rather than making a network
 * call - callers that only need a one-off read don't pay for a round
 * trip. Resolve resolveSupabaseAuthState() (or let onSupabaseAuthChange()
 * fire once) before relying on this returning a fresh answer - mirrors
 * getFirebaseCurrentUser()'s same contract, including returning null
 * before either has run yet.
 * @returns {Object|null} Current Supabase user, or null when signed out, unconfigured, or not yet resolved.
 */
window.getSupabaseCurrentUser = function () {
  return lastResolvedSupabaseUser;
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

// Supabase's Google provider has "Skip nonce checks" off (the more secure
// default - the panel itself calls the alternative "less secure"), so it
// requires the ID token's nonce claim to match one it can verify. Google
// embeds whatever nonce initialize() is given straight into the token, so
// the raw value can't be reused as-is: hand Google a SHA-256 hash of a
// fresh random value, keep the raw value here, then hand the raw value to
// signInWithIdToken() so Supabase can hash it itself and compare. A stale
// or reused nonce is exactly the replay this exists to prevent, so a fresh
// one is generated on every initialize() call rather than cached once.
function generateNonce() {
  let bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  let digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function handleGoogleCredentialForSupabase(response) {
  try {
    let ready = await window.ensureSupabaseClient();
    if (!ready) return;
    let { data, error } = await ready.client.auth.signInWithIdToken({
      provider: "google",
      token: response.credential,
      nonce: currentRawGoogleNonce,
    });
    if (error) throw error;
    lastResolvedSupabaseUser = data?.user || null;
  } catch (err) {
    reportSupabaseError(err);
  }
}

// Requires supabase.config.js's googleWebClientId field, set only once
// Authentication -> Providers -> Google is enabled in the Supabase
// dashboard - a real setup step, not something this file configures on
// its own. Returns false (not an error) when unset, matching every other
// optional-credential feature in this app. Re-initializes with a fresh
// nonce on every call (see generateNonce() above) rather than only once -
// google.accounts.id.initialize() is safe to call repeatedly and just
// updates its config, so each render gets its own single-use nonce.
async function ensureSupabaseGoogleIdentityInitialized() {
  if (!window.oskarsSupabaseConfigured()) return false;
  let clientId = window.OSKARS_SUPABASE_CONFIG.googleWebClientId;
  if (!clientId) return false;
  await loadGoogleIdentityScript();
  currentRawGoogleNonce = generateNonce();
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredentialForSupabase,
    nonce: await sha256Hex(currentRawGoogleNonce),
  });
  return true;
}

/**
 * Renders Google's own "Sign in with Google" button into the given
 * container once Google Identity Services is ready for the Supabase
 * client id specifically. A no-op if unconfigured (nothing renders,
 * including while googleWebClientId is still a placeholder) or the
 * container doesn't exist.
 * @param {Element} container Empty element to render the button into.
 */
window.renderGoogleSignInButtonForSupabase = async function (container) {
  if (!container) return;
  try {
    let ready = await ensureSupabaseGoogleIdentityInitialized();
    if (!ready) return;
    let compact = Boolean(
      container.closest?.(".app-header:not([data-account-landing])"),
    );
    container.innerHTML = "";
    window.google.accounts.id.renderButton(container, {
      theme: "outline",
      size: "medium",
      type: compact ? "icon" : "standard",
      shape: compact ? "circle" : "pill",
    });
  } catch (err) {
    reportSupabaseError(err);
  }
};

/**
 * Resolves Supabase's initial persisted authentication state once,
 * including explicit configuration, offline, timeout, and
 * initialization-failure cases - mirrors resolveFirebaseAuthState()'s
 * exact contract and status set.
 * @param {{timeoutMs?: number}} [options] Initial-state timeout override.
 * @returns {Promise<{status: 'signed-in'|'signed-out'|'unconfigured'|'offline'|'error', user?: Object, error?: string}>}
 */
window.resolveSupabaseAuthState = function (options = {}) {
  if (!window.oskarsSupabaseConfigured())
    return Promise.resolve({ status: "unconfigured" });
  if (supabaseAuthResolutionPromise) return supabaseAuthResolutionPromise;
  let timeoutMs =
    Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000;
  supabaseAuthResolutionPromise = window
    .ensureSupabaseClient()
    .then(
      (ready) =>
        new Promise((resolve) => {
          let settled = false;
          let timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve({
              status: window.navigator?.onLine === false ? "offline" : "error",
              error: "Timed out while checking the signed-in account.",
            });
          }, timeoutMs);
          ready.client.auth
            .getSession()
            .then(({ data, error }) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              if (error) {
                resolve({
                  status:
                    window.navigator?.onLine === false ? "offline" : "error",
                  error: String(error.message || error),
                });
                return;
              }
              let user = data?.session?.user || null;
              lastResolvedSupabaseUser = user;
              resolve(
                user
                  ? { status: "signed-in", user }
                  : {
                      status:
                        window.navigator?.onLine === false
                          ? "offline"
                          : "signed-out",
                    },
              );
            })
            .catch((err) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resolve({
                status:
                  window.navigator?.onLine === false ? "offline" : "error",
                error: String(err?.message || err),
              });
            });
        }),
    )
    .catch((err) => {
      reportSupabaseError(err);
      return {
        status: window.navigator?.onLine === false ? "offline" : "error",
        error: String(err?.message || err),
      };
    });
  return supabaseAuthResolutionPromise;
};

/**
 * Signs the current user out, if Supabase is configured and initialized.
 * Stamps deliberateSignOutAt first so onSupabaseAuthChange's subscribers
 * can tell this apart from an unexpected sign-out, mirroring
 * signOutOfFirebase()'s exact contract.
 */
window.signOutOfSupabase = async function () {
  let ready = await window.ensureSupabaseClient();
  if (!ready) return;
  deliberateSignOutAt = Date.now();
  let { error } = await ready.client.auth.signOut();
  if (error) {
    reportSupabaseError(error);
    throw error;
  }
  lastResolvedSupabaseUser = null;
};

/**
 * Subscribes to sign-in state changes. A no-op (never calls back) when
 * Supabase isn't configured, mirroring onFirebaseAuthChange()'s exact
 * contract including the `deliberate` sign-out distinction.
 * @param {(user: Object|null, meta: {deliberate: boolean}) => void} callback
 * @returns {() => void} Unsubscribe function.
 */
window.onSupabaseAuthChange = function (callback) {
  if (!window.oskarsSupabaseConfigured()) return () => {};
  let unsubscribeFn = () => {};
  let cancelled = false;
  window
    .ensureSupabaseClient()
    .then((ready) => {
      if (!ready || cancelled) return;
      let { data } = ready.client.auth.onAuthStateChange((_event, session) => {
        let user = session?.user || null;
        lastResolvedSupabaseUser = user;
        callback(user, {
          deliberate:
            Boolean(user) ||
            Date.now() - deliberateSignOutAt < DELIBERATE_SIGN_OUT_WINDOW_MS,
        });
      });
      unsubscribeFn = () => data?.subscription?.unsubscribe?.();
    })
    .catch(reportSupabaseError);
  return () => {
    cancelled = true;
    unsubscribeFn();
  };
};
