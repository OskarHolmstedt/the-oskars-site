/** @file Controls the Supabase-backed watched-film Intake queue and guided lifecycle. */

(function () {
  let container = document.getElementById("intakePage");
  let escape = window.pageEscape;
  let workflows = [];
  let selected = null;
  let rankingGuide = null;
  let awardGuide = null;
  let busy = false;
  let RANKING_LEVELS = ["year", "decade", "century", "allTime"];
  let AWARD_LEVELS = ["year", "decade", "century", "allTime"];

  function labelLevel(level) {
    return level === "allTime"
      ? "All-time"
      : `${level.slice(0, 1).toUpperCase()}${level.slice(1)}`;
  }

  function workflowFilm(workflow) {
    return workflow?.watched?.films || {};
  }

  function workflowUrl(id) {
    return `intake.html?intake=${encodeURIComponent(id)}`;
  }

  function replaceWorkflow(updated) {
    let index = workflows.findIndex((workflow) => workflow.id === updated.id);
    if (index >= 0) workflows[index] = updated;
    else workflows.unshift(updated);
    selected = updated;
  }

  function stepStatuses(workflow) {
    return [
      workflow.steps.rating.status,
      workflow.steps.ranking.status,
      ...AWARD_LEVELS.map((level) => workflow.steps.awards[level].status),
    ];
  }

  function progressMeter(workflow) {
    let statuses = stepStatuses(workflow);
    let completed = statuses.filter((status) => status === "complete").length;
    return `<section class="intake-progress card"><div><b>${escape(completed)}</b> / ${escape(statuses.length)} steps complete</div><progress value="${escape(completed)}" max="${escape(statuses.length)}"></progress></section>`;
  }

  function stepList(workflow) {
    let rows = [
      ["Rating and viewing facts", workflow.steps.rating.status],
      ["Progressive ranking", workflow.steps.ranking.status],
      ...AWARD_LEVELS.map((level) => [
        `${labelLevel(level)} awards`,
        workflow.steps.awards[level].status,
      ]),
    ];
    return `<ol class="edit-log-change-list">${rows
      .map(
        ([label, status]) =>
          `<li><strong>${escape(label)}</strong><span>${escape(status === "complete" ? "Complete" : "Pending")}</span></li>`,
      )
      .join("")}</ol>`;
  }

  function freshForm() {
    return `<details><summary class="button-link">Add watched film</summary>
      <form class="data-form" data-fresh-watched-film>
        <label class="data-field">Title<input name="title" required autocomplete="off" data-intake-title></label>
        <div class="intake-lookup" data-intake-lookup></div>
        <label class="data-field">Release year<input name="year" type="number" min="1888" max="2100" required data-intake-year></label>
        <label class="data-field">Director(s)<input name="director" placeholder="Comma-separated"></label>
        <input type="hidden" name="tmdbId" data-intake-tmdbid>
        <label class="data-field">Rating${window.renderRatingInput({})}</label>
        <label class="data-field">Date watched<input name="dateWatched" type="date"></label>
        <label class="data-field">Platform<input name="platform"></label>
        <label class="data-field">Views<input name="views" type="number" min="1" value="1"></label>
        <button type="submit"${busy ? " disabled" : ""}>Add and start Intake</button>
      </form>
    </details>`;
  }

  // Fresh-watched-film lookup (issue: intake film identification) - before
  // asking the user to describe a film by hand, check whether it already
  // exists (searchSupabaseFilmsByTitle - the same catalog lookup
  // custom-collections.js/projects.js already use to add an existing film),
  // and if not, look it up on TMDB (lookupTmdbMovieMetadata, the same
  // pipeline setFilmTmdbMetadata's own refresh path uses) and ask the user
  // to confirm the match before it's applied - create_fresh_watched_intake
  // already dedupes server-side by tmdb_id (or an exact title+year fallback
  // when none is set), so a confirmed match here is what lets that
  // dedup actually fire instead of quietly creating a second films row.
  let freshSearchTimer = null;

  function lookupResultsEl(form) {
    return form.querySelector("[data-intake-lookup]");
  }

  function filmLookupCardHtml(kind, id, title, year, posterUrl, tmdbId) {
    return `<button type="button" class="intake-lookup-card" data-pick-${kind}-film="${escape(id)}" data-pick-title="${escape(title)}" data-pick-year="${escape(year || "")}" data-pick-tmdbid="${escape(tmdbId || "")}">
      ${posterUrl ? `<img src="${escape(posterUrl)}" alt="">` : '<span class="intake-lookup-card-noposter" aria-hidden="true"></span>'}
      <span>${escape(title)}${year ? ` (${escape(year)})` : ""}</span>
    </button>`;
  }

  function renderLookupPicked(form, title, year, source) {
    lookupResultsEl(form).innerHTML = `<p class="data-panel-status">Using ${escape(source)}: <strong>${escape(title)}</strong>${year ? ` (${escape(year)})` : ""}. <button type="button" class="button-link" data-intake-lookup-clear>Change</button></p>`;
  }

  function applyPickedFilm(form, { id, tmdbId, title, year, director }) {
    form.querySelector('[name="title"]').value = title || "";
    form.querySelector('[name="year"]').value = year || "";
    form.querySelector("[data-intake-tmdbid]").value = tmdbId || "";
    if (director && !form.querySelector('[name="director"]').value)
      form.querySelector('[name="director"]').value = director;
    renderLookupPicked(
      form,
      title,
      year,
      id ? "existing catalog film" : "TMDB match",
    );
  }

  async function runTmdbLookup(form) {
    let title = form.querySelector('[name="title"]').value.trim();
    let year = form.querySelector("[data-intake-year]").value.trim();
    if (!title) return;
    let results = lookupResultsEl(form);
    results.innerHTML = `<p class="data-panel-status">Searching TMDB…</p>`;
    try {
      let match = await window.lookupTmdbMovieMetadata({ title, year });
      if (!match) {
        results.innerHTML = `<p class="data-panel-status">No TMDB match found for "${escape(title)}". You can still add it by hand.</p>`;
        return;
      }
      results.innerHTML = `<div class="intake-lookup-confirm">
        ${match.poster?.url ? `<img src="${escape(match.poster.url)}" alt="">` : ""}
        <div>
          <p>Is this it? <strong>${escape(match.matchedTitle || title)}</strong>${match.matchedYear ? ` (${escape(match.matchedYear)})` : ""}${match.director ? ` · ${escape(match.director)}` : ""}</p>
          <div class="data-form-actions">
            <button type="button" data-intake-lookup-confirm>Yes, this is it</button>
            <button type="button" class="button-link" data-intake-lookup-clear>No, keep typing</button>
          </div>
        </div>
      </div>`;
      results.dataset.tmdbMatch = JSON.stringify({
        tmdbId: match.tmdbId,
        title: match.matchedTitle || title,
        year: match.matchedYear || year,
        director: match.director,
      });
    } catch (err) {
      results.innerHTML = `<p class="data-panel-status">${escape(err.message || String(err))}</p>`;
    }
  }

  async function runCatalogSearch(form) {
    let title = form.querySelector('[name="title"]').value.trim();
    let results = lookupResultsEl(form);
    if (title.length < 2) {
      results.innerHTML = "";
      return;
    }
    try {
      let matches = await window.searchSupabaseFilmsByTitle(title);
      let cards = matches
        .slice(0, 6)
        .map((film) =>
          filmLookupCardHtml(
            "catalog",
            film.id,
            film.title,
            film.year,
            film.poster_url,
            film.tmdb_id,
          ),
        )
        .join("");
      results.innerHTML = `${cards ? `<p class="intake-lookup-heading">Already in the catalog?</p><div class="intake-lookup-grid">${cards}</div>` : `<p class="data-panel-status">No catalog matches for "${escape(title)}".</p>`}<button type="button" class="sort-order-button" data-intake-tmdb-search>Search TMDB instead</button>`;
    } catch (err) {
      results.innerHTML = `<p class="data-panel-status">${escape(err.message || String(err))}</p>`;
    }
  }

  function wireFreshFormLookup(form) {
    form
      .querySelector("[data-intake-title]")
      ?.addEventListener("input", () => {
        clearTimeout(freshSearchTimer);
        freshSearchTimer = setTimeout(() => runCatalogSearch(form), 250);
      });
    lookupResultsEl(form)?.addEventListener("click", (event) => {
      let catalogPick = event.target.closest("[data-pick-catalog-film]");
      let tmdbSearch = event.target.closest("[data-intake-tmdb-search]");
      let confirm = event.target.closest("[data-intake-lookup-confirm]");
      let clear = event.target.closest("[data-intake-lookup-clear]");
      if (catalogPick) {
        applyPickedFilm(form, {
          id: catalogPick.dataset.pickCatalogFilm,
          tmdbId: catalogPick.dataset.pickTmdbid || "",
          title: catalogPick.dataset.pickTitle,
          year: catalogPick.dataset.pickYear,
        });
      } else if (tmdbSearch) {
        runTmdbLookup(form);
      } else if (confirm) {
        let picked = JSON.parse(
          event.target
            .closest("[data-intake-lookup]")
            .dataset.tmdbMatch || "{}",
        );
        applyPickedFilm(form, picked);
      } else if (clear) {
        form.querySelector("[data-intake-tmdbid]").value = "";
        lookupResultsEl(form).innerHTML = "";
      }
    });
  }

  function queueHtml() {
    if (!workflows.length) return "<p>No watched-film Intakes yet.</p>";
    return workflows
      .map((workflow) => {
        let film = workflowFilm(workflow);
        return `<a class="project-membership-card" href="${escape(workflowUrl(workflow.id))}">
          <span><strong>${escape(film.title || "Unknown film")}</strong><small>${escape(workflow.source === "watchlist" ? "From watchlist" : "Fresh watched film")}</small></span>
          <span class="project-status-badge project-status-badge--${workflow.completed_at ? "open" : "active"}">${workflow.completed_at ? "Complete" : "Open"}</span>
        </a>`;
      })
      .join("");
  }

  function ratingForm(workflow) {
    let watched = workflow.watched;
    let rating = watched.rating
      ? window.renderFilmRating({
          ratingValue: Number(watched.rating),
          ratingModifier: watched.rating_modifier || "",
        })
      : "";
    return `<form class="data-form" data-intake-rating="${escape(workflow.id)}">
      <h3>Next: rating and viewing facts</h3>
      <label class="data-field">Rating${window.renderRatingInput({ value: rating, required: true })}</label>
      <label class="data-field">Date watched<input name="dateWatched" type="date" value="${escape(watched.date_watched || "")}"></label>
      <label class="data-field">Platform<input name="platform" value="${escape(watched.platform || "")}"></label>
      <label class="data-field">Views<input name="views" type="number" min="1" value="${escape(watched.views || 1)}"></label>
      <button type="submit"${busy ? " disabled" : ""}>Save rating</button>
    </form>`;
  }

  function rankingForm(workflow) {
    let level = rankingGuide.level;
    let film = workflowFilm(workflow);
    let priorIndex = RANKING_LEVELS.indexOf(level) - 1;
    let prior =
      priorIndex >= 0
        ? workflow.steps.ranking.decisions[RANKING_LEVELS[priorIndex]]
        : null;
    let gaps = window.supabaseIntakeRankingGaps(rankingGuide.candidates, prior);
    let candidateById = new Map(
      rankingGuide.candidates.map((entry) => [entry.film_id, entry]),
    );
    let options = gaps
      .map((gap) => {
        if (!gap.targetFilmId)
          return '<option value="|after">Only film in this exact-rating cohort</option>';
        let target = candidateById.get(gap.targetFilmId)?.films || {};
        return `<option value="${escape(`${gap.targetFilmId}|${gap.position}`)}">${escape(gap.position === "before" ? "Before" : "After")} ${escape(target.title || "comparison film")}</option>`;
      })
      .join("");
    let anchor = prior
      ? `<p data-intake-ranking-anchor="${escape(RANKING_LEVELS[priorIndex])}">The ${escape(labelLevel(RANKING_LEVELS[priorIndex]).toLowerCase())} decision constrains this broader placement.</p>`
      : "";
    if (!gaps.length)
      return `<section class="detail-empty"><h3>Ranking changed elsewhere</h3><p>The narrower comparison anchor is missing from this scope. Refresh or use the dedicated ranking tools before continuing.</p></section>`;
    let cards = rankingGuide.candidates
      .map(
        (entry) => `<article class="film-card intake-ranking-card">
          ${entry.films?.poster_url ? `<img src="${escape(entry.films.poster_url)}" alt="" class="rate-watched-poster-thumb">` : ""}
          <span>${escape(entry.films?.title || "Unknown film")}</span>
        </article>`,
      )
      .join("");
    return `<form class="data-form intake-ranking-board" data-intake-ranking="${escape(workflow.id)}" data-intake-ranking-level="${escape(level)}">
      <h3>Next: ${escape(labelLevel(level).toLowerCase())} ranking comparison</h3>
      <p>Place <strong>${escape(film.title)}</strong> among films with the exact same rating.</p>
      ${anchor}
      <div class="film-grid">${cards || `<article class="film-card intake-ranking-card"><span>${escape(film.title)}</span></article>`}</div>
      <label class="data-field">Placement<select name="placement">${options}</select></label>
      <button type="submit"${busy ? " disabled" : ""}>Confirm ${escape(labelLevel(level).toLowerCase())} placement</button>
    </form>`;
  }

  function nominationsHtml(nominations) {
    if (!nominations.length) return "<p>No nominees yet.</p>";
    return `<ol>${nominations
      .map(
        (nomination) =>
          `<li>${escape(nomination.placement)}. ${escape(nomination.films?.title || "Unknown film")}</li>`,
      )
      .join("")}</ol>`;
  }

  function awardForm(workflow) {
    let { level, category, loaded } = awardGuide;
    let film = workflowFilm(workflow);
    let existing = loaded.nominations.find(
      (nomination) => nomination.film_id === workflow.watched.film_id,
    );
    let alreadyHandled = existing && !window.isMultiNomineeCategory?.(category);
    let capacity = category === "Best Picture" ? 10 : 5;
    let positions = Array.from({ length: capacity }, (_, index) => index + 1)
      .map(
        (placement) =>
          `<option value="${placement}"${placement === Math.min(loaded.nominations.length + 1, capacity) ? " selected" : ""}>${placement}</option>`,
      )
      .join("");
    return `<form class="data-form intake-awards-board" data-intake-award="${escape(workflow.id)}" data-intake-award-level="${escape(level)}" data-intake-award-category="${escape(category)}">
      <h3>${escape(labelLevel(level))} awards · ${escape(category)}</h3>
      <p>Review <strong>${escape(film.title)}</strong> against the current bracket.</p>
      ${nominationsHtml(loaded.nominations)}
      ${alreadyHandled ? `<p class="data-panel-status">Already nominated at #${escape(existing.placement)}.</p>` : `<label class="data-field">Nomination placement<select name="placement">${positions}</select></label><label class="data-field">Recipient(s)<input name="recipients" placeholder="Comma-separated"></label><label class="data-field">Detail<input name="detail"></label>`}
      <div class="data-form-actions">
        <button type="submit" name="action" value="${alreadyHandled ? "keep" : "nominate"}"${busy ? " disabled" : ""}>${alreadyHandled ? "Keep nomination and continue" : "Nominate and continue"}</button>
        <button type="submit" name="action" value="skip"${busy ? " disabled" : ""}>Not nominated</button>
      </div>
    </form>`;
  }

  function nextOpenWorkflow(currentId) {
    return (
      workflows.find(
        (workflow) => workflow.id !== currentId && !workflow.completed_at,
      ) || null
    );
  }

  function guideHtml(workflow) {
    if (workflow.completed_at) {
      let next = nextOpenWorkflow(workflow.id);
      return `<section class="film-edit-section intake-complete">
        <h3><span class="project-status-badge project-status-badge--complete">✓ Complete</span> ${escape(workflowFilm(workflow).title || "This Intake")}</h3>
        <p>${escape(workflow.summary || "Rating, ranking, and awards review complete.")}</p>
        <p class="data-panel-status">${escape(workflow.completed_at)}</p>
        <div class="data-form-actions">
          ${next ? `<a class="button-link" href="${escape(workflowUrl(next.id))}">Continue to next Intake</a>` : ""}
          <a class="button-link" href="intake.html">Back to queue</a>
          <button type="button" data-intake-reopen="${escape(workflow.id)}"${busy ? " disabled" : ""}>Reopen Intake</button>
        </div>
      </section>`;
    }
    if (workflow.steps.rating.status !== "complete")
      return ratingForm(workflow);
    if (workflow.steps.ranking.status !== "complete")
      return rankingGuide
        ? rankingForm(workflow)
        : '<p class="data-panel-status">Loading ranking…</p>';
    let awardLevel = window.supabaseIntakeNextAwardLevel(workflow);
    if (awardLevel)
      return awardGuide
        ? awardForm(workflow)
        : '<p class="data-panel-status">Loading awards…</p>';
    return `<section class="film-edit-section intake-ready"><h3>Ready to complete</h3><p>Rating, four ranking scopes, and every awards category have been reviewed.</p><button type="button" data-intake-complete="${escape(workflow.id)}"${busy ? " disabled" : ""}>Complete Intake</button></section>`;
  }

  function render() {
    let finish = window.startOskarsPerformance?.("intake:render");
    container.innerHTML = `<div class="edit-log-heading"><div><h2>Watched-film Intake</h2><p>Finish rating, progressive exact-rating placement, and explicit awards review for every newly watched film.</p></div><div class="data-actions"><a class="button-link" href="build.html">Build your Oskars</a><a class="button-link" href="rate-watched.html">Rate unrated watched</a><a class="button-link" href="data.html">Open Data</a></div>${freshForm()}</div>
      <div class="project-membership-list">${queueHtml()}</div>
      ${
        selected
          ? `<section class="film-edit-section"><h3>${escape(workflowFilm(selected).title || "Unknown film")}</h3>${progressMeter(selected)}${stepList(selected)}<div class="intake-step-enter">${guideHtml(selected)}</div></section>`
          : ""
      }`;
    window.enhanceRatingInputs?.(container);
    let freshFormEl = container.querySelector("[data-fresh-watched-film]");
    if (freshFormEl) wireFreshFormLookup(freshFormEl);
    finish?.(`${workflows.length} workflow(s)`);
  }

  async function loadSelectedGuide() {
    rankingGuide = null;
    awardGuide = null;
    if (!selected || selected.completed_at) return;
    if (selected.steps.rating.status !== "complete") return;
    if (selected.steps.ranking.status !== "complete") {
      let level = window.supabaseIntakeNextRankingLevel(selected);
      let scope = window.supabaseIntakeScope(selected, level);
      let loaded = await window.loadSupabaseRanking(
        scope.scope,
        scope.scopeType,
      );
      rankingGuide = {
        level,
        scope,
        ...loaded,
        candidates: window.supabaseIntakeRankingCandidates(
          selected,
          loaded.entries,
          window.getSupabaseWorkspace()?.watched || [],
          level,
        ),
      };
      return;
    }
    let level = window.supabaseIntakeNextAwardLevel(selected);
    if (!level) return;
    let categories = window.getOrderedCategories();
    let category = window.supabaseIntakeNextAwardCategory(
      selected,
      level,
      categories,
    );
    let scope = window.supabaseIntakeScope(selected, level);
    let loaded = await window.loadSupabasePersonalNominations(
      scope.scope,
      category,
      scope.scopeType,
    );
    awardGuide = { level, category, categories, scope, loaded };
  }

  async function refreshAfter(updated) {
    replaceWorkflow(updated);
    await loadSelectedGuide();
    render();
  }

  function parsedForm(form) {
    let values = Object.fromEntries(new FormData(form).entries());
    let parsed = window.parseFilmRating(values.rating);
    values.rating = parsed.value || "";
    values.ratingModifier = parsed.modifier;
    return values;
  }

  container.addEventListener("submit", async (event) => {
    let fresh = event.target.closest("[data-fresh-watched-film]");
    let rating = event.target.closest("[data-intake-rating]");
    let ranking = event.target.closest("[data-intake-ranking]");
    let award = event.target.closest("[data-intake-award]");
    if (!fresh && !rating && !ranking && !award) return;
    event.preventDefault();
    if (busy) return;
    busy = true;
    render();
    try {
      if (fresh) {
        let values = parsedForm(fresh);
        let created = await window.createSupabaseFreshWatchedIntake(values);
        workflows.unshift(created);
        selected = created;
        history.replaceState(null, "", workflowUrl(created.id));
        await loadSelectedGuide();
      } else if (rating) {
        let values = parsedForm(rating);
        if (!values.rating) throw new Error("Choose a rating before saving.");
        let watched = await window.setSupabaseIntakeWatchedFacts(
          selected.watched,
          values,
        );
        selected.watched = watched;
        let steps = JSON.parse(JSON.stringify(selected.steps));
        steps.rating.status = "complete";
        await refreshAfter(
          await window.updateSupabaseIntakeWorkflow(selected, { steps }),
        );
      } else if (ranking) {
        let [targetFilmId, position] = String(
          new FormData(ranking).get("placement"),
        ).split("|");
        let placementTargetFilmId = targetFilmId;
        let placementPosition = position;
        if (!placementTargetFilmId) {
          let watchedByFilm = new Map(
            (window.getSupabaseWorkspace()?.watched || []).map((row) => [
              row.film_id,
              row,
            ]),
          );
          let targetGrade = window.supabaseIntakeRatingGrade(selected.watched);
          let firstLower = rankingGuide.entries.find(
            (entry) =>
              window.supabaseIntakeRatingGrade(
                watchedByFilm.get(entry.film_id),
              ) < targetGrade,
          );
          if (firstLower) {
            placementTargetFilmId = firstLower.film_id;
            placementPosition = "before";
          } else if (rankingGuide.entries.length) {
            placementTargetFilmId =
              rankingGuide.entries[rankingGuide.entries.length - 1].film_id;
            placementPosition = "after";
          }
        }
        await window.placeSupabaseIntakeRankingFilm(
          rankingGuide.rankingId,
          rankingGuide.entries,
          selected.watched.film_id,
          placementTargetFilmId || null,
          placementPosition,
        );
        let steps = window.supabaseIntakeRecordRanking(
          selected.steps,
          rankingGuide.level,
          { targetFilmId: targetFilmId || null, position },
        );
        await refreshAfter(
          await window.updateSupabaseIntakeWorkflow(selected, { steps }),
        );
      } else {
        let values = Object.fromEntries(new FormData(award).entries());
        let action = values.action === "skip" ? "skip" : "nominate";
        if (values.action === "nominate") {
          await window.insertSupabasePersonalNomination(
            awardGuide.loaded.personalAwardId,
            awardGuide.category,
            Number(values.placement),
            awardGuide.category === "Best Picture" ? 10 : 5,
            selected.watched.film_id,
            values.detail || "",
            String(values.recipients || "")
              .split(",")
              .map((name) => name.trim())
              .filter(Boolean),
          );
        }
        if (awardGuide.level === "year") {
          let hasNominees =
            awardGuide.loaded.nominations.length > 0 || action === "nominate";
          await window.setSupabaseAwardReview(
            awardGuide.scope.scope,
            awardGuide.category,
            hasNominees ? "complete" : "none",
          );
        }
        let steps = window.supabaseIntakeRecordAward(
          selected.steps,
          awardGuide.level,
          awardGuide.category,
          action,
          awardGuide.categories,
        );
        await refreshAfter(
          await window.updateSupabaseIntakeWorkflow(selected, { steps }),
        );
      }
    } catch (error) {
      alert(error.message || String(error));
    } finally {
      busy = false;
      render();
    }
  });

  container.addEventListener("click", async (event) => {
    let complete = event.target.closest("[data-intake-complete]");
    let reopen = event.target.closest("[data-intake-reopen]");
    if ((!complete && !reopen) || busy) return;
    busy = true;
    render();
    try {
      if (complete) {
        if (!window.supabaseIntakeReadyToComplete(selected))
          throw new Error("Finish every Intake step before completing it.");
        await refreshAfter(
          await window.updateSupabaseIntakeWorkflow(selected, {
            completed_at: new Date().toISOString(),
            summary:
              "Rating, progressive ranking, and four-level awards review complete.",
          }),
        );
      } else {
        await refreshAfter(
          await window.updateSupabaseIntakeWorkflow(selected, {
            completed_at: null,
          }),
        );
      }
    } catch (error) {
      alert(error.message || String(error));
    } finally {
      busy = false;
      render();
    }
  });

  function renderHeaderAuthStatus(user) {
    let status = document.querySelector("[data-auth-status]");
    if (!status) return;
    window.renderSignedInHeaderAccount?.(
      status,
      user,
      user.email || "Signed in",
    );
    status
      .querySelector("[data-supabase-sign-out]")
      ?.addEventListener("click", async () => {
        await window.signOutOfSupabase?.();
        window.location.reload();
      });
  }

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    renderHeaderAuthStatus(access.user);
    try {
      await window.loadSupabaseWorkspace();
      workflows = await window.loadSupabaseIntakeWorkflows();
      let requested = window.pageQueryParam?.("intake") || "";
      selected =
        workflows.find((workflow) => workflow.id === requested) ||
        workflows.find((workflow) => !workflow.completed_at) ||
        workflows[0] ||
        null;
      await loadSelectedGuide();
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load watched-film Intake</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
