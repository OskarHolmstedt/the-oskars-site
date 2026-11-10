/** @file Renders the dedicated Trophy Cabinet, lifetime milestone stats, persona progression, and kind filters. */

(function () {
  let escape = window.pageEscape || ((s) => String(s ?? ""));
  let ui =
    window.uiText ||
    ((text, params) => {
      let result = String(text || "");
      if (params) {
        for (let [key, val] of Object.entries(params)) {
          result = result.replace(new RegExp(`\\{${key}\\}`, "g"), val);
        }
      }
      return result;
    });

  window.load?.();
  let container = document.getElementById("trophiesPage");
  if (!container) return;

  document.title = `${ui("Trophies")} · The Oskars`;

  let finishRenderTimer = window.startOskarsPerformance?.("trophies:render");

  let allTrophies = window.allTrophiesData
    ? window.allTrophiesData()
    : window.collectionTrophiesData
      ? window.collectionTrophiesData()
      : [];

  let earnedTrophyCount = 0;
  let totalTrophyCount = 0;
  let highestLevel = 0;
  let highestRankName = ui("None");
  let highestRankBadge = "";

  allTrophies.forEach((col) => {
    col.tierList?.forEach((tier) => {
      totalTrophyCount += 1;
      if (tier.earned) earnedTrophyCount += 1;
    });
    if (col.activeTier && col.activeTier.level > highestLevel) {
      highestLevel = col.activeTier.level;
      highestRankBadge = col.activeTier.badge || "";
      highestRankName =
        col.activeTier.tier === "sycophant"
          ? ui("Sycophant")
          : col.activeTier.tier === "completionist"
            ? ui("Completionist")
            : ui("Essentialist");
    }
  });

  let earnedPersonaTitles = window.getEarnedPersonaTitles
    ? window.getEarnedPersonaTitles()
    : [];

  let highestPersonaRank =
    highestLevel > 0
      ? `${highestRankBadge} ${highestRankName}`.trim()
      : ui("None");

  let summaryHtml = window.renderDetailStats
    ? window.renderDetailStats({
        classes: "completion-summary trophies-summary",
        itemsHtml: `
          <span><b>${earnedTrophyCount}/${totalTrophyCount}</b> ${escape(ui("Trophies earned"))}</span>
          <span><b>${earnedPersonaTitles.length}</b> ${escape(ui("Persona titles unlocked"))}</span>
          <span><b>${escape(highestPersonaRank)}</b> ${escape(ui("Highest persona rank"))}</span>
        `,
      })
    : "";

  let cabinetHtml = window.renderTrophyCabinet
    ? window.renderTrophyCabinet()
    : "";

  container.innerHTML = `
    <header class="completion-hero trophies-hero">
      <h1>${escape(ui("Trophies"))}</h1>
      <p>${escape(ui("Curated cinephile milestones across director filmographies, cinematic franchises, and viewing progress."))}</p>
      ${summaryHtml}
    </header>
    <div class="trophies-content">
      ${cabinetHtml}
    </div>
  `;

  finishRenderTimer?.();

  function applyKindFilter(selectedKind) {
    container.querySelectorAll("[data-trophy-kind-filter]").forEach((btn) => {
      let isActive = btn.dataset.trophyKindFilter === selectedKind;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    container.querySelectorAll(".compact-trophy-card").forEach((card) => {
      let cardKind = card.dataset.trophyKind;
      card.hidden = selectedKind !== "all" && cardKind !== selectedKind;
    });
  }

  // Handle URL query parameter for filter
  let initialKind = new URLSearchParams(window.location.search).get("kind");
  if (
    initialKind &&
    [
      "all",
      "filmography",
      "franchise",
      "other-collection",
      "progress",
    ].includes(initialKind)
  ) {
    applyKindFilter(initialKind);
  }

  container.addEventListener("click", (event) => {
    let kindFilterBtn = event.target.closest("[data-trophy-kind-filter]");
    if (kindFilterBtn) {
      event.preventDefault();
      let selectedKind = kindFilterBtn.dataset.trophyKindFilter;
      applyKindFilter(selectedKind);

      try {
        let url = new URL(window.location.href);
        if (selectedKind === "all") {
          url.searchParams.delete("kind");
        } else {
          url.searchParams.set("kind", selectedKind);
        }
        window.history?.replaceState?.(null, "", url.toString());
      } catch (err) {}
    }
  });

  // Reveal target if deep-linked via hash
  if (window.location.hash) {
    try {
      let target = container.querySelector(window.location.hash);
      if (target) {
        if (target.tagName === "DETAILS") target.open = true;
        let detailsParent = target.closest("details");
        if (detailsParent) detailsParent.open = true;
        target.scrollIntoView?.();
      }
    } catch (err) {}
  }
})();
