/**
 * @file Builds annual and director/franchise Oskars ballots through one
 * category editor. Annual progress and mutations use supabase-workspace;
 * collection membership, progress, and isolated persistence use
 * supabase-collection-ballots. Both paths require the signed-in account gate.
 *
 * Category-specific eligibility pre-filtering (issue #589): Best Animated
 * Picture, Best Original/Adapted Screenplay, and Best International Picture
 * each use TMDB-derived signals (films.medium, films.screenplay_type,
 * films.original_language, films.primary_country) to pre-filter the pool.
 * Only confirmed mismatches hide films; missing/unknown metadata leaves
 * a film eligible, mirroring validateAward()'s "unknown -> warning, not
 * error" posture (src/domain/awards.js). A "Show N <filtered-reason>"
 * button in each category's pool heading toggles visibility of the
 * filtered-out films, letting the user reveal and nominate them when
 * the TMDB metadata is wrong.
 *
 * Each pool card also has a global exclude button (⊗) that hides the film
 * from every category's pool at once for the session - useful when a film
 * is not a contender for any award that year. A separate restore control
 * returns globally hidden films to every category. Both pools use title order.
 *
 * Also drops tie support (two nominees sharing one placement) - confirmed
 * by reading the previous implementation in full that this page never sets
 * planNominationInsertion's `tie` option; that branch belongs to a
 * different page's tooling this cutover doesn't touch.
 *
 * insertSupabasePersonalNomination()/deleteSupabasePersonalNomination()
 * do the real work (atomic placement-bump-cascade / shift-up via a
 * Postgres RPC - see their migration), matching the previous implementation's
 * planNominationInsertion/applyNominationPlacementPlan bump-cascade
 * exactly, just server-side instead of a window.state clone-and-diff.
 */

