/** @file Renders the Collections navigation hub for the different film collection types. */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let finish = window.startOskarsPerformance?.("collections:render");
  let types = [
    ["directors.html", "Directors", "Explore films by director."],
    [
      "franchises.html",
      "Franchises",
      "Browse film series and shared universes.",
    ],
    ["tags.html", "Tags", "Explore films grouped by tag."],
    [
      "custom-collections.html",
      "Custom Collections",
      "Create and browse your own named film lists.",
    ],
  ];
  document.title = `${ui("Collections")} · The Oskars`;
  document.getElementById("collectionsPage").innerHTML =
    window.renderDetailHeader({
      mainHtml: `<h1>${escape(ui("Collections"))}</h1><p>${escape(ui("Explore films by director, franchise, tag, or your own custom collections."))}</p>`,
    }) +
    `<div class="film-grid project-film-grid">${types.map(([href, title, description]) => `<a class="film-card project-card" href="${href}"><h2 class="project-card-title">${escape(ui(title))}</h2><p class="leaderboard-meta">${escape(ui(description))}</p></a>`).join("")}</div>`;
  finish?.();
})();
