/**
 * @file Computes diffs between current app state and live Google Sheets ranges,
 * and generates reviewed write batches for Oskar brackets, ratings/tiers, and all-time rankings.
 */

(function () {
  /** Converts a 0-indexed column number to A1 sheet column letters (e.g. 0 -> "A", 26 -> "AA"). */
  function columnToLetter(index) {
    let letter = "";
    let temp = index;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  }

  /** Cleans text for comparison. */
  function clean(val) {
    return String(val ?? "").trim();
  }

  /** Formats date to sheet's compact YYMMDD format, or '-' if absent. */
  function formatDateForSheet(dateVal) {
    if (!dateVal || dateVal === "-") return "-";
    let text = String(dateVal).trim();
    if (/^\d{6}$/.test(text)) return text;
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return `${match[1].slice(2)}${match[2]}${match[3]}`;
    }
    return text;
  }

  /** Formats film rating to stars representation (e.g. ★★★★★＋) or '-'. */
  function formatRatingForSheet(ratingVal, modifierVal) {
    if (!ratingVal || ratingVal === "-") return "-";
    if (typeof window.renderFilmRating === "function") {
      let rendered = window.renderFilmRating({
        ratingValue: ratingVal,
        ratingModifier: modifierVal,
      });
      if (rendered) return rendered;
    }
    return String(ratingVal);
  }

  /** Detects whether formula in cell A2 uses semicolon or comma separator. */
  function detectFormulaSeparator(sheetRows) {
    let row2CellA = sheetRows?.[1]?.[0] || "";
    if (typeof row2CellA === "string" && row2CellA.includes(";")) {
      return ";";
    }
    return ";"; // Default to semicolon per owner's sheet configuration
  }

  /**
   * Builds one row for the All-time sheet corresponding to a film at given row index.
   * @param {Object} film Film record.
   * @param {number} rowIndex 1-indexed sheet row number (e.g. 2 for the first film).
   * @param {string} [formulaSeparator] Formula parameter separator.
   * @returns {Array<string|number>} 20-cell array.
   */
  window.buildAllTimeSheetRow = function (
    film,
    rowIndex,
    formulaSeparator = ";",
  ) {
    let dynamicRankFormula = `=SUBTOTAL(103${formulaSeparator} $C$2:C${rowIndex})`;
    let fixedRank = rowIndex - 1;
    let year = film.year != null ? film.year : "-";
    let title = clean(film.title);
    let director =
      film.director ||
      (Array.isArray(film.directors)
        ? film.directors.map((d) => (typeof d === "string" ? d : d.name)).join(", ")
        : "") ||
      "-";
    let rating = formatRatingForSheet(film.rating, film.rating_modifier || film.ratingModifier);
    let type = film.type || "Film";
    let tag =
      (Array.isArray(film.tags)
        ? film.tags.join(", ")
        : film.tag || film.tags) || "-";
    let medium = film.medium || "-";
    let screenplay = film.screenplay || film.screenplay_type || "-";
    let source = film.source || film.adaptation_source || "-";
    let country = film.country || film.primary_country || "-";
    let views =
      film.views != null && String(film.views).trim() !== ""
        ? String(film.views)
        : "1";
    let date = formatDateForSheet(film.dateWatched || film.date_watched);
    let score = film.musicScore || film.score || "-";
    let franchise = film.franchise || "-";
    let platform = film.platform || "-";
    let runtime = film.runtime || film.runtime_minutes || "-";
    let tmdbId = film.tmdbId || film.tmdb_id || "-";
    let letterboxd = film.letterboxd || film.letterboxd_url || "-";

    return [
      dynamicRankFormula,
      fixedRank,
      year,
      title,
      director,
      rating,
      type,
      tag,
      medium,
      screenplay,
      source,
      country,
      views,
      date,
      score,
      franchise,
      platform,
      runtime,
      tmdbId,
      letterboxd,
    ];
  };

  /**
   * Normalizes film identity key for matching across sheet and app data.
   * @param {Object} film Film object or sheet row values.
   * @returns {string} Key.
   */
  function filmIdentityKey(film) {
    let tmdbId = film.tmdbId || film.tmdb_id;
    if (tmdbId && String(tmdbId).trim() && String(tmdbId).trim() !== "-") {
      return `tmdb:${String(tmdbId).trim()}`;
    }
    let title = clean(film.title || "").toLowerCase();
    let year = film.year != null ? String(film.year).trim() : "";
    return `title:${title}::${year}`;
  }

  /**
   * Diffs All-time ranking in Supabase against the current Google Sheet rows.
   * @param {Array<Array<*>>} sheetRows Current raw rows from All-time sheet.
   * @param {Array<Object>} appFilms All-time films from app, sorted by confirmed all-time rank.
   * @param {Object} [options] Options including sheetName.
   * @returns {Object} Diff summary, items, and value updates.
   */
  window.diffAllTimeRanking = function (sheetRows, appFilms, options = {}) {
    let sheetName = options.sheetName || "'All-time'";
    let separator = detectFormulaSeparator(sheetRows);
    let items = [];
    let batches = [];

    // Header is row 0; film data starts at row 1 (sheet row 2)
    let existingFilms = (sheetRows || []).slice(1).map((row, idx) => {
      let sheetRowNumber = idx + 2;
      return {
        sheetRowNumber,
        dynamicRank: row[0],
        fixedRank: Number(row[1]) || (idx + 1),
        year: row[2],
        title: row[3],
        director: row[4],
        rating: row[5],
        type: row[6],
        tag: row[7],
        medium: row[8],
        screenplay: row[9],
        source: row[10],
        country: row[11],
        views: row[12],
        date: row[13],
        score: row[14],
        franchise: row[15],
        platform: row[16],
        runtime: row[17],
        tmdbId: row[18],
        letterboxd: row[19],
        rawRow: row,
      };
    });

    let existingByKey = new Map();
    existingFilms.forEach((ef) => {
      let key = filmIdentityKey(ef);
      existingByKey.set(key, ef);
    });

    // Check if the physical row sequence of films matches appFilms
    let sequenceMatches =
      existingFilms.length === appFilms.length &&
      appFilms.every((af, idx) => {
        let ef = existingFilms[idx];
        return ef && filmIdentityKey(ef) === filmIdentityKey(af);
      });

    if (sequenceMatches) {
      // Row positions and ranks are identical: surgically update only changed cells
      existingFilms.forEach((ef, idx) => {
        let af = appFilms[idx];
        let targetRow = ef.sheetRowNumber;

        // Rating
        let appRating = formatRatingForSheet(
          af.rating,
          af.rating_modifier || af.ratingModifier,
        );
        let sheetRating = clean(ef.rating);
        if (appRating !== "-" && appRating !== sheetRating) {
          items.push({
            type: "rating",
            description: `[All-time Rating] "${af.title}": "${sheetRating}" → "${appRating}"`,
          });
          batches.push({
            range: `${sheetName}!F${targetRow}`,
            values: [[appRating]],
          });
        }

        // Date
        let appDate = formatDateForSheet(af.dateWatched || af.date_watched);
        let sheetDate = clean(ef.date);
        if (appDate !== "-" && appDate !== sheetDate) {
          items.push({
            type: "date",
            description: `[All-time Date] "${af.title}": "${sheetDate}" → "${appDate}"`,
          });
          batches.push({
            range: `${sheetName}!N${targetRow}`,
            values: [[appDate]],
          });
        }

        // Views
        let appViews = af.views != null ? String(af.views) : "";
        let sheetViews = clean(ef.views);
        if (appViews && parseInt(appViews, 10) !== parseInt(sheetViews, 10)) {
          items.push({
            type: "views",
            description: `[All-time Views] "${af.title}": "${sheetViews}" → "${appViews}"`,
          });
          batches.push({
            range: `${sheetName}!M${targetRow}`,
            values: [[appViews]],
          });
        }

        // Platform
        let appPlatform = clean(af.platform);
        let sheetPlatform = clean(ef.platform);
        if (appPlatform && appPlatform !== "-" && appPlatform !== sheetPlatform) {
          items.push({
            type: "platform",
            description: `[All-time Platform] "${af.title}": "${sheetPlatform}" → "${appPlatform}"`,
          });
          batches.push({
            range: `${sheetName}!Q${targetRow}`,
            values: [[appPlatform]],
          });
        }

        // Music score
        let appScore = clean(af.musicScore || af.score);
        let sheetScore = clean(ef.score);
        if (appScore && appScore !== "-" && appScore !== sheetScore) {
          items.push({
            type: "score",
            description: `[All-time Music Score] "${af.title}": "${sheetScore}" → "${appScore}"`,
          });
          batches.push({
            range: `${sheetName}!O${targetRow}`,
            values: [[appScore]],
          });
        }
      });
    } else {
      // Order has changed or new films inserted: rewrite the ranked block
      appFilms.forEach((af, idx) => {
        let key = filmIdentityKey(af);
        let existing = existingByKey.get(key);
        let newRank = idx + 1;
        if (!existing) {
          items.push({
            type: "insert",
            description: `[All-time Insert] #${newRank} "${af.title} (${af.year ?? "?"})" inserted into all-time ranking`,
          });
        } else if (existing.fixedRank !== newRank) {
          items.push({
            type: "reorder",
            description: `[All-time Rank] "${af.title}": #${existing.fixedRank} → #${newRank}`,
          });
        }

        let appRating = formatRatingForSheet(
          af.rating,
          af.rating_modifier || af.ratingModifier,
        );
        if (existing && appRating !== "-" && appRating !== clean(existing.rating)) {
          items.push({
            type: "rating",
            description: `[All-time Rating] "${af.title}": "${existing.rating}" → "${appRating}"`,
          });
        }
      });

      // Build full replacement rows for A2:T{N}
      let fullRows = appFilms.map((film, idx) =>
        window.buildAllTimeSheetRow(film, idx + 2, separator),
      );

      if (fullRows.length > 0) {
        batches.push({
          range: `${sheetName}!A2:T${fullRows.length + 1}`,
          values: fullRows,
        });
      }
    }

    return {
      hasChanges: batches.length > 0,
      items,
      batches,
    };
  };

  /**
   * Bracket category column mappings for 37-column bracket sheet.
   * Matches header in The Oskars.tsv.
   */
  const BRACKET_COLUMN_SPECS = [
    { category: "Best Picture", field: "film", colHalf1: 2, colHalf2: 3 },
    { category: "Best Director", recipientCol: 4, filmCol: 5 },
    { category: "Best Cinematography", recipientCol: 6, filmCol: 7 },
    { category: "Best Original Screenplay", recipientCol: 8, filmCol: 9 },
    { category: "Best Adapted Screenplay", recipientCol: 10, filmCol: 11 },
    { category: "Best Lead Actor", recipientCol: 12, detailCol: 13, filmCol: 14 },
    { category: "Best Lead Actress", recipientCol: 15, detailCol: 16, filmCol: 17 },
    { category: "Best Supporting Actor", recipientCol: 18, detailCol: 19, filmCol: 20 },
    { category: "Best Supporting Actress", recipientCol: 21, detailCol: 22, filmCol: 23 },
    { category: "Best International Picture", filmCol: 24 },
    { category: "Best Animated Picture", filmCol: 25 },
    { category: "Best Score", recipientCol: 26, filmCol: 27 },
    { category: "Best Song", detailCol: 28, recipientCol: 29, filmCol: 30 },
    { category: "Best Casting", filmCol: 31 },
    { category: "Best Editing", recipientCol: 32, filmCol: 33 },
    { category: "Best Visual Effects", filmCol: 34 },
    { category: "Best Production Design", filmCol: 35 },
    { category: "Best Costume Design", filmCol: 36 },
  ];

  /**
   * Diffs personal award brackets in Supabase against The Oskars spreadsheet rows.
   * @param {Array<Array<*>>} sheetRows Raw rows from The Oskars sheet.
   * @param {Array<Object>} personalAwards Supabase personal_awards rows.
   * @param {Map<string, Object>} filmsById Films keyed by UUID.
   * @param {Object} [options] Options including sheetName.
   * @returns {Object} Diff summary, items, and value updates.
   */
  window.diffBrackets = function (
    sheetRows,
    personalAwards,
    filmsById,
    options = {},
  ) {
    let sheetName = options.sheetName || "'The Oskars'";
    let items = [];
    let batches = [];

    if (!Array.isArray(sheetRows) || !sheetRows.length) {
      return { hasChanges: false, items: [], batches: [] };
    }

    let headerRow = sheetRows[0] || [];
    let periodCol = headerRow.findIndex(
      (cell) => clean(cell).toLowerCase() === "period",
    );
    if (periodCol < 0) periodCol = 1;

    // Index Supabase personal awards by scope_type and scope
    let awardsByScope = new Map();
    (personalAwards || []).forEach((award) => {
      let scopeType = award.scope_type || award.scopeType || "years";
      let scope = String(award.scope || "").trim();
      let key = `${scopeType}::${scope}`;
      awardsByScope.set(key, award);
    });

    // Scan sheet rows for period blocks
    for (let r = 1; r < sheetRows.length; r++) {
      let periodTypeCell = clean(sheetRows[r]?.[periodCol]);
      if (!/^(?:Year|Decade|Century|All-time)$/i.test(periodTypeCell)) continue;

      let metaValue = clean(sheetRows[r + 1]?.[periodCol]);
      let { periodType, year } = window.bracketPeriodFromMeta(
        periodTypeCell,
        metaValue,
      );
      let awardKey = `${periodType}::${year}`;
      let award = awardsByScope.get(awardKey);
      if (!award) continue;

      let nominations = award.personal_nominations || [];
      let nomMap = new Map();
      nominations.forEach((nom) => {
        let cat = nom.category;
        let placement = nom.placement || 1;
        nomMap.set(`${cat}::${placement}`, nom);
      });

      // Rows for this block: r is meta row, r+1 is Winner (placement 1), r+2 is Nominee 1 (placement 2), etc.
      BRACKET_COLUMN_SPECS.forEach((spec) => {
        if (spec.category === "Best Picture") {
          // 1st half: placements 1..5 in rows r+1..r+5, col 2
          // 2nd half: placements 6..10 in rows r+1..r+5, col 3
          for (let p = 1; p <= 5; p++) {
            let rowIdx = r + p;
            let nom1 = nomMap.get(`Best Picture::${p}`);
            let film1 = nom1 ? filmsById.get(nom1.film_id) : null;
            let targetTitle1 = film1 ? clean(film1.title) : "-";
            let currentCell1 = clean(sheetRows[rowIdx]?.[spec.colHalf1]);
            if (targetTitle1 !== "-" && targetTitle1 !== currentCell1) {
              items.push({
                type: "bracket",
                description: `[Bracket ${year} Best Picture #${p}] "${currentCell1}" → "${targetTitle1}"`,
              });
              batches.push({
                range: `${sheetName}!${columnToLetter(spec.colHalf1)}${rowIdx + 1}`,
                values: [[targetTitle1]],
              });
            }

            let p2 = p + 5;
            let nom2 = nomMap.get(`Best Picture::${p2}`);
            let film2 = nom2 ? filmsById.get(nom2.film_id) : null;
            let targetTitle2 = film2 ? clean(film2.title) : "-";
            let currentCell2 = clean(sheetRows[rowIdx]?.[spec.colHalf2]);
            if (targetTitle2 !== "-" && targetTitle2 !== currentCell2) {
              items.push({
                type: "bracket",
                description: `[Bracket ${year} Best Picture #${p2}] "${currentCell2}" → "${targetTitle2}"`,
              });
              batches.push({
                range: `${sheetName}!${columnToLetter(spec.colHalf2)}${rowIdx + 1}`,
                values: [[targetTitle2]],
              });
            }
          }
          return;
        }

        // Other categories: placements 1..5 in rows r+1..r+5
        for (let p = 1; p <= 5; p++) {
          let rowIdx = r + p;
          if (rowIdx >= sheetRows.length) break;
          let nom = nomMap.get(`${spec.category}::${p}`);
          let film = nom ? filmsById.get(nom.film_id) : null;
          let targetFilmTitle = film ? clean(film.title) : "-";

          let targetRecipient = "-";
          if (nom?.personal_nomination_recipients?.length) {
            targetRecipient = nom.personal_nomination_recipients
              .map((rc) => clean(rc.recipient_name || rc.name))
              .filter(Boolean)
              .join(", ");
          }

          let targetDetail = nom?.detail ? clean(nom.detail) : "-";

          // Check Film cell
          if (spec.filmCol != null) {
            let currentFilmCell = clean(sheetRows[rowIdx]?.[spec.filmCol]);
            if (targetFilmTitle !== "-" && targetFilmTitle !== currentFilmCell) {
              let label = p === 1 ? "Winner" : `Nominee ${p - 1}`;
              items.push({
                type: "bracket",
                description: `[Bracket ${year} ${spec.category} ${label}] "${currentFilmCell}" → "${targetFilmTitle}"`,
              });
              batches.push({
                range: `${sheetName}!${columnToLetter(spec.filmCol)}${rowIdx + 1}`,
                values: [[targetFilmTitle]],
              });
            }
          }

          // Check Recipient cell
          if (spec.recipientCol != null) {
            let currentRecCell = clean(sheetRows[rowIdx]?.[spec.recipientCol]);
            if (targetRecipient !== "-" && targetRecipient !== currentRecCell) {
              items.push({
                type: "bracket",
                description: `[Bracket ${year} ${spec.category} Recipient #${p}] "${currentRecCell}" → "${targetRecipient}"`,
              });
              batches.push({
                range: `${sheetName}!${columnToLetter(spec.recipientCol)}${rowIdx + 1}`,
                values: [[targetRecipient]],
              });
            }
          }

          // Check Detail (role/work) cell
          if (spec.detailCol != null) {
            let currentDetailCell = clean(sheetRows[rowIdx]?.[spec.detailCol]);
            if (targetDetail !== "-" && targetDetail !== currentDetailCell) {
              items.push({
                type: "bracket",
                description: `[Bracket ${year} ${spec.category} Detail #${p}] "${currentDetailCell}" → "${targetDetail}"`,
              });
              batches.push({
                range: `${sheetName}!${columnToLetter(spec.detailCol)}${rowIdx + 1}`,
                values: [[targetDetail]],
              });
            }
          }
        }
      });
    }

    return {
      hasChanges: batches.length > 0,
      items,
      batches,
    };
  };

  /**
   * Diffs watchlist tiers in Supabase against Directors and Franchises sheet.
   * @param {Array<Array<*>>} sheetRows Raw rows from Directors and Franchises.
   * @param {Array<Object>} watchlistItems Watchlist items from Supabase.
   * @param {Map<string, Object>} filmsById Films keyed by UUID.
   * @param {Object} [options] Options including sheetName.
   * @returns {Object} Diff summary, items, and value updates.
   */
  window.diffWatchlistTiers = function (
    sheetRows,
    watchlistItems,
    filmsById,
    options = {},
  ) {
    let sheetName = options.sheetName || "'Directors and Franchises'";
    let items = [];
    let batches = [];

    if (!Array.isArray(sheetRows) || sheetRows.length < 2) {
      return { hasChanges: false, items: [], batches: [] };
    }

    // Map existing rows by title + year
    let rowByKey = new Map();
    for (let r = 1; r < sheetRows.length; r++) {
      let row = sheetRows[r];
      let year = clean(row[0]);
      let title = clean(row[1]).toLowerCase();
      let tier = clean(row[4]);
      let key = `${title}::${year}`;
      rowByKey.set(key, { rowIndex: r + 1, tier, row });
    }

    (watchlistItems || []).forEach((item) => {
      if (!item.tier) return;
      let film = filmsById.get(item.film_id) || item.films;
      if (!film) return;
      let title = clean(film.title).toLowerCase();
      let year = film.year != null ? String(film.year).trim() : "";
      let key = `${title}::${year}`;
      let existing = rowByKey.get(key);
      if (existing) {
        let appTier = clean(item.tier).toUpperCase();
        let sheetTier = existing.tier.toUpperCase();
        if (appTier && appTier !== sheetTier) {
          items.push({
            type: "tier",
            description: `[Watchlist Tier] "${film.title}": "${sheetTier}" → "${appTier}"`,
          });
          batches.push({
            range: `${sheetName}!E${existing.rowIndex}`,
            values: [[appTier]],
          });
        }
      }
    });

    return {
      hasChanges: batches.length > 0,
      items,
      batches,
    };
  };

  /**
   * Previews all Google Sheets write-back changes by reading live sheets and comparing to Supabase.
   * @returns {Promise<Object>} Review plan with summary, change list, and update batches.
   */
  window.previewGoogleSheetsWriteBack = async function () {
    let config = window.OSKARS_LOCAL_CONFIG?.googleSheets;
    let spreadsheetId = String(config?.spreadsheetId || "").trim();
    if (!spreadsheetId) {
      throw new Error("Missing googleSheets.spreadsheetId in config.local.js.");
    }
    let ranges = config?.ranges || {};
    let allTimeRange = ranges.allTime || "'All-time'!A:ZZ";
    let bracketRange = ranges.bracket || "'The Oskars'!A:ZZ";
    let directorsFranchisesRange =
      ranges.directorsAndFranchises || "'Directors and Franchises'!A:ZZ";

    // 1. Fetch live Google Sheets data (read token)
    await window.loadGoogleIdentity?.();
    let readToken = await window.requestGoogleAccessToken?.();
    let sheetData = await window.fetchGoogleSheetValues?.(
      spreadsheetId,
      [allTimeRange, bracketRange, directorsFranchisesRange],
      readToken,
    );
    let valueRanges = sheetData?.valueRanges || [];
    let allTimeSheetRows = valueRanges[0]?.values || [];
    let bracketSheetRows = valueRanges[1]?.values || [];
    let dfSheetRows = valueRanges[2]?.values || [];

    // 2. Load Supabase data
    let source = await window.loadSupabaseLegacyHydrationSource?.();
    let filmsById = new Map();
    (source.catalogFilms || []).forEach((f) => filmsById.set(f.id, f));
    (source.watched || []).forEach((w) => {
      if (w.films) filmsById.set(w.film_id, { ...w.films, ...w });
    });

    // 3. Resolve all-time films ordered by allTime ranking position
    let allTimeRanking = (source.rankings || []).find(
      (r) => r.scope_type === "allTime" || r.scope === "allTime",
    );
    let watchedByFilmId = new Map(
      (source.watched || []).map((w) => [w.film_id, w]),
    );

    let allTimeFilms = [];
    if (allTimeRanking?.ranking_entries) {
      let sortedEntries = [...allTimeRanking.ranking_entries].sort(
        (a, b) => (a.position || 0) - (b.position || 0),
      );
      sortedEntries.forEach((entry) => {
        let watchedRow = watchedByFilmId.get(entry.film_id);
        let film = filmsById.get(entry.film_id) || {};
        allTimeFilms.push({
          ...film,
          ...watchedRow,
          allTimeRank: entry.position,
        });
      });
    }

    // 4. Compute diffs
    let allTimeDiff = window.diffAllTimeRanking(
      allTimeSheetRows,
      allTimeFilms,
      { sheetName: "'All-time'" },
    );
    let bracketDiff = window.diffBrackets(
      bracketSheetRows,
      source.personalAwards || [],
      filmsById,
      { sheetName: "'The Oskars'" },
    );
    let tierDiff = window.diffWatchlistTiers(
      dfSheetRows,
      source.watchlist || [],
      filmsById,
      { sheetName: "'Directors and Franchises'" },
    );

    let allItems = [
      ...allTimeDiff.items,
      ...bracketDiff.items,
      ...tierDiff.items,
    ];
    let allBatches = [
      ...allTimeDiff.batches,
      ...bracketDiff.batches,
      ...tierDiff.batches,
    ];

    let summaryLines = [
      `Total changes: ${allItems.length}`,
      `- All-time ranking / ratings: ${allTimeDiff.items.length} changes`,
      `- Oskar brackets: ${bracketDiff.items.length} changes`,
      `- Watchlist tiers: ${tierDiff.items.length} changes`,
    ];

    return {
      hasChanges: allBatches.length > 0,
      changesCount: allItems.length,
      summary: summaryLines.join("\n"),
      items: allItems,
      batches: allBatches,
      spreadsheetId,
    };
  };

  /**
   * Applies a previewed write-back plan to Google Sheets using write authorization.
   * @param {Object} plan Plan object returned by previewGoogleSheetsWriteBack.
   * @returns {Promise<Object>} Execution result.
   */
  window.applyGoogleSheetsWriteBack = async function (plan) {
    if (!plan || !plan.batches || !plan.batches.length) {
      return { success: true, updatedRanges: 0, message: "No changes to apply." };
    }

    // Request write scope
    let writeToken = await window.requestGoogleAccessToken?.({ write: true });
    let result = await window.batchUpdateGoogleSheetValues?.(
      plan.spreadsheetId,
      plan.batches,
      writeToken,
      { valueInputOption: "USER_ENTERED" },
    );

    return {
      success: true,
      updatedRanges: plan.batches.length,
      totalUpdatedCells: result?.totalUpdatedCells || plan.items.length,
      response: result,
    };
  };
})();

