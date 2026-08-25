/**
 * @file First-run onboarding choice screen for a fresh `local`-mode session
 * (issue #252): import a Letterboxd export (the recommended path for most
 * new users, headlined first), an empty archive, or sample data - with
 * restoring a previous Oskars backup/canonical file as a lighter-weight
 * link rather than a fourth competing card. Only rendered when
 * `window.shouldShowOnboarding()` is true.
 */

(function () {
  let escapeText = (value) => window.pageEscape(value);
  let ui = window.uiText || ((text) => text);

  function choiceCard({ eyebrow, heading, body, buttonId, buttonLabel, recommended }) {
    return `<article class="onboarding-choice${recommended ? " onboarding-choice--recommended" : ""}">
      ${eyebrow ? `<span class="eyebrow">${escapeText(eyebrow)}</span>` : ""}
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
          "Your archive saves automatically to this browser and syncs to your signed-in account. Back it up anytime from the Data page, and you can clear it there to start over.",
        ),
      )}</p>
      <div class="onboarding-choices">
        ${choiceCard({
          eyebrow: ui("Recommended if you already track films elsewhere"),
          heading: ui("Import your Letterboxd export"),
          body: ui(
            "Bring in watched films, ratings, diary dates, tags, and your watchlist in one step. Awards and rankings stay yours to set up here.",
          ),
          buttonId: "onboardingImportLetterboxd",
          buttonLabel: ui("Import Letterboxd export"),
          recommended: true,
        })}
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
      </div>
      <p class="onboarding-alternative">${escapeText(
        ui(
          "Restoring a previous Oskars backup or canonical file instead? ",
        ),
      )}<a href="${window.prepareOskarsAccountNavigation("data.html#backupRestore")}">${escapeText(ui("Go to the Data page."))}</a></p>
    </div>`;
    document
      .getElementById("onboardingImportLetterboxd")
      .addEventListener("click", () => {
        window.location.href = window.prepareOskarsAccountNavigation(
          "data.html#letterboxdImport",
        );
      });
    document
      .getElementById("onboardingStartEmpty")
      .addEventListener("click", startEmpty);
    document
      .getElementById("onboardingStartSample")
      .addEventListener("click", startWithSample);
  };
})();
