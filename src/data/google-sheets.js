/**
 * @file Owns Google Sheets OAuth, configured range fetching and validation,
 * replace/merge imports, and post-import consistency snapshots.
 */

(function () {
  let GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
  let GOOGLE_SHEETS_READ_SCOPE =
    "https://www.googleapis.com/auth/spreadsheets.readonly";
  let GOOGLE_SHEETS_WRITE_SCOPE =
    "https://www.googleapis.com/auth/spreadsheets";
  let googleIdentityPromise = null;
  let googleAccessToken = "";
  let OAUTH_STATE_KEY = "oskarsGoogleSheetsOAuthState";
  let OAUTH_TOKEN_KEY = "oskarsGoogleSheetsAccessToken";
  let OAUTH_TOKEN_EXPIRES_KEY = "oskarsGoogleSheetsAccessTokenExpiresAt";
  let OAUTH_TOKEN_SCOPE_KEY = "oskarsGoogleSheetsAccessTokenScope";

  function googleSheetsConfig() {
    return window.OSKARS_LOCAL_CONFIG?.googleSheets || {};
  }

  function googleSheetsSignInMode() {
    let config = googleSheetsConfig();
    if (typeof config.signInMode === "string") return config.signInMode;
    if (config.oneTapSignIn) return "oneTap";
    if (config.redirectSignIn || config.redirectUri) return "redirect";
    return "oneTap";
  }

  function isRedirectSignIn() {
    return googleSheetsSignInMode() === "redirect";
  }

  function isOneTapSignIn() {
    return googleSheetsSignInMode() === "oneTap";
  }

  function getStoredGoogleAccessToken(
    requiredScope = GOOGLE_SHEETS_READ_SCOPE,
  ) {
    let token = sessionStorage.getItem(OAUTH_TOKEN_KEY);
    let expiresAt = Number(
      sessionStorage.getItem(OAUTH_TOKEN_EXPIRES_KEY) || 0,
    );
    let storedScope =
      sessionStorage.getItem(OAUTH_TOKEN_SCOPE_KEY) || GOOGLE_SHEETS_READ_SCOPE;
    if (
      requiredScope === GOOGLE_SHEETS_WRITE_SCOPE &&
      storedScope !== GOOGLE_SHEETS_WRITE_SCOPE
    ) {
      clearStoredGoogleAccessToken();
      return null;
    }
    if (token && expiresAt > Date.now() + 30000) {
      googleAccessToken = token;
      return token;
    }
    clearStoredGoogleAccessToken();
    return null;
  }

  function storeGoogleAccessToken(
    token,
    expiresIn,
    scope = GOOGLE_SHEETS_READ_SCOPE,
  ) {
    googleAccessToken = String(token || "");
    sessionStorage.setItem(OAUTH_TOKEN_KEY, googleAccessToken);
    sessionStorage.setItem(
      OAUTH_TOKEN_EXPIRES_KEY,
      String(Date.now() + (Number(expiresIn) || 0) * 1000),
    );
    sessionStorage.setItem(OAUTH_TOKEN_SCOPE_KEY, scope);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }

  function clearStoredGoogleAccessToken() {
    googleAccessToken = "";
    sessionStorage.removeItem(OAUTH_TOKEN_KEY);
    sessionStorage.removeItem(OAUTH_TOKEN_EXPIRES_KEY);
    sessionStorage.removeItem(OAUTH_TOKEN_SCOPE_KEY);
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }

  function buildGoogleOAuthState() {
    let value =
      Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    sessionStorage.setItem(OAUTH_STATE_KEY, value);
    return value;
  }

  function verifyGoogleOAuthState(state) {
    return state && sessionStorage.getItem(OAUTH_STATE_KEY) === state;
  }

  function parseGoogleOAuthResponse() {
    let hash = String(window.location.hash || "").replace(/^#/, "");
    if (!hash) return null;
    let params = new URLSearchParams(hash);
    if (!params.has("access_token") && !params.has("error")) return null;
    return {
      accessToken: params.get("access_token"),
      expiresIn: params.get("expires_in"),
      state: params.get("state"),
      error: params.get("error"),
      errorDescription: params.get("error_description"),
    };
  }

  function clearGoogleOAuthResponseFromUrl() {
    if (window.history?.replaceState) {
      let url =
        window.location.origin +
        window.location.pathname +
        window.location.search;
      window.history.replaceState(null, document.title, url);
    } else {
      window.location.hash = "";
    }
  }

  let OAUTH_PENDING_ACTION_KEY = "oskars_google_sheets_pending_action";

  function setPendingGoogleSheetsRedirectAction(action = "preview") {
    try {
      sessionStorage.setItem(OAUTH_PENDING_ACTION_KEY, String(action));
    } catch (err) {}
  }

  function consumePendingGoogleSheetsRedirectAction() {
    try {
      let action = sessionStorage.getItem(OAUTH_PENDING_ACTION_KEY);
      sessionStorage.removeItem(OAUTH_PENDING_ACTION_KEY);
      return action || null;
    } catch (err) {
      return null;
    }
  }

  window.consumePendingGoogleSheetsAction =
    consumePendingGoogleSheetsRedirectAction;

  function loadGoogleIdentity() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (googleIdentityPromise) return googleIdentityPromise;
    googleIdentityPromise = new Promise((resolve, reject) => {
      let script = document.createElement("script");
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error("Could not load Google Identity Services."));
      document.head.appendChild(script);
    });
    return googleIdentityPromise;
  }

  let GOOGLE_SIGN_IN_TIMEOUT_MS = 60000;

  // Google's token-client callback fires from deep inside its own script, not
  // synchronously from our call — if a consent popup gets silently blocked, or
  // closes itself without ever messaging the opener back (both seen in the
  // wild with Google Identity Services), that callback simply never runs and
  // the surrounding promise hangs forever with no error. Racing it against a
  // timeout turns that silent hang into a visible, actionable failure.
  function withSignInTimeout(promise, ms = GOOGLE_SIGN_IN_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            "Google sign-in timed out waiting for a response. If a Google " +
              "popup appeared and closed itself, the browser likely blocked it " +
              "from returning to this page — check the address bar for a " +
              "blocked-popup icon, allow popups for this site, and try again.",
          ),
        );
      }, ms);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async function requestGoogleAccessToken(options = {}) {
    let clientId =
      options.clientId ||
      window.OSKARS_LOCAL_CONFIG?.googleClientId ||
      window.OSKARS_SUPABASE_CONFIG?.googleWebClientId;
    if (!clientId)
      throw new Error(
        "Missing Google Client ID (configure googleWebClientId in supabase.config.js or googleClientId in config.local.js).",
      );
    let requestedScope = options.write
      ? GOOGLE_SHEETS_WRITE_SCOPE
      : options.scope || GOOGLE_SHEETS_READ_SCOPE;
    if (isOneTapSignIn()) {
      let token =
        options.prompt === "consent"
          ? null
          : getStoredGoogleAccessToken(requestedScope);
      if (token) return token;
      await loadGoogleIdentity();

      if (window.google?.accounts?.oauth2) {
        // Trigger token request synchronously within user gesture (issue #564).
        // Google Identity Services prompt: "" skips consent if already granted,
        // or opens the consent popup directly within the active gesture call stack
        // so Safari (ITP) and Chrome do not silently block the popup.
        let promptMode = options.prompt ?? "";
        return withSignInTimeout(
          new Promise((resolve, reject) => {
            let settled = false;
            let tokenClient = window.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: requestedScope,
              callback: (response) => {
                if (settled) return;
                console.debug(
                  "Google Sheets sign-in: token client response",
                  response,
                );
                if (response?.error) {
                  settled = true;
                  let message =
                    response.error_description ||
                    response.error ||
                    "Google did not grant Sheets access.";
                  if (response.error === "popup_blocked_by_browser") {
                    message =
                      "Google sign-in popup was blocked by your browser. Please allow popups for this site and try again.";
                  }
                  reject(new Error(message));
                  return;
                }
                googleAccessToken = response.access_token;
                storeGoogleAccessToken(
                  googleAccessToken,
                  response.expires_in,
                  requestedScope,
                );
                settled = true;
                resolve(googleAccessToken);
              },
            });
            tokenClient.requestAccessToken({ prompt: promptMode });
          }),
          options.timeoutMs || GOOGLE_SIGN_IN_TIMEOUT_MS,
        );
      }
      // Falls through to the redirect/popup flow below if oauth2 never loaded.
    }

    if (isRedirectSignIn()) {
      let token = getStoredGoogleAccessToken(requestedScope);
      if (token) return Promise.resolve(token);

      let response = parseGoogleOAuthResponse();
      if (response) {
        clearGoogleOAuthResponseFromUrl();
        if (response.error)
          return Promise.reject(
            new Error(response.errorDescription || response.error),
          );
        if (!verifyGoogleOAuthState(response.state)) {
          clearStoredGoogleAccessToken();
          return Promise.reject(new Error("Google OAuth state mismatch."));
        }
        if (!response.accessToken)
          return Promise.reject(
            new Error("Google OAuth response missing access token."),
          );
        storeGoogleAccessToken(
          response.accessToken,
          response.expiresIn,
          requestedScope,
        );
        return Promise.resolve(response.accessToken);
      }

      let config = googleSheetsConfig();
      let redirectUri = String(
        config.redirectUri ||
          `${window.location.origin}${window.location.pathname}`,
      ).trim();
      if (!redirectUri)
        throw new Error(
          "Missing googleSheets.redirectUri in config.local.js or unable to determine current page URL for redirect.",
        );

      setPendingGoogleSheetsRedirectAction(options.action || "preview");
      let state = buildGoogleOAuthState();
      let authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "token");
      authUrl.searchParams.set("scope", requestedScope);
      authUrl.searchParams.set("include_granted_scopes", "true");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("prompt", googleAccessToken ? "" : "consent");

      window.location.href = authUrl.toString();
      return new Promise(() => {});
    }

    return withSignInTimeout(
      new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
          reject(new Error("Google Identity Services are not loaded."));
          return;
        }
        let tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: requestedScope,
          callback: (response) => {
            console.debug(
              "Google Sheets sign-in: token client response",
              response,
            );
            if (response?.error)
              reject(new Error(response.error_description || response.error));
            else {
              googleAccessToken = response.access_token;
              storeGoogleAccessToken(
                googleAccessToken,
                response.expires_in,
                requestedScope,
              );
              resolve(googleAccessToken);
            }
          },
        });
        tokenClient.requestAccessToken({
          prompt: googleAccessToken ? "" : "consent",
        });
      }),
    );
  }

  function escapeDelimitedCell(value, delimiter) {
    let text = String(value ?? "");
    if (text.includes(delimiter) || /["\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function rowsToDelimited(values, delimiter) {
    return (values || [])
      .map((row) =>
        (row || [])
          .map((value) => escapeDelimitedCell(value, delimiter))
          .join(delimiter),
      )
      .join("\n");
  }

  function rowsToPlainDelimited(values, delimiter) {
    return (values || [])
      .map((row) =>
        (row || [])
          .map((value) =>
            String(value ?? "")
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n"),
          )
          .join(delimiter),
      )
      .join("\n");
  }

  function normalizeHeaderCell(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function rowHasHeader(row, requiredHeaders) {
    let normalized = (row || []).map(normalizeHeaderCell);
    return requiredHeaders.every((header) => normalized.includes(header));
  }

  function validateRankedListSchema(values, spec) {
    let warnings = [];
    let rows = values || [];
    let header = rows.find(
      (row) =>
        rowHasHeader(row, ["rank", "year", "title"]) ||
        rowHasHeader(row, ["fixed rank", "year", "title"]) ||
        rowHasHeader(row, ["dynamic rank", "year", "title"]),
    );
    if (!header) {
      warnings.push(
        `${spec.key} has no recognizable ranked-list header. Headerless A:T imports are allowed, but shifted columns are harder to diagnose.`,
      );
      return warnings;
    }
    let normalized = header
      .map(normalizeHeaderCell)
      .filter((value) => value !== "country");
    let hasRank = normalized.includes("rank");
    let hasFixedRank = normalized.includes("fixed rank") || hasRank;
    let hasDynamicRank = normalized.includes("dynamic rank");
    let expected;
    let aliases = {
      rank: ["rank", "fixed rank"],
      "fixed rank": ["rank", "fixed rank"],
      tmdbid: ["tmdbid", "tmdb id"],
      letterboxd: ["letterboxd", "letterboxd url", "letterboxd uri"],
    };

    if (hasFixedRank && hasDynamicRank) {
      expected = [
        "dynamic rank",
        "fixed rank",
        "year",
        "title",
        "director",
        "rating",
        "type",
        "tag",
        "medium",
        "screenplay",
        "source",
        "views",
        "date",
        "score",
        "franchise",
        "platform",
        "runtime",
        "tmdbid",
        "letterboxd",
      ];
    } else if (hasFixedRank) {
      expected = [
        "fixed rank",
        "year",
        "title",
        "director",
        "rating",
        "type",
        "tag",
        "medium",
        "screenplay",
        "source",
        "views",
        "date watched",
        "score",
        "franchise",
        "platform",
        "runtime",
        "global rank",
        "tmdbid",
        "letterboxd",
      ];
      aliases["fixed rank"] = ["fixed rank"];
    } else if (hasDynamicRank) {
      expected = [
        "dynamic rank",
        "year",
        "title",
        "director",
        "rating",
        "type",
        "tag",
        "medium",
        "screenplay",
        "source",
        "views",
        "date watched",
        "score",
        "franchise",
        "platform",
        "runtime",
        "global rank",
        "tmdbid",
        "letterboxd",
      ];
      aliases["dynamic rank"] = ["dynamic rank"];
    } else {
      expected = [
        "rank",
        "year",
        "title",
        "director",
        "rating",
        "type",
        "tag",
        "medium",
        "screenplay",
        "source",
        "views",
        "date watched",
        "score",
        "franchise",
        "platform",
        "runtime",
        "global rank",
        "tmdbid",
        "letterboxd",
      ];
      aliases.rank = ["rank", "fixed rank", "dynamic rank"];
    }

    expected.forEach((headerName, index) => {
      let accepted = aliases[headerName] || [headerName];
      let actualIndex = normalized.findIndex((value) =>
        accepted.includes(value),
      );
      if (actualIndex < 0)
        warnings.push(`${spec.key} header is missing "${expected[index]}".`);
      else if (actualIndex !== index)
        warnings.push(
          `${spec.key} header "${expected[index]}" is in column ${actualIndex + 1}, expected ${index + 1}.`,
        );
    });
    return warnings;
  }

  function validateWatchlistSchema(values, spec) {
    let warnings = [];
    let rows = values || [];
    let header = rows[0] || [];
    let normalized = header
      .map(normalizeHeaderCell)
      .filter((value) => value !== "country");
    let hasHeader = normalized.some((value) =>
      ["name", "title", "year"].includes(value),
    );
    if (!hasHeader) return warnings;
    if (!normalized.includes("name") && !normalized.includes("title")) {
      warnings.push(`${spec.key} header is missing "Name".`);
    }
    if (!normalized.includes("year")) {
      warnings.push(`${spec.key} header is missing "Year".`);
    }
    return warnings;
  }

  function validateDiarySchema(values, spec) {
    let warnings = [];
    let rows = values || [];
    let header = rows.find((row) =>
      rowHasHeader(row, ["year", "title", "type"]),
    );
    if (!header) {
      warnings.push(
        `${spec.key} has no recognizable Diary header with Year, Title, and Type.`,
      );
      return warnings;
    }
    let normalized = header
      .map(normalizeHeaderCell)
      .filter((value) => value !== "country");
    let expected = [
      "year",
      "title",
      "director",
      "rating",
      "type",
      "tag",
      "medium",
      "screenplay",
      "source",
      "views",
      "date",
      "score",
      "franchise",
      "platform",
      "runtime",
      "tmdbid",
      "letterboxd",
    ];
    let aliases = {
      date: ["date", "date watched", "watched date"],
      tmdbid: ["tmdbid", "tmdb id"],
      letterboxd: ["letterboxd", "letterboxd url", "letterboxd uri"],
    };
    expected.forEach((headerName, index) => {
      let accepted = aliases[headerName] || [headerName];
      let actualIndex = normalized.findIndex((value) =>
        accepted.includes(value),
      );
      if (actualIndex < 0)
        warnings.push(`${spec.key} header is missing "${headerName}".`);
      else if (actualIndex !== index)
        warnings.push(
          `${spec.key} header "${headerName}" is in column ${actualIndex + 1}, expected ${index + 1}.`,
        );
    });
    if (
      normalized.includes("dynamic rank") ||
      normalized.includes("fixed rank")
    ) {
      warnings.push(
        `${spec.key} must omit the All-time Dynamic Rank and Fixed Rank columns.`,
      );
    }
    return warnings;
  }

  function validateBracketSchema(values, spec) {
    let warnings = [];
    let rows = values || [];
    let widestRow = rows.reduce(
      (max, row) => Math.max(max, (row || []).length),
      0,
    );
    if (widestRow < 37) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); bracket schema expects at least 37 columns through AK.`,
      );
    }
    let headerRow = rows.find((row) => {
      let cells = (row || []).map((cell) => String(cell || "").trim());
      return (
        cells.includes("Position") &&
        cells.includes("Period") &&
        cells.includes("Picture (1st half)") &&
        cells.includes("Picture (2nd half)") &&
        cells.includes("Director (Recipient)") &&
        cells.includes("Director (Film)")
      );
    });
    if (!headerRow) {
      warnings.push(
        `${spec.key} has no "Position"/"Period" bracket header row.`,
      );
    } else {
      let periodCol = headerRow.findIndex(
        (cell) => String(cell || "").trim() === "Period",
      );
      let hasMarker = rows.some((row) =>
        /^(?:Year|Decade|Century|All-time)$/i.test(
          String(row?.[periodCol] || "").trim(),
        ),
      );
      if (!hasMarker) {
        warnings.push(
          `${spec.key} has no recognizable bracket period marker in the "Period" column.`,
        );
      }
    }
    return warnings;
  }

  function validateCollectionAwardsSchema(values, spec) {
    let warnings = validateBracketSchema(values, spec).filter(
      (warning) => !warning.includes("period marker"),
    );
    let rows = values || [];
    let header = rows.find((row) =>
      (row || []).some((cell) => String(cell || "").trim() === "Period"),
    );
    let metaCol = (header || []).findIndex(
      (cell) => String(cell || "").trim() === "Period",
    );
    let hasMarker = rows.some((row) =>
      /^(?:Director|Franchise)$/i.test(String(row?.[metaCol] || "").trim()),
    );
    if (!hasMarker)
      warnings.push(
        `${spec.key} has no Director or Franchise marker in the "Period" column.`,
      );
    return warnings;
  }

  function isSheetLaneHeaderCell(value) {
    return (
      String(value || "")
        .trim()
        .toLowerCase() === "year"
    );
  }

  function countSheetLaneHeaders(rows) {
    let count = 0;
    (rows || []).forEach((row) => {
      for (let col = 0; col < (row || []).length; col += 3) {
        if (isSheetLaneHeaderCell(row?.[col])) count += 1;
      }
    });
    return count;
  }

  // Shared by validateFranchiseSchema/validateDirectorSheetSchema below -
  // both check the same year/title/<lane> lane-of-3 structure and differ
  // only in their wording, not their logic.
  function validateLaneSheetSchema(values, spec, wording) {
    let warnings = [];
    let rows = values || [];
    let widestRow = rows.reduce(
      (max, row) => Math.max(max, (row || []).length),
      0,
    );
    if (widestRow < 3) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); ${wording.schemaLabel} schema expects at least one year/title/${wording.laneWord} lane.`,
      );
    } else if (widestRow % 3 !== 0) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); ${wording.schemaLabel} lanes are read in year/title/${wording.laneWord} groups of 3, so trailing columns may be ignored.`,
      );
    }
    let markerCount = countSheetLaneHeaders(rows);
    if (!markerCount) {
      warnings.push(
        `${spec.key} has no "Year" ${wording.headerNoun} header cells; films cannot be assigned to ${wording.assignmentTarget}.`,
      );
    }
    let filmLikeRows = rows.filter((row) => {
      for (let col = 0; col < (row || []).length; col += 3) {
        let title = String(row?.[col + 1] || "").trim();
        if (title && !isSheetLaneHeaderCell(row?.[col])) return true;
      }
      return false;
    }).length;
    if (markerCount && !filmLikeRows) {
      warnings.push(
        `${spec.key} has ${wording.headerNoun} headers but no film rows in the expected title columns.`,
      );
    }
    return warnings;
  }

  function validateFranchiseSchema(values, spec) {
    return validateLaneSheetSchema(values, spec, {
      schemaLabel: "franchise",
      laneWord: "rating",
      headerNoun: "franchise",
      assignmentTarget: "franchise groups",
    });
  }

  function validateDirectorSheetSchema(values, spec) {
    return validateLaneSheetSchema(values, spec, {
      schemaLabel: "Directors",
      laneWord: "interest",
      headerNoun: "director",
      assignmentTarget: "directors",
    });
  }

  /**
   * Validates visible range structure for its configured importer.
   * @param {Array<Array<*>>} values Raw Google Sheet rows.
   * @param {GoogleSheetRangeSpec} spec Configured range specification.
   * @returns {string[]} Non-fatal schema warnings.
   */
  window.validateGoogleSheetRangeForImport = function (values, spec) {
    if (!spec?.importType) return [];
    if (spec.importType === "list")
      return validateRankedListSchema(values, spec);
    if (spec.importType === "diary") return validateDiarySchema(values, spec);
    if (spec.importType === "watchlist")
      return validateWatchlistSchema(values, spec);
    if (spec.importType === "table") return validateBracketSchema(values, spec);
    if (spec.importType === "collection-awards")
      return validateCollectionAwardsSchema(values, spec);
    if (spec.importType === "franchises")
      return validateFranchiseSchema(values, spec);
    if (spec.importType === "directors")
      return validateDirectorSheetSchema(values, spec);
    return [];
  };

  async function fetchSheetValues(
    spreadsheetId,
    ranges,
    accessToken,
    options = {},
  ) {
    let params = new URLSearchParams();
    ranges.forEach((range) => params.append("ranges", range));
    params.set("majorDimension", options.majorDimension || "ROWS");
    params.set(
      "valueRenderOption",
      options.valueRenderOption || "FORMATTED_VALUE",
    );
    let response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      let text = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets request failed (${response.status}). ${text}`.trim(),
      );
    }
    return response.json();
  }

  /**
   * Writes values to a single Google Sheets range.
   * @param {string} spreadsheetId Target spreadsheet ID.
   * @param {string} range A1 notation range.
   * @param {Array<Array<*>>} values Two-dimensional row values.
   * @param {string} accessToken Active Google OAuth access token.
   * @param {Object} [options] Write options including valueInputOption.
   * @returns {Promise<Object>} API response object.
   */
  async function writeSheetValues(
    spreadsheetId,
    range,
    values,
    accessToken,
    options = {},
  ) {
    let params = new URLSearchParams();
    params.set("valueInputOption", options.valueInputOption || "USER_ENTERED");
    let response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${params}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          range,
          majorDimension: options.majorDimension || "ROWS",
          values,
        }),
      },
    );
    if (!response.ok) {
      let text = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets write failed (${response.status}). ${text}`.trim(),
      );
    }
    return response.json();
  }

  /**
   * Batch updates multiple Google Sheets value ranges.
   * @param {string} spreadsheetId Target spreadsheet ID.
   * @param {Array<{range: string, values: Array<Array<*>>, majorDimension?: string}>} data Value ranges.
   * @param {string} accessToken Active Google OAuth access token.
   * @param {Object} [options] Write options including valueInputOption.
   * @returns {Promise<Object>} API response object.
   */
  async function batchUpdateSheetValues(
    spreadsheetId,
    data,
    accessToken,
    options = {},
  ) {
    let payload = {
      valueInputOption: options.valueInputOption || "USER_ENTERED",
      data: (data || []).map((entry) => ({
        range: entry.range,
        majorDimension: entry.majorDimension || "ROWS",
        values: entry.values,
      })),
    };
    let response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      let text = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets batch update failed (${response.status}). ${text}`.trim(),
      );
    }
    return response.json();
  }

  /**
   * Executes structural batchUpdate requests on a Google Spreadsheet.
   * @param {string} spreadsheetId Target spreadsheet ID.
   * @param {Array<Object>} requests Spreadsheets API request objects.
   * @param {string} accessToken Active Google OAuth access token.
   * @returns {Promise<Object>} API response object.
   */
  async function batchUpdateSpreadsheet(spreadsheetId, requests, accessToken) {
    let response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );
    if (!response.ok) {
      let text = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets spreadsheet batch update failed (${response.status}). ${text}`.trim(),
      );
    }
    return response.json();
  }

  function hasMeaningfulValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return true;
    let text = String(value || "").trim();
    return text && text !== "unknown";
  }

  function allSourceFilms(data) {
    return Object.values(data.years || {}).flatMap(
      (period) => period.films || [],
    );
  }

  function buildFilmMatcher(localState) {
    let films = [
      ...Object.values(localState.filmsById || {}),
      ...allSourceFilms(localState),
    ];
    let seen = new Set();
    films = films.filter((film) => {
      if (!film?.title) return false;
      let key =
        film.id || `${film.year || ""}::${window.normalizeTitle(film.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    let byTmdb = new Map();
    let byTitleYear = new Map();
    let byTitle = new Map();
    films.forEach((film) => {
      if (film.tmdbId) byTmdb.set(String(film.tmdbId), film);
      let title = window.normalizeTitle(film.title);
      let year = String(film.year || "").trim();
      if (title && year) byTitleYear.set(`${year}::${title}`, film);
      if (title) {
        let matches = byTitle.get(title) || [];
        matches.push(film);
        byTitle.set(title, matches);
      }
    });
    return (film) => {
      if (film?.tmdbId && byTmdb.has(String(film.tmdbId)))
        return byTmdb.get(String(film.tmdbId));
      let title = window.normalizeTitle(film?.title);
      let year = String(film?.year || "").trim();
      if (title && year && byTitleYear.has(`${year}::${title}`))
        return byTitleYear.get(`${year}::${title}`);
      let titleMatches = byTitle.get(title) || [];
      return titleMatches.length === 1 ? titleMatches[0] : null;
    };
  }

  function preserveFilmMetadata(incomingFilm, localFilm) {
    if (!incomingFilm || !localFilm) return incomingFilm;
    [
      "tmdbId",
      "director",
      "country",
      "medium",
      "screenplayType",
      "adaptationSource",
      "review",
    ].forEach((field) => {
      if (hasMeaningfulValue(localFilm[field]))
        incomingFilm[field] = window.cloneRecord(localFilm[field]);
    });
    ["directors", "tags", "franchises"].forEach((field) => {
      if (hasMeaningfulValue(localFilm[field]))
        incomingFilm[field] = window.cloneRecord(localFilm[field]);
    });
    if (hasMeaningfulValue(localFilm.poster))
      incomingFilm.poster = window.cloneRecord(localFilm.poster);
    if (
      !hasMeaningfulValue(incomingFilm.url) &&
      hasMeaningfulValue(localFilm.url)
    )
      incomingFilm.url = localFilm.url;
    return incomingFilm;
  }

  function mergeWatchlistMetadata(incomingItems, localItems) {
    let localById = new Map();
    let localByTitleYear = new Map();
    (localItems || []).forEach((item) => {
      let id = item.id || window.watchlistItemId?.(item);
      if (id) localById.set(id, item);
      localByTitleYear.set(
        `${item.year || ""}::${window.normalizeTitle(item.title)}`,
        item,
      );
    });
    return (incomingItems || []).map((item) => {
      let id = item.id || window.watchlistItemId?.(item);
      let local =
        localById.get(id) ||
        localByTitleYear.get(
          `${item.year || ""}::${window.normalizeTitle(item.title)}`,
        );
      if (!local) return item;
      ["tmdbId", "director"].forEach((field) => {
        if (hasMeaningfulValue(local[field])) item[field] = local[field];
      });
      ["tags", "franchises"].forEach((field) => {
        if (hasMeaningfulValue(local[field]))
          item[field] = window.cloneRecord(local[field]);
      });
      if (hasMeaningfulValue(local.poster))
        item.poster = window.cloneRecord(local.poster);
      return item;
    });
  }

  function mergeWatchedOtherEntries(incomingItems, localItems) {
    let merged = (localItems || []).map((item) => window.cloneRecord(item));
    let indexById = new Map(merged.map((item, index) => [item.id, index]));
    (incomingItems || []).forEach((item) => {
      let index = indexById.get(item.id);
      if (index == null) {
        indexById.set(item.id, merged.length);
        merged.push(window.cloneRecord(item));
      } else {
        merged[index] = window.cloneRecord(item);
      }
    });
    return merged;
  }

  function enrichGoogleImportedStateFromSharedArchive(importedState, reports) {
    let importedPeriods = new Set(
      reports.flatMap((report) => report.periods || []),
    );
    importedPeriods.forEach((period) => {
      (importedState.years?.[period]?.films || []).forEach((film) =>
        window.enrichPersonalRecordFromSharedArchive?.(film, "film"),
      );
    });
    if (
      reports.some(
        (report) =>
          ["watchlist", "franchises", "directors"].includes(report.rangeKey) &&
          (report.filmsParsed || report.sheetRows),
      )
    ) {
      (importedState.watchlist || []).forEach((item) =>
        window.enrichPersonalRecordFromSharedArchive?.(item, "watchlist"),
      );
    }
    if (
      reports.some(
        (report) =>
          ["diary", "franchises", "directors"].includes(report.rangeKey) &&
          (report.filmsParsed || report.sheetRows),
      )
    ) {
      (importedState.watchedOther || []).forEach((item) =>
        window.enrichPersonalRecordFromSharedArchive?.(item, "film"),
      );
    }
    return importedState;
  }

  function mergeImportedGoogleState(localState, incomingState, reports) {
    let merged = window.cloneRecord(localState);
    incomingState = enrichGoogleImportedStateFromSharedArchive(
      window.cloneRecord(incomingState),
      reports,
    );
    let findLocalFilm = buildFilmMatcher(localState);
    let importedPeriods = new Set(
      reports.flatMap((report) => report.periods || []),
    );

    importedPeriods.forEach((period) => {
      if (!incomingState.years?.[period]) return;
      let incomingPeriod = window.cloneRecord(incomingState.years[period]);
      (incomingPeriod.films || []).forEach((film) =>
        preserveFilmMetadata(film, findLocalFilm(film)),
      );
      merged.years[period] = incomingPeriod;
    });

    let importedWatchlist = reports.some(
      (report) =>
        ["watchlist", "franchises", "directors"].includes(report.rangeKey) &&
        (report.filmsParsed || report.sheetRows),
    );
    if (importedWatchlist) {
      merged.watchlist = mergeWatchlistMetadata(
        window.cloneRecord(incomingState.watchlist || []),
        localState.watchlist || [],
      );
    }
    // Deduplicate watchlist against watched films: any film
    // present in watched years must not remain on the watchlist (issue #634).
    if (merged.watchlist?.length) {
      let isWatched = buildFilmMatcher(merged);
      merged.watchlist = merged.watchlist.filter((item) => !isWatched(item));
    }
    let importedWatchedOther = reports.some(
      (report) =>
        ["diary", "franchises", "directors"].includes(report.rangeKey) &&
        (report.filmsParsed || report.sheetRows),
    );
    if (importedWatchedOther) {
      merged.watchedOther = mergeWatchedOtherEntries(
        incomingState.watchedOther || [],
        localState.watchedOther || [],
      );
    }
    if (
      reports.some(
        (report) =>
          report.rangeKey === "collectionAwards" &&
          (report.awardsAdded || report.sheetRows),
      )
    )
      merged.collectionAwards = window.cloneRecord(
        incomingState.collectionAwards || { director: {}, franchise: {} },
      );

    // Cross-source conflicts are recorded on the import-time state (the
    // cleared state every range was parsed into), so the merged result must
    // take them from there or they'd silently vanish in merge mode.
    merged.sourceConflicts = window.cloneRecord(
      incomingState.sourceConflicts || [],
    );

    return merged;
  }
  /**
   * Replaces imported periods while preserving local metadata and local-only sections.
   * @param {OskarsState} localState State captured before the import.
   * @param {OskarsState} incomingState State built from Google Sheet ranges.
   * @param {ImportReport[]} reports Per-range import reports.
   * @returns {OskarsState} Merged source state ready for aggregate rebuilding.
   */
  window.mergeImportedGoogleState = mergeImportedGoogleState;

  let DEFAULT_SHEET_ROW_COUNT = 1000;
  let AWARDS_SHEET_FIRST_YEAR = 1900;
  let AWARDS_SHEET_LAST_YEAR = 2029;

  function sheetListText(value) {
    return Array.isArray(value)
      ? value.filter(Boolean).join(", ")
      : String(value || "");
  }

  function sheetPositiveNumber(value) {
    let number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : "";
  }

  // "-" marks a film explicitly unranked; a blank Rank would make the next
  // sync invent an all-time rank from the row order.
  function watchedSheetRank(film) {
    if (film.suppressAllTimeRank) return "-";
    return (
      sheetPositiveNumber(film.allTimeRank) ||
      sheetPositiveNumber(film.rank) ||
      "-"
    );
  }

  let WATCHED_SHEET_COLUMNS = [
    {
      header: "Dynamic Rank",
      formula: (rowNumber) => `=SUBTOTAL(103, $C$2:C${rowNumber})`,
    },
    { header: "Rank", aliases: ["fixed rank"], value: watchedSheetRank },
    { header: "Year", value: (film) => sheetPositiveNumber(film.year) },
    { header: "Title", value: (film) => film.title || "" },
    {
      header: "Director",
      value: (film) => film.director || sheetListText(film.directors),
    },
    {
      header: "Rating",
      value: (film) => film.rating || window.renderFilmRating?.(film) || "",
    },
    {
      header: "Tag",
      aliases: ["tags"],
      value: (film) => sheetListText(film.tags),
    },
    { header: "Views", value: (film) => sheetPositiveNumber(film.views) },
    {
      header: "Date",
      aliases: ["date watched", "watched date"],
      value: (film) => film.dateWatched || "",
    },
    { header: "Platform", value: (film) => film.platform || "" },
  ];

  let WATCHLIST_SHEET_COLUMNS = [
    {
      header: "Name",
      aliases: ["title"],
      value: (item) => item.title || item.name || "",
    },
    { header: "Year", value: (item) => sheetPositiveNumber(item.year) },
    {
      header: "Director",
      value: (item) => item.director || sheetListText(item.directors),
    },
    { header: "Tier", aliases: ["rank"], value: (item) => item.tier || "" },
    {
      header: "Tag",
      aliases: ["tags"],
      value: (item) => sheetListText(item.tags),
    },
  ];

  let AWARDS_SHEET_HEADERS = [
    "Position",
    "Period",
    "Picture (1st half)",
    "Picture (2nd half)",
    "Director (Recipient)",
    "Director (Film)",
    "Cinematography (Recipient)",
    "Cinematography (Film)",
    "Original Screenplay (Recipient)",
    "Original Screenplay (Film)",
    "Adapted Screenplay (Recipient)",
    "Adapted Screenplay (Film)",
    "Lead Actor (Recipient)",
    "Lead Actor (Role)",
    "Lead Actor (Film)",
    "Lead Actress (Recipient)",
    "Lead Actress (Role)",
    "Lead Actress (Film)",
    "Supporting Actor (Recipient)",
    "Supporting Actor (Role)",
    "Supporting Actor (Film)",
    "Supporting Actress (Recipient)",
    "Supporting Actress (Role)",
    "Supporting Actress (Film)",
    "International Picture",
    "Animated Picture",
    "Score (Recipient)",
    "Score (Film)",
    "Song (Work)",
    "Song (Recipient)",
    "Song (Film)",
    "Casting",
    "Editing (Recipient)",
    "Editing (Film)",
    "Visual Effects",
    "Production Design",
    "Costume Design",
  ];

  // The ranked-list importer matches Watched columns by header name, so
  // only a missing header loses data; column order doesn't matter.
  function validateWatchedSheetSchema(values) {
    let header = (values || []).find((row) =>
      rowHasHeader(row, ["year", "title"]),
    );
    if (!header) return ['Watched has no header row with "Year" and "Title".'];
    let normalized = header
      .map(normalizeHeaderCell)
      .filter((value) => value !== "country");
    return WATCHED_SHEET_COLUMNS.filter(
      (column) =>
        !column.formula &&
        ![column.header, ...(column.aliases || [])].some((name) =>
          normalized.includes(normalizeHeaderCell(name)),
        ),
    ).map((column) => `Watched header is missing "${column.header}".`);
  }

  // Each film once (hydration lists a ranked film under both its year and
  // all-time), in all-time rank order with unranked films last.
  function watchedSheetFilms(state) {
    let seen = new Set();
    let films = [
      ...allSourceFilms(state),
      ...(state.watchedOther || []),
    ].filter((film) => {
      if (!film?.title) return false;
      let key =
        film.supabaseFilmId ||
        film.id ||
        `${film.year || ""}::${window.normalizeTitle(film.title)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    let rankOf = (film) => {
      let rank = watchedSheetRank(film);
      return rank === "-" ? Infinity : rank;
    };
    return films.sort(
      (left, right) =>
        rankOf(left) - rankOf(right) ||
        String(left.year || "").localeCompare(String(right.year || "")) ||
        String(left.title).localeCompare(String(right.title)),
    );
  }

  function sheetRows(columns, records) {
    return [
      columns.map((column) => column.header),
      ...records.map((record, index) =>
        columns.map((column) =>
          column.formula ? column.formula(index + 2) : column.value(record),
        ),
      ),
    ];
  }

  function awardsSheetPeriodBlocks() {
    let blocks = [];
    for (
      let year = AWARDS_SHEET_FIRST_YEAR;
      year <= AWARDS_SHEET_LAST_YEAR;
      year += 1
    )
      blocks.push({ periodType: "years", marker: "Year", value: String(year) });
    for (
      let decade = AWARDS_SHEET_FIRST_YEAR;
      decade <= AWARDS_SHEET_LAST_YEAR;
      decade += 10
    )
      blocks.push({
        periodType: "decades",
        marker: "Decade",
        value: `${decade}s`,
      });
    blocks.push(
      {
        periodType: "centuries",
        marker: "Century",
        value: "20th century (1900s)",
      },
      {
        periodType: "centuries",
        marker: "Century",
        value: "21st century (2000s)",
      },
      { periodType: "allTime", marker: "All-time", value: "" },
    );
    return blocks;
  }

  // Each block is one bracket: Position 1-N (the period's category
  // capacity), with the Period column's first two cells naming the period
  // type and value, as splitBracketSheetBlocks() and parseTable() read them.
  function awardsSheetLayoutRows(scopes = new Map()) {
    let blocks = awardsSheetPeriodBlocks();
    let existingKeys = new Set(
      blocks.map((block) => {
        let parsed = window.bracketPeriodFromMeta?.(block.marker, block.value);
        return parsed ? awardScope(parsed.periodType, parsed.year).key : "";
      }),
    );
    for (let scope of scopes.values()) {
      if (existingKeys.has(scope.key)) continue;
      blocks.push({
        periodType: scope.periodType,
        marker: awardScopeMarker(scope),
        value: scope.periodType === "allTime" ? "" : scope.year,
      });
      existingKeys.add(scope.key);
    }
    let rows = [];
    blocks.forEach((block) => {
      let parsed = window.bracketPeriodFromMeta?.(block.marker, block.value);
      let scopeKey = parsed
        ? awardScope(parsed.periodType, parsed.year).key
        : "";
      let nominations = scopes.get(scopeKey)?.nominations;
      let capacity = window.bracketCapacities(block.periodType).category;
      for (let position = 1; position <= capacity; position++) {
        let rowCells = [position];
        if (position === 1) {
          rowCells[1] = block.marker;
        } else if (position === 2 && block.value) {
          rowCells[1] = block.value;
        }
        if (nominations) {
          AWARDS_SHEET_HEADERS.slice(2).forEach((name, idx) => {
            let spec = awardColumnSpec(name);
            let placement = position + (spec.secondHalf ? capacity : 0);
            let val =
              nominations.get(`${spec.category}::${placement}`)?.[spec.field] ||
              "";
            if (val) rowCells[idx + 2] = val;
          });
        }
        rows.push(rowCells);
      }
    });
    return rows;
  }

  function sheetCellData(value) {
    return typeof value === "number"
      ? { userEnteredValue: { numberValue: value } }
      : { userEnteredValue: { stringValue: String(value ?? "") } };
  }

  function sheetHeaderRowData(headers, targetColumnCount = headers.length) {
    return {
      values: Array.from({ length: targetColumnCount }, (_, index) => ({
        userEnteredValue: {
          stringValue: index < headers.length ? headers[index] : "",
        },
        userEnteredFormat: { textFormat: { bold: true } },
      })),
    };
  }

  function sheetGridRows(
    columns,
    rows,
    targetColumnCount = columns.length,
    targetRowCount = rows.length,
  ) {
    let headerRow = sheetHeaderRowData(rows[0], targetColumnCount);
    let dataRows = rows.slice(1).map((row) => ({
      values: Array.from({ length: targetColumnCount }, (_, columnIndex) => {
        if (columnIndex < row.length) {
          return columns[columnIndex]?.formula
            ? { userEnteredValue: { formulaValue: row[columnIndex] } }
            : sheetCellData(row[columnIndex]);
        }
        return { userEnteredValue: { stringValue: "" } };
      }),
    }));
    let emptyRow = {
      values: Array.from({ length: targetColumnCount }, () => ({
        userEnteredValue: { stringValue: "" },
      })),
    };
    let paddedRows = [headerRow, ...dataRows];
    while (paddedRows.length < targetRowCount) {
      paddedRows.push(emptyRow);
    }
    return paddedRows;
  }

  function awardsSheetGridRows(films = []) {
    let scopes = films?.length
      ? archiveAwardScopes(films, { lenient: true })
      : new Map();
    let layoutRows = awardsSheetLayoutRows(scopes);
    return [
      sheetHeaderRowData(AWARDS_SHEET_HEADERS),
      ...layoutRows.map((row) =>
        row[0] === 1
          ? {
              values: AWARDS_SHEET_HEADERS.map((_, columnIndex) => ({
                ...(columnIndex < row.length &&
                row[columnIndex] !== undefined &&
                row[columnIndex] !== ""
                  ? sheetCellData(row[columnIndex])
                  : {}),
                userEnteredFormat: {
                  borders: { top: { style: "SOLID_MEDIUM" } },
                  ...(columnIndex === 1 ? { textFormat: { bold: true } } : {}),
                },
              })),
            }
          : {
              values: Array.from({ length: row.length }, (_, i) =>
                row[i] !== undefined && row[i] !== ""
                  ? sheetCellData(row[i])
                  : {},
              ),
            },
      ),
    ];
  }

  function sheetDefinition(title, rowData, columnCount, options = {}) {
    return {
      properties: {
        title,
        gridProperties: {
          rowCount: Math.max(rowData.length, options.minRowCount || 0),
          columnCount,
          frozenRowCount: 1,
          frozenColumnCount: options.frozenColumnCount || 0,
        },
      },
      data: [{ startRow: 0, startColumn: 0, rowData }],
    };
  }

  /**
   * Builds the spreadsheets.create payload for the Create on Google Drive
   * workbook: Watched, Watchlist, and a pre-laid-out Awards tab, each grid
   * exactly as wide as its columns.
   * @param {Object} [options] Workbook options.
   * @param {string} [options.title] Document title.
   * @param {boolean} [options.populateFromArchive] Whether to fill Watched and Watchlist from window.state.
   * @param {FilmRecord[]} [options.films] Explicit films for the Watched tab.
   * @param {WatchlistItem[]} [options.watchlist] Explicit items for the Watchlist tab.
   * @returns {Object} Sheets API Spreadsheet resource.
   */
  function buildGoogleSheetsWorkbook(options = {}) {
    let films =
      options.films ||
      (options.populateFromArchive
        ? watchedSheetFilms(window.state || {})
        : []);
    let watchlist =
      options.watchlist ||
      (options.populateFromArchive ? window.state?.watchlist || [] : []);
    let awardsRows = awardsSheetGridRows(films);
    return {
      properties: {
        title: options.title || "The Oskars — Film Archive & Awards",
      },
      sheets: [
        sheetDefinition(
          "Watched",
          sheetGridRows(
            WATCHED_SHEET_COLUMNS,
            sheetRows(WATCHED_SHEET_COLUMNS, films),
          ),
          WATCHED_SHEET_COLUMNS.length,
          { minRowCount: DEFAULT_SHEET_ROW_COUNT, frozenColumnCount: 4 },
        ),
        sheetDefinition(
          "Watchlist",
          sheetGridRows(
            WATCHLIST_SHEET_COLUMNS,
            sheetRows(WATCHLIST_SHEET_COLUMNS, watchlist),
          ),
          WATCHLIST_SHEET_COLUMNS.length,
          { minRowCount: DEFAULT_SHEET_ROW_COUNT, frozenColumnCount: 2 },
        ),
        sheetDefinition("Awards", awardsRows, AWARDS_SHEET_HEADERS.length, {
          frozenColumnCount: 2,
        }),
      ],
    };
  }

  /**
   * Creates a new Google Spreadsheet document on the user's Google Drive
   * from buildGoogleSheetsWorkbook().
   * @param {Object} [options] Creation options.
   * @param {string} [options.title] Document title.
   * @param {boolean} [options.populateFromArchive] Whether to populate rows from existing films and watchlist.
   * @param {string} [options.accessToken] Active Google OAuth access token.
   * @param {FilmRecord[]} [options.films] Optional explicit films to populate.
   * @param {WatchlistItem[]} [options.watchlist] Optional explicit watchlist items to populate.
   * @returns {Promise<{spreadsheetId: string, spreadsheetUrl: string, title: string}>} Created spreadsheet info.
   */
  async function createGoogleSheetsDocument(options = {}) {
    let accessToken =
      options.accessToken ||
      (await requestGoogleAccessToken({
        write: true,
        scope: GOOGLE_SHEETS_WRITE_SCOPE,
      }));

    let payload = buildGoogleSheetsWorkbook(options);
    let title = payload.properties.title;

    let response = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      let errText = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets creation failed (${response.status}): ${errText}`.trim(),
      );
    }

    let created = await response.json();
    let spreadsheetId = created.spreadsheetId;
    let spreadsheetUrl =
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;

    return {
      spreadsheetId,
      spreadsheetUrl,
      title: created.properties?.title || title,
    };
  }

  /**
   * Fetches metadata for a Google Spreadsheet: its title, tab names, and each tab's id and grid size.
   * @param {string} spreadsheetId Target spreadsheet ID.
   * @param {string} accessToken Active Google OAuth access token.
   * @returns {Promise<{title: string, sheetTitles: string[], sheets: Array<{sheetId: number, title: string, rowCount: number, columnCount: number}>}>} Document metadata.
   */
  async function fetchGoogleSpreadsheetMetadata(spreadsheetId, accessToken) {
    let response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      let text = await response.text().catch(() => "");
      throw new Error(
        `Google Sheets metadata lookup failed (${response.status}): ${text}`.trim(),
      );
    }
    let data = await response.json();
    let sheets = (data.sheets || [])
      .map((sheet) => sheet.properties || {})
      .filter((properties) => properties.title)
      .map((properties) => ({
        sheetId: properties.sheetId,
        title: properties.title,
        rowCount: Number(properties.gridProperties?.rowCount) || 0,
        columnCount: Number(properties.gridProperties?.columnCount) || 0,
      }));
    return {
      title: data.properties?.title || "Untitled Spreadsheet",
      sheetTitles: sheets.map((sheet) => sheet.title),
      sheets,
    };
  }

  // Plans stay in this browser session; OAuth tokens are never part of a plan.
  let archivePushPlans = new WeakMap();

  function archivePushSource(options = {}) {
    return {
      films: options.films || watchedSheetFilms(window.state || {}),
      watchlist: options.watchlist || window.state?.watchlist || [],
    };
  }

  function archivePushRevision(source) {
    return JSON.stringify(source);
  }

  async function archivePushSnapshot(spreadsheetId, accessToken) {
    let metadata = await fetchGoogleSpreadsheetMetadata(
      spreadsheetId,
      accessToken,
    );
    let sheets = metadata.sheets
      .filter((sheet) =>
        ["Watched", "Watchlist", "Awards"].includes(sheet.title),
      )
      .sort((left, right) => left.title.localeCompare(right.title));
    let data = sheets.length
      ? await fetchSheetValues(
          spreadsheetId,
          sheets.map((sheet) => `'${sheet.title}'`),
          accessToken,
          { valueRenderOption: "FORMULA" },
        )
      : { valueRanges: [] };
    return sheets.map((sheet, index) => ({
      ...sheet,
      rows: data.valueRanges[index]?.values || [],
    }));
  }

  function awardScope(type, value) {
    let periodType = window.normalizeAwardPeriodType(type);
    let year =
      periodType === "allTime" ? "alltime" : String(value || "").trim();
    let number = Number(year.replace(/s$/, ""));
    if (
      !["years", "decades", "centuries", "allTime"].includes(periodType) ||
      (periodType !== "allTime" &&
        (!/^\d{4}s?$/.test(year) ||
          number <= 0 ||
          (periodType === "years"
            ? /s$/.test(year)
            : !/s$/.test(year) ||
              number % (periodType === "decades" ? 10 : 100) !== 0)))
    )
      throw new Error(`Invalid Awards period: ${type} ${value}.`);
    return { periodType, year, key: `${periodType}::${year}` };
  }

  function awardColumnSpec(header) {
    let match = header.match(/^(.+?)(?: \((.+)\))?$/);
    return {
      category: `Best ${match[1]}`,
      field:
        match[2] === "Recipient"
          ? "recipient"
          : ["Role", "Work"].includes(match[2])
            ? "detail"
            : "film",
      secondHalf: match[2] === "2nd half",
    };
  }

  function archiveAwardScopes(films, options = {}) {
    let scopes = new Map();
    let categories = new Set(
      AWARDS_SHEET_HEADERS.slice(2).map(
        (header) => awardColumnSpec(header).category,
      ),
    );
    films.forEach((film) =>
      (film.awards || []).forEach((award) => {
        let scope;
        try {
          scope = awardScope(window.getAwardPeriodType(award), award.year);
        } catch (err) {
          if (options.lenient) return;
          throw err;
        }
        let capacity = window.bracketCapacities(scope.periodType);
        let placement = Number(award.placement);
        if (
          !categories.has(award.category) ||
          !Number.isInteger(placement) ||
          placement < 1 ||
          placement >
            (award.category === "Best Picture"
              ? capacity.picture
              : capacity.category)
        ) {
          if (options.lenient) return;
          throw new Error(
            `Cannot export Awards placement: ${scope.year} ${award.category} #${award.placement}.`,
          );
        }
        if (!scopes.has(scope.key))
          scopes.set(scope.key, { ...scope, nominations: new Map() });
        let nominations = scopes.get(scope.key).nominations;
        let key = `${award.category}::${placement}`;
        if (nominations.has(key)) {
          if (options.lenient) return;
          throw new Error(
            `Multiple films share Awards ${scope.year} ${award.category} #${placement}. Resolve this placement before pushing.`,
          );
        }
        nominations.set(key, {
          film: film.title,
          recipient:
            award.recipientText ||
            (award.recipients || [])
              .map((recipient) => recipient.name)
              .join(", "),
          detail: award.detail || "",
        });
      }),
    );
    return scopes;
  }

  function awardScopeMarker(scope) {
    return {
      years: "Year",
      decades: "Decade",
      centuries: "Century",
      allTime: "All-time",
    }[scope.periodType];
  }

  function awardsPushRequests(sheet, scopes) {
    let requests = [];
    let changes = [];
    let rows = sheet.rows;
    let empty = !rows.some((row) =>
      row.some((cell) => String(cell ?? "").trim()),
    );
    let header = empty
      ? AWARDS_SHEET_HEADERS
      : (rows[0] || []).map((cell) => String(cell).trim());
    let columns = AWARDS_SHEET_HEADERS.map((name) => {
      let matches = header
        .map((cell, index) => (cell === name ? index : -1))
        .filter((index) => index >= 0);
      if (matches.length !== 1)
        throw new Error(
          `Awards must have exactly one "${name}" column. No changes were written.`,
        );
      return matches[0];
    });
    let positionColumn = columns[0];
    let periodColumn = columns[1];
    let blocks = new Map();
    let populated = (row) =>
      columns.some((column) => String(row?.[column] ?? "").trim());
    for (let row = 1; row < rows.length; row++) {
      let marker = String(rows[row]?.[periodColumn] || "").trim();
      if (!/^(Year|Decade|Century|All-time)$/i.test(marker)) {
        if (populated(rows[row]))
          throw new Error(
            `Awards row ${row + 1} is outside a valid period block. No changes were written.`,
          );
        continue;
      }
      let parsed = window.bracketPeriodFromMeta(
        marker,
        rows[row + 1]?.[periodColumn],
      );
      let scope = awardScope(parsed.periodType, parsed.year);
      if (blocks.has(scope.key))
        throw new Error(
          `Awards has duplicate ${marker} ${scope.year} blocks. No changes were written.`,
        );
      let capacity = window.bracketCapacities(scope.periodType).category;
      let positions = new Map();
      for (let offset = 0; offset < capacity; offset++) {
        let sourceRow = rows[row + offset];
        let position = Number(sourceRow?.[positionColumn]);
        if (
          !Number.isInteger(position) ||
          position < 1 ||
          position > capacity ||
          positions.has(position) ||
          (offset > 0 &&
            /^(Year|Decade|Century|All-time)$/i.test(
              String(sourceRow?.[periodColumn] || "").trim(),
            ))
        )
          throw new Error(
            `Awards ${marker} ${scope.year} needs each Position 1–${capacity} exactly once. No changes were written.`,
          );
        positions.set(position, row + offset);
      }
      blocks.set(scope.key, { ...scope, positions });
      row += capacity - 1;
    }
    let nextRow = Math.max(rows.length, 1);
    if (empty && scopes.size)
      requests.push({
        updateCells: {
          start: { sheetId: sheet.sheetId, rowIndex: 0, columnIndex: 0 },
          rows: [sheetHeaderRowData(header)],
          fields: "userEnteredValue",
        },
      });
    for (let scope of scopes.values()) {
      if (blocks.has(scope.key)) continue;
      let capacity = window.bracketCapacities(scope.periodType).category;
      let positions = new Map();
      for (let position = 1; position <= capacity; position++) {
        positions.set(position, nextRow);
        let values = Array.from({ length: header.length }, () => ({}));
        values[positionColumn] = sheetCellData(position);
        values[periodColumn] = sheetCellData(
          position === 1
            ? awardScopeMarker(scope)
            : position === 2 && scope.periodType !== "allTime"
              ? scope.year
              : "",
        );
        requests.push({
          updateCells: {
            start: {
              sheetId: sheet.sheetId,
              rowIndex: nextRow++,
              columnIndex: 0,
            },
            rows: [{ values }],
            fields: "userEnteredValue",
          },
        });
      }
      blocks.set(scope.key, { ...scope, positions });
      changes.push(`Add ${awardScopeMarker(scope)} ${scope.year} block.`);
    }
    let awardsPushed = 0;
    let awardsCleared = 0;
    for (let block of blocks.values()) {
      let nominations = scopes.get(block.key)?.nominations || new Map();
      awardsPushed += nominations.size;
      let capacity = window.bracketCapacities(block.periodType).category;
      AWARDS_SHEET_HEADERS.slice(2).forEach((name, index) => {
        let column = columns[index + 2];
        let spec = awardColumnSpec(name);
        for (let [position, row] of block.positions) {
          let placement = position + (spec.secondHalf ? capacity : 0);
          let value =
            nominations.get(`${spec.category}::${placement}`)?.[spec.field] ||
            "";
          let current = rows[row]?.[column] ?? "";
          if (String(current) === String(value)) continue;
          if (spec.field === "film" && current && !value) awardsCleared++;
          changes.push(
            `${awardScopeMarker(block)} ${block.year} · ${name} #${placement}: ${current || "(empty)"} → ${value || "(empty)"}`,
          );
          requests.push({
            updateCells: {
              start: {
                sheetId: sheet.sheetId,
                rowIndex: row,
                columnIndex: column,
              },
              rows: [{ values: [value === "" ? {} : sheetCellData(value)] }],
              fields: "userEnteredValue",
            },
          });
        }
      });
    }
    let growRequests =
      nextRow > sheet.rowCount
        ? [
            {
              appendDimension: {
                sheetId: sheet.sheetId,
                dimension: "ROWS",
                length: nextRow - sheet.rowCount,
              },
            },
          ]
        : [];
    if (header.length > sheet.columnCount)
      growRequests.push({
        appendDimension: {
          sheetId: sheet.sheetId,
          dimension: "COLUMNS",
          length: header.length - sheet.columnCount,
        },
      });
    return {
      requests: [...growRequests, ...requests],
      changes,
      awardsPushed,
      awardsCleared,
    };
  }

  /**
   * Previews a connected workbook push, validating Awards blocks and capturing the reviewed archive and Sheet values.
   * @param {string} spreadsheetId Target spreadsheet ID.
   * @param {Object} [options] Optional access token, films and watchlist overrides.
   * @returns {Promise<Object>} Session-only review summary and proposed Awards cell changes.
   */
  async function previewGoogleSpreadsheetArchive(spreadsheetId, options = {}) {
    let accessToken = options.accessToken || (await requestGoogleAccessToken());
    let snapshot = await archivePushSnapshot(spreadsheetId, accessToken);
    let source = archivePushSource(options);
    let scopes = archiveAwardScopes(source.films);
    let requests = [];
    let summary = {
      filmsPushed: 0,
      watchlistPushed: 0,
      awardsPushed: 0,
      awardsCleared: 0,
    };
    let warnings = [];
    for (let tab of [
      {
        title: "Watched",
        columns: WATCHED_SHEET_COLUMNS,
        records: source.films,
        count: "filmsPushed",
      },
      {
        title: "Watchlist",
        columns: WATCHLIST_SHEET_COLUMNS,
        records: source.watchlist,
        count: "watchlistPushed",
      },
    ]) {
      let sheet = snapshot.find((entry) => entry.title === tab.title);
      if (!sheet || !tab.records.length) {
        warnings.push(
          `${tab.title}: left untouched (${!sheet ? "missing tab" : "empty app collection"}).`,
        );
        continue;
      }
      let rows = sheetRows(tab.columns, tab.records);
      let rowCount = Math.max(rows.length, sheet.rowCount);
      let columnCount = Math.max(tab.columns.length, sheet.columnCount);
      if (rows.length > sheet.rowCount)
        requests.push({
          appendDimension: {
            sheetId: sheet.sheetId,
            dimension: "ROWS",
            length: rows.length - sheet.rowCount,
          },
        });
      if (tab.columns.length > sheet.columnCount)
        requests.push({
          appendDimension: {
            sheetId: sheet.sheetId,
            dimension: "COLUMNS",
            length: tab.columns.length - sheet.columnCount,
          },
        });
      requests.push({
        updateCells: {
          range: {
            sheetId: sheet.sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: columnCount,
          },
          rows: sheetGridRows(tab.columns, rows, columnCount, rowCount),
          fields: "userEnteredValue",
        },
      });
      summary[tab.count] = tab.records.length;
    }
    let awardsSheet = snapshot.find((sheet) => sheet.title === "Awards");
    if (!awardsSheet && scopes.size) {
      let sheetId = Math.max(0, ...snapshot.map((sheet) => sheet.sheetId)) + 1;
      // Let Google allocate an id outside every tab in the workbook.
      let metadata = await fetchGoogleSpreadsheetMetadata(
        spreadsheetId,
        accessToken,
      );
      sheetId = Math.max(
        sheetId,
        ...metadata.sheets.map((sheet) => sheet.sheetId + 1),
      );
      awardsSheet = {
        sheetId,
        rows: [],
        rowCount: 1,
        columnCount: AWARDS_SHEET_HEADERS.length,
      };
      requests.push({
        addSheet: {
          properties: {
            sheetId,
            title: "Awards",
            gridProperties: {
              rowCount: 1,
              columnCount: AWARDS_SHEET_HEADERS.length,
              frozenRowCount: 1,
              frozenColumnCount: 2,
            },
          },
        },
      });
    }
    let awards = awardsSheet
      ? awardsPushRequests(awardsSheet, scopes)
      : { requests: [], changes: [], awardsPushed: 0, awardsCleared: 0 };
    requests.push(...awards.requests);
    summary.awardsPushed = awards.awardsPushed;
    summary.awardsCleared = awards.awardsCleared;
    let plan = {
      spreadsheetId,
      ...summary,
      warnings,
      awardChanges: awards.changes,
      hasChanges: requests.length > 0,
    };
    archivePushPlans.set(plan, {
      spreadsheetId,
      snapshot,
      sourceRevision: archivePushRevision(source),
      requests,
      summary,
    });
    return plan;
  }

  /**
   * Applies a reviewed workbook push after checking the archive and live Sheet for changes, using one atomic batch.
   * @param {string} spreadsheetId Target spreadsheet ID.
   * @param {Object} options Reviewed plan and optional access token, films and watchlist overrides.
   * @returns {Promise<Object>} Counts of exported films, watchlist items and awards.
   */
  async function writeGoogleSpreadsheetArchive(spreadsheetId, options = {}) {
    let reviewed = archivePushPlans.get(options.plan);
    if (!reviewed || reviewed.spreadsheetId !== spreadsheetId)
      throw new Error("Preview the archive push before applying it.");
    let accessToken =
      options.accessToken ||
      (await requestGoogleAccessToken({
        write: true,
        scope: GOOGLE_SHEETS_WRITE_SCOPE,
      }));
    let snapshot = await archivePushSnapshot(spreadsheetId, accessToken);
    let sheetChanged =
      JSON.stringify(snapshot) !== JSON.stringify(reviewed.snapshot);
    let archiveChanged =
      archivePushRevision(archivePushSource(options)) !==
      reviewed.sourceRevision;
    if (sheetChanged || archiveChanged) {
      archivePushPlans.delete(options.plan);
      let target =
        sheetChanged && archiveChanged
          ? "The Sheet and archive"
          : sheetChanged
            ? "The Sheet"
            : "The archive";
      throw new Error(
        `${target} changed after preview. Preview the push again before applying it.`,
      );
    }
    if (reviewed.requests.length)
      await batchUpdateSpreadsheet(
        spreadsheetId,
        reviewed.requests,
        accessToken,
      );
    archivePushPlans.delete(options.plan);
    return reviewed.summary;
  }

  /**
   * Builds an ImportProposal from Google Spreadsheet data.
   * @param {Object} spreadsheetData Data fetched from Google Sheets.
   * @param {string[][]} [spreadsheetData.watchedRows] Rows from the Watched sheet.
   * @param {string[][]} [spreadsheetData.watchlistRows] Rows from the Watchlist sheet.
   * @param {string[][]} [spreadsheetData.awardsRows] Rows from the Awards sheet.
   * @param {string} [spreadsheetData.watchedRaw] Optional raw CSV/TSV for watched rows.
   * @param {string} [spreadsheetData.watchlistRaw] Optional raw CSV/TSV for watchlist rows.
   * @param {string} [spreadsheetData.awardsRaw] Optional raw CSV/TSV for awards rows.
   * @param {Object} [options] Proposal options.
   * @param {string} [options.spreadsheetId] Google Spreadsheet ID.
   * @param {string} [options.sourceName] Friendly name for report.
   * @param {'merge'|'replace'} [options.mode] Merge mode (defaults to 'merge').
   * @returns {ImportProposal} The reviewed import proposal.
   */
  function proposeGoogleSpreadsheetSync(spreadsheetData, options = {}) {
    let mode = options.mode === "replace" ? "replace" : "merge";
    let baseState = window.cloneRecord(window.state);
    let watchedRows = spreadsheetData.watchedRows || [];
    let watchlistRows = spreadsheetData.watchlistRows || [];
    let awardsRows = spreadsheetData.awardsRows || [];

    let watchedRaw =
      spreadsheetData.watchedRaw ||
      (watchedRows.length ? rowsToDelimited(watchedRows, ",") : "");
    let watchlistRaw =
      spreadsheetData.watchlistRaw ||
      (watchlistRows.length ? rowsToDelimited(watchlistRows, ",") : "");
    let awardsRaw =
      spreadsheetData.awardsRaw ||
      (awardsRows.length ? rowsToDelimited(awardsRows, "\t") : "");

    try {
      window.state =
        mode === "replace"
          ? window.createClearedLocalState()
          : window.cloneRecord(baseState);
      window.rebuildAggregates?.();

      let combinedReport = {
        source: options.sourceName || "Google Sheets",
        sourceKind: "google-sheets",
        filmsParsed: 0,
        filmsAdded: 0,
        filmsMerged: 0,
        awardsAdded: 0,
        awardsRejected: 0,
        ruleWarnings: 0,
        skipped: 0,
        periods: [],
        warnings: [],
        titleVariants: [],
        ruleViolations: [],
        ruleWarningDetails: [],
        skippedDetails: [],
        missingAllTimeFilms: [],
        newFilmDetails: [],
        rankChanges: [],
        awardChanges: [],
        preservedFieldDetails: [],
        sourceConflicts: [],
        watchlistItemsParsed: 0,
        watchlistItemsAdded: 0,
        watchlistItemsUpdated: 0,
      };

      function collectDetails(report, source) {
        combinedReport.ruleWarnings += report.ruleWarnings || 0;
        [
          "titleVariants",
          "ruleViolations",
          "ruleWarningDetails",
          "skippedDetails",
          "missingAllTimeFilms",
          "newFilmDetails",
          "rankChanges",
          "awardChanges",
          "preservedFieldDetails",
          "sourceConflicts",
        ].forEach((key) => {
          combinedReport[key].push(
            ...(report[key] || []).map((detail) => ({
              ...detail,
              source,
            })),
          );
        });
      }

      if (watchedRows && watchedRows.length > 0) {
        combinedReport.warnings.push(
          ...validateWatchedSheetSchema(watchedRows),
        );
      }

      if (watchlistRows && watchlistRows.length > 0) {
        let watchlistSchemaWarnings = validateWatchlistSchema(watchlistRows, {
          key: "Watchlist",
        });
        if (watchlistSchemaWarnings && watchlistSchemaWarnings.length > 0) {
          combinedReport.warnings.push(...watchlistSchemaWarnings);
        }
      }

      if (awardsRows && awardsRows.length > 0) {
        let awardsSchemaWarnings = validateBracketSchema(awardsRows, {
          key: "Awards",
        });
        if (awardsSchemaWarnings && awardsSchemaWarnings.length > 0) {
          combinedReport.warnings.push(...awardsSchemaWarnings);
        }
      }

      if (watchedRaw && watchedRaw.trim()) {
        let diaryReport = window.importData(watchedRaw, "ranked", {
          confirmDerivedRanks: true,
          render: false,
          silentReport: true,
          checkEligibility: false,
        });
        if (diaryReport) {
          collectDetails(diaryReport, "Watched");
          combinedReport.filmsParsed += diaryReport.filmsParsed || 0;
          combinedReport.filmsAdded += diaryReport.filmsAdded || 0;
          combinedReport.filmsMerged += diaryReport.filmsMerged || 0;
          combinedReport.skipped += diaryReport.skipped || 0;
          if (diaryReport.warnings)
            combinedReport.warnings.push(...diaryReport.warnings);
          if (diaryReport.periods) {
            combinedReport.periods = Array.from(
              new Set([
                ...combinedReport.periods,
                ...Array.from(diaryReport.periods),
              ]),
            );
          }
        }
      }

      if (watchlistRaw && watchlistRaw.trim()) {
        let watchlistReport = window.importData(watchlistRaw, "watchlist", {
          render: false,
          silentReport: true,
          checkEligibility: false,
        });
        if (watchlistReport) {
          collectDetails(watchlistReport, "Watchlist");
          combinedReport.watchlistItemsParsed +=
            watchlistReport.watchlistItemsParsed ||
            watchlistReport.filmsParsed ||
            0;
          combinedReport.watchlistItemsAdded +=
            watchlistReport.watchlistItemsAdded ||
            watchlistReport.filmsAdded ||
            0;
          combinedReport.watchlistItemsUpdated +=
            watchlistReport.watchlistItemsUpdated ||
            watchlistReport.filmsMerged ||
            0;
          if (watchlistReport.warnings)
            combinedReport.warnings.push(...watchlistReport.warnings);
        }
      }

      if (awardsRaw && awardsRaw.trim()) {
        // A populated ballot replaces its prior placements, so a reorder or
        // changed recipient cannot accumulate another version of the award.
        // Starter blocks with no award cells leave existing ballots alone;
        // a dash explicitly marks an empty ballot/category for replacement.
        let header = awardsRows[0] || [];
        let categories = new Set(
          AWARDS_SHEET_HEADERS.slice(2)
            .filter((name) => header.includes(name))
            .map((name) => awardColumnSpec(name).category),
        );
        let scopes = new Set(
          window
            .splitBracketSheetBlocks(awardsRows)
            .filter((block) =>
              block.rows
                .slice(1)
                .some((row) =>
                  block.rows[0].some(
                    (name, column) =>
                      column >= 2 &&
                      AWARDS_SHEET_HEADERS.includes(name) &&
                      String(row[column] ?? "").trim(),
                  ),
                ),
            )
            .map((block) => {
              let meta = window.bracketPeriodFromMeta(
                block.rows[1]?.[1],
                block.rows[2]?.[1],
              );
              return `${meta.periodType}::${meta.year}`;
            }),
        );
        let films = new Set([
          ...allSourceFilms(window.state),
          ...(window.state.watchedOther || []),
          ...Object.values(window.state.filmsById || {}),
        ]);
        films.forEach((film) => {
          film.awards = (film.awards || []).filter(
            (award) =>
              !categories.has(award.category) ||
              !scopes.has(`${window.getAwardPeriodType(award)}::${award.year}`),
          );
        });
        let awardsReport = window.importData(awardsRaw, "table", {
          render: false,
          silentReport: true,
          checkEligibility: false,
        });
        if (awardsReport) {
          collectDetails(awardsReport, "Awards");
          combinedReport.awardsAdded += awardsReport.awardsAdded || 0;
          combinedReport.awardsRejected += awardsReport.awardsRejected || 0;
          combinedReport.filmsParsed += awardsReport.filmsParsed || 0;
          combinedReport.filmsAdded += awardsReport.filmsAdded || 0;
          combinedReport.filmsMerged += awardsReport.filmsMerged || 0;
          if (awardsReport.warnings)
            combinedReport.warnings.push(...awardsReport.warnings);
          if (awardsReport.periods) {
            combinedReport.periods = Array.from(
              new Set([
                ...combinedReport.periods,
                ...Array.from(awardsReport.periods),
              ]),
            );
          }
        }
      }

      return window.createImportProposal({
        sourceKind: "google-sheets",
        mode,
        baseState,
        candidateState: window.state,
        report: combinedReport,
        sourceRevision: window.canonicalDataRevision({
          diaryRaw: watchedRaw,
          watchlistRaw,
          awardsRaw,
        }),
        sourceConfig: {
          spreadsheetId: String(options.spreadsheetId || ""),
          sourceName: String(options.sourceName || "Google Sheets"),
        },
      });
    } finally {
      window.state = baseState;
      window.rebuildAggregates?.();
    }
  }

  /**
   * Translates low-level Google Sheets / Drive API or network error strings into friendly, actionable user messages.
   * @param {*} error Caught error object or string.
   * @param {string} [defaultMessage] Optional fallback message.
   * @returns {string} Human-readable actionable error message.
   */
  function formatGoogleSheetsError(error, defaultMessage) {
    let raw = error?.message || String(error || "");
    if (!raw)
      return (
        defaultMessage || "An error occurred communicating with Google Sheets."
      );

    if (/401\b|unauthenticated|invalid_grant|token expired/i.test(raw)) {
      return (window.uiText || ((s) => s))(
        "Google authorization expired or invalid. Please reconnect your Google account and try again.",
      );
    }
    if (/403\b|permission_denied|insufficientPermissions|quota/i.test(raw)) {
      if (/quota|resource_exhausted/i.test(raw)) {
        return (window.uiText || ((s) => s))(
          "Google Drive or Sheets quota exceeded (403). Please free up space or wait before trying again.",
        );
      }
      return (window.uiText || ((s) => s))(
        "Access denied (403). Make sure your Google account has permission to access or edit this spreadsheet.",
      );
    }
    if (/404\b|not_found|requested entity was not found/i.test(raw)) {
      return (window.uiText || ((s) => s))(
        "Spreadsheet not found (404). Please verify that the spreadsheet ID or URL is correct and shared with your account.",
      );
    }
    if (/429\b|rate.?limit/i.test(raw)) {
      return (window.uiText || ((s) => s))(
        "Google Sheets API rate limit exceeded. Please wait a moment before trying again.",
      );
    }
    if (/popup_blocked_by_browser/i.test(raw)) {
      return (window.uiText || ((s) => s))(
        "Google sign-in popup was blocked by your browser. Please allow popups for this site and try again.",
      );
    }
    if (/timeout|timed out/i.test(raw)) {
      return (window.uiText || ((s) => s))(
        "Google sign-in or request timed out. Please check your network connection and try again.",
      );
    }
    return raw;
  }

  // Exposed for src/data/google-sheets-supabase-import.js (issue #469) -
  // that file reuses this OAuth/fetch plumbing directly rather than
  // duplicating it, but writes to Supabase instead of merging into
  // window.state (issue #565). No behavior change to any of these
  // functions themselves.
  window.loadGoogleIdentity = loadGoogleIdentity;
  window.requestGoogleAccessToken = requestGoogleAccessToken;
  window.fetchGoogleSheetValues = fetchSheetValues;
  window.writeGoogleSheetValues = writeSheetValues;
  window.batchUpdateGoogleSheetValues = batchUpdateSheetValues;
  window.batchUpdateGoogleSpreadsheet = batchUpdateSpreadsheet;
  window.rowsToDelimited = rowsToDelimited;
  window.rowsToPlainDelimited = rowsToPlainDelimited;
  window.buildGoogleSheetsWorkbook = buildGoogleSheetsWorkbook;
  window.createGoogleSheetsDocument = createGoogleSheetsDocument;
  window.fetchGoogleSpreadsheetMetadata = fetchGoogleSpreadsheetMetadata;
  window.previewGoogleSpreadsheetArchive = previewGoogleSpreadsheetArchive;
  window.writeGoogleSpreadsheetArchive = writeGoogleSpreadsheetArchive;
  window.proposeGoogleSpreadsheetSync = proposeGoogleSpreadsheetSync;
  window.validateWatchedSheetSchema = validateWatchedSheetSchema;
  window.validateWatchlistSchema = validateWatchlistSchema;
  window.formatGoogleSheetsError = formatGoogleSheetsError;

  function maybeResumeGoogleSheetsRedirect() {
    if (!isRedirectSignIn()) return;
    let response = parseGoogleOAuthResponse();
    if (!response || !response.accessToken) return;
    if (!verifyGoogleOAuthState(response.state)) {
      clearGoogleOAuthResponseFromUrl();
      clearStoredGoogleAccessToken();
      return;
    }
    storeGoogleAccessToken(response.accessToken, response.expiresIn);
    clearGoogleOAuthResponseFromUrl();
  }

  maybeResumeGoogleSheetsRedirect();
})();