(function () {
  let escape = window.pageEscape;
  let container = document.getElementById("awardsYearPage");
  let canEdit = window.oskarsCapabilities?.().canEdit ?? true;
  let year = String(window.pageQueryParam?.("year") || "").trim();
  let collectionType = String(window.pageQueryParam?.("collection") || "");
  let collectionId = String(window.pageQueryParam?.("id") || "");
  let isCollection = Boolean(collectionType);
  let valid = isCollection
    ? ["director", "franchise"].includes(collectionType) &&
      Boolean(collectionId)
    : /^\d{4}$/.test(year);
  let collectionSession = null;
  let ballotLabel = year;
  let collectionReturnUrl = "";

  let personalAwardId = null;
  let progress = null; // supabaseAnnualAwardReviewProgress(year) result
  let candidateCreditIndex = new Map();
  let tmdbCreditCache = new Map(); // "filmId\ncategory" -> {role, people}|null
  let tmdbCreditFetching = new Set();
  let tmdbCastCache = new Map(); // filmId -> cast[]
  let tmdbCastFetching = new Set();
  let castExpanded = false; // whether the open form's cast list shows more than the first page
  let castGenderFilter = true; // whether a gendered Actor/Actress category's cast list is narrowed to its expected gender

  // ---- Bracket state (session-only) ----
  let expandedCategory;
  let pendingNominee = null; // { category, filmId, placement, creditStatus? }
  let pendingNomineeGeneration = 0; // bumped on every pendingNominee reassignment, incl. null
  let editingNominee = null; // { category, nominationId, placement }
  let excludedFromPool = new Map(); // category -> Set<filmId>
  let showRestCategories = new Set(); // categories where filtered-out films are currently visible
  let globallyExcluded = new Set(); // filmIds hidden from ALL category pools for this session

  let CAPACITIES = { picture: 10, category: 5 };

  // Every pendingNominee reassignment (including closing it back to null)
  // goes through here so a stale async caller can tell "the slot changed"
  // apart from "the same category/filmId/placement got reopened" - which
  // field-value comparison alone can't distinguish.
  function setPendingNominee(value) {
    pendingNominee = value;
    pendingNomineeGeneration++;
    return pendingNomineeGeneration;
  }

  function resetCastListState() {
    castExpanded = false;
    castGenderFilter = true;
  }

  function excludedFromPoolFor(category) {
    return excludedFromPool.get(category) || new Set();
  }

  function capacityFor(category) {
    return category === "Best Picture"
      ? CAPACITIES.picture
      : CAPACITIES.category;
  }

  function yearWatchedFilms() {
    let workspace = window.getSupabaseWorkspace();
    return (
      isCollection
        ? (collectionSession?.films || []).slice()
        : (workspace?.watched || [])
            .filter((row) => String(row.films?.year) === year)
            .map((row) => row.films)
    ).sort(
      (a, b) =>
        String(a.title || "").localeCompare(String(b.title || ""), undefined, {
          sensitivity: "base",
          numeric: true,
        }) || String(a.id).localeCompare(String(b.id)),
    );
  }

  function filmPrimaryCountry(film) {
    return (
      window.normalizeCountryName?.(film?.primary_country) ||
      window.countryListValues?.(film?.country)?.[0] ||
      ""
    );
  }

  // Only a *confirmed* mismatch hides a film from a category's pool - a
  // film with no screenplay_type/medium/language recorded yet (most of the
  // archive before TMDB classification signals are populated) stays eligible
  // rather than disappearing outright, mirroring validateAward()'s existing
  // "unknown -> warning, not error" posture (src/domain/awards.js) rather
  // than inventing a stricter rule here.
  function categoryEligible(film, category) {
    if (category === "Best Original Screenplay")
      return film.screenplay_type !== "adapted";
    if (category === "Best Adapted Screenplay")
      return film.screenplay_type !== "original";
    if (category === "Best Animated Picture")
      return (
        !film.medium || film.medium === "unknown" || film.medium === "animation"
      );
    if (category === "Best International Picture") {
      // Pre-filter confirmed English-language or US/UK primary-country films.
      // A film with no language or country data stays eligible (unknown =
      // not hidden), matching the same unknown-is-eligible rule above.
      let lang = film.original_language;
      let country = filmPrimaryCountry(film);
      let isEnglish = lang === "en";
      let isUsOrUk =
        country &&
        (country.includes("United States") ||
          country.includes("United Kingdom"));
      if (isEnglish || isUsOrUk) return false;
    }
    return true;
  }

  // Returns a short reason badge explaining why a film was pre-filtered out
  // of this category's pool (e.g. "Live-action", "Adapted", "English").
  // Returns null when the film passes (shouldn't appear in filtered pool).
  function filterLabel(film, category) {
    if (category === "Best Animated Picture") {
      if (
        film.medium &&
        film.medium !== "unknown" &&
        film.medium !== "animation"
      )
        return film.medium === "hybrid" ? "Hybrid" : "Live-action";
    }
    if (category === "Best Original Screenplay") {
      if (film.screenplay_type === "adapted") return "Adapted";
    }
    if (category === "Best Adapted Screenplay") {
      if (film.screenplay_type === "original") return "Original";
    }
    if (category === "Best International Picture") {
      let lang = film.original_language;
      let country = filmPrimaryCountry(film);
      if (lang === "en") return "English";
      if (country && country.includes("United States")) return "US";
      if (country && country.includes("United Kingdom")) return "UK";
    }
    return null;
  }

  // Returns the category-specific label for the "show filtered films" button,
  // e.g. "Show 5 live-action films" instead of a generic "Show the rest".
  function filteredPoolButtonLabel(count, category) {
    if (category === "Best Animated Picture")
      return `Show ${count} live-action film${count === 1 ? "" : "s"}`;
    if (category === "Best Original Screenplay")
      return `Show ${count} adapted screenplay${count === 1 ? "" : "s"}`;
    if (category === "Best Adapted Screenplay")
      return `Show ${count} original screenplay${count === 1 ? "" : "s"}`;
    if (category === "Best International Picture")
      return `Show ${count} English-language film${count === 1 ? "" : "s"}`;
    return `Show ${count} filtered out`;
  }

  function candidateCreditOptions(filmId, category) {
    return (
      window.awardCandidateCreditOptions?.(
        candidateCreditIndex,
        filmId,
        category,
      ) || []
    );
  }

  function tmdbCreditCacheKey(filmId, category) {
    return `${filmId}\n${category}`;
  }

  // Merges the shared-catalog/personal-nomination suggestions above with a
  // point-of-nomination TMDB crew lookup (issue: "not have to write in the
  // cinematographer manually for a film that no one else has nominated
  // them for") - only consulted once no known local credit already
  // answers the question, and only ever for a film/category pair whose
  // form is actually open (ensureTmdbCreditFetched below), never
  // prefetched for every pool candidate.
  function combinedCreditSuggestions(filmId, category) {
    let known = candidateCreditOptions(filmId, category);
    if (known.length) return known;
    let cached = tmdbCreditCache.get(tmdbCreditCacheKey(filmId, category));
    if (!cached?.people?.length) return [];
    return [
      {
        recipient: cached.people.map((person) => person.name).join(", "),
        detail: "",
        source: "tmdb-crew",
      },
    ];
  }

  // Fire-and-forget: fetches this one film's TMDB crew for this category
  // if (and only if) nothing local already answers it, caching either the
  // result or the fact that TMDB had nothing either - re-renders once
  // resolved so an open nomination form picks up the suggestion.
  async function ensureTmdbCreditFetched(film, category) {
    if (!film?.id || !window.awardCategoryCreditJob?.(category)) return;
    let key = tmdbCreditCacheKey(film.id, category);
    if (tmdbCreditCache.has(key) || tmdbCreditFetching.has(key)) return;
    if (candidateCreditOptions(film.id, category).length) return;
    tmdbCreditFetching.add(key);
    let result = await window.fetchTmdbCategoryCredit?.(film, category);
    tmdbCreditFetching.delete(key);
    tmdbCreditCache.set(key, result || null);
    if (result) render();
  }

  // After a nomination is saved, persists any TMDB-fetched crew whose name
  // the confirmed recipient text actually includes (a user who overrides
  // the suggestion with a different name shouldn't have the TMDB name
  // written to the shared catalog anyway) - so the next person to
  // nominate this film for this category never needs a TMDB round trip.
  function persistMatchedTmdbCredit(filmId, category, recipient) {
    let cached = tmdbCreditCache.get(tmdbCreditCacheKey(filmId, category));
    if (!cached?.people?.length) return;
    let recipientNames = new Set(
      (window.splitRecipientNames?.(recipient) || []).map((name) =>
        name.trim().toLowerCase(),
      ),
    );
    if (!recipientNames.size) return;
    let matched = cached.people.filter((person) =>
      recipientNames.has(person.name.trim().toLowerCase()),
    );
    if (!matched.length) return;
    window
      .persistSupabaseFilmCredits?.(filmId, cached.role, matched)
      .catch(() => {});
  }

  function isActingCategory(category) {
    return (
      window.creditSubjectType?.(
        category,
        window.PERSON_AWARD_PROFESSIONS?.[category],
      ) === "role"
    );
  }

  // Fire-and-forget: fetches this film's full TMDB cast once an acting
  // category's nomination form is open - the acting equivalent of
  // ensureTmdbCreditFetched, but there's no single "known credit" to
  // check first (a billing-sorted list to pick from, not an auto-fill,
  // per the user's own framing: "whole cast is problematic" for a single
  // suggestion, "but it would be nice to see a list of cast").
  async function ensureTmdbCastFetched(film, category) {
    if (!film?.id || !isActingCategory(category)) return;
    if (tmdbCastCache.has(film.id) || tmdbCastFetching.has(film.id)) return;
    tmdbCastFetching.add(film.id);
    let cast = await window.fetchTmdbFilmCast?.(film);
    tmdbCastFetching.delete(film.id);
    tmdbCastCache.set(film.id, cast || []);
    if (cast?.length) render();
  }

  let CAST_PAGE_SIZE = 8;

  // Renders a billing-sorted, expandable cast list for the open acting-
  // category form - reuses the same data-setup-award-credit-suggestion
  // click handler the crew/personal-nomination suggestion buttons above
  // already use (fills recipient + Role from the clicked entry), so no
  // new click wiring is needed for picking a cast member. A gendered
  // category (Best Lead/Supporting Actor vs Actress) defaults to hiding
  // only cast confidently tagged as the *opposite* binary gender via
  // window.ACTOR_CATEGORY_GENDER - non-binary and untagged cast stay
  // eligible for either category. TMDB's gender field is also often just
  // unset, so a filter that would hide the *entire* cast is never applied
  // (falls back to everyone), and a toggle always stays available to see
  // the rest.
  function castListHtml(filmId, category) {
    if (!isActingCategory(category)) return "";
    let cast = tmdbCastCache.get(filmId);
    if (!cast?.length) return "";
    let expectedGender = window.ACTOR_CATEGORY_GENDER?.[category];
    // A gendered category only excludes cast confidently tagged as the
    // *opposite* binary gender - non-binary (3) and not-set (0) stay
    // eligible for either category, since there's no signal they don't
    // belong, and TMDB has no non-binary Actor/Actress category of its
    // own to defer to either way.
    let oppositeGender =
      expectedGender === 1 ? 2 : expectedGender === 2 ? 1 : null;
    let matching = oppositeGender
      ? cast.filter((person) => person.gender !== oppositeGender)
      : cast;
    let isFiltered =
      Boolean(oppositeGender) &&
      castGenderFilter &&
      matching.length > 0 &&
      matching.length < cast.length;
    let visible = isFiltered ? matching : cast;
    let visibleCount = castExpanded
      ? visible.length
      : Math.min(CAST_PAGE_SIZE, visible.length);
    let remaining = visible.length - visibleCount;
    let items = visible
      .slice(0, visibleCount)
      .map(
        (person) =>
          `<button type="button" class="setup-year-cast-member" data-setup-award-credit-suggestion data-recipient="${escape(person.name)}" data-detail="${escape(person.character || "")}">${person.profilePath ? `<img src="https://image.tmdb.org/t/p/w185${escape(person.profilePath)}" alt="">` : `<span aria-hidden="true">${escape(person.name.charAt(0))}</span>`}<span><b>${escape(person.name)}</b>${person.character ? `<small>as ${escape(person.character)}</small>` : ""}</span></button>`,
      )
      .join("");
    let showMore =
      remaining > 0
        ? `<button type="button" class="sort-order-button" data-setup-award-cast-more>Show ${escape(remaining)} more</button>`
        : "";
    let genderToggle =
      oppositeGender && matching.length > 0 && matching.length < cast.length
        ? `<button type="button" class="sort-order-button" data-setup-award-cast-gender-toggle>${isFiltered ? `Show all ${escape(cast.length)} cast` : "Show likely matches only"}</button>`
        : "";
    return `<div class="setup-year-cast-list"><span>Cast, by billing</span>${genderToggle}<div class="setup-year-cast-grid">${items}</div>${showMore}</div>`;
  }

  function creditFieldsHtml(
    category,
    recipient,
    detail,
    suggestions = [],
    filmId,
  ) {
    let detailField =
      window.creditDetailFieldHtml?.(category, detail, { escape }) || "";
    // A single suggestion (the common case: one director, one composer,
    // one cinematographer) prefills the field directly rather than
    // requiring a click - matches renderPendingNomineeForm's existing
    // single-suggestion prefill, now also honored here for the edit form.
    if (!recipient && suggestions.length === 1)
      recipient = suggestions[0].recipient;
    let fromTmdb = suggestions.some(
      (suggestion) => suggestion.source === "tmdb-crew",
    );
    let suggestionsHtml =
      suggestions.length > 1
        ? `<div class="setup-year-credit-suggestions"><span>${fromTmdb ? "From TMDB" : "Known credits"}</span><div>${suggestions.map((suggestion) => `<button type="button" data-setup-award-credit-suggestion data-recipient="${escape(suggestion.recipient)}" data-detail="${escape(suggestion.detail || "")}"><b>${escape(suggestion.recipient)}</b>${suggestion.detail ? `<small>${escape(suggestion.detail)}</small>` : ""}</button>`).join("")}</div></div>`
        : "";
    let castHtml = filmId ? castListHtml(filmId, category) : "";
    return `${suggestionsHtml}${castHtml}<label>Recipient(s)<input name="recipient" value="${escape(recipient || "")}"></label>${detailField}`;
  }

  function nominationRecipientText(nomination) {
    return (nomination.personal_nomination_recipients || [])
      .map((row) => row.recipient_name)
      .join(", ");
  }

  function renderCreditHtml(category, nomination) {
    let recipient = nominationRecipientText(nomination);
    let detail = nomination.detail || "";
    if (recipient && detail)
      return `${escape(recipient)} <span class="credit-divider">·</span> ${escape(detail)}`;
    return escape(recipient || detail);
  }

  function renderPoolCard(film, category, filterBadge) {
    let knownCredits = candidateCreditOptions(film.id, category);
    let creditHint = knownCredits.length
      ? `<span class="setup-year-pool-credit">${knownCredits.map((option) => `${escape(option.recipient)}${option.detail ? ` · ${escape(option.detail)}` : ""}`).join("<br>")}</span>`
      : "";
    let filterBadgeHtml = filterBadge
      ? `<span class="setup-year-pool-filter-badge">${escape(filterBadge)}</span>`
      : "";
    return `<article class="film-card setup-year-pool-card${filterBadge ? " is-filtered-out" : ""}" draggable="true" data-setup-award-film="${escape(film.id)}" data-setup-award-add="${escape(category)}" tabindex="0" role="button">
      <span class="setup-year-pool-poster">${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="">` : `<span aria-hidden="true">${escape(String(film.title || "?").charAt(0))}</span>`}</span>
      <span class="setup-year-pool-title">${escape(film.title)}</span>
      ${filterBadgeHtml}
      ${creditHint}
      <button type="button" class="card-remove-button" aria-label="Hide ${escape(film.title)} from this category" title="Not a contender - hide from this pool" data-setup-pool-exclude>×</button>
      <button type="button" class="card-remove-button card-super-exclude-button" aria-label="Hide ${escape(film.title)} from all categories" title="Remove from all award pools" data-setup-pool-super-exclude="${escape(film.id)}">⊗</button>
    </article>`;
  }

  function renderNomineeRow(nomination, category) {
    let film = nomination.films || {};
    let placementLabel =
      window.placementEmoji?.[nomination.placement] || nomination.placement;
    let rankBadge = `<span class="setup-year-nominee-rank ${window.placementEmoji?.[nomination.placement] ? "is-medal" : "is-numeric"}" aria-label="Placement ${escape(nomination.placement)}">${escape(placementLabel)}</span>`;
    let poster = `<span class="setup-year-nominee-poster">${film.poster_url ? `<img src="${escape(film.poster_url)}" alt="">` : `<span aria-hidden="true">${escape(String(film.title || "?").charAt(0))}</span>`}</span>`;
    let filmTitle = `<span class="setup-year-nominee-title">${escape(film.title || "Unknown film")}</span>`;
    let removeButton = `<button type="button" class="card-remove-button" aria-label="Remove ${escape(film.title || "film")}" title="Remove" data-setup-award-remove data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(film.id)}" data-setup-award-placement="${escape(nomination.placement)}">×</button>`;
    if (!canEdit) removeButton = "";
    let isEditing = canEdit && editingNominee?.nominationId === nomination.id;
    if (isEditing) {
      let editSuggestions = combinedCreditSuggestions(
        nomination.film_id,
        category,
      );
      return `<article class="setup-year-nominee is-editing" data-setup-award-target="${escape(nomination.placement)}">
        ${poster}
        ${rankBadge}
        ${removeButton}
        <div class="setup-year-nominee-copy">
          ${filmTitle}
          <form class="setup-year-credit-form" data-setup-award-credit-form data-setup-award-mode="edit" data-setup-award-nomination-id="${escape(nomination.id)}" data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(nomination.film_id)}">
            ${creditFieldsHtml(category, nominationRecipientText(nomination), nomination.detail || "", editSuggestions, nomination.film_id)}
            <button type="submit">Save</button>
            <button type="button" data-setup-award-credit-cancel>Cancel</button>
          </form>
        </div>
      </article>`;
    }
    let credit = renderCreditHtml(category, nomination);
    let creditControl =
      category === "Best Picture"
        ? ""
        : canEdit
          ? `<button type="button" class="setup-year-credit-edit" data-setup-award-credit-edit data-setup-award-nomination-id="${escape(nomination.id)}" data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(nomination.film_id)}">${credit || "Add credit"}</button>`
          : credit
            ? `<span class="setup-year-credit-display">${credit}</span>`
            : "";
    return `<article class="setup-year-nominee"${canEdit ? ' draggable="true"' : ""} data-setup-award-film="${escape(nomination.film_id)}" data-setup-award-target="${escape(nomination.placement)}">
      ${poster}
      ${rankBadge}
      ${removeButton}
      <div class="setup-year-nominee-copy">${filmTitle}${creditControl}</div>
    </article>`;
  }

  function renderCategoryRow(entry, films) {
    let category = entry.category;
    let nominations = entry.nominations;
    let review = entry.review;
    let capacity = capacityFor(category);
    let isExpanded = expandedCategory === category;
    let statusClass = review
      ? "is-full"
      : nominations.length
        ? "is-started"
        : "is-empty";
    let toggleLabel = isExpanded ? "Collapse" : review ? "Review" : "Fill";
    let header = `<div class="setup-year-category-header">
      <a class="category-link" href="${escape(window.categoryPageUrl?.(category) || "#")}">${escape(window.localizedCategoryName?.(category) || category)}</a>
      <span class="setup-year-category-progress ${statusClass}">${review?.status === "none" ? "None" : `${escape(nominations.length)}/${escape(capacity)}`}</span>
      <button type="button" class="sort-order-button" data-setup-award-toggle="${escape(category)}">${escape(toggleLabel)}</button>
    </div>`;
    if (!isExpanded)
      return `<div class="setup-year-category-row">${header}</div>`;

    let nomineeRowsHtml = nominations
      .map((nomination) => renderNomineeRow(nomination, category))
      .join("");
    let multiNominee = window.isMultiNomineeCategory?.(category);
    let nominatedIds = multiNominee
      ? new Set()
      : new Set(nominations.map((n) => n.film_id));
    let excludedIds = excludedFromPoolFor(category);
    // Films the user globally excluded (⊗ button) are hidden from every pool.
    let eligibleFilms = films.filter((film) => !globallyExcluded.has(film.id));
    let pool = eligibleFilms.filter(
      (film) =>
        !nominatedIds.has(film.id) &&
        !excludedIds.has(film.id) &&
        categoryEligible(film, category),
    );
    // Films pre-filtered by category rules — not user-hidden, not nominated,
    // but failing categoryEligible. Shown in a separate sub-section when the
    // user toggles "Show N live-action films" (or equivalent).
    let filteredPool = eligibleFilms.filter(
      (film) =>
        !nominatedIds.has(film.id) &&
        !excludedIds.has(film.id) &&
        !categoryEligible(film, category),
    );
    let isPending = pendingNominee?.category === category;
    let isAutomatic = isPending && pendingNominee.creditStatus;
    let poolHtml =
      isPending && !isAutomatic
        ? renderPendingNomineeForm(films)
        : pool.length
          ? `<div class="film-grid setup-year-pool-grid">${pool.map((film) => renderPoolCard(film, category)).join("")}</div>`
          : `<p class="setup-year-section-empty">No more of ${escape(ballotLabel)}'s watched films are eligible for this category.</p>`;
    let fullNotice =
      nominations.length >= capacity
        ? `<p class="setup-year-category-full">${escape(window.localizedCategoryName?.(category) || category)} is full. Drop a film onto a nominee above to bump it in, or remove one first.</p>`
        : "";
    let restoreHtml =
      excludedIds.size && canEdit
        ? `<button type="button" class="sort-order-button" data-setup-pool-restore="${escape(category)}">Show ${escape(excludedIds.size)} hidden</button>`
        : "";
    let restoreAllHtml =
      globallyExcluded.size && canEdit
        ? `<button type="button" class="sort-order-button" data-setup-pool-restore-all>Restore films hidden from all categories (${escape(globallyExcluded.size)})</button>`
        : "";
    // "Show N live-action films" / "Show N adapted screenplays" etc.
    let showRestHtml =
      filteredPool.length && canEdit
        ? `<button type="button" class="sort-order-button setup-year-show-filtered${showRestCategories.has(category) ? " is-active" : ""}" data-setup-pool-show-filtered="${escape(category)}">${escape(filteredPoolButtonLabel(filteredPool.length, category))}</button>`
        : "";
    // When toggled, render the filtered sub-section with reason badges.
    let filteredPoolHtml =
      showRestCategories.has(category) && filteredPool.length
        ? `<div class="setup-year-filtered-pool">
            <div class="film-grid setup-year-pool-grid setup-year-pool-grid--filtered">${filteredPool.map((film) => renderPoolCard(film, category, filterLabel(film, category))).join("")}</div>
          </div>`
        : "";
    let pendingStatus = isAutomatic ? renderPendingNomineeStatus(films) : "";
    let ballotActions = canEdit
      ? `<div class="setup-ballot-actions">${nominations.length ? `<button type="button" data-setup-award-finish="${escape(category)}">Finish category</button>` : `<button type="button" class="button-secondary" data-setup-award-none="${escape(category)}">${isCollection ? "No award for this collection" : "No award this year"}</button>`}${pendingStatus}</div>`
      : "";
    let poolSection = canEdit
      ? `<h4>Eligible films from ${escape(ballotLabel)} · A–Z ${restoreHtml}${restoreAllHtml}${showRestHtml}</h4>${poolHtml}${filteredPoolHtml}`
      : "";

    return `<div class="setup-year-category-row is-expanded">
      ${header}
      <div class="board full-width setup-year-board" data-setup-award-board="${escape(category)}">
        <div class="board-content">
          <div class="board-nominees">${nomineeRowsHtml || `<p class="setup-year-section-empty">No nominees yet.</p>`}</div>
        </div>
      </div>
      ${canEdit ? fullNotice : ""}
      ${ballotActions}
      ${poolSection}
    </div>`;
  }

  function renderBracketSection() {
    let films = yearWatchedFilms();
    if (!progress) return "";
    if (expandedCategory === undefined)
      expandedCategory = progress.nextCategory || null;
    let rows = progress.categories
      .map((entry) => renderCategoryRow(entry, films))
      .join("");
    let nav = progress.categories
      .map((entry) => {
        let label =
          window.localizedCategoryName?.(entry.category) || entry.category;
        let capacity = capacityFor(entry.category);
        let filled = Math.min(entry.nominations.length, capacity);
        let percent = Math.round((filled / capacity) * 100);
        let progressLabel = `${filled} of ${capacity} slots filled${entry.reviewed ? ", reviewed" : ""}`;
        return `<button type="button" class="setup-ballot-nav-item${entry.reviewed ? " is-complete" : ""}${entry.category === progress.nextCategory ? " is-next" : ""}${entry.category === expandedCategory ? " is-active" : ""}" style="--ballot-progress:${percent}%" data-setup-award-toggle="${escape(entry.category)}"${entry.category === expandedCategory ? ' aria-expanded="true"' : ' aria-expanded="false"'}><span class="setup-ballot-progress-ring" role="img" aria-label="${escape(progressLabel)}" title="${escape(progressLabel)}"><b>${escape(filled)}</b></span><span class="setup-ballot-nav-label">${escape(label)}</span></button>`;
      })
      .join("");
    let ceremony =
      isCollection && progress.complete
        ? `<section class="setup-ceremony-summary"><h3>Your ${escape(ballotLabel)} ballot is complete</h3><a class="button-link" href="${escape(collectionReturnUrl)}">View collection awards</a></section>`
        : progress.complete
          ? `<section class="setup-ceremony-summary"><span class="eyebrow">The envelope is sealed</span><h3>Your ${escape(year)} ceremony is ready</h3><div class="setup-ballot-actions"><a class="button-link" href="presentation.html?scope=period&amp;id=year:${escape(year)}">Run the ceremony →</a><a class="button-link" href="${escape(window.periodPageUrl?.("decade", window.getDecadeKey(year)) || "#")}&amp;view=awards">Continue to decade awards</a></div></section>`
          : `<p class="setup-ballot-next">Next: ${escape(window.localizedCategoryName?.(progress.nextCategory) || progress.nextCategory)} · ${escape(progress.reviewed)} / ${escape(progress.total)} reviewed</p>`;
    return `<nav class="setup-ballot-nav" aria-label="Ballot categories">${nav}</nav><div class="setup-year-category-list">${rows}</div>${ceremony}`;
  }

  function renderPendingNomineeStatus(films) {
    let film = films.find(
      (candidate) => candidate.id === pendingNominee.filmId,
    );
    let saving = pendingNominee.creditStatus === "saving";
    return `<span role="status">${saving ? "Adding nomination" : "Finding recipient"}… ${escape(film?.title || pendingNominee.filmId)}</span>
      ${saving ? "" : '<button type="button" data-setup-award-credit-cancel>Cancel</button>'}`;
  }

  function renderPendingNomineeForm(films) {
    let { category, filmId, placement } = pendingNominee;
    let film = films.find((candidate) => candidate.id === filmId);
    let suggestions = combinedCreditSuggestions(filmId, category);
    let defaultCredit = suggestions.length === 1 ? suggestions[0] : null;
    return `<form class="setup-year-credit-form" data-setup-award-credit-form data-setup-award-mode="add" data-setup-award-category="${escape(category)}" data-setup-award-film-id="${escape(filmId)}" data-setup-award-placement="${escape(placement)}">
      <p>Nominate ${escape(film?.title || filmId)} for ${escape(window.localizedCategoryName?.(category) || category)}</p>
      ${creditFieldsHtml(category, defaultCredit?.recipient || "", defaultCredit?.detail || "", suggestions, filmId)}
      <button type="submit">Add</button>
      <button type="button" data-setup-award-credit-cancel>Cancel</button>
    </form>`;
  }

  // A category with a single-recipient credit job (Director, Cinematographer,
  // Composer, Editor, Screenwriter(s), Costume Designer, Visual Effects
  // Supervisor) has one inarguable answer - possibly several people (two
  // co-directors, two credited screenwriters), but never a pick among
  // options, unlike the acting categories' billing-sorted cast list. Once
  // that answer resolves, add it straight to the board rather than making
  // the user re-confirm and click Add on a form that was only ever going
  // to hold that one already-known answer - matching how Best Picture and
  // Best International Picture already skip the form entirely.
  async function autoResolveTmdbCredit(
    film,
    category,
    filmId,
    placement,
    generation,
  ) {
    await ensureTmdbCreditFetched(film, category);
    // The user may have cancelled, moved on to a different film/category, or
    // reopened this exact same slot again while the TMDB round trip was in
    // flight - compare by generation, not field values, since reopening the
    // identical category/filmId/placement would pass a value comparison but
    // is still a different (later) invocation than this one.
    if (generation !== pendingNomineeGeneration) return;
    let suggestions = combinedCreditSuggestions(filmId, category);
    if (suggestions.length === 1) {
      pendingNominee.creditStatus = "saving";
      render();
      await addNominee(
        category,
        filmId,
        placement,
        suggestions[0].recipient,
        suggestions[0].detail || "",
      );
    } else {
      // TMDB had no match (missing tmdb_id, no crew data) - fall back to
      // the ordinary form for manual entry.
      pendingNominee.creditStatus = null;
      render();
    }
  }

  function beginNominee(category, filmId, placement) {
    if (!canEdit || pendingNominee?.creditStatus) return;
    if (category === "Best Picture") {
      addNominee(category, filmId, placement, "", "");
      return;
    }
    if (category === "Best International Picture") {
      let film = yearWatchedFilms().find(
        (candidate) => candidate.id === filmId,
      );
      addNominee(category, filmId, placement, filmPrimaryCountry(film), "");
      return;
    }
    let film = yearWatchedFilms().find((candidate) => candidate.id === filmId);
    if (window.awardCategoryCreditJob?.(category)) {
      let known = candidateCreditOptions(filmId, category);
      if (known.length === 1) {
        addNominee(
          category,
          filmId,
          placement,
          known[0].recipient,
          known[0].detail || "",
        );
        return;
      }
      if (!known.length) {
        let generation = setPendingNominee({
          category,
          filmId,
          placement,
          creditStatus: "loading",
        });
        editingNominee = null;
        resetCastListState();
        render();
        autoResolveTmdbCredit(film, category, filmId, placement, generation);
        return;
      }
      // known.length > 1: genuinely conflicting local credits (e.g. two
      // different recipients recorded for this film/category before) -
      // fall through to the ordinary form so the user picks between them.
    }
    setPendingNominee({ category, filmId, placement });
    editingNominee = null;
    resetCastListState();
    render();
    ensureTmdbCreditFetched(film, category);
    ensureTmdbCastFetched(film, category);
  }

  async function refreshProgress() {
    progress = isCollection
      ? window.collectionBallotProgress(collectionSession)
      : await window.supabaseAnnualAwardReviewProgress(year);
    personalAwardId = progress.personalAwardId;
  }

  async function addNominee(category, filmId, placement, recipient, detail) {
    if (!canEdit) return;
    try {
      let recipients = recipient
        ? window.splitRecipientNames?.(recipient) || [recipient]
        : [];
      if (isCollection)
        await window.changeSupabaseCollectionBallot(collectionSession, {
          type: "insert",
          category,
          placement,
          filmId,
          detail: detail || "",
          recipients,
        });
      else
        await window.insertSupabasePersonalNomination(
          personalAwardId,
          category,
          placement,
          capacityFor(category),
          filmId,
          detail || "",
          recipients,
        );
      if (!isCollection) await window.reopenSupabaseAwardReview(year, category);
      setPendingNominee(null);
      if (recipient) persistMatchedTmdbCredit(filmId, category, recipient);
      await refreshProgress();
      render();
    } catch (error) {
      if (
        pendingNominee?.category === category &&
        pendingNominee.filmId === filmId &&
        pendingNominee.placement === placement
      ) {
        pendingNominee.creditStatus = null;
        render();
      }
      alert(error.message || String(error));
    }
  }

  async function saveNomineeCredit(
    nominationId,
    category,
    filmId,
    recipient,
    detail,
  ) {
    if (!canEdit) return;
    try {
      let recipients = recipient
        ? window.splitRecipientNames?.(recipient) || [recipient]
        : [];
      if (isCollection)
        await window.changeSupabaseCollectionBallot(collectionSession, {
          type: "credit",
          category,
          nominationId,
          recipients,
          detail,
        });
      else {
        await window.updateSupabaseNominationRecipients(
          nominationId,
          recipients,
        );
        if (detail !== undefined)
          await window.updateSupabaseNominationDetail(nominationId, detail);
      }
      editingNominee = null;
      if (recipient) persistMatchedTmdbCredit(filmId, category, recipient);
      await refreshProgress();
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  async function moveNominee(category, filmId, fromPlacement, toPlacement) {
    if (!canEdit || fromPlacement === toPlacement) return;
    try {
      if (isCollection)
        await window.changeSupabaseCollectionBallot(collectionSession, {
          type: "move",
          category,
          filmId,
          placement: fromPlacement,
          toPlacement,
        });
      else
        await window.moveSupabasePersonalNomination(
          personalAwardId,
          category,
          fromPlacement,
          toPlacement,
          filmId,
        );
      await refreshProgress();
      render();
    } catch (error) {
      alert(error.message || String(error));
    }
  }

  function nextOpenPlacement(category) {
    let entry = progress.categories.find(
      (candidate) => candidate.category === category,
    );
    return Math.min(
      (entry?.nominations.length || 0) + 1,
      capacityFor(category),
    );
  }

  async function removeNominee(category, filmId, placement) {
    if (!canEdit) return;
    let numericPlacement = Number(placement);
    let previousProgress = progress;
    let optimisticProgress = window.withoutAnnualBallotNomination(
      progress,
      category,
      filmId,
      numericPlacement,
    );
    if (optimisticProgress === progress) return;
    let previousExcluded = excludedFromPool.has(category)
      ? new Set(excludedFromPool.get(category))
      : null;
    progress = optimisticProgress;
    if (!excludedFromPool.has(category))
      excludedFromPool.set(category, new Set());
    excludedFromPool.get(category).add(filmId);
    setPendingNominee(null);
    editingNominee = null;
    render();

    let deletionPersisted = false;
    try {
      if (isCollection)
        await window.changeSupabaseCollectionBallot(collectionSession, {
          type: "delete",
          category,
          filmId,
          placement: numericPlacement,
        });
      else
        await window.deleteSupabasePersonalNomination(
          personalAwardId,
          category,
          numericPlacement,
          filmId,
        );
      deletionPersisted = true;
      if (!isCollection) await window.reopenSupabaseAwardReview(year, category);
      await refreshProgress();
      render();
    } catch (error) {
      if (!deletionPersisted) {
        progress = previousProgress;
        if (previousExcluded) excludedFromPool.set(category, previousExcluded);
        else excludedFromPool.delete(category);
        render();
      } else {
        try {
          await refreshProgress();
          render();
        } catch (_) {}
      }
      alert(error.message || String(error));
    }
  }

  function toggleCategory(category) {
    expandedCategory = expandedCategory === category ? null : category;
    setPendingNominee(null);
    editingNominee = null;
    render();
  }

  function render() {
    let finish = window.startOskarsPerformance?.("awardsYear:render");
    let header = window.renderDetailHeader({
      mainHtml: `<span class="eyebrow">${isCollection ? "Collection awards" : "Annual awards"}</span><h1>${escape(ballotLabel)}</h1><p>${isCollection ? "Build an independent ballot from this collection’s watched films." : "Build the ballot category by category, then run the ceremony."}</p>`,
      actionsHtml: isCollection
        ? `<a class="button-link" href="${escape(collectionReturnUrl)}">View collection awards</a><a class="button-link" href="build.html">Build your Oskars</a>`
        : `<a class="button-link" href="build.html">Build your Oskars</a><a class="button-link" href="${escape(window.yearRankingPageUrl?.(year) || "#")}">Rank this year</a><a class="button-link" href="${escape(window.periodPageUrl?.("years", year) || "#")}">View ${escape(year)}</a>`,
    });
    container.innerHTML = `${header}
      <section class="setup-year-section">
        <h2>${isCollection ? "Collection ballot" : "Annual ballot"}</h2>
        ${renderBracketSection()}
      </section>`;
    finish?.(`${ballotLabel} · ${progress.reviewed} reviewed`);
  }

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.closest("[data-setup-pool-exclude]")) return;
    if (event.target.closest("[data-setup-pool-super-exclude]")) return;
    let addTarget = event.target.closest("[data-setup-award-add]");
    if (addTarget) {
      event.preventDefault();
      let category = addTarget.dataset.setupAwardAdd;
      beginNominee(
        category,
        addTarget.dataset.setupAwardFilm,
        nextOpenPlacement(category),
      );
    }
  });

  container.addEventListener("click", (event) => {
    let toggleTarget = event.target.closest("[data-setup-award-toggle]");
    if (toggleTarget)
      return toggleCategory(toggleTarget.dataset.setupAwardToggle);

    let finishTarget = event.target.closest("[data-setup-award-finish]");
    let noneTarget = event.target.closest("[data-setup-award-none]");
    if (finishTarget || noneTarget) {
      if (!canEdit) return;
      let target = finishTarget || noneTarget;
      if (target.disabled) return;
      target.disabled = true;
      let category =
        (finishTarget || noneTarget).dataset.setupAwardFinish ||
        (finishTarget || noneTarget).dataset.setupAwardNone;
      (async () => {
        try {
          if (isCollection)
            await window.changeSupabaseCollectionBallot(collectionSession, {
              type: "review",
              category:
                target.dataset.setupAwardFinish ||
                target.dataset.setupAwardNone,
              status: finishTarget ? "complete" : "none",
            });
          else
            await window.setSupabaseAwardReview(
              year,
              category,
              finishTarget ? "complete" : "none",
            );
          expandedCategory = undefined;
          await refreshProgress();
          render();
        } catch (error) {
          target.disabled = false;
          alert(error.message || String(error));
        }
      })();
      return;
    }

    let poolExcludeTarget = event.target.closest("[data-setup-pool-exclude]");
    if (poolExcludeTarget) {
      let card = poolExcludeTarget.closest("[data-setup-award-film]");
      let category = card?.dataset.setupAwardAdd;
      let filmId = card?.dataset.setupAwardFilm;
      if (category && filmId) {
        if (!excludedFromPool.has(category))
          excludedFromPool.set(category, new Set());
        excludedFromPool.get(category).add(filmId);
        render();
      }
      return;
    }

    // Super-exclude: hide this film from every category pool for the session.
    // Checked before the card's own add-to-board handler below, since this
    // button sits inside the card element and would otherwise trigger a nomination.
    let superExcludeTarget = event.target.closest(
      "[data-setup-pool-super-exclude]",
    );
    if (superExcludeTarget) {
      let filmId = superExcludeTarget.dataset.setupPoolSuperExclude;
      if (filmId) {
        globallyExcluded.add(filmId);
        render();
      }
      return;
    }

    if (event.target.closest("[data-setup-pool-restore-all]")) {
      globallyExcluded.clear();
      render();
      return;
    }

    let poolRestoreTarget = event.target.closest("[data-setup-pool-restore]");
    if (poolRestoreTarget) {
      excludedFromPool.delete(poolRestoreTarget.dataset.setupPoolRestore);
      render();
      return;
    }

    // Toggle filtered-pool visibility for this category.
    let showFilteredTarget = event.target.closest(
      "[data-setup-pool-show-filtered]",
    );
    if (showFilteredTarget) {
      let cat = showFilteredTarget.dataset.setupPoolShowFiltered;
      if (showRestCategories.has(cat)) {
        showRestCategories.delete(cat);
      } else {
        showRestCategories.add(cat);
      }
      render();
      return;
    }

    let removeTarget = event.target.closest("[data-setup-award-remove]");
    if (removeTarget) {
      removeNominee(
        removeTarget.dataset.setupAwardCategory,
        removeTarget.dataset.setupAwardFilmId,
        removeTarget.dataset.setupAwardPlacement,
      );
      return;
    }

    let creditEditTarget = event.target.closest(
      "[data-setup-award-credit-edit]",
    );
    if (creditEditTarget) {
      editingNominee = {
        nominationId: creditEditTarget.dataset.setupAwardNominationId,
      };
      setPendingNominee(null);
      resetCastListState();
      render();
      let category = creditEditTarget.dataset.setupAwardCategory;
      let film = yearWatchedFilms().find(
        (candidate) =>
          candidate.id === creditEditTarget.dataset.setupAwardFilmId,
      );
      ensureTmdbCreditFetched(film, category);
      ensureTmdbCastFetched(film, category);
      return;
    }

    if (event.target.closest("[data-setup-award-credit-cancel]")) {
      setPendingNominee(null);
      editingNominee = null;
      resetCastListState();
      render();
      return;
    }

    if (event.target.closest("[data-setup-award-cast-more]")) {
      castExpanded = true;
      render();
      return;
    }

    if (event.target.closest("[data-setup-award-cast-gender-toggle]")) {
      castGenderFilter = !castGenderFilter;
      castExpanded = false;
      render();
      return;
    }

    let creditSuggestion = event.target.closest(
      "[data-setup-award-credit-suggestion]",
    );
    if (creditSuggestion) {
      let form = creditSuggestion.closest("[data-setup-award-credit-form]");
      let recipientInput = form?.querySelector('[name="recipient"]');
      let detailInput = form?.querySelector('[name="detail"]');
      if (recipientInput)
        recipientInput.value = creditSuggestion.dataset.recipient || "";
      if (detailInput)
        detailInput.value = creditSuggestion.dataset.detail || "";
      recipientInput?.focus();
      return;
    }

    let addTarget = event.target.closest("[data-setup-award-add]");
    if (addTarget && !event.target.closest("a")) {
      let category = addTarget.dataset.setupAwardAdd;
      beginNominee(
        category,
        addTarget.dataset.setupAwardFilm,
        nextOpenPlacement(category),
      );
    }
  });

  container.addEventListener("submit", (event) => {
    let form = event.target.closest("[data-setup-award-credit-form]");
    if (!form) return;
    event.preventDefault();
    let recipient = form.querySelector('[name="recipient"]')?.value || "";
    let detailInput = form.querySelector('[name="detail"]');
    let detail = detailInput ? detailInput.value : undefined;
    if (form.dataset.setupAwardMode === "edit") {
      saveNomineeCredit(
        form.dataset.setupAwardNominationId,
        form.dataset.setupAwardCategory,
        form.dataset.setupAwardFilmId,
        recipient,
        detail,
      );
    } else {
      addNominee(
        form.dataset.setupAwardCategory,
        form.dataset.setupAwardFilmId,
        Number(form.dataset.setupAwardPlacement),
        recipient,
        detail || "",
      );
    }
  });

  let draggedFilmId = null;
  container.addEventListener("dragstart", (event) => {
    if (!canEdit) return;
    let card = event.target.closest("[data-setup-award-film]");
    if (!card) return;
    draggedFilmId = card.dataset.setupAwardFilm;
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  container.addEventListener("dragend", (event) => {
    event.target
      .closest("[data-setup-award-film]")
      ?.classList.remove("dragging");
    draggedFilmId = null;
  });
  container.addEventListener("dragover", (event) => {
    if (!canEdit) return;
    let target = draggedFilmId
      ? event.target.closest("[data-setup-award-target]")
      : null;
    if (!target) return;
    event.preventDefault();
    target.classList.add("drop-target");
  });
  container.addEventListener("dragleave", (event) => {
    event.target
      .closest("[data-setup-award-target]")
      ?.classList.remove("drop-target");
  });
  container.addEventListener("drop", (event) => {
    if (!canEdit || !draggedFilmId) return;
    let target = event.target.closest("[data-setup-award-target]");
    if (!target) return;
    event.preventDefault();
    target.classList.remove("drop-target");
    let category = target.closest("[data-setup-award-board]")?.dataset
      .setupAwardBoard;
    if (!category) return;
    let toPlacement = Number(target.dataset.setupAwardTarget);
    // Dropping an already-nominated film back onto its own category is a
    // reorder, not a new addition - beginNominee()/addNominee() below
    // assume the dropped film isn't nominated yet (an unconditional insert,
    // which would have duplicated the film at both placements). Nominee
    // cards are draggable alongside pool cards for exactly this case
    // (issue - previously only pool cards had draggable/data-setup-award-
    // film at all, so a nominee could never be picked up to begin with).
    let entry = progress.categories.find(
      (candidate) => candidate.category === category,
    );
    let existing = entry?.nominations.find(
      (nomination) => nomination.film_id === draggedFilmId,
    );
    if (existing) {
      moveNominee(
        category,
        draggedFilmId,
        Number(existing.placement),
        toPlacement,
      );
    } else {
      beginNominee(category, draggedFilmId, toPlacement);
    }
  });

  async function boot() {
    if (!valid) {
      document.title = "Build annual awards · The Oskars";
      container.innerHTML = `<div class="detail-empty"><h1>${isCollection ? "Collection not found" : "Year not found"}</h1><a href="index.html">Return home</a></div>`;
      return;
    }
    document.title = `Build ${year} awards · The Oskars`;
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    try {
      if (isCollection) {
        collectionSession = await window.loadSupabaseCollectionBallotSession(
          collectionType,
          collectionId,
        );
        ballotLabel = collectionSession.name;
        collectionReturnUrl = `${collectionType === "director" ? window.personPageUrl(collectionId) : window.franchisePageUrl(collectionId)}&collection-view=awards`;
        document.title = `Build ${ballotLabel} awards · The Oskars`;
      } else await window.loadSupabaseWorkspace();
      let filmIds = yearWatchedFilms().map((film) => film.id);
      let [creditSource] = await Promise.all([
        window.loadSupabaseAwardCandidateCredits(filmIds),
        refreshProgress(),
      ]);
      candidateCreditIndex =
        window.buildAwardCandidateCreditIndex(creditSource);
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>Could not load this ballot</h2><p>${escape(error.message || String(error))}</p></section>`;
    }
  }

  boot();
})();
