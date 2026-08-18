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
      window.countryListValues(localValue).join("\n") !==
      window.countryListValues(incomingValue).join("\n")
    );
  }
  return String(localValue) !== String(incomingValue);
}

/**
 * Imports one supported data format into application state and reports the merge.
 * @param {string} raw Raw import text.
 * @param {string} importType Import format identifier selected by the UI.
 * @param {Object} [options] Merge, parsing, persistence, and reporting options.
 * @returns {ImportReport|null|undefined} Import report, null on exceptions, or
 *   undefined when input or import type validation stops the transaction.
 */
window.importData = function (raw, importType, options = {}) {
  try {
    let suppliedRows =
      options.rows ||
      options.tableRows ||
      options.collectionAwardRows ||
      options.directorRows ||
      options.franchiseRows;

    if (!String(raw || "").trim() && !Array.isArray(suppliedRows)) {
      alert("Empty input");
      return;
    }
    let report = {
      source:
        importType === "table"
          ? "Bracket text"
          : importType === "collection-awards"
            ? "Collection awards"
            : "Ranked list",
      filmsParsed: 0,
      filmsAdded: 0,
      filmsMerged: 0,
      awardsAdded: 0,
      awardsRejected: 0,
      ruleWarnings: 0,
      skipped: 0,
      periods: new Set(),
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

    function ratingsDisagree(existingValue, incomingValue) {
      let existing = window.filmRatingSortValue?.(existingValue) ?? 0;
      let incoming = window.filmRatingSortValue?.(incomingValue) ?? 0;
      return Boolean(existing && incoming && existing !== incoming);
    }

    function recordArchiveRatingConflicts(entry) {
      Object.values(state.years || {}).forEach((period) => {
        (period.films || []).forEach((film) => {
          if (!sourceFilmMatchesEntry(film, entry)) return;
          if (!ratingsDisagree(film, entry.rating)) return;
          recordSourceConflict({
            target: "archive",
            field: "rating",
            title: film.title,
            year: film.year || "",
            rowNumber: entry.rowNumber || "",
            existing:
              window.renderFilmRating?.(film) || String(film.rating || ""),
            incoming:
              window.renderFilmRating?.(entry.rating) ||
              String(entry.rating || ""),
            kept: "existing",
          });
        });
      });
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
        let preserveExistingRankForUnrankedMetadata = Boolean(
          f.suppressAllTimeRank && Number(existing.allTimeRank) > 0,
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
        if (!existing.rating && f.rating) {
          existing.rating = f.rating;
          existing.ratingValue = f.ratingValue;
          existing.ratingModifier = f.ratingModifier || "";
        } else if (
          existing.rating &&
          f.rating &&
          f.rating !== existing.rating
        ) {
          report.preservedFieldDetails.push({
            title: existing.title,
            year,
            field: "rating",
            local: existing.rating,
            incoming: f.rating,
          });
        }
        window.normalizeFilmRatingFields?.(existing);
        existing.url = preserveLocalField("url", f.url || f.letterboxdUrl);
        existing.director = preserveLocalField("director", f.director);
        existing.country = preserveLocalField("country", f.country);
        existing.type = preserveLocalField("type", f.type);
        existing.liveAction = preserveLocalField("liveAction", f.liveAction);
        existing.adaptation = preserveLocalField("adaptation", f.adaptation);
        existing.adaptationSource = preserveLocalField(
          "adaptationSource",
          f.adaptationSource,
        );
        existing.tmdbId = preserveLocalField("tmdbId", f.tmdbId);
        existing.letterboxdUrl = preserveLocalField(
          "letterboxdUrl",
          f.letterboxdUrl,
        );
        existing.platform = preserveLocalField("platform", f.platform);
        existing.dateWatched = preserveLocalField("dateWatched", f.dateWatched);
        existing.views = preserveLocalField("views", f.views);
        existing.musicScore = preserveLocalField("musicScore", f.musicScore);
        existing.musicRating = preserveLocalField(
          "musicRating",
          f.musicRating,
        );
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

    function sourceFilmMatchesEntry(film, entry) {
      let title = normalizeTitle(entry?.title || "");
      if (!title || normalizeTitle(film?.title || "") !== title) return false;
      if (
        entry.year &&
        window.filmConcreteYear?.(film?.year) !== entry.year &&
        String(film?.year || "") !== entry.year
      )
        return false;
      return true;
    }

    function addFranchiseToFilmSource(film, membership) {
      let before = window.formatFranchiseMemberships?.(film.franchises) || "";
      film.franchises = window.normalizeFranchiseMemberships?.([
        ...(film.franchises || []),
        membership,
      ]) ||
        film.franchises || [membership];
      let after = window.formatFranchiseMemberships?.(film.franchises) || "";
      return before !== after;
    }

    function updateSourceFilmsForFranchise(entry, membership) {
      let matched = 0;
      let updated = 0;
      Object.values(state.years || {}).forEach((period) => {
        (period.films || []).forEach((film) => {
          if (!sourceFilmMatchesEntry(film, entry)) return;
          matched += 1;
          if (addFranchiseToFilmSource(film, membership)) updated += 1;
        });
      });
      return { matched, updated };
    }

    function countSourceFilmsForEntry(entry) {
      let matched = 0;
      Object.values(state.years || {}).forEach((period) => {
        (period.films || []).forEach((film) => {
          if (sourceFilmMatchesEntry(film, entry)) matched += 1;
        });
      });
      return matched;
    }

    function watchlistCandidatesForFranchiseEntry(entry) {
      let title = normalizeTitle(entry?.title || "");
      if (!title) return [];
      return (state.watchlist || []).filter(
        (item) => normalizeTitle(item.title) === title,
      );
    }

    function findWatchlistItemForFranchiseEntry(entry) {
      let candidates = watchlistCandidatesForFranchiseEntry(entry);
      if (entry.year) {
        return (
          candidates.find((item) => String(item.year || "") === entry.year) ||
          null
        );
      }
      return candidates.length === 1 ? candidates[0] : null;
    }

    function watchlistItemMatchesFranchiseEntry(item, entry) {
      if (
        normalizeTitle(item?.title || "") !== normalizeTitle(entry?.title || "")
      )
        return false;
      if (entry.year && String(item?.year || "") !== entry.year) return false;
      return true;
    }

    function removeWatchlistItemsForFranchiseEntry(entry) {
      let before = (state.watchlist || []).length;
      state.watchlist = (state.watchlist || []).filter(
        (item) => !watchlistItemMatchesFranchiseEntry(item, entry),
      );
      return before - state.watchlist.length;
    }

    function upsertWatchlistFranchiseEntry(entry, membership) {
      let item = findWatchlistItemForFranchiseEntry(entry);
      if (item) {
        let before = window.formatFranchiseMemberships?.(item.franchises) || "";
        item.franchises = window.normalizeFranchiseMemberships?.([
          ...(item.franchises || []),
          membership,
        ]) ||
          item.franchises || [membership];
        let tierChanged = Boolean(entry.tier && !item.tier);
        if (tierChanged) item.tier = entry.tier;
        else if (entry.tier && item.tier && item.tier !== entry.tier) {
          recordSourceConflict({
            target: "watchlist",
            field: "tier",
            title: item.title,
            year: item.year || "",
            rowNumber: entry.rowNumber || "",
            existing: item.tier,
            incoming: entry.tier,
            kept: "existing",
          });
        }
        if (!item.id) item.id = window.watchlistItemId?.(item);
        let after = window.formatFranchiseMemberships?.(item.franchises) || "";
        return { added: false, changed: before !== after || tierChanged };
      }
      item = window.normalizeWatchlistItem?.({
        title: entry.title,
        year: entry.year,
        tier: entry.tier,
        franchises: [membership],
      });
      if (!item) return { added: false, changed: false };
      state.watchlist ||= [];
      state.watchlist.push(item);
      return { added: true, changed: true };
    }

    function upsertWatchlistDirectorEntry(entry) {
      let item = findWatchlistItemForFranchiseEntry(entry);
      if (item) {
        let changed = false;
        if (entry.director && !item.director) {
          item.director = entry.director;
          changed = true;
        }
        if (entry.tier && !item.tier) {
          item.tier = entry.tier;
          changed = true;
        } else if (entry.tier && item.tier && item.tier !== entry.tier) {
          recordSourceConflict({
            target: "watchlist",
            field: "tier",
            title: item.title,
            year: item.year || "",
            rowNumber: entry.rowNumber || "",
            existing: item.tier,
            incoming: entry.tier,
            kept: "existing",
          });
        }
        if (!item.id) item.id = window.watchlistItemId?.(item);
        return { added: false, changed };
      }
      item = window.normalizeWatchlistItem?.({
        title: entry.title,
        year: entry.year,
        tier: entry.tier,
        director: entry.director,
      });
      if (!item) return { added: false, changed: false };
      state.watchlist ||= [];
      state.watchlist.push(item);
      return { added: true, changed: true };
    }

    // Rated, already-watched entries that don't match any archive film (e.g.
    // a miniseries or other non-film credit) aren't a watchlist item and
    // aren't a canonical film, so they're kept in their own collection.
    function upsertWatchedOtherEntry(entry, extra = {}) {
      state.watchedOther ||= [];
      let year = String(entry.year || "");
      let id = `${year}::${normalizeTitle(entry.title || "")}`;
      let membership = extra.franchiseName
        ? {
            name: extra.franchiseName,
            parentName: extra.parentName || "",
            parentChain: extra.parentChain || [],
            rank: extra.rank,
          }
        : null;
      let existing = state.watchedOther.find((item) => item.id === id);
      if (existing) {
        let changed = false;
        if (entry.rating && existing.rating !== entry.rating) {
          if (ratingsDisagree(existing, entry.rating)) {
            recordSourceConflict({
              target: "watched-other",
              field: "rating",
              title: existing.title,
              year: existing.year || "",
              rowNumber: entry.rowNumber || "",
              existing:
                window.renderFilmRating?.(existing) ||
                String(existing.rating || ""),
              incoming:
                window.renderFilmRating?.(entry.rating) ||
                String(entry.rating || ""),
              kept: "incoming",
            });
          }
          existing.rating = entry.rating;
          existing.ratingValue = entry.ratingValue || 0;
          changed = true;
        }
        if (extra.director && !existing.director) {
          existing.director = extra.director;
          changed = true;
        }
        if (membership) {
          let before =
            window.formatFranchiseMemberships?.(existing.franchises) || "";
          existing.franchises = window.normalizeFranchiseMemberships?.([
            ...(existing.franchises || []),
            membership,
          ]) ||
            existing.franchises || [membership];
          let after =
            window.formatFranchiseMemberships?.(existing.franchises) || "";
          if (before !== after) changed = true;
        }
        return { added: false, changed };
      }
      state.watchedOther.push({
        id,
        title: entry.title,
        year,
        type: "unknown",
        rating: entry.rating || "",
        ratingValue: entry.ratingValue || 0,
        director: extra.director || "",
        franchises: membership ? [membership] : [],
        rowNumber: entry.rowNumber,
      });
      return { added: true, changed: true };
    }

    function diaryWatchedRecord(entry) {
      let year = String(entry.year || "").trim();
      let record = window.cloneRecord(entry);
      record.id = `${year}::${normalizeTitle(entry.title || "")}`;
      record.normalizedTitle = normalizeTitle(entry.title || "");
      record.year = year;
      record.type = String(entry.type || "").trim();
      record.awards = [];
      window.normalizeFilmMetadata?.(record);
      return record;
    }

    function upsertDiaryWatchedEntry(entry) {
      state.watchedOther ||= [];
      let incoming = diaryWatchedRecord(entry);
      let existing = state.watchedOther.find(
        (item) => item.id === incoming.id,
      );
      if (!existing) {
        state.watchedOther.push(incoming);
        return { added: true, changed: true };
      }

      let before = JSON.stringify(existing);
      let scalarFields = [
        "title",
        "director",
        "rating",
        "ratingValue",
        "ratingModifier",
        "medium",
        "screenplayType",
        "adaptationSource",
        "country",
        "primaryCountry",
        "platform",
        "runtimeMinutes",
        "tmdbId",
        "letterboxdUrl",
        "url",
        "musicScore",
      ];
      scalarFields.forEach((field) => {
        if (
          (existing[field] === undefined ||
            existing[field] === null ||
            existing[field] === "" ||
            existing[field] === "unknown") &&
          incoming[field] !== undefined &&
          incoming[field] !== null &&
          incoming[field] !== ""
        ) {
          existing[field] = window.cloneRecord(incoming[field]);
        }
      });
      if (!existing.type || existing.type === "unknown")
        existing.type = incoming.type;
      existing.views = Math.max(
        Number(existing.views) || 0,
        Number(incoming.views) || 0,
      ) || null;
      if (
        incoming.dateWatched &&
        (!existing.dateWatched || incoming.dateWatched > existing.dateWatched)
      ) {
        existing.dateWatched = incoming.dateWatched;
      }
      existing.tags = window.parseFilmTags?.([
        ...(existing.tags || []),
        ...(incoming.tags || []),
      ]) || existing.tags || incoming.tags || [];
      existing.franchises = window.normalizeFranchiseMemberships?.([
        ...(existing.franchises || []),
        ...(incoming.franchises || []),
      ]) || existing.franchises || incoming.franchises || [];
      window.normalizeFilmMetadata?.(existing);
      return { added: false, changed: JSON.stringify(existing) !== before };
    }

    function findDiaryArchiveFilm(entry) {
      let title = normalizeTitle(entry?.title || "");
      let year = String(entry?.year || "").trim();
      if (!title || !year) return null;
      return (
        allTimeRosterFilms().find(
          (film) =>
            normalizeTitle(film.title) === title &&
            String(film.year || "").trim() === year,
        ) || null
      );
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

    if (importType === "collection-awards") {
      let tableRows = Array.isArray(options.collectionAwardRows)
        ? options.collectionAwardRows
        : Array.isArray(options.tableRows)
          ? options.tableRows
          : String(raw || "")
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n")
              .split("\n")
              .map((line) => line.split("\t"));
      let blocks = window.splitCollectionAwardSheetBlocks(tableRows, {
        sheetStartRow: options.sheetStartRow || 1,
      });
      state.collectionAwards ||= { director: {}, franchise: {} };
      let imported = [];
      blocks.forEach((block) => {
        let parsed = window.parseCollectionAwardsTable("", {
          rows: block.rows,
        });
        let label = block.label || "collection award bracket";
        if (!parsed) {
          report.skipped += 1;
          report.warnings.push(`${label} could not be parsed.`);
          report.skippedDetails.push({
            rowNumber: block.rowNumber || "",
            reason: "Collection award bracket could not be parsed.",
            values: [label],
          });
          return;
        }
        (parsed.diagnostics?.metadataErrors || []).forEach((message) =>
          report.warnings.push(`${label}: ${message}`),
        );
        if (!parsed.collectionType || !parsed.collectionId) {
          report.skipped += 1;
          report.skippedDetails.push({
            rowNumber: block.rowNumber || "",
            reason: "Missing or unsupported collection metadata.",
            values: [label],
          });
          return;
        }
        (parsed.diagnostics?.unsupportedHeaders || []).forEach((header) =>
          report.warnings.push(`${label} ignored unsupported header "${header}".`),
        );
        (parsed.diagnostics?.malformedRows || []).forEach((finding) => {
          report.skipped += 1;
          report.skippedDetails.push({
            rowNumber:
              (block.rowNumber || 1) + Number(finding.rowNumber || 1) - 2,
            reason: finding.reason,
            values: [label],
          });
        });
        if (parsed.diagnostics?.duplicateNominations?.length)
          report.warnings.push(
            `${label} ignored ${parsed.diagnostics.duplicateNominations.length} duplicate nomination(s).`,
          );
        state.collectionAwards[parsed.collectionType] ||= {};
        let bracket = {
          collectionType: parsed.collectionType,
          collectionId: parsed.collectionId,
          collectionName: parsed.collectionName,
          sourceUrl: parsed.sourceUrl,
          nominations: parsed.nominations,
        };
        state.collectionAwards[parsed.collectionType][parsed.collectionId] =
          bracket;
        imported.push(bracket);
        report.awardsAdded += bracket.nominations.length;
      });
      window.rebuildAggregates?.();
      let membershipWarnings = [];
      imported.forEach((bracket) => {
        let model = window.collectionAwardViewModel?.(
          bracket.collectionType,
          bracket.collectionId,
        );
        (model?.unresolved || []).forEach((entry) =>
          membershipWarnings.push({
            collection: bracket.collectionName,
            title: entry.sourceTitle,
            ambiguous: entry.ambiguous,
          }),
        );
      });
      report.filmsParsed = new Set(
        imported.flatMap((bracket) =>
          bracket.nominations.map((nomination) =>
            normalizeTitle(nomination.sourceTitle),
          ),
        ),
      ).size;
      if (membershipWarnings.length)
        report.warnings.push(
          `${membershipWarnings.length} collection award film(s) are not uniquely known as members of their collection; their titles were retained for display.`,
        );
      report.collectionAwardSummary = {
        brackets: imported.length,
        nominations: report.awardsAdded,
        membershipWarnings,
      };
    } else if (importType === "table") {
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
              periodTypeHint: options.tablePeriodType,
            })
          : parseTable(chunk, { periodTypeHint: options.tablePeriodType });

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
        report.periods.add(year);
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
        report.periods.add(data.yearKey);
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
          addOrUpdateYearFilm(data.yearKey, f, {
            addToAllTime: !f.suppressAllTimeRank,
            addToDerivedPeriods: false,
            replaceRanks: true,
          });
        });
        state.selectedYears = [data.yearKey];
        state.selectedPeriodType = "alltime";
        let alltimeRadio = document.querySelector?.(
          'input[name="periodType"][value="alltime"]',
        );
        if (alltimeRadio) alltimeRadio.checked = true;
      }
    } else if (importType === "diary") {
      let data = window.parseDiary(raw);
      report.source = "Diary";
      if (!data) {
        report.skipped += 1;
        report.warnings.push(
          "Diary input could not be parsed. Check the header row and entries.",
        );
      } else {
        report.filmsParsed = data.entries.length;
        report.skipped += data.diagnostics?.skippedRows || 0;
        report.skippedDetails.push(...(data.diagnostics?.skippedDetails || []));
        let archiveMatched = 0;
        let missingArchive = [];
        let standaloneAdded = 0;
        let standaloneMerged = 0;

        data.entries.forEach((entry) => {
          let kind = window.diaryEntryKind(entry.type);
          if (kind === "archive") {
            if (findDiaryArchiveFilm(entry)) archiveMatched += 1;
            else missingArchive.push(entry);
            return;
          }
          let result = upsertDiaryWatchedEntry(entry);
          if (result.added) standaloneAdded += 1;
          else standaloneMerged += 1;
        });

        report.filmsAdded = standaloneAdded;
        report.filmsMerged = standaloneMerged;
        if (missingArchive.length) {
          let samples = missingArchive
            .slice(0, 8)
            .map((entry) => `${entry.title} (${entry.year})`)
            .join(", ");
          report.warnings.push(
            `${missingArchive.length} Diary Film/TV-film row(s) did not match All-time and were not imported${samples ? `: ${samples}` : "."}`,
          );
        }
        report.diarySummary = {
          archiveMatched,
          missingArchive: missingArchive.length,
          standaloneAdded,
          standaloneMerged,
        };
      }
    } else if (importType === "watchlist") {
      let data = window.parseWatchlist(raw);
      state.watchlist = data.items;
      window.recomputeWatchlistOrder?.();
      state.watchlistOrderVersion = 1;
      report.source = "Watchlist";
      report.filmsParsed = data.items.length;
      report.filmsAdded = data.items.length;
      report.skipped += data.diagnostics?.skippedRows || 0;
      report.skippedDetails.push(...(data.diagnostics?.skippedDetails || []));
      if (report.skipped)
        report.warnings.push(
          `${report.skipped} watchlist row(s) had no usable film title.`,
        );
    } else if (importType === "franchises") {
      let data = window.parseFranchiseSheet(raw, {
        rows: options.franchiseRows || options.rows || options.tableRows,
        sheetStartRow: options.sheetStartRow,
      });
      report.source = "Franchises";
      state.sourceConflicts = (state.sourceConflicts || []).filter(
        (conflict) => conflict.source !== report.source,
      );
      report.filmsParsed = data.items.length;
      report.skipped += data.diagnostics?.skippedRows || 0;
      report.skippedDetails.push(...(data.diagnostics?.skippedDetails || []));
      let archiveMerged = 0;
      let archiveUpdated = 0;
      let watchlistAdded = 0;
      let watchlistMerged = 0;
      let watchlistRemoved = 0;
      let watchedOtherAdded = 0;
      let watchedOtherMerged = 0;
      let unmatchedRated = [];
      let untiered = [];
      let ambiguousWatchlist = [];
      data.items.forEach((entry) => {
        // Every item under one lane header carries that header's own URL
        // (see franchise-sheet.js), so this fires once per lane in effect -
        // state.franchisesById is fully derived on every load (never
        // persisted directly), so the URL has to live in its own persisted
        // side-table, keyed the same way rebuildFranchiseIndex() keys a
        // franchise node, and get merged back in during that rebuild.
        if (entry.sourceUrl) {
          state.franchiseLinks ||= {};
          state.franchiseLinks[
            window.normalizeFranchiseId(entry.franchiseName)
          ] = entry.sourceUrl;
        }
        let membership = {
          name: entry.franchiseName,
          parentName: entry.parentName,
          parentChain: entry.parentChain,
          rank: entry.rank,
        };
        let archiveResult = updateSourceFilmsForFranchise(entry, membership);
        if (archiveResult.matched) {
          archiveMerged += 1;
          archiveUpdated += archiveResult.updated ? 1 : 0;
          if (entry.ratingValue) recordArchiveRatingConflicts(entry);
          watchlistRemoved += removeWatchlistItemsForFranchiseEntry(entry);
          return;
        }
        if (entry.ratingValue) {
          unmatchedRated.push(entry);
          let result = upsertWatchedOtherEntry(entry, {
            franchiseName: entry.franchiseName,
            parentName: entry.parentName,
            parentChain: entry.parentChain,
            rank: entry.rank,
          });
          if (result.added) watchedOtherAdded += 1;
          else if (result.changed) watchedOtherMerged += 1;
          return;
        }
        if (!entry.tier) untiered.push(entry);
        let watchlistCandidates = watchlistCandidatesForFranchiseEntry(entry);
        if (!entry.year && watchlistCandidates.length > 1) {
          ambiguousWatchlist.push(entry);
        }
        let result = upsertWatchlistFranchiseEntry(entry, membership);
        if (result.added) watchlistAdded += 1;
        else if (result.changed) watchlistMerged += 1;
      });
      report.filmsAdded = watchlistAdded;
      report.filmsMerged = archiveMerged + watchlistMerged;
      if (report.skipped)
        report.warnings.push(
          `${report.skipped} franchise sheet row(s) had no usable film/franchise data.`,
        );
      if (unmatchedRated.length) {
        report.warnings.push(
          `${unmatchedRated.length} franchise sheet row(s) had a star rating but did not match an archive film; they were stored as watched entries of unknown type instead of watchlist rows.`,
        );
      }
      if (ambiguousWatchlist.length) {
        report.warnings.push(
          `${ambiguousWatchlist.length} franchise sheet row(s) had no year and matched multiple watchlist titles; a new watchlist row may have been added.`,
        );
      }
      if (untiered.length) {
        report.warnings.push(
          `${untiered.length} franchise sheet row(s) had no recognized rating or interest tier.`,
        );
      }
      report.franchiseSummary = {
        lanes: data.diagnostics?.lanes || 0,
        headers: data.diagnostics?.headers || 0,
        withYear: data.diagnostics?.itemsWithYear || 0,
        withoutYear: data.diagnostics?.itemsWithoutYear || 0,
        rated: data.diagnostics?.ratedItems || 0,
        tiered: data.diagnostics?.tieredItems || 0,
        untiered: data.diagnostics?.untieredItems || 0,
        archiveMatched: archiveMerged,
        archiveUpdated,
        watchlistMerged,
        watchlistAdded,
        duplicateWatchlistRemoved: watchlistRemoved,
        watchedOtherAdded,
        watchedOtherMerged,
        unmatchedRated: unmatchedRated.slice(0, 25).map((entry) => ({
          rowNumber: entry.rowNumber,
          title: entry.title,
          year: entry.year,
          franchise: entry.parentName
            ? `${entry.parentName} > ${entry.franchiseName}`
            : entry.franchiseName,
        })),
        ambiguousWatchlist: ambiguousWatchlist.slice(0, 25).map((entry) => ({
          rowNumber: entry.rowNumber,
          title: entry.title,
          franchise: entry.parentName
            ? `${entry.parentName} > ${entry.franchiseName}`
            : entry.franchiseName,
        })),
        untieredRows: untiered.slice(0, 25).map((entry) => ({
          rowNumber: entry.rowNumber,
          title: entry.title,
          year: entry.year,
          franchise: entry.parentName
            ? `${entry.parentName} > ${entry.franchiseName}`
            : entry.franchiseName,
        })),
      };
      report.warnings.push(
        `Franchise sheet read ${data.diagnostics?.headers || 0} franchise header(s) across ${data.diagnostics?.lanes || 0} lane(s): ${archiveMerged} archive match(es), ${archiveUpdated} archive update(s), ${watchlistMerged} watchlist merge(s), ${watchlistAdded} watchlist addition(s), ${watchlistRemoved} archive duplicate watchlist removal(s).`,
      );
      window.recomputeWatchlistOrder?.();
      state.watchlistOrderVersion = 1;
    } else if (importType === "directors") {
      let data = window.parseDirectorWatchlistSheet(raw, {
        rows: options.directorRows || options.rows || options.tableRows,
        sheetStartRow: options.sheetStartRow,
      });
      report.source = "Directors";
      state.sourceConflicts = (state.sourceConflicts || []).filter(
        (conflict) => conflict.source !== report.source,
      );
      report.filmsParsed = data.items.length;
      report.skipped += data.diagnostics?.skippedRows || 0;
      report.skippedDetails.push(...(data.diagnostics?.skippedDetails || []));
      let archiveMatched = 0;
      let duplicateWatchlistRemoved = 0;
      let watchlistAdded = 0;
      let watchlistMerged = 0;
      let watchedOtherAdded = 0;
      let watchedOtherMerged = 0;
      let untiered = [];
      let unmatchedRated = [];
      data.items.forEach((entry) => {
        // state.peopleById is fully derived on every load, so the URL needs
        // its own persisted side-table - keyed through the same alias
        // resolution addCredit() uses (src/domain/people/index.js) so this
        // matches whatever canonical person id the derived object ends up
        // with, even if an alias gets confirmed after this import runs.
        if (entry.sourceUrl) {
          state.directorLinks ||= {};
          let variantId = window.normalizePersonName(entry.director);
          let canonicalName =
            state.peopleAliases?.[variantId] || entry.director;
          state.directorLinks[window.normalizePersonName(canonicalName)] =
            entry.sourceUrl;
        }
        let archiveMatches = countSourceFilmsForEntry(entry);
        if (archiveMatches) {
          archiveMatched += 1;
          if (entry.ratingValue) recordArchiveRatingConflicts(entry);
          duplicateWatchlistRemoved +=
            removeWatchlistItemsForFranchiseEntry(entry);
          return;
        }
        if (entry.ratingValue) {
          unmatchedRated.push(entry);
          let result = upsertWatchedOtherEntry(entry, {
            director: entry.director,
          });
          if (result.added) watchedOtherAdded += 1;
          else if (result.changed) watchedOtherMerged += 1;
          return;
        }
        if (!entry.tier) untiered.push(entry);
        let result = upsertWatchlistDirectorEntry(entry);
        if (result.added) watchlistAdded += 1;
        else if (result.changed) watchlistMerged += 1;
      });
      report.filmsAdded = watchlistAdded;
      report.filmsMerged = archiveMatched + watchlistMerged;
      if (report.skipped)
        report.warnings.push(
          `${report.skipped} Directors sheet row(s) had no usable film/director data.`,
        );
      if (untiered.length)
        report.warnings.push(
          `${untiered.length} Directors sheet row(s) had no recognized interest tier.`,
        );
      if (unmatchedRated.length) {
        report.warnings.push(
          `${unmatchedRated.length} Directors sheet row(s) had a star rating but did not match an archive film; they were stored as watched entries of unknown type instead of watchlist rows.`,
        );
      }
      report.directorSummary = {
        lanes: data.diagnostics?.lanes || 0,
        headers: data.diagnostics?.headers || 0,
        withYear: data.diagnostics?.itemsWithYear || 0,
        withoutYear: data.diagnostics?.itemsWithoutYear || 0,
        rated: data.diagnostics?.ratedItems || 0,
        tiered: data.diagnostics?.tieredItems || 0,
        untiered: data.diagnostics?.untieredItems || 0,
        archiveMatched,
        watchlistMerged,
        watchlistAdded,
        duplicateWatchlistRemoved,
        watchedOtherAdded,
        watchedOtherMerged,
        untieredRows: untiered.slice(0, 25).map((entry) => ({
          rowNumber: entry.rowNumber,
          title: entry.title,
          year: entry.year,
          director: entry.director,
        })),
        unmatchedRated: unmatchedRated.slice(0, 25).map((entry) => ({
          rowNumber: entry.rowNumber,
          title: entry.title,
          year: entry.year,
          director: entry.director,
        })),
      };
      report.warnings.push(
        `Directors sheet read ${data.diagnostics?.headers || 0} director header(s) across ${data.diagnostics?.lanes || 0} lane(s): ${archiveMatched} already-watched match(es), ${watchlistMerged} watchlist merge(s), ${watchlistAdded} watchlist addition(s), ${duplicateWatchlistRemoved} archive duplicate watchlist removal(s).`,
      );
      window.recomputeWatchlistOrder?.();
      state.watchlistOrderVersion = 1;
    } else {
      alert("Unknown import type: " + importType);
      return;
    }

    if (options.render !== false) window.render?.();
    report.periods = [...report.periods];
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
    console.error(err);
    alert("Import failed: " + (err && err.message ? err.message : String(err)));
    return null;
  }
};
