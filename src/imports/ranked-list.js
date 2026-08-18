/**
 * @file Parses ranked-list CSV or TSV exports, including tied/composite rows,
 * ranking groups, film metadata, and archive relationship references.
 */

/**
 * Parses a ranked-list export into canonical film records.
 * @param {string} raw Raw CSV or TSV text.
 * @param {Object} [options] Parsing controls.
 * @param {boolean} [options.includeRowNumbers] Whether records retain source row numbers.
 * @returns {Object|null} Parsed all-time period and diagnostics, or null for empty input.
 */
function parseRankedList(raw, options = {}) {
  let parsedRows = parseRankedListDelimitedRows(raw);
  if (!parsedRows.length) return null;

  let headerCols = parsedRows[0];
  let hasHeader = headerCols
    .slice(0, 6)
    .some((c) =>
      /^(year|title|director|rating|rank|fixed rank|dynamic rank|type)$/i.test(
        String(c || "").trim(),
      ),
    );
  let rows = hasHeader ? parsedRows.slice(1) : parsedRows;
  let columns = hasHeader ? headerCols.map(normalizeRankedListHeader) : null;
  let maxColumnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let rankPrefixedRows =
    !columns &&
    rows.some(
      (row) =>
        /^\s*\d+\s*$/.test(String(row[0] || "")) &&
        /^\s*\d{4}s?\s*$/.test(String(row[1] || "")),
    );

  function columnIndex(patterns, fallback = -1) {
    if (!columns) return fallback;
    return columns.findIndex((column) =>
      patterns.some((pattern) =>
        pattern instanceof RegExp ? pattern.test(column) : column === pattern,
      ),
    );
  }

  let yearIndex = columns ? columnIndex(["year"]) : rankPrefixedRows ? 1 : 0;
  if (columns && yearIndex === -1) {
    yearIndex = columnIndex(["decade"]);
  }
  if (columns && yearIndex === -1) {
    yearIndex = columnIndex(["century"]);
  }
  if (columns && yearIndex === -1) {
    yearIndex = columnIndex([/\b(period|era|range)\b/]);
  }
  if (columns && yearIndex === -1) {
    yearIndex = 0;
  }

  let titleIndex = columns
    ? columnIndex(["title", "name"])
    : rankPrefixedRows
      ? 2
      : 1;
  let directorIndex = columns
    ? columnIndex(["director", "directors"])
    : rankPrefixedRows
      ? 3
      : 2;
  let ratingIndex = columns
    ? columnIndex(["rating"])
    : rankPrefixedRows
      ? 4
      : 3;
  let rankIndex = columns
    ? columnIndex(["fixed rank"])
    : rankPrefixedRows
      ? 0
      : -1;
  let typeIndex = columns
    ? columnIndex(["type", "format"])
    : rankPrefixedRows
      ? 5
      : -1;
  let inferredMediumIndex = inferRankedListMediumIndex(rows);
  let tagIndex = columns
    ? columnIndex(["tag"])
    : rankPrefixedRows
      ? 6
      : -1;
  let liveIndex = columns
    ? columnIndex([
        "medium",
        "live action",
        "liveaction",
        "animated",
        "animation",
      ])
    : inferredMediumIndex;
  let adaptIndex = columns
    ? columnIndex([
        "screenplay",
        "original adapt",
        "adaptation",
        "adaptation type",
        "adapted original",
      ])
    : inferredMediumIndex >= 0
      ? inferredMediumIndex + 1
      : rankPrefixedRows
        ? 8
        : 7;
  let sourceIndex = columns
    ? columnIndex([
        "source",
        "adaptation source",
        "source material",
        "based on",
        "source type",
      ])
    : maxColumnCount >= 16 && inferredMediumIndex >= 0
      ? inferredMediumIndex + 2
      : parsedRows.some((row) => row.length >= 16)
        ? rankPrefixedRows
          ? 9
          : 8
        : -1;
  let countryIndex = columns
    ? columnIndex(["country", "countries"])
    : rankPrefixedRows
      ? 10
      : -1;
  let viewsIndex = columns
    ? columnIndex(["views", "view count"])
    : rankPrefixedRows
      ? 11
      : -1;
  let dateWatchedIndex = columns
    ? columnIndex(["date watched", "watched date", "watched", "date"])
    : rankPrefixedRows
      ? 12
      : -1;
  let musicScoreIndex = columns
    ? columnIndex(["score", "music score", "soundtrack score"])
    : rankPrefixedRows
      ? 13
      : -1;
  let franchiseIndex = columns
    ? columnIndex(["franchise", "franchises", "series", "universe"])
    : parsedRows.some((row) => row.length >= 15)
      ? 14
      : -1;
  let platformIndex = columns
    ? columnIndex(["platform", "service", "where watched"])
    : rankPrefixedRows
      ? 15
      : -1;
  let runtimeIndex = columns
    ? columnIndex(["runtime", "runtime minutes", "minutes"])
    : rankPrefixedRows
      ? 16
      : -1;
  let tmdbIndex = columns
    ? columnIndex(["tmdbid", "tmdb id", "tmdb"])
    : rankPrefixedRows
      ? 18
      : -1;
  let letterboxdIndex = columns
    ? columnIndex(["letterboxd", "letterboxd url", "letterboxd uri"])
    : rankPrefixedRows
      ? 19
      : -1;

  if (titleIndex === -1) titleIndex = 1;
  if (directorIndex === -1) directorIndex = 2;
  if (ratingIndex === -1) ratingIndex = 3;
  if (liveIndex === -1) liveIndex = inferredMediumIndex;
  if (adaptIndex === -1) adaptIndex = 7;

  let films = [];
  let skippedRows = 0;
  let skippedDetails = [];

  function cleanCell(value) {
    return String(value || "")
      .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
      .trim();
  }

  function splitCellLines(value) {
    return cleanCell(value)
      .split("\n")
      .map((v) => cleanCell(v))
      .filter(Boolean);
  }

  function valueAt(values, idx) {
    return values[idx] || values[0] || "";
  }

  function parseRow(cols) {
    if (cols.length === 1) {
      let line = cols[0];
      let flex = line.match(/^([0-9]{4}s?)[\t,\s]+(.+)$/i);
      if (flex) {
        // if title begins with a year-like string followed by punctuation, treat it as title
        if (/^[0-9]{4}[:\-–—]/.test(flex[2])) {
          cols = [line.trim()];
        } else {
          cols = [flex[1].trim(), flex[2].trim()];
        }
      }
    }
    return cols;
  }

  function recordSkipped(rowIndex, reason, values) {
    skippedRows += 1;
    skippedDetails.push({
      rowNumber: rowIndex + (hasHeader ? 2 : 1),
      reason,
      values: (values || [])
        .map((value) => cleanCell(value))
        .filter(Boolean)
        .slice(0, 8),
    });
  }

  rows.forEach((row, rowIndex) => {
    let cols = parseRow(row);
    if (!cols.length) {
      recordSkipped(rowIndex, "Row had no cell values.", row);
      return;
    }

    let year =
      yearIndex >= 0 && cols[yearIndex] ? cleanCell(cols[yearIndex]) : "";
    let title = cleanCell(cols[titleIndex] || "");
    let director = cleanCell(
      (directorIndex >= 0 ? cols[directorIndex] : "") || "",
    );
    let rating = cleanCell((ratingIndex >= 0 ? cols[ratingIndex] : "") || "");
    let rankCell = rankIndex >= 0 ? cleanCell(cols[rankIndex]) : "";
    let rank = rankIndex >= 0 ? Number(rankCell) : NaN;
    let explicitlyUnranked =
      rankIndex >= 0 && rankCell && !cleanRankedListDash(rankCell);
    let type = cleanRankedListDash(
      (typeIndex >= 0 ? cols[typeIndex] : "") || "",
    );
    let tag = cleanRankedListDash(
      (tagIndex >= 0 ? cols[tagIndex] : "") || "",
    );
    let liveAction = cleanCell((liveIndex >= 0 ? cols[liveIndex] : "") || "");
    let adaptation = cleanCell((adaptIndex >= 0 ? cols[adaptIndex] : "") || "");
    let adaptationSource = cleanCell(
      (sourceIndex >= 0 ? cols[sourceIndex] : "") || "",
    );
    let country = cleanRankedListDash(
      (countryIndex >= 0 ? cols[countryIndex] : "") || "",
    );
    let views = cleanCell((viewsIndex >= 0 ? cols[viewsIndex] : "") || "");
    let dateWatched = cleanCell(
      (dateWatchedIndex >= 0 ? cols[dateWatchedIndex] : "") || "",
    );
    let musicScore = cleanCell(
      (musicScoreIndex >= 0 ? cols[musicScoreIndex] : "") || "",
    );
    let franchises = cleanCell(
      (franchiseIndex >= 0 ? cols[franchiseIndex] : "") || "",
    );
    let platform = cleanRankedListDash(
      (platformIndex >= 0 ? cols[platformIndex] : "") || "",
    );
    let runtime = cleanCell(
      (runtimeIndex >= 0 ? cols[runtimeIndex] : "") || "",
    );
    let tmdbId = cleanCell((tmdbIndex >= 0 ? cols[tmdbIndex] : "") || "");
    let letterboxdUrl = cleanCell(
      (letterboxdIndex >= 0 ? cols[letterboxdIndex] : "") || "",
    );

    if (!title && cols.length === 2) {
      let line = cleanCell(cols[0]);
      let flex = line.match(/^([0-9]{4}s?)[\t,\s]+(.+)$/i);
      if (flex) {
        year = flex[1].trim();
        title = flex[2].trim();
      }
    }

    if (!title) {
      recordSkipped(rowIndex, "No usable film title found.", cols);
      return;
    }

    let yearValues = splitCellLines(year);
    let titleValues = splitCellLines(title);
    let ratingValues = splitCellLines(rating);
    let tagValues = splitCellLines(tag);
    let countryValues = splitCellLines(country);
    let franchiseValues = splitCellLines(franchises);
    let tmdbValues = splitCellLines(tmdbId);
    let letterboxdValues = splitCellLines(letterboxdUrl);
    let rowCount = Math.max(
      yearValues.length,
      titleValues.length,
      ratingValues.length,
      tagValues.length,
      countryValues.length,
      franchiseValues.length,
      tmdbValues.length,
      letterboxdValues.length,
      1,
    );

    Array.from({ length: rowCount }).forEach((_, rowPartIndex) => {
      let titleStructure = parseRankedListTitleStructure(
        valueAt(titleValues, rowPartIndex),
      );
      let titleParts = titleStructure.titles;
      if (!titleParts.length) return;
      let partCount = titleParts.length;
      let alignedYears = alignedRankedListValues(
        valueAt(yearValues, rowPartIndex),
        partCount,
      );
      let alignedDirectors = alignedRankedListValues(director, partCount);
      let alignedRatings = alignedRankedListValues(
        valueAt(ratingValues, rowPartIndex),
        partCount,
      );
      let alignedTypes = alignedRankedListValues(type, partCount);
      let alignedTags = alignedRankedListValues(
        valueAt(tagValues, rowPartIndex),
        partCount,
      );
      let alignedLiveAction = alignedRankedListValues(liveAction, partCount);
      let alignedAdaptation = alignedRankedListValues(adaptation, partCount);
      let alignedAdaptationSources = alignedRankedListValues(
        adaptationSource,
        partCount,
      );
      let alignedCountries = alignedRankedListValues(
        valueAt(countryValues, rowPartIndex),
        partCount,
      );
      let alignedViews = alignedRankedListValues(views, partCount);
      let alignedDatesWatched = alignedRankedListValues(dateWatched, partCount);
      let alignedMusicScores = alignedRankedListValues(musicScore, partCount);
      let alignedFranchises = alignedRankedListValues(
        valueAt(franchiseValues, rowPartIndex),
        partCount,
      );
      let alignedPlatforms = alignedRankedListValues(platform, partCount);
      let alignedRuntimes = alignedRankedListValues(runtime, partCount);
      let alignedTmdbIds = alignedRankedListValues(
        valueAt(tmdbValues, rowPartIndex),
        partCount,
      );
      let alignedLetterboxdUrls = alignedRankedListValues(
        valueAt(letterboxdValues, rowPartIndex),
        partCount,
      );
      let rankingGroupId =
        titleStructure.kind === "shared"
          ? `shared:${rowIndex + 1}:${titleParts.map(window.normalizeTitle).join("|")}`
          : "";

      titleParts.forEach((partTitle, titlePartIndex) => {
        if (!partTitle) return;
        let partYear = valueAt(alignedYears, titlePartIndex);
        let partDirector = valueAt(alignedDirectors, titlePartIndex);
        let partRating = valueAt(alignedRatings, titlePartIndex);
        let partType = cleanRankedListDash(
          valueAt(alignedTypes, titlePartIndex),
        );
        let partTags = cleanRankedListDash(
          valueAt(alignedTags, titlePartIndex),
        );
        let partLiveAction = valueAt(alignedLiveAction, titlePartIndex);
        let partAdaptation = valueAt(alignedAdaptation, titlePartIndex);
        let partAdaptationSource = valueAt(
          alignedAdaptationSources,
          titlePartIndex,
        );
        let partCountry = cleanRankedListDash(
          valueAt(alignedCountries, titlePartIndex),
        );
        let partViews = valueAt(alignedViews, titlePartIndex);
        let partDateWatched = valueAt(alignedDatesWatched, titlePartIndex);
        let partMusicScore = valueAt(alignedMusicScores, titlePartIndex);
        let partFranchises = valueAt(alignedFranchises, titlePartIndex);
        let partPlatform = cleanRankedListDash(
          valueAt(alignedPlatforms, titlePartIndex),
        );
        let partRuntime = valueAt(alignedRuntimes, titlePartIndex);
        let partTmdbId = valueAt(alignedTmdbIds, titlePartIndex);
        let partLetterboxdUrl = valueAt(alignedLetterboxdUrls, titlePartIndex);

        let film = {
          title: partTitle,
          year: partYear,
          rank: Number.isFinite(rank) ? rank : null,
          director: partDirector,
          rating: partRating,
          type: partType,
          tags: window.parseFilmTags?.(partTags) || [],
          liveAction: partLiveAction,
          adaptation: partAdaptation,
          adaptationSource: partAdaptationSource,
          country: partCountry,
          views: positiveIntegerOrNull(partViews),
          dateWatched: window.normalizeWatchedDate
            ? window.normalizeWatchedDate(partDateWatched)
            : cleanRankedListDash(partDateWatched),
          musicScore: musicScoreOrNull(partMusicScore),
          franchises: window.parseFranchiseMemberships?.(partFranchises) || [],
          platform: partPlatform,
          runtimeMinutes: positiveIntegerOrNull(partRuntime),
          tmdbId: partTmdbId,
          letterboxdUrl: partLetterboxdUrl,
          url: partLetterboxdUrl,
          rankingGroupId,
          rankingGroupTitle: rankingGroupId ? titleParts.join("; ") : "",
          suppressAllTimeRank: explicitlyUnranked,
          compositeParts:
            titleStructure.kind === "composite"
              ? titleStructure.partTitles.map((title) => ({ title }))
              : null,
          awards: [],
        };
        if (options.includeRowNumbers)
          film.rowNumber = rowIndex + (hasHeader ? 2 : 1);
        films.push(film);
      });
    });
  });

  if (!films.length) return null;

  let yearGroups = {};
  let decadeGroups = {};
  let centuryGroups = {};

  let rankedFilms = films.filter((f) => !f.suppressAllTimeRank);

  rankedFilms.forEach((f) => {
    let yearValue = String(f.year || "").trim();
    let yearNum = Number(yearValue.replace(/[^0-9]/g, ""));
    if (yearValue && isFinite(yearNum)) {
      let yearKey = yearValue;
      yearGroups[yearKey] ||= [];
      yearGroups[yearKey].push(f);

      let decadeKey = Math.floor(yearNum / 10) * 10 + "s";
      decadeGroups[decadeKey] ||= [];
      decadeGroups[decadeKey].push(f);

      let centuryKey = Math.floor(yearNum / 100) * 100 + "s";
      centuryGroups[centuryKey] ||= [];
      centuryGroups[centuryKey].push(f);
    }
  });

  Object.values(yearGroups).forEach((group) =>
    assignRankedListGroupRanks(group, "yearRank"),
  );
  Object.values(decadeGroups).forEach((group) =>
    assignRankedListGroupRanks(group, "decadeRank"),
  );
  Object.values(centuryGroups).forEach((group) =>
    assignRankedListGroupRanks(group, "centuryRank"),
  );

  let nextAllTimeRank = 1;
  let rankingGroupRanks = new Map();
  rankedFilms.forEach((f) => {
    let rank = Number(f.rank);
    if (f.rankingGroupId && rankingGroupRanks.has(f.rankingGroupId)) {
      f.allTimeRank = rankingGroupRanks.get(f.rankingGroupId);
    } else {
      f.allTimeRank =
        Number.isFinite(rank) && rank > 0 ? rank : nextAllTimeRank;
      if (f.rankingGroupId)
        rankingGroupRanks.set(f.rankingGroupId, f.allTimeRank);
      nextAllTimeRank = f.allTimeRank + 1;
    }
    if (!Number.isFinite(rank) || rank <= 0) f.rank = f.allTimeRank;
  });

  resolveRankedListCompositeRelations(films);

  films.forEach((f) => {
    if (f.suppressAllTimeRank) {
      f.rank = null;
      f.allTimeRank = null;
    }
    if (!Number.isFinite(f.yearRank)) f.yearRank = f.rank;
    if (!Number.isFinite(f.decadeRank)) f.decadeRank = f.rank;
    if (!Number.isFinite(f.centuryRank)) f.centuryRank = f.rank;
  });

  return {
    yearKey: "alltime",
    films,
    diagnostics: { skippedRows, skippedDetails },
  };
}

