/**
 * @file Supabase web app configuration (issue #395, #410). Not secret —
 * safe to commit; protection comes from Row Level Security policies, not
 * from hiding these values. Mirrors firebase.config.js's exact posture.
 * See docs/supabase-backend-decision.md.
 *
 * googleWebClientId reuses firebase.config.js's existing Web client id —
 * Google Cloud OAuth clients aren't provider-specific, and Supabase's
 * Google provider panel's "Client IDs" field is exactly where an existing
 * client id belongs, so no new Google Cloud client was created for this.
 */

window.OSKARS_SUPABASE_CONFIG = {
  url: "https://xvkblgqkljivgatwjkpn.supabase.co",
  anonKey: "sb_publishable_emp2koZuZukgPiLlT993kg_E_j1aMg4",
  googleWebClientId:
    "586737039645-v3r8h945heovsv63idudm75o64ij9gb2.apps.googleusercontent.com",
};
