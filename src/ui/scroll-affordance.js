/** @file Detects intentional horizontal overflow and adds accessible mobile navigation affordances. */

(function () {
  let observed = new WeakSet();
  let mobileQuery = window.matchMedia?.("(max-width: 720px)");
  let resizeObserver = null;

  function overflowResizeObserver() {
    if (!resizeObserver && typeof ResizeObserver === "function")
      resizeObserver = new ResizeObserver((entries) =>
        entries.forEach((entry) => updateOverflowState(entry.target)),
      );
    return resizeObserver;
  }

  function scrollText(text) {
    return window.uiText?.(text) || text;
  }

  function controlsFor(scroller) {
    let controls = scroller.previousElementSibling;
    if (controls?.matches?.("[data-horizontal-scroll-controls]"))
      return controls;

    controls = document.createElement("div");
    controls.className = "horizontal-scroll-controls";
    controls.setAttribute("data-horizontal-scroll-controls", "");
    controls.innerHTML = `<span>${scrollText("More columns")}</span><span><button type="button" data-horizontal-scroll-back aria-label="${scrollText("Scroll left")}">←</button><button type="button" data-horizontal-scroll-forward aria-label="${scrollText("Scroll right")}">→</button></span>`;
    scroller.insertAdjacentElement("beforebegin", controls);
    controls
      .querySelector("[data-horizontal-scroll-back]")
      ?.addEventListener("click", () =>
        scroller.scrollBy({
          left: -Math.max(160, scroller.clientWidth * 0.75),
          behavior: "smooth",
        }),
      );
    controls
      .querySelector("[data-horizontal-scroll-forward]")
      ?.addEventListener("click", () =>
        scroller.scrollBy({
          left: Math.max(160, scroller.clientWidth * 0.75),
          behavior: "smooth",
        }),
      );
    return controls;
  }

  function updateOverflowState(scroller) {
    let overflows = scroller.scrollWidth > scroller.clientWidth + 1;
    let atStart = scroller.scrollLeft <= 1;
    let atEnd =
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
    scroller.classList.toggle("has-horizontal-overflow", overflows);
    scroller.classList.toggle("is-scroll-start", overflows && atStart);
    scroller.classList.toggle("is-scroll-end", overflows && atEnd);

    if (scroller.matches(".app-primary-nav")) return;
    let controls = controlsFor(scroller);
    controls.hidden = !overflows;
    controls.querySelector("[data-horizontal-scroll-back]").disabled = atStart;
    controls.querySelector("[data-horizontal-scroll-forward]").disabled = atEnd;
  }

  function enhanceScroller(scroller) {
    if (!scroller || observed.has(scroller)) return;
    observed.add(scroller);
    scroller.dataset.horizontalScrollReady = "true";
    scroller.addEventListener("scroll", () => updateOverflowState(scroller), {
      passive: true,
    });
    overflowResizeObserver()?.observe(scroller);
    updateOverflowState(scroller);
  }

  /** Adds overflow detection and navigation affordances to wide content. @param {Element|Document} [root] Root whose scroll containers are enhanced. */
  window.enhanceHorizontalScroll = function (root = document) {
    if (!root?.querySelectorAll) return;
    if (mobileQuery && !mobileQuery.matches) return;
    if (
      root.matches?.(
        ".app-primary-nav,.leaderboard-wrap,.period-year-grid-wrap",
      )
    )
      enhanceScroller(root);
    root
      .querySelectorAll(
        ".app-primary-nav,.leaderboard-wrap,.period-year-grid-wrap",
      )
      .forEach(enhanceScroller);
  };

  mobileQuery?.addEventListener?.("change", (event) => {
    if (event.matches) window.enhanceHorizontalScroll(document);
  });
})();
