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
    return `<form class="rate-watched-card card" data-rate-watched-row="${escape(row.id)}">
      <div class="rate-watched-identity">
        ${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="" class="rate-watched-poster-thumb">` : ""}
        <div><h3>${escape(film.title)}</h3><p>${escape(filmMeta(film))}</p></div>
      </div>
      <label>Rating${window.renderRatingInput({ name: "rating", id: `rate-${row.id}`, required: true })}</label>
      <button type="submit">Save rating</button>
    </form>`;
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
    let year = allYears.includes(requested) ? requested : openYears[0] || allYears[0];
    let queue = grouped.get(year) || [];
    let unratedCount = [...grouped.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    let ratedCount = all.length - unratedCount;

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

    let body = queue.length
      ? `<section><h2>${escape(year)} · ${escape(queue.length)} unrated</h2><div class="rate-watched-grid">${queue.map(renderCard).join("")}</div></section>`
      : `<section class="detail-empty"><h2>${escape(year)} is fully rated</h2></section>`;

    container.innerHTML = `${header}
      <section class="rate-watched-progress card"><div><b>${escape(ratedCount)}</b> / ${escape(all.length)} rated</div><progress value="${escape(ratedCount)}" max="${escape(all.length || 1)}"></progress></section>
      <label>Release year<select data-rate-watched-year>${yearOptions}</select></label>
      ${body}`;
    window.enhanceRatingInputs?.(container);
    finish?.(`${unratedCount} unrated, ${year}, ${queue.length} shown`);
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
      await window.setSupabaseWatchedRating(
        form.dataset.rateWatchedRow,
        parsed.value,
        parsed.modifier,
      );
      render();
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
