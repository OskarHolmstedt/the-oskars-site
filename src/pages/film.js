/** @file Controls film detail rendering, awards, read-only catalog metadata, and personal editing. */

(function () {
  let filmPageEscape = window.pageEscape;
  let filmPagePlacement = window.pagePlacement;
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  let ui =
    window.uiText ||
    ((text, values = {}) =>
      text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""));

  function filmPagePeriodOrder(period) {
    if (period === "alltime") return 100000;
    return Number(String(period || "").replace(/[^0-9]/g, "")) || 0;
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

  function formatNumber(value) {
    let number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : "";
  }

  function formatWatchedDate(value) {
    let iso = window.parseWatchedDate?.(value) || "";
    if (!iso)
      return window.normalizeWatchedDate?.(value) ?? String(value || "").trim();
    let date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
  }

  let filmId = window.pageQueryParam("id");
  let previewTmdbId = filmId ? "" : window.pageQueryParam("tmdb");
  let awardsView =
    window.pageQueryParam("awards") === "matrix" ? "matrix" : "periods";
  let container = document.getElementById("filmPage");

  // Shared catalog tags (issue #797) load lazily after the first paint so
  // no film hydration query carries them; they stay out of film.tags, which
  // the write path saves back to the user's personal film_tags.
  let catalogTags = [];
  let catalogTagsRequested = false;

  function catalogTagsHtml() {
    if (!catalogTags.length) return "";
    return `<section class="film-tags film-catalog-tags"><h2>${filmPageEscape(ui("Catalog tags"))}</h2><div class="film-tag-list">${catalogTags
      .map(
        (tag) =>
          `<a class="film-tag film-tag--catalog" href="${filmPageEscape(window.catalogTagPageUrl(tag.name))}">${filmPageEscape(tag.name)}</a>`,
      )
      .join("")}</div></section>`;
  }

  function ensureCatalogTags() {
    if (catalogTagsRequested || !filmId || !window.loadSupabaseFilmCatalogTags)
      return;
    catalogTagsRequested = true;
    window
      .loadSupabaseFilmCatalogTags(filmId)
      .then((tags) => {
        catalogTags = tags;
        if (tags.length && !currentlyEditing) render(false);
      })
      .catch(() => {});
  }

  // Compact film detail (issue #617): window.OSKARS_FILM_COMPACT opts a
  // canonical film.html?id=<filmId> visit into a fast initial paint from
  // loadSupabaseFilmDetail() (one film's own watched/watchlist/rankings/
  // personal-awards/franchises slice) instead of the eager full archive
  // hydration every other film.html visit still gets. `compactActive`
  // stays true only until a full hydration actually completes (either
  // the eager background upgrade below, or an interactive action that
  // needs it) - once it flips false it never flips back for the rest of
  // this page's life, so every other function below runs completely
  // unmodified from that point on, exactly like #598's own Watchlist
  // cutover. `compactReady` tracks whether the one-film fetch itself has
  // resolved yet - distinct from compactActive, which stays true even
  // after that (until the *background full* hydration also finishes).
  let compactActive =
    Boolean(window.OSKARS_FILM_COMPACT) && Boolean(filmId || previewTmdbId);
  let compactReady = !compactActive;
  let fullyHydratedPromise = null;

  // Film credits use the derived peopleByProfession groups. Most pages can
  // keep the people index lazy, but the film page explicitly needs it
  // before render - except in compact mode, where the archive-wide alias
  // index it builds (rebuildPeopleIndex()) is exactly the shared people/
  // franchise infrastructure issue #617 rules out touching here, so the
  // credits section defers until the real background full hydration below
  // rebuilds it from complete data, same as ensureFilmFullyHydrated() does
  // for the watchlist-detail view's archive-match-review section.
  if (!compactActive) window.ensurePeopleIndex?.();

  // The canonical film URL stays stable as personal collection status changes.
  let watchlistItem = null;
  let isWatchlistDetail = false;
  let watchlistBusy = false;
  let pendingCollectionAction = "";
  let collectionDetail = null;
  let collectionFilm = null;
  let collectionPreview = null;
  let pendingCollectionActive = true;
  let requestedWatchedForm = window.pageQueryParam("action") === "watched";
  let removedWatchlistSnapshot = null;
  let watchlistFranchiseChains = null;
  let scopedOpenIntake = null;
  let intakeRequestedForFilm = "";

  function ensureOpenIntake() {
    let id = window.isUuid?.(filmId) ? filmId : currentFilm()?.supabaseFilmId;
    if (
      !canEdit ||
      window.state?.isPublicProfileView ||
      window.resolveActiveProfileSlug?.() ||
      !window.isUuid?.(id) ||
      intakeRequestedForFilm === id ||
      !window.loadSupabaseOpenIntakeForFilm
    )
      return;
    intakeRequestedForFilm = id;
    window
      .loadSupabaseOpenIntakeForFilm(id)
      .then((workflow) => {
        scopedOpenIntake = workflow;
        if (workflow && !currentlyEditing) render(false);
      })
      .catch(() => {});
  }

  let scopedActiveProjects = [];
  let scopedArchiveMatch = null;
  // Read-only archive-match hint, ported from watchlist-film.js: built
  // from the already-hydrated window.state.filmsById (every watched film,
  // Supabase-side there's no separate "watchedOther" bucket) rather than a
  // live loadSupabaseWorkspace() call watchlist-film.js's own boot() used
  // to make - the data's already sitting in window.state by the time this
  // runs (in compact mode, scoped to read_watched_title_matches() rows).
  let watchedTitlesByYear = new Map();

  function archiveMatchCandidateFromMatches(matches, item) {
    if (!matches?.length || !item) return null;
    let year = String(item.year || "");
    let sameTitleYear = year
      ? matches.find((film) => String(film.year || "") === year)
      : null;
    if (sameTitleYear)
      return {
        level: "exact",
        label: ui("Title and year match"),
        film: sameTitleYear,
      };
    let sameTitle = matches[0];
    if (sameTitle)
      return {
        level: "possible",
        label: year
          ? ui("Same title, different year")
          : ui("Same title, year unknown"),
        film: sameTitle,
      };
    return null;
  }

  function refreshWatchlistDetailState() {
    watchlistItem = filmId
      ? (collectionDetail?.watchlist || window.state.watchlist)?.find(
          (entry) => entry.supabaseFilmId === filmId,
        ) || null
      : null;
    isWatchlistDetail = Boolean(watchlistItem);
    watchedTitlesByYear = new Map();
    if (isWatchlistDetail && !compactActive && !collectionDetail) {
      Object.values(window.state.filmsById || {}).forEach((watched) => {
        let title = window.normalizeTitle(watched.title || "");
        if (!title) return;
        let entry = { title: watched.title, year: watched.year };
        watchedTitlesByYear.set(`${title}::${watched.year || ""}`, entry);
        watchedTitlesByYear.set(`${title}::`, entry);
      });
    }
  }

  /**
   * Loads current complete archive state before compound editors and legacy writes.
   * Collection status actions instead own a one-film projection and do not
   * require this upgrade. A successful upgrade replaces that projection.
   * @returns {Promise<void>}
   */
  function ensureFilmFullyHydrated() {
    if (
      !compactActive &&
      !collectionDetail &&
      window.OSKARS_STATE_HYDRATION_COMPLETE !== false
    )
      return Promise.resolve();
    if (fullyHydratedPromise) return fullyHydratedPromise;
    fullyHydratedPromise = (
      window.ensureFocusedShellData?.() || Promise.resolve()
    )
      .then(() => {
        compactActive = false;
        collectionDetail = null;
        collectionFilm = null;
        collectionPreview = null;
        scopedActiveProjects = [];
        scopedArchiveMatch = null;
        window.ensurePeopleIndex?.();
        refreshWatchlistDetailState();
        render(currentlyEditing);
        ensureOfficialResultsForThisFilm();
      })
      .catch((error) => {
        // Retain the scoped projection so a failed editor upgrade stays retryable.
        fullyHydratedPromise = null;
        throw error;
      });
    return fullyHydratedPromise;
  }

  if (compactActive) {
    let detailPromise = previewTmdbId
      ? window.loadSupabaseFilmDetailByTmdbId?.(previewTmdbId)
      : window.loadSupabaseFilmDetail(filmId);
    let projectsPromise = window.isUuid?.(filmId)
      ? window.loadSupabaseActiveProjectsForFilm?.(filmId).catch(() => [])
      : Promise.resolve([]);
    Promise.all([detailPromise, projectsPromise])
      .then(async ([source, activeProjects]) => {
        if (!source) {
          compactReady = true;
          window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "ready";
          render(currentlyEditing);
          return;
        }
        let hasFilmRecord =
          Boolean(source.watched?.length) ||
          Boolean(source.watchlist?.length) ||
          Boolean(source.catalogFilms?.length);
        if (!hasFilmRecord) {
          compactReady = true;
          window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "ready";
          render(currentlyEditing);
          return;
        }
        if (!filmId && source.catalogFilms?.[0]?.id) {
          filmId = source.catalogFilms[0].id;
        }
        scopedActiveProjects = activeProjects || [];
        if (source.catalogFilms?.length) {
          window.applySharedFilmArchive?.(
            window.buildSharedFilmArchiveFromSupabase(
              source.catalogFilms,
              source.franchises,
            ),
            { merge: true },
          );
        } else {
          window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "ready";
        }
        Object.assign(
          window.state,
          window.buildLegacyStateFromSupabaseHydration(source),
        );
        // state.filmsById is rebuilt from state.years by rebuildAggregates()
        // itself, not by the reshape above (buildLegacyStateFromSupabaseHydration
        // only returns years/watchedOther/watchlist/personPortraits) -
        // exactly the same second step ensureOskarsData() always takes.
        window.rebuildAggregates();
        compactReady = true;
        refreshWatchlistDetailState();
        if (isWatchlistDetail && watchlistItem?.title) {
          try {
            let matches = await window.loadSupabaseWatchedTitleMatches?.(
              watchlistItem.title,
            );
            scopedArchiveMatch = archiveMatchCandidateFromMatches(
              matches || [],
              watchlistItem,
            );
          } catch {
            scopedArchiveMatch = null;
          }
        }
        render(currentlyEditing);
        ensureOfficialResultsForThisFilm();
      })
      .catch(() => {
        // The compact read itself failed (not just the background
        // upgrade) - fall straight through to the same full-hydration
        // path every write already waits on, rather than leaving the
        // page stuck on an empty "not found". compactActive stays true
        // until that actually resolves, so a write that lands in the
        // meantime still waits instead of racing ahead of real data.
        ensureFilmFullyHydrated().finally(() => {
          compactReady = true;
          window.OSKARS_SHARED_FILM_ARCHIVE_STATUS = "ready";
          render(currentlyEditing);
          ensureOfficialResultsForThisFilm();
        });
      });
  } else {
    refreshWatchlistDetailState();
  }

  function filmViewUrl() {
    let url = window.filmPageUrl(filmId);
    return awardsView === "matrix" ? `${url}&awards=matrix` : url;
  }

  function updateFilmViewUrl() {
    if (window.history?.replaceState)
      window.history.replaceState(null, "", filmViewUrl());
  }

  function currentFilm() {
    if (collectionDetail) return collectionFilm;
    return window.findFilmById(filmId) || window.findWatchedFilmById?.(filmId);
  }

  async function refreshFilmCollection(isCurrent) {
    // The retained archive is no longer a complete write baseline after a
    // scoped mutation. Legacy saves must wait for an explicit full upgrade.
    window.OSKARS_STATE_HYDRATION_COMPLETE = false;
    window.OSKARS_SUPABASE_HYDRATION_SOURCE = null;
    fullyHydratedPromise = null;
    window.invalidateCachedSupabaseHydrationSource?.();
    let [source, projects] = await Promise.all([
      window.loadSupabaseFilmDetail(filmId),
      window
        .loadSupabaseActiveProjectsForFilm?.(filmId)
        .catch(() => scopedActiveProjects) ||
        Promise.resolve(scopedActiveProjects),
    ]);
    if (!isCurrent())
      throw new Error("Account changed while performing operation.");
    // Keep this one-film projection separate from any already-loaded archive.
    // Compound editors still upgrade through ensureFilmFullyHydrated.
    collectionDetail = window.buildLegacyStateFromSupabaseHydration(source);
    collectionPreview =
      Object.values(
        window.buildSharedFilmArchiveFromSupabase(
          source.catalogFilms || [],
          source.franchises || [],
        ),
      )[0] || null;
    collectionFilm =
      Object.values(collectionDetail.years || {}).flatMap(
        (period) => period.films || [],
      )[0] ||
      collectionDetail.watchedOther?.[0] ||
      null;
    scopedActiveProjects = projects;
    watchlistFranchiseChains = window.buildSupabaseFranchiseChains(
      source.franchises || [],
    );
    refreshWatchlistDetailState();
    if (watchlistItem?.title) {
      let matches = await window
        .loadSupabaseWatchedTitleMatches?.(watchlistItem.title)
        .catch(() => []);
      if (!isCurrent())
        throw new Error("Account changed while performing operation.");
      scopedArchiveMatch = archiveMatchCandidateFromMatches(
        matches || [],
        watchlistItem,
      );
    }
  }

  // Objective catalog metadata - shared verbatim across the Watched
  // (archive) detail view, the Watchlist detail view, and the catalog-only
  // preview: none of these facts
  // (type, medium, screenplay, TMDB/Letterboxd ids, country, runtime...)
  // depend on the viewer's relation to the film, only on the shared
  // `films` row itself, so a watched film, a watchlist item, and a
  // catalog preview all read the same field names here and must render
  // identically. Previously each of the 3 views hand-built its own row
  // list and had quietly drifted apart - the Watchlist view was missing
  // Type/Primary country/URL entirely, and the catalog preview surfaced
  // only TMDB/Country/Runtime out of an object that already carried
  // every other field too (see buildSharedFilmArchiveFromSupabase in
  // src/domain/supabase-legacy-hydration.js).
  function objectiveFilmMetadataRows(film) {
    let letterboxdUrl =
      film.letterboxdUrl ||
      (/letterboxd\.com/i.test(String(film.url || "")) ? film.url : "");
    let otherUrl = film.url && film.url !== letterboxdUrl ? film.url : "";
    let countryValues = window.countryListValues(film.country);
    let primaryCountry =
      window.primaryCountryValue?.(film) || film.primaryCountry || "";
    return [
      [
        ui("Year"),
        film.year,
        film.year ? window.periodPageUrl("year", film.year) : "",
      ],
      [ui("Type"), film.type ? metadataLabel(film.type) : ""],
      [
        "TMDB",
        film.tmdbId ? `#${film.tmdbId}` : "",
        film.tmdbId
          ? `https://www.themoviedb.org/${window.tmdbResourcePath(window.parseTmdbReference(film.tmdbId))}`
          : "",
      ],
      ["Letterboxd", letterboxdUrl ? "Open on Letterboxd" : "", letterboxdUrl],
      [
        ui("Medium"),
        film.medium && film.medium !== "unknown"
          ? metadataLabel(film.medium)
          : "",
      ],
      [
        ui("Screenplay"),
        film.screenplayType && film.screenplayType !== "unknown"
          ? metadataLabel(film.screenplayType)
          : "",
      ],
      [
        ui("Adapted from"),
        film.adaptationSource,
        film.adaptationSource
          ? `${window.periodPageUrl("alltime", "alltime")}&view=films&scope=all&source=${encodeURIComponent(film.adaptationSource)}`
          : "",
      ],
      [ui("Swedish title"), film.swedishTitle],
      [
        ui("Country"),
        countryValues.join(", ") || primaryCountry,
        "",
        [...new Set([primaryCountry, ...countryValues].filter(Boolean))]
          .map((country) => {
            let link = window.renderCountryLinks(country, filmPageEscape);
            return country === primaryCountry
              ? `<strong>${link}</strong>`
              : link;
          })
          .join(", "),
      ],
      [ui("Runtime"), formatRuntime(film.runtimeMinutes)],
      ["URL", otherUrl, otherUrl],
    ].filter((entry) => entry[1]);
  }

  function objectiveFilmMetadataHtml(film) {
    return objectiveFilmMetadataRows(film)
      .map(
        (entry) =>
          `<div><dt>${filmPageEscape(entry[0])}</dt><dd>${
            entry[3]
              ? entry[3]
              : entry[2]
                ? `<a class="period-link" href="${filmPageEscape(entry[2])}"${/^https?:\/\//i.test(String(entry[2])) ? ' target="_blank" rel="noopener noreferrer"' : ""}>${filmPageEscape(entry[1])}</a>`
                : filmPageEscape(entry[1])
          }</dd></div>`,
      )
      .join("");
  }

  // Read-only archive-match hint (issue #439's confirmed scope reduction
  // drops metadata/poster editing entirely, but this stays useful and
  // needs no write of its own): a simple normalized-title/year match
  // against the signed-in user's own already-watched titles.
  function archiveMatchCandidate() {
    if (compactActive || collectionDetail) return scopedArchiveMatch;
    let normalizedTitle = window.normalizeTitle(watchlistItem.title || "");
    let year = String(watchlistItem.year || "");
    let sameTitleYear = watchedTitlesByYear.get(`${normalizedTitle}::${year}`);
    let sameTitle = watchedTitlesByYear.get(`${normalizedTitle}::`);
    if (sameTitleYear)
      return {
        level: "exact",
        label: ui("Title and year match"),
        film: sameTitleYear,
      };
    if (sameTitle)
      return {
        level: "possible",
        label: year
          ? ui("Same title, different year")
          : ui("Same title, year unknown"),
        film: sameTitle,
      };
    return null;
  }

  function renderArchiveMatchReview() {
    let match = archiveMatchCandidate();
    if (!match) return "";
    let film = match.film;
    let table = window.renderLeaderboardTable({
      headers: [ui("Confidence"), ui("Film")].map(filmPageEscape),
      rows: `<tr><td><span class="match-confidence match-confidence--${filmPageEscape(match.level)}">${filmPageEscape(match.level === "exact" ? ui("Exact") : ui("Possible"))}</span><span class="leaderboard-meta">${filmPageEscape(match.label)}</span></td><td class="film-table-cell"><a class="table-film-link" href="${filmPageEscape(window.periodPageUrl("year", film.year))}"><strong>${filmPageEscape(film.title)}</strong></a><span class="leaderboard-meta">${filmPageEscape(film.year || "")}</span></td></tr>`,
    });
    return `<section class="archive-match-review"><h2>${filmPageEscape(ui("Archive match review"))}</h2><p>${filmPageEscape(ui("Possible archive matches are shown for review only."))}</p>${table}</section>`;
  }

  function renderWatchlistWatchedForm() {
    document.title = `${ui("Mark {title} as watched", { title: watchlistItem.title })} · The Oskars`;
    container.innerHTML = `<form id="markWatchlistWatchedForm" class="film-edit-form">
      ${window.renderDetailHeader({ mainHtml: `<h1>${filmPageEscape(ui("Mark {title} as watched", { title: watchlistItem.title }))}</h1><p>${filmPageEscape(ui("Add any viewing facts you know, then mark it watched."))}</p>`, actionsHtml: `${window.renderCollectionActionButton({ kind: "watched", label: ui("Mark as watched"), escape: filmPageEscape, attributes: { type: "submit", disabled: watchlistBusy } })}<button type="button" data-cancel-watchlist-transition>${filmPageEscape(ui("Cancel"))}</button>` })}
      <section class="film-edit-section"><h2>${filmPageEscape(ui("Viewing facts"))}</h2><div class="film-edit-grid">
        <label>${filmPageEscape(ui("Rating"))} ${window.renderRatingInput({})}</label>
        <label>${filmPageEscape(ui("Date watched"))} <input name="dateWatched" type="date"></label>
        <label>${filmPageEscape(ui("Platform"))} <input name="platform" value="${filmPageEscape(watchlistItem.platform || "")}"></label>
        <label>${filmPageEscape(ui("Views"))} <input name="views" type="number" min="1" step="1" value="1"></label>
      </div></section>
      <p>${filmPageEscape(ui("Any unfinished rating, ranking, and awards work will remain in the intake queue."))}</p>
    </form>`;
    window.enhanceRatingInputs?.(container);
  }

  function filmCollectionSections(film, itemId = false) {
    let tags = window
      .parseFilmTags(film.tags)
      .map(
        (tag) =>
          `<a class="film-tag" href="${filmPageEscape(window.tagPageUrl(tag))}">${filmPageEscape(tag)}</a>`,
      )
      .join("");
    let franchises = window.renderFranchiseMembershipLinks(film.franchises, {
      ...(itemId ? { itemId: film.id } : { filmId: film.id }),
      escape: filmPageEscape,
    });
    return `${tags || canEdit ? `<section class="film-tags"><h2>${filmPageEscape(ui("Your tags"))}${canEdit ? `<button type="button" class="film-inline-add" data-edit-film="tags" aria-label="${filmPageEscape(ui("Tags"))}">+</button>` : ""}</h2><div class="film-tag-list">${tags}</div></section>` : ""}${franchises || canEdit ? `<section class="film-franchises"><h2>${filmPageEscape(ui("Franchises"))}${canEdit ? `<button type="button" class="film-inline-add" data-edit-film="franchises" aria-label="${filmPageEscape(ui("Add franchise"))}">+</button>` : ""}</h2><div class="film-franchise-links">${franchises}</div></section>` : ""}`;
  }

  function watchlistEditFormHtml() {
    return `<form id="watchlistEditForm" class="film-edit-form">
        <section class="film-edit-section"><h2>${filmPageEscape(ui("Interest tier"))}</h2><div class="film-edit-grid"><label>${filmPageEscape(ui("Interest tier"))}<span class="tier-select-row">${window.renderTierSetter({ tierName: "tier", tier: watchlistItem.tier, modifierName: "tierModifier", modifier: watchlistItem.tierModifier, escape: filmPageEscape, ui })}</span></label></div></section>
      <section class="film-edit-section"><h2>${filmPageEscape(ui("Your tags"))}</h2><div class="film-edit-grid"><label class="wide">${filmPageEscape(ui("Tags"))}<input name="tags" value="${filmPageEscape(window.formatFilmTags(watchlistItem.tags))}"><span class="field-help">${filmPageEscape(ui("Separate tags with commas."))}</span></label></div></section>
      <section class="film-edit-section"><h2>${filmPageEscape(ui("Franchises"))}</h2>${window.renderFranchiseMembershipLinks(watchlistItem.franchises, { itemId: watchlistItem.id, escape: filmPageEscape })}<div class="film-edit-grid"><label>${filmPageEscape(ui("Add franchise"))}<input name="franchise" placeholder="${filmPageEscape(ui("Franchise name"))}"></label><label>${filmPageEscape(ui("Parent (optional)"))}<input name="parent" placeholder="${filmPageEscape(ui("Parent franchise"))}"></label></div><p class="field-help">${filmPageEscape(ui("New memberships can be added. Existing shared-catalog memberships cannot be removed or corrected here."))}</p></section>
      <div class="film-edit-actions"><button type="submit">${filmPageEscape(ui("Save changes"))}</button><button type="button" data-cancel-film-edit>${filmPageEscape(ui("Cancel"))}</button></div>
    </form>`;
  }

  function renderWatchlistDetail() {
    if (!watchlistItem) {
      if (removedWatchlistSnapshot) {
        document.title = `${ui("Removed from watchlist")} · The Oskars`;
        container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Removed from watchlist"))}</h1>${window.renderActionFeedback({ message: ui('Removed "{title}" from your watchlist.', { title: removedWatchlistSnapshot.title }), actionLabel: ui("Undo"), actionAttribute: "data-undo-watchlist-removal", escape: filmPageEscape })}<a href="watchlist-merge.html">${filmPageEscape(ui("Return to watchlist"))}</a></div>`;
        return;
      }
      document.title = `${ui("Watchlist film not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Watchlist film not found"))}</h1><a href="watchlist-merge.html">${filmPageEscape(ui("Return to watchlist"))}</a></div>`;
      return;
    }

    let displayTitle = window.localizedFilmTitle(watchlistItem);
    let posterHtml = renderPosterArea(watchlistItem);
    let directorHtml = window.renderLinkedDirectors(watchlistItem, {
      escape: filmPageEscape,
      expanded: true,
    });
    let metadataHtml = objectiveFilmMetadataHtml(watchlistItem);
    let archiveMatchHtml = renderArchiveMatchReview();

    document.title = `${displayTitle} · Watchlist · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${filmPageEscape(displayTitle)}</h1><div class="film-personal-rating">${canEdit ? `<button type="button" class="film-inline-value" data-edit-film="tier" aria-label="${filmPageEscape(ui("Interest tier"))}">${window.renderWatchlistTierBadge(watchlistItem.tier, { escape: filmPageEscape, modifier: watchlistItem.tierModifier }) || filmPageEscape(ui("Interest tier"))}</button>` : window.renderWatchlistTierBadge(watchlistItem.tier, { escape: filmPageEscape, modifier: watchlistItem.tierModifier })}</div></div>
        ${directorHtml ? `<p>${filmPageEscape(ui("by"))} ${directorHtml}</p>` : ""}
        ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}
`,
      actionsHtml: canEdit
        ? `${window.renderCollectionActionButton({ kind: "watchlist", label: ui("Remove from watchlist"), escape: filmPageEscape, active: true, attributes: { "data-remove-watchlist-film": true, disabled: watchlistBusy } })}${window.renderCollectionActionButton({ kind: "watched", label: ui("Mark as watched"), escape: filmPageEscape, attributes: { "data-mark-watchlist-watched": true, disabled: watchlistBusy } })}`
        : "",
    })}
    ${catalogTagsHtml()}
    ${filmCollectionSections(watchlistItem, true)}
    ${archiveMatchHtml}`;
    window.enhanceTierSetters?.(container);
    window.enhanceTierModifierToggles?.(container);
  }

  async function reloadWatchlistItem() {
    if (!watchlistFranchiseChains) {
      let franchiseCatalog = await window.loadSupabaseFranchiseCatalog();
      watchlistFranchiseChains =
        window.buildSupabaseFranchiseChains(franchiseCatalog);
    }
    watchlistItem = window.supabaseLegacyHydrationWatchlistItem(
      await window.loadSupabaseWatchlistItemDetail(watchlistItem.id),
      0,
      watchlistFranchiseChains,
    );
    render(false);
  }

  function renderPosterArea(film) {
    return window.renderFilmPoster(film, "detail");
  }

  function sortedAwards(film) {
    return [...(film.awards || [])].sort(
      (left, right) =>
        filmPagePeriodOrder(left.year) - filmPagePeriodOrder(right.year) ||
        categorySortIndex(left.category) - categorySortIndex(right.category) ||
        Number(left.placement) - Number(right.placement),
    );
  }

  function officialPeriodMatchesFilm(periodKey, film) {
    let year = String(film?.year || "");
    return !!year && window.officialResultPeriodYears(periodKey).includes(year);
  }

  function officialFilmContext(film) {
    let source = window.state?.officialResults?.["academy-awards"];
    if (!source || !film?.id) return null;
    let periods = Object.entries(source.periods || {})
      .filter(([periodKey, period]) =>
        period?.nominations?.length
          ? officialPeriodMatchesFilm(periodKey, film)
          : false,
      )
      .map(([periodKey, period]) => ({ periodKey, period }));
    if (!periods.length) return null;
    let nominations = periods.flatMap(({ periodKey, period }) =>
      period.nominations
        .filter((nomination) =>
          window
            .officialNominationFilms(nomination)
            .some((entry) => entry.filmRef?.id === film.id),
        )
        .map((nomination) => ({ ...nomination, periodKey })),
    );
    return { source, periods, nominations };
  }

  function awardCreditHtml(film, award) {
    return window.renderAwardCreditHtml({ film, award, escape: filmPageEscape })
      .html;
  }

  function officialCreditText(nominations) {
    return [
      ...new Set(
        nominations
          .flatMap((nomination) => [nomination.recipient, nomination.detail])
          .map((value) => window.formatOfficialField(value))
          .filter(Boolean),
      ),
    ].join(" · ");
  }

  function renderOfficialComparison(award, nominations) {
    let officialWinner = nominations.some((nomination) => nomination.winner);
    let hasOfficialNomination = nominations.length > 0;
    let personalWinner = Number(award?.placement) === 1;
    let agrees =
      !!award && hasOfficialNomination && personalWinner === officialWinner;
    let label = officialWinner
      ? ui("Official winner")
      : hasOfficialNomination
        ? ui("Official nominee")
        : ui("Not nominated");
    let comparisonLabel = agrees
      ? ui("Matches your Oskars result")
      : ui("Differs from your Oskars result");
    let credit = officialCreditText(nominations);
    return `<td class="film-official-comparison ${agrees ? "is-agreement" : "is-disagreement"}" title="${filmPageEscape(comparisonLabel)}"><span class="film-official-status"><span aria-hidden="true">${agrees ? "✓" : "≠"}</span> ${filmPageEscape(label)}</span>${credit ? `<small>${filmPageEscape(credit)}</small>` : ""}</td>`;
  }

  function renderAwardRows(film, awards, officialNominations = null) {
    let nominationsByCategory = new Map();
    (officialNominations || []).forEach((nomination) => {
      let nominations = nominationsByCategory.get(nomination.category) || [];
      nominations.push(nomination);
      nominationsByCategory.set(nomination.category, nominations);
    });
    let rows = awards
      .map(
        (award) => `<tr>
    <td class="detail-place">${filmPagePlacement(award.placement)}</td>
    <td><a class="category-link" href="${filmPageEscape(window.categoryPageUrl(award.category))}"><strong>${filmPageEscape(award.category)}</strong></a></td>
    <td>${awardCreditHtml(film, award)}</td>
    ${officialNominations ? renderOfficialComparison(award, nominationsByCategory.get(award.category) || []) : ""}
  </tr>`,
      )
      .concat(
        officialNominations
          ? [...nominationsByCategory.entries()]
              .filter(
                ([category]) =>
                  !awards.some((award) => award.category === category),
              )
              .sort(
                (left, right) =>
                  categorySortIndex(left[0]) - categorySortIndex(right[0]) ||
                  left[0].localeCompare(right[0]),
              )
              .map(
                ([category, nominations]) => `<tr class="film-official-only">
    <td class="detail-place">—</td>
    <td><a class="category-link" href="${filmPageEscape(window.categoryPageUrl(category))}"><strong>${filmPageEscape(category)}</strong></a></td>
    <td>—</td>
    ${renderOfficialComparison(null, nominations)}
  </tr>`,
              )
          : [],
      )
      .join("");
    return (
      rows ||
      `<tr><td colspan="${officialNominations ? 4 : 3}">${filmPageEscape(ui("No nominations"))}</td></tr>`
    );
  }

  function renderAwardGroups(film, awards, officialContext) {
    let typeOrder = { years: 0, decades: 1, centuries: 2, allTime: 3 };
    let groups = new Map();
    awards.forEach((award) => {
      let period = String(award.year || "");
      if (!groups.has(period)) groups.set(period, []);
      groups.get(period).push(award);
    });
    if (
      officialContext?.nominations.length &&
      ![...groups.values()].some((periodAwards) =>
        periodAwards.some(
          (award) =>
            window.getAwardPeriodType(award) === "years" &&
            officialPeriodMatchesFilm(award.year, film),
        ),
      )
    ) {
      groups.set(officialContext.nominations[0].periodKey, []);
    }
    return [...groups.entries()]
      .sort((left, right) => {
        let leftType = left[1][0]
          ? window.getAwardPeriodType(left[1][0])
          : "years";
        let rightType = right[1][0]
          ? window.getAwardPeriodType(right[1][0])
          : "years";
        return (
          (typeOrder[leftType] ?? 9) - (typeOrder[rightType] ?? 9) ||
          filmPagePeriodOrder(left[0]) - filmPagePeriodOrder(right[0])
        );
      })
      .map(([period, periodAwards]) => {
        let type = periodAwards[0]
          ? window.getAwardPeriodType(periodAwards[0])
          : "years";
        let label =
          type === "allTime" || period === "alltime" ? ui("All-time") : period;
        periodAwards.sort(
          (left, right) =>
            categorySortIndex(left.category) -
              categorySortIndex(right.category) ||
            Number(left.placement) - Number(right.placement),
        );
        let officialNominations =
          type === "years" && officialPeriodMatchesFilm(period, film)
            ? officialContext?.nominations || []
            : null;
        let table = window.renderLeaderboardTable({
          headers: [
            ui("Place"),
            ui("Category"),
            ui("Credit"),
            ...(officialNominations ? [ui("Real Oscars")] : []),
          ].map(filmPageEscape),
          rows: renderAwardRows(film, periodAwards, officialNominations),
          classes: "detail-awards",
        });
        return `<section class="film-award-period"><h3><a class="period-link" href="${filmPageEscape(window.periodPageUrl(type, period))}">${filmPageEscape(label)}</a></h3>${table}</section>`;
      })
      .join("");
  }

  function renderAwardMatrix(film, awards) {
    let columns = [
      { type: "years", label: ui("Year") },
      { type: "decades", label: ui("Decade") },
      { type: "centuries", label: ui("Century") },
      { type: "allTime", label: ui("All-time") },
    ];
    let byCategory = new Map();
    awards.forEach((award) => {
      let category = award.category;
      let type = window.getAwardPeriodType(award);
      if (!byCategory.has(category)) byCategory.set(category, new Map());
      if (!byCategory.get(category).has(type))
        byCategory.get(category).set(type, award);
    });
    let annualCategories = [
      ...new Set(
        awards
          .filter((award) => window.getAwardPeriodType(award) === "years")
          .map((award) => award.category),
      ),
    ];
    let categories = (
      annualCategories.length ? annualCategories : [...byCategory.keys()]
    ).sort((left, right) => categorySortIndex(left) - categorySortIndex(right));
    let headerLabels = columns.map((column) => {
      let periodAward = awards.find(
        (award) => window.getAwardPeriodType(award) === column.type,
      );
      let period = periodAward?.year;
      let periodLabel = column.type === "allTime" ? "" : period;
      return `${column.label}${periodLabel ? `<span>${filmPageEscape(periodLabel)}</span>` : ""}`;
    });
    let rows = categories
      .map((category) => {
        let categoryAwards = byCategory.get(category);
        let creditAward =
          categoryAwards?.get("years") ||
          [...(categoryAwards?.values() || [])][0];
        let credit = creditAward ? awardCreditHtml(film, creditAward) : "";
        let placements = columns
          .map((column) => {
            let award = byCategory.get(category)?.get(column.type);
            return window.renderProgressionPlacementCell(award, {
              type: column.type,
              period: award?.year,
              placement: filmPagePlacement,
              escape: filmPageEscape,
            });
          })
          .join("");
        return `<tr><th><a class="category-link" href="${filmPageEscape(window.categoryPageUrl(category))}">${filmPageEscape(category)}</a></th><td class="award-matrix-credit">${credit}</td>${placements}</tr>`;
      })
      .join("");
    return window.renderProgressionTable({
      headers: [ui("Category"), ui("Credit"), ...headerLabels],
      rows,
      emptyText: ui("No nominations"),
    });
  }

  function relationFilmLink(ref) {
    let related = ref?.id ? window.findFilmById(ref.id) : null;
    let title = related?.title || ref?.title || "";
    if (!title) return "";
    let year = related?.year || ref?.year || "";
    let href =
      related?.id || ref?.id ? window.filmPageUrl(related?.id || ref.id) : "";
    let label = `${title}${year ? ` (${year})` : ""}`;
    return href
      ? `<a class="table-film-link" href="${filmPageEscape(href)}">${filmPageEscape(label)}</a>`
      : filmPageEscape(label);
  }

  function renderFilmRelations(film) {
    let sections = [];
    let parts = (film.compositeParts || [])
      .map(relationFilmLink)
      .filter(Boolean);
    if (parts.length) {
      sections.push(
        `<div><h3>${filmPageEscape(ui("Includes"))}</h3><p>${parts.join(" · ")}</p></div>`,
      );
    }
    let canonical = relationFilmLink(film.canonicalComposite);
    if (canonical) {
      sections.push(
        `<div><h3>${filmPageEscape(ui("Part of"))}</h3><p>${canonical}</p></div>`,
      );
    }
    if (!sections.length) return "";
    return `<section class="film-relations"><h2>${filmPageEscape(ui("Film relations"))}</h2>${sections.join("")}</section>`;
  }

  function awardCreditAchievementHtml(person) {
    let awards = Array.isArray(person.awards) ? person.awards : [];
    let placements = awards
      .map((award) => Number(award.placement))
      .filter(Boolean);
    if (!placements.length) return "";
    let bestPlacement = Math.min(...placements);
    let symbol = placementEmoji[bestPlacement] || "•";
    let label =
      bestPlacement === 1
        ? ui("Winner")
        : bestPlacement === 2
          ? "2nd"
          : bestPlacement === 3
            ? "3rd"
            : ui("Nomination");
    let extra =
      awards.length > 1 ? ` · ${awards.length} ${ui("Nominations")}` : "";
    return `<span class="award-credit-achievement" title="${filmPageEscape(label + extra)}" aria-label="${filmPageEscape(label)}">${filmPageEscape(symbol)}</span>`;
  }

  function renderView(film) {
    let displayTitle = window.localizedFilmTitle(film);
    let awards = sortedAwards(film);
    let officialContext = officialFilmContext(film);
    let officialWins =
      officialContext?.nominations.filter((nomination) => nomination.winner)
        .length || 0;
    let awardScores = window.calculateAwardsScores(awards);
    let periodTypes = ["allTime", "centuries", "decades", "years"];
    let periodStats = periodTypes.map((periodType) =>
      calculateAwardStats(
        awards.filter(
          (award) => window.getAwardPeriodType(award) === periodType,
        ),
      ),
    );
    let rankValues = [
      film.allTimeRank,
      film.centuryRank,
      film.decadeRank,
      film.yearRank,
    ].map((rank, index) =>
      window.isFilmRankConfirmed(film, periodTypes[index]) ? rank : null,
    );
    let scoreValues = [
      awardScores.allTime,
      awardScores.century,
      awardScores.decade,
      awardScores.year,
    ];
    let rankCells = rankValues
      .map((rank, index) =>
        index === 0 && Number(rank) > 0 && Number(rank) <= 250
          ? `<span class="top-250-rank" title="Top 250 all-time film"><span class="top-250-star" aria-hidden="true">★</span><b>${filmPageEscape(rank)}</b><small>Top 250</small></span>`
          : `<span>${Number(rank) > 0 ? `<b>${filmPageEscape(rank)}</b>` : "—"}</span>`,
      )
      .join("");
    let scoreCells = scoreValues
      .map((score) => `<span><b>${filmPageEscape(score || 0)}</b></span>`)
      .join("");
    let statRow = (label, key) =>
      `<div class="detail-stat-row"><b>${filmPageEscape(label)}</b>${periodStats.map((entry) => `<span><b>${filmPageEscape(entry[key] || 0)}</b></span>`).join("")}</div>`;
    let officialStatsHtml = officialContext
      ? `<div class="detail-stat-summary film-official-summary"><span><b>${filmPageEscape(ui("Real Oscars"))}</b> ${officialWins} ${filmPageEscape(ui(officialWins === 1 ? "Win" : "Wins"))} · ${officialContext.nominations.length} ${filmPageEscape(ui(officialContext.nominations.length === 1 ? "Nomination" : "Nominations"))}</span></div>`
      : "";
    let statsHtml = `<div class="detail-stat-grid"><div class="detail-stat-head"><b></b><span>${filmPageEscape(ui("All-time"))}</span><span>${filmPageEscape(ui("Century"))}</span><span>${filmPageEscape(ui("Decade"))}</span><span>${filmPageEscape(ui("Year"))}</span></div><div class="detail-stat-row"><b>${filmPageEscape(ui("Rank"))}</b>${rankCells}</div><div class="detail-stat-row"><b>${filmPageEscape(ui("Score"))}</b>${scoreCells}</div>${statRow(ui("Wins"), "wins")}${statRow(ui("2nd"), "second")}${statRow(ui("3rd"), "third")}${statRow(ui("Nominations"), "nominations")}</div>${officialStatsHtml}`;
    let director = film.directors?.length
      ? film.directors
      : String(film.director || "").trim();
    let directorHtml = window.renderLinkedDirectors(
      film.directors?.length ? film : director,
      {
        escape: filmPageEscape,
        expanded: true,
      },
    );
    let metadataHtml = objectiveFilmMetadataHtml(film);
    let viewingFacts = [
      [ui("Watched"), formatWatchedDate(film.dateWatched)],
      [ui("Platform"), film.platform],
      [
        ui("Music score"),
        film.musicScore != null
          ? window.renderFilmRating?.(film.musicScore) ||
            String(film.musicScore)
          : "",
      ],
      [ui("Views"), formatNumber(film.views)],
      [
        ui("Rewatchlist"),
        film.wantToRewatch
          ? film.rewatchTier
            ? ui("Want to rewatch ({tier})", { tier: film.rewatchTier })
            : ui("Want to rewatch")
          : ui("Not marked"),
      ],
    ].filter((entry) => entry[1]);
    let viewingHtml = viewingFacts.length
      ? `<div class="film-viewing-summary">${viewingFacts.map((entry) => `<span><b>${filmPageEscape(entry[0])}</b> ${filmPageEscape(entry[1])}</span>`).join("")}</div>`
      : "";
    film.peopleByProfession ||= window.buildFilmPeopleByProfession?.(film);
    let professionHtml = window.PERSON_PROFESSION_ORDER.filter(
      (profession) => film.peopleByProfession?.[profession]?.length,
    )
      .map((profession) => {
        let people = [...film.peopleByProfession[profession]]
          .sort((left, right) =>
            window.comparePersonNamesBySurname(left.name, right.name),
          )
          .map((person) => {
            let subjectType =
              profession === "Actor"
                ? "role"
                : profession === "Songwriter"
                  ? "song"
                  : "";
            let details = person.details
              .map((detail) =>
                subjectType
                  ? `<a class="detail-subject-link" href="${filmPageEscape(window.subjectPageUrl(window.makeCreditSubjectId(subjectType, film.id, detail)))}">${filmPageEscape(detail)}</a>`
                  : filmPageEscape(detail),
              )
              .join(" · ");
            return `<div class="film-credit-person"><a href="${filmPageEscape(window.personPageUrl(person.id))}">${filmPageEscape(person.name)}</a>${awardCreditAchievementHtml(person)}</div>${details ? `<span>${details}</span>` : ""}`;
          })
          .join("");
        return `<div class="film-credit-group"><h3>${filmPageEscape(profession)}</h3>${people}</div>`;
      })
      .join("");
    let posterHtml = renderPosterArea(film);
    let relationsHtml = renderFilmRelations(film);
    let activeProjects =
      compactActive || collectionDetail
        ? scopedActiveProjects.map((row) => ({
            id: row.id,
            name: row.name,
            sourceLabel: row.source_label,
            pinned: Boolean(row.pinned),
            progress: {
              watchedCount: row.watched_count,
              total: row.total,
            },
          }))
        : window.activeProjectsForFilm?.({ archiveId: film.id }) || [];
    let projectMembershipHtml = window.renderProjectMembershipSection(
      activeProjects,
      { escape: filmPageEscape, title: ui("Active projects") },
    );
    let awardsHtml =
      awards.length || officialContext?.nominations.length
        ? `<section class="film-awards" data-collapsible-section><h2 data-collapsible-heading>${filmPageEscape(ui("Awards"))}</h2><div data-collapsible-body>
  <fieldset class="film-awards-view-controls"><legend>${filmPageEscape(ui("Display"))}</legend><label><input type="radio" name="filmAwardsView" value="periods" ${awardsView === "periods" ? "checked" : ""}> ${filmPageEscape(ui("Period tables"))}</label><label><input type="radio" name="filmAwardsView" value="matrix" ${awardsView === "matrix" ? "checked" : ""}> ${filmPageEscape(ui("Progression table"))}</label></fieldset>
  ${
    awardsView === "matrix"
      ? renderAwardMatrix(film, awards)
      : `<div class="film-award-period-grid">${renderAwardGroups(film, awards, officialContext)}</div>`
  }</div></section>`
        : "";
    let openIntake = scopedOpenIntake;
    let intakeBannerHtml = openIntake
      ? `<section class="detail-note"><div><h2>${filmPageEscape(ui("Watched-film intake is open"))}</h2></div><p>${filmPageEscape(ui("Rating, global ranking, or awards review still needs an explicit decision."))}</p><a class="button-link" href="${filmPageEscape(window.intakePageUrl(openIntake.id))}">${filmPageEscape(ui("Continue intake"))}</a></section>`
      : "";

    container.innerHTML = `${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${filmPageEscape(displayTitle)}</h1><div class="film-personal-rating">${canEdit ? `<button type="button" class="film-inline-value" data-edit-film="rating" aria-label="${filmPageEscape(ui("Rating"))}">${film.rating ? window.renderFilmRatingHtml(film, { escape: filmPageEscape }) : filmPageEscape(ui("Rating"))}</button>` : film.rating ? window.renderFilmRatingHtml(film, { escape: filmPageEscape }) : ""}</div></div>${directorHtml ? `<p>${filmPageEscape(ui("by"))} ${directorHtml}</p>` : ""}
      ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}
      `,
      actionsHtml: `<a class="button-link" href="${filmPageEscape(window.comparePageUrl([film.id]))}">${filmPageEscape(ui("Compare"))}</a>${
        canEdit
          ? `${window.renderCollectionActionButton({ kind: "watched", label: ui("Remove from watched"), escape: filmPageEscape, active: true, attributes: { "data-remove-watched-film": true } })}${window.renderCollectionActionButton({ kind: "rewatch", label: ui(film.wantToRewatch ? "Remove from rewatchlist" : "Want to rewatch"), escape: filmPageEscape, active: film.wantToRewatch, attributes: { "data-toggle-film-rewatch": true } })}${
              film.wantToRewatch && window.renderTierSetter
                ? `<label class="film-rewatch-tier-label">${filmPageEscape(ui("Rewatch tier"))} <span class="tier-select-row">${window.renderTierSetter({ tierName: "rewatchTier", tier: film.rewatchTier, modifierName: "rewatchTierModifier", modifier: film.rewatchTierModifier, tierAttributes: "data-rewatch-tier-select", escape: filmPageEscape, ui })}</span></label>`
                : ""
            }`
          : ""
      }`,
    })}
  <section class="film-personal-summary">      ${statsHtml}
      ${viewingHtml}
      ${film.review || canEdit ? `<section class="detail-note film-review-compact"><div><h2>${filmPageEscape(ui("Review"))}${canEdit ? `<button type="button" class="film-inline-add" data-edit-film="review" aria-label="${filmPageEscape(ui("Review / comment"))}">✎</button>` : ""}</h2></div><p>${filmPageEscape(film.review || "")}</p></section>` : ""}</section>
  ${intakeBannerHtml}
  ${catalogTagsHtml()}
  ${filmCollectionSections(film)}
  ${relationsHtml}
  ${projectMembershipHtml}
  ${
    professionHtml
      ? `<section class="film-credits" data-collapsible-section><h2 data-collapsible-heading>${filmPageEscape(ui("Award credits"))}</h2><div class="film-credit-grid" data-collapsible-body>${professionHtml}</div></section>`
      : ""
  }
  ${awardsHtml}`;
    window.enhanceCollapsibles?.(container);
    window.enhanceTierSetters?.(container);
    window.enhanceTierModifierToggles?.(container);
  }

  function filmEditFormHtml(film) {
    return `<form id="filmEditForm" class="film-edit-form">
    <section class="film-edit-section"><h2>${filmPageEscape(ui("Rating"))}</h2><div class="film-edit-grid">
      <label>${filmPageEscape(ui("Rating"))} ${window.renderRatingInput({ value: film.rating || "" })}</label>
    </div></section><section class="film-edit-section"><h2>${filmPageEscape(ui("Franchises"))}</h2><div class="film-edit-grid">
      <label>${filmPageEscape(ui("Add franchise"))}<input name="franchise" placeholder="${filmPageEscape(ui("Franchise name"))}"></label><label>${filmPageEscape(ui("Parent (optional)"))}<input name="parent" placeholder="${filmPageEscape(ui("Parent franchise"))}"></label><p class="field-help">${filmPageEscape(ui("New memberships can be added. Existing shared-catalog memberships cannot be removed or corrected here."))}</p>
    </div></section><section class="film-edit-section"><h2>${filmPageEscape(ui("Your tags"))}</h2><div class="film-edit-grid">
      <label class="wide">${filmPageEscape(ui("Tags"))} <input name="tags" value="${filmPageEscape(window.formatFilmTags(film.tags))}" placeholder="${filmPageEscape(ui("Noir, courtroom drama, rewatch"))}"><span class="field-help">${filmPageEscape(ui("Separate tags with commas."))}</span></label>
    </div></section><section class="film-edit-section"><h2>${filmPageEscape(ui("Review"))}</h2><div class="film-edit-grid">
      <label class="wide">${filmPageEscape(ui("Review / comment"))} <textarea name="review" rows="5" maxlength="1000">${filmPageEscape(film.review || "")}</textarea><span class="field-help">${filmPageEscape(ui("A short personal note about the film."))}</span></label>
    </div></section><section class="film-edit-section"><h2>${filmPageEscape(ui("Rewatchlist"))}</h2><div class="film-edit-grid">
      <label><input type="checkbox" name="wantToRewatch" ${film.wantToRewatch ? "checked" : ""}> ${filmPageEscape(ui("Rewatchlist"))}</label>
      <label>${filmPageEscape(ui("Rewatch tier"))} <span class="tier-select-row">${window.renderTierSetter(
        {
          tierName: "rewatchTier",
          tier: film.rewatchTier,
          modifierName: "rewatchTierModifier",
          modifier: film.rewatchTierModifier,
          escape: filmPageEscape,
          ui,
        },
      )}</span></label>
    </div></section>
    <div class="film-edit-actions"><button type="submit">${filmPageEscape(ui("Save changes"))}</button><button type="button" data-cancel-film-edit>${filmPageEscape(ui("Cancel"))}</button></div>
  </form>`;
  }

  // Keep the detail page visible while a focused personal-data draft is open.
  function openFilmEditor(field) {
    let watched = !isWatchlistDetail;
    let draft = document.createElement("div");
    draft.innerHTML = watched
      ? filmEditFormHtml(currentFilm())
      : watchlistEditFormHtml();
    let form = draft.querySelector("form");
    let sections = Array.from(form.querySelectorAll(".film-edit-section"));
    let index = watched
      ? { rating: 0, franchises: 1, tags: 2, review: 3 }[field]
      : { tier: 0, tags: 1, franchises: 2 }[field];
    sections.forEach((section, i) => {
      section.hidden = i !== index;
    });
    let dialog = document.createElement("dialog");
    dialog.className = "film-inline-dialog";
    dialog.setAttribute(
      "aria-label",
      sections[index].querySelector("h2").textContent,
    );
    dialog.append(form);
    container.append(dialog);
    dialog.addEventListener("close", () => {
      currentlyEditing = false;
      dialog.remove();
      container.querySelector(`[data-edit-film="${field}"]`)?.focus();
    });
    currentlyEditing = true;
    dialog.addEventListener("cancel", (event) => {
      if (watchlistBusy || filmEditBusy) event.preventDefault();
    });
    dialog.showModal();
    window.enhanceRatingInputs?.(dialog);
    window.enhanceTierSetters?.(dialog);
    window.enhanceTierModifierToggles?.(dialog);
  }

  // Rating and tier drafts use the current one-film projection, including its
  // row version, so opening or saving them never waits for the whole archive.
  function openFilmQuickEditor(anchor, field) {
    if (!canEdit || container.querySelector("[data-film-quick-editor]")) return;
    let target = field === "rating" ? currentFilm() : watchlistItem;
    if (!target) return;
    let panel = document.createElement("div");
    panel.className = "film-quick-popover";
    panel.setAttribute("popover", "auto");
    panel.setAttribute("data-film-quick-editor", field);
    panel.setAttribute("role", "dialog");
    panel.setAttribute(
      "aria-label",
      ui(field === "rating" ? "Rating" : "Interest tier"),
    );
    panel.innerHTML = `<form id="filmQuickEditForm">
      <div class="film-quick-heading"><strong>${filmPageEscape(ui(field === "rating" ? "Rating" : "Interest tier"))}</strong><button type="button" data-close-film-quick-editor aria-label="${filmPageEscape(ui("Close"))}">×</button></div>
      ${
        field === "rating"
          ? window.renderRatingInput({
              id: "filmQuickRating",
              value: window.renderFilmRating(target),
              starsOnly: true,
            })
          : window.renderTierSetter({
              tier: target.tier,
              modifier: target.tierModifier,
              escape: filmPageEscape,
              ui,
            })
      }
      <div class="film-quick-actions"><button type="submit">${filmPageEscape(ui("Save"))}</button></div>
    </form>`;
    let busy = false;
    function close() {
      if (!panel.isConnected) return;
      panel.hidePopover();
      panel.remove();
      currentlyEditing = false;
      anchor.setAttribute("aria-expanded", "false");
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      anchor.focus();
    }
    function position() {
      let bounds = anchor.getBoundingClientRect();
      let size = panel.getBoundingClientRect();
      let left = Math.max(
        8,
        Math.min(bounds.left, window.innerWidth - size.width - 8),
      );
      let top = bounds.bottom + 6;
      if (top + size.height > window.innerHeight - 8)
        top = bounds.top - size.height - 6;
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.max(8, top)}px`;
    }
    window.enhanceRatingInputs(panel);
    let slider = panel.querySelector('[role="slider"]');
    panel
      .querySelector("[data-close-film-quick-editor]")
      .addEventListener("click", close);
    panel.addEventListener("toggle", (event) => {
      if (event.newState === "closed") close();
    });
    panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      let controls = Array.from(panel.querySelectorAll("button, input"));
      let enabledControls = controls.filter((control) => !control.disabled);
      let values = Object.fromEntries(
        new FormData(
          /** @type {HTMLFormElement} */ (panel.querySelector("form")),
        ).entries(),
      );
      enabledControls.forEach((control) => {
        control.disabled = true;
      });
      try {
        let isCurrent =
          window.supabaseWorkspaceContext.beginWorkspaceMutation();
        if (field === "rating") {
          await window.updateSupabaseWatchedFilm(target, {
            rating: String(values.rating || ""),
          });
        } else {
          await window.setSupabaseWatchlistTier(
            target.id,
            String(values.tier || ""),
            String(values.tierModifier || ""),
          );
        }
        if (!isCurrent())
          throw new Error("Account changed while performing operation.");
        filmId = target.supabaseFilmId || filmId;
        await refreshFilmCollection(isCurrent);
        close();
        updateFilmViewUrl();
        render(false);
        container.querySelector(`[data-edit-film="${field}"]`)?.focus();
      } catch (error) {
        alert(error.message || String(error));
        enabledControls.forEach((control) => {
          control.disabled = false;
        });
      } finally {
        busy = false;
      }
    });
    container.append(panel);
    currentlyEditing = true;
    anchor.setAttribute("aria-haspopup", "dialog");
    anchor.setAttribute("aria-expanded", "true");
    window.enhanceTierSetters?.(panel);
    panel
      .querySelectorAll("[data-tier-setter-tier], [data-tier-setter-mod]")
      .forEach((button) => {
        button.setAttribute("tabindex", "0");
      });
    panel.showPopover();
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    (slider || panel.querySelector("[data-tier-setter-tier]")).focus();
  }

  // A catalog-only film has no personal record at all - it's
  // reached either via film.html?tmdb=<id> (a shared-archive card, a
  // director page's Other films grid, or a header search result built
  // before this film's real id was known) or film.html?id=<filmId> (every
  // other catalog film link, once resolved to the film's own Supabase id).
  // Rendered with a deliberately separate, much simpler template rather
  // than threading preview-mode conditionals through renderView's full
  // local-film layout, which assumes dozens of fields (medium,
  // screenplayType, rank, awards, notes...) a shared record never has.
  function currentSharedPreview() {
    if (collectionPreview) return collectionPreview;
    return previewTmdbId
      ? window.sharedArchiveCandidateFilmByTmdbId?.(previewTmdbId)
      : window.sharedArchiveCandidateFilmById?.(filmId);
  }
  function renderSharedPreview() {
    let preview = currentSharedPreview();
    if (!preview) {
      let status = window.OSKARS_SHARED_FILM_ARCHIVE_STATUS;
      if (status === "loading" || status === "idle") {
        document.title = `${ui("Loading…")} · The Oskars`;
        container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Loading…"))}</h1><p class="data-panel-status">${filmPageEscape(ui("Loading film…"))}</p></div>`;
        return;
      }
      document.title = `${ui("Film not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Film not found"))}</h1><p>${filmPageEscape(ui("This film could not be found."))}</p><a href="index.html">${filmPageEscape(ui("Return home"))}</a></div>`;
      return;
    }
    let title = window.localizedFilmTitle?.(preview) || preview.title;
    document.title = `${title} · The Oskars`;
    // Same director-link/metadata construction renderView uses below (director
    // as its own linked "by X" line under the title, not a metadata dt/dd row;
    // renderLinkedDirectors links every name to person.html regardless of
    // whether that person has any local record yet - see person.js's matching
    // preview-mode fallback), so this page reads like a real film page rather
    // than a stripped-down lookalike.
    let director = window.sharedArchiveFilmDirectorNames(preview).join(", ");
    let directorHtml = window.renderLinkedDirectors(director, {
      escape: filmPageEscape,
      expanded: true,
    });
    // Same shared objective-metadata table the Watched and Watchlist
    // detail views use (see objectiveFilmMetadataHtml above) - preview
    // already carries every field it needs (buildSharedFilmArchiveFromSupabase
    // populates type/medium/screenplayType/swedishTitle/letterboxdUrl/
    // adaptationSource alongside tmdbId/country/runtime), so this no
    // longer hand-picks just 3 of them.
    let metadataHtml = objectiveFilmMetadataHtml(preview);
    let franchiseHtml = window.renderFranchiseMembershipLinks(
      preview.franchises,
      { filmId: preview.id, escape: filmPageEscape },
    );
    let posterHtml = window.renderFilmPoster(
      { poster: preview.poster, title },
      "detail",
    );
    container.innerHTML = `${window.renderDetailHeader({
      classes: posterHtml ? "has-poster" : "",
      leadingHtml: posterHtml,
      mainClasses: "detail-header-main film-detail-main",
      mainHtml: `<div class="film-title-row"><h1>${filmPageEscape(title)}</h1><div class="film-personal-rating">${filmPageEscape(ui("Not seen"))}</div></div>${directorHtml ? `<p>${filmPageEscape(ui("by"))} ${directorHtml}</p>` : ""}
      ${metadataHtml ? `<dl class="film-metadata">${metadataHtml}</dl>` : ""}`,
      actionsHtml: canEdit
        ? `${window.renderCollectionActionButton({ kind: "watchlist", label: ui("Add to watchlist"), escape: filmPageEscape, attributes: { "data-add-shared-preview-watchlist": true } })}${window.renderCollectionActionButton({ kind: "watched", label: ui("Add to watched"), escape: filmPageEscape, attributes: { "data-add-shared-preview-watched": true } })}`
        : "",
    })}
    ${catalogTagsHtml()}
    ${franchiseHtml ? `<section class="film-franchises"><h2>${filmPageEscape(ui("Franchises"))}</h2><div class="film-franchise-links">${franchiseHtml}</div></section>` : ""}`;
  }

  // Tracked only so the post-hydration re-render below can't kick a user
  // out of an in-progress edit by hardcoding false.
  let currentlyEditing = false;
  let filmEditBusy = false;
  let stopArchiveWatch = () => {};
  function render(editing = false) {
    if (container.querySelector("[data-film-quick-editor]")) return;
    if (editing && container.querySelector(".film-inline-dialog[open]")) return;
    renderContent(editing);
    if (pendingCollectionAction) {
      container
        .querySelectorAll("[data-collection-action]")
        .forEach((button) => {
          let active =
            button.getAttribute("data-collection-action") ===
              pendingCollectionAction && pendingCollectionActive;
          button.classList.toggle("is-active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
          window.setCollectionActionButtonState(button, {
            label: button.getAttribute("aria-label"),
            busy: true,
          });
        });
    }
    if (compactReady) ensureOpenIntake();
    stopArchiveWatch();
    stopArchiveWatch = window.whenCompleteArchiveNeeded(container, () =>
      ensureFilmFullyHydrated().catch(() => {}),
    );
  }

  function renderContent(editing = false) {
    currentlyEditing = editing;
    let finishRenderTimer = window.startOskarsPerformance?.("film:render");
    if (compactActive && !compactReady) {
      container.innerHTML = '<p class="data-panel-status">Loading…</p>';
      finishRenderTimer?.("compact: loading");
      return;
    }
    let film = currentFilm();
    if (!film && (isWatchlistDetail || removedWatchlistSnapshot)) {
      if (requestedWatchedForm && canEdit) {
        requestedWatchedForm = false;
        renderWatchlistWatchedForm();
        finishRenderTimer?.("watchlist watched form");
        return;
      }
      renderWatchlistDetail();
      finishRenderTimer?.("watchlist detail");
      return;
    }
    if (!film && (previewTmdbId || filmId)) {
      renderSharedPreview();
      finishRenderTimer?.("shared preview");
      return;
    }
    if (!film) {
      document.title = `${ui("Film not found")} · The Oskars`;
      container.innerHTML = `<div class="detail-empty"><h1>${filmPageEscape(ui("Film not found"))}</h1><a href="index.html">${filmPageEscape(ui("Return home"))}</a></div>`;
      finishRenderTimer?.("not found");
      return;
    }
    editing = editing && canEdit;
    document.title = `${editing ? ui("Edit {title}", { title: film.title }) : window.localizedFilmTitle(film)} · The Oskars`;
    renderView(film);
    finishRenderTimer?.(
      `${film.id}, ${editing ? "edit" : "view"}, ${(film.awards || []).length} award(s)`,
    );
  }

  if (typeof window !== "undefined") {
    window.removeEventListener?.(
      "oskars:localechange",
      window.__oskarsFilmLocaleRender,
    );
    window.__oskarsFilmLocaleRender = () => {
      if (String(container.innerHTML || "").includes('id="filmEditForm"'))
        return;
      render(false);
    };
    window.addEventListener?.(
      "oskars:localechange",
      window.__oskarsFilmLocaleRender,
    );
  }

  container.addEventListener("click", async (event) => {
    let quickButton = event.target.closest(
      '[data-edit-film="rating"], [data-edit-film="tier"]',
    );
    if (quickButton) {
      openFilmQuickEditor(quickButton, quickButton.dataset.editFilm);
      return;
    }
    if (event.target.closest("[data-film-quick-editor]")) return;
    let collectionButton = event.target.closest(
      "[data-add-shared-preview-watchlist], [data-add-shared-preview-watched], [data-mark-watchlist-watched], [data-remove-watchlist-film], [data-remove-watched-film], [data-undo-watchlist-removal]",
    );
    if (collectionButton) {
      if (!canEdit || pendingCollectionAction) return;
      let addWatchlist = collectionButton.hasAttribute(
        "data-add-shared-preview-watchlist",
      );
      let fromWatchlist = collectionButton.hasAttribute(
        "data-mark-watchlist-watched",
      );
      let removeWatchlist = collectionButton.hasAttribute(
        "data-remove-watchlist-film",
      );
      let removeWatched = collectionButton.hasAttribute(
        "data-remove-watched-film",
      );
      let undoRemoval = collectionButton.hasAttribute(
        "data-undo-watchlist-removal",
      );
      let preview = fromWatchlist ? null : currentSharedPreview();
      let watched = currentFilm();
      let item = watchlistItem;
      if (undoRemoval && !removedWatchlistSnapshot) return;
      let owner = window.getSupabaseCurrentUser?.()?.id;
      let isCurrent = () => owner === window.getSupabaseCurrentUser?.()?.id;
      pendingCollectionAction =
        addWatchlist || removeWatchlist || undoRemoval
          ? "watchlist"
          : "watched";
      pendingCollectionActive = !removeWatchlist && !removeWatched;
      render(false);
      try {
        if (!isCurrent())
          throw new Error("Account changed while performing operation.");
        if (removeWatchlist) {
          await window.removeFromSupabaseWatchlist(item.id);
          removedWatchlistSnapshot = {
            title: item.title,
            filmId: item.supabaseFilmId,
            tier: item.tier,
            tierModifier: item.tierModifier,
            reason: item.reason,
            position: item.position,
          };
        } else if (removeWatched) {
          await window.removeFromSupabaseWatched(watched.supabaseWatchedId);
        } else if (undoRemoval) {
          await window.addToSupabaseWatchlist(
            removedWatchlistSnapshot.filmId,
            removedWatchlistSnapshot,
          );
          removedWatchlistSnapshot = null;
        } else if (addWatchlist) {
          let row = await window.addSupabaseWatchlistRecord({
            ...preview,
            supabaseFilmId: preview.supabaseFilmId || preview.id,
          });
          filmId = row.film_id;
        } else if (fromWatchlist) {
          let workflow = await window.createSupabaseWatchlistWatchedIntake(
            watchlistItem.id,
            {},
            { refreshWorkspace: false },
          );
          filmId = workflow.watched.film_id;
        } else {
          let result = await window.addSupabaseCandidateToWatched(preview, {
            refreshWorkspace: false,
          });
          if (!result.ok)
            throw new Error(result.reason || ui("Could not add this film."));
          filmId = result.filmId;
        }
        if (!removeWatchlist && !removeWatched) removedWatchlistSnapshot = null;
        await refreshFilmCollection(isCurrent);
        previewTmdbId = "";
        refreshWatchlistDetailState();
        updateFilmViewUrl();
        intakeRequestedForFilm = "";
        ensureOfficialResultsForThisFilm();
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        pendingCollectionAction = "";
        render(false);
      }
      return;
    }
    // Plain clicks, including popover light dismissal, do not need archive data.
    if (
      !event.target.closest(
        "[data-cancel-watchlist-transition], [data-toggle-film-rewatch], [data-edit-film], [data-cancel-film-edit]",
      )
    )
      return;
    // Every write action below waits on the real background full
    // hydration first (issue #617, same blanket policy as #598's own
    // Watchlist cutover) - a no-op once already hydrated (legacy mode, or
    // compact mode's eager upgrade already finished, almost always true
    // by the time a person could actually click anything).
    await ensureFilmFullyHydrated().catch(() => {});
    if (event.target.closest("[data-cancel-watchlist-transition]")) {
      render(false);
      return;
    }
    if (event.target.closest("[data-toggle-film-rewatch]")) {
      let film = currentFilm();
      let backup = window.cloneRecord(window.getSerializableState());
      try {
        window.updateFilmMetadata(
          film.id,
          Object.assign(window.filmMetadataFormValues(film), {
            wantToRewatch: !film.wantToRewatch,
          }),
        );
        // Render immediately so the button state and the tier picker card
        // update without waiting for the network round-trip.
        render(false);
        await window.updateSupabaseWatchedFilm(currentFilm(), {
          wantToRewatch: currentFilm().wantToRewatch || false,
          rewatchTier: currentFilm().rewatchTier || "",
          rewatchTierModifier: currentFilm().rewatchTierModifier || "",
        });
      } catch (err) {
        if (err.code !== "OSKARS_ACCOUNT_CHANGED")
          window.restoreSerializableState?.(backup);
        alert(err.message || String(err));
        render(false);
      }
      return;
    }
    if (event.target.closest("[data-edit-film]")) {
      openFilmEditor(
        event.target.closest("[data-edit-film]").dataset.editFilm || "rating",
      );
      return;
    }
    if (event.target.closest("[data-cancel-film-edit]")) {
      container.querySelector(".film-inline-dialog")?.close();
      return;
    }
  });

  container.addEventListener("change", async (event) => {
    if (event.target.closest("[data-film-quick-editor]")) return;
    if (
      !event.target.closest(
        '[data-rewatch-tier-select], input[name="filmAwardsView"]',
      )
    )
      return;
    await ensureFilmFullyHydrated().catch(() => {});
    // Inline rewatch-tier setter on the watched-film view (the tier setter
    // dispatches change from the hidden rewatchTier / rewatchTierModifier
    // input; both use data-rewatch-tier-select on their [data-tier-setter]).
    let rewatchTierChange = event.target.closest("[data-rewatch-tier-select]");
    if (rewatchTierChange) {
      let film = currentFilm();
      let backup = window.cloneRecord(window.getSerializableState());
      // Read both values from the DOM before re-rendering detaches the node.
      let setterRoot = rewatchTierChange.closest("[data-tier-setter]");
      let tierVal =
        setterRoot?.querySelector('input[data-tier-setter-input="tier"]')
          ?.value || "";
      let modVal =
        setterRoot?.querySelector('input[data-tier-setter-input="modifier"]')
          ?.value || "";
      try {
        window.updateFilmMetadata(
          film.id,
          Object.assign(window.filmMetadataFormValues(film), {
            rewatchTier: tierVal,
            rewatchTierModifier: modVal,
          }),
        );
        // Optimistic render before the network write so the badge updates
        // immediately, then save in the background.
        render(false);
        await window.updateSupabaseWatchedFilm(currentFilm(), {
          rewatchTier: currentFilm().rewatchTier || "",
          rewatchTierModifier: currentFilm().rewatchTierModifier || "",
        });
      } catch (err) {
        if (err.code !== "OSKARS_ACCOUNT_CHANGED")
          window.restoreSerializableState?.(backup);
        alert(err.message || String(err));
        render(false);
      }
      return;
    }
    let input = event.target.closest('input[name="filmAwardsView"]');
    if (!input) return;
    awardsView = input.value;
    updateFilmViewUrl();
    render(false);
  });

  container.addEventListener("submit", async (event) => {
    // preventDefault() first and synchronously, before the await below -
    // every branch here handles its own form programmatically, so letting
    // the browser's default submit navigation race an in-flight hydration
    // wait would reload the page out from under it.
    event.preventDefault();
    if (event.target.closest("[data-film-quick-editor]")) return;
    await ensureFilmFullyHydrated().catch(() => {});
    let transitionForm = event.target.closest("#markWatchlistWatchedForm");
    if (transitionForm) {
      let values = Object.fromEntries(
        new FormData(/** @type {HTMLFormElement} */ (transitionForm)).entries(),
      );
      let parsed = window.parseFilmRating(values.rating);
      watchlistBusy = true;
      render(false);
      try {
        let workflow = await window.createSupabaseWatchlistWatchedIntake(
          watchlistItem.id,
          {
            rating: parsed.value || null,
            ratingModifier: parsed.modifier,
            dateWatched: values.dateWatched,
            platform: values.platform,
            views: values.views,
          },
        );
        window.location.href = window.intakePageUrl(workflow.id);
      } catch (err) {
        alert(err.message || String(err));
        watchlistBusy = false;
        render(false);
      }
      return;
    }
    let watchlistForm = event.target.closest("#watchlistEditForm");
    if (watchlistForm) {
      if (watchlistBusy) return;
      watchlistBusy = true;
      let values = Object.fromEntries(
        new FormData(/** @type {HTMLFormElement} */ (watchlistForm)).entries(),
      );
      let controls = Array.from(
        watchlistForm.querySelectorAll("button, input, textarea"),
      ).filter((control) => !control.disabled);
      controls.forEach((control) => {
        control.disabled = true;
      });
      try {
        let tags = window.parseFilmTags(String(values.tags || ""));
        let previousTags = watchlistItem.tags || [];
        await window.setSupabaseWatchlistTier(
          watchlistItem.id,
          String(values.tier || ""),
          String(values.tierModifier || ""),
        );
        for (let tag of tags.filter((tag) => !previousTags.includes(tag)))
          await window.addSupabaseFilmTag(watchlistItem.supabaseFilmId, tag);
        for (let tag of previousTags.filter((tag) => !tags.includes(tag)))
          await window.removeSupabaseFilmTag(watchlistItem.supabaseFilmId, tag);
        if (String(values.franchise || "").trim())
          await window.addSupabaseFilmFranchiseMembership(
            watchlistItem.supabaseFilmId,
            String(values.franchise).trim(),
            String(values.parent || "").trim(),
          );
        await reloadWatchlistItem();
      } catch (err) {
        alert(err.message || String(err));
        controls.forEach((control) => {
          control.disabled = false;
        });
      } finally {
        watchlistBusy = false;
        if (!currentlyEditing) render(false);
      }
      return;
    }
    let form = event.target.closest("#filmEditForm");
    if (!form || filmEditBusy) return;
    filmEditBusy = true;
    let controls = Array.from(form.querySelectorAll("button"));
    controls.forEach((control) => {
      control.disabled = true;
    });
    let backup = window.cloneRecord(window.getSerializableState());
    let persistenceStarted = false;
    try {
      let film = currentFilm();
      let before = window.cloneRecord(film);
      let values = Object.assign(
        window.filmMetadataFormValues(film),
        Object.fromEntries(
          new FormData(/** @type {HTMLFormElement} */ (form)).entries(),
        ),
      );
      values.wantToRewatch = form.elements.wantToRewatch.checked;
      let addedFranchise = String(values.franchise || "").trim();
      let parentFranchise = String(values.parent || "").trim();
      values.franchises = window.formatFranchiseMemberships(
        window.normalizeFranchiseMemberships([
          ...(film.franchises || []),
          ...window.parseFranchiseMemberships(
            addedFranchise
              ? `${parentFranchise ? parentFranchise + " > " : ""}${addedFranchise}`
              : "",
          ),
        ]),
      );
      let updated = window.updateFilmMetadata(filmId, values);
      if (!updated) throw new Error(ui("Film could not be updated."));
      let nextId = updated.id;
      persistenceStarted = true;
      await window.persistSupabaseFilmForm(before, currentFilm());
      filmId = nextId;
      updateFilmViewUrl();
      render(false);
    } catch (err) {
      if (err.code !== "OSKARS_ACCOUNT_CHANGED")
        window.restoreSerializableState?.(backup);
      if (persistenceStarted) {
        await window.ensureOskarsData({ forceRefresh: true }).catch(() => {});
      }
      alert(err.message || String(err));
      // Keep the user’s draft available after a failed save.
    } finally {
      filmEditBusy = false;
      controls.forEach((control) => {
        control.disabled = false;
      });
    }
  });

  // A direct/bookmarked film.html?tmdb=... or ?id=<catalogFilmId> load can
  // land here before the async shared-archive pull finishes - re-render
  // once it does so the preview appears without a manual reload (same fix
  // as person.js's director-page Other films section). Guarded by
  // !isWatchlistDetail so an archive refresh doesn't spuriously re-render
  // a Watchlisted-detail page too, which also has filmId set.
  window.onSharedFilmArchiveChange?.(() => {
    if (!currentFilm() && !isWatchlistDetail && (previewTmdbId || filmId))
      render(false);
  });

  // officialFilmContext() (used only by renderView()'s Watched-film case)
  // is the one caller of official-results content on this page - a
  // Watchlist-detail or catalog-preview visit never reads it, so it's
  // skipped entirely there rather than fetching even a scoped slice for
  // nothing. Guarded against firing twice: once synchronously below for
  // the already-resolved legacy path, and once from compactActive's own
  // fetch .then() once isWatchlistDetail is actually known there too.
  let officialResultsRequested = false;
  function ensureOfficialResultsForThisFilm() {
    if (officialResultsRequested || isWatchlistDetail || previewTmdbId) return;
    if (!filmId) return;
    officialResultsRequested = true;
    window
      .hydrateOfficialResultsForFilm?.(filmId)
      .then(() => render(currentlyEditing));
  }

  render(false);
  ensureOfficialResultsForThisFilm();
  ensureCatalogTags();
})();
