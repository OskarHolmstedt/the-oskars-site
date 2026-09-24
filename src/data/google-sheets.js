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

  function getStoredGoogleAccessToken(requiredScope = GOOGLE_SHEETS_READ_SCOPE) {
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
    let clientId = window.OSKARS_LOCAL_CONFIG?.googleClientId;
    if (!clientId)
      throw new Error("Missing googleClientId in config.local.js.");
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
    let normalized = header.map(normalizeHeaderCell);
    let hasFixedRank = normalized.includes("fixed rank");
    let hasDynamicRank = normalized.includes("dynamic rank");
    let expected;
    let aliases = {
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
        "country",
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
        "country",
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
        "country",
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
        "country",
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
    let normalized = header.map(normalizeHeaderCell);
    let hasHeader = normalized.some((value) =>
      ["date", "name", "year", "letterboxd uri", "letterboxd url"].includes(
        value,
      ),
    );
    if (!hasHeader) return warnings;
    ["date", "name", "year"].forEach((headerName) => {
      if (!normalized.includes(headerName))
        warnings.push(`${spec.key} header is missing "${headerName}".`);
    });
    if (
      !normalized.includes("letterboxd uri") &&
      !normalized.includes("letterboxd url")
    ) {
      warnings.push(`${spec.key} header is missing "Letterboxd URI".`);
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
    let normalized = header.map(normalizeHeaderCell);
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
      "country",
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

  async function fetchSheetValues(spreadsheetId, ranges, accessToken, options = {}) {
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

