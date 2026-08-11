/**
 * @file Provides opt-in in-memory performance timers and browser-facing
 * inspection controls used by startup, rendering, and persistence paths.
 */

window.OSKARS_PERFORMANCE_LOG_KEY = "oskars-performance-log";
window.OSKARS_PERFORMANCE_MAX_ENTRIES = 500;

let oskarsPerformanceEntries = [];

/**
 * Returns defensive copies of recorded performance measurements.
 * @returns {OskarsPerformanceEntry[]} Recorded measurements in insertion order.
 */
window.getOskarsPerformanceEntries = function () {
  return oskarsPerformanceEntries.map((entry) => ({ ...entry }));
};

/**
 * Clears all in-memory performance measurements.
 */
window.clearOskarsPerformanceEntries = function () {
  oskarsPerformanceEntries.length = 0;
};

/**
 * Records and broadcasts one bounded performance measurement.
 * @param {string} label Stable measurement label.
 * @param {number} duration Elapsed milliseconds.
 * @param {string} [extra] Optional diagnostic context.
 * @returns {OskarsPerformanceEntry} Stored measurement.
 */
window.recordOskarsPerformance = function (label, duration, extra = "") {
  let entry = {
    label: String(label || ""),
    duration: Number(duration),
    extra: String(extra || ""),
    path: `${window.location?.pathname || ""}${window.location?.search || ""}`,
    timestamp: new Date().toISOString(),
  };
  oskarsPerformanceEntries.push(entry);
  let excess =
    oskarsPerformanceEntries.length - window.OSKARS_PERFORMANCE_MAX_ENTRIES;
  if (excess > 0) oskarsPerformanceEntries.splice(0, excess);
  try {
    window.dispatchEvent?.(
      new CustomEvent("oskars:performance", { detail: { ...entry } }),
    );
  } catch (err) {}
  return entry;
};

/**
 * Reports whether performance logging is enabled by URL or local preference.
 * @returns {boolean} Whether new timers should record measurements.
 */
window.oskarsPerformanceEnabled = function () {
  try {
    return (
      /(?:^|[?&])perf=1(?:&|$)/.test(window.location?.search || "") ||
      localStorage.getItem(window.OSKARS_PERFORMANCE_LOG_KEY) === "1"
    );
  } catch (err) {
    return false;
  }
};

/**
 * Persists the local performance-logging preference.
 * @param {boolean} enabled Whether logging should remain enabled across pages.
 */
window.setOskarsPerformanceLogging = function (enabled) {
  try {
    if (enabled) localStorage.setItem(window.OSKARS_PERFORMANCE_LOG_KEY, "1");
    else localStorage.removeItem(window.OSKARS_PERFORMANCE_LOG_KEY);
  } catch (err) {}
};

/**
 * Starts an enabled performance measurement.
 * @param {string} label Stable measurement label.
 * @returns {OskarsPerformanceStop|null} Stop callback, or null when logging is disabled.
 */
window.startOskarsPerformance = function (label) {
  if (!window.oskarsPerformanceEnabled?.() || !window.performance?.now)
    return null;
  let start = window.performance.now();
  return function (extra = "") {
    let duration = Math.round((window.performance.now() - start) * 10) / 10;
    window.recordOskarsPerformance?.(label, duration, extra);
    window.console?.info?.(
      `[Oskars perf] ${label}: ${duration} ms${extra ? ` (${extra})` : ""}`,
    );
    return duration;
  };
};
