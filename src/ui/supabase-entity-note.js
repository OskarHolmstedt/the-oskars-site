/**
 * @file Shared Supabase-backed entity note UI (issue #439), generalized
 * from tag.js's original page-specific note editor once franchise.js
 * needed the identical capability. Async parallel of notes.js's
 * synchronous renderEntityNote()/bindEntityNoteEditor() (which mutate
 * state.entityNotes/window.save() in place) - this reads/writes the
 * generic entity_notes table via loadSupabaseEntityNote()/
 * setSupabaseEntityNote() (src/core/supabase-workspace.js) instead.
 *
 * Unlike bindEntityNoteEditor's own narrower per-section DOM patch, the
 * caller's `rerender` is expected to be its own full-page render() (every
 * Supabase-backed collection page already rebuilds its whole container on
 * any state change), so this only ever needs the caller's note/editing/
 * busy state and a render trigger, not its own DOM surgery.
 */
(function () {
  let ui = window.uiText || ((text) => text);

  /**
   * Renders one entity note section, in either display or edit mode.
   * @param {{entityKind: string, entityKey: string, note: string, editing: boolean, busy: boolean, draft?: string, label?: string, escape?: function}} options
   * @returns {string}
   */
  window.renderSupabaseEntityNote = function (options) {
    let escape = options.escape || window.pageEscape;
    let { note, editing, busy, draft, label = ui("Note") } = options;
    if (editing) {
      // Prefers the caller's in-flight draft (set on submit, kept on a
      // failed save) over the last confirmed note - without this, the
      // busy-state rerender right after clicking Save, or a rerender after
      // the save fails, redraws the textarea from the still-stale
      // confirmed note and silently discards whatever the user just typed.
      let value = draft != null ? draft : note;
      return `<section class="detail-note" data-supabase-entity-note><form data-supabase-entity-note-form><textarea name="note" rows="4" maxlength="1200">${escape(value)}</textarea><div><button type="submit"${busy ? " disabled" : ""}>${escape(ui("Save note"))}</button><button type="button" data-cancel-supabase-entity-note>${escape(ui("Cancel"))}</button></div></form></section>`;
    }
    if (!note && busy) return "";
    return `<section class="detail-note" data-supabase-entity-note><div><h2>${escape(label)}</h2><button type="button" data-edit-supabase-entity-note${busy ? " disabled" : ""}>${escape(note ? ui("Edit") : ui("Add note"))}</button></div>${note ? `<p>${escape(note)}</p>` : `<p class="detail-note-empty">${escape(ui("No note yet."))}</p>`}</section>`;
  };

  /**
   * Binds delegated edit/cancel/save behavior for one Supabase entity note
   * section. `noteState` is a small mutable box ({note, editing, busy}) the
   * caller owns and reads back in its own render(); this function updates
   * it directly and calls `rerender` after every change.
   * @param {{container: Element, entityKind: string, entityKey: string|function(): string, state: {note: string, editing: boolean, busy: boolean}, rerender: function}} options
   *   `entityKey` may be a function, read at save time, for a page whose
   *   key is only known after it loads.
   */
  window.bindSupabaseEntityNoteEditor = function (options) {
    let {
      container,
      entityKind,
      entityKey,
      state: noteState,
      rerender,
    } = options;
    container.addEventListener("click", (event) => {
      if (event.target.closest("[data-edit-supabase-entity-note]")) {
        noteState.editing = true;
        noteState.draft = undefined;
        rerender();
      } else if (event.target.closest("[data-cancel-supabase-entity-note]")) {
        noteState.editing = false;
        noteState.draft = undefined;
        rerender();
      }
    });
    container.addEventListener("submit", async (event) => {
      let form = event.target.closest("[data-supabase-entity-note-form]");
      if (!form) return;
      event.preventDefault();
      let value = String(new FormData(form).get("note") || "").trim();
      noteState.draft = value;
      noteState.busy = true;
      rerender();
      try {
        await window.setSupabaseEntityNote(
          entityKind,
          typeof entityKey === "function" ? entityKey() : entityKey,
          value,
        );
        noteState.note = value;
        noteState.editing = false;
        noteState.draft = undefined;
      } catch (err) {
        alert(err.message || String(err));
      } finally {
        noteState.busy = false;
        rerender();
      }
    });
  };
})();