function rankedListMediumKind(value) {
  let text = String(value || "")
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!text || /^(?:-|–|—|n\/?a|none|unknown)$/.test(text)) return "";
  if (/\b(?:anim|animated|animation|animerad|tecknad)\b/.test(text))
    return "animation";
  if (/\b(?:live action|liveaction|spelfilm)\b/.test(text))
    return "live-action";
  if (/\b(?:hybrid|mixed|mixad)\b/.test(text)) return "hybrid";
  return "";
}

function normalizeRankedListHeader(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function cleanRankedListDash(value) {
  let text = String(value || "")
    .replace(/[\u200E\u200F\u202A-\u202E]/g, "")
    .trim();
  return /^(?:-|–|—|n\/?a|none)$/i.test(text) ? "" : text;
}

function parseRankedListTitleStructure(value) {
  let text = String(value || "").trim();
  if (!text) return { kind: "single", titles: [] };
  let compositeParts = text.split(/\s+>\s+/);
  if (compositeParts.length > 1) {
    let canonicalTitle = compositeParts.shift().trim();
    let partTitles =
      window.splitTieCandidateTitles?.(compositeParts.join(" > ")) || [];
    return {
      kind: "composite",
      titles: canonicalTitle ? [canonicalTitle] : [],
      partTitles,
    };
  }
  let titles = window.splitTieCandidateTitles?.(text) || [text];
  return titles.length > 1
    ? { kind: "shared", titles }
    : { kind: "single", titles };
}

function alignedRankedListValues(value, count) {
  let text = String(value || "").trim();
  if (count > 1 && text.includes(";")) {
    let values = text.split(";").map((part) => part.trim());
    if (values.length === count) return values;
  }
  return [text];
}

function assignRankedListGroupRanks(group, field) {
  let nextRank = 1;
  let groupRanks = new Map();
  group.forEach((film) => {
    if (film.rankingGroupId && groupRanks.has(film.rankingGroupId)) {
      film[field] = groupRanks.get(film.rankingGroupId);
      return;
    }
    film[field] = nextRank;
    if (film.rankingGroupId) groupRanks.set(film.rankingGroupId, nextRank);
    nextRank += 1;
  });
}

function resolveRankedListCompositeRelations(films) {
  let byTitle = new Map();
  films.forEach((film) => {
    let key =
      window.normalizeTitle?.(film.title) ||
      String(film.title || "").toLowerCase();
    if (!key) return;
    let entries = byTitle.get(key) || [];
    entries.push(film);
    byTitle.set(key, entries);
  });

  films.forEach((film) => {
    if (!film.compositeParts?.length) return;
    film.compositeParts = film.compositeParts.map((part) => {
      let key =
        window.normalizeTitle?.(part.title) ||
        String(part.title || "").toLowerCase();
      let match = (byTitle.get(key) || []).find(
        (candidate) => candidate !== film,
      );
      let resolved = Object.assign({}, part);
      if (match?.year) resolved.year = match.year;
      if (match?.year && match?.title)
        resolved.id = window.makeFilmId?.(match.year, match.title);
      if (match) {
        match.canonicalComposite = {
          title: film.title,
          year: film.year,
          id: film.year ? window.makeFilmId?.(film.year, film.title) : "",
        };
      }
      return resolved;
    });
  });
}

function numberOrNull(value) {
  let text = cleanRankedListDash(value).replace(",", ".");
  if (!text) return null;
  let number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function musicScoreOrNull(value) {
  let text = cleanRankedListDash(value);
  if (!text) return null;
  let rating = window.renderFilmRating?.(text) || "";
  return rating || numberOrNull(text);
}

function positiveIntegerOrNull(value) {
  let text = cleanRankedListDash(value);
  let match = text.match(/\d+/);
  if (!match) return null;
  let number = Number(match[0]);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function inferRankedListMediumIndex(rows) {
  let maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  let best = { index: -1, score: 0 };
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    if (columnIndex <= 5) continue;
    let score = rows.reduce(
      (count, row) => count + (rankedListMediumKind(row[columnIndex]) ? 1 : 0),
      0,
    );
    if (score > best.score) {
      best = { index: columnIndex, score };
    }
  }
  return best.score ? best.index : -1;
}

function parseRankedListDelimitedRows(raw) {
  // Unlike line splitting, this preserves tabs and newlines inside quoted cells;
  // the source contains multi-film rows encoded that way.
  let text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let delimiter = text.includes("\t") ? "\t" : ",";
  let rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    let next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (ch === "\n" && !inQuotes) {
      row.push(cell.trim());
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  if (delimiter === "," && rows.every((r) => r.length === 1)) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) =>
        line
          .split(/\s{2,}/)
          .map((c) => c.trim())
          .filter(Boolean),
      );
  }

  return rows;
}
