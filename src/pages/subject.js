/** @file Renders role and song detail pages derived from indexed award-credit subjects. */

(function () {
  let subjectEscape = window.pageEscape;
  let ui = window.uiText || ((text) => text);

  window.load();
  let subject = (window.ensureCreditSubjects?.() ||
    state.creditSubjectsById ||
    {})[window.pageQueryParam("id")];
  let container = document.getElementById("subjectPage");

  if (!subject) {
    document.title = `${ui("Credit not found")} · The Oskars`;
    container.innerHTML = `<div class="detail-empty"><h1>${subjectEscape(ui("Credit not found"))}</h1><a href="index.html">${subjectEscape(ui("Return home"))}</a></div>`;
    return;
  }

  let finishRenderTimer = window.startOskarsPerformance?.("subject:render");
  document.title = `${subject.title} · The Oskars`;
  let stats = subject.stats || {};
  let peopleLabel =
    subject.type === "song" ? ui("Songwriters") : ui("Performers");
  let filmRows = subject.films
    .map((film) => {
      let people = subject.appearances
        .filter((appearance) => appearance.filmId === film.id)
        .map(
          (appearance) =>
            `<a class="subject-person" href="${subjectEscape(window.personPageUrl(appearance.personId))}">${subjectEscape(appearance.personName)}</a>`,
        )
        .join("");
      return `<tr>
    <td><a class="period-link" href="${subjectEscape(window.periodPageUrl("year", film.year))}">${subjectEscape(film.year || "")}</a></td>
    <td><a class="table-film-link" href="${subjectEscape(window.filmPageUrl(film.id))}"><strong>${subjectEscape(film.title)}</strong></a></td>
    <td>${people}</td>
  </tr>`;
    })
    .join("");
  let awards = subject.awards
    .map(
      (award) => `<tr>
  <td><a class="period-link" href="${subjectEscape(window.periodPageUrl(window.getAwardPeriodType({ year: award.period }), award.period))}">${subjectEscape(award.period || "")}</a></td>
  <td class="detail-place">${window.pagePlacement(award.placement)}</td>
  <td><a class="category-link" href="${subjectEscape(window.categoryPageUrl(award.category))}">${subjectEscape(award.category)}</a></td>
  <td><a class="table-film-link" href="${subjectEscape(window.filmPageUrl(award.filmId))}">${subjectEscape(award.filmTitle)}</a></td>
</tr>`,
    )
    .join("");
  let appearancesTable = window.renderLeaderboardTable({
    headers: [
      subjectEscape(ui("Year")),
      subjectEscape(ui("Film")),
      peopleLabel,
    ],
    rows: filmRows,
  });
  let awardsTable = window.renderLeaderboardTable({
    headers: [ui("Period"), ui("Place"), ui("Category"), ui("Film")].map(
      subjectEscape,
    ),
    rows: awards,
  });

  let header = window.renderDetailHeader({
    mainHtml: `<h1>${subjectEscape(subject.title)}</h1><p>${subject.type === "song" ? subjectEscape(ui("Song")) : subjectEscape(ui("Role"))}</p>`,
  });
  let summary = window.renderDetailStats({
    itemsHtml: `<span><b>${subject.films.length}</b> ${subjectEscape(ui("Films"))}</span><span><b>${subject.people.length}</b> ${peopleLabel}</span><span><b>${stats.wins || 0}</b> ${subjectEscape(ui("Annual wins"))}</span><span><b>${stats.second || 0}</b> ${subjectEscape(ui("2nd"))}</span><span><b>${stats.third || 0}</b> ${subjectEscape(ui("3rd"))}</span><span><b>${stats.nominations || 0}</b> ${subjectEscape(ui("Noms"))}</span>${window.renderRatingStatisticsItems(subject.ratingStatistics, { escape: subjectEscape, ui })}`,
  });
  container.innerHTML = `${header}
${summary}
<h2>${subjectEscape(ui("Appearances"))}</h2>
${appearancesTable}
<h2>${subjectEscape(ui("Awards"))}</h2>
${awardsTable}`;
  window.enhanceCollapsibles?.(container);
  finishRenderTimer?.(
    `${subject.id}, ${subject.films.length} film(s), ${subject.people.length} people`,
  );
})();
