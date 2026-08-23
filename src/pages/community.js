/**
 * @file Renders the Community directory and its client-only, revision-pinned
 * archive comparison and joint-ceremony views.
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
    return `<details class="community-sources"><summary>Source revisions</summary><ul>${profiles
      .map(
        (profile) =>
          `<li><strong>${escape(profile.ownerName)}</strong> · <code>${escape(profile.revision)}</code></li>`,
      )
      .join("")}</ul><p>These immutable revisions are read directly. Nothing is saved back to an archive.</p></details>`;
  }

  async function fetchCommunityIndex() {
    let response = await fetch("./profiles/index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let index = await response.json();
    let validation = window.validateCommunityIndex(index);
    if (!validation.valid)
      throw new Error(`Invalid directory: ${validation.errors.join("; ")}`);
    return index;
  }

  async function fetchSelectedProfiles(index, tokens) {
    let entries = new Map(index.profiles.map((profile) => [profile.slug, profile]));
    let unique = [];
    tokens.forEach((token) => {
      let parsed = window.parseCommunityProfileToken(token);
      let entry = parsed ? entries.get(parsed.slug) : null;
      if (!parsed || !entry || unique.some((item) => item.slug === parsed.slug))
        return;
      unique.push({ ...entry, revision: parsed.revision });
    });
    if (unique.length < 2)
      throw new Error("Select at least two published archives.");
    return Promise.all(
      unique.map(async (profile) => {
        let result = await window.fetchPublicProfileRevision(
          profile.slug,
          profile.revision,
        );
        if (!result.ok)
          throw new Error(
            `${profile.ownerName}'s revision could not be loaded (${result.detail || result.error}).`,
          );
        window.assertPublicData(result.data);
        return { ...profile, data: result.data };
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
                  <label class="community-select"><input type="checkbox" name="profile" value="${escape(window.communityProfileToken(profile))}"> Select</label>
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
        : `<div class="detail-empty"><h2>No published archives yet</h2><p>Profiles appear here only after their owners explicitly publish them.</p></div>`
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
    if (!rows.length) return `<p class="community-empty-note">${escape(emptyText)}</p>`;
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
      <p>A read-only comparison of ${profiles.length} pinned public archives.</p>
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

  function ceremonyCategoryHtml(category) {
    let podium = category.ranking.slice(0, 3);
    return `<article class="community-ceremony-category">
      <header><h2>${escape(category.category)}</h2><span>${category.participatingProfiles} ballots</span></header>
      <ol>${podium
        .map(
          (candidate, index) => `<li class="community-podium-${index + 1}">
            <span class="community-medal">${["🏆", "🥈", "🥉"][index]}</span>
            <div><strong>${escape(candidate.film.title)}</strong><small>${escape(candidate.film.year)} · ${(candidate.score * 100).toFixed(0)}% consensus score · ${candidate.firstPlaceVotes} first-place vote${candidate.firstPlaceVotes === 1 ? "" : "s"}</small></div>
          </li>`,
        )
        .join("")}</ol>
    </article>`;
  }

  function renderCeremony(profiles) {
    let ceremony = window.buildCommunityCeremony(profiles);
    container.innerHTML = `<header class="community-hero community-ceremony-hero">
      <p class="eyebrow">Joint ceremony</p>
      <h1>${ceremony.year ? `${escape(ceremony.year)} Community Awards` : "No shared ceremony yet"}</h1>
      <p>${ceremony.year ? `The newest annual ceremony with ballots from at least two selected archives. Each archive contributes equal total weight in every category.` : escape(ceremony.reason)}</p>
      <a href="community.html">Choose different archives</a>
    </header>
    ${
      ceremony.categories.length
        ? `<div class="community-ceremony-grid">${ceremony.categories.map(ceremonyCategoryHtml).join("")}</div>`
        : ""
    }
    <section class="community-method"><h2>How the result is calculated</h2><p>Each ballot is normalized from first to last place, then given the same total weight. Consensus score decides the order, followed by first-place votes and title for deterministic ties. Missing categories count as abstentions.</p></section>
    ${sourceHtml(profiles)}`;
  }

  try {
    let index = await fetchCommunityIndex();
    let params = new URLSearchParams(window.location.search);
    let view = params.get("view") || "";
    if (view === "compare" || view === "ceremony") {
      container.innerHTML = `<div class="detail-empty"><h1>Loading Community view…</h1></div>`;
      let profiles = await fetchSelectedProfiles(
        index,
        String(params.get("profiles") || "").split(",").filter(Boolean),
      );
      if (view === "compare") renderComparison(profiles);
      else renderCeremony(profiles);
    } else {
      renderDirectory(index);
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
