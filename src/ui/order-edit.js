/** @file Owns shared drag-and-drop order editing for watchlist-backed lists and project queues. */

(function () {
  function itemFromElement(element) {
    return {
      scope: String(element?.dataset?.orderEditScope || ""),
      id: String(element?.dataset?.orderEditId || ""),
      type: String(element?.dataset?.orderEditType || ""),
      group: String(element?.dataset?.orderEditGroup || ""),
      index: Number(element?.dataset?.orderEditIndex),
    };
  }

  function payloadFromTransfer(dataTransfer, fallback) {
    if (!dataTransfer) return fallback;
    try {
      let payload =
        dataTransfer.getData("application/json") ||
        dataTransfer.getData("text/plain");
      return payload ? JSON.parse(payload) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  /**
   * Builds the standardized attributes consumed by the shared order-edit controller.
   * @param {{enabled:boolean, scope:string, id:string, index:number, type?:string, group?:string}} options Order-item identity and state.
   * @returns {Record<string, string>} HTML attributes for a draggable order item.
   */
  window.orderEditItemAttributes = function (options) {
    if (!options?.enabled) return {};
    return {
      draggable: "true",
      "data-order-edit-scope": String(options.scope || ""),
      "data-order-edit-id": String(options.id || ""),
      "data-order-edit-type": String(options.type || ""),
      "data-order-edit-group": String(options.group || ""),
      "data-order-edit-index": String(options.index ?? 0),
    };
  };

  /**
   * Serializes standardized order-edit attributes for table rows and other inline templates.
   * @param {{enabled:boolean, scope:string, id:string, index:number, type?:string, group?:string}} options Order-item identity and state.
   * @param {(value:*) => string} [escape] HTML escaping function.
   * @returns {string} A class and attributes suitable for insertion after an opening tag name.
   */
  window.renderOrderEditItemAttributes = function (
    options,
    escape = window.pageEscape,
  ) {
    if (!options?.enabled) return "";
    let attributes = window.orderEditItemAttributes(options);
    let html = Object.entries(attributes)
      .map(([name, value]) => ` ${name}="${escape(value)}"`)
      .join("");
    return ` class="watchlist-order-card"${html}`;
  };

  /**
   * Binds tier/group-safe drag-and-drop ordering to a page container.
   * @param {{container:Element, scope:string, enabled:() => boolean, commit:(from:Object, target:Object, position:'before'|'after') => (Object|Promise<Object>), rerender?:() => (*|Promise<*>), rejectedMessage?:string}} options Controller hooks and scope.
   * @returns {{move:(from:Object, target:Object) => (Object|Promise<Object>), destroy:() => void}} Controller methods for testing or cleanup.
   */
  window.createOrderEditController = function (options) {
    let container = options?.container;
    let scope = String(options?.scope || "");
    let dragged = null;
    let listeners = [];

    function enabled() {
      // Reordering mutates state regardless of which page embeds this
      // controller (issue #253) - gating here once covers every page
      // instead of requiring each page's own `enabled` callback to
      // separately remember to check canEdit too.
      if (!(window.oskarsCapabilities?.().canEdit ?? true)) return false;
      return Boolean(container && options?.enabled?.());
    }

    function listen(type, handler) {
      container?.addEventListener(type, handler);
      listeners.push([type, handler]);
    }

    function closestItem(event) {
      let item = event.target?.closest?.(".watchlist-order-card");
      return item?.dataset?.orderEditScope === scope ? item : null;
    }

    function move(from, target) {
      if (
        !from?.id ||
        !target?.id ||
        from.scope !== scope ||
        target.scope !== scope
      )
        return { ok: false, reason: "invalid-item" };
      if (from.id === target.id && from.type === target.type)
        return { ok: false, reason: "same-item" };
      if (String(from.group || "") !== String(target.group || "")) {
        let reason =
          options.rejectedMessage ||
          window.uiText?.("Items can only move within the same group.") ||
          "Items can only move within the same group.";
        window.alert?.(reason);
        return { ok: false, reason };
      }
      let position =
        Number(from.index) < Number(target.index) ? "after" : "before";
      function finish(result) {
        if (!result?.ok) {
          if (result?.reason) window.alert?.(result.reason);
          return result || { ok: false };
        }
        let rerendered = options.rerender?.();
        return rerendered?.then ? rerendered.then(() => result) : result;
      }
      let result = options.commit(from, target, position);
      return result?.then ? result.then(finish) : finish(result);
    }

    listen("dragstart", (event) => {
      if (!enabled()) return;
      let item = closestItem(event);
      if (!item) return;
      dragged = itemFromElement(item);
      if (event.dataTransfer) {
        let payload = JSON.stringify(dragged);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", payload);
        try {
          event.dataTransfer.setData("application/json", payload);
        } catch (err) {}
      }
      item.classList.add("dragging");
    });
    listen("dragend", (event) => {
      closestItem(event)?.classList.remove("dragging");
      dragged = null;
    });
    listen("dragover", (event) => {
      if (!enabled()) return;
      let item = closestItem(event);
      if (!item) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      item.classList.add("drop-target");
    });
    listen("dragleave", (event) =>
      closestItem(event)?.classList.remove("drop-target"),
    );
    listen("drop", async (event) => {
      if (!enabled()) return;
      let item = closestItem(event);
      if (!item) return;
      event.preventDefault();
      item.classList.remove("drop-target");
      await move(
        payloadFromTransfer(event.dataTransfer, dragged),
        itemFromElement(item),
      );
    });

    return {
      move,
      destroy() {
        listeners.forEach(([type, handler]) =>
          container?.removeEventListener?.(type, handler),
        );
        listeners = [];
        dragged = null;
      },
    };
  };
})();
