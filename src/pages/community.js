/**
 * @file Renders the live published Community directory and its read-only,
 * live-fetched archive comparison and joint-ceremony views. Every view -
 * directory, compare, and ceremony - reads straight from Supabase through
 * the isolated anonymous public reader (issue #483); none of them depend on
 * the optional legacy static-snapshot pipeline
 * (`scripts/generate-profile-artifacts.jxa.js`, `publish-profiles.yml`)
 * any more, so results always reflect each archive's current public data
 * rather than a fixed revision.
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

  function ceremonyBoardCategoryHtml(category) {
    return `<article class="community-ceremony-category">
      <header><h2>${escape(category.category)}</h2><span>${category.participatingProfiles} ballots</span></header>
      <ol>${category.ranking
        .map(
          (candidate, index) => `<li class="community-podium-${index + 1}">
            <span class="community-medal">${placementBadge(index + 1)}</span>
            <div><strong>${escape(candidate.film.title)}</strong><small>${escape(candidate.film.year)} · ${(candidate.score * 100).toFixed(0)}% consensus score · ${candidate.firstPlaceVotes} first-place vote${candidate.firstPlaceVotes === 1 ? "" : "s"}</small>${supportListHtml(candidate)}${agreementBadgeHtml(candidate)}</div>
          </li>`,
        )
        .join("")}</ol>
    </article>`;
  }

  // Nominees list alphabetically until revealed (spoiler-safe, matching the
  // personal archive's own Run ceremony stage in presentation.js) - the
  // reveal then reorders them into the full consensus ranking via the same
  // `--ceremony-placement` CSS custom property and `.ceremony-revealed`
  // class that stage already defines, rather than a second copy of that
  // mechanic.
  function ceremonyStageSlideHtml(category, index, total) {
    let rankByCandidate = new Map(
      category.ranking.map((candidate, position) => [candidate, position + 1]),
    );
    let alphabetical = [...category.ranking].sort((left, right) =>
      String(left.film.title).localeCompare(
        String(right.film.title),
        undefined,
        {
          sensitivity: "base",
        },
      ),
    );
    let nomineeItems = alphabetical
      .map((candidate) => {
        let rank = rankByCandidate.get(candidate);
        // Support (who nominated this and at what placement) and the
        // agreement badge are themselves spoilers - both already give away
        // where a candidate is heading in the consensus ranking - so they
        // stay inside .ceremony-revealed-only, hidden until Reveal ranking
        // exactly like .ceremony-placement itself.
        return `<li class="ceremony-stage-nominee${rank === 1 ? " ceremony-stage-nominee--winner" : ""}" style="--ceremony-placement:${rank}">
          <span class="ceremony-stage-nominee-body">
            <i class="ceremony-placement">${escape(placementBadge(rank))}</i>
            <b>${escape(candidate.film.title)}</b>
            <small>${escape(candidate.film.year)}</small>
            <span class="ceremony-revealed-only">${supportListHtml(candidate)}${agreementBadgeHtml(candidate)}</span>
          </span>
        </li>`;
      })
      .join("");
    return `<div class="ceremony-stage-slide" data-ceremony-slide="${index}" data-has-ranking="true"${index === 0 ? "" : " hidden"}>
      <div class="ceremony-stage-progress">Category ${index + 1} of ${total}</div>
      <h3 class="ceremony-stage-category">${escape(category.category)}</h3>
      <p class="community-ceremony-stage-meta">${category.participatingProfiles} archives nominated in this category.</p>
      <ul class="ceremony-stage-nominees">${nomineeItems}</ul>
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

  function renderCeremony(profiles) {
    let ceremony = window.buildCommunityCeremony(profiles);
    container.innerHTML = `<header class="community-hero community-ceremony-hero">
      <p class="eyebrow">Joint ceremony</p>
      <h1>${ceremony.year ? `${escape(ceremony.year)} Community Awards` : "No shared ceremony yet"}</h1>
      <p>${ceremony.year ? `The newest annual ceremony with ballots from at least two selected archives. Each archive contributes equal total weight in every category. Run the ceremony to see every archive's nominees before the consensus ranking is revealed.` : escape(ceremony.reason)}</p>
      <a href="community.html">Choose different archives</a>
    </header>
    ${
      ceremony.categories.length
        ? `<div class="ceremony-toolbar"><span class="ceremony-year-badge">${escape(ceremony.year)}</span><button type="button" class="button-link" data-ceremony-start>Run ceremony</button></div>
          <div class="community-ceremony-grid" data-ceremony-board>${ceremony.categories.map(ceremonyBoardCategoryHtml).join("")}</div>
          <div class="ceremony-stage" data-ceremony-stage hidden>
            ${ceremony.categories.map((category, index) => ceremonyStageSlideHtml(category, index, ceremony.categories.length)).join("")}
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
  }

  try {
    let params = new URLSearchParams(window.location.search);
    let view = params.get("view") || "";
    if (view === "compare" || view === "ceremony") {
      container.innerHTML = `<div class="detail-empty"><h1>Loading Community view…</h1></div>`;
      let profiles = await fetchSelectedProfiles(
        String(params.get("profiles") || "")
          .split(",")
          .filter(Boolean),
      );
      if (view === "compare") renderComparison(profiles);
      else renderCeremony(profiles);
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
