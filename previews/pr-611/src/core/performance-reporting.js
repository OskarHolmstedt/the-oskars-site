/**
 * @file Real-user Core Web Vitals reporting (issue #748). On the deployed
 * site, measures each page view's LCP, INP, and CLS with Google's web-vitals
 * library and sends them anonymously (page type, viewport class, deploy
 * version, and the values; no account, device, or session identifier) to the
 * record_web_vitals Supabase RPC when the page is hidden. The entry loader
 * loads this file after the page's load event, outside every render path.
 * Objections (the privacy notice's switch, Global Privacy Control, Do Not
 * Track) are owned by src/ui/privacy-notice.js; without it nothing reports.
 */

(function () {
  const WEB_VITALS_URL = "https://esm.sh/web-vitals@6.2.2";
  const MOBILE_MAX_WIDTH = 720;
  const TABLET_MAX_WIDTH = 1100;

  /**
   * Returns why this page view must not report, or null when it may.
   * @param {Window} [env] Global object to inspect (tests pass a stand-in).
   * @returns {'no-objection-check'|'gpc'|'dnt'|'opt-out'|'automation'|'local'|'preview'|'owner-mode'|'unconfigured'|null}
   */
  window.performanceReportingBlocker = function (env = window) {
    if (typeof env.performanceReportingObjection !== "function")
      return "no-objection-check";
    let objection = env.performanceReportingObjection(env);
    if (objection) return objection;
    let location = env.location || {};
    if (env.navigator?.webdriver) return "automation";
    if (
      location.protocol === "file:" ||
      ["localhost", "127.0.0.1", ""].includes(location.hostname || "")
    )
      return "local";
    if (/\/previews\/pr-\d+\//.test(location.pathname || "")) return "preview";
    if (env.getRuntimeMode?.() === "owner") return "owner-mode";
    if (
      !env.OSKARS_SUPABASE_CONFIG?.url ||
      !env.OSKARS_SUPABASE_CONFIG?.anonKey
    )
      return "unconfigured";
    return null;
  };

  /**
   * Builds the record_web_vitals RPC arguments for one page view.
   * @param {string} page Entry name, e.g. "film".
   * @param {number} viewportWidth Layout viewport width in CSS pixels.
   * @param {string} appVersion The deploy's 12-character commit stamp, or "".
   * @param {Array<{name: string, value: number, rating: string, navigationType: string}>} metrics
   * @returns {{p_page: string, p_viewport: string, p_app_version: string|null, p_metrics: Array<{name: string, value: number, rating: string, navigation_type: string|null}>}}
   */
  window.buildWebVitalsReport = function (
    page,
    viewportWidth,
    appVersion,
    metrics,
  ) {
    let latest = new Map();
    metrics.forEach((metric) => latest.set(metric.name, metric));
    return {
      p_page: page,
      p_viewport:
        viewportWidth <= MOBILE_MAX_WIDTH
          ? "mobile"
          : viewportWidth <= TABLET_MAX_WIDTH
            ? "tablet"
            : "desktop",
      p_app_version: /^[0-9a-f]{12}$/.test(appVersion || "")
        ? appVersion
        : null,
      p_metrics: [...latest.values()].map((metric) => ({
        name: metric.name,
        value: Math.max(0, Number(metric.value) || 0),
        rating: metric.rating,
        navigation_type: metric.navigationType || null,
      })),
    };
  };

  function appVersion() {
    let loader = document.querySelector('script[src*="entry-loader.js"]');
    return loader ? new URL(loader.src).searchParams.get("v") || "" : "";
  }

  function send(report) {
    let config = window.OSKARS_SUPABASE_CONFIG;
    fetch(`${config.url}/rest/v1/rpc/record_web_vitals`, {
      method: "POST",
      keepalive: true,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(report),
    }).catch(() => {});
  }

  /**
   * Queues every web-vitals report for this page view and sends the batch
   * when the page is hidden or unloaded.
   * @param {{onLCP: Function, onINP: Function, onCLS: Function}} webVitals The web-vitals module.
   */
  window.reportWebVitals = function (webVitals) {
    let pending = [];
    let queue = (metric) => pending.push(metric);
    webVitals.onLCP(queue);
    webVitals.onINP(queue);
    webVitals.onCLS(queue);
    // Registered after web-vitals' own visibility listeners, so a page being
    // hidden finalizes CLS and INP into the queue before it is sent.
    let flush = () => {
      if (!pending.length) return;
      if (window.performanceReportingBlocker()) {
        pending = [];
        return;
      }
      send(
        window.buildWebVitalsReport(
          window.OSKARS_ENTRY,
          document.documentElement.clientWidth,
          appVersion(),
          pending,
        ),
      );
      pending = [];
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
  };

  /**
   * Starts measuring this page view when reporting is allowed.
   * @returns {Promise<boolean>} Whether measurement started.
   */
  window.startPerformanceReporting = async function () {
    if (window.performanceReportingBlocker() || !window.OSKARS_ENTRY)
      return false;
    try {
      window.reportWebVitals(await import(WEB_VITALS_URL));
      return true;
    } catch {
      return false;
    }
  };

  window.startPerformanceReporting();
})();
