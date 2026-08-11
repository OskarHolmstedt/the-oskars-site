/**
 * @file Owns Google Sheets OAuth, configured range fetching and validation,
 * replace/merge imports, and post-import consistency snapshots.
 */

(function () {
  let GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
  let GOOGLE_SHEETS_SCOPE =
    "https://www.googleapis.com/auth/spreadsheets.readonly";
  let googleIdentityPromise = null;
  let googleAccessToken = "";
  let OAUTH_STATE_KEY = "oskarsGoogleSheetsOAuthState";
  let OAUTH_TOKEN_KEY = "oskarsGoogleSheetsAccessToken";
  let OAUTH_TOKEN_EXPIRES_KEY = "oskarsGoogleSheetsAccessTokenExpiresAt";
  let OAUTH_PENDING_IMPORT_KEY = "oskarsGoogleSheetsPendingImport";

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

  function getStoredGoogleAccessToken() {
    let token = sessionStorage.getItem(OAUTH_TOKEN_KEY);
    let expiresAt = Number(
      sessionStorage.getItem(OAUTH_TOKEN_EXPIRES_KEY) || 0,
    );
    if (token && expiresAt > Date.now() + 30000) {
      googleAccessToken = token;
      return token;
    }
    clearStoredGoogleAccessToken();
    return null;
  }

  function storeGoogleAccessToken(token, expiresIn) {
    googleAccessToken = String(token || "");
    sessionStorage.setItem(OAUTH_TOKEN_KEY, googleAccessToken);
    sessionStorage.setItem(
      OAUTH_TOKEN_EXPIRES_KEY,
      String(Date.now() + (Number(expiresIn) || 0) * 1000),
    );
    sessionStorage.removeItem(OAUTH_STATE_KEY);
  }

  function clearStoredGoogleAccessToken() {
    googleAccessToken = "";
    sessionStorage.removeItem(OAUTH_TOKEN_KEY);
    sessionStorage.removeItem(OAUTH_TOKEN_EXPIRES_KEY);
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

  function storePendingGoogleSheetsImport(options) {
    if (!options) return;
    sessionStorage.setItem(
      OAUTH_PENDING_IMPORT_KEY,
      JSON.stringify({
        replace: Boolean(options.replace),
        merge: Boolean(options.merge),
        foundation: Boolean(options.foundation),
      }),
    );
  }

  function consumePendingGoogleSheetsImport() {
    let raw = sessionStorage.getItem(OAUTH_PENDING_IMPORT_KEY);
    sessionStorage.removeItem(OAUTH_PENDING_IMPORT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function configuredRanges() {
    let ranges = googleSheetsConfig().ranges || {};
    let combinedBracketRange =
      ranges.bracketBlocks || ranges.brackets || ranges.yearBrackets;
    let combinedBracketKey = ranges.bracketBlocks
      ? "bracketBlocks"
      : ranges.brackets
        ? "brackets"
        : ranges.yearBrackets
          ? "yearBrackets"
          : "";
    let bracketRanges = combinedBracketRange
      ? [[combinedBracketKey, "table", null, combinedBracketRange]]
      : [];
    return [
      ["allTimeRankedList", "list"],
      ...bracketRanges,
      ["watchlist", "watchlist"],
      ["franchises", "franchises"],
      ["directors", "directors"],
    ]
      .map(([key, importType, periodTypeHint, explicitRange]) => ({
        key,
        importType,
        periodTypeHint,
        range: explicitRange || ranges[key],
      }))
      .filter((item) => item.range);
  }

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

  let GOOGLE_SIGN_IN_TIMEOUT_MS = 20000;

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

  async function requestGoogleAccessToken() {
    let clientId = window.OSKARS_LOCAL_CONFIG?.googleClientId;
    if (!clientId)
      throw new Error("Missing googleClientId in config.local.js.");
    if (isOneTapSignIn()) {
      let token = getStoredGoogleAccessToken();
      if (token) return token;
      await loadGoogleIdentity();

      if (window.google?.accounts?.oauth2) {
        return withSignInTimeout(
          new Promise((resolve, reject) => {
            let escalated = false;
            let escalateTimer;
            let tokenClient = window.google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: GOOGLE_SHEETS_SCOPE,
              callback: (response) => {
                console.debug(
                  "Google Sheets sign-in: token client response",
                  response,
                );
                clearTimeout(escalateTimer);
                if (response?.error) {
                  escalateToConsent();
                  return;
                }
                googleAccessToken = response.access_token;
                storeGoogleAccessToken(googleAccessToken, response.expires_in);
                resolve(googleAccessToken);
              },
            });
            function escalateToConsent() {
              clearTimeout(escalateTimer);
              if (escalated) {
                reject(new Error("Google did not grant Sheets access."));
                return;
              }
              escalated = true;
              tokenClient.requestAccessToken({ prompt: "consent" });
            }
            // Try silently first — succeeds instantly for a returning user
            // with an active Google session. Some browsers (Safari's ITP,
            // Chrome's third-party-cookie phase-out) block the silent iframe
            // this uses from ever calling back at all — no success, no
            // error — so also escalate to a visible consent popup if nothing
            // has happened after a few seconds, rather than silently waiting
            // out the full sign-in timeout for a response that won't come.
            tokenClient.requestAccessToken({ prompt: "none" });
            escalateTimer = setTimeout(escalateToConsent, 4000);
          }),
        );
      }
      // Falls through to the redirect/popup flow below if oauth2 never loaded.
    }

    if (isRedirectSignIn()) {
      let token = getStoredGoogleAccessToken();
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
        storeGoogleAccessToken(response.accessToken, response.expiresIn);
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

      let state = buildGoogleOAuthState();
      let authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "token");
      authUrl.searchParams.set("scope", GOOGLE_SHEETS_SCOPE);
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
          scope: GOOGLE_SHEETS_SCOPE,
          callback: (response) => {
            console.debug(
              "Google Sheets sign-in: token client response",
              response,
            );
            if (response?.error)
              reject(new Error(response.error_description || response.error));
            else {
              googleAccessToken = response.access_token;
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

  function rangeStartRow(range) {
    let match =
      String(range || "").match(/![A-Z]+(\d+)(?::|$)/i) ||
      String(range || "").match(/^[A-Z]+(\d+)(?::|$)/i);
    return match ? Math.max(1, Number(match[1]) || 1) : 1;
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
        "genre",
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
        "genre",
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
        "genre",
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
        "genre",
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

  function validateFranchiseSchema(values, spec) {
    let warnings = [];
    let rows = values || [];
    let widestRow = rows.reduce(
      (max, row) => Math.max(max, (row || []).length),
      0,
    );
    if (widestRow < 3) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); franchise schema expects at least one year/title/rating lane.`,
      );
    } else if (widestRow % 3 !== 0) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); franchise lanes are read in year/title/rating groups of 3, so trailing columns may be ignored.`,
      );
    }
    let markerCount = countSheetLaneHeaders(rows);
    if (!markerCount) {
      warnings.push(
        `${spec.key} has no "Year" franchise header cells; films cannot be assigned to franchise groups.`,
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
        `${spec.key} has franchise headers but no film rows in the expected title columns.`,
      );
    }
    return warnings;
  }

  function validateDirectorSheetSchema(values, spec) {
    let warnings = [];
    let rows = values || [];
    let widestRow = rows.reduce(
      (max, row) => Math.max(max, (row || []).length),
      0,
    );
    if (widestRow < 3) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); Directors schema expects at least one year/title/interest lane.`,
      );
    } else if (widestRow % 3 !== 0) {
      warnings.push(
        `${spec.key} returned ${widestRow} visible column(s); Directors lanes are read in year/title/interest groups of 3, so trailing columns may be ignored.`,
      );
    }
    let markerCount = countSheetLaneHeaders(rows);
    if (!markerCount) {
      warnings.push(
        `${spec.key} has no "Year" director header cells; films cannot be assigned to directors.`,
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
        `${spec.key} has director headers but no film rows in the expected title columns.`,
      );
    }
    return warnings;
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
    if (spec.importType === "watchlist")
      return validateWatchlistSchema(values, spec);
    if (spec.importType === "table") return validateBracketSchema(values, spec);
    if (spec.importType === "franchises")
      return validateFranchiseSchema(values, spec);
    if (spec.importType === "directors")
      return validateDirectorSheetSchema(values, spec);
    return [];
  };

  async function fetchSheetValues(spreadsheetId, ranges, accessToken) {
    let params = new URLSearchParams();
    ranges.forEach((range) => params.append("ranges", range));
    params.set("majorDimension", "ROWS");
    params.set("valueRenderOption", "FORMATTED_VALUE");
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
      let key =
        film.id || `${film.year || ""}::${window.normalizeTitle(film.title)}`;
      if (!film?.title || seen.has(key)) return false;
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

  function mergeImportedGoogleState(localState, incomingState, reports) {
    let merged = window.cloneRecord(localState);
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
      merged.watchedOther = mergeWatchedOtherEntries(
        incomingState.watchedOther || [],
        localState.watchedOther || [],
      );
    }

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

  /**
   * Authenticates and builds a session-only proposal from every configured range.
   * @param {Object} [options] Import mode controls.
   * @param {boolean} [options.replace] Whether to clear state before importing.
   * @param {boolean} [options.merge] Whether to preserve local-only state and metadata.
   * @param {boolean} [options.foundation] Whether this is the one-time foundation proposal.
   * @returns {Promise<ImportProposal>} Reviewed candidate and per-range diagnostics.
   */
  window.importFromGoogleSheets = async function (options = {}) {
    let config = googleSheetsConfig();
    let spreadsheetId = String(config.spreadsheetId || "").trim();
    if (!spreadsheetId)
      throw new Error("Missing googleSheets.spreadsheetId in config.local.js.");
    let rangeSpecs = configuredRanges();
    if (!rangeSpecs.length)
      throw new Error("Missing googleSheets.ranges in config.local.js.");

    if (isRedirectSignIn()) {
      storePendingGoogleSheetsImport(options);
    } else {
      await loadGoogleIdentity();
    }
    let accessToken = await requestGoogleAccessToken();
    let data = await fetchSheetValues(
      spreadsheetId,
      rangeSpecs.map((item) => item.range),
      accessToken,
    );
    let valueRanges = data.valueRanges || [];
    let reports = [];
    let originalState = window.cloneRecord(window.state);
    let sourceConfig = {
      spreadsheetId,
      ranges: rangeSpecs.map((spec) => ({
        key: spec.key,
        range: spec.range,
        importType: spec.importType,
        periodTypeHint: spec.periodTypeHint || "",
      })),
    };
    let sourceRevision = window.canonicalDataRevision({
      sourceConfig,
      values: valueRanges.map((entry) => entry.values || []),
    });

    try {
      if (options.replace || options.merge) {
        window.state = window.createClearedLocalState();
        window.rebuildAggregates?.();
      }

      rangeSpecs.forEach((spec, index) => {
        let values = valueRanges[index]?.values || [];
        let schemaWarnings = window.validateGoogleSheetRangeForImport(
          values,
          spec,
        );
        let raw = ["table", "franchises", "directors"].includes(spec.importType)
          ? rowsToPlainDelimited(values, "\t")
          : rowsToDelimited(values, "\t");
        if (!raw.trim()) {
          reports.push({
            source: `Google Sheets · ${spec.key}`,
            rangeKey: spec.key,
            sheetRange: spec.range,
            sheetRows: values.length,
            filmsParsed: 0,
            filmsAdded: 0,
            filmsMerged: 0,
            awardsAdded: 0,
            awardsRejected: 0,
            skipped: 0,
            periods: [],
            warnings: [
              ...schemaWarnings,
              `${spec.key} returned no visible cell values from ${spec.range}.`,
            ],
            titleVariants: [],
            ruleViolations: [],
            ruleWarningDetails: [],
            skippedDetails: [],
          });
          return;
        }
        let report = window.importData(raw, spec.importType, {
          render: false,
          silentReport: true,
          tableRows: spec.importType === "table" ? values : null,
          franchiseRows: spec.importType === "franchises" ? values : null,
          directorRows: spec.importType === "directors" ? values : null,
          sheetStartRow: rangeStartRow(spec.range),
          tablePeriodType: spec.periodTypeHint,
          requireAllTimeMembership: spec.importType === "table",
          sourceLabel: `Google Sheets ${spec.key}`,
        });
        if (report) {
          report.source = `Google Sheets · ${spec.key}`;
          report.rangeKey = spec.key;
          report.sheetRange = spec.range;
          report.sheetRows = values.length;
          if (schemaWarnings.length) {
            report.warnings ||= [];
            report.warnings.unshift(...schemaWarnings);
          }
          report.skippedDetails = (report.skippedDetails || []).map((detail) =>
            Object.assign(
              {
                source: spec.key,
                range: spec.range,
              },
              detail,
            ),
          );
          report.ruleWarningDetails = (report.ruleWarningDetails || []).map(
            (detail) =>
              Object.assign(
                {
                  source: spec.key,
                  range: spec.range,
                },
                detail,
              ),
          );
          if (!report.filmsParsed && !report.periods?.length) {
            report.warnings ||= [];
            report.warnings.push(
              `${spec.key} returned ${values.length} row(s), but no films were parsed from ${spec.range}.`,
            );
          }
          reports.push(report);
        } else {
          reports.push({
            source: `Google Sheets · ${spec.key}`,
            rangeKey: spec.key,
            sheetRange: spec.range,
            sheetRows: values.length,
            filmsParsed: 0,
            filmsAdded: 0,
            filmsMerged: 0,
            awardsAdded: 0,
            awardsRejected: 0,
            skipped: values.length,
            periods: [],
            warnings: [
              ...schemaWarnings,
              `${spec.key} returned ${values.length} row(s), but import failed for ${spec.range}.`,
            ],
            titleVariants: [],
            ruleViolations: [],
            ruleWarningDetails: [],
            skippedDetails: [
              {
                source: spec.key,
                range: spec.range,
                rowNumber: "",
                reason: "Import failed for range.",
                values: [spec.range],
              },
            ],
          });
        }
      });

      if (options.merge) {
        window.state = mergeImportedGoogleState(
          originalState,
          window.state,
          reports,
        );
        window.recomputeWatchlistOrder?.();
        window.state.watchlistOrderVersion = 1;
        window.rebuildAggregates?.();
        reports.push({
          source: "Google Sheets · merge",
          rangeKey: "merge",
          sheetRange: "",
          sheetRows: 0,
          filmsParsed: 0,
          filmsAdded: 0,
          filmsMerged: 0,
          awardsAdded: 0,
          awardsRejected: 0,
          skipped: 0,
          periods: [],
          warnings: [
            "Merge mode replaced imported Google Sheets periods and preserved local metadata for matching films.",
          ],
          titleVariants: [],
          ruleViolations: [],
          ruleWarningDetails: [],
          skippedDetails: [],
        });
      }

      // Import consistency checks (issue #41): with the final state in place
      // (including merge mode's merged result), re-read each range's raw rows
      // with the independent checker and verify that source-row fields landed.
      // Aggregates must be fresh first so findFilmByTitleYear sees the result.
      window.rebuildAggregates?.();
      if (window.collectImportConsistency) {
        reports.forEach((report) => {
          let index = rangeSpecs.findIndex(
            (spec) => spec.key === report.rangeKey,
          );
          if (index < 0) return;
          let checks = window.collectImportConsistency(
            rangeSpecs[index],
            valueRanges[index]?.values || [],
          );
          if (!checks.length) return;
          report.consistency = checks;
          let missingTotal = checks.reduce(
            (sum, check) => sum + check.missingCount,
            0,
          );
          if (missingTotal) {
            report.warnings ||= [];
            report.warnings.push(
              `${missingTotal} field value(s) present in ${report.rangeKey} source rows are missing after import; possible parser bug or schema drift.`,
            );
          }
        });
        window.state.importConsistency = {
          checkedAt: new Date().toISOString(),
          ranges: reports
            .filter((report) => report.consistency?.length)
            .map((report) => ({
              key: report.rangeKey,
              checks: report.consistency,
            })),
        };
      }

      let mode = options.foundation
        ? "foundation"
        : options.replace
          ? "replace"
          : "merge";
      let summary = window.summarizeGoogleSheetsReports?.(
        reports,
        `Google Sheets ${mode} proposal`,
      );
      return window.createImportProposal({
        sourceKind: "google-sheets",
        mode,
        baseState: originalState,
        candidateState: window.state,
        report: summary || reports[0] || {},
        sourceRevision,
        sourceConfig,
      });
    } finally {
      window.state = originalState;
      window.rebuildAggregates?.();
    }
  };

  /**
   * Reports whether OAuth, spreadsheet, and range configuration is complete.
   * @returns {boolean} Whether Google Sheets import can start.
   */
  window.googleSheetsImportConfigured = function () {
    return Boolean(
      window.OSKARS_LOCAL_CONFIG?.googleClientId &&
      googleSheetsConfig().spreadsheetId &&
      configuredRanges().length,
    );
  };

  function maybeResumeGoogleSheetsImport() {
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
    let pendingOptions = consumePendingGoogleSheetsImport();
    if (pendingOptions)
      window.OSKARS_RESUMED_GOOGLE_PROPOSAL_OPTIONS = pendingOptions;
  }

  maybeResumeGoogleSheetsImport();
})();
