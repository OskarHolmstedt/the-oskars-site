/** @file Documents the optional browser-local Google Sheets configuration shape. */

window.OSKARS_LOCAL_CONFIG = {
  // Reveals a link to owner-data.html in source checkouts. Deployment
  // artifacts exclude that page regardless of this example value.
  ownerDataTools: false,
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
