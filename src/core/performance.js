/**
 * @file Provides opt-in in-memory performance timers and browser-facing
 * inspection controls used by startup, rendering, and persistence paths.
 */

window.OSKARS_PERFORMANCE_LOG_KEY = "oskars-performance-log";
window.OSKARS_PERFORMANCE_MAX_ENTRIES = 500;
window.OSKARS_DIAGNOSTIC_MAX_ENTRIES = 50;

let oskarsPerformanceEntries = [];
let oskarsDiagnosticEntries = [];

function sanitizeDiagnosticText(value) {
  return String(value ?? "")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\beyJ[a-z\d_-]{10,}\.[a-z\d_-]{10,}\.[a-z\d_-]{10,}\b/gi,
      "[redacted token]",
    )
    .replace(
      /((?:api[_-]?key|client[_-]?secret|authorization[_-]?code|access[_-]?token|refresh[_-]?token|token|password|secret|code)=)[^&\s"'<>]+/gi,
      "$1[redacted]",
    )
    .slice(0, 4000);
}
window.sanitizeOskarsDiagnosticText = sanitizeDiagnosticText;

/** Returns a defensive copy of the most recent sanitized runtime diagnostics. @returns {Array<{level: string, message: string, details: string, path: string, timestamp: string}>} Diagnostics in insertion order. */
window.getOskarsDiagnosticEntries = function () {
  return oskarsDiagnosticEntries.map((entry) => ({ ...entry }));
};

/** Records one sanitized diagnostic in the bounded in-memory log. @param {'warning'|'error'} level Diagnostic severity. @param {*} message Short diagnostic message. @param {*} [details] Optional technical details. @returns {{level: string, message: string, details: string, path: string, timestamp: string}} Stored diagnostic. */
window.recordOskarsDiagnostic = function (level, message, details = "") {
  let entry = {
    level: level === "warning" ? "warning" : "error",
    message: sanitizeDiagnosticText(message),
    details: sanitizeDiagnosticText(details),
    path: sanitizeDiagnosticText(
      `${window.location?.pathname || ""}${window.location?.search || ""}`,
    ),
    timestamp: new Date().toISOString(),
  };
  oskarsDiagnosticEntries.push(entry);
  let excess =
    oskarsDiagnosticEntries.length - window.OSKARS_DIAGNOSTIC_MAX_ENTRIES;
  if (excess > 0) oskarsDiagnosticEntries.splice(0, excess);
  return { ...entry };
};

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
