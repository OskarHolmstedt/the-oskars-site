/** @file Documents the optional browser-local Google Sheets and data-tools configuration shape. */

window.OSKARS_LOCAL_CONFIG = {
  // Enables data-tools.html - a hidden, unlinked owner page (missing-
  // metadata fetch + duplicate film/person detection and merge) that only
  // ever does anything when this flag is set, so it's silently inert on
  // the deployed site (which never has this gitignored file at all).
  ownerDataTools: true,
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
