/** @file Renders the visual Collections hub, with bounded previews and direct discovery links. */
(function () {
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let container = document.getElementById("collectionsPage");
  let readOnly = Boolean(
    window.resolveActiveProfileSlug?.() ||
    window.oskarsCapabilities?.().allowOwnerPages === false,
  );
  let model = null;
  let customCount = null;
  let loading = true;
  let unavailable = false;
  let types = [
    {
      id: "directors",
      href: "directors.html",
      name: "Directors",
      hint: "By filmmaker",
    },
    {
      id: "franchises",
      href: "franchises.html",
      name: "Franchises",
      hint: "Series & worlds",
    },
    { id: "tags", href: "tags.html", name: "Tags", hint: "Pick a theme" },
    {
      id: "custom",
      href: "custom-collections.html",
      name: "Your collections",
      hint: "Made by you",
    },
  ];

  function deck(films, type) {
    return window.renderPosterDeck(
      films?.length ? films : [{ title: " " }, { title: " " }, { title: " " }],
      {
        classes: `collections-hub-deck collections-hub-deck--${type}`,
        limit: 3,
      },
    );
  }

  function typeTile(type) {
    let records = model?.groups[type.id] || [];
    let count =
      type.id === "custom" ? customCount : model ? records.length : null;
    let films = records.slice(0, 3).flatMap((item) => item.posters.slice(0, 1));
    if (films.length < 3) films = records[0]?.posters || films;
    return `<a class="collections-hub-tile collections-hub-${type.id}" href="${type.href}">
      <span class="collections-hub-arrow" aria-hidden="true">↗</span>
      ${deck(films, type.id)}
      <div class="collections-hub-tile-body"><h2>${escape(ui(type.name))}${count !== null ? `<span class="collections-hub-count">${escape(count)}</span>` : ""}</h2><p>${escape(ui(type.hint))}</p></div>
    </a>`;
  }

  function suggestion(item) {
    let label = {
      directors: "Director",
      franchises: "Franchise",
      tags: "Tag",
      custom: "Your list",
    }[item.type];
    let hint =
      item.type === "franchises" && item.watched && item.remaining
        ? ui(item.remaining === 1 ? "1 film left" : "{count} films left", {
            count: item.remaining,
          })
        : ui(item.total === 1 ? "1 film" : "{count} films", {
            count: item.total,
          });
    return `<a class="collections-hub-pick collections-hub-${item.type}" href="${escape(item.href)}">
      ${deck(item.posters, item.type)}
      <div><span class="collections-hub-kind">${escape(ui(label))}</span><h3>${escape(item.name)}</h3><span class="collections-hub-pick-hint">${escape(hint)}</span></div>
      <span class="collections-hub-pick-arrow" aria-hidden="true">→</span>
    </a>`;
  }

  function render(measure = true) {
    let finish = measure
      ? window.startOskarsPerformance?.("collections:render")
      : null;
    document.title = `${ui("Collections")} · The Oskars`;
    container.setAttribute("aria-busy", String(loading));
    container.innerHTML =
      window.renderDetailHeader({
        mainHtml: `<h1>${escape(ui("Collections"))}</h1>`,
        actionsHtml: readOnly
          ? ""
          : `<a class="button-link collections-hub-create" href="custom-collections.html?create=1"><span aria-hidden="true">＋</span> ${escape(ui("New collection"))}</a>`,
      }) +
      `<div class="collections-hub-types">${types
        .filter((type) => !readOnly || type.id !== "custom")
        .map(typeTile)
        .join("")}</div>
      ${unavailable ? `<p class="collections-hub-status" role="status">${escape(ui(model ? "Some previews unavailable." : "Previews unavailable."))} <button type="button" data-collections-retry>${escape(ui("Retry"))}</button></p>` : ""}
      ${model?.suggestions.length ? `<section class="collections-hub-discover"><div class="collections-hub-section-header"><h2>${escape(ui("Dive in"))}</h2><button type="button" class="button-link" data-collections-surprise>${escape(ui("Surprise me"))}</button></div><div class="collections-hub-picks">${model.suggestions.map(suggestion).join("")}</div></section>` : !loading && !readOnly && !unavailable ? `<p class="collections-hub-status">${escape(ui("Make it yours."))}</p>` : ""}`;
    finish?.();
  }

  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-collections-retry]")) {
      if (!loading) boot();
      return;
    }
    if (
      event.target.closest("[data-collections-surprise]") &&
      model?.items.length
    ) {
      window.location.href =
        model.items[Math.floor(Math.random() * model.items.length)].href;
    }
  });
  window.addEventListener?.("oskars:localechange", () => render());

  async function boot() {
    loading = true;
    unavailable = false;
    render(false);
    try {
      let [dataResult, customResult] = await Promise.allSettled([
        window.ensureOskarsData(),
        readOnly
          ? Promise.resolve([])
          : window.listSupabaseCollections({ includePosters: true }),
      ]);
      if (dataResult.status === "rejected") throw dataResult.reason;
      if (
        window.resolveActiveProfileSlug?.() &&
        !window.state.isPublicProfileView
      )
        throw new Error("Public profile unavailable.");
      let custom =
        customResult.status === "fulfilled" ? customResult.value : [];
      unavailable = customResult.status === "rejected";
      customCount = unavailable || readOnly ? null : custom.length;
      model = window.buildCollectionsHubModel(custom, readOnly);
    } catch (error) {
      model = null;
      customCount = null;
      unavailable = true;
    }
    loading = false;
    render();
  }
  boot();
})();
