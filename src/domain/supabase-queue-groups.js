/**
 * @file Pure grouping for the Supabase-backed queue pages (Rate watched and
 * Set watchlist tier): splits the workspace's watched or watchlist rows into
 * release years, director filmographies or franchises. Director and
 * franchise membership comes from loadSupabaseQueueMembership()'s rows; a
 * franchise includes its sub-franchises' films, as the Build hub's
 * collection ceremonies do.
 *
 * No DOM, no Supabase SDK import - directly Node-testable.
 */

/**
 * The workspace rows a queue page works through: every row of one
 * workspace part whose film has a concrete release year.
 * @param {'watched'|'watchlist'} part Workspace part.
 * @returns {Object[]} Rows, each joined with its film.
 */
window.supabaseQueueRows = function (part) {
  let workspace = window.getSupabaseWorkspace?.();
  return (workspace?.[part] || []).filter((row) =>
    Number.isInteger(row.films?.year),
  );
};

/**
 * Indexes each film's directors and franchises (with every ancestor
 * franchise) from loadSupabaseQueueMembership()'s rows. Directors are keyed
 * by people.id, franchises by normalized name - the ids person.html,
 * franchise.html and the collection ballots use.
 * @param {{rows: Object[], franchises: Object[]}} source Rows shaped `{film_id, films: {credits, film_franchises: {franchise_id}[]}}` plus the franchise catalog (`{id, name, parent_id}`).
 * @returns {Map<string, {director: {id: string, name: string}[], franchise: {id: string, name: string}[]}>} Film id -> its collections.
 */
window.indexSupabaseQueueMembership = function (source) {
  let franchises = new Map(
    (source?.franchises || []).map((row) => [row.id, row]),
  );
  let index = new Map();
  for (let row of source?.rows || []) {
    let film = row.films;
    let filmId = row.film_id || film?.id;
    if (!filmId || index.has(filmId)) continue;
    let directors = new Map();
    for (let credit of film?.credits || []) {
      let person = credit.people;
      if (credit.role !== "director" || !person?.name) continue;
      let id = person.id || window.normalizeTitle(person.name);
      directors.set(id, { id, name: person.name });
    }
    let franchiseIds = new Set();
    for (let link of film?.film_franchises || []) {
      let franchiseId = link.franchise_id;
      while (franchiseId && !franchiseIds.has(franchiseId)) {
        franchiseIds.add(franchiseId);
        franchiseId = franchises.get(franchiseId)?.parent_id;
      }
    }
    let byName = new Map();
    for (let franchiseId of franchiseIds) {
      let name = franchises.get(franchiseId)?.name;
      if (!name) continue;
      let id = window.normalizeTitle(name);
      byName.set(id, { id, name });
    }
    index.set(filmId, {
      director: [...directors.values()],
      franchise: [...byName.values()],
    });
  }
  return index;
};

function compareYearTitle(left, right) {
  return (
    left.films.year - right.films.year ||
    String(left.films.title).localeCompare(String(right.films.title))
  );
}

/**
 * Groups queue rows by release year, director or franchise. Years run
 * oldest first; directors and franchises run largest first, then by name.
 * A row joins every collection its film belongs to, so a co-directed film
 * or a sub-franchise film appears in several groups. Rows within a group
 * run by release year, then title.
 * @param {Object[]} rows Queue rows from supabaseQueueRows().
 * @param {'year'|'director'|'franchise'} kind Grouping.
 * @param {Map<string, Object>} [membership] indexSupabaseQueueMembership() result; required for director and franchise.
 * @returns {{id: string, name: string, rows: Object[]}[]} Groups.
 */
window.groupSupabaseQueueRows = function (rows, kind, membership) {
  let groups = new Map();
  function add(id, name, row) {
    let group = groups.get(id);
    if (!group) {
      group = { id, name, rows: [] };
      groups.set(id, group);
    }
    group.rows.push(row);
  }
  for (let row of rows || []) {
    if (kind === "year") {
      add(String(row.films.year), String(row.films.year), row);
      continue;
    }
    let collections = membership?.get(row.film_id)?.[kind] || [];
    collections.forEach((collection) =>
      add(collection.id, collection.name, row),
    );
  }
  let result = [...groups.values()];
  result.forEach((group) => group.rows.sort(compareYearTitle));
  return kind === "year"
    ? result.sort((left, right) => Number(left.id) - Number(right.id))
    : result.sort(
        (left, right) =>
          right.rows.length - left.rows.length ||
          left.name.localeCompare(right.name),
      );
};
