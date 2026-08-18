/**
 * @file Documents the Firebase web app configuration shape (issue #255).
 * Unlike config.local.example.js, this file's real counterpart
 * (firebase.config.js) is NOT secret and IS meant to be committed —
 * Firebase's web config is safe to publish; protection comes from
 * Firestore Security Rules and the Console's Authorized domains list, not
 * from hiding these values. See docs/google-signin-firestore-decision.md.
 *
 * To set up: create a Firebase project at console.firebase.google.com,
 * add a Web app, copy its config here, save as firebase.config.js, and
 * commit it — the real deployed site needs it checked in to work.
 *
 * googleWebClientId is separate from the rest of this object: find it at
 * Authentication -> Sign-in method -> Google provider -> "Web SDK
 * configuration" -> Web client ID. It's a different value from
 * config.local.js's googleClientId (that one's a separate OAuth client
 * used only for Sheets import's spreadsheet-scope access).
 */

window.OSKARS_FIREBASE_CONFIG = {
  apiKey: "your-firebase-web-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id",
  googleWebClientId: "your-web-client-id.apps.googleusercontent.com",
};
