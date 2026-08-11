/**
 * @file Collects bracket integrity, metadata coverage, eligibility, alias, image, and work-queue health data.
 */

function dataHealthAllTimeFilms() {
  return (state.periods?.allTime?.all?.films || [])
    .map((entry) => {
      let film = state.filmsById?.[entry.id];
      return (
        film &&
        Object.assign({}, film, { allTimeRank: entry.rank || film.allTimeRank })
      );
    })
    .filter(Boolean);
}

function dataHealthTitlesLikelyMatch(leftTitle, rightTitle) {
  function comparable(value) {
    return normalizeTitle(value)
      .replace(/[‘’]/g, "'")
      .replace(/…/g, "...")
      .replace(/⁄/g, "/")
      .replace(/\s+/g, " ")
      .trim();
  }
  function compact(value) {
    return value.replace(/[^a-z0-9\u00c0-\u024f]+/g, "");
  }
  let left = comparable(leftTitle);
  let right = comparable(rightTitle);
  if (left === right || compact(left) === compact(right)) return true;
  let leftCompact = compact(left);
  let rightCompact = compact(right);
  if (
    Math.min(leftCompact.length, rightCompact.length) >= 8 &&
    (leftCompact.startsWith(rightCompact) ||
      rightCompact.startsWith(leftCompact))
  )
    return true;
  let shorter = left.length < right.length ? left : right;
  let longer = left.length < right.length ? right : left;
  return shorter.length >= 8 && longer.includes(shorter);
}

function dataHealthAllTimeFilmIndex() {
  let all = dataHealthAllTimeFilms();
  let byYear = new Map();
  all.forEach((film) => {
    let year = String(film.year || "");
    let films = byYear.get(year) || [];
    films.push(film);
    byYear.set(year, films);
  });
  return { all, byYear };
}

function dataHealthAllTimeCounterpart(
  film,
  index = dataHealthAllTimeFilmIndex(),
) {
  let year = String(film.year || "");
  let candidates = year ? index.byYear.get(year) || [] : index.all;
  return candidates.find(
    (candidate) =>
      (!film.year ||
        String(candidate.year || "") === String(film.year || "")) &&
      dataHealthTitlesLikelyMatch(candidate.title, film.title),
  );
}

function dataHealthFilmLabel(film) {
  return `${film.title}${film.year ? ` (${film.year})` : ""}`;
}

