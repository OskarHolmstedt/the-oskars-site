/** @file Owns the owner catalog table and guarded row edits over Data tools' shared film/people arrays, without personal archive hydration. */

const catalogFilmFields = [
  ["title", "Title"],
  ["year", "Year", "number"],
  ["tmdb_id", "TMDB movie ID", "number"],
  ["tmdb_tv_ref", "TMDB TV reference"],
  ["swedish_title", "Swedish title"],
  ["runtime_minutes", "Runtime (minutes)", "number"],
  ["country", "Countries"],
  ["primary_country", "Primary country"],
  ["original_language", "Original language"],
  ["medium", "Medium"],
  ["type", "Type"],
  ["screenplay_type", "Screenplay type"],
  ["adaptation_source", "Adaptation source"],
  ["poster_url", "Poster URL"],
  ["letterboxd_url", "Letterboxd URL"],
];
const editorialDecisionHelp =
  "Screenplay type, adaptation source, primary country and Type are yours to decide: a changed value becomes your decision, which reviews show beside TMDB's value without asking again and which fetches never overwrite. Clear one of them to follow TMDB again. Other changed fields are checked against TMDB on the next review; choose Keep there to make a different value your decision.";
const catalogPersonFields = [
  ["name", "Name"],
  ["tmdb_id", "TMDB person ID", "number"],
  ["portrait_url", "Portrait URL"],
  ["source_url", "Source URL"],
];

/** Captures editable values and exact director links for a guarded catalog write. @param {'films'|'people'} entity Table. @param {Object} row Catalog row. @returns {Object} Expected database values. */
window.sharedCatalogEditSnapshot = function (entity, row) {
  let fields = entity === "films" ? catalogFilmFields : catalogPersonFields;
  let result = Object.fromEntries(
    fields.map(([key]) => [key, row[key] ?? null]),
  );
  if (entity === "films")
    result.director_ids = (row.credits || [])
      .filter((c) => c.role === "director")
      .map((c) => c.person_id || c.people?.id)
      .filter(Boolean)
      .sort();
  return result;
};

