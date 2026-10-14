/** @file Renders the owner-only Award ceremony hub using scoped Supabase reads and links to annual, broader-period, and collection editors. */

(function () {
  let container = document.getElementById("awardPage");
  let escape = window.pageEscape;
  let ui = window.uiText || ((text) => text);
  let model;
  let collections;
  let collectionError = false;
  let periodType = "year";
  let periodKey = "";

  function typeLabel(type) {
    return {
      year: ui("Year"),
      decade: ui("Decade"),
      century: ui("Century"),
      alltime: ui("All time"),
      director: ui("Director"),
      franchise: ui("Franchise"),
    }[type];
  }

  function periodName(period) {
    if (period.type === "alltime") return ui("All time");
    if (period.type === "decade") return period.key;
    if (period.type === "century")
      return `${parseInt(period.key, 10)}–${parseInt(period.key, 10) + 99}`;
    return period.key;
  }

  function card(item, action) {
    let name = item.key ? periodName(item) : item.name;
    let progress =
      item.reviewed === undefined
        ? ui("{count} watched films", { count: item.filmCount })
        : ui("{reviewed}/{total} categories", {
            reviewed: item.reviewed,
            total: item.total,
          });
    return `<article class="build-collection-card"><a class="build-collection-card-visual" href="${escape(item.href)}" aria-label="${escape(`${action}: ${name}`)}">${window.renderPosterDeck(item.films.slice(0, 5))}</a><div class="build-collection-card-body"><span class="eyebrow">${escape(typeLabel(item.type))}</span><h3><a href="${escape(item.href)}">${escape(name)}</a></h3><p>${escape(progress)}</p><a class="button-link" href="${escape(item.href)}">${escape(action)} →</a></div></article>`;
  }

  function section(id, title, items, action) {
    if (!items.length) return "";
    return `<section class="build-collections" aria-labelledby="${id}"><div class="build-section-heading"><h2 id="${id}">${escape(title)}</h2></div><div class="build-collection-grid">${items.map((item) => card(item, action)).join("")}</div></section>`;
  }

  function render() {
    if (!model) return;
    let finish = window.startOskarsPerformance?.("award:render");
    let periods = model.periods.filter((period) => period.type === periodType);
    let selected =
      periods.find((period) => period.key === periodKey) || periods[0];
    periodKey = selected?.key || "";
    let saved = collections?.saved || [];
    let continuing = [
      ...model.continuing,
      ...saved.filter((item) => !item.complete),
    ];
    let completed = [
      ...model.completed,
      ...saved.filter((item) => item.complete),
    ];
    let suggestions = model.periods
      .filter(
        (period) =>
          period.type === "year" &&
          !period.complete &&
          !period.reviewed &&
          !period.nominationCount,
      )
      .slice(0, 6);
    document.title = `${ui("Award")} · The Oskars`;
    container.innerHTML = `${window.renderDetailHeader({ classes: "build-hero", mainHtml: `<span class="eyebrow">${escape(ui("Build"))}</span><h1>${escape(ui("Award"))}</h1><p>${escape(ui("Nominate your favourites and choose the winners."))}</p>` })}
      ${section("awardContinue", ui("Continue ceremony"), continuing, ui("Continue ceremony"))}
      <section aria-labelledby="awardPeriodHeading"><h2 id="awardPeriodHeading">${escape(ui("Choose a period"))}</h2><div class="award-picker"><label>${escape(ui("Period"))}<select data-award-type>${["year", "decade", "century", "alltime"].map((type) => `<option value="${type}"${type === periodType ? " selected" : ""}>${escape(typeLabel(type))}</option>`).join("")}</select></label><label>${escape(ui("Choose ceremony"))}<select data-award-period${periods.length ? "" : " disabled"}>${periods.map((period) => `<option value="${escape(period.key)}"${period.key === periodKey ? " selected" : ""}>${escape(periodName(period))}</option>`).join("") || `<option>${escape(ui("No watched films yet."))}</option>`}</select></label>${selected ? `<a class="button-link" href="${escape(selected.href)}" data-award-open>${escape(ui("Open ceremony"))} →</a>` : ""}</div><p>${escape(ui("Decade, century, and all-time ceremonies build on nominees from their smaller periods."))}</p></section>
      ${section("awardStart", ui("Start a ceremony"), suggestions, ui("Hold ceremony"))}
      ${section("awardCollections", ui("Choose a collection"), collections?.suggested || [], ui("Hold ceremony"))}
      <p><a href="directors.html">${escape(ui("Browse directors"))} →</a> · <a href="franchises.html">${escape(ui("Browse franchises"))} →</a></p>
      ${collectionError ? `<p role="alert">${escape(ui("Could not load collection ceremonies."))} <button type="button" class="link-button" data-award-retry>${escape(ui("Try again"))}</button></p>` : ""}
      ${completed.length ? `<details><summary>${escape(ui("Completed ceremonies"))} (${completed.length})</summary>${section("awardCompleted", ui("Completed ceremonies"), completed, ui("View ceremony"))}</details>` : ""}
      ${model.periods.length ? "" : `<p class="detail-empty">${escape(ui("Add watched films to start your first ceremony."))} <a href="build.html">${escape(ui("Build your Oskars"))} →</a></p>`}`;
    finish?.(
      `${model.periods.length} periods, ${continuing.length} continuing`,
    );
  }

  container.addEventListener("change", (event) => {
    if (event.target.matches("[data-award-type]")) {
      periodType = event.target.value;
      periodKey = "";
      render();
      container.querySelector("[data-award-type]")?.focus();
    } else if (event.target.matches("[data-award-period]")) {
      periodKey = event.target.value;
      render();
      container.querySelector("[data-award-period]")?.focus();
    }
  });
  container.addEventListener("click", (event) => {
    if (event.target.closest("[data-award-retry]")) boot();
  });
  window.addEventListener?.("oskars:localechange", render);

  async function boot() {
    let access = await window.resolveSupabaseAccountGate();
    if (!access.allowed) {
      window.renderSupabaseAccountGate(access, container);
      return;
    }
    container.innerHTML = `<p role="status">${escape(ui("Loading ceremonies…"))}</p>`;
    try {
      collectionError = false;
      let [workspace, awardSource, reviews, source] = await Promise.all([
        window.loadSupabaseWorkspace({ parts: ["watched"] }),
        window.loadSupabaseHydrationDomains(["personalAwards"]),
        window.loadSupabaseAwardReviews(),
        window.loadSupabaseCollectionCeremonySource().catch(() => {
          collectionError = true;
          return null;
        }),
      ]);
      let categories = window.getOrderedCategories?.() || [];
      model = window.buildAwardHub(
        workspace.watched,
        awardSource.personalAwards,
        reviews,
        categories,
      );
      collections = source
        ? window.buildCollectionCeremonies(source, { categories })
        : null;
      render();
    } catch (error) {
      container.innerHTML = `<section class="detail-empty"><h2>${escape(ui("Could not load ceremonies."))}</h2><p>${escape(error.message || String(error))}</p><button type="button" data-award-retry>${escape(ui("Try again"))}</button></section>`;
    }
  }
  boot();
})();
