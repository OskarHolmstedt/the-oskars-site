/**
 * @file Renders the live published Community directory and its read-only,
 * live-fetched archive comparison and joint-ceremony views. Every view -
 * directory, compare, and ceremony - reads straight from Supabase through
 * the isolated anonymous public reader (issue #483); none of them depend on
 * the optional legacy static-snapshot pipeline
 * (`scripts/generate-profile-artifacts.jxa.js`, `publish-profiles.yml`)
 * any more, so results always reflect each archive's current public data
 * rather than a fixed revision.
 *
 * The joint ceremony's staged reveal shows one row per participating
 * archive with that archive's own nominees. Reveal ranking sorts each
 * row into that archive's own placement order in place (the same
 * --ceremony-placement/order mechanic presentation.js's single-archive
 * ceremony uses for one shared list, just applied independently per row
 * here) and reveals a "Consensus" section underneath with the
 * cross-archive result - an additional section, not a replacement
 * (issue #493). Every nominee (board and stage alike) renders as a
 * fixed-width poster card (`window.renderFilmPoster(film, "winner")`,
 * matching the site's other single-film-spotlight usage), or a
 * recipient's portrait wherever a nomination actually credits someone
 * with a real `person_id` (issue #491). A nominee's year label is
 * omitted for a "years" ceremony (redundant - the page's own heading
 * already states it) but kept once decade/century/all-time ceremonies
 * exist, since those can span several different years.
 */