function dataHealthMissingQueues() {
  let films = Object.values(state.filmsById || {}).filter(
    (film) => film?.id && film.title,
  );
  let people = Object.values(
    window.ensurePeopleIndex?.() || state.peopleById || {},
  ).filter((person) => person?.id && person.name);
  let watchlist = (state.watchlist || []).filter((item) => item?.title);
  let archiveFilms = films.filter((film) => !film.watchlistItem);
  function filmEntry(film) {
    return {
      id: film.id,
      title: dataHealthFilmLabel(film),
      href: window.filmPageUrl?.(film.id) || "",
    };
  }
  function personEntry(person) {
    return {
      id: person.id,
      title: person.name,
      href: window.personPageUrl?.(person.id) || "",
    };
  }
  function watchlistEntry(item) {
    let id = item.id || window.watchlistItemId?.(item);
    return {
      id,
      title: dataHealthFilmLabel(item),
      href: window.watchlistFilmPageUrl?.(id) || "",
    };
  }
  function queue(id, label, batchType, entries, source = "fetchable") {
    return {
      id,
      label,
      batchType,
      source,
      count: entries.length,
      entries,
      samples: entries.slice(0, 8),
    };
  }
  return [
    queue(
      "filmTmdb",
      "Watched films missing TMDB ID",
      "film-metadata",
      archiveFilms.filter((film) => !film.tmdbId).map(filmEntry),
    ),
    queue(
      "filmDirectors",
      "Watched films missing director",
      "film-metadata",
      archiveFilms
        .filter((film) => !film.director && !film.directors?.length)
        .map(filmEntry),
    ),
    queue(
      "filmCountries",
      "Watched films missing country",
      "film-metadata",
      archiveFilms.filter((film) => !film.country).map(filmEntry),
    ),
    queue(
      "filmRuntime",
      "Ranked-list films missing runtime",
      "",
      archiveFilms.filter((film) => !film.runtimeMinutes).map(filmEntry),
      "sheet",
    ),
    queue(
      "filmMedium",
      "Ranked-list films missing medium",
      "",
      archiveFilms
        .filter((film) => !film.medium || film.medium === "unknown")
        .map(filmEntry),
      "sheet",
    ),
    queue(
      "filmScreenplay",
      "Ranked-list films missing screenplay type",
      "",
      archiveFilms
        .filter(
          (film) => !film.screenplayType || film.screenplayType === "unknown",
        )
        .map(filmEntry),
      "sheet",
    ),
    queue(
      "filmPosters",
      "Watched films missing poster",
      "film-posters",
      archiveFilms
        .filter((film) => !window.normalizePosterRecord?.(film.poster))
        .map(filmEntry),
    ),
    queue(
      "watchlistMetadata",
      "Watchlist films missing TMDB/director",
      "watchlist-metadata",
      watchlist
        .filter((item) => window.watchlistNeedsMetadataLookup?.(item))
        .map(watchlistEntry),
    ),
    queue(
      "watchlistPosters",
      "Watchlist films missing poster",
      "watchlist-posters",
      watchlist
        .filter((item) => window.watchlistNeedsPosterLookup?.(item))
        .map(watchlistEntry),
    ),
    queue(
      "personPortraits",
      "People missing portrait",
      "person-portraits",
      people
        .filter(
          (person) =>
            !window.normalizePosterRecord?.(
              person.portrait || state.personPortraits?.[person.id],
            ),
        )
        .map(personEntry),
    ),
  ];
}

// Focused per-film eligibility review queues (issue #40): unlike the
// aggregated eligibility warning counts, each queue lists every affected
// nominee with a link and a short note, so gaps can be reviewed film by film.
function dataHealthEligibilityQueues() {
  let films = Object.values(state.filmsById || {}).filter(
    (film) => film?.id && film.title,
  );
  function entry(film, note) {
    return {
      id: film.id,
      title: dataHealthFilmLabel(film),
      note,
      href: window.filmPageUrl?.(film.id) || "",
    };
  }
  function nomineesOf(categories) {
    return films
      .filter((film) =>
        (film.awards || []).some((award) =>
          categories.includes(award.category),
        ),
      )
      .sort(
        (left, right) =>
          String(left.year || "").localeCompare(String(right.year || "")) ||
          left.title.localeCompare(right.title),
      );
  }
  let animated = nomineesOf(["Best Animated Picture"])
    .filter((film) => film.medium !== "animation")
    .map((film) =>
      entry(
        film,
        !film.medium || film.medium === "unknown"
          ? "medium unknown"
          : `medium: ${film.medium}`,
      ),
    );
  let international = nomineesOf(["Best International Picture"])
    .map((film) => {
      let country =
        window.primaryCountryValue?.(film) || film.primaryCountry || "";
      if (!country) return entry(film, "country missing");
      return window.isUsOrUkCountry?.(country)
        ? entry(film, `US/UK country: ${country}`)
        : null;
    })
    .filter(Boolean);
  let screenplayCategories = [
    "Best Original Screenplay",
    "Best Adapted Screenplay",
  ];
  let screenplay = nomineesOf(screenplayCategories)
    .filter((film) => !film.screenplayType || film.screenplayType === "unknown")
    .map((film) => {
      let categories = [
        ...new Set(
          (film.awards || [])
            .filter((award) => screenplayCategories.includes(award.category))
            .map((award) => award.category),
        ),
      ];
      return entry(film, `screenplay type unknown · ${categories.join(", ")}`);
    });
  function queue(id, label, entries) {
    return {
      id,
      label,
      batchType: "",
      source: "sheet",
      count: entries.length,
      entries,
      samples: entries.slice(0, 8),
    };
  }
  return [
    queue(
      "eligibilityAnimated",
      "Animated nominees with unknown or non-animation medium",
      animated,
    ),
    queue(
      "eligibilityInternational",
      "International nominees with missing or US/UK country",
      international,
    ),
    queue(
      "eligibilityScreenplay",
      "Screenplay nominees with unknown screenplay type",
      screenplay,
    ),
  ];
}

