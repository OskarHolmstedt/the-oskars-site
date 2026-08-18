/** @file Controls watchlist-film detail, archive-match review, poster selection, metadata, and editing. */

(function () {
  let escape = window.pageEscape;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));

  window.load();

  let itemId = window.pageQueryParam("id");
  let container = document.getElementById("watchlistFilmPage");
  let posterOptions = [];
  let posterOptionIndex = 0;
  let posterPickerStatus = "";
  let openTransitionOnLoad = window.pageQueryParam("action") === "watched";

  function currentPosterOptionIndex(item) {
    let currentUrl = String(item?.poster?.url || "");
    let index = posterOptions.findIndex((poster) => poster.url === currentUrl);
    return index >= 0
      ? index
      : Math.max(0, Math.min(posterOptionIndex, posterOptions.length - 1));
  }

  function selectPosterOption(index) {
    if (!posterOptions.length) return;
    posterOptionIndex = (index + posterOptions.length) % posterOptions.length;
    window.setWatchlistPoster(itemId, posterOptions[posterOptionIndex]);
    posterPickerStatus = "";
    render();
    container.querySelector("[data-film-poster-picker]")?.focus();
  }

  function metadataRow(label, value, href) {
    if (!value) return "";
    return `<div><dt>${escape(label)}</dt><dd>${
      href
        ? `<a class="period-link" href="${escape(href)}"${/^https?:\/\//i.test(String(href)) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escape(value)}</a>`
        : escape(value)
    }</dd></div>`;
  }

  function metadataLabel(value) {
    let text = String(value || "").replace(/-/g, " ");
    return text ? ui(text[0].toUpperCase() + text.slice(1)) : "";
  }

  function formatRuntime(minutes) {
    let runtime = Number(minutes);
    if (!Number.isInteger(runtime) || runtime <= 0) return "";
    let hours = Math.floor(runtime / 60);
    let remainder = runtime % 60;
    return hours
      ? `${hours}h ${remainder ? `${remainder}m` : ""}`.trim()
      : `${runtime}m`;
  }

  function tierOptions(selected) {
    return `<option value="">${escape(ui("Unranked"))}</option>${window.WATCHLIST_TIERS.map(
      (tier) =>
        `<option value="${escape(tier)}" ${window.normalizeWatchlistTier(selected) === tier ? "selected" : ""}>${escape(tier)}</option>`,
    ).join("")}`;
  }

  function renderArchiveMatchReview(item) {
    let candidates =
      window.watchlistArchiveMatchCandidates?.(item, { limit: 5 }) || [];
    if (!candidates.length) return "";
    let rows = candidates
      .map((entry) => {
        let film = entry.film;
        return `<tr><td><span class="match-confidence match-confidence--${escape(entry.confidence)}">${escape(ui(entry.confidence === "exact" ? "Exact" : "Possible"))}</span><span class="leaderboard-meta">${escape(ui(entry.reason))}</span></td><td class="film-table-cell">${window.renderFilmPoster(film, "thumb")}<span><a class="table-film-link" href="${escape(window.filmPageUrl(film.id))}"><strong>${escape(window.localizedFilmTitle?.(film) || film.title)}</strong></a><span class="leaderboard-meta">${escape(film.year || "")}${film.director ? ` · ${escape(film.director)}` : ""}${film.rating ? ` · ${escape(film.rating)}` : ""}</span></span></td></tr>`;
      })
      .join("");
    let table = window.renderLeaderboardTable({
      headers: [ui("Confidence"), ui("Film")].map(escape),
      rows,
    });
    return `<section class="archive-match-review"><h2>${escape(ui("Archive match review"))}</h2><p>${escape(ui("Possible archive matches are shown for review only."))}</p>${table}</section>`;
  }

  function transitionTargetText(plan) {
    return plan.target.type === "archive"
      ? ui("the existing archive film")
      : plan.watchedBefore
        ? ui("the existing watched film")
        : ui("a new watched film");
  }

  function renderWatchedForm() {
    let item = window.findWatchlistItemById(itemId);
    if (!item) return render();
    document.title = `${ui("Mark {title} as watched", { title: item.title })} · The Oskars`;
    container.innerHTML = `<form id="markWatchlistWatchedForm" class="film-edit-form">
      ${window.renderDetailHeader({ mainHtml: `<h1>${escape(ui("Mark {title} as watched", { title: item.title }))}</h1><p>${escape(ui("Add known viewing facts, then confirm."))}</p>`, actionsHtml: `<button type="submit">${escape(ui("Mark as watched"))}</button><button type="button" data-cancel-watchlist-transition>${escape(ui("Cancel"))}</button>` })}
      <section class="film-edit-section"><h2>${escape(ui("Viewing facts"))}</h2><div class="film-edit-grid">
        <label>${escape(ui("Rating"))} ${window.renderRatingInput({})}</label>
        <label>${escape(ui("Date watched"))} <input name="dateWatched" type="date"></label>
        <label>${escape(ui("Platform"))} <input name="platform" value="${escape(item.platform || "")}"></label>
        <label>${escape(ui("Views"))} <input name="views" type="number" min="1" step="1" value="1"></label>
      </div></section>
      <p>${escape(ui("Any unfinished rating, ranking, and awards work will remain in the intake queue."))}</p>
    </form>`;
    window.enhanceRatingInputs?.(container);
  }

  function render() {
    let finishRenderTimer = window.startOskarsPerformance?.(
      "watchlistFilm:render",
    );
    let item = window.findWatchlistItemById(itemId);
    if (!item) {
      document.title = `${ui("Watchlist film not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${escape(ui("Watchlist film not found"))}</h1><a href="${escape(window.periodPageUrl("alltime", "alltime"))}&view=watchlist">${escape(ui("Return to watchlist"))}</a></div>`;
      finishRenderTimer?.("not found");
      return;
    }

    item.id ||= window.watchlistItemId(item);
    let archiveFilm = window.findWatchlistArchiveFilm(item);
    let film = window.watchlistFilmLike(item, archiveFilm);
    let displayTitle = window.localizedFilmTitle(film);
    let localizedTitleMeta = window.hasLocalizedFilmTitle(film)
      ? `<span class="leaderboard-meta localized-title-meta">${escape(ui("Original title"))}: ${escape(film.title)}</span>`
      : "";
    let posterHtml = window.renderFilmPoster(film, "detail");
    if (posterOptions.length || posterPickerStatus) {
      posterOptionIndex = currentPosterOptionIndex(item);
      posterHtml = window.renderPosterPicker({
        posterHtml,
        options: posterOptions,
        activeIndex: posterOptionIndex,
        status: posterPickerStatus,
        escape,
      });
    }
    let director = String(
      item.director ||
        archiveFilm?.director ||
        (archiveFilm?.directors || []).join(", "),
    ).trim();
    let directorHtml = window.renderLinkedDirectors(director, {
      escape,
      expanded: true,
    });
    let letterboxdUrl =
      item.letterboxdUrl ||
      film.letterboxdUrl ||
      (/letterboxd\.com/i.test(String(film.url || "")) ? film.url : "");
    let otherUrl = film.url && film.url !== letterboxdUrl ? film.url : "";
    let tmdbId = item.tmdbId || film.tmdbId || "";
    let metadataHtml = [
      metadataRow(
        ui("Year"),
        film.year,
        film.year ? window.periodPageUrl("year", film.year) : "",
      ),
      metadataRow(
        "TMDB",
        tmdbId ? `#${tmdbId}` : "",
        tmdbId
          ? `https://www.themoviedb.org/${window.tmdbResourcePath(window.parseTmdbReference(tmdbId))}`
          : "",
      ),
      metadataRow(
        "Letterboxd",
        letterboxdUrl ? "Open on Letterboxd" : "",
        letterboxdUrl,
      ),
      metadataRow(
        ui("Medium"),
        film.medium && film.medium !== "unknown"
          ? metadataLabel(film.medium)
          : "",
      ),
      metadataRow(
        ui("Screenplay"),
        film.screenplayType && film.screenplayType !== "unknown"
          ? metadataLabel(film.screenplayType)
          : "",
      ),
      metadataRow(
        ui("Adapted from"),
        film.adaptationSource,
        film.adaptationSource
          ? `${window.periodPageUrl("alltime", "alltime")}&view=films&scope=all&source=${encodeURIComponent(film.adaptationSource)}`
          : "",
      ),
      metadataRow(ui("Swedish title"), film.swedishTitle),
      film.country
        ? `<div><dt>${escape(ui("Country"))}</dt><dd>${window.renderCountryLinks(film.country, escape)}</dd></div>`
        : "",
      metadataRow(ui("Runtime"), formatRuntime(film.runtimeMinutes)),
      metadataRow(ui("Platform"), film.platform),
      metadataRow("URL", otherUrl, otherUrl),
    ].join("");
    let tagHtml = window
      .parseFilmTags(item.tags)
      .map(
        (tag) =>
          `<a class="film-tag" href="${escape(window.tagPageUrl(tag))}">${escape(tag)}</a>`,
      )
      .join("");
    let franchiseHtml = window.renderFranchiseMembershipLinks(item.franchises, {
      itemId,
      escape,
    });
    let projectMembershipHtml = window.renderProjectMembershipSection(
      window.activeProjectsForFilm?.({
        archiveId: archiveFilm?.id || "",
        watchlistId: item.id,
      }) || [],
      { escape, title: ui("Active projects") },
    );
    let archiveMatchHtml = renderArchiveMatchReview(item);
    let moreToolsOpen = posterOptions.length > 0 || !!posterPickerStatus;

    document.title = `${displayTitle} · Watchlist · The Oskars`;
    container.innerHTML = `<nav class="detail-breadcrumbs" aria-label="Breadcrumb"><a href="${escape(window.periodPageUrl("alltime", "alltime"))}&view=watchlist">Watchlist</a><span aria-hidden="true">›</span><span aria-current="page">${escape(item.title)}</span></nav>
    ${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${escape(displayTitle)}</h1>${window.renderWatchlistTierBadge(item.tier, { escape })}</div>
        ${localizedTitleMeta}
        ${directorHtml ? `<p>${escape(ui("by"))} ${directorHtml}</p>` : ""}
        ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}`,
      actionsHtml: `<button type="button" data-mark-watchlist-watched>${escape(ui("Mark as watched"))}</button><button type="button" data-edit-watchlist-film>${escape(ui("Edit"))}</button><details class="detail-header-more"${moreToolsOpen ? " open" : ""}><summary class="button-link">${escape(ui("More"))}</summary><div class="detail-header-more-panel"><button type="button" data-enrich-watchlist-film="${escape(item.id)}">${escape(ui("Find metadata"))}</button><button type="button" data-find-watchlist-poster="${escape(item.id)}">${escape(film.poster ? ui("Refresh poster") : ui("Find poster"))}</button><button type="button" data-load-watchlist-poster-options="${escape(item.id)}">${escape(posterOptions.length ? ui("Reload poster options") : ui("Browse posters"))}</button></div></details>`,
    })}
    ${tagHtml ? `<section class="film-tags"><h2>${escape(ui("Tags"))}</h2><div class="film-tag-list">${tagHtml}</div></section>` : ""}
    ${franchiseHtml ? `<section class="film-franchises"><h2>${escape(ui("Franchises"))}</h2><div class="film-franchise-links">${franchiseHtml}</div></section>` : ""}
    ${projectMembershipHtml}
    ${archiveMatchHtml}`;
    window.enhanceCollapsibles?.(container);
    finishRenderTimer?.(
      `${item.id}, ${archiveFilm ? "archive match" : "watchlist only"}`,
    );
  }

  if (typeof window !== "undefined") {
    window.removeEventListener?.(
      "oskars:localechange",
      window.__oskarsWatchlistFilmLocaleRender,
    );
    window.__oskarsWatchlistFilmLocaleRender = () => {
      if (String(container.innerHTML || "").includes('id="watchlistFilmForm"'))
        return;
      render();
    };
    window.addEventListener?.(
      "oskars:localechange",
      window.__oskarsWatchlistFilmLocaleRender,
    );
  }

  function renderEdit() {
    let item = window.findWatchlistItemById(itemId);
    if (!item) return render();
    document.title = `${ui("Edit {title}", { title: item.title })} · Watchlist · The Oskars`;
    container.innerHTML = `<form id="watchlistFilmForm" class="film-edit-form">
    ${window.renderDetailHeader({ mainHtml: `<h1>${escape(ui("Edit {title}", { title: item.title }))}</h1><p>${escape(ui("Watchlist metadata"))}</p>`, actionsHtml: `<button type="submit">${escape(ui("Save"))}</button><button type="button" data-cancel-watchlist-edit>${escape(ui("Cancel"))}</button>` })}
    <section class="film-edit-section"><h2>${escape(ui("Details"))}</h2><div class="film-edit-grid">
      <label>${escape(ui("Interest"))} <select name="tier">${tierOptions(item.tier)}</select></label>
      <label>${escape(ui("TMDB ID"))} <input name="tmdbId" inputmode="numeric" value="${escape(item.tmdbId || "")}"></label>
      <label>${escape(ui("Year"))} <input name="year" type="number" min="1888" max="2100" value="${escape(item.year || "")}" disabled></label>
      <label class="wide">${escape(ui("Director(s)"))} <input name="director" value="${escape(item.director || "")}" placeholder="${escape(ui("Comma-separated names"))}"></label>
      <label>${escape(ui("Country"))} <input name="country" value="${escape(item.country || "")}"></label>
      <label>${escape(ui("Runtime (minutes)"))} <input name="runtimeMinutes" type="number" min="1" max="2000" value="${escape(item.runtimeMinutes || "")}"></label>
      <label>${escape(ui("Medium"))} <select name="medium"><option value="unknown" ${!item.medium || item.medium === "unknown" ? "selected" : ""}>${escape(ui("Unknown"))}</option><option value="live-action" ${item.medium === "live-action" ? "selected" : ""}>${escape(ui("Live action"))}</option><option value="animation" ${item.medium === "animation" ? "selected" : ""}>${escape(ui("Animation"))}</option><option value="hybrid" ${item.medium === "hybrid" ? "selected" : ""}>${escape(ui("Hybrid"))}</option></select></label>
      <label>${escape(ui("Screenplay"))} <select name="screenplayType"><option value="unknown" ${!item.screenplayType || item.screenplayType === "unknown" ? "selected" : ""}>${escape(ui("Unknown"))}</option><option value="original" ${item.screenplayType === "original" ? "selected" : ""}>${escape(ui("Original"))}</option><option value="adapted" ${item.screenplayType === "adapted" ? "selected" : ""}>${escape(ui("Adapted"))}</option></select></label>
      <label>${escape(ui("Adaptation source"))} <input name="adaptationSource" value="${escape(item.adaptationSource || "")}" placeholder="${escape(ui("Novel, play, video game…"))}"></label>
      <label>${escape(ui("Swedish title"))} <input name="swedishTitle" value="${escape(item.swedishTitle || "")}"></label>
      <label>${escape(ui("Platform"))} <input name="platform" value="${escape(item.platform || "")}"></label>
      <label class="wide">${escape(ui("Letterboxd URL"))} <input name="letterboxdUrl" type="url" value="${escape(item.letterboxdUrl || "")}"></label>
      <label class="wide">${escape(ui("Tags"))} <input name="tags" value="${escape(window.formatFilmTags(item.tags))}" placeholder="${escape(ui("Noir, courtroom drama, rewatch"))}"></label>
      <label class="wide">${escape(ui("Franchises"))} <textarea name="franchises" rows="5" placeholder="${escape(ui("Parent franchise > Subfranchise | rank"))}">${escape(window.formatFranchiseMemberships(item.franchises))}</textarea></label>
    </div></section>
    <div class="film-edit-actions"><button type="submit">${escape(ui("Save changes"))}</button><button type="button" data-cancel-watchlist-edit>${escape(ui("Cancel"))}</button></div>
  </form>`;
  }

  container.addEventListener("click", async (event) => {
    if (event.target.closest("[data-mark-watchlist-watched]")) {
      renderWatchedForm();
      return;
    }
    if (event.target.closest("[data-cancel-watchlist-transition]")) {
      render();
      return;
    }
    if (event.target.closest("[data-edit-watchlist-film]")) {
      renderEdit();
      return;
    }
    if (event.target.closest("[data-cancel-watchlist-edit]")) {
      render();
      return;
    }
    let enrichButton = event.target.closest("[data-enrich-watchlist-film]");
    if (enrichButton) {
      enrichButton.disabled = true;
      enrichButton.textContent = ui("Finding...");
      try {
        let metadata = await window.loadWatchlistMetadata(
          enrichButton.dataset.enrichWatchlistFilm,
        );
        if (!metadata) throw new Error(ui("No TMDB match was found."));
        render();
      } catch (err) {
        enrichButton.disabled = false;
        enrichButton.textContent = ui("Find metadata");
        alert(err.message || String(err));
      }
      return;
    }
    let optionsButton = event.target.closest(
      "[data-load-watchlist-poster-options]",
    );
    if (optionsButton) {
      optionsButton.disabled = true;
      optionsButton.textContent = ui("Loading posters...");
      try {
        posterOptions = await window.loadWatchlistPosterOptions(
          optionsButton.dataset.loadWatchlistPosterOptions,
          { limit: 12 },
        );
        posterOptionIndex = currentPosterOptionIndex(
          window.findWatchlistItemById(itemId),
        );
        posterPickerStatus = posterOptions.length
          ? ""
          : ui("No TMDB posters were found for this film.");
        render();
      } catch (err) {
        optionsButton.disabled = false;
        optionsButton.textContent = posterOptions.length
          ? ui("Reload poster options")
          : ui("Browse posters");
        posterPickerStatus = window.posterPickerErrorText(err);
        render();
      }
      return;
    }
    let posterStepButton = event.target.closest("[data-poster-option-step]");
    if (posterStepButton) {
      selectPosterOption(
        currentPosterOptionIndex(window.findWatchlistItemById(itemId)) +
          (Number(posterStepButton.dataset.posterOptionStep) || 0),
      );
      return;
    }
    let posterSelectButton = event.target.closest(
      "[data-poster-option-select]",
    );
    if (posterSelectButton) {
      selectPosterOption(
        Number(posterSelectButton.dataset.posterOptionSelect) || 0,
      );
      return;
    }
    let button = event.target.closest("[data-find-watchlist-poster]");
    if (!button) return;
    button.disabled = true;
    button.textContent = ui("Finding...");
    try {
      let poster = await window.loadWatchlistPoster(
        button.dataset.findWatchlistPoster,
      );
      if (!poster) throw new Error(ui("No poster was found."));
      render();
    } catch (err) {
      button.disabled = false;
      let item = window.findWatchlistItemById(
        button.dataset.findWatchlistPoster,
      );
      let film = window.watchlistFilmLike(item);
      button.textContent = film?.poster
        ? ui("Refresh poster")
        : ui("Find poster");
      alert(err.message || String(err));
    }
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (
      !posterOptions.length ||
      !event.target.closest?.("[data-film-poster-picker]")
    )
      return;
    event.preventDefault();
    selectPosterOption(
      currentPosterOptionIndex(window.findWatchlistItemById(itemId)) +
        (event.key === "ArrowRight" ? 1 : -1),
    );
  });

  container.addEventListener("submit", async (event) => {
    let transitionForm = event.target.closest("#markWatchlistWatchedForm");
    if (transitionForm) {
      event.preventDefault();
      let values = Object.fromEntries(new FormData(transitionForm).entries());
      let plan = window.planMarkWatchlistFilmWatched(itemId, values);
      if (!plan.ok) {
        alert(plan.errors.join("\n"));
        return;
      }
      let confirmText = [
        ui("Mark as watched? This will become {target}.", {
          target: transitionTargetText(plan),
        }),
        "",
        ...plan.actions,
        ...(plan.warnings.length ? ["", ui("Still to do"), ...plan.warnings] : []),
      ].join("\n");
      if (!confirm(confirmText)) return;
      let result = window.applyMarkWatchlistFilmWatched(plan);
      if (!result.ok) {
        alert(
          result.reason === "stale"
            ? ui("The data changed after preview. Try again.")
            : ui("The watchlist transition could not be applied."),
        );
        return;
      }
      await result.persisted;
      window.location.href =
        result.target.type === "archive"
          ? window.filmPageUrl(result.target.id)
          : window.intakePageUrl(result.workflow.id);
      return;
    }
    let form = event.target.closest("#watchlistFilmForm");
    if (!form) return;
    event.preventDefault();
    let values = Object.fromEntries(new FormData(form).entries());
    try {
      if (!window.setWatchlistMetadata(itemId, values))
        throw new Error(ui("Watchlist film could not be updated."));
      render();
    } catch (err) {
      alert(err.message || String(err));
      renderEdit();
    }
  });

  function renderInitial() {
    if (openTransitionOnLoad) {
      openTransitionOnLoad = false;
      renderWatchedForm();
    } else render();
  }

  if ((state.watchlist || []).length) renderInitial();
  else window.ensureWatchlistData().then(renderInitial);
})();
