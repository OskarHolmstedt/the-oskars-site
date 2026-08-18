/**
 * @file Parses one bracket table into films, awards, period metadata, source
 * attribution, and diagnostics, including an explicit isolated mode for
 * official winner/nominee results.
 */

/**
 * Parses a bracket table and attaches its valid placements to resolved films.
 * @param {string} raw Raw tab-delimited bracket text.
 * @param {Object} [options] Optional preparsed rows, period hints, and result mode.
 * @returns {Object} Parsed period metadata, films, source URL, and diagnostics.
 */
function parseTable(raw, options = {}) {
  function cleanCell(value) {
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
  }

  function rowsFromInput(input) {
    let sourceRows = Array.isArray(options.rows)
      ? options.rows
      : Array.isArray(input)
        ? input
        : null;

    if (sourceRows) {
      return sourceRows.map((row) => (row || []).map(cleanCell));
    }

    return String(input || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.split("\t").map(cleanCell))
      .filter((row) => row.some(Boolean));
  }

  function normalizeHeader(value) {
    return cleanCell(value).replace(/\s+/g, " ");
  }

  function normalizeHeaderKey(value) {
    return normalizeHeader(value).toLowerCase();
  }

  function parsePlacement(value) {
    let number = Number(cleanCell(value));
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function isBlankOrDash(value) {
    let text = cleanCell(value);
    return !text || text === "-" || text === "–" || text === "—";
  }

  const CATEGORY_NAME_MAP = {
    picture: "Best Picture",
    director: "Best Director",
    cinematography: "Best Cinematography",
    "original screenplay": "Best Original Screenplay",
    "adapted screenplay": "Best Adapted Screenplay",
    "lead actor": "Best Lead Actor",
    "lead actress": "Best Lead Actress",
    "supporting actor": "Best Supporting Actor",
    "supporting actress": "Best Supporting Actress",
    "international picture": "Best International Picture",
    "animated picture": "Best Animated Picture",
    score: "Best Score",
    song: "Best Song",
    casting: "Best Casting",
    editing: "Best Editing",
    "visual effects": "Best Visual Effects",
    "production design": "Best Production Design",
    "costume design": "Best Costume Design",
  };

  const FIELD_NAME_MAP = {
    recipient: "recipient",
    film: "film",
    role: "detail",
    work: "detail",
  };

  function pictureFieldFromRawField(rawField) {
    let key = String(rawField || "")
      .trim()
      .toLowerCase();

    if (/^(1st|first)\s+half$/.test(key)) return "filmFirstHalf";
    if (/^(2nd|second)\s+half$/.test(key)) return "filmSecondHalf";

    return "";
  }

  function parseAwardHeader(headerText, columnIndex) {
    let text = normalizeHeader(headerText);
    if (!text) return null;

    let match = text.match(/^(.+?)\s*\((.+?)\)$/);
    let rawCategory = match ? match[1].trim() : text;
    let rawField = match ? match[2].trim() : "";

    let category = CATEGORY_NAME_MAP[rawCategory.toLowerCase()];
    if (!category) return null;

    let field = "";

    if (category === "Best Picture") {
      field = pictureFieldFromRawField(rawField);
    } else {
      field = rawField ? FIELD_NAME_MAP[rawField.toLowerCase()] : "film";
    }

    if (!field) return null;

    return { category, field, columnIndex, header: text };
  }

  function findHeaderRowIndex(rows) {
    return rows.findIndex((row) => {
      let headers = row.map(normalizeHeaderKey);
      return (
        headers.some((value) => /^picture\b/.test(value)) &&
        headers.some((value) => value.startsWith("director"))
      );
    });
  }

  function buildAwardDefs(headerRow) {
    let defsByCategory = new Map();

    headerRow.forEach((header, columnIndex) => {
      if (columnIndex < 2) return;

      let parsed = parseAwardHeader(header, columnIndex);
      if (!parsed) return;

      let def = defsByCategory.get(parsed.category) || {
        category: parsed.category,
        columns: {},
      };

      def.columns[parsed.field] = parsed.columnIndex;
      defsByCategory.set(parsed.category, def);
    });

    return [...defsByCategory.values()];
  }

  function periodFromMetaRows(dataRows) {
    let metaType = cleanCell(dataRows[0]?.[1]);
    let metaValue = cleanCell(dataRows[1]?.[1]);
    let metaUrl = cleanCell(dataRows[2]?.[1]);

    let periodType = /^decade$/i.test(metaType)
      ? "decades"
      : /^century$/i.test(metaType)
        ? "centuries"
        : /^all-time$/i.test(metaType)
          ? "allTime"
          : "years";

    let year = "";

    if (periodType === "allTime") {
      year = "alltime";
    } else if (periodType === "years") {
      let match = metaValue.match(/(?:18|19|20)\d{2}/);
      year = match ? match[0] : "";
    } else {
      let match = metaValue.match(/(?:18|19|20)\d{2}s?/);
      year = match ? match[0].replace(/s?$/, "s") : "";
    }

    return { periodType, year, url: isBlankOrDash(metaUrl) ? "" : metaUrl };
  }

  function filmKey(title) {
    return normalizeTitle(cleanCell(title));
  }

  function getOrCreateFilm(films, title, year, rank = null) {
    let key = filmKey(title);
    if (!key) return null;

    let existing = films.find((film) => filmKey(film.title) === key);
    if (existing) {
      if (rank != null && existing.rank == null) existing.rank = rank;
      return existing;
    }

    let film = {
      title: cleanCell(title),
      rank,
      rating: "",
      year,
      awards: [],
    };

    films.push(film);
    return film;
  }

  // A tied placement is authored as one cell with semicolon-separated
  // titles. Only treat it as a tie when every resulting piece already
  // matches a real archive film — never auto-create new films from a
  // split, so an ordinary title that happens to contain a semicolon (rare,
  // but not impossible) still falls back to being one literal film.
  function resolveFilmsForTitle(films, rawTitle, year, rank = null) {
    let title = cleanCell(rawTitle);
    if (isBlankOrDash(title)) return [];
    let pieces = window.splitTieCandidateTitles(title);
    if (
      pieces.length > 1 &&
      pieces.every((piece) =>
        window.findFilmByTitleYear?.({ title: piece, year }),
      )
    ) {
      return pieces
        .map((piece) => getOrCreateFilm(films, piece, year, rank))
        .filter(Boolean);
    }
    let film = getOrCreateFilm(films, title, year, rank);
    return film ? [film] : [];
  }

  function addAwardToFilm(films, awardDef, row, placement, year, acceptAward) {
    let filmCol = awardDef.columns.film;
    let recipientCol = awardDef.columns.recipient;
    let detailCol = awardDef.columns.detail;

    let filmTitle = filmCol != null ? cleanCell(row[filmCol]) : "";

    if (isBlankOrDash(filmTitle)) return;
    if (/^\d+$/.test(filmTitle)) return;
    if (window.categories?.includes(filmTitle)) return;

    let recipient = recipientCol != null ? cleanCell(row[recipientCol]) : "";
    let detail = detailCol != null ? cleanCell(row[detailCol]) : "";

    if (isBlankOrDash(recipient)) recipient = "";
    if (isBlankOrDash(detail)) detail = "";

    if (recipient && normalizeTitle(recipient) === normalizeTitle(filmTitle)) {
      recipient = "";
    }

    let tiedFilms = resolveFilmsForTitle(films, filmTitle, year);
    if (!tiedFilms.length) return;

    tiedFilms.forEach((film) => {
      acceptAward(
        film,
        window.setAwardRecipients(
          {
            category: awardDef.category,
            placement,
            detail,
            year,
          },
          recipient,
        ),
        tiedFilms.length > 1,
      );
    });
  }

  function pictureColumnForPlacement(pictureDef, placement, capacities) {
    let columns = pictureDef?.columns || {};
    let splitPoint = Math.ceil(capacities.picture / 2);

    return placement <= splitPoint
      ? columns.filmFirstHalf
      : columns.filmSecondHalf;
  }

  let rows = rowsFromInput(raw);
  if (!rows.length) return null;

  let headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) return null;

  let headerRow = rows[headerRowIndex];
  let dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((row) => row.some(Boolean));

  if (dataRows.length < 3) return null;

  let awardRows = dataRows;
  let awardDefs = buildAwardDefs(headerRow);

  if (options.resultMode === "collection") {
    let collectionName = cleanCell(dataRows[1]?.[1]);
    let collectionType = window.normalizeCollectionAwardType?.(
      cleanCell(dataRows[0]?.[1]),
    );
    let collectionId = window.collectionAwardCollectionId?.(
      collectionType,
      collectionName,
    );
    let sourceUrl = cleanCell(dataRows[2]?.[1]);
    if (isBlankOrDash(sourceUrl)) sourceUrl = "";
    let diagnostics = {
      duplicateNominations: [],
      malformedRows: [],
      unsupportedHeaders: headerRow
        .slice(2)
        .filter(
          (header, index) =>
            normalizeHeader(header) && !parseAwardHeader(header, index + 2),
        )
        .map(normalizeHeader),
      metadataErrors: [],
    };
    if (!collectionType)
      diagnostics.metadataErrors.push(
        'Period row 1 must be "Director" or "Franchise".',
      );
    if (!collectionName)
      diagnostics.metadataErrors.push(
        "Period row 2 must name the collection.",
      );
    let nominations = [];

    function addCollectionNomination(definition, row, placement, filmColumn) {
      let sourceTitle = cleanCell(row[filmColumn]);
      if (isBlankOrDash(sourceTitle)) return;
      let recipient =
        definition.columns.recipient == null
          ? ""
          : cleanCell(row[definition.columns.recipient]);
      let detail =
        definition.columns.detail == null
          ? ""
          : cleanCell(row[definition.columns.detail]);
      if (isBlankOrDash(recipient)) recipient = "";
      if (isBlankOrDash(detail)) detail = "";
      if (recipient && normalizeTitle(recipient) === normalizeTitle(sourceTitle))
        recipient = "";
      nominations.push({
        category: definition.category,
        placement,
        sourceTitle,
        ...(recipient ? { recipient } : {}),
        ...(detail ? { detail } : {}),
      });
    }

    let capacities = window.bracketCapacities("years");
    let pictureDef = awardDefs.find(
      (definition) => definition.category === "Best Picture",
    );
    let otherDefs = awardDefs.filter(
      (definition) => definition.category !== "Best Picture",
    );
    awardRows.forEach((row, rowIndex) => {
      let position = parsePlacement(row[0]);
      let populatedAwardCells = row
        .slice(2)
        .some((cell) => !isBlankOrDash(cell));
      if (!position) {
        if (populatedAwardCells)
          diagnostics.malformedRows.push({
            rowNumber: headerRowIndex + rowIndex + 2,
            reason: "Populated award row has no positive integer Position.",
          });
        return;
      }
      if (position > capacities.category) return;
      if (pictureDef) {
        let firstColumn = pictureDef.columns.filmFirstHalf;
        let secondColumn = pictureDef.columns.filmSecondHalf;
        if (firstColumn != null)
          addCollectionNomination(pictureDef, row, position, firstColumn);
        if (secondColumn != null)
          addCollectionNomination(
            pictureDef,
            row,
            position + capacities.category,
            secondColumn,
          );
      }
      otherDefs.forEach((definition) => {
        if (definition.columns.film != null)
          addCollectionNomination(
            definition,
            row,
            position,
            definition.columns.film,
          );
      });
    });
    let seen = new Set();
    nominations = nominations
      .sort(
        (left, right) =>
          window.categorySortIndex(left.category) -
            window.categorySortIndex(right.category) ||
          left.placement - right.placement ||
          window.compareEnglishTitles(left.sourceTitle, right.sourceTitle),
      )
      .filter((nomination) => {
        let key = [
          nomination.category,
          nomination.placement,
          normalizeTitle(nomination.sourceTitle),
          normalizeTitle(nomination.recipient || ""),
          normalizeTitle(nomination.detail || ""),
        ].join("\n");
        if (!seen.has(key)) {
          seen.add(key);
          return true;
        }
        diagnostics.duplicateNominations.push({
          category: nomination.category,
          placement: nomination.placement,
          title: nomination.sourceTitle,
        });
        return false;
      });
    return {
      collectionType,
      collectionId,
      collectionName,
      sourceUrl,
      nominations,
      diagnostics,
    };
  }

  let { periodType, year, url: sourceUrl } = periodFromMetaRows(dataRows);
  let capacities = window.bracketCapacities(periodType);
  if (!year) return null;

  if (options.resultMode === "official") {
    let diagnostics = {
      duplicateNominations: [],
      malformedRows: [],
      missingWinners: [],
      multipleWinners: [],
      unsupportedHeaders: headerRow
        .slice(2)
        .filter(
          (header, index) =>
            normalizeHeader(header) && !parseAwardHeader(header, index + 2),
        )
        .map(normalizeHeader),
    };
    let nominations = [];

    function addOfficialNomination(def, row, position, filmColumn) {
      let sourceTitle = cleanCell(row[filmColumn]);
      if (isBlankOrDash(sourceTitle)) return;
      let recipient =
        def.columns.recipient == null
          ? ""
          : cleanCell(row[def.columns.recipient]);
      let detail =
        def.columns.detail == null ? "" : cleanCell(row[def.columns.detail]);
      nominations.push({
        category: def.category,
        winner: position === 1,
        sourceTitle,
        ...(isBlankOrDash(recipient) ? {} : { recipient }),
        ...(isBlankOrDash(detail) ? {} : { detail }),
      });
    }

    let pictureDef = awardDefs.find(
      (definition) => definition.category === "Best Picture",
    );
    let otherDefs = awardDefs.filter(
      (definition) => definition.category !== "Best Picture",
    );
    awardRows.forEach((row, rowIndex) => {
      let position = parsePlacement(row[0]);
      let populatedAwardCells = row
        .slice(2)
        .some((cell) => !isBlankOrDash(cell));
      if (!position) {
        if (populatedAwardCells)
          diagnostics.malformedRows.push({
            rowNumber: headerRowIndex + rowIndex + 2,
            reason: "Populated award row has no positive integer Position.",
          });
        return;
      }
      if (pictureDef && position <= capacities.category) {
        let firstColumn = pictureDef.columns.filmFirstHalf;
        let secondColumn = pictureDef.columns.filmSecondHalf;
        if (firstColumn != null)
          addOfficialNomination(pictureDef, row, position, firstColumn);
        if (
          secondColumn != null &&
          position + capacities.category <= capacities.picture
        )
          addOfficialNomination(
            pictureDef,
            row,
            position + capacities.category,
            secondColumn,
          );
      }
      if (position <= capacities.category)
        otherDefs.forEach((definition) => {
          if (definition.columns.film != null)
            addOfficialNomination(
              definition,
              row,
              position,
              definition.columns.film,
            );
        });
    });

    let categoryNominations = new Map();
    nominations.forEach((nomination) => {
      let entries = categoryNominations.get(nomination.category) || [];
      entries.push(nomination);
      categoryNominations.set(nomination.category, entries);
    });
    categoryNominations.forEach((entries, category) => {
      let winners = entries.filter((entry) => entry.winner);
      if (!winners.length) diagnostics.missingWinners.push({ category });
      if (winners.length > 1)
        diagnostics.multipleWinners.push({
          category,
          titles: winners.map((entry) => entry.sourceTitle),
        });
    });

    let seen = new Set();
    nominations = nominations
      .sort((left, right) => {
        let leftKey = [
          left.category,
          left.winner ? "0" : "1",
          normalizeTitle(left.sourceTitle),
          normalizeTitle(left.recipient || ""),
          normalizeTitle(left.detail || ""),
        ].join("\n");
        let rightKey = [
          right.category,
          right.winner ? "0" : "1",
          normalizeTitle(right.sourceTitle),
          normalizeTitle(right.recipient || ""),
          normalizeTitle(right.detail || ""),
        ].join("\n");
        return leftKey.localeCompare(rightKey);
      })
      .filter((nomination) => {
        let key = [
          nomination.category,
          normalizeTitle(nomination.sourceTitle),
          normalizeTitle(nomination.recipient || ""),
          normalizeTitle(nomination.detail || ""),
        ].join("\n");
        if (!seen.has(key)) {
          seen.add(key);
          return true;
        }
        diagnostics.duplicateNominations.push({
          category: nomination.category,
          title: nomination.sourceTitle,
        });
        return false;
      });

    return {
      year,
      periodType,
      sourceUrl,
      nominations,
      diagnostics,
    };
  }

  let films = [];
  let diagnostics = { rejectedAwards: [], ruleWarnings: [] };
  let placementOwners = new Map();

  function acceptAward(film, award, allowTie) {
    award.periodType = periodType;

    let result = window.tryAddAward(film, award, {
      periodType,
      placementOwners,
      allowTie,
    });

    result.errors.forEach((message) => {
      diagnostics.rejectedAwards.push({
        film: film.title,
        category: award.category,
        message,
      });
    });

    result.warnings.forEach((message) => {
      diagnostics.ruleWarnings.push({
        film: film.title,
        category: award.category,
        message,
      });
    });
  }

  let pictureDef = awardDefs.find((def) => def.category === "Best Picture");
  let otherDefs = awardDefs.filter((def) => def.category !== "Best Picture");

  awardRows.forEach((row) => {
    let placement = parsePlacement(row[0]);
    if (!placement) return;

    if (pictureDef && placement <= capacities.category) {
      let firstCol = pictureDef.columns.filmFirstHalf;
      let secondCol = pictureDef.columns.filmSecondHalf;

      [
        { col: firstCol, bpPlacement: placement },
        { col: secondCol, bpPlacement: placement + capacities.category },
      ].forEach(({ col, bpPlacement }) => {
        if (col == null || bpPlacement > capacities.picture) return;

        let pictureTitle = cleanCell(row[col]);
        if (isBlankOrDash(pictureTitle)) return;

        let tiedFilms = resolveFilmsForTitle(
          films,
          pictureTitle,
          year,
          bpPlacement,
        );
        if (!tiedFilms.length) return;

        tiedFilms.forEach((film) => {
          acceptAward(
            film,
            window.setAwardRecipients(
              {
                category: "Best Picture",
                placement: bpPlacement,
                detail: "",
                year,
              },
              "",
            ),
            tiedFilms.length > 1,
          );
        });
      });
    }

    if (placement <= capacities.category) {
      otherDefs.forEach((def) => {
        addAwardToFilm(films, def, row, placement, year, acceptAward);
      });
    }
  });

  return {
    year,
    periodType,
    sourceUrl,
    films,
    diagnostics,
  };
}

/**
 * Parses bracket-shaped TSV with official winner/nominee semantics.
 * @param {string} raw Raw tab-delimited official results.
 * @param {Object} [options] Optional preparsed rows and period hints.
 * @returns {Object|null} Parsed official period and diagnostics.
 */
window.parseOfficialResultsTable = function (raw, options = {}) {
  return parseTable(raw, { ...options, resultMode: "official" });
};

/** Parses bracket-shaped TSV as one collection-specific personal Oskars bracket. @param {string} raw Raw tab-delimited bracket text. @param {Object} [options] Optional preparsed rows. @returns {Object|null} Parsed collection bracket and diagnostics. */
window.parseCollectionAwardsTable = function (raw, options = {}) {
  return parseTable(raw, { ...options, resultMode: "collection" });
};
