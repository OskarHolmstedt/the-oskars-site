/**
 * @file Shared controller for the Supabase-backed queue pages: Rate watched
 * (unrated watched films) and Set watchlist tier (untiered watchlist items).
 * Each page supplies its workspace part, input widget and save call; this
 * owns everything else - the account gate and workspace load, grouping by
 * release year, director or franchise (src/domain/supabase-queue-groups.js),
 * in-page navigation with popstate restoration, the open-item card grid,
 * and the sorted list of already-set items below it.
 *
 * URLs: `?year=N` (the default grouping), or `?collection=director|franchise`
 * with an optional `&id=` (a people.id or normalized franchise name, the
 * same parameters as the awards-year.html collection builder). Director and
 * franchise membership is read once, on the first non-year view.
 */
(function () {
  const KINDS = [
    ["year", "Release year"],
    ["director", "Director"],
    ["franchise", "Franchise"],
  ];
  const KIND_PLURALS = {
    director: "directors",
    franchise: "franchises",
  };

  /**
   * Mounts one queue page on its `<main>` and boots it.
   * @param {Object} config Page configuration.
   * @param {Element} config.container The page's `<main>`.
   * @param {string} config.page Page file name, for in-page URLs.
   * @param {'watched'|'watchlist'} config.part Workspace part to work through.
   * @param {string} config.timer Performance timer name for each render.
   * @param {string} config.title Page heading.
   * @param {string} config.intro Lead paragraph under the heading.
   * @param {{open: string, done: string, doneHeading: string, nothing: string, allDone: string, noRows: string, loadError: string}} config.words Status wording: "unrated"/"rated"/"Rated", the empty states and the load-failure heading.
   * @param {(row: Object) => boolean} config.isDone Whether a row is already set.
   * @param {(row: Object) => number} config.doneScore Sort score for set rows, best highest.
   * @param {(row: Object) => string} config.renderInput Card input HTML for an open row.
   * @param {(row: Object) => string} config.renderDoneValue Already-safe value HTML for a set row.
   * @param {(container: Element) => void} [config.enhance] Wires inputs after rendering.
   * @param {(form: HTMLFormElement) => Object} config.readInput Reads a card's input, throwing when incomplete.
   * @param {(rowId: string, input: Object) => Promise<Object>} config.save Persists one row and resolves to its updated row.
   */
  window.mountSupabaseQueuePage = function (config) {
    let escape = window.pageEscape;
    let container = config.container;
    let membership = null;
    let membershipLoad = null;
    let active = null; // the {kind, id} render() last drew the queue for

    function requestedView() {
      let kind = window.pageQueryParam("collection");
      if (kind === "director" || kind === "franchise")
        return { kind, id: window.pageQueryParam("id") || "" };
      return { kind: "year", id: window.pageQueryParam("year") || "" };
    }

    function pageUrl(kind, id) {
      if (kind === "year")
        return id
          ? `${config.page}?year=${encodeURIComponent(id)}`
          : config.page;
      return `${config.page}?collection=${kind}${id ? `&id=${encodeURIComponent(id)}` : ""}`;
    }

    function kindLabel(kind) {
      return KINDS.find(([value]) => value === kind)?.[1] || "";
    }

    function collectionUrl(kind, id) {
      if (kind === "director") return window.personPageUrl?.(id) || "";
      if (kind === "franchise") return window.franchisePageUrl?.(id) || "";
      return "";
    }

    function openRows(group) {
      return group.rows.filter((row) => !config.isDone(row));
    }

    function filmMeta(film, kind) {
      return [kind === "year" ? "" : film.year, film.medium, film.type]
        .filter(Boolean)
        .join(" · ");
    }

    function renderCard(row, kind) {
      let film = row.films;
      // Reuses the same sized, aspect-ratio-constrained poster component every
      // browse grid already uses (film-poster--card) instead of a bare <img>
      // with no width/height at all - that rendered each poster at its full
      // natural resolution (found live: two loaded posters at 500x750px
      // overlapping the whole grid) rather than fit to the card.
      let poster = film.poster_url
        ? window.renderFilmPoster(
            { title: film.title, poster: { url: film.poster_url } },
            "card",
          )
        : "";
      return `<form class="queue-card film-card" data-queue-row="${escape(row.id)}">
      ${poster}
      <div class="queue-identity">
        <h3>${escape(film.title)}</h3>
        <p>${escape(filmMeta(film, kind))}</p>
      </div>
      <div class="queue-input-row">
        ${config.renderInput(row)}
        <button type="submit" class="queue-save" aria-label="Save" title="Save">✓</button>
      </div>
    </form>`;
    }

    function renderDoneEntry(row, kind) {
      let film = row.films;
      let href = window.filmPageUrl?.(row.film_id) || "#";
      let poster = film.poster_url
        ? window.renderFilmPoster(
            { title: film.title, poster: { url: film.poster_url } },
            "thumb",
          )
        : "";
      let year = kind === "year" ? "" : ` <small>${escape(film.year)}</small>`;
      return `<li class="queue-done-item" data-score="${escape(config.doneScore(row))}">
      <a href="${escape(href)}" class="queue-done-poster">${poster}</a>
      <a href="${escape(href)}" class="queue-done-title">${escape(film.title)}${year}</a>
      <span class="queue-done-value">${config.renderDoneValue(row)}</span>
    </li>`;
    }

    function header() {
      return window.renderDetailHeader({
        mainHtml: `<h1>${escape(config.title)}</h1><p>${escape(config.intro)}</p>`,
      });
    }

    function progressHtml(doneCount, total) {
      return `<section class="queue-progress card"><div><b>${escape(doneCount)}</b> / ${escape(total)} ${escape(config.words.done)}</div><progress value="${escape(doneCount)}" max="${escape(total || 1)}"></progress></section>`;
    }

    function kindSelectHtml(kind) {
      let options = KINDS.map(
        ([value, label]) =>
          `<option value="${value}"${value === kind ? " selected" : ""}>${escape(label)}</option>`,
      ).join("");
      return `<label>Group by<select data-queue-kind>${options}</select></label>`;
    }

    function toolbarHtml(kind, listed, group) {
      let groupOptions = listed
        .map(
          (candidate) =>
            `<option value="${escape(candidate.id)}"${candidate === group ? " selected" : ""}>${escape(candidate.name)} · ${escape(openRows(candidate).length)}</option>`,
        )
        .join("");
      let index = listed.indexOf(group);
      let arrow = (target, glyph, label) =>
        target
          ? `<a class="queue-arrow" href="${escape(pageUrl(kind, target.id))}" aria-label="${escape(label)} (${escape(target.name)})">${glyph}</a>`
          : `<span class="queue-arrow is-disabled" aria-hidden="true">${glyph}</span>`;
      let groupSelect = group
        ? `<label>${escape(kindLabel(kind))}<select data-queue-group>${groupOptions}</select></label>`
        : "";
      return `<div class="queue-toolbar collection-film-toolbar">
      <div class="queue-nav">
        ${arrow(index > 0 ? listed[index - 1] : null, "‹", `Previous ${kindLabel(kind).toLowerCase()}`)}
        <div class="queue-selects">${kindSelectHtml(kind)}${groupSelect}</div>
        ${arrow(index >= 0 && index < listed.length - 1 ? listed[index + 1] : null, "›", `Next ${kindLabel(kind).toLowerCase()}`)}
      </div>
    </div>`;
    }

    function loadMembership() {
      membershipLoad ||= window
        .loadSupabaseQueueMembership(config.part)
        .then((source) => {
          membership = window.indexSupabaseQueueMembership(source);
        })
        .catch((error) => {
          membershipLoad = null;
          throw error;
        });
      return membershipLoad;
    }

    function render() {
      let finish = window.startOskarsPerformance?.(config.timer);
      let view = requestedView();
      let rows = window.supabaseQueueRows(config.part);
      let openCount = rows.filter((row) => !config.isDone(row)).length;
      let doneCount = rows.length - openCount;

      if (!rows.length || (!openCount && !view.id)) {
        container.innerHTML = `${header()}<section class="detail-empty"><h2>${escape(config.words.nothing)}</h2><p>${escape(rows.length ? config.words.allDone : config.words.noRows)}</p></section>`;
        active = null;
        finish?.(`${rows.length} rows, complete`);
        return;
      }

      if (view.kind !== "year" && !membership) {
        container.innerHTML = `${header()}${progressHtml(doneCount, rows.length)}${toolbarHtml(view.kind, [], null)}<section class="detail-empty" data-queue-loading><p>Loading ${escape(KIND_PLURALS[view.kind])}…</p></section>`;
        active = null;
        // The load already in flight re-renders whatever view is current
        // once it settles.
        if (!membershipLoad)
          loadMembership().then(render, (error) => {
            let status = container.querySelector("[data-queue-loading]");
            let kind = requestedView().kind;
            if (status && kind !== "year")
              status.innerHTML = `<h2>Could not load ${escape(KIND_PLURALS[kind])}</h2><p>${escape(error.message || String(error))}</p>`;
          });
        finish?.(`${openCount} open, loading ${view.kind}`);
        return;
      }

      let groups = window.groupSupabaseQueueRows(rows, view.kind, membership);
      // A one-film director or franchise offers nothing to compare against;
      // its film is still reachable by year, or by linking to it directly.
      let listed =
        view.kind === "year"
          ? groups
          : groups.filter(
              (group) => group.rows.length >= 2 || group.id === view.id,
            );
      let group =
        listed.find((candidate) => candidate.id === view.id) ||
        listed.find((candidate) => openRows(candidate).length) ||
        listed[0];

      if (!group) {
        container.innerHTML = `${header()}${progressHtml(doneCount, rows.length)}${toolbarHtml(view.kind, listed, null)}<section class="detail-empty"><h2>No ${escape(KIND_PLURALS[view.kind])} with two or more of these films</h2></section>`;
        active = null;
        finish?.(`${openCount} open, no ${view.kind} groups`);
        return;
      }

      let queue = openRows(group);
      let done = group.rows
        .filter((row) => config.isDone(row))
        .sort(
          (left, right) => config.doneScore(right) - config.doneScore(left),
        );
      let href = collectionUrl(view.kind, group.id);
      let nameHtml = href
        ? `<a class="queue-collection-link" href="${escape(href)}">${escape(group.name)}</a>`
        : escape(group.name);

      let openBody = queue.length
        ? `<section><h2>${nameHtml} · <span data-queue-open-count>${escape(queue.length)}</span> ${escape(config.words.open)}</h2><div class="queue-grid">${queue.map((row) => renderCard(row, view.kind)).join("")}</div></section>`
        : `<section class="detail-empty"><h2>${nameHtml} is fully ${escape(config.words.done)}</h2></section>`;
      let doneBody = done.length
        ? `<section class="queue-done-section"><h2>${nameHtml} · ${escape(config.words.doneHeading)}</h2><ol class="queue-done-list">${done.map((row) => renderDoneEntry(row, view.kind)).join("")}</ol></section>`
        : "";

      container.innerHTML = `${header()}
      ${progressHtml(doneCount, rows.length)}
      ${toolbarHtml(view.kind, listed, group)}
      ${openBody}
      ${doneBody}`;
      config.enhance?.(container);
      active = { kind: view.kind, id: group.id };
      finish?.(
        `${openCount} open, ${view.kind} ${group.id}, ${queue.length} shown`,
      );
    }

    // Inserts one freshly-set row into the already-rendered done list at
    // its sorted position, without touching anything else in the DOM.
    function insertDoneEntry(doneList, row) {
      let score = config.doneScore(row);
      let template = document.createElement("template");
      template.innerHTML = renderDoneEntry(row, active.kind).trim();
      let node = template.content.firstElementChild;
      let before = Array.from(doneList.children).find(
        (item) => Number(item.dataset.score) < score,
      );
      if (before) doneList.insertBefore(node, before);
      else doneList.appendChild(node);
    }

    // Removes just the one card that was set, in place, instead of calling
    // render() (which rebuilds the whole grid from scratch - found live to
    // reload every remaining poster and jump scroll position back to the
    // top on every single save). Falls back to a full render() once the
    // current group's queue actually empties, or the done list doesn't
    // exist in the DOM yet (its first entry is a real layout change
    // render() already knows how to draw).
    function removeDoneCard(form, updatedRow) {
      let rows = window.supabaseQueueRows(config.part);
      let openCount = rows.filter((row) => !config.isDone(row)).length;
      let group = active
        ? window
            .groupSupabaseQueueRows(rows, active.kind, membership)
            .find((candidate) => candidate.id === active.id)
        : null;
      let queue = group ? openRows(group) : [];
      let doneList = container.querySelector(".queue-done-list");

      if (!queue.length || !doneList) {
        render();
        return;
      }

      form.remove();

      let progress = container.querySelector(".queue-progress");
      if (progress) {
        progress.querySelector("b").textContent = rows.length - openCount;
        progress.querySelector("progress").value = rows.length - openCount;
      }
      let count = container.querySelector("[data-queue-open-count]");
      if (count) count.textContent = queue.length;
      let option = Array.from(
        container.querySelector("[data-queue-group]")?.options || [],
      ).find((candidate) => candidate.value === active.id);
      if (option) option.textContent = `${group.name} · ${queue.length}`;

      if (updatedRow) insertDoneEntry(doneList, updatedRow);
    }

    function navigate(url) {
      window.history.pushState(null, "", url);
      render();
    }

    container.addEventListener("click", (event) => {
      let arrow = event.target.closest("a.queue-arrow");
      if (arrow) {
        event.preventDefault();
        navigate(arrow.getAttribute("href"));
      }
    });

    container.addEventListener("change", (event) => {
      let kindSelect = event.target.closest("[data-queue-kind]");
      if (kindSelect) {
        navigate(pageUrl(kindSelect.value, ""));
        return;
      }
      let groupSelect = event.target.closest("[data-queue-group]");
      if (groupSelect)
        navigate(pageUrl(requestedView().kind, groupSelect.value));
    });

    window.addEventListener("popstate", () => {
      render();
    });

    container.addEventListener("submit", async (event) => {
      let form = event.target.closest("[data-queue-row]");
      if (!form) return;
      event.preventDefault();
      let button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        let updated = await config.save(
          form.dataset.queueRow,
          config.readInput(form),
        );
        removeDoneCard(form, updated);
      } catch (error) {
        button.disabled = false;
        alert(error.message || String(error));
      }
    });

    async function boot() {
      let access = await window.resolveSupabaseAccountGate();
      if (!access.allowed) {
        window.renderSupabaseAccountGate(access, container);
        return;
      }
      window.renderHeaderAuthStatus?.(access.user);
      // Found running this for real: a transient network error here (or
      // in render()) left <main> stuck showing the gate's "loading..."
      // placeholder forever, with no visible error at all - the gate
      // itself already handles its own errors correctly (#413's fixes),
      // but nothing downstream of a successful gate did. Genuine errors
      // must surface, not disappear behind stale placeholder text.
      try {
        await window.loadSupabaseWorkspace({ parts: [config.part] });
        render();
      } catch (error) {
        container.innerHTML = `<section class="detail-empty"><h2>${escape(config.words.loadError)}</h2><p>${escape(error.message || String(error))}</p></section>`;
      }
    }

    boot();
  };
})();
