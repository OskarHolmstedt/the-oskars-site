/** @file Owns URL-safe union/intersection expressions and catalog collection membership. */
(function () {
  const modes = ["any", "all"];
  const types = ["tag", "franchise", "person", "period"];

  /** Parses a bounded collection expression, rejecting malformed input as a whole. @param {string} value Serialized expression. @returns {CollectionFilterExpression|null} Valid expression or null. */
  window.parseCollectionFilter = function (value) {
    if (!value || value.length > 20000) return null;
    try {
      let expression = JSON.parse(value);
      if (
        !modes.includes(expression.mode) ||
        !Array.isArray(expression.groups) ||
        expression.groups.length > 20
      )
        return null;
      for (let group of expression.groups) {
        if (
          !group ||
          !modes.includes(group.mode) ||
          !Array.isArray(group.items) ||
          group.items.length > 50
        )
          return null;
        for (let item of group.items) {
          if (
            !item ||
            !types.includes(item.type) ||
            typeof item.id !== "string" ||
            !item.id.trim() ||
            item.id.length > 500
          )
            return null;
          if (
            item.type === "period" &&
            !/^(year:\d{4}|(?:decade|century):\d{4}s|unknown|alltime:alltime)$/.test(
              item.id,
            )
          )
            return null;
        }
      }
      return expression;
    } catch {
      return null;
    }
  };

  /** Combines nonempty groups with explicit union or intersection semantics. @param {CollectionFilterExpression|null} expression Collection expression. @param {Function} matches Membership predicate. @returns {boolean} Whether the film matches. */
  window.matchesCollectionFilter = function (expression, matches) {
    let groups = expression?.groups.filter((group) => group.items.length) || [];
    if (!groups.length) return true;
    return groups[expression.mode === "any" ? "some" : "every"]((group) =>
      group.items[group.mode === "any" ? "some" : "every"](matches),
    );
  };

  /** Builds collection choices and membership sets over the merged catalog. @param {FilmRecord[]} films Catalog films. @returns {CatalogCollectionChoice[]} Named collection choices with catalog member sets. */
  window.buildCatalogCollectionChoices = function (films) {
    let choices = new Map();
    let filmsById = new Map();
    function add(type, id, name, film) {
      if (!id) return;
      let key = JSON.stringify([type, id]);
      if (!choices.has(key))
        choices.set(key, { type, id, name, members: new Set() });
      if (film) choices.get(key).members.add(film);
      return choices.get(key);
    }
    films.forEach((film) => {
      [film.id, film.supabaseFilmId]
        .filter(Boolean)
        .forEach((id) => filmsById.set(id, film));
      (window.parseFilmTags(film.tags) || []).forEach((tag) =>
        add("tag", window.normalizeFilmTag(tag).toLocaleLowerCase(), tag, film),
      );
      let year = String(film.year || "");
      if (/^\d{4}$/.test(year)) {
        add("period", `year:${year}`, year, film);
        let decade = window.getDecadeKey(year),
          century = window.getCenturyKey(year);
        add("period", `decade:${decade}`, decade, film);
        add("period", `century:${century}`, century, film);
      } else add("period", "unknown", "Unknown year", film);
      add("period", "alltime:alltime", "All time", film);
    });
    Object.values(window.ensurePeopleIndex?.() || {}).forEach((person) => {
      let choice = add("person", person.id, person.name);
      [
        ...(person.filmIds || []),
        ...(person.watchedOtherIds || []),
        ...(person.watchlistIds || []),
        ...(person.catalogIds || []),
      ].forEach((id) => {
        if (filmsById.has(id)) choice.members.add(filmsById.get(id));
      });
    });
    let franchises = window.ensureFranchiseIndex?.() || {};
    Object.values(franchises).forEach((franchise) => {
      let choice = add("franchise", franchise.id, franchise.name);
      [
        ...(franchise.films || []),
        ...(franchise.otherFilms || []),
        ...(franchise.watchlistFilms || []),
      ].forEach((entry) => {
        let film = filmsById.get(entry.filmId || entry.itemId);
        if (film) choice.members.add(film);
      });
    });
    // Catalog-only films are absent from the personal franchise index.
    films.forEach((film) => {
      window
        .normalizeFranchiseMemberships(film.franchises)
        .forEach((membership) => {
          let pending = [
            [membership.id, membership.name],
            ...(membership.parentChainIds || []).map((id, index) => [
              id,
              membership.parentChainNames[index],
            ]),
            ...(membership.parentIds || []).map((id, index) => [
              id,
              membership.parentNames[index],
            ]),
          ];
          let seen = new Set();
          while (pending.length) {
            let [id, name] = pending.pop();
            if (seen.has(id)) continue;
            seen.add(id);
            add("franchise", id, franchises[id]?.name || name || id, film);
            (franchises[id]?.parentIds || []).forEach((parent) =>
              pending.push([parent, franchises[parent]?.name]),
            );
          }
        });
    });
    return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
})();
