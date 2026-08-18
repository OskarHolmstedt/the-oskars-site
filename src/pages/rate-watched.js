/** @file Guides exact personal rating through a focused poster-first deck or batch grid. */

(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("rateWatchedPage");
  let lastChange = null;
  window.load();

  function pageUrl(year, mode = currentMode()) {
    let params = [];
    if (year) params.push(`year=${encodeURIComponent(year)}`);
    if (mode === "grid") params.push("mode=grid");
    return `rate-watched.html${params.length ? `?${params.join("&")}` : ""}`;
  }

  function currentMode() {
    return window.pageQueryParam("mode") === "grid" ? "grid" : "focus";
  }

  function replaceUrl(year) {
    window.history?.replaceState?.(null, "", pageUrl(year));
  }

  function filmTitle(film) {
    return window.localizedFilmTitle?.(film) || film.title;
  }

  function isStandalone(film) {
    return Boolean(window.findWatchedFilmById?.(film.id));
  }

  function filmMeta(film) {
    let director = film.director || (film.directors || []).join(", ");
    return [director, isStandalone(film) ? film.type || ui("Other") : ""]
      .filter(Boolean)
      .join(" · ");
  }

  function renderBatchForm(film) {
    return `<form class="rate-watched-card card" data-rate-watched-film="${escape(film.id)}">
      <div class="rate-watched-identity">${window.renderFilmPoster(film, "thumb")}<div><h3><a href="${escape(window.filmPageUrl(film.id))}">${escape(filmTitle(film))}</a></h3><p>${escape(filmMeta(film))}</p></div></div>
      <label>${escape(ui("Rating"))}${window.renderRatingInput({ name: "rating", id: `rate-${film.id}`, required: true })}</label>
      <button type="submit">${escape(ui("Save rating"))}</button>
    </form>`;
  }

  function renderPoster(film) {
    let poster = window.renderFilmPoster(film, "detail");
    return poster || `<div class="rate-focused-poster-placeholder" aria-hidden="true"><span>${escape(String(filmTitle(film)).slice(0, 1).toUpperCase())}</span></div>`;
  }

  function renderDeckStrip(yearFilms, current) {
    let currentIndex = yearFilms.findIndex((film) => film.id === current.id);
    let start = Math.max(0, Math.min(currentIndex - 2, yearFilms.length - 5));
    return `<div class="rate-focused-strip" aria-label="${escape(ui("Films in this year"))}">${yearFilms.slice(start, start + 5).map((film) => {
      let poster = window.normalizePosterRecord?.(film.poster);
      return `<span class="rate-focused-strip-card${film.id === current.id ? " is-current" : ""}${window.filmRatingGrade(film) ? " is-rated" : ""}" title="${escape(filmTitle(film))}">${poster ? `<img src="${escape(poster.url)}" alt="">` : `<b>${escape(String(filmTitle(film)).slice(0, 1).toUpperCase())}</b>`}</span>`;
    }).join("")}</div>`;
  }

  function renderFocused(queue, yearFilms, year) {
    let film = queue[0];
    return `<section class="rate-focused" data-rate-focused>
      <div class="rate-focused-stage">
        <div class="rate-focused-poster">${renderPoster(film)}</div>
        <form class="rate-focused-form" data-rate-watched-film="${escape(film.id)}">
          ${isStandalone(film) ? `<span class="rate-focused-type">${escape(film.type || ui("Other"))} · ${escape(ui("Rating only"))}</span>` : ""}
          <h2><a href="${escape(window.filmPageUrl(film.id))}">${escape(filmTitle(film))}</a></h2>
          <p>${escape(filmMeta(film))}</p>
          <label>${escape(ui("Your rating"))}${window.renderRatingInput({ name: "rating", id: "focused-rating", required: true })}</label>
          <p class="rate-focused-shortcuts">${escape(ui("Keys 1–5 set whole stars · − / . / + choose the shade · Enter saves"))}</p>
          <div class="rate-focused-actions"><button type="submit">${escape(ui("Save & next"))} →</button>${lastChange ? `<button type="button" class="button-secondary" data-rate-undo>${escape(ui("Undo last rating"))}</button>` : ""}</div>
        </form>
      </div>
      ${renderDeckStrip(yearFilms, film)}
      <p class="rate-focused-position">${escape(ui("{current} of {total} left in {year}", { current: 1, total: queue.length, year }))}</p>
    </section>`;
  }

  function renderYearRecap(year, yearFilms, archiveFilms, allComplete) {
    let top = [...yearFilms]
      .filter((film) => window.filmRatingGrade(film))
      .sort(
        (left, right) =>
          window.filmRatingGrade(right) - window.filmRatingGrade(left) ||
          window.compareEnglishTitles(left.title, right.title),
      )
      .slice(0, 5);
    return `<section class="rate-year-recap rate-watched-complete">
      <span class="eyebrow">${escape(ui("Year rated"))}</span><h2>${escape(year)} ${escape(ui("is ready"))}</h2>
      <p>${escape(ui("You rated all {count} watched work(s) from this year.", { count: yearFilms.length }))}</p>
      <div class="rate-year-recap-posters">${window.renderPosterDeck(top, { classes: "poster-deck--featured" })}</div>
      <div class="rate-year-recap-actions">${archiveFilms.length ? `<a class="button-link" href="${escape(window.yearRankingPageUrl(year))}">${escape(ui("Rank this year"))} →</a>` : ""}<a class="button-link" href="build.html">${escape(ui(allComplete ? "Return to Build your Oskars" : "Choose another year"))}</a>${lastChange ? `<button type="button" class="button-secondary" data-rate-undo>${escape(ui("Undo last rating"))}</button>` : ""}</div>
    </section>`;
  }

  function render() {
    let finish = window.startOskarsPerformance?.("rateWatched:render");
    let all = window.watchedFilmsForRating();
    let grouped = window.unratedWatchedFilmsByYear();
    let allYears = [...new Set(all.map((film) => String(film.year)))].sort(
      (left, right) => Number(left) - Number(right),
    );
    let openYears = [...grouped.keys()].sort((left, right) => Number(left) - Number(right));
    let requested = window.pageQueryParam("year");
    let year = allYears.includes(requested) ? requested : openYears[0] || allYears[0] || "";
    let yearFilms = all.filter((film) => String(film.year) === year).sort((left, right) => window.compareEnglishTitles(left.title, right.title));
    let archiveFilms = yearFilms.filter((film) => !isStandalone(film));
    let queue = grouped.get(year) || [];
    let unratedCount = [...grouped.values()].reduce((sum, films) => sum + films.length, 0);
    let ratedCount = all.length - unratedCount;
    let yearIndex = openYears.indexOf(year);
    let previous = yearIndex > 0 ? openYears[yearIndex - 1] : "";
    let next = yearIndex >= 0 && yearIndex + 1 < openYears.length ? openYears[yearIndex + 1] : "";
    let mode = currentMode();
    if (year) replaceUrl(year);
    document.title = `${ui("Rate watched")} · The Oskars`;
    let header = window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Rate watched"))}</h1><p>${escape(ui("Give unrated watched entries their exact personal rating, one release year at a time."))}</p>`,
      actionsHtml: `<a class="button-link" href="build.html">${escape(ui("Back to Build your Oskars"))}</a><a class="button-link" href="intake.html">${escape(ui("Back to Intake"))}</a>`,
    });
    if (!all.length || (!unratedCount && !requested)) {
      container.innerHTML = `${header}<section class="detail-empty rate-watched-complete"><h2>${escape(ui("Everything watched is rated"))}</h2><p>${escape(ui("There are no unrated watched entries with a release year."))}</p></section>`;
      finish?.(`${all.length} watched, complete`);
      return;
    }
    let yearOptions = allYears.map((value) => `<option value="${escape(value)}"${value === year ? " selected" : ""}>${escape(value)} · ${(grouped.get(value) || []).length}</option>`).join("");
    let modeToggle = `<nav class="rate-mode-toggle" aria-label="${escape(ui("Rating mode"))}"><a href="${escape(pageUrl(year, "focus"))}"${mode === "focus" ? ' class="active" aria-current="page"' : ""}>${escape(ui("Focus"))}</a><a href="${escape(pageUrl(year, "grid"))}"${mode === "grid" ? ' class="active" aria-current="page"' : ""}>${escape(ui("Grid"))}</a></nav>`;
    let body = !queue.length
      ? renderYearRecap(year, yearFilms, archiveFilms, !unratedCount)
      : mode === "grid"
        ? `<section><h2>${escape(year)} · ${escape(ui("{count} unrated", { count: queue.length }))}</h2><div class="rate-watched-grid">${queue.map(renderBatchForm).join("")}</div></section>`
        : renderFocused(queue, yearFilms, year);
    container.innerHTML = `${header}
      <section class="rate-watched-progress card"><div><b>${escape(ratedCount)}</b> / ${escape(all.length)} ${escape(ui("rated"))}</div><progress value="${escape(ratedCount)}" max="${escape(all.length || 1)}"></progress><span>${escape(ui("{count} remaining", { count: unratedCount }))}</span></section>
      <div class="rate-watched-controls"><nav class="rate-watched-year-nav" aria-label="${escape(ui("Unrated years"))}">${previous ? `<a class="button-link" href="${escape(pageUrl(previous))}">← ${escape(previous)}</a>` : `<span></span>`}<label>${escape(ui("Release year"))}<select data-rate-watched-year>${yearOptions}</select></label>${next ? `<a class="button-link" href="${escape(pageUrl(next))}">${escape(next)} →</a>` : `<span></span>`}</nav>${queue.length ? modeToggle : ""}</div>${body}`;
    window.enhanceRatingInputs?.(container);
    if (mode === "focus") container.querySelector(".rating-input-text")?.focus();
    finish?.(`${unratedCount} unrated, ${year}, ${queue.length} shown, ${mode}`);
  }

  async function persistAndRender() {
    await window.save?.({ immediate: true });
    render();
  }

  container.addEventListener("change", (event) => {
    let select = event.target.closest("[data-rate-watched-year]");
    if (select) window.location.href = pageUrl(select.value);
  });

  container.addEventListener("submit", async (event) => {
    let form = event.target.closest("[data-rate-watched-film]");
    if (!form) return;
    event.preventDefault();
    let button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let film = window.findFilmById?.(form.dataset.rateWatchedFilm) || window.findWatchedFilmById?.(form.dataset.rateWatchedFilm);
      let before = film?.rating || "";
      let values = new FormData(form);
      let updated = window.setWatchedFilmRating(form.dataset.rateWatchedFilm, values.get("rating"), { save: false });
      lastChange = { filmId: updated.id, rating: before };
      await persistAndRender();
    } catch (error) {
      button.disabled = false;
      alert(error.message || String(error));
    }
  });

  container.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-rate-undo]") || !lastChange) return;
    window.restoreWatchedFilmRating(lastChange.filmId, lastChange.rating, { save: false });
    lastChange = null;
    await persistAndRender();
  });

  container.addEventListener("keydown", (event) => {
    let form = event.target.closest(".rate-focused-form");
    if (!form || event.metaKey || event.ctrlKey || event.altKey) return;
    let input = form.querySelector('.rating-input-text');
    let parsed = window.parseFilmRating(input.value);
    if (/^[1-5]$/.test(event.key)) {
      event.preventDefault();
      input.value = window.renderFilmRating({ ratingValue: Number(event.key), ratingModifier: parsed.modifier });
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (["-", ".", "+"].includes(event.key) && parsed.value) {
      event.preventDefault();
      let modifier = event.key === "-" ? "minus" : event.key === "." ? "dot" : "plus";
      input.value = window.renderFilmRating({ ratingValue: parsed.value, ratingModifier: modifier });
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (event.key === "Enter" && event.target === input) {
      event.preventDefault();
      form.requestSubmit?.();
    }
  });

  render();
})();
