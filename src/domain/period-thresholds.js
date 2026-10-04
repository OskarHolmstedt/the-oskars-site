/** @file Owns film-count ceremony readiness thresholds and badge formatting across release years, decades, centuries, and all-time. */

(function () {
  /**
   * Configurable minimum film-count thresholds per period type for full ceremony readiness.
   * @type {Record<string, {total: number, animated: number, foreign: number, adapted: number, original: number}>}
   */
  window.PERIOD_CEREMONY_THRESHOLDS = {
    year: {
      total: 10,
      animated: 5,
      foreign: 5,
      adapted: 5,
      original: 5,
    },
    decade: {
      total: 10,
      animated: 5,
      foreign: 5,
      adapted: 5,
      original: 5,
    },
    century: {
      total: 10,
      animated: 5,
      foreign: 5,
      adapted: 5,
      original: 5,
    },
    alltime: {
      total: 10,
      animated: 5,
      foreign: 5,
      adapted: 5,
      original: 5,
    },
  };

  /**
   * Tests whether a film qualifies as a foreign-language or non-US/UK international film.
   * @param {FilmRecord|Object} film Film record.
   * @returns {boolean} Whether the film is foreign/international.
   */
  window.isPeriodThresholdForeignFilm = function (film) {
    if (!film || typeof film !== "object") return false;
    let language = film.original_language || film.originalLanguage;
    if (language && typeof language === "string") {
      let normalizedLang = language.trim().toLowerCase();
      if (
        normalizedLang === "en" ||
        normalizedLang === "eng" ||
        normalizedLang === "english"
      ) {
        return false;
      }
      return true;
    }
    let country =
      film.primary_country ||
      film.primaryCountry ||
      (window.primaryCountryValue ? window.primaryCountryValue(film) : "") ||
      film.country ||
      "";
    if (!country) return false;
    if (window.isUsOrUkCountry && window.isUsOrUkCountry(country)) {
      return false;
    }
    return true;
  };

  /**
   * Counts films across total, animated, foreign, adapted screenplay, and original screenplay categories.
   * @param {(FilmRecord|Object)[]} films Array of film records.
   * @returns {{total: number, animated: number, foreign: number, adapted: number, original: number}} Category counts.
   */
  window.countPeriodThresholdFilms = function (films = []) {
    let counts = {
      total: 0,
      animated: 0,
      foreign: 0,
      adapted: 0,
      original: 0,
    };
    (films || []).forEach((film) => {
      if (!film || typeof film !== "object") return;
      counts.total += 1;
      if (film.medium === "animation") {
        counts.animated += 1;
      }
      if (window.isPeriodThresholdForeignFilm(film)) {
        counts.foreign += 1;
      }
      let screenplay = film.screenplay_type || film.screenplayType;
      if (screenplay === "adapted") {
        counts.adapted += 1;
      } else if (screenplay === "original") {
        counts.original += 1;
      }
    });
    return counts;
  };

  /**
   * Resolves ceremony threshold statistics and readiness for a given set of films or pre-computed counts.
   * @param {(FilmRecord|Object)[]|{total?: number, animated?: number, foreign?: number, adapted?: number, original?: number}} filmsOrCounts Films or counts object.
   * @param {string} [periodType] Period type ('year'|'decade'|'century'|'alltime').
   * @returns {{periodType: string, counts: {total: number, animated: number, foreign: number, adapted: number, original: number}, thresholds: {total: number, animated: number, foreign: number, adapted: number, original: number}, metrics: {key: string, label: string, count: number, threshold: number, met: boolean}[], allMet: boolean}} Threshold stats.
   */
  window.periodThresholdStats = function (filmsOrCounts, periodType = "year") {
    let normalizedType = window.periodPageType
      ? window.periodPageType(periodType)
      : String(periodType || "year").toLowerCase();
    let thresholds = window.PERIOD_CEREMONY_THRESHOLDS?.[normalizedType] ||
      window.PERIOD_CEREMONY_THRESHOLDS?.year || {
        total: 10,
        animated: 5,
        foreign: 5,
        adapted: 5,
        original: 5,
      };
    let counts = Array.isArray(filmsOrCounts)
      ? window.countPeriodThresholdFilms(filmsOrCounts)
      : {
          total: Number(filmsOrCounts?.total) || 0,
          animated: Number(filmsOrCounts?.animated) || 0,
          foreign: Number(filmsOrCounts?.foreign) || 0,
          adapted: Number(filmsOrCounts?.adapted) || 0,
          original: Number(filmsOrCounts?.original) || 0,
        };
    let ui = window.uiText || ((text) => text);
    let metrics = [
      {
        key: "total",
        label: ui("total"),
        count: counts.total,
        threshold: thresholds.total,
        met: counts.total >= thresholds.total,
      },
      {
        key: "animated",
        label: ui("animated"),
        count: counts.animated,
        threshold: thresholds.animated,
        met: counts.animated >= thresholds.animated,
      },
      {
        key: "foreign",
        label: ui("foreign"),
        count: counts.foreign,
        threshold: thresholds.foreign,
        met: counts.foreign >= thresholds.foreign,
      },
      {
        key: "adapted",
        label: ui("adapted"),
        count: counts.adapted,
        threshold: thresholds.adapted,
        met: counts.adapted >= thresholds.adapted,
      },
      {
        key: "original",
        label: ui("original"),
        count: counts.original,
        threshold: thresholds.original,
        met: counts.original >= thresholds.original,
      },
    ];
    return {
      periodType: normalizedType,
      counts,
      thresholds,
      metrics,
      allMet: metrics.every((metric) => metric.met),
    };
  };

  /**
   * Renders HTML badges/chips for the ceremony readiness thresholds.
   * @param {(FilmRecord|Object)[]|Object} filmsOrStats Films, counts, or precomputed threshold stats.
   * @param {Object} [options] Presentation options.
   * @param {(value:*) => string} [options.escape] HTML escaper.
   * @param {(text: string, values?: Object) => string} [options.ui] Localization function.
   * @param {string} [options.periodType] Period type ('year'|'decade'|'century'|'alltime').
   * @param {string} [options.classes] Extra wrapper CSS classes.
   * @returns {string} Threshold chips HTML.
   */
  window.renderPeriodThresholdBadges = function (filmsOrStats, options = {}) {
    let escape =
      options.escape || window.pageEscape || ((val) => String(val ?? ""));
    let ui = options.ui || window.uiText || ((text) => text);
    let stats =
      filmsOrStats &&
      typeof filmsOrStats === "object" &&
      "metrics" in filmsOrStats
        ? filmsOrStats
        : window.periodThresholdStats(
            filmsOrStats,
            options.periodType || "year",
          );
    let chipsHtml = stats.metrics
      .map((metric) => {
        let stateClass = metric.met
          ? "period-threshold-chip--met"
          : "period-threshold-chip--unmet";
        let title = metric.met
          ? ui("{count}/{threshold} {label} (threshold met)", {
              count: metric.count,
              threshold: metric.threshold,
              label: metric.label,
            })
          : ui("{count}/{threshold} {label} (threshold: {threshold})", {
              count: metric.count,
              threshold: metric.threshold,
              label: metric.label,
            });
        return `<span class="period-threshold-chip ${stateClass}" title="${escape(title)}"><b>${escape(metric.count)}/${escape(metric.threshold)}</b> ${escape(metric.label)}</span>`;
      })
      .join("");
    let wrapperClasses = [
      "period-threshold-chips",
      stats.allMet ? "period-threshold-chips--all-met" : "",
      options.classes || "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<div class="${escape(wrapperClasses)}" aria-label="${escape(ui("Ceremony thresholds"))}">${chipsHtml}</div>`;
  };
})();