/** Creates a searchable editor sharing the caller's loaded catalog and update callback. @param {Object} options Catalog getters, client, rendering and busy callbacks. @returns {Object} Rendering, event and open methods. */
window.createSharedCatalogEditor = function (options) {
  const esc = window.pageEscape;
  let entity = "films",
    query = "",
    filter = "all",
    page = 0,
    edit = null,
    saving = false,
    tagging = false,
    vocabulary = null,
    opening = false,
    message = "",
    error = "";
  const fields = () =>
    entity === "films" ? catalogFilmFields : catalogPersonFields;
  const rows = () => (entity === "films" ? options.films() : options.people());
  let selected = new Set(),
    expanded = new Set(),
    rowResults = new Map();
  let processing = false,
    stopped = false,
    progress = null;
  const statuses = {
    ready: "Ready to fetch and verify",
    review: "Needs your decision",
    changed: "Changed since review",
    reviewed: "Reviewed — no pending decisions",
  };
  const status = (row) => window.catalogFilmWorkflowStatus?.(row) || "ready";
  const blocked = () =>
    saving || tagging || opening || processing || options.busy();
  async function processRows(batch, refresh = false) {
    if (blocked() || edit || !options.process) return;
    // Freeze membership before changing any rows or filter statuses.
    batch = [...batch];
    processing = true;
    options.setProcessing?.(true);
    stopped = false;
    progress = { done: 0, total: batch.length };
    let cursor = 0,
      renderTimer = null;
    function renderProgress() {
      if (renderTimer === null)
        renderTimer = setTimeout(() => {
          renderTimer = null;
          options.render();
        }, 250);
    }
    options.render();
    async function worker() {
      while (!stopped && cursor < batch.length) {
        let row = batch[cursor++];
        rowResults.set(row.id, "Processing…");
        renderProgress();
        try {
          let reused =
            window.hasCurrentFilmMetadataVerification(row) && !refresh;
          let report = await options.process(row, { refresh });
          let fills = Object.values(report?.fields || {}).filter(
            (f) => f.status === "filled",
          ).length;
          rowResults.set(
            row.id,
            `${statuses[status(row)]}${reused ? " · current review reused" : fills ? ` · ${fills} fields filled` : ""}`,
          );
          selected.delete(row.id);
        } catch (e) {
          rowResults.set(
            row.id,
            `Failed: ${e.message || e}. Select and process again to retry.`,
          );
        }
        progress.done++;
        renderProgress();
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(4, batch.length) }, worker),
      );
    } finally {
      processing = false;
      options.setProcessing?.(false);
      if (renderTimer !== null) clearTimeout(renderTimer);
      options.render();
    }
  }
  function personLabel(person) {
    return `${person.name} · TMDB ${person.tmdb_id || "none"} · ${person.id.slice(0, 8)}`;
  }
  function matches(row) {
    let text = [
      row.id,
      row.title,
      row.name,
      row.year,
      row.tmdb_id,
      row.tmdb_tv_ref,
      ...(row.credits || [])
        .filter((c) => c.role === "director")
        .map((c) => c.people?.name),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (!text.includes(query.toLocaleLowerCase())) return false;
    if (statuses[filter]) return entity === "films" && status(row) === filter;
    if (filter === "identity")
      return (
        entity === "films" &&
        row.tmdb_verification?.identity === "doubtful" &&
        !!window.hasCurrentFilmMetadataVerification?.(row)
      );
    if (filter === "failed")
      return rowResults.get(row.id)?.startsWith("Failed:");
    if (filter === "missing") {
      let keys =
        entity === "films"
          ? [
              "title",
              "year",
              "runtime_minutes",
              "country",
              "poster_url",
              "medium",
              "screenplay_type",
              "original_language",
              "genre",
            ]
          : ["name", "tmdb_id", "portrait_url"];
      return (
        keys.some((key) => !row[key] || row[key] === "unknown") ||
        (entity === "films" &&
          !(row.credits || []).some((c) => c.role === "director"))
      );
    }
    return true;
  }
  function identityEditor(row) {
    if (!options.findIdentity) return "";
    return `<fieldset><legend>TMDB identity</legend><button type="button" data-catalog-find-identity${blocked() ? " disabled" : ""}>Find candidates by title</button><p>Choose a candidate to put its identity in the draft, then save to confirm. You can also enter an ID or TV reference directly.</p>${(edit.candidates || []).map((c, i) => `<p>${esc(c.title)} (${esc(c.year || "unknown year")}) · ${esc(c.reference)} <button type="button" data-catalog-use-identity="${i}"${blocked() ? " disabled" : ""}>Use this identity</button></p>`).join("")}${edit.searched && !edit.candidates?.length ? `<p>No movie or TV candidates found for ${esc(row.title)}.</p>` : ""}</fieldset>`;
  }
  /** TMDB's director evidence for the row being edited, resolved to loaded people ids. @returns {Set<string>} */
  function tmdbDirectorPersonIds() {
    let report = options.getReview?.(rows().find((r) => r.id === edit.id));
    let suggestions = (report?.fields.directors?.source || []).filter(
      (p) => p && typeof p === "object",
    );
    return new Set(
      suggestions
        .map(
          (p) =>
            options
              .people()
              .find((q) =>
                p.tmdb_id
                  ? Number(q.tmdb_id) === Number(p.tmdb_id)
                  : q.name === p.name,
              )?.id,
        )
        .filter(Boolean),
    );
  }
  function directorEditor() {
    let selected = edit.directorIds.map(
      (id) =>
        options.people().find((p) => p.id === id) ||
        rows()
          .find((r) => r.id === edit.id)
          ?.credits?.find((c) => (c.person_id || c.people?.id) === id)
          ?.people || { id, name: "Unknown person" },
    );
    let report = options.getReview?.(rows().find((r) => r.id === edit.id));
    let suggestions = (report?.fields.directors?.source || []).filter(
      (p) => p && typeof p === "object",
    );
    let evidenceHtml = suggestions.length
      ? `<p>TMDB director evidence:</p><ul>${suggestions
          .map((p) => {
            let person = options
              .people()
              .find((q) =>
                p.tmdb_id
                  ? Number(q.tmdb_id) === Number(p.tmdb_id)
                  : q.name === p.name,
              );
            return `<li>${esc(p.name)} · TMDB ${esc(p.tmdb_id || "none")} ${person ? (edit.directorIds.includes(person.id) ? "— retained" : `<button type="button" data-catalog-add-director="${esc(person.id)}"${blocked() ? " disabled" : ""}>Add director link</button>`) : "— no matching person in the loaded catalog"}</li>`;
          })
          .join("")}</ul>`
      : "";
    return `<fieldset class="catalog-directors"><legend>Director credits</legend>${evidenceHtml}<p>Remove a link to correct this film. This does not delete the person or their other credits. A director TMDB doesn't credit can be marked uncredited/editorial so it never makes this film's identity doubtful.</p><ul>${selected.map((p) => `<li>${esc(personLabel(p))}${edit.directorUncredited[p.id] ? " · uncredited/editorial credit" : ""} <button type="button" data-catalog-remove-director="${esc(p.id)}"${blocked() ? " disabled" : ""}>Remove link</button> <button type="button" data-catalog-toggle-director-uncredited="${esc(p.id)}"${blocked() ? " disabled" : ""}>${edit.directorUncredited[p.id] ? "Unmark uncredited" : "Mark uncredited/editorial"}</button></li>`).join("")}</ul><label>Find an existing person <input type="search" data-catalog-person-search placeholder="Name or TMDB ID"${blocked() ? " disabled" : ""}></label><div data-catalog-person-results></div></fieldset>`;
  }
  async function loadCatalogTags(filmId) {
    let client = options.client();
    if (!vocabulary) {
      let { data, error: e } = await client
        .from("catalog_tags")
        .select("id, name, kind, tv_only")
        .order("name");
      if (e) throw e;
      vocabulary = data;
    }
    let { data, error: e } = await client
      .from("film_catalog_tags")
      .select("tag_id, source, removed")
      .eq("film_id", filmId);
    if (e) throw e;
    return data;
  }
  const tagKinds = [
    ["genre", "Genres"],
    ["theme", "Themes"],
    ["form", "Forms"],
    ["source", "Source authors"],
  ];
  function tagEditor(row) {
    let byId = new Map((vocabulary || []).map((t) => [t.id, t]));
    let name = (link) => byId.get(link.tag_id)?.name || "Unknown tag";
    let present = edit.tags.filter((l) => !l.removed);
    let removed = edit.tags.filter((l) => l.removed);
    let disabled = blocked() ? " disabled" : "";
    let chips = present
      .map(
        (l) =>
          `<li>${esc(name(l))} <small>${l.source === "tmdb" ? "from TMDB" : "your choice"}</small> <button type="button" data-catalog-tag-remove="${esc(l.tag_id)}"${disabled}>Remove</button></li>`,
      )
      .join("");
    let restored = removed
      .map(
        (l) =>
          `<li>${esc(name(l))} <small>removed by you</small> <button type="button" data-catalog-tag-restore="${esc(l.tag_id)}"${disabled}>Restore</button></li>`,
      )
      .join("");
    let options_ = tagKinds
      .map(([kind, label]) => {
        let choices = (vocabulary || []).filter(
          (t) => t.kind === kind && !present.some((l) => l.tag_id === t.id),
        );
        return choices.length
          ? `<optgroup label="${esc(label)}">${choices.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.tv_only ? " (TV)" : ""}</option>`).join("")}</optgroup>`
          : "";
      })
      .join("");
    return `<fieldset class="catalog-tags"><legend>Catalog tags</legend><p>Genres and objective tags shared by everyone. TMDB's genres seed them (${esc(row.genre || "none listed")}); what you add or remove here is your decision and a TMDB refresh keeps it. Changes save at once.</p><ul>${chips || "<li>No catalog tags.</li>"}</ul>${restored ? `<ul>${restored}</ul>` : ""}<div class="data-form-actions"><select data-catalog-tag-choice aria-label="Catalog tag to add"${disabled}>${options_}</select><button type="button" data-catalog-tag-add${disabled}>Add tag</button></div><div class="data-form-actions"><input data-catalog-tag-name placeholder="New tag name" aria-label="New catalog tag name"${disabled}><select data-catalog-tag-kind aria-label="New tag kind"${disabled}>${tagKinds.map(([kind, label]) => `<option value="${kind}">${esc(label)}</option>`).join("")}</select><label><input type="checkbox" data-catalog-tag-tv${disabled}> TV only</label><button type="button" data-catalog-tag-create${disabled}>Create and add</button></div></fieldset>`;
  }
  async function changeTag(target) {
    const field = (name) =>
      target.closest("fieldset").querySelector(`[data-catalog-tag-${name}]`);
    tagging = true;
    error = "";
    options.render();
    try {
      let client = options.client();
      let tagId =
        target.dataset.catalogTagRemove || target.dataset.catalogTagRestore;
      let present = !target.hasAttribute("data-catalog-tag-remove");
      if (target.hasAttribute("data-catalog-tag-add"))
        tagId = field("choice").value;
      if (target.hasAttribute("data-catalog-tag-create")) {
        let { data, error: e } = await client.rpc("create_catalog_tag", {
          p_name: field("name").value,
          p_kind: field("kind").value,
          p_tv_only: field("tv").checked,
        });
        if (e) throw e;
        vocabulary = null;
        tagId = data.id;
      }
      if (!tagId) throw new Error("Choose a catalog tag first.");
      let { error: e } = await client.rpc("set_film_catalog_tag", {
        p_film_id: edit.id,
        p_tag_id: tagId,
        p_present: present,
      });
      if (e) throw e;
      edit.tags = await loadCatalogTags(edit.id);
    } catch (e) {
      error = e.message || String(e);
    } finally {
      tagging = false;
      options.render();
    }
  }
  function canDelete() {
    return entity === "films" && !!options.deleteFilm;
  }
  function editForm(row) {
    let decided = new Set(
      entity === "films" ? row.owner_decided_fields || [] : [],
    );
    return `${entity === "films" ? options.reviewHtml?.(row, true) || "" : ""}<form data-catalog-save class="catalog-edit-form"><p>Editing shared metadata for <strong>${esc(row.title || row.name)}</strong>. Blank clears a value. Use either a movie ID or TV reference, not both.</p>${entity === "films" ? `<p>${esc(editorialDecisionHelp)}</p>` : ""}<div class="catalog-edit-fields">${fields()
      .map(
        ([key, label, type]) =>
          `<label>${esc(label)}${decided.has(key) ? " · your decision" : ""}<input data-catalog-field="${key}" name="${key}" type="${type || "text"}" value="${esc(edit.draft[key] ?? "")}"${blocked() ? " disabled" : ""}></label>`,
      )
      .join(
        "",
      )}</div>${entity === "films" ? identityEditor(row) + directorEditor() : "<p>Changing a portrait or TMDB identity clears stale fetched-portrait attribution; the image remains available as a manual image.</p>"}<p role="alert">${esc(error)}</p><div class="data-form-actions"><button type="submit"${blocked() ? " disabled" : ""}>${saving ? "Saving…" : "Save shared metadata"}</button><button type="button" data-catalog-cancel${blocked() ? " disabled" : ""}>Cancel</button>${canDelete() ? `<button type="button" data-catalog-delete${blocked() ? " disabled" : ""}>Delete film permanently</button>` : ""}</div></form>${entity === "films" && edit.tags ? tagEditor(row) : ""}`;
  }
  function html() {
    let filtered = rows().filter(matches);
    let pages = Math.max(1, Math.ceil(filtered.length / 50));
    page = Math.min(page, pages - 1);
    let cols = fields();
    return `<section class="film-edit-section" id="sharedCatalogEditor"><h2>Shared catalog editor</h2><p>${options.films().length} films and ${options.people().length} people loaded, with film credits. Search, editing and verification use this catalog; your watched films, ratings and rankings are not loaded for them.</p><form data-catalog-search class="data-form-actions"><label>Table <select name="entity"${edit || blocked() ? " disabled" : ""}><option value="films"${entity === "films" ? " selected" : ""}>Films</option><option value="people"${entity === "people" ? " selected" : ""}>People</option></select></label><label>Search <input name="query" type="search" value="${esc(query)}" placeholder="Title, name, year or ID"${edit || blocked() ? " disabled" : ""}></label><label>Filter <select name="filter"${edit || blocked() ? " disabled" : ""}>${[
      ["all", "All"],
      ["missing", "Missing metadata"],
      ...(entity === "films"
        ? [...Object.entries(statuses), ["identity", "Identity doubtful"]]
        : []),
      ["failed", "Failed this session"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}"${filter === value ? " selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label><button type="submit"${edit || blocked() ? " disabled" : ""}>Search</button><button type="button" data-catalog-reload${edit || blocked() ? " disabled" : ""}>Reload shared catalog</button></form>${entity === "films" ? `<div class="data-form-actions"><button type="button" data-catalog-process="selected"${edit || blocked() || !selected.size ? " disabled" : ""}>Process selected (${selected.size})</button><button type="button" data-catalog-process="filtered"${edit || blocked() || !filtered.length ? " disabled" : ""}>Process filtered results (${filtered.length})</button><button type="button" data-catalog-stop${!processing || stopped ? " disabled" : ""}>Stop after active rows</button></div><p>Process fetches and verifies unchecked rows, reuses saved evidence after edits, and leaves current reviews unchanged. A row with a wrong TMDB identity can be corrected in Edit, or deleted there if it is not a real film. Reviewed means no pending decisions, not proof of every field. Unavailable fields can be entered manually and are never retried for the same identity.</p>${progress ? `<p role="status">${processing ? "Processing" : stopped ? "Stopped" : "Finished"}: ${progress.done} / ${progress.total}. Keep this page open while processing; saved rows survive a reload.</p>` : ""}` : ""}<p role="status">${esc(message)}</p>${!edit && error ? `<p role="alert">${esc(error)}</p>` : ""}<p>${filtered.length} rows · page ${page + 1} / ${pages}. Scroll horizontally to see every metadata column.</p><div class="leaderboard-wrap catalog-table-wrap" tabindex="0" aria-label="Shared catalog metadata table"><table class="leaderboard catalog-table"><thead><tr><th>Actions and review</th>${cols.map(([, label]) => `<th>${esc(label)}</th>`).join("")}${entity === "films" ? "<th>Directors</th>" : ""}</tr></thead><tbody>${filtered
      .slice(page * 50, (page + 1) * 50)
      .map(
        (row) =>
          `<tr><td>${entity === "films" ? `<label><input type="checkbox" data-catalog-select="${esc(row.id)}" aria-label="Select ${esc(row.title)}"${selected.has(row.id) ? " checked" : ""}${edit || blocked() ? " disabled" : ""}> ${esc(statuses[status(row)])}</label>${row.tmdb_verification?.identity === "doubtful" && window.hasCurrentFilmMetadataVerification?.(row) ? "<small>Identity doubtful: TMDB's title, year or directors disagree.</small>" : ""}${Object.values(row.tmdb_field_outcomes?.[row.tmdb_tv_ref || `movie:${row.tmdb_id}`] || {}).includes("unavailable") ? "<small>Some fields unavailable from TMDB; manual entry remains possible.</small>" : ""}` : ""}<button type="button" data-catalog-edit="${esc(row.id)}"${edit || blocked() ? " disabled" : ""}>Edit</button>${entity === "films" ? `<button type="button" data-catalog-review="${esc(row.id)}"${edit || blocked() || !row.tmdb_verification ? " disabled" : ""}>${expanded.has(row.id) ? "Hide" : "Show"} review</button><button type="button" data-catalog-refresh="${esc(row.id)}"${edit || blocked() ? " disabled" : ""}>Refresh TMDB evidence</button>` : ""}${rowResults.has(row.id) ? `<p role="status">${esc(rowResults.get(row.id))}</p>` : ""}</td>${cols.map(([key]) => `<td><span class="catalog-cell" title="${esc(row[key] ?? "")}">${esc(row[key] ?? "—")}</span></td>`).join("")}${
            entity === "films"
              ? `<td><span class="catalog-cell">${esc(
                  (row.credits || [])
                    .filter((c) => c.role === "director")
                    .map((c) =>
                      c.people?.name
                        ? `${c.people.name}${c.uncredited ? " (uncredited)" : ""}`
                        : null,
                    )
                    .filter(Boolean)
                    .join(", ") || "—",
                )}</span></td>`
              : ""
          }</tr>${expanded.has(row.id) && edit?.id !== row.id ? `<tr><td colspan="${cols.length + (entity === "films" ? 2 : 1)}">${options.reviewHtml?.(row) || ""}</td></tr>` : ""}${edit?.id === row.id ? `<tr><td colspan="${cols.length + (entity === "films" ? 2 : 1)}">${editForm(row)}</td></tr>` : ""}`,
      )
      .join(
        "",
      )}</tbody></table></div><div class="data-form-actions"><button type="button" data-catalog-page="-1"${page === 0 || edit || blocked() ? " disabled" : ""}>Previous</button><button type="button" data-catalog-page="1"${page + 1 >= pages || edit || blocked() ? " disabled" : ""}>Next</button></div></section>`;
  }
  async function open(id, table = "films") {
    if (blocked()) return;
    if (edit && (edit.id !== id || entity !== table)) {
      error = "Save or cancel the current row before editing another.";
      options.render();
      return;
    }
    entity = table;
    query = id;
    filter = "all";
    page = 0;
    let row = rows().find((r) => r.id === id);
    if (!row) return;
    opening = true;
    options.render();
    try {
      // Background enrichment may have created links without UUIDs in memory.
      if (
        table === "films" &&
        (row.credits || []).some(
          (c) => c.role === "director" && !(c.person_id || c.people?.id),
        )
      )
        Object.assign(row, await window.loadSupabaseFilmCatalogEditorRow(id));
      if (table === "films") await options.loadReview?.(row);
      let tags = table === "films" ? await loadCatalogTags(id) : undefined;
      let expected = window.sharedCatalogEditSnapshot(table, row);
      edit = {
        id,
        expected,
        draft: { ...expected },
        directorIds: [...(expected.director_ids || [])],
        // Keyed by person id rather than index-aligned with directorIds,
        // since add/remove splice that array and a map survives reordering.
        directorUncredited: Object.fromEntries(
          (row.credits || [])
            .filter((c) => c.role === "director")
            .map((c) => [c.person_id || c.people?.id, Boolean(c.uncredited)])
            .filter(([id]) => id),
        ),
        removedUncreditedIds: new Set(),
        tags,
      };
      message = "";
      error = "";
    } catch (e) {
      error = e.message;
    } finally {
      opening = false;
      options.render();
    }
    document
      .getElementById("sharedCatalogEditor")
      ?.scrollIntoView({ block: "start" });
  }
  let personSearchTimer = null;
  function input(event) {
    if (!edit || blocked()) return false;
    let field = event.target.dataset.catalogField;
    if (field) {
      edit.draft[field] = event.target.value;
      return true;
    }
    if (event.target.matches("[data-catalog-person-search]")) {
      let target = event.target;
      let fieldset = target.closest("fieldset");
      if (personSearchTimer) clearTimeout(personSearchTimer);
      personSearchTimer = setTimeout(() => {
        personSearchTimer = null;
        let q = target.value.trim().toLocaleLowerCase();
        let choices = q
          ? options
              .people()
              .filter(
                (p) =>
                  !edit.directorIds.includes(p.id) &&
                  `${p.name} ${p.tmdb_id || ""}`
                    .toLocaleLowerCase()
                    .includes(q),
              )
              .slice(0, 15)
          : [];
        let results = fieldset?.querySelector?.(
          "[data-catalog-person-results]",
        );
        if (results) {
          results.innerHTML =
            choices
              .map(
                (p) =>
                  `<button type="button" data-catalog-add-director="${esc(p.id)}">Add ${esc(personLabel(p))}</button>`,
              )
              .join("") ||
            (q ? "<p>No matching people in the loaded catalog.</p>" : "");
        }
      }, 120);
      return true;
    }
    return false;
  }
  async function click(event) {
    let target = event.target.closest(
      "[data-catalog-edit],[data-catalog-cancel],[data-catalog-delete],[data-catalog-page],[data-catalog-remove-director],[data-catalog-add-director],[data-catalog-toggle-director-uncredited],[data-catalog-reload],[data-catalog-select],[data-catalog-process],[data-catalog-stop],[data-catalog-review],[data-catalog-refresh],[data-catalog-find-identity],[data-catalog-use-identity],[data-catalog-tag-remove],[data-catalog-tag-restore],[data-catalog-tag-add],[data-catalog-tag-create]",
    );
    if (!target) return false;
    if (target.hasAttribute("data-catalog-stop")) {
      stopped = true;
      options.render();
      return true;
    }
    if (blocked()) return true;
    if (
      edit &&
      ["remove", "restore", "add", "create"].some((kind) =>
        target.hasAttribute(`data-catalog-tag-${kind}`),
      )
    ) {
      await changeTag(target);
      return true;
    }
    if (target.hasAttribute("data-catalog-delete") && edit) {
      let row = rows().find((r) => r.id === edit.id);
      if (!row || !canDelete()) return true;
      saving = true;
      error = "";
      options.render();
      try {
        if (await options.deleteFilm(row)) {
          selected.delete(row.id);
          rowResults.delete(row.id);
          edit = null;
          query = "";
          message = `Deleted ${row.title}${row.year ? ` (${row.year})` : ""}.`;
        }
      } catch (e) {
        error = e.message || String(e);
      } finally {
        saving = false;
        options.render();
      }
      return true;
    }
    if (target.hasAttribute("data-catalog-find-identity") && edit) {
      saving = true;
      error = "";
      options.render();
      try {
        edit.candidates = await options.findIdentity(edit.draft.title);
        edit.searched = true;
      } catch (e) {
        error = e.message;
      } finally {
        saving = false;
        options.render();
      }
      return true;
    }
    if (target.hasAttribute("data-catalog-use-identity") && edit) {
      let candidate =
        edit.candidates?.[Number(target.dataset.catalogUseIdentity)];
      if (candidate) {
        edit.draft.tmdb_id = candidate.tmdb_id;
        edit.draft.tmdb_tv_ref = candidate.tmdb_tv_ref;
        options.render();
      }
      return true;
    }
    if (target.hasAttribute("data-catalog-select")) {
      let id = target.dataset.catalogSelect;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      options.render();
      return true;
    }
    if (target.hasAttribute("data-catalog-process")) {
      await processRows(
        rows().filter(
          target.dataset.catalogProcess === "filtered"
            ? matches
            : (row) => selected.has(row.id),
        ),
      );
      return true;
    }
    if (target.hasAttribute("data-catalog-refresh")) {
      await processRows(
        rows().filter((row) => row.id === target.dataset.catalogRefresh),
        true,
      );
      return true;
    }
    if (target.hasAttribute("data-catalog-review")) {
      let row = rows().find((r) => r.id === target.dataset.catalogReview);
      if (expanded.has(row.id)) expanded.delete(row.id);
      else
        try {
          await options.loadReview?.(row);
          expanded.add(row.id);
        } catch (e) {
          error = e.message;
        }
      options.render();
      return true;
    }
    if (target.hasAttribute("data-catalog-edit")) {
      await open(target.dataset.catalogEdit, entity);
      return true;
    }
    if (target.hasAttribute("data-catalog-reload")) {
      await options.reload();
      return true;
    }
    if (target.hasAttribute("data-catalog-cancel")) {
      edit = null;
      error = "";
    }
    if (target.hasAttribute("data-catalog-page") && !edit)
      page = Math.max(0, page + Number(target.dataset.catalogPage));
    if (edit && target.hasAttribute("data-catalog-remove-director")) {
      let id = target.dataset.catalogRemoveDirector;
      // An uncredited credit is otherwise never deleted by this save (a
      // refresh or future enrichment must never silently drop one) - an
      // explicit Remove click opts this specific id into actual deletion.
      if (edit.directorUncredited[id]) edit.removedUncreditedIds.add(id);
      edit.directorIds = edit.directorIds.filter((did) => did !== id);
      delete edit.directorUncredited[id];
    }
    if (
      edit &&
      target.hasAttribute("data-catalog-add-director") &&
      !edit.directorIds.includes(target.dataset.catalogAddDirector)
    ) {
      let id = target.dataset.catalogAddDirector;
      edit.directorIds.push(id);
      edit.removedUncreditedIds.delete(id);
      // TMDB doesn't credit this person for this film - ask whether it's an
      // uncredited/editorial addition (#784) rather than silently leaving it
      // an unmarked mismatch.
      if (!tmdbDirectorPersonIds().has(id))
        edit.directorUncredited[id] = window.confirm(
          "TMDB's director credits for this film don't list this person. Add as an uncredited/editorial director credit? Choose Cancel to add it as a plain credit (flagged as a mismatch until TMDB lists it too).",
        );
    }
    if (
      edit &&
      target.hasAttribute("data-catalog-toggle-director-uncredited")
    ) {
      let id = target.dataset.catalogToggleDirectorUncredited;
      edit.directorUncredited[id] = !edit.directorUncredited[id];
    }
    options.render();
    return true;
  }
  async function submit(event) {
    let form = event.target;
    if (form.matches("[data-catalog-search]")) {
      event.preventDefault();
      if (edit || blocked()) return true;
      if (entity !== form.elements.entity.value) selected.clear();
      entity = form.elements.entity.value;
      query = form.elements.query.value.trim();
      filter = form.elements.filter.value;
      page = 0;
      options.render();
      return true;
    }
    if (!form.matches("[data-catalog-save]")) return false;
    event.preventDefault();
    if (!edit || blocked()) return true;
    error = "";
    try {
      let patch = {};
      for (let [key, , type] of fields()) {
        let value = String(edit.draft[key] ?? "").trim();
        value = value === "" ? null : type === "number" ? Number(value) : value;
        if (type === "number" && value !== null && !Number.isSafeInteger(value))
          throw new Error("Numeric metadata must be a whole number.");
        if (value !== edit.expected[key]) patch[key] = value;
      }
      saving = true;
      options.render();
      let args =
        entity === "films"
          ? {
              p_film_id: edit.id,
              p_expected: edit.expected,
              p_patch: patch,
              p_director_ids: edit.directorIds,
              p_uncredited_director_ids: edit.directorIds.filter(
                (id) => edit.directorUncredited[id],
              ),
              p_remove_uncredited_ids: [...edit.removedUncreditedIds],
            }
          : { p_person_id: edit.id, p_expected: edit.expected, p_patch: patch };
      let { data, error: rpcError } = await options
        .client()
        .rpc(
          entity === "films"
            ? "edit_shared_catalog_film"
            : "edit_shared_catalog_person",
          args,
        );
      if (
        rpcError &&
        entity === "films" &&
        options.mergeIntoIdentityHolder &&
        ("tmdb_id" in patch || "tmdb_tv_ref" in patch) &&
        window.isTmdbIdentityConflict?.(rpcError)
      ) {
        let duplicate = rows().find((r) => r.id === edit.id);
        let holder = await options.mergeIntoIdentityHolder(edit.id, {
          tmdbId: "tmdb_id" in patch ? patch.tmdb_id : edit.expected.tmdb_id,
          tvTmdbRef:
            "tmdb_tv_ref" in patch
              ? patch.tmdb_tv_ref
              : edit.expected.tmdb_tv_ref,
        });
        if (holder) {
          selected.delete(edit.id);
          rowResults.delete(edit.id);
          edit = null;
          query = holder.id;
          filter = "all";
          page = 0;
          message = `Same film as ${holder.title} (${holder.year ?? "unknown year"}), which already has that TMDB identity. Merged ${duplicate?.title || "this row"} into it; its watched, list, ranking and nomination links moved over and the existing row's metadata was kept.`;
          return true;
        }
      }
      if (rpcError) throw rpcError;
      Object.assign(
        rows().find((r) => r.id === edit.id),
        data,
      );
      if (entity === "people")
        for (let film of options.films())
          for (let credit of film.credits || [])
            if ((credit.person_id || credit.people?.id) === data.id)
              Object.assign(credit.people, {
                id: data.id,
                name: data.name,
                tmdb_id: data.tmdb_id,
              });
      window.invalidateSupabaseHydrationCache?.();
      edit = null;
      message = "Shared metadata saved.";
      try {
        let result = await options.afterSave?.(entity, data);
        if (result) message += ` ${result}`;
      } catch (e) {
        error = `Metadata was saved, but reassessment failed: ${e.message}. Process this row to retry.`;
      }
      setTimeout(() => {
        message = "";
        options.render();
      }, 2800);
    } catch (e) {
      error = e.message || String(e);
    } finally {
      saving = false;
      options.render();
    }
    return true;
  }
  return {
    html,
    open,
    input,
    click,
    submit,
    isEditing: () => !!edit,
    isSaving: () => saving || opening,
    isProcessing: () => processing,
    processRows,
    getRowResult: (id) => rowResults.get(id),
    showFilter(value) {
      if (!edit && !blocked()) {
        entity = "films";
        filter = value;
        query = "";
        page = 0;
        options.render();
      }
    },
  };
};
