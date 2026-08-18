/** @file Generic two-pointer merge session: combines two already-ordered lists via repeated "which ranks higher" choices, in O(|A|+|B|) comparisons rather than an exhaustive all-pairs sort. Shared by the watchlist merge tool (`watchlist-merge.html`) and the local-rank merge tool (issue #165). */

(function () {
  function mergeFinishIfExhausted(session) {
    if (session.pointerA >= session.listA.length) {
      session.merged.push(...session.listB.slice(session.pointerB));
      session.pointerB = session.listB.length;
      session.done = true;
      return true;
    }
    if (session.pointerB >= session.listB.length) {
      session.merged.push(...session.listA.slice(session.pointerA));
      session.pointerA = session.listA.length;
      session.done = true;
      return true;
    }
    return false;
  }

  /**
   * Starts a merge session over two ordered lists.
   * @param {Array} listA First ordered list.
   * @param {Array} listB Second ordered list.
   * @returns {Object} Session: `listA`, `listB`, `pointerA`, `pointerB`,
   *   `merged`, `history`, `done`. Auto-completes when either list starts
   *   empty.
   */
  window.createMergeSession = function (listA, listB) {
    let session = {
      listA: listA || [],
      listB: listB || [],
      pointerA: 0,
      pointerB: 0,
      merged: [],
      history: [],
      done: false,
    };
    mergeFinishIfExhausted(session);
    return session;
  };

  /**
   * Records a "this one ranks higher" choice and advances the session.
   * @param {Object} session Session from `createMergeSession`.
   * @param {'a'|'b'} side Which list's current item was chosen.
   * @returns {Object} The same session, mutated.
   */
  window.pickMergeSide = function (session, side) {
    if (!session || session.done) return session;
    let item =
      side === "a"
        ? session.listA[session.pointerA]
        : session.listB[session.pointerB];
    session.merged.push(item);
    session.history.push(side);
    if (side === "a") session.pointerA += 1;
    else session.pointerB += 1;
    mergeFinishIfExhausted(session);
    return session;
  };

  /**
   * Undoes the last recorded choice, if any.
   * @param {Object} session Session from `createMergeSession`.
   * @returns {Object} The same session, mutated.
   */
  window.undoMergeChoice = function (session) {
    let side = session?.history?.pop();
    if (!side) return session;
    session.merged.pop();
    if (side === "a") session.pointerA -= 1;
    else session.pointerB -= 1;
    session.done = false;
    return session;
  };

  function mergeUi(options) {
    return (
      options.ui ||
      window.uiText ||
      ((text, values = {}) =>
        text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""))
    );
  }

  /**
   * Renders the pairwise comparison step shared by every merge-tool page:
   * two cards side by side with an undo/cancel action row. watchlist-
   * merge.html and local-rank-merge.html render genuinely different card
   * content (a tier badge and linked director vs. a plain film card), so
   * the caller supplies its own per-item card renderer rather than this
   * function guessing at a shared shape.
   * @param {Object} session Active merge session from `createMergeSession`.
   * @param {Function} renderCard Renders one side's card: (item, side) => string.
   * @param {Object} [options] Rendering options.
   * @param {Function} [options.escape] HTML-escaping function.
   * @param {Function} [options.ui] Localized-text function.
   * @returns {string} Comparison step HTML.
   */
  window.renderMergeCompareStep = function (session, renderCard, options = {}) {
    let escape = options.escape || window.pageEscape;
    let ui = mergeUi(options);
    let remainingA = session.listA.length - session.pointerA;
    let remainingB = session.listB.length - session.pointerB;
    let cardA = renderCard(session.listA[session.pointerA], "a");
    let cardB = renderCard(session.listB[session.pointerB], "b");
    let progressText = ui("{a} left in Group A, {b} left in Group B", {
      a: window.uiCount?.(remainingA, "film", "films") || `${remainingA} films`,
      b: window.uiCount?.(remainingB, "film", "films") || `${remainingB} films`,
    });
    return `<section class="watchlist-merge-compare" data-watchlist-merge-compare>
      <p class="watchlist-merge-progress">${escape(ui("Which one ranks higher?"))} · ${escape(progressText)}</p>
      <div class="watchlist-merge-choice">
        ${cardA}
        <span class="watchlist-merge-vs">${escape(ui("or"))}</span>
        ${cardB}
      </div>
      <div class="watchlist-merge-compare-actions">
        <button type="button" class="sort-order-button" data-merge-undo${session.history.length ? "" : " disabled"}>${escape(ui("Undo last choice"))}</button>
        <button type="button" class="sort-order-button" data-merge-cancel>${escape(ui("Cancel merge"))}</button>
      </div>
    </section>`;
  };

  /**
   * Wires the start/pick/undo/cancel/apply/restart/again click dispatch
   * (plus the matching Enter/Space keyboard pick) shared by every merge-
   * tool page's container.
   * @param {HTMLElement} container Page container element.
   * @param {Object} handlers Page-specific action callbacks.
   * @param {Function} handlers.start Called to start a merge from setup.
   * @param {Function} handlers.pick Called with the picked side ("a"/"b").
   * @param {Function} handlers.undo Called to undo the last pick.
   * @param {Function} handlers.cancel Called to cancel back to setup.
   * @param {Function} handlers.apply Called to apply the merged order.
   * @param {Function} handlers.restart Called to return to setup from preview.
   * @param {Function} handlers.again Called to start a fresh merge after done.
   */
  window.wireMergeCompareControls = function (container, handlers) {
    container.addEventListener("click", (event) => {
      if (event.target.closest("[data-merge-start]")) {
        handlers.start();
        return;
      }
      let pickTarget = event.target.closest("[data-watchlist-merge-pick]");
      if (pickTarget) {
        handlers.pick(pickTarget.dataset.watchlistMergePick);
        return;
      }
      if (event.target.closest("[data-merge-undo]")) {
        handlers.undo();
        return;
      }
      if (event.target.closest("[data-merge-cancel]")) {
        handlers.cancel();
        return;
      }
      if (event.target.closest("[data-merge-apply]")) {
        handlers.apply();
        return;
      }
      if (event.target.closest("[data-merge-restart]")) {
        handlers.restart();
        return;
      }
      if (event.target.closest("[data-merge-again]")) {
        handlers.again();
      }
    });
    container.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      let pickTarget = event.target.closest("[data-watchlist-merge-pick]");
      if (!pickTarget) return;
      event.preventDefault();
      handlers.pick(pickTarget.dataset.watchlistMergePick);
    });
  };
})();
