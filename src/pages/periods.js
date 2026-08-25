/** @file Renders the period index as an all-time, century, and decade poster-card gallery. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  window.load();
  let container = document.getElementById("periodsPage");

  function archiveFilms() {
    return Object.values(state.filmsById || {}).filter((film) => {
      let year = Number(film.year);
      return Number.isInteger(year) && year >= 1000 && year <= 9999;
    });
  }

  function periodKeyForYear(year, type) {
    let value = Number(year);
    if (type === "century") return `${Math.floor(value / 100) * 100}s`;
    if (type === "decade") return `${Math.floor(value / 10) * 10}s`;
    return "alltime";
  }

  function periodRecords(type) {
    let records = new Map();
    archiveFilms().forEach((film) => {
      let key = periodKeyForYear(film.year, type);
      let record = records.get(key) || {
        key,
        type,
        films: [],
        nominations: 0,
        winners: 0,
      };
      record.films.push(film);
      (film.awards || []).forEach((award) => {
        let awardKey = String(award.year || "").toLowerCase();
        let matches =
          type === "alltime"
            ? awardKey === "alltime" || awardKey === "all-time"
            : awardKey === key.toLowerCase();
        if (!matches) return;
        record.nominations += 1;
        if (Number(award.placement) === 1) record.winners += 1;
      });
      records.set(key, record);
    });
    return [...records.values()].sort(
      (left, right) =>
        Number(right.key.replace(/\D/g, "")) -
        Number(left.key.replace(/\D/g, "")),
    );
  }

  function representativeFilms(record) {
    let rankField =
      record.type === "century"
        ? "centuryRank"
        : record.type === "decade"
          ? "decadeRank"
          : "allTimeRank";
    return [...record.films]
      .sort(
        (left, right) =>
          Number(Boolean(window.normalizePosterRecord?.(right.poster))) -
            Number(Boolean(window.normalizePosterRecord?.(left.poster))) ||
          Number(
            left[rankField] || left.allTimeRank || Number.MAX_SAFE_INTEGER,
          ) -
            Number(
              right[rankField] || right.allTimeRank || Number.MAX_SAFE_INTEGER,
            ) ||
          Number(right.ratingValue || 0) - Number(left.ratingValue || 0) ||
          String(left.title || "").localeCompare(String(right.title || "")),
      )
      .slice(0, 5);
  }

  function periodStats(record) {
    let awards = record.nominations
      ? `<span><b>${record.nominations}</b> ${escape(ui("nominations"))}</span><span><b>${record.winners}</b> ${escape(ui("winners"))}</span>`
      : "";
    return `<div class="period-gallery-card-stats"><span><b>${record.films.length}</b> ${escape(ui("films"))}</span>${awards}</div>`;
  }

  function periodCard(record, options = {}) {
    let label =
      record.type === "alltime"
        ? ui("The whole archive")
        : record.type === "century"
          ? ui("Century")
          : ui("Decade");
    let href = window.periodPageUrl(record.type, record.key);
    let deck = window.renderPosterDeck?.(representativeFilms(record), {
      classes: options.featured
        ? "period-gallery-poster-deck poster-deck--featured"
        : "period-gallery-poster-deck",
    });
    return `<article class="period-gallery-card${options.featured ? " period-gallery-card--featured" : ""}"><a class="period-gallery-card-link" href="${escape(href)}">${deck || ""}<div class="period-gallery-card-body"><span class="eyebrow">${escape(label)}</span><h2>${escape(record.type === "alltime" ? ui("All-time") : record.key)}</h2>${periodStats(record)}<span class="period-gallery-card-action">${escape(ui("Open period"))} →</span></div></a></article>`;
  }

  function gallerySection(id, eyebrow, title, text, records, classes = "") {
    if (!records.length) return "";
    return `<section class="period-gallery-section" aria-labelledby="${escape(id)}"><div class="section-heading"><div><span class="eyebrow">${escape(ui(eyebrow))}</span><h2 id="${escape(id)}">${escape(ui(title))}</h2></div><p>${escape(ui(text))}</p></div><div class="period-gallery-grid ${escape(classes)}">${records.map((record) => periodCard(record)).join("")}</div></section>`;
  }

  function render() {
    let doneRender = window.startOskarsPerformance?.("periods:render");
    let allTime = periodRecords("alltime")[0];
    let centuries = periodRecords("century");
    let decades = periodRecords("decade");
    document.title = `${ui("Periods")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ classes: "periods-header", mainHtml: `<h1>${escape(ui("Periods"))}</h1><p>${escape(ui("Move through the archive one cinematic era at a time."))}</p>` })}
    ${allTime ? `<section class="period-gallery-feature" aria-label="${escape(ui("All-time"))}">${periodCard(allTime, { featured: true })}</section>` : ""}
    ${gallerySection("periodCenturyHeading", "Big picture", "Centuries", "Open a century to see its films, brackets, and watchlist together.", centuries, "period-gallery-grid--centuries")}
    ${gallerySection("periodDecadeHeading", "Era by era", "Decades", "Each deck is drawn from the strongest ranked films in that decade.", decades, "period-gallery-grid--decades")}`;
    doneRender?.();
  }

  render();
  window.addEventListener?.("oskars:localechange", render);
})();
