/**
 * @file Rate watched, cut over to Supabase for real (issue #420) - the
 * first real, reachable page running on the backend built out across
 * #395's epic, replacing the old Firebase/window.state-backed version.
 * Adapted directly from the proven proof of concept (#414,
 * rate-watched-supabase.js): gate check -> loadSupabaseWorkspace() ->
 * render -> submit calls setSupabaseWatchedRating() directly. No
 * save() step - every Supabase write is already durable, unlike the
 * old two-step "mutate window.state, then call save()" flow.
 *
 * Deliberately simpler than the version this replaces (no Focus mode,
 * no keyboard shortcuts, no poster-deck strip) - #420 proves the
 * cutover works, not full feature parity; those can come back later
 * once more of the app is on Supabase and it's clear which are worth
 * rebuilding.
 *
 * entry-loader.js doesn't load firebase-client.js for this entry at
 * all (see supabaseBackedEntries there), so site-header.js's Firebase
 * auth widget renders its [data-auth-status] container empty rather
 * than erroring (all four of its Firebase calls are optionally-
 * chained). This controller injects its own status/sign-out into that
 * same container once signed in, rather than making site-header.js
 * itself backend-aware.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("rateWatchedPage");
  let activeYear = null; // the year render() last drew the queue for

  function pageUrl(year) {
    return year
      ? `rate-watched.html?year=${encodeURIComponent(year)}`
      : "rate-watched.html";
  }

  function filmMeta(film) {
    return [film.director, film.medium, film.type].filter(Boolean).join(" · ");
  }

  function renderCard(row) {
    let film = row.films;
    // Reuses the same sized, aspect-ratio-constrained poster component every
    // browse grid already uses (film-poster--card) instead of a bare <img>
    // with no width/height at all - that rendered each poster at its full
    // natural resolution (found live: two loaded posters at 500x750px
    // overlapping the whole grid) rather than fit to the card.
    let poster = film.poster_url
      ? window.renderFilmPoster(
          { title: film.title, poster: { url: film.poster_url } },
          "card",
        )
      : "";
    return `<form class="rate-watched-card film-card" data-rate-watched-row="${escape(row.id)}">
      ${poster}
      <div class="rate-watched-identity">
        <h3>${escape(film.title)}</h3>
        <p>${escape(filmMeta(film))}</p>
      </div>
      <div class="rate-watched-rating-row">
        ${window.renderRatingInput({ name: "rating", id: `rate-${row.id}`, required: true, compact: true })}
        <button type="submit" class="rate-watched-save" aria-label="Save rating" title="Save rating">✓</button>
      </div>
    </form>`;
  }

  // Exact 1-30 grade (rating expanded by its minus/plus refinement) - the
  // same scale supabaseIntakeRatingGrade() already sorts Intake's rating
  // shelves by, reused here so the Rated section orders identically.
  function ratedGrade(row) {
    return window.supabaseIntakeRatingGrade?.(row) || 0;
  }

  function renderRatedEntry(row) {
    let film = row.films;
    let href = window.filmPageUrl?.(row.film_id) || "#";
    let poster = film.poster_url
      ? window.renderFilmPoster(
          { title: film.title, poster: { url: film.poster_url } },
          "thumb",
        )
      : "";
    let stars =
      window.renderFilmRating?.({
        ratingValue: row.rating,
        ratingModifier: row.rating_modifier,
      }) || "";
    return `<li class="rate-watched-rated-item" data-grade="${ratedGrade(row)}">
      <a href="${escape(href)}" class="rate-watched-rated-poster">${poster}</a>
      <a href="${escape(href)}" class="rate-watched-rated-title">${escape(film.title)}</a>
      <span class="rate-watched-rated-stars">${stars}</span>
    </li>`;
  }

  function render() {
    let finish = window.startOskarsPerformance?.("rateWatched:render");
    let all = window.watchedFilmsForSupabaseRating();
    let grouped = window.unratedSupabaseWatchedFilmsByYear();
    let allYears = [...new Set(all.map((row) => row.films.year))].sort(
      (left, right) => left - right,
    );
    let openYears = [...grouped.keys()].sort((left, right) => left - right);
    let requested = Number(window.pageQueryParam("year"));
    let year = allYears.includes(requested)
      ? requested
      : openYears[0] || allYears[0];
    let queue = grouped.get(year) || [];
    let unratedCount = [...grouped.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    let ratedCount = all.length - unratedCount;
    // Best first, so a still-unrated film can be placed by eye against
    // the ones already rated this year.
    let ratedForYear = all
      .filter((row) => row.films.year === year && row.rating)
      .sort((left, right) => ratedGrade(right) - ratedGrade(left));

    let header = window.renderDetailHeader({
      mainHtml:
        "<h1>Rate watched</h1><p>Give unrated watched films a rating, one release year at a time.</p>",
    });

    if (!all.length || (!unratedCount && !requested)) {
      container.innerHTML = `${header}<section class="detail-empty"><h2>Nothing to rate</h2><p>${all.length ? "Everything watched is rated." : "No watched films found for this account."}</p></section>`;
      finish?.(`${all.length} watched, complete`);
      return;
    }

    let yearOptions = allYears
      .map(
        (value) =>
          `<option value="${escape(value)}"${value === year ? " selected" : ""}>${escape(value)} · ${(grouped.get(value) || []).length}</option>`,
      )
      .join("");
    let yearIndex = allYears.indexOf(year);
    let prevYear = yearIndex > 0 ? allYears[yearIndex - 1] : null;
    let nextYear =
      yearIndex >= 0 && yearIndex < allYears.length - 1
        ? allYears[yearIndex + 1]
        : null;
    let yearArrow = (targetYear, glyph, label) =>
      targetYear
        ? `<a class="rate-watched-year-arrow" href="${escape(pageUrl(targetYear))}" aria-label="${escape(label)} (${escape(targetYear)})">${glyph}</a>`
        : `<span class="rate-watched-year-arrow is-disabled" aria-hidden="true">${glyph}</span>`;

    let unratedBody = queue.length
      ? `<section><h2>${escape(year)} · ${escape(queue.length)} unrated</h2><div class="rate-watched-grid">${queue.map(renderCard).join("")}</div></section>`
      : `<section class="detail-empty"><h2>${escape(year)} is fully rated</h2></section>`;
    let ratedBody = ratedForYear.length
      ? `<section class="rate-watched-rated-section"><h2>${escape(year)} · Rated</h2><ol class="rate-watched-rated-list">${ratedForYear.map(renderRatedEntry).join("")}</ol></section>`
      : "";

    container.innerHTML = `${header}
      <section class="rate-watched-progress card"><div><b>${escape(ratedCount)}</b> / ${escape(all.length)} rated</div><progress value="${escape(ratedCount)}" max="${escape(all.length || 1)}"></progress></section>
      <div class="rate-watched-year-nav">
        ${yearArrow(prevYear, "‹", "Previous year")}
        <label>Release year<select data-rate-watched-year>${yearOptions}</select></label>
        ${yearArrow(nextYear, "›", "Next year")}
      </div>
      ${unratedBody}
      ${ratedBody}`;
    window.enhanceRatingInputs?.(container);
    activeYear = year;
    finish?.(`${unratedCount} unrated, ${year}, ${queue.length} shown`);
  }

  // Inserts one freshly-rated film into the already-rendered Rated list
  // at its correctly sorted position, without touching anything else in
  // the DOM - a poster-reload-and-scroll-jump was found live from a full
  // render() on every single rating (see removeRatedCard below); the
  // Rated section deserves the same treatment now that it exists too.
  function insertRatedEntry(ratedList, row) {
    let grade = ratedGrade(row);
    let template = document.createElement("template");
    template.innerHTML = renderRatedEntry(row).trim();
    let node = template.content.firstElementChild;
    let before = Array.from(ratedList.children).find(
      (item) => Number(item.dataset.grade) < grade,
    );
    if (before) ratedList.insertBefore(node, before);
    else ratedList.appendChild(node);
  }

  // Removes just the one card that was rated, in place, instead of
  // calling render() (which rebuilds the whole grid from scratch - found
  // live to reload every remaining poster and jump scroll position back
  // to the top on every single rating). Falls back to a full render()
  // once the current year's queue actually empties, or the Rated section
  // doesn't exist in the DOM yet (its first entry is a real layout
  // change render() already knows how to draw).
  function removeRatedCard(form, updatedRow) {
    let all = window.watchedFilmsForSupabaseRating();
    let grouped = window.unratedSupabaseWatchedFilmsByYear();
    let unratedCount = [...grouped.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    let ratedCount = all.length - unratedCount;
    let queue = grouped.get(activeYear) || [];
    let ratedList = container.querySelector(".rate-watched-rated-list");

    if (!queue.length || !ratedList) {
      render();
      return;
    }

    form.remove();

    let progressSection = container.querySelector(".rate-watched-progress");
    if (progressSection) {
      progressSection.querySelector("b").textContent = ratedCount;
      progressSection.querySelector("progress").value = ratedCount;
    }
    let yearHeading = container.querySelector(
      ".rate-watched-grid",
    )?.parentElement?.querySelector("h2");
    if (yearHeading)
      yearHeading.textContent = `${activeYear} · ${queue.length} unrated`;
    let yearOption = container.querySelector(
      `[data-rate-watched-year] option[value="${activeYear}"]`,
    );
    if (yearOption) yearOption.textContent = `${activeYear} · ${queue.length}`;

    if (updatedRow) insertRatedEntry(ratedList, updatedRow);
  }

  function renderHeaderAuthStatus(user) {
    let statusContainer = document.querySelector("[data-auth-status]");
    if (!statusContainer) return;
    window.renderSignedInHeaderAccount?.(
      statusContainer,
      user,
      user.email || "Signed in",
    );
    statusContainer
      .querySelector("[data-supabase-sign-out]")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
      });
  }

  container.addEventListener("change", (event) => {
    let select = event.target.closest("[data-rate-watched-year]");
    if (select) window.location.href = pageUrl(select.value);
  });

  container.addEventListener("submit", async (event) => {
    let form = event.target.closest("[data-rate-watched-row]");
    if (!form) return;
    event.preventDefault();
    let button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      let values = new FormData(form);
      let parsed = window.parseFilmRating(values.get("rating"));
      if (!parsed.value) throw new Error("Choose a rating before saving.");
      let updated = await window.setSupabaseWatchedRating(
        form.dataset.rateWatchedRow,
        parsed.value,
        parsed.modifier,
      );
      removeRatedCard(form, updated);
    } catch (error) {
      button.disabled = false;
      alert(error.message || String(error));
    }
  });

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    renderHeaderAuthStatus(access.user);
    // Found running this for real: a transient network error here (or
    // in render()) left <main> stuck showing the gate's "loading..."
    // placeholder forever, with no visible error at all - the gate
    // itself already handles its own errors correctly (#413's fixes),
    // but nothing downstream of a successful gate did. Genuine errors
    // must surface, not disappear behind stale placeholder text.
    try {
      await window.loadSupabaseWorkspace();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load your watched films</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
