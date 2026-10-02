/** @file Installs the global unhandled-error recovery surface for application pages. */

let oskarsErrorRecoveryInstalled = false;
let oskarsErrorRecoveryPanel = null;

function captureConsoleDiagnostics() {
  let consoleObject = window.console;
  for (let [method, level] of [
    ["warn", "warning"],
    ["error", "error"],
  ]) {
    let original = consoleObject?.[method];
    if (typeof original !== "function" || original.__oskarsDiagnosticWrapped)
      continue;
    let wrapped = function (...args) {
      window.recordOskarsDiagnostic?.(
        level,
        `console.${method}`,
        args.map(runtimeErrorDetails).join(" "),
      );
      return original.apply(consoleObject, args);
    };
    Object.defineProperty(wrapped, "__oskarsDiagnosticWrapped", {
      value: true,
    });
    consoleObject[method] = wrapped;
  }
}

function runtimeErrorDetails(error) {
  let details =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack || ""}`
      : String(error ?? "Unknown error");
  return (
    window.sanitizeOskarsDiagnosticText?.(details) ||
    details
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /((?:api[_-]?key|client[_-]?secret|authorization[_-]?code|access[_-]?token|refresh[_-]?token|token|password|secret|code)=)[^&\s"'<>]+/gi,
        "$1[redacted]",
      )
      .slice(0, 4000)
  );
}

/** Retries one failed cross-origin image load with cache-busted URLs. @param {HTMLImageElement} image Failed image element. @returns {boolean} Whether retries started. */
window.retryOskarsExternalImage = function (image) {
  if (!image?.src || image.dataset?.oskarsRetryStarted || !window.withRetry)
    return false;
  let source;
  try {
    source = new URL(image.currentSrc || image.src, window.location?.href);
    if (
      !["http:", "https:"].includes(source.protocol) ||
      source.origin === window.location?.origin
    )
      return false;
  } catch {
    return false;
  }

  image.dataset.oskarsRetryStarted = "true";
  let attempt = 0;
  window
    .withRetry(
      () =>
        new Promise((resolve, reject) => {
          source.searchParams.set("oskars-retry", String(++attempt));
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener(
            "error",
            () => reject(new TypeError("External image request failed")),
            { once: true },
          );
          image.src = source.href;
        }),
      { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 1500 },
    )
    .catch((error) => {
      window.recordOskarsDiagnostic?.(
        "warning",
        "External image request failed after retries",
        error.message,
      );
    });
  return true;
};

/** Renders an accessible recovery surface and records the sanitized failure. @param {*} error Unhandled error or rejection reason. @param {{blocking?: boolean, message?: string}} [options] Render context. */
window.renderOskarsErrorRecovery = function (error, options = {}) {
  let details = runtimeErrorDetails(error);
  let diagnostic = window.recordOskarsDiagnostic?.(
    "error",
    options.message || "Unhandled page error",
    details,
  );
  let panel = oskarsErrorRecoveryPanel;
  if (!panel) {
    panel = document.createElement("section");
    panel.setAttribute("role", "alert");
    panel.setAttribute("data-runtime-error", "");

    let heading = document.createElement("h2");
    heading.textContent =
      window.uiText?.("An unexpected error occurred.") ||
      "An unexpected error occurred.";
    let message = document.createElement("p");
    message.textContent =
      window.uiText?.(
        "This page encountered a problem. Reload it or return home.",
      ) || "This page encountered a problem. Reload it or return home.";

    let actions = document.createElement("div");
    actions.className = "runtime-error-actions";
    let reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = window.uiText?.("Reload page") || "Reload page";
    reload.addEventListener("click", () => window.location.reload());
    let home = document.createElement("a");
    home.href = "index.html";
    home.textContent = window.uiText?.("Go to home") || "Go to home";
    actions.append(reload, home);

    let disclosure = document.createElement("details");
    let summary = document.createElement("summary");
    summary.textContent =
      window.uiText?.("Technical details") || "Technical details";
    let pre = document.createElement("pre");
    disclosure.append(summary, pre);
    panel.append(heading, message, actions, disclosure);
    oskarsErrorRecoveryPanel = panel;
  }

  panel.className = options.blocking
    ? "runtime-error runtime-error-blocking"
    : "runtime-error";
  panel.querySelector("pre").textContent =
    diagnostic?.details || details || "Unknown error";
  if (options.blocking) {
    let main = document.querySelector("main");
    if (main) main.replaceChildren(panel);
    else document.body.prepend(panel);
  } else if (!panel.isConnected) {
    document.body.prepend(panel);
  }
};

/** Installs one global listener for unhandled runtime errors and promise rejections. */
window.installOskarsErrorRecovery = function () {
  if (oskarsErrorRecoveryInstalled) return;
  oskarsErrorRecoveryInstalled = true;
  captureConsoleDiagnostics();
  window.addEventListener(
    "error",
    (event) => {
      let target = event.target;
      if (target && target !== window) {
        if (
          window.HTMLImageElement &&
          target instanceof window.HTMLImageElement
        ) {
          if (target.dataset?.oskarsRetryStarted) return;
          if (window.retryOskarsExternalImage(target)) return;
        }
        return;
      }
      window.renderOskarsErrorRecovery(event.error || event.message, {
        message: "Unhandled page error",
      });
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    window.renderOskarsErrorRecovery(event.reason, {
      message: "Unhandled promise rejection",
    });
  });
};
