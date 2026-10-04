/** @file Loads and caches compact Home RPC responses by account, public profile, local date and sort without hydrating the archive. */

(function () {
  let generation = 0;
  let owner = window.getSupabaseCurrentUser?.()?.id || null;
  let pending = new Map();
  const prefix = "oskars-home-cache:v1:";
  const ttl = 5 * 60 * 1000;

  function scope() {
    let slug = window.resolveActiveProfileSlug?.() || "";
    return {
      slug,
      user: slug ? "" : window.getSupabaseCurrentUser?.()?.id || "",
    };
  }

  function clear() {
    generation += 1;
    pending.clear();
    try {
      let keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        let key = sessionStorage.key(i);
        if (key?.startsWith(prefix)) keys.push(key);
      }
      keys.forEach((key) => sessionStorage.removeItem(key));
    } catch (_) {}
  }

  async function read(client, name, params, identity, date, isCurrent) {
    let key = prefix + JSON.stringify([identity, date, name, params]);
    try {
      let cached = JSON.parse(sessionStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.at < ttl) return cached.data;
    } catch (_) {}
    if (pending.has(key)) return pending.get(key);
    let request = (async () => {
      let { data, error } = await client.rpc(name, params);
      if (error) throw error;
      if (!isCurrent())
        throw new Error("The account or archive changed. Please try again.");
      if (name === "read_home_dashboard" && identity.slug) {
        let result = await client
          .from("profiles")
          .select("display_name, public_slug")
          .eq("public_slug", identity.slug)
          .maybeSingle();
        if (result.error) throw result.error;
        if (!result.data || !isCurrent())
          throw new Error("This profile is unavailable.");
        data.profile = result.data;
      }
      if (data?.version !== 1) throw new Error("Unsupported Home response.");
      if (
        name === "read_home_leaderboard" &&
        (!Array.isArray(data.entries) || data.entries.length > 25)
      )
        throw new Error("Invalid Home leaderboard response.");
      try {
        sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
      } catch (_) {}
      return data;
    })().finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
    pending.set(key, request);
    return request;
  }

  function film(source, row = {}) {
    if (!source) return null;
    let directors = (source.credits || []).filter(
      (credit) => credit.role === "director" && credit.people?.name,
    );
    let record = {
      id: source.id,
      supabaseFilmId: source.id,
      title: source.title,
      year: source.year == null ? "" : String(source.year),
      type: source.type || "",
      swedishTitle: source.swedish_title || "",
      tmdbId: source.tmdb_tv_ref || String(source.tmdb_id || ""),
      director: directors.map((credit) => credit.people.name).join(", "),
      directors: directors.map((credit) => credit.people.name),
      directorIds: directors.map((credit) => credit.people.id),
      directorUncredited: directors.map((credit) => Boolean(credit.uncredited)),
      poster: source.poster_url
        ? { url: source.poster_url, source: "tmdb" }
        : null,
      ratingValue: Number(row.rating) || 0,
      ratingModifier: row.rating_modifier || "",
      allTimeRank: row.allTimeRank || null,
      suppressAllTimeRank: Boolean(row.suppressAllTimeRank),
      rankingGroupId: row.rankingGroupId || null,
    };
    record.rating = window.renderFilmRating(record);
    return record;
  }

  /** Converts versioned compact responses into Home presentation fields without publishing archive state. @param {Object} dashboard Daily counts and cards. @param {Object} leaderboard Ordered Top 25. @param {Object|null} actions Owner-only action summary. @param {boolean} publicProfile Whether this is a published archive. @returns {Object} Home presentation model. */
  window.buildSupabaseHomeModel = function (
    dashboard,
    leaderboard,
    actions,
    publicProfile,
  ) {
    if (
      dashboard?.version !== 1 ||
      leaderboard?.version !== 1 ||
      (actions && actions.version !== 1)
    )
      throw new Error("Unsupported Home response.");
    let zero = {
      awardScore: 0,
      normalizedAwardScore: 0,
      wins: 0,
      nominations: 0,
    };
    let pick = dashboard.watchlistPick;
    let next = actions?.project;
    return {
      profile: dashboard.profile || null,
      counts: dashboard.counts,
      publicProfile,
      actions,
      memory: dashboard.memory
        ? {
            ...dashboard.memory,
            film: film(dashboard.memory.film, dashboard.memory),
          }
        : null,
      watchlistPick: pick
        ? {
            item: {
              ...film(pick.films),
              tier: pick.tier || "",
              tierModifier: pick.tier_modifier || "",
            },
            reason: pick.reason,
          }
        : null,
      intake: actions?.intake
        ? { ...actions.intake, watched: { films: film(actions.intake.film) } }
        : null,
      projects: next
        ? [
            {
              project: { id: next.id, name: next.name },
              next: {
                film: film(next.film),
                href: window.filmPageUrl(next.film.id),
              },
            },
          ]
        : [],
      entries: leaderboard.entries.map((row) => ({
        film: film(row.film, row),
        allStats: { wins: row.wins, nominations: row.nominations },
        yearScoreStats: row.stats.years || zero,
        decadeScoreStats: row.stats.decades || zero,
        centuryScoreStats: row.stats.centuries || zero,
        allTimeScoreStats: row.stats.allTime || zero,
      })),
    };
  };

  /** Reads Home's compact daily cards, actions and ordered leaderboard with identity and write guards. @param {Object} [options] Sort selection. @param {string} [options.sort] Current sort. @param {string} [options.previousSort] Previous sort for ties. @returns {Promise<Object>} Home presentation model. */
  window.loadSupabaseHome = async function (options = {}) {
    let identity = scope();
    let requestGeneration = generation;
    let isCurrent = () =>
      generation === requestGeneration &&
      JSON.stringify(scope()) === JSON.stringify(identity);
    let ready;
    if (identity.slug) ready = await window.ensureSupabasePublicClient();
    else {
      let auth = await window.resolveSupabaseAuthState();
      if (auth.status !== "signed-in" || auth.user.id !== identity.user)
        throw new Error("Sign in to view Home.");
      ready = await window.ensureSupabaseClient();
    }
    if (!ready || !isCurrent())
      throw new Error("Home is unavailable. Please try again.");
    let now = new Date();
    let date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let params = { p_public_slug: identity.slug || null };
    let [dashboard, leaderboard, actionResult] = await Promise.all([
      read(
        ready.client,
        "read_home_dashboard",
        { ...params, p_local_date: date },
        identity,
        date,
        isCurrent,
      ),
      read(
        ready.client,
        "read_home_leaderboard",
        {
          ...params,
          p_sort: options.sort || "yearScore",
          p_previous_sort: options.previousSort || null,
        },
        identity,
        date,
        isCurrent,
      ),
      identity.slug
        ? Promise.resolve({ data: null })
        : read(
            ready.client,
            "read_home_actions",
            {},
            identity,
            date,
            isCurrent,
          ).then(
            (data) => ({ data }),
            (error) => ({ data: null, error }),
          ),
    ]);
    if (!isCurrent())
      throw new Error("The account or archive changed. Please try again.");
    let model = window.buildSupabaseHomeModel(
      dashboard,
      leaderboard,
      actionResult.data,
      Boolean(identity.slug),
    );
    model.actionsError = Boolean(actionResult.error);
    return model;
  };

  window.addEventListener?.("oskars:hydration-invalidated", clear);
  window.onSupabaseAuthChange?.((user) => {
    let next = user?.id || null;
    if (next !== owner) {
      owner = next;
      if (window.resolveActiveProfileSlug?.()) return;
      clear();
      window.dispatchEvent?.(new CustomEvent("oskars:home-account-changed"));
    }
  });
})();
