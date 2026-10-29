/** @file Documents the optional browser-local Google Sheets and data-tools configuration shape. */

window.OSKARS_LOCAL_CONFIG = {
  // Enables local catalog ingestion, metadata repair, and duplicate merges.
  ownerDataTools: true,
  // Optional Supabase Service Role key for standalone data-tools.html.
  // Bypasses user sign-in and Row Level Security for direct catalog administration.
  // supabaseServiceRoleKey: "your-supabase-service-role-key",
  googleClientId: "your-google-oauth-client-id.apps.googleusercontent.com",
  googleSheets: {
    spreadsheetId: "your-private-google-sheet-id",
    signInMode: "oneTap", // 'oneTap': silent token first, popup consent only if needed. also supports 'redirect'/'popup'.
    // For redirect mode, use an authorized URI on the OAuth client.
    // redirectUri: 'http://127.0.0.1:5500/data-tools.html',
    // Owner catalog ingestion only. Connect personal archive Sheets on data.html.
    ranges: {
      franchises: "'Franchises'!A:ZZ",
      directors: "'Directors'!A:ZZ",
      // directorsAndFranchises: "'Directors and Franchises'!A:Z",
    },
  },
};
