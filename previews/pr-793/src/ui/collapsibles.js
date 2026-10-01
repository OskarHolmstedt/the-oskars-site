/** @file Adds accessible, idempotent collapse controls to supported page sections. */

/**
 * Enhances supported descendants of a root element with collapse toggles.
 * @param {Element|Document} root Container whose sections should be enhanced.
 */
window.enhanceCollapsibles = function (root) {
  if (!root?.querySelectorAll) return;

  function addToggle(target, host, label) {
    if (target.dataset.collapsibleReady) return;
    target.dataset.collapsibleReady = "true";
    target.classList.add("collapsible");
    host.classList.add("collapsible-heading");

    let button = document.createElement("button");
    button.type = "button";
    button.className = "collapsible-toggle";
    let initiallyCollapsed = target.classList.contains("is-collapsed");
    button.textContent = initiallyCollapsed ? "▸" : "▾";
    button.title = `${initiallyCollapsed ? "Expand" : "Collapse"} ${label}`;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-expanded", String(!initiallyCollapsed));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      let collapsed = target.classList.toggle("is-collapsed");
      button.textContent = collapsed ? "▸" : "▾";
      button.title = `${collapsed ? "Expand" : "Collapse"} ${label}`;
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-expanded", String(!collapsed));
    });
    host.appendChild(button);
  }

  root.querySelectorAll(".board").forEach((board) => {
    let label = board.querySelector(":scope > .category-link, :scope > b");
    addToggle(board, board, label?.textContent?.trim() || "category");
  });

  root.querySelectorAll(".film-card").forEach((card) => {
    let heading = card.querySelector(":scope > .film-title");
    if (heading) addToggle(card, heading, heading.textContent.trim() || "film");
  });

  root.querySelectorAll(".leaderboard-wrap").forEach((wrapper) => {
    if (wrapper.hasAttribute("data-collapsible-skip")) return;
    let heading = wrapper.previousElementSibling;
    if (heading?.matches?.("[data-horizontal-scroll-controls]"))
      heading = heading.previousElementSibling;
    if (heading?.matches?.("h2,h3,.health-section-heading")) {
      addToggle(wrapper, heading, heading.textContent.trim() || "table");
    } else {
      addToggle(wrapper, wrapper, "table");
      wrapper.classList.add("collapsible-table-standalone");
    }
  });

  root.querySelectorAll("[data-collapsible-section]").forEach((section) => {
    let heading = section.querySelector(":scope > [data-collapsible-heading]");
    let body = section.querySelector(":scope > [data-collapsible-body]");
    if (heading && body)
      addToggle(body, heading, heading.textContent.trim() || "section");
  });

  window.enhanceHorizontalScroll?.(root);
};