function dataHealthFilmHasLetterboxd(film) {
  return (
    Boolean(film.letterboxdUrl) ||
    /letterboxd\.com/i.test(String(film.url || ""))
  );
}

function dataHealthFilmLetterboxdInferable(film) {
  return !film.letterboxdUrl && /letterboxd\.com/i.test(String(film.url || ""));
}

// External ID and media type coverage (issue #42): TMDB/Letterboxd presence
// across archive and watchlist, plus review queues for missing links and for
// rows whose ranked-list Type isn't Film. The TMDB media type *check* (does a
// stored ID resolve as TV?) needs the network and lives in image-batches.js.
function dataHealthExternalIds() {
  let films = Object.values(state.filmsById || {}).filter(
    (film) => film?.id && film.title,
  );
  let archiveFilms = films.filter((film) => !film.watchlistItem);
  let watchlist = (state.watchlist || []).filter((item) => item?.title);
  function filmEntry(film, note) {
    return {
      id: film.id,
      title: dataHealthFilmLabel(film),
      note,
      href: window.filmPageUrl?.(film.id) || "",
    };
  }
  function watchlistEntry(item) {
    let id = item.id || window.watchlistItemId?.(item);
    return {
      id,
      title: dataHealthFilmLabel(item),
      href: window.watchlistFilmPageUrl?.(id) || "",
    };
  }
  function metric(id, label, present, target) {
    return {
      id,
      label,
      present,
      target,
      missing: Math.max(0, target - present),
      percent: target ? Math.round((present / target) * 100) : 0,
    };
  }
  function queue(id, label, batchType, entries, source = "fetchable") {
    return {
      id,
      label,
      batchType,
      source,
      count: entries.length,
      entries,
      samples: entries.slice(0, 8),
    };
  }
  let nonFilmType = archiveFilms
    .filter((film) => film.type && !/^film$/i.test(String(film.type).trim()))
    .map((film) => filmEntry(film, `type: ${String(film.type).trim()}`));
  return {
    metrics: [
      metric(
        "tmdbArchive",
        "Watched films with TMDB ID",
        archiveFilms.filter((film) => film.tmdbId).length,
        archiveFilms.length,
      ),
      metric(
        "tmdbWatchlist",
        "Watchlist films with TMDB ID",
        watchlist.filter((item) => item.tmdbId).length,
        watchlist.length,
      ),
      metric(
        "letterboxdArchive",
        "Watched films with Letterboxd link",
        archiveFilms.filter(dataHealthFilmHasLetterboxd).length,
        archiveFilms.length,
      ),
      metric(
        "letterboxdWatchlist",
        "Watchlist films with Letterboxd link",
        watchlist.filter((item) => item.letterboxdUrl).length,
        watchlist.length,
      ),
    ],
    queues: [
      queue(
        "filmLetterboxd",
        "Watched films missing Letterboxd link",
        "",
        archiveFilms
          .filter((film) => !dataHealthFilmHasLetterboxd(film))
          .map((film) => filmEntry(film)),
        "sheet",
      ),
      queue(
        "watchlistLetterboxd",
        "Watchlist films missing Letterboxd link",
        "",
        watchlist.filter((item) => !item.letterboxdUrl).map(watchlistEntry),
        "sheet",
      ),
      queue(
        "watchlistTmdb",
        "Watchlist films missing TMDB ID",
        "watchlist-metadata",
        watchlist.filter((item) => !item.tmdbId).map(watchlistEntry),
      ),
      queue(
        "filmNonFilmType",
        "Watched films with a non-Film type",
        "",
        nonFilmType,
        "sheet",
      ),
    ],
    inferableLetterboxd: archiveFilms.filter(dataHealthFilmLetterboxdInferable)
      .length,
  };
}

