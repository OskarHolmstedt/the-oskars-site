/**
 * @file A scoped-down account gate for Supabase-backed pages (issue #414,
 * now backing the real rate-watched.html - issue #420), mirroring
 * src/core/account-access.js's planOskarsAccountAccess() pure-
 * function shape and renderOskarsAccountGate()'s general posture, but
 * deliberately much smaller: no bound-account-UID tracking, no navigation
 * handoff, no different-account detection. Those belonged to the previous
 * gate to protect against a *persistent local IndexedDB mirror* leaking a
 * previous account's data into a new session - supabase-workspace.js has
 * no such local persistence at all (its cache already clears itself on
 * account switch, issue #413), so there's nothing for that machinery to
 * guard here.
 *
 * Can only ever check "is someone signed in," never "is this account
 * eligible" - private.is_eligible() lives in a schema not in the exposed
 * API's schema list (supabase/config.toml), by deliberate design
 * (docs/supabase-backend-decision.md's "Auth and eligibility" section): a
 * client discovers ineligibility reactively, by a write/read coming back
 * empty, never by asking first. An ineligible signed-in user passes this
 * gate and then simply sees no films to rate.
 */

/**
 * Plans access to a Supabase-backed owner page without reading its data.
 * Pure function - Node-testable without any Supabase client involved.
 * @param {{configured?: boolean, authStatus?: string, user?: Object, error?: string}} input
 * @returns {{allowed: boolean, status: string, user?: Object, error?: string}}
 */
window.planSupabaseAccountGate = function (input) {
  if (!input.configured) return { allowed: false, status: "unconfigured" };
  if (input.authStatus !== "signed-in" || !input.user?.id)
    return {
      allowed: false,
      status: input.authStatus || "signed-out",
      ...(input.error ? { error: input.error } : {}),
    };
  return { allowed: true, status: "signed-in", user: input.user };
};

/**
 * Resolves the current Supabase account-gate decision, end to end.
 * @returns {Promise<{allowed: boolean, status: string, user?: Object, error?: string}>}
 */
window.resolveSupabaseAccountGate = async function () {
  let configured = Boolean(window.oskarsSupabaseConfigured?.());
  if (!configured) return window.planSupabaseAccountGate({ configured });
  let auth = await window.resolveSupabaseAuthState();
  return window.planSupabaseAccountGate({
    configured,
    authStatus: auth?.status,
    user: auth?.user,
    error: auth?.error,
  });
};

/**
 * Renders a minimal sign-in/status gate into `container`, replacing its
 * contents. Reuses the real Google sign-in button
 * (renderGoogleSignInButtonForSupabase) rather than a placeholder - the
 * gate is only "done" once a real sign-in through it actually works.
 * @param {{allowed: boolean, status: string, error?: string}} access
 * @param {Element} container
 */
window.renderSupabaseAccountGate = function (access, container) {
  if (!container) return;
  let escape = window.pageEscape;
  let messages = {
    loading: "Checking your account...",
    unconfigured: "Supabase isn't configured for this deployment.",
    offline: "You appear to be offline - reconnect and reload.",
    error: access.error || "Something went wrong checking your account.",
  };
  let message =
    messages[access.status] ||
    "Sign in with Google to rate your watched films.";
  container.innerHTML = `<div class="account-gate">
    <p>${escape(message)}</p>
    <div data-supabase-gate-button></div>
  </div>`;
  if (access.status === "signed-out") {
    window.renderGoogleSignInButtonForSupabase?.(
      container.querySelector("[data-supabase-gate-button]"),
    );
  }
};
