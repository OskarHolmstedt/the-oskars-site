/**
 * @file Owns the central import transaction: dispatching supported formats,
 * merging parsed records into state, collecting diagnostics, and rendering the
 * resulting import report.
 */

/* ===========================
   IMPORT ENTRY POINT
=========================== */

/** Compares import fields after applying field-specific semantic normalization. @param {string} field Field name. @param {*} localValue Existing value. @param {*} incomingValue Imported value. @returns {boolean} Whether the values differ. */
function importFieldValuesDiffer(field, localValue, incomingValue) {
  if (field === "country" && window.countryListValues) {
    return (
      window.countryListValues(localValue).slice().sort().join("\n") !==
      window.countryListValues(incomingValue).slice().sort().join("\n")
    );
  }
  if (field === "adaptationSource" && window.normalizeAdaptationSource) {
    return (
      window.normalizeAdaptationSource(localValue) !==
      window.normalizeAdaptationSource(incomingValue)
    );
  }
  if (field === "director") {
    let norm = (val) => {
      let names = window.splitRecipientNames
        ? window.splitRecipientNames(val)
        : String(val || "")
            .split(/[,;&|/]/)
            .map((s) => s.trim())
            .filter(Boolean);
      return names
        .map(
          (name) =>
            window.resolveAwardRecipientPersonId?.(name) ||
            window.normalizePersonName?.(name) ||
            window.normalizeTitle?.(name) ||
            String(name).trim().toLowerCase(),
        )
        .filter(Boolean)
        .sort()
        .join("\n");
    };
    return norm(localValue) !== norm(incomingValue);
  }
  return String(localValue) !== String(incomingValue);
}
window.importFieldValuesDiffer = importFieldValuesDiffer;

/**
 * Imports one supported data format into application state and reports the merge.
 * @param {string} raw Raw import text.
 * @param {string} importType Import format identifier selected by the UI.
 * @param {Object} [options] Merge, parsing, persistence, and reporting options.
 * @param {boolean} [options.confirmDerivedRanks] Whether ranked imports confirm the year, decade, and century positions derived from global order.
 * @param {boolean} [options.checkEligibility] Whether to check nomination eligibility against metadata; defaults to true.
 * @param {string[][]} [options.rows] Pre-split table rows used in place of `raw`.
 * @param {string[][]} [options.tableRows] Alias of `rows`.
 * @param {number} [options.sheetStartRow] Sheet row number of the first table row.
 * @param {string} [options.sourceLabel] Source name used in warnings.
 * @param {boolean} [options.requireAllTimeMembership] Whether to report imported films missing from the all-time list.
 * @param {boolean} [options.silentReport] Whether to skip showing the import report.
 * @returns {ImportReport|null|undefined} Import report, null on exceptions, or
 *   undefined when input or import type validation stops the transaction.
 */
