/** @file Owns independent director/franchise ballot membership, progress, and optimistic Supabase persistence. */
(function () {
  const table = "collection_ballots";
  const select =
    "id, collection_type, collection_id, collection_name, nominations, reviews, revision";
  const capacity = (category) => (category === "Best Picture" ? 10 : 5);
  const conflict = () =>
    new Error(
      "This collection ballot changed in another tab. Reload before editing again.",
    );

  /** Returns the builder URL for a director or franchise. @param {'director'|'franchise'} type Collection type. @param {string} id Normalized collection id. @returns {string} Builder URL. */
  window.collectionBallotUrl = function (type, id) {
    return `awards-year.html?collection=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  };

  /** Resolves watched collection membership, including franchise descendants. @param {Object} source Watched rows and franchise catalog. @param {'director'|'franchise'} type Collection type. @param {string} id Normalized collection id. @returns {Object|null} Collection name and deduplicated watched films. */
  window.resolveCollectionBallotContext = function (source, type, id) {
    if (!["director", "franchise"].includes(type) || !id) return null;
    let name = "";
    let members = new Map();
    let franchises = new Map(
      (source.franchises || []).map((row) => [row.id, row]),
    );
    let roots = new Set();
    if (type === "franchise") {
      for (let row of franchises.values()) {
        if (window.normalizeTitle(row.name) === id) {
          name = row.name;
          roots.add(row.id);
        }
      }
    }
    function belongs(franchiseId) {
      let visited = new Set();
      while (franchiseId && !visited.has(franchiseId)) {
        if (roots.has(franchiseId)) return true;
        visited.add(franchiseId);
        franchiseId = franchises.get(franchiseId)?.parent_id;
      }
      return false;
    }
    for (let row of source.watched || []) {
      let film = row.films;
      if (!film?.id) continue;
      let included = false;
      if (type === "director") {
        for (let credit of film.credits || []) {
          // A people.id uuid (issue #633) matches the credit's own person;
          // a legacy name slug still matches by normalized name.
          let matches = window.isUuid?.(id)
            ? credit.people?.id === id
            : window.normalizePersonName(credit.people?.name || "") === id;
          if (credit.role === "director" && matches) {
            name = credit.people.name;
            included = true;
          }
        }
      } else
        included = (film.film_franchises || []).some((link) =>
          belongs(link.franchise_id || link.franchises?.id),
        );
      if (included) members.set(film.id, film);
    }
    return name ? { type, id, name, films: [...members.values()] } : null;
  };

  async function readyClient() {
    let ready = await window.ensureSupabaseClient();
    let auth = await window.resolveSupabaseAuthState();
    if (!ready || auth.status !== "signed-in")
      throw new Error("Sign in to build collection awards.");
    return { client: ready.client, ownerId: auth.user.id };
  }

  /** Reads an owner's saved collection ballot without creating an empty row. @param {'director'|'franchise'} type Collection type. @param {string} id Normalized collection id. @returns {Promise<CollectionBallotRecord|null>} Persisted ballot. */
  window.loadSupabaseCollectionBallot = async function (type, id) {
    let { client } = await readyClient();
    let { data, error } = await client
      .from(table)
      .select(select)
      .eq("collection_type", type)
      .eq("collection_id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  /** Loads the watched membership and private ballot for one collection builder. @param {'director'|'franchise'} type Collection type. @param {string} id Normalized collection id. @returns {Promise<Object>} Account-bound builder session. */
  window.loadSupabaseCollectionBallotSession = async function (type, id) {
    let { client, ownerId } = await readyClient();
    let [watched, franchises, ballotRow] = await Promise.all([
      window.fetchAllSupabaseRows((count) =>
        client
          .from("watched")
          .select(
            "id, films(id, tmdb_id, title, year, poster_url, primary_country, country, medium, screenplay_type, original_language, credits(role, people(id, name)), film_franchises(franchise_id))",
            count ? { count: "exact" } : undefined,
          )
          .order("id"),
      ),
      type === "franchise"
        ? window.fetchAllSupabaseRows((count) =>
            client
              .from("franchises")
              .select(
                "id, name, parent_id",
                count ? { count: "exact" } : undefined,
              )
              .order("id"),
          )
        : [],
      window.loadSupabaseCollectionBallot(type, id),
    ]);
    let context = window.resolveCollectionBallotContext(
      { watched, franchises },
      type,
      id,
    );
    let ballot = ballotRow;
    if (!context)
      throw new Error("Collection not found in your watched films.");
    // A director ballot saved before person keys moved to people.id (issue
    // #633) is still under the name slug - move it over on first open.
    if (!ballot && type === "director" && window.isUuid?.(id)) {
      let moved = await window.adoptLegacySupabaseKey({
        table,
        kindColumn: "collection_type",
        kind: "director",
        keyColumn: "collection_id",
        fromKey: window.normalizePersonName(context.name),
        toKey: id,
      });
      if (moved) ballot = await window.loadSupabaseCollectionBallot(type, id);
    }
    if (window.getSupabaseCurrentUser?.()?.id !== ownerId)
      throw new Error("Account changed. Reload this page.");
    return { ...context, ownerId, ballot };
  };

  /** Validates a collection ballot before saving or restoring a backup. @param {CollectionBallotRecord} ballot Stored ballot fields. */
  window.validateCollectionBallot = function (ballot) {
    if (
      !ballot ||
      !["director", "franchise"].includes(ballot.collection_type) ||
      !ballot.collection_id ||
      !ballot.collection_name ||
      !Array.isArray(ballot.nominations) ||
      !ballot.reviews ||
      Array.isArray(ballot.reviews) ||
      typeof ballot.reviews !== "object"
    )
      throw new Error("Invalid collection ballot.");
    let ids = new Set();
    let groups = new Map();
    for (let nomination of ballot.nominations) {
      if (
        !nomination?.id ||
        ids.has(nomination.id) ||
        !nomination.film_id ||
        !nomination.category ||
        !Number.isInteger(nomination.placement) ||
        !Array.isArray(nomination.recipients) ||
        nomination.recipients.some((name) => typeof name !== "string") ||
        typeof nomination.detail !== "string" ||
        !nomination.films?.title
      )
        throw new Error("Invalid collection nomination.");
      ids.add(nomination.id);
      let group = groups.get(nomination.category) || [];
      group.push(nomination);
      groups.set(nomination.category, group);
    }
    for (let [category, group] of groups) {
      group.sort((a, b) => a.placement - b.placement);
      if (
        group.length > capacity(category) ||
        group.some((n, i) => n.placement !== i + 1)
      )
        throw new Error("Invalid collection placements.");
    }
    for (let status of Object.values(ballot.reviews))
      if (!["complete", "none"].includes(status))
        throw new Error("Invalid collection review.");
  };

  /** Derives the shared builder's category progress from an isolated collection ballot. @param {Object} session Collection builder session. @returns {Object} Category progress and hydrated nominations. */
  window.collectionBallotProgress = function (session) {
    let ballot = session.ballot || { nominations: [], reviews: {} };
    let films = new Map(session.films.map((film) => [film.id, film]));
    let categories = (window.getOrderedCategories?.() || []).map((category) => {
      let nominations = ballot.nominations
        .filter((n) => n.category === category)
        .sort((a, b) => a.placement - b.placement)
        .map((n) => ({
          ...n,
          films: films.get(n.film_id) || n.films,
          personal_nomination_recipients: n.recipients.map(
            (recipient_name) => ({ recipient_name }),
          ),
        }));
      let status = ballot.reviews[category];
      return {
        category,
        nominations,
        review: status ? { status } : null,
        reviewed: Boolean(status),
        winner: nominations.find((n) => n.placement === 1) || null,
      };
    });
    return {
      personalAwardId: ballot.id || null,
      categories,
      total: categories.length,
      reviewed: categories.filter((c) => c.reviewed).length,
      complete: categories.length > 0 && categories.every((c) => c.reviewed),
      nextCategory: categories.find((c) => !c.reviewed)?.category || "",
      winners: categories.map((c) => c.winner).filter(Boolean),
    };
  };

  /** Applies one collection ballot operation without mutating the original record. @param {Object} session Builder session. @param {Object} action Nomination or review operation. @returns {CollectionBallotRecord} Validated replacement fields. */
  window.planCollectionBallotChange = function (session, action) {
    let ballot = session.ballot || { nominations: [], reviews: {} };
    let next = {
      collection_type: session.type,
      collection_id: session.id,
      collection_name: session.name,
      nominations: JSON.parse(JSON.stringify(ballot.nominations)),
      reviews: { ...ballot.reviews },
    };
    let category = action.category;
    if (!(window.getOrderedCategories?.() || []).includes(category))
      throw new Error("Unknown award category.");
    let group = next.nominations
      .filter((n) => n.category === category)
      .sort((a, b) => a.placement - b.placement);
    if (action.type === "review") {
      if (
        !["complete", "none"].includes(action.status) ||
        (action.status === "none" && group.length) ||
        (action.status === "complete" && !group.length)
      )
        throw new Error(
          "Review outcome does not match this category's nominees.",
        );
      next.reviews[category] = action.status;
    } else {
      delete next.reviews[category];
      if (action.type === "insert") {
        let film = session.films.find((f) => f.id === action.filmId);
        if (!film)
          throw new Error("Choose a watched film from this collection.");
        if (
          !window.isMultiNomineeCategory?.(category) &&
          group.some((n) => n.film_id === film.id)
        )
          throw new Error("This film is already nominated in this category.");
        let index = Math.max(
          0,
          Math.min(Number(action.placement) - 1, group.length),
        );
        group.splice(index, 0, {
          id: window.crypto.randomUUID(),
          category,
          film_id: film.id,
          films: {
            id: film.id,
            title: film.title,
            year: film.year,
            poster_url: film.poster_url,
          },
          detail: action.detail || "",
          recipients: action.recipients || [],
        });
        group = group.slice(0, capacity(category));
      } else {
        let index = group.findIndex((n) =>
          action.nominationId
            ? n.id === action.nominationId
            : n.film_id === action.filmId &&
              n.placement === Number(action.placement),
        );
        if (index < 0)
          throw new Error("This nomination changed. Reload the ballot.");
        if (action.type === "delete") group.splice(index, 1);
        else if (action.type === "move") {
          let [nomination] = group.splice(index, 1);
          group.splice(
            Math.max(0, Math.min(Number(action.toPlacement) - 1, group.length)),
            0,
            nomination,
          );
        } else if (action.type === "credit") {
          group[index].recipients = action.recipients;
          if (action.detail !== undefined) group[index].detail = action.detail;
        } else throw new Error("Unknown ballot operation.");
      }
      group.forEach((n, i) => {
        n.placement = i + 1;
      });
      next.nominations = next.nominations
        .filter((n) => n.category !== category)
        .concat(group);
    }
    window.validateCollectionBallot(next);
    return next;
  };

  /** Saves one atomic collection ballot change and rejects stale revisions or account changes. @param {Object} session Account-bound builder session. @param {Object} action Nomination/review operation. @returns {Promise<void>} Resolves after persistence and session refresh. */
  window.changeSupabaseCollectionBallot = async function (session, action) {
    if (session.busy)
      throw new Error("Wait for the current nomination to finish saving.");
    session.busy = true;
    try {
      let { client, ownerId } = await readyClient();
      if (ownerId !== session.ownerId)
        throw new Error("Account changed. Reload this page.");
      let next = window.planCollectionBallotChange(session, action);
      let query = session.ballot
        ? client
            .from(table)
            .update(next)
            .eq("id", session.ballot.id)
            .eq("revision", session.ballot.revision)
        : client.from(table).insert(next);
      let { data, error } = await query.select(select).maybeSingle();
      if (error?.code === "23505" || (!error && !data)) throw conflict();
      if (error) throw error;
      if (window.getSupabaseCurrentUser?.()?.id !== session.ownerId)
        throw new Error("Account changed. Reload this page.");
      session.ballot = data;
    } finally {
      session.busy = false;
    }
  };

  /** Converts a persisted collection ballot to the collection Awards view model. @param {CollectionBallotRecord|null} ballot Saved ballot. @returns {Object|null} Read-only view model. */
  window.supabaseCollectionBallotViewModel = function (ballot) {
    if (!ballot) return null;
    let progress = window.collectionBallotProgress({ ballot, films: [] });
    return {
      bracket: { sourceUrl: "" },
      unresolved: [],
      categories: progress.categories
        .filter((c) => c.nominations.length)
        .map((c) => ({
          category: c.category,
          nominations: c.nominations.map((n) => ({
            ...n,
            sourceTitle: n.films.title,
            recipient: n.recipients.join(", "),
            href: window.filmPageUrl(n.film_id),
          })),
        })),
    };
  };
})();
