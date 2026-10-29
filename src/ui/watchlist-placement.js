/** @file Owns the reusable staged placement dialog and its Rankings watchlist adapter. */
(function () {
  /**
   * Opens an accessible insertion journey using caller-owned candidates, plans, and saves.
   * @template T, P
   * @param {StagedPlacementDialogOptions<T, P>} options Dialog inputs and collection adapter.
   * @returns {void}
   */
  window.openStagedPlacement = function ({
    items,
    adapter,
    onSaved = () => {},
    getItems = () => items,
    labels = {},
    focusFallback = "",
    initialId = "",
  }) {
    let copy = {
      dialog: "Place an item",
      category: "COLLECTION",
      noun: "item",
      plural: "items",
      picker: "Pick an item to place or revisit in your order.",
      firstPool: "Place it among the ranked items in this pool.",
      search: "Find an item",
      placeholder: "Title or metadata",
      ...labels,
    };
    let read = (item) => ({
      metadata: "",
      posterUrl: "",
      ranked: false,
      eligible: true,
      ...adapter.readItem(item),
    });
    if (document.querySelector("dialog.watchlist-placement")) return;
    let e = window.pageEscape;
    let dialog = document.createElement("dialog");
    dialog.className = "watchlist-placement";
    dialog.setAttribute("aria-label", copy.dialog);
    document.body.append(dialog);
    let plan = null;
    let busy = false;
    let error = "";
    let done = false;
    let dragging = false;
    let search = "";
    let rankFilter = "all";
    let opener = document.activeElement;
    function close() {
      if (busy) return;
      dialog.close();
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      else if (focusFallback) document.querySelector(focusFallback)?.focus();
    }
    function portrait(item) {
      return item.posterUrl
        ? `<img src="${e(item.posterUrl)}" alt="" width="36" height="54" loading="lazy">`
        : '<span class="placement-poster" aria-hidden="true">✦</span>';
    }
    function render() {
      let finishRender = window.startOskarsPerformance?.("placement:render");
      let content;
      let selectedItem = plan ? read(plan.item) : null;
      let group = plan ? adapter.groupLabel?.(plan) || "your order" : "";
      if (!plan) {
        let candidates = items.map(read).filter((item) => item.eligible);
        let choices = candidates.filter(
          (item) =>
            (rankFilter === "all" ||
              item.ranked === (rankFilter === "ranked")) &&
            (item.searchText ?? `${item.title} ${item.metadata}`)
              .toLowerCase()
              .includes(search.toLowerCase()),
        );
        let counts = {
          all: candidates.length,
          ranked: candidates.filter((item) => item.ranked).length,
          unranked: candidates.filter((item) => !item.ranked).length,
        };
        let filters = `<div class="placement-rank-filters" role="group" aria-label="Ranking status">${["all", "unranked", "ranked"].map((value) => `<button type="button" class="sort-order-button" data-placement-rank-filter="${value}" aria-pressed="${rankFilter === value}">${value === "all" ? "All" : value === "unranked" ? "Unranked" : "Ranked"} <span>${counts[value]}</span></button>`).join("")}</div>`;
        content = `<p class="placement-eyebrow">MAKE ROOM FOR YOUR NEXT FAVOURITE</p><h2>Find its place</h2><p>${e(copy.picker)}</p>${filters}<label class="placement-search">${e(copy.search)}<input type="search" data-placement-search value="${e(search)}" placeholder="${e(copy.placeholder)}" autocomplete="off"></label><div class="placement-choices">${choices.map((item) => `<button type="button" data-placement-film="${e(item.id)}">${portrait(item)}<span><strong>${e(item.title)}</strong><small>${e(item.metadata)}</small></span><span aria-hidden="true">↗</span></button>`).join("") || `<p>No ${e(copy.plural)} match these filters.</p>`}</div>`;
      } else if (done) {
        content = `<div class="placement-celebrate"><span aria-hidden="true">✦</span><p class="placement-eyebrow">IN ITS RIGHTFUL PLACE</p><h2>${e(selectedItem.title)}</h2><p>Saved in ${e(group)}. Your other ${e(copy.plural)} kept their relative order.</p><button type="button" class="sort-order-button" data-placement-another>Place another ${e(copy.noun)} ↗</button></div>`;
      } else if (plan.stage === plan.stages.length) {
        content = `<h2>${busy ? "Saving its place…" : "Your placement is ready"}</h2><p>${e(selectedItem.title)}</p>${!busy ? '<button type="button" class="sort-order-button" data-placement-retry>Try saving again</button>' : ""}`;
      } else {
        let pool = window.stagedPlacementPool(plan);
        let nextLabel =
          plan.stage === plan.stages.length - 1
            ? "save placement"
            : "next pool";
        let selected = `<div class="placement-selected" draggable="${!busy}" tabindex="0" aria-label="Drag ${e(selectedItem.title)} to a placement below">${portrait(selectedItem)}<span><strong>${e(selectedItem.title)}</strong><small>${e(group)} · Drag me into the list</small></span><span aria-hidden="true">⠿</span></div>`;
        let slot = (index, label) =>
          pool.slots.includes(index)
            ? `<button type="button" class="placement-slot" data-placement-slot="${index}" aria-label="${e(label)}"><span>＋ ${e(label)}</span></button>`
            : "";
        content = `<ol class="placement-stages" aria-label="Placement stages">${plan.stages.map((stage, i) => `<li ${i === plan.stage ? 'aria-current="step"' : ""} class="${i < plan.stage ? "is-complete" : ""}">${i < plan.stage ? "✓ " : ""}${e(stage.label)}</li>`).join("")}</ol><h2>Where in ${e(plan.stages[plan.stage].label)}?</h2><p>${e(plan.stage ? `Your previous pool sets the roof and floor. Place the ${copy.noun} between the locked neighbours.` : copy.firstPool)} Drop to advance, or tap a gap.</p>${selected}<div class="placement-pool">${pool.roof ? `<div class="placement-peer placement-anchor" data-placement-roof>${portrait(read(pool.roof.item))}<span><small>PLACEMENT ROOF · LOCKED</small><strong>${e(read(pool.roof.item).title)}</strong></span><span aria-hidden="true">⌁</span></div>` : `<p class="placement-floor">Open roof · you can place this ${e(copy.noun)} first.</p>`}${pool.above
          .map(({ item: raw, index, rank }) => {
            let item = read(raw);
            return `${slot(index, `Place above ${item.title}`)}<div class="placement-peer">${portrait(item)}<span><small>#${rank}</small><strong>${e(item.title)}</strong><small>${e(item.poolMetadata ?? item.metadata)}</small></span></div>`;
          })
          .join(
            "",
          )}${slot(pool.bottom, plan.stage || pool.above.length ? `Keep here · ${nextLabel} →` : `Place here · ${nextLabel} →`)}${pool.anchor ? `<div class="placement-peer placement-anchor" data-placement-floor>${portrait(read(pool.anchor.item))}<span><small>PLACEMENT FLOOR · LOCKED</small><strong>${e(read(pool.anchor.item).title)}</strong></span><span aria-hidden="true">⌁</span></div>` : `<p class="placement-floor">Open floor · you can place this ${e(copy.noun)} last.</p>`}</div><div class="placement-footer">${plan.stage ? '<button type="button" class="sort-order-button" data-placement-back>← Previous pool</button>' : `<button type="button" class="sort-order-button" data-placement-another>← Choose ${e(copy.noun)}</button>`}<span>${pool.above.length} ${e(copy.plural)} to explore · ${e(group)}</span></div>`;
      }
      dialog.innerHTML = `<header><span>${e(copy.category)} · FIND ITS PLACE</span><button type="button" data-placement-close aria-label="Close placement" ${busy ? "disabled" : ""}>×</button></header>${content}<p class="placement-status" role="status">${e(error)}</p>`;
      finishRender?.();
    }
    async function save() {
      busy = true;
      error = "";
      render();
      try {
        let position = adapter.resolvePosition
          ? await adapter.resolvePosition(plan)
          : undefined;
        await adapter.save(plan, position);
        done = true;
        onSaved();
      } catch (err) {
        error = err.message || String(err);
      } finally {
        busy = false;
        render();
        dialog
          .querySelector("[data-placement-another], [data-placement-retry]")
          ?.focus();
      }
    }
    async function place(index) {
      if (busy || !plan || done) return;
      error = "";
      if (window.advanceStagedPlacement(plan, index)) await save();
      else {
        render();
        dialog.querySelector(".placement-selected")?.focus();
      }
    }
    dialog.addEventListener("click", async (event) => {
      if (busy) return;
      let target = event.target;
      let filter = target.closest("[data-placement-rank-filter]");
      if (filter) {
        rankFilter = filter.dataset.placementRankFilter;
        render();
        dialog
          .querySelector(`[data-placement-rank-filter="${rankFilter}"]`)
          ?.focus();
        return;
      }
      if (target.closest("[data-placement-close]")) return close();
      if (target.closest("[data-placement-another]")) {
        items = getItems();
        plan = null;
        done = false;
        error = "";
        render();
        return;
      }
      if (target.closest("[data-placement-back]")) {
        plan.stage--;
        Object.assign(plan, plan.history.pop());
        render();
        return;
      }
      if (target.closest("[data-placement-retry]")) return save();
      let choice = target.closest("[data-placement-film]");
      if (choice) {
        try {
          plan = adapter.createPlan(getItems(), choice.dataset.placementFilm);
          error = "";
        } catch (err) {
          error = err.message;
        }
        render();
        dialog.querySelector(".placement-selected")?.focus();
      }
      let slot = target.closest("[data-placement-slot]");
      if (slot) await place(Number(slot.dataset.placementSlot));
    });
    dialog.addEventListener("input", (event) => {
      if (
        !(event.target instanceof HTMLInputElement) ||
        !event.target.matches("[data-placement-search]")
      )
        return;
      let start = event.target.selectionStart;
      search = event.target.value;
      render();
      let input = dialog.querySelector("input");
      input.focus();
      input.setSelectionRange(start, start);
    });
    dialog.addEventListener("dragstart", (event) => {
      if (!event.target.closest(".placement-selected") || busy) return;
      dragging = true;
      event.dataTransfer.setData("text/plain", read(plan.item).id);
      event.dataTransfer.effectAllowed = "move";
      dialog.classList.add("is-dragging");
    });
    dialog.addEventListener("dragover", (event) => {
      if (!dragging || !event.target.closest("[data-placement-slot]")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      dialog
        .querySelectorAll(".is-drop-target")
        .forEach((el) => el.classList.remove("is-drop-target"));
      event.target
        .closest("[data-placement-slot]")
        .classList.add("is-drop-target");
    });
    dialog.addEventListener("drop", async (event) => {
      let slot = event.target.closest("[data-placement-slot]");
      if (!dragging || !slot) return;
      event.preventDefault();
      dragging = false;
      dialog.classList.remove("is-dragging");
      await place(Number(slot.dataset.placementSlot));
    });
    dialog.addEventListener("dragend", () => {
      dragging = false;
      dialog.classList.remove("is-dragging");
      dialog
        .querySelectorAll(".is-drop-target")
        .forEach((el) => el.classList.remove("is-drop-target"));
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      close();
    });
    if (initialId) {
      try {
        plan = adapter.createPlan(getItems(), initialId);
      } catch (err) {
        error = err.message || String(err);
      }
    }
    render();
    dialog.showModal();
    if (plan) dialog.querySelector(".placement-selected")?.focus();
  };
  /**
   * Opens the Rankings watchlist journey through the shared placement dialog.
   * @param {Object} options Dialog inputs.
   * @param {WatchlistItem[]} options.items All films available for placement.
   * @param {() => WatchlistItem[]} [options.getItems] Reads the complete current watchlist.
   * @param {() => void} options.onSaved Refreshes the current view from memory.
   * @returns {void}
   */
  window.openWatchlistPlacement = function ({
    items,
    onSaved,
    getItems = () => window.state.watchlist,
  }) {
    window.openStagedPlacement({
      items,
      getItems,
      onSaved,
      focusFallback: "[data-watchlist-placement-open]",
      labels: {
        dialog: "Place a watchlist film",
        category: "WATCHLIST",
        noun: "film",
        plural: "films",
        picker:
          "All tiered watchlist films are available here. Pick one to place or revisit, starting in its year. Films are sorted by tier, then title.",
        firstPool: "Place it among the ranked films in its year.",
        search: "Find a film",
        placeholder: "Title or year",
      },
      adapter: {
        readItem: (item) => ({
          id: item.id,
          title: item.title,
          searchText: `${item.title} ${item.year}`,
          metadata: `${item.year || "Unknown year"} · ${window.watchlistTierKey(item.tier, item.tierModifier)}`,
          poolMetadata: item.year || "Unknown year",
          posterUrl: item.poster?.url || "",
          eligible: Boolean(item.tier),
          ranked: Boolean(item.supabaseWatchlistPosition),
        }),
        createPlan: (candidates, id) =>
          window.createWatchlistPlacement(candidates, id),
        groupLabel: (plan) => plan.tier,
        save: (plan) => window.saveWatchlistPlacement(plan),
      },
    });
  };
})();