window.importData = function (raw, importType, options = {}) {
  try {
    if (importType === "ranked") importType = "list";
    let suppliedRows = options.rows || options.tableRows;

    if (!String(raw || "").trim() && !Array.isArray(suppliedRows)) {
      alert("Empty input");
      return;
    }
    let importedPeriods = new Set();
    let report = {
      source: importType === "table" ? "Bracket text" : "Ranked list",
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
    };

    function addTitleVariant(imported, matched) {
      if (!imported || !matched || imported === matched) return;
      let key = `${imported}\n${matched}`;
      if (
        !report.titleVariants.some(
          (variant) => `${variant.imported}\n${variant.matched}` === key,
        )
      ) {
        report.titleVariants.push({ imported, matched });
      }
    }

    // Cross-source rating/interest conflicts (issue #43): when a franchise or
    // Directors sheet row carries a rating/tier that disagrees with what the
    // same film already has from another source, the merge rules silently pick
    // a winner (existing archive rating and watchlist tier win; watched-other
    // ratings are overwritten). Flag each disagreement for review instead of
    // letting it vanish. Conflicts persist in state.sourceConflicts, replaced
    // per source on each import of that source.
    function sourceConflictKey(conflict) {
      return [
        conflict.source,
        conflict.target,
        conflict.field,
        conflict.title,
        conflict.year || "",
        conflict.existing,
        conflict.incoming,
      ].join("\n");
    }

    function recordSourceConflict(conflict) {
      let record = Object.assign({ source: report.source }, conflict);
      state.sourceConflicts ||= [];
      let key = sourceConflictKey(record);
      if (
        state.sourceConflicts.some(
          (existing) => sourceConflictKey(existing) === key,
        )
      )
        return;
      state.sourceConflicts.push(record);
      report.sourceConflicts.push(record);
    }

    function validateFilmAwards(film, periodType) {
      let canonical = window.findFilmByTitleYear(film);
      let validationFilm = Object.assign({}, film, {
        medium: canonical?.medium || film.medium,
        screenplayType: canonical?.screenplayType || film.screenplayType,
        country: canonical?.country || film.country,
        directors: canonical?.directors || film.directors,
        director: canonical?.director || film.director,
      });

      film.awards = (film.awards || []).filter((award) => {
        let result = window.validateAward(validationFilm, award, {
          periodType,
          checkEligibility: options.checkEligibility,
        });
        report.ruleWarnings += result.warnings.length;
        result.warnings.forEach((message) =>
          report.ruleWarningDetails.push({
            film: film.title,
            category: award.category,
            period: award.year || "",
            message,
          }),
        );
        if (!result.valid) {
          report.awardsRejected += 1;
          result.errors.forEach((message) =>
            report.ruleViolations.push({
              film: film.title,
              category: award.category,
              message,
            }),
          );
        }
        return result.valid;
      });
    }

    function allTimeRosterFilms() {
      let sourceFilms = state.years?.alltime?.films || [];
      if (sourceFilms.length) return sourceFilms;
      return (state.periods?.allTime?.all?.films || [])
        .map((entry) => state.filmsById?.[entry.id])
        .filter(Boolean);
    }

    function findAllTimeRosterFilm(film, period, periodType) {
      let title = normalizeTitle(film?.title || "");
      if (!title) return null;
      let candidates = allTimeRosterFilms().filter(
        (candidate) => normalizeTitle(candidate.title) === title,
      );
      let concreteYear = window.filmConcreteYear(film?.year);
      if (concreteYear) {
        let exact = candidates.find(
          (candidate) => String(candidate.year || "") === concreteYear,
        );
        if (exact) return exact;
      }
      if (period && periodType) {
        let inPeriod = candidates.find((candidate) =>
          window.periodTypeKeyContainsYear(periodType, period, candidate.year),
        );
        if (inPeriod) return inPeriod;
      }
      return candidates[0] || null;
    }

    function canonicalYearForImportedYearBlock(data) {
      if (
        data.periodType !== "years" ||
        !/^\d{4}$/.test(String(data.year || ""))
      )
        return "";
      let counts = new Map();
      let matched = 0;
      (data.films || []).forEach((film) => {
        let counterpart = findAllTimeRosterFilm(
          film,
          data.year,
          data.periodType,
        );
        let year = String(counterpart?.year || "");
        if (!/^\d{4}$/.test(year)) return;
        matched += 1;
        counts.set(year, (counts.get(year) || 0) + 1);
      });
      if (!matched || counts.size !== 1) return "";
      let [[canonicalYear, count]] = [...counts.entries()];
      if (canonicalYear === String(data.year)) return "";
      let required = Math.max(2, Math.ceil((data.films || []).length * 0.6));
      return count >= required ? canonicalYear : "";
    }

    function retargetYearBlock(data, nextYear) {
      let previousYear = String(data.year || "");
      if (!nextYear || nextYear === previousYear) return;
      data.year = nextYear;
      (data.films || []).forEach((film) => {
        if (String(film.year || "") === previousYear) film.year = nextYear;
        (film.awards || []).forEach((award) => {
          if (String(award.year || "") === previousYear) award.year = nextYear;
        });
      });
      report.warnings.push(
        `${options.sourceLabel || "Bracket"} year block marked ${previousYear} was assigned to ${nextYear} from all-time release years.`,
      );
    }

    function recordMissingAllTimeFilm(film, period, periodType) {
      if (!options.requireAllTimeMembership) return;
      let roster = allTimeRosterFilms();
      if (!roster.length) return;
      if (findAllTimeRosterFilm(film, period, periodType)) return;
      let key = `${period}\n${normalizeTitle(film.title)}\n${film.rank || ""}`;
      if (
        report.missingAllTimeFilms.some(
          (entry) =>
            `${entry.period}\n${normalizeTitle(entry.title)}\n${entry.rank || ""}` ===
            key,
        )
      )
        return;
      report.missingAllTimeFilms.push({
        title: film.title,
        period,
        periodType,
        rank: film.rank || "",
      });
    }

    function resolveImportedFilmYear(data, film) {
      if (window.filmConcreteYear(film?.year)) return;
      let counterpart = findAllTimeRosterFilm(film, data.year, data.periodType);
      if (counterpart?.year && window.filmConcreteYear(counterpart.year)) {
        film.year = String(counterpart.year);
      }
    }

    function addOrUpdateYearFilm(year, f, options = {}) {
      state.years[year] ||= { films: [] };
      if (options.periodType) state.years[year].periodType = options.periodType;
      let existing = state.years[year].films.find((x) =>
        window.sameFilmIdentity(x, f),
      );
      if (existing) {
        report.filmsMerged += 1;
        addTitleVariant(f.title, existing.title);
        let awardsBefore = existing.awards?.length || 0;

        // A local value only ever loses to an incoming one when the local
        // field was empty - flag it whenever both sides actually disagree,
        // so a re-import surfaces "kept your edit" instead of hiding it.
        function preserveLocalField(field, incomingValue) {
          let localValue = existing[field];
          if (localValue) {
            if (
              incomingValue &&
              importFieldValuesDiffer(field, localValue, incomingValue)
            ) {
              report.preservedFieldDetails.push({
                title: existing.title,
                year,
                field,
                local: String(localValue),
                incoming: String(incomingValue),
              });
            }
            return localValue;
          }
          return incomingValue;
        }

        let rankBefore = existing.rank;
        let existingHasRank = [
          existing.rank,
          existing.yearRank,
          existing.decadeRank,
          existing.centuryRank,
          existing.allTimeRank,
        ].some((rank) => Number(rank) > 0);
        let preserveExistingRankForUnrankedMetadata = Boolean(
          f.suppressAllTimeRank && existingHasRank,
        );
        existing.rank =
          options.replaceRanks && !preserveExistingRankForUnrankedMetadata
            ? f.rank
            : existing.rank || f.rank;
        existing.yearRank =
          options.replaceRanks && !preserveExistingRankForUnrankedMetadata
            ? f.yearRank
            : existing.yearRank || f.yearRank;
        existing.decadeRank =
          options.replaceRanks && !preserveExistingRankForUnrankedMetadata
            ? f.decadeRank
            : existing.decadeRank || f.decadeRank;
        existing.centuryRank =
          options.replaceRanks && !preserveExistingRankForUnrankedMetadata
            ? f.centuryRank
            : existing.centuryRank || f.centuryRank;
        existing.allTimeRank =
          options.replaceRanks && !preserveExistingRankForUnrankedMetadata
            ? f.allTimeRank
            : existing.allTimeRank || f.allTimeRank;
        if (
          Number.isFinite(existing.rank) &&
          existing.rank !== rankBefore &&
          rankBefore != null
        ) {
          report.rankChanges.push({
            title: existing.title,
            year,
            before: rankBefore,
            after: existing.rank,
          });
        }
        let existingRating = window.parseFilmRating?.(existing);
        let incomingRating = window.parseFilmRating?.(f);
        let existingHasRating = Boolean(
          existingRating?.value || existing.rating,
        );
        let incomingHasRating = Boolean(incomingRating?.value || f.rating);

        if (!existingHasRating && incomingHasRating) {
          existing.rating = f.rating;
          existing.ratingValue = incomingRating?.value ?? f.ratingValue;
          existing.ratingModifier =
            incomingRating?.modifier ?? f.ratingModifier ?? "";
        } else if (existingHasRating && incomingHasRating) {
          let sameBaseValue =
            Boolean(existingRating?.value) &&
            existingRating.value === incomingRating?.value;
          let incomingHigherResolution =
            sameBaseValue &&
            !existingRating.modifier &&
            Boolean(incomingRating?.modifier);
          let sameRatingSemantics =
            sameBaseValue &&
            (existingRating.modifier || "") ===
              (incomingRating?.modifier || "");
          let localHigherResolution =
            sameBaseValue &&
            Boolean(existingRating.modifier) &&
            !incomingRating?.modifier;

          if (incomingHigherResolution) {
            existing.rating = f.rating;
            existing.ratingValue = incomingRating.value;
            existing.ratingModifier = incomingRating.modifier || "";
          } else if (!sameRatingSemantics && !localHigherResolution) {
            report.preservedFieldDetails.push({
              title: existing.title,
              year,
              field: "rating",
              local: existing.rating,
              incoming: f.rating,
            });
          }
        }
        window.normalizeFilmRatingFields?.(existing);
        existing.url = preserveLocalField("url", f.url || f.letterboxdUrl);
        existing.director = preserveLocalField("director", f.director);
        existing.country = preserveLocalField("country", f.country);
        existing.type = preserveLocalField("type", f.type);
        existing.liveAction = preserveLocalField("liveAction", f.liveAction);
        existing.adaptation = preserveLocalField("adaptation", f.adaptation);
        existing.adaptationSource = window.normalizeAdaptationSource
          ? window.normalizeAdaptationSource(
              preserveLocalField("adaptationSource", f.adaptationSource),
            )
          : preserveLocalField("adaptationSource", f.adaptationSource);
        existing.tmdbId = preserveLocalField("tmdbId", f.tmdbId);
        existing.letterboxdUrl = preserveLocalField(
          "letterboxdUrl",
          f.letterboxdUrl,
        );
        existing.platform = preserveLocalField("platform", f.platform);
        existing.dateWatched = preserveLocalField("dateWatched", f.dateWatched);
        existing.views = preserveLocalField("views", f.views);
        existing.musicScore = preserveLocalField("musicScore", f.musicScore);
        existing.musicRating = preserveLocalField("musicRating", f.musicRating);
        existing.musicRatingValue = preserveLocalField(
          "musicRatingValue",
          f.musicRatingValue,
        );
        existing.runtimeMinutes = preserveLocalField(
          "runtimeMinutes",
          f.runtimeMinutes,
        );
        existing.rankingGroupId = preserveLocalField(
          "rankingGroupId",
          f.rankingGroupId,
        );
        existing.rankingGroupTitle = preserveLocalField(
          "rankingGroupTitle",
          f.rankingGroupTitle,
        );
        // Boolean, so preserveLocalField's truthy check would wipe out a
        // real `false` (reset-but-unconfirmed) - local state always wins
        // when set, matching the suppressAllTimeRank handling below.
        if (
          !Object.prototype.hasOwnProperty.call(existing, "rankConfirmed") &&
          Object.prototype.hasOwnProperty.call(f, "rankConfirmed")
        ) {
          existing.rankConfirmed = f.rankConfirmed;
        }
        if (options.replaceRanks && !f.suppressAllTimeRank) {
          existing.rankConfirmed = true;
          existing.rankConfirmedByScope = {
            ...existing.rankConfirmedByScope,
            ...f.rankConfirmedByScope,
            allTime: true,
          };
        }
        if (f.compositeParts?.length)
          existing.compositeParts = f.compositeParts;
        if (f.canonicalComposite)
          existing.canonicalComposite = f.canonicalComposite;
        if (
          Object.prototype.hasOwnProperty.call(f, "suppressAllTimeRank") &&
          !preserveExistingRankForUnrankedMetadata
        ) {
          existing.suppressAllTimeRank = Boolean(f.suppressAllTimeRank);
        }
        existing.tags =
          window.parseFilmTags?.([
            ...(existing.tags || []),
            ...(f.tags || []),
          ]) ||
          existing.tags ||
          f.tags ||
          [];
        existing.franchises =
          window.normalizeFranchiseMemberships?.([
            ...(existing.franchises || []),
            ...(f.franchises || []),
          ]) ||
          existing.franchises ||
          f.franchises ||
          [];
        existing.awards ||= [];
        (f.awards || []).forEach((a) => {
          let found = existing.awards.find((x) => window.sameAward(x, a));
          if (!found) {
            existing.awards.push(a);
            report.awardChanges.push({
              title: existing.title,
              year,
              category: a.category,
              placement: a.placement,
            });
          }
        });
        report.awardsAdded += existing.awards.length - awardsBefore;

        if (window.addFilmToStore) {
          let actualYear =
            f.year && /^[0-9]{4}$/.test(f.year.trim()) ? f.year.trim() : year;
          let canonical = window.addFilmToStore(actualYear, existing, options);
          addTitleVariant(f.title, canonical.title);
          if (canonical !== existing) {
            state.years[year].films = state.years[year].films.map((x) =>
              window.sameFilmIdentity(x, existing) ? canonical : x,
            );
          }
          if (options.addToDerivedPeriods !== false && actualYear !== year) {
            state.years[actualYear] ||= { films: [] };
            let existingYear = state.years[actualYear].films.find((x) =>
              window.sameFilmIdentity(x, canonical),
            );
            if (!existingYear) {
              state.years[actualYear].films.push(canonical);
            }
          }
        }
      } else {
        report.filmsAdded += 1;
        report.awardsAdded += (f.awards || []).length;
        report.newFilmDetails.push({
          title: f.title,
          year,
          rank: f.rank || "",
        });
        let copy = window.cloneRecord(f);
        window.normalizeFilmRatingFields?.(copy);
        state.years[year].films.push(copy);
        if (window.addFilmToStore) {
          let actualYear =
            f.year && /^[0-9]{4}$/.test(f.year.trim()) ? f.year.trim() : year;
          let canonical = window.addFilmToStore(actualYear, copy, options);
          addTitleVariant(f.title, canonical.title);

          let key = year;
          state.years[key].films = state.years[key].films.map((x) =>
            window.sameFilmIdentity(x, copy) ? canonical : x,
          );

          if (options.addToDerivedPeriods !== false && actualYear !== year) {
            state.years[actualYear] ||= { films: [] };
            let existingYear = state.years[actualYear].films.find((x) =>
              window.sameFilmIdentity(x, canonical),
            );
            if (!existingYear) {
              state.years[actualYear].films.push(canonical);
            }
          }
        }
      }
    }

    function cleanTableCell(value) {
      return String(value || "").trim();
    }

    function bracketMetaColumn(row) {
      return (row || []).findIndex((cell) => cleanTableCell(cell) === "Year");
    }

    function tableBlockLabelFromRows(rows, index, startRow) {
      let metaCol = bracketMetaColumn(rows?.[0] || []);
      let metaType = cleanTableCell(rows?.[1]?.[metaCol]);
      let metaValue = cleanTableCell(rows?.[2]?.[metaCol]);

      let source =
        options.sourceLabel ||
        (importType === "table" ? "bracket" : importType);
      let rowText = startRow ? ` row ${startRow}` : "";

      if (metaType && metaValue) {
        return `${source} block ${index + 1}${rowText} near "${metaType} ${metaValue}"`;
      }

      return `${source} block ${index + 1}${rowText}`;
    }

    function tableBlockLabel(chunk, index) {
      let rows = String(chunk || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .map((line) => line.split("\t"));

      return tableBlockLabelFromRows(rows, index, "");
    }

    if (importType === "table") {
      let tableRows = Array.isArray(options.tableRows)
        ? options.tableRows
        : String(raw || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .split("\n")
            .map((line) => line.split("\t"));

      let blocks = window.splitBracketSheetBlocks(tableRows, {
        sheetStartRow: options.sheetStartRow || 1,
      });
      let allYears = [];

      blocks.forEach((block, blockIndex) => {
        let chunk = typeof block === "string" ? block : block.raw;
        let blockLabel =
          block.label ||
          (block.rows
            ? tableBlockLabelFromRows(block.rows, blockIndex, block.rowNumber)
            : tableBlockLabel(chunk, blockIndex));
        let data = block.rows
          ? parseTable("", {
              rows: block.rows,
              checkEligibility: options.checkEligibility,
            })
          : parseTable(chunk, {
              checkEligibility: options.checkEligibility,
            });

        if (!data) {
          report.skipped += 1;
          report.warnings.push(`${blockLabel} could not be parsed.`);
          report.skippedDetails.push({
            rowNumber: block.rowNumber || "",
            reason: "Bracket block could not be parsed.",
            values: [blockLabel],
          });
          return;
        }

        if (!data.films?.length) return;

        retargetYearBlock(data, canonicalYearForImportedYearBlock(data));
        if (window.categories && data.films) {
          data.films.forEach((f) => {
            (f.awards || []).forEach((a) => {
              if (a && a.category && !window.categories.includes(a.category)) {
                window.categories.push(a.category);
              }
            });
          });
        }

        let year = data.year;
        // Row 3 of each bracket block's Period column is a source URL
        // (typically a Letterboxd list for that year) - parsed above but
        // otherwise dropped; store it on the period so it can be linked.
        state.years[year] ||= { films: [] };
        if (data.sourceUrl) state.years[year].sourceUrl = data.sourceUrl;
        importedPeriods.add(year);
        report.filmsParsed += data.films.length;
        report.awardsRejected += data.diagnostics?.rejectedAwards?.length || 0;
        (data.diagnostics?.rejectedAwards || []).forEach((violation) =>
          report.ruleViolations.push(violation),
        );
        data.films.forEach((f) => {
          if (!f.rank) f.rank = f.rank || 0;
          resolveImportedFilmYear(data, f);
          recordMissingAllTimeFilm(f, year, data.periodType);
          validateFilmAwards(f, data.periodType);
          addOrUpdateYearFilm(year, f, {
            addToAllTime: false,
            periodType: data.periodType,
            periodKey: data.periodType === "allTime" ? "all" : year,
          });
        });
        allYears.push(year);
        state.selectedPeriodType =
          data.periodType === "decades"
            ? "decade"
            : data.periodType === "centuries"
              ? "century"
              : data.periodType === "allTime"
                ? "alltime"
                : "year";
      });

      state.selectedYears = allYears;
      let periodRadio = document.querySelector?.(
        `input[name="periodType"][value="${state.selectedPeriodType}"]`,
      );
      if (periodRadio) periodRadio.checked = true;
    } else if (importType === "list") {
      let data = parseRankedList(raw);
      if (!data) {
        report.skipped += 1;
        report.warnings.push(
          "Ranked-list input could not be parsed. Check the header row and film rows.",
        );
        report.skippedDetails.push({
          rowNumber: "",
          reason: "Ranked-list input could not be parsed.",
          values: [],
        });
      } else {
        importedPeriods.add(data.yearKey);
        report.filmsParsed += data.films.length;
        report.skipped += data.diagnostics?.skippedRows || 0;
        report.skippedDetails.push(...(data.diagnostics?.skippedDetails || []));
        if (report.skipped)
          report.warnings.push(
            `${report.skipped} ranked-list row(s) had no usable film title.`,
          );

        data.films.forEach((f, idx) => {
          if (!f.suppressAllTimeRank && !Number.isFinite(f.rank))
            f.rank = idx + 1;
          if (!f.suppressAllTimeRank) {
            f.rankConfirmed = true;
            f.rankConfirmedByScope = options.confirmDerivedRanks
              ? { allTime: true, years: true, decades: true, centuries: true }
              : { allTime: true };
          }
          addOrUpdateYearFilm(data.yearKey, f, {
            addToAllTime: !f.suppressAllTimeRank,
            addToDerivedPeriods: false,
            replaceRanks: true,
          });
        });
        // Every source copy must carry the reviewed order. Later award merges
        // read these records rather than the temporary canonical film store.
        let reviewedRanks = new Map(
          data.films
            .filter((film) => !film.suppressAllTimeRank)
            .map((film) => [
              window.filmIdentityKey(film, { includePeriodKey: true }),
              film,
            ]),
        );
        Object.entries(state.years).forEach(([key, period]) => {
          (period.films || []).forEach((film) => {
            let reviewed = reviewedRanks.get(
              window.filmIdentityKey(film, { includePeriodKey: true }),
            );
            if (!reviewed) return;
            ["allTimeRank", "yearRank", "decadeRank", "centuryRank"].forEach(
              (field) => {
                film[field] = reviewed[field];
              },
            );
            film.rankConfirmed = true;
            film.rankConfirmedByScope = {
              ...film.rankConfirmedByScope,
              ...reviewed.rankConfirmedByScope,
            };
            film.suppressAllTimeRank = false;
            let scopeType =
              period.periodType ||
              (key === "alltime"
                ? "allTime"
                : /^\d{4}$/.test(key)
                  ? "years"
                  : "");
            let rankField = window.RANK_FIELD_BY_SCOPE_TYPE[scopeType];
            if (rankField) film.rank = reviewed[rankField];
          });
        });
        state.selectedYears = [data.yearKey];
        state.selectedPeriodType = "alltime";
        let alltimeRadio = document.querySelector?.(
          'input[name="periodType"][value="alltime"]',
        );
        if (alltimeRadio) alltimeRadio.checked = true;
      }
    } else if (importType === "watchlist") {
      let data = window.parseWatchlist(raw);
      state.watchlist ||= [];
      let existingById = new Map();
      state.watchlist.forEach((item) => {
        let id = item.id || window.watchlistItemId?.(item);
        if (id) existingById.set(id, item);
      });
      let added = 0;
      let merged = 0;
      data.items.forEach((incoming) => {
        let id = incoming.id || window.watchlistItemId?.(incoming);
        let existing = id ? existingById.get(id) : null;
        if (!existing) {
          let normalized = normalizeTitle(incoming.title || "");
          let year = String(incoming.year || "").trim();
          existing = state.watchlist.find(
            (item) =>
              normalizeTitle(item.title || "") === normalized &&
              String(item.year || "").trim() === year,
          );
        }
        if (existing) {
          merged += 1;
          if (incoming.tier && !existing.tier) {
            existing.tier = incoming.tier;
          } else if (
            incoming.tier &&
            existing.tier &&
            existing.tier !== incoming.tier
          ) {
            recordSourceConflict({
              target: "watchlist",
              field: "tier",
              title: existing.title,
              year: existing.year || "",
              rowNumber: incoming.rowNumber || "",
              existing: existing.tier,
              incoming: incoming.tier,
              kept: "existing",
            });
          }
          if (incoming.director && !existing.director)
            existing.director = incoming.director;
          if (incoming.letterboxdUrl && !existing.letterboxdUrl)
            existing.letterboxdUrl = incoming.letterboxdUrl;
          if (incoming.tmdbId && !existing.tmdbId)
            existing.tmdbId = incoming.tmdbId;
          if (incoming.franchises?.length) {
            existing.franchises =
              window.normalizeFranchiseMemberships?.([
                ...(existing.franchises || []),
                ...incoming.franchises,
              ]) || existing.franchises;
          }
          if (incoming.tags?.length) {
            existing.tags = Array.from(
              new Set([...(existing.tags || []), ...incoming.tags]),
            );
          }
        } else {
          added += 1;
          state.watchlist.push(incoming);
          if (id) existingById.set(id, incoming);
        }
      });
      window.recomputeWatchlistOrder?.();
      state.watchlistOrderVersion = 1;
      report.source = "Watchlist";
      report.filmsParsed = data.items.length;
      report.filmsAdded = added;
      report.filmsMerged = merged;
      report.skipped += data.diagnostics?.skippedRows || 0;
      report.skippedDetails.push(...(data.diagnostics?.skippedDetails || []));
      if (report.skipped)
        report.warnings.push(
          `${report.skipped} watchlist row(s) had no usable film title.`,
        );
    } else {
      alert("Unknown import type: " + importType);
      return;
    }

    report.periods = [...importedPeriods];
    if (report.awardsRejected)
      report.warnings.push(
        `${report.awardsRejected} award nomination(s) were rejected by data rules.`,
      );
    if (report.ruleWarnings)
      report.warnings.push(
        `${report.ruleWarnings} eligibility check(s) could not be completed because metadata is unknown.`,
      );
    if (report.missingAllTimeFilms?.length)
      report.warnings.push(
        `${report.missingAllTimeFilms.length} bracket film(s) were not found in the all-time ranked list.`,
      );
    if (report.rankChanges?.length)
      report.warnings.push(
        `${report.rankChanges.length} existing film rank(s) were updated.`,
      );
    if (report.preservedFieldDetails?.length)
      report.warnings.push(
        `${report.preservedFieldDetails.length} field(s) had a differing incoming value but kept the existing local value.`,
      );
    if (report.sourceConflicts?.length)
      report.warnings.push(
        `${report.sourceConflicts.length} row(s) carried a rating or interest tier that disagrees with another source; see the cross-source conflicts table.`,
      );
    window.lastImportReport = report;
    if (!options.silentReport) window.showImportReport?.(report);
    return report;
  } catch (err) {
    console.error?.(err);
    alert?.(
      "Import failed: " + (err && err.message ? err.message : String(err)),
    );
    return null;
  }
};