// A film's generic `url` sometimes already is a Letterboxd link even though
// the dedicated letterboxdUrl field is empty (older imports split them
// inconsistently). This copies those over in one explicit click.
/** Copies inferable Letterboxd URLs into their dedicated field. @returns {number} Films updated. */
window.applyInferableLetterboxdLinks = function () {
  let updated = new Set();
  function apply(film) {
    if (!film?.title || !dataHealthFilmLetterboxdInferable(film)) return;
    film.letterboxdUrl = String(film.url).trim();
    updated.add(`${film.year || ""}::${normalizeTitle(film.title)}`);
  }
  Object.values(state.years || {}).forEach((period) =>
    (period.films || []).forEach(apply),
  );
  Object.values(state.filmsById || {}).forEach(apply);
  if (updated.size) {
    window.markAggregatesDirty?.("letterboxd links inferred from film URLs");
    window.save?.();
  }
  return updated.size;
};

function collectSheetMetadataCoverage(films) {
  let archiveFilms = films.filter(
    (film) => film?.id && film.title && !film.watchlistItem,
  );
  function count(predicate) {
    return archiveFilms.filter(predicate).length;
  }
  function metric(id, label, present, target = archiveFilms.length, note = "") {
    return {
      id,
      label,
      present,
      target,
      missing: Math.max(0, target - present),
      percent: target ? Math.round((present / target) * 100) : 0,
      note,
    };
  }
  return [
    metric(
      "tmdb",
      "TMDB IDs",
      count((film) => film.tmdbId),
      archiveFilms.length,
      "Fetchable, but now also read from Google Sheets.",
    ),
    metric(
      "country",
      "Countries",
      count((film) => film.country),
      archiveFilms.length,
      "Used by International eligibility.",
    ),
    metric(
      "medium",
      "Medium",
      count((film) => film.medium && film.medium !== "unknown"),
      archiveFilms.length,
      "Used by Animated eligibility.",
    ),
    metric(
      "screenplay",
      "Screenplay type",
      count((film) => film.screenplayType && film.screenplayType !== "unknown"),
      archiveFilms.length,
      "Used by screenplay eligibility.",
    ),
    metric(
      "runtime",
      "Runtime",
      count((film) => film.runtimeMinutes),
      archiveFilms.length,
      "Read from ranked list A:T.",
    ),
    metric(
      "letterboxd",
      "Letterboxd links",
      count(
        (film) =>
          film.letterboxdUrl || /letterboxd\.com/i.test(String(film.url || "")),
      ),
      archiveFilms.length,
      "Read from ranked list A:T.",
    ),
    metric(
      "globalRank",
      "Global ranks",
      count((film) => film.globalRank),
      archiveFilms.length,
      "Read from ranked list A:T.",
    ),
    metric(
      "personalScore",
      "Personal scores",
      count((film) => film.personalScore != null),
      archiveFilms.length,
      "Read from ranked list A:T.",
    ),
  ];
}

