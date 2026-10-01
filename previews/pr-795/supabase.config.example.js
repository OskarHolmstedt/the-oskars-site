/**
 * @file Documents the Supabase web app configuration shape (issue #395,
 * #410). Like firebase.config.example.js, this file's real counterpart
 * (supabase.config.js) is NOT secret and IS meant to be committed —
 * Supabase's anon key is designed to be public; protection comes from
 * Row Level Security policies, not from hiding this value. See
 * docs/supabase-backend-decision.md.
 *
 * To set up: create a project at supabase.com, copy its URL and anon
 * (publishable) key from Project Settings -> API, and save as
 * supabase.config.js — the real deployed site needs it checked in to
 * work, same as firebase.config.js.
 *
 * googleWebClientId is separate: Authentication -> Providers -> Google
 * must be enabled first (a real setup step in the Supabase dashboard,
 * not something this file alone configures), and the client id there is
 * the one Google Identity Services' ID-token flow exchanges via
 * supabase.auth.signInWithIdToken() — see src/core/supabase-client.js's
 * file header for why this app uses that instead of Supabase's own
 * signInWithOAuth redirect flow.
 */

window.OSKARS_SUPABASE_CONFIG = {
  url: "https://your-project-ref.supabase.co",
  anonKey: "your-anon-public-key",
  googleWebClientId: "your-web-client-id.apps.googleusercontent.com",
};
