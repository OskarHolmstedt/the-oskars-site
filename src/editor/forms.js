/** @file Binds the editor's static film and nomination dialogs and submits their domain operations. */

let ui = window.uiText || ((text) => text);
let finishStaticFormTimer = window.startOskarsPerformance?.(
  "editor:staticFormSetup",
);

// editor.html's dialogs are static markup, not JS-templated like every other
// page, so there's no ui() call site to wrap - the labels/options/placeholders
// carry their own English text as a data-i18n(-placeholder) key instead, and
// this runs once at load to swap in the Swedish text where available.
document.querySelectorAll("[data-i18n]").forEach((element) => {
  element.textContent = ui(element.dataset.i18n);
});
document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
  element.placeholder = ui(element.dataset.i18nPlaceholder);
});

function openDialog(dialog) {
  if (dialog.showModal) dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
  if (dialog.close) dialog.close();
  else dialog.removeAttribute("open");
}

function populateNominationFilms() {
  let select = document.getElementById("nominationFilmInput");
  select.innerHTML = "";
  Object.values(state.filmsById || {})
    .sort(
      (a, b) =>
        window.compareEnglishTitles(a.title, b.title) ||
        String(a.year).localeCompare(String(b.year)),
    )
    .forEach((film) => {
      let option = document.createElement("option");
      option.value = film.id;
      option.textContent = `${film.title} (${film.year || ui("Unknown year")})`;
      select.appendChild(option);
    });
}

function updateNominationPeriod() {
  let film = window.findFilmById(
    document.getElementById("nominationFilmInput").value,
  );
  let type = document.getElementById("nominationPeriodType").value;
  let periodInput = document.getElementById("nominationPeriodKey");
  let year = film?.year;
  periodInput.value =
    type === "allTime"
      ? "alltime"
      : type === "decades"
        ? getDecadeKey(year)
        : type === "centuries"
          ? getCenturyKey(year)
          : /^\d{4}$/.test(String(year || ""))
            ? year
            : "";
  periodInput.readOnly = type === "allTime";

  let category = document.getElementById("nominationCategoryInput").value;
  let limits = window.PERIOD_LIMITS[type];
  document.getElementById("nominationPlacementInput").max =
    category === "Best Picture" ? limits.picture : limits.category;
}

function renderFilmRatingField() {
  let container = document.getElementById("filmRatingField");
  container.innerHTML = window.renderRatingInput({
    name: "rating",
    id: "filmRatingInput",
  });
  window.enhanceRatingInputs(container);
}

document.getElementById("addFilmBtn").addEventListener("click", () => {
  let finishDialogTimer = window.startOskarsPerformance?.("editor:filmDialog");
  document.getElementById("filmForm").reset();
  renderFilmRatingField();
  openDialog(document.getElementById("filmDialog"));
  finishDialogTimer?.(
    `${document.querySelectorAll("#filmForm input, #filmForm select, #filmForm textarea").length} field(s)`,
  );
});

document.getElementById("cancelFilmBtn").addEventListener("click", () => {
  closeDialog(document.getElementById("filmDialog"));
});

document.getElementById("filmForm").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    let film = window.addFilm({
      title: document.getElementById("filmTitleInput").value,
      year: document.getElementById("filmYearInput").value,
      director: document.getElementById("filmDirectorInput").value,
      rating: document.getElementById("filmRatingInput").value,
      medium: document.getElementById("filmMediumInput").value,
      screenplayType: document.getElementById("filmScreenplayInput").value,
      adaptationSource: document.getElementById("filmAdaptationSourceInput")
        .value,
      country: document.getElementById("filmCountryInput").value,
      url: document.getElementById("filmUrlInput").value,
      posterUrl: document.getElementById("filmPosterInput").value,
      franchises: document.getElementById("filmFranchisesInput").value,
      tags: document.getElementById("filmTagsInput").value,
      review: document.getElementById("filmReviewInput").value,
    });
    closeDialog(document.getElementById("filmDialog"));
    alert(
      ui("{title} ({year}) was added.", { title: film.title, year: film.year }),
    );
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("addNominationBtn").addEventListener("click", () => {
  let finishDialogTimer = window.startOskarsPerformance?.(
    "editor:nominationDialog",
  );
  let finishOptionsTimer = window.startOskarsPerformance?.(
    "editor:nominationOptions",
  );
  populateNominationFilms();
  let categorySelect = document.getElementById("nominationCategoryInput");
  categorySelect.innerHTML = "";
  getOrderedCategories().forEach((category) => {
    let option = document.createElement("option");
    option.value = category;
    option.textContent = window.localizedCategoryName?.(category) || category;
    categorySelect.appendChild(option);
  });
  finishOptionsTimer?.(
    `${document.getElementById("nominationFilmInput").options.length} films, ${categorySelect.options.length} categories`,
  );
  document.getElementById("nominationForm").reset();
  updateNominationPeriod();
  openDialog(document.getElementById("nominationDialog"));
  finishDialogTimer?.(
    `${document.querySelectorAll("#nominationForm input, #nominationForm select").length} field(s)`,
  );
});

document.getElementById("cancelNominationBtn").addEventListener("click", () => {
  closeDialog(document.getElementById("nominationDialog"));
});
document
  .getElementById("nominationFilmInput")
  .addEventListener("change", updateNominationPeriod);
document
  .getElementById("nominationPeriodType")
  .addEventListener("change", updateNominationPeriod);
document
  .getElementById("nominationCategoryInput")
  .addEventListener("change", updateNominationPeriod);

document
  .getElementById("nominationForm")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      let values = {
        filmId: document.getElementById("nominationFilmInput").value,
        periodType: document.getElementById("nominationPeriodType").value,
        periodKey: document.getElementById("nominationPeriodKey").value,
        category: document.getElementById("nominationCategoryInput").value,
        placement: document.getElementById("nominationPlacementInput").value,
        recipient: document.getElementById("nominationRecipientInput").value,
        detail: document.getElementById("nominationDetailInput").value,
      };
      let plan = window.planNominationInsertion(values);
      if (!window.confirmNominationPlacementPlan(plan)) return;
      let result = window.applyNominationPlacementPlan(plan);
      if (!result.ok)
        throw new Error(result.reason || ui("Nomination was not added."));
      closeDialog(document.getElementById("nominationDialog"));
      alert(ui("Nomination added."));
    } catch (err) {
      alert(err.message);
    }
  });
finishStaticFormTimer?.("2 dialog(s)");
