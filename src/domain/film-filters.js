/** @file Owns the shared validation and matching vocabulary for film and watchlist filters. */

/** @typedef {string|number|string[]|null} FilmFilterValue */
/**
 * @typedef {Object} FilmFilterOptions
 * @property {FilmFilterValue} [defaultValue] Value returned after failed validation.
 * @property {(string|number)[]} [values] Values accepted by a contextual filter.
 */

(function () {
  const mediumValues = new Set(["live-action", "animation", "hybrid"]);
  const screenplayValues = new Set(["original", "adapted"]);

  function inactive(value) {
    return (
      value === undefined || value === null || value === "" || value === "all"
    );
  }

  function ratingValue(value) {
    return Number(value) || window.filmRatingValue(value);
  }

  function ratingGradeBoundary(value) {
    let numeric = Number(value) || 0;
    return numeric
      ? window.filmRatingGrade({ ratingValue: numeric, ratingModifier: "" })
      : 0;
  }

  function allowedValue(value, options = {}) {
    if (!options.values) return true;
    return options.values.some((candidate) =>
      options.key
        ? options.key(candidate) === options.key(value)
        : candidate === value,
    );
  }

  const definitions = {
    period: {
      validate(value) {
        if (inactive(value) || value === "unknown") return true;
        return (
          /^alltime:alltime$/.test(value) ||
          /^(year:\d{4}|(?:decade|century):\d{4}s)$/.test(value) ||
          /^\d{4}s?$/.test(value)
        );
      },
      matches(record, value, options = {}) {
        if (inactive(value)) return true;
        if (value === "unknown")
          return !/^\d{4}$/.test(String(record?.year || ""));
        let [type, key] = String(value).includes(":")
          ? String(value).split(":")
          : [/s$/.test(value) ? "decade" : "year", String(value)];
        if (type === "alltime")
          return options.alltimeMatchesAll || Number(record?.allTimeRank) > 0;
        if (type === "year") return String(record?.year || "") === key;
        if (type === "decade") return window.getDecadeKey(record?.year) === key;
        if (type === "century")
          return window.getCenturyKey(record?.year) === key;
        return true;
      },
    },
    medium: {
      validate: (value) => inactive(value) || mediumValues.has(value),
      matches: (record, value) => inactive(value) || record?.medium === value,
    },
    screenplay: {
      validate: (value) => inactive(value) || screenplayValues.has(value),
      matches: (record, value) =>
        inactive(value) || record?.screenplayType === value,
    },
    adaptationSource: {
      normalize(value, options = {}) {
        return (
          options.values?.find(
            (candidate) =>
              window.adaptationSourceKey(candidate) ===
              window.adaptationSourceKey(value),
          ) || value
        );
      },
      validate(value, options = {}) {
        return (
          inactive(value) ||
          allowedValue(
            value,
            Object.assign({}, options, { key: window.adaptationSourceKey }),
          )
        );
      },
      matches: (record, value) =>
        inactive(value) ||
        window.adaptationSourceKey(record?.adaptationSource) ===
          window.adaptationSourceKey(value),
    },
    country: {
      normalize(value, options = {}) {
        return (
          options.values?.find(
            (candidate) =>
              window.normalizeTitle(candidate) === window.normalizeTitle(value),
          ) || value
        );
      },
      validate(value, options = {}) {
        return (
          inactive(value) ||
          allowedValue(
            value,
            Object.assign({}, options, { key: window.normalizeTitle }),
          )
        );
      },
      matches: (record, value) =>
        inactive(value) ||
        window
          .countryListValues(record?.country)
          .some(
            (country) =>
              window.normalizeTitle(country) === window.normalizeTitle(value),
          ),
    },
    category: {
      validate(value, options = {}) {
        return inactive(value) || allowedValue(value, options);
      },
      matches: (record, value) =>
        inactive(value) ||
        (record?.awards || []).some((award) => award.category === value),
    },
    exactRating: {
      normalize: ratingValue,
      validate(value, options = {}) {
        if (inactive(value)) return true;
        let rating = ratingValue(value);
        return rating >= 0.5 && rating <= 5 && allowedValue(rating, options);
      },
      matches: (record, value) =>
        inactive(value) ||
        window.filmRatingValue(record) === ratingValue(value),
    },
    minimumRating: {
      normalize: (value) => Number(value) || 0,
      validate(value) {
        if (inactive(value) || Number(value) === 0) return true;
        let rating = Number(value);
        return rating >= 0.5 && rating <= 5;
      },
      matches: (record, value) =>
        inactive(value) ||
        !Number(value) ||
        window.filmRatingSortValue(record) >= ratingGradeBoundary(value),
    },
    maximumRating: {
      normalize: (value) => Number(value) || 0,
      validate(value) {
        if (inactive(value) || Number(value) === 0) return true;
        let rating = Number(value);
        return rating >= 0.5 && rating <= 5;
      },
      matches(record, value) {
        if (inactive(value) || !Number(value)) return true;
        let rating = window.filmRatingSortValue(record);
        return Boolean(rating) && rating <= ratingGradeBoundary(value);
      },
    },
    minimumRuntime: {
      normalize: (value) => Number(value) || 0,
      validate(value) {
        if (inactive(value) || Number(value) === 0) return true;
        return Number(value) > 0;
      },
      matches(record, value) {
        if (inactive(value) || !Number(value)) return true;
        let runtime = Number(record?.runtimeMinutes);
        return Boolean(runtime) && runtime >= Number(value);
      },
    },
    maximumRuntime: {
      normalize: (value) => Number(value) || 0,
      validate(value) {
        if (inactive(value) || Number(value) === 0) return true;
        return Number(value) > 0;
      },
      matches(record, value) {
        if (inactive(value) || !Number(value)) return true;
        let runtime = Number(record?.runtimeMinutes);
        return Boolean(runtime) && runtime <= Number(value);
      },
    },
    watchlistTier: {
      validate(value) {
        if (value === null || inactive(value) || value === "unset") return true;
        if (Array.isArray(value))
          return value.every(
            (tier) =>
              tier === "" || Boolean(window.normalizeWatchlistTier(tier)),
          );
        return Boolean(window.normalizeWatchlistTier(value));
      },
      matches(record, value) {
        if (value === null || inactive(value)) return true;
        let tier = window.normalizeWatchlistTier(record?.tier);
        if (Array.isArray(value)) return value.includes(tier);
        return value === "unset"
          ? !tier
          : tier === window.normalizeWatchlistTier(value);
      },
    },
  };

  /** Returns a shared filter definition by its vocabulary name.
   * @param {string} name Filter vocabulary name.
   * @returns {Object|null} The definition, when known.
   */
  window.filmFilterDefinition = function (name) {
    return definitions[name] || null;
  };

  /** Parses a value through a shared filter definition and falls back when it is invalid.
   * @param {string} name Filter vocabulary name.
   * @param {FilmFilterValue} value Candidate filter value.
   * @param {FilmFilterOptions} [options] Validation context and fallback.
   * @returns {FilmFilterValue} The accepted value or configured fallback.
   */
  window.parseFilmFilterValue = function (name, value, options = {}) {
    let definition = definitions[name];
    if (!definition) return options.defaultValue;
    let normalized = definition.normalize
      ? definition.normalize(value, options)
      : value;
    return definition.validate(normalized, options)
      ? normalized
      : options.defaultValue;
  };

  /** Tests a record against a composed set of shared film filters.
   * @param {FilmRecord|WatchlistItem} record Film-like record to test.
   * @param {Record<string, FilmFilterValue>} filters Filter names and active values.
   * @param {Record<string, Object>} [options] Per-filter predicate context.
   * @returns {boolean} Whether the record satisfies every known filter.
   */
  window.filmMatchesFilters = function (record, filters, options = {}) {
    return Object.entries(filters || {}).every(([name, value]) => {
      let definition = definitions[name];
      return !definition || definition.matches(record, value, options[name]);
    });
  };
})();
