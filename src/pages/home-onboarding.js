/**
 * @file First-run onboarding choice screen for a fresh `local`-mode session
 * (issue #252): empty archive, sample archive, or import an existing
 * backup. Only rendered when `window.shouldShowOnboarding()` is true.
 */

(function () {
  let escapeText = (value) => window.pageEscape(value);
  let ui = window.uiText || ((text) => text);

  function choiceCard({ heading, body, buttonId, buttonLabel }) {
    return `<article class="onboarding-choice">
      <h2>${escapeText(heading)}</h2>
      <p>${escapeText(body)}</p>
      <button type="button" class="button-link" id="${buttonId}">${escapeText(buttonLabel)}</button>
    </article>`;
  }

  function renderEmptyConfirmation() {
    document.getElementById("homeContent").innerHTML = `
    <div class="onboarding-confirmation">
      <p>${escapeText(ui("Your empty archive is ready."))}</p>
      <a class="button-link" href="editor.html">${escapeText(ui("Add your first film"))}</a>
      <button type="button" class="button-link" id="onboardingSkipToDashboard">${escapeText(ui("Skip for now"))}</button>
    </div>`;
    document
      .getElementById("onboardingSkipToDashboard")
      .addEventListener("click", () => window.renderHomeDashboard?.());
  }

  async function startEmpty() {
    await window.replaceStoredState(window.createClearedLocalState(), {
      message: "Local archive started",
      fallbackMessage: "Local archive started using fallback storage",
    });
    renderEmptyConfirmation();
  }

  async function startWithSample() {
    let sample = window.OSKARS_SAMPLE_ARCHIVE;
    let workspace = window.publishedCanonicalWorkspace(
      sample,
      window.state,
      window.canonicalDataRevision(sample),
    );
    let runtime = window.browserPersistenceToRuntimeState(workspace);
    await window.replaceStoredState(runtime, {
      message: "Sample archive loaded",
      fallbackMessage: "Sample archive loaded using fallback storage",
    });
    window.renderHomeDashboard?.();
  }

  /** Renders the first-run empty/sample/import choice screen into #homeContent. */
  window.renderOnboarding = function () {
    document.getElementById("homeContent").innerHTML = `
    <div class="home-onboarding">
      <h1>${escapeText(ui("Welcome to The Oskars"))}</h1>
      <p>${escapeText(
        ui(
          "This copy runs entirely in your browser — nothing is uploaded, and no one else can see it. Your archive saves automatically to this browser only. Back it up anytime from the Data page, and you can clear it there to start over.",
        ),
      )}</p>
      <div class="onboarding-choices">
        ${choiceCard({
          heading: ui("Start with an empty archive"),
          body: ui(
            "Build your own archive from scratch — add films and awards yourself.",
          ),
          buttonId: "onboardingStartEmpty",
          buttonLabel: ui("Start empty"),
        })}
        ${choiceCard({
          heading: ui("Start with sample data"),
          body: ui(
            "A few made-up films and awards, so you can see how everything works before adding your own.",
          ),
          buttonId: "onboardingStartSample",
          buttonLabel: ui("Load sample archive"),
        })}
        ${choiceCard({
          heading: ui("Import an existing backup"),
          body: ui(
            "Already have an exported backup or canonical file? Import it on the Data page.",
          ),
          buttonId: "onboardingImportBackup",
          buttonLabel: ui("Go to Data page"),
        })}
      </div>
    </div>`;
    document
      .getElementById("onboardingStartEmpty")
      .addEventListener("click", startEmpty);
    document
      .getElementById("onboardingStartSample")
      .addEventListener("click", startWithSample);
    document
      .getElementById("onboardingImportBackup")
      .addEventListener("click", () => {
        window.location.href = "data.html";
      });
  };
})();