function collectDataHealth() {
  let findings = [];
  let orderedCategories = getOrderedCategories();
  let metadataGaps = new Map();
  let allFilms = Object.values(state.filmsById || {}).filter(
    (film) => film?.id && film.title,
  );
  // Data Health reports people-credit issues, aliases, and portrait coverage,
  // so establish the lazy people index before reading any of those derived
  // fields. Otherwise the first post-load report can silently omit issues.
  let peopleById = window.ensurePeopleIndex?.() || state.peopleById || {};
  // Build the all-time candidates once. Previously every annual film rebuilt
  // and fuzzy-scanned the full all-time list, turning this check quadratic on
  // the full archive and accounting for nearly the entire Data Health delay.
  let finishAllTimeIndexTimer = window.startOskarsPerformance?.(
    "dataHealth:allTimeIndex",
  );
  let allTimeIndex = dataHealthAllTimeFilmIndex();
  finishAllTimeIndexTimer?.(
    `${allTimeIndex.all.length} all-time film(s), ${allTimeIndex.byYear.size} year bucket(s)`,
  );

  let finishBracketTimer = window.startOskarsPerformance?.(
    "dataHealth:brackets",
  );
  let bracketPeriods = getImportedBracketPeriods();
  let finishBracketIndexTimer = window.startOskarsPerformance?.(
    "dataHealth:bracketIndex",
  );
  let bracketAwardIndex = dataHealthBracketAwardIndex(bracketPeriods);
  let indexedAwardCount = [...bracketAwardIndex.values()].reduce(
    (count, period) => count + period.entries.length,
    0,
  );
  finishBracketIndexTimer?.(
    `${indexedAwardCount} award(s), ${bracketPeriods.length} period(s)`,
  );

  let finishBracketChecksTimer = window.startOskarsPerformance?.(
    "dataHealth:bracketChecks",
  );
  let finishBracketPlacementsTimer = window.startOskarsPerformance?.(
    "dataHealth:bracketPlacements",
  );
  bracketPeriods.forEach((period) => {
    let periodAwards = bracketAwardIndex.get(period);

    orderedCategories.forEach((category) => {
      let capacity =
        category === "Best Picture"
          ? period.pictureCapacity
          : period.categoryCapacity;
      let awardEntries = periodAwards.byCategory.get(category) || [];
      let placements = awardEntries
        .map((entry) => Number(entry.award.placement))
        .filter(Number.isFinite);
      let uniquePlacements = [...new Set(placements)];

      // A placement shared by exactly two *different* films is a legitimate
      // tie (e.g. a two-part release), not a data error - anything else
      // sharing a placement (a film duplicated onto itself, or 3+ films)
      // stays a hard error.
      let titlesByPlacement = new Map();
      awardEntries.forEach((entry) => {
        let placement = Number(entry.award.placement);
        if (!Number.isFinite(placement)) return;
        let titles = titlesByPlacement.get(placement) || [];
        titles.push(entry.sourceFilm.title);
        titlesByPlacement.set(placement, titles);
      });
      let sharedPlacements = [];
      let duplicates = [];
      titlesByPlacement.forEach((titles, placement) => {
        if (titles.length <= 1) return;
        if (titles.length === 2 && new Set(titles).size === 2)
          sharedPlacements.push(placement);
        else duplicates.push(placement);
      });
      if (sharedPlacements.length) {
        findings.push({
          severity: "info",
          period: period.key,
          issue: "Shared placement (tie)",
          detail: `${category}: ${sharedPlacements.join(", ")}`,
        });
      }
      if (duplicates.length) {
        findings.push({
          severity: "error",
          period: period.key,
          issue: "Duplicate placement",
          detail: `${category}: ${duplicates.join(", ")}`,
        });
      }

      let outOfRange = uniquePlacements.filter(
        (placement) => placement < 1 || placement > capacity,
      );
      if (outOfRange.length) {
        findings.push({
          severity: "error",
          period: period.key,
          issue: "Placement out of range",
          detail: `${category}: ${outOfRange.join(", ")} (max ${capacity})`,
        });
      }

      let highest = Math.min(capacity, Math.max(0, ...uniquePlacements));
      let gaps = Array.from(
        { length: highest },
        (_, index) => index + 1,
      ).filter((placement) => !uniquePlacements.includes(placement));
      if (gaps.length) {
        findings.push({
          severity: "warning",
          period: period.key,
          issue: "Placement gap",
          detail: `${category}: missing ${gaps.join(", ")}`,
        });
      }
    });
  });
  finishBracketPlacementsTimer?.(
    `${bracketPeriods.length} period(s), ${findings.length} finding(s)`,
  );

  let finishBracketEligibilityTimer = window.startOskarsPerformance?.(
    "dataHealth:bracketEligibility",
  );
  let normalizedFilms = new Set();
  bracketPeriods.forEach((period) => {
    bracketAwardIndex.get(period).entries.forEach(({ film, award }) => {
      if (!normalizedFilms.has(film)) {
        window.normalizeFilmMetadata(film);
        normalizedFilms.add(film);
      }
      let validation = window.validateAward(film, award, {
        periodType: period.periodType,
        filmMetadataNormalized: true,
      });
      validation.errors.forEach((message) =>
        findings.push({
          severity: "error",
          period: period.key,
          issue: "Eligibility violation",
          detail: `${film.title} · ${award.category}: ${message}`,
        }),
      );
      validation.warnings.forEach((message) => {
        let key = `${message}\n${award.category}`;
        let gap = metadataGaps.get(key) || {
          message,
          category: award.category,
          count: 0,
          films: new Set(),
          periods: new Set(),
        };
        gap.count += 1;
        gap.films.add(film.title);
        gap.periods.add(period.key);
        metadataGaps.set(key, gap);
      });
    });
  });
  finishBracketEligibilityTimer?.(
    `${indexedAwardCount} award(s), ${normalizedFilms.size} film(s)`,
  );
  finishBracketChecksTimer?.(
    `${bracketPeriods.length} period(s), ${findings.length} finding(s)`,
  );

  let finishBracketCounterpartsTimer = window.startOskarsPerformance?.(
    "dataHealth:bracketCounterparts",
  );
  Object.entries(state.periods?.years || {}).forEach(([year, period]) => {
    (period.films || [])
      .map((entry) => state.filmsById[entry.id])
      .filter(Boolean)
      .forEach((film) => {
        let participates = (film.awards || []).some(
          (award) => String(award.year || "") === year,
        );
        if (participates && !dataHealthAllTimeCounterpart(film, allTimeIndex)) {
          findings.push({
            severity: "warning",
            period: year,
            issue: "No all-time match",
            detail: film.title,
          });
        }
      });
  });
  finishBracketCounterpartsTimer?.(
    `${Object.keys(state.periods?.years || {}).length} year period(s)`,
  );
  finishBracketTimer?.(
    `${bracketPeriods.length} period(s), ${findings.length} finding(s)`,
  );

  let finishDiagnosticsTimer = window.startOskarsPerformance?.(
    "dataHealth:diagnostics",
  );
  let identities = new Map();
  Object.values(state.filmsById || {}).forEach((film) => {
    let identity = `${film.year || ""}::${normalizeTitle(film.title)}`;
    let group = identities.get(identity) || [];
    group.push(film);
    identities.set(identity, group);
  });
  identities.forEach((group) => {
    if (group.length > 1) {
      findings.push({
        severity: "error",
        period: group[0].year || "",
        issue: "Duplicate film identity",
        detail: group.map((film) => film.title).join(" / "),
      });
    }
  });

  (state.watchlist || []).forEach((item) => {
    let archiveMatch = window.findWatchlistArchiveFilm?.(item);
    if (archiveMatch) {
      findings.push({
        severity: "warning",
        period: item.year || "",
        issue: "Watchlist/watched overlap",
        detail: `${item.title}${item.year ? ` (${item.year})` : ""} also matches ${archiveMatch.title}${archiveMatch.year ? ` (${archiveMatch.year})` : ""}`,
      });
    }
  });

  let eligibilityGaps = [...metadataGaps.values()]
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.category.localeCompare(right.category) ||
        left.message.localeCompare(right.message),
    )
    .map((gap) => ({
      message: gap.message,
      category: gap.category,
      count: gap.count,
      films: [...gap.films].slice(0, 8),
      periods: [...gap.periods].slice(0, 8),
    }));

  eligibilityGaps.forEach((gap) => {
    let examples = [...gap.films].slice(0, 4).join(", ");
    findings.push({
      severity: "warning",
      period: "All",
      issue: "Eligibility metadata missing",
      detail: `${gap.category}: ${gap.message} ${gap.count} nomination(s). Examples: ${examples}`,
    });
  });

  if (state.peopleCreditIssues?.length) {
    let examples = state.peopleCreditIssues
      .slice(0, 5)
      .map((issue) => `${issue.credit} (${issue.film})`)
      .join("; ");
    findings.push({
      severity: "warning",
      period: "All",
      issue: "Ambiguous people credits",
      detail: `${state.peopleCreditIssues.length} shared or annotated credit(s). Examples: ${examples}`,
    });
  }

  window.getPotentialPersonAliases().forEach((candidate) => {
    let profession = candidate.sharedProfessions.length
      ? ` Shared: ${candidate.sharedProfessions.join(", ")}.`
      : "";
    findings.push({
      severity: "warning",
      period: "All",
      issue: "Potential duplicate person",
      detail: `${candidate.leftName} / ${candidate.rightName} — ${candidate.reason}.${profession}`,
      aliasCandidate: candidate,
    });
  });

  let confirmedAliases = Object.entries(state.peopleAliases || {})
    .map(([variantId, canonicalName]) => {
      let canonicalId = normalizePersonName(canonicalName);
      let canonical = peopleById[canonicalId];
      let variantName =
        canonical?.aliases?.find(
          (alias) => normalizePersonName(alias) === variantId,
        ) || variantId;
      return { variantId, variantName, canonicalName };
    })
    .sort((left, right) =>
      left.canonicalName.localeCompare(right.canonicalName),
    );

  findings.sort(
    (a, b) =>
      (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1) ||
      String(a.period).localeCompare(String(b.period)) ||
      a.issue.localeCompare(b.issue),
  );

  let filmImages = new Map();
  Object.values(state.filmsById || {})
    .filter(
      (film) =>
        /^\d{4}$/.test(String(film.year || "")) && normalizeTitle(film.title),
    )
    .forEach((film) => {
      let identity = `${film.year}::${normalizeTitle(film.title)}`;
      let current = filmImages.get(identity) || false;
      filmImages.set(
        identity,
        current || Boolean(window.normalizePosterRecord?.(film.poster)),
      );
    });
  let people = Object.values(peopleById);
  let portraitCount = people.filter((person) =>
    window.normalizePosterRecord?.(
      person.portrait || state.personPortraits?.[person.id],
    ),
  ).length;
  let imageStats = state.imageImportStats || {};

  let finishQueuesTimer = window.startOskarsPerformance?.("dataHealth:queues");
  let queues = dataHealthMissingQueues();
  let eligibilityQueues = dataHealthEligibilityQueues();
  let externalIds = dataHealthExternalIds();
  finishQueuesTimer?.(
    `${queues.length} work queue(s), ${eligibilityQueues.length} eligibility queue(s), ${(externalIds.queues || []).length} external queue(s)`,
  );
  finishDiagnosticsTimer?.(
    `${findings.length} finding(s), ${confirmedAliases.length} confirmed alias(es)`,
  );

  return {
    findings,
    queues,
    eligibilityQueues,
    externalIds,
    sourceConflicts: [...(state.sourceConflicts || [])].sort(
      (left, right) =>
        String(left.source || "").localeCompare(String(right.source || "")) ||
        String(left.title || "").localeCompare(String(right.title || "")),
    ),
    sheetMetadata: collectSheetMetadataCoverage(allFilms),
    eligibilityGaps,
    confirmedAliases,
    rejectedAliasCount: (state.rejectedPersonAliases || []).length,
    images: {
      posters: [...filmImages.values()].filter(Boolean).length,
      posterTarget: filmImages.size,
      posterFailures: Math.max(0, Number(imageStats.posterFailures) || 0),
      portraits: portraitCount,
      portraitTarget: people.length,
      portraitFailures: Math.max(0, Number(imageStats.portraitFailures) || 0),
    },
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning")
      .length,
  };
}
