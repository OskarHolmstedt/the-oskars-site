/** @file Renders and binds persisted notes for supported entity detail pages. */

(function () {
  let ui = window.uiText || ((text) => text);

  function noteStore(scope) {
    state.entityNotes ||= {
      people: {},
      periods: {},
      franchises: {},
      tags: {},
      categories: {},
      projects: {},
    };
    state.entityNotes[scope] ||= {};
    return state.entityNotes[scope];
  }

  /**
   * Renders an entity note section in display mode.
   * @param {string} scope Entity-note collection name.
   * @param {string} key Entity identifier within the collection.
   * @param {string} [label] User-facing note label.
   * @returns {string}
   */
  window.renderEntityNote = function (scope, key, label = ui("Note")) {
    let escape = window.pageEscape;
    let note = String(noteStore(scope)[key] || "").trim();
    return `<section class="detail-note" data-entity-note="${escape(scope)}" data-note-key="${escape(key)}" data-note-label="${escape(label)}"><div><h2>${escape(label)}</h2><button type="button" data-edit-entity-note>${note ? escape(ui("Edit")) : escape(ui("Add note"))}</button></div>${note ? `<p>${escape(note)}</p>` : `<p class="detail-note-empty">${escape(ui("No note yet."))}</p>`}</section>`;
  };

  /**
   * Binds delegated edit, cancel, and save behavior for entity notes.
   * @param {Element} container Container hosting entity note sections.
   */
  window.bindEntityNoteEditor = function (container) {
    container.addEventListener("click", (event) => {
      let button = event.target.closest("[data-edit-entity-note]");
      if (!button) return;
      let section = button.closest("[data-entity-note]");
      let note =
        noteStore(section.dataset.entityNote)[section.dataset.noteKey] || "";
      section.innerHTML = `<form class="entity-note-form"><textarea name="note" rows="4" maxlength="1200">${window.pageEscape(note)}</textarea><div><button type="submit">${window.pageEscape(ui("Save note"))}</button><button type="button" data-cancel-entity-note>${window.pageEscape(ui("Cancel"))}</button></div></form>`;
      section.querySelector("textarea")?.focus();
    });
    container.addEventListener("click", (event) => {
      let button = event.target.closest("[data-cancel-entity-note]");
      if (!button) return;
      let section = button.closest("[data-entity-note]");
      section.outerHTML = window.renderEntityNote(
        section.dataset.entityNote,
        section.dataset.noteKey,
        section.dataset.noteLabel || ui("Note"),
      );
    });
    container.addEventListener("submit", (event) => {
      let form = event.target.closest(".entity-note-form");
      if (!form) return;
      event.preventDefault();
      let section = form.closest("[data-entity-note]");
      let value = String(new FormData(form).get("note") || "").trim();
      let store = noteStore(section.dataset.entityNote);
      let before = String(store[section.dataset.noteKey] || "");
      if (value) store[section.dataset.noteKey] = value;
      else delete store[section.dataset.noteKey];
      if (before !== value && window.recordEdit) {
        window.recordEdit({
          type: "entity note",
          summary: `${section.dataset.entityNote}:${section.dataset.noteKey}`,
          sheetHint: "Local notes",
          changes: [
            {
              field: section.dataset.noteLabel || ui("Note"),
              before,
              after: value,
            },
          ],
          undo: {
            version: 1,
            kind: "entity-note",
            target: {
              noteScope: section.dataset.entityNote,
              noteKey: section.dataset.noteKey,
            },
            fields: [
              {
                key: "note",
                label: section.dataset.noteLabel || ui("Note"),
                before,
                after: value,
              },
            ],
          },
          context: {
            noteScope: section.dataset.entityNote,
            noteKey: section.dataset.noteKey,
          },
        });
      }
      window.save();
      section.outerHTML = window.renderEntityNote(
        section.dataset.entityNote,
        section.dataset.noteKey,
        section.dataset.noteLabel || ui("Note"),
      );
    });
  };
})();