(async function () {
  let escape = window.pageEscape;
  let container = document.getElementById("communityPage");
  let finishRender = window.startOskarsPerformance?.("community:render");

  function formatNumber(value) {
    return Number(value || 0).toLocaleString(window.currentOskarsLocale?.());
  }

  function safePosterUrl(value) {
    let url = String(value || "").trim();
    return /^https?:\/\//.test(url) ? url : "";
  }

  function sourceHtml(profiles) {
    return `<details class="community-sources"><summary>Source archives</summary><ul>${profiles
      .map(
        (profile) => `<li><strong>${escape(profile.ownerName)}</strong></li>`,
      )
      .join(
        "",
      )}</ul><p>These are live reads of each archive's current public data, not a fixed snapshot — results can change if an archive is updated later. Nothing is saved back to an archive.</p></details>`;
  }

  async function fetchSelectedProfiles(slugs) {
    let unique = [...new Set(slugs.filter(Boolean))];
    if (unique.length < 2)
      throw new Error("Select at least two published archives.");
    return Promise.all(
      unique.map(async (slug) => {
        let result = await window.fetchSupabasePublicProfileProjection(slug);
        if (!result.ok)
          throw new Error(
            `${slug}'s archive could not be loaded (${result.detail || result.error}).`,
          );
        return { slug, ownerName: result.ownerName, data: result.data };
      }),
    );
  }

  function posterDeckHtml(profile) {
    let posters = (profile.posters || []).map(safePosterUrl).filter(Boolean);
    if (!posters.length)
      return `<div class="community-card-monogram" aria-hidden="true">${escape(
        profile.ownerName.slice(0, 1).toUpperCase(),
      )}</div>`;
    return `<div class="community-card-posters" aria-hidden="true">${posters
      .map((url) => `<img src="${escape(url)}" alt="" loading="lazy">`)
      .join("")}</div>`;
  }

  function renderDirectory(index) {
    let profiles = index.profiles || [];
    container.innerHTML = `<header class="community-hero">
      <p class="eyebrow">Published archives</p>
      <h1>Community</h1>
      <p>Visit another member’s read-only archive, or select several perspectives to compare tastes and hold a joint ceremony.</p>
    </header>
    ${
      profiles.length
        ? `<form id="communitySelection"><div class="community-grid">${profiles
            .map(
              (profile) => `<article class="community-card">
                ${posterDeckHtml(profile)}
                <div class="community-card-copy">
                  <label class="community-select"><input type="checkbox" name="profile" value="${escape(profile.slug)}"> Select</label>
                  <h2>${escape(profile.ownerName)}</h2>
                  <p class="community-card-stats"><span><b>${formatNumber(profile.summary.filmCount)}</b> films</span><span><b>${formatNumber(profile.summary.ratedCount)}</b> rated</span><span><b>${formatNumber(profile.summary.winnerCount)}</b> winners</span></p>
                  <a class="button-link" href="index.html?profile=${encodeURIComponent(profile.slug)}">Visit archive</a>
                </div>
              </article>`,
            )
            .join("")}</div>
          <div class="community-actions">
            <p id="communitySelectionStatus">Select at least two archives.</p>
            <button type="button" data-community-view="compare" disabled>Compare archives</button>
            <button type="button" data-community-view="ceremony" disabled>Hold a joint ceremony</button>
          </div></form>`
        : `<div class="detail-empty"><h2>0 profiles</h2><p>Published profiles will appear here when someone chooses to share one.</p></div>`
    }`;
    let form = document.getElementById("communitySelection");
    if (!form) return;
    let update = () => {
      let count = form.querySelectorAll('input[name="profile"]:checked').length;
      form.querySelectorAll("[data-community-view]").forEach((button) => {
        button.disabled = count < 2;
      });
      document.getElementById("communitySelectionStatus").textContent =
        count < 2
          ? "Select at least two archives."
          : `${count} archives selected.`;
    };
    form.addEventListener("change", update);
    form.addEventListener("click", (event) => {
      let button = event.target.closest("[data-community-view]");
      if (!button || button.disabled) return;
      let selected = Array.from(
        form.querySelectorAll('input[name="profile"]:checked'),
      ).map((input) => input.value);
      let params = new URLSearchParams({
        view: button.dataset.communityView,
        profiles: selected.join(","),
      });
      window.location.href = `community.html?${params}`;
    });
  }

  function ratingListHtml(row) {
    return row.ratings
      .map(
        (rating) =>
          `<span><strong>${escape(rating.ownerName)}</strong> ${escape(rating.value.toFixed(1))} ★</span>`,
      )
      .join("");
  }

  function comparisonRowsHtml(rows, emptyText) {
    if (!rows.length)
      return `<p class="community-empty-note">${escape(emptyText)}</p>`;
    return `<div class="community-result-list">${rows
      .slice(0, 20)
      .map(
        (row) => `<article>
          ${safePosterUrl(row.film.poster?.url) ? `<img src="${escape(safePosterUrl(row.film.poster.url))}" alt="" loading="lazy">` : ""}
          <div><h3>${escape(row.film.title)}</h3><p>${escape(row.film.year)}</p><div class="community-rating-row">${ratingListHtml(row)}</div></div>
        </article>`,
      )
      .join("")}</div>`;
  }

  function renderComparison(profiles) {
    let comparison = window.buildCommunityComparison(profiles);
    container.innerHTML = `<header class="community-hero">
      <p class="eyebrow">Community comparison</p>
      <h1>${profiles.map((profile) => escape(profile.ownerName)).join(" & ")}</h1>
      <p>A read-only, live comparison of ${profiles.length} public archives.</p>
      <a href="community.html">Choose different archives</a>
    </header>
    <section class="community-overview">
      <div><b>${formatNumber(comparison.unionFilmCount)}</b><span>films across the group</span></div>
      <div><b>${formatNumber(comparison.sharedByAllCount)}</b><span>watched by everyone</span></div>
      <div><b>${formatNumber(comparison.agreements.length)}</b><span>close rating matches</span></div>
      <div><b>${formatNumber(comparison.disagreements.length)}</b><span>big rating splits</span></div>
    </section>
    <section class="community-results"><h2>Shared favourites</h2><p>Films rated within half a star across at least two archives, highest group average first.</p>${comparisonRowsHtml(comparison.agreements, "No close rating matches were found.")}</section>
    <section class="community-results"><h2>Beautiful disagreements</h2><p>Films whose published ratings differ by at least one and a half stars.</p>${comparisonRowsHtml(comparison.disagreements, "No large rating differences were found.")}</section>
    <section class="community-results"><h2>Shared shelf</h2><p>Films appearing in two or more selected archives.</p>${comparisonRowsHtml(comparison.overlapRows, "These archives do not currently overlap.")}</section>
    ${sourceHtml(profiles)}`;
  }

  function placementBadge(placement) {
    return ["🏆", "🥈", "🥉"][placement - 1] || `#${placement}`;
  }

  // A candidate more than one selected archive nominated in this category -
  // the "agreement" the owner asked the reveal to highlight, distinct from
  // "consensus winner" (which a single archive's unanimous pick can also be).
  function isAgreement(candidate) {
    return candidate.support.length > 1;
  }

  function supportListHtml(candidate) {
    let entries = [...candidate.support].sort(
      (left, right) => left.placement - right.placement,
    );
    return `<ul class="community-ceremony-support">${entries
      .map(
        (entry) =>
          `<li><strong>${escape(entry.ownerName)}</strong> ${escape(placementBadge(entry.placement))}</li>`,
      )
      .join("")}</ul>`;
  }

  function agreementBadgeHtml(candidate) {
    return isAgreement(candidate)
      ? `<span class="community-ceremony-agreement-badge">🤝 Nominated by ${candidate.support.length} archives</span>`
      : "";
  }

  // A category-appropriate portrait beats a poster when the nomination
  // actually credits someone (Best Director, Best Lead Actor, ...) - a
  // poster still carries no information about who's up for the award in
  // those categories. Falls through to the film's poster, then a plain
  // monogram, exactly like the directory cards already do for a profile
  // with no posters at all.
  function candidateRecipientPortrait(nominee, portraitByPersonId) {
    for (let recipient of nominee.recipients || []) {
      let url = portraitByPersonId[recipient.personId];
      if (url) return { url, name: recipient.name };
    }
    return null;
  }

  function candidateVisualHtml(nominee, portraitByPersonId) {
    let portrait = candidateRecipientPortrait(nominee, portraitByPersonId);
    if (portrait)
      return `<figure class="film-poster film-poster--winner"><img src="${escape(portrait.url)}" alt="${escape(`Portrait of ${portrait.name}`)}" loading="lazy" decoding="async"></figure>`;
    let posterHtml = window.renderFilmPoster?.(nominee.film, "winner");
    if (posterHtml) return posterHtml;
    return `<div class="film-poster film-poster--winner community-visual-monogram" aria-hidden="true">${escape(String(nominee.film?.title || "?").charAt(0))}</div>`;
  }

  function recipientCreditHtml(nominee) {
    let names = (nominee.recipients || []).map((recipient) => recipient.name);
    return names.length
      ? `<small class="ceremony-recipient-credit">${escape(names.join(", "))}</small>`
      : "";
  }

  // A year-ceremony's every nominee necessarily shares the ceremony's own
  // year (already stated in the page's own <h1>), so repeating it on
  // every card is noise - omitted only for "years" ceremonies. A future
  // decade/century/all-time ceremony can span several different years,
  // where the label becomes meaningful again (issue #493).
  function consensusMetaHtml(candidate, periodType) {
    let yearPrefix =
      periodType === "years" ? "" : `${escape(candidate.film.year)} · `;
    return `<small>${yearPrefix}${(candidate.score * 100).toFixed(0)}% consensus score · ${candidate.firstPlaceVotes} first-place vote${candidate.firstPlaceVotes === 1 ? "" : "s"}</small>`;
  }

  function ceremonyBoardCategoryHtml(category, portraitByPersonId, periodType) {
    return `<article class="community-ceremony-category">
      <header><h2>${escape(category.category)}</h2><span>${category.participatingProfiles} ballots</span></header>
      <ol>${category.ranking
        .map(
          (candidate, index) => `<li class="community-podium-${index + 1}">
            <span class="community-medal">${placementBadge(index + 1)}</span>
            ${candidateVisualHtml(candidate, portraitByPersonId)}
            <div><strong>${escape(candidate.film.title)}</strong>${consensusMetaHtml(candidate, periodType)}${recipientCreditHtml(candidate)}${supportListHtml(candidate)}${agreementBadgeHtml(candidate)}</div>
          </li>`,
        )
        .join("")}</ol>
    </article>`;
  }

  // One row per archive with that archive's own nominees, in that
  // archive's own placement order. Pre-reveal, this is the only thing
  // shown - alphabetical-feeling but actually placement-ordered, no
  // badges - since one person's own ballot order isn't itself a spoiler
  // for the joint outcome. On reveal it stays visible (unlike the old
  // full-swap design) and each row sorts into that person's own
  // placement via the same --ceremony-placement/order mechanic
  // presentation.js's single-archive ceremony already uses for one
  // shared list, just applied independently per row here (issue #493).
  function personRowHtml(personEntry, portraitByPersonId, periodType) {
    let items = personEntry.entries
      .map(
        (entry) => `<li class="ceremony-stage-nominee${entry.placement === 1 ? " ceremony-stage-nominee--winner" : ""}" style="--ceremony-placement:${entry.placement}">
          ${candidateVisualHtml(entry, portraitByPersonId)}
          <span class="ceremony-stage-nominee-body">
            <i class="ceremony-placement" aria-label="${escape(`Placement ${entry.placement}`)}">${escape(placementBadge(entry.placement))}</i>
            <b>${escape(entry.film.title)}</b>
            ${periodType === "years" ? "" : `<small>${escape(entry.film.year)}</small>`}
            ${recipientCreditHtml(entry)}
          </span>
        </li>`,
      )
      .join("");
    return `<div class="ceremony-stage-person-row">
      <h4 class="ceremony-stage-person-name">${escape(personEntry.ownerName)}</h4>
      <ul class="ceremony-stage-nominees">${items}</ul>
    </div>`;
  }

  // The cross-archive consensus, one row per position - support (who
  // nominated this and at what placement) and the agreement badge give
  // away the joint outcome, so this whole block stays hidden behind
  // .ceremony-revealed-only until Reveal ranking. Unlike the original
  // #491 design, this no longer replaces the by-person rows above - it
  // appears as an additional section underneath them once both are
  // visible (issue #493).
  function positionRowHtml(candidate, position, portraitByPersonId, periodType) {
    return `<div class="ceremony-stage-position-row${position === 1 ? " ceremony-stage-position-row--winner" : ""}">
      <span class="ceremony-stage-position-badge">${escape(placementBadge(position))}</span>
      ${candidateVisualHtml(candidate, portraitByPersonId)}
      <div class="ceremony-stage-position-body">
        <b>${escape(candidate.film.title)}</b>
        ${consensusMetaHtml(candidate, periodType)}
        ${recipientCreditHtml(candidate)}
        ${supportListHtml(candidate)}
        ${agreementBadgeHtml(candidate)}
      </div>
    </div>`;
  }

  function ceremonyStageSlideHtml(category, index, total, portraitByPersonId, periodType) {
    let byPersonHtml = category.byPerson
      .map((personEntry) =>
        personRowHtml(personEntry, portraitByPersonId, periodType),
      )
      .join("");
    let byPositionHtml = category.ranking
      .map((candidate, position) =>
        positionRowHtml(candidate, position + 1, portraitByPersonId, periodType),
      )
      .join("");
    return `<div class="ceremony-stage-slide" data-ceremony-slide="${index}" data-has-ranking="true"${index === 0 ? "" : " hidden"}>
      <div class="ceremony-stage-progress">Category ${index + 1} of ${total}</div>
      <h3 class="ceremony-stage-category">${escape(category.category)}</h3>
      <p class="community-ceremony-stage-meta">${category.participatingProfiles} archives nominated in this category.</p>
      <div class="ceremony-stage-by-person">${byPersonHtml}</div>
      <h4 class="ceremony-stage-consensus-heading ceremony-revealed-only">Consensus</h4>
      <div class="ceremony-stage-by-position ceremony-revealed-only">${byPositionHtml}</div>
    </div>`;
  }

  // Reuses presentation.js's own board/stage toggle and reveal/reorder
  // mechanic verbatim (.ceremony-toolbar/.ceremony-board/.ceremony-stage/
  // .ceremony-revealed) so joint ceremonies behave like the familiar
  // personal-archive Run ceremony instead of a second, unrelated
  // implementation - only the per-candidate agreement/support detail below
  // it is new.
  function wireCeremonyStage(scope) {
    let board = scope.querySelector("[data-ceremony-board]");
    let stage = scope.querySelector("[data-ceremony-stage]");
    let startButton = scope.querySelector("[data-ceremony-start]");
    let slides = stage
      ? [...stage.querySelectorAll("[data-ceremony-slide]")]
      : [];
    let revealButton = stage?.querySelector("[data-ceremony-reveal]");
    let nextButton = stage?.querySelector("[data-ceremony-next]");
    let prevButton = stage?.querySelector("[data-ceremony-prev]");
    let exitButton = stage?.querySelector("[data-ceremony-exit]");
    let index = 0;

    function show(newIndex) {
      index = Math.max(0, Math.min(newIndex, slides.length - 1));
      slides.forEach((slide, slideIndex) => {
        slide.hidden = slideIndex !== index;
      });
      let revealed = slides[index]?.classList.contains("ceremony-revealed");
      if (revealButton) revealButton.disabled = Boolean(revealed);
      if (prevButton) prevButton.disabled = index === 0;
      if (nextButton) nextButton.disabled = index === slides.length - 1;
    }
    function reveal() {
      slides[index]?.classList.add("ceremony-revealed");
      if (revealButton) revealButton.disabled = true;
    }
    function reset() {
      slides.forEach((slide) => slide.classList.remove("ceremony-revealed"));
      show(0);
    }
    startButton?.addEventListener("click", () => {
      if (board) board.hidden = true;
      if (stage) stage.hidden = false;
      reset();
    });
    exitButton?.addEventListener("click", () => {
      if (stage) stage.hidden = true;
      if (board) board.hidden = false;
      reset();
    });
    revealButton?.addEventListener("click", reveal);
    nextButton?.addEventListener("click", () => show(index + 1));
    prevButton?.addEventListener("click", () => show(index - 1));
  }

  function yearPickerHtml(ceremony, slugs) {
    if (ceremony.years.length < 2) return "";
    let options = ceremony.years
      .map(
        (year) =>
          `<option value="${escape(year)}"${year === ceremony.year ? " selected" : ""}>${escape(year)}</option>`,
      )
      .join("");
    return `<label class="ceremony-year-picker">Year <select data-ceremony-year-picker>${options}</select></label>`;
  }

  function ceremonyRecipientPersonIds(ceremony) {
    let ids = new Set();
    ceremony.categories.forEach((category) =>
      category.ranking.forEach((candidate) =>
        (candidate.recipients || []).forEach(
          (recipient) => recipient.personId && ids.add(recipient.personId),
        ),
      ),
    );
    return [...ids];
  }

  async function renderCeremony(profiles, slugs) {
    let requestedYear = new URLSearchParams(window.location.search).get(
      "year",
    );
    let ceremony = window.buildCommunityCeremony(profiles, requestedYear);
    let portraitByPersonId = {};
    try {
      portraitByPersonId = await window.fetchCommunityPortraits?.(
        ceremonyRecipientPersonIds(ceremony),
      ) || {};
    } catch (err) {
      console.warn("Community ceremony portraits:", err);
    }
    container.innerHTML = `<header class="community-hero community-ceremony-hero">
      <p class="eyebrow">Joint ceremony</p>
      <h1>${ceremony.year ? `${escape(ceremony.year)} Community Awards` : "No shared ceremony yet"}</h1>
      <p>${ceremony.year ? `${ceremony.years.length > 1 ? "Every year with ballots from at least two selected archives is available below." : "The only annual ceremony with ballots from at least two selected archives."} Each archive contributes equal total weight in every category. Run the ceremony to see every archive's nominees before the consensus ranking is revealed.` : escape(ceremony.reason)}</p>
      ${yearPickerHtml(ceremony, slugs)}
      <a href="community.html">Choose different archives</a>
    </header>
    ${
      ceremony.categories.length
        ? `<div class="ceremony-toolbar"><span class="ceremony-year-badge">${escape(ceremony.year)}</span><button type="button" class="button-link" data-ceremony-start>Run ceremony</button></div>
          <div class="community-ceremony-grid" data-ceremony-board>${ceremony.categories.map((category) => ceremonyBoardCategoryHtml(category, portraitByPersonId, ceremony.periodType)).join("")}</div>
          <div class="ceremony-stage" data-ceremony-stage hidden>
            ${ceremony.categories.map((category, index) => ceremonyStageSlideHtml(category, index, ceremony.categories.length, portraitByPersonId, ceremony.periodType)).join("")}
            <div class="ceremony-stage-controls">
              <button type="button" data-ceremony-prev>Previous category</button>
              <button type="button" data-ceremony-reveal>Reveal ranking</button>
              <button type="button" data-ceremony-next>Next category</button>
              <button type="button" data-ceremony-exit>Exit ceremony</button>
            </div>
          </div>`
        : ""
    }
    <section class="community-method"><h2>How the result is calculated</h2><p>Each ballot is normalized from first to last place, then given the same total weight. Consensus score decides the order, followed by first-place votes and title for deterministic ties. Missing categories count as abstentions. A film nominated by more than one selected archive is marked as an agreement.</p></section>
    ${sourceHtml(profiles)}`;
    if (ceremony.categories.length) wireCeremonyStage(container);
    container
      .querySelector("[data-ceremony-year-picker]")
      ?.addEventListener("change", (event) => {
        let params = new URLSearchParams({
          view: "ceremony",
          profiles: slugs.join(","),
          year: event.target.value,
        });
        window.location.href = `community.html?${params}`;
      });
  }

  try {
    let params = new URLSearchParams(window.location.search);
    let view = params.get("view") || "";
    if (view === "compare" || view === "ceremony") {
      container.innerHTML = `<div class="detail-empty"><h1>Loading Community view…</h1></div>`;
      let slugs = String(params.get("profiles") || "")
        .split(",")
        .filter(Boolean);
      let profiles = await fetchSelectedProfiles(slugs);
      if (view === "compare") renderComparison(profiles);
      else await renderCeremony(profiles, slugs);
    } else {
      renderDirectory(await window.fetchSupabaseCommunityDirectory());
    }
  } catch (err) {
    console.warn("Community:", err);
    container.innerHTML = `<header class="community-hero"><p class="eyebrow">Published archives</p><h1>Community</h1></header><div class="detail-empty"><h2>Community is unavailable</h2><p>The published-profile directory could not be loaded. ${escape(err.message || err)}</p><button type="button" data-community-retry>Retry</button></div>`;
    container
      .querySelector("[data-community-retry]")
      ?.addEventListener("click", () => window.location.reload());
  } finally {
    finishRender?.();
  }
})();
