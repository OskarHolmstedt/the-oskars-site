/** @file Derives watched-film completion and project collections from imported Academy Awards results. */

(function () {
  const SOURCE_ID = "academy-awards";

  /** Expands an official annual or historical span key into represented release years. @param {string} periodKey Official period key. @returns {string[]} Four-digit years. */
  window.officialResultPeriodYears = function (periodKey) {
    let match = String(periodKey || "").match(/^(\d{4})(?:\/(\d{2}|\d{4}))?$/);
    if (!match) return [];
    let years = [match[1]];
    if (!match[2]) return years;
    let end = match[2];
    if (end.length === 2) {
      let century = Number(match[1].slice(0, 2));
      let startSuffix = Number(match[1].slice(2));
      let endSuffix = Number(end);
      if (endSuffix < startSuffix) century += 1;
      end = `${century}${String(endSuffix).padStart(2, "0")}`;
    }
    if (end !== match[1]) years.push(end);
    return years;
  };

  function officialResultFilmTitles(sourceTitle) {
    return String(sourceTitle || "")
      .split("|")
      .map((title) => title.trim())
      .filter(Boolean);
  }

  function recordsByTitle(records) {
    let result = new Map();
    (records || []).forEach((record) => {
      let key = window.normalizeTitle(record?.title || "");
      if (!key) return;
      let entries = result.get(key) || [];
      if (!entries.some((entry) => entry.id === record.id)) entries.push(record);
      result.set(key, entries);
    });
    return result;
  }

  function watchedRecords() {
    let records = Object.values(window.state?.filmsById || {});
    (window.state?.watchedFilms || window.state?.watchedOther || []).forEach(
      (film) => {
        if (film?.id && !records.some((record) => record.id === film.id))
          records.push(film);
      },
    );
    return records;
  }

  function matchingRecord(entries, years) {
    let allowedYears = new Set(years);
    let matches = (entries || []).filter((entry) =>
      allowedYears.has(String(entry?.year || "")),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function candidateHref(periodKey) {
    return `${window.periodPageUrl("year", periodKey)}&view=official`;
  }

  function completionGroup(films, sourceId) {
    let watchedCount = films.filter((film) => film.watched).length;
    return {
      sourceId,
      films,
      unseen: films.filter((film) => !film.watched),
      watchedCount,
      total: films.length,
      percent: films.length ? Math.round((watchedCount / films.length) * 100) : 0,
    };
  }

  function officialSourceId(category, scope) {
    return category ? `category:${category}:${scope}` : `all:${scope}`;
  }

  /** Builds the current overall and per-category Academy Awards film-completion model. @returns {OfficialOscarCompletion} Completion model. */
  window.officialOscarCompletion = function () {
    let source = window.state?.officialResults?.[SOURCE_ID];
    let watchedByTitle = recordsByTitle(watchedRecords());
    let watchlistByTitle = recordsByTitle(window.state?.watchlist || []);
    let filmsById = new Map();
    let periodKeys = [];

    Object.entries(source?.periods || {}).forEach(([periodKey, period]) => {
      if (!period?.nominations?.length) return;
      periodKeys.push(periodKey);
      let years = window.officialResultPeriodYears(periodKey);
      period.nominations.forEach((nomination) => {
        officialResultFilmTitles(nomination.sourceTitle).forEach((title) => {
          let titleKey = window.normalizeTitle(title);
          if (!titleKey) return;
          let id = `${periodKey}::${titleKey}`;
          let film = filmsById.get(id);
          if (!film) {
            film = {
              id,
              title,
              year: years[0] || "",
              periodKey,
              winner: false,
              categories: [],
              winnerCategories: [],
              watched: false,
              watchedFilm: null,
              watchedType: "",
              watchlistItem: null,
              href: candidateHref(periodKey),
            };
            filmsById.set(id, film);
          }
          film.winner ||= Boolean(nomination.winner);
          if (
            nomination.category &&
            !film.categories.includes(nomination.category)
          )
            film.categories.push(nomination.category);
          if (
            nomination.winner &&
            nomination.category &&
            !film.winnerCategories.includes(nomination.category)
          )
            film.winnerCategories.push(nomination.category);
        });
      });
    });

    let films = [...filmsById.values()];
    films.forEach((film) => {
      let years = window.officialResultPeriodYears(film.periodKey);
      let watched = matchingRecord(
        watchedByTitle.get(window.normalizeTitle(film.title)),
        years,
      );
      let watchlist = matchingRecord(
        watchlistByTitle.get(window.normalizeTitle(film.title)),
        years,
      );
      if (watched) {
        film.watched = true;
        film.watchedFilm = watched;
        film.watchedType = window.state?.filmsById?.[watched.id]
          ? "archive"
          : "watched";
        film.year = String(watched.year || film.year);
        film.href = window.filmPageUrl(watched.id);
      } else if (watchlist) {
        film.watchlistItem = watchlist;
        film.year = String(watchlist.year || film.year);
        film.href = window.watchlistFilmPageUrl(watchlist.id);
      }
      film.categories.sort(
        (left, right) =>
          window.categorySortIndex(left) - window.categorySortIndex(right) ||
          left.localeCompare(right),
      );
      film.winnerCategories.sort(
        (left, right) =>
          window.categorySortIndex(left) - window.categorySortIndex(right) ||
          left.localeCompare(right),
      );
    });
    films.sort(
      (left, right) =>
        left.periodKey.localeCompare(right.periodKey, undefined, {
          numeric: true,
        }) || left.title.localeCompare(right.title),
    );

    let categoryNames = [
      ...new Set(films.flatMap((film) => film.categories)),
    ].sort(
      (left, right) =>
        window.categorySortIndex(left) - window.categorySortIndex(right) ||
        left.localeCompare(right),
    );
    let categories = categoryNames.map((category) => {
      let categoryFilms = films.filter((film) =>
        film.categories.includes(category),
      );
      return {
        category,
        winners: completionGroup(
          categoryFilms.filter((film) =>
            film.winnerCategories.includes(category),
          ),
          officialSourceId(category, "winners"),
        ),
        nominees: completionGroup(
          categoryFilms,
          officialSourceId(category, "nominees"),
        ),
      };
    });
    let orderedPeriodKeys = [...new Set(periodKeys)].sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
    let periods = orderedPeriodKeys.map((period) => {
      let periodFilms = films.filter((film) => film.periodKey === period);
      return {
        period,
        href: candidateHref(period),
        winners: completionGroup(
          periodFilms.filter((film) => film.winner),
          `period:${period}:winners`,
        ),
        nominees: completionGroup(
          periodFilms,
          `period:${period}:nominees`,
        ),
      };
    });
    let winners = completionGroup(
      films.filter((film) => film.winner),
      officialSourceId("", "winners"),
    );
    let nominees = completionGroup(
      films,
      officialSourceId("", "nominees"),
    );
    return {
      source: source || null,
      periodKeys: orderedPeriodKeys,
      films,
      filmsById,
      winners,
      nominees,
      periods,
      categories,
      bestPicture:
        categories.find((entry) => entry.category === "Best Picture") || null,
    };
  };

  /** Resolves one official collection source into its project label and films. @param {string} sourceId Official source id. @param {OfficialOscarCompletion} [completion] Existing completion model. @returns {Object|null} Project source. */
  window.officialOscarProjectSource = function (sourceId, completion) {
    let model = completion || window.officialOscarCompletion();
    let scope = String(sourceId || "").endsWith(":winners")
      ? "winners"
      : String(sourceId || "").endsWith(":nominees")
        ? "nominees"
        : "";
    if (!scope) return null;
    let category = "";
    let period = "";
    if (String(sourceId).startsWith("category:"))
      category = String(sourceId).slice(
        "category:".length,
        -(`:${scope}`.length),
      );
    if (String(sourceId).startsWith("period:"))
      period = String(sourceId).slice(
        "period:".length,
        -(`:${scope}`.length),
      );
    let periodGroup = period
      ? model.periods.find((entry) => entry.period === period)
      : null;
    let group = category
      ? model.categories.find((entry) => entry.category === category)?.[scope]
      : periodGroup
        ? periodGroup[scope]
        : model[scope];
    if (!group) return null;
    let label = category
      ? `${category} ${scope}`
      : period
        ? `${period} Oscar ${scope}`
      : scope === "winners"
        ? "Oscar winners"
        : "Oscar-nominated films";
    return {
      name: label,
      sourceLabel: label,
      sourceHref:
        periodGroup?.href || "completion.html#completion-oscars",
      films: group.films,
      filmRefs: group.films.map((film) => ({
        type: "official",
        id: film.id,
      })),
    };
  };
})();
