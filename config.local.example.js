/** @file Documents the optional browser-local TMDB and Google Sheets configuration shape. */

window.OSKARS_LOCAL_CONFIG = {
  // Optional: calls TMDB directly with your own key instead of going
  // through the shared Cloudflare Worker proxy (cloudflare/tmdb-proxy/,
  // docs/tmdb-shared-key-proxy-decision.md). Leave both unset to use the
  // deployed proxy, the normal path for every real user.
  tmdbCredential: "your-tmdb-api-key-or-read-token",
  // Optional: only needed alongside tmdbCredential to point at something
  // other than TMDB directly - e.g. a local `wrangler dev` server
  // (http://localhost:8787/3) while testing the proxy itself.
  // tmdbApiBase: "http://localhost:8787/3",
  googleClientId: "your-google-oauth-client-id.apps.googleusercontent.com",
  googleSheets: {
    spreadsheetId: "your-private-google-sheet-id",
    signInMode: "oneTap", // 'oneTap': silent token first, popup consent only if needed. 'redirect'/'popup': see below.
    redirectSignIn: false, // legacy fallback for redirect mode
    // redirectUri: 'https://localhost:1234/data.html',
    ranges: {
      bracketBlocks: "'The Oskars'!A:ZZ",
      allTimeRankedList: "'All-time'!A:ZZ",
      diary: "'Diary'!A:R",
      watchlist: "'Watchlist'!A:ZZ",
      franchises: "'Franchises'!A:ZZ",
      directors: "'Directors'!A:ZZ",
      collectionAwards: "'Collection Awards'!A:ZZ",
    },
  },
};
